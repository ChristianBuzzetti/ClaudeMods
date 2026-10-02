// Runs the Boberto engine (engine.generated.mjs, the original boberto.js
// wrapped in a function) inside the hooks module's own environment: the
// browser globals it reads are stubbed here, its canvas is a recording
// context that emits SVG (svg-context.mjs), and its timers run on a virtual
// clock, so a gesture's choreography (the engine's own g_* functions) plays
// to the end in a few milliseconds and leaves a flipbook behind.
//
// Pure: no `$`. The build script loads this same file to measure and preview.

import { bootEngine } from './engine.generated.mjs'
import type { BobertoEngine } from './engine.generated.mjs'
import { DefsRegistry, SvgContext, makeFormatter } from './svg-context.mjs'
import type { BobertoAnimation, BobertoMotion, BobertoStep } from './assemble'

/** What Boberto wears: an accessory, a body color, an eye color, a glow. */
export type Outfit = {
  /** An id of the engine's HAT_PRESETS ('limpio' is none). */
  hat: string
  /** 'auto' (the engine's own palette) or an id of SKIN_PRESETS. */
  skin: string
  /** 'auto' or a hex color of EYE_PRESETS. */
  eye: string
  /** 'none' or a hex color for a drop-shadow halo. */
  glow: string
}

export const DEFAULT_OUTFIT: Outfit = { hat: 'alasmurcielago', skin: 'auto', eye: 'auto', glow: 'none' }

// ---------------------------------------------------------------------------
// A browser just deep enough for the engine's load-time code.

type Loose = Record<string | symbol, unknown>

/** A value that absorbs any property access, call or construction. */
function absorber(): Loose {
  const store = new Map<string | symbol, unknown>()
  const target = function () {}
  return new Proxy(target, {
    get(_, prop) {
      if (store.has(prop)) return store.get(prop)
      if (prop === Symbol.toPrimitive) return () => ''
      if (prop === Symbol.iterator) return function* () {}
      if (prop === 'then') return undefined
      if (prop === 'length') return 0
      if (prop === 'toString' || prop === 'valueOf') return () => ''
      const child = absorber()
      store.set(prop, child)
      return child
    },
    set(_, prop, value) {
      store.set(prop, value)
      return true
    },
    apply: () => absorber(),
    construct: () => absorber(),
    has: () => true,
  }) as unknown as Loose
}

/** A CSSStyleDeclaration: plain properties plus the methods the engine calls. */
function styleOf(): Loose {
  const style: Loose = {}
  Object.assign(style, {
    setProperty: (k: string, v: unknown) => void (style[k] = v),
    removeProperty: (k: string) => void delete style[k],
    getPropertyValue: (k: string) => String(style[k] ?? ''),
  })
  return style
}

function element(tag: string): Loose {
  const el = absorber()
  Object.assign(el, {
    tagName: String(tag).toUpperCase(),
    style: styleOf(),
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    dataset: {},
    children: [],
    childNodes: [],
    isConnected: true,
    clientWidth: 0,
    clientHeight: 0,
    offsetWidth: 0,
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
    getClientRects: () => [],
    getContext: () => null,
    appendChild: (n: unknown) => n,
    removeChild: (n: unknown) => n,
    remove: () => {},
    contains: () => false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  return el
}

function memoryStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: unknown) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

// ---------------------------------------------------------------------------
// Virtual time: the engine's setTimeout, requestAnimationFrame and Date.now.

type Timer = { at: number; seq: number; fn: (...args: unknown[]) => void; args: unknown[]; every?: number }

const EPOCH = Date.UTC(2026, 0, 1, 12)
const FRAME_MS = 16

class VirtualClock {
  now = 0
  private seq = 0
  private timers = new Map<number, Timer>()

  add(fn: unknown, ms: unknown, args: unknown[], every?: number) {
    const id = ++this.seq
    if (typeof fn !== 'function') return id
    const delay = Math.max(0, Number(ms) || 0)
    this.timers.set(id, { at: this.now + delay, seq: id, fn: fn as Timer['fn'], args, every: every === undefined ? undefined : Math.max(1, delay) })
    return id
  }
  clear(id: unknown) {
    this.timers.delete(Number(id))
  }
  reset() {
    this.timers.clear()
  }
  /** Runs the earliest timer, advancing `now` to it; false when none is left. */
  step(limit: number) {
    let next: [number, Timer] | null = null
    for (const entry of this.timers) {
      if (next === null || entry[1].at < next[1].at || (entry[1].at === next[1].at && entry[1].seq < next[1].seq)) next = entry
    }
    if (next === null || next[1].at > limit) return false
    const [id, timer] = next
    this.now = timer.at
    if (timer.every !== undefined) timer.at += timer.every
    else this.timers.delete(id)
    try {
      timer.fn(...timer.args)
    } catch {
      // A failing callback must not stop the clock.
    }
    return true
  }
}

/** Lets every pending continuation of the choreography run. */
async function settle() {
  for (let i = 0; i < 48; i++) await Promise.resolve()
}

// ---------------------------------------------------------------------------
// The engine, booted once per module load.

type Recorder = { ctx: SvgContext; dirty: boolean }

type Host = {
  api: BobertoEngine
  clock: VirtualClock
  /** The recorder the next `createElement('canvas')` gets. */
  pending: Recorder | null
  outfit: string
}

let host: Host | null = null

function boot(): Host {
  if (host !== null) return host
  const clock = new VirtualClock()
  const state: Host = { api: null as unknown as BobertoEngine, clock, pending: null, outfit: '' }

  const createElement = (tag: string) => {
    const el = element(tag)
    if (String(tag).toLowerCase() === 'canvas' && state.pending !== null) {
      const rec = state.pending
      state.pending = null
      el['getContext'] = () => rec.ctx
      rec.ctx.canvas = el
      // A whole-canvas clear starts a new frame.
      const clear = rec.ctx.clearRect.bind(rec.ctx)
      rec.ctx.clearRect = (x: number, y: number, w: number, h: number) => {
        rec.dirty = true
        clear(x, y, w, h)
      }
    }
    return el
  }

  const document = absorber()
  Object.assign(document, {
    readyState: 'loading',
    documentElement: element('html'),
    head: element('head'),
    body: element('body'),
    createElement,
    createElementNS: (_: string, tag: string) => element(tag),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    hidden: false,
    visibilityState: 'visible',
  })

  class VirtualDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(EPOCH + clock.now)
      else super(...(args as [string]))
    }
    static override now() {
      return EPOCH + clock.now
    }
  }

  const window: Loose = {
    document,
    localStorage: memoryStorage({ mascota_enabled: 'true', boberto_character: 'none' }),
    sessionStorage: memoryStorage({}),
    navigator: { userAgent: 'claude-code', language: 'en', languages: ['en'], maxTouchPoints: 0 },
    location: { href: 'http://localhost/', pathname: '/', search: '', hash: '' },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout: (fn: unknown, ms: unknown, ...args: unknown[]) => clock.add(fn, ms, args),
    clearTimeout: (id: unknown) => clock.clear(id),
    setInterval: (fn: unknown, ms: unknown, ...args: unknown[]) => clock.add(fn, ms, args, Number(ms) || 0),
    clearInterval: (id: unknown) => clock.clear(id),
    requestAnimationFrame: (fn: unknown) => clock.add(typeof fn === 'function' ? () => fn(clock.now) : fn, FRAME_MS, []),
    cancelAnimationFrame: (id: unknown) => clock.clear(id),
    queueMicrotask: (fn: () => void) => void Promise.resolve().then(fn),
    performance: { now: () => clock.now },
    Date: VirtualDate,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    CustomEvent: class CustomEvent {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    },
    Event: class Event {
      type: string
      constructor(type: string) {
        this.type = type
      }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
  }
  window['window'] = window
  window['self'] = window

  state.api = bootEngine(window as never)
  host = state
  return state
}

/** The engine's own option lists (franchise characters excluded by the build). */
export function engineOptions() {
  const { api } = boot()
  return {
    hats: api.listHats().map(x => ({ id: x.id, name: x.name })),
    skins: api.listSkins().map(x => ({ id: x.id, name: x.name, color: x.color })),
    eyes: api.listEyes().map(x => ({ id: x.id, name: x.name })),
    gestures: api.listGestures().map(x => ({ id: x.id, name: x.name })),
    poses: api.listPoses(),
  }
}

const outfitKey = (o: Outfit) => `${o.hat}|${o.skin}|${o.eye}|${o.glow}`

/** Points the engine's chosen skin and eyes at `outfit` (the hat goes per draw). */
function wear(h: Host, outfit: Outfit) {
  const key = `${outfit.skin}|${outfit.eye}`
  if (h.outfit === key) return
  h.api.setSkin(outfit.skin)
  h.api.setEyeColor(outfit.eye)
  h.outfit = key
}

// ---------------------------------------------------------------------------
// Drawing.

/** Engine units to drawing units in the frames (the canvas is BOX.W x BOX.H units). */
export const SCALE = 9

/** The frame box in drawing units, and a viewBox with room for motion. */
export function frameBox() {
  const { api } = boot()
  const box = api.box()
  const width = box.W * SCALE
  const height = box.H * SCALE
  return { width, height, viewBox: `${-width * 0.125} ${-height * 0.06} ${width * 1.25} ${height * 1.08}` }
}

const WING_ANGLE = -0.45 // the wings' rotate() in HATS.alasmurcielago
const WING_VARIANTS: Record<string, number> = { up: -0.75, down: -0.15 }

export type Frames = { defs: string; frames: string[]; steps: BobertoStep[] }

/**
 * Draws a list of `pose@variant` specs, each for `ms`, into one flipbook. A
 * variant (`up`, `down`) swaps the bat wings' angle and is ignored for other
 * accessories.
 */
export function drawPoses(outfit: Outfit, specs: readonly (readonly [string, number])[], digits = 1): Frames {
  const h = boot()
  wear(h, outfit)
  const { width, height } = frameBox()
  const known = new Set(h.api.listPoses())
  const fmt = makeFormatter(digits)
  const defs = new DefsRegistry('p', fmt)
  const index = new Map<string, number>()
  const frames: string[] = []
  const steps: BobertoStep[] = []
  for (const [spec, ms] of specs) {
    const [pose = 'base', variant] = spec.split('@')
    const wings = outfit.hat === 'alasmurcielago' && variant !== undefined ? WING_VARIANTS[variant] : undefined
    const key = wings === undefined ? pose : spec
    let frame = index.get(key)
    if (frame === undefined) {
      const rotateHook = wings === undefined ? undefined : (a: number) => (Math.abs(a - WING_ANGLE) < 1e-9 ? wings : a)
      const ctx = new SvgContext({ defs, fmt, rotateHook, width, height })
      const cnv = { width: 0, height: 0, style: {}, getContext: () => ctx }
      ctx.canvas = cnv
      h.api.renderPose(cnv, known.has(pose) ? pose : 'base', SCALE, { hat: outfit.hat, character: '' })
      frame = frames.length
      frames.push(ctx.toSvg())
      index.set(key, frame)
    }
    steps.push({ frame, ms })
  }
  return { defs: defs.toString(), frames, steps }
}

/**
 * Plays one of the engine's gestures (GESTOS, its g_* choreography) on a
 * mirror (`peana`) of its own, on virtual time, and returns every frame the
 * choreography drew with how long it stayed. Particles are DOM in the engine
 * and are not recorded.
 */
export async function recordGesture(outfit: Outfit, gesture: string, digits = 1): Promise<Frames | null> {
  const h = boot()
  wear(h, outfit)
  const { width, height } = frameBox()
  const fmt = makeFormatter(digits)
  const defs = new DefsRegistry('g', fmt)
  const rec: Recorder = { ctx: new SvgContext({ defs, fmt, width, height }), dirty: false }

  const box = h.api.box()
  const caja = element('div')
  Object.assign(caja, {
    clientWidth: box.W * SCALE,
    clientHeight: box.H * SCALE,
    getClientRects: () => [{}],
  })

  h.clock.reset()
  h.pending = rec
  // `cada: 0` keeps the mirror's own routine to blinks; it yields to the gesture.
  if (!h.api.peana(caja, { cada: 0, hat: outfit.hat, character: '', escalaMax: SCALE })) {
    h.pending = null
    return null
  }
  h.pending = null
  await settle()

  const shots: { svg: string; at: number }[] = []
  const shoot = () => {
    if (!rec.dirty) return
    rec.dirty = false
    const svg = rec.ctx.toSvg()
    const last = shots[shots.length - 1]
    if (last !== undefined && last.at === h.clock.now) last.svg = svg
    else if (last === undefined || last.svg !== svg) shots.push({ svg, at: h.clock.now })
  }

  rec.dirty = false
  if (!h.api.peanaGesto(caja, gesture)) {
    h.api.soltarPeana(caja)
    return null
  }
  const start = h.clock.now
  await settle()
  shoot()
  const limit = start + 30_000
  let end = limit
  while (h.clock.step(limit)) {
    await settle()
    shoot()
    // A soft pose is refused while a gesture still runs: accepted, it ended.
    if (h.api.peanaPose(caja, 'base', 1)) {
      end = h.clock.now
      break
    }
  }
  h.api.soltarPeana(caja)
  h.clock.reset()

  if (shots.length === 0) return null
  const index = new Map<string, number>()
  const frames: string[] = []
  const steps: BobertoStep[] = []
  shots.forEach((shot, i) => {
    const until = shots[i + 1]?.at ?? Math.max(end, shot.at + 400)
    const ms = Math.max(16, until - shot.at)
    let frame = index.get(shot.svg)
    if (frame === undefined) {
      frame = frames.length
      frames.push(shot.svg)
      index.set(shot.svg, frame)
    }
    const prev = steps[steps.length - 1]
    if (prev !== undefined && prev.frame === frame) prev.ms += ms
    else steps.push({ frame, ms })
  })
  return { defs: defs.toString(), frames, steps }
}

export function toAnimation(f: Frames, motion: BobertoMotion, extras: string): BobertoAnimation {
  const { width, height, viewBox } = frameBox()
  return { width, height, viewBox, defs: f.defs, frames: f.frames, steps: f.steps, motion, extras }
}

export { outfitKey }
