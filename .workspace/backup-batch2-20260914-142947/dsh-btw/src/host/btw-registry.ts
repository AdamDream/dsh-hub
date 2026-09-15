/**
 * Durable btw index: which persisted child session belongs to which parent
 * session (U5).
 *
 * The mapping deliberately lives OUTSIDE the child session meta: upstream's
 * `hiddenSideChatMeta` strips `parentSession` from `childSessionMeta()` so the
 * child stays out of both the normal session directory and the subagent
 * directory (origin `'subagent'` with no parent link). Writing the parent id
 * back into the child header would break that hiding. Instead this small
 * sidecar file records parentSessionId → childSessionId, is updated with
 * atomic rename writes, and is consulted by `SideChatService.start()` to
 * resume the persisted child through `ctx.agents.resume()` after a DSH
 * restart.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** One index record: the persisted child session for one parent session. */
export interface BtwIndexEntry {
  readonly childSessionId: string
  readonly createdAt: number
  readonly lastActiveAt: number
}

interface BtwIndexFile {
  readonly version: 1
  readonly entries: Record<string, BtwIndexEntry>
}

const EMPTY_INDEX: BtwIndexFile = Object.freeze({ version: 1, entries: Object.freeze({}) })

/** The DSH home directory (env override first, `~/.dsh` fallback). */
export function btwHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Absolute path of the durable btw index file. */
export function btwIndexPath(): string {
  return join(btwHome(), 'btw', 'index.json')
}

function parseIndex(raw: string): BtwIndexFile {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null) throw new Error('btw index: not an object')
  const record = value as { version?: unknown; entries?: unknown }
  if (record.version !== 1) throw new Error(`btw index: unsupported version ${String(record.version)}`)
  if (typeof record.entries !== 'object' || record.entries === null) throw new Error('btw index: entries is not an object')
  const entries: Record<string, BtwIndexEntry> = {}
  for (const [parentSessionId, entry] of Object.entries(record.entries as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as { childSessionId?: unknown; createdAt?: unknown; lastActiveAt?: unknown }
    if (typeof candidate.childSessionId !== 'string' || candidate.childSessionId.length === 0) continue
    if (typeof candidate.createdAt !== 'number' || typeof candidate.lastActiveAt !== 'number') continue
    entries[parentSessionId] = {
      childSessionId: candidate.childSessionId,
      createdAt: candidate.createdAt,
      lastActiveAt: candidate.lastActiveAt,
    }
  }
  return { version: 1, entries }
}

/**
 * Atomic-read registry over `~/.dsh/btw/index.json`. Every mutation rewrites
 * the whole (small) file through a unique temp file + `rename`, so a crash
 * mid-write can never leave a torn index behind.
 */
export class BtwRegistry {
  /** Serialized write chain so concurrent set/touch/remove cannot interleave. */
  private tail: Promise<unknown> = Promise.resolve()

  /** Read the index fresh from disk; a missing or corrupt file degrades to empty. */
  async load(): Promise<BtwIndexFile> {
    try {
      return parseIndex(await readFile(btwIndexPath(), 'utf8'))
    } catch {
      return EMPTY_INDEX
    }
  }

  /** The persisted child session id for one parent session, when indexed. */
  async get(parentSessionId: string): Promise<BtwIndexEntry | undefined> {
    return (await this.load()).entries[parentSessionId]
  }

  /** Record (or refresh) the child session for one parent session. */
  async set(parentSessionId: string, childSessionId: string): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.load()
      const previous = current.entries[parentSessionId]
      const now = Date.now()
      const next: BtwIndexFile = {
        version: 1,
        entries: {
          ...current.entries,
          [parentSessionId]: {
            childSessionId,
            createdAt: previous?.childSessionId === childSessionId ? previous.createdAt : now,
            lastActiveAt: now,
          },
        },
      }
      await this.write(next)
    })
  }

  /** Refresh `lastActiveAt` for one parent session, keeping the child id. */
  async touch(parentSessionId: string): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.load()
      const previous = current.entries[parentSessionId]
      if (previous === undefined) return
      await this.write({
        version: 1,
        entries: {
          ...current.entries,
          [parentSessionId]: { ...previous, lastActiveAt: Date.now() },
        },
      })
    })
  }

  /** Drop one parent session from the index (its persisted log is untouched). */
  async remove(parentSessionId: string): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.load()
      if (!(parentSessionId in current.entries)) return
      const entries = { ...current.entries }
      delete entries[parentSessionId]
      await this.write({ version: 1, entries })
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.tail.then(operation, operation)
    this.tail = next.catch(() => undefined)
    return next
  }

  private async write(index: BtwIndexFile): Promise<void> {
    const path = btwIndexPath()
    const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(temporary, JSON.stringify(index, null, 2) + '\n', 'utf8')
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
