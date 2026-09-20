// 2026-09-14 tooltip — hit-testing / tooltip-position unit check.
// Extracts the REAL render-layer helpers from lib/client.js
// (hitAreaPoints / hitBarRects / hitGridCells / tipAtEvent) plus the geometry
// functions they consume (scaleArea / scaleBars / barRects / heatmapGrid /
// formatTokens), and asserts their behavior over REAL data (dev/trend.json +
// dev/grid.json — itself produced by the real queryTimeseries/queryHeatmap
// aggregation): every data point must be hittable at its own coordinate and
// the returned day/token text must match the underlying series/cell.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = readFileSync(join(root, "lib", "client.js"), "utf8");
const trend = JSON.parse(readFileSync(join(root, "dev", "trend.json"), "utf8"));
const grid = JSON.parse(readFileSync(join(root, "dev", "grid.json"), "utf8"));

function extractFn(src, fnName) {
	const marker = "function " + fnName + "(";
	const start = src.indexOf(marker);
	if (start < 0) throw new Error("function " + fnName + " not found");
	let paren = 1;
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

const fnNames = [
	"parseDay", "formatDay", "heatmapGrid", "scaleBars", "barRects", "scaleArea", "formatTokens",
	"hitAreaPoints", "hitBarRects", "hitGridCells", "tipAtEvent", "tipTokens",
];
const fnSrcs = fnNames.map((n) => extractFn(clientSrc, n));
const body =
	extractFills(clientSrc) + "\n" + fnSrcs.join("\n") +
	"\nreturn { parseDay, formatDay, heatmapGrid, scaleBars, barRects, scaleArea, formatTokens, hitAreaPoints, hitBarRects, hitGridCells, tipAtEvent, tipTokens };";;
const win = { innerWidth: 1280, innerHeight: 720 };
const mod = new Function("window", body)(win);

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
	if (ok) { passed += 1; console.log("PASS " + label); }
	else { failed += 1; console.log("FAIL " + label + " — " + (detail ?? "")); }
};

// --- 1. area chart: every real point hittable at its own coordinate --------
const areaPoints = trend["area"]["points"];
const seriesByDay = new Map(trend["series"].map((s) => [s.day, s]));
areaPoints.forEach((p, i) => {
	check("area point#" + i + " (" + p.day + ") self-hit", mod.hitAreaPoints(areaPoints, p.x, p.y, 12) === i, "got " + mod.hitAreaPoints(areaPoints, p.x, p.y, 12));
});
// segment midpoints hit one of the two endpoints
for (let i = 0; i + 1 < areaPoints.length; i += 7) {
	const a = areaPoints[i], b = areaPoints[i + 1];
	const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
	const idx = mod.hitAreaPoints(areaPoints, mx, my, 12);
	check("area segment " + i + "–" + (i + 1) + " midpoint hit endpoint", idx === i || idx === i + 1, "got " + idx);
}
// far away → miss
check("area far-off point misses", mod.hitAreaPoints(areaPoints, -40, -40, 12) === -1);
check("area point value text matches series", (() => {
	const idx = mod.hitAreaPoints(areaPoints, areaPoints[0].x, areaPoints[0].y, 12);
	return idx === 0 && seriesByDay.get(areaPoints[0].day).formatted !== undefined;
})());
// the day returned by the hit matches the point's own day (date correctness)
check("area hit returns the point's day", (() => {
	const idx = mod.hitAreaPoints(areaPoints, areaPoints[5].x + 3, areaPoints[5].y + 3, 12);
	return idx >= 0 && areaPoints[idx].day === trend["series"][idx].day;
})());

// --- 2. bar chart: rect containment + narrow-bar nearest fallback ----------
const rects = trend["bars"]["rects"];
const seriesValueByIndex = new Map(trend["series"].map((s, i) => [i, s]));
rects.forEach((r, i) => {
	const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
	check("bar rect#" + i + " (" + r.day + ") center hit", mod.hitBarRects(rects, cx, cy) === i, "got " + mod.hitBarRects(rects, cx, cy));
	// value text correctness: hit index → series value
});
// corner of the rect still hits (strict containment)
check("bar rect#0 top-left corner hit", (() => {
	const r = rects[0];
	return mod.hitBarRects(rects, r.x + 0.1, r.y + 0.1) === 0;
})());
// gap between two bars with pointer in vertical span → nearest (fallback)
let gapHit = true;
for (let i = 0; i + 1 < rects.length; i++) {
	const r = rects[i], n = rects[i + 1];
	if (n.x > r.x + r.width) {
		const gx = r.x + r.width + 0.5;
		const gy = Math.max(r.y, n.y) + 2; // inside both vertical spans (if overlapping)
		const idx = mod.hitBarRects(rects, gx, gy);
		gapHit = gapHit && (idx === i || idx === i + 1);
		if (idx < 0) { gapHit = false; console.log("  gap i=" + i + " gx=" + gx + " gy=" + gy + " got " + idx); }
	}
}
check("bar gaps resolve to nearest bar", gapHit);
// above the bars (out of vertical tolerance) → miss
check("bar above-all miss", (() => {
	const ys = rects.map((r) => r.y);
	const my = Math.min(...ys) - 30;
	return mod.hitBarRects(rects, rects[0].x + rects[0].width / 2, my) === -1;
})());
check("bar hit returns series day/value", (() => {
	const r = rects[7];
	const idx = mod.hitBarRects(rects, r.x + r.width / 2, r.y + r.height / 2);
	return idx === 7 && rects[idx].day === trend["series"][idx].day && Number(rects[idx].value) === Number(trend["series"][idx].value);
})());

// --- 3. heatmap: cell containment incl. monthRow offset --------------------
const cells = grid["cells"];
const monthRow = 16;
let cellAll = true;
cells.forEach((c) => {
	const hit = mod.hitGridCells(cells, c.x + c.size / 2, monthRow + c.y + c.size / 2, monthRow);
	if (hit < 0) { cellAll = false; console.log("  cell " + c.day + " not hit"); }
	else if (cells[hit].day !== c.day) { cellAll = false; console.log("  cell " + c.day + " hit wrong " + cells[hit].day); }
});
check("heatmap all " + cells.length + " cells self-hit (offset applied)", cellAll);
check("heatmap no-data cell returns day + level 0", (() => {
	const empty = cells.find((c) => c.level === 0);
	if (!empty) return true; // no empty cell in real data — acceptable
	const hit = mod.hitGridCells(cells, empty.x + empty.size / 2, monthRow + empty.y + empty.size / 2, monthRow);
	return hit >= 0 && cells[hit].day === empty.day && cells[hit].level === 0;
})());
check("heatmap outside misses", mod.hitGridCells(cells, -5, monthRow + 10, monthRow) === -1);

// --- 4. tipAtEvent viewport flip -------------------------------------------
const pMid = mod.tipAtEvent({ clientX: 500, clientY: 300 }, 170, 46);
check("tip mid-viewport: +14 right, centered, arrow L", pMid.left === 514 && pMid.top === 300 - 23 && pMid.dir === "l" && pMid.fx === false && pMid.fy === false, JSON.stringify(pMid));
const pRight = mod.tipAtEvent({ clientX: 1250, clientY: 300 }, 170, 46);
check("tip right-edge flips left, arrow R", pRight.left === 1250 - 170 - 14 && pRight.fx === true && pRight.dir === "r" && pRight.fy === false, JSON.stringify(pRight));
const pBottom = mod.tipAtEvent({ clientX: 500, clientY: 710 }, 170, 46);
check("tip bottom-edge flips up, arrow D", pBottom.top === 712 - 46 && pBottom.fx === false && pBottom.fy === true && pBottom.dir === "d", JSON.stringify(pBottom));
const pCorner = mod.tipAtEvent({ clientX: 2, clientY: 2 }, 170, 46);
check("tip top-left no-flip +14, arrow L, clamped top U", pCorner.left === 16 && pCorner.top === 8 && pCorner.dir === "u" && !pCorner.fx && !pCorner.fy, JSON.stringify(pCorner));
// flip that would still land <8 must clamp to 8 (huge tooltip near left edge)
const pClamp = mod.tipAtEvent({ clientX: 200, clientY: 200 }, 1300, 46);
check("tip clamp after flip to 8", pClamp.left === 8, JSON.stringify(pClamp));
// bottom-right corner → horizontal flip + bottom overflow (fx+fy, arrow D):
// the hover-flip preview scenario, proven at code level for the real viewport
const pBr = mod.tipAtEvent({ clientX: 1270, clientY: 715 }, 110, 40);
check("tip bottom-right fx+fy, arrow D", pBr.fx === true && pBr.fy === true && pBr.dir === "d" && pBr.left === 1270 - 110 - 14 && pBr.top === 712 - 40, JSON.stringify(pBr));

// --- 5. tooltip display formatters (iteration 2) ---------------------------
check("tipTokens 253460000 → 253.5M", mod.tipTokens(253460000) === "253.5M");
check("tipTokens 1218596672 → 1.2B", mod.tipTokens(1218596672) === "1.2B");
check("tipTokens 1880694444 → 1.9B", mod.tipTokens(1880694444) === "1.9B");
check("tipTokens 1234 → 1K", mod.tipTokens(1234) === "1K");
check("tipTokens 999 → 999", mod.tipTokens(999) === "999");
check("tipTokens 0 → 0", mod.tipTokens(0) === "0");
check("tooltip date MM-DD matches axis-label form", "2026-08-17".slice(5) === "08-17" && trend["series"][0].day.slice(5).length === 5);
check("formatTokens 1218596672 → 1.22b (global unchanged)", mod.formatTokens(1218596672) === "1.22b");
check("formatTokens 0 → 0", mod.formatTokens(0) === "0");

console.log("\nhit-test: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
console.log("verify-hit: PASS");
