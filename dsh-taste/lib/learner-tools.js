import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
	isValidTasteFilePath,
	normalizePreferenceKey,
	parseTasteFile,
	renderTasteFile,
	resolveTastePath,
	withTasteLock,
	writeFileAtomicTaste,
} from "./storage.js";
//#region lib/learner-tools.js
/**
 * The three taste-file tools the learner agent uses to record preferences.
 * Every tool resolves its scope directory lazily at execution time, validates
 * the model-supplied relative path against the storage whitelist, and reports
 * failures as `error: ...` text so the learner can read and self-correct
 * instead of aborting its turn.
 * @module dsh-taste/learner-tools
 */
const SCOPE_VALUES = ["global", "project"];
const PATH_RULES = "偏好文件路径必须是 taste.md 或 {category}/taste.md";
const UNPARSABLE_HINT =
	"错误：内容不含有效偏好条目（- 中文陈述 Confidence: 0.88）；请先用 read_taste_file 重读，再用 edit_taste_file 修改，不要覆盖";

/** Flatten any thrown value into one message line. */
function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve a scope plus relative path into an absolute file path, or return an
 * `error:` string. The whitelist check runs first for a friendly message;
 * `resolveTastePath` remains the authoritative gate against traversal.
 */
function resolveTarget(deps, scope, relPath) {
	let scopeDir;
	try {
		scopeDir = scope === "project" ? deps.resolveProjectDir() : deps.resolveGlobalDir();
	} catch (error) {
		return `错误：无法解析${scope}偏好目录：${errorText(error)}`;
	}
	if (!isValidTasteFilePath(relPath)) return `错误：偏好文件路径必须是 taste.md 或 {category}/taste.md`;
	try {
		return { absolute: resolveTastePath(scopeDir, relPath), scopeDir };
	} catch (error) {
		return `错误：${errorText(error)}`;
	}
}

/**
 * Union of the incoming entries plus every current entry the incoming content
 * does not state, keyed by {@link normalizePreferenceKey}. Order: incoming
 * first, then the surviving current entries in file order.
 */
function mergeTasteEntries(current, incoming) {
	const stated = new Set(incoming.map((entry) => normalizePreferenceKey(entry.statement)));
	const merged = [...incoming];
	for (const entry of current) {
		const key = normalizePreferenceKey(entry.statement);
		if (!stated.has(key)) {
			merged.push(entry);
			stated.add(key);
		}
	}
	return merged;
}

/** `read_taste_file`: return the file content, or an explicit miss/error text. */
async function executeRead(deps, args) {
	const target = resolveTarget(deps, args.scope, args.path);
	if (typeof target === "string") return target;
	try {
		return await readFile(target.absolute, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return "（文件不存在）";
		return `错误：${errorText(error)}`;
	}
}

/**
 * `write_taste_file`: read-merge-write inside the taste lock. The submitted
 * content is a target snapshot, never a blind overwrite — entries the file
 * already holds and the content does not state survive, so writes that raced
 * across LLM turns cannot lose each other.
 */
async function executeWrite(deps, args) {
	const target = resolveTarget(deps, args.scope, args.path);
	if (typeof target === "string") return target;
	const { absolute, scopeDir } = target;
	try {
		// The lock sibling is created inside the target directory, which may be
		// brand new, so the directory must exist before the lock is acquired.
		await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
		let result = `已写入 ${args.path}`;
		await withTasteLock(absolute, async () => {
			let current = "";
			try {
				current = await readFile(absolute, "utf8");
			} catch {
				current = "";
			}
			const currentEntries = parseTasteFile(current);
			if (currentEntries.length === 0) {
				// Empty (or entry-less) file: write the submitted content verbatim.
				await writeFileAtomicTaste(absolute, args.content);
				return;
			}
			const incomingEntries = parseTasteFile(args.content);
			if (incomingEntries.length === 0) {
				deps.log(`write_taste_file refused non-taste content for ${args.path}`);
				result = UNPARSABLE_HINT;
				return;
			}
			await writeFileAtomicTaste(absolute, renderTasteFile(mergeTasteEntries(currentEntries, incomingEntries)));
		});
		return result;
	} catch (error) {
		return `错误：${errorText(error)}`;
	}
}

/**
 * `edit_taste_file`: read, replace the one unique `old_text` occurrence, and
 * write atomically — all inside the taste lock, so the edit is RMW-safe.
 */
async function executeEdit(deps, args) {
	const target = resolveTarget(deps, args.scope, args.path);
	if (typeof target === "string") return target;
	if (args.old_text.length === 0) return "错误：old_text 必须是非空字符串";
	const { absolute } = target;
	try {
		// Existence probe first: a missing file must report cleanly (and create
		// nothing) even when the scope — and with it the lock sibling's
		// directory — does not exist yet. The authoritative read still happens
		// inside the lock below, so a file deleted after this probe is caught.
		try {
			await stat(absolute);
		} catch (error) {
			if (error?.code === "ENOENT") return "错误：文件不存在";
			return `错误：${errorText(error)}`;
		}
		let result = `已编辑 ${args.path}`;
		await withTasteLock(absolute, async () => {
			let current;
			try {
				current = await readFile(absolute, "utf8");
			} catch (error) {
				result = error?.code === "ENOENT" ? "error: file does not exist" : `error: ${errorText(error)}`;
				return;
			}
			const hits = current.split(args.old_text).length - 1;
			if (hits === 0) {
				result = "错误：未找到 old_text";
				return;
			}
			if (hits > 1) {
				result = `错误：old_text 匹配 ${hits} 处，请提供只匹配一处的更长片段`;
				return;
			}
			await writeFileAtomicTaste(absolute, current.replace(args.old_text, args.new_text));
		});
		return result;
	} catch (error) {
		return `错误：${errorText(error)}`;
	}
}

/** Tool definition shared plumbing: string result rendered as one text block. */
const stringOutput = {
	schema: { type: "string" },
	render: (_args, value) => [{ type: "text", text: value }],
};

/** Build the `read_taste_file` definition. */
function readTasteFileTool(deps) {
	return defineTool({
		name: "read_taste_file",
		description: '读取中文偏好文件。路径相对于偏好目录，只能是 taste.md 或 {category}/taste.md。',
		parameters: {
			scope: {
				type: "string",
				required: true,
				enum: SCOPE_VALUES,
				description: '要读取的偏好范围：global（用户全局）或 project（当前项目）。',
			},
			path: {
				type: "string",
				required: true,
				description: '相对偏好路径：taste.md 或 {category}/taste.md。',
			},
		},
		output: stringOutput,
		execute: (args) => executeRead(deps, args),
	});
}

/** Build the `write_taste_file` definition. */
function writeTasteFileTool(deps) {
	return defineTool({
		name: "write_taste_file",
		description: '创建或更新中文偏好文件，条目格式为「- 中文陈述 Confidence: 0.88」。磁盘中未被新内容提及的条目会保留。路径必须是 taste.md 或 {category}/taste.md。',
		parameters: {
			scope: {
				type: "string",
				required: true,
				enum: SCOPE_VALUES,
				description: '要写入的偏好范围：global（用户全局）或 project（当前项目）。',
			},
			path: {
				type: "string",
				required: true,
				description: '相对偏好路径：taste.md 或 {category}/taste.md。',
			},
			content: {
				type: "string",
				required: true,
				description: '完整目标内容，使用中文偏好条目（「- 中文陈述 Confidence: 0.88」）。',
			}
		},
		output: stringOutput,
		execute: (args) => executeWrite(deps, args),
	});
}

/** Build the `edit_taste_file` definition. */
function editTasteFileTool(deps) {
	return defineTool({
		name: "edit_taste_file",
		description: "在偏好文件中精确替换唯一一处 old_text；old_text 必须只匹配一处。路径必须是 taste.md 或 {category}/taste.md。",
		parameters: {
			scope: {
				type: "string",
				required: true,
				enum: SCOPE_VALUES,
				description: 'Taste directory to edit: "global" (user-wide) or "project" (current repository).',
			},
			path: {
				type: "string",
				required: true,
				description: '相对偏好路径：taste.md 或 {category}/taste.md。',
			},
			old_text: {
				type: "string",
				required: true,
				description: "要替换的原文；必须在文件中恰好出现一次。",
			},
			new_text: {
				type: "string",
				required: true,
				description: "替换文本（可为空以删除）。",
			}
		},
		output: stringOutput,
		execute: (args) => executeEdit(deps, args),
	});
}


//#endregion

export function createTasteTools({ resolveGlobalDir, resolveProjectDir, log }) {
 const deps = { resolveGlobalDir, resolveProjectDir, log: typeof log === "function" ? log : () => {} };
 return [readTasteFileTool(deps), writeTasteFileTool(deps), editTasteFileTool(deps)];
}
