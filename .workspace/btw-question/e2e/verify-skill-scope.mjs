/**
 * 跨工作区 skill 可见性实证：在 GUI 里把工作区切到目标目录 → 新建会话 → 问 agent
 * 它的 skill 清单里是否有 program-notebook → 读回答 + 截图。
 * 用法：node verify-skill-scope.mjs "Dexterous_Hand_23Dof" dex
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire('/home/CNS2026495165/playwright_scratch/')
const { chromium } = require('playwright')

const WS = process.argv[2]
const TAG = process.argv[3] ?? 'run'
const OUT = '/home/CNS2026495165/dsh/.workspace/btw-question/e2e'
const PROMPT = '只回答一个问题，不要调用任何工具、不要读文件：你的系统提示里「可用技能（skills）」清单中是否包含名为 program-notebook 的 skill？第一行只写 有 或 无；第二行写该 skill 描述的前 20 个字（若无则写 -）。'

const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] })
const p = await (await b.newContext({ viewport:{width:1440,height:900}, locale:'zh-CN' })).newPage()
const out = { workspace: WS, tag: TAG, prompt: PROMPT, at: new Date().toISOString() }
try {
  await p.goto('http://127.0.0.1:3080', { waitUntil:'domcontentloaded', timeout:60000 })
  await p.waitForFunction(() => window.__DSH_BOOT__ !== undefined && document.querySelector('div[role="tree"]') !== null, null, { timeout:90000 })
  await p.locator('button[class*="newSession"]').first().click()
  await p.waitForTimeout(800)
  await p.locator('button[class*="workspace"]').first().click()
  await p.waitForTimeout(600)
  await p.getByRole('menuitem', { name: WS, exact: true }).click()
  await p.waitForTimeout(600)
  out.selectedWorkspace = await p.locator('button[class*="workspace"]').first().innerText()
  const ta = p.locator('textarea').first()
  await ta.fill(PROMPT)
  await ta.press('Enter')
  // 等回答：正文里出现单独一行 有/无
  const deadline = Date.now() + 150000
  let text = ''
  while (Date.now() < deadline) {
    text = await p.evaluate(() => document.body.innerText)
    if (/(^|\n)\s*(有|无)\s*(\n|$)/u.test(text)) break
    await p.waitForTimeout(2000)
  }
  const m = text.match(/(?:^|\n)\s*(有|无)\s*\n?([^\n]{0,40})/u)
  out.answer = m === null ? null : { verdict: m[1], detail: (m[2] ?? '').trim() }
  out.tailText = text.slice(-600)
  out.shot = `${OUT}/skill-scope-${TAG}.png`
  await p.screenshot({ path: out.shot })
} catch (e) {
  out.error = String(e).split('\n')[0]
} finally {
  fs.writeFileSync(`${OUT}/skill-scope-${TAG}.json`, JSON.stringify(out, null, 2))
  console.log(JSON.stringify({ tag: TAG, ws: WS, answer: out.answer ?? null, error: out.error ?? null, selected: out.selectedWorkspace ?? null }))
  await b.close()
}
