import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseBackfillArg } from "./backfill.js";
//#region lib/commands.js
/**
 * The `/taste` command family (proposal §7, audit R7; backfill-design §2):
 * nine subcommands — status, on, off, list, remember, forget, paths, model,
 * backfill — dispatched on the first word of `invocation.rawInput`. Every
 * handler is async, resolves to a `{ kind, text }`
 * command result, and catches its own failures: a command never throws into
 * the conversation (a thrown handler renders as a command error anyway, but
 * the result shape stays ours).
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
		`学习：${config.learningEnabled ? "开启" : "关闭"}`,
		`注入：${config.injection.enabled ? "开启" : "关闭"}（≤${config.injection.maxChars} 字符，子代理：${config.injection.includeSubagents ? "包含" : "排除"}）`,
		`队列：${stats.pending} 待处理，${stats.running ? "运行中" : "空闲"}，${stats.failCount} 次连续失败`,
		`熔断：${stats.cooldownUntil > Date.now() ? `冷却中（约 ${cooldownMinutes} 分钟后恢复）` : "已就绪（无冷却）"}`,
		`偏好：${total} 条`,
		`模型路由：${config.observer.modelMode}`,
	];
	// Backfill progress while a waterfall runs (§5.3); the line doubles as the
	// user-visible half of the re-entry gate (§6). "backfill:" 前缀为协议词，与
	// 命令错误文案保持一致。
	const progress = deps.backfillProgress?.();
	if (progress?.active) lines.push(`backfill: ${progress.done}/${progress.total} 块`);
	return { kind: "success", text: lines.join("\n") };
}

/** `/taste on|off`: flip `learningEnabled` in config.json. */
async function setLearning(deps, enabled) {
	const dir = deps.globalDir();
	const config = await deps.loadConfig(dir);
	if (config.learningEnabled === enabled) {
		return { kind: "success", text: `偏好学习已经是${enabled ? "开启" : "关闭"}状态。` };
	}
	config.learningEnabled = enabled;
	await deps.saveConfig(dir, config);
	return { kind: "success", text: enabled ? "已开启偏好学习。" : "已关闭偏好学习。" };
}

/** `/taste list [n]`: numbered statements with confidence. */
async function listPreferences(deps, invocation, argument) {
	const entries = await enumerateEntries(deps, invocation);
	if (entries.length === 0) return { kind: "success", text: "还没有任何偏好记录。" };
	const limit = /^\d+$/.test(argument) ? Math.min(entries.length, Math.max(1, Number.parseInt(argument, 10))) : LIST_DEFAULT_LIMIT;
	const lines = entries.slice(0, limit).map(
		(entry, index) => `${index + 1}. [${entry.dir === deps.globalDir() ? "global" : "project"}] ${entry.statement}（Confidence: ${entry.confidence.toFixed(2)}）`,
	);
	if (entries.length > limit) lines.push(`… 还有 ${entries.length - limit} 条（用法：/taste list <n>）`);
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
	if (!statement) return { kind: "error", text: "用法：/taste remember <偏好文本>" };
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
		? { kind: "success", text: `已记录（全局，Confidence: 1.00）：${statement}` }
		: { kind: "success", text: "已存在相同偏好，未做更改。" };
}

/**
 * `/taste forget <n|keyword>`: remove the numbered entry from `/taste list`,
 * or every entry whose statement contains the keyword (case-insensitive).
 * Removal rewrites each affected file once, under its lock.
 */
async function forgetPreferences(deps, invocation, argument) {
	const keyword = argument.trim();
	if (!keyword) return { kind: "error", text: "用法：/taste forget <编号|关键词>" };
	const entries = await enumerateEntries(deps, invocation);
	if (entries.length === 0) return { kind: "success", text: "还没有任何偏好记录。" };
	const numeric = /^\d+$/.test(keyword) ? Number.parseInt(keyword, 10) : undefined;
	const matches =
		numeric !== undefined
			? entries.filter((_, index) => index + 1 === numeric)
			: entries.filter((entry) => entry.statement.toLowerCase().includes(keyword.toLowerCase()));
	if (matches.length === 0) {
		return { kind: "error", text: `没有匹配 ${JSON.stringify(keyword)} 的偏好；可用 /taste list 查看编号。` };
	}
	// Shared deletion core (gui-mutation-design §2): the GUI's deleteEntry and
	// this command call ONE implementation — locked RMW per file, emptied files
	// HARD-depend on the injected helper (no degraded prune-less path left).
	const { normalizePreferenceKey, deleteTasteEntries } = deps.storageFns;
	const targets = matches.map((match) => ({
		scopeDir: match.dir,
		relPath: match.relPath,
		keys: [normalizePreferenceKey(match.statement)],
	}));
	const removed = await deps.storageFns.deleteTasteEntries(targets, (message) => deps.logger?.warn?.(message));
	return { kind: "success", text: `已移除 ${removed} 条偏好。` };
}

/** `/taste paths`: scope directories plus residual `*.lock` hints. */
async function showPaths(deps, invocation) {
	const globalDir = deps.globalDir();
	const projectDir = deps.projectDir(invocation?.agent?.session?.header?.cwd);
	const lines = [`global: ${globalDir}`, `project: ${projectDir ?? "（不在仓库内——仅全局 scope）"}`];
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
			? "locks: 无"
			: `locks: ${locks.length} 个残留锁文件——确认没有偏好写入进程后可安全删除：\n  ${locks.join("\n  ")}`,
	);
	return { kind: "success", text: lines.join("\n") };
}

/** `/taste model`: the learner's model route plus observer budgets, read from the live config. */
async function showModel(deps) {
	const config = await deps.loadConfig(deps.globalDir());
	const observer = config.observer ?? {};
	const route =
		observer.modelMode === "custom"
			? `custom（provider ${observer.provider || "（未设置）"}，model ${observer.model || "（未设置）"}）`
			: "inherit（跟随主模型）";
	const lines = [`learner 模型路由：${route}`, `observer 预算：timeoutMs ${observer.timeoutMs}，maxTurns ${observer.maxTurns}`];
	return { kind: "success", text: lines.join("\n") };
}

const USAGE = "用法：/taste <status|on|off|list|remember|forget|paths|model|backfill>";

/**
 * `/taste backfill [n]` (backfill-design §2): re-learn the last n completed
 * historical turns (default: all) in serial background blocks. Pre-checks run
 * in the design's order — argument, learning switch, breaker cooldown,
 * re-entry gate (§6 blocker #2) — then the enqueue returns immediately; the
 * learner runs behind the command and results land in taste.md (check
 * `/taste list` or the file afterwards).
 */
async function backfillCommand(deps, invocation, argument) {
	const parsed = parseBackfillArg(argument);
	if (!parsed.ok) return { kind: "error", text: `用法：/taste backfill [n]。${parsed.reason}` };
	const config = await deps.loadConfig(deps.globalDir());
	if (!config.learningEnabled) return { kind: "error", text: "backfill: 学习已关闭（/taste on 开启）。" };
	if (deps.queue.stats().cooldownUntil > Date.now()) return { kind: "error", text: "backfill: learner 熔断冷却中，请稍后再试。" };
	const progress = deps.backfillProgress?.();
	if (progress?.active) return { kind: "error", text: `backfill: 已在运行中（${progress.done}/${progress.total} 块），请稍候。` };
	if (typeof deps.enqueueBackfill !== "function") return { kind: "error", text: "backfill: 不可用（enqueueBackfill 未注入）。" };
	const result = await deps.enqueueBackfill({ agent: invocation?.agent, events: invocation?.agent?.session?.events, n: parsed.n });
	if (!result || result.blocks === 0) return { kind: "error", text: "backfill: 没有可补学的历史轮。" };
	return { kind: "success", text: `已排入 ${result.blocks} 块（${result.turns} 轮），learner 后台串行补学；结果见 /taste list 或 taste.md。` };
}


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
			case "backfill": return await backfillCommand(deps, invocation, argument);

			default: return { kind: "error", text: `未知子命令 ${JSON.stringify(verb)}。${USAGE}` };
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
 * @param {{stats(): object}} deps.queue - the job queue (status reads its state).
 * @param {({agent?: object, events?: Array, n?: number}) => Promise<{blocks: number, turns: number}|null>} deps.enqueueBackfill - slice the session's completed history into backfill blocks and start the background waterfall (§1/§2); resolves to the enqueued block/turn counts, or null when nothing is learnable.
 * @param {() => {active: boolean, total: number, done: number}} deps.backfillProgress - backfill progress accessor; `active` is the command re-entry gate (§5.3/§6) and `/taste status` renders it while active.
 * @param {object} [deps.logger] - diagnostic sink.
 */
export function registerTasteCommands(ctx, deps) {
	ctx.commands.register({
		name: "taste",
		description: "本地偏好学习：从对话中沉淀并注入你的持久偏好",
		input: { hint: "<status|on|off|list|remember|forget|paths|model|backfill>" },
		recordInput: false,
		handler: (invocation) => handleInvocation(invocation, deps),
	});
}
//#endregion
