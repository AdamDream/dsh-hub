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
/**
* The three models a side conversation may route to (provider is always `adam`).
* `deepseek-v4-flash` was replaced by `deepseek-v4.1-flash` (2026-09-16);
* persisted legacy selections are mapped host-side (see `sanitizeBtwModel`).
*/
const btwModelSchema = z.enum([
	"deepseek-v4.1-flash",
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
/** The raster formats a pasted side-chat image may carry (aligned with `dsh-attachment`). */
const sideChatImageMediaTypeSchema = z.enum([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
]);
/**
* One pasted image carried by a `sideChat/send` request. `data` is the
* canonical base64 payload; the host admits it through the attachments store
* before it is ever referenced.
*/
const sideChatImagePartSchema = z.object({
	type: z.literal("image"),
	mediaType: sideChatImageMediaTypeSchema,
	data: z.string().min(1),
	name: z.string().optional()
}).strict();
/** A durable image reference echoed in the transcript for display (host-owned refs). */
const sideChatImageRefSchema = z.object({
	attachmentId: z.string(),
	mediaType: sideChatImageMediaTypeSchema,
	name: z.string().optional()
}).strict();
/**
* Flat summary of one tool call in the child transcript (Layer B). The host
* collects `tool/call` + `tool/result` events (which the parent digest never
* reads, see side-chat-service.ts) and projects a lightweight IN/OUT pair for
* the panel's ToolRow approximation. No full `ToolCallBlock` is transported.
*/
const sideChatToolDigestSchema = z.object({
	callId: z.string(),
	name: z.string(),
	/** Raw JSON argument text from the `tool/call` event (IN). */
	args: z.string(),
	/** Content text of the `tool/result` message (OUT); present once settled. */
	result: z.string().optional(),
	/** Whether the call failed (`tool/result` isError). */
	isError: z.boolean().optional(),
	/** Whether the call is still in flight (`tool/call` without `tool/result`); only set while the child runs. */
	running: z.boolean().optional()
}).strict();
/**
* What the child agent is doing right now, for the running banner (TurnStatus
* approximation). `turn`/`step` come from the latest persisted `step/start`,
* falling back to the most recent `tool/call`.
*/
const sideChatCurrentActionSchema = z.discriminatedUnion("kind", [z.object({
	kind: z.literal("generating"),
	turn: z.number().int().nonnegative(),
	step: z.number().int().nonnegative()
}).strict(), z.object({
	kind: z.literal("tool"),
	tool: z.string().min(1),
	turn: z.number().int().nonnegative(),
	step: z.number().int().nonnegative()
}).strict()]);
const sideChatTranscriptMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	images: z.array(sideChatImageRefSchema).optional(),
	/** Flat tool call summaries that happened right after this assistant message (Layer B). */
	tools: z.array(sideChatToolDigestSchema).optional()
}).strict();
const readSideChatImageRequestSchema = z.object({
	chatToken: z.string().uuid(),
	attachmentId: z.string().min(1)
}).strict();
const readSideChatImageResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: z.object({
		mediaType: sideChatImageMediaTypeSchema,
		data: z.string()
	}).strict()
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
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
		currentAction: sideChatCurrentActionSchema.optional(),
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
	/** The user's own text; may be empty when `images` are present (pure-image message). */
	text: z.string().trim().max(1e5),
	images: z.array(sideChatImagePartSchema).optional()
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
/**
* One enumerated side conversation: a tree/project node (identified by
* `parentSessionId`) joined with its persisted btw index record and, when the
* node is live, fresh session metadata.
*/
const sideChatTreeEntrySchema = z.object({
	parentSessionId: z.string(),
	childSessionId: z.string(),
	title: z.string().optional(),
	cwd: z.string().optional(),
	lastActiveAt: z.number(),
	preview: z.string().optional(),
	running: z.boolean().optional()
}).strict();
const listSideChatTreeRequestSchema = z.object({ parentSessionId: z.string().min(1).max(256) }).strict();
const listSideChatTreeResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: z.object({ entries: z.array(sideChatTreeEntrySchema) }).strict()
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
const listSideChatProjectRequestSchema = z.object({ parentSessionId: z.string().min(1).max(256) }).strict();
const listSideChatProjectResultSchema = z.discriminatedUnion("ok", [z.object({
	ok: z.literal(true),
	value: z.object({ entries: z.array(sideChatTreeEntrySchema) }).strict()
}).strict(), z.object({
	ok: z.literal(false),
	error: sideChatErrorSchema
}).strict()]);
//#endregion
export { setSideChatModelRequestSchema as _, closeSideChatRequestSchema as a, startSideChatRequestSchema as b, listSideChatProjectResultSchema as c, readSideChatImageRequestSchema as d, readSideChatImageResultSchema as f, sendSideChatResultSchema as g, sendSideChatRequestSchema as h, cancelSideChatResultSchema as i, listSideChatTreeRequestSchema as l, readSideChatResultSchema as m, answerSideChatResultSchema as n, closeSideChatResultSchema as o, readSideChatRequestSchema as p, cancelSideChatRequestSchema as r, listSideChatProjectRequestSchema as s, answerSideChatRequestSchema as t, listSideChatTreeResultSchema as u, setSideChatModelResultSchema as v, startSideChatResultSchema as x, sideChatImageMediaTypeSchema as y };
