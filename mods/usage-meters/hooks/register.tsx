import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Limit, Snapshot, Tokens, Totals } from '../types'
import { encode, paintPane, paintStrip, paneRows, stripWidth } from './terminal'
import type { PaneModel, StripModel } from './terminal'

const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const NO_TOTALS: Totals = { turns: 0, durationMs: 0, session: NO_TOKENS, main: NO_TOKENS, last: null }
const NO_AGENTS: AgentRun[] = []
const MAX_AGENTS = 60

const snapshot = atom({ plugin: 'usage-meters', key: 'snapshot' } as const, null)
const totals = atom({ plugin: 'usage-meters', key: 'totals' } as const, NO_TOTALS)
const agents = atom({ plugin: 'usage-meters', key: 'agents' } as const, NO_AGENTS)
const isHidden = atom({ plugin: 'usage-meters', key: 'isHidden' } as const, false)
const isPanelOpen = atom({ plugin: 'usage-meters', key: 'isPanelOpen' } as const, false)

const PANEL = 'usage-meters'
const now = atom({ plugin: 'usage-meters', key: 'now' } as const, 0)

// Palette.
const ACCENT = '#8b7cf6'
const WARN = '#f59e0b'
const DANGER = '#ef4444'
const GOOD = '#22c55e'

// Light end, dark end of each tone's gradient.
const GRADIENTS: Record<string, [string, string]> = {
  [ACCENT]: ['#c4b5fd', '#7c5cff'],
  [GOOD]: ['#86efac', '#16a34a'],
  [WARN]: ['#fde68a', '#f59e0b'],
  [DANGER]: ['#fca5a5', '#ef4444'],
}
const FALLBACK_GRADIENT: [string, string] = ['#c4b5fd', '#7c5cff']

// Token kinds in the flow bar.
const FLOW = [
  { key: 'input', label: 'input', color: '#38bdf8' },
  { key: 'cacheWrite', label: 'cache write', color: '#f472b6' },
  { key: 'cacheRead', label: 'cache read', color: '#34d399' },
  { key: 'output', label: 'output', color: '#fbbf24' },
] as const

// Main conversation first, then one color per subagent type.
const MAIN_COLOR = '#e4e4e7'
const AGENT_COLORS = ['#8b7cf6', '#38bdf8', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#a3e635']

const LABELS: Record<string, string> = {
  five_hour: '5-hour cap',
  seven_day: 'Weekly cap',
  spend_limit: 'Spend limit',
}

// ---------------------------------------------------------------------------
// Figures

type Gauge = { key: string; label: string; percent: number; value: string; sub: string; note: string; tone: string }

type AgentGroup = {
  type: string
  color: string
  runs: number
  running: number
  tokens: Tokens
  latest: string
  model?: string
}

const toSnapshot = (usage: {
  context: { percent?: number; tokens?: number; window: number }
  rateLimits: Limit[]
  cost?: { usd: number }
}): Snapshot => ({
  contextPercent: usage.context.percent,
  contextTokens: usage.context.tokens,
  contextWindow: usage.context.window,
  limits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
  costUsd: usage.cost?.usd,
})

const compact = (tokens: number) => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 100_000 ? 0 : 1)}k`
  return String(tokens)
}

const untilReset = (resetsAt: string | undefined, at: number) => {
  if (!resetsAt) return ''
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - at) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

const formatDuration = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

// Usage meters: higher is worse.
const toneOf = (percent: number) => (percent >= 95 ? DANGER : percent >= 80 ? WARN : ACCENT)

// Cache hit rate: higher is better.
const cacheToneOf = (percent: number) => (percent >= 70 ? GOOD : percent >= 40 ? ACCENT : WARN)

const promptTokens = (t: Tokens) => t.input + t.cacheRead + t.cacheWrite
const allTokens = (t: Tokens) => promptTokens(t) + t.output

const hitRate = (t: Tokens) => {
  const total = promptTokens(t)
  return total === 0 ? 0 : (t.cacheRead / total) * 100
}

const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

const gaugesOf = (snap: Snapshot, sums: Totals, at: number): Gauge[] => {
  const gauges: Gauge[] = []
  if (snap.contextPercent !== undefined) {
    const used = snap.contextTokens === undefined ? '' : `${compact(snap.contextTokens)} / `
    gauges.push({
      key: 'context',
      label: 'Context',
      percent: snap.contextPercent,
      value: `${Math.round(snap.contextPercent)}`,
      sub: `${used}${compact(snap.contextWindow)}`,
      note: '',
      tone: toneOf(snap.contextPercent),
    })
  } else {
    // A fresh chat has no fill reading until its first response: show an empty meter, not nothing.
    gauges.push({
      key: 'context',
      label: 'Context',
      percent: 0,
      value: '0',
      sub: `0 / ${compact(snap.contextWindow)}`,
      note: '',
      tone: ACCENT,
    })
  }
  for (const limit of snap.limits) {
    const reset = untilReset(limit.resetsAt, at)
    gauges.push({
      key: limit.kind,
      label: LABELS[limit.kind] ?? limit.kind,
      percent: limit.percentUsed,
      value: `${Math.round(limit.percentUsed)}`,
      sub: reset ? `resets in ${reset}` : 'no reset time',
      note: '',
      tone: toneOf(limit.percentUsed),
    })
  }
  if (promptTokens(sums.session) > 0) {
    const rate = hitRate(sums.session)
    gauges.push({
      key: 'cache',
      label: 'Cache hits',
      percent: rate,
      value: `${Math.round(rate)}`,
      sub: `${compact(sums.session.cacheRead)} read`,
      note: sums.last === null ? '' : `last ${Math.round(hitRate(sums.last))}%`,
      tone: cacheToneOf(rate),
    })
  }
  return gauges
}

const groupAgents = (runs: AgentRun[]): AgentGroup[] => {
  const byType = new Map<string, AgentGroup>()
  for (const run of runs) {
    const group = byType.get(run.type) ?? {
      type: run.type,
      color: '',
      runs: 0,
      running: 0,
      tokens: NO_TOKENS,
      latest: '',
      model: undefined,
    }
    group.runs += 1
    group.running += run.isRunning ? 1 : 0
    group.tokens = addTokens(group.tokens, run.tokens)
    group.latest = run.description
    group.model = run.model ?? group.model
    byType.set(run.type, group)
  }
  return [...byType.values()]
    .sort((a, b) => allTokens(b.tokens) - allTokens(a.tokens) || b.runs - a.runs)
    .map((group, index) => ({ ...group, color: AGENT_COLORS[index % AGENT_COLORS.length] ?? ACCENT }))
}

// ---------------------------------------------------------------------------
// SVG card

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Rough text width in px, for layout inside the SVG.
const textWidth = (text: string, size: number) => Math.ceil(text.length * size * 0.56)

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const SVG_WIDTH = 760
const PAD = 16
const FONT = "Inter, 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif"
const MONO = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"

const defs = () => {
  const dots = (id: string, fill: string, opacity = 1) =>
    `<pattern id="${id}" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${fill}" fill-opacity="${opacity}"/></pattern>`
  const out = [
    '<defs>',
    '<linearGradient id="shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17161d"/><stop offset="1" stop-color="#0e0d12"/></linearGradient>',
    '<radialGradient id="aura" cx="0.1" cy="0" r="0.8"><stop offset="0" stop-color="#8b7cf6" stop-opacity="0.2"/><stop offset="1" stop-color="#8b7cf6" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="aura2" cx="0.95" cy="1" r="0.6"><stop offset="0" stop-color="#38bdf8" stop-opacity="0.08"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>',
    '<linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.055"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.015"/></linearGradient>',
    '<filter id="glow" x="-50%" y="-300%" width="200%" height="700%"><feGaussianBlur stdDeviation="3"/></filter>',
    '<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>',
    '<filter id="neon" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="2.4"/></filter>',
    dots('dotsTrack', '#ffffff', 0.08),
    dots('dotsWhite', '#ffffff'),
    '<linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.7" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>',
    '<linearGradient id="shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
    '<mask id="dotMask" maskUnits="userSpaceOnUse" x="0" y="0" width="4000" height="4000"><rect width="4000" height="4000" fill="url(#dotsWhite)"/></mask>',
  ]
  for (const [tone, [light, dark]] of Object.entries(GRADIENTS)) {
    const id = tone.slice(1)
    out.push(
      dots(`d${id}`, light),
      `<linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient>`,
    )
  }
  for (const color of [MAIN_COLOR, ...AGENT_COLORS]) {
    out.push(dots(`a${color.slice(1)}`, color))
  }
  out.push('</defs>')
  return out.join('')
}

// A dithered progress bar: dot track, quarter ticks, fading dot fill, sweeping shimmer, glowing knob.
const ditherBar = (
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  percent: number,
  fillPattern: string,
  glowColor: string,
  delay: number,
) => {
  const p = Math.min(100, Math.max(0, percent))
  const fillW = Math.max(4, (p / 100) * w)
  const end = x + fillW
  const out = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#000000" fill-opacity="0.35" stroke="#ffffff" stroke-opacity="0.06"/>`,
    `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="url(#dotsTrack)"/>`,
  ]
  for (const q of [0.25, 0.5, 0.75]) {
    const tx = Math.round(x + q * w) + 0.5
    out.push(`<line x1="${tx}" x2="${tx}" y1="${y - 2}" y2="${y + h + 2}" stroke="#ffffff" stroke-opacity="0.14"/>`)
  }
  out.push(
    `<mask id="fade-${key}" maskUnits="userSpaceOnUse" x="0" y="0" width="4000" height="4000"><rect x="${x}" y="${y}" width="${fillW}" height="${h}" fill="url(#fade)"/></mask>`,
    `<clipPath id="clip-${key}"><rect x="${x}" y="${y + 1}" width="${fillW}" height="${h - 2}"/></clipPath>`,
    `<rect x="${x}" y="${y}" width="${fillW}" height="${h}" fill="${glowColor}" opacity="0.18" filter="url(#glow)"/>`,
    `<rect x="${x + 1}" y="${y + 2}" width="${fillW - 1}" height="${h - 4}" fill="url(#${fillPattern})" mask="url(#fade-${key})"/>`,
    `<g clip-path="url(#clip-${key})"><g mask="url(#dotMask)"><rect x="${x - 80}" y="${y}" width="80" height="${h}" fill="url(#shine)">`,
    `<animate attributeName="x" from="${x - 80}" to="${end}" dur="${(1.6 + fillW / 280).toFixed(2)}s" begin="${delay.toFixed(2)}s" repeatCount="indefinite"/>`,
    '</rect></g></g>',
    `<rect x="${end - 3}" y="${y - 3}" width="6" height="${h + 6}" rx="2" fill="${glowColor}" filter="url(#glow)" opacity="0.5">`,
    '<animate attributeName="opacity" values="0.2;0.8;0.2" dur="2.4s" repeatCount="indefinite"/>',
    '</rect>',
    `<rect x="${end - 1.5}" y="${y - 2}" width="3" height="${h + 4}" rx="1.5" fill="#ffffff"/>`,
  )
  return out.join('')
}

// A rounded frame inset by INSET so the trail's glow is not clipped: fill layers,
// one uniform hairline edge, and a neon comet (glow, tail, head) looping the border.
const INSET = 3
const TRAIL_SECONDS = 6

const neonFrame = (W: number, H: number, rx: number, fills: string[]) => {
  const box = `x="${INSET}" y="${INSET}" width="${W - INSET * 2}" height="${H - INSET * 2}" rx="${rx}"`
  // pathLength normalizes the perimeter to 1000, so dash lengths read as shares of the border.
  const comet = (length: number, color: string, width: number, opacity: number, filter = '') =>
    `<rect ${box} fill="none" pathLength="1000" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-opacity="${opacity}" stroke-dasharray="${length} ${1000 - length}" ${filter}>` +
    `<animate attributeName="stroke-dashoffset" values="${length};${length - 1000}" dur="${TRAIL_SECONDS}s" repeatCount="indefinite"/></rect>`
  return [
    ...fills.map(fill => `<rect ${box} fill="${fill}"/>`),
    `<rect ${box} fill="none" stroke="#ffffff" stroke-opacity="0.09"/>`,
    comet(150, '#8b7cf6', 4, 0.55, 'filter="url(#neon)"'),
    comet(150, '#8b7cf6', 1.2, 0.35),
    comet(80, '#a78bfa', 1.4, 0.7),
    comet(28, '#e9d5ff', 1.8, 1),
  ].join('')
}

const tileFrame = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#tile)" stroke="#ffffff" stroke-opacity="0.08"/>`

const sectionTitle = (x: number, y: number, text: string, right = '') =>
  `<text x="${x}" y="${y}" font-size="9.5" font-weight="600" letter-spacing="1.4" fill="#71717a">${escapeXml(text.toUpperCase())}</text>` +
  (right
    ? `<text x="${SVG_WIDTH - PAD}" y="${y}" font-size="10" text-anchor="end" fill="#71717a" font-family="${MONO}">${escapeXml(right)}</text>`
    : '')

const chip = (xRight: number, y: number, text: string, color = '#d4d4d8') => {
  const w = textWidth(text, 10.5) + 18
  const x = xRight - w
  return {
    x,
    svg:
      `<rect x="${x}" y="${y}" width="${w}" height="20" rx="10" fill="#ffffff" fill-opacity="0.045" stroke="#ffffff" stroke-opacity="0.09"/>` +
      `<text x="${x + w / 2}" y="${y + 13.5}" font-size="10.5" text-anchor="middle" fill="${color}" font-family="${MONO}">${escapeXml(text)}</text>`,
  }
}

type Card = {
  gauges: Gauge[]
  sums: Totals
  groups: AgentGroup[]
  cost?: number
}

const cardSvg = ({ gauges, sums, groups, cost }: Card) => {
  const W = SVG_WIDTH
  const inner = W - PAD * 2
  const body: string[] = []
  let y = 0

  // Header: live dot, title, chips.
  const isRunning = groups.some(group => group.running > 0)
  body.push(
    `<circle cx="${PAD + 4}" cy="22" r="7" fill="#8b7cf6" opacity="0.25"><animate attributeName="r" values="4;9;4" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.35;0;0.35" dur="2.6s" repeatCount="indefinite"/></circle>`,
    `<circle cx="${PAD + 4}" cy="22" r="3.5" fill="#a78bfa"/>`,
    `<text x="${PAD + 16}" y="26" font-size="13" font-weight="650" fill="#fafafa">Usage</text>`,
    `<text x="${PAD + 62}" y="26" font-size="11" fill="#71717a">${isRunning ? 'agents running' : 'this session'}</text>`,
  )
  let right = W - PAD
  const headerChips = [
    cost === undefined ? null : { text: `$${cost.toFixed(2)}`, color: '#fafafa' },
    sums.turns === 0 ? null : { text: `${sums.turns} turns · avg ${formatDuration(sums.durationMs / sums.turns)}`, color: '#a1a1aa' },
    sums.model ? { text: sums.model.replace(/^claude-/, ''), color: '#c4b5fd' } : null,
  ]
  for (const item of headerChips) {
    if (!item) continue
    const made = chip(right, 12, item.text, item.color)
    body.push(made.svg)
    right = made.x - 6
  }
  y = 46

  // Gauge tiles.
  if (gauges.length > 0) {
    const gap = 10
    const tileW = (inner - gap * (gauges.length - 1)) / gauges.length
    const tileH = 92
    gauges.forEach((gauge, index) => {
      const x = PAD + index * (tileW + gap)
      const id = gauge.tone.slice(1)
      const [light] = GRADIENTS[gauge.tone] ?? FALLBACK_GRADIENT
      const big = 26
      body.push(
        tileFrame(x, y, tileW, tileH),
        `<circle cx="${x + 14}" cy="${y + 18}" r="2.5" fill="${light}"/>`,
        `<text x="${x + 22}" y="${y + 21.5}" font-size="9.5" font-weight="600" letter-spacing="1.3" fill="#a1a1aa">${escapeXml(gauge.label.toUpperCase())}</text>`,
        gauge.note
          ? `<text x="${x + tileW - 12}" y="${y + 21.5}" font-size="10" text-anchor="end" fill="#71717a" font-family="${MONO}">${escapeXml(gauge.note)}</text>`
          : '',
        `<text x="${x + 13}" y="${y + 54}" font-size="${big}" font-weight="700" fill="#fafafa" letter-spacing="-0.5">${escapeXml(gauge.value)}<tspan font-size="14" font-weight="600" fill="${light}" dx="2">%</tspan></text>`,
        `<text x="${x + tileW - 12}" y="${y + 54}" font-size="10.5" text-anchor="end" fill="#71717a" font-family="${MONO}">${escapeXml(gauge.sub)}</text>`,
        ditherBar(`g${index}`, x + 13, y + 68, tileW - 26, 10, gauge.percent, `d${id}`, light, index * 0.4),
      )
    })
    y += tileH + 18
  }

  // Token flow: one stacked bar of where the session's tokens went.
  const total = allTokens(sums.session)
  if (total > 0) {
    body.push(sectionTitle(PAD, y + 8, 'Token flow', `${compact(total)} tokens`))
    const barY = y + 18
    const barH = 10
    body.push(
      `<clipPath id="flowClip"><rect x="${PAD}" y="${barY}" width="${inner}" height="${barH}" rx="5"/></clipPath>`,
      `<rect x="${PAD}" y="${barY}" width="${inner}" height="${barH}" rx="5" fill="#ffffff" fill-opacity="0.05"/>`,
      '<g clip-path="url(#flowClip)">',
    )
    let x = PAD
    for (const kind of FLOW) {
      const value = sums.session[kind.key]
      const w = (value / total) * inner
      if (w <= 0) continue
      body.push(
        `<rect x="${x}" y="${barY}" width="${w}" height="${barH}" fill="${kind.color}" fill-opacity="0.85"/>`,
        `<rect x="${x}" y="${barY}" width="${w}" height="${barH / 2}" fill="#ffffff" fill-opacity="0.12"/>`,
      )
      if (x > PAD) body.push(`<line x1="${x}" x2="${x}" y1="${barY}" y2="${barY + barH}" stroke="#0e0d12" stroke-width="2"/>`)
      x += w
    }
    body.push('</g>')
    let lx = PAD
    for (const kind of FLOW) {
      const value = sums.session[kind.key]
      const share = `${Math.round((value / total) * 100)}%`
      body.push(
        `<rect x="${lx}" y="${barY + 21}" width="8" height="8" rx="2" fill="${kind.color}"/>`,
        `<text x="${lx + 13}" y="${barY + 28.5}" font-size="10.5" fill="#a1a1aa">${kind.label}</text>`,
        `<text x="${lx + 13 + textWidth(kind.label, 10.5) + 6}" y="${barY + 28.5}" font-size="10.5" font-weight="600" fill="#e4e4e7" font-family="${MONO}">${compact(value)}</text>`,
        `<text x="${lx + 13 + textWidth(kind.label, 10.5) + 6 + textWidth(compact(value), 10.5) + 5}" y="${barY + 28.5}" font-size="10" fill="#52525b" font-family="${MONO}">${share}</text>`,
      )
      lx += inner / FLOW.length
    }
    y = barY + 44
  }

  // Agents: who spent the tokens, the conversation versus each subagent type.
  if (groups.length > 0 && total > 0) {
    const runs = groups.reduce((n, group) => n + group.runs, 0)
    body.push(sectionTitle(PAD, y + 8, 'By agent', `${runs} subagent run${runs === 1 ? '' : 's'}`))
    const shareY = y + 18
    const shareH = 6
    const slices = [
      { color: MAIN_COLOR, value: allTokens(sums.main) },
      ...groups.map(group => ({ color: group.color, value: allTokens(group.tokens) })),
    ]
    body.push(
      `<clipPath id="shareClip"><rect x="${PAD}" y="${shareY}" width="${inner}" height="${shareH}" rx="3"/></clipPath>`,
      `<rect x="${PAD}" y="${shareY}" width="${inner}" height="${shareH}" rx="3" fill="#ffffff" fill-opacity="0.05"/>`,
      '<g clip-path="url(#shareClip)">',
    )
    let sx = PAD
    for (const slice of slices) {
      const w = (slice.value / total) * inner
      if (w <= 0) continue
      body.push(`<rect x="${sx}" y="${shareY}" width="${w}" height="${shareH}" fill="${slice.color}" fill-opacity="0.9"/>`)
      if (sx > PAD) body.push(`<line x1="${sx}" x2="${sx}" y1="${shareY}" y2="${shareY + shareH}" stroke="#0e0d12" stroke-width="2"/>`)
      sx += w
    }
    body.push('</g>')

    // One row each: the conversation, then subagent types by tokens.
    const rowsY = shareY + 18
    const rowH = 28
    const rows = [
      {
        name: 'Conversation',
        detail: 'main loop',
        color: MAIN_COLOR,
        runs: 0,
        running: 0,
        tokens: sums.main,
        model: sums.model,
      },
      ...groups.slice(0, 5).map(group => ({
        name: group.type,
        detail: group.latest,
        color: group.color,
        runs: group.runs,
        running: group.running,
        tokens: group.tokens,
        model: group.model,
      })),
    ]
    const shareX = W - PAD - 244
    const shareW = 96
    rows.forEach((row, index) => {
      const ry = rowsY + index * rowH
      const mid = ry + rowH / 2
      const rowTotal = allTokens(row.tokens)
      const share = (rowTotal / total) * 100
      body.push(`<rect x="${PAD}" y="${ry + 1}" width="${inner}" height="${rowH - 2}" rx="7" fill="#ffffff" fill-opacity="${index % 2 === 0 ? 0.025 : 0}"/>`)
      if (row.running > 0) {
        body.push(
          `<circle cx="${PAD + 12}" cy="${mid}" r="6" fill="${row.color}" opacity="0.3"><animate attributeName="r" values="3;8;3" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite"/></circle>`,
        )
      }
      const nameText = clip(row.name, 22)
      const nameW = textWidth(nameText, 12)
      body.push(
        `<circle cx="${PAD + 12}" cy="${mid}" r="3.5" fill="${row.color}"/>`,
        `<text x="${PAD + 24}" y="${mid + 4}" font-size="12" font-weight="600" fill="#f4f4f5">${escapeXml(nameText)}</text>`,
      )
      let tagX = PAD + 24 + nameW + 8
      if (row.runs > 0) {
        const tag = row.running > 0 ? `×${row.runs} · ${row.running} live` : `×${row.runs}`
        const tagW = textWidth(tag, 9.5) + 12
        body.push(
          `<rect x="${tagX}" y="${mid - 8}" width="${tagW}" height="16" rx="8" fill="${row.color}" fill-opacity="0.14" stroke="${row.color}" stroke-opacity="0.35"/>`,
          `<text x="${tagX + tagW / 2}" y="${mid + 3.5}" font-size="9.5" font-weight="600" text-anchor="middle" fill="${row.color}" font-family="${MONO}">${escapeXml(tag)}</text>`,
        )
        tagX += tagW + 8
      }
      const detailRoom = Math.max(0, Math.floor((shareX - 16 - tagX) / 6))
      if (detailRoom > 6) {
        body.push(`<text x="${tagX}" y="${mid + 4}" font-size="11" fill="#71717a">${escapeXml(clip(row.detail, detailRoom))}</text>`)
      }
      body.push(
        ditherBar(`a${index}`, shareX, mid - 4, shareW, 8, share, `a${row.color.slice(1)}`, row.color, 0.3 + index * 0.25),
        `<text x="${shareX + shareW + 10}" y="${mid + 4}" font-size="11" font-weight="600" fill="#e4e4e7" font-family="${MONO}">${Math.round(share)}%</text>`,
        `<text x="${W - PAD - 64}" y="${mid + 4}" font-size="11" text-anchor="end" fill="#a1a1aa" font-family="${MONO}">${compact(rowTotal)}</text>`,
        `<text x="${W - PAD - 8}" y="${mid + 4}" font-size="10.5" text-anchor="end" fill="${hitRate(row.tokens) >= 70 ? '#86efac' : '#a1a1aa'}" font-family="${MONO}">${Math.round(hitRate(row.tokens))}% hit</text>`,
      )
    })
    y = rowsY + rows.length * rowH + 4
  }

  const H = y + 10
  const shell = [neonFrame(W, H, 16, ['url(#shell)', 'url(#aura)', 'url(#aura2)'])]

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`,
    defs(),
    ...shell,
    ...body,
    '</svg>',
  ].join('')
}

// The collapsed band: one slim strip with context, cache hits and live subagents.
type Strip = { context?: Gauge; cache?: Gauge; running: number }

const STRIP_HEIGHT = 34

const stripSvg = ({ context, cache, running }: Strip) => {
  const H = STRIP_HEIGHT
  const mid = H / 2
  // Content first; the shell is sized to it once the width is known.
  const out: string[] = []
  let x = 16

  const meter = (gauge: Gauge, key: string, delay: number) => {
    const [light] = GRADIENTS[gauge.tone] ?? FALLBACK_GRADIENT
    const label = gauge.label.toUpperCase()
    out.push(
      `<text x="${x}" y="${mid + 3.5}" font-size="9.5" font-weight="600" letter-spacing="1.3" fill="#a1a1aa">${escapeXml(label)}</text>`,
    )
    x += textWidth(label, 9.5) + 16
    out.push(ditherBar(key, x, mid - 4, 96, 8, gauge.percent, `d${gauge.tone.slice(1)}`, light, delay))
    x += 96 + 10
    out.push(
      `<text x="${x}" y="${mid + 4.5}" font-size="12.5" font-weight="700" fill="#fafafa">${escapeXml(gauge.value)}<tspan font-size="10" fill="${light}" dx="1">%</tspan></text>`,
    )
    x += 44
    out.push(`<line x1="${x}" x2="${x}" y1="${mid - 7}" y2="${mid + 7}" stroke="#ffffff" stroke-opacity="0.1"/>`)
    x += 16
  }

  if (context) meter(context, 'sctx', 0)
  if (cache) meter(cache, 'scache', 0.5)

  // Live subagents: a pulsing dot while any run.
  const agentColor = running > 0 ? '#a78bfa' : '#52525b'
  if (running > 0) {
    out.push(
      `<circle cx="${x + 4}" cy="${mid}" r="6" fill="${agentColor}" opacity="0.3"><animate attributeName="r" values="3;8;3" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite"/></circle>`,
    )
  }
  out.push(
    `<circle cx="${x + 4}" cy="${mid}" r="3.5" fill="${agentColor}"/>`,
    `<text x="${x + 14}" y="${mid + 4}" font-size="11.5" fill="${running > 0 ? '#f4f4f5' : '#71717a'}">${
      running > 0 ? `<tspan font-weight="700">${running}</tspan> agent${running === 1 ? '' : 's'} running` : 'no agents running'
    }</text>`,
  )
  const agentText = running > 0 ? `${running} agent${running === 1 ? '' : 's'} running` : 'no agents running'
  const W = Math.ceil(x + 14 + textWidth(agentText, 11.5) + 18)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`,
    defs(),
    neonFrame(W, H, (H - INSET * 2) / 2, ['url(#shell)', 'url(#aura)']),
    ...out,
    '</svg>',
  ].join('')
}

// ---------------------------------------------------------------------------
// Terminal: models for the Raster drawings in ./terminal.ts, and the registry
// of mounted Rasters a clock repaints with $.ui.blit for the shimmer and neon.

const toneOfGauge = (tone: string) => {
  const [light, dark] = GRADIENTS[tone] ?? FALLBACK_GRADIENT
  return { light, dark }
}

const stripModel = (context: Gauge | undefined, cache: Gauge | undefined, running: number): StripModel => ({
  meters: [context, cache]
    .filter((gauge): gauge is Gauge => gauge !== undefined)
    .map(gauge => ({
      label: gauge.key === 'cache' ? 'Cache' : gauge.label,
      percent: gauge.percent,
      value: gauge.value,
      tone: toneOfGauge(gauge.tone),
    })),
  running,
})

const paneModel = (gauges: Gauge[], sums: Totals, groups: AgentGroup[], cost: number | undefined): PaneModel => {
  const total = allTokens(sums.session)
  const header = [
    sums.model ? sums.model.replace(/^claude-/, '') : null,
    sums.turns > 0 ? `${sums.turns} turns · avg ${formatDuration(sums.durationMs / sums.turns)}` : null,
    cost === undefined ? null : `$${cost.toFixed(2)}`,
  ]
    .filter((part): part is string => part !== null)
    .join('  ·  ')
  const runs = groups.reduce((n, group) => n + group.runs, 0)
  const rows = [
    { name: 'Conversation', detail: 'main loop', color: MAIN_COLOR, runs: 0, running: 0, tokens: sums.main },
    ...groups.slice(0, 6).map(group => ({
      name: group.type,
      detail: group.latest,
      color: group.color,
      runs: group.runs,
      running: group.running,
      tokens: group.tokens,
    })),
  ]
  return {
    header,
    gauges: gauges.map(gauge => ({ ...gauge, tone: toneOfGauge(gauge.tone) })),
    flow: total === 0 ? [] : FLOW.map(kind => ({ label: kind.label, value: sums.session[kind.key], color: kind.color })),
    flowTotal: `${compact(total)} tokens`,
    agents:
      total === 0 || groups.length === 0
        ? []
        : rows.map(row => ({
            ...row,
            share: (allTokens(row.tokens) / total) * 100,
            tokens: compact(allTokens(row.tokens)),
            hit: hitRate(row.tokens),
          })),
    runsLabel: `${runs} subagent run${runs === 1 ? '' : 's'}`,
  }
}

type Mounted = { requestId: string; key: string; paint: (tick: number) => string }

// Rasters drawn by the latest renders, repainted by the session clock. Module
// state on purpose: a reload re-renders and refills it.
const mounted = new Map<string, Mounted>()
let tick = 0

// Everything both views draw from, read once per render.
async function figures($: EngineInterface) {
  const snap = await read($, snapshot)
  if (snap === null) return null
  // Totals written by an earlier version of this module may lack newer fields.
  const sums: Totals = { ...NO_TOTALS, ...(await read($, totals)) }
  const groups = groupAgents(await read($, agents))
  const gauges = gaugesOf(snap, sums, await read($, now))
  const context = gauges.find(gauge => gauge.key === 'context')
  const cache = gauges.find(gauge => gauge.key === 'cache')
  const running = groups.reduce((n, group) => n + group.running, 0)
  const alt = gauges.map(gauge => `${gauge.label} ${gauge.value}%`).join(', ')
  return { snap, sums, groups, gauges, context, cache, running, alt }
}

// Opens the details panel or closes it, deciding from the panes open now,
// never from a flag a drawing captured. Resolves whether it is open after.
async function togglePanel($: EngineInterface) {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANEL)) {
    await update($, isPanelOpen, () => false)
    await $.ui.close({ id: PANEL })
    return false
  }
  await update($, isPanelOpen, () => true)
  await $.ui.open({ id: PANEL, title: 'Usage', closeOnEscape: true, columns: 100, rows: 24 })
  return true
}

// ---------------------------------------------------------------------------
// Hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'meters',
      description: 'Open or close the usage details panel (args: hide, show)',
    })
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage))
    // A reload keeps the flag but may have dropped the pane: align it with what is open.
    const panes = await $.ui.panes()
    const isOpen = panes.some(pane => pane.id === PANEL)
    await update($, isPanelOpen, () => isOpen)
    const at = await $.clock.now()
    await update($, now, () => at)
    $.clock.every(60_000, () => {
      void $.clock.now().then(t => update($, now, () => t))
    })
    // Terminal shimmer and neon: repaint mounted Rasters in place, no render pass.
    $.clock.every(140, () => {
      tick += 1
      for (const [id, raster] of mounted) {
        void $.ui
          .blit({ requestId: raster.requestId, key: raster.key, cells: raster.paint(tick) })
          .then(result => {
            if (result.deny) mounted.delete(id)
          })
      }
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e))
    const at = await $.clock.now()
    await update($, now, () => at)

    return next(e)
  })

  // Learn each subagent's type and task as it starts, keyed by the id its turns carry.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const agentId = result.agentId
    if (agentId !== undefined) {
      const run: AgentRun = {
        id: agentId,
        type: e.subagentType,
        description: e.description,
        model: result.model,
        turns: 0,
        durationMs: 0,
        tokens: NO_TOKENS,
        isRunning: true,
      }
      await update($, agents, list => [...list.filter(one => one.id !== agentId), run].slice(-MAX_AGENTS))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.usage) {
      const turn: Tokens = {
        input: e.usage.input_tokens,
        output: e.usage.output_tokens,
        cacheRead: e.usage.cache_read_input_tokens,
        cacheWrite: e.usage.cache_creation_input_tokens,
      }
      const agentId = e.agentId
      const isMain = agentId === undefined
      const model = e.usage.model
      const durationMs = e.durationMs

      // Session figures count every loop; turns, duration, model and "last" stay the conversation's.
      await update($, totals, sums => ({
        turns: sums.turns + (isMain ? 1 : 0),
        durationMs: sums.durationMs + (isMain ? durationMs : 0),
        session: addTokens(sums.session, turn),
        main: isMain ? addTokens(sums.main ?? NO_TOKENS, turn) : (sums.main ?? NO_TOKENS),
        last: isMain ? turn : sums.last,
        model: isMain ? model : sums.model,
      }))

      if (!isMain) {
        await update($, agents, list => {
          const known = list.some(one => one.id === agentId)
          const updated = list.map(one =>
            one.id === agentId
              ? {
                  ...one,
                  model,
                  turns: one.turns + 1,
                  durationMs: one.durationMs + durationMs,
                  tokens: addTokens(one.tokens, turn),
                  isRunning: false,
                }
              : one,
          )
          // A subagent that started before this module loaded: keep its tokens under an unknown type.
          return known
            ? updated
            : [
                ...updated,
                {
                  id: agentId,
                  type: 'subagent',
                  description: '',
                  model,
                  turns: 1,
                  durationMs,
                  tokens: turn,
                  isRunning: false,
                },
              ].slice(-MAX_AGENTS)
        })
      }
    }

    return next(e)
  })

  on('command.run', { command: 'meters' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'hide' || arg === 'show') {
      const hidden = arg === 'hide'
      await update($, isHidden, () => hidden)
      return { text: hidden ? 'Usage meters hidden.' : 'Usage meters shown.' }
    }
    const isOpen = await togglePanel($)
    return { text: isOpen ? 'Usage details opened.' : 'Usage details closed.' }
  })

  // The panel's open state, kept in sync with every close: the strip's button, Escape, the pane's own mark.
  on('ui.close', { id: PANEL }, async ($, e, next) => {
    const closed = await next(e)
    await update($, isPanelOpen, () => false)

    return closed
  })

  // The strip above the prompt: always the compact line, with a button for the panel.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await figures($)
    if (e.props.hasSurvey || f === null || f.gauges.length === 0 || (await read($, isHidden))) {
      return next(e)
    }

    const isOpen = await read($, isPanelOpen)
    const onToggle = async () => {
      await togglePanel($)
    }
    const label = isOpen ? 'Hide details' : 'Details'

    if (e.surface !== 'terminal') {
      const { Box, Button, Svg } = $.ui.resolve(e)

      return (
        <Box paddingX={1} flexDirection="row" alignItems="center" gap={1}>
          <Svg source={stripSvg(f)} alt={`Usage: ${f.alt}; ${f.running} agents running`} />
          <Button key="panel" label={label} plain dimColor onPress={onToggle} />
        </Box>
      )
    }

    const { Box, Button, Raster } = $.ui.resolve(e)
    const model = stripModel(f.context, f.cache, f.running)
    const paint = (t: number) => encode(paintStrip(model, t))
    mounted.set('strip', { requestId: e.requestId, key: 'strip', paint })

    return (
      <Box paddingX={1} flexDirection="row" gap={1}>
        <Raster key="strip" columns={stripWidth(model)} rows={1} cells={paint(tick)} />
        <Button key="panel" label={isOpen ? 'hide details' : 'details'} hotkey="d" plain onPress={onToggle} />
      </Box>
    )
  })

  // The panel: the full dashboard.
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const f = await figures($)

    if (e.surface !== 'terminal') {
      const { Box, Text, Svg } = $.ui.resolve(e)
      if (f === null || f.gauges.length === 0) {
        return <Text dimColor>Waiting for the first measurement…</Text>
      }

      return (
        <Box flexDirection="column">
          <Svg source={cardSvg({ gauges: f.gauges, sums: f.sums, groups: f.groups, cost: f.snap.costUsd })} alt={`Usage: ${f.alt}`} />
        </Box>
      )
    }

    const { Raster, Text } = $.ui.resolve(e)
    if (f === null || f.gauges.length === 0) {
      return <Text dimColor>Waiting for the first measurement…</Text>
    }
    const model = paneModel(f.gauges, f.sums, f.groups, f.snap.costUsd)
    const columns = Math.max(40, e.props.bodyColumns)
    const paint = (t: number) => encode(paintPane(model, columns, t))
    mounted.set('pane', { requestId: e.requestId, key: 'pane', paint })

    return <Raster key="pane" columns={columns} rows={paneRows(model)} cells={paint(tick)} />
  })
}
