// First-open burst probe: the browser fires the settings-page RPCs CONCURRENTLY.
// Fires settings.describe + llm.providers + credentials.describe + pluginInventory/list
// in parallel (keep-alive, separate sockets), measures per-request latency and the
// wall time until every response settles. Read-only RPCs only.
import http from 'node:http'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const REPS = 20
const agent = new http.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 60_000 })

const CALLS = [
  ['settings.describe', '/api/settings.describe', 'settings.describe', {}],
  ['llm.providers', '/api/llm.providers', 'llm.providers', {}],
  ['credentials.describe', '/api/credentials.describe', 'credentials.describe',
    { refs: ['DEEPSEEK_API_KEY', 'ADAM_API_KEY', 'OPENCODE_GO_API_KEY'] }],
  ['pluginInventory.list', '/api/pluginInventory/list', 'pluginInventory/list', { args: {} }],
]

function call([id, path, method, payload]) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: id, method, payload })
    const t0 = process.hrtime.bigint()
    const req = http.request({
      host: '127.0.0.1', port: 3080, path, method: 'POST', agent,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({
        endpoint: id,
        ms: Number(process.hrtime.bigint() - t0) / 1e6,
        status: res.statusCode,
        bytes: Buffer.concat(chunks).length,
      }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const out = []
// warm-up burst (not measured)
await Promise.all(CALLS.map(call))
for (let i = 1; i <= REPS; i++) {
  const t0 = process.hrtime.bigint()
  const settled = await Promise.all(CALLS.map(call))
  const wall = Number(process.hrtime.bigint() - t0) / 1e6
  out.push({ rep: i, burst_wall_ms: Number(wall.toFixed(3)), requests: settled })
  await new Promise((r) => setTimeout(r, 100))
}
writeFileSync(join(OUT, 'raw-reps-burst.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n')
for (const r of out) {
  console.log(`rep ${String(r.rep).padStart(2)} wall=${r.burst_wall_ms.toFixed(2).padStart(7)}  ` +
    r.requests.map((q) => `${q.endpoint}=${q.ms.toFixed(2)}`).join('  '))
}
agent.destroy()
