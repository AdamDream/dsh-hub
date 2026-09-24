/**
 * btw 问答卡片 —— notebook §8 第 11 条「四项未覆盖」真机补测驱动器。
 *
 * T1 真实 GUI 多选交互（3 选项，点 1+2，50ms×3s 采样，提交答案）
 * T2 「回答后再提问」重挂（第二问：单选 A/B，草稿清零 + 题干不同 + 点选保持）
 * T3 窄屏 640×800 bottom-sheet 分支的选项行（放置模式 / 裁剪 / 点选保持 / 命中测试）
 * T4 选项行键盘导航与焦点序（Tab 序列 / Space 切换 / ArrowDown/Up 无作用）
 *
 * 用法：node .workspace/btw-question/e2e-cover/cover-driver.mjs
 * 只写 .workspace/btw-question/e2e-cover/；不改任何源码；读取 ~/.dsh/sessions 仅只读（由 bash 侧另做）。
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire('/home/CNS2026495165/playwright_scratch/')
const { chromium } = require('playwright')

const URL_ = process.env.DSH_URL || 'http://127.0.0.1:3080'
const OUT = '/home/CNS2026495165/dsh/.workspace/btw-question/e2e-cover'
const STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
const SAMPLE_MS = 50
const HOLD_MS = 3000

fs.mkdirSync(OUT, { recursive: true })
const log = m => console.log(`[${new Date().toISOString()}] ${m}`)

// ---------- selectors (verified against live bundle rev 887a12106dcd) ----------
const BTW_BUTTON = 'button[title="打开 btw"], button[title="关闭 btw"], button[title="收起 btw"]'
const SURFACE = '[data-side-chat-surface-mode]'
const PLACEMENT = '[data-dsh-btw-root]'
const SCRIM = '[data-dsh-btw-scrim]'
const DRAWER_INPUT = `${SURFACE} textarea[aria-label="输入一个临时问题…"]`
const CARD = `${SURFACE} section[class*="questionCard"]`
const OPTIONS = `${SURFACE} [class*="questionOptions"]`
const OPTION_BUTTONS = `${SURFACE} [class*="questionOptions"] > button`
const CUSTOM_INPUT = `${SURFACE} input[class*="questionInput"]`

const KICKOFF_PROMPT = '只回复两个字：好的。'

// T1：多选，**故意不给键名**（实测口径：不给键名时子代理会自发写合法 multi_select: true）
const T1_PROMPT = '请立刻调用 btw_ask_user 工具向我提一个问题：我希望可以同时勾选多个选项（多选，允许一次选中好几个），给出 3 个选项。header 写「饮品」，问题写「你想喝哪几种？」，三个选项分别是「咖啡」「茶」「果汁」。必须真实调用工具，不要用纯文字代替。'
const T1_PROMPT_RETRY = '你上一次没有成功提问。请现在立刻调用 btw_ask_user 工具：这是一个**多选**问题（multi_select 为 true），header「饮品」，问题「你想喝哪几种？」，选项「咖啡」「茶」「果汁」。只允许调用工具，不要输出解释。'
// 最后一次兜底才把键名说死（用于区分"模型没调工具"与"模型调了但参数错"，并留重试记录）
const T1_PROMPT_KEYED = '请立刻调用 btw_ask_user 工具，参数里明确带上 multi_select: true：header「饮品」，问题「你想喝哪几种？」，选项「咖啡」「茶」「果汁」。只调用工具，不要解释。'

// T2：单选、header 与上一题不同
const T2_PROMPT = '很好，我已经回答了。请再立刻调用一次 btw_ask_user 工具，提一个**新的、不同的**问题：这次只能选一个答案（单选），header 写「时间」，问题写「你什么时候有空？」，选项只有两个：「上午」「下午」。必须真实调用工具，不要用纯文字代替。'
const T2_PROMPT_RETRY = '请现在立刻调用 btw_ask_user 工具提第二问（单选题）：header「时间」，问题「你什么时候有空？」，选项「上午」和「下午」。只调用工具，不要解释。'

const BTN_ANSWER = /发送回答|Send answer/
const BTN_ANSWERING = /发送中|Sending/

// ---------- page-side probes ----------
const fn_snapshot = () => {
  const rect = (el) => {
    if (el === null || el === undefined) return null
    const r = el.getBoundingClientRect()
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) }
  }
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const out = { at: new Date().toISOString(), viewport: { w: innerWidth, h: innerHeight } }
  const surface = document.querySelector('[data-side-chat-surface-mode]')
  out.surfaceMode = surface ? surface.getAttribute('data-side-chat-surface-mode') : null
  const placement = document.querySelector('[data-dsh-btw-root]')
  out.placement = placement === null ? null : {
    mode: placement.getAttribute('data-placement-mode'),
    degraded: placement.getAttribute('data-placement-degraded'),
    box: rect(placement),
  }
  const scrim = document.querySelector('[data-dsh-btw-scrim]')
  out.scrim = scrim === null ? null : {
    display: getComputedStyle(scrim).display,
    pointerEvents: getComputedStyle(scrim).pointerEvents,
    box: rect(scrim),
    zIndex: getComputedStyle(scrim).zIndex,
  }
  const drawer = document.querySelector('#dsh-btw-drawer')
  out.drawer = drawer === null ? null : { box: rect(drawer), role: drawer.getAttribute('role') }
  const cards = document.querySelectorAll('section[class*="questionCard"]')
  out.cardCount = cards.length
  out.cardPresent = cards.length > 0
  out.cards = []
  for (const card of cards) {
    // questionId 在 DOM 中是否可观测（React key 不落 DOM）
    const idAttrs = []
    for (const el of card.querySelectorAll('*')) {
      for (const a of el.attributes) if (UUID_RE.test(a.value)) idAttrs.push({ tag: el.tagName, attr: a.name, value: a.value })
    }
    const c = {
      ariaLabel: card.getAttribute('aria-label'),
      box: rect(card),
      classList: String(card.className).slice(0, 120),
      uuidAttrs: idAttrs.slice(0, 10),
      questions: [],
      customInputs: [],
      submit: null,
      textHead: (card.innerText || '').slice(0, 400),
    }
    for (const item of card.querySelectorAll('[class*="questionItem"]')) {
      const optWrap = item.querySelector('[class*="questionOptions"]')
      const q = {
        header: item.querySelector('[class*="questionHeader"]')?.textContent ?? null,
        question: item.querySelector('[class*="questionText"]')?.textContent ?? null,
        optionsWrapRole: optWrap === null ? null : optWrap.getAttribute('role'),
        optionsWrapBox: rect(optWrap),
        optionCount: optWrap === null ? 0 : optWrap.querySelectorAll(':scope > button').length,
        options: [],
      }
      if (optWrap !== null) {
        for (const b of optWrap.querySelectorAll(':scope > button')) {
          const check = b.querySelector('span[class*="questionOptionCheck"]')
          let checkBg = null
          if (check !== null) checkBg = getComputedStyle(check, '::before').backgroundColor
          q.options.push({
            label: b.querySelector('[class*="questionOptionLabel"]')?.textContent ?? null,
            role: b.getAttribute('role'),
            ariaChecked: b.getAttribute('aria-checked'),
            ariaPressed: b.getAttribute('aria-pressed'),
            type: b.getAttribute('type'),
            disabled: b.disabled,
            tabIndex: b.tabIndex,
            cls: String(b.className).slice(0, 120),
            selectedClass: /questionOptionSelected/.test(String(b.className)),
            checkCls: check === null ? null : String(check.className).slice(0, 160),
            checkCheckedClass: check !== null && /questionOptionCheckChecked/.test(String(check.className)),
            checkSvgCount: check === null ? null : check.querySelectorAll(':scope > svg').length,
            checkBg,
            checkColor: check === null ? null : getComputedStyle(check).color,
            indexBadge: b.querySelector('[class*="questionOptionIndex"]')?.textContent ?? null,
            box: rect(b),
          })
        }
      }
      const inp = item.querySelector('input[class*="questionInput"]')
      if (inp !== null) {
        q.customInput = { ariaLabel: inp.getAttribute('aria-label'), placeholder: inp.placeholder, value: inp.value }
        c.customInputs.push(q.customInput)
      }
      c.questions.push(q)
    }
    const sub = [...card.querySelectorAll('button')].find(b => /发送回答|Send answer/.test(b.textContent || '') || /发送中|Sending/.test(b.textContent || ''))
    if (sub !== undefined) c.submit = { text: (sub.textContent || '').trim(), disabled: sub.disabled, box: rect(sub), sending: /发送中|Sending/.test(sub.textContent || '') }
    out.cards.push(c)
  }
  const stop = [...document.querySelectorAll(`${'[data-side-chat-surface-mode]'} button`)].find(b => /停止/.test(b.getAttribute('aria-label') || ''))
  out.stopButton = stop === undefined ? null : { ariaLabel: stop.getAttribute('aria-label'), box: rect(stop) }
  const ta = document.querySelector('[data-side-chat-surface-mode] textarea[aria-label="输入一个临时问题…"]')
  out.composer = ta === null ? null : { disabled: ta.disabled, box: rect(ta) }
  if (drawer !== null) out.drawerText = (drawer.innerText || '').slice(-1200)
  return out
}

const fn_focus = () => {
  const a = document.activeElement
  if (a === null) return { none: true }
  const inOptions = a.closest('[class*="questionOptions"]') !== null
  return {
    tag: a.tagName,
    role: a.getAttribute('role'),
    ariaLabel: a.getAttribute('aria-label'),
    placeholder: a.getAttribute('placeholder'),
    text: (a.textContent || '').slice(0, 50),
    cls: String(a.className || '').slice(0, 100),
    inOptionsRow: inOptions,
    isOptionButton: a.tagName === 'BUTTON' && inOptions,
  }
}

const fn_checked = () => Array.from(document.querySelectorAll('[data-side-chat-surface-mode] [class*="questionOptions"] > button'))
  .map(b => ({ label: b.querySelector('[class*="questionOptionLabel"]')?.textContent ?? null, checked: b.getAttribute('aria-checked'), cls: /questionOptionSelected/.test(String(b.className)) }))

const fn_hitSubmit = () => {
  const card = document.querySelector('[data-side-chat-surface-mode] section[class*="questionCard"]')
  if (card === null) return { found: false, why: 'no card' }
  const btn = [...card.querySelectorAll('button')].find(b => /发送回答|发送中|Send answer|Sending/.test(b.textContent || ''))
  if (btn === undefined) return { found: false, why: 'no submit button in card' }
  const r = btn.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const hit = document.elementFromPoint(cx, cy)
  return {
    found: true, label: (btn.textContent || '').trim(), disabled: btn.disabled,
    cx: +cx.toFixed(1), cy: +cy.toFixed(1),
    hitTag: hit === null ? null : hit.tagName,
    hitCls: hit === null ? null : String(hit.className || '').slice(0, 90),
    hitIsSelfOrDescendant: hit !== null && (hit === btn || btn.contains(hit)),
    hitIsScrim: hit !== null && hit.getAttribute('data-dsh-btw-scrim') !== null,
  }
}

const fn_hitStop = () => {
  const scope = document.querySelector('[data-side-chat-surface-mode]')
  if (scope === null) return { found: false }
  const btn = [...scope.querySelectorAll('button')].find(b => /停止|Stop/.test(b.getAttribute('aria-label') || ''))
  if (btn === undefined) return { found: false, why: 'no stop button' }
  const r = btn.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const hit = document.elementFromPoint(cx, cy)
  return {
    found: true, ariaLabel: btn.getAttribute('aria-label'),
    cx: +cx.toFixed(1), cy: +cy.toFixed(1),
    hitTag: hit === null ? null : hit.tagName,
    hitIsSelfOrDescendant: hit !== null && (hit === btn || btn.contains(hit)),
    hitIsScrim: hit !== null && hit.getAttribute('data-dsh-btw-scrim') !== null,
  }
}

const fn_indexOfActive = () => {
  const all = Array.from(document.querySelectorAll('[data-side-chat-surface-mode] [class*="questionOptions"] > button'))
  return all.indexOf(document.activeElement)
}

const fn_focusDrawerAnchor = () => {
  const scope = document.querySelector('[data-dsh-btw-drawer]')
  if (scope === null) return { ok: false, why: 'no drawer' }
  const cands = [...scope.querySelectorAll('button, textarea, input, select, a[href], [tabindex]')]
    .filter(el => el.disabled !== true && el.tabIndex >= 0 && el.offsetParent !== null)
  if (cands.length === 0) return { ok: false, why: 'no focusable element in drawer' }
  cands[0].focus()
  return { ok: document.activeElement === cands[0], anchorTag: cands[0].tagName, anchorCls: String(cands[0].className || '').slice(0, 80), anchorLabel: cands[0].getAttribute('aria-label'), candidateCount: cands.length }
}

const fn_hit = (sel) => {
  const el = document.querySelector(sel)
  if (el === null) return { found: false }
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const hit = document.elementFromPoint(cx, cy)
  const vp = { w: innerWidth, h: innerHeight }
  const interW = Math.max(0, Math.min(r.right, vp.w) - Math.max(r.left, 0))
  const interH = Math.max(0, Math.min(r.bottom, vp.h) - Math.max(r.top, 0))
  return {
    found: true, cx: +cx.toFixed(1), cy: +cy.toFixed(1),
    inViewportCenter: cx >= 0 && cx <= vp.w && cy >= 0 && cy <= vp.h,
    visibleArea: +(interW * interH).toFixed(1),
    fullyInsideViewport: r.left >= 0 && r.top >= 0 && r.right <= vp.w && r.bottom <= vp.h,
    box: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) },
    hitTag: hit === null ? null : hit.tagName,
    hitCls: hit === null ? null : String(hit.className || '').slice(0, 90),
    hitIsSelfOrDescendant: hit !== null && (hit === el || el.contains(hit)),
    hitIsScrim: hit !== null && hit.getAttribute('data-dsh-btw-scrim') !== null,
  }
}

async function main() {
  const run = {
    kind: 'btw-question §8#11 four-item real-GUI coverage (T1-T4)',
    url: URL_,
    startedAt: new Date().toISOString(),
    stamp: STAMP,
    holdMs: HOLD_MS, sampleMs: SAMPLE_MS,
    browserVersion: null,
    boot: null,
    resourceUrls: [],
    phases: {},
    consoleMessages: [],
    pageErrors: [],
    requestFailures: [],
    shots: [],
  }
  const flush = () => fs.writeFileSync(path.join(OUT, `raw-${STAMP}.json`), JSON.stringify(run, null, 2))
  const phaseFlush = (name) => fs.writeFileSync(path.join(OUT, `raw-${STAMP}-${name}.json`), JSON.stringify(run.phases[name] ?? {}, null, 2))

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  run.browserVersion = browser.version()
  // 全新 context：不复用缓存（另见 route 强制 no-store）
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', bypassCSP: true })
  const page = await context.newPage()
  page.on('pageerror', e => run.pageErrors.push({ at: new Date().toISOString(), error: String(e).slice(0, 500) }))
  page.on('console', m => {
    if (m.type() === 'warning' || m.type() === 'error') run.consoleMessages.push({ at: new Date().toISOString(), type: m.type(), text: m.text().slice(0, 400) })
  })
  page.on('requestfailed', r => run.requestFailures.push({ at: new Date().toISOString(), url: r.url().slice(0, 200), err: r.failure()?.errorText ?? null }))
  page.on('response', r => { if (/dsh-btw/.test(r.url())) run.resourceUrls.push({ url: r.url(), status: r.status() }) })

  const shotFull = async (name) => {
    const file = path.join(OUT, `fullpage-${STAMP}-${name}.png`)
    await page.screenshot({ path: file })
    run.shots.push({ kind: 'fullpage', name, file })
    return file
  }
  const shotClip = async (locator, name) => {
    try {
      const file = path.join(OUT, `${STAMP}-${name}.png`)
      await locator.first().screenshot({ path: file, timeout: 15000 })
      run.shots.push({ kind: 'clip', name, file })
      return file
    } catch (error) {
      run.shots.push({ kind: 'clip', name, error: String(error).split('\n')[0] })
      return null
    }
  }
  const snap = async () => await page.evaluate(fn_snapshot)
  const focusNow = async () => await page.evaluate(fn_focus)
  const checkedNow = async () => await page.evaluate(fn_checked)

  /** 50ms 采样所有选项 aria-checked */
  const sample = async (ms, label) => {
    const t0 = Date.now()
    const arr = []
    while (Date.now() - t0 < ms) {
      const c = await checkedNow()
      arr.push({ ms: Date.now() - t0, states: c })
      await page.waitForTimeout(SAMPLE_MS)
    }
    log(`sampled ${label}: ${arr.length} ticks`)
    return arr
  }
  const sampleSummary = (arr, indices) => {
    const ticks = arr.length
    const allOn = arr.filter(t => indices.every(i => t.states[i]?.checked === 'true')).length
    const firstOff = arr.find(t => !indices.every(i => t.states[i]?.checked === 'true'))
    return {
      ticks, allOnTicks: allOn, ratio: `${allOn}/${ticks}`,
      allOnAllTicks: allOn === ticks,
      firstOffAtMs: firstOff === undefined ? null : firstOff.ms,
      firstTick: arr[0]?.states ?? null,
      lastTick: arr[arr.length - 1]?.states ?? null,
      observedMs: arr.length === 0 ? 0 : arr[arr.length - 1].ms,
    }
  }

  const waitCard = async (timeoutMs) => {
    try {
      await page.waitForSelector(CARD, { timeout: timeoutMs })
      return true
    } catch { return false }
  }
  const waitComposerEnabled = async (timeoutMs) => {
    try {
      await page.waitForFunction((sel) => { const el = document.querySelector(sel); return el !== null && el.disabled === false }, DRAWER_INPUT, { timeout: timeoutMs })
      return true
    } catch { return false }
  }

  try {
    // ---------- 0. boot ----------
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout: 90000 })
    run.boot = await page.evaluate(() => {
      const b = window.__DSH_BOOT__
      const e = (b.entries || []).find(x => /dsh-btw/.test(x.id))
      return { rev: b.rev, btwEntry: e === undefined ? null : { id: e.id, url: e.url, rev: e.rev }, ts: new Date().toISOString() }
    })
    run.resourceUrls = []
    await page.evaluate(() => performance.clearResourceTimings())
    log(`boot ok; btw entry rev=${run.boot?.btwEntry?.rev}`)
    flush()

    // ---------- 1. new session ----------
    await page.locator('button[class*="newSession"]').first().click({ timeout: 20000 })
    await page.waitForSelector('textarea', { timeout: 30000 })
    try {
      await page.locator(BTW_BUTTON).first().waitFor({ state: 'visible', timeout: 8000 })
    } catch {
      const main = page.locator('textarea').first()
      await main.fill(KICKOFF_PROMPT)
      await main.press('Enter')
      log('kickoff sent')
    }
    await page.waitForSelector(BTW_BUTTON, { timeout: 120000 })
    await page.locator(BTW_BUTTON).first().click({ timeout: 20000 })
    await page.waitForSelector(DRAWER_INPUT, { timeout: 30000 })
    log('drawer open')
    run.sessionOpenedAt = new Date().toISOString()
    flush()

    // ================= T1 =================
    const T1 = { name: 'T1 multi-select real GUI interaction', startedAt: new Date().toISOString(), attempts: [], assertions: [], verdict: 'INCONCLUSIVE' }
    run.phases.T1 = T1
    let t1CardSnap = null
    const t1Prompts = [T1_PROMPT, T1_PROMPT_RETRY, T1_PROMPT_KEYED]
    for (let i = 0; i < t1Prompts.length; i++) {
      const attempt = { n: i + 1, promptKind: ['no-keyname', 'no-keyname-retry', 'keyed-multi_select'][i], prompt: t1Prompts[i], sentAt: new Date().toISOString() }
      const editable = await waitComposerEnabled(60000)
      attempt.composerEditable = editable
      if (!editable) { attempt.result = 'composer never enabled'; T1.attempts.push(attempt); flush(); phaseFlush('T1'); break }
      await page.fill(DRAWER_INPUT, t1Prompts[i])
      await page.press(DRAWER_INPUT, 'Enter')
      log(`T1 prompt #${i + 1} sent (${attempt.promptKind})`)
      const ok = await waitCard(90000)
      attempt.cardAppeared = ok
      if (ok) {
        await page.waitForTimeout(1200)
        t1CardSnap = await snap()
        attempt.card = t1CardSnap.cards[0] ?? null
        attempt.result = 'card appeared'
        T1.producingAttempt = { n: i + 1, promptKind: attempt.promptKind }
        T1.attempts.push(attempt); flush(); phaseFlush('T1')
        break
      }
      attempt.result = 'no card in 90s'
      attempt.drawerTextTail = (await snap()).drawerText?.slice(-400) ?? null
      T1.attempts.push(attempt); flush(); phaseFlush('T1')
      log(`T1 attempt #${i + 1} produced no card`)
    }
    if (t1CardSnap !== null && t1CardSnap.cardCount > 0) {
      const card0 = t1CardSnap.cards[0]
      const q0 = card0.questions[0] ?? { options: [] }
      T1.cardSnapshot = card0
      T1.optionCount = q0.optionCount
      T1.optionsWrapRole = q0.optionsWrapRole
      T1.optionRoles = q0.options.map(o => o.role)
      await shotFull('T1-1-card-appeared')
      await shotClip(page.locator(OPTIONS), 'T1-1-options-crop')

      // 断言①：卡片出现 + role=checkbox（不是 radio）
      T1.assertions.push({
        id: 'a1_card_and_checkbox_role',
        pass: card0 !== undefined && q0.optionCount === 3 && q0.options.every(o => o.role === 'checkbox'),
        detail: { cardFound: true, optionCount: q0.optionCount, optionsWrapRole: q0.optionsWrapRole, roles: q0.options.map(o => o.role), labels: q0.options.map(o => o.label) },
      })

      const beforeCheckSvg = q0.options.map(o => o.checkSvgCount)
      const beforeCheckedClass = q0.options.map(o => o.checkCheckedClass)
      const beforeCheckBg = q0.options.map(o => o.checkBg)

      // 点第 1、2 个选项
      await page.locator(OPTION_BUTTONS).nth(0).click({ timeout: 10000 })
      await page.locator(OPTION_BUTTONS).nth(1).click({ timeout: 10000 })
      T1.clickedAt = new Date().toISOString()
      log('T1 clicked options #1 and #2')
      const samples = await sample(HOLD_MS, 'T1 after click 1+2')
      const summary = sampleSummary(samples, [0, 1])
      T1.samples = samples
      T1.sampleSummary = summary
      const afterSnap = await snap()
      T1.afterClickSnapshot = afterSnap.cards[0] ?? null
      await shotFull('T1-2-after-click-hold')
      await shotClip(page.locator(OPTIONS), 'T1-2-options-selected-crop')

      // 断言②：两项 aria-checked=true 且 3s 全程保持
      T1.assertions.push({
        id: 'a2_two_checked_persist_3s',
        pass: summary.allOnAllTicks && summary.ticks >= 50,
        detail: { ...summary, sampleMs: SAMPLE_MS, windowMs: HOLD_MS },
      })
      // 断言③：勾图标/徽标随选中出现
      const afterOpts = (afterSnap.cards[0]?.questions[0]?.options) ?? []
      T1.assertions.push({
        id: 'a3_check_mark_appears_on_selected',
        pass: afterOpts[0]?.checkSvgCount === 1 && afterOpts[1]?.checkSvgCount === 1 && afterOpts[2]?.checkSvgCount === 0
          && afterOpts[0]?.checkCheckedClass === true && afterOpts[1]?.checkCheckedClass === true && afterOpts[2]?.checkCheckedClass === false,
        detail: {
          beforeCheckSvg, beforeCheckedClass, beforeCheckBg,
          after: afterOpts.map(o => ({ label: o.label, checked: o.ariaChecked, checkSvgCount: o.checkSvgCount, checkCheckedClass: o.checkCheckedClass, checkBg: o.checkBg, selectedClass: o.selectedClass })),
        },
      })
      // 断言④：提交 → 卡片消失 + 子代理继续
      const beforeSubmitText = (await snap()).drawerText ?? ''
      const submitBox = afterSnap.cards[0]?.submit ?? null
      T1.submitButtonBefore = submitBox
      let submitClickOk = true
      try { await page.locator(CARD).locator('button', { hasText: BTN_ANSWER }).first().click({ timeout: 10000 }) } catch (error) {
        submitClickOk = false
        T1.submitClickError = String(error).split('\n')[0]
      }
      T1.submittedAt = new Date().toISOString()
      log(`T1 submit clicked ok=${submitClickOk}`)
      await page.waitForTimeout(500)
      const rightAfter = await snap()
      T1.snapshotRightAfterSubmit = { cardCount: rightAfter.cardCount, submit: rightAfter.cards[0]?.submit ?? null, drawerTextTail: rightAfter.drawerText?.slice(-300) }
      let cardGone = false
      const goneT0 = Date.now()
      while (Date.now() - goneT0 < 30000) {
        const s = await snap()
        if (s.cardCount === 0) { cardGone = true; T1.cardGoneAfterMs = Date.now() - goneT0 }
        if (cardGone) break
        await page.waitForTimeout(250)
      }
      const afterSubmitText = (await snap()).drawerText ?? ''
      T1.transcriptChangedAfterSubmit = beforeSubmitText !== afterSubmitText
      T1.transcriptDeltaChars = afterSubmitText.length - beforeSubmitText.length
      await shotFull('T1-3-after-submit')
      T1.assertions.push({
        id: 'a4_submit_card_gone_agent_continues',
        pass: submitClickOk && cardGone && T1.transcriptChangedAfterSubmit,
        detail: { submitClickOk, submitButtonBefore: submitBox, cardGone, cardGoneAfterMs: T1.cardGoneAfterMs ?? null, transcriptChangedAfterSubmit: T1.transcriptChangedAfterSubmit, transcriptDeltaChars: T1.transcriptDeltaChars, drawerTextTailAfter: afterSubmitText.slice(-500) },
      })
      T1.verdict = T1.assertions.every(a => a.pass) ? 'PASS' : 'FAIL'
    } else {
      T1.verdict = 'INCONCLUSIVE'
      T1.reason = 'no question card appeared after 3 attempts (see attempts[])'
    }
    flush(); phaseFlush('T1')

    // ================= T2 =================
    const T2 = { name: 'T2 re-mount on second question (answer-then-ask)', startedAt: new Date().toISOString(), attempts: [], assertions: [], verdict: 'INCONCLUSIVE' }
    run.phases.T2 = T2
    T2.t1Card = run.phases.T1.cardSnapshot === undefined ? null : {
      header: run.phases.T1.cardSnapshot.questions[0]?.header ?? null,
      question: run.phases.T1.cardSnapshot.questions[0]?.question ?? null,
      labels: (run.phases.T1.cardSnapshot.questions[0]?.options ?? []).map(o => o.label),
    }
    let t2CardSnap = null
    const t2Prompts = [T2_PROMPT, T2_PROMPT_RETRY]
    for (let i = 0; i < t2Prompts.length; i++) {
      const attempt = { n: i + 1, prompt: t2Prompts[i], sentAt: new Date().toISOString() }
      const editable = await waitComposerEnabled(180000)
      attempt.composerEditableAfterWait = editable
      if (!editable) { attempt.result = 'composer never enabled within 180s'; T2.attempts.push(attempt); flush(); phaseFlush('T2'); break }
      attempt.composerEnabledAt = new Date().toISOString()
      await page.fill(DRAWER_INPUT, t2Prompts[i])
      await page.press(DRAWER_INPUT, 'Enter')
      log(`T2 prompt #${i + 1} sent`)
      const ok = await waitCard(90000)
      attempt.cardAppeared = ok
      if (ok) {
        await page.waitForTimeout(1200)
        t2CardSnap = await snap()
        attempt.card = t2CardSnap.cards[0] ?? null
        attempt.result = 'card appeared'
        T2.producingAttempt = i + 1
        T2.attempts.push(attempt); flush(); phaseFlush('T2')
        break
      }
      attempt.result = 'no card in 90s'
      attempt.drawerTextTail = (await snap()).drawerText?.slice(-400) ?? null
      T2.attempts.push(attempt); flush(); phaseFlush('T2')
    }
    if (t2CardSnap !== null && t2CardSnap.cardCount > 0) {
      const card0 = t2CardSnap.cards[0]
      const q0 = card0.questions[0] ?? { options: [] }
      T2.cardSnapshot = card0
      T2.optionCount = q0.optionCount
      await shotFull('T2-1-second-card-fresh')
      await shotClip(page.locator(OPTIONS), 'T2-1-options-fresh-crop')

      const allFalse = q0.options.every(o => o.ariaChecked === 'false')
      const customEmpty = (card0.customInputs ?? []).every(c => c.value === '')
      T2.assertions.push({
        id: 'a1_fresh_draft_on_new_card',
        pass: allFalse && customEmpty && q0.optionCount === 2,
        detail: { optionCount: q0.optionCount, ariaChecked: q0.options.map(o => o.ariaChecked), selectedClass: q0.options.map(o => o.selectedClass), customInputs: card0.customInputs, uuidAttrsInCard: card0.uuidAttrs },
      })
      const diffHeader = q0.header !== T2.t1Card?.header
      const diffQuestion = q0.question !== T2.t1Card?.question
      const diffLabels = JSON.stringify(q0.options.map(o => o.label)) !== JSON.stringify(T2.t1Card?.labels ?? [])
      T2.assertions.push({
        id: 'a2_content_differs_from_first_question',
        pass: diffHeader && diffQuestion && diffLabels,
        detail: { newHeader: q0.header, oldHeader: T2.t1Card?.header, newQuestion: q0.question, oldQuestion: T2.t1Card?.question, newLabels: q0.options.map(o => o.label), oldLabels: T2.t1Card?.labels, diffHeader, diffQuestion, diffLabels },
      })
      // 点第二个选项（B）并采样
      await page.locator(OPTION_BUTTONS).nth(1).click({ timeout: 10000 })
      T2.clickedAt = new Date().toISOString()
      const samples = await sample(HOLD_MS, 'T2 after click B')
      const summary = sampleSummary(samples, [1])
      T2.samples = samples
      T2.sampleSummary = summary
      await shotFull('T2-2-after-click-hold')
      await shotClip(page.locator(OPTIONS), 'T2-2-options-selected-crop')
      T2.assertions.push({
        id: 'a3_click_persists_after_remount',
        pass: summary.allOnAllTicks && summary.firstTick?.[1]?.checked === 'true' && summary.firstTick?.[0]?.checked === 'false',
        detail: summary,
      })
      T2.verdict = T2.assertions.every(a => a.pass) ? 'PASS' : 'FAIL'
    } else {
      T2.verdict = 'INCONCLUSIVE'
      T2.reason = 'second question card never appeared'
    }
    flush(); phaseFlush('T2')

    // ================= T4 (keyboard) —— 先做键盘（1440×900），再做 T3 窄屏 =================
    const T4 = { name: 'T4 option-row keyboard navigation and focus order', startedAt: new Date().toISOString(), assertions: [], verdict: 'INCONCLUSIVE' }
    run.phases.T4 = T4
    const cardExistsForT4 = (await snap()).cardCount > 0
    T4.cardAvailable = cardExistsForT4
    if (cardExistsForT4) {
      T4.stateAtStart = await checkedNow()
      // 重置：单选卡里若有已选中项，先用鼠标取消，保证「Space ⇒ true」可判定
      const preChecked = T4.stateAtStart.findIndex(o => o.checked === 'true')
      if (preChecked >= 0) {
        await page.locator(OPTION_BUTTONS).nth(preChecked).click({ timeout: 10000 })
        await page.waitForTimeout(200)
        T4.resetByMouse = { index: preChecked, after: await checkedNow() }
      }
      // ① 焦点锚点：抽屉输入框（待答状态下可能 disabled ⇒ 记录并回退到抽屉第一个可聚焦元素）
      const composerProbe = await page.evaluate((sel) => { const t = document.querySelector(sel); return t === null ? null : { disabled: t.disabled, tabIndex: t.tabIndex, offsetParent: t.offsetParent !== null } }, DRAWER_INPUT)
      T4.composerProbe = composerProbe
      let anchorPath = null
      try {
        await page.locator(DRAWER_INPUT).focus({ timeout: 5000 })
        const f = await focusNow()
        if (f.role === undefined || f.tag === 'TEXTAREA') anchorPath = 'composer-textarea'
        T4.composerFocusAttempt = { focused: f }
      } catch (error) { T4.composerFocusAttempt = { error: String(error).split('\n')[0] } }
      if (anchorPath === null) {
        T4.anchorFallback = await page.evaluate(fn_focusDrawerAnchor)
        T4.anchorFallbackReason = `composer textarea not focusable (disabled=${composerProbe?.disabled}) ⇒ fallback to first focusable element inside #dsh-btw-drawer`
        anchorPath = 'drawer-first-focusable'
      }
      T4.anchorPath = anchorPath
      T4.anchorFocus = await focusNow()

      const walk = async (direction, max) => {
        const seq = [{ step: 0, direction: 'anchor', focus: await focusNow() }]
        for (let i = 1; i <= max; i++) {
          await page.keyboard.press(direction)
          await page.waitForTimeout(60)
          const f = await focusNow()
          seq.push({ step: i, direction, focus: f })
          if (f.isOptionButton === true) return { seq, reached: { path: direction, steps: i } }
        }
        return { seq, reached: null }
      }
      let reached = null
      if (anchorPath === 'composer-textarea') {
        const back = await walk('Shift+Tab', 30)
        T4.shiftTabSequence = back.seq
        reached = back.reached
        T4.reachedViaShiftTab = reached
        if (reached === null) {
          await page.locator(DRAWER_INPUT).focus({ timeout: 5000 })
          const fwd = await walk('Tab', 60)
          T4.tabSequence = fwd.seq
          reached = fwd.reached
          T4.reachedViaTab = reached
        }
      } else {
        const fwd = await walk('Tab', 80)
        T4.tabSequenceFromDrawerHead = fwd.seq
        reached = fwd.reached
      }
      const focusSeq = T4.shiftTabSequence ?? T4.tabSequence ?? T4.tabSequenceFromDrawerHead ?? []
      T4.focusSequenceTail = focusSeq.slice(-8).map(s => ({ step: s.step, direction: s.direction, tag: s.focus?.tag, role: s.focus?.role, ariaLabel: s.focus?.ariaLabel, text: s.focus?.text, inOptionsRow: s.focus?.inOptionsRow }))
      T4.assertions.push({
        id: 'a1_focus_reaches_option_row',
        pass: reached !== null,
        detail: {
          reached, anchorPath, anchorFocus: T4.anchorFocus, stepsWalked: focusSeq.length - 1,
          focusSequence: focusSeq.map(s => ({ step: s.step, direction: s.direction, tag: s.focus?.tag, role: s.focus?.role, ariaLabel: s.focus?.ariaLabel, text: s.focus?.text, cls: s.focus?.cls, inOptionsRow: s.focus?.inOptionsRow })),
        },
      })
      if (reached !== null) {
        const focusedIdx = await page.evaluate(fn_indexOfActive)
        T4.focusedIndex = focusedIdx
        const beforeSpace = await checkedNow()
        T4.focusBeforeSpace = await focusNow()
        await page.keyboard.press('Space')
        await page.waitForTimeout(150)
        const samplesOn = await sample(HOLD_MS, 'T4 after Space #1')
        const sumOn = sampleSummary(samplesOn, [focusedIdx])
        T4.space1 = { focusedIdx, before: beforeSpace, summary: sumOn }
        T4.space1Samples = samplesOn
        await shotFull('T4-1-after-space-on')
        await shotClip(page.locator(OPTIONS), 'T4-1-options-crop')
        T4.assertions.push({
          id: 'a2_space_checks_and_persists',
          pass: sumOn.allOnAllTicks && beforeSpace[focusedIdx]?.checked === 'false',
          detail: { focusedIndex: focusedIdx, focusedBefore: beforeSpace[focusedIdx], ...sumOn },
        })
        // ③ 再按 Space 应可再次切换
        const beforeSpace2 = await checkedNow()
        await page.keyboard.press('Space')
        await page.waitForTimeout(200)
        const afterSpace2 = await checkedNow()
        T4.space2 = { before: beforeSpace2, after: afterSpace2 }
        await shotFull('T4-2-after-space-off')
        T4.assertions.push({
          id: 'a3_space_toggles_back',
          pass: beforeSpace2[focusedIdx]?.checked === 'true' && afterSpace2[focusedIdx]?.checked === 'false',
          detail: { focusedIndex: focusedIdx, before: beforeSpace2[focusedIdx], after: afterSpace2[focusedIdx], full: T4.space2 },
        })
        // ④ ArrowDown / ArrowUp 是否改变选中或焦点
        const grab = async () => ({ checked: await checkedNow(), activeIndex: await page.evaluate(fn_indexOfActive), focus: await focusNow() })
        const beforeArrow = await grab()
        await page.keyboard.press('ArrowDown')
        await page.waitForTimeout(250)
        const afterDown = await grab()
        await page.keyboard.press('ArrowUp')
        await page.waitForTimeout(250)
        const afterUp = await grab()
        T4.arrows = { beforeArrow, afterDown, afterUp }
        await shotFull('T4-3-after-arrows')
        const unchanged = JSON.stringify(beforeArrow.checked) === JSON.stringify(afterUp.checked) && beforeArrow.activeIndex === afterUp.activeIndex
        T4.assertions.push({
          id: 'a4_arrows_do_not_change_selection_or_focus',
          pass: unchanged,
          detail: {
            unchanged,
            checkedBefore: beforeArrow.checked, checkedAfterDown: afterDown.checked, checkedAfterUp: afterUp.checked,
            activeIndexBefore: beforeArrow.activeIndex, activeIndexAfterDown: afterDown.activeIndex, activeIndexAfterUp: afterUp.activeIndex,
            note: 'expected: official dsh-client-ui-user-questions also has no roving tabindex / no arrow handling ⇒ 属与官方一致的偏差，非 btw 新缺陷',
          },
        })
        T4.optionTabIndexes = await page.evaluate(() => Array.from(document.querySelectorAll('[data-side-chat-surface-mode] [class*="questionOptions"] > button')).map(b => ({ label: b.querySelector('[class*="questionOptionLabel"]')?.textContent ?? null, tabIndex: b.tabIndex, hasTabindexAttr: b.hasAttribute('tabindex'), role: b.getAttribute('role') })))
      }
      T4.verdict = T4.assertions.every(a => a.pass) ? 'PASS' : (reached === null ? 'INCONCLUSIVE' : 'FAIL')
    } else {
      T4.verdict = 'INCONCLUSIVE'
      T4.reason = 'no question card present when T4 started'
    }
    flush(); phaseFlush('T4')

    // ================= T3 (narrow viewport bottom-sheet) =================
    const T3 = { name: 'T3 <720px bottom-sheet option rows', startedAt: new Date().toISOString(), assertions: [], verdict: 'INCONCLUSIVE' }
    run.phases.T3 = T3
    const snapBeforeResize = await snap()
    T3.beforeResize = { placement: snapBeforeResize.placement, scrim: snapBeforeResize.scrim, optionCount: snapBeforeResize.cards[0]?.questions[0]?.optionCount ?? 0 }
    await page.setViewportSize({ width: 640, height: 800 })
    await page.waitForTimeout(1500)
    let modeSeen = null
    const modeT0 = Date.now()
    while (Date.now() - modeT0 < 15000) {
      const s = await snap()
      modeSeen = s.placement?.mode ?? null
      if (modeSeen === 'bottom-sheet') break
      await page.waitForTimeout(300)
    }
    T3.modeAfterResize = modeSeen
    T3.modeWaitMs = Date.now() - modeT0
    const s3 = await snap()
    T3.placementAfterResize = s3.placement
    T3.scrimAfterResize = s3.scrim
    T3.drawerAfterResize = s3.drawer
    T3.surfaceMode = s3.surfaceMode
    // 把卡片滚进视野
    await page.evaluate(() => { const c = document.querySelector('[data-side-chat-surface-mode] section[class*="questionCard"]'); if (c !== null) c.scrollIntoView({ block: 'center' }) })
    await page.waitForTimeout(600)
    const s3b = await snap()
    T3.afterScrollIntoView = { cardCount: s3b.cardCount, cardBox: s3b.cards[0]?.box ?? null, options: s3b.cards[0]?.questions[0]?.options?.map(o => ({ label: o.label, box: o.box })) ?? [], optionsWrapBox: s3b.cards[0]?.questions[0]?.optionsWrapBox ?? null, submit: s3b.cards[0]?.submit ?? null, stopButton: s3b.stopButton, viewport: s3b.viewport }
    await shotFull('T3-1-bottom-sheet-640x800')
    await shotClip(page.locator(OPTIONS), 'T3-1-options-crop-640x800')

    const optionBoxes = s3b.cards[0]?.questions[0]?.options ?? []
    const vp = s3b.viewport
    const insideAll = optionBoxes.length > 0 && optionBoxes.every(o => o.box !== null && o.box.x >= 0 && o.box.y >= 0 && o.box.right <= vp.w && o.box.bottom <= vp.h)
    const visibleAll = optionBoxes.length > 0 && optionBoxes.every(o => { const w = Math.max(0, Math.min(o.box.right, vp.w) - Math.max(o.box.x, 0)); const h = Math.max(0, Math.min(o.box.bottom, vp.h) - Math.max(o.box.y, 0)); return w * h > 0 })
    T3.assertions.push({
      id: 'a1_bottom_sheet_mode',
      pass: modeSeen === 'bottom-sheet',
      detail: { placementMode: modeSeen, beforeResizeMode: T3.beforeResize.placement?.mode ?? null, degraded: s3.placement?.degraded ?? null, waitMs: T3.modeWaitMs, scrim: s3.scrim, surfaceMode: s3.surfaceMode, mediaQueryMatches: await page.evaluate(() => ({ w720: matchMedia('(width<=720px)').matches, w719: matchMedia('(width<=719.98px)').matches })) },
    })
    T3.assertions.push({
      id: 'a2_card_visible_not_clipped',
      pass: s3b.cardCount === 1 && insideAll && visibleAll,
      detail: { cardBox: s3b.cards[0]?.box ?? null, viewport: vp, optionBoxes: optionBoxes.map(o => ({ label: o.label, box: o.box })), fullyInsideViewport: insideAll, allVisibleAreaGt0: visibleAll, resizeHandlesHidden: await page.evaluate(() => Array.from(document.querySelectorAll('[data-dsh-btw-handle]')).map(h => ({ handle: h.getAttribute('data-dsh-btw-handle'), display: getComputedStyle(h).display }))) },
    })
    // 点选 + 采样（选当前未选中的第一个选项）
    const stateNow = await checkedNow()
    const targetIdx = stateNow.findIndex(o => o.checked === 'false')
    T3.targetIndex = targetIdx
    T3.targetBefore = targetIdx >= 0 ? stateNow[targetIdx] : null
    let t3ClickMethod = 'normal'
    try {
      await page.locator(OPTION_BUTTONS).nth(targetIdx).click({ timeout: 10000 })
    } catch (error) {
      t3ClickMethod = `normal-failed: ${String(error).split('\n')[0]}`
      await page.locator(OPTION_BUTTONS).nth(targetIdx).click({ timeout: 10000, force: true })
      t3ClickMethod += ' | force-used'
    }
    T3.clickMethod = t3ClickMethod
    T3.clickedAt = new Date().toISOString()
    const samples = await sample(HOLD_MS, 'T3 after click')
    const summary = sampleSummary(samples, [targetIdx])
    T3.samples = samples
    T3.sampleSummary = summary
    await shotFull('T3-2-after-click-hold')
    await shotClip(page.locator(OPTIONS), 'T3-2-options-selected-crop')
    T3.assertions.push({
      id: 'a3_click_persists_in_bottom_sheet',
      pass: summary.allOnAllTicks && t3ClickMethod === 'normal',
      detail: { targetIndex: targetIdx, clickMethod: t3ClickMethod, ...summary },
    })
    // 命中测试（提交按钮 / 停止按钮不被 scrim 吞掉）
    await page.evaluate(() => { const c = document.querySelector('[data-side-chat-surface-mode] section[class*="questionCard"]'); if (c !== null) c.scrollIntoView({ block: 'center' }) })
    await page.waitForTimeout(400)
    const hitSubmit = await page.evaluate(fn_hitSubmit)
    const hitStop = await page.evaluate(fn_hitStop)
    const hitOption = await page.evaluate(fn_hit, `${SURFACE} [class*="questionOptions"] > button`)
    const hitComposer = await page.evaluate(fn_hit, `${SURFACE} textarea[aria-label="输入一个临时问题…"]`)
    T3.hitTests = { submit: hitSubmit, stop: hitStop, optionRow: hitOption, composer: hitComposer }
    // 用真实鼠标点击提交按钮，验证未被 scrim 吞掉（Playwright 会做 hit-test）
    let submitRealClick = null
    try {
      await page.locator(CARD).locator('button', { hasText: BTN_ANSWER }).first().click({ timeout: 8000 })
      submitRealClick = 'ok'
      T3.submittedInBottomSheet = true
      await page.waitForTimeout(800)
      T3.cardCountAfterSubmit = (await snap()).cardCount
    } catch (error) { submitRealClick = String(error).split('\n')[0] }
    T3.submitRealClick = submitRealClick
    T3.assertions.push({
      id: 'a4_controls_hittable_not_swallowed_by_scrim',
      pass: hitSubmit.hitIsSelfOrDescendant === true && hitOption.hitIsSelfOrDescendant === true && hitSubmit.hitIsScrim === false && submitRealClick === 'ok',
      detail: {
        hitSubmit: { label: hitSubmit.label, disabled: hitSubmit.disabled, hitTag: hitSubmit.hitTag, hitCls: hitSubmit.hitCls, isSelf: hitSubmit.hitIsSelfOrDescendant, isScrim: hitSubmit.hitIsScrim },
        hitStop: { found: hitStop.found, ariaLabel: hitStop.ariaLabel, hitTag: hitStop.hitTag, isSelf: hitStop.hitIsSelfOrDescendant, isScrim: hitStop.hitIsScrim },
        hitOptionRow: { hitTag: hitOption.hitTag, isSelf: hitOption.hitIsSelfOrDescendant, isScrim: hitOption.hitIsScrim },
        composer: { hitTag: hitComposer.hitTag, isSelf: hitComposer.hitIsSelfOrDescendant },
        scrim: s3.scrim, realClickOnSubmit: submitRealClick,
      },
    })
    await shotFull('T3-3-final')
    T3.verdict = T3.assertions.every(a => a.pass) ? 'PASS' : 'FAIL'
    flush(); phaseFlush('T3')

    // ---------- close-up: resource urls actually loaded ----------
    run.resourceUrlsAtEnd = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(n => /dsh-btw/.test(n)))
    run.finishedAt = new Date().toISOString()
    flush()
  } catch (error) {
    run.fatalError = String(error).split('\n').slice(0, 3).join(' | ')
    log(`FATAL: ${run.fatalError}`)
    try { await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-FATAL.png`) }) } catch { /* ignore */ }
  } finally {
    run.finishedAt = new Date().toISOString()
    flush()
    await browser.close()
    log(`wrote raw-${STAMP}.json`)
  }
  const summary = Object.fromEntries(Object.entries(run.phases).map(([k, v]) => [k, v.verdict]))
  console.log(JSON.stringify({ stamp: STAMP, verdicts: summary, fatal: run.fatalError ?? null }, null, 2))
}

process.exitCode = (await main()) === undefined ? 0 : 1
