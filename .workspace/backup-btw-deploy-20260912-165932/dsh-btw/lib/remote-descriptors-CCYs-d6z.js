import { z } from "zod";
//#region src/shared/remote.ts
const sideChatErrorCodeSchema = z.enum([
	"parent-not-found",
	"already-open",
	"not-open",
	"invalid-input",
	"compatibility",
	"cancelled",
	"internal"
]);
const sideChatErrorSchema = z.object({
	code: sideChatErrorCodeSchema,
	message: z.string()
}).strict();
/** The three models a side conversation may route to (provider is always `adam`). */
const btwModelSchema = z.enum([
	"deepseek-v4-flash",
	"glm-5.3",
	"deepseek-v4-pro"
]);
const startSideChatRequestSchema = z.object({
	parentSessionId: z.string().min(1).max(256),
	chatToken: z.string().uuid(),
	model: btwModelSchema.optional()
}).strict();
const startSideChatValueSchema = z.object({
	parentSessionId: z.string(),
	childSessionId: z.string(),
	chatToken: z.string().uuid(),
	seedLength: z.number().int().nonnegative(),
	/** Whether this start resumed a persisted child (true) or forked a fresh one (false). */
	resumed: z.boolean(),
	/** The side conversation's current model (default or persisted). */
	model: btwModelSchema.optional()
}).strict();
const startSideChatResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: startSideChatValueSchema
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
const readSideChatRequestSchema = z.object({ chatToken: z.string().uuid() }).strict();
const sideChatTranscriptMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant"]),
	text: z.string()
}).strict();
/** One question inside a pending btw_ask_user call (mirrors ask_user_question's shape). */
const btwQuestionSchema = z.object({
	id: z.string().min(1),
	question: z.string().min(1),
	header: z.string().optional(),
	options: z.array(z.object({
		label: z.string().min(1),
		description: z.string().optional()
	})).optional(),
	multi_select: z.boolean().optional()
}).strict();
/** The question currently blocking the child agent, surfaced through sideChat/read. */
const btwPendingQuestionSchema = z.object({
	questionId: z.string().uuid(),
	questions: z.array(btwQuestionSchema).min(1)
}).strict();
/** One answered question, echoed back through sideChat/answer. */
const btwAnswerSchema = z.object({
	id: z.string().min(1),
	selected: z.array(z.string()),
	custom: z.string().optional()
}).strict();
const readSideChatResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: z.object({
		chatToken: z.string().uuid(),
		revision: z.number().int().nonnegative(),
		messages: z.array(sideChatTranscriptMessageSchema),
		partial: z.string(),
		reasoning: z.string(),
		running: z.boolean(),
		runningTool: z.string().optional(),
		pendingQuestion: btwPendingQuestionSchema.optional(),
		model: btwModelSchema.optional()
	}).strict()
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
const sendSideChatRequestSchema = z.object({
	chatToken: z.string().uuid(),
	requestId: z.string().uuid(),
	text: z.string().trim().min(1).max(1e5)
}).strict();
const sendSideChatValueSchema = z.object({
	chatToken: z.string().uuid(),
	requestId: z.string().uuid(),
	accepted: z.literal(true),
	messageId: z.string()
}).strict();
const sendSideChatResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: sendSideChatValueSchema
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
const cancelSideChatRequestSchema = z.object({ chatToken: z.string().uuid() }).strict();
const cancelSideChatResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: z.object({
		chatToken: z.string().uuid(),
		accepted: z.literal(true)
	}).strict()
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
const answerSideChatRequestSchema = z.object({
	chatToken: z.string().uuid(),
	questionId: z.string().uuid(),
	answers: z.array(btwAnswerSchema)
}).strict();
const answerSideChatValueSchema = z.object({
	chatToken: z.string().uuid(),
	questionId: z.string().uuid(),
	accepted: z.literal(true)
}).strict();
const answerSideChatResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: answerSideChatValueSchema
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
const closeSideChatRequestSchema = z.object({ chatToken: z.string().uuid() }).strict();
const closeSideChatValueSchema = z.object({
	chatToken: z.string().uuid(),
	closed: z.boolean(),
	/**
	* `kept`: the live runtime state was removed while the persisted child log
	* stays on disk for a later resume; `absent`: no live entry existed.
	*/
	cleanup: z.enum(["kept", "absent"]),
	warning: z.string().optional()
}).strict();
const closeSideChatResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: closeSideChatValueSchema
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
const setSideChatModelRequestSchema = z.object({
	chatToken: z.string().uuid(),
	model: btwModelSchema
}).strict();
const setSideChatModelValueSchema = z.object({
	chatToken: z.string().uuid(),
	accepted: z.literal(true)
}).strict();
const setSideChatModelResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: setSideChatModelValueSchema
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
//#endregion
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
	directDescriptor("start", "StartSideChatRequest", startSideChatRequestSchema, "StartSideChatResult", startSideChatResultSchema, 90),
	directDescriptor("read", "ReadSideChatRequest", readSideChatRequestSchema, "ReadSideChatResult", readSideChatResultSchema, 160),
	directDescriptor("send", "SendSideChatRequest", sendSideChatRequestSchema, "SendSideChatResult", sendSideChatResultSchema, 160),
	directDescriptor("answer", "AnswerSideChatRequest", answerSideChatRequestSchema, "AnswerSideChatResult", answerSideChatResultSchema, 195),
	directDescriptor("cancel", "CancelSideChatRequest", cancelSideChatRequestSchema, "CancelSideChatResult", cancelSideChatResultSchema, 195),
	directDescriptor("close", "CloseSideChatRequest", closeSideChatRequestSchema, "CloseSideChatResult", closeSideChatResultSchema, 210),
	directDescriptor("setModel", "SetSideChatModelRequest", setSideChatModelRequestSchema, "SetSideChatModelResult", setSideChatModelResultSchema, 220)
]);
//#endregion
export { sideChatRemoteDescriptors as t };
