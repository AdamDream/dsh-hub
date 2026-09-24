/**
 * 主会话官方问答卡片「参照物」采集器：用于把 btw 自绘卡片向主会话观感/语义对齐时的对照证据。
 *
 * 流程：打开 GUI → 新建临时会话 → 发 kickoff 开会话 → 让主会话调用 ask_user_question
 *      → 截图 + 记录选项 DOM/计算样式 → 点选第一个选项 → 记录选中态样式 → 截图。
 *
 * 用法：node .workspace/btw-question/e2e/compare-main-question.mjs --label main-ref
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
const LABEL = argOf('label', 'main-ref')
const OUT_DIR = '/home/CNS2026495165/dsh/.workspace/btw-question/e2e'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
fs.mkdirSync(OUT_DIR, { recursive: true })
const log = m => console.log(`[${new Date().toISOString()}] ${m}`)

const ASK = '请立刻调用 ask_user_question 工具向我提一个问题：单选，header 写「确认」，问题写「是否继续？」，选项分别是「继续」和「停止」。必须真实调用工具，不要用纯文字代替。'
const ASK_RETRY = '你上一次没有调用工具。请现在立刻调用 ask_user_question：单选，header「确认」，问题「是否继续？」，选项「继续」「停止」。只允许调用工具。'

/** 官方卡片：容器 [data-question-key]，选项按钮 class 里带 option（排除 optionLabel/optionLine/optionCopy）。 */
const OPTION_SEL = '[data-question-key] button[class*="_option"]'
const PROBE = (sel) => {
  const nodes = Array.from(document.querySelectorAll(sel))
  return nodes.map(el => {
    const cs = getComputedStyle(el)
    const parent = el.parentElement
    return {
      text: (el.textContent || '').slice(0, 80),
      className: el.className,
      role: el.getAttribute('role'),
      ariaChecked: el.getAttribute('aria-checked'),
      ariaPressed: el.getAttribute('aria-pressed'),
      tag: el.tagName,
      background: cs.backgroundColor,
      borderColor: cs.borderTopColor,
      borderWidth: cs.borderTopWidth,
      borderRadius: cs.borderRadius,
      color: cs.color,
      minHeight: cs.minHeight,
      padding: cs.padding,
      firstChildClass: el.firstElementChild === null ? null : el.firstElementChild.className,
      firstChildText: el.firstElementChild === null ? null : (el.firstElementChild.textContent || '').slice(0, 20),
      parentClass: parent === null ? null : parent.className,
      containerRole: parent === null ? null : parent.getAttribute('role'),
      containerAriaLabel: parent === null ? null : parent.getAttribute('aria-label'),
    }
  })
}

async function main() {
  const rec = { label: LABEL, url: URL_, startedAt: new Date().toISOString(), steps: [] }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  const shot = async (name) => {
    const file = path.join(OUT_DIR, `${STAMP}-${LABEL}-${name}.png`)
    await page.screenshot({ path: file })
    rec.shots = [...(rec.shots ?? []), file]
  }
  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout: 90000 })
    log('boot ok')

    await page.locator('button[class*="newSession"]').first().click({ timeout: 20000 })
    await page.waitForSelector('textarea', { timeout: 30000 })
    const composer = page.locator('textarea').first()
    await composer.fill('只回复两个字：好的。')
    await composer.press('Enter')
    log('kickoff sent')
    // 等主会话回合结束（发送键回到可输入态）
    await page.waitForFunction(() => {
      const t = document.querySelector('textarea')
      return t !== null && t.disabled === false
    }, null, { timeout: 120000 })

    let seen = false
    for (const [attempt, prompt] of [[1, ASK], [2, ASK_RETRY]]) {
      await composer.fill(prompt)
      await composer.press('Enter')
      log(`ask sent (attempt ${attempt})`)
      try {
        await page.waitForSelector(OPTION_SEL, { timeout: 90000 })
        seen = true
        break
      } catch {
        log(`attempt ${attempt}: official option not found in 90s`)
        await page.waitForFunction(() => {
          const t = document.querySelector('textarea')
          return t !== null && t.disabled === false
        }, null, { timeout: 120000 })
      }
    }
    if (!seen) throw new Error('official question card never appeared')

    rec.beforeClick = await page.evaluate(PROBE, OPTION_SEL)
    rec.questionKey = await page.evaluate(() => document.querySelector('[data-question-key]')?.getAttribute('data-question-key') ?? null)
    await shot('1-official-card')

    await page.locator(OPTION_SEL).first().click({ timeout: 10000 })
    await page.waitForTimeout(400)
    rec.afterClick = await page.evaluate(PROBE, OPTION_SEL)
    await shot('2-official-selected')
    rec.verdict = 'OK'
    log('captured official card reference')
  } catch (error) {
    rec.error = String(error).split('\n')[0]
    rec.verdict = 'ERROR'
    log(`ERROR: ${rec.error}`)
    try { await shot('error') } catch { /* ignore */ }
  } finally {
    rec.finishedAt = new Date().toISOString()
    const out = path.join(OUT_DIR, `${STAMP}-${LABEL}.json`)
    fs.writeFileSync(out, JSON.stringify(rec, null, 2))
    log(`wrote ${out}`)
    await browser.close()
  }
  return rec.verdict === 'OK' ? 0 : 1
}

process.exitCode = await main()
