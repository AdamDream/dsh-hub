import { describe, expect, it } from 'vitest'
import {
  answerSideChatRequestSchema, answerSideChatResultSchema,
  cancelSideChatRequestSchema, cancelSideChatResultSchema,
  closeSideChatRequestSchema, closeSideChatResultSchema,
  readSideChatRequestSchema, readSideChatResultSchema,
  sendSideChatRequestSchema, sendSideChatResultSchema,
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
      chatToken: token, revision: 18, running: true, partial: 'Working',
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
})
