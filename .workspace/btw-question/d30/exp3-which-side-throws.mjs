// D30 experiment 3: WHICH SIDE throws — host (result serialization) or client (result parse)?
//
// Faithful reproduction: the REAL TypertGatewayService.prototype.invoke / invokeRpc are driven
// with a stubbed service resolver (only the cordis wiring is stubbed; the descriptor, the real
// production result schema and the real decode()/rpcFailure() bodies all execute).
import * as descriptorsModule from '/home/CNS2026495165/dsh/dsh-btw/lib/remote-descriptors-D37stQ5y.js'
import { TypertGatewayService } from '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js'

const descriptors = Object.values(descriptorsModule)
  .find(v => Array.isArray(v) && v.every(d => d && typeof d === 'object' && 'method' in d && 'result' in d))
const readDescriptor = descriptors.find(d => d.method === 'read')

const poison = {
  ok: true,
  value: {
    chatToken: '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b',
    revision: 7,
    messages: [],
    partial: '',
    reasoning: '',
    running: true,
    pendingQuestion: {
      questionId: '9f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5c',
      questions: [{ id: 'q1', question: '是否继续？', options: [{ label: '继续' }, { label: '停止' }], detail: 'probe' }],
    },
  },
}

class FakeSideChatService {
  async read() { return poison }
}
const service = new FakeSideChatService()
// validateBinding() requires this exact typertRemote binding shape.
service.typertRemote = { service, serviceKey: 'sideChat', namespace: 'sideChat' }

const fakeThis = Object.create(TypertGatewayService.prototype)
fakeThis.ctx = {
  get: key => (key === 'sideChat' ? service : undefined),
  typert: { local: { get: endpoint => (endpoint === 'sideChat/read' ? readDescriptor : undefined), hasSeen: () => false } },
}

const rpcArgs = { request: { chatToken: '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b' } }

console.log('=== 3a. host-side: real invoke() on the poisoned payload (no try/catch of ours) ===')
try {
  const value = await TypertGatewayService.prototype.invoke.call(fakeThis, { namespace: 'sideChat', method: 'read', args: rpcArgs })
  console.log('invoke returned (no host-side throw):', JSON.stringify(value).slice(0, 200))
} catch (error) {
  console.log('HOST THREW')
  console.log('  name     :', error.name)
  console.log('  code     :', error.code)
  console.log('  endpoint :', error.endpoint)
  console.log('  field    :', error.field)
  console.log('  message  :', error.message)
  console.log('  cause    :', error.cause?.constructor?.name, '|', String(error.cause?.message).replace(/\s+/gu, ' ').slice(0, 200))
}

console.log('\n=== 3b. what the browser actually receives: real invokeRpc() -> rpcFailure() ===')
const rpc = await TypertGatewayService.prototype.invokeRpc.call(fakeThis, 'sideChat/read', { args: rpcArgs })
console.log(JSON.stringify(rpc, null, 1))

console.log('\n=== 3c. how dsh-btw client/poll() renders that failure ===')
if (!rpc.ok) {
  const remoteFailure = error => (error.message === undefined ? error.code : error.message)
  const thrownByPoll = new Error(remoteFailure(rpc.error))
  console.log('controller.ts:691  if (!result.ok) throw new Error(remoteFailure(result.error))')
  console.log('  -> thrown Error.message =', JSON.stringify(thrownByPoll.message))
  console.log('  -> reaches controller.ts:741  console.warn(\'[dsh-btw] transcript read failed\', error)')
  console.log('  -> then controller.ts:742-746  delay = 1_200; setTimeout(..., delay);  NO publish, NO error phase')
} else {
  console.log('unexpected ok')
}

console.log('\n=== 3d. control: the identical path with a LEGAL question (no extra key) ===')
poison.value.pendingQuestion.questions = [{ id: 'q1', question: '是否继续？', multi_select: false, options: [{ label: '继续' }] }]
const okRpc = await TypertGatewayService.prototype.invokeRpc.call(fakeThis, 'sideChat/read', { args: rpcArgs })
console.log('invokeRpc ok?', okRpc.ok, '| pendingQuestion delivered?', okRpc.ok && okRpc.value.value.pendingQuestion !== undefined)
