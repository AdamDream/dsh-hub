/**
 * T4 补尾：选项行上的 **Enter** 键行为（spec 的「Space（或 Enter）」另一半）。
 * 关注两点：① Enter 能否切换 aria-checked；② Enter 是否会**误提交**整张卡片（btw 选项行无 onKeyDown，
 * 若 Enter 触发了 card 级提交则属缺陷）。同时记录 Shift+Tab 反向可达性。
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire('/home/CNS2026495165/playwright_scratch/')
const { chromium } = require('playwright')

const URL_ = process.env.DSH_URL || 'http://127.0.0.1:3080'
const OUT = '/home/CNS2026495165/dsh/.workspace/btw-question/e2e-cover'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
const log = m => console.log(`[${new Date().toISOString()}] ${m}`)

const BTW_BUTTON = 'button[title="打开 btw"], button[title="关闭 btw"], button[title="收起 btw"]'
const SURFACE = '[data-side-chat-surface-mode]'
const DRAWER_INPUT = `${SURFACE} textarea[aria-label="输入一个临时问题…"]`
const CARD = `${SURFACE} section[class*="questionCard"]`
const OPTIONS = `${SURFACE} [class*="questionOptions"]`
const OPTION_BUTTONS = `${SURFACE} [class*="questionOptions"] > button`
const ASK = '请立刻调用 btw_ask_user 工具向我提一个多选问题（可同时勾选多个，multi_select 为 true）：header「调料」，问题「加哪些？」，选项「盐」「糖」。必须真实调用工具。'

const fn_checked = () => Array.from(document.querySelectorAll('[data-side-chat-surface-mode] [class*="questionOptions"] > button'))
  .map(b => ({ label: b.querySelector('[class*="questionOptionLabel"]')?.textContent ?? null, checked: b.getAttribute('aria-checked'), role: b.getAttribute('role') }))
const fn_focus = () => {
  const a = document.activeElement
  const all = Array.from(document.querySelectorAll('[data-side-chat-surface-mode] [class*="questionOptions"] > button'))
  return { tag: a?.tagName, text: (a?.textContent || '').slice(0, 30), optionIndex: all.indexOf(a), inOptionsRow: all.indexOf(a) >= 0 }
}

async function main() {
  const run = { kind: 'T4 tail: Enter key on option row', url: URL_, startedAt: new Date().toISOString(), stamp: STAMP }
  const flush = () => fs.writeFileSync(path.join(OUT, `raw-${STAMP}-T4-enter.json`), JSON.stringify(run, null, 2))
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  run.pageErrors = []
  page.on('pageerror', e => run.pageErrors.push(String(e).slice(0, 300)))
  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout: 90000 })
    run.boot = await page.evaluate(() => { const e = (window.__DSH_BOOT__.entries || []).find(x => /dsh-btw/.test(x.id)); return { rev: window.__DSH_BOOT__.rev, btwRev: e?.rev ?? null } })
    await page.locator('button[class*="newSession"]').first().click({ timeout: 20000 })
    await page.waitForSelector('textarea', { timeout: 30000 })
    const c = page.locator('textarea').first()
    await c.fill('只回复两个字：好的。'); await c.press('Enter')
    await page.waitForFunction(() => { const t = document.querySelector('textarea'); return t !== null && t.disabled === false }, null, { timeout: 120000 })
    await page.waitForSelector(BTW_BUTTON, { timeout: 120000 })
    await page.locator(BTW_BUTTON).first().click({ timeout: 20000 })
    await page.waitForSelector(DRAWER_INPUT, { timeout: 30000 })
    await page.fill(DRAWER_INPUT, ASK); await page.press(DRAWER_INPUT, 'Enter')
    await page.waitForSelector(CARD, { timeout: 90000 })
    await page.waitForTimeout(1000)
    run.roles = await fn_checkedHelper(page)
    run.cardBefore = (await page.locator(CARD).count())
    // 键盘抵达第一个选项行（锚点=抽屉内第一个可聚焦元素，composer 待答时 disabled）
    await page.evaluate(() => { const d = document.querySelector('#dsh-btw-drawer'); const cands = [...d.querySelectorAll('button, textarea, input, select, a[href], [tabindex]')].filter(el => el.disabled !== true && el.tabIndex >= 0 && el.offsetParent !== null); cands[0]?.focus() })
    let steps = 0
    while (steps < 80) {
      await page.keyboard.press('Tab'); await page.waitForTimeout(60); steps++
      if ((await page.evaluate(fn_focus)).inOptionsRow) break
    }
    run.reachedAt = (await page.evaluate(fn_focus)).inOptionsRow ? steps : null
    run.focusAtReach = await page.evaluate(fn_focus)
    run.beforeEnter = await page.evaluate(fn_checked)
    // ① Enter 键
    await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    run.afterEnter = await page.evaluate(fn_checked)
    run.cardAfterEnter = await page.locator(CARD).count()
    run.focusAfterEnter = await page.evaluate(fn_focus)
    await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-T4e-1-after-enter.png`) })
    // ② 再按 Enter
    await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    run.afterEnter2 = await page.evaluate(fn_checked)
    run.cardAfterEnter2 = await page.locator(CARD).count()
    // ③ Shift+Tab 反向可达性（从第一个选项行往前退一格，看是否仍在选项行/去了哪）
    const f0 = await page.evaluate(fn_focus)
    await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(150)
    run.afterShiftTab = await page.evaluate(fn_focus)
    await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-T4e-2-after-shifttab.png`) })
    const idx = run.focusAtReach.optionIndex
    const enterToggles = run.beforeEnter[idx]?.checked === 'false' && run.afterEnter[idx]?.checked === 'true' && run.afterEnter2[idx]?.checked === 'false'
    run.assertions = [
      { id: 'enter_toggles_checkbox', pass: enterToggles === true, detail: { focusedIndex: idx, before: run.beforeEnter[idx], afterEnter: run.afterEnter[idx], afterEnter2: run.afterEnter2[idx] } },
      { id: 'enter_does_not_submit_card', pass: run.cardAfterEnter === 1 && run.cardAfterEnter2 === 1, detail: { cardBefore: run.cardBefore, cardAfterEnter: run.cardAfterEnter, cardAfterEnter2: run.cardAfterEnter2 } },
    ]
    run.verdict = run.assertions.every(a => a.pass) ? 'PASS' : 'FAIL'
    log(`reachedAt=${run.reachedAt} verdict=${run.verdict}`)
  } catch (error) {
    run.fatalError = String(error).split('\n').slice(0, 2).join(' | '); run.verdict = 'ERROR'
    log(`FATAL ${run.fatalError}`)
    try { await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-T4e-FATAL.png`) }) } catch { /* ignore */ }
  } finally { run.finishedAt = new Date().toISOString(); flush(); await browser.close() }
  console.log(JSON.stringify({ stamp: STAMP, verdict: run.verdict, reachedAt: run.reachedAt, fatal: run.fatalError ?? null }))
}

async function fn_checkedHelper(page) { return await page.evaluate(() => document.querySelector('[data-side-chat-surface-mode] [class*="questionOptions"]')?.getAttribute('role') ?? null) }

await main()
