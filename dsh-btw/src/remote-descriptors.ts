import type { TypertSchema } from '@deepseek-ai/dsh-typert-protocol'
import {
  answerSideChatRequestSchema, answerSideChatResultSchema,
  cancelSideChatRequestSchema, cancelSideChatResultSchema,
  closeSideChatRequestSchema, closeSideChatResultSchema,
  listSideChatProjectRequestSchema, listSideChatProjectResultSchema,
  listSideChatTreeRequestSchema, listSideChatTreeResultSchema,
  readSideChatImageRequestSchema, readSideChatImageResultSchema,
  readSideChatRequestSchema, readSideChatResultSchema,
  sendSideChatRequestSchema, sendSideChatResultSchema,
  setSideChatModelRequestSchema, setSideChatModelResultSchema,
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
  directDescriptor('start', 'StartSideChatRequest', startSideChatRequestSchema, 'StartSideChatResult', startSideChatResultSchema, 444),
  directDescriptor('read', 'ReadSideChatRequest', readSideChatRequestSchema, 'ReadSideChatResult', readSideChatResultSchema, 784),
  directDescriptor('send', 'SendSideChatRequest', sendSideChatRequestSchema, 'SendSideChatResult', sendSideChatResultSchema, 793),
  directDescriptor('answer', 'AnswerSideChatRequest', answerSideChatRequestSchema, 'AnswerSideChatResult', answerSideChatResultSchema, 870),
  directDescriptor('cancel', 'CancelSideChatRequest', cancelSideChatRequestSchema, 'CancelSideChatResult', cancelSideChatResultSchema, 886),
  directDescriptor('close', 'CloseSideChatRequest', closeSideChatRequestSchema, 'CloseSideChatResult', closeSideChatResultSchema, 899),
  directDescriptor('setModel', 'SetSideChatModelRequest', setSideChatModelRequestSchema, 'SetSideChatModelResult', setSideChatModelResultSchema, 924),
  directDescriptor('readImage', 'ReadSideChatImageRequest', readSideChatImageRequestSchema, 'ReadSideChatImageResult', readSideChatImageResultSchema, 943),
  directDescriptor('listTree', 'ListSideChatTreeRequest', listSideChatTreeRequestSchema, 'ListSideChatTreeResult', listSideChatTreeResultSchema, 977),
  directDescriptor('listProject', 'ListSideChatProjectRequest', listSideChatProjectRequestSchema, 'ListSideChatProjectResult', listSideChatProjectResultSchema, 1000),
])
