export type Phase = 'idle' | 'busy'

declare module 'claude-code' {
  interface PluginState {
    'prompt-master': {
      phase: Phase
      isArmed: boolean
      draft: string
      result: string
      error: string
    }
  }
}
