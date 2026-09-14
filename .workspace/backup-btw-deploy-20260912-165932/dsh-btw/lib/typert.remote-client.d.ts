import { T as StartSideChatResult, c as CancelSideChatRequest, d as CloseSideChatResult, g as SendSideChatResult, h as SendSideChatRequest, l as CancelSideChatResult, m as ReadSideChatResult, n as AnswerSideChatResult, p as ReadSideChatRequest, t as AnswerSideChatRequest, u as CloseSideChatRequest, v as SetSideChatModelRequest, w as StartSideChatRequest, y as SetSideChatModelResult } from "./remote-jUXYzlU4.js";
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
  }
  interface TypertRemoteNamespaceMap {
    sideChat: SideChatRemoteNamespace;
  }
}
declare const TYPERT_REMOTE: TypertRemoteContribution;
//#endregion
export { SideChatRemoteNamespace, TYPERT_REMOTE, TYPERT_REMOTE as default };