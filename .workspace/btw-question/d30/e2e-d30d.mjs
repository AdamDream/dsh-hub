/**
 * D30 真机 E2E 第四版：在同一浏览器上下文里完成「构造 → 冻结态取证 → 收起/重开 → 按停止」全流程，
 * 回答交付要求的三个可观察断言：卡片是否可见 / 界面是否报错 / 有无出路。
 * 用法：node .workspace/btw-question/d30/e2e-d30d.mjs --label probe4
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire('/home/CNS2026495165/playwright_scratch/')
const { chromium } = require('playwright')

const argOf = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  if (hit !== undefined) return hit.slice(name.length + 3)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx >= 0 && process.argv[idx + 1] !== undefined && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1]
  return fallback
}

const URL_ = process.env.DSH_URL || 'http://127.0.0.1:3080'
const LABEL = argOf('label', 'probe4')
const OUT_DIR = '/home/CNS2026495165/dsh/.workspace/btw-question/d30'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
const log = m => console.log(`[${new Date().toISOString()}] ${m}`)

const BTW_OPEN = 'button[title="打开 btw"]'
const BTW_ANY = 'button[title="打开 btw"], button[title="关闭 btw"], button[title="收起 btw"]'
const DRAWER = '[data-side-chat-surface-mode]'
const DRAWER_INPUT = `${DRAWER} textarea`
const OPTION_BUTTONS = `${DRAWER} [class*="questionOptions"] > button`
const STOP_BUTTON = `${DRAWER} button[aria-label="停止"], ${DRAWER} button[title="停止"]`

const PROMPT = '请立刻用 btw_ask_user 工具提一个「多选」问题：header 写「确认」，问题写「是否继续？」，选项分别是「继续」和「停止」。'
  + '注意：我们的抽屉前端读的是驼峰键名 multiSelect（不是 multi_select，snake_case 不生效），请务必用驼峰 multiSelect: true。只允许调用工具，不要输出解释。'

const probe = page => page.evaluate(sels => {
  const d = document.querySelector(sels.drawer)
  const text = d === null ? '' : (d.textContent || '')
  return {
    drawerPresent: d !== null,
    questionCard: d === null ? null : d.querySelector('[class*="questionCard"]') !== null,
    optionCount: d === null ? 0 : d.querySelectorAll(sels.options).length,
    stopButton: d === null ? null : d.querySelector(sels.stop) !== null,
    buttons: d === null ? [] : Array.from(d.querySelectorAll('button')).map(b => ({ title: b.getAttribute('title'), aria: b.getAttribute('aria-label'), disabled: b.disabled })),
    textareaDisabled: d === null ? null : (d.querySelector('textarea')?.disabled ?? null),
    textTail: text.replace(/\s+/gu, ' ').slice(-420),
  }
}, { drawer: DRAWER, options: OPTION_BUTTONS, stop: STOP_BUTTON })

async function main() {
  const record = { label: LABEL, url: URL_, startedAt: new Date().toISOString(), phases: [], consoleWarns: [], poisoned: [], readOk: 0, shots: [] }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  page.on('console', msg => {
    const text = msg.text()
    if (text.includes('dsh-btw') || msg.type() === 'warning' || msg.type() === 'error') {
      record.consoleWarns.push({ at: new Date().toISOString(), type: msg.type(), text })
    }
  })
  page.on('response', async response => {
    if (!response.url().includes('sideChat/read')) return
    let body = ''
    try { body = (await response.text()).slice(0, 3000) } catch { return }
    if (body.includes('boundary validation')) record.poisoned.push({ at: new Date().toISOString(), body })
    else if (body.includes('"ok":true')) record.readOk += 1
  })

  const shot = async name => {
    const file = `${OUT_DIR}/${STAMP}-${LABEL}-${name}.png`
    await page.screenshot({ path: file })
    record.shots.push(file)
  }
  const phase = async (name, extra = {}) => {
    const p = await probe(page)
    record.phases.push({ at: new Date().toISOString(), name, ...p, ...extra })
    log(`${name}: card=${p.questionCard} opts=${p.optionCount} stop=${p.stopButton} textareaDisabled=${p.textareaDisabled}`)
    return p
  }

  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout: 90000 })
    await page.locator('button[class*="newSession"]').first().click({ timeout: 20000 })
    await page.waitForSelector('textarea', { timeout: 30000 })
    try {
      await page.locator(BTW_ANY).first().waitFor({ state: 'visible', timeout: 8000 })
    } catch {
      const mainComposer = page.locator('textarea').first()
      await mainComposer.fill('只回复两个字：好的。')
      await mainComposer.press('Enter')
    }
    await page.waitForSelector(BTW_ANY, { timeout: 120000 })
    await page.locator(BTW_ANY).first().click({ timeout: 20000 })
    await page.waitForSelector(DRAWER_INPUT, { timeout: 30000 })
    await page.waitForTimeout(2500)
    await phase('1-baseline')
    await shot('1-baseline')

    await page.fill(DRAWER_INPUT, PROMPT)
    await page.press(DRAWER_INPUT, 'Enter')
    log('poison prompt sent')
    const deadline = Date.now() + 45000
    while (Date.now() < deadline && record.poisoned.length === 0) await page.waitForTimeout(2000)
    log(`poisoned reads: ${record.poisoned.length}`)
    await page.waitForTimeout(6000)
    const frozen = await phase('2-frozen')
    await shot('2-frozen')

    // Reopen path: minimize the drawer, then open it again (parked -> confirmRestore).
    try {
      await page.locator(BTW_ANY).first().click({ timeout: 10000 })
      await page.waitForTimeout(1500)
      await page.locator(BTW_OPEN).first().click({ timeout: 10000 })
      await page.waitForSelector(DRAWER_INPUT, { timeout: 20000 })
      await page.waitForTimeout(5000)
      await phase('3-after-reopen')
      await shot('3-after-reopen')
    } catch (error) {
      record.phases.push({ at: new Date().toISOString(), name: '3-after-reopen', error: String(error) })
    }

    // Escape route: press the stop button that the frozen snapshot still renders.
    const poisonedBefore = record.poisoned.length
    try {
      await page.locator(STOP_BUTTON).first().click({ timeout: 10000 })
      log('stop pressed')
    } catch (error) {
      record.phases.push({ at: new Date().toISOString(), name: '4-stop', error: String(error) })
    }
    await page.waitForTimeout(15000)
    const after = await phase('4-after-stop', { poisonedBefore, poisonedAfter: record.poisoned.length })
    await shot('4-after-stop')
    record.afterStop = {
      poisonedBefore, poisonedAfter: record.poisoned.length,
      warnBefore: record.consoleWarns.length,
      frozenCard: frozen.questionCard,
      afterCard: after.questionCard,
    }
  } catch (error) {
    record.fatal = String(error)
    log(`FATAL ${String(error)}`)
    try { await shot('9-fatal') } catch { /* ignore */ }
  } finally {
    record.transcriptReadFailedCount = record.consoleWarns.filter(w => w.text.includes('transcript read failed')).length
    console.log('SUMMARY ' + JSON.stringify({
      poisonedReads: record.poisoned.length,
      transcriptReadFailedCount: record.transcriptReadFailedCount,
      consoleWarnTypes: [...new Set(record.consoleWarns.map(w => w.type + ':' + w.text.slice(0, 60)))],
      afterStop: record.afterStop,
      phases: record.phases.map(p => ({ name: p.name, card: p.questionCard, opts: p.optionCount, stop: p.stopButton, tail: (p.textTail ?? '').slice(-160) })),
    }, null, 1))
    fs.writeFileSync(`${OUT_DIR}/${STAMP}-${LABEL}.json`, JSON.stringify(record, null, 1))
    console.log('WROTE ' + `${OUT_DIR}/${STAMP}-${LABEL}.json`)
    await browser.close()
  }
}

await main()
