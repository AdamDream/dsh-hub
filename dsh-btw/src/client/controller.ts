import type { ClientContext, ISessions, SessionBinding, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BtwModel, BtwPendingQuestion, SideChatCurrentAction, SideChatTranscriptMessage, SideChatTreeEntry } from '../shared/remote.ts'
import type { SideChatRemoteNamespace } from './remote.ts'
import type { SideChatDraftImage } from './view-store.ts'

export type SideChatPhase = 'closed' | 'starting' | 'open' | 'error'
export type SideChatCommandResult = { readonly ok: true } | { readonly ok: false; readonly error: string }
export type SideChatListResult = { readonly ok: true; readonly entries: readonly SideChatTreeEntry[] }
  | { readonly ok: false; readonly error: string }
export type SideChatImageResult = { readonly ok: true; readonly mediaType: string; readonly data: string }
  | { readonly ok: false; readonly error: string }

export interface SideChatClientState {
  readonly epoch: number
  readonly phase: SideChatPhase
  readonly parentSessionId?: SessionId
  readonly childSessionId?: SessionId
  readonly chatToken?: string
  readonly seedLength: number
  readonly revision: number
  readonly messages: readonly SideChatTranscriptMessage[]
  readonly partial: string
  readonly reasoning: string
  readonly running: boolean
  readonly runningTool?: string
  /** What the child agent is doing right now (running banner copy). */
  readonly currentAction?: SideChatCurrentAction
  readonly pendingQuestion?: BtwPendingQuestion
  readonly model?: BtwModel
  readonly error?: string
}

type OpeningDisposition = 'visible' | 'parked' | 'closed'
interface OpeningAttempt {
  readonly parentSessionId: SessionId
  readonly chatToken: string
  disposition: OpeningDisposition
}

interface RestoreAttempt {
  readonly parentSessionId: SessionId
  readonly parked: SideChatClientState
  disposition: OpeningDisposition
}

interface OptimisticSend {
  readonly parentSessionId: SessionId
  readonly chatToken: string
  readonly requestId: string
  readonly localMessageId: string
  readonly text: string
  /** Pasted images carried to the host with this send (U-A/U-D). */
  readonly images?: readonly SideChatDraftImage[]
  messageId?: string
  admission?: Promise<SideChatCommandResult>
}

const NOT_OPEN_MESSAGE = 'This side conversation is no longer open on the host (it may have restarted). Its saved history is kept — press Try again to resume it.'

const EMPTY_TRANSCRIPT = Object.freeze({
  seedLength: 0,
  revision: 0,
  messages: Object.freeze([]) as readonly SideChatTranscriptMessage[],
  partial: '',
  reasoning: '',
  running: false,
})

function remoteFailure(error: { code: string; message?: string }): string {
  return error.message === undefined ? error.code : error.message
}

function keyOf(sessionId: SessionId): string {
  return String(sessionId)
}

export class SideChatController {
  private epoch = 0
  private state: SideChatClientState = Object.freeze({ epoch: 0, phase: 'closed', ...EMPTY_TRANSCRIPT })
  private readonly listeners = new Set<() => void>()
  private readonly parkedByParent = new Map<string, SideChatClientState>()
  private readonly openingByParent = new Map<string, OpeningAttempt>()
  private readonly openingByToken = new Map<string, OpeningAttempt>()
  private readonly restoringByParent = new Map<string, RestoreAttempt>()
  private readonly optimisticByToken = new Map<string, OptimisticSend>()
  /** In-memory list caches, invalidated whenever the sessions list changes (U-K). */
  private readonly treeByParent = new Map<string, readonly SideChatTreeEntry[]>()
  private readonly projectByParent = new Map<string, readonly SideChatTreeEntry[]>()
  private closing: Promise<void> | undefined
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private readonly disposeList: () => void
  private readonly sessions: ISessions

  constructor(
    ctx: ClientContext,
    private readonly remote: SideChatRemoteNamespace,
  ) {
    this.sessions = ctx.get('sessions') as unknown as ISessions
    this.disposeList = this.sessions.list.subscribe(() => { this.handleSessionChange() })
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): SideChatClientState => this.state

  currentSessionId(): SessionId | undefined {
    return this.sessions.list.getSnapshot().current
  }

  binding(sessionId: SessionId | undefined): SessionBinding | undefined {
    return sessionId === undefined ? undefined : this.sessions.binding(sessionId)
  }

  hasConversation(sessionId: SessionId | undefined): boolean {
    if (sessionId === undefined) return false
    const key = keyOf(sessionId)
    if (this.state.phase !== 'closed' && this.state.parentSessionId !== undefined
      && keyOf(this.state.parentSessionId) === key) return true
    if (this.parkedByParent.has(key)) return true
    return this.openingByParent.has(key)
  }

  async open(parentSessionId: SessionId): Promise<void> {
    if (this.state.phase !== 'closed') {
      if (this.state.parentSessionId !== undefined
        && keyOf(this.state.parentSessionId) === keyOf(parentSessionId)) return
      this.parkVisible()
    }
    if (this.restoreExisting(parentSessionId)) return
    if (this.closing !== undefined) await this.closing

    const chatToken = crypto.randomUUID()
    const attempt: OpeningAttempt = { parentSessionId, chatToken, disposition: 'visible' }
    this.openingByParent.set(keyOf(parentSessionId), attempt)
    this.openingByToken.set(chatToken, attempt)
    this.publish(this.startingState(attempt))

    try {
      const result = await this.remote.start({ parentSessionId: String(parentSessionId), chatToken })
      if (!result.ok) throw new Error(remoteFailure(result.error))
      if (!result.value.ok) throw new Error(result.value.error.message)
      const value = result.value.value
      const optimistic = this.optimisticByToken.get(value.chatToken)
      const openState: SideChatClientState = {
        epoch: this.nextEpoch(),
        phase: 'open',
        parentSessionId,
        childSessionId: value.childSessionId as SessionId,
        chatToken: value.chatToken,
        seedLength: value.seedLength,
        revision: value.seedLength,
        ...(value.model === undefined ? {} : { model: value.model }),
        messages: optimistic === undefined ? [] : [this.optimisticMessage(optimistic)],
        partial: '',
        reasoning: '',
        running: optimistic !== undefined,
      }
      if (attempt.disposition === 'closed') {
        void this.remote.close({ chatToken: value.chatToken })
        return
      }
      const current = this.currentSessionId()
      if (attempt.disposition === 'parked'
        || (current !== undefined && keyOf(current) !== keyOf(parentSessionId))) {
        this.parkedByParent.set(keyOf(parentSessionId), openState)
        if (optimistic !== undefined) void this.admitOptimistic(optimistic, true)
        return
      }
      this.publish(openState)
      if (optimistic !== undefined) void this.admitOptimistic(optimistic, true)
      void this.poll(openState.epoch)
    } catch (error: unknown) {
      if (attempt.disposition === 'closed') return
      const optimistic = this.optimisticByToken.get(chatToken)
      const errorState: SideChatClientState = {
        epoch: this.nextEpoch(),
        phase: 'error',
        parentSessionId,
        chatToken,
        ...EMPTY_TRANSCRIPT,
        messages: optimistic === undefined ? [] : [this.optimisticMessage(optimistic)],
        error: error instanceof Error ? error.message : String(error),
      }
      if (attempt.disposition === 'parked') this.parkedByParent.set(keyOf(parentSessionId), errorState)
      else this.publish(errorState)
    } finally {
      if (this.openingByParent.get(keyOf(parentSessionId)) === attempt) {
        this.openingByParent.delete(keyOf(parentSessionId))
      }
      if (this.openingByToken.get(chatToken) === attempt) this.openingByToken.delete(chatToken)
    }
  }

  async send(text: string, attachments?: readonly SideChatDraftImage[]): Promise<SideChatCommandResult> {
    const snapshot = this.state
    const token = snapshot.chatToken
    const parentSessionId = snapshot.parentSessionId
    if ((snapshot.phase !== 'starting' && snapshot.phase !== 'open')
      || token === undefined || parentSessionId === undefined || snapshot.running) {
      return { ok: false, error: 'This side conversation is no longer open.' }
    }
    if (text.trim() === '' && (attachments === undefined || attachments.length === 0)) {
      return { ok: false, error: 'This side conversation question cannot be empty.' }
    }
    const requestId = crypto.randomUUID()
    const optimistic: OptimisticSend = {
      parentSessionId,
      chatToken: token,
      requestId,
      localMessageId: `optimistic:${requestId}`,
      text: text.trim(),
      ...(attachments === undefined || attachments.length === 0 ? {} : { images: attachments }),
    }
    this.optimisticByToken.set(token, optimistic)
    this.publish({
      ...snapshot,
      messages: [...snapshot.messages, this.optimisticMessage(optimistic)],
      running: true,
    })
    if (snapshot.phase === 'starting') return { ok: true }
    return this.admitOptimistic(optimistic, false)
  }

  /** Answer the pending btw_ask_user question shown in the panel (U7). */
  async answer(answers: readonly { id: string; selected: string[]; custom?: string }[]): Promise<SideChatCommandResult> {
    const snapshot = this.state
    const token = snapshot.chatToken
    const pendingQuestion = snapshot.pendingQuestion
    if (snapshot.phase !== 'open' || token === undefined || pendingQuestion === undefined) {
      return { ok: false, error: 'No pending question to answer.' }
    }
    try {
      const result = await this.remote.answer({
        chatToken: token,
        questionId: pendingQuestion.questionId,
        answers: answers.map(answer => ({
          id: answer.id,
          selected: answer.selected,
          ...answer.custom === undefined ? {} : { custom: answer.custom },
        })),
      })
      if (!result.ok) return { ok: false, error: remoteFailure(result.error) }
      if (!result.value.ok) return { ok: false, error: result.value.error.message }
      this.updateTokenState(token, state => {
        const { pendingQuestion: cleared, ...rest } = state
        void cleared
        return rest
      })
      return { ok: true }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async cancel(): Promise<SideChatCommandResult> {
    const token = this.state.chatToken
    if (this.state.phase !== 'open' || token === undefined) {
      return { ok: false, error: 'This side conversation is no longer open.' }
    }
    try {
      const result = await this.remote.cancel({ chatToken: token })
      if (!result.ok) return { ok: false, error: remoteFailure(result.error) }
      if (!result.value.ok) return { ok: false, error: result.value.error.message }
      return { ok: true }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Switch the side conversation's model; the host applies it on the next turn. */
  async setModel(model: BtwModel): Promise<SideChatCommandResult> {
    const token = this.state.chatToken
    if (this.state.phase !== 'open' || token === undefined) {
      return { ok: false, error: 'This side conversation is no longer open.' }
    }
    try {
      const result = await this.remote.setModel({ chatToken: token, model })
      if (!result.ok) return { ok: false, error: remoteFailure(result.error) }
      if (!result.value.ok) return { ok: false, error: result.value.error.message }
      this.publish({ ...this.state, model })
      return { ok: true }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async retry(): Promise<void> {
    const parent = this.state.parentSessionId
    if (parent === undefined) return
    const retainedText = this.state.chatToken === undefined
      ? undefined
      : this.optimisticByToken.get(this.state.chatToken)?.text
    const key = keyOf(parent)
    if (this.state.phase === 'error' && this.parkedByParent.has(key)) {
      this.publish(this.closedState())
      this.restoreExisting(parent)
      return
    }
    await this.close()
    await this.open(parent)
    if (retainedText !== undefined && this.state.phase === 'open') {
      await this.send(retainedText)
    }
  }

  async close(): Promise<void> {
    const snapshot = this.state
    const token = snapshot.chatToken
    const parent = snapshot.parentSessionId
    this.stopPolling()
    if (parent !== undefined) {
      const key = keyOf(parent)
      this.parkedByParent.delete(key)
      const restore = this.restoringByParent.get(key)
      if (restore !== undefined) {
        restore.disposition = 'closed'
        this.restoringByParent.delete(key)
      }
    }
    if (token !== undefined) {
      this.optimisticByToken.delete(token)
      const attempt = this.openingByToken.get(token)
      if (attempt !== undefined) attempt.disposition = 'closed'
    }
    this.publish(this.closedState())
    if (token === undefined) return
    const close = this.remote.close({ chatToken: token }).then(result => {
      if (!result.ok) console.warn('[dsh-btw] close transport failed', result.error)
      else if (!result.value.ok) console.warn('[dsh-btw] close failed', result.value.error)
      else if (result.value.value.warning !== undefined) console.warn('[dsh-btw]', result.value.value.warning)
    }).catch(error => { console.warn('[dsh-btw] close failed', error) })
      .finally(() => { if (this.closing === close) this.closing = undefined })
    this.closing = close
    await close
  }

  /**
   * U-K: read the bytes behind one admitted image back for display (R1-10).
   * The refs belong to the host's attachment store and are never in the child
   * session events, so they are served by the `sideChat/readImage` remote.
   */
  async readImage(attachmentId: string): Promise<SideChatImageResult> {
    const token = this.state.chatToken
    if (this.state.phase !== 'open' || token === undefined) {
      return { ok: false, error: 'This side conversation is no longer open.' }
    }
    try {
      const result = await this.remote.readImage({ chatToken: token, attachmentId })
      if (!result.ok) return { ok: false, error: remoteFailure(result.error) }
      if (!result.value.ok) return { ok: false, error: result.value.error.message }
      return { ok: true, mediaType: result.value.value.mediaType, data: result.value.value.data }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** U-K: enumerate side conversations under the current session tree (cached). */
  async listTree(): Promise<SideChatListResult> {
    const parent = this.currentSessionId()
    if (parent === undefined) return { ok: false, error: 'No active session.' }
    const key = keyOf(parent)
    const cached = this.treeByParent.get(key)
    if (cached !== undefined) return { ok: true, entries: cached }
    try {
      const result = await this.remote.listTree({ parentSessionId: String(parent) })
      if (!result.ok) return { ok: false, error: remoteFailure(result.error) }
      if (!result.value.ok) return { ok: false, error: result.value.error.message }
      const entries = Object.freeze(result.value.value.entries)
      this.treeByParent.set(key, entries)
      return { ok: true, entries }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** U-K: enumerate side conversations grouped by the current session's working directory (cached). */
  async listProject(): Promise<SideChatListResult> {
    const parent = this.currentSessionId()
    if (parent === undefined) return { ok: false, error: 'No active session.' }
    const key = keyOf(parent)
    const cached = this.projectByParent.get(key)
    if (cached !== undefined) return { ok: true, entries: cached }
    try {
      const result = await this.remote.listProject({ parentSessionId: String(parent) })
      if (!result.ok) return { ok: false, error: remoteFailure(result.error) }
      if (!result.value.ok) return { ok: false, error: result.value.error.message }
      const entries = Object.freeze(result.value.value.entries)
      this.projectByParent.set(key, entries)
      return { ok: true, entries }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * U-K: jump the main conversation to another parent session and switch this
   * side conversation to it (R0-3). Sequence: open the target main session
   * (parks any visible side chat belonging to another parent), fall back to
   * the subagent catalog address when the target is not in the session list,
   * then open (or restore) the target's side conversation. Idempotent.
   */
  async jumpTo(parentSessionId: SessionId): Promise<SideChatCommandResult> {
    try {
      const list = this.sessions.list.getSnapshot()
      const known = (list.byId as Readonly<Record<string, unknown>>)[keyOf(parentSessionId)] !== undefined
      if (!known) {
        const address = this.subagentAddressOf(parentSessionId)
        if (address !== undefined) {
          this.sessions.openSubagent(address)
        }
      }
      this.sessions.open(parentSessionId)
      await this.open(parentSessionId)
      return { ok: true }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Locate the catalog address of one subagent session, when discoverable.
   *
   * The catalog snapshot's base shape is declared in a deployment-only package
   * (`dsh-client-connection`); this workspace resolves it structurally instead.
   */
  private subagentAddressOf(sessionId: SessionId): { parentSessionId: SessionId, childSessionId: SessionId, mode: 'one-shot' | 'continuable' } | undefined {
    interface CatalogChildLike {
      readonly id: unknown
      readonly kind: unknown
      readonly mode?: unknown
    }
    interface CatalogLike {
      readonly entries?: readonly CatalogChildLike[]
    }
    const catalog = this.sessions.list.getSnapshot().subagentsByParent as unknown as
      Readonly<Record<string, CatalogLike>>
    for (const [parent, snapshot] of Object.entries(catalog)) {
      for (const entry of snapshot?.entries ?? []) {
        if (entry?.id !== sessionId || entry.kind !== 'child') continue
        return {
          parentSessionId: parent as SessionId,
          childSessionId: sessionId,
          mode: entry.mode === 'continuable' ? 'continuable' : 'one-shot',
        }
      }
    }
    return undefined
  }

  private optimisticMessage(optimistic: OptimisticSend): SideChatTranscriptMessage {
    return {
      id: optimistic.messageId ?? optimistic.localMessageId,
      role: 'user',
      text: optimistic.text,
    }
  }

  private mergeOptimisticMessages(
    messages: readonly SideChatTranscriptMessage[],
    optimistic: OptimisticSend,
  ): readonly SideChatTranscriptMessage[] {
    const hostId = optimistic.messageId
    const withoutLocal = messages.filter(message => message.id !== optimistic.localMessageId)
    if (hostId !== undefined && withoutLocal.some(message => message.id === hostId)) return withoutLocal
    return [...withoutLocal, this.optimisticMessage(optimistic)]
  }

  private updateTokenState(
    chatToken: string,
    update: (state: SideChatClientState) => SideChatClientState,
  ): void {
    if (this.state.chatToken === chatToken) {
      this.publish(update(this.state))
      return
    }
    for (const [parentKey, parked] of this.parkedByParent) {
      if (parked.chatToken !== chatToken) continue
      this.parkedByParent.set(parentKey, Object.freeze(update(parked)))
      return
    }
  }

  private admitOptimistic(
    optimistic: OptimisticSend,
    retainOnFailure: boolean,
  ): Promise<SideChatCommandResult> {
    if (optimistic.admission !== undefined) return optimistic.admission
    const admission = (async (): Promise<SideChatCommandResult> => {
      let error: string | undefined
      try {
        const result = await this.remote.send({
          chatToken: optimistic.chatToken,
          requestId: optimistic.requestId,
          text: optimistic.text,
          ...(optimistic.images === undefined || optimistic.images.length === 0
            ? {}
            : {
              images: optimistic.images.map(({ mediaType, data, name }) => ({
                type: 'image' as const, mediaType, data,
                ...(name === undefined ? {} : { name }),
              })),
            }),
        })
        if (!result.ok) error = remoteFailure(result.error)
        else if (!result.value.ok) error = result.value.error.message
        else {
          optimistic.messageId = result.value.value.messageId
          this.updateTokenState(optimistic.chatToken, state => ({
            ...state,
            messages: this.mergeOptimisticMessages(state.messages, optimistic),
            running: true,
          }))
          if (this.state.phase === 'open' && this.state.chatToken === optimistic.chatToken) {
            void this.poll(this.state.epoch)
          }
          return { ok: true }
        }
      } catch (caught: unknown) {
        error = caught instanceof Error ? caught.message : String(caught)
      }

      if (this.optimisticByToken.get(optimistic.chatToken) === optimistic) {
        if (retainOnFailure) {
          this.updateTokenState(optimistic.chatToken, state => ({
            ...state,
            phase: 'error',
            messages: this.mergeOptimisticMessages(state.messages, optimistic),
            running: false,
            error,
          }))
        } else {
          this.optimisticByToken.delete(optimistic.chatToken)
          this.updateTokenState(optimistic.chatToken, state => ({
            ...state,
            messages: state.messages.filter(message => (
              message.id !== optimistic.localMessageId && message.id !== optimistic.messageId
            )),
            running: false,
          }))
        }
      }
      return { ok: false, error: error ?? 'The side conversation could not accept this message.' }
    })()
    optimistic.admission = admission
    return admission
  }

  async dispose(): Promise<void> {
    this.disposeList()
    this.stopPolling()
    if (this.state.phase !== 'closed') this.parkVisible()
    this.listeners.clear()
  }

  private handleSessionChange(): void {
    // The list caches describe the tree/project under a parent; any list
    // change may add/remove/retitle sessions, so drop them and re-fetch.
    this.treeByParent.clear()
    this.projectByParent.clear()
    const current = this.currentSessionId()
    if (current === undefined) return
    const parent = this.state.parentSessionId
    if (this.state.phase !== 'closed' && parent !== undefined && keyOf(parent) !== keyOf(current)) {
      this.parkVisible()
    }
    if (this.state.phase === 'closed') this.restoreExisting(current)
  }

  private parkVisible(): void {
    if (this.state.phase === 'closed') return
    this.stopPolling()
    const snapshot = this.state
    if (snapshot.parentSessionId !== undefined) {
      const key = keyOf(snapshot.parentSessionId)
      const restore = this.restoringByParent.get(key)
      if (snapshot.phase === 'starting' && restore !== undefined) {
        restore.disposition = 'parked'
      } else if (snapshot.phase === 'starting' && snapshot.chatToken !== undefined) {
        const attempt = this.openingByToken.get(snapshot.chatToken)
        if (attempt !== undefined) attempt.disposition = 'parked'
      } else if (!(snapshot.phase === 'error' && this.parkedByParent.has(key))) {
        this.parkedByParent.set(key, snapshot)
      }
    }
    this.publish(this.closedState())
  }

  private restoreExisting(parentSessionId: SessionId): boolean {
    const key = keyOf(parentSessionId)
    const restoring = this.restoringByParent.get(key)
    if (restoring !== undefined) {
      restoring.disposition = 'visible'
      this.publish(this.restoringState(restoring))
      return true
    }

    const parked = this.parkedByParent.get(key)
    if (parked !== undefined) {
      this.parkedByParent.delete(key)
      if (parked.phase !== 'open' || parked.chatToken === undefined) {
        this.publish({ ...parked, epoch: this.nextEpoch() })
        return true
      }
      const restore: RestoreAttempt = { parentSessionId, parked, disposition: 'visible' }
      this.restoringByParent.set(key, restore)
      this.publish(this.restoringState(restore))
      void this.confirmRestore(restore)
      return true
    }

    const attempt = this.openingByParent.get(key)
    if (attempt !== undefined) {
      attempt.disposition = 'visible'
      this.publish(this.startingState(attempt))
      return true
    }
    return false
  }

  private async confirmRestore(attempt: RestoreAttempt): Promise<void> {
    const key = keyOf(attempt.parentSessionId)
    const token = attempt.parked.chatToken
    if (token === undefined) return
    try {
      const result = await this.remote.read({ chatToken: token })
      if (!result.ok) throw new Error(remoteFailure(result.error))
      if (!result.value.ok) {
        if (result.value.error.code === 'not-open') {
          if (attempt.disposition === 'visible') {
            this.publish(this.notOpenState(attempt.parentSessionId, token))
          }
          return
        }
        throw new Error(result.value.error.message)
      }

      const value = result.value.value
      const { runningTool: previousRunningTool, error: previousError,
        currentAction: previousCurrentAction, ...base } = attempt.parked
      void previousRunningTool
      void previousError
      void previousCurrentAction
      const restored: SideChatClientState = {
        ...base,
        epoch: this.nextEpoch(),
        phase: 'open',
        revision: value.revision,
        messages: value.messages,
        partial: value.partial,
        reasoning: value.reasoning,
        running: value.running,
        ...(value.runningTool === undefined ? {} : { runningTool: value.runningTool }),
        ...(value.currentAction === undefined ? {} : { currentAction: value.currentAction }),
        ...(value.pendingQuestion === undefined ? {} : { pendingQuestion: value.pendingQuestion }),
        ...(value.model === undefined ? {} : { model: value.model }),
      }
      if (attempt.disposition !== 'visible') {
        if (attempt.disposition === 'parked') this.parkedByParent.set(key, restored)
        return
      }
      this.publish(restored)
      void this.poll(restored.epoch)
    } catch (error: unknown) {
      if (attempt.disposition === 'closed') return
      this.parkedByParent.set(key, attempt.parked)
      if (attempt.disposition === 'visible') {
        this.publish({
          epoch: this.nextEpoch(),
          phase: 'error',
          parentSessionId: attempt.parentSessionId,
          chatToken: token,
          ...EMPTY_TRANSCRIPT,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      if (this.restoringByParent.get(key) === attempt) this.restoringByParent.delete(key)
    }
  }

  private async poll(epoch: number): Promise<void> {
    this.stopPolling()
    const token = this.state.chatToken
    if (this.state.phase !== 'open' || this.state.epoch !== epoch || token === undefined) return
    let delay = 700
    try {
      const result = await this.remote.read({ chatToken: token })
      if (this.state.phase !== 'open' || this.state.epoch !== epoch || this.state.chatToken !== token) return
      if (!result.ok) throw new Error(remoteFailure(result.error))
      if (!result.value.ok) {
        if (result.value.error.code === 'not-open') {
          const parent = this.state.parentSessionId
          if (parent !== undefined) {
            this.parkedByParent.delete(keyOf(parent))
            this.publish(this.notOpenState(parent, token))
          } else {
            this.publish(this.closedState())
          }
          return
        }
        this.publish({
          ...this.state,
          phase: 'error',
          running: false,
          error: result.value.error.message,
        })
        return
      }
      const value = result.value.value
      const optimistic = this.optimisticByToken.get(token)
      const hostHasOptimistic = optimistic?.messageId !== undefined
        && value.messages.some(message => message.id === optimistic.messageId)
      if (optimistic !== undefined && hostHasOptimistic && !value.running) {
        this.optimisticByToken.delete(token)
      }
      const messages = optimistic === undefined || (hostHasOptimistic && !value.running)
        ? value.messages
        : this.mergeOptimisticMessages(value.messages, optimistic)
      const running = value.running || (optimistic !== undefined && !(hostHasOptimistic && !value.running))
      delay = running ? 220 : 700
      const { runningTool: previousRunningTool, pendingQuestion: previousPendingQuestion,
        currentAction: previousCurrentAction, ...baseState } = this.state
      void previousRunningTool
      void previousPendingQuestion
      void previousCurrentAction
      this.publish({
        ...baseState,
        revision: value.revision,
        messages,
        partial: value.partial,
        reasoning: value.reasoning,
        running,
        ...(value.runningTool === undefined ? {} : { runningTool: value.runningTool }),
        ...(value.currentAction === undefined ? {} : { currentAction: value.currentAction }),
        ...(value.pendingQuestion === undefined ? {} : { pendingQuestion: value.pendingQuestion }),
        ...(value.model === undefined ? {} : { model: value.model }),
      })
    } catch (error: unknown) {
      console.warn('[dsh-btw] transcript read failed', error)
      delay = 1_200
    }
    if (this.state.phase === 'open' && this.state.epoch === epoch) {
      this.pollTimer = setTimeout(() => { void this.poll(epoch) }, delay)
    }
  }

  private restoringState(attempt: RestoreAttempt): SideChatClientState {
    return {
      epoch: this.nextEpoch(),
      phase: 'starting',
      parentSessionId: attempt.parentSessionId,
      ...(attempt.parked.chatToken === undefined ? {} : { chatToken: attempt.parked.chatToken }),
      ...EMPTY_TRANSCRIPT,
    }
  }

  private notOpenState(parentSessionId: SessionId, chatToken: string): SideChatClientState {
    return {
      epoch: this.nextEpoch(),
      phase: 'error',
      parentSessionId,
      chatToken,
      ...EMPTY_TRANSCRIPT,
      error: NOT_OPEN_MESSAGE,
    }
  }

  private startingState(attempt: OpeningAttempt): SideChatClientState {
    const optimistic = this.optimisticByToken.get(attempt.chatToken)
    return {
      epoch: this.nextEpoch(),
      phase: 'starting',
      parentSessionId: attempt.parentSessionId,
      chatToken: attempt.chatToken,
      ...EMPTY_TRANSCRIPT,
      messages: optimistic === undefined ? [] : [this.optimisticMessage(optimistic)],
      running: optimistic !== undefined,
    }
  }

  private closedState(): SideChatClientState {
    return { epoch: this.nextEpoch(), phase: 'closed', ...EMPTY_TRANSCRIPT }
  }

  private nextEpoch(): number {
    this.epoch += 1
    return this.epoch
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return
    clearTimeout(this.pollTimer)
    this.pollTimer = undefined
  }

  private publish(next: SideChatClientState): void {
    this.state = Object.freeze(next)
    for (const listener of this.listeners) listener()
  }
}
