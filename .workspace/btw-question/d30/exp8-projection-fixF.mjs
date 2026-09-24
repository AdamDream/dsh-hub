// D30 experiment 8 (fix F): does an official-style whitelist projection in `execute` make D30
// structurally disappear, and where exactly is its boundary?
//
// Uses the REAL production codec object (readSideChatResultSchema from dsh-btw/lib) as the
// checkpoint that used to fail, plus a projection replica of the official ask_user_question
// execute() shape (dsh-tool-ask-user/lib/index.js:96-112).
import * as descriptorsModule from '/home/CNS2026495165/dsh/dsh-btw/lib/remote-descriptors-D37stQ5y.js'

const descriptors = Object.values(descriptorsModule)
  .find(v => Array.isArray(v) && v.every(d => d && typeof d === 'object' && 'method' in d && 'result' in d))
const readSchema = descriptors.find(d => d.method === 'read').result.schema

// --- drill the production artifact to read btwQuestionSchema's declared keys (independent check) ---
let questionKeys = null
try {
  const union = readSchema.def.options
  const okMember = union[0]
  const value = okMember.def.shape.value
  const pending = value.def.shape.pendingQuestion
  const pendingObj = pending.def.innerType ?? pending.def.schema ?? pending
  const questions = pendingObj.def.shape.questions
  const question = questions.def.element
  questionKeys = Object.keys(question.shape)
  questionKeys = Object.keys(question.def.shape)
  console.log('=== drilled from production artifact: btwQuestionSchema declared keys ===')
  console.log(JSON.stringify(questionKeys))
} catch (error) {
  console.log('drill failed (non-fatal):', String(error).slice(0, 200))
}

const QUESTION_KEYS = ['id', 'question', 'header', 'options', 'multi_select']
const OPTION_KEYS = ['label', 'description']

/** Official-style projection (dsh-tool-ask-user/lib/index.js:96-104), btw counterpart: no rename. */
const projectQuestion = q => ({
  id: q.id,
  question: q.question,
  ...(q.header !== undefined ? { header: q.header } : {}),
  ...(q.options !== undefined ? { options: q.options } : {}),
  ...(q.multi_select !== undefined ? { multi_select: q.multi_select } : {}),
})
/** The stricter variant: also project option items to their declared keys. */
const projectOption = o => ({
  label: o.label,
  ...(o.description !== undefined ? { description: o.description } : {}),
})
const projectQuestionDeep = q => {
  const p = projectQuestion(q)
  if (Array.isArray(p.options)) p.options = p.options.map(projectOption)
  return p
}

const envelope = questions => ({
  ok: true,
  value: {
    chatToken: '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b', revision: 7, messages: [],
    partial: '', reasoning: '', running: true,
    pendingQuestion: { questionId: '9f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5c', questions },
  },
})
const verdict = questions => (readSchema.safeParse(envelope(questions)).success ? 'PASS' : 'FAIL')

console.log('\n=== 8a. adversarial KEY inputs: raw vs question-level projection vs deep projection ===')
const keyCases = [
  ['camelCase multiSelect', { id: 'q1', question: 'x', multiSelect: true, options: [{ label: 'A' }] }],
  ['official-only detail', { id: 'q1', question: 'x', detail: 'probe', options: [{ label: 'A' }] }],
  ['official-only intent', { id: 'q1', question: 'x', intent: 'plan', options: [{ label: 'A' }] }],
  ['nested junk object', { id: 'q1', question: 'x', meta: { a: [1, { b: 2 }] }, options: [{ label: 'A' }] }],
  ['question extra + option extra', { id: 'q1', question: 'x', detail: 'p', options: [{ label: 'A', extra: 1, weight: 9 }] }],
  ['option extra only', { id: 'q1', question: 'x', options: [{ label: 'A', extra: 1 }] }],
]
for (const [name, q] of keyCases) {
  console.log(`${name.padEnd(32)} raw=${verdict([q])}  projectQuestion=${verdict([projectQuestion(q)])}  deep=${verdict([projectQuestionDeep(q)])}`)
}

console.log('\n=== 8b. boundary: projection does NOT fix VALUE-constraint width gaps ===')
const valueCases = [
  ['empty id', { id: '', question: 'x' }],
  ['empty question', { id: 'q1', question: '' }],
  ['empty option label', { id: 'q1', question: 'x', options: [{ label: '' }] }],
  ['empty questions array', 'EMPTY_ARRAY'],
]
for (const [name, q] of valueCases) {
  const input = q === 'EMPTY_ARRAY' ? [] : [projectQuestionDeep(q)]
  console.log(`${name.padEnd(32)} after projection: ${verdict(input)}`)
}

console.log('\n=== 8c. drift lock feasibility: projection key list vs codec declared keys ===')
console.log('projection QUESTION_KEYS  :', JSON.stringify(QUESTION_KEYS))
console.log('codec declared keys       :', JSON.stringify(questionKeys))
console.log('identical?', JSON.stringify(QUESTION_KEYS) === JSON.stringify(questionKeys))
console.log('(zod v4 exposes .shape on strict objects => a unit test can assert set equality and fail on drift)')
