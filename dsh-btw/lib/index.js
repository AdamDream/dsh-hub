import { b as sideChatImageMediaTypeSchema, r as btwPendingQuestionSchema } from "./remote-C2Gojj6I.js";
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { appendDelegatedPolicyOverrides, applyChildComposition, childSessionMeta, resolveChildAgentOptions, resolveChildDepth } from "@deepseek-ai/dsh-subagent";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
//#region src/host/btw-registry.ts
/**
* Durable btw index: which persisted child session belongs to which parent
* session (U5).
*
* The mapping deliberately lives OUTSIDE the child session meta: upstream's
* `hiddenSideChatMeta` strips `parentSession` from `childSessionMeta()` so the
* child stays out of both the normal session directory and the subagent
* directory (origin `'subagent'` with no parent link). Writing the parent id
* back into the child header would break that hiding. Instead this small
* sidecar file records parentSessionId → childSessionId, is updated with
* atomic rename writes, and is consulted by `SideChatService.start()` to
* resume the persisted child through `ctx.agents.resume()` after a DSH
* restart.
*/
const EMPTY_INDEX = Object.freeze({
	version: 1,
	entries: Object.freeze({})
});
/** The DSH home directory (env override first, `~/.dsh` fallback). */
function btwHome() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
/** Absolute path of the durable btw index file. */
function btwIndexPath() {
	return join(btwHome(), "btw", "index.json");
}
function parseIndex(raw) {
	const value = JSON.parse(raw);
	if (typeof value !== "object" || value === null) throw new Error("btw index: not an object");
	const record = value;
	if (record.version !== 1) throw new Error(`btw index: unsupported version ${String(record.version)}`);
	if (typeof record.entries !== "object" || record.entries === null) throw new Error("btw index: entries is not an object");
	const entries = {};
	for (const [parentSessionId, entry] of Object.entries(record.entries)) {
		if (typeof entry !== "object" || entry === null) continue;
		const candidate = entry;
		if (typeof candidate.childSessionId !== "string" || candidate.childSessionId.length === 0) continue;
		if (typeof candidate.createdAt !== "number" || typeof candidate.lastActiveAt !== "number") continue;
		entries[parentSessionId] = {
			childSessionId: candidate.childSessionId,
			createdAt: candidate.createdAt,
			lastActiveAt: candidate.lastActiveAt,
			...typeof candidate.parentTitle === "string" ? { parentTitle: candidate.parentTitle } : {},
			...typeof candidate.parentCwd === "string" ? { parentCwd: candidate.parentCwd } : {},
			...typeof candidate.lastPreview === "string" ? { lastPreview: candidate.lastPreview } : {}
		};
	}
	return {
		version: 1,
		entries
	};
}
/**
* Atomic-read registry over `~/.dsh/btw/index.json`. Every mutation rewrites
* the whole (small) file through a unique temp file + `rename`, so a crash
* mid-write can never leave a torn index behind.
*/
var BtwRegistry = class {
	/** Serialized write chain so concurrent set/touch/remove cannot interleave. */
	tail = Promise.resolve();
	/** Read the index fresh from disk; a missing or corrupt file degrades to empty. */
	async load() {
		try {
			return parseIndex(await readFile(btwIndexPath(), "utf8"));
		} catch {
			return EMPTY_INDEX;
		}
	}
	/** The persisted child session id for one parent session, when indexed. */
	async get(parentSessionId) {
		return (await this.load()).entries[parentSessionId];
	}
	/** Record (or refresh) the child session for one parent session. */
	async set(parentSessionId, childSessionId, extras) {
		await this.enqueue(async () => {
			const current = await this.load();
			const previous = current.entries[parentSessionId];
			const now = Date.now();
			const next = {
				version: 1,
				entries: {
					...current.entries,
					[parentSessionId]: {
						childSessionId,
						createdAt: previous?.childSessionId === childSessionId ? previous.createdAt : now,
						lastActiveAt: now,
						...extras?.parentTitle !== void 0 ? { parentTitle: extras.parentTitle } : {},
						...extras?.parentCwd !== void 0 ? { parentCwd: extras.parentCwd } : {},
						...extras?.lastPreview !== void 0 ? { lastPreview: extras.lastPreview } : {}
					}
				}
			};
			await this.write(next);
		});
	}
	/** Refresh `lastActiveAt` (and any provided v2 fields) for one parent session. */
	async touch(parentSessionId, extras) {
		await this.enqueue(async () => {
			const current = await this.load();
			const previous = current.entries[parentSessionId];
			if (previous === void 0) return;
			await this.write({
				version: 1,
				entries: {
					...current.entries,
					[parentSessionId]: {
						...previous,
						lastActiveAt: Date.now(),
						...extras?.parentTitle !== void 0 ? { parentTitle: extras.parentTitle } : {},
						...extras?.parentCwd !== void 0 ? { parentCwd: extras.parentCwd } : {},
						...extras?.lastPreview !== void 0 ? { lastPreview: extras.lastPreview } : {}
					}
				}
			});
		});
	}
	/** Drop one parent session from the index (its persisted log is untouched). */
	async remove(parentSessionId) {
		await this.enqueue(async () => {
			const current = await this.load();
			if (!(parentSessionId in current.entries)) return;
			const entries = { ...current.entries };
			delete entries[parentSessionId];
			await this.write({
				version: 1,
				entries
			});
		});
	}
	enqueue(operation) {
		const next = this.tail.then(operation, operation);
		this.tail = next.catch(() => void 0);
		return next;
	}
	async write(index) {
		const path = btwIndexPath();
		const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
		try {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(temporary, JSON.stringify(index, null, 2) + "\n", "utf8");
			await rename(temporary, path);
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => void 0);
			throw error;
		}
	}
};
//#endregion
//#region src/host/vision.ts
function routeOf(value) {
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	if (typeof record.provider === "string" && record.provider.length > 0 && typeof record.model === "string" && record.model.length > 0) return {
		provider: record.provider,
		model: record.model
	};
}
/**
* Resolve the route one agent runs under, mirroring the host's `selectionFor`
* tiers on the public surface only: the session's logged request header first
* (`agent.session.requestHeader()?.config`, the dsh-session public API — the
* same value the host's log tier reads), then the `agentDefaultModel`
* selection service (the host's default tier), then undefined. A route the
* host picked in-memory but has not logged yet is not visible here; the host
* gate still validates the final send against its own authoritative
* selection, so this can only ever be more conservative, never unsafe.
*/
function resolveAgentRoute(ctx, agent) {
	const logged = (agent?.session)?.requestHeader?.();
	const route = routeOf(logged?.config);
	if (route !== void 0) return route;
	const defaults = ctx.get?.("agentDefaultModel");
	return routeOf(defaults?.currentSelection?.());
}
/**
* Whether one route DECLARES image input. True only when the LLM registry's
* `resolveModelInfo` returns `inputModalities` containing 'image'. Every
* other outcome — route unresolvable, registry absent, lookup failure, a
* missing or image-less modality list — returns false, so callers keep the
* conservative vision-adam text path (text is accepted by any model).
*/
async function modelAcceptsImage(ctx, route, signal) {
	const llm = ctx.get?.("llm");
	if (llm?.resolveModelInfo === void 0) return false;
	try {
		const info = await llm.resolveModelInfo(route.provider, route.model, signal);
		return Array.isArray(info?.inputModalities) && info.inputModalities.includes("image");
	} catch {
		return false;
	}
}
/** Defaults used when no `vision-adam` settings section is available (R1-4/R1-5). */
const VISION_DEFAULTS = Object.freeze({
	model: "deepseek-v4.1-flash",
	baseURL: "https://opencode.ai/zen/go/v1",
	apiKeyEnv: "OPENCODE_GO_API_KEY",
	maxTokens: 2e3
});
/** Default analysis question sent with every pasted image (audit U-I; 2026-09-14 全落点改版：完整转录 + 审美/设计合理性分析). */
const VISION_DEFAULT_QUESTION = "请用中文尽可能完整转录这张图片的全部可见内容（文字逐字、布局、颜色、元素位置），并附审美与设计合理性分析（配色、层级、对齐、可读性、改进建议）。";
function errorText$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* The R1-9 template: one heading, one `[图片 N]` segment per description, and
* the user's own text when present (pure-image messages omit it and leave no
* trailing blank line).
*/
function wrapImageDescriptions(descriptions, originalText) {
	const heading = `用户附带了 ${descriptions.length} 张图片，以下为各图片的描述（vision-adam 生成）：`;
	const body = descriptions.map((description, index) => `[图片 ${index + 1}] ${description.trim()}`).join("\n\n");
	const original = originalText.trim();
	const segments = [heading, body];
	if (original !== "") segments.push(`用户原文：\n${original}`);
	return segments.join("\n\n");
}
async function loadVisionAdam() {
	const vision = await import("@deepseek-ai/dsh-vision-adam");
	if (typeof vision.analyzeImageBytes !== "function" || typeof vision.resolveOptions !== "function" || typeof vision.resolveApiKey !== "function") throw new Error("vision-adam 部署副本缺少 analyzeImageBytes/resolveOptions/resolveApiKey 导出，请按部署 Runbook（U-H）升级该插件");
	return vision;
}
/** Read the `vision-adam` settings section; any surprise degrades to the defaults. */
function readVisionConfig(ctx) {
	try {
		const section = ctx.get("settings")?.get?.("vision-adam");
		if (section !== null && typeof section === "object") return section;
	} catch {}
	return VISION_DEFAULTS;
}
function readBtwSettings(ctx) {
	try {
		const section = ctx.get("settings")?.get?.("dsh-btw");
		if (section !== null && typeof section === "object") return section;
	} catch {}
	return {};
}
/**
* Analyze every image synchronously (before the message is admitted) and
* return one description per image, in order. Configuration comes from the
* `vision-adam` settings section (defaults when absent); the API key is
* resolved through the credentials chain. Any failure throws with a readable
* vision-adam-prefixed message so callers can surface it without sending.
*/
async function analyzeImages(ctx, images, signal) {
	if (images.length === 0) return [];
	const vision = await loadVisionAdam();
	const options = vision.resolveOptions(readVisionConfig(ctx));
	const apiKey = await vision.resolveApiKey(options, ctx, signal).catch((error) => {
		throw new Error(`vision-adam 凭据不可用: ${errorText$1(error)}`);
	});
	const descriptions = [];
	for (const image of images) {
		const description = await vision.analyzeImageBytes(options, apiKey, image.mediaType, image.data, VISION_DEFAULT_QUESTION, signal);
		descriptions.push(description);
	}
	return descriptions;
}
//#endregion
//#region src/shared/tool-policy.ts
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
const READ_ONLY_TOOL_CANDIDATES = Object.freeze([
	"read",
	"read_image",
	"analyze_image",
	"glob",
	"grep",
	"lsp",
	"view_image",
	"web_search",
	"skill",
	"session_event_read",
	"session_event_search",
	"session_event_trace",
	"session_search",
	"session_trace",
	"job_list",
	"job_output",
	"terminal_list",
	"terminal_read",
	"list_agents",
	"get_goal",
	"mnemon_document_search",
	"mnemon_memory_bodies",
	"mnemon_recall",
	"mnemon_related",
	"mnemon_status"
]);
const READ_ONLY_TOOL_SET = Object.freeze(/* @__PURE__ */ new Set([
	...READ_ONLY_TOOL_CANDIDATES,
	"run_code",
	"btw_ask_user"
]));
function isSideChatToolAllowed(name) {
	return READ_ONLY_TOOL_SET.has(name);
}
const READ_ONLY_DENIAL = "btw is read-only. This tool could change external state, files, sessions, or processes. Answer using inherited context, read-only inspection, or the btw_ask_user tool instead.";
//#endregion
//#region src/host/side-chat-service.ts
const SIDE_CHAT_PERSONA = "You are in a persistent side conversation (btw), separate from the main task. Treat inherited history as reference context only. Do not continue or complete the parent task. Answer only instructions submitted in this side conversation. Use lightweight, read-only exploration. Never modify files, repositories, sessions, processes, remote systems, or external state. Do not delegate to subagents. When you need clarification, confirmation, or a decision from the user before answering, call the btw_ask_user tool with concise questions (stable ids, optional options, recommended option first); the user answers inside the side panel and the answers return to you as the tool result. Prefer asking over guessing when the user's request is ambiguous.";
const SIDE_CHAT_BOUNDARY = "Side conversation boundary. Everything before this message is inherited history from the parent thread and is reference context only, not your current task. Do not continue any earlier plan, edit, command, approval, or tool call. Only direct user messages after this boundary are active instructions. This conversation is read-only.";
/** Marker injected with the digest notice so the digest stays identifiable in the child log. */
const DIGEST_SUMMARY = "Main conversation progress snapshot";
/**
* Fallback routable side-conversation models (provider is always `adam`).
* The routable set and the default are settings-driven (P0-b 热载):
* `dsh-btw.model.options` / `dsh-btw.model.default` are read on every call
* (host re-reads the namespace each time, so editing `~/.dsh/settings.yaml`
* applies without a restart); an absent or malformed section falls back to
* these constants (= pre-hot-read behavior).
*/
const BTW_FALLBACK_MODELS = [
	"deepseek-v4.1-flash",
	"glm-5.3",
	"deepseek-v4-pro"
];
const BTW_PROVIDER = "adam";
const BTW_FALLBACK_DEFAULT_MODEL = "deepseek-v4.1-flash";
/**
* Legacy persisted model ids mapped onto their replacement. Side conversations
* created before the v4-flash → v4.1-flash switch (2026-09-16) keep their
* flash-class intent (the persisted id lives in the child session request
* header and is read on every resume); anything unknown degrades to the
* default. The wire schemas never carry these ids — every host emission goes
* through `sanitizeBtwModel` first, so a legacy id can never trip strict
* client-side validation.
*/
const BTW_LEGACY_MODEL_MAP = { "deepseek-v4-flash": "deepseek-v4.1-flash" };
/**
* The routable model list right now: `dsh-btw.model.options` when configured
* (non-empty array), else the fallback constant list. Read per call → 热载.
*/
function btwRoutableModels(ctx) {
	const options = readBtwSettings(ctx).model?.options;
	return Array.isArray(options) && options.length > 0 ? options : BTW_FALLBACK_MODELS;
}
/**
* The default model right now: `dsh-btw.model.default` validated against the
* current routable set, else the fallback constant. Read per call → 热载.
*/
function btwDefaultModel(ctx) {
	return sanitizeBtwModel(readBtwSettings(ctx).model?.default, btwRoutableModels(ctx));
}
/**
* Normalize one model candidate to a routable value: a legacy persisted id
* maps onto its replacement first, then the candidate passes when it is in
* the routable set (`routable` or the fallback constant list), else the
* default. Never throws — strict wire validation can therefore never be
* tripped by persisted or configured values.
*/
function sanitizeBtwModel(model, routable) {
	if (model === void 0) return BTW_FALLBACK_DEFAULT_MODEL;
	const legacy = BTW_LEGACY_MODEL_MAP[model];
	if (legacy !== void 0) return legacy;
	if ((routable ?? BTW_FALLBACK_MODELS).includes(model)) return model;
	return BTW_FALLBACK_DEFAULT_MODEL;
}
/**
* The model a side conversation reports right now: the composed selection
* (explicit pick / persisted header) sanitized against the current routable
* set, or the settings-resolved default while the child is still opening.
* Read per call, so a settings.yaml edit surfaces on the very next read.
*/
function btwCurrentModel(ctx, entry) {
	const current = entry.modelSelection?.current?.model;
	if (current === void 0) return btwDefaultModel(ctx);
	return sanitizeBtwModel(current, btwRoutableModels(ctx));
}
function failure(code, message) {
	return {
		ok: false,
		error: {
			code,
			message
		}
	};
}
function completedTurnSeed(events) {
	const lastTurnEnd = events.findLast((event) => event.type === "turn/end");
	if (lastTurnEnd === void 0) return [];
	return events.slice(0, lastTurnEnd.seq + 1);
}
function visibleReadTools(parent) {
	return READ_ONLY_TOOL_CANDIDATES.filter((name) => parent.ctx.tools.get(name, parent) !== void 0);
}
function hiddenSideChatMeta(parent, depth, forkSeq) {
	const { parentSession: durableParentLink, ...meta } = childSessionMeta(parent, depth, forkSeq);
	return meta;
}
function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
function openingFailure(error) {
	const message = errorText(error);
	return {
		code: message.includes("tool") || message.includes("factory") ? "compatibility" : "internal",
		message
	};
}
function contentText(content) {
	return content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
}
function truncate(text, limit) {
	return text.length <= limit ? text : text.slice(0, limit) + " …";
}
/** Compare two absolute working directories by their resolved real paths. */
function sameRealpath(left, right) {
	try {
		return realpathSync(left) === realpathSync(right);
	} catch {
		try {
			return resolve(left) === resolve(right);
		} catch {
			return left === right;
		}
	}
}
/** Find one logical-corpus record by session id (structural; inject-declared). */
function findSessionRecord(records, sessionId) {
	for (const record of records) {
		const candidate = record;
		if (candidate?.header?.id !== void 0 && String(candidate.header.id) === String(sessionId)) return candidate;
	}
}
/**
* Best available title for one parent session: the last non-empty
* `session/title` event, falling back to the cwd basename (audit U-J).
*/
function parentTitleOf(parent) {
	const events = parent.session.events;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event === void 0) continue;
		const candidate = event;
		if (candidate.type !== "session/title") continue;
		const title = candidate.data?.title;
		if (typeof title === "string" && title.trim() !== "") return title.trim();
	}
	const cwd = parent.session.header?.cwd;
	if (typeof cwd === "string" && cwd !== "") return cwd.split(/[\\/]/).filter((segment) => segment !== "").at(-1) ?? cwd;
}
/** Last non-empty user/assistant text in the child live events (list preview, audit U-J). */
function lastPreviewOf(entry) {
	const events = entry.handle?.agent.session.events ?? [];
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event === void 0) continue;
		if (event.type === "user/message") {
			if (event.data.source?.kind !== "user") continue;
			const text = contentText(event.data.content).trim();
			if (text !== "") return truncate(text, 160);
			continue;
		}
		if (event.type === "assistant/message") {
			const text = contentText(event.data.message.content).trim();
			if (text !== "") return truncate(text, 160);
		}
	}
}
/** The transcript image references for one message id (U-E display surface). */
function imageRefsOf(entry, messageId) {
	return entry.imageRefsByMessageId.get(messageId);
}
/** Project admitted refs onto the wire transcript shape (no `undefined` keys). */
function refsToImages(refs) {
	return refs.map((ref) => ({
		attachmentId: String(ref.attachmentId),
		mediaType: ref.mediaType,
		...ref.name === void 0 ? {} : { name: ref.name }
	}));
}
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
function buildProgressDigest(parent) {
	try {
		return progressDigestLines(parent);
	} catch {
		return `Main conversation progress snapshot (captured when this side chat opened; it may be stale):\n- Main agent status: ${parent.status === "running" ? "running" : "idle"}.`;
	}
}
function progressDigestLines(parent) {
	const events = parent.session.events;
	const lastTurnEnd = events.findLast((event) => event.type === "turn/end");
	const suffix = events.slice(lastTurnEnd === void 0 ? 0 : lastTurnEnd.seq + 1);
	let latestUser;
	const surface = parent.session.surface;
	if (surface !== void 0) for (const seq of [...surface.nodes].reverse()) {
		const event = events[seq];
		if (event === void 0 || event.type !== "user/message") continue;
		if (event.data.source.kind !== "user") continue;
		const text = contentText(event.data.content).trim();
		if (text !== "") latestUser = text;
		break;
	}
	if (latestUser === void 0) for (const event of suffix) {
		if (event.type !== "user/message" || event.data.source.kind !== "user") continue;
		const text = contentText(event.data.content).trim();
		if (text !== "") latestUser = text;
	}
	const toolCalls = [];
	for (const event of suffix) {
		if (event.type !== "tool/call") continue;
		let summary = "";
		try {
			const parsed = JSON.parse(event.data.arguments);
			summary = parsed === null || typeof parsed !== "object" ? truncate(String(parsed), 120) : truncate(Object.values(parsed).map((value) => String(value)).join(" ").trim(), 120);
		} catch {
			summary = truncate(event.data.arguments, 120);
		}
		toolCalls.push(summary === "" ? event.data.name : `${event.data.name}(${summary})`);
	}
	const chunkText = /* @__PURE__ */ new Map();
	const finalizedSteps = /* @__PURE__ */ new Set();
	for (const event of suffix) {
		if (event.type === "assistant/chunk") {
			const key = `${event.data.turn}:${event.data.step}`;
			if (event.data.chunk.type === "text-delta") chunkText.set(key, (chunkText.get(key) ?? "") + event.data.chunk.text);
			continue;
		}
		if (event.type === "assistant/message") finalizedSteps.add(`${event.data.turn}:${event.data.step}`);
	}
	const partial = [...chunkText.entries()].filter(([key]) => !finalizedSteps.has(key)).map(([, text]) => text).join("");
	const running = parent.status === "running";
	const lines = ["Main conversation progress snapshot (captured when this side chat opened; it may be stale):", `- Main agent status: ${running ? "running" : "idle"}.`];
	if (latestUser !== void 0) lines.push(`- Latest user instruction: ${truncate(latestUser, 400)}`);
	if (toolCalls.length > 0) lines.push(`- Tool calls in the in-progress turn (latest last): ${toolCalls.slice(-5).map((call) => truncate(call, 160)).join("; ")}`);
	if (partial.trim() !== "") lines.push(`- Latest assistant output fragment: ${truncate(partial.trim(), 400)}`);
	if (!running && toolCalls.length === 0 && partial.trim() === "") lines.push("- The main agent has finished its latest turn; no work is in progress.");
	return lines.join("\n");
}
/** Issue rows echoed back to the model; beyond this the count is summarized. */
const ASK_BACK_ISSUE_LIMIT = 5;
/**
* Correctable rejection text for `btw_ask_user` arguments that the outbound
* strict codec would refuse (D30). It names the offending paths and codes and
* the legal key set — including the snake_case `multi_select` spelling — but
* never echoes the submitted payload itself.
*/
function askBackArgumentMessage(error) {
	const rows = error.issues.slice(0, ASK_BACK_ISSUE_LIMIT).map((issue) => {
		return `- ${issue.path.length === 0 ? "(root)" : issue.path.map((segment) => String(segment)).join(".")}${"keys" in issue && Array.isArray(issue.keys) ? ` [${issue.keys.map((key) => String(key)).join(", ")}]` : ""}: ${issue.code} — ${issue.message}`;
	});
	const overflow = error.issues.length > ASK_BACK_ISSUE_LIMIT ? `\n… (${error.issues.length} total)` : "";
	return "btw_ask_user: these arguments do not match the btw question wire protocol, so the panel could not display them. Fix them and call again.\n" + rows.join("\n") + overflow + "\nAllowed keys — question: id, question, header, options, multi_select; option: label, description. The multi-select key is snake_case `multi_select` (not `multiSelect`); every `id`, `question`, and option `label` must be non-empty, and `questions` must not be empty.";
}
function transcript(entry, ctx) {
	const events = entry.handle?.agent.session.events.slice(entry.seedLength) ?? [];
	const messages = [];
	const messageIds = /* @__PURE__ */ new Set();
	const finalized = /* @__PURE__ */ new Set();
	const chunkText = /* @__PURE__ */ new Map();
	const chunkReasoning = /* @__PURE__ */ new Map();
	const toolOrder = [];
	const toolsByCallId = /* @__PURE__ */ new Map();
	const toolStepByCallId = /* @__PURE__ */ new Map();
	let pendingTools = [];
	let lastAssistant;
	let latestStep;
	let runningTool;
	let runningToolDigest;
	for (const event of events) {
		if (event.type === "user/message" && event.data.source.kind === "user") {
			const text = contentText(event.data.content);
			const id = String(event.data.id);
			const refs = imageRefsOf(entry, id);
			if (text !== "" || refs !== void 0) {
				messageIds.add(id);
				messages.push({
					id,
					role: "user",
					text,
					...refs === void 0 || refs.length === 0 ? {} : { images: refsToImages(refs) }
				});
			}
			continue;
		}
		if (event.type === "assistant/chunk") {
			const key = `${event.data.turn}:${event.data.step}`;
			if (event.data.chunk.type === "text-delta") chunkText.set(key, (chunkText.get(key) ?? "") + event.data.chunk.text);
			else if (event.data.chunk.type === "reasoning-delta") chunkReasoning.set(key, (chunkReasoning.get(key) ?? "") + event.data.chunk.text);
			continue;
		}
		if (event.type === "assistant/message") {
			const key = `${event.data.turn}:${event.data.step}`;
			finalized.add(key);
			const text = contentText(event.data.message.content);
			if (text !== "") {
				const carried = pendingTools.length > 0 ? pendingTools : void 0;
				pendingTools = [];
				const message = {
					id: String(event.data.message.id),
					role: "assistant",
					text,
					...carried === void 0 ? {} : { tools: carried }
				};
				messages.push(message);
				lastAssistant = {
					message,
					tools: message.tools ?? []
				};
			}
			continue;
		}
		if (event.type === "step/start") {
			latestStep = {
				turn: event.data.turn,
				step: event.data.step
			};
			continue;
		}
		if (event.type === "tool/call") {
			const digest = {
				callId: String(event.data.callId),
				name: event.data.name,
				args: event.data.arguments,
				running: true
			};
			toolOrder.push(digest.callId);
			toolsByCallId.set(digest.callId, digest);
			toolStepByCallId.set(digest.callId, {
				turn: event.data.turn,
				step: event.data.step
			});
			if (lastAssistant !== void 0) {
				lastAssistant.tools.push(digest);
				if (lastAssistant.message.tools === void 0) lastAssistant.message.tools = lastAssistant.tools;
			} else pendingTools.push(digest);
			continue;
		}
		if (event.type === "tool/result") {
			const block = event.data.message.content[0];
			const callId = String(block.toolCallId);
			const digest = toolsByCallId.get(callId);
			if (digest !== void 0) {
				digest.result = contentText(block.content);
				digest.isError = block.isError === true;
				delete digest.running;
			}
			continue;
		}
	}
	const partial = [...chunkText.entries()].filter(([key]) => !finalized.has(key)).map(([, text]) => text).join("");
	const reasoning = [...chunkReasoning.entries()].filter(([key]) => !finalized.has(key)).map(([, text]) => text).join("");
	for (const [requestId, pending] of entry.pendingByRequest) {
		const id = String(pending.message.id);
		if (messageIds.has(id)) {
			entry.pendingByRequest.delete(requestId);
			continue;
		}
		const text = contentText(pending.message.content);
		const refs = pending.images;
		if (text !== "" || refs !== void 0) messages.push({
			id,
			role: "user",
			text,
			...refs === void 0 || refs.length === 0 ? {} : { images: refsToImages(refs) }
		});
	}
	const queued = [...entry.pendingByRequest.values()].some((pending) => !pending.cancelled && !pending.delivered);
	const childRunning = entry.handle?.agent.status === "running";
	if (!childRunning) for (const callId of toolOrder) {
		const digest = toolsByCallId.get(callId);
		if (digest?.running === true) delete digest.running;
	}
	else for (let index = toolOrder.length - 1; index >= 0; index -= 1) {
		const digest = toolsByCallId.get(toolOrder[index]);
		if (digest?.running === true) {
			runningTool = digest.name;
			runningToolDigest = digest;
			break;
		}
	}
	const lastCall = toolOrder.length === 0 ? void 0 : toolStepByCallId.get(toolOrder[toolOrder.length - 1]);
	const currentAction = childRunning ? runningToolDigest !== void 0 ? {
		kind: "tool",
		tool: runningTool ?? runningToolDigest.name,
		turn: toolStepByCallId.get(runningToolDigest.callId)?.turn ?? latestStep?.turn ?? 0,
		step: toolStepByCallId.get(runningToolDigest.callId)?.step ?? latestStep?.step ?? 0
	} : {
		kind: "generating",
		turn: latestStep?.turn ?? lastCall?.turn ?? 0,
		step: latestStep?.step ?? lastCall?.step ?? 0
	} : void 0;
	const pendingQuestion = entry.pendingQuestion;
	return {
		chatToken: entry.chatToken,
		revision: events.at(-1)?.seq ?? entry.seedLength,
		messages,
		partial,
		reasoning,
		running: childRunning || queued,
		model: btwCurrentModel(ctx, entry),
		...currentAction === void 0 ? {} : { currentAction },
		...childRunning && runningTool !== void 0 ? { runningTool } : {},
		...pendingQuestion === void 0 ? {} : { pendingQuestion: {
			questionId: pendingQuestion.questionId,
			questions: pendingQuestion.questions
		} }
	};
}
var SideChatService = class extends TypertRemoteService {
	static inject = [
		"agents",
		"sessions",
		"attachments",
		"settings",
		"subagents",
		"sessionQuery"
	];
	byToken = /* @__PURE__ */ new Map();
	tokenByParent = /* @__PURE__ */ new Map();
	registry = new BtwRegistry();
	grillMeText;
	grillMeLoaded = false;
	constructor(ctx) {
		super(ctx, "sideChat");
		ctx.effect(() => () => this.disposeAll(), "btw: dispose live side conversations");
		ctx.on("agent/disposed", ({ agent }) => {
			const token = [...this.byToken.values()].find((entry) => String(entry.childSessionId) === String(agent.id))?.chatToken;
			if (token !== void 0) this.forget(token);
		});
	}
	async start(request) {
		const duplicate = this.byToken.get(request.chatToken);
		if (duplicate !== void 0 && !duplicate.closing) {
			if (duplicate.openingError !== void 0) return failure(duplicate.openingError.code, duplicate.openingError.message);
			if (duplicate.handle !== void 0 || duplicate.creation !== void 0) return this.startValue(duplicate);
			if (this.byToken.get(request.chatToken) === duplicate) return failure("already-open", "This side conversation is still opening.");
		}
		const existingToken = this.tokenByParent.get(request.parentSessionId);
		if (existingToken !== void 0 && existingToken !== request.chatToken) {
			const existing = this.byToken.get(existingToken);
			if (existing !== void 0 && !existing.closing) {
				if (existing.openingError === void 0 && (existing.handle !== void 0 || existing.creation !== void 0)) {
					this.adoptToken(existing, request.chatToken);
					return this.startValue(existing);
				}
				if (existing.openingError !== void 0) this.forget(existingToken);
			}
			if (this.tokenByParent.get(request.parentSessionId) === existingToken) this.tokenByParent.delete(request.parentSessionId);
		}
		const parentId = SessionId(request.parentSessionId);
		let parent = this.ctx.agents.get(parentId);
		if (parent === void 0) {
			const recovered = await this.recoverParent(parentId, new AbortController().signal);
			if (recovered === void 0) return failure("parent-not-found", "The parent conversation does not exist.");
			if ("error" in recovered) return failure("parent-not-found", recovered.error);
			parent = recovered.parent;
		}
		const seed = completedTurnSeed(parent.session.events);
		const indexed = await this.registry.get(request.parentSessionId);
		if (indexed !== void 0) {
			const resumed = await this.startResumed(request, parent, SessionId(indexed.childSessionId));
			if (resumed !== void 0) return resumed;
			await this.registry.remove(request.parentSessionId).catch(() => void 0);
		}
		const childId = SessionId(randomUUID());
		const entry = {
			chatToken: request.chatToken,
			parentSessionId: request.parentSessionId,
			childSessionId: childId,
			seedLength: seed.length,
			resumed: false,
			abort: new AbortController(),
			sentRequests: /* @__PURE__ */ new Map(),
			pendingByRequest: /* @__PURE__ */ new Map(),
			imageRefsByMessageId: /* @__PURE__ */ new Map(),
			pendingQuestion: void 0,
			closing: false
		};
		this.byToken.set(request.chatToken, entry);
		this.tokenByParent.set(request.parentSessionId, request.chatToken);
		try {
			const childDepth = resolveChildDepth(parent, void 0);
			const allowedTools = visibleReadTools(parent);
			const creation = parent.ctx.agents.create({
				sessionId: childId,
				seed,
				meta: hiddenSideChatMeta(parent, childDepth, seed.length),
				agentOptions: resolveChildAgentOptions(parent, {
					provider: BTW_PROVIDER,
					model: request.model ?? btwDefaultModel(this.ctx)
				}, childDepth),
				signal: entry.abort.signal,
				setup: (childCtx) => this.composeChild(childCtx, parent, allowedTools, entry)
			});
			entry.creation = creation;
			creation.then((handle) => {
				if (entry.closing || this.byToken.get(entry.chatToken) !== entry) return;
				entry.handle = handle;
				this.injectOpeningNotices(handle, parent);
				this.registry.set(request.parentSessionId, String(childId), this.indexExtras(parent, entry)).catch(() => void 0);
				this.deliverQueued(entry, handle);
			}).catch((error) => {
				if (!entry.closing && this.byToken.get(entry.chatToken) === entry) entry.openingError = openingFailure(error);
			});
			return this.startValue(entry);
		} catch (error) {
			this.forget(entry.chatToken);
			if (entry.abort.signal.aborted || entry.closing) return failure("cancelled", "Side Chat opening was cancelled.");
			const opening = openingFailure(error);
			return failure(opening.code, opening.message);
		}
	}
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
	async recoverParent(parentId, signal, seen = /* @__PURE__ */ new Set()) {
		const key = String(parentId);
		if (seen.has(key)) return { error: `the parent conversation chain is cyclic at "${key}"` };
		const live = this.ctx.agents.get(parentId);
		if (live !== void 0) return { parent: live };
		const record = await this.corpusRecord(parentId);
		if (record === void 0) {
			if (this.ctx.get("sessionQuery")?.listSessions === void 0) return { error: "the session corpus is unavailable; the parent conversation cannot be recovered" };
			return;
		}
		const header = record.header ?? {};
		if (header.origin === "subagent") {
			const directParentId = header.parentSession;
			if (typeof directParentId !== "string") return { error: `the subagent conversation "${key}" has no recoverable parent session` };
			const nextSeen = new Set(seen).add(key);
			const directParent = await this.recoverParent(SessionId(directParentId), signal, nextSeen);
			if (directParent === void 0) return void 0;
			if ("error" in directParent) return directParent;
			const subagents = this.ctx.get("subagents");
			if (subagents?.materializeContinuableChild === void 0) return { error: "subagent materialization is unavailable; the dsh-subagent materializeContinuableChild runtime patch is not applied" };
			try {
				return { parent: await subagents.materializeContinuableChild(directParent.parent, parentId, { signal }) };
			} catch (error) {
				return { error: `the parent conversation could not be recovered: ${errorText(error)}` };
			}
		}
		try {
			return { parent: (await this.ctx.agents.resume({
				resumeSessionId: parentId,
				signal
			})).agent };
		} catch (error) {
			return { error: `the parent conversation could not be recovered: ${errorText(error)}` };
		}
	}
	/** Find the logical-corpus record for one session id (existence + origin), when queryable. */
	async corpusRecord(parentId) {
		const query = this.ctx.get("sessionQuery");
		if (query?.listSessions === void 0) return void 0;
		try {
			return findSessionRecord(await query.listSessions(void 0), parentId);
		} catch {
			return;
		}
	}
	/**
	* Resume the indexed child session for this parent (U5). Returns the start
	* result on success, or `undefined` when the caller should fall back to a
	* fresh fork.
	*/
	async startResumed(request, parent, childId) {
		const entry = {
			chatToken: request.chatToken,
			parentSessionId: request.parentSessionId,
			childSessionId: childId,
			seedLength: 0,
			resumed: true,
			abort: new AbortController(),
			sentRequests: /* @__PURE__ */ new Map(),
			pendingByRequest: /* @__PURE__ */ new Map(),
			imageRefsByMessageId: /* @__PURE__ */ new Map(),
			pendingQuestion: void 0,
			closing: false
		};
		this.byToken.set(request.chatToken, entry);
		this.tokenByParent.set(request.parentSessionId, request.chatToken);
		try {
			const childDepth = resolveChildDepth(parent, void 0);
			const allowedTools = visibleReadTools(parent);
			const creation = parent.ctx.agents.resume({
				resumeSessionId: childId,
				agentOptions: resolveChildAgentOptions(parent, {
					provider: BTW_PROVIDER,
					model: request.model ?? btwDefaultModel(this.ctx)
				}, childDepth),
				signal: entry.abort.signal,
				setup: (childCtx) => this.composeChild(childCtx, parent, allowedTools, entry)
			});
			entry.creation = creation;
			const handle = await creation;
			if (entry.closing || this.byToken.get(entry.chatToken) !== entry) {
				await handle.dispose().catch(() => void 0);
				return failure("cancelled", "Side Chat opening was cancelled.");
			}
			entry.handle = handle;
			entry.seedLength = handle.agent.session.header.seedLength ?? 0;
			this.hydrateImageRefs(entry, handle.agent);
			handle.agent.inject(createUserMessage({
				content: [{
					type: "text",
					text: buildProgressDigest(parent)
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-btw",
					form: "notice",
					summary: DIGEST_SUMMARY
				}
			}));
			this.deliverQueued(entry, handle);
			this.registry.touch(request.parentSessionId, this.indexExtras(parent, entry)).catch(() => void 0);
			return this.startValue(entry);
		} catch {
			this.forget(entry.chatToken);
			if (entry.abort.signal.aborted || entry.closing) return failure("cancelled", "Side Chat opening was cancelled.");
			return;
		}
	}
	/** The four read-only layers plus the btw_ask_user channel (create and resume). */
	composeChild(childCtx, parent, allowedTools, entry) {
		const childAgent = childCtx.agent;
		appendDelegatedPolicyOverrides(childAgent.session, {
			sandboxMode: "read-only",
			approvalPolicy: "never"
		});
		applyChildComposition(childCtx, parent, {
			persona: this.persona(),
			toolFilter: { allow: allowedTools }
		});
		entry.modelSelection = this.installBtwModelSelection(childCtx, childAgent);
		childCtx.tools.guard((execution) => isSideChatToolAllowed(execution.name) ? void 0 : READ_ONLY_DENIAL);
		this.registerAskBackTool(childCtx, entry);
	}
	/**
	* Couple this child's mutable model choice to its request routing.
	* `current` resolves a `setModel` pick first, then the persisted header
	* (resume), then the default; `agent/request` applies it on the next turn.
	*/
	installBtwModelSelection(childCtx, childAgent) {
		let picked;
		const ctx = this.ctx;
		const selection = {
			get current() {
				if (picked !== void 0) return picked;
				const logged = childAgent.session.requestHeader()?.config;
				if (logged === void 0) return {
					provider: BTW_PROVIDER,
					model: btwDefaultModel(ctx)
				};
				return {
					provider: logged.provider,
					model: sanitizeBtwModel(logged.model, btwRoutableModels(ctx))
				};
			},
			set current(next) {
				picked = next;
			},
			assembled: void 0
		};
		installModelSelection(childCtx, selection);
		return selection;
	}
	registerAskBackTool(childCtx, entry) {
		childCtx.tools.register(defineTool({
			name: "btw_ask_user",
			description: "Ask the user a concise question inside the side panel when you need confirmation, a choice, or missing information before answering. Send one or more questions, each with a stable id that will be echoed in the answer. The tool blocks until the user answers.",
			parameters: { questions: {
				type: "array",
				required: true,
				description: "Questions to ask the user before continuing.",
				items: {
					type: "object",
					additionalProperties: true,
					properties: {
						id: {
							type: "string",
							required: true,
							description: "Stable id for this question; echoed in the answer."
						},
						question: {
							type: "string",
							required: true,
							description: "The specific question to ask the user."
						},
						header: {
							type: "string",
							description: "Optional short heading for the question."
						},
						options: {
							type: "array",
							description: "Optional choices to show the user. If you recommend one, put it first and append \"(Recommended)\".",
							items: {
								type: "object",
								additionalProperties: true,
								properties: {
									label: {
										type: "string",
										required: true,
										description: "Short user-facing option label."
									},
									description: {
										type: "string",
										description: "One sentence explaining the tradeoff or impact."
									}
								}
							}
						},
						multi_select: {
							type: "boolean",
							description: "Whether the user may select more than one option. Defaults to false."
						}
					}
				}
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { answers: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: {
									type: "string",
									required: true
								},
								selected: {
									type: "array",
									required: true,
									items: { type: "string" }
								},
								custom: { type: "string" }
							}
						}
					} }
				},
				render: (_args, value) => [{
					type: "text",
					text: JSON.stringify(value)
				}]
			},
			async execute(args, exec) {
				const questions = args.questions;
				if (entry.pendingQuestion !== void 0) throw new Error("btw_ask_user: another question is already waiting for the user in this panel. Wait for its answer before asking again.");
				const questionId = randomUUID();
				const checked = btwPendingQuestionSchema.safeParse({
					questionId,
					questions
				});
				if (!checked.success) throw new Error(askBackArgumentMessage(checked.error));
				return await new Promise((resolve, reject) => {
					const settle = () => {
						if (entry.pendingQuestion?.questionId === questionId) entry.pendingQuestion = void 0;
						exec.signal.removeEventListener("abort", onAbort);
					};
					const onAbort = () => {
						if (entry.pendingQuestion?.questionId !== questionId) return;
						settle();
						reject(/* @__PURE__ */ new Error("btw_ask_user: the question was cancelled before the user answered."));
					};
					exec.signal.addEventListener("abort", onAbort, { once: true });
					entry.pendingQuestion = {
						questionId,
						questions: checked.data.questions,
						resolve: (answers) => {
							settle();
							resolve({ answers: answers.map((answer) => answer.custom === void 0 ? {
								id: answer.id,
								selected: [...answer.selected]
							} : {
								id: answer.id,
								selected: [...answer.selected],
								custom: answer.custom
							}) });
						},
						reject: (reason) => {
							settle();
							reject(reason);
						}
					};
				});
			}
		}));
	}
	injectOpeningNotices(handle, parent) {
		handle.agent.inject(createUserMessage({
			content: [{
				type: "text",
				text: SIDE_CHAT_BOUNDARY
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-btw",
				form: "notice",
				summary: "Side conversation boundary"
			}
		}));
		handle.agent.inject(createUserMessage({
			content: [{
				type: "text",
				text: buildProgressDigest(parent)
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-btw",
				form: "notice",
				summary: DIGEST_SUMMARY
			}
		}));
	}
	deliverQueued(entry, handle) {
		for (const pending of entry.pendingByRequest.values()) {
			if (pending.cancelled || pending.delivered) continue;
			pending.delivered = true;
			handle.agent.followup(pending.message);
		}
	}
	/** Persona text with the grill-me interview skill inlined when available (U8). */
	persona() {
		if (!this.grillMeLoaded) {
			this.grillMeLoaded = true;
			this.grillMeText = this.loadGrillMeText();
		}
		if (this.grillMeText === void 0) return SIDE_CHAT_PERSONA;
		return `${SIDE_CHAT_PERSONA}\n\nWhen the user asks you to "grill me" (relentlessly interview them to sharpen a plan or design), run that interview with btw_ask_user, one numbered round of frontier questions at a time, each with your recommended answer, following this skill text:\n\n<grill-me>\n${this.grillMeText}\n</grill-me>`;
	}
	loadGrillMeText() {
		try {
			const path = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "skills", "grill-me", "SKILL.md");
			const text = readFileSync(path, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
			return text === "" ? void 0 : text;
		} catch {
			return;
		}
	}
	read(request) {
		const entry = this.byToken.get(request.chatToken);
		if (entry === void 0 || entry.closing) return {
			ok: false,
			error: {
				code: "not-open",
				message: "This side conversation is no longer open."
			}
		};
		if (entry.openingError !== void 0) return {
			ok: false,
			error: entry.openingError
		};
		return {
			ok: true,
			value: transcript(entry, this.ctx)
		};
	}
	async send(request) {
		const entry = this.byToken.get(request.chatToken);
		if (entry === void 0 || entry.closing) return {
			ok: false,
			error: {
				code: "not-open",
				message: "This side conversation is no longer open."
			}
		};
		if (entry.openingError !== void 0) return {
			ok: false,
			error: entry.openingError
		};
		const existing = entry.sentRequests.get(request.requestId);
		if (existing !== void 0) return {
			ok: true,
			value: {
				chatToken: request.chatToken,
				requestId: request.requestId,
				accepted: true,
				messageId: existing
			}
		};
		const text = request.text.trim();
		const images = request.images ?? [];
		if (text.length === 0 && images.length === 0) return {
			ok: false,
			error: {
				code: "invalid-input",
				message: "A side conversation question cannot be empty."
			}
		};
		let effectiveText = text;
		let imageRefs = [];
		let directContent;
		if (images.length > 0) {
			const attachments = this.ctx.get("attachments");
			if (attachments === void 0) return {
				ok: false,
				error: {
					code: "internal",
					message: "The attachments service is unavailable; images cannot be admitted."
				}
			};
			try {
				const { admitEncodedImages } = await import("@deepseek-ai/dsh-attachment");
				imageRefs = await admitEncodedImages(attachments, images.map(({ mediaType, data, name }) => ({
					mediaType,
					data,
					...name === void 0 ? {} : { name }
				})));
			} catch (error) {
				return {
					ok: false,
					error: {
						code: "invalid-input",
						message: errorText(error)
					}
				};
			}
			const route = entry.modelSelection?.current;
			if (route !== void 0 && await modelAcceptsImage(this.ctx, route)) directContent = [...text.length > 0 ? [{
				type: "text",
				text
			}] : [], ...imageRefs.map((ref) => ({
				type: "image",
				attachment: ref
			}))];
			else {
				if (readBtwSettings(this.ctx).vision?.autoTransform === false) return {
					ok: false,
					error: {
						code: "invalid-input",
						message: "当前模型不支持图片，且 dsh-btw.vision.autoTransform 已关闭（不自动转文本）。请开启该开关或改用支持图片的模型。"
					}
				};
				try {
					const inputs = await Promise.all(imageRefs.map(async (ref) => {
						const stored = await attachments.readImage(ref, entry.abort.signal);
						return {
							mediaType: ref.mediaType,
							data: Buffer.from(stored.data).toString("base64")
						};
					}));
					effectiveText = wrapImageDescriptions(await analyzeImages(this.ctx, inputs, entry.abort.signal), text);
				} catch (error) {
					return {
						ok: false,
						error: {
							code: "internal",
							message: `vision-adam 分析失败: ${errorText(error)}`
						}
					};
				}
			}
		}
		const message = createUserMessage({
			content: directContent ?? [{
				type: "text",
				text: effectiveText
			}],
			source: { kind: "user" }
		});
		entry.sentRequests.set(request.requestId, String(message.id));
		if (imageRefs.length > 0) entry.imageRefsByMessageId.set(String(message.id), imageRefs);
		const pending = {
			requestId: request.requestId,
			message,
			...imageRefs.length === 0 ? {} : { images: imageRefs },
			delivered: entry.handle !== void 0,
			cancelled: false
		};
		entry.pendingByRequest.set(request.requestId, pending);
		entry.handle?.agent.followup(message);
		this.touchIndex(entry);
		return {
			ok: true,
			value: {
				chatToken: request.chatToken,
				requestId: request.requestId,
				accepted: true,
				messageId: String(message.id)
			}
		};
	}
	/** Deliver the user's answers to a pending btw_ask_user call (U7). */
	async answer(request) {
		const entry = this.byToken.get(request.chatToken);
		if (entry === void 0 || entry.closing) return {
			ok: false,
			error: {
				code: "not-open",
				message: "This side conversation is no longer open."
			}
		};
		const pending = entry.pendingQuestion;
		if (pending === void 0 || pending.questionId !== request.questionId) return {
			ok: false,
			error: {
				code: "invalid-input",
				message: "No pending question matches this question id."
			}
		};
		pending.resolve(request.answers);
		return {
			ok: true,
			value: {
				chatToken: request.chatToken,
				questionId: request.questionId,
				accepted: true
			}
		};
	}
	async cancel(request) {
		const entry = this.byToken.get(request.chatToken);
		if (entry === void 0 || entry.closing) return {
			ok: false,
			error: {
				code: "not-open",
				message: "This side conversation is no longer open."
			}
		};
		if (entry.handle === void 0) for (const pending of entry.pendingByRequest.values()) pending.cancelled = true;
		else entry.handle.agent.cancel({ kind: "user" });
		return {
			ok: true,
			value: {
				chatToken: request.chatToken,
				accepted: true
			}
		};
	}
	async close(request) {
		const entry = this.byToken.get(request.chatToken);
		if (entry === void 0) return {
			ok: true,
			value: {
				chatToken: request.chatToken,
				closed: true,
				cleanup: "absent"
			}
		};
		entry.closing = true;
		entry.pendingQuestion?.reject(/* @__PURE__ */ new Error("btw: the side conversation was closed."));
		entry.pendingQuestion = void 0;
		entry.abort.abort();
		this.forget(entry.chatToken);
		try {
			const handle = entry.handle ?? await entry.creation?.catch(() => void 0);
			if (handle !== void 0) await handle.dispose();
			return {
				ok: true,
				value: {
					chatToken: request.chatToken,
					closed: true,
					cleanup: "kept"
				}
			};
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "internal",
					message: errorText(error)
				}
			};
		}
	}
	/** Switch the side conversation's model for subsequent turns (takes effect on the next step). */
	async setModel(request) {
		const entry = this.byToken.get(request.chatToken);
		if (entry === void 0 || entry.closing) return {
			ok: false,
			error: {
				code: "not-open",
				message: "This side conversation is no longer open."
			}
		};
		if (entry.openingError !== void 0) return {
			ok: false,
			error: entry.openingError
		};
		if (entry.modelSelection === void 0) return {
			ok: false,
			error: {
				code: "not-open",
				message: "This side conversation is still opening."
			}
		};
		entry.modelSelection.current = {
			provider: BTW_PROVIDER,
			model: sanitizeBtwModel(request.model, btwRoutableModels(this.ctx))
		};
		return {
			ok: true,
			value: {
				chatToken: request.chatToken,
				accepted: true
			}
		};
	}
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
	hydrateImageRefs(entry, agent) {
		const events = agent.session.events.slice(entry.seedLength);
		for (const event of events) {
			if (event.type !== "user/message") continue;
			const content = event.data.content;
			if (!Array.isArray(content)) continue;
			const refs = [];
			for (const part of content) {
				if (part === null || typeof part !== "object") continue;
				const candidate = part;
				if (candidate.type !== "image") continue;
				const attachment = candidate.attachment;
				if (attachment !== void 0 && typeof attachment.attachmentId === "string") refs.push(attachment);
			}
			if (refs.length > 0) entry.imageRefsByMessageId.set(String(event.data.id), refs);
		}
	}
	/**
	* U-F: read the verified bytes behind one admitted image back to the client
	* for display (R1-10 thumbnails). The child session log only carries text,
	* so `sessions.readAttachment` cannot serve these refs — they live in
	* `imageRefsByMessageId` on the live entry (restored on resume by
	* {@link hydrateImageRefs}).
	*/
	async readSideChatImage(request) {
		const entry = this.byToken.get(request.chatToken);
		if (entry === void 0 || entry.closing) return {
			ok: false,
			error: {
				code: "not-open",
				message: "This side conversation is no longer open."
			}
		};
		if (entry.openingError !== void 0) return {
			ok: false,
			error: entry.openingError
		};
		let ref;
		for (const refs of entry.imageRefsByMessageId.values()) {
			const match = refs.find((candidate) => String(candidate.attachmentId) === request.attachmentId);
			if (match !== void 0) {
				ref = match;
				break;
			}
		}
		if (ref === void 0) return {
			ok: false,
			error: {
				code: "invalid-input",
				message: "Unknown attachment id for this side conversation."
			}
		};
		const attachments = this.ctx.get("attachments");
		if (attachments === void 0) return {
			ok: false,
			error: {
				code: "internal",
				message: "The attachments service is unavailable."
			}
		};
		try {
			const stored = await attachments.readImage(ref, entry.abort.signal);
			return {
				ok: true,
				value: {
					mediaType: ref.mediaType,
					data: Buffer.from(stored.data).toString("base64")
				}
			};
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "internal",
					message: errorText(error)
				}
			};
		}
	}
	/**
	* U-J: enumerate every side conversation under one session tree — the root
	* itself plus all session-backed subagents below it (`subagents.listDescendants`),
	* joined with the durable btw index and, when live, fresh session metadata.
	*/
	async listTree(request) {
		const memberIds = /* @__PURE__ */ new Set([request.parentSessionId]);
		const subagents = this.ctx.get("subagents");
		if (subagents?.listDescendants !== void 0) try {
			const rows = await subagents.listDescendants(request.parentSessionId, void 0);
			for (const row of rows) {
				const candidate = row;
				if (candidate.kind !== "child" || typeof candidate.id !== "string") continue;
				memberIds.add(candidate.id);
			}
		} catch {}
		return {
			ok: true,
			value: { entries: await this.listEntries([...memberIds], void 0) }
		};
	}
	/**
	* U-J: enumerate every side conversation whose parent session lives in the
	* same working directory (project group) — `sessionQuery.listSessions`
	* filtered by resolved realpath, joined with the durable btw index.
	*/
	async listProject(request) {
		const rootCwd = this.ctx.agents.get(SessionId(request.parentSessionId))?.session.header?.cwd;
		if (rootCwd === void 0) return {
			ok: true,
			value: { entries: [] }
		};
		const sessionIds = [];
		const query = this.ctx.get("sessionQuery");
		if (query?.listSessions !== void 0) try {
			const records = await query.listSessions(void 0);
			for (const record of records) {
				const candidate = record;
				const cwd = candidate.header?.cwd;
				if (typeof cwd !== "string" || !sameRealpath(cwd, rootCwd)) continue;
				const id = candidate.header?.id;
				if (typeof id === "string") sessionIds.push(id);
			}
		} catch {}
		return {
			ok: true,
			value: { entries: await this.listEntries(sessionIds, rootCwd) }
		};
	}
	startValue(entry) {
		return {
			ok: true,
			value: {
				parentSessionId: entry.parentSessionId,
				childSessionId: String(entry.childSessionId),
				chatToken: entry.chatToken,
				seedLength: entry.seedLength,
				resumed: entry.resumed,
				model: btwCurrentModel(this.ctx, entry)
			}
		};
	}
	adoptToken(entry, chatToken) {
		if (entry.chatToken === chatToken) return;
		this.byToken.delete(entry.chatToken);
		entry.chatToken = chatToken;
		this.byToken.set(chatToken, entry);
		this.tokenByParent.set(entry.parentSessionId, chatToken);
	}
	/** Fresh index v2 fields for one parent/child pair (audit U-J). */
	indexExtras(parent, entry) {
		const extras = {};
		const title = parentTitleOf(parent);
		if (title !== void 0) extras.parentTitle = title;
		const cwd = parent.session.header?.cwd;
		if (cwd !== void 0) extras.parentCwd = cwd;
		const preview = lastPreviewOf(entry);
		if (preview !== void 0) extras.lastPreview = preview;
		return extras;
	}
	/** Fire-and-forget index freshness refresh after side-chat activity (send). */
	touchIndex(entry) {
		const parent = this.ctx.agents.get(SessionId(entry.parentSessionId));
		const extras = {};
		if (parent !== void 0) {
			const title = parentTitleOf(parent);
			if (title !== void 0) extras.parentTitle = title;
			const cwd = parent.session.header?.cwd;
			if (cwd !== void 0) extras.parentCwd = cwd;
		}
		const preview = lastPreviewOf(entry);
		if (preview !== void 0) extras.lastPreview = preview;
		this.registry.touch(entry.parentSessionId, extras).catch(() => void 0);
	}
	/** Join candidate parent ids with the durable index; live metadata wins. */
	async listEntries(parentIds, cwdFilter) {
		const index = await this.registry.load();
		const entries = [];
		for (const parentId of parentIds) {
			const record = index.entries[parentId];
			if (record === void 0) continue;
			const live = this.ctx.agents.get(SessionId(parentId));
			const cwd = live?.session.header?.cwd ?? record.parentCwd;
			if (cwdFilter !== void 0 && (cwd === void 0 || !sameRealpath(cwd, cwdFilter))) continue;
			entries.push({
				parentSessionId: parentId,
				childSessionId: record.childSessionId,
				lastActiveAt: record.lastActiveAt,
				...record.parentTitle !== void 0 ? { title: record.parentTitle } : {},
				...cwd !== void 0 ? { cwd } : {},
				...record.lastPreview !== void 0 ? { preview: record.lastPreview } : {},
				...live?.status === "running" ? { running: true } : {}
			});
		}
		entries.sort((left, right) => right.lastActiveAt - left.lastActiveAt);
		return entries;
	}
	forget(chatToken) {
		const entry = this.byToken.get(chatToken);
		if (entry === void 0) return;
		this.byToken.delete(chatToken);
		if (this.tokenByParent.get(entry.parentSessionId) === chatToken) this.tokenByParent.delete(entry.parentSessionId);
	}
	async disposeAll() {
		const entries = [...this.byToken.values()];
		this.byToken.clear();
		this.tokenByParent.clear();
		await Promise.allSettled(entries.map(async (entry) => {
			entry.closing = true;
			entry.pendingQuestion?.reject(/* @__PURE__ */ new Error("btw: the host is shutting down."));
			entry.pendingQuestion = void 0;
			entry.abort.abort();
			await (entry.handle ?? await entry.creation?.catch(() => void 0))?.dispose();
		}));
	}
};
//#endregion
//#region src/host/prompt-transform.ts
/**
* Default decision: resolve the agent's route (logged request header, then
* the agent-default selection) and ask the LLM registry for its DECLARED
* input modalities. Unknown/absent declarations are false — the caller then
* keeps the vision-adam text path.
*/
function defaultPromptImageDecision(ctx, agent) {
	const route = resolveAgentRoute(ctx, agent);
	if (route === void 0) return Promise.resolve(false);
	return modelAcceptsImage(ctx, route);
}
/** Keep only wire parts whose media type the attachment/vision chain accepts. */
function toVisionInputs(parts) {
	const inputs = [];
	for (const part of parts) {
		if (typeof part.mediaType !== "string" || typeof part.data !== "string") continue;
		const mediaType = sideChatImageMediaTypeSchema.safeParse(part.mediaType);
		if (!mediaType.success) continue;
		inputs.push({
			mediaType: mediaType.data,
			data: part.data
		});
	}
	return inputs;
}
/**
* Build the waterfall handler. The analyzer and the direct-pass decision are
* injectable for tests; the defaults run the vision-adam fan-out from
* `vision.ts` and the declared-modality check.
*/
function createPromptImageTransformHandler(ctx, analyze = analyzeImages, passDirect = defaultPromptImageDecision) {
	return async (payload, next) => {
		const resolved = await next();
		const effective = resolved === void 0 ? payload.content : resolved;
		const imageParts = effective.filter((part) => part.type === "image");
		if (imageParts.length === 0) return void 0;
		const inputs = toVisionInputs(imageParts);
		if (inputs.length === 0) return void 0;
		if (await passDirect(ctx, payload.agent)) return void 0;
		const originalText = effective.filter((part) => part.type === "text").map((part) => typeof part.text === "string" ? part.text : "").join("\n");
		return [{
			type: "text",
			text: wrapImageDescriptions(await analyze(ctx, inputs), originalText)
		}];
	};
}
/** Register the transform on the plugin context; `ctx.on` scopes it to the fiber. */
function registerPromptImageTransform(ctx) {
	ctx.on("session/prompt-image-transform", createPromptImageTransformHandler(ctx));
}
//#endregion
//#region src/index.ts
const name = "dsh-btw";
/** Settings namespace brand for the `dsh-btw` section. */
const BTW_SETTINGS_NS = settingsNamespace("dsh-btw");
/**
* `dsh-btw` settings namespace (P0-b settings 行为开关试点). Values hot-reload:
* editing `~/.dsh/settings.yaml` `dsh-btw:` section republishes and the host
* re-reads on the next call while the client re-renders via settingsScope —
* no restart. Keys are pure behavior switches; defaults equal the pre-P0-b
* behavior (absent section = defaults = 现状). Schema grows only-additively.
*/
const BTW_SETTINGS_SCHEMA = z.object({
	ui: z.object({
		banner: z.boolean().default(true),
		modelSelect: z.boolean().default(true),
		imageBadge: z.boolean().default(true)
	}).default({
		banner: true,
		modelSelect: true,
		imageBadge: true
	}),
	vision: z.object({ autoTransform: z.boolean().default(true) }).default({ autoTransform: true }),
	model: z.object({
		default: z.string().default("deepseek-v4.1-flash"),
		options: z.array(z.string()).default([
			"deepseek-v4.1-flash",
			"glm-5.3",
			"deepseek-v4-pro"
		])
	}).default({
		default: "deepseek-v4.1-flash",
		options: [
			"deepseek-v4.1-flash",
			"glm-5.3",
			"deepseek-v4-pro"
		]
	})
}).default({
	ui: {
		banner: true,
		modelSelect: true,
		imageBadge: true
	},
	vision: { autoTransform: true },
	model: {
		default: "deepseek-v4.1-flash",
		options: [
			"deepseek-v4.1-flash",
			"glm-5.3",
			"deepseek-v4-pro"
		]
	}
});
function apply(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.register(BTW_SETTINGS_NS, BTW_SETTINGS_SCHEMA);
	});
	ctx.plugin(SideChatService);
	registerPromptImageTransform(ctx);
}
//#endregion
export { BTW_SETTINGS_NS, BTW_SETTINGS_SCHEMA, BtwRegistry, READ_ONLY_TOOL_CANDIDATES, READ_ONLY_TOOL_SET, SideChatService, apply, btwHome, btwIndexPath, buildProgressDigest, completedTurnSeed, isSideChatToolAllowed, name };
