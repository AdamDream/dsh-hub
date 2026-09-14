import { t as sideChatRemoteDescriptors } from "./remote-descriptors-CCYs-d6z.js";
//#region src/typert.host.ts
const TYPERT = {
	package: "@local/dsh-btw",
	face: "host",
	schemas: [],
	invocations: sideChatRemoteDescriptors,
	model: {
		services: [{
			description: "Creates, reads, prompts, answers, cancels, and closes persistent read-only side conversations.",
			summary: "Persistent read-only side conversations.",
			tags: [],
			jsDoc: "/** Persistent read-only side conversation service. */",
			key: "sideChat",
			exportName: "SideChatService",
			members: [
				{
					kind: "method",
					name: "start",
					signature: "start(request: StartSideChatRequest): Promise<StartSideChatResult>",
					summary: "Start or resume a side conversation.",
					jsDoc: "/** Start or resume a side conversation. */"
				},
				{
					kind: "method",
					name: "read",
					signature: "read(request: ReadSideChatRequest): ReadSideChatResult",
					summary: "Read the live child transcript.",
					jsDoc: "/** Read a side conversation transcript snapshot. */"
				},
				{
					kind: "method",
					name: "send",
					signature: "send(request: SendSideChatRequest): Promise<SendSideChatResult>",
					summary: "Submit a turn to the owned child agent.",
					jsDoc: "/** Submit a side question. */"
				},
				{
					kind: "method",
					name: "answer",
					signature: "answer(request: AnswerSideChatRequest): Promise<AnswerSideChatResult>",
					summary: "Answer the pending btw_ask_user question.",
					jsDoc: "/** Answer a pending ask-back question. */"
				},
				{
					kind: "method",
					name: "cancel",
					signature: "cancel(request: CancelSideChatRequest): Promise<CancelSideChatResult>",
					summary: "Cancel active child generation.",
					jsDoc: "/** Cancel active side conversation work. */"
				},
				{
					kind: "method",
					name: "close",
					signature: "close(request: CloseSideChatRequest): Promise<CloseSideChatResult>",
					summary: "Close a side conversation, keeping its persisted log.",
					jsDoc: "/** Close a side conversation, keeping its persisted log. */"
				},
				{
					kind: "method",
					name: "setModel",
					signature: "setModel(request: SetSideChatModelRequest): Promise<SetSideChatModelResult>",
					summary: "Switch the side conversation model for subsequent turns.",
					jsDoc: "/** Switch the side conversation model for subsequent turns. */"
				}
			],
			types: []
		}],
		events: [],
		objects: []
	}
};
//#endregion
export { TYPERT, TYPERT as default };
