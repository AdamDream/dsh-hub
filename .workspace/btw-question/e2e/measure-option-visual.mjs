/** 元素级取证：btw 提问卡片选项行的「选中态可感知度」——计算样式 + 元素截图（点选前后）。 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire('/home/CNS2026495165/playwright_scratch/')
const { chromium } = require('playwright')
const OUT = '/home/CNS2026495165/dsh/.workspace/btw-question/e2e'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
const DRAWER = '[data-side-chat-surface-mode]'
const OPTS = `${DRAWER} [class*="questionOptions"] > button`
const PROMPT = '请立刻调用 btw_ask_user 工具向我提一个问题：单选，header「确认」，问题「是否继续？」，选项「继续」「停止」。必须真实调用工具。'
const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] })
const p = await (await b.newContext({ viewport:{width:1440,height:900}, locale:'zh-CN' })).newPage()
const rec = { stamp: STAMP }
try {
  await p.goto('http://127.0.0.1:3080', { waitUntil:'domcontentloaded', timeout:60000 })
  await p.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout:90000 })
  await p.locator('button[class*="newSession"]').first().click()
  await p.waitForSelector('textarea', { timeout:30000 })
  const main = p.locator('textarea').first()
  await main.fill('只回复两个字：好的。'); await main.press('Enter')
  await p.waitForSelector('button[title="打开 btw"], button[title="关闭 btw"]', { timeout:120000 })
  await p.locator('button[title="打开 btw"], button[title="关闭 btw"]').first().click()
  await p.waitForSelector(`${DRAWER} textarea[aria-label="输入一个临时问题…"]`, { timeout:30000 })
  const ta = p.locator(`${DRAWER} textarea[aria-label="输入一个临时问题…"]`)
  await ta.fill(PROMPT); await ta.press('Enter')
  await p.waitForSelector(OPTS, { timeout:90000 })
  await p.waitForTimeout(300)
  const probe = () => p.evaluate((sel) => {
    const card = document.querySelector(sel.split(' ')[0])
    const opts = Array.from(document.querySelectorAll(sel))
    const badge = opts[0]?.firstElementChild ?? null
    const cs = (el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, border: s.borderTopColor, color: s.color, radius: s.borderRadius, minH: s.minHeight, pad: s.padding } }
    return {
      card: cs(card), cardBgImage: getComputedStyle(card).backgroundColor,
      opt: opts.map(o => ({ cls: o.className, ariaChecked: o.getAttribute('aria-checked'), role: o.getAttribute('role'), ...cs(o) })),
      badge: badge === null ? null : { cls: badge.className, text: badge.textContent, ...cs(badge) },
      cardRect: card.getBoundingClientRect().toJSON(), optRects: opts.map(o => o.getBoundingClientRect().toJSON()),
    }
  }, OPTS)
  rec.before = await probe()
  await p.locator(OPTS).first().screenshot({ path: `${OUT}/${STAMP}-opt1-before.png` })
  await p.locator(OPTS).nth(1).screenshot({ path: `${OUT}/${STAMP}-opt2-before.png` })
  await p.locator(OPTS).first().click()
  await p.waitForTimeout(600)
  rec.after = await probe()
  await p.locator(OPTS).first().screenshot({ path: `${OUT}/${STAMP}-opt1-after.png` })
  await p.locator(OPTS).nth(1).screenshot({ path: `${OUT}/${STAMP}-opt2-after.png` })
  await p.locator(DRAWER).screenshot({ path: `${OUT}/${STAMP}-drawer-after.png` })
  rec.ok = true
} catch (e) { rec.error = String(e).split('\n')[0] } finally {
  fs.writeFileSync(`${OUT}/${STAMP}-optvisual.json`, JSON.stringify(rec, null, 2))
  console.log(JSON.stringify({ ok: rec.ok ?? false, error: rec.error ?? null, before: rec.before?.opt?.[0], after: rec.after?.opt?.[0], badge: rec.after?.badge ?? rec.before?.badge, card: rec.before?.card }, null, 1))
  await b.close()
}
