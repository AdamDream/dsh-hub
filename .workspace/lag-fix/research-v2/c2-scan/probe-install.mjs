import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
const log = (...a) => console.error('[inst]', ...a)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const scripts = []
page.on('response', r => { const u = r.url(); if (/\.js($|\?)/.test(u)) scripts.push(r.status() + ' ' + u.slice(0, 150)) })
// instrument BEFORE any page script: count MutationObserver constructions/observes
await page.addInitScript(() => {
  window.__inst = { constructed: 0, observes: [], badge: 0 }
  const Real = window.MutationObserver
  window.MutationObserver = class extends Real {
    constructor(cb) { super(cb); window.__inst.constructed++; this.__cb = cb }
    observe(target, opts) {
      const rec = { target: target === document.body ? 'body' : target === document.documentElement ? 'html' : (target?.nodeName + '#' + (target?.id||'') + '.' + String(target?.className||'').slice(0,40)), opts: JSON.stringify(opts) }
      window.__inst.observes.push(rec)
      return super.observe(target, opts)
    }
  }
})
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('[role="treeitem"]', { timeout: 30000 }).catch(() => log('no treeitem'))
await page.waitForTimeout(3000)
const r = await page.evaluate(() => ({
  inst: window.__inst,
  boot: window.__DSH_BOOT__ ? Object.keys(window.__DSH_BOOT__) : null,
  scriptsLoaded: Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src')).slice(0, 40),
  linkModules: Array.from(document.querySelectorAll('link[rel=modulepreload],link[rel=preload]')).map(l => l.getAttribute('href')).slice(0, 40),
  hasClientJs: performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('workspace-enhancement') || n.includes('client.js')).slice(0, 20),
  resources: performance.getEntriesByType('resource').map(e => e.name.replace(/^http:\/\/127\.0\.0\.1:3080/, '')).slice(0, 60),
}))
console.log(JSON.stringify(r, null, 1))
log('scripts:', scripts.join('\n  '))
await browser.close()
