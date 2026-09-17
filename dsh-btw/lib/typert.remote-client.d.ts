import { I as StartSideChatRequest, L as StartSideChatResult, S as SendSideChatResult, T as SetSideChatModelResult, _ as ReadSideChatImageRequest, b as ReadSideChatResult, c as CancelSideChatRequest, d as CloseSideChatResult, g as ListSideChatTreeResult, h as ListSideChatTreeRequest, l as CancelSideChatResult, m as ListSideChatProjectResult, n as AnswerSideChatResult, p as ListSideChatProjectRequest, t as AnswerSideChatRequest, u as CloseSideChatRequest, v as ReadSideChatImageResult, w as SetSideChatModelRequest, x as SendSideChatRequest, y as ReadSideChatRequest } from "./remote-DHlY-Qf0.js";
import { RemoteResult, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
//#region src/client/remote.d.ts
interface SideChatRemoteNamespace {
  start: (request: StartSideChatRequest) => Promise<RemoteResult<StartSideChatResult>>;
  read: (request: ReadSideChatRequest) => Promise<RemoteResult<ReadSideChatResult>>;
  send: (request: SendSideChatRequest) => Promise<RemoteResult<SendSideChatResult>>;
  answer: (request: AnswerSideChatRequest) => Promise<RemoteResult<AnswerSideChatResult>>;
  cancel: (request: CancelSideChatRequest) => Promise<RemoteResult<CancelSideChatResult>>;
  close: (request: CloseSideChatRequest) => Promise<RemoteResult<CloseSideChatResult>>;
  setModel: (request: SetSideChatModelRequest) => Promise<RemoteResult<SetSideChatModelResult>>;
  readImage: (request: ReadSideChatImageRequest) => Promise<RemoteResult<ReadSideChatImageResult>>;
  listTree: (request: ListSideChatTreeRequest) => Promise<RemoteResult<ListSideChatTreeResult>>;
  listProject: (request: ListSideChatProjectRequest) => Promise<RemoteResult<ListSideChatProjectResult>>;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'sideChat/start': SideChatRemoteNamespace['start'];
    'sideChat/read': SideChatRemoteNamespace['read'];
    'sideChat/send': SideChatRemoteNamespace['send'];
    'sideChat/answer': SideChatRemoteNamespace['answer'];
    'sideChat/cancel': SideChatRemoteNamespace['cancel'];
    'sideChat/close': SideChatRemoteNamespace['close'];
    'sideChat/setModel': SideChatRemoteNamespace['setModel'];
    'sideChat/readImage': SideChatRemoteNamespace['readImage'];
    'sideChat/listTree': SideChatRemoteNamespace['listTree'];
    'sideChat/listProject': SideChatRemoteNamespace['listProject'];
  }
  interface TypertRemoteNamespaceMap {
    sideChat: SideChatRemoteNamespace;
  }
}
declare const TYPERT_REMOTE: TypertRemoteContribution;
//#endregion
export { SideChatRemoteNamespace, TYPERT_REMOTE, TYPERT_REMOTE as default };