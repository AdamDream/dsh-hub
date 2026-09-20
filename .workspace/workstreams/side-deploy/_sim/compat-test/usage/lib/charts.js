//#region lib/charts.js
/**
 * Pure SVG geometry generators for the dsh-usage card (AUDIT U10, A5 decision:
 * 零新增依赖、自绘 SVG — no echarts). Every function is dependency-free and
 * returns plain structures directly consumable by `React.createElement('svg',
 * …)` — the client bundle inlines these bodies verbatim (build-free bundle,
 * see the `charts.js 内联` marker in lib/client.js); this file is the
 * source of truth and stays `node --check`-able on its own.
 * @module dsh-usage/charts
 */

/**
 * Area-chart geometry: smooth-less polyline path + filled baseline path.
 * @param {Array<{x: number, y: number}>} points - already-scaled points.
 * @param {number} w - viewBox width.
 * @param {number} h - viewBox height.
 * @param {{baseline?: number}} [opts]
 * @returns {{line: string, area: string, w: number, h: number}}
 */
export function areaPath(points, w, h, opts = {}) {
	const baseline = Number.isFinite(opts.baseline) ? opts.baseline : h;
	if (!Array.isArray(points) || points.length === 0) {
		return { line: "", area: "", w, h };
	}
	const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
	const area = `${line} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`;
	return { line, area, w, h };
}

/**
 * Bar-chart rects for one value series.
 * @param {Array<{x: number, y: number, width: number, height: number, value: number}>} values
 *   — the caller scales values into coordinates.
 * @param {number} w - viewBox width.
 * @param {number} h - viewBox height.
 * @param {{pad?: number}} [opts]
 * @returns {Array<{x: number, y: number, width: number, height: number, value: number}>}
 */
export function barRects(values, w, h, opts = {}) {
	const pad = Number.isFinite(opts.pad) ? opts.pad : 1;
	if (!Array.isArray(values)) return [];
	return values.map((v) => ({
		x: Math.max(0, v.x + pad),
		y: Math.max(0, v.y),
		width: Math.max(0.5, v.width - pad * 2),
		height: Math.max(0, Math.min(v.height, h - v.y)),
		value: v.value,
	}));
}

/**
 * GitHub-style heatmap grid (≤7 intensity levels, 0 = none). `days` are
 * `{day: 'YYYY-MM-DD', total: number}`; weeks are columns of 7 day-cells
 * starting on `opts.startWeekday` (default 0 = Sunday).
 * @param {Array<{day: string, total: number}>} days
 * @param {number} cell - cell size in px (width = cell * 53 + gap * 52).
 * @param {{startWeekday?: number, gap?: number}} [opts]
 * @returns {{cells: Array<{x: number, y: number, size: number, fill: string,
 *   day: string, value: number, level: number}>, weeks: number, width: number, levels: number}}
 */
export function heatmapGrid(days, cell, opts = {}) {
	const gap = Number.isFinite(opts.gap) ? opts.gap : 3;
	const startWeekday = Number.isFinite(opts.startWeekday) ? opts.startWeekday : 0;
	const size = cell;
	const levels = 6; // 0 (none) + 6 intensity buckets → ≤7
	if (!Array.isArray(days) || days.length === 0) {
		return { cells: [], weeks: 0, width: 0, levels };
	}
	// Sorted by day; find the global min/max across the year grid.
	const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
	const first = parseDay(sorted[0].day);
	const last = parseDay(sorted[sorted.length - 1].day);
	const firstDow = (first.getDay() - startWeekday + 7) % 7;
	const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - firstDow);
	const daysTotal = Math.floor((last - start) / 86400000) + 1;
	const weeks = Math.ceil(daysTotal / 7);
	const maxTotal = Math.max(1, ...sorted.map((d) => d.total));
	const byDay = new Map(sorted.map((d) => [d.day, d]));
	const cells = [];
	for (let index = 0; index < weeks * 7; index += 1) {
		const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
		const day = formatDay(date);
		const entry = byDay.get(day);
		const x = Math.floor(index / 7) * (size + gap);
		const y = (index % 7) * (size + gap);
		const value = entry ? entry.total : 0;
		const level = value > 0 ? Math.min(levels, Math.ceil((value / maxTotal) * levels)) : 0;
		cells.push({ x, y, size, fill: FILLS[level], day, value, level });
	}
	return { cells, weeks, width: weeks * (size + gap) - gap, levels };
}

const FILLS = [
	"var(--dsw-alias-interactive-bg-hover)",
	"var(--dsw-state-warn-secondary)",
	"var(--dsw-state-warn-primary)",
	"var(--dsw-state-success-secondary)",
	"var(--dsw-state-success-primary)",
	"var(--dsw-state-business-secondary)",
	"var(--dsw-state-business-primary)",
];

/** `YYYY-MM-DD` → local Date at midnight. */
function parseDay(text) {
	const [y, m, d] = text.split("-").map(Number);
	return new Date(y, m - 1, d);
}

/** local Date → `YYYY-MM-DD`. */
function formatDay(date) {
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * Scale a numeric series into `{x, y, width, height, value}` bar rects.
 * @param {Array<{day: string, value: number}>} series
 * @param {number} w - chart width.
 * @param {number} h - chart height.
 * @returns {{rects: Array<object>, ticks: Array<{label: string, x: number}>}}
 */
export function scaleBars(series, w, h) {
	if (!Array.isArray(series) || series.length === 0) return { rects: [], ticks: [] };
	const max = Math.max(1, ...series.map((s) => s.value));
	const slot = w / series.length;
	const baseline = h;
	const rects = series.map((s, i) => {
		const height = (s.value / max) * (h - 4);
		return {
			x: i * slot,
			y: baseline - height,
			width: slot,
			height,
			value: s.value,
		};
	});
	const tickEvery = Math.max(1, Math.ceil(series.length / 8));
	const ticks = series
		.map((s, i) => ({ label: s.day.slice(5), x: i * slot + slot / 2 }))
		.filter((_, i) => i % tickEvery === 0 || i === series.length - 1);
	return { rects, ticks };
}

/**
 * Scale a numeric series into area-chart points.
 * @param {Array<{day: string, value: number}>} series
 * @param {number} w - chart width.
 * @param {number} h - chart height.
 * @returns {{points: Array<{x: number, y: number}>, ticks: Array<{label: string, x: number}>}}
 */
export function scaleArea(series, w, h) {
	if (!Array.isArray(series) || series.length === 0) return { points: [], ticks: [] };
	const max = Math.max(1, ...series.map((s) => s.value));
	const slot = series.length > 1 ? w / (series.length - 1) : w;
	const points = series.map((s, i) => ({
		x: i * slot,
		y: h - (s.value / max) * (h - 4) - 2,
	}));
	const tickEvery = Math.max(1, Math.ceil(series.length / 8));
	const ticks = series
		.map((s, i) => ({ label: s.day.slice(5), x: i * slot }))
		.filter((_, i) => i % tickEvery === 0 || i === series.length - 1);
	return { points, ticks };
}

/** Format a token count compactly: 12345 → 12.3k, 1234567 → 1.2m. */
export function formatTokens(value) {
	const n = Number(value ?? 0);
	if (!Number.isFinite(n)) return "0";
	if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
	if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
	if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
	return String(Math.round(n));
}
//#endregion
