// Launch a browser briefly and dump the exact /proc cmdline shapes so the census can
// distinguish the browser MAIN process from helpers, by exe + argv (no pgrep -f).
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const HEADED = process.argv.includes('--headed')
const b = await chromium.launch({
  headless: !HEADED,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
})
const page = await (await b.newContext()).newPage()
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })

const rows = []
for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
  let exe = null
  try { exe = fs.readlinkSync(`/proc/${pid}/exe`) } catch { continue }
  if (!/(chrome|chromium|headless_shell)$/.test(exe)) continue
  let argv = []
  try { argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean) } catch { }
  const typeArg = argv.find((a) => a.startsWith('--type=')) || null
  rows.push({
    pid: Number(pid), exe: exe.split('/').slice(-2).join('/'),
    type: typeArg, hasPipe: argv.includes('--remote-debugging-pipe'),
    browserPid: argv.find((a) => a.startsWith('--browser-pid=')) || null,
    argc: argv.length,
    headlessArg: argv.filter((a) => /headless|ozone|use-gl|use-angle|disable-gpu|in-process-gpu|gpu/.test(a)),
  })
}
rows.sort((a, b2) => a.pid - b2.pid)
fs.writeFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro/raw/procshapes.json', JSON.stringify({ headed: HEADED, rows }, null, 1))
for (const r of rows) console.log(JSON.stringify(r))
await b.close()
