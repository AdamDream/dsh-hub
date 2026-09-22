// Loop-availability probe: how often is the HOST event loop unavailable, and is the
// stall periodic? Issues the cheapest possible read-only RPC (credentials.describe with
// refs: []) back-to-back for ~20 s on one keep-alive socket and records monotonic
// timestamps, so a stall shows up as a long request plus the wall gap it creates.
import http from 'node:http'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const DURATION_MS = 20_000
const agent = new http.Agent({ keepAlive: true, maxSockets: 1, keepAliveMsecs: 60_000 })
const PATH = '/api/credentials.describe'
const METHOD = 'credentials.describe'
const PAYLOAD = { refs: [] }

function call() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'hb', method: METHOD, payload: PAYLOAD })
    const t0 = process.hrtime.bigint()
    const req = http.request({
      host: '127.0.0.1', port: 3080, path: PATH, method: 'POST', agent,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      res.resume()
      res.on('end', () => resolve({ t_ms: Number(process.hrtime.bigint() - T0) / 1e6,
        ms: Number(process.hrtime.bigint() - t0) / 1e6, status: res.statusCode }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const T0 = process.hrtime.bigint()
await call()  // warm-up
const samples = []
while (Number(process.hrtime.bigint() - T0) / 1e6 < DURATION_MS) samples.push(await call())
writeFileSync(join(OUT, 'raw-heartbeat.jsonl'), samples.map((s) => JSON.stringify(s)).join('\n') + '\n')

const lat = samples.map((s) => s.ms).sort((a, b) => a - b)
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p / 100 * lat.length))]
console.log(`n=${samples.length} samples over ${(Number(process.hrtime.bigint() - T0) / 1e6 / 1000).toFixed(1)} s`)
console.log(`latency ms: p50=${q(50).toFixed(2)} p90=${q(90).toFixed(2)} p99=${q(99).toFixed(2)} max=${lat[lat.length - 1].toFixed(2)}`)
const slow = samples.filter((s) => s.ms > 20)
console.log(`samples > 20 ms: ${slow.length} (${(100 * slow.length / samples.length).toFixed(1)}%)`)
// stall episode detection: consecutive slow samples collapse into one episode; report episode start times
const episodes = []
let prev = null
for (const s of samples) {
  if (s.ms > 20) {
    if (prev === null) episodes.push([s.t_ms, s.ms])
    else episodes[episodes.length - 1][1] = Math.max(episodes[episodes.length - 1][1], s.ms)
    prev = s
  } else prev = null
}
console.log(`stall episodes (>20 ms): ${episodes.length}`)
if (episodes.length > 1) {
  const gaps = episodes.slice(1).map((e, i) => e[0] - episodes[i][0]).sort((a, b) => a - b)
  console.log(`episode-start spacing ms: min=${gaps[0].toFixed(1)} p50=${gaps[Math.floor(gaps.length / 2)].toFixed(1)} max=${gaps[gaps.length - 1].toFixed(1)}`)
}
console.log('first 12 episodes (start_ms, worst_ms):', episodes.slice(0, 12).map(([t, m]) => `${t.toFixed(0)}/${m.toFixed(0)}`).join(' '))
agent.destroy()
