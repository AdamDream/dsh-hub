// Recon: find the exact settings-button + settings-dialog DOM shape. Read-only, no clicks that mutate.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro/raw'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('[role="treeitem"]', { timeout: 60000 })
await page.waitForTimeout(3000)

const before = await page.evaluate(() => ({
  dialogs: document.querySelectorAll('[role="dialog"]').length,
  nodes: document.getElementsByTagName('*').length,
  settingsButtons: Array.from(document.querySelectorAll('button')).filter(b => /^设置$/.test((b.textContent || '').trim())).map(b => ({
    cls: String(b.className || '').slice(0, 120),
    testid: b.getAttribute('data-testid'),
    aria: b.getAttribute('aria-label'),
    title: b.getAttribute('title'),
    parentCls: String(b.parentElement?.className || '').slice(0, 120),
  })),
}))

const t0 = Date.now()
await page.locator('button', { hasText: /^设置$/ }).first().click({ timeout: 15000 })
await page.waitForTimeout(2500)
const after = await page.evaluate(() => {
  const q = (s) => Array.from(document.querySelectorAll(s))
  return {
    dialogs: q('[role="dialog"]').length,
    dialogsDetail: q('[role="dialog"]').map(d => ({
      cls: String(d.className || '').slice(0, 160),
      testid: d.getAttribute('data-testid'),
      ariaLabel: d.getAttribute('aria-label'),
      rect: (r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }))(d.getBoundingClientRect()),
      text: (d.textContent || '').trim().slice(0, 200),
    })),
    tablists: q('[role="tablist"]').length,
    tabs: q('[role="tab"]').map(t => ({ text: (t.textContent || '').trim().slice(0, 30), testid: t.getAttribute('data-testid') })).slice(0, 30),
    nodes: document.getElementsByTagName('*').length,
    // candidate panel roots
    asideDetail: q('aside').map(a => ({ cls: String(a.className || '').slice(0, 140), rect: (r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }))(a.getBoundingClientRect()), text: (a.textContent || '').trim().slice(0, 120) })),
    testids: q('[data-testid]').map(e => e.getAttribute('data-testid')).filter(Boolean).slice(0, 80),
  }
})
fs.writeFileSync(`${OUT}/recon.json`, JSON.stringify({ before, after, clickMs: Date.now() - t0 }, null, 1))
console.log(JSON.stringify({ before, afterClickMs: Date.now() - t0, after }, null, 1))
await page.screenshot({ path: `${OUT}/recon-settings.png`, fullPage: false })
await browser.close()
