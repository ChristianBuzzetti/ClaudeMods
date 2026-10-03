// Every SVG the mod draws, cached per load: Boberto's live states, idle
// gestures and end-of-turn reactions (drawn by the engine at run time, see
// engine-host.ts), the mini pill and the status timeline for the band above
// the prompt. Pure: no `$`, shared with the build's preview.

import { assembleSvg } from './assemble'
import type { AssembleOptions, BobertoAnimation, BobertoStep } from './assemble'
import { GESTURE_MOTION, LIVE_SPECS } from './choreo'
import type { LiveName } from './choreo'
import { drawPoses, glowColor, outfitKey, recordGesture, toAnimation } from './engine-host'
import type { Outfit } from './engine-host'
import type { BobertoPhase, BobertoTimelineEntry } from '../types'

/** The Svg element's cap is 131072 characters; stay well under it. */
export const SVG_BUDGET = 120_000

/** `full` for the pane (one decimal), `small` for the band and the transcript (whole units). */
export type Quality = 'full' | 'small'
const DIGITS: Record<Quality, number> = { full: 1, small: 0 }
const BUDGET: Record<Quality, number> = { full: 116_000, small: 70_000 }

// ---------------------------------------------------------------------------
// Fitting a flipbook under its budget.

/** Folds the frame with the least screen time into the steps around it. */
function dropBriefest(anim: BobertoAnimation): BobertoAnimation | null {
  const time = new Map<number, number>()
  for (const step of anim.steps) time.set(step.frame, (time.get(step.frame) ?? 0) + step.ms)
  if (time.size < 2) return null
  let victim = -1
  let least = Infinity
  for (const [frame, ms] of time) {
    if (ms < least) [victim, least] = [frame, ms]
  }
  const steps: BobertoStep[] = []
  for (const step of anim.steps) {
    const prev = steps[steps.length - 1]
    const frame = step.frame === victim ? (prev?.frame ?? anim.steps.find(s => s.frame !== victim)?.frame ?? step.frame) : step.frame
    if (prev !== undefined && prev.frame === frame) prev.ms += step.ms
    else steps.push({ frame, ms: step.ms })
  }
  return { ...anim, steps }
}

/** Assembles `anim`, dropping its briefest frames until it fits `budget`. */
export function fitSvg(anim: BobertoAnimation, options: AssembleOptions, budget: number): string | null {
  let current: BobertoAnimation | null = anim
  while (current !== null) {
    const svg = assembleSvg(current, options)
    if (svg.length <= budget) return svg
    current = dropBriefest(current)
  }
  return null
}

// ---------------------------------------------------------------------------
// Cache. Bounded: a long session of shuffles should not keep every outfit.

const cache = new Map<string, string>()
const LIMIT = 48

function remember(key: string, svg: string) {
  cache.delete(key)
  cache.set(key, svg)
  while (cache.size > LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return svg
}

const glowOf = (outfit: Outfit) => glowColor(outfit)

/** One live state, looping (or played once). */
export function liveSvg(name: LiveName, outfit: Outfit, quality: Quality, once = false): string {
  const key = `live|${name}|${outfitKey(outfit)}|${quality}|${once}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const spec = LIVE_SPECS[name]
  const anim = toAnimation(drawPoses(outfit, spec.steps, DIGITS[quality]), spec.motion, spec.extras)
  const svg = fitSvg(anim, { glow: glowOf(outfit), once }, BUDGET[quality]) ?? assembleSvg({ ...anim, steps: anim.steps.slice(0, 1) })
  return remember(key, svg)
}

/** Whether a gesture's SVG is already drawn for `outfit`. */
export const hasGesture = (id: string, outfit: Outfit, quality: Quality) => cache.has(`gesture|${id}|${outfitKey(outfit)}|${quality}`)

/** One of the engine's gestures, recorded from its choreography: played once, or looping with `loop`. */
export async function gestureSvg(
  id: string,
  outfit: Outfit,
  quality: Quality,
  loop = false,
): Promise<{ svg: string; durationMs: number } | null> {
  const key = `gesture|${id}|${outfitKey(outfit)}|${quality}${loop ? '|loop' : ''}`
  const durKey = `${key}|ms`
  const hit = cache.get(key)
  if (hit !== undefined) return { svg: hit, durationMs: Number(cache.get(durKey) ?? 6000) }
  const frames = await recordGesture(outfit, id, DIGITS[quality])
  if (frames === null) return null
  const anim = toAnimation(frames, GESTURE_MOTION, '')
  const svg = fitSvg(anim, { glow: glowOf(outfit), once: !loop }, BUDGET[quality])
  if (svg === null) return null
  const durationMs = frames.steps.reduce((sum, step) => sum + step.ms, 0)
  remember(durKey, String(durationMs))
  return { svg: remember(key, svg), durationMs }
}

/** The width-to-height ratio of Boberto's documents. */
export function aspectOf(svg: string) {
  const match = /viewBox="([^"]+)"/.exec(svg)
  const [, , w = 1, h = 1] = (match?.[1] ?? '0 0 1 1').split(' ').map(Number)
  return w / h
}

// ---------------------------------------------------------------------------
// The band above the prompt: the visual language of the usage strip (dark
// shell, hairline edge, neon comet on the border). Every document is drawn at
// the CSS size it is shown at (the hook passes width and height), so the app
// never scales it: a document wider than its slot would shrink whole.

export const BAND_HEIGHT = 44
/** The timeline's widths: a typical band, and a narrow one. */
export const TIMELINE_WIDTH = { wide: 560, narrow: 400 }
const INSET = 3
const FONT = "Inter, 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif"
const MONO = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"
const ACCENT = '#8b7cf6'

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const textWidth = (text: string, size: number, mono = false) => Math.ceil(text.length * size * (mono ? 0.6 : 0.56))

const shellDefs = (p: string) =>
  `<linearGradient id="${p}shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17161d"/><stop offset="1" stop-color="#0e0d12"/></linearGradient>` +
  `<radialGradient id="${p}aura" cx="0.1" cy="0" r="0.8"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0.2"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>` +
  `<filter id="${p}neon" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
  `<filter id="${p}glow" x="-50%" y="-300%" width="200%" height="700%"><feGaussianBlur stdDeviation="3"/></filter>`

/** The rounded shell with its hairline edge and a neon comet looping the border. */
function neonFrame(p: string, W: number, H: number, seconds: number) {
  const rx = (H - INSET * 2) / 2
  const box = `x="${INSET}" y="${INSET}" width="${W - INSET * 2}" height="${H - INSET * 2}" rx="${rx}"`
  const comet = (length: number, color: string, width: number, opacity: number, filter = '') =>
    `<rect ${box} fill="none" pathLength="1000" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-opacity="${opacity}" stroke-dasharray="${length} ${1000 - length}" ${filter}>` +
    `<animate attributeName="stroke-dashoffset" values="${length};${length - 1000}" dur="${seconds}s" repeatCount="indefinite"/></rect>`
  return [
    `<rect ${box} fill="url(#${p}shell)"/>`,
    `<rect ${box} fill="url(#${p}aura)"/>`,
    `<rect ${box} fill="none" stroke="#ffffff" stroke-opacity="0.09"/>`,
    comet(150, ACCENT, 4, 0.55, `filter="url(#${p}neon)"`),
    comet(150, ACCENT, 1.2, 0.35),
    comet(80, '#a78bfa', 1.4, 0.7),
    comet(28, '#e9d5ff', 1.8, 1),
  ].join('')
}

/** Re-roots a Boberto document as a nested <svg> placed in a box. */
function nest(svg: string, x: number, y: number, w: number, h: number) {
  return svg.replace(/^<svg ([^>]*?) width="[^"]*" height="[^"]*"/, `<svg $1 x="${x}" y="${y}" width="${w}" height="${h}"`)
}

/** Mini Boberto in a 34 px pill, playing `name` (a live state or a gesture's document). */
export const MINI_WIDTH = 72

export function miniPillSvg(boberto: string, isActive: boolean) {
  const H = BAND_HEIGHT
  const W = MINI_WIDTH
  // His canvas has air around him for the wings and the motion: drawn larger
  // than the pill and clipped to its inside, he fills it.
  const bh = Math.round(H * 1.3)
  const bw = Math.round(bh * aspectOf(boberto))
  const r = (H - INSET * 2) / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>${shellDefs('m')}<clipPath id="minside"><rect x="${INSET + 1}" y="${INSET + 1}" width="${W - INSET * 2 - 2}" height="${H - INSET * 2 - 2}" rx="${r - 1}"/></clipPath></defs>` +
    neonFrame('m', W, H, isActive ? 2.4 : 6) +
    `<g clip-path="url(#minside)">${nest(boberto, Math.round((W - bw) / 2), Math.round(H - bh + H * 0.12), bw, bh)}</g>` +
    '</svg>'
  )
}

/** The words each phase draws, and its accent. */
export const PHASES: Record<BobertoPhase, { word: string; color: string }> = {
  thinking: { word: 'thinking', color: '#c4b5fd' },
  reading: { word: 'reading', color: '#38bdf8' },
  searching: { word: 'searching', color: '#22d3ee' },
  editing: { word: 'editing', color: '#fbbf24' },
  running: { word: 'running', color: '#f472b6' },
  delegating: { word: 'delegating', color: '#a78bfa' },
  browsing: { word: 'browsing', color: '#34d399' },
  asking: { word: 'asking', color: '#fb923c' },
  planning: { word: 'planning', color: '#a3e635' },
  tool: { word: 'tool', color: '#a1a1aa' },
  done: { word: 'done', color: '#22c55e' },
  error: { word: 'error', color: '#ef4444' },
  stopped: { word: 'stopped', color: '#a1a1aa' },
}

export const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** What one chip reads: phase, detail, ×count, elapsed. */
export function chipText(entry: BobertoTimelineEntry, elapsedMs: number) {
  let text = PHASES[entry.phase].word
  if (entry.detail) text += ` ${clip(entry.detail, 16)}`
  if (entry.count > 1) text += ` ×${entry.count}`
  if (elapsedMs >= 1000) text += ` · ${formatElapsed(elapsedMs)}`
  return text
}

/**
 * The status timeline: the chat's recent phases as chips in a pill of width
 * `W`, newest on the right and lit, older ones fading toward the left; the
 * ones that do not fit leave from the left edge.
 */
const CHIP_H = 26
const CHIP_FONT = 11

export function timelineSvg(entries: readonly BobertoTimelineEntry[], now: number, W: number, isWorking: boolean) {
  const H = BAND_HEIGHT
  const mid = H / 2
  const label = 'STATUS'
  const out: string[] = []

  // The lead: a dot, pulsing while a turn runs, and the label.
  const dot = isWorking ? '#a78bfa' : '#52525b'
  if (isWorking) {
    out.push(
      `<circle cx="20" cy="${mid}" r="6" fill="${dot}" opacity="0.3"><animate attributeName="r" values="3;8;3" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite"/></circle>`,
    )
  }
  out.push(
    `<circle cx="20" cy="${mid}" r="3.5" fill="${dot}"/>`,
    `<text x="31" y="${mid + 3.8}" font-size="${CHIP_FONT}" font-weight="600" letter-spacing="1.3" fill="#a1a1aa">${label}</text>`,
  )
  const left = 31 + textWidth(label, 10.5) + 16
  const right = W - 12

  if (entries.length === 0) {
    out.push(`<text x="${left}" y="${mid + 4}" font-size="12" fill="#71717a">waiting for the first prompt</text>`)
  }

  // Chips from the newest (right) back, while they fit.
  let x = right
  const gap = 6
  const chips: string[] = []
  for (let i = entries.length - 1, age = 0; i >= 0; i--, age++) {
    const entry = entries[i]
    if (entry === undefined) continue
    const until = entries[i + 1]?.at ?? (isWorking || age > 0 ? now : entry.lastAt)
    const text = chipText(entry, Math.max(until - entry.at, entry.lastAt - entry.at))
    const isNewest = age === 0
    const w = textWidth(text, CHIP_FONT, true) + (isNewest ? 30 : 22)
    if (x - w < left) break
    x -= w
    const { color } = PHASES[entry.phase]
    const tone = entry.isError === true ? PHASES.error.color : color
    const opacity = isNewest ? 1 : Math.max(0.28, 0.9 - age * 0.11)
    const y = mid - CHIP_H / 2
    const parts = [`<g opacity="${opacity.toFixed(2)}">`]
    if (isNewest) {
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${tone}" opacity="0.35" filter="url(#tglow)"/>`,
        `<rect x="${x}" y="${y}" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${tone}" fill-opacity="0.16" stroke="${tone}" stroke-opacity="0.8"/>`,
        `<circle cx="${x + 12}" cy="${mid}" r="3.2" fill="${tone}">${isWorking ? '<animate attributeName="opacity" values="1;.35;1" dur="1.2s" repeatCount="indefinite"/>' : ''}</circle>`,
        `<text x="${x + 21}" y="${mid + 4.2}" font-size="${CHIP_FONT}" font-weight="600" fill="#fafafa" font-family="${MONO}">${escapeXml(text)}</text>`,
      )
    } else {
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="#ffffff" fill-opacity="0.045" stroke="#ffffff" stroke-opacity="0.09"/>`,
        `<circle cx="${x + 10}" cy="${mid}" r="2.6" fill="${tone}"/>`,
        `<text x="${x + 16}" y="${mid + 4.2}" font-size="${CHIP_FONT}" fill="#d4d4d8" font-family="${MONO}">${escapeXml(text)}</text>`,
      )
    }
    parts.push('</g>')
    chips.push(parts.join(''))
    x -= gap
    // A hairline arrow between chips reads as "then".
    if (i > 0) chips.push(`<path d="M${x + 1} ${mid - 3}l3 3l-3 3" fill="none" stroke="#ffffff" stroke-opacity="0.18"/>`)
    x -= 4
  }
  // Fade the oldest edge.
  out.push(`<g mask="url(#tfade)">${chips.join('')}</g>`)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`,
    '<defs>',
    shellDefs('t'),
    `<linearGradient id="tfadeg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.2"/><stop offset="${(Math.min(160, W / 3) / W).toFixed(3)}" stop-color="#fff"/></linearGradient>`,
    `<mask id="tfade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="${left}" y="0" width="${W - left}" height="${H}" fill="url(#tfadeg)"/></mask>`,
    '</defs>',
    neonFrame('t', W, H, 6),
    ...out,
    '</svg>',
  ].join('')
}

/** A short line saying what the timeline shows, for a reader that cannot see it. */
export function timelineAlt(entries: readonly BobertoTimelineEntry[]) {
  if (entries.length === 0) return 'Status timeline: nothing yet'
  return `Status timeline, newest last: ${entries
    .slice(-6)
    .map(entry => `${PHASES[entry.phase].word}${entry.detail ? ` ${entry.detail}` : ''}${entry.count > 1 ? ` ×${entry.count}` : ''}`)
    .join(', ')}`
}
