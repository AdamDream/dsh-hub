//#region lib/flash.js
/**
 * dsh-workerspace 烧录执行编排（flash.templates 白名单模板 + 高危确认 + 日志落盘）。
 *
 * 与 core.js 的分工：core 负责「纯」校验/构造（占位符、白名单、路径围栏、脱敏）；
 * 本模块负责把这些纯步骤串成一次可审计的烧录执行：
 *   1. 按 templateId 查 settings flash.templates；
 *   2. 白名单校验 argv[0]；
 *   3. 产物路径围栏解析 + 凭据槽解析（值只进 argv，进 secrets 供脱敏）；
 *   4. 高危确认（security.confirmDangerous 门，ask 函数由 index.js 注入 —— 走
 *      ctx.approval.request，结果非 'allowed-once' 一律 fail-closed）；
 *   5. ctx.subprocess.spawn 执行（argv 直传、无 shell），收集输出 + 落盘日志（脱敏）；
 *   6. 非零退出码 → 抛脱敏后的错误。
 * @module dsh-workerspace/flash
 */

import {
	buildFlashArgv,
	isToolAllowlisted,
	isValidTemplateId,
	parseCommandTemplate,
	redact,
	resolveArtifactPath,
} from "./core.js";

/** 收集输出上限（stdout/stderr 各 64 KiB 内存 + 全量 spill 文件）。 */
export const COLLECT_MAX_BYTES = 64 * 1024;
/** 进程树终止宽限（ms）。 */
export const DEFAULT_GRACE_MS = 10_000;

/**
 * 组装烧录计划（纯校验 + 注入解析，不执行）。
 * @param {object} args
 * @param {string} args.templateId
 * @param {Array<{id: string, command: string, dangerous: boolean, timeoutMs: number}>} args.templates
 * @param {string[]} args.allowlist
 * @param {Record<string,string>} args.artifacts - 工具参数里用户给的 name→path。
 * @param {string} args.artifactsDir
 * @param {(p: string) => Promise<string>} args.realpathFn
 * @param {(ref: string) => Promise<{value?: string}>} args.resolveCredential
 * @returns {Promise<{ templateId: string, template: object, argv: string[], secrets: string[], dangerous: boolean, timeoutMs: number }>}
 */
export async function planFlash(args) {
	if (!isValidTemplateId(args.templateId)) {
		throw new Error(`invalid flash template id "${args.templateId}"`);
	}
	const template = args.templates.find((t) => t && t.id === args.templateId);
	if (template === undefined) {
		const known = args.templates.map((t) => t.id).join(", ") || "(none configured)";
		throw new Error(
			`unknown flash template "${args.templateId}"; configure it under settings dsh-workerspace → flash.templates, or choose one of: ${known}`,
		);
	}
	if (typeof template.command !== "string" || template.command.trim().length === 0) {
		throw new Error(`flash template "${args.templateId}" has an empty command`);
	}

	// 1) 白名单：argv[0] 必须是 allowlist 成员（默认 esptool/esptool.py/openocd/dfu-util/uuu/fastboot）。
	const parsed = parseCommandTemplate(template.command);
	if (!isToolAllowlisted(parsed.argv[0], args.allowlist)) {
		throw new Error(
			`flash template "${args.templateId}" executable "${parsed.argv[0]}" is not in the command allowlist (${args.allowlist.join(", ")})`,
		);
	}

	// 2) 产物围栏 + 3) 凭据槽。
	const resolvedArtifacts = {};
	for (const name of parsed.artifactNames) {
		const raw = args.artifacts?.[name];
		if (typeof raw !== "string" || raw.trim().length === 0) {
			throw new Error(`flash template "${args.templateId}" needs artifact "${name}"; pass it in the artifacts argument`);
		}
		resolvedArtifacts[name] = await resolveArtifactPath(raw, args.artifactsDir, args.realpathFn);
	}
	const resolvedCredentials = {};
	const credentialRefs = parsed.credentialRefs;
	for (const ref of credentialRefs) {
		const record = await args.resolveCredential(ref);
		if (record === undefined || typeof record.value !== "string" || record.value.length === 0) {
			throw new Error(
				`flash template "${args.templateId}" references credential "${ref}" but it is not stored; add it through the credentials service (credential-ref, never inline plaintext)`,
			);
		}
		resolvedCredentials[ref] = record.value;
	}

	const built = buildFlashArgv(template.command, resolvedArtifacts, resolvedCredentials);
	const dangerous = template.dangerous !== false;
	const timeoutMs = Number.isFinite(template.timeoutMs) && template.timeoutMs > 0 ? template.timeoutMs : 600_000;
	return {
		templateId: args.templateId,
		template,
		argv: built.argv,
		secrets: built.secrets,
		dangerous,
		timeoutMs,
	};
}

/**
 * 执行烧录计划。
 * @param {object} plan - planFlash 的返回值。
 * @param {object} exec
 * @param {object} exec.spawn - (spec) => SubprocessHandle（ctx.subprocess.spawn）。
 * @param {AbortSignal} [exec.signal]
 * @param {string} exec.cwd - 工作目录（artifacts.dir）。
 * @param {boolean} exec.confirm - 是否走高危确认。
 * @param {(argv: string[]) => Promise<boolean>} exec.ask - 确认函数（index.js 注入
 *        ctx.approval.request 封装），返回 true=放行。
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string, durationMs: number, logLines: string[] }>}
 */
export async function runFlashPlan(plan, exec) {
	const started = Date.now();

	if (exec.confirm && plan.dangerous) {
		const allowed = await exec.ask(plan.argv);
		if (!allowed) {
			throw new Error(
				"flash execution was not approved (high-risk operation requires confirmation; see settings dsh-workerspace → security.confirmDangerous)",
			);
		}
	}

	const signals = [];
	if (exec.signal !== undefined) signals.push(exec.signal);
	signals.push(AbortSignal.timeout(plan.timeoutMs));
	const signal = AbortSignal.any(signals);

	let handle;
	let outcome;
	try {
		handle = exec.spawn({
			argv: plan.argv,
			cwd: exec.cwd,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: COLLECT_MAX_BYTES, spill: { maxBytes: 8 * 1024 * 1024 } },
				stderr: { maxBytes: COLLECT_MAX_BYTES, spill: { maxBytes: 8 * 1024 * 1024 } },
			},
			graceMs: DEFAULT_GRACE_MS,
			signal,
		});
		outcome = await handle.done;
	} catch (error) {
		throw new Error(`flash subprocess failed to spawn: ${error instanceof Error ? error.message : String(error)}`);
	}
	const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
	const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
	const durationMs = Date.now() - started;

	const logLines = [
		`[flash] template=${plan.templateId} argv=${JSON.stringify(plan.argv)}`,
		`[flash] exit=${outcome.exitCode} signal=${outcome.signal ?? "none"} durationMs=${durationMs}`,
	];
	if (stdout.trim().length > 0) logLines.push(`[flash] stdout:\n${stdout.trimEnd()}`);
	if (stderr.trim().length > 0) logLines.push(`[flash] stderr:\n${stderr.trimEnd()}`);

	if (outcome.exitCode !== 0) {
		const detail = (stderr.trim() || stdout.trim() || `exit code ${outcome.exitCode}`).slice(-4000);
		throw new Error(`flash ${plan.templateId} failed (exit ${outcome.exitCode}): ${detail}`);
	}

	return { exitCode: outcome.exitCode, stdout, stderr, durationMs, logLines };
}

/** 把日志行脱敏后拼成一段文本（落盘用）。 */
export function redactLogLines(logLines, secrets) {
	const full = logLines.join("\n");
	const { text } = redact(full, secrets);
	return text;
}
//#endregion
