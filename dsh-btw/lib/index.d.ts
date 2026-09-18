import { $ as listSideChatTreeRequestSchema, A as SideChatImageMediaType, B as answerSideChatResultSchema, C as SendSideChatValue, D as SideChatCurrentAction, E as SetSideChatModelValue, F as SideChatTreeEntry, G as btwQuestionSchema, H as btwAnswerSchema, I as StartSideChatRequest, J as closeSideChatRequestSchema, K as cancelSideChatRequestSchema, L as StartSideChatResult, M as SideChatImageRef, N as SideChatToolDigest, O as SideChatError, P as SideChatTranscriptMessage, Q as listSideChatProjectResultSchema, R as StartSideChatValue, S as SendSideChatResult, St as startSideChatValueSchema, T as SetSideChatModelResult, U as btwModelSchema, V as answerSideChatValueSchema, W as btwPendingQuestionSchema, X as closeSideChatValueSchema, Y as closeSideChatResultSchema, Z as listSideChatProjectRequestSchema, _ as ReadSideChatImageRequest, _t as sideChatToolDigestSchema, a as BtwModel, at as sendSideChatRequestSchema, b as ReadSideChatResult, bt as startSideChatRequestSchema, c as CancelSideChatRequest, ct as setSideChatModelRequestSchema, d as CloseSideChatResult, dt as sideChatCurrentActionSchema, et as listSideChatTreeResultSchema, f as CloseSideChatValue, ft as sideChatErrorCodeSchema, g as ListSideChatTreeResult, gt as sideChatImageRefSchema, h as ListSideChatTreeRequest, ht as sideChatImagePartSchema, i as BtwAnswer, it as readSideChatResultSchema, j as SideChatImagePart, k as SideChatErrorCode, l as CancelSideChatResult, lt as setSideChatModelResultSchema, m as ListSideChatProjectResult, mt as sideChatImageMediaTypeSchema, n as AnswerSideChatResult, nt as readSideChatImageResultSchema, o as BtwPendingQuestion, ot as sendSideChatResultSchema, p as ListSideChatProjectRequest, pt as sideChatErrorSchema, q as cancelSideChatResultSchema, r as AnswerSideChatValue, rt as readSideChatRequestSchema, s as BtwQuestion, st as sendSideChatValueSchema, t as AnswerSideChatRequest, tt as readSideChatImageRequestSchema, u as CloseSideChatRequest, ut as setSideChatModelValueSchema, v as ReadSideChatImageResult, vt as sideChatTranscriptMessageSchema, w as SetSideChatModelRequest, x as SendSideChatRequest, xt as startSideChatResultSchema, y as ReadSideChatRequest, yt as sideChatTreeEntrySchema, z as answerSideChatRequestSchema } from "./remote-DHlY-Qf0.js";
import z from "@deepseek-ai/schemastery";
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
   * Recover the parent Agent for a `start` request when it is not live (P0):
   * a persisted top-level session is cold-resumed through `ctx.agents.resume`
   * (official dsh-api-remotes precedent), a persisted subagent session is
   * materialized through the dsh-subagent continuation manager (no model turn,
   * no work) under its exact live direct parent, recursing up a cold chain.
   * Returns `undefined` when no such session exists in the logical corpus;
   * `{ error }` when the session exists but cannot be recovered; `{ parent }`
   * on success.
   */
  private recoverParent;
  /** Find the logical-corpus record for one session id (existence + origin), when queryable. */
  private corpusRecord;
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
   * 2026-09-18 D1 fix: rebuild the durable image refs of a RESUMED side chat.
   *
   * `imageRefsByMessageId` is only ever written when a message is admitted on a
   * LIVE entry (`sendMessage`), so a resumed conversation began with an empty
   * map: every historical image disappeared from the transcript, and
   * `sideChat/readImage` answered "Unknown attachment id" for ids whose bytes
   * were still sitting in the attachments store — the user-visible symptom was
   * "the screenshot is gone / the model cannot find it".
   *
   * The refs are reconstructible from the child log itself: each admitted image
   * is recorded there as an `image` part carrying its durable `attachment`
   * reference (that is the same shape `sendMessage` sends when the model
   * accepts images directly). This walks the child's own slice of the log once,
   * after the resume settles, and restores the map.
   */
  private hydrateImageRefs;
  /**
   * U-F: read the verified bytes behind one admitted image back to the client
   * for display (R1-10 thumbnails). The child session log only carries text,
   * so `sessions.readAttachment` cannot serve these refs — they live in
   * `imageRefsByMessageId` on the live entry (restored on resume by
   * {@link hydrateImageRefs}).
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
declare const READ_ONLY_TOOL_CANDIDATES: readonly ["read", "read_image", "analyze_image", "glob", "grep", "lsp", "view_image", "web_search", "skill", "session_event_read", "session_event_search", "session_event_trace", "session_search", "session_trace", "job_list", "job_output", "terminal_list", "terminal_read", "list_agents", "get_goal", "mnemon_document_search", "mnemon_memory_bodies", "mnemon_recall", "mnemon_related", "mnemon_status"];
declare const READ_ONLY_TOOL_SET: ReadonlySet<string>;
declare function isSideChatToolAllowed(name: string): boolean;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-btw";
/** Settings namespace brand for the `dsh-btw` section. */
declare const BTW_SETTINGS_NS: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/**
 * `dsh-btw` settings namespace (P0-b settings 行为开关试点). Values hot-reload:
 * editing `~/.dsh/settings.yaml` `dsh-btw:` section republishes and the host
 * re-reads on the next call while the client re-renders via settingsScope —
 * no restart. Keys are pure behavior switches; defaults equal the pre-P0-b
 * behavior (absent section = defaults = 现状). Schema grows only-additively.
 */
declare const BTW_SETTINGS_SCHEMA: z<Schemastery.ObjectS<{
  ui: z<Schemastery.ObjectS<{
    banner: z<boolean, boolean>;
    modelSelect: z<boolean, boolean>;
    imageBadge: z<boolean, boolean>;
  }>, Schemastery.ObjectT<{
    banner: z<boolean, boolean>;
    modelSelect: z<boolean, boolean>;
    imageBadge: z<boolean, boolean>;
  }>>;
  vision: z<Schemastery.ObjectS<{
    autoTransform: z<boolean, boolean>;
  }>, Schemastery.ObjectT<{
    autoTransform: z<boolean, boolean>;
  }>>;
  model: z<Schemastery.ObjectS<{
    default: z<string, string>;
    options: z<string[], string[]>;
  }>, Schemastery.ObjectT<{
    default: z<string, string>;
    options: z<string[], string[]>;
  }>>;
}>, Schemastery.ObjectT<{
  ui: z<Schemastery.ObjectS<{
    banner: z<boolean, boolean>;
    modelSelect: z<boolean, boolean>;
    imageBadge: z<boolean, boolean>;
  }>, Schemastery.ObjectT<{
    banner: z<boolean, boolean>;
    modelSelect: z<boolean, boolean>;
    imageBadge: z<boolean, boolean>;
  }>>;
  vision: z<Schemastery.ObjectS<{
    autoTransform: z<boolean, boolean>;
  }>, Schemastery.ObjectT<{
    autoTransform: z<boolean, boolean>;
  }>>;
  model: z<Schemastery.ObjectS<{
    default: z<string, string>;
    options: z<string[], string[]>;
  }>, Schemastery.ObjectT<{
    default: z<string, string>;
    options: z<string[], string[]>;
  }>>;
}>>;
declare function apply(ctx: Context): void;
//#endregion
export { type AnswerSideChatRequest, type AnswerSideChatResult, type AnswerSideChatValue, BTW_SETTINGS_NS, BTW_SETTINGS_SCHEMA, type BtwAnswer, type BtwModel, type BtwPendingQuestion, type BtwQuestion, BtwRegistry, type CancelSideChatRequest, type CancelSideChatResult, type CloseSideChatRequest, type CloseSideChatResult, type CloseSideChatValue, type ListSideChatProjectRequest, type ListSideChatProjectResult, type ListSideChatTreeRequest, type ListSideChatTreeResult, READ_ONLY_TOOL_CANDIDATES, READ_ONLY_TOOL_SET, type ReadSideChatImageRequest, type ReadSideChatImageResult, type ReadSideChatRequest, type ReadSideChatResult, type SendSideChatRequest, type SendSideChatResult, type SendSideChatValue, type SetSideChatModelRequest, type SetSideChatModelResult, type SetSideChatModelValue, type SideChatCurrentAction, type SideChatError, type SideChatErrorCode, type SideChatImageMediaType, type SideChatImagePart, type SideChatImageRef, SideChatService, type SideChatToolDigest, type SideChatTranscriptMessage, type SideChatTreeEntry, type StartSideChatRequest, type StartSideChatResult, type StartSideChatValue, type answerSideChatRequestSchema, type answerSideChatResultSchema, type answerSideChatValueSchema, apply, type btwAnswerSchema, btwHome, btwIndexPath, type btwModelSchema, type btwPendingQuestionSchema, type btwQuestionSchema, buildProgressDigest, type cancelSideChatRequestSchema, type cancelSideChatResultSchema, type closeSideChatRequestSchema, type closeSideChatResultSchema, type closeSideChatValueSchema, completedTurnSeed, isSideChatToolAllowed, type listSideChatProjectRequestSchema, type listSideChatProjectResultSchema, type listSideChatTreeRequestSchema, type listSideChatTreeResultSchema, name, type readSideChatImageRequestSchema, type readSideChatImageResultSchema, type readSideChatRequestSchema, type readSideChatResultSchema, type sendSideChatRequestSchema, type sendSideChatResultSchema, type sendSideChatValueSchema, type setSideChatModelRequestSchema, type setSideChatModelResultSchema, type setSideChatModelValueSchema, type sideChatCurrentActionSchema, type sideChatErrorCodeSchema, type sideChatErrorSchema, type sideChatImageMediaTypeSchema, type sideChatImagePartSchema, type sideChatImageRefSchema, type sideChatToolDigestSchema, type sideChatTranscriptMessageSchema, type sideChatTreeEntrySchema, type startSideChatRequestSchema, type startSideChatResultSchema, type startSideChatValueSchema };