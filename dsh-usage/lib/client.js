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
		const css = ".du_root{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px;font-size:13px;line-height:20px}.du_head{align-items:center;gap:8px;flex-wrap:wrap;display:flex}.du_title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600}.du_sub{color:var(--dsw-alias-label-caption);font-size:11px}.du_toolbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.du_select{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:2px 6px;font:inherit;font-size:12px}.du_btn{color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-border-inverted);border-radius:8px;padding:2px 10px;font:inherit;font-size:12px}.du_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.du_btn:disabled{opacity:.4;cursor:default}.du_error{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px}.du_errorDetail{color:var(--dsw-alias-label-caption);font-family:var(--ds-font-family-code,monospace);font-size:11px;word-break:break-all}.du_hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}.du_stat{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px 10px;min-width:0}.du_statLabel{color:var(--dsw-alias-label-caption);font-size:11px}.du_statValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}.du_note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}.du_panel{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}.du_panelTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}.du_svg{width:100%;max-width:560px;height:auto}.du_tabs{display:flex;gap:4px;flex-wrap:wrap}.du_tab{color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font:inherit;font-size:12px}.du_tabActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);border-color:var(--dsw-alias-border-inverted)}.du_tableWrap{max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.du_table{border-collapse:collapse;width:100%;font-size:12px}.du_table th{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-interactive-bg-hover);padding:4px 8px;text-align:left;font-weight:500;position:sticky;top:0}.du_table td{padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}.du_table tr.du_clickable{cursor:pointer}.du_table tr.du_clickable:hover td{background:var(--dsw-alias-interactive-bg-hover)}.du_legend{display:flex;gap:4px;align-items:center;color:var(--dsw-alias-label-caption);font-size:11px;flex-wrap:wrap}.du_swatch{width:10px;height:10px;border-radius:2px;display:inline-block}";
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
		const FILLS = [
			"var(--dsw-alias-interactive-bg-hover)",
			"var(--dsw-state-warn-secondary)",
			"var(--dsw-state-warn-primary)",
			"var(--dsw-state-success-secondary)",
			"var(--dsw-state-success-primary)",
			"var(--dsw-state-business-secondary)",
			"var(--dsw-state-business-primary)",
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
		function barRects(values, w, h, opts) {
			const pad = opts && Number.isFinite(opts.pad) ? opts.pad : 1;
			if (!Array.isArray(values)) return [];
			return values.map((v) => ({
				x: Math.max(0, v.x + pad),
				y: Math.max(0, v.y),
				width: Math.max(0.5, v.width - pad * 2),
				height: Math.max(0, Math.min(v.height, h - v.y)),
				value: v.value,
			}));
		}
		function heatmapGrid(days, cell, opts) {
			const gap = opts && Number.isFinite(opts.gap) ? opts.gap : 3;
			const startWeekday = opts && Number.isFinite(opts.startWeekday) ? opts.startWeekday : 0;
			const size = cell;
			const levels = 6;
			if (!Array.isArray(days) || days.length === 0) return { cells: [], weeks: 0, width: 0, levels };
			const sorted = days.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
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
		function scaleBars(series, w, h) {
			if (!Array.isArray(series) || series.length === 0) return { rects: [], ticks: [] };
			const max = Math.max(1, ...series.map((s) => s.value));
			const slot = w / series.length;
			const baseline = h;
			const rects = series.map((s, i) => {
				const height = (s.value / max) * (h - 4);
				return { x: i * slot, y: baseline - height, width: slot, height, value: s.value };
			});
			const tickEvery = Math.max(1, Math.ceil(series.length / 8));
			const ticks = series
				.map((s, i) => ({ label: s.day.slice(5), x: i * slot + slot / 2 }))
				.filter((_, i) => i % tickEvery === 0 || i === series.length - 1);
			return { rects, ticks };
		}
		function scaleArea(series, w, h) {
			if (!Array.isArray(series) || series.length === 0) return { points: [], ticks: [] };
			const max = Math.max(1, ...series.map((s) => s.value));
			const slot = series.length > 1 ? w / (series.length - 1) : w;
			const points = series.map((s, i) => ({ x: i * slot, y: h - (s.value / max) * (h - 4) - 2 }));
			const tickEvery = Math.max(1, Math.ceil(series.length / 8));
			const ticks = series
				.map((s, i) => ({ label: s.day.slice(5), x: i * slot }))
				.filter((_, i) => i % tickEvery === 0 || i === series.length - 1);
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
		//#endregion
		//#region card components
		const CHANNEL = "/usage";
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
		function StatBox(props) {
			return react.createElement("div", { className: "du_stat" },
				react.createElement("div", { className: "du_statLabel" }, props.label),
				react.createElement("div", { className: "du_statValue" }, props.value));
		}
		function TrendChart(props) {
			const series = (props.rows || []).map((r) => ({ day: r.day, value: bucketValue(r, props.bucket) }));
			const w = 560;
			const h = 150;
			if (series.length === 0) return react.createElement("div", { className: "du_note" }, "暂无趋势数据");
			const children = [];
			if (props.mode === "bar") {
				const scaled = scaleBars(series, w, h);
				const rects = barRects(scaled.rects, w, h);
				children.push(react.createElement("g", { fill: "var(--dsw-state-business-primary)" },
					rects.map((r) => react.createElement("rect", { key: r.x + "-" + r.y, x: r.x, y: r.y, width: r.width, height: r.height, rx: 1 }))));
				children.push(react.createElement("g", { fill: "var(--dsw-alias-label-caption)", fontSize: 9, textAnchor: "middle" },
					scaled.ticks.map((t) => react.createElement("text", { key: "t" + t.x, x: t.x, y: h - 2 }, t.label))));
			} else {
				const scaled = scaleArea(series, w, h);
				const geom = areaPath(scaled.points, w, h);
				children.push(react.createElement("path", { d: geom.area, fill: "var(--dsw-state-business-secondary)", opacity: 0.35 }));
				children.push(react.createElement("path", { d: geom.line, fill: "none", stroke: "var(--dsw-state-business-primary)", strokeWidth: 2 }));
				children.push(react.createElement("g", { fill: "var(--dsw-alias-label-caption)", fontSize: 9, textAnchor: "middle" },
					scaled.ticks.map((t) => react.createElement("text", { key: "t" + t.x, x: t.x, y: h - 2 }, t.label))));
			}
			return react.createElement("svg", { viewBox: "0 0 " + w + " " + h, className: "du_svg", role: "img", "aria-label": "usage trend" }, children);
		}
		function HeatmapChart(props) {
			const cell = 11;
			const grid = heatmapGrid(props.days || [], cell);
			const gridH = 7 * (cell + 3) - 3;
			if (grid.cells.length === 0) return react.createElement("div", { className: "du_note" }, "暂无热力图数据");
			const rects = grid.cells.map((c) => react.createElement("rect", { key: c.day, x: c.x, y: c.y, width: c.size, height: c.size, rx: 2, fill: c.fill }));
			const legend = react.createElement("div", { className: "du_legend" },
				react.createElement("span", null, "少"),
				FILLS.map((f) => react.createElement("span", { key: f, className: "du_swatch", style: { background: f } })),
				react.createElement("span", null, "多"));
			return react.createElement(react.Fragment, null,
				react.createElement("svg", { viewBox: "0 0 " + Math.max(grid.width, 200) + " " + gridH, className: "du_svg", role: "img", "aria-label": "usage heatmap" }, rects),
				legend);
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
			const [dataSource, setDataSource] = react.useState("all");
			const [rangeDays, setRangeDays] = react.useState(7);
			const [customFrom, setCustomFrom] = react.useState("");
			const [customTo, setCustomTo] = react.useState("");
				const [refreshSec, setRefreshSec] = react.useState(60);
				const [pollVisible, setPollVisible] = react.useState(true);
				const cardRef = react.useRef(null);
				// Set inside the effect below; the IntersectionObserver callback reads it
				// so a visibility change never needs to re-create the observer (the
				// closures stay current through these refs, mirroring loadAllRef below).
				const setPollVisibleRef = react.useRef(null);
				/* dsh-perf-fix A-gating-fix v1 */ /* 必须把 setter 接到 ref 上：缺此行时观察器回调里的
				   `if (setPollVisibleRef.current)` 恒为假 → pollVisible 永远 true → 门控完全失效（死代码）。
				   与下方 loadAllRef.current = loadAll 同一写法（渲染期赋值）。 */
				setPollVisibleRef.current = setPollVisible;
				const ioRef = react.useRef(null);
				/** Node ↔ observer binding kept in a ref callback (it runs exactly once,
				 * when the card mounts — an effect's dependency array would re-observe on
				 * every render). Null on detach; remount re-observes. */
				const attachCardRef = react.useCallback((node) => {
					if (ioRef.current) {
						ioRef.current.disconnect();
						ioRef.current = null;
					}
					cardRef.current = node;
					if (node === null) return;
					if (typeof IntersectionObserver !== "function") {
						if (setPollVisibleRef.current) setPollVisibleRef.current(true);
						return;
					}
					const observer = new IntersectionObserver(
						(entries) => {
							for (const entry of entries) {
								if (setPollVisibleRef.current) setPollVisibleRef.current(Boolean(entry.isIntersecting));
							}
						},
						{ threshold: 0 },
					);
					observer.observe(node);
					ioRef.current = observer;
				}, []);
			const [bucket, setBucket] = react.useState("total");
			const [chartMode, setChartMode] = react.useState("area");
			const [tab, setTab] = react.useState("byModel");
			const [error, setError] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [summary, setSummary] = react.useState(null);
			const [timeseries, setTimeseries] = react.useState([]);
			const [heatmap, setHeatmap] = react.useState([]);
			const [byModel, setByModel] = react.useState([]);
			const [byProject, setByProject] = react.useState([]);
			const [byDay, setByDay] = react.useState([]);
			const [sessionRows, setSessionRows] = react.useState([]);
			const [status, setStatus] = react.useState(null);
			const [sessionFrom, setSessionFrom] = react.useState("");
			const [sessionTo, setSessionTo] = react.useState("");
			const rpcAvailable = rpc && typeof rpc.call === "function";
			const loadAllRef = react.useRef(null);

			const range = react.useMemo(() => {
				const now = Date.now();
				// 2026-09-20 (audit §4.5(1)/§5 A0): the rolling window was
				// `now - N*86400000`, which shares the host's day-granularity
				// pre-aggregation only by accident. Align "近 N 天" to local
				// calendar days instead — [today 00:00 - (N-1) days, today 23:59:59.999].
				// `setDate(getDate()-n)` (never `- n*86400000`) keeps the walk DST-safe.
				if (rangeDays > 0) {
					// ⚠️ 时间戳算术的浮点陷阱（实测踩到两次）：`new Date(...).getTime()`
					// 是 float，`midnight - 1` 会算成「次日 .001」而不是「前一日 .999」
					// （实测 `1789919999999.001`）；反过来 `midnight + 1` 会算成当天
					// `.001`。所以**任何「±1ms 取日边界」的写法都必须落在整毫秒的
					// Date 对象上再做算术**，并统一走 localDayStart / localDayEnd。
					const localDayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
					const localDayEnd = (d) => {
						const nextStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
						return new Date(nextStart).getTime() - 1;
					};
					// 顺序很重要：先在**整数毫秒**的日边界上做日历回退，再取窗口末端。
					// 若先取 `to`（含 `.999` 小数）再 `setDate`，`start` 会继承那个小数
					// 毫秒，`start !== localDayStart(start)` → 守卫永远不成立（实测踩到）。
					const start = new Date(localDayStart(new Date(now)));
					start.setDate(start.getDate() - (rangeDays - 1));
					const to = new Date(localDayEnd(new Date(now))); // 今天 23:59:59.999（整数毫秒）
					// 守卫：窗口两端都必须落在本地日边界（宿主侧还有第二道闸门，
					// 这里不成立只会退回滚动窗口 → 只损失速度、不会算错）。
					if (start.getTime() === localDayStart(start) && to.getTime() === localDayEnd(to)) {
						return { from: start.getTime(), to: to.getTime() };
					}
					return { from: now - rangeDays * 86400000, to: now };
				}
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
					const calls = await Promise.all([
						rpc.call(CHANNEL, "summary", payload),
						rpc.call(CHANNEL, "timeseries", Object.assign({ granularity: "day" }, payload)),
						rpc.call(CHANNEL, "heatmap", { year: new Date(range.from || Date.now()).getFullYear(), dataSources: dataSource }),
						rpc.call(CHANNEL, "byModel", payload),
						rpc.call(CHANNEL, "byProject", payload),
						rpc.call(CHANNEL, "byDay", payload),
					]);
					if (calls.every((r) => r && r.ok)) {
						setSummary(calls[0].value);
						setTimeseries(calls[1].value || []);
						setHeatmap(calls[2].value || []);
						setByModel(calls[3].value || []);
						setByProject(calls[4].value || []);
						setByDay(calls[5].value || []);
						setError(null);
					} else {
						const failed = calls.find((r) => !r || !r.ok);
						setError((failed && failed.error) || { code: "internal", message: "unknown rpc failure" });
					}
				} catch (cause) {
					setError({ code: "transport", message: String((cause && cause.message) || cause) });
				} finally {
					setLoading(false);
				}
			}, [rpcAvailable, rpc, payload, range.from, dataSource]);
			loadAllRef.current = loadAll;
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
				// 2026-09-20 (audit §5 B2): the card is a settings-page section —
				// while it is scrolled out of view (or the tab is in the
				// background) it must not poll at all: every cycle costs the host
				// ~0.3-0.5s of blocked event loop. Only the timer is gated; the
				// initial load and the manual refresh stay unconditional.
				if (!pollVisible || (typeof document !== "undefined" && document.hidden)) return;
				// latest-callback ref: the interval must NOT restart when a filter
				// change replaces loadAll's identity.
				const timer = setInterval(() => {
					if (typeof document !== "undefined" && document.hidden) return;
					const run = loadAllRef.current;
					if (typeof run === "function") void run();
				}, refreshSec * 1000);
				return () => clearInterval(timer);
			}, [refreshSec, pollVisible]);
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
			// 可见性门控的观察目标（B2）：卡片滚出视口/标签页不可见时停止轮询。
			return react.createElement("div", { className: "du_root", ref: attachCardRef },
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
					react.createElement("div", { className: "du_panelTitle" }, "趋势"),
					react.createElement("div", { className: "du_toolbar" },
						react.createElement("select", { className: "du_select", value: bucket, onChange: (e) => setBucket(e.target.value) },
							BUCKETS.map((b) => react.createElement("option", { key: b.key, value: b.key }, b.label))),
						react.createElement("select", { className: "du_select", value: chartMode, onChange: (e) => setChartMode(e.target.value) },
							react.createElement("option", { value: "area" }, "面积图"),
							react.createElement("option", { value: "bar" }, "柱状图"))),
					react.createElement(TrendChart, { rows: timeseries, bucket: bucket, mode: chartMode })),
				react.createElement("div", { className: "du_panel" },
					react.createElement("div", { className: "du_panelTitle" }, "热力图（按日总量）"),
					react.createElement(HeatmapChart, { days: heatmap })),
				react.createElement("div", { className: "du_tabs" },
					TABS.map((t) => react.createElement("button", { key: t.key, type: "button", className: "du_tab" + (tab === t.key ? " du_tabActive" : ""), onClick: () => setTab(t.key) }, t.label))),
				tabBody,
				react.createElement("div", { className: "du_note" }, statusLine));
		}
		//#endregion
		//#region plugin face (bundle exports.inject = service names; apply registers the card slot)
		const inject = ["slots", "connection", "sessions"];
		function apply(ctx) {
			// `useStore` placeholder: the dsh-usage settings namespace is empty
			// (AUDIT B8 — no configuration items), so the card reads nothing from
			// the settings store; the face still exposes the hook per AUDIT U10.
			const useStore = () => ({});
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "dsh-usage",
				locale: "dshUsage",
				// REVIEW P3: `connection` is declared in package.json
				// `dsh.client.inject` so the bundle may consume it; take it
				// defensively anyway — when the injection is missing the card
				// falls back to the ready-made `rpcAvailable=false` state
				// ("宿主未注册 /usage RPC 通道") instead of a render TypeError.
				inject: () => ({ useStore, rpc: ctx.connection?.rpc ?? null, sessions: ctx.sessions }),
			}, UsageCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
