// Custom RGB colors for the wardrobe: parsing what a person types into one
// canonical form (`#rrggbb`, lowercase) and the channel arithmetic the RGB
// editor needs. Pure: no `$`.

/** A canonical custom color: `#` and six lowercase hex digits. */
export const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value)

export type Rgb = { r: number; g: number; b: number }

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const byteHex = (n: number) => clampByte(n).toString(16).padStart(2, '0')

export const rgbToHex = ({ r, g, b }: Rgb) => `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** One channel as typed: a whole number from 0 to 255, else null. */
export function parseByte(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,3}$/.test(t)) return null
  const n = Number(t)
  return n <= 255 ? n : null
}

/**
 * What a person typed as a color, canonical, or null: `#rrggbb`, `rrggbb`,
 * `#rgb`, `rgb`, `r,g,b` (or space separated) and `rgb(r, g, b)`.
 */
export function parseColor(text: string): string | null {
  const t = text.trim().toLowerCase()
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t)
  if (hex !== null) {
    const digits = hex[1] ?? ''
    const six = digits.length === 3 ? [...digits].map(c => c + c).join('') : digits
    return `#${six}`
  }
  const triple = /^(?:rgb\s*\(\s*)?(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)?$/.exec(t)
  if (triple === null) return null
  // A parenthesis on one side only is a typo, not a color.
  if (t.startsWith('rgb') !== t.endsWith(')')) return null
  const [r, g, b] = [triple[1], triple[2], triple[3]].map(x => parseByte(x ?? ''))
  if (r === null || g === null || b === null || r === undefined || g === undefined || b === undefined) return null
  return rgbToHex({ r, g, b })
}

/** `hex` with one channel replaced, or nudged by `delta` (clamped to 0..255). */
export function withChannel(hex: string, channel: keyof Rgb, value: number) {
  return rgbToHex({ ...hexToRgb(hex), [channel]: clampByte(value) })
}

/** A random, reasonably vivid color: what Shuffle picks for a custom slot. */
export function randomHex(random: () => number = Math.random) {
  const h = random() * 360
  const s = 0.55 + random() * 0.4
  const l = 0.4 + random() * 0.25
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 })
}

// ---------------------------------------------------------------------------
// The wardrobe's drawings, in the usage-meters idiom: dark shells, hairline
// edges, small letter-spaced uppercase labels, mono figures.

const FONT = "Inter, 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif"
const MONO = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A small uppercase, letter-spaced section label ("WARDROBE"), and its width in px. */
export function labelSvg(text: string, color = '#a1a1aa') {
  const t = text.toUpperCase()
  const width = Math.ceil(t.length * 8.4) + 4
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 14" width="${width}" height="14">` +
    `<text x="1" y="10.5" font-family="${FONT}" font-size="9.5" font-weight="600" letter-spacing="1.6" fill="${color}">${escapeXml(t)}</text>` +
    '</svg>'
  return { source, width }
}

export const SWATCH_CARD = { width: 210, height: 76 }

/** The color card's head: a 56 px rounded swatch glowing in its own color, the part's name, the hex and the channels in mono. */
export function swatchCardSvg(hex: string, part: string) {
  const { width, height } = SWATCH_CARD
  const { r, g, b } = hexToRgb(hex)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    '<defs>' +
    '<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>' +
    '</defs>' +
    `<rect x="12" y="12" width="52" height="52" rx="13" fill="${hex}" opacity="0.6" filter="url(#halo)"/>` +
    `<rect x="10" y="10" width="56" height="56" rx="14" fill="${hex}"/>` +
    '<rect x="10" y="10" width="56" height="56" rx="14" fill="url(#gloss)"/>' +
    '<rect x="10.5" y="10.5" width="55" height="55" rx="13.5" fill="none" stroke="#ffffff" stroke-opacity="0.18"/>' +
    `<text x="82" y="26" font-family="${FONT}" font-size="9.5" font-weight="600" letter-spacing="1.5" fill="#a1a1aa">${escapeXml(part.toUpperCase())}</text>` +
    `<text x="81" y="47" font-family="${MONO}" font-size="18" font-weight="600" fill="#fafafa">${hex}</text>` +
    `<text x="82" y="63" font-family="${MONO}" font-size="10.5" fill="#71717a">rgb ${r} · ${g} · ${b}</text>` +
    '</svg>'
  )
}

/** Each channel's pure color, the end of its bar's gradient. */
export const CHANNEL_COLORS: Record<keyof Rgb, string> = { r: '#ff2a2a', g: '#22e36b', b: '#3b6bff' }
export const CHANNEL_BAR = { width: 140, height: 12 }

/** One channel as a bar: black to the pure channel color, a white knob at the value. */
export function channelBarSvg(channel: keyof Rgb, value: number) {
  const { width: w, height: h } = CHANNEL_BAR
  const color = CHANNEL_COLORS[channel]
  const v = Math.max(0, Math.min(255, value))
  const x = 3 + (v / 255) * (w - 6)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    '<defs>' +
    `<linearGradient id="ramp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="${color}"/></linearGradient>` +
    '<filter id="knob" x="-200%" y="-50%" width="500%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>' +
    '</defs>' +
    `<rect x="1.5" y="3.5" width="${w - 3}" height="5" rx="2.5" fill="url(#ramp)" stroke="#ffffff" stroke-opacity="0.09"/>` +
    `<rect x="1.5" y="3.5" width="${(x - 1.5).toFixed(1)}" height="5" rx="2.5" fill="${color}" fill-opacity="0.18"/>` +
    `<rect x="${(x - 3).toFixed(1)}" y="0" width="6" height="${h}" rx="3" fill="${color}" opacity="0.7" filter="url(#knob)"/>` +
    `<rect x="${(x - 1.5).toFixed(1)}" y="0.5" width="3" height="${h - 1}" rx="1.5" fill="#ffffff"/>` +
    '</svg>'
  )
}
