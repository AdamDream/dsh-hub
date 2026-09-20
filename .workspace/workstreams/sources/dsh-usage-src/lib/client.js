window.__ModuleLoader__.load({
	id: "@local/dsh-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region dsh-usage Web GUI — handwritten, build-free client bundle.
		// AUDIT U10: settings.plugin.item card keyed `dsh-usage` (paired with the
		// host `settings.register('dsh-usage', …)` namespace), self-drawn SVG
		// charts (A5 决策, zero deps), data over the `/usage` RPC channel via
		// ctx.connection.rpc.call, polling in useEffect+setInterval (B9, taste
		// 先例), session rows drill down via ctx.sessions.select.
		//#endregion
		//#region styles (data-plugin style + --dsw-* tokens, official idiom)
		const css = ".du_root{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px;font-size:13px;line-height:20px}.du_head{align-items:center;gap:8px;flex-wrap:wrap;display:flex}.du_title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600}.du_sub{color:var(--dsw-alias-label-caption);font-size:11px}.du_toolbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.du_select{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:2px 6px;font:inherit;font-size:12px}.du_btn{color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-border-inverted);border-radius:8px;padding:2px 10px;font:inherit;font-size:12px}.du_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.du_btn:disabled{opacity:.4;cursor:default}.du_error{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px}.du_errorDetail{color:var(--dsw-alias-label-caption);font-family:var(--ds-font-family-code,monospace);font-size:11px;word-break:break-all}.du_hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}.du_stat{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px 10px;min-width:0}.du_statLabel{color:var(--dsw-alias-label-caption);font-size:11px}.du_statValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}.du_note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}.du_panel{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}.du_panelTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}.du_svg{width:100%;max-width:560px;height:auto}.du_tabs{display:flex;gap:4px;flex-wrap:wrap}.du_tab{color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font:inherit;font-size:12px}.du_tabActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);border-color:var(--dsw-alias-border-inverted)}.du_tableWrap{max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.du_table{border-collapse:collapse;width:100%;font-size:12px}.du_table th{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-interactive-bg-hover);padding:4px 8px;text-align:left;font-weight:500;position:sticky;top:0}.du_table td{padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}.du_table tr.du_clickable{cursor:pointer}.du_table tr.du_clickable:hover td{background:var(--dsw-alias-interactive-bg-hover)}.du_legend{display:flex;gap:4px;align-items:center;color:var(--dsw-alias-label-secondary);font-size:12px;flex-wrap:wrap}.du_swatch{width:10px;height:10px;border-radius:2px;display:inline-block}.du_heatNote{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}.du_tip{position:fixed;z-index:1000;pointer-events:none;background:#ffffff;border:1px solid #d8dce2;border-radius:8px;padding:4px 7px;font-size:11px;line-height:13px;box-shadow:0 4px 16px rgba(0,0,0,.18);white-space:nowrap}.du_tipDay{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:12px;font-variant-numeric:tabular-nums}.du_tipValue{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums;line-height:14px;font-size:12px}.du_tipUnit{color:var(--dsw-alias-label-caption);font-weight:400;font-size:10px;line-height:14px}.du_tipMuted{color:var(--dsw-alias-label-caption);font-weight:400}.du_tip::before{content:'';position:absolute;top:-5px;left:var(--du-tip-ax,14px);width:8px;height:8px;background:#ffffff;border-left:1px solid #d8dce2;border-top:1px solid #d8dce2;transform:rotate(45deg)}.du_tip.du_tipL::before{top:var(--du-tip-ay,14px);left:-5px;border-left:1px solid #d8dce2;border-top:1px solid #d8dce2;transform:rotate(-45deg)}.du_tip.du_tipR::before{top:var(--du-tip-ay,14px);left:auto;right:-5px;border-right:1px solid #d8dce2;border-top:1px solid #d8dce2;transform:rotate(45deg)}.du_tip.du_tipD::before{top:auto;bottom:-5px;left:var(--du-tip-ax,14px);border-right:1px solid #d8dce2;border-bottom:1px solid #d8dce2;transform:rotate(45deg)}body[data-ds-dark-theme] .du_tip{background:#2b303b;border-color:#8b93a1;box-shadow:0 6px 20px rgba(0,0,0,.55)}body[data-ds-dark-theme] .du_tip::before{background:#2b303b;border-left-color:#8b93a1;border-top-color:#8b93a1}body[data-ds-dark-theme] .du_tip.du_tipR::before{border-right-color:#8b93a1;border-top-color:#8b93a1}body[data-ds-dark-theme] .du_tip.du_tipD::before{border-right-color:#8b93a1;border-bottom-color:#8b93a1}body[data-ds-dark-theme] .du_tip.du_tipL::before{border-left-color:#8b93a1;border-top-color:#8b93a1}body{--du-heat-0:#f3f4f6;--du-heat-0-stroke:#9ca3af;--du-heat-0-stroke-width:1px;--du-heat-1:#dbeafe;--du-heat-2:#93c5fd;--du-heat-3:#60a5fa;--du-heat-4:#3b82f6;--du-heat-5:#2563eb;--du-heat-6:#1e3a8a;--du-heat-peak-stroke:#ffffff;--du-heat-month-fill:var(--dsw-alias-label-caption);--du-trend-line:#60a5fa;--du-trend-fill:#1e3a8a99;--du-bar-low:#f5c451;--du-bar-high:#f08a3c}body[data-ds-dark-theme]{--du-heat-0:#2f3540;--du-heat-0-stroke:#8b93a1;--du-heat-0-stroke-width:1.5px;--du-heat-1:#1e3a8a;--du-heat-2:#2563eb;--du-heat-3:#3b82f6;--du-heat-4:#60a5fa;--du-heat-5:#93c5fd;--du-heat-6:#bfdbfe;--du-heat-peak-stroke:#0f1115;--du-heat-month-fill:var(--dsw-alias-label-secondary);--du-trend-line:#93c5fd;--du-trend-fill:#1e3a8a8c;--du-bar-low:#f5c451;--du-bar-high:#f08a3c}";
		const tagId = "@local/dsh-usage/dsh-usage-card.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@local/dsh-usage";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region charts.js 内联 (build-free inline of lib/charts.js — keep in sync)
		// 2026-09-12 heatmap redesign v2: theme-aware blue ramp via usage-injected
		// custom properties --du-heat-0..6 (defined in the du_* CSS above, per
		// body vs body[data-ds-dark-theme]: light = near-white→deep blue, dark =
		// deep→bright blue, "越多越亮"; unified blue hue, no purple). Index 0 =
		// no data (filled --du-heat-0 + thin --du-heat-0-stroke border).
		const FILLS = [
			"var(--du-heat-0)",
			"var(--du-heat-1)",
			"var(--du-heat-2)",
			"var(--du-heat-3)",
			"var(--du-heat-4)",
			"var(--du-heat-5)",
			"var(--du-heat-6)",
		];
		function parseDay(text) {
			const parts = text.split("-").map(Number);
			return new Date(parts[0], parts[1] - 1, parts[2]);
		}
		function formatDay(date) {
			const mm = String(date.getMonth() + 1).padStart(2, "0");
			const dd = String(date.getDate()).padStart(2, "0");
			return date.getFullYear() + "-" + mm + "-" + dd;
		}
		function areaPath(points, w, h, opts) {
			const baseline = opts && Number.isFinite(opts.baseline) ? opts.baseline : h;
			if (!Array.isArray(points) || points.length === 0) return { line: "", area: "", w, h };
			const line = points.map((p, i) => (i === 0 ? "M" : "L") + p.x + "," + p.y).join(" ");
			const area = line + " L" + points[points.length - 1].x + "," + baseline + " L" + points[0].x + "," + baseline + " Z";
			return { line, area, w, h };
		}
		// 2026-09-18: linear blend between two #rrggbb colours (bar ramp). The
		// theme endpoints come from --du-bar-low/--du-bar-high; only the
		// arithmetic lives here (mirrors charts.js mixHex).
		function mixHex(low, high, t) {
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
			return "#" + [0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("");
		}
		// 2026-09-18: bucket key → axis/tooltip label. `slice(5)` alone is
		// correct for `YYYY-MM-DD` but degenerates for an hourly
		// `YYYY-MM-DD HH` key (prints the same day label a dozen times).
		function bucketLabel(key) {
			const text = typeof key === "string" ? key : String(key == null ? "" : key);
			const space = text.indexOf(" ");
			if (space > 0) return text.slice(5, 10) + " " + text.slice(space + 1);
			return text.length >= 10 ? text.slice(5, 10) : text;
		}
		// 2026-09-18b: the 04:00 → 04:00 "usage day" window of the 24h gear.
		// A reference instant exactly ON the boundary belongs to the window that
		// starts there — that is what makes the date picker work (pass
		// `new Date('<date>T04:00:00')` and you get that date's own window).
		// Component arithmetic keeps it DST-correct (mirrors charts.js).
		function usageDayWindow(refMs, anchorHour) {
			const hour = Number.isInteger(anchorHour) && anchorHour >= 0 && anchorHour <= 23 ? anchorHour : 4;
			const ref = new Date(Number.isFinite(refMs) ? refMs : Date.now());
			let start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), hour, 0, 0, 0);
			if (ref.getTime() < start.getTime()) start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1, hour, 0, 0, 0);
			const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, hour, 0, 0, 0);
			return { from: start.getTime(), to: end.getTime() };
		}
		// 2026-09-18b: intraday axis label — `YYYY-MM-DD HH` → `HH`. The 24h gear
		// labels every bucket, so exactly two digits fit; tooltips keep the full
		// bucketLabel form so the date is never lost.
		function hourTickLabel(key) {
			const text = typeof key === "string" ? key : String(key == null ? "" : key);
			const space = text.indexOf(" ");
			return space > 0 ? text.slice(space + 1) : bucketLabel(text);
		}
		// 2026-09-18b: `MM-DD HH:00` of a window bound, for the panel title.
		function windowLabel(ms) {
			const date = new Date(ms);
			const mm = String(date.getMonth() + 1).padStart(2, "0");
			const dd = String(date.getDate()).padStart(2, "0");
			const hh = String(date.getHours()).padStart(2, "0");
			return mm + "-" + dd + " " + hh + ":00";
		}
		// 2026-09-18b: tail of a path (its last segment) + a filled wedge for it, so
		// the still-running bucket can be drawn dashed (mirrors charts.js tailOf).
		function tailOf(line, penultimate, last, baseline) {
			const cut = Math.max(line.lastIndexOf(" C"), line.lastIndexOf(" L"));
			if (cut <= 0) return { tailLine: "", tailArea: "" };
			const start = "M" + round2(penultimate.x) + "," + round2(penultimate.y);
			const tailLine = start + " " + line.slice(cut + 1);
			return { tailLine: tailLine, tailArea: tailLine + " L" + round2(last.x) + "," + baseline + " L" + round2(penultimate.x) + "," + baseline + " Z" };
		}
		function round2(value) {
			return Math.round(value * 100) / 100;
		}
		// 2026-09-18: monotone cubic (Fritsch–Carlson) area path — never
		// overshoots between samples, so the curve cannot invent values above
		// the data (mirrors charts.js smoothAreaPath).
		function smoothAreaPath(points, w, h, opts) {
			const baseline = opts && Number.isFinite(opts.baseline) ? opts.baseline : h;
			if (!Array.isArray(points) || points.length === 0) return { line: "", area: "", tailLine: "", tailArea: "", w, h };
			// 2026-09-18b: opts.tail = true additionally returns the last segment
			// (and its wedge) so the render layer can dash the still-running bucket.
			if (points.length < 3) {
				const straight = areaPath(points, w, h, opts);
				if (!opts || opts.tail !== true || points.length < 2) return { line: straight.line, area: straight.area, tailLine: "", tailArea: "", w: straight.w, h: straight.h };
				const t = tailOf(straight.line, points[points.length - 2], points[points.length - 1], baseline);
				return { line: straight.line, area: straight.area, tailLine: t.tailLine, tailArea: t.tailArea, w: straight.w, h: straight.h };
			}
			const n = points.length;
			const xs = points.map((p) => Number(p.x));
			const ys = points.map((p) => Number(p.y));
			if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) {
				const straight = areaPath(points, w, h, opts);
				if (!opts || opts.tail !== true) return { line: straight.line, area: straight.area, tailLine: "", tailArea: "", w: straight.w, h: straight.h };
				const t = tailOf(straight.line, points[n - 2], points[n - 1], baseline);
				return { line: straight.line, area: straight.area, tailLine: t.tailLine, tailArea: t.tailArea, w: straight.w, h: straight.h };
			}
			const delta = new Array(n - 1);
			const slope = new Array(n - 1);
			for (let i = 0; i < n - 1; i += 1) {
				delta[i] = xs[i + 1] - xs[i];
				slope[i] = delta[i] > 0 ? (ys[i + 1] - ys[i]) / delta[i] : 0;
			}
			const m = new Array(n);
			m[0] = slope[0];
			m[n - 1] = slope[n - 2];
			for (let i = 1; i < n - 1; i += 1) {
				const s0 = slope[i - 1];
				const s1 = slope[i];
				if (s0 * s1 <= 0) {
					m[i] = 0;
				} else {
					const w1 = 2 * delta[i] + delta[i - 1];
					const w2 = delta[i] + 2 * delta[i - 1];
					m[i] = (w1 + w2) / (w1 / s0 + w2 / s1);
				}
			}
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
			const round = round2;
			let line = "M" + round(xs[0]) + "," + round(ys[0]);
			for (let i = 0; i < n - 1; i += 1) {
				const third = delta[i] / 3;
				const c1x = round(xs[i] + third);
				const c1y = round(ys[i] + m[i] * third);
				const c2x = round(xs[i + 1] - third);
				const c2y = round(ys[i + 1] - m[i + 1] * third);
				line += " C" + c1x + "," + c1y + " " + c2x + "," + c2y + " " + round(xs[i + 1]) + "," + round(ys[i + 1]);
			}
			const area = line + " L" + round(xs[n - 1]) + "," + baseline + " L" + round(xs[0]) + "," + baseline + " Z";
			const tail = opts && opts.tail === true ? tailOf(line, points[n - 2], points[n - 1], baseline) : { tailLine: "", tailArea: "" };
			return { line, area, tailLine: tail.tailLine, tailArea: tail.tailArea, w, h };
		}
		// 2026-09-18: dense bucket series (missing buckets → 0). Scaled charts
		// place buckets by INDEX, so a sparse hourly series would silently
		// compress the time axis (mirrors charts.js fillBuckets).
		function fillBuckets(rows, opts) {
			const list = Array.isArray(rows) ? rows : [];
			const o = opts || {};
			const granularity = o.granularity === "hour" ? "hour" : "day";
			if (!Number.isFinite(o.from) || !Number.isFinite(o.to) || o.to < o.from) return list;
			// 2026-09-18 fix: an EMPTY input means "no data at this granularity" and
			// must stay empty — synthesising a dense zero window fabricates a chart
			// of real-looking zero usage and defeats every "no data → fall back"
			// test (the filled array is never empty), which is exactly how the
			// hourly trend plotted 57 zero buckets with hour labels while the panel
			// title still read 按日.
			if (list.length === 0) return list;
			const cap = Number.isFinite(o.cap) && o.cap > 0 ? Math.floor(o.cap) : 2200;
			const byKey = new Map();
			for (const row of list) {
				if (row && typeof row.day === "string") byKey.set(row.day, row);
			}
			const zeroRow = (key) => ({ day: key, requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
			const out = [];
			let matched = 0;
			const take = (key) => {
				const hit = byKey.get(key);
				if (hit === undefined) return zeroRow(key);
				matched += 1;
				return hit;
			};
			if (granularity === "hour") {
				const start = new Date(o.from);
				let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours());
				while (cursor.getTime() <= o.to && out.length < cap) {
					const key = formatDay(cursor) + " " + String(cursor.getHours()).padStart(2, "0");
					out.push(take(key));
					cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours() + 1);
				}
			} else {
				const start = new Date(o.from);
				let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
				while (cursor.getTime() <= o.to && out.length < cap) {
					const key = formatDay(cursor);
					out.push(take(key));
					cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
				}
			}
			// 2026-09-18 fix: nothing matched ⇒ the input's keys are not of the
			// requested granularity (e.g. a host answering `hour` with `day` keys);
			// keep the caller's rows instead of a wall of fabricated zeros.
			if (matched === 0) return list;
			const seen = new Set(out.map((r) => r.day));
			for (const row of list) {
				if (row && typeof row.day === "string" && !seen.has(row.day)) {
					seen.add(row.day);
					out.push(row);
				}
			}
			return out;
		}
		// 2026-09-18: sum N consecutive buckets into one (the trend curve rides a
		// 3-hour roll-up: ~2/3 of the hourly buckets are empty, so a plain hourly
		// curve is a row of isolated spikes). `day` = the group's last hour,
		// `hours` = how many hours the group actually holds (mirrors charts.js
		// rollupBuckets).
		function rollupBuckets(rows, hoursPerBucket) {
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
		function barRects(values, w, h, opts) {
			const pad = opts && Number.isFinite(opts.pad) ? opts.pad : 1;
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
		function heatmapGrid(days, cell, opts) {
			const gap = opts && Number.isFinite(opts.gap) ? opts.gap : 3;
			const startWeekday = opts && Number.isFinite(opts.startWeekday) ? opts.startWeekday : 0;
			const size = cell;
			// P0-b: intensity bucket count from opts (clamped 1..6); default 6.
			const levels = Number.isInteger(opts && opts.levels) && opts.levels >= 1 ? Math.min(6, opts.levels) : 6;
			if (!Array.isArray(days) || days.length === 0) return { cells: [], weeks: 0, width: 0, levels, months: [], peak: 0, peakDay: "" };
			const sorted = days.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
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
			// 2026-09-12 heatmap redesign v3: month labels collected as column
			// runs, filtered to data months, x = CENTER of the month's covered
			// column span (text-anchor middle in the render); narrow grids
			// (≤4 weeks) collapse to first/last month only.
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
					months.push({ label: runMonth + 1 + "月", x: Math.round((spanStart + spanEnd) / 2) });
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
				// 2026-09-12 heatmap redesign v3: level 0 = --du-heat-0 fill +
				// thin --du-heat-0-stroke border with theme-aware width
				// (--du-heat-0-stroke-width: 1px light / 1.5px dark); levels
				// 1–6 = theme-aware --du-heat-N ramp.
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
		function scaleBars(series, w, h, opts) {
			const o = opts || {};
			if (!Array.isArray(series) || series.length === 0) return { rects: [], ticks: [] };
			const max = Math.max(1, ...series.map((s) => s.value));
			const slot = w / series.length;
			const baseline = h;
			const rects = series.map((s, i) => {
				const height = (s.value / max) * (h - 4);
				return { x: i * slot, y: baseline - height, width: slot, height, value: s.value, day: s.day };
			});
			// 2026-09-18: append the final tick only when it does not crowd its
			// predecessor (hourly series otherwise overlapped the last two labels).
			// 2026-09-18b: opts.tickEvery (1 = label every bucket, the 24h intraday
			// view) and opts.tickFormatter (2-digit hour) override the defaults.
			const tickEvery = Number.isFinite(o.tickEvery) && o.tickEvery >= 1 ? Math.floor(o.tickEvery) : Math.max(1, Math.ceil(series.length / 8));
			const label = typeof o.tickFormatter === "function" ? o.tickFormatter : bucketLabel;
			const ticks = series
				.map((s, i) => ({ label: label(s.day), x: i * slot + slot / 2, index: i }))
				.filter((t, i) => i % tickEvery === 0);
			const lastIndex = series.length - 1;
			if (ticks.length === 0 || lastIndex - ticks[ticks.length - 1].index >= Math.ceil(tickEvery * 0.6)) {
				ticks.push({ label: label(series[lastIndex].day), x: lastIndex * slot + slot / 2, index: lastIndex });
			}
			return { rects, ticks };
		}
		function scaleArea(series, w, h, opts) {
			const o = opts || {};
			if (!Array.isArray(series) || series.length === 0) return { points: [], ticks: [] };
			const max = Math.max(1, ...series.map((s) => s.value));
			const slot = series.length > 1 ? w / (series.length - 1) : w;
			const points = series.map((s, i) => ({ x: i * slot, y: h - (s.value / max) * (h - 4) - 2, day: s.day, value: s.value }));
			// 2026-09-18: same tick-spacing rule and overrides as scaleBars.
			const tickEvery = Number.isFinite(o.tickEvery) && o.tickEvery >= 1 ? Math.floor(o.tickEvery) : Math.max(1, Math.ceil(series.length / 8));
			const label = typeof o.tickFormatter === "function" ? o.tickFormatter : bucketLabel;
			const ticks = series
				.map((s, i) => ({ label: label(s.day), x: i * slot, index: i }))
				.filter((t, i) => i % tickEvery === 0);
			const lastIndex = series.length - 1;
			if (ticks.length === 0 || lastIndex - ticks[ticks.length - 1].index >= Math.ceil(tickEvery * 0.6)) {
				ticks.push({ label: label(series[lastIndex].day), x: lastIndex * slot, index: lastIndex });
			}
			return { points, ticks };
		}
		function formatTokens(value) {
			const n = Number(value == null ? 0 : value);
			if (!Number.isFinite(n)) return "0";
			if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "b";
			if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "m";
			if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "k";
			return String(Math.round(n));
		}
		// 2026-09-14 tooltip: self-drawn hover tooltip for area/bar/heatmap.
		// Hit-testing runs in viewBox coordinates (the svg onMouseMove handler
		// converts screen coords via getBoundingClientRect × viewBox scale);
		// the tooltip layer is position:fixed following the mouse with
		// viewport-flip so it never overflows the window.
		function hitAreaPoints(points, mx, my, maxDist) {
			// nearest data point (vertex distance + polyline segment distance).
			let best = -1;
			let bestDist = maxDist;
			for (let i = 0; i < points.length; i++) {
				const dx = points[i].x - mx;
				const dy = points[i].y - my;
				const d = Math.sqrt(dx * dx + dy * dy);
				if (d <= bestDist) { bestDist = d; best = i; }
				if (i + 1 < points.length) {
					const ax = points[i].x, ay = points[i].y;
					const bx = points[i + 1].x, by = points[i + 1].y;
					const abx = bx - ax, aby = by - ay;
					const len2 = abx * abx + aby * aby;
					let t = len2 > 0 ? ((mx - ax) * abx + (my - ay) * aby) / len2 : 0;
					t = Math.max(0, Math.min(1, t));
					const px = ax + abx * t;
					const py = ay + aby * t;
					const ddx = mx - px, ddy = my - py;
					const d2 = Math.sqrt(ddx * ddx + ddy * ddy);
					if (d2 <= bestDist) { bestDist = d2; best = t < 0.5 ? i : i + 1; }
				}
			}
			return best;
		}
		function hitBarRects(rects, mx, my) {
			// strict rect containment first; for narrow bars fall back to the
			// horizontally nearest rect while the pointer stays within the
			// bar's vertical span (± small tolerance).
			for (let i = 0; i < rects.length; i++) {
				const r = rects[i];
				if (mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height) return i;
			}
			let best = -1;
			let bestD = Infinity;
			for (let i = 0; i < rects.length; i++) {
				const r = rects[i];
				const cx = r.x + r.width / 2;
				const d = Math.abs(mx - cx);
				const tolX = Math.max(8, r.width / 2 + 2);
				if (d <= tolX && my >= r.y - 8 && my <= r.y + r.height + 8 && d < bestD) {
					bestD = d;
					best = i;
				}
			}
			return best;
		}
		function hitGridCells(cells, mx, my, offsetY) {
			// cells are laid out inside <g transform=translate(0,monthRow)>,
			// so the pointer's y is offset by monthRow before containment.
			for (let i = 0; i < cells.length; i++) {
				const c = cells[i];
				if (mx >= c.x && mx < c.x + c.size && my >= offsetY + c.y && my < offsetY + c.y + c.size) return i;
			}
			return -1;
		}
		function tipAtEvent(e, estW, estH) {
			// 2026-09-14 tooltip iteration 2: tooltip is vertically centered on
			// the pointer and sits +14px to its right; the returned `dir` makes
			// the arrow point back at the data point in all four quadrants:
			//   L — default (pointer left of tooltip)
			//   R — right-edge flip (pointer right of tooltip)
			//   D — bottom overflow (tooltip above pointer)
			//   U — top overflow (tooltip below pointer)
			const vw = window.innerWidth - 8;
			const vh = window.innerHeight - 8;
			const fx = e.clientX + 14 + estW > vw;
			const left = Math.max(8, fx ? e.clientX - estW - 14 : e.clientX + 14);
			let top = e.clientY - estH / 2;
			let dir;
			if (top + estH > vh) { top = vh - estH; dir = "d"; }
			else if (top < 8) { top = 8; dir = "u"; }
			else dir = fx ? "r" : "l";
			return { left, top, dir, fx, fy: dir === "d" };
		}
		function tipTokens(value) {
			// 2026-09-14 tooltip iteration 2: tooltip-only compact formatter —
			// one decimal, uppercase unit (253.45m → "253.5M"). The global
			// formatTokens keeps its existing two-decimal lowercase form for
			// tables/hero/heatmap note (out of this feature's scope).
			const n = Number(value == null ? 0 : value);
			if (!Number.isFinite(n)) return "0";
			if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
			if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
			if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + "K";
			return String(Math.round(n));
		}
		//#endregion
		//#region card components
		const CHANNEL = "/usage";
		// 2026-09-18b: boundary hour of the intraday "usage day" (04:00 → 04:00),
		// so one working session is not split by midnight.
		const TREND_ANCHOR_HOUR = 4;
		const BUCKETS = [
			{ key: "total", label: "总 tokens" },
			{ key: "input_tokens", label: "输入(未缓存)" },
			{ key: "output_tokens", label: "输出" },
			{ key: "cache_read_tokens", label: "缓存读" },
			{ key: "cache_write_tokens", label: "缓存写" },
		];
		const TABS = [
			{ key: "byModel", label: "按模型" },
			{ key: "byProject", label: "按项目" },
			{ key: "byDay", label: "按日" },
			{ key: "sessions", label: "会话明细" },
		];
		function bucketValue(row, key) {
			if (!row) return 0;
			if (key === "total") {
				return Number(row.input_tokens || 0) + Number(row.output_tokens || 0) + Number(row.cache_read_tokens || 0) + Number(row.cache_write_tokens || 0);
			}
			return Number(row[key] || 0);
		}
		function fmtDate(ms) {
			if (!Number.isFinite(ms)) return "";
			const d = new Date(ms);
			const mm = String(d.getMonth() + 1).padStart(2, "0");
			const dd = String(d.getDate()).padStart(2, "0");
			return d.getFullYear() + "-" + mm + "-" + dd;
		}
		// 2026-09-18: read one theme custom property off <body> (the same
		// `body` / `body[data-ds-dark-theme]` split the CSS uses) with a
		// fallback so a missing var can never blank a chart.
		function themeVar(name, fallback) {
			try {
				if (typeof document === "undefined" || !document.body) return fallback;
				const value = getComputedStyle(document.body).getPropertyValue(name);
				return value && value.trim() ? value.trim() : fallback;
			} catch (cause) {
				return fallback;
			}
		}
		// 2026-09-18: anchor the first/last tick to the chart edge so its label is
		// not clipped by the viewBox (mid labels stay centered on their bucket).
		function tickAnchor(x, w) {
			if (x <= 0.5) return "start";
			if (x >= w - 0.5) return "end";
			return "middle";
		}
		function StatBox(props) {
			return react.createElement("div", { className: "du_stat" },
				react.createElement("div", { className: "du_statLabel" }, props.label),
				react.createElement("div", { className: "du_statValue" }, props.value));
		}
		function TrendChart(props) {
			const mode = props.mode === "bar" ? "bar" : "area";
			// 2026-09-18b: the GEAR decides the data — `hour` = the 24h intraday
			// window (04:00 → 04:00, one bucket per hour), `day` = the daily series
			// over the range selector. Both drawing modes (area / bar) follow the
			// same gear, so switching the drawing never silently changes the time
			// axis. `props.hourly` is empty when the host cannot serve hourly
			// buckets yet (a pre-restart host rejects granularity "hour") → the
			// chart falls back to the daily series instead of failing the card.
			const usingHourly = props.grain === "hour" && Array.isArray(props.hourly) && props.hourly.length > 0;
			const rows = usingHourly ? props.hourly : (props.rows || []);
			const series = rows.map((r) => ({ day: r.day, value: bucketValue(r, props.bucket) }));
			// 2026-09-18b: in the 24h gear every bucket gets a 2-digit hour label.
			const tickOpts = usingHourly ? { tickEvery: 1, tickFormatter: hourTickLabel } : undefined;
			// 2026-09-18b: the caller decides whether the LAST bucket is still
			// running (today / the current hour); only the final segment changes.
			const partialTail = props.partial === true;
			const w = 560;
			const h = 150;
			// P0-b: settings switch `dsh-usage.ui.tooltip` (default true) — the
			// self-drawn hover tooltip. false = no custom float layer, no mouse
			// hit-testing (pre-tooltip behavior; heatmap keeps <title>).
			const tooltipEnabled = props.tooltip !== false;
			// 2026-09-14 tooltip: self-drawn hover tooltip — hit-testing runs
			// in viewBox coordinates on the svg's onMouseMove; the tooltip
			// layer is a fixed-position .du_tip div following the mouse
			// (viewport-flipped so it never overflows the window).
			const [tip, setTip] = react.useState(null);
			if (series.length === 0) return react.createElement("div", { className: "du_note" }, "暂无趋势数据");
			const children = [];
			let hitFn = null;
			if (mode === "bar") {
				const scaled = scaleBars(series, w, h, tickOpts);
				const rects = barRects(scaled.rects, w, h);
				hitFn = (mx, my) => {
					const i = hitBarRects(rects, mx, my);
					return i >= 0 ? { day: rects[i].day, valueText: tipTokens(rects[i].value) } : null;
				};
				// 2026-09-18 bar ramp: each bar takes its colour from the theme's
				// yellow→orange ramp at its own normalized value (linear), so a
				// busier day reads warmer. The endpoints live in the CSS
				// (--du-bar-low / --du-bar-high) so light and dark can differ.
				const rampLow = themeVar("--du-bar-low", "#eab308");
				const rampHigh = themeVar("--du-bar-high", "#ea580c");
				const rampMax = Math.max(1, ...series.map((s) => s.value));
				// 2026-09-18b: the still-running bucket (today / the current hour) is
				// a PARTIAL sum — rendered lighter so it cannot read as a drop in usage.
				children.push(react.createElement("g", null,
					rects.map((r, i) => react.createElement("rect", {
						key: r.x + "-" + r.y,
						x: r.x,
						y: r.y,
						width: r.width,
						height: r.height,
						rx: 1,
						fill: mixHex(rampLow, rampHigh, r.value / rampMax),
						...(partialTail && i === rects.length - 1 ? { fillOpacity: 0.45 } : {}),
					}))));
				children.push(react.createElement("g", { fill: "var(--dsw-alias-label-caption)", fontSize: 10, textAnchor: "middle" },
					scaled.ticks.map((t) => react.createElement("text", { key: "t" + t.x, x: t.x, y: h - 2, textAnchor: tickAnchor(t.x, w) }, t.label))));
			} else {
				const scaled = scaleArea(series, w, h, tickOpts);
				// 2026-09-18: monotone-cubic smoothing (no overshoot). The fill is the
				// deep-blue wash --du-trend-fill (alpha baked into the token so the
				// themes can differ), the outline is --du-trend-line.
				const geom = smoothAreaPath(scaled.points, w, h, { tail: partialTail });
				hitFn = (mx, my) => {
					const i = hitAreaPoints(scaled.points, mx, my, 12);
					return i >= 0 ? { day: scaled.points[i].day, valueText: tipTokens(scaled.points[i].value) } : null;
				};
				children.push(react.createElement("path", { d: geom.area, fill: "var(--du-trend-fill)", stroke: "none" }));
				children.push(react.createElement("path", { d: geom.line, fill: "none", stroke: "var(--du-trend-line)", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }));
				// 2026-09-18b: the LAST segment covers the still-running bucket, whose
				// sum is incomplete — a dashed overlay says "in progress" instead of
				// letting the tail look like usage collapsed to zero.
				if (partialTail && geom.tailLine !== "") {
					children.push(react.createElement("path", { d: geom.tailLine, fill: "none", stroke: "var(--du-trend-line)", strokeWidth: 2, strokeLinecap: "round", strokeDasharray: "4 3" }));
				}
				children.push(react.createElement("g", { fill: "var(--dsw-alias-label-caption)", fontSize: 10, textAnchor: "middle" },
					scaled.ticks.map((t) => react.createElement("text", { key: "t" + t.x, x: t.x, y: h - 2, textAnchor: tickAnchor(t.x, w) }, t.label))));
			}
			const onMove = (e) => {
				const svg = e.currentTarget;
				const rect = svg.getBoundingClientRect();
				if (!rect.width || !rect.height) return;
				const vx = (e.clientX - rect.left) * (w / rect.width);
				const vy = (e.clientY - rect.top) * (h / rect.height);
				const hit = hitFn(vx, vy);
				if (!hit) { setTip(null); return; }
				const pos = tipAtEvent(e, 110, 40);
				// arrow pivot tracks the pointer (clamped inside the card)
				const ax = Math.max(10, Math.min(110 - 18, e.clientX - pos.left));
				const ay = Math.max(10, Math.min(40 - 18, e.clientY - pos.top));
				setTip({ left: pos.left, top: pos.top, dir: pos.dir, ax: ax, ay: ay, day: bucketLabel(hit.day), valueText: hit.valueText, muted: false });
			};
			const tipEl = tooltipEnabled && tip
				? react.createElement("div", { className: "du_tip du_tip" + tip.dir.toUpperCase(), style: { left: tip.left + "px", top: tip.top + "px", "--du-tip-ax": tip.ax + "px", "--du-tip-ay": tip.ay + "px" } },
						react.createElement("div", { className: "du_tipDay" }, tip.day),
						react.createElement("div", { className: "du_tipValue" },
							tip.muted ? tip.valueText : react.createElement("span", null, tip.valueText, react.createElement("span", { className: "du_tipUnit" }, " tokens"))))
				: null;
			return react.createElement("div", { style: { position: "relative" } },
				react.createElement("svg", { viewBox: "0 0 " + w + " " + h, className: "du_svg", role: "img", "aria-label": "usage trend", ...(tooltipEnabled ? { onMouseMove: onMove, onMouseLeave: () => setTip(null) } : {}) }, children),
				tipEl);
		}
		function HeatmapChart(props) {
			const cell = 11;
			// P0-b: settings switches — heatmap.levels (1..6, default 6),
			// peakRing / monthLabels / legendNote (default true), ui.tooltip.
			const levels = Number.isInteger(props.levels) && props.levels >= 1 ? Math.min(6, props.levels) : 6;
			const peakRingEnabled = props.peakRing !== false;
			const monthLabelsEnabled = props.monthLabels !== false;
			const legendNoteEnabled = props.legendNote !== false;
			const tooltipEnabled = props.tooltip !== false;
			const grid = heatmapGrid(props.days || [], cell, { levels });
			const monthRow = 16;
			const gridH = monthRow + 7 * (cell + 3) - 3;
			// 2026-09-14 tooltip: self-drawn hover tooltip on top of the
			// per-cell <title> (kept as an a11y/fallback affordance). Cells
			// already carry {day, value, level} from heatmapGrid, so the
			// hit-test reads the day/token value directly; level 0 shows
			// 无数据.
			const [tip, setTip] = react.useState(null);
			if (grid.cells.length === 0) return react.createElement("div", { className: "du_note" }, "暂无热力图数据");
			// 2026-09-12 heatmap redesign v3: per-cell SVG <title> tooltip (data
			// vs 无数据), month labels CENTERED over their covered column span
			// (text-anchor middle, 12px — visible in dark via --du-heat-month-fill
			// = label-secondary), the peak cell gets a 2px --du-heat-peak-stroke
			// ring (theme-opposite of the peak fill), legend + a unit/peak note
			// line (label-secondary text).
			const rects = grid.cells.map((c) => {
				const isPeak = peakRingEnabled && c.day === grid.peakDay;
				return react.createElement("g", { key: c.day },
					react.createElement("title", null, c.level === 0 ? c.day + " · 无数据" : c.day + " · 总用量 " + formatTokens(c.value) + " tokens"),
					react.createElement("rect", { x: c.x, y: c.y, width: c.size, height: c.size, rx: 2, fill: c.fill, stroke: isPeak ? "var(--du-heat-peak-stroke)" : c.stroke, strokeWidth: isPeak ? 2 : c.strokeWidth }));
			});
			const monthLabels = monthLabelsEnabled
				? grid.months.map((m) =>
						react.createElement("text", { key: m.label + "-" + m.x, x: m.x, y: 12, textAnchor: "middle", fill: "var(--du-heat-month-fill)", fontSize: 12 }, m.label))
				: [];
			const legend = react.createElement("div", { className: "du_legend" },
				react.createElement("span", null, "少"),
				FILLS.slice(1, levels + 1).map((f) => react.createElement("span", { key: f, className: "du_swatch", style: { background: f } })),
				react.createElement("span", null, "多"));
			const legendNote = legendNoteEnabled
				? react.createElement("div", { className: "du_heatNote" },
						"单位 tokens/日 · 灰格 = 无数据 · 峰值 " + formatTokens(grid.peak) + " tokens/日（" + grid.peakDay + "）")
				: null;
			const onMove = (e) => {
				const svg = e.currentTarget;
				const rect = svg.getBoundingClientRect();
				if (!rect.width || !rect.height) return;
				const vw = Math.max(grid.width, 200);
				const vx = (e.clientX - rect.left) * (vw / rect.width);
				const vy = (e.clientY - rect.top) * (gridH / rect.height);
				const i = hitGridCells(grid.cells, vx, vy, monthRow);
				if (i < 0) { setTip(null); return; }
				const c = grid.cells[i];
				const noData = c.level === 0;
				const pos = tipAtEvent(e, 110, 40);
				const ax = Math.max(10, Math.min(110 - 18, e.clientX - pos.left));
				const ay = Math.max(10, Math.min(40 - 18, e.clientY - pos.top));
				setTip({ left: pos.left, top: pos.top, dir: pos.dir, ax: ax, ay: ay, day: c.day.slice(5), valueText: noData ? "无数据" : tipTokens(c.value), muted: noData });
			};
			const tipEl = tooltipEnabled && tip
				? react.createElement("div", { className: "du_tip du_tip" + tip.dir.toUpperCase(), style: { left: tip.left + "px", top: tip.top + "px", "--du-tip-ax": tip.ax + "px", "--du-tip-ay": tip.ay + "px" } },
						react.createElement("div", { className: "du_tipDay" }, tip.day),
						react.createElement("div", { className: "du_tipValue" + (tip.muted ? " du_tipMuted" : "") },
							tip.muted ? tip.valueText : react.createElement("span", null, tip.valueText, react.createElement("span", { className: "du_tipUnit" }, " tokens"))))
				: null;
			return react.createElement(react.Fragment, null,
				react.createElement("div", { style: { position: "relative" } },
					react.createElement("svg", { viewBox: "0 0 " + Math.max(grid.width, 200) + " " + gridH, className: "du_svg", role: "img", "aria-label": "usage heatmap", ...(tooltipEnabled ? { onMouseMove: onMove, onMouseLeave: () => setTip(null) } : {}) },
						monthLabels,
						react.createElement("g", { transform: "translate(0," + monthRow + ")" }, rects)),
					tipEl),
				legend,
				legendNote);
		}
		function UsageTable(props) {
			const rows = props.rows || [];
			if (rows.length === 0) return react.createElement("div", { className: "du_note" }, props.emptyText || "暂无数据");
			const head = react.createElement("tr", null, props.columns.map((c) => react.createElement("th", { key: c.key }, c.label)));
			const body = rows.map((row, index) =>
				react.createElement("tr", {
					key: props.rowKey(row, index),
					className: props.onRowClick ? "du_clickable" : undefined,
					onClick: props.onRowClick ? () => props.onRowClick(row) : undefined,
				}, props.columns.map((c) => react.createElement("td", { key: c.key }, c.render ? c.render(row) : String(row[c.key] ?? "")))));
			return react.createElement("div", { className: "du_tableWrap" },
				react.createElement("table", { className: "du_table" }, react.createElement("thead", null, head), react.createElement("tbody", null, body)));
		}
		function UsageCard(props) {
			const rpc = props.rpc;
			const sessions = props.sessions;
			// P0-b: reactive settings snapshot — settings.yaml edits hot-reload
			// the card (scope.subscribe → setState → re-render) without a
			// restart. Missing/loading/unavailable scope → defaults (现状).
			const [settings, setSettings] = react.useState(() => usageSettingsOf(
				props.settingsScope ? props.settingsScope.getSnapshot() : null,
			));
			react.useEffect(() => {
				if (!props.settingsScope) return;
				const update = () => setSettings(usageSettingsOf(props.settingsScope.getSnapshot()));
				update();
				return props.settingsScope.subscribe(update);
			}, [props.settingsScope]);
			const [dataSource, setDataSource] = react.useState("all");
			const [rangeDays, setRangeDays] = react.useState(7);
			const [customFrom, setCustomFrom] = react.useState("");
			const [customTo, setCustomTo] = react.useState("");
			const [refreshSec, setRefreshSec] = react.useState(30);
			const [bucket, setBucket] = react.useState("total");
			const [chartMode, setChartMode] = react.useState("area");
			// 2026-09-18b: trend GEAR — `hour` = the 24h intraday window
			// (04:00 → 04:00, one bucket per hour), `day` = the range selector's
			// daily series. `trendDay` empty = the current window; a date picks that
			// date's own 04:00 → next 04:00 window (history browsing).
			const [trendGrain, setTrendGrain] = react.useState("hour");
			const [trendDay, setTrendDay] = react.useState("");
			const [trendWindow, setTrendWindow] = react.useState(() => usageDayWindow(Date.now(), TREND_ANCHOR_HOUR));
			const [tab, setTab] = react.useState("byModel");
			const [error, setError] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [summary, setSummary] = react.useState(null);
			const [timeseries, setTimeseries] = react.useState([]);
			// 2026-09-18: hourly series for the smooth trend curve (optional — see
			// the granularity "hour" call in loadAll).
			const [timeseriesHour, setTimeseriesHour] = react.useState([]);
			const [heatmap, setHeatmap] = react.useState([]);
			const [byModel, setByModel] = react.useState([]);
			const [byProject, setByProject] = react.useState([]);
			const [byDay, setByDay] = react.useState([]);
			const [sessionRows, setSessionRows] = react.useState([]);
			const [status, setStatus] = react.useState(null);
			const [sessionFrom, setSessionFrom] = react.useState("");
			const [sessionTo, setSessionTo] = react.useState("");
			const rpcAvailable = rpc && typeof rpc.call === "function";
			const range = react.useMemo(() => {
				const now = Date.now();
				if (rangeDays > 0) return { from: now - rangeDays * 86400000, to: now };
				const from = customFrom ? new Date(customFrom + "T00:00:00").getTime() : undefined;
				const to = customTo ? new Date(customTo + "T23:59:59").getTime() : undefined;
				return { from, to };
			}, [rangeDays, customFrom, customTo]);
			const payload = react.useMemo(() => ({ from: range.from, to: range.to, dataSources: dataSource }), [range.from, range.to, dataSource]);
			const loadAll = react.useCallback(async () => {
				if (!rpcAvailable) {
					setError({ code: "unavailable", message: "宿主未注册 /usage RPC 通道" });
					return;
				}
				setLoading(true);
				try {
					// 2026-09-18b: the intraday series has its OWN window (04:00 →
					// 04:00 of the selected day), independent of the card-level range
					// selector. Recomputed on every load so a long-lived tab rolls
					// over the 04:00 boundary by itself.
					const trendWin = trendDay === ""
						? usageDayWindow(Date.now(), TREND_ANCHOR_HOUR)
						: usageDayWindow(
							new Date(trendDay + "T" + String(TREND_ANCHOR_HOUR).padStart(2, "0") + ":00:00").getTime(),
							TREND_ANCHOR_HOUR,
						);
					const calls = await Promise.all([
						rpc.call(CHANNEL, "summary", payload),
						rpc.call(CHANNEL, "timeseries", Object.assign({ granularity: "day" }, payload)),
						rpc.call(CHANNEL, "heatmap", { year: new Date(range.from || Date.now()).getFullYear(), dataSources: dataSource }),
						rpc.call(CHANNEL, "byModel", payload),
						rpc.call(CHANNEL, "byProject", payload),
						rpc.call(CHANNEL, "byDay", payload),
						// Deliberately OUTSIDE the all-or-nothing gate below: a host
						// predating the hourly whitelist rejects this with
						// invalid-params, and that must degrade to the daily trend
						// instead of blanking the whole card.
						rpc.call(CHANNEL, "timeseries", { granularity: "hour", from: trendWin.from, to: trendWin.to, dataSources: dataSource }).catch(() => null),
					]);
					if (calls.slice(0, 6).every((r) => r && r.ok)) {
						setSummary(calls[0].value);
						setTimeseries(calls[1].value || []);
						setHeatmap(calls[2].value || []);
						setByModel(calls[3].value || []);
						setByProject(calls[4].value || []);
						setByDay(calls[5].value || []);
						setTimeseriesHour(calls[6] && calls[6].ok ? calls[6].value || [] : []);
						setTrendWindow(trendWin);
						setError(null);
					} else {
						const failed = calls.slice(0, 6).find((r) => !r || !r.ok);
						setError((failed && failed.error) || { code: "internal", message: "unknown rpc failure" });
					}
				} catch (cause) {
					setError({ code: "transport", message: String((cause && cause.message) || cause) });
				} finally {
					setLoading(false);
				}
			}, [rpcAvailable, rpc, payload, range.from, dataSource, trendDay]);
			const loadSessions = react.useCallback(async () => {
				if (!rpcAvailable) return;
				const from = sessionFrom ? new Date(sessionFrom + "T00:00:00").getTime() : range.from;
				const to = sessionTo ? new Date(sessionTo + "T23:59:59").getTime() : range.to;
				try {
					const result = await rpc.call(CHANNEL, "sessions", { from, to, dataSources: dataSource, limit: 200 });
					if (result && result.ok) {
						setSessionRows(result.value || []);
					} else {
						setError((result && result.error) || { code: "internal", message: "sessions rpc failure" });
					}
				} catch (cause) {
					setError({ code: "transport", message: String((cause && cause.message) || cause) });
				}
			}, [rpcAvailable, rpc, dataSource, range.from, range.to, sessionFrom, sessionTo]);
			const loadStatus = react.useCallback(async () => {
				if (!rpcAvailable) return;
				try {
					const result = await rpc.call(CHANNEL, "status", {});
					if (result && result.ok) setStatus(result.value);
				} catch {
					// status is best-effort
				}
			}, [rpcAvailable, rpc]);
			react.useEffect(() => {
				void loadAll();
				void loadSessions();
				void loadStatus();
			}, [loadAll, loadSessions, loadStatus]);
			react.useEffect(() => {
				if (refreshSec <= 0) return;
				const timer = setInterval(() => void loadAll(), refreshSec * 1000);
				return () => clearInterval(timer);
			}, [refreshSec, loadAll]);
			const onManualRefresh = async () => {
				if (rpcAvailable) {
					try {
						await rpc.call(CHANNEL, "refresh", {});
					} catch {
						// refresh endpoint is best-effort; reload regardless
					}
				}
				await loadAll();
				await loadSessions();
			};
			const onSessionClick = (row) => {
				try {
					if (sessions && typeof sessions.select === "function") sessions.select(row.session_id);
					else setError({ code: "session", message: "sessions.select 不可用" });
				} catch (cause) {
					setError({ code: "session", message: String((cause && cause.message) || cause) });
				}
			};
			const hero = summary
				? [
						react.createElement(StatBox, { key: "req", label: "请求数", value: String(summary.requests) }),
						react.createElement(StatBox, { key: "in", label: "输入(未缓存)", value: formatTokens(summary.input_tokens) }),
						react.createElement(StatBox, { key: "out", label: "输出", value: formatTokens(summary.output_tokens) }),
						react.createElement(StatBox, { key: "cr", label: "缓存读", value: formatTokens(summary.cache_read_tokens) }),
						react.createElement(StatBox, { key: "cw", label: "缓存写", value: formatTokens(summary.cache_write_tokens) }),
						react.createElement(StatBox, { key: "hit", label: "命中率", value: Math.round((summary.hit_rate || 0) * 100) + "%" }),
						react.createElement(StatBox, { key: "sess", label: "覆盖会话", value: String(summary.sessions) }),
					]
				: [react.createElement(StatBox, { key: "loading", label: "状态", value: loading ? "加载中…" : "无数据" })];
			const tabBody = (() => {
				if (tab === "byModel") {
					return react.createElement(UsageTable, {
						columns: [
							{ key: "model", label: "模型", render: (r) => r.model || "(unknown)" },
							{ key: "requests", label: "请求数" },
							{ key: "input_tokens", label: "输入(未缓存)", render: (r) => formatTokens(r.input_tokens) },
							{ key: "output_tokens", label: "输出", render: (r) => formatTokens(r.output_tokens) },
							{ key: "cache_read_tokens", label: "缓存读", render: (r) => formatTokens(r.cache_read_tokens) },
							{ key: "cache_write_tokens", label: "缓存写", render: (r) => formatTokens(r.cache_write_tokens) },
						],
						rows: byModel,
						rowKey: (r) => "m" + (r.model || ""),
						emptyText: "暂无模型数据",
					});
				}
				if (tab === "byProject") {
					return react.createElement(UsageTable, {
						columns: [
							{ key: "project", label: "项目", render: (r) => r.project || "(unknown)" },
							{ key: "requests", label: "请求数" },
							{ key: "input_tokens", label: "输入(未缓存)", render: (r) => formatTokens(r.input_tokens) },
							{ key: "output_tokens", label: "输出", render: (r) => formatTokens(r.output_tokens) },
							{ key: "cache_read_tokens", label: "缓存读", render: (r) => formatTokens(r.cache_read_tokens) },
							{ key: "cache_write_tokens", label: "缓存写", render: (r) => formatTokens(r.cache_write_tokens) },
						],
						rows: byProject,
						rowKey: (r) => "p" + (r.project || ""),
						emptyText: "暂无项目数据",
					});
				}
				if (tab === "byDay") {
					return react.createElement(UsageTable, {
						columns: [
							{ key: "day", label: "日期" },
							{ key: "requests", label: "请求数" },
							{ key: "input_tokens", label: "输入(未缓存)", render: (r) => formatTokens(r.input_tokens) },
							{ key: "output_tokens", label: "输出", render: (r) => formatTokens(r.output_tokens) },
							{ key: "cache_read_tokens", label: "缓存读", render: (r) => formatTokens(r.cache_read_tokens) },
							{ key: "cache_write_tokens", label: "缓存写", render: (r) => formatTokens(r.cache_write_tokens) },
						],
						rows: byDay,
						rowKey: (r) => "d" + r.day,
						emptyText: "暂无按日数据",
					});
				}
				return react.createElement(react.Fragment, null,
					react.createElement("div", { className: "du_toolbar" },
						react.createElement("label", { className: "du_note" }, "日期筛选"),
						react.createElement("input", { type: "date", className: "du_select", value: sessionFrom, onChange: (e) => setSessionFrom(e.target.value) }),
						react.createElement("input", { type: "date", className: "du_select", value: sessionTo, onChange: (e) => setSessionTo(e.target.value) }),
						react.createElement("button", { type: "button", className: "du_btn", onClick: () => void loadSessions() }, "查询")),
					react.createElement(UsageTable, {
						columns: [
							{ key: "session_id", label: "会话" },
							{ key: "data_source", label: "来源" },
							{ key: "ts", label: "最近时间", render: (r) => fmtDate(r.ts) },
							{ key: "requests", label: "请求数" },
							{ key: "input_tokens", label: "输入(未缓存)", render: (r) => formatTokens(r.input_tokens) },
							{ key: "output_tokens", label: "输出", render: (r) => formatTokens(r.output_tokens) },
							{ key: "cache_read_tokens", label: "缓存读", render: (r) => formatTokens(r.cache_read_tokens) },
							{ key: "cache_write_tokens", label: "缓存写", render: (r) => formatTokens(r.cache_write_tokens) },
							{ key: "model", label: "模型", render: (r) => r.model || "-" },
						],
						rows: sessionRows,
						rowKey: (r) => "s" + r.data_source + r.session_id,
						onRowClick: onSessionClick,
						emptyText: "暂无会话数据（点击行可跳转到会话）",
					}));
			})();
			const statusLine = status
				? "上次 ingest：" + (status.lastIngest ? fmtDate(status.lastIngest) : "—") + " · 来源事件：dsh " + (status.eventsDsh || 0) + " / cc " + (status.eventsCc || 0)
				: "状态通道不可用";
			// 2026-09-18: the hourly trend series is computed ONCE here and drives
			// both the panel title and the chart, so they can never disagree about
			// which series is on screen. It is offered only when the host actually
			// returned hourly buckets (a host predating the `hour` granularity
			// rejects the call → empty state → the chart falls back to the daily
			// series). Guarding on the RAW rows matters: `fillBuckets` completes
			// sparse hours but leaves an empty input empty, and an earlier revision
			// keyed the fallback on the FILLED array — which is never empty — so a
			// rejected hour call produced 57 fabricated zero buckets and the whole
			// trend read "0 tokens".
			const hourlyRows = Array.isArray(timeseriesHour) && timeseriesHour.length > 0
				? fillBuckets(timeseriesHour, { granularity: "hour", from: trendWindow.from, to: Math.min(trendWindow.to - 1, Date.now()) })
				: [];
			const dailyRows = fillBuckets(timeseries, { granularity: "day", from: range.from, to: range.to });
			// 2026-09-18b: "the last bucket is still running" — the current intraday
			// window (its final hour) or a daily series whose last day is today.
			const trendPartial = trendGrain === "hour"
				? (hourlyRows.length > 1 && trendWindow.to > Date.now())
				: (dailyRows.length > 1 && dailyRows[dailyRows.length - 1].day === formatDay(new Date()));
			// 2026-09-18b: title states the gear AND the window it covers; when the
			// host cannot serve hourly buckets the fallback is named explicitly so
			// the reader is never shown a daily curve under an "hourly" label.
			const trendTitle = trendGrain === "hour" && hourlyRows.length > 0
				? "趋势（逐小时 " + windowLabel(trendWindow.from) + "–" + windowLabel(trendWindow.to) + "）"
				: (trendGrain === "hour"
					? "趋势（按日 · 宿主暂不支持小时粒度，重启后生效）"
					: "趋势（按日）");
			return react.createElement("div", { className: "du_root" },
				react.createElement("div", { className: "du_head" },
					react.createElement("div", { className: "du_title" }, "Token 用量 · dsh-usage"),
					react.createElement("div", { className: "du_sub" }, "dsh + Claude Code 双源统计（不计费）")),
				react.createElement("div", { className: "du_toolbar" },
					react.createElement("select", { className: "du_select", value: dataSource, onChange: (e) => setDataSource(e.target.value) },
						react.createElement("option", { value: "all" }, "全部来源"),
						react.createElement("option", { value: "dsh" }, "dsh"),
						react.createElement("option", { value: "cc" }, "cc")),
					react.createElement("select", { className: "du_select", value: String(rangeDays), onChange: (e) => setRangeDays(Number(e.target.value)) },
						react.createElement("option", { value: "7" }, "近 7 天"),
						react.createElement("option", { value: "30" }, "近 30 天"),
						react.createElement("option", { value: "90" }, "近 90 天"),
						react.createElement("option", { value: "0" }, "自选")),
					rangeDays === 0
						? react.createElement(react.Fragment, null,
								react.createElement("input", { type: "date", className: "du_select", value: customFrom, onChange: (e) => setCustomFrom(e.target.value) }),
								react.createElement("input", { type: "date", className: "du_select", value: customTo, onChange: (e) => setCustomTo(e.target.value) }))
						: null,
					react.createElement("select", { className: "du_select", value: String(refreshSec), onChange: (e) => setRefreshSec(Number(e.target.value)) },
						react.createElement("option", { value: "0" }, "不轮询"),
						react.createElement("option", { value: "5" }, "5s 刷新"),
						react.createElement("option", { value: "30" }, "30s 刷新"),
						react.createElement("option", { value: "60" }, "60s 刷新")),
					react.createElement("button", { type: "button", className: "du_btn", disabled: loading, onClick: () => void onManualRefresh() }, loading ? "加载中…" : "手动刷新")),
				error
					? react.createElement("div", { className: "du_error" },
							react.createElement("div", null, "数据加载失败：" + (error.message || error.code)),
							react.createElement("div", { className: "du_errorDetail" }, String(error.code || "")))
					: null,
				react.createElement("div", { className: "du_hero" }, hero),
				react.createElement("div", { className: "du_note" },
					"口径：请求数 = 含 usage 的调用（dsh 按 turn:step 并集去重，cc 按 message.id 去重）；输入 = 未缓存输入（cc 已扣除缓存读/写，B3）；总 tokens = 输入+输出+缓存读+缓存写；命中率 = 缓存读/(输入+缓存读)。本地时区。"),
				react.createElement("div", { className: "du_panel" },
					react.createElement("div", { className: "du_panelTitle" }, trendTitle),
					react.createElement("div", { className: "du_toolbar" },
						react.createElement("select", { className: "du_select", value: trendGrain, onChange: (e) => setTrendGrain(e.target.value) },
							react.createElement("option", { value: "hour" }, "24h 逐小时"),
							react.createElement("option", { value: "day" }, "按日")),
						trendGrain === "hour"
							? react.createElement(react.Fragment, null,
									react.createElement("input", {
										type: "date",
										className: "du_select",
										value: trendDay,
										max: formatDay(new Date()),
										title: "选择要回看的那一天（" + TREND_ANCHOR_HOUR + ":00 → 次日 " + TREND_ANCHOR_HOUR + ":00）",
										onChange: (e) => setTrendDay(e.target.value),
									}),
									trendDay === ""
										? null
										: react.createElement("button", { type: "button", className: "du_btn", onClick: () => setTrendDay("") }, "回到今日"))
							: null,
						react.createElement("select", { className: "du_select", value: bucket, onChange: (e) => setBucket(e.target.value) },
							BUCKETS.map((b) => react.createElement("option", { key: b.key, value: b.key }, b.label))),
						react.createElement("select", { className: "du_select", value: chartMode, onChange: (e) => setChartMode(e.target.value) },
							react.createElement("option", { value: "area" }, "面积图"),
							react.createElement("option", { value: "bar" }, "柱状图"))),
					react.createElement(TrendChart, { rows: dailyRows, hourly: hourlyRows, grain: trendGrain, partial: trendPartial, bucket: bucket, mode: chartMode, tooltip: settings.ui.tooltip })),
				react.createElement("div", { className: "du_panel" },
					react.createElement("div", { className: "du_panelTitle" }, "热力图（按日总量）"),
					react.createElement(HeatmapChart, { days: heatmap, tooltip: settings.ui.tooltip, peakRing: settings.heatmap.peakRing, monthLabels: settings.heatmap.monthLabels, legendNote: settings.heatmap.legendNote, levels: settings.heatmap.levels })),
				react.createElement("div", { className: "du_tabs" },
					TABS.map((t) => react.createElement("button", { key: t.key, type: "button", className: "du_tab" + (tab === t.key ? " du_tabActive" : ""), onClick: () => setTab(t.key) }, t.label))),
				tabBody,
				react.createElement("div", { className: "du_note" }, statusLine));
		}
		//#endregion
		//#region plugin face (bundle exports.inject = service names; apply registers the card slot)
		const inject = ["slots", "connection", "sessions", "settingsScope"];
		// P0-b: narrow the settingsScope snapshot to the keys the card reads;
		// absent/loading/unavailable sections resolve to the defaults (无键 =
		// 现状, old-config compatible). Defaults mirror lib/index.js schema
		// defaults: ui.tooltip=true; heatmap.{peakRing,monthLabels,legendNote}=
		// true, heatmap.levels=6.
		function usageSettingsOf(snapshot) {
			const value = snapshot && snapshot.value && typeof snapshot.value === "object" ? snapshot.value : {};
			const ui = value.ui && typeof value.ui === "object" ? value.ui : {};
			const heatmap = value.heatmap && typeof value.heatmap === "object" ? value.heatmap : {};
			return {
				ui: { tooltip: ui.tooltip !== false },
				heatmap: {
					peakRing: heatmap.peakRing !== false,
					monthLabels: heatmap.monthLabels !== false,
					legendNote: heatmap.legendNote !== false,
					levels: Number.isInteger(heatmap.levels) && heatmap.levels >= 1 ? Math.min(6, heatmap.levels) : 6,
				},
			};
		}
		function apply(ctx) {
			// `useStore` placeholder: the dsh-usage settings namespace now
			// carries behavior switches (P0-b) read through the settingsScope
			// bound below; the card consumes them via the `settingsScope` prop
			// (snapshot value + subscribe), so settings.yaml edits hot-reload
			// the card without a restart.
			const useStore = () => ({});
			// P0-b: bind the `dsh-usage` namespace scope on this fiber; when the
			// settingsScope service is unavailable the card falls back to
			// USAGE_SETTINGS_DEFAULTS (current behavior).
			let settingsScope = null;
			try {
				const binder = ctx.settingsScope;
				if (binder && typeof binder.bind === "function") {
					settingsScope = binder.bind({ namespace: "dsh-usage" });
				}
			} catch {
				settingsScope = null;
			}
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "dsh-usage",
				locale: "dshUsage",
				// REVIEW P3: `connection` is declared in package.json
				// `dsh.client.inject` so the bundle may consume it; take it
				// defensively anyway — when the injection is missing the card
				// falls back to the ready-made `rpcAvailable=false` state
				// ("宿主未注册 /usage RPC 通道") instead of a render TypeError.
				inject: () => ({ useStore, rpc: ctx.connection?.rpc ?? null, sessions: ctx.sessions, settingsScope }),
			}, UsageCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
