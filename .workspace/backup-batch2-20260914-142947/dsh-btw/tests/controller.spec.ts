import { describe, expect, it, vi } from 'vitest'
import type { ClientContext, ISessions, SessionBinding, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SideChatRemoteNamespace } from '../src/client/remote.ts'
import { SideChatController } from '../src/client/controller.ts'

const NOT_OPEN_MESSAGE = 'This side conversation is no longer open on the host (it may have restarted). Its saved history is kept — press Try again to resume it.'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

function harness() {
  let current = 'parent' as SessionId
  const listeners = new Set<() => void>()
  const bindings = new Map<string, SessionBinding>()
  const sessions = {
    list: {
      getSnapshot: () => ({ current }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    binding: (id: SessionId) => bindings.get(String(id)),
  } as unknown as ISessions
  const ctx = { get: (name: string) => name === 'sessions' ? sessions : undefined } as unknown as ClientContext
  return {
    ctx,
    bindings,
    switchTo(id: string) { current = id as SessionId; for (const listener of listeners) listener() },
  }
}

function success(token: string, parentSessionId = 'parent', resumed = false) {
  return {
    ok: true as const,
    value: {
      ok: true as const,
      value: {
        parentSessionId,
        childSessionId: `child-${parentSessionId}`,
        chatToken: token,
        seedLength: 14,
        resumed,
      },
    },
  }
}

function closeResult() {
  return { ok: true as const, value: { ok: true as const, value: {
    chatToken: 'ignored', closed: true, cleanup: 'absent' as const,
  } } }
}

function sendResult(chatToken: string, requestId: string, messageId = 'queued-1') {
  return { ok: true as const, value: { ok: true as const, value: {
    chatToken, requestId, accepted: true as const, messageId,
  } } }
}

function readResult(
  chatToken: string,
  messages: { id: string, role: 'user' | 'assistant', text: string }[] = [],
  running = false,
  extras: Record<string, unknown> = {},
) {
  return { ok: true as const, value: { ok: true as const, value: {
    chatToken,
    revision: 18,
    running,
    partial: '',
    messages,
    ...extras,
  } } }
}

function notOpenResult() {
  return { ok: true as const, value: { ok: false as const, error: {
    code: 'not-open' as const, message: 'Side Chat is not open.',
  } } }
}

function hostFailure(code: 'compatibility' | 'internal', message: string) {
  return { ok: true as const, value: { ok: false as const, error: { code, message } } }
}

function transportFailure(message = 'Network unavailable.') {
  return { ok: false as const, error: { code: 'transport-failure', message } }
}

describe('SideChatController lifecycle', () => {
  it('accepts and renders the first message before start admission finishes', async () => {
    const env = harness()
    const start = deferred<ReturnType<typeof success>>()
    const send = vi.fn(async ({ chatToken, requestId }: { chatToken: string, requestId: string }) => (
      sendResult(chatToken, requestId)
    ))
    const remote = {
      start: vi.fn(() => start.promise),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken)),
      send,
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    const opening = controller.open('parent' as SessionId)
    const token = controller.getSnapshot().chatToken!
    const result = await controller.send('First question')

    expect(result).toEqual({ ok: true })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'starting',
      running: true,
      messages: [{ role: 'user', text: 'First question' }],
    })
    expect(send).not.toHaveBeenCalled()

    start.resolve(success(token))
    await opening
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(1) })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ chatToken: token, text: 'First question' }))
    await controller.dispose()
  })

  it('keeps the first message visible when start admission itself fails', async () => {
    const env = harness()
    const start = deferred<ReturnType<typeof hostFailure>>()
    const remote = {
      start: vi.fn(() => start.promise),
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    const opening = controller.open('parent' as SessionId)
    await controller.send('Keep me on failure')
    start.resolve(hostFailure('compatibility', 'factory exploded'))
    await opening

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      error: 'factory exploded',
      messages: [{ role: 'user', text: 'Keep me on failure' }],
    })
    await controller.dispose()
  })

  it('keeps an optimistic message visible while Host admission is pending', async () => {
    vi.useFakeTimers()
    const env = harness()
    const admitted = deferred<ReturnType<typeof sendResult>>()
    const send = vi.fn((_request: { chatToken: string, requestId: string, text: string }) => admitted.promise)
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken)),
      send,
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    await Promise.resolve()
    const token = controller.getSnapshot().chatToken!
    const sending = controller.send('Stay visible')
    await vi.advanceTimersByTimeAsync(700)
    const messagesWhilePending = controller.getSnapshot().messages

    const requestId = send.mock.calls[0]![0].requestId
    admitted.resolve(sendResult(token, requestId))
    await sending

    expect(messagesWhilePending).toEqual([
      expect.objectContaining({ role: 'user', text: 'Stay visible' }),
    ])
    await controller.dispose()
    vi.useRealTimers()
  })

  it('surfaces a background opening failure without dropping the accepted message', async () => {
    const env = harness()
    let reads = 0
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => {
        reads += 1
        return reads === 1
          ? readResult(chatToken)
          : hostFailure('compatibility', 'factory exploded')
      }),
      send: vi.fn(async ({ chatToken, requestId }: { chatToken: string, requestId: string }) => (
        sendResult(chatToken, requestId)
      )),
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await controller.open('parent' as SessionId)
    await vi.waitFor(() => { expect(reads).toBe(1) })
    await controller.send('Keep this question')
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('error') })

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      error: 'factory exploded',
      messages: [{ role: 'user', text: 'Keep this question' }],
    })
    warn.mockRestore()
    await controller.dispose()
  })

  it('retries a retained first message after background opening fails', async () => {
    const env = harness()
    let starts = 0
    const send = vi.fn(async ({ chatToken, requestId }: { chatToken: string, requestId: string }) => (
      sendResult(chatToken, requestId, `queued-${send.mock.calls.length}`)
    ))
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => {
        starts += 1
        return success(chatToken)
      }),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => (
        starts === 1 && send.mock.calls.length > 0
          ? hostFailure('compatibility', 'factory exploded')
          : readResult(chatToken)
      )),
      send,
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    await controller.send('Retry me')
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('error') })
    await controller.retry()
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(2) })

    expect(controller.getSnapshot().messages).toContainEqual(
      expect.objectContaining({ role: 'user', text: 'Retry me' }),
    )
    await controller.dispose()
  })

  it('keeps repeated open for the active parent idempotent', async () => {
    const env = harness()
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken)),
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    const childSessionId = controller.getSnapshot().childSessionId
    await controller.open('parent' as SessionId)

    expect(remote.start).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().childSessionId).toBe(childSessionId)
    await controller.dispose()
  })

  it('retires a start response that arrives after explicit close', async () => {
    const env = harness()
    const start = deferred<ReturnType<typeof success>>()
    const close = vi.fn(async () => closeResult())
    const remote = { start: vi.fn(() => start.promise), close } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    const opening = controller.open('parent' as SessionId)
    const token = controller.getSnapshot().chatToken
    expect(controller.getSnapshot().phase).toBe('starting')
    await controller.close()
    start.resolve(success(token!))
    await opening

    expect(controller.getSnapshot().phase).toBe('closed')
    expect(close).toHaveBeenCalledWith({ chatToken: token })
    await controller.dispose()
  })

  it('publishes only the active child transcript epoch', async () => {
    const env = harness()
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken, [
        { id: 'm1', role: 'assistant' as const, text: 'A focused answer.' },
      ])),
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    await vi.waitFor(() => { expect(controller.getSnapshot().revision).toBe(18) })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'open', childSessionId: 'child-parent', seedLength: 14,
      messages: [{ id: 'm1', role: 'assistant', text: 'A focused answer.' }],
    })
    await controller.dispose()
  })

  it('confirms a parked conversation with the Host before restoring its latest transcript', async () => {
    const env = harness()
    const restore = deferred<ReturnType<typeof readResult>>()
    let reads = 0
    const close = vi.fn(async () => closeResult())
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(({ chatToken }: { chatToken: string }) => {
        reads += 1
        if (reads === 1) return Promise.resolve(readResult(chatToken, [
          { id: 'cached', role: 'assistant' as const, text: 'Cached answer.' },
        ]))
        if (reads === 2) return restore.promise
        return Promise.resolve(readResult(chatToken, [
          { id: 'latest', role: 'assistant' as const, text: 'Latest Host answer.' },
        ]))
      }),
      close,
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    await vi.waitFor(() => { expect(controller.getSnapshot().messages).toHaveLength(1) })
    const token = controller.getSnapshot().chatToken
    env.switchTo('another-parent')

    expect(controller.getSnapshot().phase).toBe('closed')
    expect(controller.hasConversation('parent' as SessionId)).toBe(true)
    expect(close).not.toHaveBeenCalled()

    env.switchTo('parent')
    expect(controller.getSnapshot()).toMatchObject({ phase: 'starting', chatToken: token, messages: [] })
    restore.resolve(readResult(token!, [
      { id: 'latest', role: 'assistant', text: 'Latest Host answer.' },
    ]))
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('open') })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'open', chatToken: token, childSessionId: 'child-parent',
      messages: [{ id: 'latest', text: 'Latest Host answer.' }],
    })
    expect(close).not.toHaveBeenCalled()

    await controller.close()
    expect(close).toHaveBeenCalledTimes(1)
    await controller.dispose()
  })

  it('keeps polling while the host reports running without ever expiring', async () => {
    vi.useFakeTimers()
    const env = harness()
    const close = vi.fn(async () => closeResult())
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken, [], true)),
      close,
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    await vi.advanceTimersByTimeAsync(35 * 60 * 1_000)

    expect(controller.getSnapshot()).toMatchObject({ phase: 'open', running: true })
    expect(close).not.toHaveBeenCalled()
    await controller.dispose()
    vi.useRealTimers()
  })

  it('keeps separate retained conversations for different parent tasks', async () => {
    const env = harness()
    const remote = {
      start: vi.fn(async ({ chatToken, parentSessionId }: { chatToken: string, parentSessionId: string }) => (
        success(chatToken, parentSessionId)
      )),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken)),
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    const firstToken = controller.getSnapshot().chatToken
    env.switchTo('second')
    await controller.open('second' as SessionId)
    const secondToken = controller.getSnapshot().chatToken
    expect(secondToken).not.toBe(firstToken)

    env.switchTo('parent')
    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toMatchObject({ phase: 'open', chatToken: firstToken, childSessionId: 'child-parent' })
    })
    env.switchTo('second')
    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toMatchObject({ phase: 'open', chatToken: secondToken, childSessionId: 'child-second' })
    })
    expect(remote.close).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('parks an in-flight opening instead of deleting its late result', async () => {
    const env = harness()
    const start = deferred<ReturnType<typeof success>>()
    const close = vi.fn(async () => closeResult())
    const remote = {
      start: vi.fn(() => start.promise),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken)),
      close,
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    const opening = controller.open('parent' as SessionId)
    const token = controller.getSnapshot().chatToken!
    env.switchTo('other')
    start.resolve(success(token))
    await opening

    expect(controller.getSnapshot().phase).toBe('closed')
    expect(close).not.toHaveBeenCalled()
    env.switchTo('parent')
    await vi.waitFor(() => { expect(controller.getSnapshot()).toMatchObject({ phase: 'open', chatToken: token }) })
    await controller.dispose()
  })

  it('keeps an optimistic opening message when switching away and back', async () => {
    const env = harness()
    const start = deferred<ReturnType<typeof success>>()
    const remote = {
      start: vi.fn(() => start.promise),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken)),
      send: vi.fn(async ({ chatToken, requestId }: { chatToken: string, requestId: string }) => (
        sendResult(chatToken, requestId)
      )),
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    const opening = controller.open('parent' as SessionId)
    const token = controller.getSnapshot().chatToken!
    await controller.send('Follow this parent')
    env.switchTo('other')
    env.switchTo('parent')

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'starting',
      messages: [{ role: 'user', text: 'Follow this parent' }],
      running: true,
    })

    start.resolve(success(token))
    await opening
    await controller.dispose()
  })

  it('does not flash a stale cached transcript and offers an explicit retry after not-open', async () => {
    const env = harness()
    let reads = 0
    const start = vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken))
    const close = vi.fn(async () => closeResult())
    const remote = {
      start,
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => {
        reads += 1
        if (reads === 1) return readResult(chatToken, [
          { id: 'stale-cache', role: 'assistant' as const, text: 'Do not flash me.' },
        ])
        if (reads === 2) return notOpenResult()
        return readResult(chatToken)
      }),
      close,
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    await vi.waitFor(() => { expect(controller.getSnapshot().messages).toHaveLength(1) })
    env.switchTo('other')
    env.switchTo('parent')

    expect(controller.getSnapshot()).toMatchObject({ phase: 'starting', messages: [] })
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('error') })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error', messages: [], error: NOT_OPEN_MESSAGE,
    })

    await controller.retry()
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('open') })
    expect(start).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })

  it('keeps a parked conversation retryable when Host confirmation has a transport failure', async () => {
    const env = harness()
    let reads = 0
    const close = vi.fn(async () => closeResult())
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => {
        reads += 1
        if (reads === 1) return readResult(chatToken, [
          { id: 'cached', role: 'assistant' as const, text: 'Cached answer.' },
        ])
        if (reads === 2) return transportFailure()
        return readResult(chatToken, [
          { id: 'recovered', role: 'assistant' as const, text: 'Recovered answer.' },
        ])
      }),
      close,
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    await vi.waitFor(() => { expect(controller.getSnapshot().messages).toHaveLength(1) })
    env.switchTo('other')
    env.switchTo('parent')

    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('error') })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error', error: 'Network unavailable.', messages: [],
    })

    await controller.retry()
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('open') })
    expect(controller.getSnapshot().messages).toContainEqual({
      id: 'recovered', role: 'assistant', text: 'Recovered answer.',
    })
    expect(close).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('surfaces the pending question from reads and submits answers through the answer remote', async () => {
    const env = harness()
    const questionId = '123e4567-e89b-42d3-a456-426614174009'
    let reads = 0
    const answer = vi.fn(async (request: { chatToken: string, questionId: string }) => ({
      ok: true as const,
      value: { ok: true as const, value: { chatToken: request.chatToken, questionId: request.questionId, accepted: true as const } },
    }))
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => {
        reads += 1
        return readResult(chatToken, [], reads === 1, reads === 1
          ? { pendingQuestion: { questionId, questions: [
            { id: 'q1', question: 'Which scope?', options: [{ label: 'Repo only' }, { label: 'Everything' }] },
            { id: 'q2', question: 'Anything else?', multi_select: true },
          ] } }
          : {})
      }),
      answer,
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    await vi.waitFor(() => { expect(controller.getSnapshot().pendingQuestion).toBeDefined() })
    expect(controller.getSnapshot().pendingQuestion).toMatchObject({ questionId })

    const result = await controller.answer([
      { id: 'q1', selected: ['Repo only'] },
      { id: 'q2', selected: [], custom: 'No, thanks' },
    ])
    expect(result).toEqual({ ok: true })
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({
      questionId,
      answers: [
        { id: 'q1', selected: ['Repo only'] },
        { id: 'q2', selected: [], custom: 'No, thanks' },
      ],
    }))
    expect(controller.getSnapshot().pendingQuestion).toBeUndefined()
    await controller.dispose()
  })

  it('rejects answers when no question is pending', async () => {
    const env = harness()
    const remote = {
      start: vi.fn(async ({ chatToken }: { chatToken: string }) => success(chatToken)),
      read: vi.fn(async ({ chatToken }: { chatToken: string }) => readResult(chatToken)),
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    const result = await controller.answer([{ id: 'q1', selected: [] }])
    expect(result.ok).toBe(false)
    await controller.dispose()
  })

  it('surfaces host business errors without creating a binding', async () => {
    const env = harness()
    const remote = {
      start: vi.fn(async () => ({ ok: true as const, value: {
        ok: false as const,
        error: { code: 'parent-not-found' as const, message: 'The parent conversation is not live.' },
      } })),
      close: vi.fn(async () => closeResult()),
    } as unknown as SideChatRemoteNamespace
    const controller = new SideChatController(env.ctx, remote)

    await controller.open('parent' as SessionId)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'error', error: 'The parent conversation is not live.' })
    await controller.dispose()
  })
})
