import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { sideChatRemoteDescriptors } from '../remote-descriptors.ts'
import type {
  AnswerSideChatRequest, AnswerSideChatResult, CancelSideChatRequest, CancelSideChatResult, CloseSideChatRequest, CloseSideChatResult,
  ListSideChatProjectRequest, ListSideChatProjectResult, ListSideChatTreeRequest, ListSideChatTreeResult,
  ReadSideChatImageRequest, ReadSideChatImageResult, ReadSideChatRequest, ReadSideChatResult, SendSideChatRequest, SendSideChatResult,
  SetSideChatModelRequest, SetSideChatModelResult, StartSideChatRequest, StartSideChatResult,
} from '../shared/remote.ts'

export interface SideChatRemoteNamespace {
  start: (request: StartSideChatRequest) => Promise<RemoteResult<StartSideChatResult>>
  read: (request: ReadSideChatRequest) => Promise<RemoteResult<ReadSideChatResult>>
  send: (request: SendSideChatRequest) => Promise<RemoteResult<SendSideChatResult>>
  answer: (request: AnswerSideChatRequest) => Promise<RemoteResult<AnswerSideChatResult>>
  cancel: (request: CancelSideChatRequest) => Promise<RemoteResult<CancelSideChatResult>>
  close: (request: CloseSideChatRequest) => Promise<RemoteResult<CloseSideChatResult>>
  setModel: (request: SetSideChatModelRequest) => Promise<RemoteResult<SetSideChatModelResult>>
  readImage: (request: ReadSideChatImageRequest) => Promise<RemoteResult<ReadSideChatImageResult>>
  listTree: (request: ListSideChatTreeRequest) => Promise<RemoteResult<ListSideChatTreeResult>>
  listProject: (request: ListSideChatProjectRequest) => Promise<RemoteResult<ListSideChatProjectResult>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'sideChat/start': SideChatRemoteNamespace['start']
    'sideChat/read': SideChatRemoteNamespace['read']
    'sideChat/send': SideChatRemoteNamespace['send']
    'sideChat/answer': SideChatRemoteNamespace['answer']
    'sideChat/cancel': SideChatRemoteNamespace['cancel']
    'sideChat/close': SideChatRemoteNamespace['close']
    'sideChat/setModel': SideChatRemoteNamespace['setModel']
    'sideChat/readImage': SideChatRemoteNamespace['readImage']
    'sideChat/listTree': SideChatRemoteNamespace['listTree']
    'sideChat/listProject': SideChatRemoteNamespace['listProject']
  }
  interface TypertRemoteNamespaceMap { sideChat: SideChatRemoteNamespace }
}

export const TYPERT_REMOTE: TypertRemoteContribution = { package: '@local/dsh-btw', descriptors: sideChatRemoteDescriptors }
export default TYPERT_REMOTE
