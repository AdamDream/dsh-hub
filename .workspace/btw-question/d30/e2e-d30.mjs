/**
 * D30 真机 E2E：让 btw 子代理用「schema 允许的多余键」调用 btw_ask_user，
 * 观察 (1) 问答卡片是否出现、(2) 控制台是否出现 [dsh-btw] transcript read failed、
 * (3) sideChat/read 的 RPC 回包形态、(4) 子代理是否一直 running、(5) 界面是否报错。
 *
 * 只读驱动，不改任何源码/配置；结束后临时会话保留。
 * 用法：node .workspace/btw-question/d30/e2e-d30.mjs --label probe
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
const LABEL = argOf('label', 'probe')
const OUT_DIR = '/home/CNS2026495165/dsh/.workspace/btw-question/d30'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
fs.mkdirSync(OUT_DIR, { recursive: true })
const log = m => console.log(`[${new Date().toISOString()}] ${m}`)

const BTW_BUTTON = 'button[title="打开 btw"], button[title="关闭 btw"], button[title*="btw"]'
const DRAWER = '[data-side-chat-surface-mode]'
const DRAWER_INPUT = `${DRAWER} textarea`
const OPTION_BUTTONS = `${DRAWER} [class*="questionOptions"] > button`
const KICKOFF_PROMPT = '只回复两个字：好的。'

const PROMPT_1 = '请立刻调用 btw_ask_user 工具，参数必须逐字照抄下面这段 JSON，一个字都不要删改（尤其 detail 字段必须原样保留）：'
  + '{"questions":[{"id":"q1","question":"是否继续？","header":"确认","options":[{"label":"继续"},{"label":"停止"}],"detail":"probe"}]}'
  + ' 只允许调用工具，不要输出任何解释。'
const PROMPT_2 = '请立刻调用 btw_ask_user 工具，参数必须逐字照抄下面这段 JSON，一个字都不要删改（尤其 multiSelect 这个键必须原样保留，不要改成 multi_select）：'
  + '{"questions":[{"id":"q1","question":"是否继续？","header":"确认","options":[{"label":"继续"},{"label":"停止"}],"multiSelect":true}]}'
  + ' 只允许调用工具，不要输出任何解释。'

async function probe(page) {
  return await page.evaluate((sels) => {
    const { drawer, options } = sels
    const d = document.querySelector(drawer)
    const text = d === null ? '' : (d.textContent || '')
    return {
      drawerPresent: d !== null,
      surfaceMode: d === null ? null : d.getAttribute('data-side-chat-surface-mode'),
      questionCard: d === null ? null : d.querySelector('[class*="questionCard"]') !== null,
      optionCount: d === null ? 0 : d.querySelectorAll(options).length,
      buttons: d === null ? [] : Array.from(d.querySelectorAll('button')).map(b => ({
        title: b.getAttribute('title'), aria: b.getAttribute('aria-label'), disabled: b.disabled,
      })),
      textareaDisabled: d === null ? null : (d.querySelector('textarea')?.disabled ?? null),
      hasErrorText: /失败|错误|error/i.test(text),
      textTail: text.replace(/\s+/gu, ' ').slice(-400),
    }
  }, { drawer: DRAWER, options: OPTION_BUTTONS })
}

async function main() {
  const record = { label: LABEL, url: URL_, startedAt: new Date().toISOString(), steps: [], consoleWarns: [], rpcReads: [], probes: [], shots: [] }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  record.browserVersion = browser.version()
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(String(e)))

  page.on('console', msg => {
    const text = msg.text()
    if (text.includes('dsh-btw') || msg.type() === 'warning' || msg.type() === 'error') {
      record.consoleWarns.push({ at: new Date().toISOString(), type: msg.type(), text })
    }
  })
  page.on('response', async response => {
    const url = response.url()
    if (!url.includes('sideChat/read')) return
    let body = ''
    try { body = (await response.text()).slice(0, 2000) } catch { /* gone */ }
    record.rpcReads.push({ at: new Date().toISOString(), status: response.status(), body })
  })

  const shot = async (name) => {
    const file = `${OUT_DIR}/${STAMP}-${LABEL}-${name}.png`
    await page.screenshot({ path: file, fullPage: false })
    record.shots.push(file)
    log(`shot ${file}`)
  }

  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout: 90000 })
    log('boot ok')

    await page.locator('button[class*="newSession"]').first().click({ timeout: 20000 })
    await page.waitForSelector('textarea', { timeout: 30000 })
    try {
      await page.locator(BTW_BUTTON).first().waitFor({ state: 'visible', timeout: 8000 })
    } catch {
      const mainComposer = page.locator('textarea').first()
      await mainComposer.fill(KICKOFF_PROMPT)
      await mainComposer.press('Enter')
      log('kickoff sent')
    }
    await page.waitForSelector(BTW_BUTTON, { timeout: 120000 })
    log('btw button present')

    await page.locator(BTW_BUTTON).first().click({ timeout: 20000 })
    await page.waitForSelector(DRAWER_INPUT, { timeout: 30000 })
    log('drawer open')

    // Baseline probe before the poisoned call.
    record.probes.push({ at: new Date().toISOString(), phase: 'baseline', ...(await probe(page)) })
    await shot('1-drawer-open')

    const prompts = [[1, PROMPT_1], [2, PROMPT_2]]
    let called = false
    for (const [attempt, prompt] of prompts) {
      await page.fill(DRAWER_INPUT, prompt)
      await page.press(DRAWER_INPUT, 'Enter')
      log(`poison prompt sent (attempt ${attempt})`)
      record.steps.push({ step: `prompt ${attempt} sent`, at: new Date().toISOString() })
      // Watch 60 s: does ANY question card appear?
      const deadline = Date.now() + 60000
      while (Date.now() < deadline) {
        await page.waitForTimeout(3000)
        const p = await probe(page)
        record.probes.push({ at: new Date().toISOString(), phase: `attempt${attempt}`, ...p })
        if (p.questionCard) { called = true; break }
      }
      if (called) break
      log(`attempt ${attempt}: no question card in 60s`)
      await shot(`2-attempt${attempt}-no-card`)
    }

    // Observation window after the poisoned call: 30 s of sampling.
    const obsEnd = Date.now() + 30000
    while (Date.now() < obsEnd) {
      await page.waitForTimeout(5000)
      record.probes.push({ at: new Date().toISOString(), phase: 'observe', ...(await probe(page)) })
    }
    await shot('3-observe')

    // Try the parked-restore path: close the drawer then reopen it.
    try {
      const closeBtn = page.locator(BTW_BUTTON).first()
      await closeBtn.click({ timeout: 10000 })
      await page.waitForTimeout(1500)
      await closeBtn.click({ timeout: 10000 })
      await page.waitForSelector(DRAWER_INPUT, { timeout: 20000 })
      await page.waitForTimeout(4000)
      record.probes.push({ at: new Date().toISOString(), phase: 'after-reopen', ...(await probe(page)) })
      await shot('4-after-reopen')
    } catch (error) {
      record.steps.push({ step: 'reopen failed', error: String(error) })
    }

    record.called = called
    record.pageErrors = pageErrors
  } catch (error) {
    record.fatal = String(error)
    log(`FATAL ${String(error)}`)
    try { await shot('9-fatal') } catch { /* ignore */ }
  } finally {
    record.consoleWarnCount = record.consoleWarns.length
    record.transcriptReadFailedCount = record.consoleWarns.filter(w => w.text.includes('transcript read failed')).length
    record.rpcReadCount = record.rpcReads.length
    const summary = {
      label: record.label, called: record.called, fatal: record.fatal,
      transcriptReadFailedCount: record.transcriptReadFailedCount,
      consoleWarnCount: record.consoleWarnCount, rpcReadCount: record.rpcReadCount,
      lastProbe: record.probes.at(-1), anyQuestionCard: record.probes.some(p => p.questionCard === true),
    }
    console.log('SUMMARY ' + JSON.stringify(summary, null, 1))
    fs.writeFileSync(`${OUT_DIR}/${STAMP}-${LABEL}.json`, JSON.stringify(record, null, 1))
    console.log('WROTE ' + `${OUT_DIR}/${STAMP}-${LABEL}.json`)
    await browser.close()
  }
}

await main()
