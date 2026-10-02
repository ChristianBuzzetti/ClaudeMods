// Types of svg-context.mjs: a recording CanvasRenderingContext2D that emits SVG.

export function makeFormatter(digits: number): (n: number) => string

export class DefsRegistry {
  constructor(prefix: string, fmt: (n: number) => string)
  toString(): string
}

export class SvgContext {
  constructor(options: {
    defs: DefsRegistry
    fmt: (n: number) => string
    rotateHook?: (angle: number) => number
    width?: number
    height?: number
  })
  canvas: unknown
  stats: Record<string, number>
  clearRect(x: number, y: number, w: number, h: number): void
  toSvg(): string
}
