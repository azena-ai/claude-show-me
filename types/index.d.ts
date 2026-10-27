/** One prepared page: a PNG for the terminal, a small JPEG for the Claude app, desktop and VS Code. */
export type Page = { png: string; jpg: string; w: number; h: number; name: string }

export type Kind = 'image' | 'pdf' | 'video' | 'web'

/** What one viewer shows (per tool call or /show-me row). */
export type View = {
  kind: Kind
  title: string
  source: string
  pages: Page[]
  total: number
  before?: Page[]
  beforeSource?: string
  note?: string
}

export type Mode = 'after' | 'before' | 'both'

/** Where the person is in a viewer: page and before/after mode. */
export type Position = { page: number; mode: Mode }

declare module 'claude-code' {
  interface PluginState {
    'show-me': {
      views: Shaped<Record<string, View>>
      positions: Shaped<Record<string, Position>>
    }
  }
}
