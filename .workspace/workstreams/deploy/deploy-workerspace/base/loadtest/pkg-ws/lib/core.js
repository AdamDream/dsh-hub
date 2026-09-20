//#region lib/core.js
/**
 * dsh-workerspace 纯逻辑核心（零 DSH/零 IO 依赖，全部可单测）。
 *
 * 覆盖四道安全闸的「纯」部分：
 *   1. 命令白名单 —— 模板首 token 必须命中 security.commandAllowlist；
 *   2. 占位符强校验 —— 只认 `{{artifact:<name>}}` / `{{credential:<ref>}}` 两种整 token
 *      占位符，字面 token 禁止 shell 元字符，杜绝拼接注入；
 *   3. 产物路径围栏 —— 相对路径解析到 artifacts.dir 内 + realpath 包含性校验（防 symlink 逃逸）；
 *   4. 输出脱敏 —— 凭据解析值/私钥路径在工具结果、日志、错误里一律替换为 `[redacted:<n>]`。
 *
 * 约定：本模块不得 import 任何 @deepseek-ai/* 包，不得触碰 process/网络；IO 一律由调用方
 * 注入（realpathFn / spawn 等），保证测试纯净。
 * @module dsh-workerspace/core
 */

import { isAbsolute, join, sep } from "node:path";

/** 默认烧录工具白名单（与需求五项 esptool/openocd/dfu/uuu/fastboot 对齐）。 */
export const DEFAULT_TOOL_ALLOWLIST = Object.freeze([
	"esptool",
	"esptool.py",
	"openocd",
	"dfu-util",
	"uuu",
	"fastboot",
]);

/** `{{artifact:<name>}}` 整 token 占位符（name: 字母数字._-）。 */
export const ARTIFACT_PLACEHOLDER_RE = /^\{\{artifact:([A-Za-z0-9_.-]+)\}\}$/;
/** `{{credential:<ref>}}` 整 token 占位符（ref: 字母数字._-）。 */
export const CREDENTIAL_PLACEHOLDER_RE = /^\{\{credential:([A-Za-z0-9_.-]+)\}\}$/;
/** 任何「看起来像占位符」的子串（用于拒绝混合/未知形态）。 */
const ANY_PLACEHOLDER_RE = /\{\{[a-z]+:/;

/** 字面 token 里禁止的 shell 相关字符（无 shell 执行也禁止，防模板污染 argv 语义）。 */
const TOKEN_FORBIDDEN_RE = /[\s"'`;|&<>$()\\]/;

/** 波特率合法区间（stty 词表覆盖 50–4000000）。 */
export const BAUD_MIN = 50;
export const BAUD_MAX = 4_000_000;

/** 串口路径名（/dev/ttyUSB0 等）允许的字符。 */
export const PORT_NAME_RE = /^[A-Za-z0-9._:/-]+$/;

/** 会话 id 形态（UUID v4 36 字符）。 */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 模板 id 形态（字母数字._-，≤64）。 */
export const TEMPLATE_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * 解析命令模板为 argv 序列。每条规则：
 * - 按空白切 token（模板内不允许引号包裹语义 —— 引号字符被 TOKEN_FORBIDDEN_RE 拒绝）；
 * - token 必须是「整占位符」或「无占位符形态的字面量」二选一；
 * - 字面量内禁止 shell 元字符；
 * - 占位符只允许 artifact / credential 两种 kind。
 * @param {string} text - 模板原文（settings flash.templates[].command）。
 * @returns {{ argv: string[], artifactNames: string[], credentialRefs: string[] }}
 * @throws {Error} 模板为空 / 含非法 token。
 */
export function parseCommandTemplate(text) {
	if (typeof text !== "string" || text.trim().length === 0) {
		throw new Error("flash template command must be a non-empty string");
	}
	const argv = [];
	const artifactNames = [];
	const credentialRefs = [];
	for (const raw of text.trim().split(/\s+/)) {
		if (raw.length === 0) continue;
		const artifact = ARTIFACT_PLACEHOLDER_RE.exec(raw);
		if (artifact !== null) {
			argv.push(raw);
			artifactNames.push(artifact[1]);
			continue;
		}
		const credential = CREDENTIAL_PLACEHOLDER_RE.exec(raw);
		if (credential !== null) {
			argv.push(raw);
			credentialRefs.push(credential[1]);
			continue;
		}
		if (ANY_PLACEHOLDER_RE.test(raw) || raw.includes("}}")) {
			throw new Error(
				`flash template token "${raw}" is not a whole {{artifact:<name>}} / {{credential:<ref>}} placeholder; mixed or unknown placeholder forms are rejected`,
			);
		}
		if (TOKEN_FORBIDDEN_RE.test(raw)) {
			throw new Error(
				`flash template literal token "${raw}" contains shell-sensitive characters (whitespace/quote/pipe/etc.); templates are argv-based, not shell text`,
			);
		}
		argv.push(raw);
	}
	if (argv.length === 0) {
		throw new Error("flash template command produced no argv tokens");
	}
	return { argv, artifactNames, credentialRefs };
}

/**
 * 白名单校验：模板 argv[0]（可执行名）必须命中 allowlist。
 * @param {string} tool - argv[0]。
 * @param {readonly string[]} allowlist - security.commandAllowlist（缺省 DEFAULT_TOOL_ALLOWLIST）。
 * @returns {boolean}
 */
export function isToolAllowlisted(tool, allowlist) {
	if (typeof tool !== "string" || tool.length === 0) return false;
	return allowlist.includes(tool);
}

/**
 * 产物路径围栏：把用户给出的路径解析成 artifacts.dir 内的真实绝对路径。
 * - 相对路径以 artifactsDir 为基准；
 * - realpath（含 symlink 解析）后必须严格落在 artifactsDir 内（文件须存在）；
 * - 返回真实路径，供 flash 工具直接使用。
 * @param {string} rawPath - 用户提供路径（可相对）。
 * @param {string} artifactsDir - 产物根（settings artifacts.dir，已 mkdir）。
 * @param {(p: string) => Promise<string>} realpathFn - 注入的 realpath（node:fs/promises）。
 * @returns {Promise<string>} 围栏内真实绝对路径。
 * @throws {Error} 不存在 / 逃逸 / 无法解析。
 */
export async function resolveArtifactPath(rawPath, artifactsDir, realpathFn) {
	if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
		throw new Error("artifact path must be a non-empty string");
	}
	const base = isAbsolute(rawPath) ? rawPath : join(artifactsDir, rawPath);
	let realBase;
	let realTarget;
	try {
		realBase = await realpathFn(artifactsDir);
		realTarget = await realpathFn(base);
	} catch (error) {
		throw new Error(`artifact "${rawPath}" does not exist or cannot be resolved: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (realTarget !== realBase && !realTarget.startsWith(realBase + sep)) {
		throw new Error(`artifact "${rawPath}" escapes the artifacts directory ${artifactsDir} (resolved to ${realTarget}); rejected`);
	}
	return realTarget;
}

/**
 * 把解析好的产物/凭据代入模板 argv，得到最终 argv。
 * @param {string} templateText - 模板原文。
 * @param {Record<string,string>} resolvedArtifacts - name → 围栏校验后的绝对路径。
 * @param {Record<string,string>} resolvedCredentials - ref → 凭据值（只进 argv，绝不回显）。
 * @returns {{ argv: string[], secrets: string[] }} secrets = 代入的凭据值（供脱敏）。
 */
export function buildFlashArgv(templateText, resolvedArtifacts, resolvedCredentials) {
	const { argv, artifactNames, credentialRefs } = parseCommandTemplate(templateText);
	const secrets = [];
	const out = argv.map((token) => {
		const artifact = ARTIFACT_PLACEHOLDER_RE.exec(token);
		if (artifact !== null) {
			const path = resolvedArtifacts[artifact[1]];
			if (typeof path !== "string" || path.length === 0) {
				throw new Error(`flash template references artifact "${artifact[1]}" but it was not provided in the tool call`);
			}
			return path;
		}
		const credential = CREDENTIAL_PLACEHOLDER_RE.exec(token);
		if (credential !== null) {
			const value = resolvedCredentials[credential[1]];
			if (typeof value !== "string" || value.length === 0) {
				throw new Error(`flash template references credential "${credential[1]}" but it is not configured; store it through the credentials service`);
			}
			secrets.push(value);
			return value;
		}
		return token;
	});
	return { argv: out, secrets, artifactNames, credentialRefs };
}

/** 正则转义（脱敏用）。 */
export function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 输出脱敏：把 secrets（凭据值等）在文本里全部替换为 `[redacted:<n>]`。
 * 长值先替换（避免子串碰撞）；空串/过短值忽略（防误伤）。
 * @param {string} text - 原始文本。
 * @param {readonly string[]} secrets - 要打码的值。
 * @returns {{ text: string, hits: number }} 脱敏后文本与命中次数。
 */
export function redact(text, secrets) {
	if (typeof text !== "string" || text.length === 0 || secrets.length === 0) {
		return { text: String(text ?? ""), hits: 0 };
	}
	const ordered = [...secrets]
		.filter((s) => typeof s === "string" && s.length >= 4)
		.sort((a, b) => b.length - a.length);
	let out = text;
	let hits = 0;
	ordered.forEach((secret, index) => {
		if (secret.length === 0) return;
		const marker = `[redacted:${index + 1}]`;
		const replaced = out.split(secret).join(marker);
		if (replaced !== out) {
			const occurrences = (out.match(new RegExp(escapeRegExp(secret), "g")) ?? []).length;
			hits += occurrences;
			out = replaced;
		}
	});
	return { text: out, hits };
}

/** 波特率校验（正整数 50..4000000）。 */
export function isValidBaudRate(value) {
	return Number.isInteger(value) && value >= BAUD_MIN && value <= BAUD_MAX;
}

/** 串口路径名校验（允许 /dev/... 形态）。 */
export function isValidPortName(value) {
	return typeof value === "string" && value.trim().length > 0 && PORT_NAME_RE.test(value.trim());
}

/** 会话 id 校验（UUID）。 */
export function isValidSessionId(value) {
	return typeof value === "string" && SESSION_ID_RE.test(value.trim());
}

/** 模板 id 校验。 */
export function isValidTemplateId(value) {
	return typeof value === "string" && TEMPLATE_ID_RE.test(value.trim());
}

/** 把路径转成安全的日志文件名片段（/ 与 .. 换成 _）。 */
export function safeLogSegment(value) {
	return String(value).replace(/[^A-Za-z0-9_.-]+/g, "_");
}

//#endregion
