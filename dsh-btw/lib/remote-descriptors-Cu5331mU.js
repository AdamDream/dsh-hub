import { S as startSideChatResultSchema, _ as sendSideChatResultSchema, a as cancelSideChatResultSchema, c as listSideChatProjectRequestSchema, d as listSideChatTreeResultSchema, f as readSideChatImageRequestSchema, g as sendSideChatRequestSchema, h as readSideChatResultSchema, i as cancelSideChatRequestSchema, l as listSideChatProjectResultSchema, m as readSideChatRequestSchema, n as answerSideChatResultSchema, o as closeSideChatRequestSchema, p as readSideChatImageResultSchema, s as closeSideChatResultSchema, t as answerSideChatRequestSchema, u as listSideChatTreeRequestSchema, v as setSideChatModelRequestSchema, x as startSideChatRequestSchema, y as setSideChatModelResultSchema } from "./remote-C2Gojj6I.js";
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
