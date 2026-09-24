// D30 experiment 6: blast radius (which sideChat endpoints carry questions) and
// whether fail-closed at the TOOL boundary (option A) can close the width gap entirely.
import * as descriptorsModule from '/home/CNS2026495165/dsh/dsh-btw/lib/remote-descriptors-D37stQ5y.js'
import { defineTool, parameterSchemaSpecToJsonSchema, validateJsonSchemaValue, assertSupportedJsonSchema } from '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'

const sideChatRemoteDescriptors = Object.values(descriptorsModule)
  .find(v => Array.isArray(v) && v.every(d => d && typeof d === 'object' && 'method' in d && 'result' in d))

console.log('=== 6a. which result schema can carry a stored question? ===')
// Serialize each result schema's JSON shape by feeding it an extra "pendingQuestion" probe:
// cheapest faithful probe is to inspect the descriptor typeSymbol + test parse of a minimal value.
const readSchema = sideChatRemoteDescriptors.find(d => d.method === 'read').result.schema
const probeValue = questions => ({
  ok: true,
  value: {
    chatToken: '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b', revision: 1, messages: [],
    partial: '', reasoning: '', running: true,
    pendingQuestion: { questionId: '9f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5c', questions },
  },
})
console.log('read result accepts a legal pendingQuestion?', readSchema.safeParse(probeValue([{ id: 'q1', question: 'x' }])).success)
console.log('read result accepts the SAME payload WITHOUT pendingQuestion?',
  readSchema.safeParse((() => { const p = probeValue([{ id: 'q1', question: 'x' }]); delete p.value.pendingQuestion; return p })()).success)
// A per-endpoint "does this result schema know pendingQuestion" probe via parse() is not sound
// (the other unions have different shapes), so the blast radius is decided by source inspection:
//   grep -n pendingQuestion dsh-btw/src/shared/remote.ts   ->  single hit at line 174 (read value only)
console.log('blast radius evidence: grep -n pendingQuestion src/shared/remote.ts  (only line 174, inside readSideChatResultSchema.value)')

console.log('\n=== 6b. tool DSL keyword subset: can minLength / minItems be expressed? ===')
try {
  assertSupportedJsonSchema({ type: 'object', properties: { a: { type: 'string', minLength: 1 } } })
  console.log('minLength accepted (unexpected)')
} catch (error) {
  console.log('minLength rejected:', error.name, '|', String(error.message).slice(0, 400))
}
try {
  assertSupportedJsonSchema({ type: 'array', minItems: 1, items: { type: 'string' } })
  console.log('minItems accepted (unexpected)')
} catch (error) {
  console.log('minItems rejected:', error.name, '|', String(error.message).slice(0, 300))
}

console.log('\n=== 6c. even with additionalProperties:false, VALUE-constraint width gaps remain ===')
const toolParams = {
  questions: {
    type: 'array', required: true,
    items: {
      type: 'object',
      additionalProperties: false, // <- the strictest the DSL allows (fix A)
      properties: {
        id: { type: 'string', required: true },
        question: { type: 'string', required: true },
        header: { type: 'string' },
        options: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string', required: true }, description: { type: 'string' } } } },
        multi_select: { type: 'boolean' },
      },
    },
  },
}
const strictCompiled = parameterSchemaSpecToJsonSchema(toolParams)
const valueGaps = [
  ['empty id (codec requires min 1)', { questions: [{ id: '', question: 'ok' }] }],
  ['empty question (codec requires min 1)', { questions: [{ id: 'q1', question: '' }] }],
  ['empty questions array (codec requires min 1 item)', { questions: [] }],
  ['empty option label (codec requires min 1)', { questions: [{ id: 'q1', question: 'x', options: [{ label: '' }] }] }],
]
for (const [name, args] of valueGaps) {
  const toolViolations = validateJsonSchemaValue(strictCompiled, args, '')
  const codecOk = readSchema.safeParse(probeValue(args.questions)).success
  console.log(`${name}\n   tool-schema (additionalProperties:false) => ${toolViolations.length === 0 ? 'PASSES tool validation' : 'rejected: ' + toolViolations.join('; ')}`)
  console.log(`   strict read codec                  => ${codecOk ? 'passes' : 'FAILS  <== residual silent channel'}`)
}
