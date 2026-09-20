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
 * 2026-09-18 trend roll-up: sum N consecutive buckets into one.
 *
 * Why this exists: with a 7-day hourly window about two thirds of the buckets
 * carry no usage at all, so the "smooth curve" is really a row of isolated
 * spikes separated by flat zero stretches — the smoothing has almost nothing to
 * smooth. Summing 3 consecutive hours (pure client-side; the host still serves
 * hourly buckets) yields ~57 points and a curve that actually flows while
 * keeping the within-day structure.
 *
 * The bucket key is the LAST hour of each group, and `hours` records how many
 * hours the group actually holds (the trailing group of a window is usually
 * partial), so a renderer can tell a full bucket from a partial one.
 * @param {Array<object>} rows - dense bucket rows (`day` + the five counters).
 * @param {number} [hoursPerBucket] - group size (default 3; ≤1 returns the input).
 * @returns {Array<object>} rolled-up rows.
 */
export function rollupBuckets(rows, hoursPerBucket = 3) {
	const list = Array.isArray(rows) ? rows : [];
	const size = Number.isFinite(hoursPerBucket) && hoursPerBucket >= 1 ? Math.floor(hoursPerBucket) : 1;
	if (size <= 1 || list.length === 0) return list;
	const fields = ["requests", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"];
	const out = [];
	for (let i = 0; i < list.length; i += size) {
		const chunk = list.slice(i, i + size);
		const last = chunk[chunk.length - 1];
		const row = { day: last.day, hours: chunk.length };
		for (const field of fields) {
			row[field] = chunk.reduce((sum, item) => sum + Number(item[field] || 0), 0);
		}
		out.push(row);
	}
	return out;
}

/**
 * 2026-09-18 intraday window: the `anchorHour → anchorHour` "usage day".
 *
 * The trend panel's 24h gear watches a single day running 04:00 → next 04:00
 * local time (a 04:00 boundary keeps one working session from being split by
 * midnight). A reference instant exactly ON the boundary belongs to the window
 * that starts there, which is what makes the date picker work: pass
 * `new Date('<date>T04:00:00')` and you get that date's own window.
 * Component arithmetic (not `+86400000`) keeps it correct across DST.
 * @param {number} refMs - reference instant (any ms inside the wanted window).
 * @param {number} [anchorHour] - boundary hour, default 4.
 * @returns {{from: number, to: number}} window bounds in ms (to − from = 24h).
 */
export function usageDayWindow(refMs, anchorHour = 4) {
	const hour = Number.isInteger(anchorHour) && anchorHour >= 0 && anchorHour <= 23 ? anchorHour : 4;
	const ref = new Date(Number.isFinite(refMs) ? refMs : Date.now());
	let start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), hour, 0, 0, 0);
	if (ref.getTime() < start.getTime()) start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1, hour, 0, 0, 0);
	const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, hour, 0, 0, 0);
	return { from: start.getTime(), to: end.getTime() };
}

/**
 * 2026-09-18 intraday axis label: `YYYY-MM-DD HH` → `HH` (two digits).
 *
 * A 24h window puts 24 ticks across the chart, so every tick gets a label and
 * there is room for exactly two digits. Tooltips keep the full
 * {@link bucketLabel} form ("09-18 14") so no information is lost.
 * @param {string} key - bucket key (`YYYY-MM-DD HH`).
 * @returns {string} two-digit hour, or the plain bucketLabel for other shapes.
 */
export function hourTickLabel(key) {
	const text = typeof key === "string" ? key : String(key ?? "");
	const space = text.indexOf(" ");
	return space > 0 ? text.slice(space + 1) : bucketLabel(text);
}

/**
 * 2026-09-18 bar ramp: linear blend between two `#rrggbb` colours.
 *
 * Pure on purpose — the render layer reads the theme's endpoint colours off the
 * `--du-bar-low` / `--du-bar-high` custom properties (theme-aware) and only the
 * arithmetic lives here, so it stays unit-testable and inline-parity-checkable.
 * @param {string} low - `#rrggbb` at t=0.
 * @param {string} high - `#rrggbb` at t=1.
 * @param {number} t - blend position, clamped to 0..1.
 * @returns {string} `#rrggbb`, or `low` when either input is unparseable.
 */
export function mixHex(low, high, t) {
	const parse = (hex) => {
		if (typeof hex !== "string") return null;
		const text = hex.trim().replace(/^#/, "");
		if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
		return [parseInt(text.slice(0, 2), 16), parseInt(text.slice(2, 4), 16), parseInt(text.slice(4, 6), 16)];
	};
	const a = parse(low);
	const b = parse(high);
	if (a === null || b === null) return low;
	const p = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
	const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * p);
	return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * 2026-09-18b: the tail of a path (its last segment) plus a filled wedge for it.
 *
 * The live 04:00 → 04:00 window ends in an hour that is still running, so its
 * bucket is a partial sum: drawn like the rest, the curve looks like usage
 * collapsed to zero. The render layer draws this tail dashed / semi-transparent
 * instead, which says "not finished yet" without hiding the data point.
 * @param {string} line - a full `M… (C|L)…` path.
 * @param {{x: number, y: number}} penultimate - the second-to-last point.
 * @param {{x: number, y: number}} last - the last point.
 * @param {number} baseline - area baseline.
 * @returns {{tailLine: string, tailArea: string}} empty strings when the path
 *   has a single segment or none.
 */
function tailOf(line, penultimate, last, baseline) {
	const cut = Math.max(line.lastIndexOf(" C"), line.lastIndexOf(" L"));
	if (cut <= 0) return { tailLine: "", tailArea: "" };
	const start = `M${round2(penultimate.x)},${round2(penultimate.y)}`;
	const tailLine = `${start} ${line.slice(cut + 1)}`;
	return { tailLine, tailArea: `${tailLine} L${round2(last.x)},${baseline} L${round2(penultimate.x)},${baseline} Z` };
}

/** Round to 2 decimals (path strings stay short). */
function round2(value) {
	return Math.round(value * 100) / 100;
}

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
 * 2026-09-18 trend smoothing: monotone cubic (Fritsch–Carlson) area path.
 *
 * Why monotone and not Catmull-Rom: token counts are non-negative, and an
 * overshooting spline invents peaks above the real maximum (or below zero)
 * between two samples — a chart that lies about the data. Fritsch–Carlson
 * tangents are limited so each segment stays monotone between its endpoints,
 * so the curve never leaves the envelope of the data it interpolates.
 *
 * The output uses cubic Béziers with control points at 1/3 of the segment
 * (the standard monotone-cubic → Bézier conversion), and the filled variant
 * closes onto `baseline` exactly like `areaPath`, so the render layer can
 * swap the two without touching anything else.
 * @param {Array<{x: number, y: number}>} points - already-scaled points (x strictly increasing).
 * @param {number} w - viewBox width.
 * @param {number} h - viewBox height.
 * @param {{baseline?: number}} [opts]
 * @returns {{line: string, area: string, w: number, h: number}}
 */
export function smoothAreaPath(points, w, h, opts = {}) {
	const baseline = Number.isFinite(opts.baseline) ? opts.baseline : h;
	if (!Array.isArray(points) || points.length === 0) {
		return { line: "", area: "", tailLine: "", tailArea: "", w, h };
	}
	if (points.length < 3) {
		// 1–2 points carry no curvature; the straight path is already monotone.
		const straight = areaPath(points, w, h, opts);
		if (opts.tail !== true || points.length < 2) {
			return { line: straight.line, area: straight.area, tailLine: "", tailArea: "", w: straight.w, h: straight.h };
		}
		const t = tailOf(straight.line, points[points.length - 2], points[points.length - 1], baseline);
		return { line: straight.line, area: straight.area, tailLine: t.tailLine, tailArea: t.tailArea, w: straight.w, h: straight.h };
	}
	const n = points.length;
	const xs = points.map((p) => Number(p.x));
	const ys = points.map((p) => Number(p.y));
	if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) {
		const straight = areaPath(points, w, h, opts);
		if (opts.tail !== true) return { line: straight.line, area: straight.area, tailLine: "", tailArea: "", w: straight.w, h: straight.h };
		const tf = tailOf(straight.line, points[n - 2], points[n - 1], baseline);
		return { line: straight.line, area: straight.area, tailLine: tf.tailLine, tailArea: tf.tailArea, w: straight.w, h: straight.h };
	}
	// Segment slopes (x is strictly increasing; a degenerate run falls back to flat).
	const delta = new Array(n - 1);
	const slope = new Array(n - 1);
	for (let i = 0; i < n - 1; i += 1) {
		delta[i] = xs[i + 1] - xs[i];
		slope[i] = delta[i] > 0 ? (ys[i + 1] - ys[i]) / delta[i] : 0;
	}
	// Initial tangents: one-sided at the ends, weighted harmonic mean inside.
	const m = new Array(n);
	m[0] = slope[0];
	m[n - 1] = slope[n - 2];
	for (let i = 1; i < n - 1; i += 1) {
		const s0 = slope[i - 1];
		const s1 = slope[i];
		if (s0 * s1 <= 0) {
			// local extremum (or a plateau): a zero tangent keeps the curve inside.
			m[i] = 0;
		} else {
			const w1 = 2 * delta[i] + delta[i - 1];
			const w2 = delta[i] + 2 * delta[i - 1];
			m[i] = (w1 + w2) / (w1 / s0 + w2 / s1);
		}
	}
	// Fritsch–Carlson limiter: keep (m_i/slope_i, m_{i+1}/slope_i) inside the
	// monotonicity circle of radius 3.
	for (let i = 0; i < n - 1; i += 1) {
		if (slope[i] === 0) {
			m[i] = 0;
			m[i + 1] = 0;
			continue;
		}
		const a = m[i] / slope[i];
		const b = m[i + 1] / slope[i];
		const sum = a * a + b * b;
		if (sum > 9) {
			const t = 3 / Math.sqrt(sum);
			m[i] = t * a * slope[i];
			m[i + 1] = t * b * slope[i];
		}
	}
	let line = `M${round2(xs[0])},${round2(ys[0])}`;
	for (let i = 0; i < n - 1; i += 1) {
		const third = delta[i] / 3;
		const c1x = round2(xs[i] + third);
		const c1y = round2(ys[i] + m[i] * third);
		const c2x = round2(xs[i + 1] - third);
		const c2y = round2(ys[i + 1] - m[i + 1] * third);
		line += ` C${c1x},${c1y} ${c2x},${c2y} ${round2(xs[i + 1])},${round2(ys[i + 1])}`;
	}
	const area = `${line} L${round2(xs[n - 1])},${baseline} L${round2(xs[0])},${baseline} Z`;
	const t = opts.tail === true ? tailOf(line, points[n - 2], points[n - 1], baseline) : { tailLine: "", tailArea: "" };
	return { line, area, tailLine: t.tailLine, tailArea: t.tailArea, w, h };
}

/**
 * 2026-09-18 bucket axis labels.
 *
 * The previous code took `key.slice(5)` unconditionally, which is right for a
 * `YYYY-MM-DD` bucket but silently degenerates for an hourly `YYYY-MM-DD HH`
 * bucket (`"2026-09-17 19"` → `"09-17"`), printing the same label a dozen times
 * across one axis. The format is now driven by the bucket key shape itself
 * (space = hour precision), so day and hour series can never be mixed up.
 * @param {string} key - bucket key (`YYYY-MM-DD` or `YYYY-MM-DD HH`).
 * @returns {string} axis/tooltip label (`MM-DD` or `MM-DD HH`).
 */
export function bucketLabel(key) {
	const text = typeof key === "string" ? key : String(key ?? "");
	const space = text.indexOf(" ");
	if (space > 0) return `${text.slice(5, 10)} ${text.slice(space + 1)}`;
	return text.length >= 10 ? text.slice(5, 10) : text;
}

/**
 * 2026-09-18 hourly trend: dense bucket series (missing buckets filled with 0).
 *
 * `scaleArea`/`scaleBars` place buckets by INDEX, not by timestamp, so a
 * sparse series (real data: 297 non-empty hours out of 720) silently compresses
 * the time axis and draws a chart whose x positions do not mean what they say.
 * Every series that feeds a scaled chart must therefore be filled to a
 * continuous run of buckets first.
 *
 * Buckets are generated in LOCAL time, walking with `Date` component arithmetic
 * (not `+3600000`) so a DST boundary cannot shift the labels away from the
 * `'localtime'` buckets the host SQL produces.
 * @param {Array<{day: string}>} rows - sparse rows from the host (`day` = bucket key).
 * @param {{granularity?: "day"|"hour", from?: number, to?: number, cap?: number}} [opts]
 *   `from`/`to` are ms epoch bounds (inclusive); `cap` bounds the bucket count
 *   (default 2200) so a pathological range cannot blow up the SVG.
 * @returns {Array<object>} dense rows; missing buckets are zero-filled.
 */
export function fillBuckets(rows, opts = {}) {
	const list = Array.isArray(rows) ? rows : [];
	const granularity = opts.granularity === "hour" ? "hour" : "day";
	if (!Number.isFinite(opts.from) || !Number.isFinite(opts.to) || opts.to < opts.from) return list;
	// 2026-09-18 fix: an EMPTY input means "this granularity has no data" (the
	// host refused the bucket width, or the window is genuinely empty). It must
	// NOT be turned into a dense window of zeros: that fabricates a chart of
	// real-looking zero usage AND defeats every caller's "no data → fall back"
	// test, because the filled array is then never empty — which is exactly how
	// the hourly trend ended up plotting 57 zero buckets with hour labels while
	// the panel title still said 按日.
	if (list.length === 0) return list;
	const cap = Number.isFinite(opts.cap) && opts.cap > 0 ? Math.floor(opts.cap) : 2200;
	const byKey = new Map();
	for (const row of list) {
		if (row && typeof row.day === "string") byKey.set(row.day, row);
	}
	const zeroRow = (key) => ({
		day: key,
		requests: 0,
		input_tokens: 0,
		output_tokens: 0,
		cache_read_tokens: 0,
		cache_write_tokens: 0,
	});
	const out = [];
	let matched = 0;
	const take = (key) => {
		const hit = byKey.get(key);
		if (hit === undefined) return zeroRow(key);
		matched += 1;
		return hit;
	};
	if (granularity === "hour") {
		const start = new Date(opts.from);
		let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours());
		while (cursor.getTime() <= opts.to && out.length < cap) {
			const key = `${formatDay(cursor)} ${String(cursor.getHours()).padStart(2, "0")}`;
			out.push(take(key));
			cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours() + 1);
		}
	} else {
		const start = new Date(opts.from);
		let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
		while (cursor.getTime() <= opts.to && out.length < cap) {
			const key = formatDay(cursor);
			out.push(take(key));
			cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
		}
	}
	// 2026-09-18 fix: if not one input row landed in the generated window, the
	// input's bucket keys do not belong to the requested granularity (e.g. a host
	// that answered a `hour` request with `day` keys). Handing back a wall of
	// fabricated zeros would read as real data; keep the caller's own rows and
	// let it decide.
	if (matched === 0) return list;
	// Any rows outside [from,to] (host clock skew) are appended so no data is lost.
	const seen = new Set(out.map((r) => r.day));
	for (const row of list) {
		if (row && typeof row.day === "string" && !seen.has(row.day)) {
			seen.add(row.day);
			out.push(row);
		}
	}
	return out;
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
export function scaleBars(series, w, h, opts = {}) {
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
	// 2026-09-18: keep the arithmetic ticks and append the final bucket only when
	// it does not crowd its predecessor. With a 169-point hourly series the last
	// tick used to land ~14 slots after the previous one, so the two labels
	// overlapped; the render layer anchors the first/last label per edge so the
	// text cannot be clipped by the viewBox either.
	// 2026-09-18b: `opts.tickEvery` (e.g. 1 for the 24h intraday view, where every
	// hour is labelled) and `opts.tickFormatter` override the automatic density
	// and the label text.
	const tickEvery = Number.isFinite(opts.tickEvery) && opts.tickEvery >= 1
		? Math.floor(opts.tickEvery)
		: Math.max(1, Math.ceil(series.length / 8));
	const label = typeof opts.tickFormatter === "function" ? opts.tickFormatter : bucketLabel;
	const ticks = series
		.map((s, i) => ({ label: label(s.day), x: i * slot + slot / 2, index: i }))
		.filter((t, i) => i % tickEvery === 0);
	const lastIndex = series.length - 1;
	if (ticks.length === 0 || lastIndex - ticks[ticks.length - 1].index >= Math.ceil(tickEvery * 0.6)) {
		ticks.push({ label: label(series[lastIndex].day), x: lastIndex * slot + slot / 2, index: lastIndex });
	}
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
export function scaleArea(series, w, h, opts = {}) {
	if (!Array.isArray(series) || series.length === 0) return { points: [], ticks: [] };
	const max = Math.max(1, ...series.map((s) => s.value));
	const slot = series.length > 1 ? w / (series.length - 1) : w;
	const points = series.map((s, i) => ({
		x: i * slot,
		y: h - (s.value / max) * (h - 4) - 2,
		day: s.day,
		value: s.value,
	}));
	// 2026-09-18: same tick-spacing rule as scaleBars (see the note there),
	// including the `opts.tickEvery` / `opts.tickFormatter` overrides.
	const tickEvery = Number.isFinite(opts.tickEvery) && opts.tickEvery >= 1
		? Math.floor(opts.tickEvery)
		: Math.max(1, Math.ceil(series.length / 8));
	const label = typeof opts.tickFormatter === "function" ? opts.tickFormatter : bucketLabel;
	const ticks = series
		.map((s, i) => ({ label: label(s.day), x: i * slot, index: i }))
		.filter((t, i) => i % tickEvery === 0);
	const lastIndex = series.length - 1;
	if (ticks.length === 0 || lastIndex - ticks[ticks.length - 1].index >= Math.ceil(tickEvery * 0.6)) {
		ticks.push({ label: label(series[lastIndex].day), x: lastIndex * slot, index: lastIndex });
	}
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
