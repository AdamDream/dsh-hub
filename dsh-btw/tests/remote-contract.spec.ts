import { describe, expect, it } from 'vitest'
import {
  answerSideChatRequestSchema, answerSideChatResultSchema,
  cancelSideChatRequestSchema, cancelSideChatResultSchema,
  closeSideChatRequestSchema, closeSideChatResultSchema,
  listSideChatProjectRequestSchema, listSideChatProjectResultSchema,
  listSideChatTreeRequestSchema, listSideChatTreeResultSchema,
  readSideChatImageRequestSchema, readSideChatImageResultSchema,
  readSideChatRequestSchema, readSideChatResultSchema,
  sendSideChatRequestSchema, sendSideChatResultSchema,
  sideChatImagePartSchema, sideChatImageRefSchema,
  startSideChatRequestSchema, startSideChatResultSchema,
} from '../src/shared/remote.ts'

const token = '123e4567-e89b-42d3-a456-426614174000'
const questionId = '123e4567-e89b-42d3-a456-426614174009'

describe('btw remote schemas', () => {
  it('accepts a strict start round trip', () => {
    expect(startSideChatRequestSchema.parse({ parentSessionId: 'parent', chatToken: token })).toEqual({ parentSessionId: 'parent', chatToken: token })
    expect(startSideChatResultSchema.parse({ ok: true, value: {
      parentSessionId: 'parent', childSessionId: 'child', chatToken: token, seedLength: 12, resumed: false,
    } }).ok).toBe(true)
  })

  it('rejects malformed or widened payloads', () => {
    expect(() => startSideChatRequestSchema.parse({ parentSessionId: 'parent', chatToken: 'not-a-uuid' })).toThrow()
    expect(() => startSideChatRequestSchema.parse({ parentSessionId: 'parent', chatToken: token, extra: true })).toThrow()
    expect(() => startSideChatResultSchema.parse({ ok: true, value: {
      parentSessionId: 'parent', childSessionId: 'child', chatToken: token, seedLength: 12, resumed: false, expiresAt: 1,
    } })).toThrow()
  })

  it('validates host-projected transcript snapshots with optional pending questions', () => {
    expect(readSideChatRequestSchema.parse({ chatToken: token }).chatToken).toBe(token)
    const result = readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 18, running: true, partial: 'Working', reasoning: 'Thinking',
      messages: [{ id: 'm1', role: 'user', text: 'Why?' }],
      pendingQuestion: {
        questionId,
        questions: [{ id: 'q1', question: 'Which scope?', options: [{ label: 'Repo only' }], multi_select: true }],
      },
    } })
    expect(result.ok && result.value.messages).toHaveLength(1)
    expect(result.ok && result.value.pendingQuestion?.questionId).toBe(questionId)
    expect(() => readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 18, running: true, partial: '', messages: [], expiresAt: 5,
    } })).toThrow()
  })

  it('validates host-owned send, cancel, and answer payloads', () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174001'
    expect(sendSideChatRequestSchema.parse({ chatToken: token, requestId, text: 'Why?' }).text).toBe('Why?')
    expect(sendSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, requestId, accepted: true, messageId: 'message-1',
    } }).ok).toBe(true)
    expect(cancelSideChatRequestSchema.parse({ chatToken: token }).chatToken).toBe(token)
    expect(cancelSideChatResultSchema.parse({ ok: true, value: { chatToken: token, accepted: true } }).ok).toBe(true)
    expect(answerSideChatRequestSchema.parse({
      chatToken: token, questionId,
      answers: [{ id: 'q1', selected: ['Repo only'], custom: 'extra' }],
    })).toEqual({
      chatToken: token, questionId,
      answers: [{ id: 'q1', selected: ['Repo only'], custom: 'extra' }],
    })
    expect(answerSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, questionId, accepted: true,
    } }).ok).toBe(true)
  })

  it('accepts idempotent absent and kept close results', () => {
    expect(closeSideChatRequestSchema.parse({ chatToken: token }).chatToken).toBe(token)
    expect(closeSideChatResultSchema.parse({ ok: true, value: { chatToken: token, closed: true, cleanup: 'absent' } }).ok).toBe(true)
    expect(closeSideChatResultSchema.parse({ ok: true, value: { chatToken: token, closed: true, cleanup: 'kept' } }).ok).toBe(true)
    expect(() => closeSideChatResultSchema.parse({ ok: true, value: { chatToken: token, closed: true, cleanup: 'archived' } })).toThrow()
  })

  it('validates image parts and the send request carrying them', () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174001'
    expect(sideChatImagePartSchema.parse({
      type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'clip.png',
    })).toEqual({ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'clip.png' })
    // A pure-image message may carry an empty text (R1-9 `用户原文` omitted).
    expect(sendSideChatRequestSchema.parse({
      chatToken: token, requestId, text: '', images: [{ type: 'image', mediaType: 'image/webp', data: 'aGVsbG8=' }],
    }).images).toHaveLength(1)
    // Mixed text + images keeps both.
    expect(sendSideChatRequestSchema.parse({
      chatToken: token, requestId, text: 'Look at this',
      images: [{ type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' }],
    }).text).toBe('Look at this')
    // An images-less old payload still passes (backward compatibility).
    expect(sendSideChatRequestSchema.parse({ chatToken: token, requestId, text: 'Why?' }).images).toBeUndefined()
  })

  it('rejects malformed or widened image payloads', () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174001'
    expect(() => sideChatImagePartSchema.parse({ type: 'image', data: 'aGVsbG8=' })).toThrow()
    expect(() => sideChatImagePartSchema.parse({ type: 'image', mediaType: 'image/png' })).toThrow()
    expect(() => sideChatImagePartSchema.parse({ type: 'image', mediaType: 'image/tiff', data: 'aGVsbG8=' })).toThrow()
    expect(() => sideChatImagePartSchema.parse({ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', extra: 1 })).toThrow()
    expect(() => sideChatImagePartSchema.parse({ type: 'text', text: 'nope' })).toThrow()
    expect(() => sendSideChatRequestSchema.parse({
      chatToken: token, requestId, text: 'x', images: [{ type: 'image', mediaType: 'image/png' }],
    })).toThrow()
  })

  it('validates transcript image refs and the readImage round trip', () => {
    expect(sideChatImageRefSchema.parse({
      attachmentId: 'att-1', mediaType: 'image/gif',
    })).toEqual({ attachmentId: 'att-1', mediaType: 'image/gif' })
    expect(sideChatImageRefSchema.parse({
      attachmentId: 'att-1', mediaType: 'image/png', name: 'shot.png',
    }).name).toBe('shot.png')
    const transcript = readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 18, running: false, partial: '', reasoning: '',
      messages: [{ id: 'm1', role: 'user', text: '', images: [{ attachmentId: 'att-1', mediaType: 'image/png' }] }],
    } })
    expect(transcript.ok && transcript.value.messages[0]!.images).toHaveLength(1)
    expect(() => readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 18, running: false, partial: '', reasoning: '',
      messages: [{ id: 'm1', role: 'user', text: '', images: [{ attachmentId: 'att-1', mediaType: 'image/tiff' }] }],
    } })).toThrow()
    expect(readSideChatImageRequestSchema.parse({ chatToken: token, attachmentId: 'att-1' }).attachmentId).toBe('att-1')
    expect(readSideChatImageRequestSchema.parse({ chatToken: token, attachmentId: 'att-1' }).chatToken).toBe(token)
    expect(() => readSideChatImageRequestSchema.parse({ chatToken: 'not-a-uuid', attachmentId: 'att-1' })).toThrow()
    const read = readSideChatImageResultSchema.parse({
      ok: true, value: { mediaType: 'image/png', data: 'aGVsbG8=' },
    })
    expect(read.ok && read.value.data).toBe('aGVsbG8=')
    expect(readSideChatImageResultSchema.parse({
      ok: false, error: { code: 'invalid-input', message: 'Unknown attachment.' },
    }).ok).toBe(false)
  })

  it('validates listTree and listProject payloads with joined entries', () => {
    expect(listSideChatTreeRequestSchema.parse({ parentSessionId: 'parent-1' }).parentSessionId).toBe('parent-1')
    expect(() => listSideChatTreeRequestSchema.parse({ parentSessionId: '' })).toThrow()
    expect(listSideChatProjectRequestSchema.parse({ parentSessionId: 'parent-1' }).parentSessionId).toBe('parent-1')
    const entry = {
      parentSessionId: 'parent-1', childSessionId: 'child-1', lastActiveAt: 1_700_000_000,
      title: 'Main', cwd: '/work/repo', preview: '…', running: true,
    }
    const tree = listSideChatTreeResultSchema.parse({ ok: true, value: { entries: [entry] } })
    expect(tree.ok && tree.value.entries[0]).toMatchObject({
      parentSessionId: 'parent-1', childSessionId: 'child-1', lastActiveAt: 1_700_000_000, running: true,
    })
    const project = listSideChatProjectResultSchema.parse({ ok: true, value: { entries: [entry] } })
    expect(project.ok && project.value.entries[0]!.cwd).toBe('/work/repo')
    expect(listSideChatTreeResultSchema.parse({
      ok: false, error: { code: 'internal', message: 'boom' },
    }).ok).toBe(false)
    expect(() => listSideChatTreeResultSchema.parse({ ok: true, value: { entries: [{ ...entry, lastActiveAt: 'soon' }] } })).toThrow()
  })

  it('round-trips layer-B tool digests and the running current action', () => {
    const result = readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 21, running: true, partial: '', reasoning: '',
      messages: [{
        id: 'a1', role: 'assistant', text: 'Checking…',
        tools: [
          { callId: 'c1', name: 'read', args: '{"path":"a.ts"}', result: 'file body', isError: false },
          { callId: 'c2', name: 'search', args: '{"q":"btw"}', running: true },
        ],
      }],
      currentAction: { kind: 'tool', tool: 'search', turn: 3, step: 2 },
    } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.messages[0]?.tools).toHaveLength(2)
    expect(result.value.messages[0]?.tools?.[0]).toEqual({
      callId: 'c1', name: 'read', args: '{"path":"a.ts"}', result: 'file body', isError: false,
    })
    expect(result.value.messages[0]?.tools?.[1]).toEqual({ callId: 'c2', name: 'search', args: '{"q":"btw"}', running: true })
    expect(result.value.currentAction).toEqual({ kind: 'tool', tool: 'search', turn: 3, step: 2 })

    // Generating action round-trips too.
    const generating = readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 22, running: true, partial: '', reasoning: '', messages: [],
      currentAction: { kind: 'generating', turn: 4, step: 1 },
    } })
    expect(generating.ok && generating.value.currentAction?.kind).toBe('generating')

    // Strict schemas reject unknown digest fields and malformed actions.
    expect(() => readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 22, running: false, partial: '', reasoning: '', messages: [
        { id: 'a', role: 'assistant', text: 'x', tools: [{ callId: 'c', name: 'n', args: '', extra: 1 }] },
      ],
    } })).toThrow()
    expect(() => readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 22, running: false, partial: '', reasoning: '', messages: [],
      currentAction: { kind: 'nope' },
    } })).toThrow()
    expect(() => readSideChatResultSchema.parse({ ok: true, value: {
      chatToken: token, revision: 22, running: false, partial: '', reasoning: '', messages: [],
      currentAction: { kind: 'tool', tool: '', turn: 1, step: 0 },
    } })).toThrow()
  })
})
