// Bundle smoke for .workspace/dsh-vision-adam-src/lib/client.js
// Verifies: __ModuleLoader__ registration shape, exports.inject/apply, the
// settings.section registration (id/name/label/component), and a render of the
// section against a fake settings scope (react-dom/server, no effects).
import { createRequire } from 'node:module'
// react/react-dom live in the dsh-btw workspace node_modules (deployment-side
// copy); anchor the require there so the smoke does not need its own install.
const require = createRequire('/home/CNS2026495165/dsh/dsh-btw/package.json')

const react = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      captured = registration
    },
  },
}

await import('./lib/client.js')

if (captured === null) throw new Error('client.js did not register a module')
if (captured.id !== '@deepseek-ai/dsh-vision-adam') throw new Error(`unexpected module id: ${captured.id}`)

const mod = captured.factory((spec) => {
  if (spec === 'react') return react
  throw new Error(`unexpected require: ${spec}`)
})
if (!Array.isArray(mod.inject)) throw new Error('exports.inject must be an array')
if (mod.inject.join(',') !== 'slots,settingsScope') throw new Error(`unexpected inject list: ${mod.inject}`)
if (typeof mod.apply !== 'function') throw new Error('exports.apply must be a function')

// --- apply against a stub ctx -------------------------------------------------
const READY_SNAPSHOT = Object.freeze({
  status: 'ready',
  value: Object.freeze({ model: 'deepseek-v4.1-flash', baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'OPENCODE_GO_API_KEY', maxTokens: 2000 }),
  base: undefined,
  user: undefined,
  revision: 7,
  writable: true,
  mode: 'host',
})
const scopeStub = {
  getSnapshot: () => READY_SNAPSHOT,
  subscribe: () => () => {},
  set: async () => {},
  unset: async () => {},
}
let slotName = null
let slotRegistrant = null
let slotOptions = null
let slotComponent = null
const ctxStub = {
  settingsScope: {
    bind(spec) {
      if (spec.namespace !== 'vision-adam') throw new Error(`bound wrong namespace: ${spec.namespace}`)
      return scopeStub
    },
  },
  slots: {
    inject(name, cb) {
      slotName = name
      slotRegistrant = cb
    },
    register(options, component) {
      slotOptions = options
      slotComponent = component
      return () => {}
    },
  },
}
mod.apply(ctxStub)
if (slotName !== 'settings.section') throw new Error(`unexpected slot name: ${slotName}`)
const dispose = slotRegistrant()
if (slotOptions.name !== 'settings.section') throw new Error(`unexpected section name: ${slotOptions.name}`)
if (slotOptions.id !== '@deepseek-ai/dsh-vision-adam') throw new Error(`unexpected section id: ${slotOptions.id}`)
if (typeof slotOptions.label !== 'string' || slotOptions.label.length === 0) throw new Error('section label must be a non-empty string')
if (typeof slotComponent !== 'function') throw new Error('section component must be a function')

// --- render the section (server render: useState initial draft only) ----------
const injected = slotOptions.inject()
const html = renderToStaticMarkup(react.createElement(slotComponent, injected))
for (const needle of ['vision-adam 识图设置', '识图模型', '网关 Base URL', 'API Key 凭据引用', '单次分析最大输出 tokens', '保存到 settings.yaml', 'deepseek-v4.1-flash']) {
  if (!html.includes(needle)) throw new Error(`rendered section missing "${needle}"`)
}
if (typeof dispose === 'function') dispose()

console.log('vision-adam client bundle smoke: PASS')
console.log('  module id:', captured.id)
console.log('  inject:', mod.inject.join(', '))
console.log('  section:', slotOptions.id, '| order', slotOptions.order, '| label', JSON.stringify(slotOptions.label))
console.log('  render: 4 fields + save/reset + defaults present')
