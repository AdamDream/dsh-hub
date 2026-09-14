import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('@deepseek-ai/dsh-subagent', () => ({
  appendDelegatedPolicyOverrides: vi.fn(),
  applyChildComposition: vi.fn(),
  childSessionMeta: vi.fn(() => ({ parentSession: 'parent' })),
  resolveChildAgentOptions: vi.fn(() => ({})),
  resolveChildDepth: vi.fn(() => 1),
}))

import { SideChatService } from '../src/host/side-chat-service.ts'
import { btwIndexPath } from '../src/host/btw-registry.ts'

let home: string | undefined
const previousHome = process.env.DSH_HOME

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'btw-persistence-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

let parentSequence = 0

function nextParentId(): string {
  parentSequence += 1
  return `parent-${parentSequence}`
}

const TOKEN = '00000000-0000-4000-8000-000000000001'

function seedEvents(): SessionEvent[] {
  return [
    {
      seq: 0, time: 1, type: 'user/message',
      data: { id: 'm0', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } },
    },
    { seq: 1, time: 2, type: 'turn/end', data: {} },
  ] as unknown as SessionEvent[]
}

function resumedHandle() {
  const inject = vi.fn()
  const followup = vi.fn()
  const handle = {
    agent: {
      status: 'idle',
      session: {
        header: { seedLength: 14 },
        events: [
          { seq: 0, time: 1, type: 'user/message', data: {} },
          { seq: 14, time: 2, type: 'user/message', data: {
            id: 'boundary', content: [{ type: 'text', text: 'boundary' }], source: { kind: 'plugin', plugin: 'dsh-btw' },
          } },
        ],
      },
      inject,
      followup,
      cancel: vi.fn(),
    },
    dispose: vi.fn(async () => {}),
  } as unknown as AgentHandle
  return { handle, inject, followup }
}

function childHandle() {
  const handle = {
    agent: {
      status: 'idle',
      session: { events: [], header: {} },
      inject: vi.fn(),
      followup: vi.fn(),
      cancel: vi.fn(),
    },
    dispose: vi.fn(async () => {}),
  } as unknown as AgentHandle
  return handle
}

async function seedIndex(parentId: string, childSessionId: string): Promise<void> {
  const path = btwIndexPath()
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify({
    version: 1,
    entries: {
      [parentId]: { childSessionId, createdAt: 1, lastActiveAt: 2 },
    },
  }), 'utf8')
}

function hostHarness(options: {
  resume?: () => Promise<AgentHandle>
  create?: () => Promise<AgentHandle>
  withWorkspace?: boolean
} = {}) {
  const ctx = new Context()
  const parentId = nextParentId()
  const agents = {
    get: vi.fn(),
    create: vi.fn(options.create ?? (async () => childHandle())),
    resume: vi.fn<(options: { resumeSessionId?: string }) => Promise<AgentHandle>>(
      options.resume ?? (async () => { throw new Error('no persisted session') }),
    ),
  }
  const parent = {
    status: 'idle',
    session: { events: seedEvents() },
    ctx: { agents, tools: { get: vi.fn(() => undefined) } },
  } as unknown as Agent
  agents.get.mockImplementation(id => String(id) === parentId ? parent : undefined)
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  const archiveSession = vi.fn(async () => {})
  if (options.withWorkspace === true) ctx.provide('workspaceRegistry', { archiveSession } as never)
  const service = new SideChatService(ctx)
  return { ctx, service, agents, parentId, archiveSession }
}

describe('btw persistence index and resume', () => {
  const contexts: Context[] = []

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  })

  it('resumes the indexed child instead of forking a fresh one', async () => {
    const resumed = resumedHandle()
    const env = hostHarness({ resume: async () => resumed.handle })
    contexts.push(env.ctx)
    await seedIndex(env.parentId, 'persisted-child')

    const result = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })

    expect(result).toMatchObject({
      ok: true,
      value: { childSessionId: 'persisted-child', resumed: true, seedLength: 14 },
    })
    expect(env.agents.resume).toHaveBeenCalledTimes(1)
    expect(vi.mocked(env.agents.resume).mock.calls[0]?.[0]).toMatchObject({ resumeSessionId: 'persisted-child' })
    expect(env.agents.create).not.toHaveBeenCalled()
    // The persisted log already carries the boundary: only the fresh progress
    // digest is injected, never a second boundary.
    expect(resumed.inject).toHaveBeenCalledTimes(1)
    const digest = resumed.inject.mock.calls[0]![0] as { content: { text: string }[] }
    expect(digest.content[0]!.text).toContain('Main agent status')
  })

  it('records a freshly forked child in the durable index', async () => {
    const env = hostHarness()
    contexts.push(env.ctx)

    const result = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    await vi.waitFor(async () => {
      const index = JSON.parse(await readFile(btwIndexPath(), 'utf8')) as {
        entries: Record<string, { childSessionId: string }>
      }
      expect(index.entries[env.parentId]).toBeDefined()
    })

    expect(result).toMatchObject({ ok: true, value: { resumed: false } })
    const index = JSON.parse(await readFile(btwIndexPath(), 'utf8')) as {
      entries: Record<string, { childSessionId: string }>
    }
    expect(result.ok && index.entries[env.parentId]!.childSessionId).toBe(result.ok ? result.value.childSessionId : '')
  })

  it('falls back to a fresh fork and clears the index entry when resume fails', async () => {
    const env = hostHarness({ resume: async () => { throw new Error('session log missing') } })
    contexts.push(env.ctx)
    await seedIndex(env.parentId, 'gone-child')

    const result = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })

    expect(result).toMatchObject({ ok: true, value: { resumed: false } })
    expect(env.agents.resume).toHaveBeenCalledTimes(1)
    expect(env.agents.create).toHaveBeenCalledTimes(1)
    const index = JSON.parse(await readFile(btwIndexPath(), 'utf8')) as {
      entries: Record<string, unknown>
    }
    expect(index.entries[env.parentId]).toBeUndefined()
  })

  it('closes without archiving the persisted child log', async () => {
    const env = hostHarness({ withWorkspace: true })
    contexts.push(env.ctx)

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    const result = await env.service.close({ chatToken: TOKEN })

    expect(result).toMatchObject({ ok: true, value: { closed: true, cleanup: 'kept' } })
    expect(env.archiveSession).not.toHaveBeenCalled()
    // The index entry survives an explicit close, so reopening resumes history.
    await vi.waitFor(async () => {
      const index = JSON.parse(await readFile(btwIndexPath(), 'utf8')) as {
        entries: Record<string, unknown>
      }
      expect(index.entries[env.parentId]).toBeDefined()
    })
  })
})
