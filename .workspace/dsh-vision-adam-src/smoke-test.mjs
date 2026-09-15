// Smoke test: run v4f-test.png through analyzeImageBytes with the NEW prompt
// (default branch + question branch) and through the OLD deployed copy for comparison.
// API key is read from ~/.dsh/.credentials.yaml (OPENCODE_GO_API_KEY ref), never printed.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NEW_MODULE_URL = 'file:///home/CNS2026495165/dsh/.workspace/dsh-vision-adam-src/lib/index.js'
const OLD_MODULE_URL = 'file:///home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js'
const PNG_PATH = '/home/CNS2026495165/dsh/.workspace/v4f-test.png'
const CRED_PATH = join(homedir(), '.dsh', '.credentials.yaml')

// --- credentials ---
function readApiKey() {
  const yaml = readFileSync(CRED_PATH, 'utf8')
  const m = yaml.match(/OPENCODE_GO_API_KEY:\s*["']?([^\s"']+)["']?/)
  if (!m) throw new Error('OPENCODE_GO_API_KEY not found in credentials yaml')
  return m[1]
}

// --- module under test ---
const newMod = await import(NEW_MODULE_URL)
const oldMod = await import(OLD_MODULE_URL)

const mediaType = 'image/png'
const base64 = readFileSync(PNG_PATH).toString('base64')

const options = { baseURL: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4.1-flash', maxTokens: 2000, xApiKey: true, sessionHeader: true }
const apiKey = readApiKey()

const BBTW_QUESTION = '请用中文尽可能完整转录这张图片的全部可见内容（文字逐字、布局、颜色、元素位置），并附审美与设计合理性分析（配色、层级、对齐、可读性、改进建议）。'

const runs = [
  ['NEW default branch (no question)', newMod.analyzeImageBytes, undefined],
  ['NEW question branch (btw question)', newMod.analyzeImageBytes, BBTW_QUESTION],
  ['OLD default branch (no question)', oldMod.analyzeImageBytes, undefined],
]

for (const [label, fn, question] of runs) {
  const t0 = Date.now()
  try {
    const text = await fn(options, apiKey, mediaType, base64, question, undefined)
    console.log(`\n===== ${label} (${Date.now() - t0}ms) =====`)
    console.log(text)
  } catch (error) {
    console.log(`\n===== ${label} FAILED =====`)
    console.log(error instanceof Error ? error.message : String(error))
  }
}
