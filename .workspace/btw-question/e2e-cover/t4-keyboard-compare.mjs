/**
 * T4 修正轮 + 官方对照轮。
 *
 * 背景：首轮 T4 在 **单选（role=radio）** 卡片上断言「再按 Space 可再次切换（取消选中）」→ FAIL。
 * 读源发现：单选语义下 radio 不可取消——
 *   btw  : controller toggle：`if (!multiSelect) selected.clear(); if (selected.has(label)) delete else add`
 *          ⇒ clear 之后 has() 恒 false ⇒ 必然重新 add ⇒ 勾选不可撤销（radio 语义）。
 *   官方 : `choose()` 单选分支 `return { selected: [label] }` ⇒ 同样恒选中（radio 语义）。
 * ⇒ 首轮 T4 的期望值本身不符合 radio 语义；「可再次切换」应在 **多选（checkbox）** 上验证。
 *
 * 本脚本：
 *   A. btw 多选卡片：Tab 聚焦选项行 → Space(true) → Space(false，真正取消勾选) → Space(true)
 *      → ArrowDown/ArrowUp 无作用；50ms×3s 采样。
 *   B. 官方卡片实测同一组键盘行为（含 radio 的「再按不取消」），做逐项对照。
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

const BTW_BUTTON = 'button[title="打开 btw"], button[title="关闭 btw"], button[title="收起 btw"]'
const SURFACE = '[data-side-chat-surface-mode]'
const DRAWER_INPUT = `${SURFACE} textarea[aria-label="输入一个临时问题…"]`
const CARD = `${SURFACE} section[class*="questionCard"]`
const OPTIONS = `${SURFACE} [class*="questionOptions"]`
const OPTION_BUTTONS = `${SURFACE} [class*="questionOptions"] > button`
const OFFICIAL_ROOT = '[data-question-key]'
const OFFICIAL_OPTIONS = '[data-question-key] button[class*="_option"]'
const KICKOFF = '只回复两个字：好的。'

const ASK_OFFICIAL = '请立刻调用 ask_user_question 工具向我提一个问题：单选，header 写「确认」，问题写「是否继续？」，选项分别是「继续」和「停止」。必须真实调用工具，不要用纯文字代替。'
const ASK_OFFICIAL_RETRY = '你上一次没有调用工具。请现在立刻调用 ask_user_question：单选，header「确认」，问题「是否继续？」，选项「继续」「停止」。只允许调用工具。'
// 多选（不给键名）
const ASK_BTW_MULTI = '请立刻调用 btw_ask_user 工具向我提一个问题：我希望可以同时勾选多个选项（多选，允许一次选中好几个），3 个选项。header 写「配料」，问题写「你要加哪几种？」，选项「香菜」「葱花」「辣椒」。必须真实调用工具，不要用纯文字代替。'
const ASK_BTW_MULTI_RETRY = '请现在立刻调用 btw_ask_user 工具，提一个**多选**问题（multi_select 为 true）：header「配料」，问题「你要加哪几种？」，选项「香菜」「葱花」「辣椒」。只调用工具。'

const rect = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) } }

const fn_probeOfficial = () => {
  const root = document.querySelector('[data-question-key]')
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) } }
  if (root === null) return { found: false }
  const wrap = [...root.querySelectorAll('button[class*="_option"]')].map(b => ({
    label: b.getAttribute('aria-label'), role: b.getAttribute('role'), ariaChecked: b.getAttribute('aria-checked'),
    type: b.getAttribute('type'), tabIndex: b.tabIndex, hasTabindexAttr: b.hasAttribute('tabindex'),
    cls: String(b.className).slice(0, 120), box: rect(b),
  }))
  const container = root.querySelector('[class*="_options"]')
  const head = root.querySelector('h2, [class*="_title"]')
  return {
    found: true,
    questionKey: root.getAttribute('data-question-key'),
    header: root.querySelector('[class*="_eyebrow"]')?.textContent ?? null,
    question: head === null ? null : head.textContent,
    containerRole: container === null ? null : container.getAttribute('role'),
    options: wrap,
  }
}

const fn_anchorFirstFocusable = (rootSel) => {
  const root = document.querySelector(rootSel)
  if (root === null) return { ok: false, why: 'root missing' }
  const cands = [...root.querySelectorAll('button, textarea, input, select, a[href], [tabindex]')]
    .filter(el => el.disabled !== true && el.tabIndex >= 0 && el.offsetParent !== null)
  if (cands.length === 0) return { ok: false, why: 'no focusable element' }
  cands[0].focus()
  return { ok: document.activeElement === cands[0], tag: cands[0].tagName, cls: String(cands[0].className || '').slice(0, 70), ariaLabel: cands[0].getAttribute('aria-label'), candidateCount: cands.length }
}

const fn_focus = () => {
  const a = document.activeElement
  if (a === null) return { none: true }
  const scopes = { btwOption: '[data-side-chat-surface-mode] [class*="questionOptions"] > button', officialOption: '[data-question-key] button[class*="_option"]' }
  const idx = {}
  for (const [k, sel] of Object.entries(scopes)) idx[k] = Array.from(document.querySelectorAll(sel)).indexOf(a)
  return {
    tag: a.tagName, role: a.getAttribute('role'), ariaLabel: a.getAttribute('aria-label'), text: (a.textContent || '').slice(0, 40),
    cls: String(a.className || '').slice(0, 80), btwOptionIndex: idx.btwOption, officialOptionIndex: idx.officialOption,
    inBtwOptionsRow: idx.btwOption >= 0, inOfficialOptionsRow: idx.officialOption >= 0,
  }
}

async function main() {
  const run = { kind: 'T4 corrected (checkbox deselect) + official parity', url: URL_, startedAt: new Date().toISOString(), stamp: STAMP, sampleMs: SAMPLE_MS, holdMs: HOLD_MS, phases: {} }
  const flush = () => fs.writeFileSync(path.join(OUT, `raw-${STAMP}-T4b.json`), JSON.stringify(run, null, 2))

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  run.pageErrors = []
  page.on('pageerror', e => run.pageErrors.push(String(e).slice(0, 300)))
  const shotFull = async (name) => { const f = path.join(OUT, `fullpage-${STAMP}-${name}.png`); await page.screenshot({ path: f }); return f }
  const shotClip = async (loc, name) => { try { const f = path.join(OUT, `${STAMP}-${name}.png`); await loc.first().screenshot({ path: f, timeout: 15000 }); return f } catch (e) { return `ERR ${String(e).split('\n')[0]}` } }

  const stateOf = async (sel) => await page.evaluate((s) => Array.from(document.querySelectorAll(s)).map(b => ({ label: b.getAttribute('aria-label') ?? b.querySelector('[class*="questionOptionLabel"]')?.textContent ?? null, checked: b.getAttribute('aria-checked'), role: b.getAttribute('role') })), sel)
  const sample = async (sel, ms, label) => {
    const t0 = Date.now(); const arr = []
    while (Date.now() - t0 < ms) { arr.push({ ms: Date.now() - t0, states: await stateOf(sel) }); await page.waitForTimeout(SAMPLE_MS) }
    log(`sampled ${label}: ${arr.length} ticks`)
    return arr
  }
  const summarize = (arr, idx) => {
    const ticks = arr.length
    const on = arr.filter(t => t.states[idx]?.checked === 'true').length
    return { ticks, onTicks: on, ratio: `${on}/${ticks}`, allOn: on === ticks, allOff: on === 0, observedMs: arr.length === 0 ? 0 : arr[arr.length - 1].ms, first: arr[0]?.states?.[idx] ?? null, last: arr[arr.length - 1]?.states?.[idx] ?? null }
  }
  const newSession = async () => {
    await page.locator('button[class*="newSession"]').first().click({ timeout: 20000 })
    await page.waitForSelector('textarea', { timeout: 30000 })
  }
  const kickoff = async () => {
    const c = page.locator('textarea').first()
    await c.fill(KICKOFF); await c.press('Enter')
    await page.waitForFunction(() => { const t = document.querySelector('textarea'); return t !== null && t.disabled === false }, null, { timeout: 120000 })
  }
  const tabUntil = async (predicateKey, max) => {
    const seq = [{ step: 0, dir: 'anchor', focus: await page.evaluate(fn_focus) }]
    for (let i = 1; i <= max; i++) {
      await page.keyboard.press('Tab'); await page.waitForTimeout(60)
      const f = await page.evaluate(fn_focus)
      seq.push({ step: i, dir: 'Tab', focus: f })
      if (f[predicateKey] === true) return { seq, reachedAt: i }
    }
    return { seq, reachedAt: null }
  }
  const keyProbe = async (sel, optIdx, tag) => {
    const idxKey = tag === 'official' ? 'officialOptionIndex' : 'btwOptionIndex'
    const out = {}
    out.before = await stateOf(sel)
    await page.keyboard.press('Space'); await page.waitForTimeout(150)
    const s1 = await sample(sel, HOLD_MS, `${tag} Space#1`)
    out.space1 = summarize(s1, optIdx); out.space1Samples = s1
    out.afterSpace1 = await stateOf(sel)
    await page.keyboard.press('Space'); await page.waitForTimeout(200)
    out.afterSpace2 = await stateOf(sel)
    const s2 = await sample(sel, HOLD_MS, `${tag} Space#2`)
    out.space2 = summarize(s2, optIdx); out.space2Samples = s2
    await page.keyboard.press('Space'); await page.waitForTimeout(200)
    out.afterSpace3 = await stateOf(sel)
    const before = { checks: await stateOf(sel), index: (await page.evaluate(fn_focus))[idxKey] }
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250)
    const down = { checks: await stateOf(sel), focus: await page.evaluate(fn_focus) }
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(250)
    const up = { checks: await stateOf(sel), focus: await page.evaluate(fn_focus) }
    out.arrows = {
      before, down, up, idxKey,
      unchanged: JSON.stringify(before.checks) === JSON.stringify(up.checks) && down.focus[idxKey] === before.index && up.focus[idxKey] === before.index,
    }
    return out
  }

  try {
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout: 90000 })
    run.boot = await page.evaluate(() => { const e = (window.__DSH_BOOT__.entries || []).find(x => /dsh-btw/.test(x.id)); return { rev: window.__DSH_BOOT__.rev, btwRev: e?.rev ?? null, btwUrl: e?.url ?? null } })
    log(`boot ok btw rev=${run.boot.btwRev}`)

    // ================= A. 官方卡片对照 =================
    const A = { name: 'A official card keyboard parity', assertions: [] }
    run.phases.A_official = A
    await newSession()
    await kickoff()
    let offSeen = false
    for (const [i, p] of [[1, ASK_OFFICIAL], [2, ASK_OFFICIAL_RETRY]]) {
      const c = page.locator('textarea').first()
      await c.fill(p); await c.press('Enter')
      log(`official ask attempt ${i}`)
      try { await page.waitForSelector(OFFICIAL_OPTIONS, { timeout: 90000 }); offSeen = true; A.attempt = i; break } catch {
        await page.waitForFunction(() => { const t = document.querySelector('textarea'); return t !== null && t.disabled === false }, null, { timeout: 120000 })
      }
    }
    if (offSeen) {
      await page.waitForTimeout(1000)
      A.card = await page.evaluate(fn_probeOfficial)
      await shotFull('T4b-A1-official-card')
      await shotClip(page.locator(OFFICIAL_ROOT), 'T4b-A1-official-card-crop')
      A.anchor = await page.evaluate(fn_anchorFirstFocusable, OFFICIAL_ROOT)
      const walk = await tabUntil('inOfficialOptionsRow', 60)
      A.tabSequence = walk.seq
      A.reachedAt = walk.reachedAt
      A.assertions.push({ id: 'official_a1_tab_reaches_option', pass: walk.reachedAt !== null, detail: { reachedAt: walk.reachedAt, anchor: A.anchor, optionTabIndexes: A.card.options.map(o => ({ label: o.label, role: o.role, tabIndex: o.tabIndex, hasTabindexAttr: o.hasTabindexAttr })), containerRole: A.card.containerRole } })
      if (walk.reachedAt !== null) {
        const idx = (await page.evaluate(fn_focus)).officialOptionIndex
        A.focusedIndex = idx
        A.keyboard = await keyProbe(OFFICIAL_OPTIONS, idx, 'official')
        await shotFull('T4b-A2-official-after-keys')
        await shotClip(page.locator(OFFICIAL_ROOT), 'T4b-A2-official-after-keys-crop')
        A.assertions.push({ id: 'official_a2_space_selects', pass: A.keyboard.space1.allOn && A.keyboard.afterSpace1[idx]?.checked === 'true', detail: { focusedIndex: idx, before: A.keyboard.before[idx], space1: A.keyboard.space1 } })
        A.assertions.push({ id: 'official_a3_space_again_keeps_radio_selected', pass: A.keyboard.afterSpace2[idx]?.checked === 'true', detail: { focusedIndex: idx, afterSpace1: A.keyboard.afterSpace1[idx], afterSpace2: A.keyboard.afterSpace2[idx], note: '官方 choose() 单选分支 return {selected:[label]} ⇒ radio 不可取消' } })
        A.assertions.push({ id: 'official_a4_arrows_noop', pass: A.keyboard.arrows.unchanged === true, detail: { unchanged: A.keyboard.arrows.unchanged, activeIndexBefore: A.keyboard.arrows.before.index, afterDown: A.keyboard.arrows.down.focus.officialOptionIndex, afterUp: A.keyboard.arrows.up.focus.officialOptionIndex, checksSame: JSON.stringify(A.keyboard.arrows.before.checks) === JSON.stringify(A.keyboard.arrows.up.checks) } })
      }
      A.verdict = A.assertions.every(a => a.pass) ? 'PASS' : (A.reachedAt === null ? 'INCONCLUSIVE' : 'FAIL')
    } else { A.verdict = 'INCONCLUSIVE'; A.reason = 'official question card never appeared' }
    flush()

    // ================= B. btw 多选 checkbox 键盘 =================
    const B = { name: 'B btw multi-select checkbox keyboard', assertions: [] }
    run.phases.B_btw_checkbox = B
    await newSession()
    await kickoff()
    await page.waitForSelector(BTW_BUTTON, { timeout: 120000 })
    await page.locator(BTW_BUTTON).first().click({ timeout: 20000 })
    await page.waitForSelector(DRAWER_INPUT, { timeout: 30000 })
    let bSeen = false
    for (const [i, p] of [[1, ASK_BTW_MULTI], [2, ASK_BTW_MULTI_RETRY]]) {
      await page.fill(DRAWER_INPUT, p); await page.press(DRAWER_INPUT, 'Enter')
      log(`btw multi ask attempt ${i}`)
      try { await page.waitForSelector(CARD, { timeout: 90000 }); bSeen = true; B.attempt = i; break } catch { /* next */ }
    }
    if (bSeen) {
      await page.waitForTimeout(1200)
      B.card = await page.evaluate(() => {
        const card = document.querySelector('[data-side-chat-surface-mode] section[class*="questionCard"]')
        if (card === null) return { found: false }
        const rect = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }
        const wrap = card.querySelector('[class*="questionOptions"]')
        return {
          found: true,
          header: card.querySelector('[class*="questionHeader"]')?.textContent ?? null,
          question: card.querySelector('[class*="questionText"]')?.textContent ?? null,
          containerRole: wrap === null ? null : wrap.getAttribute('role'),
          options: wrap === null ? [] : [...wrap.querySelectorAll(':scope > button')].map(b => ({ label: b.querySelector('[class*="questionOptionLabel"]')?.textContent ?? null, role: b.getAttribute('role'), ariaChecked: b.getAttribute('aria-checked'), tabIndex: b.tabIndex, hasTabindexAttr: b.hasAttribute('tabindex'), box: rect(b) })),
        }
      })
      await shotFull('T4b-B1-btw-multi-card')
      await shotClip(page.locator(OPTIONS), 'T4b-B1-btw-multi-options-crop')
      const composer = await page.evaluate((sel) => { const t = document.querySelector(sel); return t === null ? null : { disabled: t.disabled } }, DRAWER_INPUT)
      B.composerDisabled = composer?.disabled ?? null
      B.anchorNote = `composer textarea disabled=${composer?.disabled} (待答状态) ⇒ 锚点回退为抽屉内第一个可聚焦元素`
      B.anchor = await page.evaluate(fn_anchorFirstFocusable, '#dsh-btw-drawer')
      const walk = await tabUntil('inBtwOptionsRow', 80)
      B.tabSequence = walk.seq
      B.reachedAt = walk.reachedAt
      B.assertions.push({ id: 'btw_b1_tab_reaches_option', pass: walk.reachedAt !== null, detail: { reachedAt: walk.reachedAt, composerDisabled: composer?.disabled ?? null, anchor: B.anchor, containerRole: B.card.containerRole, optionTabIndexes: B.card.options.map(o => ({ label: o.label, role: o.role, tabIndex: o.tabIndex, hasTabindexAttr: o.hasTabindexAttr })) } })
      if (walk.reachedAt !== null) {
        const idx = (await page.evaluate(fn_focus)).btwOptionIndex
        B.focusedIndex = idx
        B.keyboard = await keyProbe(OPTION_BUTTONS, idx, 'btw')
        await shotFull('T4b-B2-btw-after-keys')
        await shotClip(page.locator(OPTIONS), 'T4b-B2-btw-after-keys-crop')
        B.assertions.push({ id: 'btw_b2_space_checks_and_persists', pass: B.keyboard.space1.allOn && B.keyboard.before[idx]?.checked === 'false', detail: { focusedIndex: idx, before: B.keyboard.before[idx], space1: B.keyboard.space1 } })
        B.assertions.push({ id: 'btw_b3_space_toggles_off_checkbox', pass: B.keyboard.afterSpace2[idx]?.checked === 'false' && B.keyboard.space2.allOff, detail: { focusedIndex: idx, afterSpace1: B.keyboard.afterSpace1[idx], afterSpace2: B.keyboard.afterSpace2[idx], space2: B.keyboard.space2, note: '多选 checkbox 语义下取消勾选生效（与单选 radio 行为相对照）' } })
        B.assertions.push({ id: 'btw_b4_space_rechecks', pass: B.keyboard.afterSpace3[idx]?.checked === 'true', detail: { afterSpace2: B.keyboard.afterSpace2[idx], afterSpace3: B.keyboard.afterSpace3[idx] } })
        B.assertions.push({ id: 'btw_b5_arrows_noop', pass: B.keyboard.arrows.unchanged === true, detail: { unchanged: B.keyboard.arrows.unchanged, checksSame: JSON.stringify(B.keyboard.arrows.before.checks) === JSON.stringify(B.keyboard.arrows.up.checks), focusBefore: B.keyboard.arrows.before, focusAfterDown: B.keyboard.arrows.down.focus, focusAfterUp: B.keyboard.arrows.up.focus } })
      }
      B.verdict = B.assertions.every(a => a.pass) ? 'PASS' : (B.reachedAt === null ? 'INCONCLUSIVE' : 'FAIL')
    } else { B.verdict = 'INCONCLUSIVE'; B.reason = 'btw multi-select card never appeared' }
    flush()
  } catch (error) {
    run.fatalError = String(error).split('\n').slice(0, 3).join(' | ')
    log(`FATAL ${run.fatalError}`)
    try { await page.screenshot({ path: path.join(OUT, `fullpage-${STAMP}-FATAL.png`) }) } catch { /* ignore */ }
  } finally {
    run.finishedAt = new Date().toISOString()
    flush()
    await browser.close()
  }
  console.log(JSON.stringify({ stamp: STAMP, verdicts: Object.fromEntries(Object.entries(run.phases).map(([k, v]) => [k, v.verdict])), fatal: run.fatalError ?? null }, null, 2))
}

await main()
