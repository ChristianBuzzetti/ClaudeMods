// A fake CanvasRenderingContext2D that records what the Boberto engine draws
// and emits SVG. Paths are baked into device space (the current transform is
// applied to every point), arcs and ellipses become cubic Beziers, clips become
// <clipPath>s and gradients become userSpaceOnUse gradients shared through a
// registry, so frames of one animation reuse identical defs.

const TAU = Math.PI * 2

/** Formats a number with at most `digits` decimals, without a leading zero. */
export function makeFormatter(digits) {
  const f = 10 ** digits
  return n => {
    let v = Math.round(n * f) / f
    if (Object.is(v, -0)) v = 0
    let s = String(v)
    if (s.startsWith('0.')) s = s.slice(1)
    else if (s.startsWith('-0.')) s = '-' + s.slice(2)
    return s
  }
}

const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const invert = m => {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det) return [1, 0, 0, 1, 0, 0]
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ]
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** Uniform scale + rotation (+ reflection): lengths scale by one factor. */
const isSimilarity = m => {
  const s1 = m[0] * m[0] + m[1] * m[1]
  const s2 = m[2] * m[2] + m[3] * m[3]
  return Math.abs(s1 - s2) < 1e-6 * Math.max(s1, s2, 1) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * Math.max(s1, 1)
}

const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

// ---------------------------------------------------------------------------
// Colors: hex, rgb(), rgba() and a few keywords become [hex, alpha].

const NAMED = { transparent: ['#000', 0], black: ['#000', 1], white: ['#fff', 1], none: ['#000', 0] }

const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

const shortHex = h => (h.length === 7 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6] ? `#${h[1]}${h[3]}${h[5]}` : h)

export function parseColor(input) {
  if (typeof input !== 'string') return ['#000', 1]
  const s = input.trim().toLowerCase()
  if (NAMED[s]) return NAMED[s]
  if (s[0] === '#') {
    let h = s.slice(1)
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return [shortHex(`#${h.slice(0, 6)}`), alpha]
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    const ch = parts.slice(0, 3).map(p => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)))
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    return [shortHex(`#${hex2(ch[0])}${hex2(ch[1])}${hex2(ch[2])}`), Number.isFinite(a) ? a : 1]
  }
  // hsl() and anything else: SVG understands CSS colors.
  return [s, 1]
}

// ---------------------------------------------------------------------------

class Gradient {
  constructor(kind, args) {
    this.kind = kind
    this.args = args
    this.stops = []
  }
  addColorStop(offset, color) {
    this.stops.push([offset, color])
  }
}

/**
 * Shared defs for one animation: gradients and clip paths keyed by content.
 */
export class DefsRegistry {
  constructor(prefix, fmt) {
    this.prefix = prefix
    this.fmt = fmt
    this.byKey = new Map()
    this.items = []
  }
  add(kind, body) {
    const key = kind + body
    let id = this.byKey.get(key)
    if (!id) {
      id = `${this.prefix}${this.items.length.toString(36)}`
      this.byKey.set(key, id)
      this.items.push({ id, kind, body })
    }
    return id
  }
  toString() {
    return this.items.map(({ id, kind, body }) => body.replace('ID', id)).join('')
  }
}

export class SvgContext {
  /**
   * @param {object} opts
   * @param {DefsRegistry} opts.defs shared defs of the animation
   * @param {(n:number)=>string} opts.fmt number formatter
   * @param {(angle:number)=>number} [opts.rotateHook] lets the build swap one rotation (the wing angle)
   */
  constructor({ defs, fmt, rotateHook, width = 0, height = 0 }) {
    this.defs = defs
    this.fmt = fmt
    this.rotateHook = rotateHook
    this.canvas = { width, height, style: {} }
    this.stats = { shadowsSkipped: 0, compositeSkipped: 0, drawImageSkipped: 0, clearRect: 0, conic: 0, rotateHits: 0 }
    this.elements = []
    this._stack = []
    this._s = {
      m: [1, 0, 0, 1, 0, 0],
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      dash: [],
      dashOffset: 0,
      globalAlpha: 1,
      shadowBlur: 0,
      shadowColor: 'rgba(0,0,0,0)',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      gco: 'source-over',
      clip: null,
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      filter: 'none',
      imageSmoothingEnabled: true,
    }
    this._path = []
    this._cur = null // current point, device space
    this._start = null // subpath start, device space
  }

  // --- state properties -----------------------------------------------------
  get fillStyle() { return this._s.fillStyle }
  set fillStyle(v) { this._s.fillStyle = v }
  get strokeStyle() { return this._s.strokeStyle }
  set strokeStyle(v) { this._s.strokeStyle = v }
  get lineWidth() { return this._s.lineWidth }
  set lineWidth(v) { if (Number.isFinite(v) && v > 0) this._s.lineWidth = v }
  get lineCap() { return this._s.lineCap }
  set lineCap(v) { this._s.lineCap = v }
  get lineJoin() { return this._s.lineJoin }
  set lineJoin(v) { this._s.lineJoin = v }
  get miterLimit() { return this._s.miterLimit }
  set miterLimit(v) { this._s.miterLimit = v }
  get lineDashOffset() { return this._s.dashOffset }
  set lineDashOffset(v) { this._s.dashOffset = v }
  get globalAlpha() { return this._s.globalAlpha }
  set globalAlpha(v) { if (Number.isFinite(v) && v >= 0 && v <= 1) this._s.globalAlpha = v }
  get shadowBlur() { return this._s.shadowBlur }
  set shadowBlur(v) { this._s.shadowBlur = v }
  get shadowColor() { return this._s.shadowColor }
  set shadowColor(v) { this._s.shadowColor = v }
  get shadowOffsetX() { return this._s.shadowOffsetX }
  set shadowOffsetX(v) { this._s.shadowOffsetX = v }
  get shadowOffsetY() { return this._s.shadowOffsetY }
  set shadowOffsetY(v) { this._s.shadowOffsetY = v }
  get globalCompositeOperation() { return this._s.gco }
  set globalCompositeOperation(v) { this._s.gco = v }
  get font() { return this._s.font }
  set font(v) { this._s.font = v }
  get textAlign() { return this._s.textAlign }
  set textAlign(v) { this._s.textAlign = v }
  get textBaseline() { return this._s.textBaseline }
  set textBaseline(v) { this._s.textBaseline = v }
  get filter() { return this._s.filter }
  set filter(v) { this._s.filter = v }
  get imageSmoothingEnabled() { return this._s.imageSmoothingEnabled }
  set imageSmoothingEnabled(v) { this._s.imageSmoothingEnabled = v }

  save() {
    this._stack.push({ ...this._s, m: this._s.m.slice(), dash: this._s.dash.slice() })
  }
  restore() {
    const s = this._stack.pop()
    if (s) this._s = s
  }

  // --- transforms -------------------------------------------------------------
  transform(a, b, c, d, e, f) {
    this._s.m = multiply(this._s.m, [a, b, c, d, e, f])
  }
  setTransform(a, b, c, d, e, f) {
    if (a !== null && typeof a === 'object') {
      const o = a
      this._s.m = [o.a ?? 1, o.b ?? 0, o.c ?? 0, o.d ?? 1, o.e ?? 0, o.f ?? 0]
      return
    }
    if (a === undefined) {
      this._s.m = [1, 0, 0, 1, 0, 0]
      return
    }
    this._s.m = [a, b, c, d, e, f]
  }
  resetTransform() {
    this._s.m = [1, 0, 0, 1, 0, 0]
  }
  getTransform() {
    const [a, b, c, d, e, f] = this._s.m
    return { a, b, c, d, e, f, m11: a, m12: b, m21: c, m22: d, m41: e, m42: f, is2D: true }
  }
  translate(x, y) {
    this.transform(1, 0, 0, 1, x, y)
  }
  scale(x, y) {
    this.transform(x, 0, 0, y, 0, 0)
  }
  rotate(angle) {
    if (this.rotateHook) {
      const swapped = this.rotateHook(angle)
      if (swapped !== angle) this.stats.rotateHits++
      angle = swapped
    }
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    this.transform(c, s, -s, c, 0, 0)
  }

  // --- paths ------------------------------------------------------------------
  beginPath() {
    this._path = []
    this._cur = null
    this._start = null
  }
  _pt(x, y) {
    return apply(this._s.m, x, y)
  }
  moveTo(x, y) {
    const p = this._pt(x, y)
    this._path.push(['M', p])
    this._cur = p
    this._start = p
  }
  _ensure(x, y) {
    if (!this._cur) this.moveTo(x, y)
  }
  lineTo(x, y) {
    if (!this._cur) return this.moveTo(x, y)
    const p = this._pt(x, y)
    this._path.push(['L', p])
    this._cur = p
  }
  quadraticCurveTo(cx, cy, x, y) {
    this._ensure(cx, cy)
    const c = this._pt(cx, cy)
    const p = this._pt(x, y)
    this._path.push(['Q', c, p])
    this._cur = p
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    this._ensure(c1x, c1y)
    const p = this._pt(x, y)
    this._path.push(['C', this._pt(c1x, c1y), this._pt(c2x, c2y), p])
    this._cur = p
  }
  closePath() {
    if (!this._cur) return
    this._path.push(['Z'])
    this._cur = this._start
  }
  /** An elliptical arc in local space, as cubic Beziers. `sweep` is signed. */
  _arcLocal(cx, cy, rx, ry, rot, a0, sweep) {
    const cosR = Math.cos(rot)
    const sinR = Math.sin(rot)
    const at = t => {
      const ex = rx * Math.cos(t)
      const ey = ry * Math.sin(t)
      return [cx + ex * cosR - ey * sinR, cy + ex * sinR + ey * cosR]
    }
    const d = t => {
      const ex = -rx * Math.sin(t)
      const ey = ry * Math.cos(t)
      return [ex * cosR - ey * sinR, ex * sinR + ey * cosR]
    }
    const [sx, sy] = at(a0)
    if (this._cur) this.lineTo(sx, sy)
    else this.moveTo(sx, sy)
    if (sweep === 0) return
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9))
    const step = sweep / n
    const k = (4 / 3) * Math.tan(step / 4)
    let t = a0
    for (let i = 0; i < n; i++) {
      const t2 = t + step
      const p0 = at(t)
      const p3 = at(t2)
      const d0 = d(t)
      const d3 = d(t2)
      this.bezierCurveTo(p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d3[0], p3[1] - k * d3[1], p3[0], p3[1])
      t = t2
    }
  }
  _sweep(a0, a1, ccw) {
    if (!ccw) {
      if (a1 - a0 >= TAU) return TAU
      let s = (a1 - a0) % TAU
      if (s < 0) s += TAU
      return s
    }
    if (a0 - a1 >= TAU) return -TAU
    let s = (a0 - a1) % TAU
    if (s < 0) s += TAU
    return -s
  }
  arc(x, y, r, a0, a1, ccw = false) {
    if (!(r >= 0)) return
    this._arcLocal(x, y, r, r, 0, a0, this._sweep(a0, a1, ccw))
  }
  ellipse(x, y, rx, ry, rot, a0, a1, ccw = false) {
    if (!(rx >= 0 && ry >= 0)) return
    this._arcLocal(x, y, rx, ry, rot, a0, this._sweep(a0, a1, ccw))
  }
  arcTo(x1, y1, x2, y2, r) {
    if (!this._cur) return this.moveTo(x1, y1)
    const [x0, y0] = apply(invert(this._s.m), this._cur[0], this._cur[1])
    const v1x = x0 - x1
    const v1y = y0 - y1
    const v2x = x2 - x1
    const v2y = y2 - y1
    const l1 = Math.hypot(v1x, v1y)
    const l2 = Math.hypot(v2x, v2y)
    const cross = v1x * v2y - v1y * v2x
    if (r === 0 || l1 < 1e-9 || l2 < 1e-9 || Math.abs(cross) < 1e-9) return this.lineTo(x1, y1)
    const u1 = [v1x / l1, v1y / l1]
    const u2 = [v2x / l2, v2y / l2]
    const theta = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    const dist = r / Math.tan(theta / 2)
    const t1 = [x1 + u1[0] * dist, y1 + u1[1] * dist]
    const t2 = [x1 + u2[0] * dist, y1 + u2[1] * dist]
    const bis = [u1[0] + u2[0], u1[1] + u2[1]]
    const bl = Math.hypot(bis[0], bis[1])
    const h = r / Math.sin(theta / 2)
    const c = [x1 + (bis[0] / bl) * h, y1 + (bis[1] / bl) * h]
    const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0])
    const a1 = Math.atan2(t2[1] - c[1], t2[0] - c[0])
    let sweep = a1 - a0
    while (sweep > Math.PI) sweep -= TAU
    while (sweep < -Math.PI) sweep += TAU
    this.lineTo(t1[0], t1[1])
    this._arcLocal(c[0], c[1], r, r, 0, a0, sweep)
  }
  rect(x, y, w, h) {
    this.moveTo(x, y)
    this.lineTo(x + w, y)
    this.lineTo(x + w, y + h)
    this.lineTo(x, y + h)
    this.closePath()
    this.moveTo(x, y)
  }
  roundRect(x, y, w, h, radii = 0) {
    let list = Array.isArray(radii) ? radii : [radii]
    list = list.map(r => (typeof r === 'object' && r !== null ? r.x ?? 0 : r || 0))
    let [tl, tr, br, bl] =
      list.length === 1 ? [list[0], list[0], list[0], list[0]]
      : list.length === 2 ? [list[0], list[1], list[0], list[1]]
      : list.length === 3 ? [list[0], list[1], list[2], list[1]]
      : [list[0], list[1], list[2], list[3]]
    // Scale down radii that do not fit, as the spec does.
    const f = Math.min(1, Math.abs(w) / (tl + tr || 1), Math.abs(w) / (bl + br || 1), Math.abs(h) / (tl + bl || 1), Math.abs(h) / (tr + br || 1))
    tl *= f; tr *= f; br *= f; bl *= f
    this.moveTo(x + tl, y)
    this.lineTo(x + w - tr, y)
    if (tr) this._arcLocal(x + w - tr, y + tr, tr, tr, 0, -Math.PI / 2, Math.PI / 2)
    this.lineTo(x + w, y + h - br)
    if (br) this._arcLocal(x + w - br, y + h - br, br, br, 0, 0, Math.PI / 2)
    this.lineTo(x + bl, y + h)
    if (bl) this._arcLocal(x + bl, y + h - bl, bl, bl, 0, Math.PI / 2, Math.PI / 2)
    this.lineTo(x, y + tl)
    if (tl) this._arcLocal(x + tl, y + tl, tl, tl, 0, Math.PI, Math.PI / 2)
    this.closePath()
    this.moveTo(x, y)
  }

  _d(path = this._path) {
    const f = this.fmt
    let out = ''
    const num = n => {
      const s = f(n)
      // A separator only where the next number would otherwise run on.
      if (out.length && !s.startsWith('-') && /[\d.]$/.test(out)) out += ' '
      out += s
    }
    for (const seg of path) {
      const [op] = seg
      if (op === 'Z') {
        out += 'Z'
        continue
      }
      out += op
      for (const p of seg.slice(1)) {
        num(p[0])
        num(p[1])
      }
    }
    return out
  }

  // --- paint ------------------------------------------------------------------
  createLinearGradient(x0, y0, x1, y1) {
    return new Gradient('linear', [x0, y0, x1, y1])
  }
  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    return new Gradient('radial', [x0, y0, r0, x1, y1, r1])
  }
  // createConicGradient is deliberately absent: the engine falls back to a
  // linear gradient where it is missing.
  createPattern() {
    return null
  }

  _paint(style, alphaMul) {
    const f = this.fmt
    if (style instanceof Gradient) {
      if (style.stops.length === 0) return { paint: 'none', opacity: 0 }
      const m = this._s.m
      const stops = style.stops
        .map(([o, c]) => {
          const [hex, a] = parseColor(c)
          return `<stop offset="${f(Math.max(0, Math.min(1, o)))}" stop-color="${hex}"${a < 1 ? ` stop-opacity="${f(a)}"` : ''}/>`
        })
        .join('')
      let body
      if (style.kind === 'linear') {
        let [x0, y0, x1, y1] = style.args
        let tf = ''
        if (isSimilarity(m)) {
          ;[x0, y0] = apply(m, x0, y0)
          ;[x1, y1] = apply(m, x1, y1)
        } else tf = ` gradientTransform="matrix(${m.map(f).join(' ')})"`
        body = `<linearGradient id="ID" gradientUnits="userSpaceOnUse" x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}"${tf}>${stops}</linearGradient>`
      } else {
        let [x0, y0, r0, x1, y1, r1] = style.args
        let tf = ''
        if (isSimilarity(m)) {
          const k = scaleOf(m)
          ;[x0, y0] = apply(m, x0, y0)
          ;[x1, y1] = apply(m, x1, y1)
          r0 *= k
          r1 *= k
        } else tf = ` gradientTransform="matrix(${m.map(f).join(' ')})"`
        const focus = Math.abs(x0 - x1) > 1e-6 || Math.abs(y0 - y1) > 1e-6 ? ` fx="${f(x0)}" fy="${f(y0)}"` : ''
        const fr = r0 > 1e-6 ? ` fr="${f(r0)}"` : ''
        body = `<radialGradient id="ID" gradientUnits="userSpaceOnUse" cx="${f(x1)}" cy="${f(y1)}" r="${f(r1)}"${focus}${fr}${tf}>${stops}</radialGradient>`
      }
      const id = this.defs.add('g', body)
      return { paint: `url(#${id})`, opacity: alphaMul }
    }
    const [hex, a] = parseColor(String(style))
    return { paint: hex, opacity: a * alphaMul }
  }

  _skipPaint() {
    const s = this._s
    if (s.gco !== 'source-over') {
      this.stats.compositeSkipped++
      return true
    }
    if (s.shadowBlur > 0 && parseColor(s.shadowColor)[1] > 0) this.stats.shadowsSkipped++
    return false
  }

  _emit(d, attrs) {
    if (!d) return
    const clip = this._s.clip
    // A stroke right after a fill of the same path joins that element.
    const last = this.elements[this.elements.length - 1]
    if (attrs.stroke && last && last.d === d && last.clip === clip && !last.attrs.stroke) {
      Object.assign(last.attrs, attrs, { fill: last.attrs.fill })
      if (last.attrs['fill-opacity'] !== undefined) last.attrs['fill-opacity'] = last.fillOpacity
      return
    }
    this.elements.push({ d, clip, attrs, fillOpacity: attrs['fill-opacity'] })
  }

  fill(a, b) {
    if (this._skipPaint()) return
    const rule = typeof a === 'string' ? a : typeof b === 'string' ? b : 'nonzero'
    const { paint, opacity } = this._paint(this._s.fillStyle, this._s.globalAlpha)
    if (opacity <= 0) return
    const attrs = { fill: paint }
    if (opacity < 1) attrs['fill-opacity'] = this.fmt(opacity)
    if (rule === 'evenodd') attrs['fill-rule'] = 'evenodd'
    this._emit(this._d(), attrs)
  }
  stroke() {
    if (this._skipPaint()) return
    const s = this._s
    const { paint, opacity } = this._paint(s.strokeStyle, s.globalAlpha)
    if (opacity <= 0) return
    const k = scaleOf(s.m)
    const attrs = { fill: 'none', stroke: paint, 'stroke-width': this.fmt(s.lineWidth * k) }
    if (opacity < 1) attrs['stroke-opacity'] = this.fmt(opacity)
    if (s.lineCap !== 'butt') attrs['stroke-linecap'] = s.lineCap
    if (s.lineJoin !== 'miter') attrs['stroke-linejoin'] = s.lineJoin
    if (s.dash.length) {
      attrs['stroke-dasharray'] = s.dash.map(v => this.fmt(v * k)).join(' ')
      if (s.dashOffset) attrs['stroke-dashoffset'] = this.fmt(s.dashOffset * k)
    }
    this._emit(this._d(), attrs)
  }
  _rectPath(x, y, w, h) {
    const m = this._s.m
    return [['M', apply(m, x, y)], ['L', apply(m, x + w, y)], ['L', apply(m, x + w, y + h)], ['L', apply(m, x, y + h)], ['Z']]
  }
  fillRect(x, y, w, h) {
    if (this._skipPaint()) return
    const { paint, opacity } = this._paint(this._s.fillStyle, this._s.globalAlpha)
    if (opacity <= 0) return
    const attrs = { fill: paint }
    if (opacity < 1) attrs['fill-opacity'] = this.fmt(opacity)
    this._emit(this._d(this._rectPath(x, y, w, h)), attrs)
  }
  strokeRect(x, y, w, h) {
    const saved = this._path
    this._path = this._rectPath(x, y, w, h)
    this.stroke()
    this._path = saved
  }
  clearRect(x, y, w, h) {
    this.stats.clearRect++
    // Only a clear of the whole canvas is meaningful here: it starts a frame.
    const [x0, y0] = this._pt(x, y)
    const [x1, y1] = this._pt(x + w, y + h)
    if (x0 <= 0 && y0 <= 0 && x1 >= this.canvas.width && y1 >= this.canvas.height) this.elements = []
  }
  clip(a, b) {
    const rule = typeof a === 'string' ? a : typeof b === 'string' ? b : 'nonzero'
    const parent = this._s.clip
    const d = this._d()
    const body = `<clipPath id="ID"${parent ? ` clip-path="url(#${parent})"` : ''}><path d="${d}"${rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`
    this._s.clip = this.defs.add('c', body)
  }
  setLineDash(list) {
    this._s.dash = Array.isArray(list) ? list.filter(Number.isFinite) : []
    if (this._s.dash.length % 2) this._s.dash = this._s.dash.concat(this._s.dash)
  }
  getLineDash() {
    return this._s.dash.slice()
  }
  drawImage() {
    this.stats.drawImageSkipped++
  }
  fillText() {}
  strokeText() {}
  measureText(t) {
    return { width: String(t).length * 5 }
  }
  isPointInPath() {
    return false
  }

  /** The recorded frame, elements grouped by clip. */
  toSvg() {
    let out = ''
    let open = null
    for (const el of this.elements) {
      if (el.clip !== open) {
        if (open) out += '</g>'
        if (el.clip) out += `<g clip-path="url(#${el.clip})">`
        open = el.clip
      }
      const attrs = Object.entries(el.attrs)
        .filter(([k, v]) => !(k === 'fill' && v === '#000'))
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')
      out += `<path d="${el.d}"${attrs ? ' ' + attrs : ''}/>`
    }
    if (open) out += '</g>'
    return out
  }
}
