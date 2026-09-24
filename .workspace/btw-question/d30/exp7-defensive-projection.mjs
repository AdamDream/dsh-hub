// D30 experiment 7: does a DEFENSIVE PROJECTION at the host read seam (fix E) cure the failure
// even for an already-poisoned in-memory question, and does the tool-DSL "strictest possible"
// schema (fix A) leave the value-constraint channels open? (A-side already shown in exp6.)
import * as descriptorsModule from '/home/CNS2026495165/dsh/dsh-btw/lib/remote-descriptors-D37stQ5y.js'

const descriptors = Object.values(descriptorsModule)
  .find(v => Array.isArray(v) && v.every(d => d && typeof d === 'object' && 'method' in d && 'result' in d))
const readSchema = descriptors.find(d => d.method === 'read').result.schema

// The exact object the host would store today (entry.pendingQuestion.questions[0]).
const poisonedQuestion = {
  id: 'q1', question: '是否继续？',
  options: [{ label: '继续', extra: 1 }, { label: '停止' }],
  detail: 'probe', multiSelect: true, multi_select: false,
}

const envelope = questions => ({
  ok: true,
  value: {
    chatToken: '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b', revision: 7, messages: [],
    partial: '', reasoning: '', running: true,
    pendingQuestion: { questionId: '9f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5c', questions },
  },
})

console.log('=== baseline: as stored today ===')
console.log('strict read codec:', readSchema.safeParse(envelope([poisonedQuestion])).success ? 'PASS' : 'FAIL (D30 reproduced)')

console.log('\n=== fix E: project each question to the declared key whitelist before returning ===')
const QUESTION_KEYS = ['id', 'question', 'header', 'options', 'multi_select']
const OPTION_KEYS = ['label', 'description']
const project = q => Object.fromEntries(
  QUESTION_KEYS.filter(k => Object.hasOwn(q, k)).map(k => [k, k === 'options' && Array.isArray(q[k])
    ? q[k].map(o => Object.fromEntries(OPTION_KEYS.filter(k2 => Object.hasOwn(o, k2)).map(k2 => [k2, o[k2]])))
    : q[k]]),
)
const projected = [poisonedQuestion].map(project)
console.log('projected question:', JSON.stringify(projected))
console.log('strict read codec:', readSchema.safeParse(envelope(projected)).success ? 'PASS' : 'FAIL')

console.log('\n=== fix E side effect: the model-visible intent is silently dropped ===')
console.log('multiSelect=true dropped ->', Object.hasOwn(projected[0], 'multiSelect') ? 'kept' : 'DROPPED (card renders single-select)')

console.log('\n=== how fast the silent failure would log at 1200 ms backoff ===')
const perMinute = 60000 / 1200
console.log(`poll retry interval 1200 ms -> ~${perMinute.toFixed(0)} read attempts/min -> ~${perMinute.toFixed(0)} console.warn lines/min while the question stays pending`)
