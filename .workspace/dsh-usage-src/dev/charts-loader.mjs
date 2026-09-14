// 2026-09-12 heatmap redesign — dev helper: load the actual heatmapGrid code
// from lib/charts.js (source of truth) into a runnable module, so preview
// dumps exercise the real implementation rather than a re-implementation.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function extractFn(src, fnName) {
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

export function extractFills(src) {
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

export function loadChartsModule(src) {
	const fillsSrc = extractFills(src);
	const parseDaySrc = extractFn(src, "parseDay");
	const formatDaySrc = extractFn(src, "formatDay");
	const heatmapGridSrc = extractFn(src, "heatmapGrid");
	const body =
		fillsSrc + "\n" + parseDaySrc + "\n" + formatDaySrc + "\n" + heatmapGridSrc +
		"\nreturn { FILLS, parseDay, formatDay, heatmapGrid };";
	return new Function(body)();
}

export function chartsModuleFrom(root) {
	return loadChartsModule(readFileSync(join(root, "lib", "charts.js"), "utf8"));
}
