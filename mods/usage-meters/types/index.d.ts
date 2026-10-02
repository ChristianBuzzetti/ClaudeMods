export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  limits: Limit[]
  costUsd?: number
}

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Totals = {
  turns: number
  durationMs: number
  /** Every loop: the conversation and its subagents. */
  session: Tokens
  /** The conversation's own loop. */
  main: Tokens
  last: Tokens | null
  model?: string
}

export type AgentRun = {
  id: string
  type: string
  description: string
  model?: string
  turns: number
  durationMs: number
  tokens: Tokens
  isRunning: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meters': {
      snapshot: Snapshot | null
      totals: Totals
      agents: AgentRun[]
      isHidden: boolean
      isPanelOpen: boolean
      now: number
    }
  }
}
