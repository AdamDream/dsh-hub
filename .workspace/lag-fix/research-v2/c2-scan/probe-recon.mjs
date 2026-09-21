import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
const log = (...a) => console.error('[recon]', ...a)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
log('launched')
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const requests = []
page.on('response', r => { const u = r.url(); if (u.endsWith('.js') || u.includes('/api/')) requests.push([r.status(), u.slice(0, 130)]) })
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
log('domcontentloaded')
await page.waitForSelector('[role="treeitem"]', { timeout: 30000 }).catch(() => log('no treeitem appeared'))
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const q = s => Array.from(document.querySelectorAll(s))
  const trees = q('[role="tree"]')
  return {
    title: document.title,
    treeCount: trees.length,
    trees: trees.map(t => ({ cls: t.className?.toString().slice(0,100), items: t.querySelectorAll('[role="treeitem"]').length, expanded: t.querySelectorAll('[role="treeitem"][aria-expanded]').length })),
    treeitemsTotal: q('[role="treeitem"]').length,
    hasBadge: q('[data-dsw-badge]').length,
    markedRows: q('[data-dsw-conn-id]').length,
    totalElements: document.getElementsByTagName('*').length,
    allButtons: q('button').length,
    buttonTexts: q('button').map(b => (b.textContent||'').trim().slice(0,20)).filter(Boolean).slice(0, 45),
  }
})
console.log(JSON.stringify(info, null, 1))
console.log('--- js/api responses ---')
console.log(requests.map(r => r.join(' ')).join('\n'))
await page.screenshot({ path: '.workspace/lag-fix/research-v2/c2-scan/recon.png' })
log('screenshot saved')
await browser.close()
