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
 * @param {Array<{x: number, y: number, width: number, height: number, value: number, day?: string}>} values
 *   — the caller scales values into coordinates.
 * @param {number} w - viewBox width.
 * @param {number} h - viewBox height.
 * @param {{pad?: number}} [opts]
 * @returns {Array<{x: number, y: number, width: number, height: number, value: number, day?: string}>}
 *   2026-09-14 tooltip: `day` is passed through when the input carries it, so
 *   the render layer can hit-test each rect and show 日期 + token 值 without
 *   re-indexing the source series.
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
		day: v.day,
	}));
}

/**
 * GitHub-style heatmap grid (≤7 intensity levels, 0 = none). `days` are
 * `{day: 'YYYY-MM-DD', total: number}`; weeks are columns of 7 day-cells
 * starting on `opts.startWeekday` (default 0 = Sunday).
 * 2026-09-12 heatmap redesign v2: levels 1–6 fill from the theme-aware
 * usage-injected ramp `--du-heat-1..6` (light theme near-white→deep blue,
 * dark theme deep→bright blue); level 0 (no data) fills `--du-heat-0` with a
 * thin `--du-heat-0-stroke` border (width via `--du-heat-0-stroke-width`).
 * The return carries `months` (labels centered over each data month's covered
 * column span, only for months that have data, collapsed to first/last on
 * narrow grids), `peak` (max daily total) and `peakDay` (its date, for the
 * peak-cell ring and the legend note).
 * @param {Array<{day: string, total: number}>} days
 * @param {number} cell - cell size in px (width = cell * 53 + gap * 52).
 * @param {{startWeekday?: number, gap?: number, levels?: number}} [opts]
 *   P0-b: `opts.levels` overrides the intensity bucket count (1..6, default
 *   6 = FILLS 满档). Level 0 stays "no data"; buckets 1..levels map onto the
 *   `--du-heat-1..6` ramp (levels < 6 simply stops early).
 * @returns {{cells: Array<{x: number, y: number, size: number, fill: string,
 *   stroke: string, strokeWidth: number, day: string, value: number,
 *   level: number}>, weeks: number, width: number, levels: number,
 *   months: Array<{label: string, x: number}>, peak: number, peakDay: string}}
 */
export function heatmapGrid(days, cell, opts = {}) {
	const gap = Number.isFinite(opts.gap) ? opts.gap : 3;
	const startWeekday = Number.isFinite(opts.startWeekday) ? opts.startWeekday : 0;
	const size = cell;
	// P0-b: intensity bucket count from opts (clamped 1..6); default 6.
	const levels = Number.isInteger(opts.levels) && opts.levels >= 1
		? Math.min(6, opts.levels)
		: 6;
	if (!Array.isArray(days) || days.length === 0) {
		return { cells: [], weeks: 0, width: 0, levels, months: [], peak: 0, peakDay: "" };
	}
	// Sorted by day; find the global min/max across the year grid.
	const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
	const first = parseDay(sorted[0].day);
	const last = parseDay(sorted[sorted.length - 1].day);
	const firstDow = (first.getDay() - startWeekday + 7) % 7;
	const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - firstDow);
	const daysTotal = Math.floor((last - start) / 86400000) + 1;
	const weeks = Math.ceil(daysTotal / 7);
	const peakEntry = sorted.reduce((a, b) => (b.total > a.total ? b : a));
	const maxTotal = Math.max(1, peakEntry.total);
	const peakDay = peakEntry.day;
	const byDay = new Map(sorted.map((d) => [d.day, d]));
	const cells = [];
	// 2026-09-12 heatmap redesign v3: month labels are collected as column
	// runs (each month's first→last grid-day index), filtered to months that
	// actually have data, and x is the CENTER of the month's covered column
	// span (first-column start + span/2, text-anchor middle in the client);
	// narrow grids (≤4 weeks) collapse to first/last month only.
	const dataMonths = new Set(sorted.map((d) => parseDay(d.day).getMonth()));
	const months = [];
	let runMonth = -1;
	let runStart = 0;
	const closeRun = (lastIndex) => {
		if (runMonth >= 0 && lastIndex >= runStart && dataMonths.has(runMonth)) {
			const firstCol = Math.floor(runStart / 7);
			const lastCol = Math.floor(lastIndex / 7);
			const spanStart = firstCol * (size + gap);
			const spanEnd = lastCol * (size + gap) + size;
			months.push({ label: `${runMonth + 1}月`, x: Math.round((spanStart + spanEnd) / 2) });
		}
	};
	for (let index = 0; index < weeks * 7; index += 1) {
		const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
		const day = formatDay(date);
		const entry = byDay.get(day);
		const x = Math.floor(index / 7) * (size + gap);
		const y = (index % 7) * (size + gap);
		const value = entry ? entry.total : 0;
		const level = value > 0 ? Math.min(levels, Math.ceil((value / maxTotal) * levels)) : 0;
		// 2026-09-12 heatmap redesign v3: level 0 = --du-heat-0 fill + thin
		// --du-heat-0-stroke border with theme-aware width (--du-heat-0-stroke-width:
		// 1px light / 1.5px dark); levels 1–6 = theme-aware --du-heat-N ramp.
		cells.push({
			x,
			y,
			size,
			fill: FILLS[level],
			stroke: level === 0 ? "var(--du-heat-0-stroke)" : "none",
			strokeWidth: level === 0 ? "var(--du-heat-0-stroke-width)" : 0,
			day,
			value,
			level,
		});
		const month = date.getMonth();
		if (month !== runMonth) {
			closeRun(index - 1);
			runMonth = month;
			runStart = index;
		}
	}
	closeRun(weeks * 7 - 1);
	if (weeks <= 4 && months.length > 1) {
		// 2026-09-12 heatmap redesign: narrow grid → start/end month only.
		months.splice(1, months.length - 2);
	}
	return { cells, weeks, width: weeks * (size + gap) - gap, levels, months, peak: maxTotal, peakDay };
}

// 2026-09-12 heatmap redesign v2: theme-aware blue ramp via usage-injected
// custom properties --du-heat-0..6 (defined in lib/client.js CSS, per body vs
// body[data-ds-dark-theme]: light = near-white→deep blue, dark = deep→bright
// blue, "越多越亮"; unified blue hue, no purple). Index 0 = no data (filled
// --du-heat-0 + thin --du-heat-0-stroke border; stroke emitted per cell).
const FILLS = [
	"var(--du-heat-0)",
	"var(--du-heat-1)",
	"var(--du-heat-2)",
	"var(--du-heat-3)",
	"var(--du-heat-4)",
	"var(--du-heat-5)",
	"var(--du-heat-6)",
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
 * Scale a numeric series into `{x, y, width, height, value, day}` bar rects.
 * 2026-09-14 tooltip: rects carry `day` through (self-drawn hover tooltip in
 * the render layer hits rects by coordinate and shows the date + value).
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
			day: s.day,
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
 * 2026-09-14 tooltip: points carry `day`/`value` through so the render layer
 * can hit-test near the polyline (vertex + segment distance) and show the
 * date + token value without re-indexing the source series.
 * @param {Array<{day: string, value: number}>} series
 * @param {number} w - chart width.
 * @param {number} h - chart height.
 * @returns {{points: Array<{x: number, y: number, day?: string, value?: number}>, ticks: Array<{label: string, x: number}>}}
 */
export function scaleArea(series, w, h) {
	if (!Array.isArray(series) || series.length === 0) return { points: [], ticks: [] };
	const max = Math.max(1, ...series.map((s) => s.value));
	const slot = series.length > 1 ? w / (series.length - 1) : w;
	const points = series.map((s, i) => ({
		x: i * slot,
		y: h - (s.value / max) * (h - 4) - 2,
		day: s.day,
		value: s.value,
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
