import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
const log = (...a) => console.error('[set]', ...a)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('[role="treeitem"]', { timeout: 30000 })
await page.waitForTimeout(2000)
// click 设置
const btn = page.locator('button', { hasText: /^设置$/ }).first()
await btn.click({ timeout: 10000 }).catch(e => log('click failed', e.message))
await page.waitForTimeout(2000)
const dump = await page.evaluate(() => {
  const q = s => Array.from(document.querySelectorAll(s))
  const settingsish = q('[role="dialog"], [role="tablist"], [data-settings], section, aside').map(e => ({
    tag: e.tagName, role: e.getAttribute('role'), cls: String(e.className||'').slice(0,60), text: (e.textContent||'').trim().slice(0,60)
  })).slice(0, 25)
  return {
    dialogs: q('[role="dialog"]').length,
    tablists: q('[role="tablist"]').length,
    tabs: q('[role="tab"],[role="tablist"] *').map(t => ({ tag: t.tagName, role: t.getAttribute('role'), text: (t.textContent||'').trim().slice(0,24), cls: String(t.className||'').slice(0,50) })).slice(0, 40),
    buttons: q('button').map(b => (b.textContent||'').trim().slice(0,22)).filter(Boolean).slice(0, 60),
    total: document.getElementsByTagName('*').length,
    settingsish,
  }
})
console.log(JSON.stringify(dump, null, 1))
await page.screenshot({ path: '.workspace/lag-fix/research-v2/c2-scan/settings-open.png' })
log('done')
await browser.close()
