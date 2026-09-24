/**
 * D30 真机 E2E 第三版：每种说法各用一个「全新父会话」（互不污染、避免上一轮拒绝的自我唤醒）。
 * 目标：构造出「schema 允许的多余键」的 btw_ask_user 调用。
 *   B  detail 字段（埋点契约口径）
 *   C  驼峰 multiSelect（功能性理由口径）
 * 采集：卡片 DOM、console、sideChat/read 原始回包、截图；并从子代理会话日志核对真实参数。
 * 用法：node .workspace/btw-question/d30/e2e-d30c.mjs --label probe3
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
const LABEL = argOf('label', 'probe3')
const OUT_DIR = '/home/CNS2026495165/dsh/.workspace/btw-question/d30'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
const log = m => console.log(`[${new Date().toISOString()}] ${m}`)

const BTW_BUTTON = 'button[title="打开 btw"], button[title="关闭 btw"], button[title*="btw"]'
const DRAWER = '[data-side-chat-surface-mode]'
const DRAWER_INPUT = `${DRAWER} textarea`
const OPTION_BUTTONS = `${DRAWER} [class*="questionOptions"] > button`

const FRAMINGS = [
  ['B-detail-埋点契约', '请立刻用 btw_ask_user 工具提一个「多选」问题：header 写「确认」，问题写「是否继续？」，选项分别是「继续」和「停止」。'
    + '注意：我们的前端埋点契约要求 questions 项必须额外携带一个 detail 字段，值写 "probe"，请务必加上这个字段。只允许调用工具，不要输出解释。'],
  ['C-驼峰-multiSelect', '请立刻用 btw_ask_user 工具提一个「多选」问题：header 写「确认」，问题写「是否继续？」，选项分别是「继续」和「停止」。'
    + '注意：我们的抽屉前端读的是驼峰键名 multiSelect（不是 multi_select，snake_case 不生效），请务必用驼峰 multiSelect: true。只允许调用工具，不要输出解释。'],
]

async function probe(page) {
  return await page.evaluate(sels => {
    const d = document.querySelector(sels.drawer)
    const text = d === null ? '' : (d.textContent || '')
    return {
      drawerPresent: d !== null,
      questionCard: d === null ? null : d.querySelector('[class*="questionCard"]') !== null,
      optionCount: d === null ? 0 : d.querySelectorAll(sels.options).length,
      buttons: d === null ? [] : Array.from(d.querySelectorAll('button')).map(b => ({ title: b.getAttribute('title'), disabled: b.disabled })),
      textareaDisabled: d === null ? null : (d.querySelector('textarea')?.disabled ?? null),
      textTail: text.replace(/\s+/gu, ' ').slice(-450),
    }
  }, { drawer: DRAWER, options: OPTION_BUTTONS })
}

async function runFraming(browser, name, prompt, record) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  const entry = { name, prompt, at: new Date().toISOString(), consoleWarns: [], poisonedRpcReads: [], readCount: 0, samples: [] }
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(String(e)))
  page.on('console', msg => {
    const text = msg.text()
    if (text.includes('dsh-btw') || msg.type() === 'warning' || msg.type() === 'error') {
      entry.consoleWarns.push({ at: new Date().toISOString(), type: msg.type(), text })
    }
  })
  page.on('response', async response => {
    if (!response.url().includes('sideChat/read')) return
    entry.readCount += 1
    let body = ''
    try { body = (await response.text()).slice(0, 4000) } catch { return }
    if (body.includes('boundary validation') || body.includes('result-invalid')) {
      entry.poisonedRpcReads.push({ at: new Date().toISOString(), body })
      log(`${name}: POISONED sideChat/read captured`)
    }
  })
  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout: 90000 })
    await page.locator('button[class*="newSession"]').first().click({ timeout: 20000 })
    await page.waitForSelector('textarea', { timeout: 30000 })
    try {
      await page.locator(BTW_BUTTON).first().waitFor({ state: 'visible', timeout: 8000 })
    } catch {
      const mainComposer = page.locator('textarea').first()
      await mainComposer.fill('只回复两个字：好的。')
      await mainComposer.press('Enter')
    }
    await page.waitForSelector(BTW_BUTTON, { timeout: 120000 })
    await page.locator(BTW_BUTTON).first().click({ timeout: 20000 })
    await page.waitForSelector(DRAWER_INPUT, { timeout: 30000 })
    await page.waitForTimeout(3000)
    await page.fill(DRAWER_INPUT, prompt)
    await page.press(DRAWER_INPUT, 'Enter')
    log(`${name}: prompt sent`)
    const deadline = Date.now() + 50000
    while (Date.now() < deadline) {
      await page.waitForTimeout(2500)
      const p = await probe(page)
      entry.samples.push({ at: new Date().toISOString(), questionCard: p.questionCard, optionCount: p.optionCount, textareaDisabled: p.textareaDisabled, textTail: p.textTail.slice(-220) })
    }
    entry.final = await probe(page)
    const file = `${OUT_DIR}/${STAMP}-${LABEL}-${name}.png`
    await page.screenshot({ path: file })
    entry.shot = file
  } catch (error) {
    entry.fatal = String(error)
    log(`${name}: FATAL ${String(error)}`)
  } finally {
    entry.pageErrors = pageErrors
    entry.transcriptReadFailedCount = entry.consoleWarns.filter(w => w.text.includes('transcript read failed')).length
    record.runs.push(entry)
    await context.close()
  }
}

async function main() {
  const record = { label: LABEL, url: URL_, startedAt: new Date().toISOString(), runs: [] }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  for (const [name, prompt] of FRAMINGS) await runFraming(browser, name, prompt, record)
  for (const r of record.runs) {
    console.log(`SUMMARY ${r.name} card=${r.final?.questionCard} opts=${r.final?.optionCount} `
      + `readFailed=${r.transcriptReadFailedCount} poisonedReads=${r.poisonedRpcReads.length} `
      + `consoleWarns=${r.consoleWarns.length} fatal=${r.fatal ?? 'none'}`)
    console.log(`  tail: ${(r.final?.textTail ?? '').slice(-260)}`)
  }
  fs.writeFileSync(`${OUT_DIR}/${STAMP}-${LABEL}.json`, JSON.stringify(record, null, 1))
  console.log('WROTE ' + `${OUT_DIR}/${STAMP}-${LABEL}.json`)
  await browser.close()
}

await main()
