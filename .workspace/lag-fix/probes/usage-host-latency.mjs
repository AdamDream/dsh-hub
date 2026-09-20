#!/usr/bin/env node
// ============================================================================
// usage-host-latency.mjs — dsh-usage 宿主阻塞只读探针（改前/改后对照）
// ============================================================================
// 目的：复刻主 agent 已验证的方法，量化「设置卡片一次轮询周期把宿主事件循环
//       冻结多久」。两路测量、一律 GET/POST 只读 RPC，不写 usage.db、不压测、
//       不触碰宿主进程（不发信号、不重启）。
//
//   路线 1 「背景探针」：每 PROBE_INTERVAL_MS 发一次轻量 /api/host.describe，
//                        同时顺序跑一遍卡片真实发起的 7 个 /usage/* 调用。
//                        单次 /usage/* 的同步 SQL 会阻塞宿主事件循环，表现为
//                        背景探针的延迟尖峰 → 报 max 尖峰（= 单周期阻塞上限）。
//   路线 2 「逐端点耗时」：顺序单发每个 /usage/* 端点，记录 min/median/max，
//                        用于对照报告里的 578ms / heatmap 289ms。
//
// 用法：
//   node probes/usage-host-latency.mjs                    # 默认 3 个周期
//   node probes/usage-host-latency.mjs --cycles 5
//   node probes/usage-host-latency.mjs --port 3080 --out reports/probe-after.json
//   node probes/usage-host-latency.mjs --label after-restart
//   node probes/usage-host-latency.mjs --pairs 5 --out reports/probe-block-after.json
//       ^ 「配对阻塞」模式（验收指标专用）：并发发 1 次 /usage/heatmap，同时每
//         PROBE_INTERVAL_MS 打一发 /api/host.describe；heatmap 期间背景探针的
//         最大延迟 = 该查询把宿主事件循环冻结了多久。改前 ≈289-300ms，改后应 <40ms。
//
// 预期（审计报告 §5 总账）：
//   改前（现状）  : max 尖峰 ≈ 400-600ms（heatmap 单独 ≈289ms）
//   改后（A0+A1+A2）: max 尖峰 < 40ms，heatmap ≈ 0-1ms
//
// 退出码：0 = 跑完并写出 JSON；2 = 参数/连接错误。
// ============================================================================

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const argv = process.argv.slice(2);
function argOf(name, dflt) {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}
const PORT = Number(argOf("--port", "3080"));
const CYCLES = Number(argOf("--cycles", "3"));
const LABEL = argOf("--label", "probe");
const OUT = argOf("--out", "");
const BASE = `http://127.0.0.1:${PORT}`;
const PROBE_INTERVAL_MS = 20; // 背景探针间隔（20ms 足以覆盖单次阻塞窗口）
const HOST_ENDPOINT = "/api/host.describe";
const USAGE_CHANNEL = "/usage";

let rpcSeq = 0;
function nextId(tag) {
	rpcSeq += 1;
	return `lagfix-${tag}-${process.pid}-${rpcSeq}`;
}

/** 单发一次 RPC（只读），返回耗时与解析后的值。 */
async function rpc(path, method, payload) {
	const body = { type: "client-request", rpcId: nextId(method), method, payload };
	const t0 = performance.now();
	let res;
	try {
		res = await fetch(BASE + path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	} catch (cause) {
		return { ms: performance.now() - t0, ok: false, error: String(cause && cause.message) || String(cause) };
	}
	const text = await res.text();
	const ms = performance.now() - t0;
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* non-JSON body */
	}
	if (res.status !== 200 || !json || json.result === undefined) {
		return { ms, ok: false, status: res.status, error: text.slice(0, 200) };
	}
	return { ms, ok: json.result.ok === true, status: res.status, value: json.result.value, error: json.result.error };
}

/** 一个「卡片周期」= 客户端 loadAll 真实发起的 7 个调用（顺序单发以便归因）。 */
function cycleCalls(now) {
	const from = now - 7 * 86400000; // 卡片默认「近 7 天」（改前滚动窗口 / 改后日对齐）
	const payload = { from, to: now, dataSources: "all" };
	const year = new Date(from).getFullYear();
	return [
		["summary", payload],
		["timeseries", { granularity: "day", ...payload }],
		["heatmap", { year, dataSources: "all" }],
		["byModel", payload],
		["byProject", payload],
		["byDay", payload],
		["timeseries", { granularity: "hour", from: now - 24 * 3600000, to: now, dataSources: "all" }],
	];
}

function median(xs) {
	if (xs.length === 0) return null;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function round(x, d = 2) {
	return x === null || x === undefined ? null : Number(x.toFixed(d));
}

/** 「配对阻塞」模式：并发 heatmap + 背景探针，量出 heatmap 冻结事件循环的时长。 */
async function pairsMode() {
	const PAIRS = Number(argOf("--pairs", "5"));
	const results = [];
	for (let i = 1; i <= PAIRS; i++) {
		const now = Date.now();
		const year = new Date(now - 7 * 86400000).getFullYear();
		const samples = [];
		let stop = false;
		let wake = null;
		const bg = (async () => {
			while (!stop) {
				const r = await rpc(HOST_ENDPOINT, "host.describe", {});
				samples.push({ ts: Date.now(), ms: r.ms, ok: r.ok });
				if (stop) break;
				await new Promise((res) => {
					const t = setTimeout(() => { wake = null; res(); }, PROBE_INTERVAL_MS);
					wake = () => { clearTimeout(t); wake = null; res(); };
				});
			}
		})();
		const heat = await rpc(`${USAGE_CHANNEL}/heatmap`, "heatmap", { year, dataSources: "all" });
		stop = true;
		if (typeof wake === "function") wake();
		await bg;
		const ok = samples.filter((s) => s.ok).map((s) => s.ms);
		const maxBg = ok.length ? Math.max(...ok) : null;
		results.push({ pair: i, heatmapMs: round(heat.ms), heatmapOk: heat.ok, heatmapRows: Array.isArray(heat.value) ? heat.value.length : null, bgSamples: samples.length, bgMaxMs: maxBg === null ? null : round(maxBg), bgMedianMs: round(median(ok)) });
		console.log(`[pairs] #${i} heatmap=${round(heat.ms)}ms rows=${Array.isArray(heat.value) ? heat.value.length : "-"}  背景探针 max=${maxBg === null ? "-" : round(maxBg)}ms median=${round(median(ok))}ms（n=${samples.length}）`);
	}
	const heatMs = results.map((r) => r.heatmapMs);
	const bgMax = results.map((r) => r.bgMaxMs).filter((v) => v !== null);
	const report = {
		label: LABEL,
		mode: "pairs",
		base: BASE,
		at: new Date().toISOString(),
		pairs: results,
		verdict: {
			heatmapMinMs: Math.min(...heatMs),
			heatmapMedianMs: round(median(heatMs)),
			singleCycleBlockMs: bgMax.length ? Math.max(...bgMax) : null,
			blockUnder40ms: bgMax.length ? Math.max(...bgMax) < 40 : null,
			heatmapUnder1ms: Math.min(...heatMs) < 1,
		},
	};
	console.log("[pairs] ── 汇总 ──");
	console.log(`[pairs] heatmap 单发 min=${report.verdict.heatmapMinMs.toFixed(2)}ms median=${report.verdict.heatmapMedianMs}ms`);
	console.log(`[pairs] 单周期阻塞（heatmap 并发期间背景探针 max）= ${report.verdict.singleCycleBlockMs}ms → 门槛 <40ms: ${report.verdict.blockUnder40ms === null ? "n/a" : report.verdict.blockUnder40ms ? "PASS" : "FAIL"}`);
	console.log(`[pairs] heatmap <1ms: ${report.verdict.heatmapUnder1ms ? "PASS" : "FAIL"}`);
	if (OUT) {
		const out = resolve(OUT);
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, JSON.stringify(report, null, 2) + "\n", "utf8");
		console.log(`[probe] JSON 已写出：${out}`);
	}
	process.exit(0);
}

async function main() {
	// --- 前置：确认宿主可达且 /usage 通道在 ---
	const pre = await rpc(`${USAGE_CHANNEL}/status`, "status", {});
	if (!pre.ok) {
		console.error(`[probe] 宿主不可达或 /usage 通道未注册：${JSON.stringify(pre.error ?? pre)}`);
		process.exit(2);
	}
	const status = pre.value ?? {};
	console.log(`[probe] label=${LABEL} base=${BASE} cycles=${CYCLES}`);
	console.log(`[probe] 宿主 /usage 可用：lastIngest=${status.lastIngest ?? "-"} eventsDsh=${status.eventsDsh} eventsCc=${status.eventsCc}`);

	const hostSamples = [];
	const endpointSamples = new Map(); // method(+granularity) -> [ms]
	const cycleTotals = [];
	let hostStop = false;
	let wake = null; // 立刻唤醒 hostLoop 的休眠（收尾不残留定时器）

	const hostLoop = (async () => {
		while (!hostStop) {
			const r = await rpc(HOST_ENDPOINT, "host.describe", {});
			hostSamples.push({ ts: new Date().toISOString(), ms: round(r.ms), ok: r.ok });
			if (hostStop) break;
			await new Promise((res) => {
				const timer = setTimeout(() => {
					wake = null;
					res();
				}, PROBE_INTERVAL_MS);
				wake = () => {
					clearTimeout(timer);
					wake = null;
					res();
				};
			});
		}
	})();

	for (let c = 1; c <= CYCLES; c++) {
		const now = Date.now();
		const calls = cycleCalls(now);
		let total = 0;
		const rows = [];
		for (const [method, payload] of calls) {
			const key = method === "timeseries" ? `timeseries(${payload.granularity})` : method;
			const path = `${USAGE_CHANNEL}/${method}`;
			const r = await rpc(path, method, payload);
			total += r.ms;
			const list = endpointSamples.get(key) ?? [];
			list.push(round(r.ms));
			endpointSamples.set(key, list);
			rows.push({ key, ms: round(r.ms), ok: r.ok, rows: Array.isArray(r.value) ? r.value.length : undefined });
		}
		cycleTotals.push({ cycle: c, totalMs: round(total), calls: rows });
		console.log(`[probe] cycle ${c}: 单周期 /usage/* 串行总耗时 = ${round(total)}ms`);
		for (const row of rows) {
			console.log(`         - ${row.key.padEnd(18)} ${String(row.ms).padStart(8)}ms  ok=${row.ok} rows=${row.rows ?? "-"}`);
		}
	}

	hostStop = true;
	if (typeof wake === "function") wake();
	await hostLoop;

	const okHost = hostSamples.filter((s) => s.ok).map((s) => s.ms);
	const maxHost = okHost.length ? Math.max(...okHost) : null;
	const sortedHost = [...okHost].sort((a, b) => a - b);
	const p95 = sortedHost.length ? sortedHost[Math.min(sortedHost.length - 1, Math.floor(sortedHost.length * 0.95))] : null;

	const perEndpoint = {};
	for (const [key, list] of [...endpointSamples.entries()]) {
		perEndpoint[key] = { min: Math.min(...list), median: round(median(list)), max: Math.max(...list), runs: list.length };
	}

	const report = {
		label: LABEL,
		base: BASE,
		cycles: CYCLES,
		at: new Date().toISOString(),
		hostProbe: {
			samples: hostSamples.length,
			min: okHost.length ? Math.min(...okHost) : null,
			median: round(median(okHost)),
			p95: p95 === null ? null : round(p95),
			max: maxHost === null ? null : round(maxHost),
			maxSampleTs: hostSamples.find((s) => s.ms === maxHost)?.ts ?? null,
		},
		perEndpoint,
		cycleTotals,
		verdict: {
			singleCycleBlockMs: maxHost === null ? null : round(maxHost),
			heatmapMs: perEndpoint.heatmap ? perEndpoint.heatmap.min : null,
			// 验收门槛（报告 §5）：单周期阻塞 < 40ms；heatmap < 1ms
			blockUnder40ms: maxHost !== null && maxHost < 40,
			heatmapUnder1ms: perEndpoint.heatmap ? perEndpoint.heatmap.min < 1 : null,
		},
		rawHostSamples: hostSamples,
	};

	console.log("[probe] ── 汇总 ──");
	console.log(`[probe] 背景探针延迟：min=${report.hostProbe.min}ms median=${report.hostProbe.median}ms p95=${report.hostProbe.p95}ms max=${report.hostProbe.max}ms`);
	console.log(`[probe] 单周期阻塞（= 探针 max 尖峰）：${report.verdict.singleCycleBlockMs}ms  → 门槛 <40ms: ${report.verdict.blockUnder40ms ? "PASS" : "FAIL"}`);
	console.log(`[probe] heatmap 单发 min：${report.verdict.heatmapMs}ms  → 门槛 <1ms: ${report.verdict.heatmapUnder1ms === null ? "n/a" : report.verdict.heatmapUnder1ms ? "PASS" : "FAIL"}`);
	for (const [k, v] of Object.entries(perEndpoint)) {
		console.log(`[probe]   ${k.padEnd(18)} min=${String(v.min).padStart(8)} median=${String(v.median).padStart(8)} max=${String(v.max).padStart(8)}`);
	}

	if (OUT) {
		const out = resolve(OUT);
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, JSON.stringify(report, null, 2) + "\n", "utf8");
		console.log(`[probe] JSON 已写出：${out}`);
	}
}

if (argv.includes("--pairs")) {
	await pairsMode();
} else {
	await main();
}
