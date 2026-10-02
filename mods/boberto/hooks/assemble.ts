// Assembles one animated SVG document from a generated animation: every frame
// is a <g> whose visibility a discrete SMIL <animate> toggles (a flipbook),
// and the whole body moves with <animateTransform>s that approximate the
// engine's `plt-*` CSS keyframes. Pure: no imports, so the build script can
// load this same file to measure and preview what the hooks draw.

/** One step of the flipbook: which frame shows, for how long. */
export type BobertoStep = { frame: number; ms: number }

/**
 * Whole-body motion, pivoting on the bottom center of the canvas (CSS
 * `transform-origin: bottom center`). Each track has one value per key time.
 */
export type BobertoMotion = {
  durMs: number
  keyTimes: number[]
  translate?: [number, number][]
  rotate?: number[]
  scale?: [number, number][]
}

export type BobertoAnimation = {
  /** Canvas size in drawing units: the frames' coordinate space. */
  width: number
  height: number
  /** The document's viewBox, with room for the motion. */
  viewBox: string
  /** Gradients and clip paths shared by every frame. */
  defs: string
  /** SVG fragments, one per distinct frame. */
  frames: string[]
  steps: BobertoStep[]
  motion: BobertoMotion
  /** Hand-drawn particles (SMIL-animated), over the body. */
  extras: string
}

const EASE = '.42 0 .58 1'

const seconds = (ms: number) => `${Math.round(ms) / 1000}s`

const join = (values: (string | number)[]) => values.join(';')

function track(type: 'translate' | 'rotate' | 'scale', values: string[], motion: BobertoMotion, repeat: string) {
  const splines = motion.keyTimes.slice(1).map(() => EASE)
  return (
    `<animateTransform attributeName="transform" type="${type}" values="${join(values)}" keyTimes="${join(motion.keyTimes)}"` +
    ` calcMode="spline" keySplines="${splines.join(';')}" dur="${seconds(motion.durMs)}" repeatCount="${repeat}"/>`
  )
}

/** The visibility timeline of one frame over the whole flipbook. */
function visibility(frame: number, steps: BobertoStep[], total: number) {
  const values: string[] = []
  const times: number[] = []
  let at = 0
  for (const step of steps) {
    const value = step.frame === frame ? 'visible' : 'hidden'
    if (values[values.length - 1] !== value) {
      values.push(value)
      times.push(Math.round((at / total) * 10000) / 10000)
    }
    at += step.ms
  }
  return { values, times }
}

export type AssembleOptions = {
  /** Play once and hold the last frame, instead of looping. */
  once?: boolean
  /** A drop-shadow halo of this color around the body. */
  glow?: string
  /** CSS px the document asks for; the viewBox's own size when absent. */
  height?: number
}

const PATH = /<path [^>]*\/>/g

/**
 * Moves every path drawn identically in two or more frames into `<defs>` and
 * draws it there with `<use>`: frames of one choreography share most strokes.
 */
function shareRepeats(bodies: string[]) {
  const counts = new Map<string, number>()
  for (const body of bodies) {
    for (const path of new Set(body.match(PATH) ?? [])) counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  const ids = new Map<string, string>()
  let defs = ''
  for (const [path, count] of counts) {
    if (count < 2 || path.length < 48) continue
    const id = `u${ids.size.toString(36)}`
    ids.set(path, id)
    defs += path.replace('<path ', `<path id="${id}" `)
  }
  const out = bodies.map(body => body.replace(PATH, path => (ids.has(path) ? `<use href="#${ids.get(path)}"/>` : path)))
  return { defs, bodies: out }
}

/** The full `<svg>` document for one animation. */
export function assembleSvg(anim: BobertoAnimation, options: AssembleOptions = {}): string {
  const total = anim.steps.reduce((sum, step) => sum + step.ms, 0)
  const first = anim.steps[0]?.frame ?? 0
  const lastFrame = anim.steps[anim.steps.length - 1]?.frame ?? first
  const repeat = options.once ? 'fill="freeze"' : 'repeatCount="indefinite"'
  const used = anim.frames.map((_, index) => anim.steps.some(step => step.frame === index))
  const shared = shareRepeats(anim.frames.map((body, index) => (used[index] ? body : '')))
  const frames = shared.bodies
    .map((body, index) => {
      if (!used[index]) return ''
      const { values, times } = visibility(index, anim.steps, total)
      if (options.once) {
        // A frozen discrete animation holds its last value: the last frame.
        values.push(index === lastFrame ? 'visible' : 'hidden')
        times.push(1)
      }
      const initial = index === first ? 'visible' : 'hidden'
      const animate =
        values.length > 1
          ? `<animate attributeName="visibility" values="${join(values)}" keyTimes="${join(times)}" calcMode="discrete" dur="${seconds(total)}" ${repeat}/>`
          : ''
      return `<g visibility="${initial}">${animate}${body}</g>`
    })
    .join('')

  const m = anim.motion
  const ox = anim.width / 2
  const oy = anim.height
  // Played once, the body's motion stops with the flipbook (whole cycles end at rest).
  const cycles = options.once ? String(Math.max(1, Math.round(total / Math.max(1, m.durMs)))) : 'indefinite'
  const translate = m.translate ? track('translate', m.translate.map(([x, y]) => `${x} ${y}`), m, cycles) : ''
  const rotate = m.rotate ? track('rotate', m.rotate.map(String), m, cycles) : ''
  const scale = m.scale ? track('scale', m.scale.map(([x, y]) => `${x} ${y}`), m, cycles) : ''

  // Played once, the particles leave with the last frame.
  const extras =
    options.once && anim.extras
      ? `<g>${anim.extras}<set attributeName="visibility" to="hidden" begin="${seconds(total)}" fill="freeze"/></g>`
      : anim.extras
  const [, , vw = '1', vh = '1'] = anim.viewBox.split(' ')
  const h = options.height ?? Number(vh)
  const w = Math.round((h * Number(vw)) / Number(vh))
  const halo = options.glow
    ? `<filter id="halo" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="${(anim.height / 45).toFixed(1)}" flood-color="${options.glow}" flood-opacity=".85"/></filter>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${anim.viewBox}" width="${w}" height="${h}" stroke-miterlimit="10">` +
    `<defs>${anim.defs}${halo}${shared.defs}</defs>` +
    `<g${halo ? ' filter="url(#halo)"' : ''} transform="translate(${ox} ${oy})"><g>${translate}<g>${rotate}<g>${scale}` +
    `<g transform="translate(${-ox} ${-oy})">${frames}${extras}</g>` +
    '</g></g></g></g></svg>'
  )
}
