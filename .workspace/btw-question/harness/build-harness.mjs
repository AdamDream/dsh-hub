/**
 * 离线像素核验 harness（U5 的替代目视证据面）。
 *
 * 用途：本会话的沙箱无法写入部署位 ~/.dsh/profiles/node_modules/@local/dsh-btw/lib
 *      （已被显式拒绝），因此无法把修复推到运行中的 GUI。此 harness 在一个
 *      工作区内的静态页里，用**真实主题 token** + **真实 CSS Module 编译产物**
 *      + **与 SideChatSurface.tsx 同构的选项行标记**渲染修复前/后两张卡片，
 *      供 Playwright 截图与计算样式量化，从而对 CSS/结构改动做像素级核验。
 *
 * 明确边界：本 harness 不能替代「真实 GUI + 真实 btw_ask_user」的端到端实证；
 *          持久化行为由 vitest C1 回归锁证明（已验证：对旧 effect 必失败）。
 *
 * 用法：node build-harness.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('/home/CNS2026495165/dsh/dsh-btw/')
const { transform } = require('lightningcss')

const BTW = '/home/CNS2026495165/dsh/dsh-btw'
const OUT = '/home/CNS2026495165/dsh/.workspace/btw-question/harness'
const PREIMAGE = '/home/CNS2026495165/dsh/.workspace/btw-question/preimage-lib-20260923-113216/client.js'

fs.mkdirSync(OUT, { recursive: true })

// ---- 1. 真实主题 token ----
// The theme bundle carries its full token stylesheet as one minified JS string
// (both the light `body{…}` block and the `body[data-ds-dark-theme]{…}` block).
// Locate the enclosing string literal by scanning literals forward, which keeps
// escape handling exact (a naive backwards scan breaks on `"` inside attribute
// selectors).
function themeStylesheet(source, anchor) {
  const at = source.indexOf(anchor)
  if (at < 0) throw new Error(`theme anchor not found: ${anchor}`)
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === '"' || char === "'" || char === '`') {
      const start = index + 1
      let end = start
      while (end < source.length) {
        if (source[end] === '\\') { end += 2; continue }
        if (source[end] === char) break
        end += 1
      }
      if (at > start && at < end) {
        let css = source.slice(start, end)
        for (let pass = 0; pass < 4; pass += 1) {
          css = css.replace(/\\n/gu, '\n').replace(/\\"/gu, '"').replace(/\\\\/gu, '\\')
        }
        return css
      }
      index = end + 1
      continue
    }
    if (char === '/' && source[index + 1] === '/') { while (index < source.length && source[index] !== '\n') index += 1; continue }
    if (char === '/' && source[index + 1] === '*') { index = source.indexOf('*/', index) + 2; continue }
    index += 1
  }
  throw new Error('enclosing theme string literal not found')
}

const themeSource = fs.readFileSync(path.join(BTW, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')
const themeCss = themeStylesheet(themeSource, 'body{--dsw-alias-bg-base:')
if (!themeCss.includes('--dsw-alias-interactive-bg-hover')) throw new Error('theme tokens missing from the extracted stylesheet')
// The extracted dark block is `body[data-ds-dark-theme]{…}`, which has the same
// specificity as the light `body{…}` block; raise it so the cascade is order
// independent.
const darkTokens = themeCss
  .slice(themeCss.indexOf('body[data-ds-dark-theme]{'))
  .replace(/^body\[data-ds-dark-theme\]\{/u, 'html body[data-ds-dark-theme]{')
if (!darkTokens.includes('--dsw-alias-bg-base')) throw new Error('dark token block not extracted')

// ---- 2. 修复后的真实 CSS Module 编译产物（与 tsdown 同款 pattern） ----
const moduleSource = fs.readFileSync(path.join(BTW, 'src/client/side-chat.module.css'))
const compiled = transform({
  filename: 'src/client/side-chat.module.css',
  code: Buffer.from(moduleSource),
  cssModules: { pattern: '[hash]_[local]' },
  minify: true,
})
const newCss = compiled.code.toString()
const classMap = Object.fromEntries(Object.entries(compiled.exports ?? {}).map(([local, value]) => [local, value.name]))

// ---- 3. 修复前（pre-image bundle）里被哈希过的旧规则 ----
const preimage = fs.readFileSync(PREIMAGE, 'utf8')
const prefix = classMap.questionOption.split('_')[0]
const oldRules = [...preimage.matchAll(
  new RegExp(`\\.${prefix}_(?:questionOption|questionOptionActive|questionOptions|questionOptionLabel|questionOptionDescription)[^{]*\\{[^}]*\\}`, 'gu'),
)].map(match => match[0])
if (oldRules.length === 0) throw new Error('no legacy option rules extracted from the pre-image bundle')
const oldCss = `${oldRules.join('\n')}\n.${prefix}_questionCard,.${prefix}_questionHead,.${prefix}_questionDot,.${prefix}_questionItem,.${prefix}_questionText,.${prefix}_questionOptionCopy,.${prefix}_questionOptionIndex,.${prefix}_questionOptionCheck{all:revert}`

// ---- 4. 与 SideChatSurface.tsx 同构的选项行标记 ----
const cls = name => classMap[name]
const shell = (body, extraCss) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>btw question card harness</title>
<style>${themeCss}\n${darkTokens}</style>
<style>${extraCss}</style>
<style>
  html,body{margin:0;padding:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
  .harness{display:flex;gap:24px;padding:20px;align-items:flex-start}
  .pane{width:400px}
  .paneLabel{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0 0 8px}
  .drawerBg{padding:14px;border-radius:14px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}
</style></head>
<body><div class="harness">${body}</div></body></html>`

function card(classes, { checkbox }) {
  const rows = ['继续', '停止'].map((label, index) => {
    const selected = index === 0
    const buttonClass = selected ? classes.selected : classes.option
    const lead = checkbox
      ? `<span class="${selected ? `${classes.check} ${classes.checkChecked}` : classes.check}" aria-hidden="true">${selected ? '<svg data-icon="check" width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.2 4.8 8.5 9.5 3.8" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>' : ''}</span>`
      : `<span class="${classes.index}" aria-hidden="true">${index + 1}</span>`
    return `    <button type="button" role="${checkbox ? 'checkbox' : 'radio'}" aria-checked="${selected}" class="${buttonClass}">${lead}<span class="${classes.copy}"><span class="${classes.label}">${label}</span></span></button>`
  }).join('\n')
  return `<section class="${classes.card}">
  <div class="${classes.head}"><span class="${classes.dot}" aria-hidden="true"></span><strong>侧边助手正在向你提问</strong></div>
  <p class="${classes.text}">是否继续？</p>
  <div class="${classes.options}" role="${checkbox ? 'group' : 'radiogroup'}">
${rows}
  </div>
</section>`
}

const newClasses = {
  card: cls('questionCard'), options: cls('questionOptions'),
  option: cls('questionOption'), selected: cls('questionOptionSelected'),
  index: cls('questionOptionIndex'), check: cls('questionOptionCheck'), checkChecked: cls('questionOptionCheckChecked'),
  copy: cls('questionOptionCopy'), label: cls('questionOptionLabel'), head: cls('questionHead'), dot: cls('questionDot'),
  text: cls('questionText'),
}
const oldClasses = {
  card: `${prefix}_questionCard`, options: `${prefix}_questionOptions`,
  option: `${prefix}_questionOption`, selected: `${prefix}_questionOptionActive`,
  index: `${prefix}_questionOptionIndex`, check: `${prefix}_questionOptionCheck`, checkChecked: `${prefix}_questionOptionCheckChecked`,
  copy: `${prefix}_questionOptionCopy`, label: `${prefix}_questionOptionLabel`, head: `${prefix}_questionHead`, dot: `${prefix}_questionDot`,
  text: `${prefix}_questionText`,
}
// The legacy card never rendered a lead badge / checkbox / copy wrapper: the
// label sat directly in the button (vertical flex).
function legacyCard() {
  return `<section class="${oldClasses.card}">
  <div class="${oldClasses.head}"><span class="${oldClasses.dot}" aria-hidden="true"></span><strong>侧边助手正在向你提问</strong></div>
  <p class="${oldClasses.text}">是否继续？</p>
  <div class="${oldClasses.options}" role="radiogroup">
    <button type="button" aria-pressed="true" class="${oldClasses.selected}"><span class="${oldClasses.label}">继续</span></button>
    <button type="button" aria-pressed="false" class="${oldClasses.option}"><span class="${oldClasses.label}">停止</span></button>
  </div>
</section>`
}

const beforeHtml = shell(`<div class="pane"><p class="paneLabel">BEFORE (live bundle 6c29b98b…)</p><div class="drawerBg">${legacyCard()}</div></div>`, oldCss)
const afterHtml = shell(
  `<div class="pane"><p class="paneLabel">AFTER (radio, selected)</p><div class="drawerBg">${card(newClasses, { checkbox: false })}</div></div>`
  + `<div class="pane"><p class="paneLabel">AFTER (multi: checkbox)</p><div class="drawerBg">${card(newClasses, { checkbox: true })}</div></div>`,
  newCss,
)

fs.writeFileSync(path.join(OUT, 'before.html'), beforeHtml)
fs.writeFileSync(path.join(OUT, 'after.html'), afterHtml)

const probe = {
  classMap,
  hashPrefix: prefix,
  before: Object.fromEntries(['card', 'options', 'option', 'selected', 'index', 'check', 'label', 'copy'].map(key => [key, oldClasses[key]])),
  after: Object.fromEntries(['card', 'options', 'option', 'selected', 'index', 'check', 'checkChecked', 'label', 'copy'].map(key => [key, newClasses[key]])),
  oldRuleCount: oldRules.length,
}
fs.writeFileSync(path.join(OUT, 'classmap.json'), JSON.stringify(probe, null, 2))
console.log('harness written:', OUT)
console.log('class hash prefix:', prefix)
console.log('legacy rules extracted:', oldRules.length)
