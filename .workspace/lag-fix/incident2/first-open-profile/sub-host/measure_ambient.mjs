// Ambient stall profile: is the burst inflation caused by the RPC workloads, or by
// host-side event-loop stalls that hit every request equally?
// Interleaved design (no time-of-day bias):
//   * width-1 sequential requests to the NO-OP control (credentials.describe, refs: [])
//   * width-4 bursts to the same no-op control
//   * width-4 bursts to settings.describe (the heavy first-open RPC)
// A no-op control that is slow ONLY under concurrency proves the cost is not in the
// request's own work. Read-only RPCs only.
import http from 'node:http'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const ROUNDS = 120
const agent = new http.Agent({ keepAlive: true, maxSockets: 32, keepAliveMsecs: 60_000 })

const CONTROL = ['control-credentials.describe([])', '/api/credentials.describe', 'credentials.describe', { refs: [] }]
const HEAVY = ['settings.describe', '/api/settings.describe', 'settings.describe', {}]

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
      res.on('end', () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: res.statusCode,
        bytes: Buffer.concat(chunks).length }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const rows = []
await call(CONTROL); await Promise.all(Array.from({ length: 4 }, () => call(CONTROL)))  // warm-up
for (let i = 1; i <= ROUNDS; i++) {
  // (a) single no-op
  const t0 = process.hrtime.bigint()
  const single = await call(CONTROL)
  const singleWall = Number(process.hrtime.bigint() - t0) / 1e6
  // (b) 4 concurrent no-ops
  const t1 = process.hrtime.bigint()
  const flat = await Promise.all(Array.from({ length: 4 }, () => call(CONTROL)))
  const flatWall = Number(process.hrtime.bigint() - t1) / 1e6
  // (c) 4 concurrent heavy
  const t2 = process.hrtime.bigint()
  const heavy = await Promise.all(Array.from({ length: 4 }, () => call(HEAVY)))
  const heavyWall = Number(process.hrtime.bigint() - t2) / 1e6
  rows.push({
    round: i,
    control_w1_ms: Number(single.ms.toFixed(3)), control_w1_wall_ms: Number(singleWall.toFixed(3)),
    control_w4_ms: flat.map((r) => Number(r.ms.toFixed(3))), control_w4_wall_ms: Number(flatWall.toFixed(3)),
    control_w4_spread_ms: Number((Math.max(...flat.map((r) => r.ms)) - Math.min(...flat.map((r) => r.ms))).toFixed(3)),
    heavy_w4_ms: heavy.map((r) => Number(r.ms.toFixed(3))), heavy_w4_wall_ms: Number(heavyWall.toFixed(3)),
  })
  await new Promise((r) => setTimeout(r, 40))
}
writeFileSync(join(OUT, 'raw-reps-ambient.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')

const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] }
for (const [label, vals] of [
  ['control width=1 (no-op)', rows.map((r) => r.control_w1_ms)],
  ['control width=4 (no-op)', rows.flatMap((r) => r.control_w4_ms)],
  ['settings.describe width=4', rows.flatMap((r) => r.heavy_w4_ms)],
]) {
  console.log(`${label.padEnd(28)} n=${vals.length}  p50=${pct(vals, 50).toFixed(2)}  p90=${pct(vals, 90).toFixed(2)}  p99=${pct(vals, 99).toFixed(2)}  max=${Math.max(...vals).toFixed(2)}`)
}
const slow = rows.filter((r) => r.control_w1_ms > 10).length
console.log(`rounds where the single no-op exceeded 10 ms: ${slow}/${rows.length}`)
agent.destroy()
