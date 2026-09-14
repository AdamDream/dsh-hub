import type { TypertSchema } from '@deepseek-ai/dsh-typert-protocol'
import {
  answerSideChatRequestSchema, answerSideChatResultSchema,
  cancelSideChatRequestSchema, cancelSideChatResultSchema,
  closeSideChatRequestSchema, closeSideChatResultSchema,
  readSideChatRequestSchema, readSideChatResultSchema,
  sendSideChatRequestSchema, sendSideChatResultSchema,
  startSideChatRequestSchema, startSideChatResultSchema,
} from './shared/remote.ts'

const PACKAGE = '@local/dsh-btw'

function directDescriptor(
  method: string,
  requestSymbol: string,
  requestSchema: TypertSchema,
  resultSymbol: string,
  resultSchema: TypertSchema,
  line: number,
) {
  return {
    id: `${PACKAGE}#sideChat/${method}`,
    service: 'sideChat', namespace: 'sideChat', method, invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'request', wire: 'request' as const, source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: `${PACKAGE}#${requestSymbol}`, schema: requestSchema },
    }],
    result: { mode: 'strict' as const, typeSymbol: `${PACKAGE}#${resultSymbol}`, schema: resultSchema },
    sourceLocation: { file: 'src/host/side-chat-service.ts', line, column: 3 },
  }
}

export const sideChatRemoteDescriptors = Object.freeze([
  directDescriptor('start', 'StartSideChatRequest', startSideChatRequestSchema, 'StartSideChatResult', startSideChatResultSchema, 90),
  directDescriptor('read', 'ReadSideChatRequest', readSideChatRequestSchema, 'ReadSideChatResult', readSideChatResultSchema, 160),
  directDescriptor('send', 'SendSideChatRequest', sendSideChatRequestSchema, 'SendSideChatResult', sendSideChatResultSchema, 160),
  directDescriptor('answer', 'AnswerSideChatRequest', answerSideChatRequestSchema, 'AnswerSideChatResult', answerSideChatResultSchema, 195),
  directDescriptor('cancel', 'CancelSideChatRequest', cancelSideChatRequestSchema, 'CancelSideChatResult', cancelSideChatResultSchema, 195),
  directDescriptor('close', 'CloseSideChatRequest', closeSideChatRequestSchema, 'CloseSideChatResult', closeSideChatResultSchema, 210),
])
