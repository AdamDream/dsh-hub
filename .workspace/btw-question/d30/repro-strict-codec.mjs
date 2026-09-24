// D30 experiment 2 (+6): strict-codec reproduction against the REAL built artifact of @local/dsh-btw.
// Source of truth: the production descriptor table `sideChatRemoteDescriptors` exported by
// dsh-btw/lib/remote-descriptors-*.js — the very object the typert host/client layers consume.
import * as descriptorsModule from '/home/CNS2026495165/dsh/dsh-btw/lib/remote-descriptors-D37stQ5y.js'

// The bundler mangles export names; resolve the descriptor array structurally.
const sideChatRemoteDescriptors = Object.values(descriptorsModule)
  .find(value => Array.isArray(value) && value.every(d => d && typeof d === 'object' && 'method' in d && 'result' in d))

const byMethod = Object.fromEntries(sideChatRemoteDescriptors.map(d => [d.method, d]))
const readDescriptor = byMethod.read
const schema = readDescriptor.result.schema

console.log('=== descriptor under test ===')
console.log('id          :', readDescriptor.id)
console.log('result.mode :', readDescriptor.result.mode)
console.log('typeSymbol  :', readDescriptor.result.typeSymbol)

console.log('\n=== experiment 6a: every sideChat/* result codec mode ===')
for (const d of sideChatRemoteDescriptors) {
  console.log(`${d.method.padEnd(11)} result.mode=${d.result.mode}  param.mode=${d.parameters.map(p => p.codec.mode).join(',')}`)
}

const base = () => ({
  ok: true,
  value: {
    chatToken: '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b',
    revision: 7,
    messages: [],
    partial: '',
    reasoning: '',
    running: true,
  },
})

const withPending = (questions) => {
  const payload = base()
  payload.value.pendingQuestion = { questionId: '9f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5c', questions }
  return payload
}

const cases = [
  ['control: fully legal payload (multi_select)', withPending([
    { id: 'q1', question: 'Pick one', header: 'H', multi_select: true, options: [{ label: 'A', description: 'd' }, { label: 'B' }] },
  ])],
  ['(a) question item extra key: detail', withPending([
    { id: 'q1', question: 'Pick one', options: [{ label: 'A' }], detail: 'x' },
  ])],
  ['(b) question item camelCase: multiSelect', withPending([
    { id: 'q1', question: 'Pick one', options: [{ label: 'A' }], multiSelect: true },
  ])],
  ['(c) option item extra key: extra', withPending([
    { id: 'q1', question: 'Pick one', options: [{ label: 'A', extra: 1 }] },
  ])],
]

for (const [name, payload] of cases) {
  console.log('\n' + '='.repeat(72))
  console.log('CASE', name)
  console.log('input.pendingQuestion:', JSON.stringify(payload.value.pendingQuestion))
  const r = schema.safeParse(payload)
  if (r.success) console.log('RESULT: PASS')
  else {
    console.log('RESULT: FAIL')
    console.log('error.message:', r.error.message)
    console.log('issues:', JSON.stringify(r.error.issues, null, 1))
  }
}

console.log('\n' + '='.repeat(72))
try {
  schema.parse(cases[2][1])
  console.log('THROW FORM: no throw (unexpected)')
} catch (e) {
  console.log('THROW FORM:', e.constructor.name, '|', e.message)
}
