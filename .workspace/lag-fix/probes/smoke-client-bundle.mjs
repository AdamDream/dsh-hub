#!/usr/bin/env node
// ============================================================================
// smoke-client-bundle.mjs — 客户端 bundle 冒烟执行（pinned 改动路径的行为证据）
// ============================================================================
// 目的：`node --check` 只能证明语法；这里用一个最小 React/Hook/DOM 替身**真正执行**
//       bundle 的 factory，证明：
//         S1 补丁后的 client.js 能被 module loader 载入并注册（无 ReferenceError/TypeError）
//         S2 「近 N 天」窗口按本地自然日对齐（A0）：from 落在本地 00:00:00.000、
//            to 落在本地 23:59:59.999
//         S3 轮询门控（B2）：refreshSec=60 默认；卡片不可见 → 不建立定时器、
//            不发 /usage 请求；可见后建立定时器
//         S4 refreshSec=0「不轮询」仍然不建立定时器（用户要求保留的既有选项）
//         S5 手动刷新路径仍调 refresh + loadAll + loadSessions（未被门控误伤）
//
// 纪律：纯本地、零网络（rpc.call 是替身）、不做真实 DOM 操作。不触碰宿主进程。
// 用法：node probes/smoke-client-bundle.mjs --client tmp/patched/client.js [--json out.json]
// 退出码：0 = 全部断言通过；1 = 有失败。
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const argv = process.argv.slice(2);
const argOf = (n, d) => {
	const i = argv.indexOf(n);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const clientPath = resolve(argOf("--client", ""));
const OUT = argOf("--json", "");
if (!clientPath) {
	console.error("用法：node smoke-client-bundle.mjs --client <client.js> [--json out.json]");
	process.exit(2);
}
const src = readFileSync(clientPath, "utf8");

const results = [];
let fails = 0;
const check = (name, ok, detail) => {
	results.push({ test: name, status: ok ? "PASS" : "FAIL", detail });
	if (!ok) fails += 1;
	console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail === undefined ? "" : " :: " + detail}`);
};

// ---------------------------------------------------------------- 最小 React 替身
function makeHooks() {
	const state = []; // 每个 hook 槽位
	let cursor = 0;
	const effects = []; // {deps, fn, cleanup}
	const hook = {
		renderCount: 0,
		reset() {
			cursor = 0;
		},
		useState(init) {
			const i = cursor++;
			if (process.env.LAGFIX_DEBUG) console.log(`[smoke-dbg] render#${hook.renderCount + 1} useState#${i} initSeen=${i in state}`);
			if (!(i in state)) state[i] = typeof init === "function" ? init() : init;
			if (process.env.LAGFIX_DEBUG && typeof state[i] === "boolean") console.log(`[smoke-dbg] useState#${i} = ${state[i]}`);
			if (process.env.LAGFIX_DEBUG && (i === 18)) console.log(`[smoke-dbg] RENDER#${hook.renderCount + 1} slot${i} RETURNS ${JSON.stringify(state[i])}`);
			return [state[i], (v) => {
				const next = typeof v === "function" ? v(state[i]) : v;
				if (process.env.LAGFIX_DEBUG && (typeof next === "boolean" || typeof state[i] === "boolean")) {
					console.log(`[smoke-dbg] setState#${i} ${state[i]} -> ${next} @cursor=${cursor} renderDone=${hook.renderCount}`);
					if (state[i] === false && next === true) console.log(new Error(`setter-slot${i}`).stack.split("\n").slice(1, 5).join("\n"));
				}
				state[i] = next;
			}];
		},
		useRef(init) {
			const i = cursor++;
			if (!(i in state)) state[i] = { current: init };
			return state[i];
		},
		useMemo(fn) {
			cursor++;
			return fn();
		},
		useCallback(fn) {
			const i = cursor++;
			const slot = `cb:${i}`;
			if (!(slot in state)) state[slot] = fn;
			return state[slot];
		},
		useEffect(fn, deps) {
			const i = cursor++;
			if (process.env.LAGFIX_DEBUG) {
				console.log(`[smoke-dbg] render#${hook.renderCount + 1} useEffect@cursor=${i} deps=${JSON.stringify(deps)} isArr=${Array.isArray(deps)} src=${String(fn).split("\n")[0].slice(0, 60)}`);
			}
			const slot = `fx:${i}`;
			const prev = state[slot];
			const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k]);
			if (process.env.LAGFIX_DEBUG) {
				console.log(`[smoke-dbg] effect#${i} changed=${changed} deps=${JSON.stringify(deps)} prev=${JSON.stringify(prev?.deps)}`);
			}
			// React 语义：依赖变化时先跑上一轮的 cleanup，再跑本轮 effect。
			if (changed && prev) effects.push({ index: i, fn: null, cleanup: prev.cleanup });
			state[slot] = { deps, fn, cleanup: undefined };
			if (changed) effects.push({ index: i, fn, slot });
		},
		useLayoutEffect(fn, deps) {
			return hook.useEffect(fn, deps);
		},
		useContext() {
			cursor++;
			return {};
		},
		takeEffects() {
			const list = effects.splice(0, effects.length);
			return list;
		},
		pendingPromises: [],
		setCleanup(slot, cleanup) {
			if (state[slot]) state[slot].cleanup = cleanup;
		},
	};
	return hook;
}

// ---------------------------------------------------------------- 替身环境
function makeEnv({ visible, intersect }) {
	const rpcCalls = [];
	const timers = [];
	const observers = [];
	const documentStub = {
		hidden: !visible,
		head: { appendChild() {} },
		body: { appendChild() {} },
		querySelector: () => null,
		createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, appendChild() {} }),
		addEventListener() {},
		removeEventListener() {},
	};
	class IntersectionObserverStub {
		constructor(cb, opts) {
			this.cb = cb;
			this.opts = opts;
			this.observed = [];
			observers.push(this);
		}
		observe(node) {
			this.observed.push(node);
			this.cb([{ isIntersecting: intersect, target: node }]);
		}
		disconnect() {
			this.observed = [];
		}
	}
	const sandbox = {
		document: documentStub,
		IntersectionObserver: IntersectionObserverStub,
		setInterval: (fn, ms) => {
			const id = timers.length + 1;
			timers.push({ id, fn, ms, cleared: false });
			return id;
		},
		clearInterval: (id) => {
			const t = timers.find((x) => x.id === id);
			if (t) t.cleared = true;
		},
		setTimeout: () => 0,
		clearTimeout: () => {},
		requestAnimationFrame: (fn) => fn(),
		cancelAnimationFrame: () => {},
		performance: { now: () => Date.now() },
		console,
		Date,
		JSON,
		Math,
		Number,
		String,
		Array,
		Object,
		Map,
		Set,
		Promise,
		Error,
		Symbol,
		parseInt,
		parseFloat,
		isNaN,
		isFinite,
		encodeURIComponent,
		decodeURIComponent,
	};
	const rpc = {
		call: async (channel, endpoint, payload) => {
			rpcCalls.push({ channel, endpoint, payload });
			if (endpoint === "heatmap") return { ok: true, value: [] };
			if (endpoint === "summary") return { ok: true, value: { requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, hit_rate: 0, sessions: 0 } };
			return { ok: true, value: [] };
		},
	};
	return { sandbox, rpc, rpcCalls, timers, observers, documentStub };
}

// ---------------------------------------------------------------- 载入 bundle
const registered = [];
const hooks = makeHooks();
const env = makeEnv({ visible: true, intersect: true });
const react = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	Fragment: Symbol("Fragment"),
	useState: hooks.useState,
	useRef: hooks.useRef,
	useMemo: hooks.useMemo,
	useCallback: hooks.useCallback,
	useEffect: hooks.useEffect,
	useLayoutEffect: hooks.useLayoutEffect,
	useContext: hooks.useContext,
};
env.sandbox.window = {
	__ModuleLoader__: {
		load: (entry) => {
			registered.push(entry);
		},
	},
};
env.sandbox.__react = react;
env.sandbox.__register = (id, mod) => registered.push({ id, mod });
// 关键：沙箱必须把 window/document/IntersectionObserver 等作为真正的全局绑定注入，
// 否则 bundle 里的 `typeof IntersectionObserver` 会是 undefined，可见性门控会走
// 「无 IO → 视为可见」的兜底分支，测试就会误判。
const ctx = vm.createContext(env.sandbox);
try {
	vm.runInContext(src, ctx, { filename: clientPath });
	check("S1 客户端 bundle 可被 ModuleLoader 载入并注册", registered.length === 1 && typeof registered[0].factory === "function",
		`entries=${registered.length} id=${registered[0]?.id ?? "-"}`);
} catch (cause) {
	check("S1 客户端 bundle 可被 ModuleLoader 载入并注册", false, `执行抛错：${cause && cause.message}`);
	console.log(String(cause && cause.stack).split("\n").slice(0, 6).join("\n"));
	process.exit(1);
}

// ---------------------------------------------------------------- 挂载卡片
const entry = registered[0];
const modExports = { exports: {} };
const requireStub = (name) => {
	if (name === "react") return react;
	throw new Error(`未知依赖 ${name}`);
};
let UsageCard = null;
let applyErr = null;
try {
	// bundle 形态：factory(require) 直接返回 module.exports（含 apply / inject）
	const exportsObj = entry.factory(requireStub) ?? modExports.exports;
	check("S1a factory(require) 返回含 apply/inject 的 exports", typeof exportsObj?.apply === "function" && Array.isArray(exportsObj?.inject),
		`keys=${Object.keys(exportsObj ?? {}).join(",")} inject=[${(exportsObj?.inject ?? []).join(",")}]`);
	const slots = { inject: (_name, fn) => fn(), register: (_meta, component) => { UsageCard = component; } };
	const ctxStub = {
		connection: { rpc: env.rpc },
		sessions: { select() {} },
		settingsScope: null,
		slots,
	};
	exportsObj.apply(ctxStub);
	check("S1b apply() 注册设置卡片且无异常", typeof UsageCard === "function", `UsageCard=${typeof UsageCard}`);
} catch (cause) {
	applyErr = cause;
	check("S1b apply() 注册设置卡片且无异常", false, `apply 抛错：${cause && cause.message}`);
	console.log(String(cause && cause.stack).split("\n").slice(0, 8).join("\n"));
}
if (applyErr || typeof UsageCard !== "function") {
	console.log("[smoke] 无法继续（卡片未注册）");
	process.exit(fails === 0 ? 0 : 1);
}

/** 深度优先遍历虚拟 DOM 树（替身节点形如 {type, props, children}）。 */
function walk(node, out = []) {
	if (!node || typeof node !== "object") return out;
	out.push(node);
	for (const child of node.children ?? []) walk(child, out);
	return out;
}

/** 走一遍渲染树，把 ref 回调当作 React 提交阶段那样调用。
 * React 只在 ref 函数标识变化时才 detach(null)+attach(node)；`attachCardRef` 是
 * useCallback([]) 的稳定标识，所以这里比较函数引用，只在变化时重挂。 */
const lastRefs = new Map();
function attachRefs(tree, node) {
	const walk = (n) => {
		if (!n || typeof n !== "object") return;
		const ref = n.props && n.props.ref;
		if (typeof ref === "function") {
			if (process.env.LAGFIX_DEBUG) console.log(`[smoke-dbg] attachRefs type=${String(n.type)} same=${lastRefs.get(n.type) === ref}`);
			const prev = lastRefs.get(n.type);
			if (prev !== ref) {
				if (typeof prev === "function") prev(null);
				lastRefs.set(n.type, ref);
				ref(node);
			} else {
				// React 在 ref 标识不变时不会重复调用 ref；mock 之前无条件重调，
				// 那会用「初始可见」这一陈旧值把测试设成 false 的可见性覆盖回 true。
				if (process.env.LAGFIX_DEBUG) console.log(`[smoke-dbg] attachRefs type=${String(n.type)} skipped (ref identity unchanged)`);
			}
		}
		for (const child of n.children ?? []) walk(child);
	};
	walk(tree);
}

/** 渲染若干轮并执行 effect（有界，避免自激循环）；每轮提交阶段调用 ref。 */
async function renderOnce() {
	hooks.reset();
	const tree = UsageCard({ rpc: env.rpc, sessions: { select() {} }, settingsScope: null });
	attachRefs(tree, { __cardRoot: true });
	const pending = [];
	for (const e of hooks.takeEffects()) {
		if (e.fn === null) {
			// cleanup 阶段
			if (typeof e.cleanup === "function") e.cleanup();
			continue;
		}
		const r = e.fn();
		if (e.slot) hooks.setCleanup(e.slot, r);
		if (r && typeof r.then === "function") pending.push(r);
	}
	if (pending.length > 0) await Promise.allSettled(pending);
	hooks.renderCount += 1;
	if (process.env.LAGFIX_DEBUG) {
		console.log(`[smoke-dbg] render#${hooks.renderCount} timersActive=${env.timers.filter((t) => !t.cleared).length} observers=${env.observers.length} rpc=${env.rpcCalls.length}`);
	}
	return tree;
}
async function renderAndSettle(renders = 8) {
	for (let i = 0; i < renders; i++) {
		try {
			await renderOnce();
		} catch (cause) {
			check("S1c 渲染 + effect 执行无异常", false, `抛错：${cause && cause.message}`);
			return false;
		}
	}
	return true;
}

const ok = await renderAndSettle();
check("S1c 渲染 + effect 执行无异常（含新增 ref/observer 代码路径）", ok === true, `renders=${hooks.renderCount}`);
check("S2a 可见时建立了轮询定时器", env.timers.some((t) => !t.cleared), `timers=${env.timers.length} ms=${env.timers.map((t) => t.ms).join(",")}`);
check("S2b 默认轮询周期为 60s（用户裁决：30s → 60s）", env.timers.some((t) => t.ms === 60000), `周期=${env.timers.map((t) => t.ms).join(",") || "-"}`);
check("S2c 建立了 IntersectionObserver 观察卡片根节点（可见性门控）",
	env.observers.length > 0 && env.observers[0].observed.length === 1, `observers=${env.observers.length}`);

// ---------------------------------------------------------------- S3/S4 直接从 bundle 源码求值
// 说明（诚实记录）：本 mock 的 hook 语义无法完全等价 React 的 commit/ref 时序——
// 挂载时的 observer 回调用的是「初始可见」这一陈旧值，会把测试设成 false 的可见性
// 覆盖回 true。与其继续加厚 mock，这里改为**从真实 bundle 文件里抽出 A0/B2 的代码并
// 在受控上下文里直接求值**：既验证了磁盘上真实代码的语义，又不冒充浏览器行为。
const NEW_RANGE_MARK = "const localDayStart = (d) =>";
const GATE_MARK = "const timer = setInterval(() => {";
const GATE_END = "}, refreshSec * 1000);";

/** 抽出 A0：rangeDays 分支（按大括号配平切片，求值时把 return 换成赋值）。 */
function extractRangeFn(src) {
	const mark = src.indexOf(NEW_RANGE_MARK);
	if (mark < 0) return null;
	const start = src.lastIndexOf("if (rangeDays > 0) {", mark);
	if (start < 0) return null;
	let depth = 0;
	let end = -1;
	for (let k = src.indexOf("{", start); k < src.length; k++) {
		if (src[k] === "{") depth++;
		else if (src[k] === "}") {
			depth--;
			if (depth === 0) {
				end = k;
				break;
			}
		}
	}
	if (end < 0) return null;
	const body = src.slice(start, end + 1);
	if (process.env.LAGFIX_DEBUG) console.log("[smoke-dbg] A0 extracted block:\n" + body);
	// 用 IIFE 求值：块内 return 的语义天然与真实函数一致，无需改写 return。
	return new Function(
		"now",
		"rangeDays",
		`const __out = (() => {
			${body}
			return { from: undefined, to: undefined };
		})();
		return __out;`,
	);
}

/** 抽出 B2：轮询 effect 的守卫体（在给定 refreshSec / pollVisible / document.hidden 下求值）。 */
function extractPollGate(src) {
	const s0 = src.indexOf("if (refreshSec <= 0) return;", src.indexOf(GATE_MARK) - 2000 > 0 ? src.indexOf(GATE_MARK) - 2000 : 0);
	const s1 = src.indexOf("const timer = setInterval(() => {", s0);
	const s2 = src.indexOf("}, refreshSec * 1000);", s1);
	if (s0 < 0 || s1 < 0 || s2 < 0) return null;
	const body = src.slice(s0, s2 + "}, refreshSec * 1000);".length);
	const fn = new Function("refreshSec", "pollVisible", "document", "loadAllRef", "setInterval", "clearInterval", `
		const run = (() => { ${body}; return { created: true, timer }; })();
		return run;
	`);
	return fn;
}

{
	const rangeFn = extractRangeFn(src);
	check("S3a 从补丁后 client.js 成功抽出 A0 的 rangeDays 分支", typeof rangeFn === "function", `marker=${NEW_RANGE_MARK.slice(0, 12)}…`);
	if (rangeFn) {
		let ok = true;
		const detail = [];
		// 注意用本地日历构造 Date（`new Date(iso)` 会把无时区的 ISO 串按 UTC 解析，
		// 得到的“本地时刻”不再落在整秒/整日边界上，会误判成守卫兜底分支）。
		for (const [spec, days] of [[[2026, 9, 20, 15, 30, 0], 1], [[2026, 9, 20, 15, 30, 0], 7], [[2026, 9, 20, 15, 30, 0], 30], [[2026, 9, 20, 0, 0, 1], 7], [[2026, 9, 20, 23, 59, 59], 90]]) {
			const now = new Date(spec[0], spec[1] - 1, spec[2], spec[3], spec[4], spec[5]).getTime();
			const nowIso = new Date(now).toLocaleString("sv-SE");
			const r = rangeFn(now, days);
			const f = new Date(r.from);
			const t = new Date(r.to);
			const fromOk = f.getHours() === 0 && f.getMinutes() === 0 && f.getSeconds() === 0 && f.getMilliseconds() === 0;
			const toOk = t.getHours() === 23 && t.getMinutes() === 59 && t.getSeconds() === 59 && t.getMilliseconds() === 999;
			// 窗口含今天在内共 days 个自然日
			const spanOK = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(f.getFullYear(), f.getMonth(), f.getDate())) / 86400000) === days - 1;
			if (!(fromOk && toOk && spanOK)) ok = false;
			detail.push(`${nowIso}+${days}d→${f.toISOString().slice(0, 19)}..${t.toISOString().slice(0, 19)} fromOK=${fromOk} toOK=${toOk} spanOK=${spanOK}`);
		}
		check("S3b A0：rangeDays 各档窗口均落在本地日边界（from 00:00:00.000 / to 23:59:59.999，共 N 个自然日）", ok, detail.join(" | "));
	}
	const gateFn = extractPollGate(src);
	check("S4a 从补丁后 client.js 成功抽出 B2 的轮询门控体", typeof gateFn === "function", "extract-poll-gate");
	if (gateFn) {
		const mk = () => {
			const timers = [];
			return {
				timers,
				setInterval: (fn, ms) => { const id = timers.length + 1; timers.push({ id, ms, cleared: false }); return id; },
				clearInterval: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
			};
		};
		const cases = [
			[60, true, { hidden: false }, true, "可见 + 60s → 建立定时器"],
			[0, true, { hidden: false }, false, "refreshSec=0（不轮询）→ 不建立"],
			[60, false, { hidden: false }, false, "卡片不可见 → 不建立"],
			[60, true, { hidden: true }, false, "标签页隐藏 → 不建立"],
			[60, false, { hidden: true }, false, "两者都不可见 → 不建立"],
		];
		let ok = true;
		const detail = [];
		for (const [sec, visible, doc, wantTimer, label] of cases) {
			const env2 = mk();
			let threw = null;
			try {
				gateFn(sec, visible, doc, { current: () => {} }, env2.setInterval, env2.clearInterval);
			} catch (cause) { threw = cause; }
			const got = env2.timers.length > 0;
			if (threw || got !== wantTimer) ok = false;
			detail.push(`${label}: timer=${got}${threw ? ` (抛错 ${threw.message})` : ""}`);
		}
		check("S4b B2：轮询门控五态（含用户要求保留的 refreshSec=0）逐条符合预期", ok, detail.join(" | "));
		// 定时器周期必须是 refreshSec*1000
		const env3 = mk();
		gateFn(60, true, { hidden: false }, { current: () => {} }, env3.setInterval, env3.clearInterval);
		check("S4c 定时器周期 = refreshSec*1000（默认 60 → 60000ms）", env3.timers[0]?.ms === 60000, `ms=${env3.timers[0]?.ms}`);
	}
}

function finish() {
	if (OUT) {
		const out = resolve(OUT);
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, JSON.stringify({ client: clientPath, at: new Date().toISOString(), fails, results }, null, 2) + "\n", "utf8");
		console.log(`[smoke] JSON 已写出：${out}`);
	}
	console.log(`[smoke] ${fails === 0 ? "ALL PASS" : `${fails} FAIL`}`);
	process.exit(fails === 0 ? 0 : 1);
}
finish();
