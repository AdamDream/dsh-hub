/** One pasted image held in the composer's mini attachment rail. */
export interface SideChatDraftImage {
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Canonical base64 payload (already sliced off the `data:…;base64,` prefix). */
  readonly data: string
  readonly name?: string
}

export type SideChatPresentationMode = 'drawer' | 'better-sidebar'

export interface SideChatViewState {
  readonly visible: boolean
  readonly draft: string
  readonly sendError: string | null
  readonly presentation: SideChatPresentationMode
  /** Pasted images pending in the composer rail (R1-1/R1-2). */
  readonly attachments: readonly SideChatDraftImage[]
  /** Whether the drawer's session/project jump list is expanded (R0-3). */
  readonly jumpOpen: boolean
}

const EMPTY_VIEW: SideChatViewState = Object.freeze({
  visible: false,
  draft: '',
  sendError: null,
  presentation: 'drawer',
  attachments: Object.freeze([]) as readonly SideChatDraftImage[],
  jumpOpen: false,
})

export class SideChatViewStore {
  private readonly entries = new Map<string, SideChatViewState>()
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  get(parentSessionId: string): SideChatViewState {
    return this.entries.get(parentSessionId) ?? EMPTY_VIEW
  }

  show(parentSessionId: string, presentation: SideChatPresentationMode): void {
    this.update(parentSessionId, state => ({ ...state, visible: true, presentation }))
  }

  minimize(parentSessionId: string): void {
    this.update(parentSessionId, state => ({ ...state, visible: false }))
  }

  setDraft(parentSessionId: string, draft: string): void {
    this.update(parentSessionId, state => ({ ...state, draft, sendError: null }))
  }

  setSendError(parentSessionId: string, sendError: string | null): void {
    this.update(parentSessionId, state => ({ ...state, sendError }))
  }

  /** Append one pasted image to the composer rail (R1-1). */
  addAttachment(parentSessionId: string, image: SideChatDraftImage): void {
    this.update(parentSessionId, state => ({
      ...state,
      attachments: Object.freeze([...state.attachments, image]),
    }))
  }

  /** Remove one pasted image from the composer rail by index. */
  removeAttachment(parentSessionId: string, index: number): void {
    this.update(parentSessionId, state => {
      if (index < 0 || index >= state.attachments.length) return state
      return { ...state, attachments: Object.freeze(state.attachments.filter((_, i) => i !== index)) }
    })
  }

  /** Clear the composer rail (after a successful send). */
  clearAttachments(parentSessionId: string): void {
    this.update(parentSessionId, state => (
      state.attachments.length === 0 ? state : { ...state, attachments: Object.freeze([]) }
    ))
  }

  /** Toggle the drawer jump list expansion. */
  setJumpOpen(parentSessionId: string, jumpOpen: boolean): void {
    this.update(parentSessionId, state => (state.jumpOpen === jumpOpen ? state : { ...state, jumpOpen }))
  }

  clear(parentSessionId: string): void {
    if (!this.entries.delete(parentSessionId)) return
    this.publish()
  }

  fallbackVisiblePresentation(
    from: SideChatPresentationMode,
    to: SideChatPresentationMode,
  ): void {
    let changed = false
    for (const [parentSessionId, state] of this.entries) {
      if (!state.visible || state.presentation !== from) continue
      this.entries.set(parentSessionId, Object.freeze({ ...state, presentation: to }))
      changed = true
    }
    if (changed) this.publish()
  }

  private update(parentSessionId: string, change: (state: SideChatViewState) => SideChatViewState): void {
    const previous = this.get(parentSessionId)
    const next = Object.freeze(change(previous))
    if (Object.is(previous, next)) return
    this.entries.set(parentSessionId, next)
    this.publish()
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
