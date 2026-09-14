import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

vi.mock('@deepseek-ai/dsh-subagent', () => ({
  appendDelegatedPolicyOverrides: vi.fn(),
  applyChildComposition: vi.fn(),
  childSessionMeta: vi.fn(() => ({ parentSession: 'parent' })),
  resolveChildAgentOptions: vi.fn(() => ({})),
  resolveChildDepth: vi.fn(() => 1),
}))

import { BtwRegistry, btwIndexPath } from '../src/host/btw-registry.ts'
import { SideChatService } from '../src/host/side-chat-service.ts'

let home: string | undefined
const previousHome = process.env.DSH_HOME

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'btw-list-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

async function writeIndex(entries: Record<string, unknown>): Promise<void> {
  const path = btwIndexPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8')
}

function hostHarness(options: {
  parentId: string
  parentCwd?: string
  parentTitleEvent?: { title?: string }
  descendants?: readonly { kind: 'child', id: string }[]
  sessions?: readonly { header?: { id?: string, cwd?: string } }[]
}) {
  const ctx = new Context()
  const agents = { get: vi.fn(), create: vi.fn(), resume: vi.fn() }
  const parent = {
    status: 'running',
    session: {
      events: options.parentTitleEvent === undefined ? [] : [
        { type: 'session/title', data: options.parentTitleEvent } as unknown as never,
      ],
      header: { cwd: options.parentCwd },
    },
    ctx: { agents, tools: { get: vi.fn(() => undefined) } },
  } as unknown as Agent
  agents.get.mockImplementation((id: unknown) => String(id) === options.parentId ? parent : undefined)
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  const subagents = { listDescendants: vi.fn(async () => options.descendants ?? []) }
  ctx.provide('subagents', subagents as never)
  const sessionQuery = { listSessions: vi.fn(async () => options.sessions ?? []) }
  ctx.provide('sessionQuery', sessionQuery as never)
  const service = new SideChatService(ctx)
  return { ctx, service, parentId: options.parentId, subagents, sessionQuery }
}

describe('btw Host tree/project listing (U-J)', () => {
  const contexts: Context[] = []

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  })

  it('lists the session tree root plus subagent descendants joined with the index', async () => {
    const env = hostHarness({
      parentId: 'root-1',
      parentCwd: '/live/root',
      descendants: [{ kind: 'child', id: 'sub-1' }, { kind: 'child', id: 'sub-2' }],
    })
    contexts.push(env.ctx)
    await writeIndex({
      'root-1': {
        childSessionId: 'child-root', createdAt: 1, lastActiveAt: 100,
        parentTitle: 'Root Title', parentCwd: '/live/root', lastPreview: 'root preview',
      },
      'sub-1': { childSessionId: 'child-1', createdAt: 2, lastActiveAt: 200 },
      'sub-2': { childSessionId: 'child-2', createdAt: 3, lastActiveAt: 300, lastPreview: 'second preview' },
      // Outside the tree: must never appear.
      'other-parent': { childSessionId: 'child-other', createdAt: 4, lastActiveAt: 400 },
    })

    const result = await env.service.listTree({ parentSessionId: 'root-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entries.map(entry => entry.parentSessionId)).toEqual(['sub-2', 'sub-1', 'root-1'])
    const rootEntry = result.value.entries.find(entry => entry.parentSessionId === 'root-1')
    expect(rootEntry).toMatchObject({
      childSessionId: 'child-root', title: 'Root Title', cwd: '/live/root',
      preview: 'root preview', running: true,
    })
    const sub1 = result.value.entries.find(entry => entry.parentSessionId === 'sub-1')
    // Cold node: fresh metadata absent, index values fall through (v2 fields optional).
    expect(sub1).toMatchObject({ childSessionId: 'child-1', lastActiveAt: 200 })
    expect(sub1?.title).toBeUndefined()
    expect(sub1?.preview).toBeUndefined()
    const sub2 = result.value.entries.find(entry => entry.parentSessionId === 'sub-2')
    expect(sub2?.preview).toBe('second preview')
    expect(env.subagents.listDescendants).toHaveBeenCalledWith('root-1', undefined)
  })

  it('degrades to self-only when the descendant service is unavailable', async () => {
    const env = hostHarness({ parentId: 'root-1' })
    contexts.push(env.ctx)
    env.subagents.listDescendants.mockRejectedValueOnce(new Error('listing down'))
    await writeIndex({
      'root-1': { childSessionId: 'child-root', createdAt: 1, lastActiveAt: 100, parentTitle: 'Only Me' },
    })

    const result = await env.service.listTree({ parentSessionId: 'root-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entries.map(entry => entry.parentSessionId)).toEqual(['root-1'])
  })

  it('groups side conversations by the parent working directory (project)', async () => {
    const env = hostHarness({
      parentId: 'root-1',
      parentCwd: home!,
      sessions: [
        { header: { id: 'root-1', cwd: home! } },
        { header: { id: 'sibling-1', cwd: home! } },
        { header: { id: 'other-project', cwd: join(home!, 'elsewhere') } },
      ],
    })
    contexts.push(env.ctx)
    await writeIndex({
      'root-1': { childSessionId: 'child-root', createdAt: 1, lastActiveAt: 100, parentTitle: 'Root', parentCwd: home! },
      'sibling-1': { childSessionId: 'child-sib', createdAt: 2, lastActiveAt: 200, parentTitle: 'Sibling', parentCwd: home! },
      'other-project': { childSessionId: 'child-op', createdAt: 3, lastActiveAt: 300, parentTitle: 'Other', parentCwd: join(home!, 'elsewhere') },
    })

    const result = await env.service.listProject({ parentSessionId: 'root-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entries.map(entry => entry.parentSessionId).sort()).toEqual(['root-1', 'sibling-1'])
    expect(env.sessionQuery.listSessions).toHaveBeenCalledTimes(1)
  })

  it('returns an empty project when the parent session has no working directory', async () => {
    const env = hostHarness({ parentId: 'root-1' })
    contexts.push(env.ctx)
    const result = await env.service.listProject({ parentSessionId: 'root-1' })
    expect(result).toEqual({ ok: true, value: { entries: [] } })
  })

  it('tolerates v1 index files and carries the v2 fields on set/touch', async () => {
    await writeIndex({
      'p1': { childSessionId: 'c1', createdAt: 10, lastActiveAt: 20 },
      'p2': { childSessionId: 'c2', createdAt: 30, lastActiveAt: 40 },
    })
    const registry = new BtwRegistry()

    const loaded = await registry.load()
    expect(loaded.entries['p1']).toEqual({ childSessionId: 'c1', createdAt: 10, lastActiveAt: 20 })

    await registry.set('p1', 'c1', { parentTitle: 'Title', parentCwd: '/w', lastPreview: 'prev' })
    await registry.touch('p1', { lastPreview: 'updated preview' })
    const refreshed = await registry.load()
    expect(refreshed.entries['p1']).toMatchObject({
      childSessionId: 'c1', parentTitle: 'Title', parentCwd: '/w', lastPreview: 'updated preview',
    })
    expect(refreshed.entries['p1']!.lastActiveAt).toBeGreaterThan(20)
    // Untouched entries are preserved verbatim.
    expect(refreshed.entries['p2']).toEqual({ childSessionId: 'c2', createdAt: 30, lastActiveAt: 40 })
  })

  it('reflects fresh index values in listTree after a touch', async () => {
    await writeIndex({
      'root-1': { childSessionId: 'child-root', createdAt: 1, lastActiveAt: 100 },
    })
    const registry = new BtwRegistry()
    await registry.touch('root-1', { parentTitle: 'Fresh Title', lastPreview: 'fresh preview' })

    const env = hostHarness({ parentId: 'root-1' })
    contexts.push(env.ctx)
    const result = await env.service.listTree({ parentSessionId: 'root-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entries[0]).toMatchObject({
      parentSessionId: 'root-1', title: 'Fresh Title', preview: 'fresh preview',
    })
  })
})
