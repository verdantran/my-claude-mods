export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-wrap-up': { limits: Limit[]; warned: string[] }
  }
}
