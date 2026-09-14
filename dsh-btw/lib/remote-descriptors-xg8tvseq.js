import { _ as setSideChatModelRequestSchema, a as closeSideChatRequestSchema, b as startSideChatRequestSchema, c as listSideChatProjectResultSchema, d as readSideChatImageRequestSchema, f as readSideChatImageResultSchema, g as sendSideChatResultSchema, h as sendSideChatRequestSchema, i as cancelSideChatResultSchema, l as listSideChatTreeRequestSchema, m as readSideChatResultSchema, n as answerSideChatResultSchema, o as closeSideChatResultSchema, p as readSideChatRequestSchema, r as cancelSideChatRequestSchema, s as listSideChatProjectRequestSchema, t as answerSideChatRequestSchema, u as listSideChatTreeResultSchema, v as setSideChatModelResultSchema, x as startSideChatResultSchema } from "./remote-DxLkxvnp.js";
//#region src/remote-descriptors.ts
const PACKAGE = "@local/dsh-btw";
function directDescriptor(method, requestSymbol, requestSchema, resultSymbol, resultSchema, line) {
	return {
		id: `${PACKAGE}#sideChat/${method}`,
		service: "sideChat",
		namespace: "sideChat",
		method,
		invocation: { kind: "direct" },
		parameters: [{
			name: "request",
			wire: "request",
			source: "json",
			codec: {
				mode: "strict",
				typeSymbol: `${PACKAGE}#${requestSymbol}`,
				schema: requestSchema
			}
		}],
		result: {
			mode: "strict",
			typeSymbol: `${PACKAGE}#${resultSymbol}`,
			schema: resultSchema
		},
		sourceLocation: {
			file: "src/host/side-chat-service.ts",
			line,
			column: 3
		}
	};
}
const sideChatRemoteDescriptors = Object.freeze([
	directDescriptor("start", "StartSideChatRequest", startSideChatRequestSchema, "StartSideChatResult", startSideChatResultSchema, 444),
	directDescriptor("read", "ReadSideChatRequest", readSideChatRequestSchema, "ReadSideChatResult", readSideChatResultSchema, 784),
	directDescriptor("send", "SendSideChatRequest", sendSideChatRequestSchema, "SendSideChatResult", sendSideChatResultSchema, 793),
	directDescriptor("answer", "AnswerSideChatRequest", answerSideChatRequestSchema, "AnswerSideChatResult", answerSideChatResultSchema, 870),
	directDescriptor("cancel", "CancelSideChatRequest", cancelSideChatRequestSchema, "CancelSideChatResult", cancelSideChatResultSchema, 886),
	directDescriptor("close", "CloseSideChatRequest", closeSideChatRequestSchema, "CloseSideChatResult", closeSideChatResultSchema, 899),
	directDescriptor("setModel", "SetSideChatModelRequest", setSideChatModelRequestSchema, "SetSideChatModelResult", setSideChatModelResultSchema, 924),
	directDescriptor("readImage", "ReadSideChatImageRequest", readSideChatImageRequestSchema, "ReadSideChatImageResult", readSideChatImageResultSchema, 943),
	directDescriptor("listTree", "ListSideChatTreeRequest", listSideChatTreeRequestSchema, "ListSideChatTreeResult", listSideChatTreeResultSchema, 977),
	directDescriptor("listProject", "ListSideChatProjectRequest", listSideChatProjectRequestSchema, "ListSideChatProjectResult", listSideChatProjectResultSchema, 1e3)
]);
//#endregion
export { sideChatRemoteDescriptors as t };
