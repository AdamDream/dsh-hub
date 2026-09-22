// Concurrency discrimination probe.
// Q: in the mixed first-open burst every RPC showed the SAME inflated latency
//    (~40-75ms), including the 298-byte credentials.describe. Two explanations:
//    (a) one RPC's own synchronous work blocks the loop for the others,
//    (b) an EXTERNAL blocker stalls the loop while all four are in flight.
// This probe fires N CONCURRENT IDENTICAL requests per endpoint, so each endpoint is
// measured both as blocker and as victim, plus a cheap control (credentials.describe
// with refs=[]). Read-only RPCs only.
import http from 'node:http'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const REPS = 15
const WIDTH = 4
const agent = new http.Agent({ keepAlive: true, maxSockets: 32, keepAliveMsecs: 60_000 })

const TARGETS = [
  ['settings.describe', '/api/settings.describe', 'settings.describe', {}],
  ['pluginInventory.list', '/api/pluginInventory/list', 'pluginInventory/list', { args: {} }],
  ['llm.providers', '/api/llm.providers', 'llm.providers', {}],
  ['credentials.describe(3 refs)', '/api/credentials.describe', 'credentials.describe',
    { refs: ['DEEPSEEK_API_KEY', 'ADAM_API_KEY', 'OPENCODE_GO_API_KEY'] }],
  ['credentials.describe(0 refs) CONTROL', '/api/credentials.describe', 'credentials.describe', { refs: [] }],
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
for (const target of TARGETS) {
  await Promise.all(Array.from({ length: WIDTH }, () => call(target)))  // warm-up
  for (let i = 1; i <= REPS; i++) {
    const t0 = process.hrtime.bigint()
    const settled = await Promise.all(Array.from({ length: WIDTH }, () => call(target)))
    const wall = Number(process.hrtime.bigint() - t0) / 1e6
    const ms = settled.map((s) => Number(s.ms.toFixed(2)))
    out.push({ endpoint: target[0], rep: i, width: WIDTH, wall_ms: Number(wall.toFixed(2)),
      ms, spread_ms: Number((Math.max(...ms) - Math.min(...ms)).toFixed(2)) })
    await new Promise((r) => setTimeout(r, 60))
  }
  const rows = out.filter((r) => r.endpoint === target[0])
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]
  console.log(`${target[0].padEnd(36)} median(per-req of ${WIDTH} concurrent) = ${med(rows.flatMap((r) => r.ms)).toFixed(2)} ms  median(wall) = ${med(rows.map((r) => r.wall_ms)).toFixed(2)} ms  median(spread) = ${med(rows.map((r) => r.spread_ms)).toFixed(2)} ms`)
}
writeFileSync(join(OUT, 'raw-reps-concurrent.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n')
agent.destroy()
