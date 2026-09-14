//#region src/typert.host.d.ts
declare const TYPERT: {
  readonly package: "@local/dsh-btw";
  readonly face: "host";
  readonly schemas: readonly [];
  readonly invocations: readonly {
    id: string;
    service: string;
    namespace: string;
    method: string;
    invocation: {
      kind: "direct";
    };
    parameters: {
      name: string;
      wire: "request";
      source: "json";
      codec: {
        mode: "strict";
        typeSymbol: string;
        schema: import("@deepseek-ai/dsh-typert-protocol").TypertSchema<unknown>;
      };
    }[];
    result: {
      mode: "strict";
      typeSymbol: string;
      schema: import("@deepseek-ai/dsh-typert-protocol").TypertSchema<unknown>;
    };
    sourceLocation: {
      file: string;
      line: number;
      column: number;
    };
  }[];
  readonly model: {
    readonly services: readonly [{
      readonly description: "Creates, reads, prompts, answers, cancels, and closes persistent read-only side conversations.";
      readonly summary: "Persistent read-only side conversations.";
      readonly tags: readonly [];
      readonly jsDoc: "/** Persistent read-only side conversation service. */";
      readonly key: "sideChat";
      readonly exportName: "SideChatService";
      readonly members: readonly [{
        readonly kind: "method";
        readonly name: "start";
        readonly signature: "start(request: StartSideChatRequest): Promise<StartSideChatResult>";
        readonly summary: "Start or resume a side conversation.";
        readonly jsDoc: "/** Start or resume a side conversation. */";
      }, {
        readonly kind: "method";
        readonly name: "read";
        readonly signature: "read(request: ReadSideChatRequest): ReadSideChatResult";
        readonly summary: "Read the live child transcript.";
        readonly jsDoc: "/** Read a side conversation transcript snapshot. */";
      }, {
        readonly kind: "method";
        readonly name: "send";
        readonly signature: "send(request: SendSideChatRequest): Promise<SendSideChatResult>";
        readonly summary: "Submit a turn to the owned child agent.";
        readonly jsDoc: "/** Submit a side question. */";
      }, {
        readonly kind: "method";
        readonly name: "answer";
        readonly signature: "answer(request: AnswerSideChatRequest): Promise<AnswerSideChatResult>";
        readonly summary: "Answer the pending btw_ask_user question.";
        readonly jsDoc: "/** Answer a pending ask-back question. */";
      }, {
        readonly kind: "method";
        readonly name: "cancel";
        readonly signature: "cancel(request: CancelSideChatRequest): Promise<CancelSideChatResult>";
        readonly summary: "Cancel active child generation.";
        readonly jsDoc: "/** Cancel active side conversation work. */";
      }, {
        readonly kind: "method";
        readonly name: "close";
        readonly signature: "close(request: CloseSideChatRequest): Promise<CloseSideChatResult>";
        readonly summary: "Close a side conversation, keeping its persisted log.";
        readonly jsDoc: "/** Close a side conversation, keeping its persisted log. */";
      }, {
        readonly kind: "method";
        readonly name: "setModel";
        readonly signature: "setModel(request: SetSideChatModelRequest): Promise<SetSideChatModelResult>";
        readonly summary: "Switch the side conversation model for subsequent turns.";
        readonly jsDoc: "/** Switch the side conversation model for subsequent turns. */";
      }];
      readonly types: readonly [];
    }];
    readonly events: readonly [];
    readonly objects: readonly [];
  };
};
//#endregion
export { TYPERT, TYPERT as default };