/** U8 预演：在当前（未部署 U8 的）线上构建上，用运行时注入同一条 CSS 规则，
 *  量化选中态可辨度提升，并出效果图。不修改任何部署字节。 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire('/home/CNS2026495165/playwright_scratch/')
const { chromium } = require('playwright')
const OUT = '/home/CNS2026495165/dsh/.workspace/btw-question/e2e'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
const DRAWER = '[data-side-chat-surface-mode]'
const OPTS = `${DRAWER} [class*="questionOptions"] > button`
const U8 = '.SalQ5q_questionOptionSelected .SalQ5q_questionOptionIndex{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground)}'
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
  await p.locator(OPTS).first().click()
  await p.waitForTimeout(600)
  const badgeStyle = () => p.evaluate((sel) => {
    const b = document.querySelector(sel)?.firstElementChild
    if (b === null || b === undefined) return null
    const s = getComputedStyle(b)
    return { cls: b.className, text: b.textContent, bg: s.backgroundColor, color: s.color }
  }, OPTS)
  rec.badgeBeforeU8 = await badgeStyle()
  await p.locator(OPTS).first().screenshot({ path: `${OUT}/${STAMP}-u8-off.png` })
  await p.locator(OPTS).nth(1).screenshot({ path: `${OUT}/${STAMP}-u8-off-opt2.png` })
  await p.addStyleTag({ content: U8 })
  await p.waitForTimeout(400)
  rec.badgeAfterU8 = await badgeStyle()
  await p.locator(OPTS).first().screenshot({ path: `${OUT}/${STAMP}-u8-on.png` })
  await p.locator(DRAWER).screenshot({ path: `${OUT}/${STAMP}-u8-on-drawer.png` })
  rec.ok = true
} catch (e) { rec.error = String(e).split('\n')[0] } finally {
  fs.writeFileSync(`${OUT}/${STAMP}-preview-u8.json`, JSON.stringify(rec, null, 2))
  console.log(JSON.stringify(rec, null, 1))
  await b.close()
}
