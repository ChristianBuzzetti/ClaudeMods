import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type {
  BobertoAnimationName,
  BobertoColorTarget,
  BobertoOutfit,
  BobertoPhase,
  BobertoTimelineEntry,
  BobertoTurnOutcome,
} from '../types'
import {
  BAND_HEIGHT,
  MINI_WIDTH,
  TIMELINE_WIDTH,
  aspectOf,
  gestureSvg,
  hasGesture,
  liveSvg,
  miniPillSvg,
  timelineAlt,
  timelineSvg,
} from './art'
import { LIVE, TOP_GESTURES } from './choreo'
import {
  CHANNEL_BAR,
  SWATCH_CARD,
  channelBarSvg,
  hexToRgb,
  isHex,
  labelSvg,
  parseByte,
  parseColor,
  randomHex,
  swatchCardSvg,
  withChannel,
} from './color'
import type { Rgb } from './color'
import { DEFAULT_OUTFIT, engineOptions } from './engine-host'

// ---------------------------------------------------------------------------
// State. Written from event hooks, handlers and timers only, never while drawing.

const animation = atom({ plugin: 'boberto', key: 'animation' } as const, 'idle')
const since = atom({ plugin: 'boberto', key: 'since' } as const, 0)
const isTurnRunning = atom({ plugin: 'boberto', key: 'isTurnRunning' } as const, false)
const preview = atom({ plugin: 'boberto', key: 'preview' } as const, null)
const gesture = atom({ plugin: 'boberto', key: 'gesture' } as const, null)
const outfit = atom({ plugin: 'boberto', key: 'outfit' } as const, DEFAULT_OUTFIT)
const timeline = atom({ plugin: 'boberto', key: 'timeline' } as const, [])
const outcomes = atom({ plugin: 'boberto', key: 'outcomes' } as const, [])
const isWardrobeOpen = atom({ plugin: 'boberto', key: 'isWardrobeOpen' } as const, false)
const wardrobeTab = atom({ plugin: 'boberto', key: 'wardrobeTab' } as const, 'hat')
const colorEditing = atom({ plugin: 'boberto', key: 'colorEditing' } as const, null)
const colorError = atom({ plugin: 'boberto', key: 'colorError' } as const, null)

const ORDER: BobertoAnimationName[] = [...LIVE]

const LABELS: Record<BobertoAnimationName, string> = {
  idle: 'Boberto is idle, breathing and flapping his wings',
  working: 'Boberto is typing on his laptop',
  searching: 'Boberto is searching with a magnifier',
  thinking: 'Boberto is thinking',
  celebrate: 'Boberto is celebrating',
  dizzy: 'Boberto is dizzy after an error',
  sleep: 'Boberto is napping',
  calm: 'Boberto shrugs and takes it easy',
}

// A few words on what he is doing, shown under him in the panel.
const STATUS: Record<BobertoAnimationName, string> = {
  idle: 'hanging around',
  working: 'typing',
  searching: 'searching',
  thinking: 'thinking',
  celebrate: 'done!',
  dizzy: 'ouch, an error',
  sleep: 'napping',
  calm: 'taking it easy',
}

const GESTURE_STATUS: Record<string, string> = {
  guitarra: 'playing guitar',
  skate: 'skating',
  mate: 'sipping mate',
  rubik: 'solving a Rubik cube',
  selfie: 'taking a selfie',
  yoyo: 'playing yo-yo',
  malabares: 'juggling',
  pesca: 'fishing',
  pintor: 'painting',
  cafe: 'having a coffee',
  avion: 'flying a paper plane',
  baila: 'dancing',
  levita: 'levitating',
  burbuja: 'blowing bubbles',
}

// English names for the engine's accessories, body colors and eye colors (its own are Spanish).
const HAT_NAMES: Record<string, string> = {
  auriculares: 'Headphones',
  antena: 'Antenna',
  copete: 'Quiff',
  cresta: 'LED crest',
  gorro: 'Cap',
  mago: 'Wizard hat',
  corona: 'Crown',
  vikingo: 'Viking helmet',
  chef: 'Chef hat',
  halo: 'Angel halo',
  lentes: 'Sunglasses',
  gato: 'Cat ears',
  ovni: 'Mini UFO',
  santa: 'Santa hat',
  copa: 'Top hat',
  pirata: 'Pirate',
  samurai: 'Samurai',
  astronauta: 'Astronaut',
  buzo: 'Diving helmet',
  alas: 'Wings',
  jetpack: 'Jetpack',
  demonio: 'Devil',
  capa: 'Cape',
  arquero: 'Archer',
  bufanda: 'Scarf',
  gladiador: 'Gladiator',
  helice: 'Propeller cap',
  yukata: 'Yukata',
  murcielago: 'Bat',
  alasmurcielago: 'Bat wings',
  bata: 'Lab coat',
  limpio: 'No accessory',
}
const SKIN_NAMES: Record<string, string> = {
  auto: 'Classic',
  terracota: 'Terracotta',
  azul: 'Blue',
  esmeralda: 'Emerald',
  violeta: 'Violet',
  ambar: 'Amber',
  rosa: 'Pink',
}
const EYE_NAMES: Record<string, string> = {
  auto: 'Natural',
  '#ffd98a': 'Amber',
  '#ffffff': 'White',
  '#7df9ff': 'Cyan',
  '#5fd38a': 'Green',
  '#2684ff': 'Blue',
  '#ff5630': 'Red',
  '#c77dff': 'Violet',
}
const GLOWS: { value: string; label: string }[] = [
  { value: 'none', label: 'No glow' },
  { value: '#8b7cf6', label: 'Violet' },
  { value: '#38bdf8', label: 'Cyan' },
  { value: '#f472b6', label: 'Pink' },
  { value: '#34d399', label: 'Emerald' },
  { value: '#fbbf24', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#ffffff', label: 'White' },
]

// Custom colors: each target's outfit field, its name, and the engine's own default it starts from.
const HEX_FIELD: Record<BobertoColorTarget, 'skinHex' | 'hatHex' | 'eyeHex' | 'glowHex'> = {
  skin: 'skinHex',
  hat: 'hatHex',
  eye: 'eyeHex',
  glow: 'glowHex',
}
const TARGETS: BobertoColorTarget[] = ['skin', 'hat', 'eye', 'glow']
const TARGET_NAMES: Record<BobertoColorTarget, string> = { skin: 'Body', hat: 'Accessory', eye: 'Eyes', glow: 'Glow' }
/** What `/boberto color` accepts for each target. */
const TARGET_WORDS: Record<string, BobertoColorTarget> = {
  body: 'skin',
  skin: 'skin',
  accessory: 'hat',
  acc: 'hat',
  hat: 'hat',
  eyes: 'eye',
  eye: 'eye',
  glow: 'glow',
  halo: 'glow',
}
const CUSTOM = 'custom'
/** The engine's PALS.default body color, its HAT_DARK accessory, and its natural iris. */
const ENGINE_BODY = '#d96c3f'
const ENGINE_ACCESSORY = '#2a2c34'
const ENGINE_IRIS = '#ffd98a'
const GLOW_SEED = '#8b7cf6'
const HAT_COLOR_NAMES: Record<string, string> = {
  '#2a2c34': 'Graphite',
  '#ffffff': 'White',
  '#5b8cff': 'Blue',
  '#10b981': 'Emerald',
  '#f59e0b': 'Amber',
  '#f43f5e': 'Red',
  '#ec4899': 'Pink',
  '#bd93f9': 'Violet',
  '#39ff14': 'Neon',
  '#ff7a3d': 'Orange',
}
const STEP = 16
/** The wardrobe's tabs, in order. */
const TABS: BobertoColorTarget[] = ['hat', 'skin', 'eye', 'glow']
/** Below this many pane columns the channel rows drop their bars. */
const BARS_FROM_COLUMNS = 46
const CHANNEL_LETTER_COLORS: Record<keyof Rgb, string> = { r: '#f87171', g: '#4ade80', b: '#60a5fa' }
const BAD_COLOR = 'Not a color: try #ff3366, f36 or 255,51,102'
const BAD_CHANNEL = 'A channel is a whole number from 0 to 255'

const SLEEP_AFTER_MS = 10 * 60_000
const CELEBRATE_MS = 3000
const DIZZY_MS = 2600
const CALM_MS = 2200
const GESTURE_GAP_MS: [number, number] = [8000, 15000]
const TIMELINE_LENGTH = 12
const OUTCOMES_LENGTH = 60
const STORE_KEY = 'outfit'

/** Boberto's own panel, and how tall he is drawn in it (CSS px). */
const PANEL = 'boberto'
const PANEL_HEIGHT = 190
const PANEL_SIZE = { columns: 40, rows: 24 }
const REACTION_HEIGHT = 72

// Tools that read or look things up show the magnifier.
const SEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'NotebookRead', 'ToolSearch'])
const SEARCH_WORDS = /search|fetch|read|find|query|explore|lookup|list|get/i

type ToolEvent = { tool: string; [k: string]: unknown }

const isSearchCall = (e: ToolEvent) => {
  if (SEARCH_TOOLS.has(e.tool)) return true
  if ((e.tool === 'Agent' || e.tool === 'Task') && e['subagent_type'] === 'Explore') return true
  return e.tool.startsWith('mcp__') && SEARCH_WORDS.test(e.tool.split('__').pop() ?? '')
}

/** The timeline phase a tool call stands for, and what to name on its chip. */
function phaseOf(e: ToolEvent): { phase: BobertoPhase; detail?: string } {
  const tool = e.tool
  const leaf = tool.split('__').pop() ?? tool
  if (tool === 'Read' || tool === 'NotebookRead' || tool === 'LS') return { phase: 'reading' }
  if (tool === 'Grep' || tool === 'Glob' || tool === 'ToolSearch') return { phase: 'searching' }
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit')
    return { phase: 'editing' }
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'BashOutput' || tool === 'Monitor')
    return { phase: 'running' }
  if (tool === 'Agent' || tool === 'Task' || tool === 'SendMessage') {
    const type = typeof e['subagent_type'] === 'string' ? e['subagent_type'] : undefined
    return { phase: 'delegating', detail: type }
  }
  if (tool === 'WebFetch' || tool === 'WebSearch' || /browser|chrome|navigate/i.test(tool)) return { phase: 'browsing' }
  if (tool === 'AskUserQuestion') return { phase: 'asking' }
  if (tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate' || tool === 'ExitPlanMode')
    return { phase: 'planning' }
  if (tool.startsWith('mcp__') && SEARCH_WORDS.test(leaf)) return { phase: 'searching', detail: leaf }
  return { phase: 'tool', detail: leaf }
}

const isAnimationName = (value: string): value is BobertoAnimationName => (ORDER as string[]).includes(value)

const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)]

/** Collapses whitespace; the end of a turn's text is how a transcript row is matched to it. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const TAIL = 80

// ---------------------------------------------------------------------------
// Customization: the engine's own options, minus its franchise characters
// (the build empties that catalog).

type Options = ReturnType<typeof engineOptions>
let options: Options | null = null
const optionsOf = () => (options ??= engineOptions())

function sanitize(value: unknown): BobertoOutfit {
  const o = optionsOf()
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof BobertoOutfit, unknown>>
  const oneOf = (x: unknown, allowed: string[], fallback: string) =>
    typeof x === 'string' && allowed.includes(x) ? x : fallback
  const clean: BobertoOutfit = {
    hat: oneOf(
      v.hat,
      o.hats.map(h => h.id),
      DEFAULT_OUTFIT.hat,
    ),
    skin: oneOf(v.skin, ['auto', ...o.skins.map(s => s.id)], DEFAULT_OUTFIT.skin),
    eye: oneOf(v.eye, ['auto', ...o.eyes.map(e => e.id)], DEFAULT_OUTFIT.eye),
    glow: oneOf(
      v.glow,
      GLOWS.map(g => g.value),
      DEFAULT_OUTFIT.glow,
    ),
  }
  // Custom colors are kept only in their canonical form; outfits stored before them have none.
  for (const target of TARGETS) {
    const hex = v[HEX_FIELD[target]]
    if (isHex(hex)) clean[HEX_FIELD[target]] = hex
  }
  return clean
}

/** The color a target shows now: its custom color, else the preset's or the engine's own. */
function currentHex(o: BobertoOutfit, target: BobertoColorTarget): string {
  switch (target) {
    case 'skin':
      return o.skinHex ?? optionsOf().skins.find(s => s.id === o.skin)?.color ?? ENGINE_BODY
    case 'hat':
      return o.hatHex ?? ENGINE_ACCESSORY
    case 'eye':
      return o.eyeHex ?? (o.eye === 'auto' ? ENGINE_IRIS : o.eye)
    case 'glow':
      return o.glowHex ?? (o.glow === 'none' ? GLOW_SEED : o.glow)
  }
}

/** `o` with a target's custom color set, or cleared with undefined. */
function withHex(o: BobertoOutfit, target: BobertoColorTarget, hex: string | undefined): BobertoOutfit {
  const next = { ...o }
  const field = HEX_FIELD[target]
  if (hex === undefined) delete next[field]
  else next[field] = hex
  return next
}

/** A few words on what he wears, for the command's answers. */
function describe(o: BobertoOutfit) {
  const body = o.skinHex ?? SKIN_NAMES[o.skin] ?? o.skin
  const eyes = o.eyeHex ?? EYE_NAMES[o.eye] ?? o.eye
  const glow = o.glowHex ?? (o.glow === 'none' ? null : (GLOWS.find(g => g.value === o.glow)?.label ?? o.glow))
  const tint = o.hatHex === undefined ? '' : ` in ${HAT_COLOR_NAMES[o.hatHex] ?? o.hatHex}`
  return `${HAT_NAMES[o.hat] ?? o.hat}${tint}, ${body} body, ${eyes} eyes, ${glow === null ? 'no glow' : `${glow} glow`}`
}

function shuffled(): BobertoOutfit {
  const o = optionsOf()
  return {
    hat: pick(o.hats.map(h => h.id)) ?? DEFAULT_OUTFIT.hat,
    skin: pick(['auto', ...o.skins.map(s => s.id)]) ?? 'auto',
    eye: pick(['auto', ...o.eyes.map(e => e.id)]) ?? 'auto',
    glow: Math.random() < 0.4 ? 'none' : (pick(GLOWS.slice(1))?.value ?? 'none'),
    // Now and then a custom color instead of a preset.
    ...(Math.random() < 0.25 ? { skinHex: randomHex() } : {}),
    ...(Math.random() < 0.3 ? { hatHex: randomHex() } : {}),
    ...(Math.random() < 0.2 ? { eyeHex: randomHex() } : {}),
    ...(Math.random() < 0.15 ? { glowHex: randomHex() } : {}),
  }
}

/** The wardrobe header's one-line summary: "bat wings · #ff3366 body · cyan eyes · violet glow". */
function summarize(o: BobertoOutfit) {
  const hat = (HAT_NAMES[o.hat] ?? o.hat).toLowerCase()
  const body = o.skinHex ?? (SKIN_NAMES[o.skin] ?? o.skin).toLowerCase()
  const eyes = o.eyeHex ?? (EYE_NAMES[o.eye] ?? o.eye).toLowerCase()
  const glow = o.glowHex ?? (o.glow === 'none' ? null : (GLOWS.find(g => g.value === o.glow)?.label ?? o.glow).toLowerCase())
  const tint = o.hatHex === undefined ? '' : ` ${o.hatHex}`
  return [`${hat}${tint}`, `${body} body`, `${eyes} eyes`, ...(glow === null ? [] : [`${glow} glow`])].join(' · ')
}

/** A preset Select's pick for a colored target: a preset clears its custom color, Custom opens its RGB card. */
async function pickColor($: EngineInterface, target: BobertoColorTarget, value: string) {
  if (value === CUSTOM) {
    // Starts from the color shown now, so choosing Custom alone changes nothing.
    await dress($, o => withHex(o, target, currentHex(o, target)))
    await update($, colorEditing, () => target)
    await update($, colorError, () => null)
    return
  }
  await update($, colorEditing, editing => (editing === target ? null : editing))
  await update($, colorError, () => null)
  if (target === 'hat') {
    await dress($, o => withHex(o, 'hat', isHex(value) ? value : undefined))
    return
  }
  const field = target === 'skin' ? 'skin' : target === 'eye' ? 'eye' : 'glow'
  await dress($, o => withHex({ ...o, [field]: value }, target, undefined))
}

/** A color typed or stepped in the RGB card, applied to the open tab's part (read live). */
async function editColor($: EngineInterface, next: (current: string) => string | null, problem: string) {
  const target = await read($, wardrobeTab)
  const hex = next(currentHex(await read($, outfit), target))
  if (hex === null) {
    await update($, colorError, () => problem)
    return
  }
  await update($, colorError, () => null)
  await dress($, o => withHex(o, target, hex))
}

/** Opens one tab of the wardrobe, its last note cleared. */
async function openTab($: EngineInterface, tab: BobertoColorTarget) {
  await update($, wardrobeTab, () => tab)
  await update($, colorError, () => null)
}

/** Back to the default outfit, the RGB card closed. */
async function resetOutfit($: EngineInterface) {
  await dress($, () => DEFAULT_OUTFIT)
  await update($, colorEditing, () => null)
  await update($, colorError, () => null)
}

/** Applies a change to the outfit, keeps it in the store, and stops a gesture drawn in the old one. */
async function dress($: EngineInterface, change: (o: BobertoOutfit) => BobertoOutfit) {
  const next = await update($, outfit, o => sanitize(change(o ?? DEFAULT_OUTFIT)))
  await $.store.set(STORE_KEY, next)
  await stopGesture($)
  armGesture($)
  return next
}

// ---------------------------------------------------------------------------
// Timers. A reload drops them with the module, and the next event re-arms them.

let returnTimer: Timer | null = null
let sleepTimer: Timer | null = null
let gestureTimer: Timer | null = null
let lastGesture: string | null = null

const cancel = (timer: Timer | null) => {
  timer?.cancel()
  return null
}

async function show($: EngineInterface, name: BobertoAnimationName) {
  const shown = await read($, animation)
  if (shown === name) return
  const at = await $.clock.now()
  await update($, animation, () => name)
  await update($, since, () => at)
}

/** Back to the resting state: working while a turn runs, idle otherwise. */
async function settle($: EngineInterface) {
  const running = await read($, isTurnRunning)
  await show($, running ? 'working' : 'idle')
  if (!running) {
    armSleep($)
    armGesture($)
  }
}

/** Plays a brief animation, then settles. */
async function flash($: EngineInterface, name: BobertoAnimationName, ms: number) {
  returnTimer = cancel(returnTimer)
  await show($, name)
  returnTimer = $.clock.after(ms, () => {
    returnTimer = null
    void settle($)
  })
}

/** Naps after a long quiet spell; any activity re-arms it. */
function armSleep($: EngineInterface) {
  sleepTimer = cancel(sleepTimer)
  sleepTimer = $.clock.after(SLEEP_AFTER_MS, () => {
    sleepTimer = null
    void (async () => {
      // Decide from live state at fire time, never from what was true when armed.
      if ((await read($, isTurnRunning)) || (await read($, animation)) !== 'idle') return
      await stopGesture($)
      await show($, 'sleep')
    })()
  })
}

async function stopGesture($: EngineInterface) {
  if ((await read($, gesture)) !== null) await update($, gesture, () => null)
}

/** Plays one gesture now: drawn first (so the pane never waits on it), then shown, then let go. */
async function playGesture($: EngineInterface, id: string) {
  const attire = await read($, outfit)
  const full = await gestureSvg(id, attire, 'full')
  if (full === null) return false
  await gestureSvg(id, attire, 'small')
  await update($, gesture, () => id)
  gestureTimer = cancel(gestureTimer)
  gestureTimer = $.clock.after(full.durationMs + 400, () => {
    gestureTimer = null
    void (async () => {
      if ((await read($, gesture)) === id) await update($, gesture, () => null)
      armGesture($)
    })()
  })
  return true
}

/** While the session is idle, a random top gesture every 8 to 15 seconds. */
function armGesture($: EngineInterface) {
  gestureTimer = cancel(gestureTimer)
  const [low, high] = GESTURE_GAP_MS
  gestureTimer = $.clock.after(low + Math.random() * (high - low), () => {
    gestureTimer = null
    void (async () => {
      const isIdle =
        !(await read($, isTurnRunning)) && (await read($, animation)) === 'idle' && (await read($, preview)) === null
      if (!isIdle) return
      const known = new Set(optionsOf().gestures.map(g => g.id))
      const choices = TOP_GESTURES.filter(id => known.has(id) && id !== lastGesture)
      const id = pick(choices)
      if (id === undefined) return
      lastGesture = id
      if (!(await playGesture($, id))) armGesture($)
    })()
  })
}

async function startWork($: EngineInterface) {
  sleepTimer = cancel(sleepTimer)
  returnTimer = cancel(returnTimer)
  gestureTimer = cancel(gestureTimer)
  await stopGesture($)
  await update($, isTurnRunning, () => true)
  await show($, 'working')
}

// ---------------------------------------------------------------------------
// The status timeline.

async function pushPhase($: EngineInterface, phase: BobertoPhase, detail?: string) {
  const at = await $.clock.now()
  await update($, timeline, list => {
    const entries = list ?? []
    const last = entries[entries.length - 1]
    const isTerminal = phase === 'done' || phase === 'error' || phase === 'stopped'
    if (last !== undefined && !isTerminal && last.phase === phase && last.detail === detail && last.isError !== true) {
      return [...entries.slice(0, -1), { ...last, count: last.count + 1, lastAt: at }]
    }
    const entry: BobertoTimelineEntry = { phase, count: 1, at, lastAt: at }
    if (detail !== undefined) entry.detail = detail
    return [...entries, entry].slice(-TIMELINE_LENGTH)
  })
}

async function markLastError($: EngineInterface) {
  await update($, timeline, list => {
    const entries = list ?? []
    const last = entries[entries.length - 1]
    return last === undefined ? entries : [...entries.slice(0, -1), { ...last, isError: true }]
  })
}

// ---------------------------------------------------------------------------
// Drawing helpers.

/** What the pane draws: a pinned preview first, then an idle gesture, then the live state. */
async function drawn(
  $: EngineInterface,
): Promise<{ kind: 'live'; name: BobertoAnimationName } | { kind: 'gesture'; id: string }> {
  const pinned = await read($, preview)
  if (pinned !== null) return { kind: 'live', name: pinned }
  const live = await read($, animation)
  const id = await read($, gesture)
  if (live === 'idle' && id !== null) return { kind: 'gesture', id }
  return { kind: 'live', name: live }
}

const reactionOf = (reason: BobertoTurnOutcome['reason']): BobertoAnimationName =>
  reason === 'answer' ? 'celebrate' : reason === 'aborted' ? 'calm' : 'dizzy'

const FACES: Record<BobertoTurnOutcome['reason'], { face: string; words: string; color: string }> = {
  answer: { face: '\\(^o^)/', words: 'Boberto cheers', color: '#22c55e' },
  aborted: { face: '(-_-)', words: 'Boberto shrugs', color: '#a1a1aa' },
  error: { face: '(@_@)', words: 'Boberto is dizzy', color: '#ef4444' },
  refusal: { face: '(@_@)', words: 'Boberto is dizzy', color: '#ef4444' },
}

/** Opens his panel, or closes it, deciding from the panes open now. */
async function togglePanel($: EngineInterface) {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANEL)) {
    await $.ui.close({ id: PANEL })
    return false
  }
  await $.ui.open({ id: PANEL, title: 'Boberto', ...PANEL_SIZE })
  return true
}

// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'boberto',
      description:
        "Open or close Boberto's panel; next cycles a preview, a name pins one, auto returns to live, shuffle, reset or color his outfit",
      argumentHint: '[guitarra|skate|mate|…|shuffle|color <part> <#hex>|auto|help]',
    })
    await update($, outfit, () => DEFAULT_OUTFIT)
    const stored = await $.store.get(STORE_KEY)
    if (stored !== undefined) await update($, outfit, () => sanitize(stored))
    await show($, 'idle')
    armSleep($)
    armGesture($)
    // Unasked, the surface may hold the panel until there is room; /boberto opens it anyway.
    void $.ui.open({ id: PANEL, title: 'Boberto', ...PANEL_SIZE })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // A slash command runs no model turn: leave Boberto where he is.
    if (!e.text.trimStart().startsWith('/')) {
      await startWork($)
      await pushPhase($, 'thinking')
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await startWork($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const call = e as unknown as ToolEvent
    const isSearch = isSearchCall(call)
    // A dizzy spell plays out before the next tool takes over.
    if (returnTimer === null) await show($, isSearch ? 'searching' : 'working')
    const { phase, detail } = phaseOf(call)
    await pushPhase($, phase, detail)

    const result = await next(e)

    if (result.isError === true) {
      await markLastError($)
      await flash($, 'dizzy', DIZZY_MS)
    } else if (isSearch && returnTimer === null && (await read($, animation)) === 'searching') {
      await settle($)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagents' turns end inside the main turn: only the main loop's ending counts.
    if (e.agentId !== undefined) return result

    await update($, isTurnRunning, () => false)
    const at = await $.clock.now()
    // Each answer's row gets its own top gesture, never the one the previous row plays.
    const previous = (await read($, outcomes)).at(-1)?.gesture
    const known = new Set(optionsOf().gestures.map(g => g.id))
    const gesture = e.reason === 'answer' ? pick(TOP_GESTURES.filter(id => known.has(id) && id !== previous)) : undefined
    const outcome: BobertoTurnOutcome = {
      turnId: e.turnId,
      reason: e.reason,
      durationMs: e.durationMs,
      tail: normalize(e.answer).slice(-TAIL),
      at,
      ...(gesture === undefined ? {} : { gesture }),
    }
    await update($, outcomes, list => [...(list ?? []), outcome].slice(-OUTCOMES_LENGTH))
    await pushPhase(
      $,
      e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'error',
      e.reason === 'refusal' ? 'refusal' : undefined,
    )

    if (e.reason === 'answer') await flash($, 'celebrate', CELEBRATE_MS)
    else if (e.reason === 'error' || e.reason === 'refusal') await flash($, 'dizzy', DIZZY_MS)
    else await flash($, 'calm', CALM_MS)
    armSleep($)

    return result
  })

  on('command.run', { command: 'boberto' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === '') {
      const isOpen = await togglePanel($)
      return { text: isOpen ? "Boberto's panel opened." : "Boberto's panel closed." }
    }
    if (arg === 'help') {
      return {
        text: [
          '/boberto: open or close his panel',
          `/boberto <gesture>: play one now (${TOP_GESTURES.join(', ')})`,
          '/boberto shuffle | reset: new random outfit, or back to bat wings',
          '/boberto color <body|accessory|eyes|glow> <#hex|auto>: a custom RGB color (#rrggbb, #rgb, r,g,b); auto clears it',
          `/boberto next | <state>: pin a preview of a live state (${ORDER.join(', ')})`,
          '/boberto auto: follow the session again',
        ].join('\n'),
      }
    }
    if (arg === 'auto' || arg === 'live' || arg === 'off') {
      await update($, preview, () => null)
      armGesture($)
      return { text: 'Boberto follows the session again.' }
    }
    if (arg === 'shuffle') {
      const o = await dress($, () => shuffled())
      return { text: `Boberto shuffled: ${describe(o)}.` }
    }
    if (arg === 'color' || arg.startsWith('color ')) {
      const [, word = '', ...rest] = arg.split(/\s+/)
      const target = TARGET_WORDS[word]
      const value = rest.join(' ')
      const usage = 'Usage: /boberto color <body|accessory|eyes|glow> <#hex|auto>, e.g. /boberto color eyes #00ff88'
      if (target === undefined || value === '') return { text: usage }
      if (value === 'auto') {
        const o = await dress($, x => withHex(x, target, undefined))
        return { text: `Boberto's ${TARGET_NAMES[target].toLowerCase()} color is back to its preset: ${describe(o)}.` }
      }
      const hex = parseColor(value)
      if (hex === null) return { text: `"${value}" is not a color. ${usage}` }
      const o = await dress($, x => withHex(x, target, hex))
      return { text: `Boberto's ${TARGET_NAMES[target].toLowerCase()} color is now ${hex}: ${describe(o)}.` }
    }
    if (arg === 'reset') {
      await resetOutfit($)
      await $.store.delete(STORE_KEY)
      return { text: 'Boberto is back in his bat wings.' }
    }
    if (optionsOf().gestures.some(g => g.id === arg)) {
      await update($, preview, () => null)
      const isPlaying = (await read($, animation)) === 'idle' && (await playGesture($, arg))
      return { text: isPlaying ? `Boberto plays ${arg}.` : `Boberto is busy; ${arg} plays once he is idle.` }
    }
    if (arg !== 'next' && !isAnimationName(arg)) {
      return {
        text: `Unknown option "${arg}". Try next, auto, shuffle, reset, color, a gesture (${TOP_GESTURES.join(', ')}) or one of: ${ORDER.join(', ')}.`,
      }
    }
    const pinned = await update($, preview, value => {
      if (isAnimationName(arg)) return arg
      const at = value === null ? -1 : ORDER.indexOf(value)
      return ORDER[(at + 1) % ORDER.length] ?? 'idle'
    })

    return {
      text: `Boberto preview: ${pinned ?? 'live'} (/boberto next to cycle, /boberto auto to follow the session).`,
    }
  })

  // His own panel: Boberto large and centred, a word on what he is up to, and his wardrobe.
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const what = await drawn($)
    const isPinned = (await read($, preview)) !== null
    const status = what.kind === 'gesture' ? (GESTURE_STATUS[what.id] ?? what.id) : STATUS[what.name]

    if (e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Boberto is {status} (drawn in the desktop app).</Text>
    }

    const attire = await read($, outfit)
    const o = optionsOf()
    let svg: string
    let alt: string
    if (what.kind === 'gesture' && hasGesture(what.id, attire, 'full')) {
      svg = (await gestureSvg(what.id, attire, 'full'))?.svg ?? liveSvg('idle', attire, 'full')
      alt = `Boberto is ${status}`
    } else {
      const name = what.kind === 'live' ? what.name : 'idle'
      svg = liveSvg(name, attire, 'full')
      alt = LABELS[name]
    }

    const { Box, Button, Input, Select, Svg, Text } = $.ui.resolve(e)
    const isOpen = await read($, isWardrobeOpen)
    const tab = await read($, wardrobeTab)
    const editing = await read($, colorEditing)
    const problem = await read($, colorError)
    const columns = e.props.bodyColumns
    const hasBars = columns >= BARS_FROM_COLUMNS
    // Handlers read live state when they run; nothing here is written while drawing.
    const toggleWardrobe = () => void update($, isWardrobeOpen, value => !value)
    const choose = (target: BobertoColorTarget) => (value: string) => void pickColor($, target, value)
    const custom = { value: CUSTOM, label: 'Custom RGB…' }
    const hatColorPreset = attire.hatHex !== undefined && o.hatColors.some(c => c.id === attire.hatHex)
    /** Whether a part shows its RGB card: a custom color, or Custom picked over a matching preset. */
    const isCustom = (target: BobertoColorTarget) =>
      editing === target ||
      (target === 'hat' ? attire.hatHex !== undefined && !hatColorPreset : attire[HEX_FIELD[target]] !== undefined)
    const presetValue = (target: BobertoColorTarget, preset: string) => (isCustom(target) ? CUSTOM : preset)

    const label = labelSvg('Wardrobe')
    const header = (
      <Box key="wardrobe-head" flexDirection="row" alignItems="center" gap={1} width="100%">
        <Svg source={label.source} alt="Wardrobe" height={14} width={label.width} />
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text dimColor wrap="truncate-end">
            {summarize(attire)}
          </Text>
        </Box>
        <Button key="wardrobe" label={isOpen ? 'Done ▴' : 'Customize ▾'} variant="secondary" onPress={toggleWardrobe} />
      </Box>
    )

    if (!isOpen) {
      return (
        <Box flexDirection="column" alignItems="center" paddingY={1} gap={1}>
          <Svg source={svg} alt={alt} height={PANEL_HEIGHT} width={Math.round(PANEL_HEIGHT * aspectOf(svg))} />
          <Text dimColor>
            {status}
            {isPinned ? ' · preview' : ''}
          </Text>
          <Box flexDirection="column" width="100%" paddingX={1}>
            {header}
          </Box>
        </Box>
      )
    }

    // One channel row: the letter, its bar (when there is room), the value field, and ∓16 steps.
    const channelRow = (c: keyof Rgb, value: number) => (
      <Box key={`row-${c}`} flexDirection="row" gap={1} alignItems="center">
        <Box width={2}>
          <Text color={CHANNEL_LETTER_COLORS[c]} bold>
            {c.toUpperCase()}
          </Text>
        </Box>
        {hasBars ? (
          <Svg
            source={channelBarSvg(c, value)}
            alt={`${c.toUpperCase()} ${value} of 255`}
            width={CHANNEL_BAR.width}
            height={CHANNEL_BAR.height}
          />
        ) : null}
        <Box width={12}>
          <Input
            key={c}
            value={String(value)}
            placeholder="0–255"
            submitLabel="set"
            onSubmit={text =>
              void editColor(
                $,
                cur => {
                  const n = parseByte(text)
                  return n === null ? null : withChannel(cur, c, n)
                },
                BAD_CHANNEL,
              )
            }
          />
        </Box>
        <Button
          key={`${c}-minus`}
          label={`−${STEP}`}
          variant="secondary"
          dimColor
          onPress={() => void editColor($, cur => withChannel(cur, c, hexToRgb(cur)[c] - STEP), BAD_CHANNEL)}
        />
        <Button
          key={`${c}-plus`}
          label={`+${STEP}`}
          variant="secondary"
          dimColor
          onPress={() => void editColor($, cur => withChannel(cur, c, hexToRgb(cur)[c] + STEP), BAD_CHANNEL)}
        />
      </Box>
    )

    // The open tab's RGB card: swatch, hex field, three channel rows, and the last note.
    const colorCard = (target: BobertoColorTarget) => {
      const hex = currentHex(attire, target)
      const rgb = hexToRgb(hex)
      return (
        <Box
          key="color-card"
          flexDirection="column"
          gap={1}
          paddingX={1}
          paddingY={1}
          borderStyle="round"
          borderColor="#2a2833"
          backgroundColor="#141319"
        >
          <Svg
            source={swatchCardSvg(hex, TARGET_NAMES[target])}
            alt={`${TARGET_NAMES[target]} color ${hex}`}
            width={SWATCH_CARD.width}
            height={SWATCH_CARD.height}
          />
          <Input
            key="hex"
            label="Hex"
            value={hex}
            placeholder="#rrggbb, #rgb or r,g,b"
            submitLabel="set"
            onSubmit={value => void editColor($, () => parseColor(value), BAD_COLOR)}
          />
          {channelRow('r', rgb.r)}
          {channelRow('g', rgb.g)}
          {channelRow('b', rgb.b)}
          {problem === null ? null : <Text color="#f87171">{problem}</Text>}
        </Box>
      )
    }

    // The open tab's controls: its preset Select(s), then its RGB card when its color is custom.
    const tabControls = (target: BobertoColorTarget) => {
      switch (target) {
        case 'hat':
          return [
            <Select
              key="hat"
              label="Accessory"
              options={o.hats.map(h => ({ value: h.id, label: HAT_NAMES[h.id] ?? h.name }))}
              value={attire.hat}
              onSelect={value => void dress($, x => ({ ...x, hat: value }))}
            />,
            <Select
              key="hatColor"
              label="Color"
              options={[
                { value: 'auto', label: 'Natural' },
                ...o.hatColors.map(c => ({ value: c.id, label: HAT_COLOR_NAMES[c.id] ?? c.name })),
                custom,
              ]}
              value={isCustom('hat') ? CUSTOM : (attire.hatHex ?? 'auto')}
              onSelect={choose('hat')}
            />,
          ]
        case 'skin':
          return [
            <Select
              key="skin"
              label="Body color"
              options={[
                { value: 'auto', label: SKIN_NAMES['auto'] ?? 'Classic' },
                ...o.skins.map(x => ({ value: x.id, label: SKIN_NAMES[x.id] ?? x.name })),
                custom,
              ]}
              value={presetValue('skin', attire.skin)}
              onSelect={choose('skin')}
            />,
          ]
        case 'eye':
          return [
            <Select
              key="eye"
              label="Eye color"
              options={[
                { value: 'auto', label: EYE_NAMES['auto'] ?? 'Natural' },
                ...o.eyes.map(x => ({ value: x.id, label: EYE_NAMES[x.id] ?? x.name })),
                custom,
              ]}
              value={presetValue('eye', attire.eye)}
              onSelect={choose('eye')}
            />,
          ]
        case 'glow':
          return [
            <Select
              key="glow"
              label="Glow"
              options={[...GLOWS, custom]}
              value={presetValue('glow', attire.glow)}
              onSelect={choose('glow')}
            />,
          ]
      }
    }

    return (
      <Box flexDirection="column" alignItems="center" paddingY={1} gap={1}>
        <Svg source={svg} alt={alt} height={PANEL_HEIGHT} width={Math.round(PANEL_HEIGHT * aspectOf(svg))} />
        <Text dimColor>
          {status}
          {isPinned ? ' · preview' : ''}
        </Text>
        <Box flexDirection="column" gap={1} width="100%" paddingX={1}>
          {header}
          <Box key="tabs" flexDirection="row" flexWrap="wrap" gap={1}>
            {TABS.map(t => (
              <Button
                key={`tab-${t}`}
                label={TARGET_NAMES[t]}
                {...(t === tab ? { variant: 'primary' as const } : { variant: 'secondary' as const, dimColor: true })}
                onPress={() => void openTab($, t)}
              />
            ))}
          </Box>
          <Box key="tab-body" flexDirection="column" gap={1}>
            {tabControls(tab)}
            {isCustom(tab) ? colorCard(tab) : null}
          </Box>
          <Text dimColor wrap="truncate">
            {'─'.repeat(Math.max(8, columns - 2))}
          </Text>
          <Box key="footer" flexDirection="row" gap={1} justifyContent="flex-end">
            <Button key="shuffle" label="Shuffle" variant="primary" onPress={() => void dress($, () => shuffled())} />
            <Button key="reset" label="Reset" variant="secondary" onPress={() => void resetOutfit($)} />
          </Box>
        </Box>
      </Box>
    )
  })

  // The end of a turn, on desktop: the assistant row that carried the turn's
  // final text gets Boberto reacting to how that turn ended. The desktop has
  // no TurnDuration site, and an AssistantMessage carries no turn id, so the
  // row is matched by the end of its text.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const text = normalize(e.props.text)
    if (text.length === 0) return next(e)
    const list = await read($, outcomes)
    const outcome = [...list]
      .reverse()
      .find(o => o.tail.length > 0 && (text.endsWith(o.tail) || (text.length >= 24 && o.tail.endsWith(text))))
    if (outcome === undefined) return next(e)

    const engine = await next(e)
    const attire = await read($, outfit)
    const name = reactionOf(outcome.reason)
    // Loops for as long as the row is on screen: the turn's own gesture for an
    // answer, the reaction to how it ended otherwise (and for rows from before gestures).
    const looped = outcome.gesture === undefined ? null : await gestureSvg(outcome.gesture, attire, 'small', true)
    const svg = looped?.svg ?? liveSvg(name, attire, 'small')
    const { Box, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {engine}
        <Svg
          source={svg}
          alt={looped && outcome.gesture ? `Boberto is ${GESTURE_STATUS[outcome.gesture] ?? outcome.gesture}` : LABELS[name]}
          height={REACTION_HEIGHT}
          width={Math.round(REACTION_HEIGHT * aspectOf(svg))}
        />
      </Box>
    )
  })

  // The end of a turn, on the terminal (the one surface that raises this
  // site): the engine's own line, then Boberto's face for how the turn ended.
  // The row carries no turn id, only its duration: that is the key, the
  // closest outcome within two seconds, else the latest.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const engine = await next(e)
    if (e.surface !== 'terminal') return engine
    const list = await read($, outcomes)
    if (list.length === 0) return engine
    let outcome = list.find(o => o.durationMs === e.props.durationMs)
    if (outcome === undefined) {
      const near = [...list].sort(
        (a, b) => Math.abs(a.durationMs - e.props.durationMs) - Math.abs(b.durationMs - e.props.durationMs),
      )[0]
      outcome =
        near !== undefined && Math.abs(near.durationMs - e.props.durationMs) <= 2000 ? near : list[list.length - 1]
    }
    if (outcome === undefined) return engine
    const { face, words, color } = FACES[outcome.reason]
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={2}>
        {engine}
        <Text color={color}>
          {face} <Text dimColor>{words}</Text>
        </Text>
      </Box>
    )
  })
}
