#!/usr/bin/env node
/**
 * B2 evidence — the TIMER-SWITCH SHAPE actually written into index.js, exercised
 * against the REAL cordis 4.0.2 + cordis-plugin-timer 1.1.4 from this profile.
 *
 * The switch must stay OFF in production (`INGEST_TIMER_ENABLED = false`), so
 * this probe isolates the two behaviours the patched block has to have:
 *
 *   switch=false → `ctx.inject(["timer"], …)` is NEVER called, no interval is
 *                  installed, and nothing throws;
 *   switch=true  → the install fires after a long synchronous occupation
 *                  (a cold-fold simulation) and the resulting interval keeps
 *                  firing.
 *
 * It also asserts the reason the old code was dead: reading `ctx.setInterval`
 * WITHOUT `"timer"` in the inject list THROWS, which is why the previous
 * `typeof ctx.setInterval === "function"` probe made the `ctx.effect` fallback
 * branch unreachable.
 *
 * Offline + read-only: in-memory cordis composition only. It deliberately does
 * NOT call `apply()` from lib/index.js — that would resolve and open the REAL
 * usage database.
 */

import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const NM = join(HERE, "stage", "node_modules", "@deepseek-ai");
const { Context } = await import(pathToFileURL(join(NM, "cordis", "lib", "index.js")).href);
const TimerService = (await import(pathToFileURL(join(NM, "cordis-plugin-timer", "lib", "index.js")).href)).default;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Reproduce the patched index.js block verbatim (constant + guard + inject + effect). */
function makePatchedPlugin({ enabled, spinMs, intervalMs }) {
	const state = { injectCalls: 0, installed: false, ticks: 0, bootstrapError: null, disposeTimer: null, probeThrew: null };
	return {
		name: `usage-timer-shape-enabled-${enabled}`,
		inject: ["connection", "webServer"],
		apply(ctx) {
			const runIngest = async () => {
				state.ticks += 1;
			};
			let disposed = false;
			let activationGeneration = 0;
			const isActive = (generation) => !disposed && generation === activationGeneration;
			const bootstrapGeneration = ++activationGeneration;
			queueMicrotask(() => {
				void (async () => {
					try {
						await Promise.resolve();
						// the OLD, throwing probe — kept here only to prove it throws
						try {
							void (typeof ctx.setInterval === "function");
						} catch (error) {
							state.probeThrew = error instanceof Error ? error.message : String(error);
						}
						// simulate the synchronous cold fold on the host thread
						const startedAt = Date.now();
						while (Date.now() - startedAt < spinMs) {
							/* spin */
						}
						if (!isActive(bootstrapGeneration)) return;
						// ↓↓↓ the exact shape shipped by apply-Ingest-v1.mjs I8 ↓↓↓
						if (enabled) {
							ctx.inject(["timer"], (timerCtx) => {
								if (!isActive(bootstrapGeneration)) return;
								state.injectCalls += 1;
								state.disposeTimer = timerCtx.setInterval(() => void runIngest(), intervalMs);
								state.hasSetIntervalInInject = typeof timerCtx.setInterval;
								state.installed = true;
								ctx.effect(
									() => () => {
										try {
											state.disposeTimer?.();
										} catch {
											/* best effort */
										}
										state.disposeTimer = null;
									},
									"dsh-usage: ingest interval",
								);
							});
						}
					} catch (error) {
						state.bootstrapError = error instanceof Error ? error.message : String(error);
					}
				})();
			});
			ctx.effect(
				() => () => {
					disposed = true;
					activationGeneration += 1;
					try {
						state.disposeTimer?.();
					} catch {
						/* best effort */
					}
					state.disposeTimer = null;
				},
				"dsh-usage: lifecycle",
			);
		},
		state,
	};
}

async function run({ enabled, spinMs = 1500, intervalMs = 250, observeMs = 2000 }) {
	const app = new Context();
	await app.plugin(TimerService);
	await app.plugin({
		name: "svcs",
		apply(ctx) {
			ctx.provide("connection", {});
			ctx.provide("webServer", {});
		},
	});
	const plugin = makePatchedPlugin({ enabled, spinMs, intervalMs });
	await app.plugin(plugin);
	await sleep(spinMs + observeMs);
	const state = plugin.state;
	return {
		enabled,
		injectCalls: state.injectCalls,
		installed: state.installed,
		hasSetIntervalInInject: state.hasSetIntervalInInject ?? null,
		ticks: state.ticks,
		bootstrapError: state.bootstrapError,
		legacyProbeThrew: state.probeThrew,
	};
}

const disabled = await run({ enabled: false, spinMs: 300, observeMs: 400 });
const enabled = await run({ enabled: true, spinMs: 1500, observeMs: 2000 });

const rows = [
	{
		id: "B2a:switch-OFF-installs-nothing-and-throws-nothing",
		ok: disabled.injectCalls === 0 && disabled.installed === false && disabled.ticks === 0 && disabled.bootstrapError === null,
		detail: JSON.stringify(disabled),
	},
	{
		id: "B2b:switch-ON-installs-after-a-long-synchronous-occupation",
		ok: enabled.injectCalls === 1 && enabled.installed === true && enabled.hasSetIntervalInInject === "function" && enabled.bootstrapError === null,
		detail: JSON.stringify(enabled),
	},
	{
		id: "B2c:switch-ON-interval-actually-fires",
		ok: enabled.ticks > 1,
		detail: `${enabled.ticks} tick(s) of a ${250}ms interval within ~2s after a 1500ms synchronous spin`,
	},
	{
		id: "B2d:the-legacy-typeof-probe-is-what-threw",
		ok: typeof disabled.legacyProbeThrew === "string" && /without inject/.test(disabled.legacyProbeThrew),
		detail: `reading ctx.setInterval with the current inject list threw: ${JSON.stringify(disabled.legacyProbeThrew)}`,
	},
];

let failed = 0;
const lines = [];
for (const row of rows) {
	if (!row.ok) failed += 1;
	lines.push(`${row.ok ? "PASS" : "FAIL"}  ${row.id} — ${row.detail}`);
}
process.stdout.write(`\n### B2 timer-switch shape (real cordis 4.0.2 + cordis-plugin-timer 1.1.4)\n${lines.join("\n")}\nRESULT: ${failed === 0 ? "PASS" : "FAIL"}\n`);
process.exit(failed === 0 ? 0 : 1);
