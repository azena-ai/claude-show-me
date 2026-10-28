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
  /** A PDF whose pages after the first are still being made. */
  pending?: boolean
}

export type Mode = 'after' | 'before' | 'both'

/** Where the person is in a viewer: page, before/after mode, whether the picture is folded away, and the page whose
 *  picture is drawn while a burst of page turns is still running (absent: `page`). */
export type Position = { page: number; mode: Mode; hidden?: boolean; shown?: number }

/** Checked once when the session starts: whether this session's terminal draws pictures at all, and if not, why. */
export type Screen = { imagesOff?: 'tmux' | 'terminal' }

declare module 'claude-code' {
  interface PluginState {
    'show-me': {
      views: Shaped<Record<string, View>>
      positions: Shaped<Record<string, Position>>
      screen: Shaped<Screen>
      /** Whether a Read row's picture is unfolded in the terminal, per tool_use_id. */
      open: StateFamily<boolean>
    }
  }
}
