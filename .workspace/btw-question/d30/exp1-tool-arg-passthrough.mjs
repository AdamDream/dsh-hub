// D30 experiment 1: does the tool framework strip/normalize extra keys that the
// parameter schema allows (additionalProperties: true) BEFORE `execute` sees them?
//
// Faithful reconstruction of the dispatch path:
//   dsh-agent-loop/lib/index.js:126   arguments: parseArguments(block.arguments)  -> JSON.parse, no projection
//   dsh-tools/lib/index.js:3048       arguments: deepFreeze(snapshotJsonValue(exec.arguments))  -> lossless deep copy
//   dsh-tools/lib/index.js:3181       await tool.execute(exec.arguments, exec)
//   dsh-tools/lib/index.js:862-866    defineTool wrapper: validate(args) then userExecute(args, exec)  (same reference)
import { defineTool, parameterSchemaSpecToJsonSchema, validateJsonSchemaValue } from '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'

// Verbatim copy of the `parameters` spec from dsh-btw/src/host/side-chat-service.ts:909-935.
const btwAskUserParameters = {
  questions: {
    type: 'array',
    required: true,
    description: 'Questions to ask the user before continuing.',
    items: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: { type: 'string', required: true, description: 'Stable id for this question; echoed in the answer.' },
        question: { type: 'string', required: true, description: 'The specific question to ask the user.' },
        header: { type: 'string', description: 'Optional short heading for the question.' },
        options: {
          type: 'array',
          description: 'Optional choices to show the user.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              label: { type: 'string', required: true, description: 'Short user-facing option label.' },
              description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
            },
          },
        },
        multi_select: { type: 'boolean', description: 'Whether the user may select more than one option. Defaults to false.' },
      },
    },
  },
}

const compiled = parameterSchemaSpecToJsonSchema(btwAskUserParameters)
console.log('=== compiled JSON schema of btw_ask_user.parameters ===')
console.log(JSON.stringify(compiled, null, 1))
console.log('\nroot additionalProperties present?', Object.hasOwn(compiled, 'additionalProperties'))
console.log('items additionalProperties      =', compiled.properties.questions.items.additionalProperties)
console.log('option items additionalProperties =', compiled.properties.questions.items.properties.options.items.additionalProperties)

const seen = []
const tool = defineTool({
  name: 'btw_ask_user',
  description: 'probe replica',
  parameters: btwAskUserParameters,
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { answers: { type: 'array', required: true, items: { type: 'string' } } } },
    render: () => [],
  },
  async execute(args, _exec) {
    seen.push(args)
    return { answers: [] }
  },
})

const rawArgs = {
  questions: [
    { id: 'q1', question: 'Pick one', options: [{ label: 'A', extra: 1 }], detail: 'probe', multiSelect: true, multi_select: false },
  ],
  extraTopLevelKey: { nested: [1, 2, { deep: true }] },
}

console.log('\n=== 1a. static validation of the extra-key payload ===')
console.log('validateJsonSchemaValue violations:', JSON.stringify(validateJsonSchemaValue(compiled, rawArgs, '')))
console.log('validateArgs-style conclusion: ' + (validateJsonSchemaValue(compiled, rawArgs, '').length === 0 ? 'VALID (no violation)' : 'INVALID'))

console.log('\n=== 1b. real defineTool.execute path (as invoked at dsh-tools/lib/index.js:3181) ===')
const frozen = rawArgs // runtime passes a deep-frozen lossless snapshot of the parsed model arguments
const result = await tool.execute(frozen, { signal: new AbortController().signal })
console.log('tool.execute returned:', JSON.stringify(result))
console.log('execute received (times):', seen.length)
console.log('arguments object identity preserved (same reference)?', seen[0] === frozen)
console.log('what execute saw:', JSON.stringify(seen[0], null, 1))
console.log('extra keys survived to execute?',
  ' detail=' + String(seen[0].questions[0].detail),
  ' multiSelect=' + String(seen[0].questions[0].multiSelect),
  ' option.extra=' + String(seen[0].questions[0].options[0].extra),
  ' topLevel.extraTopLevelKey=' + JSON.stringify(seen[0].extraTopLevelKey))
console.log('deep-equal to raw input?', JSON.stringify(seen[0]) === JSON.stringify(rawArgs))

console.log('\n=== 1c. negative control: additionalProperties:false DOES reject ===')
const strictTool = defineTool({
  name: 'strict_probe',
  description: 'probe',
  parameters: { questions: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } } } },
  output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
  async execute() { return {} },
})
try {
  await strictTool.execute({ questions: [{ id: 'q1', detail: 'x' }] }, { signal: new AbortController().signal })
  console.log('strict probe: no throw (unexpected)')
} catch (error) {
  console.log('strict probe threw:', error.name, '|', error.message)
}
