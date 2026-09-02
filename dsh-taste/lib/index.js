import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import z from "@deepseek-ai/schemastery";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { loadConfig, saveConfig } from "./config.js";
import { collectTurnTexts, isLearnableUserEvent } from "./collector.js";
import {
	clipText,
	ensureProjectTasteDir,
	listTasteFiles,
	loadCommandCodeTaste,
	loadTasteSnapshot,
	normalizePreferenceKey,
	parseTasteFile,
	projectRootFor,
	readTasteFile,
	redactSensitive,
	renderTasteFile,
	withTasteLock,
	writeFileAtomicTaste,
} from "./storage.js";
import { buildLearnerInput, runLearner } from "./learner.js";
import { createJobQueue } from "./queue.js";
import { registerTasteBridge } from "./bridge.js";
import { registerTasteCommands } from "./commands.js";
//#region lib/index.js
/**
 * dsh-taste: DSH-native local preference learning (proposal v2).
 *
 * Wiring ("插件四件套"): a runtime-context injection that projects the merged
 * taste snapshot into every eligible conversation, a turn-stopping hook that
 * feeds a bounded single-concurrency queue, and the `/taste` command family.
 * The learner itself runs as a one-shot `agents.create` child (lib/learner.js)
 * writing through the locked taste-file tools (lib/learner-tools.js).
 *
 * Injection channel (audit R9): the snapshot rides
 * `systemPrompt.context()` — the loop's RuntimeContextProjection appends a
 * user message only when the rendered text changes, so a stable snapshot is
 * never re-injected and compaction clears stale copies. Context text is
 * evaluated synchronously by dsh-system-prompt's `interpolate()`, so the
 * snapshot is assembled with sync fs and every `{{` is sanitized before
 * rendering.
 * @module dsh-taste
 */

const name = "taste";
// `connection` (design §2.4): the host-half of the Web GUI's read-only RPC
// channel lives on the connection service (ctx.connection.rpc.handle).
const inject = ["agents", "commands", "systemPrompt", "connection"];

/** Declarative config surface (proposal §8 defaults); runtime values hot-read `config.json`. */
const Config = z.object({
	learningEnabled: z.boolean().default(true),
	injection: z
		.object({
			enabled: z.boolean().default(true),
			maxChars: z.number().default(16000),
			includeSubagents: z.boolean().default(false),
		})
		.default({}),
	observer: z
		.object({
			modelMode: z.string().default("inherit"),
			provider: z.string().default(""),
			model: z.string().default(""),
			maxInputChars: z.number().default(16000),
			timeoutMs: z.number().default(120000),
			maxTurns: z.number().default(20),
		})
		.default({}),
	storage: z.object({ categoriesEnabled: z.boolean().default(true) }).default({}),
});

/** Turn-text budgets fed to the collector (proposal §6). */
const TURN_USER_MAX_CHARS = 8_000;
const TURN_ASSISTANT_MAX_CHARS = 12_000;

/** Previously-analyzed window bounds for the learner input (proposal §4). */
const PRIOR_WINDOW_LIMIT = 20;
const PRIOR_ENTRY_MAX_CHARS = 4_000;

/** Mirrors config.js' private filename; keep in sync. */
const CONFIG_FILENAME = "config.json";

/** Mirrors storage.js' private category predicate; keep in sync. */
function isSafeCategorySegmentSync(value) {
	if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u.test(value) || value.endsWith(".")) return false;
	return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value);
}

/** Flatten any thrown value into one message line. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Subagent triple test (proposal §1): subagent origin, a parent session, or a
 * positive runtime delegation depth.
 * @param {object} agent - agent candidate.
 * @returns {boolean} whether the agent was delegated.
 */
function isSubagent(agent) {
	const header = agent?.session?.header;
	if (!header) return false;
	if (header.origin === "subagent" || header.parentSession !== undefined) return true;
	// Authoritative semantics is dsh-subagent's delegationDepthOf: max(header.delegationDepth,
	// options.subagentDepth) — a cold-resumed child carries only the header field.
	return Math.max(agent?.options?.subagentDepth ?? 0, header.delegationDepth ?? 0) > 0;
}

/** Escape interpolate's `{{` variable syntax (R9): contexts render verbatim. */
function sanitizePromptText(text) {
	return String(text ?? "").replaceAll("{{", "{ {");
}

/**
 * One project taste scope directory for a session cwd, memoized per cwd:
 * `<git-root|cwd>/.dsh/taste` (storage.projectRootFor mirrors pi-taste's
 * walk-up). An empty-string cache entry means "no cwd".
 */
function createProjectDirResolver() {
	const cache = new Map();
	return (cwd) => {
		if (typeof cwd !== "string" || cwd.length === 0) return undefined;
		if (cache.has(cwd)) return cache.get(cwd) || undefined;
		let dir = join(projectRootFor(cwd), ".dsh", "taste");
		if (cache.size > 64) cache.clear();
		cache.set(cwd, dir);
		return dir;
	};
}

/** Whitelisted taste files of one scope directory, synchronously. */
function listTasteFilesSync(dir) {
	const files = [];
	if (typeof dir !== "string" || !dir || !existsSync(dir)) return files;
	if (existsSync(join(dir, "taste.md"))) files.push("taste.md");
	let names = [];
	try {
		names = readdirSync(dir);
	} catch {
		return files;
	}
	names.sort((a, b) => a.localeCompare(b));
	for (const segment of names) {
		if (!isSafeCategorySegmentSync(segment)) continue;
		if (existsSync(join(dir, segment, "taste.md"))) files.push(`${segment}/taste.md`);
	}
	return files;
}

/** Command Code compatibility store bases for the two scopes (read-only). */
function commandCodeBases(globalDir, projectDir) {
	const bases = [join(resolve(globalDir, "..", ".."), ".commandcode", "taste")];
	if (projectDir) bases.push(join(resolve(projectDir, "..", ".."), ".commandcode", "taste"));
	return bases;
}

/** Read-only Command Code store files: root plus plain-name one-level dirs. */
function commandCodeFilePathsSync(base) {
	const paths = [];
	if (existsSync(join(base, "taste.md"))) paths.push(join(base, "taste.md"));
	let names = [];
	try {
		names = readdirSync(base);
	} catch {
		return paths;
	}
	names.sort((a, b) => a.localeCompare(b));
	for (const segment of names) {
		if (!/^[A-Za-z0-9_.-]{1,64}$/.test(segment) || segment.startsWith("--")) continue;
		const candidate = join(base, segment, "taste.md");
		if (existsSync(candidate)) paths.push(candidate);
	}
	return paths;
}

/** Every file the injected snapshot depends on, in dedupe order. */
function snapshotDependencyPaths(globalDir, projectDir) {
	const paths = [];
	for (const dir of [projectDir, globalDir]) {
		if (!dir) continue;
		for (const relPath of listTasteFilesSync(dir)) paths.push(join(dir, relPath));
	}
	for (const base of commandCodeBases(globalDir, projectDir)) {
		paths.push(...commandCodeFilePathsSync(base));
	}
	return paths;
}

/** mtime+size fingerprint of the snapshot's file set. */
function snapshotStamp(paths) {
	const parts = [];
	for (const path of paths) {
		try {
			const stats = statSync(path);
			parts.push(`${path}:${stats.mtimeMs}:${stats.size}`);
		} catch {
			parts.push(`${path}:missing`);
		}
	}
	return parts.join("|");
}

/** Merge one scope's parsed entries into the snapshot accumulator. */
function accumulateScope(merged, seen, dir) {
	for (const relPath of listTasteFilesSync(dir)) {
		let entries;
		try {
			entries = parseTasteFile(readFileSync(join(dir, relPath), "utf8"));
		} catch {
			continue; // A snapshot stays best-effort when one file vanishes mid-read.
		}
		for (const entry of entries) {
			const key = normalizePreferenceKey(entry.statement);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			merged.push(entry);
		}
	}
}

/** Sync equivalent of storage.loadTasteSnapshot: project, global, then Command Code stores. */
function readSnapshotSync(globalDir, projectDir) {
	const merged = [];
	const seen = new Set();
	accumulateScope(merged, seen, projectDir);
	accumulateScope(merged, seen, globalDir);
	for (const base of commandCodeBases(globalDir, projectDir)) {
		for (const path of commandCodeFilePathsSync(base)) {
			let entries;
			try {
				entries = parseTasteFile(readFileSync(path, "utf8"));
			} catch {
				continue;
			}
			for (const entry of entries) {
				const key = normalizePreferenceKey(entry.statement);
				if (!key || seen.has(key)) continue;
				seen.add(key);
				merged.push(entry);
			}
		}
	}
	return renderTasteFile(merged);
}

/**
 * Snapshot reader with an mtime-gated cache: the file set (and each file's
 * mtime+size) is re-stamped on every call — a few stats — and the text is
 * re-read only when something changed. Bounded per project scope.
 */
function createSnapshotReader(globalDir) {
	const cache = new Map();
	return (projectDir) => {
		const key = projectDir ?? "";
		const stamp = snapshotStamp(snapshotDependencyPaths(globalDir, projectDir));
		const cached = cache.get(key);
		if (cached && cached.stamp === stamp) return cached.text;
		const text = readSnapshotSync(globalDir, projectDir);
		if (cache.size > 32) cache.clear();
		cache.set(key, { stamp, text });
		return text;
	};
}

/** pi-taste `buildTree`, one level deep: the whitelist allows no deeper nesting. */
function renderScopeTree(dir, files) {
	const lines = [];
	for (let index = 0; index < files.length; index += 1) {
		const relPath = files[index];
		const connector = index === files.length - 1 ? "└── " : "├── ";
		let suffix = "";
		try {
			suffix = ` (${parseTasteFile(readFileSync(join(dir, relPath), "utf8")).length} learnings)`;
		} catch {
			suffix = "";
		}
		lines.push(`${connector}${relPath}${suffix}`);
	}
	return lines.join("\n");
}

/** Learner "Current taste structure" block across both scopes. */
function renderTasteTree(globalDir, globalFiles, projectDir, projectFiles) {
	const sections = [];
	if (projectDir) sections.push(`project (${projectDir}):\n${renderScopeTree(projectDir, projectFiles) || "(empty)"}`);
	sections.push(`global (${globalDir}):\n${renderScopeTree(globalDir, globalFiles) || "(empty)"}`);
	return sections.join("\n\n");
}

/** Join a message content array's non-blank text blocks. */
function joinVisibleText(content) {
	const parts = [];
	if (!Array.isArray(content)) return parts.join("\n");
	for (const block of content) {
		if (block?.type !== "text" || typeof block.text !== "string" || !block.text.trim()) continue;
		parts.push(block.text);
	}
	return parts.join("\n");
}

/**
 * The learner's "previously analyzed" window: visible user/assistant texts
 * strictly before the current turn's boundary, most recent `limit` entries,
 * each redacted and clipped.
 */
function collectPriorWindow(events, turn) {
	if (!Array.isArray(events) || typeof turn !== "number" || !Number.isFinite(turn)) return [];
	let boundary = -1;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index]?.type === "turn/start" && events[index].data?.turn === turn) {
			boundary = index;
			break;
		}
	}
	const history = boundary < 0 ? events : events.slice(0, boundary);
	const entries = [];
	for (const event of history) {
		if (isLearnableUserEvent(event)) {
			const text = joinVisibleText(event.data?.content);
			if (text) entries.push({ role: "user", content: [{ type: "text", text: clipText(redactSensitive(text), PRIOR_ENTRY_MAX_CHARS) }] });
		} else if (event?.type === "assistant/message") {
			const data = event.data;
			const text = joinVisibleText(Array.isArray(data?.message?.content) ? data.message.content : data?.content);
			if (text) entries.push({ role: "assistant", content: [{ type: "text", text: clipText(redactSensitive(text), PRIOR_ENTRY_MAX_CHARS) }] });
		}
	}
	return entries.slice(-PRIOR_WINDOW_LIMIT);
}

/**
 * Plugin entry point.
 * @param {object} ctx - plugin context (agents/commands/systemPrompt injected).
 * @param {object} config - declarative config validated by {@link Config}.
 */
function apply(ctx, config) {
	const globalDir = dshHomePath("taste");
	const projectDirForCwd = createProjectDirResolver();
	const logWarn = (message) => {
		try {
			ctx.logger?.warn?.(message);
		} catch {
			// Logging must never throw into a guard or a serial listener.
		}
	};

	// Runtime configuration: `config.json` on disk is authoritative and is
	// hot-read (async) for every learner job; the synchronous guard paths
	// (injection fn, turn-stopping hook) read a cache that refreshes when the
	// file's mtime stamp changes and is seeded with the declarative config.
	// R3: the plugin teardown signal is the deterministic cancellation channel
	// for in-flight learners — aborted on unload before the drain effect runs.
	const teardown = new AbortController();
	const configState = { stamp: null, value: config };
	const configStampSync = () => {
		try {
			const stats = statSync(join(globalDir, CONFIG_FILENAME));
			return `${stats.mtimeMs}:${stats.size}`;
		} catch {
			return "missing";
		}
	};
	const refreshConfig = async () => {
		try {
			// Without a config.json the declarative (host-provided) config stays in force.
			if (!existsSync(join(globalDir, CONFIG_FILENAME))) return;
			configState.value = await loadConfig(globalDir);
		} catch (error) {
			logWarn(`taste: config refresh failed: ${describeError(error)}`);
		}
	};
	const currentConfig = () => {
		const stamp = configStampSync();
		if (stamp !== configState.stamp) {
			configState.stamp = stamp;
			void refreshConfig();
		}
		return configState.value;
	};
	const saveConfigTracked = async (dir, next) => {
		await saveConfig(dir, next);
		configState.value = next;
		configState.stamp = configStampSync();
	};

	/**
	 * Session ids of learners currently running (R5). Recursion-protection
	 * deviation note: pi-taste's `meta.origin: "taste-learner"` primary marker
	 * is unrepresentable in DSH — dsh-session's header validator rejects every
	 * origin except "subagent" (see lib/learner.js) — so `isSubagent` (the
	 * learner session carries origin "subagent" + parentSession) plus this
	 * in-flight set are the authoritative learner-recursion guards. There is
	 * deliberately no origin-based special case in the guards below.
	 */
	const inFlightLearners = new Set();
	const readSnapshot = createSnapshotReader(globalDir);

	// Runtime-context injection (R9). The text fn is synchronous by contract:
	// dsh-system-prompt interpolates context text inline, so the snapshot is
	// served from the mtime-gated sync cache below.
	const injectTasteContext = ({ agent } = {}) => {
		try {
			if (!agent?.session) return "";
			const active = currentConfig();
			if (!active.learningEnabled || !active.injection.enabled) return "";
			// R5 recursion protection (see the inFlightLearners note above): the
			// learner session is origin "subagent" + parentSession, so isSubagent
			// and the in-flight check below are the authoritative guards.
			if (isSubagent(agent) && !active.injection.includeSubagents) return "";
			if (inFlightLearners.has(agent.session.id)) return "";
			const snapshot = readSnapshot(projectDirForCwd(agent.session.header?.cwd));
			if (!snapshot) return "";
			const maxChars = Number(active.injection.maxChars);
			const bounded = Number.isFinite(maxChars) && maxChars > 0 ? clipText(snapshot, maxChars) : snapshot;
			return `<taste>\n${sanitizePromptText(bounded)}\n</taste>`;
		} catch (error) {
			logWarn(`taste: injection skipped: ${describeError(error)}`);
			return "";
		}
	};
	ctx.systemPrompt.context({ name: "taste", order: 40, text: injectTasteContext });

	/** One queued job's work: build the learner input and run the learner. */
	const runTasteJob = async (job, sessionId) => {
		if (teardown.signal.aborted) return; // R3: unload cancels pending learning.
		if (queue.stats().cooldownUntil > Date.now()) return; // Breaker check at run time (§3).
		const active = await loadConfig(globalDir); // Hot-read on every job.
		if (!active.learningEnabled) return;
		const projectDir = projectDirForCwd(job.cwd);
		if (projectDir) void ensureProjectTasteDir(projectDir).catch(() => {}); // §5: gitignored project scope.
		const [globalFiles, projectFiles] = await Promise.all([
			listTasteFiles(globalDir),
			projectDir ? listTasteFiles(projectDir) : Promise.resolve([]),
		]);
		const newMessages = [
			job.userText ? { role: "user", content: [{ type: "text", text: job.userText }] } : null,
			job.assistantText ? { role: "assistant", content: [{ type: "text", text: job.assistantText }] } : null,
		].filter(Boolean);
		const input = buildLearnerInput({
			tasteTree: renderTasteTree(globalDir, globalFiles, projectDir, projectFiles),
			newMessages,
			priorWindow: job.priorWindow,
		});
		await runLearner({
			agents: ctx.agents,
			parentAgent: job.agent,
			input,
			config: active,
			resolveGlobalDir: () => globalDir,
			resolveProjectDir: () => {
				if (!projectDir) throw new Error("no project taste scope (session has no working directory)");
				return projectDir;
			},
			signal: teardown.signal,
			sessionId,
		});
	};

	/** Queue wrapper marking the learner in flight (R5: before create → after dispose). */
	const executeJob = async (job) => {
		const sessionId = randomUUID();
		inFlightLearners.add(sessionId);
		try {
			await runTasteJob(job, sessionId);
		} finally {
			inFlightLearners.delete(sessionId);
		}
	};

	const queue = createJobQueue({ cap: 3, runJob: executeJob, log: logWarn });

	// Learning hook. R1: the whole handler — payload destructure included — is
	// try/catch: this runs as a serial listener on the user's turn, and a throw
	// (even from a malformed null dispatch) would fail the turn.
	ctx.on("agent/turn-stopping", (payload) => {
		try {
			const { agent, turn } = payload ?? {};
			if (!agent?.session) return;
			if (!currentConfig().learningEnabled) return;
			// R5 recursion protection (see the inFlightLearners note above): the
			// learner session is origin "subagent" + parentSession, so isSubagent
			// and the in-flight check below are the authoritative guards.
			if (isSubagent(agent)) return;
			if (inFlightLearners.has(agent.session.id)) return;
			const { userText, assistantText } = collectTurnTexts(agent.session.events, turn, {
				userMaxChars: TURN_USER_MAX_CHARS,
				assistantMaxChars: TURN_ASSISTANT_MAX_CHARS,
				redactFn: redactSensitive,
			});
			if (!userText) return;
			queue.push({
				agent,
				userText,
				assistantText,
				priorWindow: collectPriorWindow(agent.session.events, turn),
				cwd: agent.session.header?.cwd,
			});
		} catch (error) {
			logWarn(`taste: turn-stopping handler failed: ${describeError(error)}`);
		}
	});

	registerTasteCommands(ctx, {
		loadConfig,
		saveConfig: saveConfigTracked,
		globalDir: () => globalDir,
		projectDir: (cwd) => projectDirForCwd(cwd),
		loadTasteSnapshot,
		storageFns: { parseTasteFile, renderTasteFile, readTasteFile, listTasteFiles, withTasteLock, writeFileAtomicTaste, normalizePreferenceKey },
		queue,
		logger: ctx.logger,
	});

	// Web GUI bridge (design §2): read-only `/taste` RPC channel on the
	// connection service, scoped to this plugin's lifetime via ctx.effect.
	registerTasteBridge(ctx, {
		queue,
		globalDir: () => globalDir,
		projectDirForCwd,
		loadConfig,
		listTasteFiles,
		readTasteFile,
		parseTasteFile,
		loadCommandCodeTaste,
	});

	// Shutdown (R3): registered before the teardown-signal effect so disposal
	// (reverse order) aborts the signal FIRST — cancelling any in-flight
	// learner deterministically — and then triggers the drain. The drain is
	// fire-and-forget: unloading must not block on learner turns, and drain()
	// bounds its own wait at 30s and never rejects.
	ctx.effect(
		() => () => {
			queue.drain().catch((error) => logWarn(`taste: shutdown drain failed: ${describeError(error)}`));
		},
		"taste.shutdownDrain()",
	);
	ctx.effect(() => () => teardown.abort(new Error("taste plugin unloaded")), "taste.teardownSignal()");
}

export { Config, apply, inject, name };
//#endregion
