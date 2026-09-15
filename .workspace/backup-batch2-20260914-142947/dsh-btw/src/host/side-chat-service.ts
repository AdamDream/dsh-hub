import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-workspace'

import { BtwRegistry } from './btw-registry.ts'
import type {
  AnswerSideChatRequest,
  AnswerSideChatResult,
  BtwAnswer,
  BtwQuestion,
  CancelSideChatRequest,
  CancelSideChatResult,
  CloseSideChatRequest,
  CloseSideChatResult,
  ReadSideChatRequest,
  ReadSideChatResult,
  SendSideChatRequest,
  SendSideChatResult,
  SideChatError,
  SideChatErrorCode,
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
  pendingQuestion: PendingBtwQuestion | undefined
  handle?: AgentHandle
  creation?: Promise<AgentHandle>
  openingError?: SideChatError
  closing: boolean
}

interface PendingSideChatMessage {
  readonly requestId: string
  readonly message: ReturnType<typeof createUserMessage>
  delivered: boolean
  cancelled: boolean
}

interface PendingBtwQuestion {
  readonly questionId: string
  readonly questions: BtwQuestion[]
  resolve: (answers: readonly BtwAnswer[]) => void
  reject: (reason: Error) => void
}

function transcript(entry: LiveSideChat): Extract<ReadSideChatResult, { ok: true }>['value'] {
  const events = entry.handle?.agent.session.events.slice(entry.seedLength) ?? []
  const messages: Extract<ReadSideChatResult, { ok: true }>['value']['messages'][number][] = []
  const messageIds = new Set<string>()
  const finalized = new Set<string>()
  const chunkText = new Map<string, string>()
  const chunkReasoning = new Map<string, string>()
  let runningTool: string | undefined
  for (const event of events) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      const text = contentText(event.data.content)
      if (text !== '') {
        const id = String(event.data.id)
        messageIds.add(id)
        messages.push({ id, role: 'user', text })
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
      if (text !== '') messages.push({ id: String(event.data.message.id), role: 'assistant', text })
      continue
    }
    if (event.type === 'tool/call') runningTool = event.data.name
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
    if (text !== '') messages.push({ id, role: 'user', text })
  }
  const queued = [...entry.pendingByRequest.values()]
    .some(pending => !pending.cancelled && !pending.delivered)
  const childRunning = entry.handle?.agent.status === 'running'
  const pendingQuestion = entry.pendingQuestion
  const value = {
    chatToken: entry.chatToken,
    revision: events.at(-1)?.seq ?? entry.seedLength,
    messages, partial, reasoning,
    running: childRunning || queued,
    ...(childRunning && runningTool !== undefined ? { runningTool } : {}),
    ...(pendingQuestion === undefined ? {} : {
      pendingQuestion: { questionId: pendingQuestion.questionId, questions: pendingQuestion.questions },
    }),
  }
  return value
}

export class SideChatService extends TypertRemoteService {
  static inject = ['agents', 'sessions']

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
    const parent = this.ctx.agents.get(parentId)
    if (parent === undefined) return failure('parent-not-found', 'The parent conversation is not live.')
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
        agentOptions: resolveChildAgentOptions(parent, undefined, childDepth),
        signal: entry.abort.signal,
        setup: childCtx => this.composeChild(childCtx, parent, allowedTools, entry),
      })
      entry.creation = creation
      void creation.then(handle => {
        if (entry.closing || this.byToken.get(entry.chatToken) !== entry) return
        entry.handle = handle
        this.injectOpeningNotices(handle, parent)
        void this.registry.set(request.parentSessionId, String(childId)).catch(() => undefined)
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
        agentOptions: resolveChildAgentOptions(parent, undefined, childDepth),
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
      void this.registry.touch(request.parentSessionId).catch(() => undefined)
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
    appendDelegatedPolicyOverrides((childCtx.agent as Agent).session, {
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
    })
    applyChildComposition(childCtx, parent, {
      persona: this.persona(),
      toolFilter: { allow: allowedTools },
    })
    childCtx.tools.guard(execution => isSideChatToolAllowed(execution.name) ? undefined : READ_ONLY_DENIAL)
    this.registerAskBackTool(childCtx, entry)
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
    return { ok: true, value: transcript(entry) }
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
    if (text.length === 0) {
      return { ok: false, error: { code: 'invalid-input', message: 'A side conversation question cannot be empty.' } }
    }
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    entry.sentRequests.set(request.requestId, String(message.id))
    const pending: PendingSideChatMessage = {
      requestId: request.requestId,
      message,
      delivered: entry.handle !== undefined,
      cancelled: false,
    }
    entry.pendingByRequest.set(request.requestId, pending)
    entry.handle?.agent.followup(message)
    void this.registry.touch(entry.parentSessionId).catch(() => undefined)
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

  private startValue(entry: LiveSideChat): StartSideChatResult {
    return {
      ok: true,
      value: {
        parentSessionId: entry.parentSessionId,
        childSessionId: String(entry.childSessionId),
        chatToken: entry.chatToken,
        seedLength: entry.seedLength,
        resumed: entry.resumed,
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
