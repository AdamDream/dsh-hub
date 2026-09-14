import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('@deepseek-ai/dsh-subagent', () => ({
  appendDelegatedPolicyOverrides: vi.fn(),
  applyChildComposition: vi.fn(),
  childSessionMeta: vi.fn(() => ({ parentSession: 'parent' })),
  resolveChildAgentOptions: vi.fn(() => ({})),
  resolveChildDepth: vi.fn(() => 1),
}))

const vision = vi.hoisted(() => ({
  resolveOptions: vi.fn(),
  resolveApiKey: vi.fn(),
  analyzeImageBytes: vi.fn(),
}))
const admitEncodedImages = vi.hoisted(() => vi.fn())

vi.mock('@deepseek-ai/dsh-vision-adam', () => vision)
vi.mock('@deepseek-ai/dsh-attachment', () => ({ admitEncodedImages }))

import { SideChatService } from '../src/host/side-chat-service.ts'
import { VISION_DEFAULT_QUESTION } from '../src/host/vision.ts'

let parentSequence = 0
function nextParentId(): string {
  parentSequence += 1
  return `parent-${parentSequence}`
}

const TOKEN = '00000000-0000-4000-8000-000000000001'
const REQUEST = '00000000-0000-4000-8000-000000000002'

let home: string | undefined
const previousHome = process.env.DSH_HOME

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'btw-image-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

function seedEvents(): SessionEvent[] {
  return [
    { seq: 0, time: 1, type: 'user/message', data: { id: 'm0', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } } as unknown as SessionEvent,
    { seq: 1, time: 2, type: 'turn/end', data: {} } as unknown as SessionEvent,
  ]
}

function childHandle() {
  const inject = vi.fn()
  const followup = vi.fn()
  const cancel = vi.fn()
  const dispose = vi.fn(async () => {})
  const handle = {
    agent: {
      status: 'idle',
      session: { events: [], header: {} },
      inject, followup, cancel,
    },
    dispose,
  } as unknown as AgentHandle
  return { handle, inject, followup, cancel, dispose }
}

function refFor(index: number, mediaType: string, name?: string) {
  return {
    attachmentId: `att-${index}`,
    mediaType,
    bytes: 4,
    width: 1,
    height: 1,
    ...(name === undefined ? {} : { name }),
  }
}

function hostHarness(create: () => Promise<AgentHandle>) {
  const ctx = new Context()
  const parentId = nextParentId()
  const agents = { get: vi.fn(), create: vi.fn(create), resume: vi.fn(async () => { throw new Error('no persisted session') }) }
  const parent = {
    status: 'idle',
    session: { events: seedEvents() },
    ctx: { agents, tools: { get: vi.fn(() => undefined) } },
  } as unknown as Agent
  agents.get.mockImplementation(id => String(id) === parentId ? parent : undefined)
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  const attachments = {
    readImage: vi.fn(async (ref: { attachmentId: string }) => ({
      ref,
      data: new TextEncoder().encode(`bytes-of-${ref.attachmentId}`),
    })),
  }
  ctx.provide('attachments', attachments as never)
  const settings = {
    get: vi.fn((namespace: string) => namespace === 'vision-adam'
      ? { model: 'deepseek-v4.1-flash', maxTokens: 2000 }
      : undefined),
  }
  ctx.provide('settings', settings as never)
  ctx.provide('subagents', {} as never)
  ctx.provide('sessionQuery', {} as never)
  const service = new SideChatService(ctx)
  return { ctx, service, agents, parentId, attachments, settings }
}

/** Open a side chat whose child handle is already attached (Path A). */
async function opened(contexts: Context[]) {
  const child = Promise.withResolvers<AgentHandle>()
  const env = hostHarness(() => child.promise)
  contexts.push(env.ctx)
  const created = childHandle()
  await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
  child.resolve(created.handle)
  await Promise.resolve()
  await Promise.resolve()
  return { env, created }
}

describe('btw Host image admission (U-D/E/F)', () => {
  const contexts: Context[] = []

  beforeEach(() => {
    vision.resolveOptions.mockReset()
    vision.resolveApiKey.mockReset()
    vision.analyzeImageBytes.mockReset()
    admitEncodedImages.mockReset()
    vision.resolveOptions.mockReturnValue({ baseURL: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4.1-flash' })
    vision.resolveApiKey.mockResolvedValue('vision-key')
    vision.analyzeImageBytes.mockResolvedValue('绿色背景，左上角红色方块，白色文字 V4F-73。')
    admitEncodedImages.mockImplementation(
      async (_attachments: unknown, images: { mediaType: string, name?: string }[]) => (
        images.map((image, index) => refFor(index, image.mediaType, image.name))
      ),
    )
  })

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  })

  it('admits images, analyzes them, and follows up with the R1-9 text template', async () => {
    const { env, created } = await opened(contexts)

    const result = await env.service.send({
      chatToken: TOKEN, requestId: REQUEST, text: 'Look at this',
      images: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'clip.png' }],
    })

    expect(result).toMatchObject({ ok: true })
    expect(admitEncodedImages).toHaveBeenCalledTimes(1)
    expect(env.settings.get).toHaveBeenCalledWith('vision-adam')
    expect(vision.resolveOptions).toHaveBeenCalledWith({ model: 'deepseek-v4.1-flash', maxTokens: 2000 })
    expect(vision.resolveApiKey).toHaveBeenCalledTimes(1)
    expect(env.attachments.readImage).toHaveBeenCalledTimes(1)
    expect(vision.analyzeImageBytes).toHaveBeenCalledTimes(1)
    // The analyzed payload is the canonical base64 of the *verified stored
    // bytes* (readImage → base64), not the raw wire payload (U-D step 3).
    expect(vision.analyzeImageBytes).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://opencode.ai/zen/go/v1' }),
      'vision-key',
      'image/png',
      'Ynl0ZXMtb2YtYXR0LTA=',
      VISION_DEFAULT_QUESTION,
      expect.any(AbortSignal),
    )
    expect(created.followup).toHaveBeenCalledTimes(1)
    const followupMessage = created.followup.mock.calls[0]![0] as { content: readonly { type: 'text', text: string }[] }
    const template = followupMessage.content[0]!.text
    expect(template).toContain('用户附带了 1 张图片')
    expect(template).toContain('[图片 1] 绿色背景，左上角红色方块，白色文字 V4F-73。')
    expect(template).toContain('用户原文：\nLook at this')
    // The child only ever receives text (R1-2): no image content blocks.
    expect(followupMessage.content.every(block => block.type === 'text')).toBe(true)
  })

  it('never sends when vision-adam analysis fails and leaves the request retryable', async () => {
    const { env, created } = await opened(contexts)
    vision.analyzeImageBytes.mockRejectedValueOnce(new Error('network timeout'))

    const failed = await env.service.send({
      chatToken: TOKEN, requestId: REQUEST, text: 'Retry me',
      images: [{ type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' }],
    })

    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.error.code).toBe('internal')
      expect(failed.error.message).toContain('vision-adam 分析失败')
      expect(failed.error.message).toContain('network timeout')
    }
    expect(created.followup).not.toHaveBeenCalled()
    // No trace of the failed message in the transcript.
    const afterFailure = env.service.read({ chatToken: TOKEN })
    expect(afterFailure.ok).toBe(true)
    if (afterFailure.ok) expect(afterFailure.value.messages).toHaveLength(0)

    // Retry re-runs the whole analysis and succeeds (R1-8).
    const retried = await env.service.send({
      chatToken: TOKEN, requestId: REQUEST, text: 'Retry me',
      images: [{ type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' }],
    })
    expect(retried.ok).toBe(true)
    expect(created.followup).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty message with no images as invalid-input', async () => {
    const { env } = await opened(contexts)

    const result = await env.service.send({ chatToken: TOKEN, requestId: REQUEST, text: '   ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-input')
    expect(env.service.read({ chatToken: TOKEN })).toMatchObject({ ok: true, value: { messages: [] } })
  })

  it('rejects image admission failure without sending', async () => {
    const { env, created } = await opened(contexts)
    admitEncodedImages.mockRejectedValueOnce(new Error('base64 decode failed'))

    const result = await env.service.send({
      chatToken: TOKEN, requestId: REQUEST, text: 'Bad image',
      images: [{ type: 'image', mediaType: 'image/png', data: '!!not-base64!!' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-input')
      expect(result.error.message).toContain('base64 decode failed')
    }
    expect(created.followup).not.toHaveBeenCalled()
    expect(env.service.read({ chatToken: TOKEN })).toMatchObject({ ok: true, value: { messages: [] } })
  })

  it('keeps duplicate image sends idempotent by requestId', async () => {
    const { env, created } = await opened(contexts)

    const first = await env.service.send({
      chatToken: TOKEN, requestId: REQUEST, text: 'Once.',
      images: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }],
    })
    const duplicate = await env.service.send({
      chatToken: TOKEN, requestId: REQUEST, text: 'Once.',
      images: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }],
    })

    expect(duplicate).toEqual(first)
    expect(admitEncodedImages).toHaveBeenCalledTimes(1)
    expect(created.followup).toHaveBeenCalledTimes(1)
  })

  it('surfaces the admitted image refs in the transcript and reads them back', async () => {
    const { env } = await opened(contexts)

    const sent = await env.service.send({
      chatToken: TOKEN, requestId: REQUEST, text: '',
      images: [
        { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'one.png' },
        { type: 'image', mediaType: 'image/webp', data: 'aGVsbG8=' },
      ],
    })
    if (!sent.ok) throw new Error('send failed')

    const transcript = env.service.read({ chatToken: TOKEN })
    expect(transcript.ok).toBe(true)
    if (!transcript.ok) return
    expect(transcript.value.messages).toHaveLength(1)
    expect(transcript.value.messages[0]).toMatchObject({
      role: 'user',
      images: [
        { attachmentId: 'att-0', mediaType: 'image/png', name: 'one.png' },
        { attachmentId: 'att-1', mediaType: 'image/webp' },
      ],
    })

    const image = await env.service.readSideChatImage({ chatToken: TOKEN, attachmentId: 'att-1' })
    expect(image.ok).toBe(true)
    if (image.ok) {
      expect(image.value).toMatchObject({ mediaType: 'image/webp' })
      expect(Buffer.from(image.value.data, 'base64').toString()).toBe('bytes-of-att-1')
    }

    const unknown = await env.service.readSideChatImage({ chatToken: TOKEN, attachmentId: 'nope' })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error.code).toBe('invalid-input')
  })

  it('maps real host message events to transcript image refs (U-E live path)', async () => {
    const { env, created } = await opened(contexts)

    const sent = await env.service.send({
      chatToken: TOKEN, requestId: REQUEST, text: 'Host event',
      images: [{ type: 'image', mediaType: 'image/gif', data: 'aGVsbG8=' }],
    })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    // The child session now carries the real user message event.
    type ChildAgentLike = { session: { events: SessionEvent[] } }
    ;(created.handle.agent as unknown as ChildAgentLike).session.events = [{
      seq: 2, time: 3, type: 'user/message',
      data: { id: sent.value.messageId, content: [{ type: 'text', text: 'Host event' }], source: { kind: 'user' } },
    }] as unknown as SessionEvent[]

    const transcript = env.service.read({ chatToken: TOKEN })
    expect(transcript.ok).toBe(true)
    if (!transcript.ok) return
    // Exactly one message (the pending optimistic entry is absorbed by the
    // real event id), carrying the image refs and the template text.
    expect(transcript.value.messages).toHaveLength(1)
    expect(transcript.value.messages[0]).toMatchObject({
      id: sent.value.messageId,
      text: expect.stringContaining('用户附带了 1 张图片'),
      images: [{ attachmentId: 'att-0', mediaType: 'image/gif' }],
    })
  })

  it('answers not-open for readImage on an unknown chat', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const result = await env.service.readSideChatImage({ chatToken: TOKEN, attachmentId: 'att-0' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not-open')
  })
})
