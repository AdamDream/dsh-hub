import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { installModelSelection, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-workspace'

import { BtwRegistry, type BtwIndexExtras } from './btw-registry.ts'
import { analyzeImages, modelAcceptsImage, readBtwSettings, wrapImageDescriptions } from './vision.ts'
import type {
  AnswerSideChatRequest,
  AnswerSideChatResult,
  BtwAnswer,
  BtwModel,
  BtwQuestion,
  CancelSideChatRequest,
  CancelSideChatResult,
  CloseSideChatRequest,
  CloseSideChatResult,
  ListSideChatProjectRequest,
  ListSideChatProjectResult,
  ListSideChatTreeRequest,
  ListSideChatTreeResult,
  ReadSideChatImageRequest,
  ReadSideChatImageResult,
  ReadSideChatRequest,
  ReadSideChatResult,
  SendSideChatRequest,
  SendSideChatResult,
  SetSideChatModelRequest,
  SetSideChatModelResult,
  SideChatError,
  SideChatErrorCode,
  SideChatCurrentAction,
  SideChatImageRef,
  SideChatToolDigest,
  StartSideChatRequest,
  StartSideChatResult,
} from '../shared/remote.ts'
import {
  isSideChatToolAllowed,
  READ_ONLY_DENIAL,
  READ_ONLY_TOOL_CANDIDATES,
} from '../shared/tool-policy.ts'

const SIDE_CHAT_PERSONA = 'You are in a persistent side conversation (btw), separate from the main task. '
  + 'Treat inherited history as reference context only. Do not continue or complete the parent task. '
  + 'Answer only instructions submitted in this side conversation. Use lightweight, read-only exploration. '
  + 'Never modify files, repositories, sessions, processes, remote systems, or external state. Do not delegate to subagents. '
  + 'When you need clarification, confirmation, or a decision from the user before answering, call the btw_ask_user tool '
  + 'with concise questions (stable ids, optional options, recommended option first); the user answers inside the side panel '
  + 'and the answers return to you as the tool result. Prefer asking over guessing when the user\'s request is ambiguous.'

const SIDE_CHAT_BOUNDARY = 'Side conversation boundary. Everything before this message is inherited history from the parent thread and is reference context only, not your current task. Do not continue any earlier plan, edit, command, approval, or tool call. Only direct user messages after this boundary are active instructions. This conversation is read-only.'

/** Marker injected with the digest notice so the digest stays identifiable in the child log. */
const DIGEST_SUMMARY = 'Main conversation progress snapshot'

/**
 * Fallback routable side-conversation models (provider is always `adam`).
 * The routable set and the default are settings-driven (P0-b 热载):
 * `dsh-btw.model.options` / `dsh-btw.model.default` are read on every call
 * (host re-reads the namespace each time, so editing `~/.dsh/settings.yaml`
 * applies without a restart); an absent or malformed section falls back to
 * these constants (= pre-hot-read behavior).
 */
export const BTW_FALLBACK_MODELS = ['deepseek-v4.1-flash', 'glm-5.3', 'deepseek-v4-pro'] as const
const BTW_PROVIDER = 'adam'
export const BTW_FALLBACK_DEFAULT_MODEL = 'deepseek-v4.1-flash'

/**
 * Legacy persisted model ids mapped onto their replacement. Side conversations
 * created before the v4-flash → v4.1-flash switch (2026-09-16) keep their
 * flash-class intent (the persisted id lives in the child session request
 * header and is read on every resume); anything unknown degrades to the
 * default. The wire schemas never carry these ids — every host emission goes
 * through `sanitizeBtwModel` first, so a legacy id can never trip strict
 * client-side validation.
 */
const BTW_LEGACY_MODEL_MAP: Readonly<Record<string, BtwModel>> = {
  'deepseek-v4-flash': 'deepseek-v4.1-flash',
}

/**
 * The routable model list right now: `dsh-btw.model.options` when configured
 * (non-empty array), else the fallback constant list. Read per call → 热载.
 */
function btwRoutableModels(ctx: Context): readonly string[] {
  const options = readBtwSettings(ctx).model?.options
  return Array.isArray(options) && options.length > 0 ? options : BTW_FALLBACK_MODELS
}

/**
 * The default model right now: `dsh-btw.model.default` validated against the
 * current routable set, else the fallback constant. Read per call → 热载.
 */
function btwDefaultModel(ctx: Context): BtwModel {
  return sanitizeBtwModel(readBtwSettings(ctx).model?.default, btwRoutableModels(ctx))
}

/**
 * Normalize one model candidate to a routable value: a legacy persisted id
 * maps onto its replacement first, then the candidate passes when it is in
 * the routable set (`routable` or the fallback constant list), else the
 * default. Never throws — strict wire validation can therefore never be
 * tripped by persisted or configured values.
 */
export function sanitizeBtwModel(model: string | undefined, routable?: readonly string[]): BtwModel {
  if (model === undefined) return BTW_FALLBACK_DEFAULT_MODEL
  const legacy = BTW_LEGACY_MODEL_MAP[model]
  if (legacy !== undefined) return legacy
  const allowed = routable ?? BTW_FALLBACK_MODELS
  if ((allowed as readonly string[]).includes(model)) return model as BtwModel
  return BTW_FALLBACK_DEFAULT_MODEL
}

/**
 * The model a side conversation reports right now: the composed selection
 * (explicit pick / persisted header) sanitized against the current routable
 * set, or the settings-resolved default while the child is still opening.
 * Read per call, so a settings.yaml edit surfaces on the very next read.
 */
function btwCurrentModel(ctx: Context, entry: LiveSideChat): BtwModel {
  const current = entry.modelSelection?.current?.model
  if (current === undefined) return btwDefaultModel(ctx)
  return sanitizeBtwModel(current, btwRoutableModels(ctx))
}

function failure(code: SideChatErrorCode, message: string): StartSideChatResult {
  return { ok: false, error: { code, message } }
}

export function completedTurnSeed(events: readonly SessionEvent[]): SessionEvent[] {
  const lastTurnEnd = events.findLast((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return []
  return events.slice(0, lastTurnEnd.seq + 1)
}

function visibleReadTools(parent: Agent): string[] {
  return READ_ONLY_TOOL_CANDIDATES.filter(name => parent.ctx.tools.get(name, parent) !== undefined)
}

function hiddenSideChatMeta(parent: Agent, depth: number, forkSeq: number) {
  // The durable parent link is deliberately stripped: `origin: 'subagent'`
  // without `parentSession` keeps the child out of both the normal session
  // directory and the subagent directory. The parent↔child mapping lives in
  // the sidecar index (see btw-registry.ts), never in the child header.
  const { parentSession: durableParentLink, ...meta } = childSessionMeta(parent, depth, forkSeq)
  void durableParentLink
  return meta
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function openingFailure(error: unknown): SideChatError {
  const message = errorText(error)
  const code: SideChatErrorCode = message.includes('tool') || message.includes('factory')
    ? 'compatibility'
    : 'internal'
  return { code, message }
}

function contentText(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + ' …'
}

/** Structural faces of the sibling services btw reads for listing (inject-declared). */
interface SubagentsLike {
  listDescendants?(rootSessionId: string, signal?: AbortSignal): Promise<readonly unknown[]>
  /**
   * P0 (route a): materialize a persisted continuable subagent session without
   * delivering any message (no model turn, no work). Provided by the official
   * dsh-subagent runtime patch; absent until the patch is applied.
   */
  materializeContinuableChild?(parent: Agent, childId: SessionId, options: { signal?: AbortSignal }): Promise<Agent>
}
interface SessionQueryLike {
  listSessions?(signal?: AbortSignal): Promise<readonly unknown[]>
}
/** Structural face of one `sessionQuery.listSessions()` record (inject-declared). */
interface SessionRecordLike {
  header?: { id?: unknown; cwd?: unknown; origin?: unknown; parentSession?: unknown }
}
interface AttachmentStoreLike {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}

/** Compare two absolute working directories by their resolved real paths. */
function sameRealpath(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right)
  } catch {
    try {
      return resolve(left) === resolve(right)
    } catch {
      return left === right
    }
  }
}

/** Find one logical-corpus record by session id (structural; inject-declared). */
function findSessionRecord(records: readonly unknown[], sessionId: SessionId): SessionRecordLike | undefined {
  for (const record of records) {
    const candidate = record as SessionRecordLike | undefined
    if (candidate?.header?.id !== undefined && String(candidate.header.id) === String(sessionId)) return candidate
  }
  return undefined
}

/**
 * Best available title for one parent session: the last non-empty
 * `session/title` event, falling back to the cwd basename (audit U-J).
 */
function parentTitleOf(parent: Agent): string | undefined {
  const events = parent.session.events
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    // `session/title` is a runtime event of the session store without a typed
    // slot in the SessionEvent union — read it structurally.
    const candidate = event as { type?: string; data?: { title?: unknown } }
    if (candidate.type !== 'session/title') continue
    const title = candidate.data?.title
    if (typeof title === 'string' && title.trim() !== '') return title.trim()
  }
  const cwd = parent.session.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') {
    return cwd.split(/[\\/]/).filter(segment => segment !== '').at(-1) ?? cwd
  }
  return undefined
}

/** Last non-empty user/assistant text in the child live events (list preview, audit U-J). */
function lastPreviewOf(entry: LiveSideChat): string | undefined {
  const events = entry.handle?.agent.session.events ?? []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'user/message') {
      const source = (event.data as { source?: { kind?: string } }).source
      if (source?.kind !== 'user') continue
      const text = contentText(event.data.content).trim()
      if (text !== '') return truncate(text, 160)
      continue
    }
    if (event.type === 'assistant/message') {
      const text = contentText(event.data.message.content).trim()
      if (text !== '') return truncate(text, 160)
    }
  }
  return undefined
}

/** The transcript image references for one message id (U-E display surface). */
function imageRefsOf(entry: LiveSideChat, messageId: string): readonly ImageAttachmentRef[] | undefined {
  return entry.imageRefsByMessageId.get(messageId)
}

/** Project admitted refs onto the wire transcript shape (no `undefined` keys). */
function refsToImages(refs: readonly ImageAttachmentRef[]): SideChatImageRef[] {
  return refs.map(ref => ({
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    ...(ref.name === undefined ? {} : { name: ref.name }),
  }))
}

/**
 * Summarize what the parent agent is doing right now (U6).
 *
 * Sources, all replacement-safe:
 * - `parent.status` — the live lifecycle mirror.
 * - The raw event-log suffix after the last completed turn. `turn/end`,
 *   `tool/call`, and `assistant/chunk` events are log-only and are never
 *   rewritten by compaction, so reading them from the raw suffix cannot
 *   double-count pruned tool results (the tool-result pruner only appends
 *   replacement `tool/result` events, which this digest never reads).
 * - The last user instruction is read through the session surface when
 *   available, so a compaction-replaced message could never be counted twice
 *   either; the raw suffix is only a fallback for test doubles.
 */
export function buildProgressDigest(parent: Agent): string {
  try {
    return progressDigestLines(parent)
  } catch {
    // The digest is best-effort context: any surprise in the event shapes
    // degrades to a bare status line instead of failing the child opening.
    return `Main conversation progress snapshot (captured when this side chat opened; it may be stale):\n- Main agent status: ${parent.status === 'running' ? 'running' : 'idle'}.`
  }
}

function progressDigestLines(parent: Agent): string {
  const events = parent.session.events
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  const suffix = events.slice(lastTurnEnd === undefined ? 0 : lastTurnEnd.seq + 1)

  let latestUser: string | undefined
  const surface = (parent.session as { surface?: { nodes: readonly number[] } }).surface
  if (surface !== undefined) {
    for (const seq of [...surface.nodes].reverse()) {
      const event = events[seq]
      if (event === undefined || event.type !== 'user/message') continue
      if (event.data.source.kind !== 'user') continue
      const text = contentText(event.data.content).trim()
      if (text !== '') latestUser = text
      break
    }
  }
  if (latestUser === undefined) {
    for (const event of suffix) {
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
      const text = contentText(event.data.content).trim()
      if (text !== '') latestUser = text
    }
  }

  const toolCalls: string[] = []
  for (const event of suffix) {
    if (event.type !== 'tool/call') continue
    let summary = ''
    try {
      const parsed: unknown = JSON.parse(event.data.arguments)
      summary = parsed === null || typeof parsed !== 'object'
        ? truncate(String(parsed), 120)
        : truncate(Object.values(parsed as Record<string, unknown>).map(value => String(value)).join(' ').trim(), 120)
    } catch {
      summary = truncate(event.data.arguments, 120)
    }
    toolCalls.push(summary === '' ? event.data.name : `${event.data.name}(${summary})`)
  }

  const chunkText = new Map<string, string>()
  const finalizedSteps = new Set<string>()
  for (const event of suffix) {
    if (event.type === 'assistant/chunk') {
      const key = `${event.data.turn}:${event.data.step}`
      if (event.data.chunk.type === 'text-delta') {
        chunkText.set(key, (chunkText.get(key) ?? '') + event.data.chunk.text)
      }
      continue
    }
    if (event.type === 'assistant/message') finalizedSteps.add(`${event.data.turn}:${event.data.step}`)
  }
  const partial = [...chunkText.entries()]
    .filter(([key]) => !finalizedSteps.has(key))
    .map(([, text]) => text)
    .join('')

  const running = parent.status === 'running'
  const lines = [
    'Main conversation progress snapshot (captured when this side chat opened; it may be stale):',
    `- Main agent status: ${running ? 'running' : 'idle'}.`,
  ]
  if (latestUser !== undefined) lines.push(`- Latest user instruction: ${truncate(latestUser, 400)}`)
  if (toolCalls.length > 0) {
    lines.push(`- Tool calls in the in-progress turn (latest last): ${toolCalls.slice(-5).map(call => truncate(call, 160)).join('; ')}`)
  }
  if (partial.trim() !== '') lines.push(`- Latest assistant output fragment: ${truncate(partial.trim(), 400)}`)
  if (!running && toolCalls.length === 0 && partial.trim() === '') {
    lines.push('- The main agent has finished its latest turn; no work is in progress.')
  }
  return lines.join('\n')
}

interface LiveSideChat {
  chatToken: string
  readonly parentSessionId: string
  readonly childSessionId: SessionId
  seedLength: number
  readonly resumed: boolean
  readonly abort: AbortController
  readonly sentRequests: Map<string, string>
  readonly pendingByRequest: Map<string, PendingSideChatMessage>
  /**
   * Durable image refs admitted for each sent message, keyed by the message
   * id. Kept out of the child session events (the model only ever sees text),
   * so the transcript can still surface the original images through
   * `sideChat/readImage`.
   */
  readonly imageRefsByMessageId: Map<string, readonly ImageAttachmentRef[]>
  pendingQuestion: PendingBtwQuestion | undefined
  handle?: AgentHandle
  creation?: Promise<AgentHandle>
  openingError?: SideChatError
  closing: boolean
  modelSelection?: ModelSelectionRef
}

interface PendingSideChatMessage {
  readonly requestId: string
  readonly message: ReturnType<typeof createUserMessage>
  /** Admitted image refs carried by this optimistic message (U-E). */
  readonly images?: readonly ImageAttachmentRef[]
  delivered: boolean
  cancelled: boolean
}

interface PendingBtwQuestion {
  readonly questionId: string
  readonly questions: BtwQuestion[]
  resolve: (answers: readonly BtwAnswer[]) => void
  reject: (reason: Error) => void
}

function transcript(entry: LiveSideChat, ctx: Context): Extract<ReadSideChatResult, { ok: true }>['value'] {
  const events = entry.handle?.agent.session.events.slice(entry.seedLength) ?? []
  const messages: Extract<ReadSideChatResult, { ok: true }>['value']['messages'][number][] = []
  const messageIds = new Set<string>()
  const finalized = new Set<string>()
  const chunkText = new Map<string, string>()
  const chunkReasoning = new Map<string, string>()
  // Layer B: flat tool digests. `tool/call` creates a digest (attached to the
  // assistant message that precedes it, matching the official ToolCallTree
  // placement after the requesting text); `tool/result` settles it by callId.
  // Digests whose call never settles stay `running` while the child runs and
  // are degraded to settled rows once the child goes idle.
  const toolOrder: string[] = []
  const toolsByCallId = new Map<string, SideChatToolDigest>()
  // turn/step of each call, kept off the wire digest (strict schema) but used
  // as the current-action fallback when no `step/start` was seen.
  const toolStepByCallId = new Map<string, { turn: number, step: number }>()
  let pendingTools: SideChatToolDigest[] = []
  let lastAssistant: { message: Extract<ReadSideChatResult, { ok: true }>['value']['messages'][number], tools: SideChatToolDigest[] } | undefined
  let latestStep: { turn: number, step: number } | undefined
  let runningTool: string | undefined
  let runningToolDigest: SideChatToolDigest | undefined
  for (const event of events) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      const text = contentText(event.data.content)
      const id = String(event.data.id)
      const refs = imageRefsOf(entry, id)
      if (text !== '' || refs !== undefined) {
        messageIds.add(id)
        messages.push({
          id, role: 'user', text,
          ...(refs === undefined || refs.length === 0 ? {} : { images: refsToImages(refs) }),
        })
      }
      continue
    }
    if (event.type === 'assistant/chunk') {
      const key = `${event.data.turn}:${event.data.step}`
      if (event.data.chunk.type === 'text-delta') {
        chunkText.set(key, (chunkText.get(key) ?? '') + event.data.chunk.text)
      }
      else if (event.data.chunk.type === 'reasoning-delta') {
        chunkReasoning.set(key, (chunkReasoning.get(key) ?? '') + event.data.chunk.text)
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const key = `${event.data.turn}:${event.data.step}`
      finalized.add(key)
      const text = contentText(event.data.message.content)
      if (text !== '') {
        const carried = pendingTools.length > 0 ? pendingTools : undefined
        pendingTools = []
        const message: Extract<ReadSideChatResult, { ok: true }>['value']['messages'][number] = {
          id: String(event.data.message.id), role: 'assistant', text,
          ...(carried === undefined ? {} : { tools: carried }),
        }
        messages.push(message)
        // Keep a live link to the message's tools array so later `tool/call`
        // digests land on this message (official ToolCallTree placement).
        lastAssistant = { message, tools: message.tools ?? [] }
      }
      continue
    }
    if (event.type === 'step/start') {
      latestStep = { turn: event.data.turn, step: event.data.step }
      continue
    }
    if (event.type === 'tool/call') {
      const digest: SideChatToolDigest = {
        callId: String(event.data.callId),
        name: event.data.name,
        args: event.data.arguments,
        running: true,
      }
      toolOrder.push(digest.callId)
      toolsByCallId.set(digest.callId, digest)
      toolStepByCallId.set(digest.callId, { turn: event.data.turn, step: event.data.step })
      if (lastAssistant !== undefined) {
        lastAssistant.tools.push(digest)
        if (lastAssistant.message.tools === undefined) lastAssistant.message.tools = lastAssistant.tools
      }
      else pendingTools.push(digest)
      continue
    }
    if (event.type === 'tool/result') {
      // The call correlation lives on the nested tool-result block
      // (`ToolResultBlock.toolCallId`), not on the message envelope.
      const block = event.data.message.content[0]
      const callId = String(block.toolCallId)
      const digest = toolsByCallId.get(callId)
      if (digest !== undefined) {
        digest.result = contentText(block.content)
        digest.isError = block.isError === true
        delete digest.running
      }
      continue
    }
  }
  const partial = [...chunkText.entries()]
    .filter(([key]) => !finalized.has(key))
    .map(([, text]) => text)
    .join('')
  const reasoning = [...chunkReasoning.entries()]
    .filter(([key]) => !finalized.has(key))
    .map(([, text]) => text)
    .join('')
  for (const [requestId, pending] of entry.pendingByRequest) {
    const id = String(pending.message.id)
    if (messageIds.has(id)) {
      entry.pendingByRequest.delete(requestId)
      continue
    }
    const text = contentText(pending.message.content)
    const refs = pending.images
    if (text !== '' || refs !== undefined) {
      messages.push({
        id, role: 'user', text,
        ...(refs === undefined || refs.length === 0 ? {} : { images: refsToImages(refs) }),
      })
    }
  }
  const queued = [...entry.pendingByRequest.values()]
    .some(pending => !pending.cancelled && !pending.delivered)
  const childRunning = entry.handle?.agent.status === 'running'
  if (!childRunning) {
    // An in-flight digest with no settling result is historical once the child
    // is idle: drop the running flag so the row reads as a plain (stopped) call.
    for (const callId of toolOrder) {
      const digest = toolsByCallId.get(callId)
      if (digest?.running === true) delete digest.running
    }
  } else {
    for (let index = toolOrder.length - 1; index >= 0; index -= 1) {
      const digest = toolsByCallId.get(toolOrder[index]!)
      if (digest?.running === true) {
        runningTool = digest.name
        runningToolDigest = digest
        break
      }
    }
  }
  const lastCall = toolOrder.length === 0 ? undefined : toolStepByCallId.get(toolOrder[toolOrder.length - 1]!)
  const currentAction: SideChatCurrentAction | undefined = childRunning
    ? runningToolDigest !== undefined
      ? {
        kind: 'tool',
        tool: runningTool ?? runningToolDigest.name,
        // Prefer the in-flight call's own turn/step (the tool IS the action);
        // `latestStep` is the fallback for synthetic event orders.
        turn: toolStepByCallId.get(runningToolDigest.callId)?.turn ?? latestStep?.turn ?? 0,
        step: toolStepByCallId.get(runningToolDigest.callId)?.step ?? latestStep?.step ?? 0,
      }
      : {
        kind: 'generating',
        turn: latestStep?.turn ?? lastCall?.turn ?? 0,
        step: latestStep?.step ?? lastCall?.step ?? 0,
      }
    : undefined
  const pendingQuestion = entry.pendingQuestion
  const value = {
    chatToken: entry.chatToken,
    revision: events.at(-1)?.seq ?? entry.seedLength,
    messages, partial, reasoning,
    running: childRunning || queued,
    model: btwCurrentModel(ctx, entry),
    ...(currentAction === undefined ? {} : { currentAction }),
    ...(childRunning && runningTool !== undefined ? { runningTool } : {}),
    ...(pendingQuestion === undefined ? {} : {
      pendingQuestion: { questionId: pendingQuestion.questionId, questions: pendingQuestion.questions },
    }),
  }
  return value
}

export class SideChatService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'attachments', 'settings', 'subagents', 'sessionQuery']

  private readonly byToken = new Map<string, LiveSideChat>()
  private readonly tokenByParent = new Map<string, string>()
  private readonly registry = new BtwRegistry()
  private grillMeText: string | undefined
  private grillMeLoaded = false

  constructor(ctx: Context) {
    super(ctx, 'sideChat')
    ctx.effect(() => () => this.disposeAll(), 'btw: dispose live side conversations')
    ctx.on('agent/disposed', ({ agent }) => {
      const token = [...this.byToken.values()]
        .find(entry => String(entry.childSessionId) === String(agent.id))?.chatToken
      if (token !== undefined) this.forget(token)
    })
  }

  async start(request: StartSideChatRequest): Promise<StartSideChatResult> {
    const duplicate = this.byToken.get(request.chatToken)
    if (duplicate !== undefined && !duplicate.closing) {
      if (duplicate.openingError !== undefined) {
        return failure(duplicate.openingError.code, duplicate.openingError.message)
      }
      if (duplicate.handle !== undefined || duplicate.creation !== undefined) {
        return this.startValue(duplicate)
      }
      if (this.byToken.get(request.chatToken) === duplicate) {
        return failure('already-open', 'This side conversation is still opening.')
      }
    }
    const existingToken = this.tokenByParent.get(request.parentSessionId)
    if (existingToken !== undefined && existingToken !== request.chatToken) {
      const existing = this.byToken.get(existingToken)
      if (existing !== undefined && !existing.closing) {
        if (existing.openingError === undefined
          && (existing.handle !== undefined || existing.creation !== undefined)) {
          this.adoptToken(existing, request.chatToken)
          return this.startValue(existing)
        }
        if (existing.openingError !== undefined) this.forget(existingToken)
      }
      if (this.tokenByParent.get(request.parentSessionId) === existingToken) {
        this.tokenByParent.delete(request.parentSessionId)
      }
    }

    const parentId = SessionId(request.parentSessionId)
    // The parent only has to exist, not be process-live (P0): a cold persisted
    // parent is recovered first — a top-level session through `ctx.agents.resume`
    // (official dsh-api-remotes precedent), a subagent session through the
    // dsh-subagent continuation manager (no model turn, no work).
    let parent = this.ctx.agents.get(parentId)
    if (parent === undefined) {
      const recovered = await this.recoverParent(parentId, new AbortController().signal)
      if (recovered === undefined) return failure('parent-not-found', 'The parent conversation does not exist.')
      if ('error' in recovered) return failure('parent-not-found', recovered.error)
      parent = recovered.parent
    }
    // An empty seed is allowed (U6): a parent whose first turn is still in
    // progress can be opened, with the progress digest carrying the context.
    const seed = completedTurnSeed(parent.session.events)

    const indexed = await this.registry.get(request.parentSessionId)
    if (indexed !== undefined) {
      const resumed = await this.startResumed(request, parent, SessionId(indexed.childSessionId))
      if (resumed !== undefined) return resumed
      // Resume failed (e.g. the persisted log is gone): drop the stale index
      // entry and fall through to a fresh fork below.
      await this.registry.remove(request.parentSessionId).catch(() => undefined)
    }

    const childId = SessionId(randomUUID())
    const entry: LiveSideChat = {
      chatToken: request.chatToken,
      parentSessionId: request.parentSessionId,
      childSessionId: childId,
      seedLength: seed.length,
      resumed: false,
      abort: new AbortController(),
      sentRequests: new Map(),
      pendingByRequest: new Map(),
      imageRefsByMessageId: new Map(),
      pendingQuestion: undefined,
      closing: false,
    }
    this.byToken.set(request.chatToken, entry)
    this.tokenByParent.set(request.parentSessionId, request.chatToken)

    try {
      const childDepth = resolveChildDepth(parent, undefined)
      const allowedTools = visibleReadTools(parent)
      const creation = parent.ctx.agents.create({
        sessionId: childId,
        seed,
        meta: hiddenSideChatMeta(parent, childDepth, seed.length),
        agentOptions: resolveChildAgentOptions(parent, {
          provider: BTW_PROVIDER,
          model: request.model ?? btwDefaultModel(this.ctx),
        }, childDepth),
        signal: entry.abort.signal,
        setup: childCtx => this.composeChild(childCtx, parent, allowedTools, entry),
      })
      entry.creation = creation
      void creation.then(handle => {
        if (entry.closing || this.byToken.get(entry.chatToken) !== entry) return
        entry.handle = handle
        this.injectOpeningNotices(handle, parent)
        void this.registry.set(request.parentSessionId, String(childId), this.indexExtras(parent, entry)).catch(() => undefined)
        this.deliverQueued(entry, handle)
      }).catch((error: unknown) => {
        if (!entry.closing && this.byToken.get(entry.chatToken) === entry) {
          entry.openingError = openingFailure(error)
        }
      })
      return this.startValue(entry)
    } catch (error: unknown) {
      this.forget(entry.chatToken)
      if (entry.abort.signal.aborted || entry.closing) return failure('cancelled', 'Side Chat opening was cancelled.')
      const opening = openingFailure(error)
      return failure(opening.code, opening.message)
    }
  }

  /**
   * Recover the parent Agent for a `start` request when it is not live (P0):
   * a persisted top-level session is cold-resumed through `ctx.agents.resume`
   * (official dsh-api-remotes precedent), a persisted subagent session is
   * materialized through the dsh-subagent continuation manager (no model turn,
   * no work) under its exact live direct parent, recursing up a cold chain.
   * Returns `undefined` when no such session exists in the logical corpus;
   * `{ error }` when the session exists but cannot be recovered; `{ parent }`
   * on success.
   */
  private async recoverParent(
    parentId: SessionId,
    signal: AbortSignal,
    seen: ReadonlySet<string> = new Set(),
  ): Promise<{ parent: Agent } | { error: string } | undefined> {
    const key = String(parentId)
    if (seen.has(key)) return { error: `the parent conversation chain is cyclic at "${key}"` }
    const live = this.ctx.agents.get(parentId)
    if (live !== undefined) return { parent: live }
    const record = await this.corpusRecord(parentId)
    if (record === undefined) {
      // No sessionQuery-backed corpus (or the id is absent from it) — nothing
      // to recover, and a blind ordinary resume must be avoided (it would
      // bypass subagent ownership semantics for a subagent id).
      const query = this.ctx.get('sessionQuery') as SessionQueryLike | undefined
      if (query?.listSessions === undefined) {
        return { error: 'the session corpus is unavailable; the parent conversation cannot be recovered' }
      }
      return undefined
    }
    const header = record.header ?? {}
    if (header.origin === 'subagent') {
      const directParentId = header.parentSession
      if (typeof directParentId !== 'string') {
        return { error: `the subagent conversation "${key}" has no recoverable parent session` }
      }
      const nextSeen = new Set(seen).add(key)
      const directParent = await this.recoverParent(SessionId(directParentId), signal, nextSeen)
      if (directParent === undefined) return undefined
      if ('error' in directParent) return directParent
      const subagents = this.ctx.get('subagents') as SubagentsLike | undefined
      if (subagents?.materializeContinuableChild === undefined) {
        return { error: 'subagent materialization is unavailable; the dsh-subagent materializeContinuableChild runtime patch is not applied' }
      }
      try {
        const agent = await subagents.materializeContinuableChild(directParent.parent, parentId, { signal })
        return { parent: agent }
      } catch (error: unknown) {
        return { error: `the parent conversation could not be recovered: ${errorText(error)}` }
      }
    }
    // Ordinary persisted top-level session — cold resume (dsh-api-remotes precedent).
    try {
      const handle = await this.ctx.agents.resume({ resumeSessionId: parentId, signal })
      return { parent: handle.agent }
    } catch (error: unknown) {
      return { error: `the parent conversation could not be recovered: ${errorText(error)}` }
    }
  }

  /** Find the logical-corpus record for one session id (existence + origin), when queryable. */
  private async corpusRecord(parentId: SessionId): Promise<SessionRecordLike | undefined> {
    const query = this.ctx.get('sessionQuery') as SessionQueryLike | undefined
    if (query?.listSessions === undefined) return undefined
    try {
      return findSessionRecord(await query.listSessions(undefined), parentId)
    } catch {
      return undefined
    }
  }

  /**
   * Resume the indexed child session for this parent (U5). Returns the start
   * result on success, or `undefined` when the caller should fall back to a
   * fresh fork.
   */
  private async startResumed(
    request: StartSideChatRequest,
    parent: Agent,
    childId: SessionId,
  ): Promise<StartSideChatResult | undefined> {
    const entry: LiveSideChat = {
      chatToken: request.chatToken,
      parentSessionId: request.parentSessionId,
      childSessionId: childId,
      seedLength: 0,
      resumed: true,
      abort: new AbortController(),
      sentRequests: new Map(),
      pendingByRequest: new Map(),
      imageRefsByMessageId: new Map(),
      pendingQuestion: undefined,
      closing: false,
    }
    this.byToken.set(request.chatToken, entry)
    this.tokenByParent.set(request.parentSessionId, request.chatToken)
    try {
      const childDepth = resolveChildDepth(parent, undefined)
      const allowedTools = visibleReadTools(parent)
      const creation = parent.ctx.agents.resume({
        resumeSessionId: childId,
        agentOptions: resolveChildAgentOptions(parent, {
          provider: BTW_PROVIDER,
          model: request.model ?? btwDefaultModel(this.ctx),
        }, childDepth),
        signal: entry.abort.signal,
        setup: childCtx => this.composeChild(childCtx, parent, allowedTools, entry),
      })
      entry.creation = creation
      const handle = await creation
      if (entry.closing || this.byToken.get(entry.chatToken) !== entry) {
        await handle.dispose().catch(() => undefined)
        return failure('cancelled', 'Side Chat opening was cancelled.')
      }
      entry.handle = handle
      entry.seedLength = handle.agent.session.header.seedLength ?? 0
      // The persisted log already carries the boundary; only a fresh snapshot
      // of what the parent is doing right now is added on each resume.
      handle.agent.inject(createUserMessage({
        content: [{ type: 'text', text: buildProgressDigest(parent) }],
        source: { kind: 'plugin', plugin: 'dsh-btw', form: 'notice', summary: DIGEST_SUMMARY },
      }))
      this.deliverQueued(entry, handle)
      void this.registry.touch(request.parentSessionId, this.indexExtras(parent, entry)).catch(() => undefined)
      return this.startValue(entry)
    } catch {
      this.forget(entry.chatToken)
      if (entry.abort.signal.aborted || entry.closing) {
        return failure('cancelled', 'Side Chat opening was cancelled.')
      }
      return undefined
    }
  }

  /** The four read-only layers plus the btw_ask_user channel (create and resume). */
  private composeChild(childCtx: Context, parent: Agent, allowedTools: string[], entry: LiveSideChat): void {
    const childAgent = childCtx.agent as Agent
    appendDelegatedPolicyOverrides(childAgent.session, {
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
    })
    applyChildComposition(childCtx, parent, {
      persona: this.persona(),
      toolFilter: { allow: allowedTools },
    })
    entry.modelSelection = this.installBtwModelSelection(childCtx, childAgent)
    childCtx.tools.guard(execution => isSideChatToolAllowed(execution.name) ? undefined : READ_ONLY_DENIAL)
    this.registerAskBackTool(childCtx, entry)
  }

  /**
   * Couple this child's mutable model choice to its request routing.
   * `current` resolves a `setModel` pick first, then the persisted header
   * (resume), then the default; `agent/request` applies it on the next turn.
   */
  private installBtwModelSelection(childCtx: Context, childAgent: Agent): ModelSelectionRef {
    let picked: ModelSelection | undefined
    const ctx = this.ctx
    const selection: ModelSelectionRef = {
      get current(): ModelSelection | undefined {
        if (picked !== undefined) return picked
        const logged = childAgent.session.requestHeader()?.config
        if (logged === undefined) return { provider: BTW_PROVIDER, model: btwDefaultModel(ctx) }
        return { provider: logged.provider, model: sanitizeBtwModel(logged.model, btwRoutableModels(ctx)) }
      },
      set current(next: ModelSelection | undefined) {
        picked = next
      },
      assembled: undefined,
    }
    installModelSelection(childCtx, selection)
    return selection
  }

  private registerAskBackTool(childCtx: Context, entry: LiveSideChat): void {
    childCtx.tools.register(defineTool({
      name: 'btw_ask_user',
      description: 'Ask the user a concise question inside the side panel when you need confirmation, '
        + 'a choice, or missing information before answering. Send one or more questions, each with a '
        + 'stable id that will be echoed in the answer. The tool blocks until the user answers.',
      parameters: {
        questions: {
          type: 'array',
          required: true,
          description: 'Questions to ask the user before continuing.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: { type: 'string', required: true, description: 'Stable id for this question; echoed in the answer.' },
              question: { type: 'string', required: true, description: 'The specific question to ask the user.' },
              header: { type: 'string', description: 'Optional short heading for the question.' },
              options: {
                type: 'array',
                description: 'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)".',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    label: { type: 'string', required: true, description: 'Short user-facing option label.' },
                    description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
                  },
                },
              },
              multi_select: { type: 'boolean', description: 'Whether the user may select more than one option. Defaults to false.' },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answers: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  selected: { type: 'array', required: true, items: { type: 'string' } },
                  custom: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args: unknown, exec: ToolRunContext) {
        const questions = (args as { questions: BtwQuestion[] }).questions
        if (entry.pendingQuestion !== undefined) {
          throw new Error('btw_ask_user: another question is already waiting for the user in this panel. '
            + 'Wait for its answer before asking again.')
        }
        return await new Promise<{ answers: { id: string, selected: string[], custom?: string }[] }>((resolve, reject) => {
          const questionId = randomUUID()
          const settle = () => {
            if (entry.pendingQuestion?.questionId === questionId) entry.pendingQuestion = undefined
            exec.signal.removeEventListener('abort', onAbort)
          }
          const onAbort = () => {
            if (entry.pendingQuestion?.questionId !== questionId) return
            settle()
            reject(new Error('btw_ask_user: the question was cancelled before the user answered.'))
          }
          exec.signal.addEventListener('abort', onAbort, { once: true })
          entry.pendingQuestion = {
            questionId,
            questions,
            resolve: answers => {
              settle()
              resolve({
                answers: answers.map((answer): { id: string, selected: string[], custom?: string } =>
                  answer.custom === undefined
                    ? { id: answer.id, selected: [...answer.selected] }
                    : { id: answer.id, selected: [...answer.selected], custom: answer.custom }),
              })
            },
            reject: reason => {
              settle()
              reject(reason)
            },
          }
        })
      },
    }))
  }

  private injectOpeningNotices(handle: AgentHandle, parent: Agent): void {
    handle.agent.inject(createUserMessage({
      content: [{ type: 'text', text: SIDE_CHAT_BOUNDARY }],
      source: { kind: 'plugin', plugin: 'dsh-btw', form: 'notice', summary: 'Side conversation boundary' },
    }))
    handle.agent.inject(createUserMessage({
      content: [{ type: 'text', text: buildProgressDigest(parent) }],
      source: { kind: 'plugin', plugin: 'dsh-btw', form: 'notice', summary: DIGEST_SUMMARY },
    }))
  }

  private deliverQueued(entry: LiveSideChat, handle: AgentHandle): void {
    for (const pending of entry.pendingByRequest.values()) {
      if (pending.cancelled || pending.delivered) continue
      pending.delivered = true
      handle.agent.followup(pending.message)
    }
  }

  /** Persona text with the grill-me interview skill inlined when available (U8). */
  private persona(): string {
    if (!this.grillMeLoaded) {
      this.grillMeLoaded = true
      this.grillMeText = this.loadGrillMeText()
    }
    if (this.grillMeText === undefined) return SIDE_CHAT_PERSONA
    return `${SIDE_CHAT_PERSONA}\n\nWhen the user asks you to "grill me" (relentlessly interview them to sharpen a plan or design), run that interview with btw_ask_user, one numbered round of frontier questions at a time, each with your recommended answer, following this skill text:\n\n<grill-me>\n${this.grillMeText}\n</grill-me>`
  }

  private loadGrillMeText(): string | undefined {
    try {
      // One small synchronous read per process, at first child composition;
      // a missing or unreadable file degrades to the plain persona. The
      // skill's YAML frontmatter (e.g. `disable-model-invocation`, which only
      // governs the skill tool) is stripped so it cannot read as an
      // instruction to ignore the inlined text.
      const path = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'skills', 'grill-me', 'SKILL.md')
      const text = readFileSync(path, 'utf8').replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
      return text === '' ? undefined : text
    } catch {
      return undefined
    }
  }

  read(request: ReadSideChatRequest): ReadSideChatResult {
    const entry = this.byToken.get(request.chatToken)
    if (entry === undefined || entry.closing) {
      return { ok: false, error: { code: 'not-open', message: 'This side conversation is no longer open.' } }
    }
    if (entry.openingError !== undefined) return { ok: false, error: entry.openingError }
    return { ok: true, value: transcript(entry, this.ctx) }
  }

  async send(request: SendSideChatRequest): Promise<SendSideChatResult> {
    const entry = this.byToken.get(request.chatToken)
    if (entry === undefined || entry.closing) {
      return { ok: false, error: { code: 'not-open', message: 'This side conversation is no longer open.' } }
    }
    if (entry.openingError !== undefined) return { ok: false, error: entry.openingError }
    const existing = entry.sentRequests.get(request.requestId)
    if (existing !== undefined) {
      return {
        ok: true,
        value: {
          chatToken: request.chatToken, requestId: request.requestId, accepted: true, messageId: existing,
        },
      }
    }
    const text = request.text.trim()
    const images = request.images ?? []
    if (text.length === 0 && images.length === 0) {
      return { ok: false, error: { code: 'invalid-input', message: 'A side conversation question cannot be empty.' } }
    }

    let effectiveText = text
    let imageRefs: readonly ImageAttachmentRef[] = []
    let directContent: ContentBlock[] | undefined
    if (images.length > 0) {
      // U-D: admit the pasted images through the attachments store first
      // (canonical base64 + batch limits). Admission failure rejects the
      // message without sending or touching the index.
      const attachments = this.ctx.get('attachments') as AttachmentStoreLike | undefined
      if (attachments === undefined) {
        return { ok: false, error: { code: 'internal', message: 'The attachments service is unavailable; images cannot be admitted.' } }
      }
      try {
        const { admitEncodedImages } = await import('@deepseek-ai/dsh-attachment')
        imageRefs = await admitEncodedImages(
          attachments,
          images.map(({ mediaType, data, name }) => ({ mediaType, data, ...(name === undefined ? {} : { name }) })),
        )
      } catch (error: unknown) {
        return { ok: false, error: { code: 'invalid-input', message: errorText(error) } }
      }
      // 能力检测：侧聊当前模型声明支持 image → 原图直传（消息内容携带
      // `image` 内容块，附件轨照常记录，不做 vision-adam 分析、不做 R1-9 包装）；
      // 否则（文本模型或声明不可解析 → 保守）走既有 vision-adam 转文本路径。
      const route = entry.modelSelection?.current
      if (route !== undefined && await modelAcceptsImage(this.ctx, route)) {
        directContent = [
          ...(text.length > 0 ? [{ type: 'text' as const, text }] : []),
          ...imageRefs.map(ref => ({ type: 'image' as const, attachment: ref })),
        ]
      } else {
        // U-D/U-I: synchronously turn every image into text (vision-adam) and
        // wrap it with the R1-9 template. A failed analysis reports an error and
        // never sends; the requestId is left unrecorded so retrying re-runs it.
        // P0-b: `dsh-btw.vision.autoTransform` (default true) — false = do not
        // auto-transform; a text-only model rejects the image send instead.
        const btwVision = readBtwSettings(this.ctx).vision
        if (btwVision?.autoTransform === false) {
          return {
            ok: false,
            error: {
              code: 'invalid-input',
              message: '当前模型不支持图片，且 dsh-btw.vision.autoTransform 已关闭（不自动转文本）。请开启该开关或改用支持图片的模型。',
            },
          }
        }
        try {
          const inputs = await Promise.all(imageRefs.map(async ref => {
            const stored = await attachments.readImage(ref, entry.abort.signal)
            return { mediaType: ref.mediaType, data: Buffer.from(stored.data).toString('base64') }
          }))
          const descriptions = await analyzeImages(this.ctx, inputs, entry.abort.signal)
          effectiveText = wrapImageDescriptions(descriptions, text)
        } catch (error: unknown) {
          return { ok: false, error: { code: 'internal', message: `vision-adam 分析失败: ${errorText(error)}` } }
        }
      }
    }

    const message = createUserMessage({
      content: directContent ?? [{ type: 'text', text: effectiveText }],
      source: { kind: 'user' },
    })
    entry.sentRequests.set(request.requestId, String(message.id))
    if (imageRefs.length > 0) entry.imageRefsByMessageId.set(String(message.id), imageRefs)
    const pending: PendingSideChatMessage = {
      requestId: request.requestId,
      message,
      ...(imageRefs.length === 0 ? {} : { images: imageRefs }),
      delivered: entry.handle !== undefined,
      cancelled: false,
    }
    entry.pendingByRequest.set(request.requestId, pending)
    entry.handle?.agent.followup(message)
    this.touchIndex(entry)
    return {
      ok: true,
      value: {
        chatToken: request.chatToken, requestId: request.requestId, accepted: true, messageId: String(message.id),
      },
    }
  }

  /** Deliver the user's answers to a pending btw_ask_user call (U7). */
  async answer(request: AnswerSideChatRequest): Promise<AnswerSideChatResult> {
    const entry = this.byToken.get(request.chatToken)
    if (entry === undefined || entry.closing) {
      return { ok: false, error: { code: 'not-open', message: 'This side conversation is no longer open.' } }
    }
    const pending = entry.pendingQuestion
    if (pending === undefined || pending.questionId !== request.questionId) {
      return {
        ok: false,
        error: { code: 'invalid-input', message: 'No pending question matches this question id.' },
      }
    }
    pending.resolve(request.answers)
    return { ok: true, value: { chatToken: request.chatToken, questionId: request.questionId, accepted: true } }
  }

  async cancel(request: CancelSideChatRequest): Promise<CancelSideChatResult> {
    const entry = this.byToken.get(request.chatToken)
    if (entry === undefined || entry.closing) {
      return { ok: false, error: { code: 'not-open', message: 'This side conversation is no longer open.' } }
    }
    if (entry.handle === undefined) {
      for (const pending of entry.pendingByRequest.values()) pending.cancelled = true
    } else {
      entry.handle.agent.cancel({ kind: 'user' })
    }
    return { ok: true, value: { chatToken: request.chatToken, accepted: true } }
  }

  async close(request: CloseSideChatRequest): Promise<CloseSideChatResult> {
    const entry = this.byToken.get(request.chatToken)
    if (entry === undefined) {
      return { ok: true, value: { chatToken: request.chatToken, closed: true, cleanup: 'absent' } }
    }
    entry.closing = true
    entry.pendingQuestion?.reject(new Error('btw: the side conversation was closed.'))
    entry.pendingQuestion = undefined
    entry.abort.abort()
    this.forget(entry.chatToken)

    try {
      const handle = entry.handle ?? await entry.creation?.catch(() => undefined)
      if (handle !== undefined) await handle.dispose()
      // No archiveSession (U5): disposing only detaches the live runtime
      // state; the persisted child log stays on disk, still hidden (its
      // durable header has origin 'subagent' and no parent link), so a later
      // open resumes it through the btw index.
      return { ok: true, value: { chatToken: request.chatToken, closed: true, cleanup: 'kept' } }
    } catch (error: unknown) {
      return { ok: false, error: { code: 'internal', message: errorText(error) } }
    }
  }

  /** Switch the side conversation's model for subsequent turns (takes effect on the next step). */
  async setModel(request: SetSideChatModelRequest): Promise<SetSideChatModelResult> {
    const entry = this.byToken.get(request.chatToken)
    if (entry === undefined || entry.closing) {
      return { ok: false, error: { code: 'not-open', message: 'This side conversation is no longer open.' } }
    }
    if (entry.openingError !== undefined) return { ok: false, error: entry.openingError }
    if (entry.modelSelection === undefined) {
      return { ok: false, error: { code: 'not-open', message: 'This side conversation is still opening.' } }
    }
    // The requested model is wire-validated; normalize it against the current
    // routable set too (settings `model.options`), so a pick that is no longer
    // routable degrades to the default instead of routing off-list.
    entry.modelSelection.current = {
      provider: BTW_PROVIDER,
      model: sanitizeBtwModel(request.model, btwRoutableModels(this.ctx)),
    }
    return { ok: true, value: { chatToken: request.chatToken, accepted: true } }
  }

  /**
   * U-F: read the verified bytes behind one admitted image back to the client
   * for display (R1-10 thumbnails). The child session log only carries text,
   * so `sessions.readAttachment` cannot serve these refs — they live in
   * `imageRefsByMessageId` on the live entry.
   */
  async readSideChatImage(request: ReadSideChatImageRequest): Promise<ReadSideChatImageResult> {
    const entry = this.byToken.get(request.chatToken)
    if (entry === undefined || entry.closing) {
      return { ok: false, error: { code: 'not-open', message: 'This side conversation is no longer open.' } }
    }
    if (entry.openingError !== undefined) return { ok: false, error: entry.openingError }
    let ref: ImageAttachmentRef | undefined
    for (const refs of entry.imageRefsByMessageId.values()) {
      const match = refs.find(candidate => String(candidate.attachmentId) === request.attachmentId)
      if (match !== undefined) {
        ref = match
        break
      }
    }
    if (ref === undefined) {
      return { ok: false, error: { code: 'invalid-input', message: 'Unknown attachment id for this side conversation.' } }
    }
    const attachments = this.ctx.get('attachments') as AttachmentStoreLike | undefined
    if (attachments === undefined) {
      return { ok: false, error: { code: 'internal', message: 'The attachments service is unavailable.' } }
    }
    try {
      const stored = await attachments.readImage(ref, entry.abort.signal)
      return { ok: true, value: { mediaType: ref.mediaType, data: Buffer.from(stored.data).toString('base64') } }
    } catch (error: unknown) {
      return { ok: false, error: { code: 'internal', message: errorText(error) } }
    }
  }

  /**
   * U-J: enumerate every side conversation under one session tree — the root
   * itself plus all session-backed subagents below it (`subagents.listDescendants`),
   * joined with the durable btw index and, when live, fresh session metadata.
   */
  async listTree(request: ListSideChatTreeRequest): Promise<ListSideChatTreeResult> {
    const memberIds = new Set<string>([request.parentSessionId])
    const subagents = this.ctx.get('subagents') as SubagentsLike | undefined
    if (subagents?.listDescendants !== undefined) {
      try {
        const rows = await subagents.listDescendants(request.parentSessionId, undefined)
        for (const row of rows) {
          const candidate = row as { kind?: unknown; id?: unknown }
          if (candidate.kind !== 'child' || typeof candidate.id !== 'string') continue
          memberIds.add(candidate.id)
        }
      } catch {
        // listing services unavailable or the root unknown — degrade to self only
      }
    }
    return { ok: true, value: { entries: await this.listEntries([...memberIds], undefined) } }
  }

  /**
   * U-J: enumerate every side conversation whose parent session lives in the
   * same working directory (project group) — `sessionQuery.listSessions`
   * filtered by resolved realpath, joined with the durable btw index.
   */
  async listProject(request: ListSideChatProjectRequest): Promise<ListSideChatProjectResult> {
    const parent = this.ctx.agents.get(SessionId(request.parentSessionId))
    const rootCwd = parent?.session.header?.cwd
    if (rootCwd === undefined) return { ok: true, value: { entries: [] } }
    const sessionIds: string[] = []
    const query = this.ctx.get('sessionQuery') as SessionQueryLike | undefined
    if (query?.listSessions !== undefined) {
      try {
        const records = await query.listSessions(undefined)
        for (const record of records) {
          const candidate = record as { header?: { id?: unknown; cwd?: unknown } }
          const cwd = candidate.header?.cwd
          if (typeof cwd !== 'string' || !sameRealpath(cwd, rootCwd)) continue
          const id = candidate.header?.id
          if (typeof id === 'string') sessionIds.push(id)
        }
      } catch {
        // query service unavailable — empty project list
      }
    }
    return { ok: true, value: { entries: await this.listEntries(sessionIds, rootCwd) } }
  }

  private startValue(entry: LiveSideChat): StartSideChatResult {
    return {
      ok: true,
      value: {
        parentSessionId: entry.parentSessionId,
        childSessionId: String(entry.childSessionId),
        chatToken: entry.chatToken,
        seedLength: entry.seedLength,
        resumed: entry.resumed,
        model: btwCurrentModel(this.ctx, entry),
      },
    }
  }

  private adoptToken(entry: LiveSideChat, chatToken: string): void {
    if (entry.chatToken === chatToken) return
    this.byToken.delete(entry.chatToken)
    entry.chatToken = chatToken
    this.byToken.set(chatToken, entry)
    this.tokenByParent.set(entry.parentSessionId, chatToken)
  }

  /** Fresh index v2 fields for one parent/child pair (audit U-J). */
  private indexExtras(parent: Agent, entry: LiveSideChat): BtwIndexExtras {
    const extras: BtwIndexExtras = {}
    const title = parentTitleOf(parent)
    if (title !== undefined) extras.parentTitle = title
    const cwd = parent.session.header?.cwd
    if (cwd !== undefined) extras.parentCwd = cwd
    const preview = lastPreviewOf(entry)
    if (preview !== undefined) extras.lastPreview = preview
    return extras
  }

  /** Fire-and-forget index freshness refresh after side-chat activity (send). */
  private touchIndex(entry: LiveSideChat): void {
    const parent = this.ctx.agents.get(SessionId(entry.parentSessionId))
    const extras: BtwIndexExtras = {}
    if (parent !== undefined) {
      const title = parentTitleOf(parent)
      if (title !== undefined) extras.parentTitle = title
      const cwd = parent.session.header?.cwd
      if (cwd !== undefined) extras.parentCwd = cwd
    }
    const preview = lastPreviewOf(entry)
    if (preview !== undefined) extras.lastPreview = preview
    void this.registry.touch(entry.parentSessionId, extras).catch(() => undefined)
  }

  /** Join candidate parent ids with the durable index; live metadata wins. */
  private async listEntries(
    parentIds: readonly string[],
    cwdFilter: string | undefined,
  ): Promise<Extract<ListSideChatTreeResult, { ok: true }>['value']['entries']> {
    const index = await this.registry.load()
    const entries: Extract<ListSideChatTreeResult, { ok: true }>['value']['entries'] = []
    for (const parentId of parentIds) {
      const record = index.entries[parentId]
      if (record === undefined) continue
      const live = this.ctx.agents.get(SessionId(parentId))
      const cwd = live?.session.header?.cwd ?? record.parentCwd
      if (cwdFilter !== undefined && (cwd === undefined || !sameRealpath(cwd, cwdFilter))) continue
      entries.push({
        parentSessionId: parentId,
        childSessionId: record.childSessionId,
        lastActiveAt: record.lastActiveAt,
        ...(record.parentTitle !== undefined ? { title: record.parentTitle } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(record.lastPreview !== undefined ? { preview: record.lastPreview } : {}),
        ...(live?.status === 'running' ? { running: true } : {}),
      })
    }
    entries.sort((left, right) => right.lastActiveAt - left.lastActiveAt)
    return entries
  }

  private forget(chatToken: string): void {
    const entry = this.byToken.get(chatToken)
    if (entry === undefined) return
    this.byToken.delete(chatToken)
    if (this.tokenByParent.get(entry.parentSessionId) === chatToken) {
      this.tokenByParent.delete(entry.parentSessionId)
    }
  }

  private async disposeAll(): Promise<void> {
    const entries = [...this.byToken.values()]
    this.byToken.clear()
    this.tokenByParent.clear()
    await Promise.allSettled(entries.map(async entry => {
      entry.closing = true
      entry.pendingQuestion?.reject(new Error('btw: the host is shutting down.'))
      entry.pendingQuestion = undefined
      entry.abort.abort()
      const handle = entry.handle ?? await entry.creation?.catch(() => undefined)
      await handle?.dispose()
    }))
  }
}
