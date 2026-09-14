import { A as btwAnswerSchema, B as readSideChatResultSchema, C as SideChatTranscriptMessage, D as answerSideChatRequestSchema, E as StartSideChatValue, F as cancelSideChatResultSchema, G as setSideChatModelResultSchema, H as sendSideChatResultSchema, I as closeSideChatRequestSchema, J as sideChatErrorSchema, K as setSideChatModelValueSchema, L as closeSideChatResultSchema, M as btwPendingQuestionSchema, N as btwQuestionSchema, O as answerSideChatResultSchema, P as cancelSideChatRequestSchema, Q as startSideChatValueSchema, R as closeSideChatValueSchema, S as SideChatErrorCode, T as StartSideChatResult, U as sendSideChatValueSchema, V as sendSideChatRequestSchema, W as setSideChatModelRequestSchema, X as startSideChatRequestSchema, Y as sideChatTranscriptMessageSchema, Z as startSideChatResultSchema, _ as SendSideChatValue, a as BtwModel, b as SetSideChatModelValue, c as CancelSideChatRequest, d as CloseSideChatResult, f as CloseSideChatValue, g as SendSideChatResult, h as SendSideChatRequest, i as BtwAnswer, j as btwModelSchema, k as answerSideChatValueSchema, l as CancelSideChatResult, m as ReadSideChatResult, n as AnswerSideChatResult, o as BtwPendingQuestion, p as ReadSideChatRequest, q as sideChatErrorCodeSchema, r as AnswerSideChatValue, s as BtwQuestion, t as AnswerSideChatRequest, u as CloseSideChatRequest, v as SetSideChatModelRequest, w as StartSideChatRequest, x as SideChatError, y as SetSideChatModelResult, z as readSideChatRequestSchema } from "./remote-jUXYzlU4.js";
import { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Agent } from "@deepseek-ai/dsh-agent";
import { SessionEvent } from "@deepseek-ai/dsh-session";
//#region src/host/side-chat-service.d.ts
declare function completedTurnSeed(events: readonly SessionEvent[]): SessionEvent[];
/**
 * Summarize what the parent agent is doing right now (U6).
 *
 * Sources, all replacement-safe:
 * - `parent.status` — the live lifecycle mirror.
 * - The raw event-log suffix after the last completed turn. `turn/end`,
 *   `tool/call`, and `assistant/chunk` events are log-only and are never
 *   rewritten by compaction, so reading them from the raw suffix cannot
 *   double-count pruned tool results (the tool-result pruner only appends
 *   replacement `tool/result` events, which this digest never reads).
 * - The last user instruction is read through the session surface when
 *   available, so a compaction-replaced message could never be counted twice
 *   either; the raw suffix is only a fallback for test doubles.
 */
declare function buildProgressDigest(parent: Agent): string;
declare class SideChatService extends TypertRemoteService {
  static inject: string[];
  private readonly byToken;
  private readonly tokenByParent;
  private readonly registry;
  private grillMeText;
  private grillMeLoaded;
  constructor(ctx: Context);
  start(request: StartSideChatRequest): Promise<StartSideChatResult>;
  /**
   * Resume the indexed child session for this parent (U5). Returns the start
   * result on success, or `undefined` when the caller should fall back to a
   * fresh fork.
   */
  private startResumed;
  /** The four read-only layers plus the btw_ask_user channel (create and resume). */
  private composeChild;
  /**
   * Couple this child's mutable model choice to its request routing.
   * `current` resolves a `setModel` pick first, then the persisted header
   * (resume), then the default; `agent/request` applies it on the next turn.
   */
  private installBtwModelSelection;
  private registerAskBackTool;
  private injectOpeningNotices;
  private deliverQueued;
  /** Persona text with the grill-me interview skill inlined when available (U8). */
  private persona;
  private loadGrillMeText;
  read(request: ReadSideChatRequest): ReadSideChatResult;
  send(request: SendSideChatRequest): Promise<SendSideChatResult>;
  /** Deliver the user's answers to a pending btw_ask_user call (U7). */
  answer(request: AnswerSideChatRequest): Promise<AnswerSideChatResult>;
  cancel(request: CancelSideChatRequest): Promise<CancelSideChatResult>;
  close(request: CloseSideChatRequest): Promise<CloseSideChatResult>;
  /** Switch the side conversation's model for subsequent turns (takes effect on the next step). */
  setModel(request: SetSideChatModelRequest): Promise<SetSideChatModelResult>;
  private startValue;
  private adoptToken;
  private forget;
  private disposeAll;
}
//#endregion
//#region src/host/btw-registry.d.ts
/** One index record: the persisted child session for one parent session. */
interface BtwIndexEntry {
  readonly childSessionId: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}
interface BtwIndexFile {
  readonly version: 1;
  readonly entries: Record<string, BtwIndexEntry>;
}
/** The DSH home directory (env override first, `~/.dsh` fallback). */
declare function btwHome(): string;
/** Absolute path of the durable btw index file. */
declare function btwIndexPath(): string;
/**
 * Atomic-read registry over `~/.dsh/btw/index.json`. Every mutation rewrites
 * the whole (small) file through a unique temp file + `rename`, so a crash
 * mid-write can never leave a torn index behind.
 */
declare class BtwRegistry {
  /** Serialized write chain so concurrent set/touch/remove cannot interleave. */
  private tail;
  /** Read the index fresh from disk; a missing or corrupt file degrades to empty. */
  load(): Promise<BtwIndexFile>;
  /** The persisted child session id for one parent session, when indexed. */
  get(parentSessionId: string): Promise<BtwIndexEntry | undefined>;
  /** Record (or refresh) the child session for one parent session. */
  set(parentSessionId: string, childSessionId: string): Promise<void>;
  /** Refresh `lastActiveAt` for one parent session, keeping the child id. */
  touch(parentSessionId: string): Promise<void>;
  /** Drop one parent session from the index (its persisted log is untouched). */
  remove(parentSessionId: string): Promise<void>;
  private enqueue;
  private write;
}
//#endregion
//#region src/shared/tool-policy.d.ts
/**
 * Tool policy for btw side conversations.
 *
 * Two layers, mirroring the upstream design:
 * - `READ_ONLY_TOOL_CANDIDATES`: the visible read-only allow-list intersected
 *   with the parent agent's actually-registered tools at child creation time.
 * - `READ_ONLY_TOOL_SET`: the execution-guard layer; everything not in this
 *   set is denied with {@link READ_ONLY_DENIAL}.
 *
 * `btw_ask_user` is the plugin's own ask-back channel (U7): it is registered
 * inside the child's scoped world, so it is NOT a global tool and therefore
 * never appears in `READ_ONLY_TOOL_CANDIDATES` (whose members are validated
 * against the parent's global tool registry). It must still pass the
 * execution guard, so it joins the guard set here. The built-in
 * `ask_user_question` stays OUT on purpose: it is double-blocked for a
 * delegated child (DELEGATED_CALLER guard in dsh-user-questions plus the
 * hidden child session having no client answer scope), which is exactly why
 * btw ships its own channel.
 */
declare const READ_ONLY_TOOL_CANDIDATES: readonly ["read", "read_image", "glob", "grep", "lsp", "view_image", "web_search", "skill", "session_event_read", "session_event_search", "session_event_trace", "session_search", "session_trace", "job_list", "job_output", "terminal_list", "terminal_read", "list_agents", "get_goal", "mnemon_document_search", "mnemon_memory_bodies", "mnemon_recall", "mnemon_related", "mnemon_status"];
declare const READ_ONLY_TOOL_SET: ReadonlySet<string>;
declare function isSideChatToolAllowed(name: string): boolean;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-btw";
declare function apply(ctx: Context): void;
//#endregion
export { type AnswerSideChatRequest, type AnswerSideChatResult, type AnswerSideChatValue, type BtwAnswer, type BtwModel, type BtwPendingQuestion, type BtwQuestion, BtwRegistry, type CancelSideChatRequest, type CancelSideChatResult, type CloseSideChatRequest, type CloseSideChatResult, type CloseSideChatValue, READ_ONLY_TOOL_CANDIDATES, READ_ONLY_TOOL_SET, type ReadSideChatRequest, type ReadSideChatResult, type SendSideChatRequest, type SendSideChatResult, type SendSideChatValue, type SetSideChatModelRequest, type SetSideChatModelResult, type SetSideChatModelValue, type SideChatError, type SideChatErrorCode, SideChatService, type SideChatTranscriptMessage, type StartSideChatRequest, type StartSideChatResult, type StartSideChatValue, type answerSideChatRequestSchema, type answerSideChatResultSchema, type answerSideChatValueSchema, apply, type btwAnswerSchema, btwHome, btwIndexPath, type btwModelSchema, type btwPendingQuestionSchema, type btwQuestionSchema, buildProgressDigest, type cancelSideChatRequestSchema, type cancelSideChatResultSchema, type closeSideChatRequestSchema, type closeSideChatResultSchema, type closeSideChatValueSchema, completedTurnSeed, isSideChatToolAllowed, name, type readSideChatRequestSchema, type readSideChatResultSchema, type sendSideChatRequestSchema, type sendSideChatResultSchema, type sendSideChatValueSchema, type setSideChatModelRequestSchema, type setSideChatModelResultSchema, type setSideChatModelValueSchema, type sideChatErrorCodeSchema, type sideChatErrorSchema, type sideChatTranscriptMessageSchema, type startSideChatRequestSchema, type startSideChatResultSchema, type startSideChatValueSchema };