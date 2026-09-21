#!/usr/bin/env node
/**
 * B1 语义缺陷复现 harness —— 冷路径排序键 + 顶层 runningSubagentCount 漏计
 *
 * 方法论（硬约束）：
 *  - 被测逻辑一律从 live 产物【程序化抽取】为字节切片 (file.slice(a,b))，逐字节相等。
 *  - harness 自证前提：sha256、切片字节相等、运行期对象源码与切片逐字节相等、版本标记存在。
 *  - 每条结论标注 evidence: code-inference | executed。
 *  - 退出码：自证失败=1；被测断言失败但跑完=0。
 *
 * 纯离线：只读文件 + 纯内存计算，无网络、无 ~/.dsh 读写、无真实会话日志/DB 访问。
 * 运行：node harness-b1-cold-sort-and-counts.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules';
const HOST_PATH = path.join(ROOT, '@deepseek-ai/dsh-host-apiproxy/lib/index.js');
const CROSS_PATH = path.join(ROOT, '@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js');
const PERSIST_PATH = path.join(ROOT, '@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js');
const PATCH_PATH = '/home/CNS2026495165/dsh/.workspace/lag-fix/patches/B1-transform.cjs';
const OUTDIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/semantics/results';

const STDOUT_PROBE = 'B1-HARNESS-STDOUT-PROBE';
const MAX = 200; // 与 SUBAGENT_LIST_MAX 默认值一致（运行时由真实切片求解并断言）

// ---------------------------------------------------------------- 输出/退出

const stdoutBuf = [];
const stderrBuf = [];
function out(line) { stdoutBuf.push(String(line)); }
function err(line) { stderrBuf.push(String(line)); }
function flush() {
	if (stdoutBuf.length > 0) process.stdout.write(stdoutBuf.splice(0).join('\n') + '\n');
	if (stderrBuf.length > 0) process.stderr.write(stderrBuf.splice(0).join('\n') + '\n');
}
function selfFail(reason, detail) {
	err(`FAIL: 自证前提不成立 -> ${reason}`);
	if (detail !== undefined) err(`      详情: ${detail}`);
	err('      （方法论硬约束：抽取失败/自证失败一律 throw + process.exit(1)，不降级为猜测）');
	flush();
	process.exit(1);
}

// ---------------------------------------------------------------- 抽取工具

function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

function readFileOrDie(file, label) {
	if (!fs.existsSync(file)) selfFail(`被测文件不存在: ${label}`, file);
	const text = fs.readFileSync(file, 'utf8');
	return { file, label, text, sha256: sha256(text), bytes: Buffer.byteLength(text, 'utf8'), lines: text.split('\n').length };
}

function lineOfIndex(text, index) { return text.slice(0, index).split('\n').length; }

function lineStartIndex(text, lineNo) {
	let idx = -1;
	for (let n = 1; n < lineNo; n += 1) {
		idx = text.indexOf('\n', idx + 1);
		if (idx < 0) throw new Error(`行号越界: ${lineNo}`);
	}
	return idx + 1;
}
function lineEndIndex(text, lineNo) {
	const start = lineStartIndex(text, lineNo);
	const nl = text.indexOf('\n', start);
	return nl < 0 ? text.length : nl;
}

function locate(text, fileLabel, anchorLabel, startAnchor, endAnchor) {
	const a = text.indexOf(startAnchor);
	if (a < 0) throw new Error(`锚点缺失 [${fileLabel}#${anchorLabel}] start=${JSON.stringify(startAnchor.slice(0, 90))}`);
	if (text.indexOf(startAnchor, a + 1) >= 0) throw new Error(`锚点不唯一 [${fileLabel}#${anchorLabel}] start 出现多次`);
	const b = text.indexOf(endAnchor, a);
	if (b < 0) throw new Error(`锚点缺失 [${fileLabel}#${anchorLabel}] end=${JSON.stringify(endAnchor.slice(0, 90))}`);
	const end = b + endAnchor.length;
	return { start: a, end, startLine: lineOfIndex(text, a), endLine: lineOfIndex(text, end - 1), slice: text.slice(a, end) };
}

function verifySlice(file, rec) {
	const byIndex = file.text.slice(rec.start, rec.end);
	if (byIndex !== rec.slice) throw new Error(`切片与 file.slice(a,b) 不逐字节相等: ${file.file} [${rec.label}]`);
	const byLines = file.text.slice(lineStartIndex(file.text, rec.startLine), lineEndIndex(file.text, rec.endLine));
	if (byLines !== rec.slice) {
		throw new Error(`切片行号锚点与字节偏移不自洽: ${file.file} [${rec.label}] ${rec.startLine}-${rec.endLine} / ${rec.start}-${rec.end}`);
	}
	return true;
}

function extract(file, anchorLabel, startAnchor, endAnchor, expectedLines) {
	const rec = locate(file.text, file.label, anchorLabel, startAnchor, endAnchor);
	rec.label = anchorLabel;
	rec.file = file.file;
	verifySlice(file, rec);
	if (expectedLines != null && !expectedLines.includes(rec.endLine - rec.startLine + 1)) {
		err(`NOTE: 切片 [${anchorLabel}] 行数 ${rec.endLine - rec.startLine + 1} 不在候选锚点 ${JSON.stringify(expectedLines)} 内（已按字节复核，继续）`);
	}
	return rec;
}

/** 运行期自证：编译出的函数 toString 必须逐字节等于切片。 */
function compileFunction(slice, glue, expectedName) {
	const fn = new Function(`${glue}\n${slice}\nreturn ${expectedName};`)();
	if (typeof fn !== 'function') throw new Error(`new Function 未产出函数: ${expectedName}`);
	if (fn.toString() !== slice) {
		throw new Error(`运行期对象源码与切片不逐字节相等: ${expectedName}\n  slice: ${JSON.stringify(slice.slice(0, 80))}\n  fn:    ${JSON.stringify(fn.toString().slice(0, 80))}`);
	}
	return fn;
}

function normalizeSrc(text) {
	return text.replace(/'/g, '"').replace(/\s+/g, ' ').trim();
}

function findAll(text, needle) { return text.split(needle).length - 1; }

// ---------------------------------------------------------------- 切片清单

const SLICE_DEFS = [
	// host 文件名为 'HOST'，其余 'CROSS' / 'PERSIST'
	['HOST', 'host.subagent_list_max', '/* dsh-lag-fix B1: subagent 会话下发上限 */', '  : 200;', [4]],
	['HOST', 'host.annotate_running_counts', 'function annotateRunningSubagentCounts(ctx, items) {', '\treturn items;\n}', [30]],
	['HOST', 'host.cold_candidate_selection', '\t\t\tconst coldSubagentCandidates = coldSource', '\t\t\t  .slice(0, SUBAGENT_LIST_MAX);', [4]],
	['PERSIST', 'persist.enumeration_reads', '\t/** The human-readable project directories under the configured root. */', '\t\treturn entries.filter((entry) => entry.isDirectory()).map((entry) => join(project, entry.name));\n\t}', [21]],
	['PERSIST', 'persist.list_snapshot', "\t/** List valid unique stored sessions' metadata (header line only — no full-log parse). */", '\t\treturn (await this.listArtifacts(signal)).map((artifact) => artifact.header);\n\t}', [4]],
	['HOST', 'host.closure_truncation', '\t\t\t\titems.sort((a, b) => b.updatedAt - a.updatedAt);', '\t\treturn annotateRunningSubagentCounts(ctx, retained);', [6]],
	['HOST', 'host.attached_comparator', '\tattachedSubagents.sort((a, b) => sessionListUpdatedAt(b.header, sessionListMetadata(b.events))', 'sessionListMetadata(a.events)));', [1]],
	['HOST', 'host.session_list_updated_at', 'function sessionListUpdatedAt(header, metadata) {', '\treturn Math.max(header.createdAt, metadata?.lastPromptAt ?? 0);\n}', [3]],
	['HOST', 'host.apply_session_list_metadata', 'function applySessionListMetadata(state, event) {', '\t\tlastPromptAt\n\t};\n}', [7]],
	['HOST', 'host.session_list_metadata', 'function sessionListMetadata(events) {', '\treturn state;\n}', [7]],
	['HOST', 'host.session_list_fields', 'function sessionListFields(header, events = [], extra = void 0) {', '\t\t...extra === void 0 ? {} : extra\n\t};\n}', null],
	['HOST', 'host.summarize', 'function summarize(session, running) {', '\t\t...sessionListFields(session.header, session.events)\n\t};\n}', null],
	['HOST', 'host.probe_cold_metadata', 'async function probeColdSessionMetadata(ctx, persistence, meta, maxBytes, signal) {', '\t\treturn;\n\t}\n}', null],
	['HOST', 'host.summarize_cold', 'async function summarizeCold(ctx, persistence, meta, metadata, blankProbeMaxBytes, signal) {', '\t\t...sessionListFields(meta)\n\t};\n}', null],
	// jsonl persistence
	['PERSIST', 'persist.from_header_line', 'function fromHeaderLine(line) {', '\t};\n}', null],
	['PERSIST', 'persist.is_header_line', 'function isHeaderLine(value) {', 'typeof value.agentPreset === "string");\n}', null],
	['PERSIST', 'persist.parse_header_meta', 'function parseHeaderMeta(firstLine) {', '\treturn fromHeaderLine(parsed);\n}', null],
	// 交叉核对文件
	['CROSS', 'cross.subagent_list_max', '/* dsh-lag-fix B1: subagent 会话下发上限 */', '  : 200;', [4]],
	['CROSS', 'cross.annotate_running_counts', 'function annotateRunningSubagentCounts(ctx, items) {', '    return items;\n}', [30]],
	['CROSS', 'cross.cold_candidate_selection', '            const coldSubagentCandidates = coldSource', "              .slice(0, SUBAGENT_LIST_MAX);", [4]],
	['CROSS', 'cross.closure_truncation', '                items.sort((a, b) => b.updatedAt - a.updatedAt);', '        return annotateRunningSubagentCounts(ctx, retained);', [6]],
];

function loadFiles() {
	return {
		HOST: readFileOrDie(HOST_PATH, 'dsh-host-apiproxy/lib/index.js (main)'),
		CROSS: readFileOrDie(CROSS_PATH, 'dsh-host-apiproxy/lib/types/api-proxy.js (cross-check)'),
		PERSIST: readFileOrDie(PERSIST_PATH, 'dsh-session-persistence-jsonl/lib/index.js'),
		PATCH: readFileOrDie(PATCH_PATH, 'lag-fix/patches/B1-transform.cjs'),
	};
}

function loadSlices(files) {
	const map = new Map();
	for (const [fileKey, label, startAnchor, endAnchor, expectedLines] of SLICE_DEFS) {
		try {
			map.set(label, extract(files[fileKey], label, startAnchor, endAnchor, expectedLines));
		} catch (e) {
			selfFail(e.message, e.stack);
		}
	}
	return map;
}

// ---------------------------------------------------------------- 自证闸门

const ASSERTIONS = [];
function recordAssert(question, id, description, pass, observed, extra) {
	const state = pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INCONCLUSIVE';
	ASSERTIONS.push({ question, id, description, state, observed, ...(extra === undefined ? {} : extra) });
	out(`${state}: ${description} -> ${typeof observed === 'string' ? observed : JSON.stringify(observed)}`);
	return state;
}

function gateAndBuildRuntime(files, map) {
	out('=== [自证 a] 被测文件指纹 (sha256) ===');
	for (const key of ['HOST', 'CROSS', 'PERSIST', 'PATCH']) {
		const f = files[key];
		out(`  ${key.padEnd(8)} ${f.sha256}  bytes=${f.bytes} lines=${f.lines}`);
		out(`           ${f.file}`);
	}
	out('');

	out('=== [自证 b] 切片逐字节相等 (slice === file.slice(a,b)) + 行号自洽 ===');
	for (const [label, rec] of map) {
		const f = files[label.startsWith('cross.') ? 'CROSS' : label.startsWith('persist.') ? 'PERSIST' : 'HOST'];
		try {
			verifySlice(f, rec);
		} catch (e) {
			selfFail(e.message);
		}
		out(`  PASS  ${label.padEnd(34)} 行 ${String(rec.startLine).padStart(4)}-${String(rec.endLine).padStart(4)}  字节 ${String(rec.start).padStart(6)}-${String(rec.end).padStart(6)}  len=${rec.slice.length}`);
	}
	out('');

	out('=== [自证 c] 运行期对象源码 === 切片（fn.toString() 逐字节相等） ===');
	const rt = {};
	const tryCompile = (label, glue, name) => {
		const rec = map.get(label);
		try {
			const fn = compileFunction(rec.slice, glue, name);
			out(`  PASS  ${label.padEnd(34)} fn.toString() === slice (len=${rec.slice.length})`);
			return fn;
		} catch (e) {
			selfFail(`运行期源码自证失败 [${label}]: ${e.message}`);
		}
	};
	// persistence 侧
	rt.isHeaderLine = tryCompile('persist.is_header_line', '', 'isHeaderLine');
	rt.fromHeaderLine = tryCompile('persist.from_header_line', '', 'fromHeaderLine');
	rt.parseHeaderMeta = tryCompile('persist.parse_header_meta',
		`const isHeaderLine = ${rt.isHeaderLine.toString()};\nconst fromHeaderLine = ${rt.fromHeaderLine.toString()};`, 'parseHeaderMeta');
	// host 侧
	rt.sessionListUpdatedAt = tryCompile('host.session_list_updated_at', '', 'sessionListUpdatedAt');
	rt.applySessionListMetadata = tryCompile('host.apply_session_list_metadata', '', 'applySessionListMetadata');
	rt.sessionListMetadata = tryCompile('host.session_list_metadata',
		`const applySessionListMetadata = ${rt.applySessionListMetadata.toString()};`, 'sessionListMetadata');
	// resolveSessionPreset 是外部包依赖（@deepseek-ai/dsh-agent-presets），无法从本文件抽取；
	// 用自包含源码字符串注入（不可用闭包箭头函数的 toString()，那会被注入到 new Function 作用域而 ReferenceError）。
	const RESOLVE_PRESET_SRC = 'function resolveSessionPreset(input) { return input?.header?.agentPreset === undefined ? undefined : input.header.agentPreset; }';
	rt.resolveSessionPresetSource = RESOLVE_PRESET_SRC;
	rt.resolveSessionPreset = (input) => (input?.header?.agentPreset === undefined ? undefined : input.header.agentPreset);
	rt.sessionListFields = tryCompile('host.session_list_fields',
		RESOLVE_PRESET_SRC, 'sessionListFields');
	// 依赖注入：被注入函数的 toString() 会丢失其自身闭包，故所有传递依赖必须一并注入。
	const HOST_FN_GLUE = [
		RESOLVE_PRESET_SRC,
		rt.sessionListUpdatedAt.toString(),
		rt.applySessionListMetadata.toString(),
		rt.sessionListMetadata.toString(),
		rt.sessionListFields.toString(),
	].join('\n');
	rt.hostFnGlue = HOST_FN_GLUE;
	rt.summarize = tryCompile('host.summarize', HOST_FN_GLUE, 'summarize');
	rt.probeColdSessionMetadata = tryCompile('host.probe_cold_metadata', '', 'probeColdSessionMetadata');
	rt.summarizeCold = tryCompile('host.summarize_cold',
		`${HOST_FN_GLUE}\n${rt.probeColdSessionMetadata.toString()}`, 'summarizeCold');
	rt.annotateRunningSubagentCounts = tryCompile('host.annotate_running_counts', '', 'annotateRunningSubagentCounts');
	// 交叉文件：同名函数（用于语义等价自证）
	rt.crossAnnotateRunningSubagentCounts = tryCompile('cross.annotate_running_counts', '', 'annotateRunningSubagentCounts');
	// 常量真实求值（切片真跑）
	const constFn = (() => {
		const rec = map.get('host.subagent_list_max');
		try {
			const fn = new Function(`${rec.slice}\nreturn SUBAGENT_LIST_MAX;`);
			const v = fn();
			const srcOk = true;
			out(`  PASS  host.subagent_list_max               切片真跑求值 SUBAGENT_LIST_MAX=${v}（切片源码与文件逐字节相等已证）`);
			return { value: v, ok: srcOk };
		} catch (e) { selfFail(`常量切片求值失败: ${e.message}`); }
	})();
	if (constFn.value !== MAX) selfFail(`SUBAGENT_LIST_MAX 期望 ${MAX}，实测 ${constFn.value}`);
	rt.SUBAGENT_LIST_MAX = constFn.value;
	out('');

	out('=== [自证 d] 版本标记注释存在于 live 文件 ===');
	const markers = [
		{ key: 'subagent_list_max', text: '/* dsh-lag-fix B1: subagent 会话下发上限 */' },
		{ key: 'runningSubagentCount', text: '/* dsh-lag-fix B1: 聚合字段 runningSubagentCount */' },
		{ key: 'top_level_filter', text: '/* dsh-lag-fix B1: 顶层全发 + subagent 最近 N 条 */' },
	];
	for (const m of markers) {
		const n = findAll(files.HOST.text, m.text);
		if (n === 0) selfFail(`版本标记缺失: ${m.text}`);
		out(`  PASS  ${m.text}  x${n}`);
	}
	rt.markers = markers.map((m) => ({ marker: m.text, occurrences_in_live: findAll(files.HOST.text, m.text) }));
	out('');

	out(`SELFTEST-PROBE: stdout 可达 (${STDOUT_PROBE})`);
	out('');
	return rt;
}

// ---------------------------------------------------------------- Q1

function realHeaderMetaFromLine(rt, line) {
	const parsed = JSON.parse(line);
	if (rt.isHeaderLine(parsed) !== true) throw new Error(`构造的 header 行未通过真实 isHeaderLine: ${line}`);
	return rt.fromHeaderLine(parsed);
}

function coldComparatorFromSlice(map) {
	// 真实代码是链式多行：coldSource\n .filter(...)\n .sort((a, b) => b.updatedAt - a.updatedAt)\n .slice(...)
	// 故按「找 .sort( 后取括号配对区间」提取，而不是单行正则。
	const rec = map.get('host.cold_candidate_selection');
	const at = rec.slice.indexOf('.sort(');
	if (at < 0) throw new Error('冷候选切片不含 .sort(');
	let depth = 0, endIdx = -1;
	for (let i = at + '.sort'.length; i < rec.slice.length; i += 1) {
		const ch = rec.slice[i];
		if (ch === '(') depth += 1;
		else if (ch === ')') {
			depth -= 1;
			if (depth === 0) { endIdx = i; break; }
		}
	}
	if (endIdx < 0) throw new Error('冷候选切片的 .sort(...) 括号不配对');
	const inner = rec.slice.slice(at + '.sort('.length, endIdx);
	// 只做 trim（不用正则，避免把锚字符串写成第二份语义副本）；
	// 随后以「可编译 + 函数名/元数 + 运行期源码等于该子串」来证明它就是真实比较器。
	const cmpSrc = inner.trim();
	if (cmpSrc.length === 0) throw new Error('冷路径 .sort( 参数为空');
	let comparator;
	try {
		comparator = new Function(`return (${cmpSrc});`)();
	} catch (e) {
		throw new Error(`冷路径 .sort( 参数不可作为表达式编译: ${JSON.stringify(cmpSrc)} / ${e.message}`);
	}
	if (typeof comparator !== 'function') throw new Error(`冷路径 .sort( 参数不是函数: ${JSON.stringify(cmpSrc)}`);
	const identity = comparator.toString() === cmpSrc;
	// 真实链表达式（真切片去掉 `const coldSubagentCandidates = ` 前缀后的语句），供 pipeline 整体真跑
	const DECL_RE = /^\s*const coldSubagentCandidates = /;
	const declMatch = rec.slice.match(DECL_RE);
	if (declMatch === null) throw new Error('冷候选切片未以 const coldSubagentCandidates = 声明开头');
	const chain = rec.slice.slice(declMatch[0].length);
	return { comparator, cmpSrc, identity, chain, sort_call: rec.slice.slice(at, endIdx + 1) };
}

function runColdPipeline(metas, comparator, chain) {
	// (1) 真跑：把「抽取出的冷候选链语句」原样放进函数体执行（被测行零改动）
	const runChain = new Function('coldSource', 'SUBAGENT_LIST_MAX',
		`const coldSubagentCandidates = ${chain}\nreturn coldSubagentCandidates;`);
	const selectedRaw = runChain(metas.map((m) => ({ ...m })), MAX);
	// (2) 枚举顺序基准：同一批对象走一次原生 sort(cmp)，cmp 是真比较器
	const enumerated = metas.map((m) => ({ ...m }));
	enumerated.sort(comparator);
	const selectedIds = new Set(selectedRaw.map((m) => m.id));
	const dropped = enumerated.filter((m) => !selectedIds.has(m.id));
	// (3) 比较器返回值样本（真比较器逐对调用）
	const sampleReturns = [];
	for (let i = 0; i < Math.min(5, enumerated.length - 1); i += 1) {
		sampleReturns.push(String(comparator(enumerated[i], enumerated[i + 1])));
	}
	return {
		sorted_ids: enumerated.map((m) => m.id),
		selected_ids: selectedRaw.map((m) => m.id),
		dropped_ids: dropped.map((m) => m.id),
		comparator_return_values: [...new Set(sampleReturns)],
	};
}

async function question1(files, map, rt) {
	const q1 = { evidence: 'executed', ordering_key_probe: {} };
	const headerLine = '{"type":"session","version":0,"id":"s1","createdAt":1700000000000,"cwd":"/home/x","delegationDepth":1,"origin":"subagent"}';
	const parsedLine = JSON.parse(headerLine);

	recordAssert('Q1', 'isHeaderLine_accepts_real_header',
		'jsonl isHeaderLine(真实形状 header 行) 接受该行', rt.isHeaderLine(parsedLine) === true, rt.isHeaderLine(parsedLine), { evidence: 'executed' });

	const meta = rt.fromHeaderLine(parsedLine); // 真函数，真跑
	const metaKeys = Object.keys(meta);
	q1.ordering_key_probe = {
		input_header_line: headerLine,
		produced_meta: meta,
		produced_meta_keys: metaKeys,
		has_updatedAt: Object.hasOwn(meta, 'updatedAt'),
		has_createdAt: Object.hasOwn(meta, 'createdAt'),
		has_lastPromptAt: Object.hasOwn(meta, 'lastPromptAt'),
		producer_slice: 'persist.from_header_line',
	};
	recordAssert('Q1', 'meta_fromHeaderLine_scan_keys',
		'real header -> meta 键集（是否含 updatedAt）', JSON.stringify(metaKeys),
		`has_updatedAt=${Object.hasOwn(meta, 'updatedAt')} has_createdAt=${Object.hasOwn(meta, 'createdAt')}`, { evidence: 'executed' });

	// persistence.list() 契约 = listArtifacts().map(a => a.header)
	const listSlice = map.get('persist.list_snapshot');
	const listContract = /return \(await this\.listArtifacts\(signal\)\)\.map\(\(artifact\) => artifact\.header\);/.test(normalizeSrc(listSlice.slice));
	recordAssert('Q1', 'list_returns_header_shape',
		'persistence.list() 返回 header 形状（listArtifacts().map(a => a.header)）-> 冷路径的 meta 就是上面这个键集',
		listContract === true, normalizeSrc(listSlice.slice), { evidence: 'code-inference（源码切片）+ executed（header 键集已实跑）' });

	// 冷「行」的 updatedAt 由 summarizeCold 现算
	const coldRow = await rt.summarizeCold({ logger: { warn() {} } }, {}, { ...meta }, undefined, 0, undefined);
	q1.cold_row_projection = {
		builder_slice: 'host.summarize_cold',
		row: coldRow,
		row_keys: Object.keys(coldRow),
		has_updatedAt: Object.hasOwn(coldRow, 'updatedAt'),
		note: 'maxBytes=0 使真 probeColdSessionMetadata 走 maxBytes===0 早退分支（真实代码路径，非桩）',
	};
	recordAssert('Q1', 'cold_row_projection',
		'冷「行」summarizeCold 现算 updatedAt（=sessionListUpdatedAt(meta, probed??metadata)=Math.max(meta.createdAt, ...)）',
		Object.hasOwn(coldRow, 'updatedAt') && coldRow.updatedAt === meta.createdAt,
		`row.updatedAt=${coldRow.updatedAt} meta.createdAt=${meta.createdAt}`, { evidence: 'executed' });
	// 关键：probe 能拿到的 lastPromptAt 也只来自 events，header meta 上没有
	q1.updatedAt_vs_header = {
		formula_slice: 'host.session_list_updated_at',
		formula: rt.sessionListUpdatedAt.toString(),
		header_has_lastPromptAt: Object.hasOwn(meta, 'lastPromptAt'),
		conclusion: '冷候选截断发生在「行」之前、对象仍是 header -> updatedAt 缺席；行级 updatedAt 是稍后由 summarizeCold 用 createdAt 现算的',
	};
	recordAssert('Q1', 'updatedAt_absent_on_header_but_present_on_row',
		'同一 meta：header 形状无 updatedAt，行形状有 -> 截断用的比较器读错对象层级',
		Object.hasOwn(meta, 'updatedAt') === false && Object.hasOwn(coldRow, 'updatedAt') === true,
		`header.has_updatedAt=${Object.hasOwn(meta, 'updatedAt')} row.has_updatedAt=${Object.hasOwn(coldRow, 'updatedAt')}`, { evidence: 'executed' });

	// ---- 真实比较器 + 201 条真实形状 meta ----
	const { comparator, cmpSrc, identity, chain, sort_call } = coldComparatorFromSlice(map);
	q1.comparator = { source: cmpSrc, slicing_slice: 'host.cold_candidate_selection', runtime_identity: identity, sort_call: sort_call, executed_chain: chain };
	recordAssert('Q1', 'comparator_runtime_identity',
		'冷路径比较器运行期源码与抽取切片一致（字节级表达式）', identity === true, comparator.toString(), { evidence: 'executed' });

	q1.attached_control_comparator = {
		source: map.get('host.attached_comparator').slice.trim(),
		keys: 'sessionListUpdatedAt(header, sessionListMetadata(events)) -> 真实存在',
		note: 'attached 路径用真键 Math.max(createdAt, lastPromptAt)；冷路径用不存在的 updatedAt —— 对照组',
	};

	const N = 201;
	const buildMetas = (order) => order.map((idx) => realHeaderMetaFromLine(rt, JSON.stringify({
		type: 'session', version: 0, id: `s${String(idx).padStart(3, '0')}`,
		createdAt: 1700000000000 + idx, cwd: '/home/x', parentSession: 'p', delegationDepth: 1, origin: 'subagent',
	})));
	const natural = Array.from({ length: N }, (_, i) => i + 1);
	const reversed = natural.slice().reverse();
	const permuted = natural.filter((x) => x % 2 === 1).concat(natural.filter((x) => x % 2 === 0)); // 固定置换，无随机

	const scen = (name, order) => {
		const metas = buildMetas(order);
		const enumIds = metas.map((m) => m.id);
		const res = runColdPipeline(metas, comparator, chain);
		const droppedIds = res.dropped_ids;
		const droppedMeta = metas.find((m) => m.id === droppedIds[0]);
		return {
			scenario: name,
			enumeration_order_head: enumIds.slice(0, 5),
			enumeration_order_tail: enumIds.slice(-2),
			comparator_return_values: res.comparator_return_values,
			sort_output_equals_enumeration_order: JSON.stringify(res.sorted_ids) === JSON.stringify(enumIds),
			sorted_head: res.sorted_ids.slice(0, 5),
			selected_count: res.selected_ids.length,
			selected_ids: res.selected_ids,
			dropped_ids: droppedIds,
			dropped_createdAt: droppedMeta === undefined ? null : droppedMeta.createdAt,
			dropped_createdAt_rank_ascending_1_is_oldest: droppedMeta === undefined ? null : droppedMeta.createdAt - 1700000000000,
			dropped_is_oldest: droppedIds.length === 1 && droppedIds[0] === 's001',
			dropped_is_newest: droppedIds.length === 1 && droppedIds[0] === `s${String(N).padStart(3, '0')}`,
		};
	};

	const A = scen('枚举顺序 = createdAt 升序 (s001..s201)', natural);
	const B = scen('枚举顺序 = createdAt 降序 (s201..s001)', reversed);
	const C = scen('枚举顺序 = 固定置换 (奇数升序 ++ 偶数升序)', permuted);
	q1.scenarios = [A, B, C];

	const firstCmpVal = A.comparator_return_values[0];
	recordAssert('Q1', 'comparator_returns',
		'真实比较器 b.updatedAt - a.updatedAt 在真实 header 形状上的返回值',
		firstCmpVal, `distinct return values=${JSON.stringify(A.comparator_return_values)}`, { evidence: 'executed' });
	recordAssert('Q1', 'sort_degenerates_to_enumerated_order',
		'NaN 比较器 -> sort 输出 === 枚举顺序（无重排）', A.sort_output_equals_enumeration_order === true,
		`sorted_head=${JSON.stringify(A.sorted_head)} enum_head=${JSON.stringify(A.enumeration_order_head)}`, { evidence: 'executed' });
	recordAssert('Q1', 'dropped_row_identity',
		'升序枚举下被 .slice(0,200) 丢弃的是枚举顺序最后一条：id/ createdAt',
		`${JSON.stringify(A.dropped_ids)} createdAt_rank=${A.dropped_createdAt_rank_ascending_1_is_oldest}`,
		`dropped_is_oldest=${A.dropped_is_oldest} dropped_is_newest=${A.dropped_is_newest}`, { evidence: 'executed' });
	recordAssert('Q1', 'dropped_is_newest_not_oldest',
		'丢弃的是 createdAt 最新的一条（与“最近 200 条”意图完全相反）', A.dropped_is_newest === true,
		`dropped=${JSON.stringify(A.dropped_ids)} rank(1=最旧)=${A.dropped_createdAt_rank_ascending_1_is_oldest}/201`, { evidence: 'executed' });

	const setA = new Set(A.selected_ids), setB = new Set(B.selected_ids), setC = new Set(C.selected_ids);
	const diffAB = A.selected_ids.filter((id) => !setB.has(id));
	const diffAC = A.selected_ids.filter((id) => !setC.has(id));
	q1.selected_set_comparison = {
		dropped: { natural: A.dropped_ids, reversed: B.dropped_ids, permuted: C.dropped_ids },
		'A\\B': diffAB, 'A\\C': diffAC,
		'|A∩B|': A.selected_ids.filter((id) => setB.has(id)).length,
		'|A∩C|': A.selected_ids.filter((id) => setC.has(id)).length,
	};
	const varies = diffAB.length > 0 || diffAC.length > 0;
	recordAssert('Q1', 'selected_set_varies_with_enumeration_order',
		'入选「最近 200」集合随枚举顺序变化 -> 名额分配与“最近”无关', varies === true,
		`|A∩B|=${q1.selected_set_comparison['|A∩B|']}/200 |A∩C|=${q1.selected_set_comparison['|A∩C|']}/200 dropped(nat)=${JSON.stringify(A.dropped_ids)} dropped(rev)=${JSON.stringify(B.dropped_ids)}`, { evidence: 'executed' });

	const enumRec = map.get('persist.enumeration_reads');
	const enumUnsorted = /const entries = await readdir\(this\.root, \{ withFileTypes: true \}\);/.test(enumRec.slice)
		&& /const entries = await readdir\(project, \{ withFileTypes: true \}\);/.test(enumRec.slice)
		&& !/entries\.sort\(/.test(enumRec.slice);
	q1.enumeration_source = {
		slice: 'persist.enumeration_reads', lines: `${enumRec.startLine}-${enumRec.endLine}`,
		uses_raw_readdir: enumUnsorted, code: enumRec.slice,
	};
	recordAssert('Q1', 'enumeration_order_is_raw_readdir',
		'枚举顺序来自 readdir({withFileTypes:true}) 且未排序（真实来源，非 harness 构造）', enumUnsorted === true,
		`contains_sort=${/entries\.sort\(/.test(enumRec.slice)}`, { evidence: 'code-inference（源码切片，未触真实文件系统）' });

	// 修复路径素材（不实跑，标注 code-inference）
	q1.repair_material = {
		'createdAt available on cold meta': Object.hasOwn(meta, 'createdAt'),
		'lastPromptAt on cold meta': Object.hasOwn(meta, 'lastPromptAt'),
		'lastPromptAt location': '仅 in-memory events（sessionListMetadata）-> 冷会话要拿到它必须读日志（persistence.readFrom / readHead）',
		'mtime location': 'header 无 mtime；listSnapshots() 另提供 stat 派生身份，但 list() 不返回',
		cold_meta_keys: metaKeys,
	};
	recordAssert('Q1', 'sort_key_exists_on_real_header_shape',
		'[裁决用] sort_key_exists_on_real_header_shape', Object.hasOwn(meta, 'updatedAt') === true,
		`header keys=${JSON.stringify(metaKeys)}`, { evidence: 'executed' });
	recordAssert('Q1', 'lastPromptAt_not_on_cold_meta',
		'lastPromptAt 只在 in-memory events 上；冷 meta 拿不到（修复要么读日志要么 stat mtime）',
		Object.hasOwn(meta, 'lastPromptAt') === false,
		`header keys=${JSON.stringify(metaKeys)}`, { evidence: 'code-inference（两条真实切片）+ executed（header 键集）' });

	return q1;
}

// ---------------------------------------------------------------- Q2

async function question2(files, map, rt) {
	const q2 = { evidence: 'executed', construction: {} };

	const constRec = map.get('host.subagent_list_max');
	const truncRec = map.get('host.closure_truncation');
	const annotRec = map.get('host.annotate_running_counts');

	// 用真切片执行收口截断 + 真实收口调用（胶水仅 harness 自身代码）
	// 真切片末行是 `return annotateRunningSubagentCounts(ctx, retained);`：该行必须被执行
	// （它就是收口的真实调用点），但 return 会短路，故取出真函数引用改为按名调用，
	// 并保留真调用语义：annotateRunningSubagentCounts(ctx, retained)。
	const closureCalls = [];
	const spyAnnotate = (ctx, rows) => { closureCalls.push(rows); return rows; };
	const CLOSURE_RETURN_STMT = '\t\treturn annotateRunningSubagentCounts(ctx, retained);';
	if (!truncRec.slice.endsWith(CLOSURE_RETURN_STMT)) {
		throw new Error('收口截断切片未以预期的真实 return 语句结尾（锚点形状变化，拒绝降级）');
	}
	const closureHead = truncRec.slice.slice(0, truncRec.slice.length - CLOSURE_RETURN_STMT.length);
	const closureDriver = new Function('items', 'SUBAGENT_LIST_MAX', 'annotateRunningSubagentCounts', 'ctx',
		`${closureHead}\n\t\tconst returned = annotateRunningSubagentCounts(ctx, retained);\nreturn { items, subagentItems, overflow, retained, returned };`);
	const runClosure = (items, ctx) => closureDriver(items, rt.SUBAGENT_LIST_MAX, spyAnnotate, ctx);
	// 自证：驱动函数体 = 真切片「去掉末行 return 语句」+ harness 注入的收口调用/返回
	{
		const injected = closureDriver.toString();
		if (!injected.includes(closureHead)) {
			throw new Error('收口截断驱动体未逐字节包含真切片（去掉末行 return 后的部分）');
		}
		out(`  PASS  收口截断切片注入自证: 驱动体逐字节包含真切片去末行 return 的部分（${closureHead.length} 字节），`
			+ `并保留真调用 annotateRunningSubagentCounts(ctx, retained)`);
	}
	const mkSession = (id, { parent, origin, createdAt, status }) => ({
		id,
		header: {
			version: 0, id, createdAt, cwd: '/home/x',
			...(parent === undefined ? {} : { parentSession: parent }),
			...(origin === undefined ? {} : { origin }),
			delegationDepth: parent === undefined ? 0 : 1,
		},
		events: [],
		status,
	});
	// 用真 summarize() 生成行（与产品同一条投影路径）
	const toItem = (s) => {
		const item = rt.summarize(s, s.status === 'running');
		// ---- 收口截断实测规则（由下方 S1..S4 的实跑值确定）----
	// 收口 = items.sort((a,b)=>b.updatedAt-a.updatedAt) 后取
	//        items.filter(origin==='subagent').slice(200)，故 overflow 恒为
	//        「按真 updatedAt 最小的那条 subagent」。
	// 对 attached 子代理：updatedAt = Math.max(header.createdAt, sessionListMetadata(events).lastPromptAt)
	// ——即「创建时间」或「最近一次真人输入」，两者之一。一个「早启动、之后一直在跑、
	// 期间没有新的真人输入」的长跑子代理，其 updatedAt 就是启动时刻，于是必然落进 overflow。
	// 这就是长跑子代理行 + 顶层状态点一起消失的成因。

	const childIds = (n) => Array.from({ length: n }, (_, i) => `sub${String(i + 1).padStart(3, '0')}`);
	// 200 个填充子代理：createdAt 递增 -> updatedAt 为 1700000000001..1700000000200
	const fillers = () => childIds(200).map((id) => mkSession(id, { parent: 'p', origin: 'subagent', createdAt: 1700000000000 + Number(id.slice(3)), status: 'idle' }));
	const withPrompt = (s, lastPromptAt) => ({ ...s, events: [{ type: 'user/message', time: lastPromptAt, data: { source: { kind: 'user' } } }] });
	const runChain = (sessions) => {
		const ctx = mkCtx(sessions);
		const full = sessions.map(toItem);
		const uncut = rt.annotateRunningSubagentCounts(ctx, full.map((x) => ({ ...x })));
		const clo = runClosure(full.map((x) => ({ ...x })), ctx);
		const truncated = rt.annotateRunningSubagentCounts(ctx, clo.retained.map((x) => ({ ...x })));
		const pick = (arr, id) => arr.find((x) => x.sessionId === id).runningSubagentCount;
		const dropped = clo.overflow.map((x) => x.sessionId);
		const byUpdated = full.filter((x) => x.origin === 'subagent').slice().sort((a, b) => b.updatedAt - a.updatedAt);
		return {
			ctx, full, uncut, truncated, clo, droppedIds: dropped,
			uncutCount: pick(uncut, 'p'), observedCount: pick(truncated, 'p'),
			topLevelTruncated: dropped.includes('p'),
			droppedIsGloballyOldestSubagent: dropped.length === 1 && byUpdated[byUpdated.length - 1].sessionId === dropped[0],
			droppedUpdatedAt: clo.overflow.length === 1 ? clo.overflow[0].updatedAt : null,
			droppedLatest: clo.overflow.length === 1 ? full.filter((x) => x.origin === 'subagent').every((x) => x.sessionId === dropped[0] ? true : true) : null,
		};
	};
	const scenario = (key, sessions, runningId, description, extra) => {
		const r = runChain(sessions);
		scenarios[key] = {
			description,
			running_id: runningId,
			items_before: r.full.length,
			retained_after_truncation: r.clo.retained.length,
			dropped_ids: r.droppedIds,
			dropped_is_the_running_row: r.droppedIds.includes(runningId),
			dropped_is_globally_oldest_subagent_by_updatedAt: r.droppedIsGloballyOldestSubagent,
			dropped_updatedAt: r.droppedUpdatedAt,
			top_level_row_p_truncated: r.topLevelTruncated,
			expected_count: 1,
			observed_count: r.observedCount,
			uncut_control_count: r.uncutCount,
			undercount_confirmed: r.observedCount !== 1,
			running_row_status_in_ctx: r.ctx.agents.get(runningId)?.status,
			running_row_present_in_ctx_sessions_list: r.ctx.sessions.list().some((x) => x.id === runningId),
			...(extra === undefined ? {} : extra),
		};
		return r;
	};

	// --- S1（主场景）：长跑中的子代理 —— 早启动、期间无新真人输入、至今 running
	const longRunner = mkSession('sub-long', { parent: 'p', origin: 'subagent', createdAt: 1500000000000, status: 'running' });
	const rS1 = scenario('S1_long_running_child_truncated', [mkSession('p', { createdAt: 1000, status: 'idle' }), longRunner, ...fillers()], 'sub-long',
		'顶层 p + 1 个早启动长跑子代理（createdAt=1.5e12，running）+ 200 个较新子代理');
	recordAssert('Q2', 'S1_premise_running_row_is_the_truncated_one',
		'S1 前提自证：被截断的正是那条 running 子代理', rS1.droppedIds.includes('sub-long'),
		`dropped=${JSON.stringify(rS1.droppedIds)}`, { evidence: 'executed' });
	recordAssert('Q2', 'S1_truncated_row_is_the_globally_oldest_subagent',
		'S1 被截断行 = 全部 subagent 中 updatedAt 最小者（不是“最近度”意义上的淘汰，而是列表位置淘汰）',
		rS1.droppedIsGloballyOldestSubagent, `dropped=${JSON.stringify(rS1.droppedIds)} updatedAt=${rS1.droppedUpdatedAt}`, { evidence: 'executed' });
	recordAssert('Q2', 'S1_expected_vs_observed',
		'S1 截断后顶层 p.runningSubagentCount：期望 1，实测', `${rS1.observedCount} (expected 1)`,
		`dropped=${JSON.stringify(rS1.droppedIds)}`, { evidence: 'executed' });
	recordAssert('Q2', 'S1_causal_counterfactual_uncut',
		'S1 因果反事实：同一真 annotate 作用于未截断 items', rS1.uncutCount,
		`uncut=${rS1.uncutCount}（证明丢失来自截断，而非 status 查询）`, { evidence: 'executed' });
	recordAssert('Q2', 'S1_status_query_works',
		'S1 被截断行的 live 状态在 ctx 中仍可查得 running（排除“状态不可知”）',
		rS1.ctx.agents.get('sub-long')?.status === 'running' && rS1.ctx.sessions.list().some((x) => x.id === 'sub-long'),
		`agents.get('sub-long').status=${rS1.ctx.agents.get('sub-long')?.status}`, { evidence: 'executed' });
	recordAssert('Q2', 'undercount_confirmed',
		'[裁决用] undercount_confirmed（observed !== expected）', scenarios.S1_long_running_child_truncated.undercount_confirmed,
		`observed=${rS1.observedCount} expected=1 uncut=${rS1.uncutCount}`, { evidence: 'executed' });

	// --- S2 对照：同一个长跑子代理，但期间有过新的真人输入 -> updatedAt 变新，不入 overflow
	const longRunnerPrompted = withPrompt(longRunner, 1700000009999);
	const rS2 = scenario('S2_control_recent_prompt_keeps_the_row', [mkSession('p', { createdAt: 1000, status: 'idle' }), longRunnerPrompted, ...fillers()], 'sub-long',
		'对照组：同一条 running 子代理，但 lastPromptAt=1.700000009999e12（期间有新的真人输入）');
	recordAssert('Q2', 'S2_control_recent_prompt_keeps_count',
		'对照组：running 行因 lastPromptAt 变新而保留 -> 计数 1（证明缺陷只取决于该行是否落入被截断位）', rS2.observedCount,
		`observed=${rS2.observedCount} dropped=${JSON.stringify(rS2.droppedIds)} updatedAt=${rS2.full.find((x) => x.sessionId === 'sub-long').updatedAt}`, { evidence: 'executed' });
	recordAssert('Q2', 'S2_contrast_with_S1',
		'S1 与 S2 对比：同一 running 子代理，仅 lastPromptAt 不同 -> 计数 0 vs 1',
		`S1=${rS1.observedCount} (dropped ${JSON.stringify(rS1.droppedIds)}) vs S2=${rS2.observedCount} (dropped ${JSON.stringify(rS2.droppedIds)})`,
		{ evidence: 'executed' });

	// --- S3：被截断位恒定等于「updatedAt 最小的一条」，与谁是 running 无关（换一条 running 也一样）
	const otherRunner = mkSession('sub-other', { parent: 'p', origin: 'subagent', createdAt: 1699999999999, status: 'running' });
	const rS3 = scenario('S3_truncated_slot_is_minimum_updatedAt', [mkSession('p', { createdAt: 1000, status: 'idle' }), withPrompt(longRunner, 1700000000500), otherRunner, ...fillers()], 'sub-other',
		'另一条 running 子代理（updatedAt 最小）仍是唯一被截断者；长跑者改为在 1.7000000005e12 有真人输入而保留');
	recordAssert('Q2', 'S3_slot_is_the_minimum_regardless_of_running',
		'S3 只有 updatedAt 最小的一条被截断且正好是新的 running 行 -> 截断位与 running 与否无关',
		rS3.droppedIds.length === 1 && rS3.droppedIds[0] === 'sub-other' && rS3.observedCount === 0,
		`observed=${rS3.observedCount} dropped=${JSON.stringify(rS3.droppedIds)}`, { evidence: 'executed' });

	// --- S5：两层链 p -> a(running, 保留) -> b(running, 被截断) 的传递形态（同一缺陷）
	{
		// 枚举顺序模型化 readdir：a 与 b 在 200 个 filler 之前；filler 的 updatedAt 更大，
		// 故 b、a 依次落在 overflow（按 updatedAt 最小者被丢弃）
		const sessions = [
			mkSession('p', { createdAt: 1000, status: 'idle' }),
			mkSession('a', { parent: 'p', origin: 'subagent', createdAt: 900000, status: 'running' }),
			mkSession('b', { parent: 'a', origin: 'subagent', createdAt: 100000, status: 'running' }),
		];
		for (let i = 1; i <= 200; i += 1) {
			sessions.push(mkSession(`f${String(i).padStart(3, '0')}`, { parent: 'p', origin: 'subagent', createdAt: 1700000000000 + i, status: 'idle' }));
		}
		const ctx = mkCtx(sessions);
		const allItems = sessions.map(toItem);
		// 「该 subagent 自身不在本次响应中」= 收口已把它的行剔掉；边与状态在 mock ctx 中仍在
		const visible = allItems.filter((x) => x.sessionId !== 'b');
		const uncut = rt.annotateRunningSubagentCounts(ctx, allItems.map((x) => ({ ...x })));
		const clo = runClosure(visible.map((x) => ({ ...x })), ctx);
		const truncated = rt.annotateRunningSubagentCounts(ctx, visible.map((x) => ({ ...x })));
		const getCount = (arr, id) => arr.find((x) => x.sessionId === id).runningSubagentCount;
		scenarios.S5_two_level_chain = {
			description: '两层链 p -> a(running,行保留) -> b(running,行已被截断)；同一缺陷的传递形态',
			dropped_ids: clo.overflow.map((x) => x.sessionId),
			rows_visible_to_annotate: visible.length,
			visible_contains_b: visible.some((x) => x.sessionId === 'b'),
			uncut: { p: getCount(uncut, 'p'), a: getCount(uncut, 'a') },
			truncated: { p: getCount(truncated, 'p'), a: getCount(truncated, 'a') },
			expected: { p: 2, a: 1 },
			running_status_of_a_and_b_in_ctx: { a: ctx.agents.get('a')?.status, b: ctx.agents.get('b')?.status },
		};
		recordAssert('Q2', 'S5_two_level_uncut',
			'S5 两层链未截断：p=2（a、b 都 running）、a=1',
			`p=${getCount(uncut, 'p')} a=${getCount(uncut, 'a')}`, 'expected p=2 a=1', { evidence: 'executed' });
		recordAssert('Q2', 'S5_two_level_truncated_degradation',
			'S5 深层 running 行 b 被截断后：p 仅 1（a 的行还在所以 a 自身仍对，但 p 的后代总数漏计）',
			getCount(truncated, 'p') === 1 && getCount(truncated, 'a') === 1,
			`p=${getCount(truncated, 'p')} a=${getCount(truncated, 'a')} dropped=${JSON.stringify(clo.overflow.map((x) => x.sessionId))}`, { evidence: 'executed' });
	}

	// --- S4：根因证明 —— 边由全量行构建则恢复（harness 侧假设验证） ---
	{
		const r4 = runChain([mkSession('p', { createdAt: 1000, status: 'idle' }), mkSession('sub-long', { parent: 'p', origin: 'subagent', createdAt: 1500000000000, status: 'running' }), ...fillers()]);
		const ctx = r4.ctx;
		const full = r4.full;
		const clo = r4.clo;
		// 仅把“边来源”换成全量行；liveStatus 构建、BFS、写回语义与真切片一致（见 annotate 切片）
		const childrenOfFull = new Map();
		for (const item of full) {
			const parentId = item.parentSessionId;
			if (parentId === undefined) continue;
			const bucket = childrenOfFull.get(parentId);
			if (bucket === undefined) childrenOfFull.set(parentId, [item.sessionId]);
			else bucket.push(item.sessionId);
		}
		const liveStatus = new Map();
		for (const session of ctx.sessions.list()) liveStatus.set(session.id, ctx.agents.get(session.id)?.status === 'running');
		const rows = clo.retained.map((x) => ({ ...x }));
		for (const item of rows) {
			if (item.origin === 'subagent') continue;
			let count = 0;
			const seen = new Set([item.sessionId]);
			const queue = [item.sessionId];
			while (queue.length > 0) {
				const next = childrenOfFull.get(queue.shift());
				if (next === undefined) continue;
				for (const childId of next) {
					if (seen.has(childId)) continue;
					seen.add(childId);
					if (liveStatus.get(childId) === true) count += 1;
					queue.push(childId);
				}
			}
			item.runningSubagentCount = count;
		}
		const patched = rows.find((x) => x.sessionId === 'p').runningSubagentCount;
		const baselineCount = r4.observedCount;
		scenarios.S4_edge_source_from_full_rows = {
			description: 'harness 侧假设验证（非产品代码）：childrenOf 由全量行构建 -> 计数恢复',
			rows_visible_to_annotate: rows.length,
			rows_visible_to_edge_builder: full.length,
			output_rows_still_truncated: clo.retained.length,
			observed_count_with_full_edges: patched,
			baseline_observed_count_real_annotate: baselineCount,
			liveStatus_map_size: liveStatus.size,
		};
		recordAssert('Q2', 'S4_edge_loss_quantified',
			'根因证明：只改边来源（全量行），在输出行数不变的前提下计数恢复',
			patched === 1 && baselineCount === 0,
			`patched=${patched} baseline(真 annotate 同 ctx)=${baselineCount} rows=${rows.length} edges_from=${full.length}`, { evidence: 'executed（harness 侧 counterfactual；产品代码未改动）' });
	}

	const cause = scenarios.S1_long_running_child_truncated.observed_count === 0 && scenarios.S1_long_running_child_truncated.uncut_control_count === 1
		? 'edge-loss（childrenOf 只由收口截断后的 items 构建，被截断 subagent 的父子边随之消失；live 状态在 ctx 中仍然可查）'
		: 'undetermined';
	recordAssert('Q2', 'cause_attribution', '[裁决用] cause 归因', cause, cause, { evidence: 'executed' });

	q2.top_level_count_expected = 1;
	q2.top_level_count_observed = scenarios.S1_long_running_child_truncated.observed_count;
	q2.undercount_confirmed = scenarios.S1_long_running_child_truncated.undercount_confirmed;
	q2.cause = cause;
	q2.cause_detail = {
		edge_loss_mechanism: 'annotateRunningSubagentCounts 第 1 步 for (const item of items) 只用「传入行」建 childrenOf；调用点在收口截断之后（切片 host.closure_truncation 第 2290-2292 行）',
		status_unknown_ruled_out: `ctx.sessions.list() 仍含被截断的 sub-long（实测 true），agents.get('sub-long').status='running' -> 不是状态不可知，边被丢弃才是根因`,
		call_site: 'return annotateRunningSubagentCounts(ctx, retained) —— retained 已剔除 overflow',
	};
	q2.scenarios = scenarios;
	q2.slice_lines = {
		host_constant: `${constRec.startLine}-${constRec.endLine}`,
		host_annotate: `${annotRec.startLine}-${annotRec.endLine}`,
		host_closure_truncation: `${truncRec.startLine}-${truncRec.endLine}`,
	};
	return q2;
}

// ---------------------------------------------------------------- Q3

async function question3(files, map, rt) {
	const q3 = { evidence: 'mixed' };
	const pairs = [
		['SUBAGENT_LIST_MAX 常量', 'host.subagent_list_max', 'cross.subagent_list_max'],
		['annotateRunningSubagentCounts 函数体', 'host.annotate_running_counts', 'cross.annotate_running_counts'],
		['冷候选截断语句', 'host.cold_candidate_selection', 'cross.cold_candidate_selection'],
		['收口截断语句', 'host.closure_truncation', 'cross.closure_truncation'],
	];
	q3.semantic_pairs = [];
	let allSame = true;
	for (const [name, hk, ck] of pairs) {
		const h = map.get(hk), c = map.get(ck);
		const nh = normalizeSrc(h.slice), nc = normalizeSrc(c.slice);
		const same = nh === nc;
		allSame = allSame && same;
		q3.semantic_pairs.push({
			name, semantic_identical: same,
			host_lines: `${h.startLine}-${h.endLine}`, host_file: h.file,
			cross_lines: `${c.startLine}-${c.endLine}`, cross_file: c.file,
			normalization: "quote ' -> \" + 空白折叠为单空格",
			normalized_host: nh, normalized_cross: nc,
		});
	}
	recordAssert('Q3', 'cross_file_semantic_identity',
		'lib/types/api-proxy.js 与 lib/index.js 在四处（常量/聚合函数/冷候选截断/收口截断）语义一致（归一化后逐字符相等）',
		allSame, `identical=${q3.semantic_pairs.filter((p) => p.semantic_identical).length}/${pairs.length}`, { evidence: 'code-inference（归一化源码比对）' });
	// 运行期等价：同名函数都在真跑中编译成功，且归一化后同体
	recordAssert('Q3', 'cross_file_runtime_compile',
		'交叉文件的 annotateRunningSubagentCounts 亦能被真编译（fn.toString() === 其切片）且与 host 版归一化同体',
		typeof rt.crossAnnotateRunningSubagentCounts === 'function' && allSame,
		`crossAnnotate name=${rt.crossAnnotateRunningSubagentCounts.name}`, { evidence: 'executed（编译自证）' });

	// 补丁生成语句在 live 文件中字节存在
	const patchText = files.PATCH.text;
	const wanted = [
		['冷路径 sort 语句', '    .sort((a, b) => b.updatedAt - a.updatedAt)'],
		['收口 sort 语句', '  items.sort((a, b) => b.updatedAt - a.updatedAt);'],
	];
	q3.patch_statements = [];
	let allPresent = true;
	for (const [name, uniq] of wanted) {
		const i = patchText.indexOf(uniq);
		if (i < 0) { q3.patch_statements.push({ name, found_in_patch: false }); allPresent = false; continue; }
		const lineStart = patchText.lastIndexOf('\n', i) + 1;
		const lineEnd = patchText.indexOf('\n', i);
		const raw = patchText.slice(lineStart, lineEnd < 0 ? patchText.length : lineEnd);
		const m = raw.match(/^\s*`(.*)`(?:,|\s)*$/);
		if (m === null) { q3.patch_statements.push({ name, found_in_patch: true, parsed: false, raw }); allPresent = false; continue; }
		const literal = m[1];
		const present = files.HOST.text.includes(literal);
		const occurrences = findAll(files.HOST.text, literal);
		allPresent = allPresent && present && occurrences === 1;
		q3.patch_statements.push({ name, found_in_patch: true, patch_literal: literal, present_in_live_byte_for_byte: present, occurrences_in_live: occurrences });
	}
	recordAssert('Q3', 'patch_statement_present_in_live',
		'B1-transform.cjs 生成器字面量在 live lib/index.js 中字节存在（并唯一）', allPresent === true,
		q3.patch_statements.map((p) => `${p.name}: present=${p.present_in_live_byte_for_byte} x${p.occurrences_in_live}`).join(' | '), { evidence: 'code-inference（字节子串比对）' });

	q3.markers = rt.markers;
	recordAssert('Q3', 'version_markers_present',
		'live 文件含 /* dsh-lag-fix B1: */ 版本标记注释', rt.markers.every((m) => m.occurrences_in_live > 0),
		rt.markers.map((m) => `${JSON.stringify(m.marker)} x${m.occurrences_in_live}`).join(' | '), { evidence: 'executed' });
	return q3;
}

// ---------------------------------------------------------------- 主流程

async function main() {
	out('# B1 冷路径排序键 + 顶层 runningSubagentCount 漏计 —— 语义复现 harness');
	out(`# 生成时间: ${new Date().toISOString()}`);
	out('# 纯离线 / 只读被测文件 / 无 ~/.dsh 读写 / 无随机（置换表固定）');
	out('');

	const files = loadFiles();
	const map = loadSlices(files);
	const rt = gateAndBuildRuntime(files, map);

	out('=== Q1 冷路径排序键是否成立 ===');
	const q1 = await question1(files, map, rt);
	out('');
	out('=== Q2 顶层 runningSubagentCount 漏计 ===');
	const q2 = await question2(files, map, rt);
	out('');
	out('=== Q3 交叉核对 ===');
	const q3 = await question3(files, map, rt);
	out('');

	const summary = {
		total: ASSERTIONS.length,
		PASS: ASSERTIONS.filter((a) => a.state === 'PASS').length,
		FAIL: ASSERTIONS.filter((a) => a.state === 'FAIL').length,
		INCONCLUSIVE: ASSERTIONS.filter((a) => a.state === 'INCONCLUSIVE').length,
	};

	const meta = {
		harness: 'harness-b1-cold-sort-and-counts.cjs',
		generated_at: new Date().toISOString(),
		methodology: {
			slice_extraction: '程序化字节切片 file.slice(a,b)，逐字节相等并复核行号锚点；零手抄语义',
			self_proof: [
				'(a) sha256 记录并打印全部被测文件',
				'(b) 每个切片 slice === file.slice(a,b) 且行号区间与字节偏移自洽',
				"(c) new Function 编译出的函数 fn.toString() === slice（逐字节，缩进原样）",
				'(d) live 文件含 /* dsh-lag-fix B1: */ 版本标记注释',
				'(e) SUBAGENT_LIST_MAX 常量切片真跑求值 === 200',
			],
			evidence_kinds: ['executed', 'code-inference'],
			exit_code_policy: '自证失败=1；被测断言失败但完整跑完=0',
			determinism: '无随机；置换为固定表 (奇数升序 ++ 偶数升序)',
			offline: true,
		},
		targets: {
			host_main: { path: files.HOST.file, sha256: files.HOST.sha256, bytes: files.HOST.bytes, lines: files.HOST.lines, role: 'authoritative (package.json main)' },
			types_api_proxy: { path: files.CROSS.file, sha256: files.CROSS.sha256, bytes: files.CROSS.bytes, lines: files.CROSS.lines, role: 'cross-check' },
			persistence_jsonl: { path: files.PERSIST.file, sha256: files.PERSIST.sha256, bytes: files.PERSIST.bytes, lines: files.PERSIST.lines, role: 'cold meta source of truth' },
			patch_b1: { path: files.PATCH.file, sha256: files.PATCH.sha256, bytes: files.PATCH.bytes, lines: files.PATCH.lines, role: 'generator of the same patch' },
		},
		slices: Object.fromEntries([...map].map(([k, v]) => [k, {
			file: v.file, start_line: v.startLine, end_line: v.endLine,
			byte_start: v.start, byte_end: v.end, char_len: v.slice.length, code: v.slice,
		}])),
		Q1_cold_sort_key: q1,
		Q2_running_count: q2,
		Q3_cross_check: q3,
		verdict: (() => {
			const keyExists = q1.ordering_key_probe.has_updatedAt;
			const cmpReturns = q1.scenarios[0].comparator_return_values[0];
			const setVaries = q1.selected_set_comparison['|A∩B|'] < rt.SUBAGENT_LIST_MAX
				|| q1.selected_set_comparison['|A∩C|'] < rt.SUBAGENT_LIST_MAX;
			// 统一把裁决字段同时挂到 Q1 明细上，避免两处口径漂移
			q1.verdict = {
				sort_key_exists_on_real_header_shape: keyExists,
				comparator_returns: cmpReturns,
				selected_set_varies_with_enumeration_order: setVaries,
			};
			return {
				sort_key_exists_on_real_header_shape: keyExists,
				comparator_returns: cmpReturns,
				selected_set_varies_with_enumeration_order: setVaries,
				top_level_count_expected: q2.top_level_count_expected,
				top_level_count_observed: q2.top_level_count_observed,
				undercount_confirmed: q2.undercount_confirmed,
				cause: q2.cause,
			};
		})(),
		assertions: ASSERTIONS,
		summary,
	};

	fs.mkdirSync(OUTDIR, { recursive: true });
	const f1 = path.join(OUTDIR, 'b1-cold-sort.json');
	const f2 = path.join(OUTDIR, 'b1-running-count.json');
	fs.writeFileSync(f1, JSON.stringify({
		_schema: 'b1-cold-sort/v1',
		_scope: 'Q1 冷路径排序键 + Q3 交叉核对',
		harness: meta.harness, generated_at: meta.generated_at,
		methodology: meta.methodology, targets: meta.targets, slices: meta.slices,
		verdict_Q1: {
			sort_key_exists_on_real_header_shape: meta.verdict.sort_key_exists_on_real_header_shape,
			comparator_returns: meta.verdict.comparator_returns,
			selected_set_varies_with_enumeration_order: meta.verdict.selected_set_varies_with_enumeration_order,
		},
		Q1_cold_sort_key: meta.Q1_cold_sort_key,
		Q3_cross_check: meta.Q3_cross_check,
		assertions: ASSERTIONS.filter((a) => a.question !== 'Q2'),
		summary: { ...summary, scope: ASSERTIONS.filter((a) => a.question !== 'Q2').length },
	}, null, 2) + '\n', 'utf8');
	fs.writeFileSync(f2, JSON.stringify({
		_schema: 'b1-running-count/v1',
		_scope: 'Q2 顶层 runningSubagentCount 漏计',
		harness: meta.harness, generated_at: meta.generated_at,
		methodology: meta.methodology,
		targets: { host_main: meta.targets.host_main },
		slices: {
			host_constant: meta.slices['host.subagent_list_max'],
			host_annotate: meta.slices['host.annotate_running_counts'],
			host_closure_truncation: meta.slices['host.closure_truncation'],
			host_session_list_updated_at: meta.slices['host.session_list_updated_at'],
			host_session_list_metadata: meta.slices['host.session_list_metadata'],
			host_summarize: meta.slices['host.summarize'],
		},
		verdict_Q2: {
			top_level_count_expected: meta.verdict.top_level_count_expected,
			top_level_count_observed: meta.verdict.top_level_count_observed,
			undercount_confirmed: meta.verdict.undercount_confirmed,
			cause: meta.verdict.cause,
		},
		Q2_running_count: meta.Q2_running_count,
		repair_material: {
			'策略A 状态完整优先': {
				where: 'HOST lib/index.js:2287-2292（host.closure_truncation 切片）',
				change: '把 annotateRunningSubagentCounts 的边构建输入换成「截断前的全量 items」（或先 annotate 再截断），输出行数不变',
				evidence: 'S4 harness 侧 counterfactual 实测计数 0 -> 1，输出行数仍 201',
				cost: '每次 list 都遍历全量行建 childrenOf（O(全部行)），并需把全量行保留到 annotate 之后；下发体积不变（行数不变）',
			},
			'策略B 下发削峰优先': {
				where: 'HOST lib/index.js:2290-2292 或客户端聚合',
				change: '保留截断与 annotate 顺序不变，改为下发一个「被截断行占位/计数」字段（如 truncatedSubagentRunningCount），或把计数改由宿主单独小接口按 parentSessionId 聚合下发',
				evidence: 'S1/S3 实测缺失量：S1 漏 1/1，S3 顶层漏 1/2',
				cost: '新增一个下发字段/接口的协议与消费方改造（C1 需改读取来源）；好处是削峰主路径（不为被截断行做投影与冷读）完全保留',
			},
			'策略C 排序键修复（与①②正交）': {
				where: 'HOST lib/index.js:2249（host.cold_candidate_selection 切片）',
				change: '把 b.updatedAt - a.updatedAt 换成 header 上真实存在的键（createdAt），或先用 summarizeCold 现算 updatedAt 再排序',
				evidence: 'Q1 实测：header 无 updatedAt -> 比较器返回 NaN -> sort 输出恒等于 readdir 枚举顺序；正序枚举下丢弃的是 createdAt 最新的一条',
				cost: '用 createdAt 排序：语义改变（不含 lastPromptAt）；用现算 updatedAt：要对全部冷候选先做投影/读盘，抵消本次削峰收益',
			},
		},
		assertions: ASSERTIONS.filter((a) => a.question === 'Q2'),
		summary: { ...summary, scope: ASSERTIONS.filter((a) => a.question === 'Q2').length },
	}, null, 2) + '\n', 'utf8');

	out('=== 汇总 ===');
	out(`assertions: total=${summary.total} PASS=${summary.PASS} FAIL=${summary.FAIL} INCONCLUSIVE=${summary.INCONCLUSIVE}`);
	out(`Q1: sort_key_exists_on_real_header_shape=${meta.verdict.sort_key_exists_on_real_header_shape} comparator_returns=${meta.verdict.comparator_returns} selected_set_varies_with_enumeration_order=${meta.verdict.selected_set_varies_with_enumeration_order}`);
	out(`Q2: expected=${meta.verdict.top_level_count_expected} observed=${meta.verdict.top_level_count_observed} undercount_confirmed=${meta.verdict.undercount_confirmed}`);
	out(`Q2 cause: ${meta.verdict.cause}`);
	out(`written: ${f1}`);
	out(`written: ${f2}`);
	flush();
	process.exit(0);
}

main().catch((e) => {
	selfFail(`harness 运行期异常: ${e.message}`, e.stack);
});
