// Keep-alive probe: isolates SERVER-SIDE handler time from curl process + TCP setup cost.
// Exactly ONE socket is reused for every rep (node:http Agent, keepAlive, maxSockets 1).
// Includes the first request on a brand-new socket, so the "first call on a fresh
// connection" cost is visible as rep 1 of each endpoint. Read-only RPCs only.
import http from 'node:http'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const REPS = 25
const agent = new http.Agent({ keepAlive: true, maxSockets: 1, keepAliveMsecs: 60_000 })

const ENDPOINTS = [
  ['settings.describe', '/api/settings.describe', 'settings.describe', {}],
  ['pluginInventory.list', '/api/pluginInventory/list', 'pluginInventory/list', { args: {} }],
  ['llm.providers', '/api/llm.providers', 'llm.providers', {}],
  ['llm.models', '/api/llm.models', 'llm.models', {}],
  ['credentials.describe', '/api/credentials.describe', 'credentials.describe',
    { refs: ['DEEPSEEK_API_KEY', 'ADAM_API_KEY', 'OPENCODE_GO_API_KEY'] }],
]

function call(path, method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'ka', method, payload })
    const req = http.request({
      host: '127.0.0.1', port: 3080, path, method: 'POST', agent,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks).length,
        socketReused: !req.reusedSocket }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const out = []
for (const [id, path, method, payload] of ENDPOINTS) {
  const reuse = []
  for (let i = 1; i <= REPS; i++) {
    const t0 = process.hrtime.bigint()
    const r = await call(path, method, payload)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    reuse.push(r.socketReused)
    out.push({ endpoint: id, rep: i, ms: Number(ms.toFixed(3)), status: r.status, bytes: r.bytes,
      fresh_socket: !r.socketReused })
    await new Promise((res) => setTimeout(res, 20))
  }
  console.log(id, 'done; fresh sockets:', reuse.filter(Boolean).length)
}
writeFileSync(join(OUT, 'raw-reps-keepalive.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n')
agent.destroy()
