import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { sideChatRemoteDescriptors } from '../remote-descriptors.ts'
import type {
  AnswerSideChatRequest, AnswerSideChatResult, CancelSideChatRequest, CancelSideChatResult, CloseSideChatRequest, CloseSideChatResult,
  ReadSideChatRequest, ReadSideChatResult, SendSideChatRequest, SendSideChatResult, StartSideChatRequest, StartSideChatResult,
} from '../shared/remote.ts'

export interface SideChatRemoteNamespace {
  start: (request: StartSideChatRequest) => Promise<RemoteResult<StartSideChatResult>>
  read: (request: ReadSideChatRequest) => Promise<RemoteResult<ReadSideChatResult>>
  send: (request: SendSideChatRequest) => Promise<RemoteResult<SendSideChatResult>>
  answer: (request: AnswerSideChatRequest) => Promise<RemoteResult<AnswerSideChatResult>>
  cancel: (request: CancelSideChatRequest) => Promise<RemoteResult<CancelSideChatResult>>
  close: (request: CloseSideChatRequest) => Promise<RemoteResult<CloseSideChatResult>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'sideChat/start': SideChatRemoteNamespace['start']
    'sideChat/read': SideChatRemoteNamespace['read']
    'sideChat/send': SideChatRemoteNamespace['send']
    'sideChat/answer': SideChatRemoteNamespace['answer']
    'sideChat/cancel': SideChatRemoteNamespace['cancel']
    'sideChat/close': SideChatRemoteNamespace['close']
  }
  interface TypertRemoteNamespaceMap { sideChat: SideChatRemoteNamespace }
}

export const TYPERT_REMOTE: TypertRemoteContribution = { package: '@local/dsh-btw', descriptors: sideChatRemoteDescriptors }
export default TYPERT_REMOTE
