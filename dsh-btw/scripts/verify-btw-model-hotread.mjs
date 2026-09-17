/**
 * Verify that the btw side-chat default model is settings-driven and
 * HOT-read (追加交付单元, 2026-09-17): editing the `dsh-btw.model.default`
 * settings section applies to the next started side conversation WITHOUT a
 * restart, and a cleared/absent section falls back to the constant default.
 *
 * The settings service face used by the host (`settings.get('dsh-btw')`) is
 * backed by a JSON file read fresh on every call, mirroring the farm chain
 * (settings.yaml → dsh-settings-file → resolved doc → per-call `get`); the
 * file is rewritten between starts to simulate a settings.yaml hot edit in
 * the same process. Runs against the BUILT host bundle (lib/index.js) with
 * the real cordis Context and the real dsh-subagent route helpers.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SideChatService } from '../lib/index.js'

const home = mkdtempSync(join(tmpdir(), 'btw-hotread-'))
process.env.DSH_HOME = home
const sectionPath = join(home, 'dsh-btw.section.json')
const section = { current: {} }
function writeSection(value) {
  section.current = value
  writeFileSync(sectionPath, JSON.stringify(value), 'utf8')
}
const settings = {
  get(namespace) {
    if (namespace !== 'dsh-btw') return undefined
    // Per-call read: any settings.yaml edit is visible on the next call.
    try {
      return JSON.parse(readFileSync(sectionPath, 'utf8'))
    } catch {
      return section.current
    }
  },
}

const ctx = new Context()
ctx.provide('settings', settings)
ctx.provide('sessions', {})

let parentSequence = 0
const parent = {
  status: 'idle',
  session: { events: [], header: {} },
  options: {},
  ctx: {
    agents: null,
    get: () => undefined,
    tools: { get: () => undefined },
  },
}
const agents = {
  get: () => parent,
  create: async (options) => {
    createdAgentOptions.push(options.agentOptions)
    return {
      agent: {
        status: 'idle',
        session: { events: [], header: {} },
        inject: () => {},
        followup: () => {},
        cancel: () => {},
      },
      dispose: async () => {},
    }
  },
  resume: async () => { throw new Error('no persisted session') },
}
parent.ctx.agents = agents
const createdAgentOptions = []
ctx.provide('agents', agents)

const service = new SideChatService(ctx)
const tokens = [randomUUID(), randomUUID(), randomUUID()]

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${message}`)
  }
}

async function startNext(token) {
  parentSequence += 1
  const result = await service.start({ parentSessionId: `parent-${parentSequence}`, chatToken: token })
  if (!result.ok) throw new Error(`start failed: ${JSON.stringify(result.error)}`)
  return result.value.model
}

// 1) settings default = glm-5.3 → new side chat defaults to glm-5.3
writeSection({ model: { default: 'glm-5.3' } })
const first = await startNext(tokens[0])
assert(first === 'glm-5.3', `settings dsh-btw.model.default=glm-5.3 → new chat default model = ${first}`)
assert(
  createdAgentOptions[0]?.model === 'glm-5.3',
  `create agentOptions.model = ${createdAgentOptions[0]?.model} (routed to the settings default)`,
)

// 2) HOT EDIT (no restart): rewrite the section like saving settings.yaml
writeSection({ model: { default: 'deepseek-v4-pro' } })
const second = await startNext(tokens[1])
assert(second === 'deepseek-v4-pro', `hot edit → dsh-btw.model.default=deepseek-v4-pro → new chat default model = ${second}`)

// 3) cleared section → falls back to the constant default
writeSection({})
const third = await startNext(tokens[2])
assert(third === 'deepseek-v4.1-flash', `cleared/absent section → fallback constant default = ${third}`)

console.log(`\nagentOptions seen by agents.create:\n${JSON.stringify(createdAgentOptions, null, 2)}`)
rmSync(home, { recursive: true, force: true })
if (process.exitCode) console.log('\nFAILED')
else console.log('\nPASS: btw default model is settings-driven and hot-read (no restart needed for value changes)')
