// Bundle smoke for .workspace/deploy-subagent-model/lib/client.js
// Verifies: __ModuleLoader__ registration shape, exports.inject/apply, the
// settings.section registration (id/order/label/component), a server render
// of the default state (text-input fallback), and a seeded-state render of
// the catalog path (provider/model SELECTs fed from the llm-pi-ai snapshot).
// Adapted from .workspace/dsh-vision-adam-src/smoke-client.mjs.
import { createRequire } from 'node:module'
// react/react-dom live in the dsh-btw workspace node_modules (deployment-side
// copy); anchor the require there so the smoke does not need its own install.
const require = createRequire('/home/CNS2026495165/dsh/dsh-btw/package.json')
const react = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(registration) { captured = registration },
  },
}

await import('./lib/client.js')

if (captured === null) throw new Error('client.js did not register a module')
if (captured.id !== '@local/dsh-subagent-model') throw new Error(`unexpected module id: ${captured.id}`)

const mod = captured.factory((spec) => {
  if (spec === 'react') return react
  throw new Error(`unexpected require: ${spec}`)
})
if (!Array.isArray(mod.inject)) throw new Error('exports.inject must be an array')
if (mod.inject.join(',') !== 'slots,settingsScope') throw new Error(`unexpected inject list: ${mod.inject}`)
if (typeof mod.apply !== 'function') throw new Error('exports.apply must be a function')

// --- apply against a stub ctx -------------------------------------------------
const ROUTE_SNAPSHOT = Object.freeze({
  status: 'ready',
  value: Object.freeze({ provider: 'adam', model: 'glm-5.3' }),
  base: Object.freeze({ provider: 'adam', model: 'deepseek-v4.1-flash' }),
  user: Object.freeze({ provider: 'adam', model: 'glm-5.3' }),
  revision: 4,
  writable: true,
  mode: 'host',
})
const CATALOG_SNAPSHOT = Object.freeze({
  status: 'ready',
  value: Object.freeze({
    providers: Object.freeze({
      adam: Object.freeze({ models: [Object.freeze({ id: 'deepseek-v4-flash' }), Object.freeze({ id: 'deepseek-v4.1-flash' }), Object.freeze({ id: 'glm-5.3' })] }),
      'opencode-go': Object.freeze({ models: [Object.freeze({ id: 'kimi-k3' })] }),
    }),
  }),
  base: Object.freeze({}),
  user: Object.freeze({}),
  revision: 1,
  writable: true,
  mode: 'host',
})
const scopeStub = {
  getSnapshot: () => ROUTE_SNAPSHOT,
  subscribe: () => () => {},
  set: async () => {},
  unset: async () => {},
}
const catalogStub = {
  getSnapshot: () => CATALOG_SNAPSHOT,
  subscribe: () => () => {},
}
let slotName = null
let slotRegistrant = null
let slotOptions = null
let slotComponent = null
const bound = []
const ctxStub = {
  settingsScope: {
    bind(spec) {
      bound.push(spec.namespace)
      if (spec.namespace === 'dsh-subagent') return scopeStub
      if (spec.namespace === 'llm-pi-ai') return catalogStub
      throw new Error(`bound unexpected namespace: ${spec.namespace}`)
    },
  },
  slots: {
    inject(name, cb) { slotName = name; slotRegistrant = cb },
    register(options, component) { slotOptions = options; slotComponent = component; return () => {} },
  },
}
mod.apply(ctxStub)
if (slotName !== 'settings.section') throw new Error(`unexpected slot name: ${slotName}`)
const dispose = slotRegistrant()
if (slotOptions.name !== 'settings.section') throw new Error(`unexpected section name: ${slotOptions.name}`)
if (slotOptions.id !== '@local/dsh-subagent-model') throw new Error(`unexpected section id: ${slotOptions.id}`)
if (slotOptions.order !== 70) throw new Error(`unexpected section order: ${slotOptions.order} (vision-adam=60 occupied)`)
if (slotOptions.label !== '子代理模型') throw new Error(`unexpected section label: ${slotOptions.label}`)
if (typeof slotComponent !== 'function') throw new Error('section component must be a function')
if (bound.join(',') !== 'dsh-subagent,llm-pi-ai') throw new Error(`unexpected bound namespaces: ${bound.join(',')}`)

// --- render A: default (server render, no effects: text-input fallback) -------
const injected = slotOptions.inject()
const htmlA = renderToStaticMarkup(react.createElement(slotComponent, injected))
for (const needle of ['子代理模型', 'Provider', 'Model', '保存到 settings.yaml', '恢复默认', 'llm-pi-ai 模型清单不可用', 'subagent / subagent_fork 派发的默认 LLM 路由']) {
  if (!htmlA.includes(needle)) throw new Error(`default render missing "${needle}"`)
}
if (htmlA.includes('<select')) throw new Error('default render should show text-input fallback (no selects)')

// --- render B: seeded state (patched hooks) exercises the catalog selects -----
const realUseState = react.useState
const realUseEffect = react.useEffect
const stateQueue = []
let hookPatched = false
// Seed the six useState slots: draft, ready, catalog, unavailable, message, busy
const seed = () => {
  const queue = [
    { provider: 'adam', model: 'glm-5.3' }, // draft
    true,                                    // ready
    [{ id: 'adam', models: ['deepseek-v4-flash', 'deepseek-v4.1-flash', 'glm-5.3'] }, { id: 'opencode-go', models: ['kimi-k3'] }], // catalog
    '',                                      // unavailable
    null,                                    // message
    false,                                   // busy
  ]
  return {
    useState(initial) {
      const next = queue.length > 0 ? queue.shift() : initial
      return [next, () => {}]
    },
    useEffect(fn, deps) {},
  }
}
const patched = seed()
react.useState = patched.useState
react.useEffect = patched.useEffect
hookPatched = true
const htmlB = renderToStaticMarkup(react.createElement(slotComponent, injected))
const selects = htmlB.split('<select').length - 1
if (selects !== 2) throw new Error(`seeded render should show 2 selects, got ${selects}`)
for (const needle of ['<option value="deepseek-v4.1-flash"', '<option value="glm-5.3"', '<option value="opencode-go"', '当前生效：provider=adam · model=glm-5.3（settings 段覆盖 preset 默认', 'selected']) {
  if (!htmlB.includes(needle)) throw new Error(`seeded render missing "${needle}"`)
}
react.useState = realUseState
react.useEffect = realUseEffect
if (typeof dispose === 'function') dispose()

console.log('dsh-subagent-model client bundle smoke: PASS')
console.log('  module id:', captured.id)
console.log('  inject:', mod.inject.join(', '))
console.log('  bound namespaces:', bound.join(', '))
console.log('  section:', slotOptions.id, '| order', slotOptions.order, '| label', JSON.stringify(slotOptions.label))
console.log('  render A (default): title + fields + fallback hint + save/reset, no selects')
console.log('  render B (seeded): 2 selects fed from llm-pi-ai catalog, options + effective line OK')
