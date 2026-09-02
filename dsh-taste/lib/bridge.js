import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
//#region lib/bridge.js
/**
 * Read-only Web GUI bridge (gui-design.md §2): exposes the taste library and
 * the learning/injection/routing status to the browser panel over the
 * `connection` service's generic RPC channel —
 * `ctx.connection.rpc.handle("/taste", handler, { authority: "loopback" })`.
 * (B 裁定, §0: zero schema, zero generator; the `loopback` authority empties
 * `trustedHosts` so `isTrustedApiRequest` fences every non-loopback origin.)
 *
 * Security envelope (§2.5; audit §5/ISSUE-1/ISSUE-4):
 * - No path passthrough: `getTree` accepts only an optional `cwd` string fed
 *   to `projectDirForCwd`; every read goes through the storage whitelist
 *   (`listTasteFiles`/`readTasteFile` → `resolveTastePath`). There is no
 *   `file`/`dir`/`relPath`/`path` parameter anywhere.
 * - No raw bytes: only `parseTasteFile`'s `{statement, confidence}` entries
 *   plus per-file `mtime`/`count` metadata are returned — never file text,
 *   never `renderTasteFile` output.
 * - No write surface: `saveConfig`/`writeFileAtomicTaste`/`withTasteLock`
 *   never enter this module; forget/remember stay on the `/taste` command.
 * - `getStatus` hot-reads `config.json` via async `loadConfig` (audit
 *   ISSUE-4): always as fresh as `/taste status`, no first-read staleness.
 *
 * Handler shape: `(endpoint, payload, signal) => { ok, value } |
 * { ok, error }` — the envelope dsh-client-connection's `fullResponse` wraps
 * into the wire response. The handler never throws into the HTTP layer.
 * @module dsh-taste/bridge
 */

const ENDPOINTS = new Set(["getTree", "getStatus"]);

/** Flatten any thrown value into one message line. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Register the read-only `/taste` RPC channel on the plugin context.
 * @param {object} ctx - plugin context; `ctx.connection.rpc.handle` must
 *   exist (`connection` is in the plugin's inject list) and `ctx.effect`
 *   binds the channel disposer to this plugin's lifetime.
 * @param {object} deps - storage/config/queue seams injected by index.js,
 *   all whitelist functions in the plugin's own shapes:
 *   `{ queue, globalDir, projectDirForCwd, loadConfig, listTasteFiles,
 *   readTasteFile, parseTasteFile, loadCommandCodeTaste }`.
 */
export function registerTasteBridge(ctx, deps) {
	const { queue, globalDir, projectDirForCwd, loadConfig, listTasteFiles, readTasteFile, parseTasteFile, loadCommandCodeTaste } = deps;

	const handle = async (endpoint, payload, signal) => {
		if (!ENDPOINTS.has(endpoint)) {
			return { ok: false, error: { code: "unknown-endpoint", message: `taste: unknown endpoint "${endpoint}"` } };
		}
		try {
			if (endpoint === "getTree") return { ok: true, value: await getTree(payload ?? {}) };
			if (endpoint === "getStatus") return { ok: true, value: await getStatus() };
		} catch (error) {
			return { ok: false, error: { code: "internal", message: describeError(error) } };
		}
	};

	// ---- Read-only data assembly (whitelist functions only) ----

	/** One scope directory's whitelisted files with parsed entries and mtime. */
	async function scopeFiles(dir) {
		const files = [];
		for (const relPath of await listTasteFiles(dir)) {
			let content;
			try {
				content = await readTasteFile(dir, relPath);
			} catch {
				continue; // A single unreadable file must not fail the whole tree.
			}
			const entries = parseTasteFile(content);
			let mtime = 0;
			try {
				mtime = statSync(join(dir, relPath)).mtimeMs;
			} catch {}
			files.push({ relPath, mtime, count: entries.length, entries });
		}
		return files;
	}

	/** Preference tree across the three sources; the only input is `cwd`. */
	async function getTree({ cwd }) {
		const global = globalDir();
		const project = typeof cwd === "string" && cwd.length > 0 ? projectDirForCwd(cwd) : void 0;
		const globalHome = resolve(global, "..", ".."); // loadTasteSnapshot's Command Code base algorithm (storage.js).
		const projectRoot = project ? resolve(project, "..", "..") : void 0;
		const commandCodeEntries = await loadCommandCodeTaste(globalHome, projectRoot);
		return {
			generatedAt: Date.now(),
			scopes: [
				// ISSUE-1 fix (b): `present` reflects the directory's real existence,
				// so "cwd given but the project scope does not exist yet" reads false.
				{
					name: "project",
					dir: project ?? null,
					present: project !== void 0 && existsSync(project),
					files: project ? await scopeFiles(project) : [],
				},
				{ name: "global", dir: global, present: true, files: await scopeFiles(global) },
				{
					name: "commandCode",
					dir: null,
					present: true,
					files: [
						{
							relPath: "(command-code)",
							mtime: 0,
							count: commandCodeEntries.length,
							entries: commandCodeEntries,
						},
					],
				},
			],
		};
	}

	/** Learning/injection/queue/breaker status, always fresh (await loadConfig). */
	async function getStatus() {
		const cfg = await loadConfig(globalDir());
		const q = queue.stats(); // { pending, failCount, cooldownUntil, running }
		return {
			learning: cfg.learningEnabled,
			injection: {
				enabled: cfg.injection.enabled,
				maxChars: cfg.injection.maxChars,
				includeSubagents: cfg.injection.includeSubagents,
			},
			modelMode: cfg.observer.modelMode, // "inherit" | "custom" (no provider/model names echoed back).
			queue: q,
			breakerCooling: q.cooldownUntil > Date.now(),
		};
	}

	const dispose = ctx.connection.rpc.handle("/taste", handle, { authority: "loopback" });
	// ISSUE-5: `rpc.handle` already binds the route to the connection service's
	// ctx; the second bind below is idempotent for teardown and keeps the
	// channel tied to this plugin's lifetime (and test-assertable).
	ctx.effect(() => dispose, "taste.rpc.channel");
}
//#endregion
