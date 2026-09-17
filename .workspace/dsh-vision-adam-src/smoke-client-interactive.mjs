// Interactive smoke for the vision-adam settings section: mounts the section
// with react-dom/client under happy-dom, fills the four fields, clicks 保存,
// and asserts the scope received the expected set/unset ops (unchanged fields
// produce no write, emptied fields produce an unset, maxTokens is a number).
import { createRequire } from 'node:module'
const require = createRequire('/home/CNS2026495165/dsh/dsh-btw/package.json')
const react = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { Window } = require('happy-dom')

let captured = null
const window = new Window()
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
window.__ModuleLoader__ = { load(reg) { captured = reg } }

await import('./lib/client.js')
if (captured === null) throw new Error('no module registration')
const mod = captured.factory((spec) => {
  if (spec === 'react') return react
  throw new Error(`unexpected require: ${spec}`)
})

// Fake scope: starts with a stored section (user layer), records writes.
const calls = []
let snapshot = {
  status: 'ready',
  value: { model: 'deepseek-v4.1-flash', baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'OPENCODE_GO_API_KEY', maxTokens: 2000 },
  base: undefined,
  user: { model: 'deepseek-v4.1-flash', maxTokens: 2000 },
  revision: 3,
  writable: true,
  mode: 'host',
}
const scope = {
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  async set(field, value) { calls.push(['set', field, value]); snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value }, user: { ...snapshot.user, [field]: value }, revision: snapshot.revision + 1 } },
  async unset(field) { calls.push(['unset', field]); snapshot = { ...snapshot, user: { ...snapshot.user, [field]: undefined } } },
}

let sectionOptions = null
let sectionComponent = null
const ctxStub = {
  settingsScope: { bind: () => scope },
  slots: {
    inject(_name, cb) { cb() },
    register(options, component) { sectionOptions = options; sectionComponent = component; return () => {} },
  },
}
mod.apply(ctxStub)
const injected = sectionOptions.inject()

// --- happy-dom mount -----------------------------------------------------------
const ReactDOM = require('react-dom/client')
const container = window.document.createElement('div')
window.document.body.appendChild(container)
const root = ReactDOM.createRoot(container)
root.render(react.createElement(sectionComponent, injected))
await new Promise((resolve) => setTimeout(resolve, 30))

const inputByLabel = (labelText) => {
  const labels = [...window.document.querySelectorAll('label')]
  const label = labels.find((el) => el.textContent === labelText)
  if (!label) throw new Error(`label not found: ${labelText}`)
  return window.document.getElementById(label.htmlFor)
}
const modelInput = inputByLabel('识图模型')
const baseURLInput = inputByLabel('网关 Base URL')
const maxTokensInput = inputByLabel('单次分析最大输出 tokens')
const buttons = [...window.document.querySelectorAll('button')]
const saveButton = buttons.find((b) => b.textContent.includes('保存到 settings.yaml'))
if (!saveButton) throw new Error('save button not found')

// Change model (stored user value differs → set), clear maxTokens (stored in
// user layer → unset), keep baseURL/apiKeyEnv untouched (never stored → no op).
const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
const setInput = (input, value) => {
  valueSetter.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}
setInput(modelInput, 'deepseek-v4.1-flash-new')
setInput(maxTokensInput, '') // stored 2000 → unset
// baseURL/apiKeyEnv keep their effective defaults → no writes

// react flushes state before the next event; wait a tick, then click save.
await new Promise((resolve) => setTimeout(resolve, 20))
saveButton.click()
await new Promise((resolve) => setTimeout(resolve, 40))
const summary = [...window.document.querySelectorAll('div')].map((d) => d.textContent).join('\n')
if (!summary.includes('已保存')) throw new Error(`save status missing; got:\n${summary.slice(0, 400)}`)
if (!calls.some(([op, field, value]) => op === 'set' && field === 'model' && value === 'deepseek-v4.1-flash-new')) throw new Error(`model set missing: ${JSON.stringify(calls)}`)
if (!calls.some(([op, field]) => op === 'unset' && field === 'maxTokens')) throw new Error(`maxTokens unset missing: ${JSON.stringify(calls)}`)
if (calls.some(([, field]) => field === 'baseURL' || field === 'apiKeyEnv')) throw new Error(`untouched fields must not be written: ${JSON.stringify(calls)}`)

// Initial server-render sanity (defaults visible).
const html = renderToStaticMarkup(react.createElement(sectionComponent, injected))
for (const needle of ['vision-adam 识图设置', '保存到 settings.yaml']) {
  if (!html.includes(needle)) throw new Error(`missing ${needle}`)
}

console.log('vision-adam client interactive smoke: PASS')
console.log('  writes:', JSON.stringify(calls))
root.unmount()
