// Headed feasibility diagnostic. Tries several launch recipes and records the exact
// stderr for each, so an "environment block" claim is evidenced rather than assumed.
// Read-only: opens chrome, does NOT navigate to the app. Closes only its own processes.
//
// usage: node headed-diag.mjs
import { spawn } from 'node:child_process'
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro'
const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock'
const OUT = path.join(ROOT, 'raw', 'headed-diag.json')
const CHROME = '/home/CNS2026495165/.cache/ms-playwright/chromium-1148/chrome-linux/chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function lockOwnerPid() { try { const m = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8').match(/(?:^|\n)\s*(?:owner_)?pid\s*[=:]\s*(\d+)/); return m ? Number(m[1]) : null } catch { return null } }
const alive = (p) => { try { return fs.existsSync(`/proc/${p}`) } catch { return false } }
async function acquire(maxMs = 300000) {
  const t0 = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(LOCK)
      fs.writeFileSync(path.join(LOCK, 'owner.txt'), `pid=${process.pid}\nts=${new Date().toISOString()}\nowner=incident2-live-repro\nline=headed feasibility diagnostic\ndir=${ROOT}\n`)
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') return false
      const h = lockOwnerPid()
      if (h != null && !alive(h)) { try { fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK); continue } catch { } }
      if (Date.now() - t0 > maxMs) return false
      await sleep(3000 + Math.random() * 3000)
    }
  }
}
function release() { try { if (lockOwnerPid() !== process.pid) return false; fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK); return true } catch { return false } }

const ENV = { ...process.env, DISPLAY: ':1', XAUTHORITY: '/run/user/1001/gdm/Xauthority' }
const res = { at: new Date().toISOString(), env: { DISPLAY: ENV.DISPLAY, XAUTHORITY: ENV.XAUTHORITY }, attempts: [] }

// ---------- attempt 1: raw chrome, headed, minimal flags (bypass Playwright) ----------
async function rawChrome(label, extraArgs) {
  const uda = `/tmp/headed-diag-${Date.now()}`
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--user-data-dir=' + uda,
    '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', ...extraArgs, 'about:blank']
  const rec = { label, kind: 'raw-chrome', args: args.filter((a) => !a.startsWith('--user-data-dir')), aliveMs: null, exitCode: null, signal: null, stderr: '' }
  const p = spawn(CHROME, args, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  p.stdout.on('data', (d) => { rec.stderr += '[out] ' + String(d) })
  p.stderr.on('data', (d) => { rec.stderr += String(d) })
  const t0 = Date.now()
  let exited = false
  p.on('exit', (code, sig) => { exited = true; rec.exitCode = code; rec.signal = sig; rec.aliveMs = Date.now() - t0 })
  await sleep(6000)
  if (!exited) {
    rec.aliveMs = Date.now() - t0
    rec.survived = true
    // confirm it is a real headed main process
    rec.proc = (() => {
      try {
        const raw = fs.readFileSync(`/proc/${p.pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
        return { pid: p.pid, hasType: /--type=/.test(raw), headless: /--headless/.test(raw) }
      } catch { return null }
    })()
    p.kill('SIGTERM')
    await sleep(1500)
    if (alive(p.pid)) p.kill('SIGKILL')
  } else { rec.survived = false }
  rec.stderr = rec.stderr.slice(0, 3000)
  res.attempts.push(rec)
}

// ---------- attempt 2..n: Playwright headed ----------
async function pwHeaded(label, opts) {
  const rec = { label, kind: 'playwright-headed', opts: { ...opts, env: undefined }, launched: false, err: null }
  try {
    const b = await chromium.launch({ headless: false, env: ENV, ...opts })
    rec.launched = true
    rec.version = b.version()
    const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
    await pg.goto('about:blank')
    rec.proc = (() => {
      const pid = (() => { try { return Number(b.process()?.pid) } catch { return null } })()
      if (!pid) return null
      try { const raw = fs.readFileSync(`/proc/${pid}/exe`, 'utf8'); return { pid } } catch { return { pid } }
    })()
    rec.exe = (() => { try { return fs.readlinkSync(`/proc/${b.process().pid}/exe`) } catch { return null } })()
    rec.visibility = await pg.evaluate(() => ({ state: document.visibilityState, focused: document.hasFocus() }))
    rec.gpu = await pg.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl'); if (!gl) return { webgl: false }; const d = gl.getExtension('WEBGL_debug_renderer_info'); return { webgl: true, renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) } }).catch(() => null)
    await b.close().catch(() => { })
  } catch (e) { rec.err = String(e && e.message).slice(0, 2500) }
  res.attempts.push(rec)
}

const got = await acquire()
res.lockAcquired = got
if (!got) { res.verdict = 'INCONCLUSIVE(lock)'; }
else {
  await rawChrome('raw-chrome-minimal', [])
  await rawChrome('raw-chrome-disable-crashpad', ['--disable-crashpad', '--disable-breakpad', '--no-crash-upload'])
  await pwHeaded('pw-headed-minimal', { args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  await pwHeaded('pw-headed-disable-crashpad', { args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crashpad', '--disable-breakpad'], chromiumSandbox: false })
  res.verdict = res.attempts.some((a) => a.survived || a.launched) ? 'HEADED-POSSIBLE' : 'HEADED-BLOCKED'
  res.lockReleased = release()
}
fs.writeFileSync(OUT, JSON.stringify(res, null, 1))
console.log(JSON.stringify({ verdict: res.verdict, lock: res.lockAcquired, attempts: res.attempts.map((a) => ({ label: a.label, survived: a.survived, launched: a.launched, aliveMs: a.aliveMs, exitCode: a.exitCode, err: a.err ? a.err.slice(0, 220) : null, stderrTail: a.stderr ? a.stderr.split('\n').filter(Boolean).slice(0, 6) : null })) }, null, 1))
