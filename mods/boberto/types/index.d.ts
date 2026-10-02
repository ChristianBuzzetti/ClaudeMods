/** The animations Boberto can be pinned to with `/boberto <name>`. */
export type BobertoAnimationName = 'idle' | 'working' | 'searching' | 'thinking' | 'celebrate' | 'dizzy' | 'sleep' | 'calm'

/** What Boberto wears; every value is one of the engine's own options. */
export type BobertoOutfit = {
  /** An accessory id of the engine's HAT_PRESETS ('limpio' is none). */
  hat: string
  /** 'auto' or a body color id of the engine's SKIN_PRESETS. */
  skin: string
  /** 'auto' or an eye color of the engine's EYE_PRESETS. */
  eye: string
  /** 'none' or the hex color of a halo around him. */
  glow: string
}

/** A phase of the chat, one chip of the status timeline. */
export type BobertoPhase =
  | 'thinking'
  | 'reading'
  | 'searching'
  | 'editing'
  | 'running'
  | 'delegating'
  | 'browsing'
  | 'asking'
  | 'planning'
  | 'tool'
  | 'done'
  | 'error'
  | 'stopped'

/** One chip: a phase, repeated `count` times in a row from `at` to `lastAt` (epoch ms). */
export type BobertoTimelineEntry = {
  phase: BobertoPhase
  /** The tool or subagent type, when the phase names one. */
  detail?: string
  count: number
  at: number
  lastAt: number
  /** True when the last call of the run failed. */
  isError?: boolean
}

/** How a main-loop turn ended, kept so each transcript row draws its own reaction. */
export type BobertoTurnOutcome = {
  turnId: string
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
  /** The turn's duration, the key the terminal's TurnDuration row carries. */
  durationMs: number
  /** The end of the turn's final text, whitespace collapsed: the key an AssistantMessage row carries. */
  tail: string
  /** The top gesture this answer's row plays, picked at random per turn; absent on other endings. */
  gesture?: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    boberto: {
      /** What Boberto is doing now, driven by the session's events. */
      animation: BobertoAnimationName
      /** When `animation` last changed, in epoch milliseconds. */
      since: number
      /** True between a main-loop turn's start and its completion. */
      isTurnRunning: boolean
      /** An animation pinned by `/boberto` for preview; null follows the session. */
      preview: BobertoAnimationName | null
      /** The idle gesture playing now (a GESTOS id), or null. */
      gesture: string | null
      /** What he wears, mirrored from the store. */
      outfit: BobertoOutfit
      /** The chat's recent phases, oldest first, at most 12. */
      timeline: BobertoTimelineEntry[]
      /** How recent main-loop turns ended, oldest first, at most 60. */
      outcomes: BobertoTurnOutcome[]
      /** Whether the pane's wardrobe (the customization controls) is unfolded. */
      isWardrobeOpen: boolean
    }
  }
}
