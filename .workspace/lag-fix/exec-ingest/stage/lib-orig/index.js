//#region lib/index.js
/**
 * dsh-usage host half (AUDIT U09, REVIEW P0 fixed). Wires, in order:
 *   1. the `dsh-usage` settings namespace (`settings.register`, empty schema —
 *      B8: the Plugins tab only dispatches namespaces served by the host);
 *   2. the `/usage` RPC channel (`registerUsageRpc`, REVIEW P0 — the 0.1.5
 *      `ctx.connection.register(ctx, '/usage', handle)` posture, which needs
 *      `webServer` in the inject list; the client card's 9 endpoints);
 *   3. the usage SQLite database via the U05 fallback chain;
 *   4. an async first scan + a 45s `ctx.setInterval` ingest loop for the dsh
 *      and cc sources (failures warn, never exit);
 *   5. lifecycle cleanup (timer dispose + db.close) on unload.
 *
 * REVIEW P0 background: AUDIT U08 specified the 0.1.1 API
 * `ctx.connection.rpc.handle('/usage', handler, {authority:'loopback'})`,
 * which is structurally gone in the installed 0.1.5 profile — its route owner
 * hardcodes the connection service's own (webServer-less) ctx. The real
 * 0.1.5 API (dsh-taste bridge.js precedent) is
 * `ctx.connection.register(ctx, '/usage', handler)` with `webServer` also
 * injected; `registerUsageRpc` implements it in lib/rpc.js.
 * @module dsh-usage
 */

import z from "@deepseek-ai/schemastery";
import { resolveDbPath, openUsageDb, ensureSchema } from "./db.js";
import { foldDshSource } from "./ingest-dsh.js";
import { foldCcSource } from "./ingest-cc.js";
import { registerUsageRpc } from "./rpc.js";

const name = "usage";
// REVIEW P0: `connection` + `webServer` are both required — 0.1.5
// `connection.register(owner, channel, handler)` binds the /usage prefix
// route to the OWNER ctx via `owner.webServer.register` (taste precedent).
const inject = ["connection", "webServer"];

/** Ingest cadence: 30–60s window → 45s, constant (AUDIT U09 step 3). */
const INGEST_INTERVAL_MS = 45_000;

/**
 * Declarative config surface (P0-b settings 行为开关试点). Values hot-reload:
 * editing `~/.dsh/settings.yaml` `dsh-usage:` section republishes and the
 * client card re-renders without a restart. Keys are pure behavior switches;
 * defaults equal the pre-P0-b behavior (absent section = defaults = 现状).
 * Schema grows only-additively (no key removal) so old documents stay valid.
 */
const Config = z
	.object({
		ui: z
			.object({
				// 三图自绘跟随鼠标 tooltip（面积/柱状/热力图）。false = 回到
				// 无自绘浮层（热力图仍保留原生 <title> 兜底）。
				tooltip: z.boolean().default(true),
			})
			.default({}),
		heatmap: z
			.object({
				// 峰值日单元格的 2px 环（--du-heat-peak-stroke）。
				peakRing: z.boolean().default(true),
				// 月份标签行（覆盖列跨度居中，仅在有数据月份显示）。
				monthLabels: z.boolean().default(true),
				// 图例说明行（"单位 tokens/日 · 灰格 = 无数据 · 峰值…"）。
				legendNote: z.boolean().default(true),
				// 热力图强度分桶数（1..6，默认 6 = FILLS 满档）。
				levels: z.number().min(1).max(6).default(6),
			})
			.default({}),
	})
	.default({});

/** Defensive logger with the `dsh-usage` prefix (AUDIT U09 step 6). */
function createLogger(ctx) {
	const log = (level, message) => {
		try {
			ctx.logger?.[level]?.(`dsh-usage: ${message}`);
		} catch {
			// Logging must never throw into plugin startup.
		}
	};
	return {
		info: (message) => log("info", message),
		warn: (message) => log("warn", message),
		error: (message) => log("error", message),
	};
}

/**
 * Plugin entry point. `apply` settles synchronously; the DB open (await
 * `node:sqlite`) + first scan run in a deferred microtask (AUDIT U09 step 3).
 * @param {object} ctx - plugin context (`connection` injected per spec).
 * @param {object} config - validated declarative config (empty).
 */
export function apply(ctx) {
	const log = createLogger(ctx);

	// 1. Settings namespace (B8 + P0-b) — behavior switches with defaults; the
	//    Plugins tab pairs this namespace with the client card keyed `dsh-usage`.
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.register("dsh-usage", Config);
	});

	let db = null;
	let dbPath = null;
	let dbSource = null;
	let firstScanAt = null;
	let lastIngest = null;
	let disposeTimer = null;
	/* dsh-perf-fix R4 v1: 生命周期代次。bootstrap 的每个 await 之后都必须复查，
	   否则在 await 期间被卸载时仍会打开 DB、完成首扫并安装 timer。 */
	let disposed = false;
	let activationGeneration = 0;
	const isActive = (generation) => !disposed && generation === activationGeneration;
	let ingestSummary = { scannedDsh: 0, scannedCc: 0, newEventsDsh: 0, newEventsCc: 0, failedDsh: 0, failedCc: 0 };

	/** Run one ingest pass over both sources (best-effort, warn-only). */
	const runIngest = async () => {
		// dispose 之后不得再启动新 ingest（timer 已清，但飞行中的手动 refresh
		// 或已排队 tick 仍可能落到这里）。
		if (disposed || db === null) return;
		try {
			const dshResult = foldDshSource(db, undefined, {
				onProgress: ({ scanned, newEvents }) => {
					ingestSummary.scannedDsh = scanned;
					ingestSummary.newEventsDsh = newEvents;
				},
			});
			const ccResult = foldCcSource(db, undefined, {
				onProgress: ({ scanned, newEvents }) => {
					ingestSummary.scannedCc = scanned;
					ingestSummary.newEventsCc = newEvents;
				},
			});
			ingestSummary.failedDsh = dshResult.failedFiles.length;
			ingestSummary.failedCc = ccResult.failedFiles.length;
			lastIngest = Date.now();
			if (firstScanAt === null) firstScanAt = lastIngest;
			log.info(
				`ingest done: dsh scanned=${dshResult.scanned} new=${dshResult.newEvents} failed=${dshResult.failedFiles.length}; ` +
					`cc scanned=${ccResult.scanned} new=${ccResult.newEvents} failed=${ccResult.failedFiles.length}`,
			);
		} catch (error) {
			log.warn(`ingest failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	/** `status` endpoint value (REVIEW P0): reads the mutable state at call
	 * time — RPC may fire before the first scan completes (db null → zeros +
	 * null paths), and event counts come from the live DB, not cached vars. */
	const statusProvider = () => {
		let eventsDsh = 0;
		let eventsCc = 0;
		if (db !== null) {
			try {
				eventsDsh = Number(db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE data_source = 'dsh'").get().n);
				eventsCc = Number(db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE data_source = 'cc'").get().n);
			} catch (error) {
				log.warn(`status event count failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return {
			dbPath,
			dbSource,
			lastIngest,
			eventsDsh,
			eventsCc,
			scannedDsh: ingestSummary.scannedDsh,
			scannedCc: ingestSummary.scannedCc,
			failedDsh: ingestSummary.failedDsh,
			failedCc: ingestSummary.failedCc,
		};
	};

	// 2. RPC channel (REVIEW P0): register synchronously so the route binds to
	//    THIS fiber (owner.effect); the DB getter resolves later (opened in the
	//    microtask below — a query before then answers db-unavailable).
	registerUsageRpc(ctx, { db: () => db, ingest: runIngest, statusProvider });

	// 3 + 4. DB open, async first scan, then the periodic ingest timer.
	const bootstrapGeneration = ++activationGeneration;
	queueMicrotask(() => {
		void (async () => {
			let openedDb = null;
			try {
				const resolved = resolveDbPath();
				openedDb = await openUsageDb(resolved.path);
				if (!isActive(bootstrapGeneration)) {
					try { openedDb?.close(); } catch { /* best effort */ }
					return;
				}
				// 只在 schema 成功且仍 active 之后才发布 db：否则 ensureSchema 抛错时
				// RPC getter 会拿到未初始化完成的连接，且旧代码会跳过 close → 连接泄漏。
				ensureSchema(openedDb);
				if (!isActive(bootstrapGeneration)) {
					try { openedDb.close(); } catch { /* best effort */ }
					return;
				}
				db = openedDb;
				openedDb = null;
				dbPath = resolved.path;
				dbSource = resolved.source;
				log.info(`db ready at ${resolved.path} (${resolved.source})`);
			} catch (error) {
				try { openedDb?.close(); } catch { /* best effort */ }
				log.warn(`db unavailable: ${error instanceof Error ? error.message : String(error)} — ingest disabled`);
				return;
			}
			if (!isActive(bootstrapGeneration)) return;
			await runIngest();
			if (!isActive(bootstrapGeneration)) return;
			disposeTimer =
				typeof ctx.setInterval === "function"
					? ctx.setInterval(runIngest, INGEST_INTERVAL_MS)
					: ctx.effect(() => {
							const timer = setInterval(() => void runIngest(), INGEST_INTERVAL_MS);
							return () => clearInterval(timer);
						}, "dsh-usage: ingest interval");
			if (!isActive(bootstrapGeneration)) {
				try { disposeTimer?.(); } catch { /* best effort */ }
				disposeTimer = null;
			}
		})().catch((error) => log.warn(`bootstrap failed: ${error instanceof Error ? error.message : String(error)}`));
	});

	// 5. Lifecycle cleanup — registered synchronously so it binds to THIS
	//    fiber; it reads the mutable timer/db references at dispose time.
	ctx.effect(
		() => () => {
			/* dsh-perf-fix R4 v1: 先失效代次再清理，late timer 不会被留下。 */
			disposed = true;
			activationGeneration += 1;
			try {
				disposeTimer?.();
			} catch {
				// best effort
			}
			try {
				db?.close();
			} catch {
				// best effort
			}
			db = null;
		},
		"dsh-usage: lifecycle",
	);
}

export { name, inject, Config };
//#endregion
