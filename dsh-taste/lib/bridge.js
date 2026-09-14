import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
//#region lib/bridge.js
/**
 * Web GUI bridge (gui-design.md §2; gui-mutation-design §1): exposes the taste
 * library and the learning/injection/routing status to the browser panel over
 * the `connection` service's generic RPC channel —
 * `ctx.connection.rpc.handle("/taste", handler, { authority: "loopback" })`.
 * (B 裁定, §0: zero schema, zero generator; the `loopback` authority empties
 * `trustedHosts` so `isTrustedApiRequest` fences every non-loopback origin.)
 *
 * Security envelope (§2.5; audit §5/ISSUE-1/ISSUE-4; gui-mutation-design §1.6):
 * read plus curated mutations, all through the plugin's existing storage/config
 * seams — this module introduces no write primitive of its own.
 * - No path passthrough: `getTree` accepts only an optional `cwd` string fed
 *   to `projectDirForCwd`; every read goes through the storage whitelist
 *   (`listTasteFiles`/`readTasteFile` → `resolveTastePath`). `deleteEntry`
 *   takes a `relPath` that must clear `isValidTasteFilePath` first and is
 *   still resolved by the authoritative `resolveTastePath` gate; its
 *   `statement` is only ever a normalizePreferenceKey lookup target, never a
 *   path; and the read-only Command Code source is refused outright.
 * - No raw bytes: only `parseTasteFile`'s `{statement, confidence}` entries
 *   plus each entry's Chinese `display` value joined from the read-only
 *   never file text, never `renderTasteFile` output.
 * - Confidence gate: `getTree` filters entries below
 *   `injection.minConfidence` — the injection snapshot's own gate, so the
 *   GUI shows exactly the effective (injected) set — and reports the filtered
 *   total as top-level `gatedCount`; a read-side filter that introduces no
 *   write primitive.
 * - Curated write surface: `deleteEntry` removes entries through the shared
 *   `deleteTasteEntries` core (forget's exact semantics); `setObserver`
 *   writes ONLY the whitelisted `{modelMode, provider, model}` triple onto a
 *   full load→modify→save cycle that preserves every other config section.
 *   `getSettings` deliberately echoes the observer routing triple
 *   (modelMode/provider/model) plus the three budgets — the settings form
 *   needs them back (gui-mutation-design §1.6/§1.7 issue #7); `getStatus`
 *   keeps its minimal modelMode-only echo. Neither echoes any secret, API
 *   key env or file path; the settings.yaml registry read surfaces only
 *   `models[].id` strings.
 * - Fresh reads: `getStatus`/`getSettings` hot-read `config.json` via async
 *   `loadConfig` (audit ISSUE-4); the model registry is re-read per call too.
 *
 * Handler shape: `(endpoint, payload, signal) => { ok, value } |
 * { ok, error }` — the envelope dsh-client-connection's `fullResponse` wraps
 * into the wire response. The handler never throws into the HTTP layer.
 * @module dsh-taste/bridge
 */

const ENDPOINTS = new Set(["getTree", "getStatus", "deleteEntry", "getSettings", "setObserver"]);

/** Endpoint-level validation failure carrying a stable wire error code. */
class TasteBridgeError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/** Flatten any thrown value into one message line. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Register the `/taste` RPC channel on the plugin context (read endpoints plus
 * the two curated mutations; gui-mutation-design §1).
 * @param {object} ctx - plugin context; `ctx.connection.rpc.handle` must
 *   exist (`connection` is in the plugin's inject list) and `ctx.effect`
 *   binds the channel disposer to this plugin's lifetime.
 * @param {object} deps - storage/config/queue seams injected by index.js,
 *   all whitelist functions in the plugin's own shapes:
 *   `{ queue, globalDir, projectDirForCwd, loadConfig, listTasteFiles,
 *   normalizePreferenceKey, isValidTasteFilePath, deleteTasteEntries,
 *   gateTasteEntries, saveConfig, settingsPath, readProviderModels, logger }`.
 */
export function registerTasteBridge(ctx, deps) {
	const {
		queue,
		globalDir,
		projectDirForCwd,
		loadConfig,
		listTasteFiles,
		readTasteFile,
		parseTasteFile,
		loadCommandCodeTaste,
		gateTasteEntries,
		normalizePreferenceKey,
		isValidTasteFilePath,
		deleteTasteEntries,
		saveConfig,
		settingsPath,
		readProviderModels,
		logger,
	} = deps;

	const handle = async (endpoint, payload, signal) => {
		if (!ENDPOINTS.has(endpoint)) {
			return { ok: false, error: { code: "unknown-endpoint", message: `taste: unknown endpoint "${endpoint}"` } };
		}
		try {
			if (endpoint === "getTree") return { ok: true, value: await getTree(payload ?? {}) };
			if (endpoint === "getStatus") return { ok: true, value: await getStatus() };
			if (endpoint === "deleteEntry") return { ok: true, value: await deleteEntry(payload ?? {}) };
			if (endpoint === "getSettings") return { ok: true, value: await getSettings() };
			if (endpoint === "setObserver") return { ok: true, value: await setObserver(payload ?? {}) };
		} catch (error) {
			// instanceof, not error.code: fs errors carry their own `.code`
			// (ENOENT…) and a bare read would leak them as endpoint codes.
			if (error instanceof TasteBridgeError) {
				return { ok: false, error: { code: error.code, message: error.message } };
			}
			return { ok: false, error: { code: "internal", message: describeError(error) } };
		}
	};

	// ---- Read-only data assembly (whitelist functions only) ----

	/** One scope's files with the confidence gate applied; `gated` counts the filtered entries. */
	async function scopeFiles(dir, minConfidence) {
		const files = [];
		let gated = 0;
		for (const relPath of await listTasteFiles(dir)) {
			let content;
			try { content = await readTasteFile(dir, relPath); } catch { continue; }
			const parsed = parseTasteFile(content);
			const entries = gateTasteEntries(parsed, minConfidence).map(({ statement, confidence }) => ({ statement, confidence }));
			gated += parsed.length - entries.length; // Unreadable files above stay best-effort and uncounted.
			let mtime = 0;
			try { mtime = statSync(join(dir, relPath)).mtimeMs; } catch {}
			files.push({ relPath, mtime, count: entries.length, entries });
		}
		return { files, gated };
	}

	/** Preference tree across the three sources; the only input is `cwd`. */
	async function getTree({ cwd }) {
		const global = globalDir();
		const project = typeof cwd === "string" && cwd.length > 0 ? projectDirForCwd(cwd) : void 0;
		// Same confidence gate as the injection snapshot (injection.minConfidence,
		// hot-read): the GUI is the effective view, so entries below the threshold
		// are filtered here and surface only through the gatedCount hint.
		const cfg = await loadConfig(global);
		const minConfidence = cfg.injection.minConfidence;
		const globalHome = resolve(global, "..", ".."); // loadTasteSnapshot's Command Code base algorithm (storage.js).
		const projectRoot = project ? resolve(project, "..", "..") : void 0;
		const ccParsed = await loadCommandCodeTaste(globalHome, projectRoot);
		const commandCodeEntries = gateTasteEntries(ccParsed, minConfidence).map(({ statement, confidence }) => ({ statement, confidence }));
		const globalScope = await scopeFiles(global, minConfidence);
		const projectScope = project ? await scopeFiles(project, minConfidence) : { files: [], gated: 0 };
		return {
			generatedAt: Date.now(),
			gatedCount: projectScope.gated + globalScope.gated + (ccParsed.length - commandCodeEntries.length),
			scopes: [
				// ISSUE-1 fix (b): `present` reflects the directory's real existence,
				// so "cwd given but the project scope does not exist yet" reads false.
				{
					name: "project",
					dir: project ?? null,
					present: project !== void 0 && existsSync(project),
					files: projectScope.files,
				},
				{
					name: "global",
					dir: global,
					present: existsSync(global),
					files: globalScope.files,
				},
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
				minConfidence: cfg.injection.minConfidence, // confidence-gate threshold for the GUI chip/hints
			},
			modelMode: cfg.observer.modelMode, // "inherit" | "custom" (no provider/model names echoed back).
			queue: q,
			breakerCooling: q.cooldownUntil > Date.now(),
		};
	}

	/**
	 * GUI delete (gui-mutation-design §1.3): remove every entry of one file
	 * whose normalizePreferenceKey matches the statement's — the shared
	 * forget/`deleteTasteEntries` core performs the locked read-modify-write.
	 * Validation maps every rejection onto a stable wire code; the
	 * read-only Command Code source is refused here regardless of what the UI
	 * renders (backend-side half of the double insurance).
	 */
	async function deleteEntry({ scope, relPath, statement, cwd }) {
		if (scope === "commandCode") {
			throw new TasteBridgeError("read-only-source", "taste: the Command Code source is read-only; deletion is refused");
		}
		if (scope !== "global" && scope !== "project") {
			throw new TasteBridgeError("invalid-payload", 'taste: scope must be "global" or "project"');
		}
		if (typeof relPath !== "string" || !isValidTasteFilePath(relPath)) {
			throw new TasteBridgeError("invalid-payload", `taste: relPath ${JSON.stringify(String(relPath ?? ""))} refused; expected "taste.md" or "{category}/taste.md"`);
		}
		if (typeof statement !== "string" || !statement.trim()) {
			throw new TasteBridgeError("invalid-payload", "taste: statement must be a non-empty string");
		}
		const scopeDir = scope === "global" ? globalDir() : projectDirForCwd(cwd);
		if (scopeDir === undefined) {
			throw new TasteBridgeError("invalid-payload", 'taste: deleting from the project scope requires a "cwd" string');
		}
		if (!existsSync(scopeDir)) {
			// Pre-lock existence check: withTasteLock creates its lock file with
			// `wx`, so a missing scope directory would surface as a raw ENOENT
			// ("internal") instead of the honest not-found. A race where the
			// directory vanishes after this check still lands in internal —
			// acceptable, same envelope as the existing hostile fallback.
			throw new TasteBridgeError("not-found", `taste: ${scope} scope directory does not exist`);
		}
		const key = normalizePreferenceKey(statement);
		if (!key) {
			throw new TasteBridgeError("invalid-payload", "taste: statement normalizes to an empty key");
		}
		const removed = await deleteTasteEntries([{ scopeDir, relPath, keys: [key] }], (message) => logger?.warn?.(message));
		if (removed === 0) {
			throw new TasteBridgeError("not-found", `taste: no entry in ${scope} ${JSON.stringify(relPath)} matches the statement key`);
		}
		return { removed };
	}

	/**
	 * Settings read-back for the model-settings form (gui-mutation-design
	 * §1.4): the hot-read observer section plus the settings.yaml model
	 * registry, re-read on every call so registry updates follow without a
	 * host restart. Any registry read failure yields `{}` (GUI free-input
	 * fallback); config read failures keep loadConfig's own defaults.
	 */
	async function getSettings() {
		const config = await loadConfig(globalDir()); // Hot read (same as getStatus).
		const modelsByProvider = await readProviderModels(settingsPath);
		return { observer: config.observer, modelsByProvider };
	}

	/**
	 * Observer model-route write (gui-mutation-design §1.5): a fixed
	 * three-field whitelist — modelMode enum plus REQUIRED provider/model
	 * strings (omitted fields are refused, never filled from the current
	 * value) — applied over a full load→modify→save cycle so budgets,
	 * injection, storage and learningEnabled survive untouched. The tracked
	 * saveConfig seam keeps the sync config cache coherent.
	 */
	async function setObserver({ modelMode, provider, model } = {}) {
		if (modelMode !== "inherit" && modelMode !== "custom") {
			throw new TasteBridgeError("invalid-payload", 'taste: modelMode must be "inherit" or "custom"');
		}
		if (typeof provider !== "string" || typeof model !== "string") {
			throw new TasteBridgeError("invalid-payload", "taste: provider and model must be strings");
		}
		const providerText = provider.trim();
		const modelText = model.trim();
		if (modelMode === "custom" && (!providerText || !modelText)) {
			throw new TasteBridgeError("invalid-payload", 'taste: modelMode "custom" needs both provider and model');
		}
		const dir = globalDir();
		const config = await loadConfig(dir); // Whole config: every other section rides along.
		config.observer = { ...config.observer, modelMode, provider: providerText, model: modelText };
		await saveConfig(dir, config);
		return { observer: config.observer };
	}

	const dispose = ctx.connection.rpc.handle("/taste", handle, { authority: "loopback" });
	// ISSUE-5: `rpc.handle` already binds the route to the connection service's
	// ctx; the second bind below is idempotent for teardown and keeps the
	// channel tied to this plugin's lifetime (and test-assertable).
	ctx.effect(() => dispose, "taste.rpc.channel");
}
//#endregion
