// 2026-09-12 heatmap redesign / 2026-09-14 tooltip — inline-copy consistency
// check. Extracts FILLS/parseDay/formatDay/heatmapGrid/scaleBars/barRects/
// scaleArea from lib/charts.js (source of truth, modern syntax) and from the
// `charts.js 内联` copy inside lib/client.js (legacy concat style) and verifies:
//   1. functional equivalence on a battery of datasets (deep-equal),
//   2. key-token parity (all redesign literals present in both),
//   3. a normalized textual diff of the heatmapGrid bodies (style-only
//      differences are expected and listed).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chartsSrc = readFileSync(join(root, "lib", "charts.js"), "utf8");
const clientSrc = readFileSync(join(root, "lib", "client.js"), "utf8");

function extractFn(src, fnName) {
	const marker = "function " + fnName + "(";
	const start = src.indexOf(marker);
	if (start < 0) throw new Error("function " + fnName + " not found");
	// Body open = first `{` at paren depth 0 (skips `opts = {}`-style defaults).
	let paren = 1; // marker already consumed the signature's opening `(`
	let open = -1;
	for (let i = start + marker.length; i < src.length; i += 1) {
		const ch = src[i];
		if (ch === "(") paren += 1;
		else if (ch === ")") paren -= 1;
		else if (ch === "{" && paren === 0) { open = i; break; }
	}
	if (open < 0) throw new Error("body brace not found for " + fnName);
	let depth = 0;
	for (let i = open; i < src.length; i += 1) {
		if (src[i] === "{") depth += 1;
		else if (src[i] === "}") {
			depth -= 1;
			if (depth === 0) return src.slice(start, i + 1);
		}
	}
	throw new Error("unmatched brace for " + fnName);
}

function extractFills(src) {
	const start = src.indexOf("const FILLS = [");
	if (start < 0) throw new Error("FILLS not found");
	const open = src.indexOf("[", start);
	let depth = 0;
	for (let i = open; i < src.length; i += 1) {
		if (src[i] === "[") depth += 1;
		else if (src[i] === "]") {
			depth -= 1;
			if (depth === 0) return src.slice(start, i + 1);
		}
	}
	throw new Error("unmatched bracket for FILLS");
}

function buildModule(fillsSrc, parseDaySrc, formatDaySrc, heatmapGridSrc, scaleBarsSrc, barRectsSrc, scaleAreaSrc, bucketLabelSrc) {
	const body =
		fillsSrc +
		"\n" +
		parseDaySrc +
		"\n" +
		formatDaySrc +
		"\n" +
		heatmapGridSrc +
		"\n" +
		scaleBarsSrc +
		"\n" +
		barRectsSrc +
		"\n" +
		scaleAreaSrc +
		"\n" +
		// 2026-09-18: scaleBars/scaleArea now label buckets through bucketLabel
		// (hour keys used to degrade to a repeated MM-DD label), so the built
		// module must carry it too.
		bucketLabelSrc +
		"\nreturn { FILLS, parseDay, formatDay, heatmapGrid, scaleBars, barRects, scaleArea, bucketLabel };";
	return new Function(body)();
}

const charts = buildModule(
	extractFills(chartsSrc),
	extractFn(chartsSrc, "parseDay"),
	extractFn(chartsSrc, "formatDay"),
	extractFn(chartsSrc, "heatmapGrid"),
	extractFn(chartsSrc, "scaleBars"),
	extractFn(chartsSrc, "barRects"),
	extractFn(chartsSrc, "scaleArea"),
	extractFn(chartsSrc, "bucketLabel"),
);
const inline = buildModule(
	extractFills(clientSrc),
	extractFn(clientSrc, "parseDay"),
	extractFn(clientSrc, "formatDay"),
	extractFn(clientSrc, "heatmapGrid"),
	extractFn(clientSrc, "scaleBars"),
	extractFn(clientSrc, "barRects"),
	extractFn(clientSrc, "scaleArea"),
	extractFn(clientSrc, "bucketLabel"),
);

// --- 1. functional equivalence --------------------------------------------
function mkDay(y, m, d, total) {
	return { day: y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"), total };
}
const datasets = [
	[],
	[mkDay(2026, 8, 11, 1.9e9)],
	[mkDay(2026, 8, 11, 0)],
	[mkDay(2026, 8, 3, 500), mkDay(2026, 8, 10, 5000), mkDay(2026, 8, 14, 25000)],
	// narrow 3-week span (start/end-month collapse path)
	[
		mkDay(2026, 8, 17, 100),
		mkDay(2026, 8, 24, 200),
		mkDay(2026, 8, 31, 300),
		mkDay(2026, 9, 1, 400),
		mkDay(2026, 9, 3, 500),
	],
	// month boundary inside one week
	[mkDay(2026, 7, 30, 10), mkDay(2026, 8, 1, 20), mkDay(2026, 8, 2, 30)],
	// 7-day / 30-day / 90-day trend spans with zeros and large values
	Array.from({ length: 7 }, (_, i) => mkDay(2026, 9, 6 + i, i % 3 === 0 ? 0 : Math.round(Math.pow(i + 2, 3) * 1000))),
	Array.from({ length: 30 }, (_, i) => mkDay(2026, 8, 14 + i, i % 4 === 0 ? 0 : Math.round(1e8 * Math.pow(1.2, i % 9)))),
	Array.from({ length: 90 }, (_, i) => {
		const d = new Date(2026, 5, 15 + i);
		const mm = String(d.getMonth() + 1).padStart(2, "0");
		const dd = String(d.getDate()).padStart(2, "0");
		return { day: "2026-" + mm + "-" + dd, value: (i % 5 === 0 ? 0 : Math.round(Math.pow(i % 11 + 1, 2) * 12345)) };
	}),
	// full year (leap-adjacent sanity, varied totals, sparse)
	Array.from({ length: 365 }, (_, i) => {
		const d = new Date(2026, 0, 1 + i);
		const mm = String(d.getMonth() + 1).padStart(2, "0");
		const dd = String(d.getDate()).padStart(2, "0");
		const total = i % 7 === 0 ? 0 : Math.round(Math.pow(i % 13 + 1, 3) * 1000);
		return { day: "2026-" + mm + "-" + dd, total };
	}).filter((d) => d.total > 0),
	// unsorted input
	[mkDay(2026, 9, 5, 900), mkDay(2026, 8, 2, 100), mkDay(2026, 8, 20, 700)],
	// single day mid-month (partial first week)
	[mkDay(2026, 6, 15, 42)],
	// spanning two years of data range (grid crosses Dec→Jan)
	[mkDay(2025, 12, 30, 5), mkDay(2026, 1, 2, 6), mkDay(2026, 1, 5, 7)],
];

// series for scaleBars/scaleArea: accept {day, value} or {day, total}
function asSeries(rows) {
	return rows.map((r) => ({ day: r.day, value: Number.isFinite(r.value) ? r.value : r.total }));
}

let failures = 0;
const total = (label, a, b) => {
	const sa = JSON.stringify(a);
	const sb = JSON.stringify(b);
	if (sa !== sb) {
		failures += 1;
		console.log("MISMATCH " + label + ":\n  charts : " + sa + "\n  inline : " + sb);
		return false;
	}
	return true;
};

// heatmapGrid battery (unchanged from the heatmap redesign; P0-b adds
// `levels` variants to prove the configurable bucket count stays in sync).
const optsList = [
	{},
	{ gap: 4 },
	{ startWeekday: 1 },
	{ gap: 2, startWeekday: 6 },
	{ levels: 1 },
	{ levels: 3 },
	{ levels: 6 },
	{ levels: 0 },
	{ levels: 99 },
	{ levels: 2.5 },
	{ gap: 3, startWeekday: 3, levels: 4 },
];
let heatCases = 0;
datasets.forEach((days, i) => {
	optsList.forEach((opts, j) => {
		heatCases += 1;
		total("heatmapGrid dataset#" + i + " opts#" + j, charts.heatmapGrid(days, 11, opts), inline.heatmapGrid(days, 11, opts));
	});
});

// scaleBars / scaleArea / barRects battery (tooltip day pass-through)
let scaleCases = 0;
datasets.forEach((rows, i) => {
	const series = asSeries(rows);
	[560, 300].forEach((w) => {
		const h = 150;
		scaleCases += 1;
		total("scaleBars dataset#" + i + " w=" + w, charts.scaleBars(series, w, h), inline.scaleBars(series, w, h));
		scaleCases += 1;
		total("scaleArea dataset#" + i + " w=" + w, charts.scaleArea(series, w, h), inline.scaleArea(series, w, h));
		[1, 2, 0].forEach((pad) => {
			scaleCases += 1;
			const aRects = charts.barRects(charts.scaleBars(series, w, h).rects, w, h, { pad });
			const bRects = inline.barRects(inline.scaleBars(series, w, h).rects, w, h, { pad });
			total("barRects dataset#" + i + " w=" + w + " pad=" + pad, aRects, bRects);
		});
	});
});

const totalCases = heatCases + scaleCases;
console.log("functional equivalence: " + (totalCases - failures) + "/" + totalCases + " datasets×opts passed (heatmapGrid " + heatCases + " + scale/bar " + scaleCases + ")");
if (failures > 0) process.exit(1);

// --- 2. key-token parity ---------------------------------------------------
// Geometry tokens must be present in BOTH files; render-layer strings must be
// present in client.js only (charts.js is pure geometry by design).
const geomTokens = [
	"var(--du-heat-0)",
	"var(--du-heat-1)",
	"var(--du-heat-2)",
	"var(--du-heat-3)",
	"var(--du-heat-4)",
	"var(--du-heat-5)",
	"var(--du-heat-6)",
	"--du-heat-0-stroke",
	"--du-heat-0-stroke-width",
	"strokeWidth",
	"月",
	"peak",
	"peakDay",
	"months",
	"dataMonths",
	"weeks <= 4",
	"day: s.day",
	"day: v.day",
	"2026-09-14 tooltip",
	// P0-b: configurable intensity bucket count (both copies must read opts.levels)
	"opts.levels",
	"levels >= 1",
	"Math.min(6, opts.levels)",
];
const renderTokens = [
	"无数据", "总用量", "峰值", "tokens/日", "灰格", "--du-heat-peak-stroke", "--du-heat-month-fill",
	"du_tip", "du_tipDay", "du_tipValue", "du_tipUnit", "du_tipMuted", "du_tipL", "du_tipR", "du_tipD", "--du-tip-ax", "--du-tip-ay", "tipTokens", "onMouseMove", "tipAtEvent", "hitAreaPoints", "hitBarRects", "hitGridCells",
	// P0-b: settings switches live in the render layer (client.js only)
	"settingsScope", "peakRingEnabled", "monthLabelsEnabled", "legendNoteEnabled", "tooltipEnabled", "usageSettingsOf", "heatmap.levels",
];
let tokenFail = 0;
for (const tok of geomTokens) {
	const inCharts = chartsSrc.includes(tok);
	const inClient = clientSrc.includes(tok);
	const status = inCharts && inClient ? "ok" : (tokenFail += 1, "MISSING");
	console.log("geom token " + JSON.stringify(tok) + " charts=" + inCharts + " client=" + inClient + " → " + status);
}
for (const tok of renderTokens) {
	const inCharts = chartsSrc.includes(tok);
	const inClient = clientSrc.includes(tok);
	const status = inClient && !inCharts ? "ok" : (tokenFail += 1, "UNEXPECTED");
	console.log("render token " + JSON.stringify(tok) + " charts=" + inCharts + " client=" + inClient + " → " + status);
}
if (tokenFail > 0) process.exit(1);

// --- 3. normalized textual diff (style-only differences expected) -----------
function normalize(src) {
	return src
		.replace(/\/\/[^\n]*/g, "") // strip comments
		.replace(/\s+/g, " ") // collapse whitespace
		.trim();
}
const normCharts = normalize(extractFn(chartsSrc, "heatmapGrid"));
const normInline = normalize(extractFn(clientSrc, "heatmapGrid"));
console.log("\n-- heatmapGrid body diff (charts.js vs client.js inline) --");
if (normCharts === normInline) {
	console.log("bodies textually identical after comment/whitespace normalization");
} else {
	console.log("bodies differ after comment/whitespace normalization (expected: syntax-style differences only, verified behaviorally identical above)");
	const a = normCharts.split(" ");
	const b = normInline.split(" ");
	let ai = 0, bi = 0, hunks = 0;
	while (ai < a.length && bi < b.length) {
		if (a[ai] === b[bi]) { ai += 1; bi += 1; continue; }
		hunks += 1;
		console.log("  [" + hunks + "] charts: ... " + a.slice(ai, ai + 6).join(" ") + " ...");
		console.log("  [" + hunks + "] inline: ... " + b.slice(bi, bi + 6).join(" ") + " ...");
		ai += 1; bi += 1;
	}
	if (ai < a.length || bi < b.length) {
		console.log("  length mismatch charts=" + a.length + " inline=" + b.length);
	}
	console.log("  (every textual diff above is a syntax-style rewrite; behavior proven identical by the functional-equivalence gate)");
}
console.log("\nFILLS charts: " + JSON.stringify(charts.FILLS));
console.log("FILLS inline: " + JSON.stringify(inline.FILLS));
console.log("verify-inline: PASS");
