/**
 * T3 追加取证：640×800 bottom-sheet 下「发送回答 / 停止 / 抽屉输入框」到底在哪个容器里、是否在视口内。
 * 首轮 T3 的 elementFromPoint 对「停止」与输入框返回 null（中心点不在视口）——本脚本查清归属与几何。
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
const ASK = '请立刻调用 btw_ask_user 工具向我提一个问题：单选，header 写「布局」，问题写「测试哪一项？」，选项「甲」「乙」。必须真实调用工具。'

const fn_geo = () => {
  const rect = (el) => { if (el === null) return null; const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) } }
  const chain = (el) => { const out = []; let cur = el; let i = 0; while (cur !== null && i < 12) { out.push(`${cur.tagName}${cur.id ? '#' + cur.id : ''}.${String(cur.className || '').split(' ').slice(0, 2).join('.')}`); cur = cur.parentElement; i++ } return out }
  const info = (el) => {
    if (el === null) return null
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2
    const hit = (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) ? document.elementFromPoint(cx, cy) : null
    return {
      box: rect(el), chain: chain(el),
      insideDrawer: el.closest('#dsh-btw-drawer') !== null,
      insidePlacementRoot: el.closest('[data-dsh-btw-root]') !== null,
      centerInViewport: cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight,
      hitTag: hit === null ? null : hit.tagName, hitCls: hit === null ? null : String(hit.className || '').slice(0, 70),
      hitIsSelfOrDesc: hit !== null && (hit === el || el.contains(hit)),
      hitIsScrim: hit !== null && hit.getAttribute('data-dsh-btw-scrim') !== null,
      clientH: el.clientHeight, scrollH: el.scrollHeight,
    }
  }
  const drawer = document.querySelector('#dsh-btw-drawer')
  const surface = document.querySelector('[data-side-chat-surface-mode]')
  const placement = document.querySelector('[data-dsh-btw-root]')
  const card = document.querySelector('[data-side-chat-surface-mode] section[class*="questionCard"]')
  const submit = card === null ? null : [...card.querySelectorAll('button')].find(b => /发送回答|发送中/.test(b.textContent || ''))
  const stopBtn = [...document.querySelectorAll('[data-side-chat-surface-mode] button')].find(b => /停止|Stop/.test(b.getAttribute('aria-label') || ''))
  const allStop = [...document.querySelectorAll('button')].filter(b => /停止|Stop/.test(b.getAttribute('aria-label') || ''))
  const ta = document.querySelector('[data-side-chat-surface-mode] textarea[aria-label="输入一个临时问题…"]')
  const transcript = document.querySelector('[data-dsh-btw-drawer] [class*="transcript"], #dsh-btw-drawer [class*="scroll"], #dsh-btw-drawer [class*="messages"]')
  return {
    at: new Date().toISOString(),
    viewport: { w: innerWidth, h: innerHeight },
    docScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    placementMode: placement === null ? null : placement.getAttribute('data-placement-mode'),
    scrim: info(document.querySelector('[data-dsh-btw-scrim]')),
    surface: info(surface), placementRoot: info(placement), drawer: info(drawer),
    card: info(card), submit: info(submit), composerTextarea: info(ta),
    stopInsideSurface: info(stopBtn),
    stopButtonsAnywhere: allStop.map(b => ({ ariaLabel: b.getAttribute('aria-label'), box: rect(b), chain: chain(b) })),
    transcriptScroll: transcript === null ? null : { cls: String(transcript.className).slice(0, 80), box: rect(transcript), scrollTop: transcript.scrollTop, scrollHeight: transcript.scrollHeight, clientHeight: transcript.clientHeight },
    drawerComposerCandidates: drawer === null ? [] : [...drawer.querySelectorAll('textarea, button')].map(b => ({ tag: b.tagName, ariaLabel: b.getAttribute('aria-label'), text: (b.textContent || '').slice(0, 20), box: rect(b) })).slice(0, 20),
  }
}

async function main() {
  const run = { kind: 'T3 extra geometry forensics @640x800', url: URL_, startedAt: new Date().toISOString(), stamp: STAMP }
  const flush = () => fs.writeFileSync(path.join(OUT, `raw-${STAMP}-T3-extra.json`), JSON.stringify(run, null, 2))
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  page.on('pageerror', e => (run.pageErrors ??= []).push(String(e).slice(0, 300)))
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
    run.at1440x900 = await page.evaluate(fn_geo)
    await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-T3x-1440x900.png`) })
    await page.setViewportSize({ width: 640, height: 800 })
    await page.waitForTimeout(1800)
    run.at640x800 = await page.evaluate(fn_geo)
    await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-T3x-640x800.png`) })
    // 尝试滚动 transcript 到底部，看输入框是否可进入视口
    await page.evaluate(() => { const d = document.querySelector('#dsh-btw-drawer'); const cand = [...d.querySelectorAll('*')].filter(el => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible'); for (const el of cand) el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(600)
    run.afterScrollToBottom = await page.evaluate(fn_geo)
    await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-T3x-640x800-scrolled.png`) })
    run.verdict = 'CAPTURED'
  } catch (error) {
    run.fatalError = String(error).split('\n').slice(0, 2).join(' | '); run.verdict = 'ERROR'
    log(`FATAL ${run.fatalError}`)
    try { await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-T3x-FATAL.png`) }) } catch { /* ignore */ }
  } finally {
    run.finishedAt = new Date().toISOString(); flush(); await browser.close()
  }
  console.log(JSON.stringify({ stamp: STAMP, verdict: run.verdict, fatal: run.fatalError ?? null }))
}

await main()
