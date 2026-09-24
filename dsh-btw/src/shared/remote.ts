import { z } from 'zod'

export const sideChatErrorCodeSchema = z.enum([
  'parent-not-found', 'already-open', 'not-open', 'invalid-input',
  'compatibility', 'cancelled', 'internal',
])
export type SideChatErrorCode = z.infer<typeof sideChatErrorCodeSchema>

export const sideChatErrorSchema = z.object({ code: sideChatErrorCodeSchema, message: z.string() }).strict()
export type SideChatError = z.infer<typeof sideChatErrorSchema>

/**
 * The three models a side conversation may route to (provider is always `adam`).
 * `deepseek-v4-flash` was replaced by `deepseek-v4.1-flash` (2026-09-16);
 * persisted legacy selections are mapped host-side (see `sanitizeBtwModel`).
 */
export const btwModelSchema = z.enum(['deepseek-v4.1-flash', 'glm-5.3', 'deepseek-v4-pro'])
export type BtwModel = z.infer<typeof btwModelSchema>

export const startSideChatRequestSchema = z.object({
  parentSessionId: z.string().min(1).max(256),
  chatToken: z.string().uuid(),
  model: btwModelSchema.optional(),
}).strict()
export type StartSideChatRequest = z.infer<typeof startSideChatRequestSchema>

export const startSideChatValueSchema = z.object({
  parentSessionId: z.string(),
  childSessionId: z.string(),
  chatToken: z.string().uuid(),
  seedLength: z.number().int().nonnegative(),
  /** Whether this start resumed a persisted child (true) or forked a fresh one (false). */
  resumed: z.boolean(),
  /** The side conversation's current model (default or persisted). */
  model: btwModelSchema.optional(),
}).strict()
export type StartSideChatValue = z.infer<typeof startSideChatValueSchema>

export const startSideChatResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: startSideChatValueSchema }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type StartSideChatResult = z.infer<typeof startSideChatResultSchema>

export const readSideChatRequestSchema = z.object({ chatToken: z.string().uuid() }).strict()
export type ReadSideChatRequest = z.infer<typeof readSideChatRequestSchema>

/** The raster formats a pasted side-chat image may carry (aligned with `dsh-attachment`). */
export const sideChatImageMediaTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export type SideChatImageMediaType = z.infer<typeof sideChatImageMediaTypeSchema>

/**
 * One pasted image carried by a `sideChat/send` request. `data` is the
 * canonical base64 payload; the host admits it through the attachments store
 * before it is ever referenced.
 */
export const sideChatImagePartSchema = z.object({
  type: z.literal('image'),
  mediaType: sideChatImageMediaTypeSchema,
  data: z.string().min(1),
  name: z.string().optional(),
}).strict()
export type SideChatImagePart = z.infer<typeof sideChatImagePartSchema>

/** A durable image reference echoed in the transcript for display (host-owned refs). */
export const sideChatImageRefSchema = z.object({
  attachmentId: z.string(),
  mediaType: sideChatImageMediaTypeSchema,
  name: z.string().optional(),
}).strict()
export type SideChatImageRef = z.infer<typeof sideChatImageRefSchema>

/**
 * Flat summary of one tool call in the child transcript (Layer B). The host
 * collects `tool/call` + `tool/result` events (which the parent digest never
 * reads, see side-chat-service.ts) and projects a lightweight IN/OUT pair for
 * the panel's ToolRow approximation. No full `ToolCallBlock` is transported.
 */
export const sideChatToolDigestSchema = z.object({
  callId: z.string(),
  name: z.string(),
  /** Raw JSON argument text from the `tool/call` event (IN). */
  args: z.string(),
  /** Content text of the `tool/result` message (OUT); present once settled. */
  result: z.string().optional(),
  /** Whether the call failed (`tool/result` isError). */
  isError: z.boolean().optional(),
  /** Whether the call is still in flight (`tool/call` without `tool/result`); only set while the child runs. */
  running: z.boolean().optional(),
}).strict()
export type SideChatToolDigest = z.infer<typeof sideChatToolDigestSchema>

/**
 * What the child agent is doing right now, for the running banner (TurnStatus
 * approximation). `turn`/`step` come from the latest persisted `step/start`,
 * falling back to the most recent `tool/call`.
 */
export const sideChatCurrentActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('generating'),
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    kind: z.literal('tool'),
    tool: z.string().min(1),
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
  }).strict(),
])
export type SideChatCurrentAction = z.infer<typeof sideChatCurrentActionSchema>

export const sideChatTranscriptMessageSchema = z.object({
  id: z.string(), role: z.enum(['user', 'assistant']), text: z.string(),
  images: z.array(sideChatImageRefSchema).optional(),
  /** Flat tool call summaries that happened right after this assistant message (Layer B). */
  tools: z.array(sideChatToolDigestSchema).optional(),
}).strict()
export type SideChatTranscriptMessage = z.infer<typeof sideChatTranscriptMessageSchema>

export const readSideChatImageRequestSchema = z.object({
  chatToken: z.string().uuid(),
  attachmentId: z.string().min(1),
}).strict()
export type ReadSideChatImageRequest = z.infer<typeof readSideChatImageRequestSchema>

export const readSideChatImageResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({
    mediaType: sideChatImageMediaTypeSchema,
    data: z.string(),
  }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type ReadSideChatImageResult = z.infer<typeof readSideChatImageResultSchema>

/** One question inside a pending btw_ask_user call (mirrors ask_user_question's shape). */
export const btwQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  header: z.string().optional(),
  // Both levels are strict: an undeclared option key must not be silently
  // stripped here while an undeclared question key is rejected. The tool
  // boundary (`btw_ask_user.execute`) validates with this same schema, so the
  // model gets a correctable error instead of a frozen panel (D30).
  options: z.array(z.object({
    label: z.string().min(1),
    description: z.string().optional(),
  }).strict()).optional(),
  multi_select: z.boolean().optional(),
}).strict()
export type BtwQuestion = z.infer<typeof btwQuestionSchema>

/** The question currently blocking the child agent, surfaced through sideChat/read. */
export const btwPendingQuestionSchema = z.object({
  questionId: z.string().uuid(),
  questions: z.array(btwQuestionSchema).min(1),
}).strict()
export type BtwPendingQuestion = z.infer<typeof btwPendingQuestionSchema>

/** One answered question, echoed back through sideChat/answer. */
export const btwAnswerSchema = z.object({
  id: z.string().min(1),
  selected: z.array(z.string()),
  custom: z.string().optional(),
}).strict()
export type BtwAnswer = z.infer<typeof btwAnswerSchema>

export const readSideChatResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({
    chatToken: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    messages: z.array(sideChatTranscriptMessageSchema),
    partial: z.string(),
    reasoning: z.string(),
    running: z.boolean(),
    runningTool: z.string().optional(),
    currentAction: sideChatCurrentActionSchema.optional(),
    pendingQuestion: btwPendingQuestionSchema.optional(),
    model: btwModelSchema.optional(),
  }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type ReadSideChatResult = z.infer<typeof readSideChatResultSchema>

export const sendSideChatRequestSchema = z.object({
  chatToken: z.string().uuid(),
  requestId: z.string().uuid(),
  /** The user's own text; may be empty when `images` are present (pure-image message). */
  text: z.string().trim().max(100_000),
  images: z.array(sideChatImagePartSchema).optional(),
}).strict()
export type SendSideChatRequest = z.infer<typeof sendSideChatRequestSchema>

export const sendSideChatValueSchema = z.object({
  chatToken: z.string().uuid(),
  requestId: z.string().uuid(),
  accepted: z.literal(true),
  messageId: z.string(),
}).strict()
export type SendSideChatValue = z.infer<typeof sendSideChatValueSchema>

export const sendSideChatResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: sendSideChatValueSchema }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type SendSideChatResult = z.infer<typeof sendSideChatResultSchema>

export const cancelSideChatRequestSchema = z.object({ chatToken: z.string().uuid() }).strict()
export type CancelSideChatRequest = z.infer<typeof cancelSideChatRequestSchema>

export const cancelSideChatResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({
    chatToken: z.string().uuid(), accepted: z.literal(true),
  }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type CancelSideChatResult = z.infer<typeof cancelSideChatResultSchema>

export const answerSideChatRequestSchema = z.object({
  chatToken: z.string().uuid(),
  questionId: z.string().uuid(),
  answers: z.array(btwAnswerSchema),
}).strict()
export type AnswerSideChatRequest = z.infer<typeof answerSideChatRequestSchema>

export const answerSideChatValueSchema = z.object({
  chatToken: z.string().uuid(),
  questionId: z.string().uuid(),
  accepted: z.literal(true),
}).strict()
export type AnswerSideChatValue = z.infer<typeof answerSideChatValueSchema>

export const answerSideChatResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: answerSideChatValueSchema }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type AnswerSideChatResult = z.infer<typeof answerSideChatResultSchema>

export const closeSideChatRequestSchema = z.object({ chatToken: z.string().uuid() }).strict()
export type CloseSideChatRequest = z.infer<typeof closeSideChatRequestSchema>

export const closeSideChatValueSchema = z.object({
  chatToken: z.string().uuid(),
  closed: z.boolean(),
  /**
   * `kept`: the live runtime state was removed while the persisted child log
   * stays on disk for a later resume; `absent`: no live entry existed.
   */
  cleanup: z.enum(['kept', 'absent']),
  warning: z.string().optional(),
}).strict()
export type CloseSideChatValue = z.infer<typeof closeSideChatValueSchema>

export const closeSideChatResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: closeSideChatValueSchema }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type CloseSideChatResult = z.infer<typeof closeSideChatResultSchema>

export const setSideChatModelRequestSchema = z.object({
  chatToken: z.string().uuid(),
  model: btwModelSchema,
}).strict()
export type SetSideChatModelRequest = z.infer<typeof setSideChatModelRequestSchema>

export const setSideChatModelValueSchema = z.object({
  chatToken: z.string().uuid(),
  accepted: z.literal(true),
}).strict()
export type SetSideChatModelValue = z.infer<typeof setSideChatModelValueSchema>

export const setSideChatModelResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: setSideChatModelValueSchema }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type SetSideChatModelResult = z.infer<typeof setSideChatModelResultSchema>

/**
 * One enumerated side conversation: a tree/project node (identified by
 * `parentSessionId`) joined with its persisted btw index record and, when the
 * node is live, fresh session metadata.
 */
export const sideChatTreeEntrySchema = z.object({
  parentSessionId: z.string(),
  childSessionId: z.string(),
  title: z.string().optional(),
  cwd: z.string().optional(),
  lastActiveAt: z.number(),
  preview: z.string().optional(),
  running: z.boolean().optional(),
}).strict()
export type SideChatTreeEntry = z.infer<typeof sideChatTreeEntrySchema>

export const listSideChatTreeRequestSchema = z.object({
  parentSessionId: z.string().min(1).max(256),
}).strict()
export type ListSideChatTreeRequest = z.infer<typeof listSideChatTreeRequestSchema>

export const listSideChatTreeResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({
    entries: z.array(sideChatTreeEntrySchema),
  }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type ListSideChatTreeResult = z.infer<typeof listSideChatTreeResultSchema>

export const listSideChatProjectRequestSchema = z.object({
  parentSessionId: z.string().min(1).max(256),
}).strict()
export type ListSideChatProjectRequest = z.infer<typeof listSideChatProjectRequestSchema>

export const listSideChatProjectResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({
    entries: z.array(sideChatTreeEntrySchema),
  }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: sideChatErrorSchema }).strict(),
])
export type ListSideChatProjectResult = z.infer<typeof listSideChatProjectResultSchema>
