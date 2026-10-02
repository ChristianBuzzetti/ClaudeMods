// Terminal drawing for usage-meters: everything is painted into a cell grid
// that the terminal's `Raster` element shows. Pure functions, no `$`.

const DEFAULT = 0x01000000

export type Grid = { columns: number; rows: number; cells: Uint32Array }

export type Tone = { light: string; dark: string }

export type MeterCell = { label: string; percent: number; value: string; tone: Tone }

export type StripModel = { meters: MeterCell[]; running: number }

export type PaneGauge = MeterCell & { sub: string; note: string }

export type FlowPart = { label: string; value: number; color: string }

export type AgentRow = {
  name: string
  detail: string
  color: string
  runs: number
  running: number
  share: number
  tokens: string
  hit: number
}

export type PaneModel = {
  header: string
  gauges: PaneGauge[]
  flow: FlowPart[]
  flowTotal: string
  agents: AgentRow[]
  runsLabel: string
}

// ---------------------------------------------------------------------------
// Grid primitives

const rgb = (color: string) => parseInt(color.slice(1), 16)

const mix = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, t))
  const ch = (shift: number) => {
    const x = (a >> shift) & 255
    const y = (b >> shift) & 255
    return Math.round(x + (y - x) * k) << shift
  }
  return ch(16) | ch(8) | ch(0)
}

const makeGrid = (columns: number, rows: number): Grid => {
  const cells = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < columns * rows; i++) {
    cells[i * 3] = 32
    cells[i * 3 + 1] = DEFAULT
    cells[i * 3 + 2] = DEFAULT
  }
  return { columns, rows, cells }
}

// The Raster takes one printable width-1 BMP character per cell: anything else becomes '?'.
const safeCode = (code: number) => {
  if (code >= 0x20 && code <= 0x7e) return code
  if (code >= 0xa0 && code <= 0x2fff) return code
  return 0x3f
}

const put = (g: Grid, x: number, y: number, code: number, fg = DEFAULT, bg = DEFAULT) => {
  if (x < 0 || y < 0 || x >= g.columns || y >= g.rows) return
  const i = (y * g.columns + x) * 3
  g.cells[i] = safeCode(code)
  g.cells[i + 1] = fg
  g.cells[i + 2] = bg
}

const write = (g: Grid, x: number, y: number, text: string, fg = DEFAULT, bg = DEFAULT) => {
  let cx = x
  for (const ch of text) {
    put(g, cx, y, ch.codePointAt(0) ?? 32, fg, bg)
    cx += 1
  }
  return cx
}

const writeRight = (g: Grid, xRight: number, y: number, text: string, fg = DEFAULT) =>
  write(g, xRight - [...text].length, y, text, fg)

const clipText = (text: string, max: number) => {
  const chars = [...text]
  if (max <= 0) return ''
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join('')}…` : text
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const encode = (g: Grid) => {
  const bytes = new Uint8Array(g.cells.buffer, g.cells.byteOffset, g.cells.byteLength)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += b === undefined ? '=' : B64.charAt((n >> 6) & 63)
    out += c === undefined ? '=' : B64.charAt(n & 63)
  }
  return out
}

// ---------------------------------------------------------------------------
// Pieces

const DIM = rgb('#52525b')
const MUTED = rgb('#a1a1aa')
const TEXT = rgb('#e4e4e7')
const BRIGHT = rgb('#fafafa')
const TRACK = rgb('#3f3f46')
const WHITE = 0xffffff
const NEON = rgb('#8b7cf6')
const NEON_HOT = rgb('#e9d5ff')

// A dithered bar: shade blocks thicken toward the knob, a shimmer sweeps the fill.
const bar = (g: Grid, x: number, y: number, w: number, percent: number, tone: Tone, tick: number) => {
  const light = rgb(tone.light)
  const dark = rgb(tone.dark)
  const p = Math.min(100, Math.max(0, percent))
  const filled = Math.max(1, Math.round((p / 100) * w))
  const ticks = new Set([0.25, 0.5, 0.75].map(q => Math.round(q * w)))
  const sweep = (tick * 1.5) % (filled + 12) - 6
  for (let i = 0; i < w; i++) {
    if (i < filled) {
      const t = filled === 1 ? 1 : i / (filled - 1)
      const shade = t < 0.35 ? 0x2592 : t < 0.75 ? 0x2593 : 0x2588
      const glint = Math.max(0, 1 - Math.abs(i - sweep) / 3)
      const fg = mix(mix(dark, light, t), WHITE, glint * 0.85)
      put(g, x + i, y, i === filled - 1 ? 0x2588 : shade, i === filled - 1 ? WHITE : fg)
    } else {
      put(g, x + i, y, ticks.has(i) ? 0x250a : 0xb7, ticks.has(i) ? DIM : TRACK)
    }
  }
}

// A stacked bar of parts sized by their share of the total.
const stacked = (g: Grid, x: number, y: number, w: number, parts: { value: number; color: string }[]) => {
  const total = parts.reduce((n, part) => n + part.value, 0)
  let cx = x
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1
    const cells = total === 0 ? 0 : isLast ? x + w - cx : Math.round((part.value / total) * w)
    for (let i = 0; i < cells && cx < x + w; i++) put(g, cx++, y, 0x2588, rgb(part.color))
  })
  while (cx < x + w) put(g, cx++, y, 0xb7, TRACK)
}

// The border's cells in clockwise order, for the neon comet.
const perimeter = (w: number, h: number) => {
  const cells: [number, number][] = []
  for (let x = 0; x < w; x++) cells.push([x, 0])
  for (let y = 1; y < h; y++) cells.push([w - 1, y])
  for (let x = w - 2; x >= 0; x--) cells.push([x, h - 1])
  for (let y = h - 2; y > 0; y--) cells.push([0, y])
  return cells
}

// A rounded frame whose border carries a neon comet looping clockwise.
const neonFrame = (g: Grid, tick: number) => {
  const w = g.columns
  const h = g.rows
  const ring = perimeter(w, h)
  const head = Math.floor(tick * 1.2) % ring.length
  const tail = 14
  ring.forEach(([x, y], index) => {
    const behind = (head - index + ring.length) % ring.length
    const heat = behind < tail ? 1 - behind / tail : 0
    const base = mix(TRACK, NEON, 0.15)
    const fg = heat > 0 ? mix(mix(base, NEON, Math.min(1, heat * 1.6)), NEON_HOT, heat > 0.85 ? 1 : 0) : base
    let code = x === 0 || x === w - 1 ? 0x2502 : 0x2500
    if (x === 0 && y === 0) code = 0x256d
    else if (x === w - 1 && y === 0) code = 0x256e
    else if (x === 0 && y === h - 1) code = 0x2570
    else if (x === w - 1 && y === h - 1) code = 0x256f
    put(g, x, y, code, fg)
  })
}

// ---------------------------------------------------------------------------
// The strip above the prompt: one row, context and cache meters, live agents.

const STRIP_BAR = 16

export const stripWidth = (model: StripModel) => {
  let w = 1
  for (const meter of model.meters) w += 2 + meter.label.length + 1 + STRIP_BAR + 1 + 4 + 3
  return w + 2 + `${model.running} agents running`.length + 1
}

export const paintStrip = (model: StripModel, tick: number) => {
  const g = makeGrid(stripWidth(model), 1)
  let x = 1
  model.meters.forEach((meter, index) => {
    x = write(g, x, 0, '● ', rgb(meter.tone.light))
    x = write(g, x, 0, meter.label.toUpperCase(), MUTED) + 1
    bar(g, x, 0, STRIP_BAR, meter.percent, meter.tone, tick + index * 7)
    x += STRIP_BAR + 1
    x = write(g, x, 0, `${meter.value}%`.padStart(4), BRIGHT)
    x = write(g, x, 0, ' │ ', DIM)
  })
  const isLive = model.running > 0
  const pulse = isLive ? mix(NEON, NEON_HOT, (Math.sin(tick / 2) + 1) / 2) : DIM
  x = write(g, x, 0, '● ', pulse)
  write(
    g,
    x,
    0,
    isLive ? `${model.running} agent${model.running === 1 ? '' : 's'} running` : 'no agents running',
    isLive ? TEXT : DIM,
  )
  return g
}

// ---------------------------------------------------------------------------
// The details pane: framed dashboard with a neon border.

export const paneRows = (model: PaneModel) => {
  const agentRows = model.agents.length > 0 ? 2 + model.agents.length : 0
  const flowRows = model.flow.length > 0 ? 4 : 0
  // Top border and header (3), gauges (2 each), a gap, flow, agents, bottom border.
  return 3 + model.gauges.length * 2 + 1 + flowRows + agentRows + 1
}

export const paintPane = (model: PaneModel, columns: number, tick: number) => {
  const w = Math.max(40, columns)
  const g = makeGrid(w, paneRows(model))
  const left = 2
  const right = w - 2
  const inner = right - left
  let y = 1

  write(g, left, y, '▌ ', NEON)
  write(g, left + 2, y, 'USAGE', BRIGHT)
  writeRight(g, right, y, clipText(model.header, inner - 10), MUTED)
  y += 2

  // Gauges: label and figures on one row, the bar under them.
  for (const gauge of model.gauges) {
    write(g, left, y, '● ', rgb(gauge.tone.light))
    write(g, left + 2, y, gauge.label.toUpperCase(), MUTED)
    const figure = `${gauge.value}%`
    const detail = gauge.note ? `${gauge.sub} · ${gauge.note}` : gauge.sub
    writeRight(g, right, y, clipText(detail, Math.max(0, inner - 24)), DIM)
    write(g, left + 16, y, figure.padStart(4), rgb(gauge.tone.light))
    bar(g, left, y + 1, inner, gauge.percent, gauge.tone, tick + y * 3)
    y += 2
  }
  y += 1

  if (model.flow.length > 0) {
    write(g, left, y, 'TOKEN FLOW', DIM)
    writeRight(g, right, y, model.flowTotal, DIM)
    stacked(g, left, y + 1, inner, model.flow)
    let lx = left
    const total = model.flow.reduce((n, part) => n + part.value, 0)
    for (const part of model.flow) {
      const share = total === 0 ? 0 : Math.round((part.value / total) * 100)
      lx = write(g, lx, y + 2, '■ ', rgb(part.color))
      lx = write(g, lx, y + 2, `${part.label} `, MUTED)
      lx = write(g, lx, y + 2, `${share}%`, TEXT) + 3
    }
    y += 4
  }

  if (model.agents.length > 0) {
    write(g, left, y, 'BY AGENT', DIM)
    writeRight(g, right, y, model.runsLabel, DIM)
    stacked(
      g,
      left,
      y + 1,
      inner,
      model.agents.map(agent => ({ value: agent.share, color: agent.color })),
    )
    y += 2
    const shareW = 12
    const tail = 4 + 1 + 7 + 1 + 8
    model.agents.forEach((agent, index) => {
      const ry = y + index
      const live = agent.running > 0
      const dot = live ? mix(rgb(agent.color), WHITE, (Math.sin(tick / 2) + 1) / 3) : rgb(agent.color)
      let x = write(g, left, ry, '● ', dot)
      x = write(g, x, ry, clipText(agent.name, 18), BRIGHT) + 1
      if (agent.runs > 0) {
        x = write(g, x, ry, live ? `×${agent.runs} · ${agent.running} live` : `×${agent.runs}`, rgb(agent.color)) + 1
      }
      const barX = right - tail - shareW - 1
      write(g, x, ry, clipText(agent.detail, barX - x - 1), DIM)
      bar(g, barX, ry, shareW, agent.share, { light: agent.color, dark: agent.color }, tick + index * 5)
      let tx = barX + shareW + 1
      tx = write(g, tx, ry, `${Math.round(agent.share)}%`.padStart(4), TEXT) + 1
      tx = write(g, tx, ry, agent.tokens.padStart(7), MUTED) + 1
      write(g, tx, ry, `${Math.round(agent.hit)}% hit`.padStart(8), agent.hit >= 70 ? rgb('#86efac') : MUTED)
    })
  }

  neonFrame(g, tick)
  return g
}
