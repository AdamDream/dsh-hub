import { $ as readSideChatImageRequestSchema, A as SideChatImagePart, B as btwAnswerSchema, C as SendSideChatValue, D as SideChatError, E as SetSideChatModelValue, F as StartSideChatResult, G as cancelSideChatResultSchema, H as btwPendingQuestionSchema, I as StartSideChatValue, J as closeSideChatValueSchema, K as closeSideChatRequestSchema, L as answerSideChatRequestSchema, M as SideChatTranscriptMessage, N as SideChatTreeEntry, O as SideChatErrorCode, P as StartSideChatRequest, Q as listSideChatTreeResultSchema, R as answerSideChatResultSchema, S as SendSideChatResult, T as SetSideChatModelResult, U as btwQuestionSchema, V as btwModelSchema, W as cancelSideChatRequestSchema, X as listSideChatProjectResultSchema, Y as listSideChatProjectRequestSchema, Z as listSideChatTreeRequestSchema, _ as ReadSideChatImageRequest, _t as startSideChatResultSchema, a as BtwModel, at as sendSideChatValueSchema, b as ReadSideChatResult, c as CancelSideChatRequest, ct as setSideChatModelValueSchema, d as CloseSideChatResult, dt as sideChatImageMediaTypeSchema, et as readSideChatImageResultSchema, f as CloseSideChatValue, ft as sideChatImagePartSchema, g as ListSideChatTreeResult, gt as startSideChatRequestSchema, h as ListSideChatTreeRequest, ht as sideChatTreeEntrySchema, i as BtwAnswer, it as sendSideChatResultSchema, j as SideChatImageRef, k as SideChatImageMediaType, l as CancelSideChatResult, lt as sideChatErrorCodeSchema, m as ListSideChatProjectResult, mt as sideChatTranscriptMessageSchema, n as AnswerSideChatResult, nt as readSideChatResultSchema, o as BtwPendingQuestion, ot as setSideChatModelRequestSchema, p as ListSideChatProjectRequest, pt as sideChatImageRefSchema, q as closeSideChatResultSchema, r as AnswerSideChatValue, rt as sendSideChatRequestSchema, s as BtwQuestion, st as setSideChatModelResultSchema, t as AnswerSideChatRequest, tt as readSideChatRequestSchema, u as CloseSideChatRequest, ut as sideChatErrorSchema, v as ReadSideChatImageResult, vt as startSideChatValueSchema, w as SetSideChatModelRequest, x as SendSideChatRequest, y as ReadSideChatRequest, z as answerSideChatValueSchema } from "./remote-B99lQE7P.js";
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
  /**
   * U-F: read the verified bytes behind one admitted image back to the client
   * for display (R1-10 thumbnails). The child session log only carries text,
   * so `sessions.readAttachment` cannot serve these refs — they live in
   * `imageRefsByMessageId` on the live entry.
   */
  readSideChatImage(request: ReadSideChatImageRequest): Promise<ReadSideChatImageResult>;
  /**
   * U-J: enumerate every side conversation under one session tree — the root
   * itself plus all session-backed subagents below it (`subagents.listDescendants`),
   * joined with the durable btw index and, when live, fresh session metadata.
   */
  listTree(request: ListSideChatTreeRequest): Promise<ListSideChatTreeResult>;
  /**
   * U-J: enumerate every side conversation whose parent session lives in the
   * same working directory (project group) — `sessionQuery.listSessions`
   * filtered by resolved realpath, joined with the durable btw index.
   */
  listProject(request: ListSideChatProjectRequest): Promise<ListSideChatProjectResult>;
  private startValue;
  private adoptToken;
  /** Fresh index v2 fields for one parent/child pair (audit U-J). */
  private indexExtras;
  /** Fire-and-forget index freshness refresh after side-chat activity (send). */
  private touchIndex;
  /** Join candidate parent ids with the durable index; live metadata wins. */
  private listEntries;
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
  /** Cached parent session title (last `session/title` event; cwd basename fallback). */
  readonly parentTitle?: string;
  /** Cached parent session working directory. */
  readonly parentCwd?: string;
  /** Cached last user/assistant text from the child live events (list preview). */
  readonly lastPreview?: string;
}
/** Optional freshness fields folded into a set/touch write (v2). */
interface BtwIndexExtras {
  parentTitle?: string;
  parentCwd?: string;
  lastPreview?: string;
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
  set(parentSessionId: string, childSessionId: string, extras?: BtwIndexExtras): Promise<void>;
  /** Refresh `lastActiveAt` (and any provided v2 fields) for one parent session. */
  touch(parentSessionId: string, extras?: BtwIndexExtras): Promise<void>;
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
export { type AnswerSideChatRequest, type AnswerSideChatResult, type AnswerSideChatValue, type BtwAnswer, type BtwModel, type BtwPendingQuestion, type BtwQuestion, BtwRegistry, type CancelSideChatRequest, type CancelSideChatResult, type CloseSideChatRequest, type CloseSideChatResult, type CloseSideChatValue, type ListSideChatProjectRequest, type ListSideChatProjectResult, type ListSideChatTreeRequest, type ListSideChatTreeResult, READ_ONLY_TOOL_CANDIDATES, READ_ONLY_TOOL_SET, type ReadSideChatImageRequest, type ReadSideChatImageResult, type ReadSideChatRequest, type ReadSideChatResult, type SendSideChatRequest, type SendSideChatResult, type SendSideChatValue, type SetSideChatModelRequest, type SetSideChatModelResult, type SetSideChatModelValue, type SideChatError, type SideChatErrorCode, type SideChatImageMediaType, type SideChatImagePart, type SideChatImageRef, SideChatService, type SideChatTranscriptMessage, type SideChatTreeEntry, type StartSideChatRequest, type StartSideChatResult, type StartSideChatValue, type answerSideChatRequestSchema, type answerSideChatResultSchema, type answerSideChatValueSchema, apply, type btwAnswerSchema, btwHome, btwIndexPath, type btwModelSchema, type btwPendingQuestionSchema, type btwQuestionSchema, buildProgressDigest, type cancelSideChatRequestSchema, type cancelSideChatResultSchema, type closeSideChatRequestSchema, type closeSideChatResultSchema, type closeSideChatValueSchema, completedTurnSeed, isSideChatToolAllowed, type listSideChatProjectRequestSchema, type listSideChatProjectResultSchema, type listSideChatTreeRequestSchema, type listSideChatTreeResultSchema, name, type readSideChatImageRequestSchema, type readSideChatImageResultSchema, type readSideChatRequestSchema, type readSideChatResultSchema, type sendSideChatRequestSchema, type sendSideChatResultSchema, type sendSideChatValueSchema, type setSideChatModelRequestSchema, type setSideChatModelResultSchema, type setSideChatModelValueSchema, type sideChatErrorCodeSchema, type sideChatErrorSchema, type sideChatImageMediaTypeSchema, type sideChatImagePartSchema, type sideChatImageRefSchema, type sideChatTranscriptMessageSchema, type sideChatTreeEntrySchema, type startSideChatRequestSchema, type startSideChatResultSchema, type startSideChatValueSchema };