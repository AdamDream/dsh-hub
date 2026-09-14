#!/usr/bin/env node
/**
 * 一次性中文单轨迁移事务（dsh-taste）。
 *
 * 依据：pi-taste-analysis/unified-chinese-taste-design.md §8.4 / §10.4（翻译来源组合 §3.1 的
 * 受控词典机制）。一次性命令，不属于运行时分支；迁移完成后本脚本按设计应删除。
 *
 * 语义（全部 fail-closed，任一失败即该 scope staging 失败：不 rename、不删除、不污染任何旧文件）：
 *   1. 逐 scope 加锁并盘点：白名单 taste.md（根 + 一级 category，listTasteFiles 语义），
 *      逐文件条目数、规范化键、sidecar 键数、精确匹配、缺失 sidecar、幽灵键、规范化碰撞、
 *      多键归一化、候选翻译冲突、翻译失败，全部写入 manifest / 失败清单。
 *   2. 翻译来源唯一且可追溯：优先 sidecar 精确键匹配；无 sidecar 匹配的英文条目只允许
 *      命中本脚本内嵌的受控词典（人工逐条翻译，绝不程序猜测）；已中文条目原样保留。
 *      幽灵键、多键归一化到同一条、同条多候选冲突、候选不可用（非中文/带置信度尾巴）、
 *      无任何候选，均失败并保留旧文件。
 *   3. 全部 scope staging 到临时目录并复检：条目数相等、每条均为中文、置信度统一
 *      formatTasteConfidence 两位（0.90/1.00/0.88）。任一 scope 失败 → 全事务不提交。
 *   4. --apply 提交：先整目录备份（taste/sidecar/config，带 sha256 manifest），再逐文件
 *      withTasteLock + writeFileAtomicTaste（temp+fsync+同目录原子 rename）；任一 rename
 *      失败立即停止并按备份 sha256 回滚全部已提交文件。全部提交成功后才把旧 sidecar
 *      就地改名为时间戳备份（绝不 unlink）。
 *   5. Command Code（~/.commandcode/taste 与 <project>/.commandcode/taste）只读扫描：
 *      缺失记"未发现"；发现英文条目仅报告上游迁移责任与兼容告警，绝不回写。
 *   6. 幂等：对已中文本体，staged 输出与现文件逐字节相同即 no-op，不产生新差异。
 *
 * 用法：
 *   node scripts/migrate-chinese-single-track.mjs                 # dry-run：盘点+staging+校验，不提交
 *   node scripts/migrate-chinese-single-track.mjs --apply         # 正式事务提交
 *   node scripts/migrate-chinese-single-track.mjs --selftest      # 临时目录 fixture：失败保留/回滚/幂等
 * 选项：--global-dir <dir>  --project-dir <dir>  --artifacts-root <dir>
 *
 * 一次性产物（staging/manifest/失败清单/备份/锁）全部位于临时目录：
 *   <artifacts-root>/dsh-taste-migration-<时间戳>/
 */
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeSync,
} from "node:fs";
import {
	copyFile,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	formatTasteConfidence,
	listTasteFiles,
	normalizePreferenceKey,
	parseTasteFile,
	renderTasteFile,
	withTasteLock,
	writeFileAtomicTaste,
} from "../lib/storage.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SIDECAAR_FILENAME = "display.zh.json";
const SIDECAR_BACKUP_SUFFIX = ".migrated-backup-";

/* ------------------------------------------------------------------ */
/* 受控词典（§3.1：人工/受控词典翻译；绝不程序猜测）。                    */
/* en 必须与 taste.md 中条目逐字一致；运行时用 normalizePreferenceKey     */
/* 双向归一后精确匹配。词典只允许覆盖"无 sidecar 匹配"的英文条目；        */
/* 词典键若与 sidecar 匹配条目重叠 → translation-conflict 失败。          */
/* ------------------------------------------------------------------ */
const CONTROLLED_DICTIONARY = [
	{
		en: "Before performing a hands-on/manual procedure, wants the underlying semantics explained — what each step measures/estimates, how the measured quantities propagate downstream (e.g., whether a calibration neutral is remapped to the downstream model's neutral and the impact of any mismatch), and the expected observable outcomes (e.g., joint-angle changes) — so they can execute precisely, rather than rote commands.",
		zh: "动手/手工操作前，要求讲清底层语义——每一步在测什么/估什么、测量量如何向下游传播（如标定中性位是否被重映射到下游模型的中性位、失配的影响）、预期可观察的结果（如关节角变化）——以便精确执行，而非机械照抄命令。",
	},
	{
		en: "For evaluating whether one project's capability can be integrated into another, prefers deep source-level reading of both the upstream implementation and the target architecture, followed by an explicit mapping of reusable components, framework-specific adapters, lifecycle hooks, storage, and risks.",
		zh: "评估一个项目的能力能否整合进另一个项目时，偏好对上游实现与目标架构做深度源码级阅读，再显式映射可复用组件、框架专属适配层、生命周期钩子、存储与风险。",
	},
	{
		en: "Prefers independently preflighting proposed APIs and integration assumptions with a minimal end-to-end smoke before dispatching implementation, and recording any disproven assumption as a concrete correction for the execution phase.",
		zh: "偏好派发实现前，先用最小端到端冒烟独立预检拟议 API 与集成假设，并把被证伪的假设记录为执行阶段的具体修正。",
	},
	{
		en: "When an audit or preflight finds a real implementation defect, prefers preserving the finding in the evidence baseline and explicitly injecting the corrected API or procedure into the execution brief rather than silently editing the plan.",
		zh: "当审计或预检发现真实实现缺陷时，偏好把发现保留在证据基线中，并把修正后的 API 或流程显式注入执行简报，而非悄悄改动方案。",
	},
	{
		en: "Prefers workflow stages to retry transient agent null returns or exceptions at most once with a fresh label, while keeping the first failure reason in the disk report.",
		zh: "偏好 workflow 各阶段对 agent 空返回或异常这类瞬时失败最多用新 label 重试一次，并在落盘报告中保留首次失败原因。",
	},
	{
		en: "Prefers workflow orchestration to distinguish transient invocation failures from business verdicts such as needs-revision or rework, avoiding blind retries of valid negative decisions.",
		zh: "偏好 workflow 编排把瞬时调用失败与 needs-revision、返工等业务裁决区分开，避免对有效的否定结论盲目重试。",
	},
	{
		en: "Prefers workflow final results to be recursively JSON-safe, with explicit fallbacks for optional fields and no undefined, Error, function, or agent objects crossing the serialization boundary.",
		zh: "偏好 workflow 最终结果递归 JSON 安全：可选字段带显式 fallback，不允许 undefined、Error、函数或 agent 对象穿越序列化边界。",
	},
	{
		en: "After a workflow failure, prefers inspecting persisted phase artifacts, git diff, and test results before resuming, retrying, or rolling back, and not undoing an implementation that already passes local verification merely because a later review call failed.",
		zh: "workflow 失败后，偏好先检查已落盘的阶段产物、git diff 和测试结果，再续接、重试或回滚；不因后续复核调用失败，就撤销已通过本地验证的实现。",
	},
	{
		en: "When glove and simulation joint topologies differ, prefers explicit semantic mapping with documented handling of unmatched joints (for example, a shared source channel), while keeping unrequested channels frozen and validating every newly unlocked channel independently.",
		zh: "当手套与仿真关节拓扑不一致时，偏好采用明确的语义映射并记录未匹配关节的处理方式（例如共享源通道）；未明确要求的通道保持冻结，每个新解锁通道都要独立验证。"
	},
	{
		en: "When the existing Web retargeting has materially wrong direction, ROM, smoothing, or discontinuous solver output, stop patching the joint-space identity mapping and rebuild the data path by tracing the complete mainline scripts/manus_teleop.py semantics through a legitimate retarget adapter, validated limits, temporal gates, filtering, and MuJoCo synchronization.",
		zh: "当现有 Web 重定向的方向、运动范围、平滑或求解器输出连续性存在实质错误时，停止修补关节空间恒等映射；应完整追踪主线 scripts/manus_teleop.py 的语义，通过合法的重定向适配器、经验证的限位、时间闸门、滤波和 MuJoCo 同步重建数据路径。"
	},
	{
		en: "Never fabricate a missing thumb_dip input by duplicating another thumb channel; use the mainline Cartesian/kinematic solver to derive coupled thumb joints, or freeze thumb_dip until a semantically valid source exists.",
		zh: "绝不通过复制其他拇指通道来伪造缺失的 thumb_dip 输入；应使用主线笛卡尔/运动学求解器推导耦合拇指关节，或在存在语义有效的源之前冻结 thumb_dip。"
	},
	{
		en: "In SDK audits, explicitly distinguish an ORCA-side angle adapter, an external protobuf/Wire-A consumer, and a genuine official Manus SDK client; never attribute external producer, schema, callback, discovery, calibration, or reconnect capabilities to the local repository without source evidence.",
		zh: "在 SDK 审计中，必须明确区分 ORCA 侧角度适配器、外部 protobuf/Wire-A 消费者和真正的官方 Manus SDK 客户端；没有源码证据时，绝不把外部生产者、schema、回调、发现、标定或重连能力归因于本地仓库。"
	},
	{
		en: "Treat Wire-A parsing as fail-closed infrastructure: validate schema identity/fingerprint, root and parent topology, finite position/quaternion values, quaternion norm, and timestamp semantics before accepting a frame.",
		zh: "将 Wire-A 解析视为 fail-closed 基础设施：接受帧之前验证 schema 身份/指纹、根节点与父节点拓扑、位置和四元数的有限值、四元数范数以及时间戳语义。"
	},
	{
		en: "For real-time control claims, distinguish source frequency from a fixed 100 Hz control scheduler; require a 10 ms tick with latest-valid-frame policy, bounded solver budget, per-tick filtering, and at-most-once sink application before claiming 100 Hz control.",
		zh: "对于实时控制声明，必须区分源频率与固定 100 Hz 控制调度器；只有具备 10 ms tick、最新有效帧策略、有界求解预算、逐 tick 滤波和 sink 至多一次应用，才能声称具备 100 Hz 控制。"
	},
	{
		en: "For command smoothing, prefer an explicitly specified second-order filter with documented sample rate, cutoff, coefficients, initialization, reset, gap and nonfinite handling, output-limit ordering, and latency budget; input median filtering is not an adequate substitute.",
		zh: "对于指令平滑，偏好明确规定采样率、截止频率、系数、初始化、重置、间隙与非有限值处理、输出限位顺序及延迟预算的二阶滤波器；输入中值滤波不能作为充分替代。"
	},
	{
		en: "Require per-channel hardware acceptance evidence for newly enabled thumb and abduction channels, covering direction, magnitude, ROM clipping, cross-channel isolation, filtering, output rate, and preservation of frozen channels; configuration presence alone is insufficient.",
		zh: "新启用的拇指和外展通道必须提供逐通道硬件验收证据，覆盖方向、幅度、运动范围裁剪、跨通道隔离、滤波、输出速率及冻结通道保持；仅有配置存在并不足够。"
	},
	{
		en: "Do not label the current Manus integration production-ready when official SDK ownership, schema validation, timing/filtering guarantees, reconnect behavior, timestamp domain, and hardware channel acceptance remain unproven; describe it as an ORCA-side integration/experimental version.",
		zh: "官方 SDK 归属、schema 校验、时序/滤波保证、重连行为、时间戳域及硬件通道验收仍未证实时，不得将当前 Manus 集成标为生产就绪；应描述为 ORCA 侧集成/实验版本。"
	}
];

/* ------------------------------------------------------------------ */
/* 语言分类：判断条目是否需要翻译（中文单轨断言的基础）。                 */
/* ------------------------------------------------------------------ */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD_RE = /[A-Za-z][A-Za-z0-9]*(?:[-'’][A-Za-z0-9]+)*/g;
const SIDECAAR_TAIL_RE = /\s*置信度[:：]\s*\d+(?:\.\d+)?\s*$/;

function normalizeSidecarChinese(value) {
	if (typeof value !== "string") return null;
	const normalized = value.replace(SIDECAAR_TAIL_RE, "").trim();
	return normalized.length > 0 ? normalized : null;
}

/**
 * @param {string} statement
 * @returns {{cls: "chinese"|"latin"|"mixed-latin-dominant"|"no-script", needsTranslation: boolean, cjk: number, latinWords: number}}
 */
export function classifyStatementLanguage(statement) {
	const text = String(statement ?? "");
	const cjk = (text.match(CJK_RE) ?? []).length;
	const latinWords = (text.match(LATIN_WORD_RE) ?? []).length;
	if (cjk === 0 && latinWords === 0) {
		return { cls: "no-script", needsTranslation: true, cjk, latinWords };
	}
	if (cjk === 0) return { cls: "latin", needsTranslation: true, cjk, latinWords };
	if (latinWords >= cjk) {
		return { cls: "mixed-latin-dominant", needsTranslation: true, cjk, latinWords };
	}
	return { cls: "chinese", needsTranslation: false, cjk, latinWords };
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function fsyncDir(dir) {
	let fd;
	try {
		fd = openSyncFn(dir, "r");
		fsyncSyncFn(fd);
	} catch {
		/* best effort */
	} finally {
		if (fd !== undefined) closeSyncFn(fd);
	}
}
import { closeSync, fsyncSync, openSync } from "node:fs";
const openSyncFn = openSync;
const fsyncSyncFn = fsyncSync;
const closeSyncFn = closeSync;

/* ------------------------------------------------------------------ */
/* 单 scope 盘点（只读）                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {string} scopeDir
 * @param {{id: string, label: string}} scope
 * @param {Map<string, {zh: string, en: string}>} dictionary
 * @returns {Promise<{files: Array<object>, failures: Array<object>, sidecar: object|null}>}
 */
async function inventoryScope(scopeDir, scope, dictionary) {
	const failures = [];
	const files = [];
	if (!existsSync(scopeDir)) {
		return { found: false, files, failures, sidecar: null };
	}
	const relPaths = await listTasteFiles(scopeDir);
	const sidecarPath = path.join(scopeDir, SIDECAAR_FILENAME);
	let sidecar = null;
	if (existsSync(sidecarPath)) {
		try {
			const raw = JSON.parse(await readFile(sidecarPath, "utf8"));
			const keys = Object.entries(raw).filter(([k, v]) => typeof v === "string");
			sidecar = { path: sidecarPath, rawKeys: keys.map(([k]) => k), map: new Map(keys) };
		} catch (error) {
			failures.push({ scope: scope.id, relPath: SIDECAAR_FILENAME, kind: "sidecar-parse-error", detail: String(error?.message ?? error) });
			sidecar = { path: sidecarPath, rawKeys: [], map: new Map(), broken: true };
		}
	}
	const usedSidecarRawKeys = new Map(); // entryKey -> rawKey[]
	const dictionaryKeys = new Set(dictionary.keys());
	const dictionaryConsumed = new Set();

	for (const relPath of relPaths) {
		const content = await readFile(path.join(scopeDir, relPath), "utf8");
		const entries = parseTasteFile(content);
		const entryRecords = [];
		const seenKeys = new Map();
		for (const [index, entry] of entries.entries()) {
			const key = normalizePreferenceKey(entry.statement);
			if (seenKeys.has(key)) {
				failures.push({ scope: scope.id, relPath, kind: "normalized-collision", detail: `条目 #${seenKeys.get(key) + 1} 与 #${index + 1} 规范化键相同: ${key}` });
			} else {
				seenKeys.set(key, index);
			}
			entryRecords.push({ index, statement: entry.statement, confidence: entry.confidence, key, lang: classifyStatementLanguage(entry.statement) });
		}
		files.push({ relPath, content, sha256: sha256(Buffer.from(content, "utf8")), entries: entryRecords, entryCount: entries.length });
	}

	const entryKeySet = new Set(files.flatMap((f) => f.entries.map((e) => e.key)));
	// sidecar 键匹配：幽灵键 / 多键归一化到同一条
	if (sidecar) {
		for (const rawKey of sidecar.rawKeys) {
			const normalized = normalizePreferenceKey(rawKey);
			if (!entryKeySet.has(normalized)) {
				failures.push({ scope: scope.id, relPath: SIDECAAR_FILENAME, kind: "ghost-sidecar-key", detail: `sidecar 键不匹配任何条目: ${rawKey}` });
				continue;
			}
			if (!usedSidecarRawKeys.has(normalized)) usedSidecarRawKeys.set(normalized, []);
			usedSidecarRawKeys.get(normalized).push(rawKey);
		}
		for (const [entryKey, rawKeys] of usedSidecarRawKeys) {
			if (rawKeys.length > 1) {
				failures.push({ scope: scope.id, relPath: SIDECAAR_FILENAME, kind: "multi-sidecar-key-per-entry", detail: `${rawKeys.length} 个 sidecar 键归一化到同一条 ${entryKey}: ${JSON.stringify(rawKeys)}` });
			}
			if (dictionaryKeys.has(entryKey)) {
				failures.push({ scope: scope.id, relPath: SIDECAAR_FILENAME, kind: "translation-conflict", detail: `受控词典与 sidecar 同时提供翻译: ${entryKey}` });
			}
		}
	}
	// 逐条目翻译来源裁决
	for (const file of files) {
		for (const entry of file.entries) {
			entry.missingSidecar = !usedSidecarRawKeys.has(entry.key);
			entry.needsTranslation = entry.lang.needsTranslation;
			entry.source = null;
			entry.zh = null;
			if (!entry.needsTranslation) {
				entry.source = "passthrough-chinese";
				entry.zh = entry.statement;
				continue;
			}
			const rawKeys = usedSidecarRawKeys.get(entry.key) ?? [];
			const candidates = [];
			for (const rawKey of rawKeys) {
				const rawZh = sidecar.map.get(rawKey);
				const zh = normalizeSidecarChinese(rawZh);
				const usable = zh !== null && !classifyStatementLanguage(zh).needsTranslation;
				candidates.push({ zh, usable, provenance: `sidecar:${rawKey}` });
				if (!usable) {
					failures.push({ scope: scope.id, relPath: SIDECAAR_FILENAME, kind: "sidecar-value-unusable", detail: `条目键 ${entry.key} 的 sidecar 值不可直接使用（空/非中文）: ${JSON.stringify(rawZh)}` });
				}
			}
			const usableCandidates = candidates.filter((c) => c.usable);
			if (usableCandidates.length === 0) {
				const dict = dictionary.get(entry.key);
				if (dict) {
					dictionaryConsumed.add(entry.key);
					entry.source = "controlled-dictionary";
					entry.zh = dict.zh;
					entry.provenance = `controlled-dictionary#${CONTROLLED_DICTIONARY.findIndex((d) => d.zh === dict.zh) + 1}`;
				} else {
					entry.source = null;
					failures.push({ scope: scope.id, relPath: file.relPath, kind: "translation-failed", detail: `条目 #${entry.index + 1}（键 ${entry.key}）无 sidecar 匹配且未命中受控词典，拒绝猜测翻译: ${JSON.stringify(entry.statement.slice(0, 120))}` });
				}
			} else {
				const distinct = [...new Set(usableCandidates.map((c) => c.zh))];
				if (distinct.length > 1) {
					entry.source = null;
					failures.push({ scope: scope.id, relPath: SIDECAAR_FILENAME, kind: "translation-conflict", detail: `条目键 ${entry.key} 存在 ${distinct.length} 个互不相同的候选翻译` });
				} else {
					entry.source = "sidecar";
					entry.zh = distinct[0];
					entry.provenance = usableCandidates[0].provenance;
				}
			}
		}
	}
	return { found: true, files, failures, sidecar };
}

/* ------------------------------------------------------------------ */
/* 单 scope staging（写临时目录，不触碰 scope）                          */
/* ------------------------------------------------------------------ */

/**
 * @param {{dir: string, id: string}} scope
 * @param {{files: Array}} inventory
 * @param {string} stagingDir
 */
async function stageScope(scope, inventory, stagingDir) {
	const staged = [];
	for (const file of inventory.files) {
		const rendered = renderTasteFile(file.entries.map((entry) => ({
			statement: entry.zh,
			confidence: entry.confidence,
		})));
		const target = path.join(stagingDir, file.relPath);
		mkdirSync(path.dirname(target), { recursive: true });
		await writeFile(target, rendered, { mode: 0o600 });
		// 复检：条目数相等、每条中文、置信度固定两位
		const reparsed = parseTasteFile(rendered);
		const problems = [];
		if (reparsed.length !== file.entryCount) problems.push(`条目数 ${reparsed.length} != 原始 ${file.entryCount}`);
		for (const [i, e] of reparsed.entries()) {
			const lang = classifyStatementLanguage(e.statement);
			if (lang.needsTranslation) problems.push(`staged 条目 #${i + 1} 非中文单轨: ${JSON.stringify(e.statement.slice(0, 60))}`);
		}
		for (const line of rendered.split("\n").filter((l) => l.startsWith("- "))) {
			if (!/^- .+ Confidence: \d+\.\d{2}$/.test(line)) problems.push(`staged 行置信度非两位小数: ${line.slice(-40)}`);
		}
		staged.push({
			relPath: file.relPath,
			content: rendered,
			sha256: sha256(Buffer.from(rendered, "utf8")),
			changed: rendered !== file.content,
			problems,
		});
	}
	return staged;
}

/* ------------------------------------------------------------------ */
/* Command Code 只读扫描（绝不写入）                                     */
/* ------------------------------------------------------------------ */

async function commandCodeScan(bases) {
	const results = [];
	for (const base of bases) {
		if (!existsSync(base)) {
			results.push({ base, found: false, note: "未发现" });
			continue;
		}
		const files = [];
		const main = path.join(base, "taste.md");
		if (existsSync(main)) files.push(main);
		let entries = [];
		try {
			entries = await readdir(base, { withFileTypes: true });
		} catch {
			entries = [];
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const dirEntry of entries) {
			if (!dirEntry.isDirectory()) continue;
			if (!/^[A-Za-z0-9_.-]{1,64}$/.test(dirEntry.name) || dirEntry.name.startsWith("--")) continue;
			const candidate = path.join(base, dirEntry.name, "taste.md");
			if (existsSync(candidate)) files.push(candidate);
		}
		const fileReports = [];
		for (const filePath of files) {
			const content = await readFile(filePath, "utf8");
			const parsed = parseTasteFile(content);
			const langs = parsed.map((e) => classifyStatementLanguage(e.statement).cls);
			fileReports.push({
				path: filePath,
				entryCount: parsed.length,
				chineseEntries: langs.filter((c) => c === "chinese").length,
				englishEntries: langs.filter((c) => c !== "chinese").length,
				status: langs.some((c) => c !== "chinese") ? "英文未迁移：未完成中文单轨；上游只读源责任，dsh-taste 不回写，注入兼容显示英文需标记未完成" : "中文",
			});
		}
		results.push({
			base,
			found: true,
			files: fileReports,
			note: files.length === 0 ? "未发现（目录存在但无白名单 taste.md）" : undefined,
		});
	}
	return results;
}

/* ------------------------------------------------------------------ */
/* 事务主体                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {{
 *   globalDir: string, projectDir: string, artifactsRoot: string,
 *   apply: boolean, forceFailRelPath?: string,
 *   onLog?: (line: string) => void
 * }} options
 */
export async function runMigration(options) {
	const log = options.onLog ?? ((line) => console.log(line));
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const artifactsDir = options.artifactsRoot
		? path.join(options.artifactsRoot, `dsh-taste-migration-${stamp}`)
		: path.join(os.tmpdir(), `dsh-taste-migration-${stamp}`);
	for (const sub of ["staging", "backups", "locks", "reports"]) {
		await mkdir(path.join(artifactsDir, sub), { recursive: true, mode: 0o700 });
	}
	const scopes = [
		{ id: "global", label: "全局", dir: path.resolve(options.globalDir) },
		{ id: "project", label: "项目", dir: path.resolve(options.projectDir) },
	];
	const dictionary = new Map(CONTROLLED_DICTIONARY.map((d) => [normalizePreferenceKey(d.en), d]));
	if (dictionary.size !== CONTROLLED_DICTIONARY.length) {
		throw new Error("受控词典内部规范化键冲突（作者错误），拒绝执行");
	}

	// scope 锁（事务级互斥；O_EXCL 独占创建）
	const lockPaths = [];
	try {
		for (const scope of scopes) {
			const lockPath = path.join(artifactsDir, "locks", `${scope.id}.lock`);
			const fd = openSyncFn(lockPath, "wx");
			fsyncSyncFn ?? undefined;
			writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), scopes: scopes.map((s) => s.dir) }, null, "\t"));
			closeSyncFn(fd);
			lockPaths.push(lockPath);
		}
	} catch (error) {
		throw new Error(`scope 锁获取失败（可能有并发迁移）: ${error?.message ?? error}`);
	}

	const result = {
		artifactsDir,
		mode: options.apply ? "apply" : "dry-run",
		startedAt: new Date().toISOString(),
		scopes: [],
		commandCode: [],
		committed: false,
		rolledBack: false,
		finishedAt: null,
	};

	try {
		// 阶段 1+2：盘点 + staging（全部 scope 完成才允许提交）
		let anyFailure = false;
		for (const scope of scopes) {
			log(`[${scope.id}] 盘点 ${scope.dir}`);
			const inventory = await inventoryScope(scope.dir, scope, dictionary);
			const staged = inventory.failures.length === 0 ? await stageScope(scope, inventory, path.join(artifactsDir, "staging", scope.id)) : [];
			if (inventory.failures.length > 0) anyFailure = true;
			const scopeRecord = {
				id: scope.id,
				dir: scope.dir,
				found: inventory.found ?? false,
				files: inventory.files.map((f) => ({
					relPath: f.relPath,
					sha256: f.sha256,
					entryCount: f.entryCount,
					keys: f.entries.map((e) => e.key),
					entries: f.entries.map((e) => ({
						index: e.index + 1,
						statement: e.statement,
						key: e.key,
						confidenceIn: formatTasteConfidence(e.confidence),
						confidenceOut: formatTasteConfidence(e.confidence),
						lang: e.lang.cls,
						missingSidecar: e.missingSidecar,
						needsTranslation: e.needsTranslation,
						source: e.source,
						zh: e.zh,
						provenance: e.provenance ?? null,
					})),
				})),
				sidecar: inventory.sidecar
					? { path: inventory.sidecar.path, keyCount: inventory.sidecar.rawKeys.length }
					: null,
				staged: staged.map((s) => ({ relPath: s.relPath, content: s.content, sha256: s.sha256, changed: s.changed, problems: s.problems })),
				failures: inventory.failures,
				status: inventory.failures.length > 0 ? "failed" : staged.some((s) => s.changed) ? "staged" : "no-op",
			};
			result.scopes.push(scopeRecord);
			log(`[${scope.id}] 状态=${scopeRecord.status} 文件=${scopeRecord.files.length} 失败=${inventory.failures.length}`);
		}

		// 全量校验闸门：任一 scope 失败 → 不提交、不备份、旧文件不动
		if (anyFailure) {
			result.status = "staging-failed";
			result.finishedAt = new Date().toISOString();
			const failureList = {
				generatedAt: result.finishedAt,
				mode: result.mode,
				scopes: result.scopes.filter((s) => s.failures.length > 0).map((s) => ({ scope: s.id, dir: s.dir, failures: s.failures })),
			};
			const failurePath = path.join(artifactsDir, "reports", "failure-list.json");
			await writeFile(failurePath, JSON.stringify(failureList, null, "\t") + "\n", { mode: 0o600 });
			await writeFile(path.join(artifactsDir, "reports", "manifest.json"), JSON.stringify(result, null, "\t") + "\n", { mode: 0o600 });
			result.failureListPath = failurePath;
			result.manifestPath = path.join(artifactsDir, "reports", "manifest.json");
			log(`失败清单: ${failurePath}`);
			log("staging 失败：未 rename、未删除、未修改任何旧文件。");
			return result;
		}
		result.status = "staged-clean";

		// 阶段 3：Command Code 只读扫描（两处基路径；缺失记"未发现"）
		result.commandCode = await commandCodeScan([
			path.join(os.homedir(), ".commandcode", "taste"),
			path.join(path.dirname(path.dirname(scopes[1].dir)), ".commandcode", "taste"),
		]);

		if (!options.apply) {
			result.finishedAt = new Date().toISOString();
			await writeFile(path.join(artifactsDir, "reports", "manifest.json"), JSON.stringify(result, null, "\t") + "\n", { mode: 0o600 });
			result.manifestPath = path.join(artifactsDir, "reports", "manifest.json");
			log(`dry-run 完成，未提交。manifest: ${result.manifestPath}`);
			return result;
		}

		// 阶段 4：备份 → 原子提交（任一失败按备份回滚全部已提交文件）
		const committedFiles = []; // {scopeId, targetAbs, backupAbs, sha256}
		try {
			for (const scopeRecord of result.scopes) {
				const scope = scopes.find((s) => s.id === scopeRecord.id);
				const changedFiles = scopeRecord.staged.filter((s) => s.changed);
				if (changedFiles.length === 0) {
					log(`[${scopeRecord.id}] 已是中文单轨且无差异：no-op，跳过提交`);
					continue;
				}
				const backupDir = path.join(artifactsDir, "backups", scopeRecord.id);
				await mkdir(backupDir, { recursive: true, mode: 0o700 });
				for (const file of scopeRecord.files) {
					const backupAbs = path.join(backupDir, file.relPath);
					mkdirSync(path.dirname(backupAbs), { recursive: true });
					await copyFile(path.join(scope.dir, file.relPath), backupAbs);
					file.backupSha256 = sha256(readFileSync(backupAbs));
					if (file.backupSha256 !== file.sha256) throw new Error(`备份校验不一致: ${file.relPath}`);
				}
				if (scopeRecord.sidecar) {
					const backupAbs = path.join(backupDir, SIDECAAR_FILENAME);
					await copyFile(scopeRecord.sidecar.path, backupAbs);
					scopeRecord.sidecar.backupSha256 = sha256(readFileSync(backupAbs));
				}
				const configPath = path.join(scope.dir, "config.json");
				if (existsSync(configPath)) {
					const backupAbs = path.join(backupDir, "config.json");
					await copyFile(configPath, backupAbs);
					scopeRecord.configBackupSha256 = sha256(readFileSync(backupAbs));
				}
				await writeFile(path.join(backupDir, "BACKUP-MANIFEST.json"), JSON.stringify({
					scope: scopeRecord.id,
					dir: scope.dir,
					at: new Date().toISOString(),
					files: scopeRecord.files.map((f) => ({ relPath: f.relPath, sha256: f.sha256 })),
					sidecarSha256: scopeRecord.sidecar?.backupSha256 ?? null,
				}, null, "\t") + "\n", { mode: 0o600 });

				for (const stagedFile of changedFiles) {
					if (options.forceFailRelPath && stagedFile.relPath === options.forceFailRelPath) {
						throw new Error(`注入的 rename 失败（selftest）: ${stagedFile.relPath}`);
					}
					const targetAbs = path.join(scope.dir, stagedFile.relPath);
					await withTasteLock(targetAbs, async () => {
						await writeFileAtomicTaste(targetAbs, stagedFile.content);
					});
					fsyncDir(path.dirname(targetAbs));
					committedFiles.push({ scopeId: scopeRecord.id, targetAbs, backupAbs: path.join(backupDir, stagedFile.relPath), sha256: sha256(readFileSync(path.join(backupDir, stagedFile.relPath))) });
					log(`[${scopeRecord.id}] 已原子提交 ${stagedFile.relPath} (sha256 ${stagedFile.sha256.slice(0, 12)}…)`);
				}
				scopeRecord.committed = true;
				scopeRecord.backupDir = backupDir;
			}
			result.committed = true;

			// 阶段 5：全部提交成功后，旧 sidecar 就地改名为时间戳备份（绝不 unlink）
			for (const scopeRecord of result.scopes) {
				const scope = scopes.find((s) => s.id === scopeRecord.id);
				if (scopeRecord.sidecar && scopeRecord.committed) {
					const stampShort = stamp;
					const renamed = scopeRecord.sidecar.path + SIDECAR_BACKUP_SUFFIX + stampShort;
					await rename(scopeRecord.sidecar.path, renamed);
					fsyncDir(scope.dir);
					scopeRecord.sidecar.renamedTo = renamed;
					log(`[${scopeRecord.id}] 旧 sidecar 已改名备份: ${renamed}`);
				}
			}

			// 阶段 6：幂等自证——对提交后状态重新 staging，必须 no diff
			for (const scopeRecord of result.scopes) {
				if (!scopeRecord.committed) continue;
				const scope = scopes.find((s) => s.id === scopeRecord.id);
				const reinventory = await inventoryScope(scope.dir, scope, dictionary);
				const restaged = await stageScope(scope, reinventory, path.join(artifactsDir, "staging", `${scopeRecord.id}.idempotency-check`));
				scopeRecord.idempotent = restaged.every((s) => !s.changed) && reinventory.failures.length === 0;
				if (!scopeRecord.idempotent) throw new Error(`幂等校验失败: ${scopeRecord.id}`);
				log(`[${scopeRecord.id}] 幂等自证通过（二次 staging 无差异）`);
			}
			result.status = "committed";
		} catch (commitError) {
			// 回滚：按备份逐文件恢复并校验 sha256
			log(`提交失败，开始回滚: ${commitError?.message ?? commitError}`);
			let rollbackErrors = [];
			for (const item of committedFiles.reverse()) {
				try {
					const backupBytes = readFileSync(item.backupAbs);
					if (sha256(backupBytes) !== item.sha256) throw new Error(`备份 sha256 与提交前不一致: ${item.targetAbs}`);
					await withTasteLock(item.targetAbs, async () => {
						await writeFileAtomicTaste(item.targetAbs, backupBytes.toString("utf8"));
					});
					fsyncDir(path.dirname(item.targetAbs));
					log(`已回滚 ${item.targetAbs}`);
				} catch (rollbackError) {
					rollbackErrors.push(`${item.targetAbs}: ${rollbackError?.message ?? rollbackError}`);
				}
			}
			result.rolledBack = rollbackErrors.length === 0;
			result.rollbackErrors = rollbackErrors;
			result.status = result.rolledBack ? "commit-failed-rolled-back" : "commit-failed-ROLLBACK-INCOMPLETE";
			result.commitError = String(commitError?.message ?? commitError);
			result.finishedAt = new Date().toISOString();
			const failurePath = path.join(artifactsDir, "reports", "failure-list.json");
			await writeFile(failurePath, JSON.stringify({ generatedAt: result.finishedAt, kind: "commit-failure", error: result.commitError, rollbackErrors, committedFiles: committedFiles.map((c) => c.targetAbs) }, null, "\t") + "\n", { mode: 0o600 });
			result.failureListPath = failurePath;
			await writeFile(path.join(artifactsDir, "reports", "manifest.json"), JSON.stringify(result, null, "\t") + "\n", { mode: 0o600 });
			result.manifestPath = path.join(artifactsDir, "reports", "manifest.json");
			return result;
		}

		result.finishedAt = new Date().toISOString();
		await writeFile(path.join(artifactsDir, "reports", "manifest.json"), JSON.stringify(result, null, "\t") + "\n", { mode: 0o600 });
		const failurePath = path.join(artifactsDir, "reports", "failure-list.json");
		await writeFile(failurePath, JSON.stringify({ generatedAt: result.finishedAt, mode: result.mode, scopes: [], note: "无失败" }, null, "\t") + "\n", { mode: 0o600 });
		result.manifestPath = path.join(artifactsDir, "reports", "manifest.json");
		result.failureListPath = failurePath;
		log(`全部 scope 提交完成。manifest: ${result.manifestPath}`);
		return result;
	} finally {
		for (const lockPath of lockPaths) {
			try {
				await rm(lockPath, { force: true });
			} catch {
				/* best effort */
			}
		}
	}
}

/* ------------------------------------------------------------------ */
/* selftest：临时目录 fixture（§10.6 迁移 fixture 最小集）               */
/* ------------------------------------------------------------------ */

async function selftest() {
	const os2 = await import("node:os");
	const { mkdtempSync } = await import("node:fs");
	const root = mkdtempSync(path.join(os2.tmpdir(), "dsh-taste-migration-selftest-"));
	const outcomes = [];
	const check = (name, ok, detail = "") => outcomes.push({ name, ok, detail });

	// F1 sidecar 不全匹配 → 失败并保留旧文件
	{
		const dir = path.join(root, "f1", ".dsh", "taste");
		mkdirSync(dir, { recursive: true });
		const old = "- Alpha preference line one. Confidence: 0.9\n- Beta preference line two. Confidence: 1\n";
		writeFileSyncHelper(path.join(dir, "taste.md"), old);
		writeFileSyncHelper(path.join(dir, SIDECAAR_FILENAME), JSON.stringify({ [normalizePreferenceKey("Alpha preference line one.")]: "第一条偏好（中文）。" }, null, "\t"));
		const r = await runMigration({ globalDir: path.join(root, "f1", "none"), projectDir: dir, artifactsRoot: root, apply: true, onLog: () => {} });
		const kept = readFileSync(path.join(dir, "taste.md"), "utf8") === old;
		check("F1 sidecar 不全匹配 → scope 失败且旧文件逐字节保留", r.status === "staging-failed" && kept && r.scopes[1].failures.some((f) => f.kind === "translation-failed"), `status=${r.status} kept=${kept}`);
	}

	// F2 幽灵键 → 失败
	{
		const dir = path.join(root, "f2", ".dsh", "taste");
		mkdirSync(dir, { recursive: true });
		writeFileSyncHelper(path.join(dir, "taste.md"), "- Gamma preference line. Confidence: 0.8\n");
		writeFileSyncHelper(path.join(dir, SIDECAAR_FILENAME), JSON.stringify({ [normalizePreferenceKey("Gamma preference line.")]: "第三条（中文）。", [normalizePreferenceKey("ghost key with no entry")]: "幽灵" }, null, "\t"));
		const r = await runMigration({ globalDir: path.join(root, "f2", "none"), projectDir: dir, artifactsRoot: root, apply: true, onLog: () => {} });
		const kept = readFileSync(path.join(dir, "taste.md"), "utf8").includes("Gamma preference line. Confidence: 0.8");
		check("F2 幽灵键 → 失败保留旧文件", r.status === "staging-failed" && kept && r.scopes[1].failures.some((f) => f.kind === "ghost-sidecar-key"), `status=${r.status}`);
	}

	// F3 规范化碰撞 → 失败
	{
		const dir = path.join(root, "f3", ".dsh", "taste");
		mkdirSync(dir, { recursive: true });
		writeFileSyncHelper(path.join(dir, "taste.md"), "- Same taste statement. Confidence: 0.8\n- Same, taste statement! Confidence: 0.9\n");
		const r = await runMigration({ globalDir: path.join(root, "f3", "none"), projectDir: dir, artifactsRoot: root, apply: true, onLog: () => {} });
		check("F3 规范化碰撞 → 失败", r.status === "staging-failed" && r.scopes[1].failures.some((f) => f.kind === "normalized-collision"), `status=${r.status}`);
	}

	// F4 一级 category + 提交 + sidecar 改名 + 幂等
	{
		const dir = path.join(root, "f4", ".dsh", "taste");
		mkdirSync(path.join(dir, "tools"), { recursive: true });
		const rootOld = "- Delta root preference. Confidence: 0.9\n";
		const catOld = "- Epsilon tool preference. Confidence: 1\n";
		writeFileSyncHelper(path.join(dir, "taste.md"), rootOld);
		writeFileSyncHelper(path.join(dir, "tools", "taste.md"), catOld);
		writeFileSyncHelper(path.join(dir, SIDECAAR_FILENAME), JSON.stringify({
			[normalizePreferenceKey("Delta root preference.")]: "根偏好（中文）。",
			[normalizePreferenceKey("Epsilon tool preference.")]: "工具偏好（中文）。",
		}, null, "\t"));
		const r1 = await runMigration({ globalDir: path.join(root, "f4", "none"), projectDir: dir, artifactsRoot: root, apply: true, onLog: () => {} });
		const migratedRoot = readFileSync(path.join(dir, "taste.md"), "utf8");
		const migratedCat = readFileSync(path.join(dir, "tools", "taste.md"), "utf8");
		const sidecarRenamed = readdirSync(dir).some((name) => name.startsWith(SIDECAAR_FILENAME + SIDECAR_BACKUP_SUFFIX));
		const sidecarGone = !existsSync(path.join(dir, SIDECAAR_FILENAME));
		const backupExists = existsSync(path.join(r1.scopes[1].backupDir ?? "definitely-missing", "tools", "taste.md"));
		const r2 = await runMigration({ globalDir: path.join(root, "f4", "none"), projectDir: dir, artifactsRoot: root, apply: true, onLog: () => {} });
		check(
			"F4 一级 category 提交/sidecar 改名备份/幂等 no-op",
			r1.status === "committed" && migratedRoot.trim() === "- 根偏好（中文）。 Confidence: 0.90" && migratedCat.trim() === "- 工具偏好（中文）。 Confidence: 1.00" && sidecarGone && backupExists && r2.scopes[1].status === "no-op" && r2.committed === true,
			`status=${r1.status} error=${r1.commitError ?? ""} root=${JSON.stringify(migratedRoot.trim())} cat=${JSON.stringify(migratedCat.trim())} sidecarGone=${sidecarGone} renamedProbe=${sidecarRenamed} r2=${r2.scopes[1].status}`,
		);
	}

	// F5 提交中途失败 → staging 回滚
	{
		const dir = path.join(root, "f5", ".dsh", "taste");
		mkdirSync(path.join(dir, "cat"), { recursive: true });
		const a = "- Zeta first preference. Confidence: 0.9\n";
		const b = "- Eta second preference. Confidence: 1\n";
		writeFileSyncHelper(path.join(dir, "taste.md"), a);
		writeFileSyncHelper(path.join(dir, "cat", "taste.md"), b);
		writeFileSyncHelper(path.join(dir, SIDECAAR_FILENAME), JSON.stringify({
			[normalizePreferenceKey("Zeta first preference.")]: "第一条（中文）。",
			[normalizePreferenceKey("Eta second preference.")]: "第二条（中文）。",
		}, null, "\t"));
		const r = await runMigration({ globalDir: path.join(root, "f5", "none"), projectDir: dir, artifactsRoot: root, apply: true, forceFailRelPath: "cat/taste.md", onLog: () => {} });
		const restoredA = readFileSync(path.join(dir, "taste.md"), "utf8") === a;
		const restoredB = readFileSync(path.join(dir, "cat", "taste.md"), "utf8") === b;
		check(
			"F5 rename 失败 → 按 manifest/hash 回滚已提交文件",
			r.status === "commit-failed-rolled-back" && r.rolledBack === true && restoredA && restoredB,
			`status=${r.status} rolledBack=${r.rolledBack} a=${restoredA} b=${restoredB}`,
		);
	}

	console.log("== selftest ==");
	for (const o of outcomes) console.log(`${o.ok ? "PASS" : "FAIL"}  ${o.name}${o.detail ? `  [${o.detail}]` : ""}`);
	const failed = outcomes.filter((o) => !o.ok).length;
	console.log(`selftest: ${outcomes.length - failed}/${outcomes.length} PASS; sandbox: ${root}`);
	await rm(path.join(root, "f1", ".dsh"), { recursive: true, force: true }).catch(() => {});
	if (failed > 0) process.exitCode = 1;
}

function writeFileSyncHelper(filePath, content) {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSyncRaw(filePath, content);
}
import { writeFileSync as writeFileSyncRaw } from "node:fs";

/* ------------------------------------------------------------------ */
/* CLI 入口                                                             */
/* ------------------------------------------------------------------ */

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--selftest")) {
		await selftest();
		return;
	}
	const option = (name, fallback) => {
		const i = args.indexOf(name);
		return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
	};
	const globalDir = option("--global-dir", path.join(os.homedir(), ".dsh", "taste"));
	const projectDir = option("--project-dir", path.join(process.cwd(), ".dsh", "taste"));
	const apply = args.includes("--apply");
	const result = await runMigration({
		globalDir,
		projectDir,
		artifactsRoot: option("--artifacts-root", null),
		apply,
	});
	console.log("== 中文单轨迁移事务 ==");
	console.log(`模式: ${result.status} (${result.mode})`);
	console.log(`一次性产物目录: ${result.artifactsDir}`);
	console.log(`manifest: ${result.manifestPath ?? "(未生成)"}`);
	console.log(`失败清单: ${result.failureListPath ?? "(无失败)"}`);
	for (const s of result.scopes) {
		console.log(`scope[${s.id}] ${s.dir} → ${s.status}（文件 ${s.files.length}，失败 ${s.failures.length}）`);
		for (const f of s.failures) console.log(`  - [${f.kind}] ${f.detail}`);
	}
	for (const c of result.commandCode) {
		console.log(`commandCode ${c.base} → ${c.found ? (c.files?.map((f) => `${f.entryCount}条/${f.englishEntries}英文`).join("; ") ?? "未发现") : "未发现"}${c.status ? "" : ""}${c.files ? "" : ""}`);
	}
	if (result.status === "staging-failed") process.exitCode = 2;
	else if (result.status === "commit-failed-ROLLBACK-INCOMPLETE") process.exitCode = 3;
	else if (result.status === "commit-failed-rolled-back") process.exitCode = 3;
}

main().catch((error) => {
	console.error("迁移事务异常终止:", error);
	process.exitCode = 1;
});
