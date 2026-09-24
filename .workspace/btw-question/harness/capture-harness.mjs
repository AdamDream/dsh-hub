/**
 * 用 Playwright 对 harness 页截图并量化选项行计算样式（亮/暗两套主题）。
 * 用法：node capture-harness.mjs
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire('/home/CNS2026495165/playwright_scratch/')
const { chromium } = require('playwright')

const DIR = '/home/CNS2026495165/dsh/.workspace/btw-question/harness'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
const map = JSON.parse(fs.readFileSync(path.join(DIR, 'classmap.json'), 'utf8'))

const probe = (selector) => {
  const el = document.querySelector(selector)
  if (el === null) return null
  const cs = getComputedStyle(el)
  const lead = el.firstElementChild
  return {
    className: el.className,
    role: el.getAttribute('role'),
    ariaChecked: el.getAttribute('aria-checked'),
    ariaPressed: el.getAttribute('aria-pressed'),
    background: cs.backgroundColor,
    borderColor: cs.borderTopColor,
    borderRadius: cs.borderTopLeftRadius,
    minHeight: cs.minHeight,
    padding: cs.padding,
    gap: cs.gap,
    flexDirection: cs.flexDirection,
    alignItems: cs.alignItems,
    color: cs.color,
    labelFontSize: cs.fontSize,
    transition: cs.transitionProperty + ' ' + cs.transitionDuration,
    leadTag: lead === null ? null : lead.tagName,
    leadClass: lead === null ? null : lead.className,
    leadText: lead === null ? null : (lead.textContent || '').slice(0, 10),
    leadBackground: lead === null ? null : getComputedStyle(lead).backgroundColor,
  }
}

const record = { stamp: STAMP, classMap: map, pages: [] }
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1000, height: 460 }, locale: 'zh-CN' })
const page = await context.newPage()

for (const [name, file] of [['before', 'before.html'], ['after', 'after.html']]) {
  for (const theme of ['light', 'dark']) {
    await page.goto(`file://${path.join(DIR, file)}`)
    if (theme === 'dark') {
      await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    } else {
      await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    }
    await page.waitForTimeout(120)
    const shot = path.join(DIR, `${STAMP}-${name}-${theme}.png`)
    await page.screenshot({ path: shot })
    const classes = name === 'before' ? map.before : map.after
    const entry = {
      name, theme, shot,
      selectedRow: await page.evaluate(probe, `.${classes.selected}`),
      plainRow: await page.evaluate(probe, `.${classes.option}`),
      leadBadge: classes.index === undefined ? null : await page.evaluate(probe, `.${classes.index}`),
      card: await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (el === null) return null
        const cs = getComputedStyle(el)
        return { borderColor: cs.borderTopColor, background: cs.backgroundColor, borderRadius: cs.borderTopLeftRadius }
      }, `.${classes.card}`),
    }
    record.pages.push(entry)
    console.log(`${name}/${theme}: selected bg=${entry.selectedRow?.background} border=${entry.selectedRow?.borderColor} | plain bg=${entry.plainRow?.background}`)
  }
}

// 选中态 vs 未选中态的背景差（亮/暗各自）
for (const entry of record.pages) {
  const a = entry.selectedRow?.background
  const b = entry.plainRow?.background
  entry.selectedVsPlainBackground = { selected: a, plain: b, differs: a !== b }
}
record.finishedAt = new Date().toISOString()
const out = path.join(DIR, `${STAMP}-harness.json`)
fs.writeFileSync(out, JSON.stringify(record, null, 2))
console.log('wrote', out)
await browser.close()
