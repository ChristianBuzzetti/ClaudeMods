// Types of engine.generated.mjs: the slice of window.BOBERTO this mod calls.

export type BobertoEngine = {
  box(): { W: number; H: number }
  listPoses(): string[]
  listGestures(): { id: string; name: string; icon: string }[]
  listHats(): { id: string; name: string; icon: string }[]
  listSkins(): { id: string; name: string; color: string }[]
  listEyes(): { id: string; name: string }[]
  setSkin(id: string): void
  setEyeColor(hex: string): void
  renderPose(cnv: unknown, pose: string, scale: number, options?: { hat?: string; character?: string }): void
  peana(box: unknown, options?: { cada?: number; hat?: string; character?: string; escalaMax?: number }): boolean
  peanaGesto(box: unknown, id: string): boolean
  peanaPose(box: unknown, pose: string, ms?: number): boolean
  soltarPeana(box: unknown): boolean
}

/** Runs the engine's script body against the given browser globals. */
export function bootEngine(globals: Record<string, unknown>): BobertoEngine
