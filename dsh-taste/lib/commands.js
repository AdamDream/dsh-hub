import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
//#region lib/commands.js
/**
 * The `/taste` command family (proposal §7, audit R7): eight subcommands —
 * status, on, off, list, remember, forget, paths, model — dispatched on the
 * first word of `invocation.rawInput`. Every handler is async, resolves to a
 * `{ kind, text }` command result, and catches its own failures: a command
 * never throws into the conversation (a thrown handler renders as a command
 * error anyway, but the result shape stays ours).
 * @module lib/commands
 */

/** Default page size for `list` when no count is given. */
const LIST_DEFAULT_LIMIT = 20;

/** Flatten any thrown value into one message line. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/** One writable taste scope: project first (wins on dedupe), then global. */
function writableScopes(deps, invocation) {
	const projectDir = deps.projectDir(invocation?.agent?.session?.header?.cwd);
	return [{ name: "project", dir: projectDir }, { name: "global", dir: deps.globalDir() }].filter(
		(scope) => typeof scope.dir === "string" && scope.dir.length > 0,
	);
}

/**
 * Enumerate the preferences of the writable scopes in display order:
 * project scope files first, then global, each file's entries in file order.
 * `list` numbers and `forget` targets share this enumeration.
 * @param {object} deps - command dependencies.
 * @param {object} invocation - command invocation (for the session cwd).
 * @returns {Promise<Array<{statement: string, confidence: number, dir: string, relPath: string}>>} entries.
 */
async function enumerateEntries(deps, invocation) {
	const { listTasteFiles, readTasteFile, parseTasteFile } = deps.storageFns;
	const entries = [];
	for (const scope of writableScopes(deps, invocation)) {
		for (const relPath of await listTasteFiles(scope.dir)) {
			let content;
			try {
				content = await readTasteFile(scope.dir, relPath);
			} catch {
				continue;
			}
			for (const entry of parseTasteFile(content)) {
				entries.push({ ...entry, dir: scope.dir, relPath });
			}
		}
	}
	return entries;
}

/** `/taste status`: switches, queue, breaker, preference count, model route. */
async function showStatus(deps, invocation) {
	const globalDir = deps.globalDir();
	const config = await deps.loadConfig(globalDir);
	const stats = deps.queue.stats();
	const projectDir = deps.projectDir(invocation?.agent?.session?.header?.cwd);
	const snapshot = await deps.loadTasteSnapshot(globalDir, projectDir);
	const total = deps.storageFns.parseTasteFile(snapshot).length;
	const cooldownMinutes = Math.max(0, Math.ceil((stats.cooldownUntil - Date.now()) / 60_000));
	const lines = [
		`learning: ${config.learningEnabled ? "on" : "off"}`,
		`injection: ${config.injection.enabled ? "on" : "off"} (max ${config.injection.maxChars} chars, subagents ${config.injection.includeSubagents ? "included" : "excluded"})`,
		`queue: ${stats.pending} pending, ${stats.running ? "running" : "idle"}, ${stats.failCount} consecutive failure(s)`,
		`breaker: ${stats.cooldownUntil > Date.now() ? `cooling down for ~${cooldownMinutes} more minute(s)` : "armed (no cooldown)"}`,
		`preferences: ${total}`,
		`model route: ${config.observer.modelMode}`,
	];
	return { kind: "success", text: lines.join("\n") };
}

/** `/taste on|off`: flip `learningEnabled` in config.json. */
async function setLearning(deps, enabled) {
	const dir = deps.globalDir();
	const config = await deps.loadConfig(dir);
	if (config.learningEnabled === enabled) {
		return { kind: "success", text: `taste learning is already ${enabled ? "on" : "off"}.` };
	}
	config.learningEnabled = enabled;
	await deps.saveConfig(dir, config);
	return { kind: "success", text: `taste learning ${enabled ? "enabled" : "disabled"}.` };
}

/** `/taste list [n]`: numbered statements with confidence. */
async function listPreferences(deps, invocation, argument) {
	const entries = await enumerateEntries(deps, invocation);
	if (entries.length === 0) return { kind: "success", text: "No preferences recorded yet." };
	const limit = /^\d+$/.test(argument) ? Math.min(entries.length, Math.max(1, Number.parseInt(argument, 10))) : LIST_DEFAULT_LIMIT;
	const lines = entries.slice(0, limit).map(
		(entry, index) => `${index + 1}. [${entry.dir === deps.globalDir() ? "global" : "project"}] ${entry.statement} (Confidence: ${entry.confidence.toFixed(1)})`,
	);
	if (entries.length > limit) lines.push(`… ${entries.length - limit} more (usage: /taste list <n>)`);
	return { kind: "success", text: lines.join("\n") };
}

/**
 * `/taste remember <text>` (R7): record one preference verbatim at
 * confidence 1.0 in the global root file — an explicit user action with zero
 * LLM cost, written read-merge-write under the taste lock.
 */
async function rememberPreference(deps, argument) {
	const { parseTasteFile, renderTasteFile, readTasteFile, withTasteLock, writeFileAtomicTaste, normalizePreferenceKey } = deps.storageFns;
	const statement = argument.trim();
	if (!statement) return { kind: "error", text: "Usage: /taste remember <preference text>" };
	const dir = deps.globalDir();
	const absolute = join(dir, "taste.md");
	await mkdir(dir, { recursive: true, mode: 0o700 });
	let recorded = false;
	await withTasteLock(absolute, async () => {
		let current = "";
		try {
			current = await readTasteFile(dir, "taste.md");
		} catch {
			current = "";
		}
		const entries = parseTasteFile(current);
		const key = normalizePreferenceKey(statement);
		if (key && entries.some((entry) => normalizePreferenceKey(entry.statement) === key)) return;
		entries.push({ statement, confidence: 1 });
		await writeFileAtomicTaste(absolute, renderTasteFile(entries));
		recorded = true;
	});
	return recorded
		? { kind: "success", text: `Recorded (global, Confidence: 1.0): ${statement}` }
		: { kind: "success", text: "Already recorded — no change." };
}

/**
 * `/taste forget <n|keyword>`: remove the numbered entry from `/taste list`,
 * or every entry whose statement contains the keyword (case-insensitive).
 * Removal rewrites each affected file once, under its lock.
 */
async function forgetPreferences(deps, invocation, argument) {
	const keyword = argument.trim();
	if (!keyword) return { kind: "error", text: "Usage: /taste forget <number|keyword>" };
	const entries = await enumerateEntries(deps, invocation);
	if (entries.length === 0) return { kind: "success", text: "No preferences recorded yet." };
	const numeric = /^\d+$/.test(keyword) ? Number.parseInt(keyword, 10) : undefined;
	const matches =
		numeric !== undefined
			? entries.filter((_, index) => index + 1 === numeric)
			: entries.filter((entry) => entry.statement.toLowerCase().includes(keyword.toLowerCase()));
	if (matches.length === 0) {
		return { kind: "error", text: `No preference matches ${JSON.stringify(keyword)}; use /taste list to see numbers.` };
	}
	const { parseTasteFile, renderTasteFile, readTasteFile, withTasteLock, writeFileAtomicTaste, normalizePreferenceKey } = deps.storageFns;
	const byFile = new Map();
	for (const match of matches) {
		const fileKey = `${match.dir}\u0000${match.relPath}`;
		if (!byFile.has(fileKey)) byFile.set(fileKey, { dir: match.dir, relPath: match.relPath, keys: new Set() });
		byFile.get(fileKey).keys.add(normalizePreferenceKey(match.statement));
	}
	let removed = 0;
	for (const file of byFile.values()) {
		const absolute = join(file.dir, file.relPath);
		await withTasteLock(absolute, async () => {
			let content;
			try {
				content = await readTasteFile(file.dir, file.relPath);
			} catch {
				return;
			}
			const before = parseTasteFile(content);
			const remaining = before.filter((entry) => !file.keys.has(normalizePreferenceKey(entry.statement)));
			if (remaining.length === before.length) return;
			await writeFileAtomicTaste(absolute, renderTasteFile(remaining));
			removed += before.length - remaining.length;
		});
	}
	return { kind: "success", text: `Removed ${removed} preference(s).` };
}

/** `/taste paths`: scope directories plus residual `*.lock` hints. */
async function showPaths(deps, invocation) {
	const globalDir = deps.globalDir();
	const projectDir = deps.projectDir(invocation?.agent?.session?.header?.cwd);
	const lines = [`global: ${globalDir}`, `project: ${projectDir ?? "(not inside a repository — global scope only)"}`];
	const locks = [];
	for (const dir of [projectDir, globalDir]) {
		if (!dir) continue;
		try {
			for (const name of (await readdir(dir)).filter((name) => name.endsWith(".lock")).sort()) {
				locks.push(join(dir, name));
			}
		} catch {
			// A missing scope directory has no locks to report.
		}
	}
	lines.push(
		locks.length === 0
			? "locks: none"
			: `locks: ${locks.length} residual lock file(s) — safe to delete when no taste writer is active:\n  ${locks.join("\n  ")}`,
	);
	return { kind: "success", text: lines.join("\n") };
}

/** `/taste model`: the learner's model route plus observer budgets, read from the live config. */
async function showModel(deps) {
	const config = await deps.loadConfig(deps.globalDir());
	const observer = config.observer ?? {};
	const route =
		observer.modelMode === "custom"
			? `custom (provider ${observer.provider || "(unset)"}, model ${observer.model || "(unset)"})`
			: "inherit (follows main model)";
	const lines = [`learner model route: ${route}`, `observer: timeoutMs ${observer.timeoutMs}, maxTurns ${observer.maxTurns}`];
	return { kind: "success", text: lines.join("\n") };
}

const USAGE = "Usage: /taste <status|on|off|list|remember|forget|paths|model>";

/**
 * Dispatch one invocation on the first input word; a bare `/taste` shows
 * status. Every failure — thrown or returned — becomes an error result.
 * @param {object} invocation - command invocation (`rawInput`, `agent`).
 * @param {object} deps - command dependencies.
 * @returns {Promise<{kind: string, text: string}>} command result.
 */
async function handleInvocation(invocation, deps) {
	try {
		const words = typeof invocation?.rawInput === "string" ? invocation.rawInput.trim().split(/\s+/).filter(Boolean) : [];
		const verb = (words[0] ?? "status").toLowerCase();
		const argument = words.slice(1).join(" ").trim();
		switch (verb) {
			case "status": return await showStatus(deps, invocation);
			case "on": return await setLearning(deps, true);
			case "off": return await setLearning(deps, false);
			case "list": return await listPreferences(deps, invocation, argument);
			case "remember": return await rememberPreference(deps, argument);
			case "forget": return await forgetPreferences(deps, invocation, argument);
			case "paths": return await showPaths(deps, invocation);
			case "model": return await showModel(deps);
			default: return { kind: "error", text: `Unknown subcommand ${JSON.stringify(verb)}. ${USAGE}` };
		}
	} catch (error) {
		deps.logger?.warn?.(`taste: command failed: ${describeError(error)}`);
		return { kind: "error", text: `taste: ${describeError(error)}` };
	}
}

/**
 * Register the global `/taste` command.
 * @param {object} ctx - plugin context with the commands service injected.
 * @param {object} deps - command dependencies.
 * @param {(dir: string) => Promise<object>} deps.loadConfig - read config.json.
 * @param {(dir: string, config: object) => Promise<void>} deps.saveConfig - persist config.json.
 * @param {() => string} deps.globalDir - absolute global taste directory.
 * @param {(cwd: string) => (string|undefined)} deps.projectDir - project taste directory for a session cwd.
 * @param {(globalDir: string, projectDir?: string) => Promise<string>} deps.loadTasteSnapshot - merged injectable snapshot.
 * @param {object} deps.storageFns - storage helpers (parseTasteFile, renderTasteFile, readTasteFile, listTasteFiles, withTasteLock, writeFileAtomicTaste, normalizePreferenceKey).
 * @param {{stats(): object}} deps.queue - the job queue (status reads its state).
 * @param {object} [deps.logger] - diagnostic sink.
 */
export function registerTasteCommands(ctx, deps) {
	ctx.commands.register({
		name: "taste",
		description: "local preference learning",
		input: { hint: "<status|on|off|list|remember|forget|paths|model>" },
		recordInput: false,
		handler: (invocation) => handleInvocation(invocation, deps),
	});
}
//#endregion
