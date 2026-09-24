/**
 * btw 问答卡片「点选颜色不持久」端到端复现/验证器。
 *
 * 流程：打开 GUI → 新建临时会话 → 打开 btw 抽屉 → 让侧聊调用 btw_ask_user 提问
 *      → 点选第一个选项 → 50ms 采样 3s（aria-checked〔旧包回退 aria-pressed〕+ 计算样式）
 *      → 截图 + JSON 判定。
 *
 * 用法：
 *   node .workspace/btw-question/e2e/repro-btw-question.mjs --label before
 *   node .workspace/btw-question/e2e/repro-btw-question.mjs --label after --hold-ms 4000
 *
 * 判定：点击后选中态（aria-checked，旧包回退 aria-pressed）是否在整个观察窗内保持 true。
 *   PERSISTED  = 全程 true（修复后期望）
 *   REVERTED   = 在 t=Xms 翻回 false（修复前期望，X 应 ≈ 轮询间隔 220/700ms）
 *   NEVER-ON   = 点击后从未变 true（点击根本没生效）
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

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
const LABEL = argOf('label', 'run')
const HOLD_MS = Number(argOf('hold-ms', '3000'))
const SAMPLE_MS = Number(argOf('sample-ms', '50'))
const OUT_DIR = '/home/CNS2026495165/dsh/.workspace/btw-question/e2e'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')

fs.mkdirSync(OUT_DIR, { recursive: true })
const log = m => console.log(`[${new Date().toISOString()}] ${m}`)

const BTW_BUTTON = 'button[title="打开 btw"], button[title="关闭 btw"]'
const DRAWER = '[data-side-chat-surface-mode]'
const DRAWER_INPUT = `${DRAWER} textarea[aria-label="输入一个临时问题…"]`
const OPTION_BUTTONS = `${DRAWER} [class*="questionOptions"] > button`

const KICKOFF_PROMPT = '只回复两个字：好的。'
const PROMPT = '请立刻调用 btw_ask_user 工具向我提一个问题：单选（single select），header 写「确认」，问题写「是否继续？」，选项分别是「继续」和「停止」。必须真实调用工具，不要用纯文字代替。'
const PROMPT_RETRY = '你上一次没有调用工具。请现在立刻调用 btw_ask_user 工具：单选题，header「确认」，问题「是否继续？」，选项「继续」和「停止」。只允许调用工具，不要输出解释。'

async function snapshotOption(page) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const cs = getComputedStyle(el)
    // 2026-09-23: the card now uses the official ARIA contract
    // (role=radio|checkbox + aria-checked). Keep the aria-pressed read as a
    // fallback so the same sampler also works against the pre-fix bundle.
    const checked = el.getAttribute('aria-checked')
    const pressed = el.getAttribute('aria-pressed')
    return {
      text: (el.textContent || '').slice(0, 60),
      className: el.className,
      ariaChecked: checked,
      ariaPressed: pressed,
      active: checked !== null ? checked === 'true' : pressed === 'true',
      selectedClass: /questionOptionSelected/u.test(String(el.className)),
      role: el.getAttribute('role'),
      background: cs.backgroundColor,
      borderColor: cs.borderTopColor,
      color: cs.color,
    }
  }, OPTION_BUTTONS)
}

async function main() {
  const record = { label: LABEL, url: URL_, startedAt: new Date().toISOString(), holdMs: HOLD_MS, sampleMs: SAMPLE_MS, steps: [], samples: [], shots: [] }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(String(e)))
  record.browserVersion = browser.version()

  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout: 90000 })
    record.steps.push({ step: 'boot', at: new Date().toISOString() })
    log('boot ok')

    // ---- 1. 新建临时会话（不污染用户既有会话）
    // 注意：点「新会话」后主区是空态落地页（无会话头 ⇒ 无 btw 按钮），
    // 必须先发一条最小主会话消息把会话真正开起来，会话头才会挂上 btw 按钮。
    const newBtn = page.locator('button[class*="newSession"]')
    await newBtn.first().click({ timeout: 20000 })
    await page.waitForSelector('textarea', { timeout: 30000 })
    record.steps.push({ step: 'new-session clicked', at: new Date().toISOString() })
    log('new session draft created')

    const btwButton = page.locator(BTW_BUTTON).first()
    try {
      await btwButton.waitFor({ state: 'visible', timeout: 8000 })
    } catch {
      // 空态落地页没有会话头：发一条最小消息开启会话
      const mainComposer = page.locator('textarea').first()
      await mainComposer.fill(KICKOFF_PROMPT)
      await mainComposer.press('Enter')
      log('kickoff message sent to open the conversation')
      record.steps.push({ step: 'kickoff sent', at: new Date().toISOString() })
    }
    await page.waitForSelector(BTW_BUTTON, { timeout: 120000 })
    record.steps.push({ step: 'btw button present', at: new Date().toISOString() })
    log('conversation open, btw button present')

    // ---- 2. 打开 btw 抽屉
    await page.locator(BTW_BUTTON).first().click({ timeout: 20000 })
    await page.waitForSelector(DRAWER_INPUT, { timeout: 30000 })
    record.steps.push({ step: 'drawer open', at: new Date().toISOString() })
    log('drawer open')

    // ---- 3. 触发 btw_ask_user
    let optionSeen = false
    for (const [attempt, prompt] of [[1, PROMPT], [2, PROMPT_RETRY]]) {
      await page.fill(DRAWER_INPUT, prompt)
      await page.press(DRAWER_INPUT, 'Enter')
      log(`prompt sent (attempt ${attempt})`)
      try {
        await page.waitForSelector(OPTION_BUTTONS, { timeout: 75000 })
        optionSeen = true
        record.steps.push({ step: `options appeared (attempt ${attempt})`, at: new Date().toISOString() })
        break
      } catch {
        log(`attempt ${attempt}: no options within 75s`)
        record.steps.push({ step: `attempt ${attempt} timed out`, at: new Date().toISOString() })
      }
    }
    if (!optionSeen) throw new Error('no question card appeared after 2 attempts')

    const optionCount = await page.locator(OPTION_BUTTONS).count()
    record.optionCount = optionCount
    record.optionsAtStart = await page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map(el => ({
      text: (el.textContent || '').slice(0, 40),
      role: el.getAttribute('role'),
      ariaChecked: el.getAttribute('aria-checked'),
      ariaPressed: el.getAttribute('aria-pressed'),
      className: el.className,
    })), OPTION_BUTTONS)
    log(`question card visible: ${optionCount} option(s)`)

    const shot = async (name) => {
      const file = path.join(OUT_DIR, `${STAMP}-${LABEL}-${name}.png`)
      await page.screenshot({ path: file })
      record.shots.push(file)
      return file
    }
    await shot('1-before-click')

    record.beforeClick = await snapshotOption(page)

    // ---- 4. 点选第一个选项并按 50ms 采样
    const t0 = Date.now()
    await page.locator(OPTION_BUTTONS).first().click({ timeout: 10000 })
    record.clickAt = new Date().toISOString()
    log('clicked option #1 — sampling')

    await shot('2-after-click-200ms')
    let firstOn = null
    let firstOff = null
    while (Date.now() - t0 < HOLD_MS) {
      const s = await snapshotOption(page)
      const elapsed = Date.now() - t0
      const on = s?.active === true
      record.samples.push({
        ms: elapsed,
        active: on,
        ariaChecked: s?.ariaChecked ?? null,
        ariaPressed: s?.ariaPressed ?? null,
        selectedClass: s?.selectedClass ?? null,
        background: s?.background ?? null,
        className: s?.className ?? null,
      })
      if (on && firstOn === null) firstOn = elapsed
      if (firstOn !== null && !on && firstOff === null) firstOff = elapsed
      await page.waitForTimeout(SAMPLE_MS)
    }
    await shot('3-after-hold')
    record.afterHold = await snapshotOption(page)

    const onSamples = record.samples.filter(s => s.active === true).length
    record.verdict = optionSeen === false ? 'NO-QUESTION-CARD'
      : firstOn === null ? 'NEVER-ON'
        : (onSamples === record.samples.length ? 'PERSISTED' : 'REVERTED')
    record.firstOnMs = firstOn
    record.firstOffMs = firstOff
    record.onSampleRatio = `${onSamples}/${record.samples.length}`
    log(`VERDICT=${record.verdict} firstOn=${String(firstOn)}ms firstOff=${String(firstOff)}ms on=${record.onSampleRatio}`)
  } catch (error) {
    record.error = String(error).split('\n')[0]
    record.verdict = 'ERROR'
    log(`ERROR: ${record.error}`)
    try { await page.screenshot({ path: path.join(OUT_DIR, `${STAMP}-${LABEL}-error.png`) }) } catch { /* ignore */ }
  } finally {
    record.pageErrors = pageErrors.slice(0, 10)
    record.finishedAt = new Date().toISOString()
    const out = path.join(OUT_DIR, `${STAMP}-${LABEL}.json`)
    fs.writeFileSync(out, JSON.stringify(record, null, 2))
    log(`wrote ${out}`)
    await browser.close()
  }
  return record.verdict === 'PERSISTED' ? 0 : 1
}

process.exitCode = await main()
