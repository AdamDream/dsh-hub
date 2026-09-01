import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";

/**
 * Taste plugin configuration: frozen defaults, whitelisted merge with
 * bounded-number clamping, and atomic persistence at `<dir>/config.json`.
 * Unknown keys are dropped and unusable numbers fall back to the defaults,
 * so a hand-edited config can never poison the learner.
 * @module lib/config
 */
const CONFIG_FILENAME = "config.json";

/** Clamping windows for tunable numbers (proposal §8; min/max mirror pi-taste). */
const BOUNDS = Object.freeze({
	injectionMaxChars: Object.freeze({ min: 1_000, max: 100_000 }),
	observerMaxInputChars: Object.freeze({ min: 4_000, max: 100_000 }),
	observerTimeoutMs: Object.freeze({ min: 5_000, max: 180_000 }),
	observerMaxTurns: Object.freeze({ min: 1, max: 40 }),
});

/** Frozen `§8` defaults; shared references can never drift. */
export const DEFAULT_CONFIG = Object.freeze({
	learningEnabled: true,
	injection: Object.freeze({ enabled: true, maxChars: 16_000, includeSubagents: false }),
	observer: Object.freeze({
		modelMode: "inherit",
		provider: "",
		model: "",
		maxInputChars: 16_000,
		timeoutMs: 120_000,
		maxTurns: 20,
	}),
	storage: Object.freeze({ categoriesEnabled: true }),
});

/** Whether a value is a plain record (arrays and null are not records). */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanOr(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}

function stringOr(value, fallback) {
	return typeof value === "string" ? value : fallback;
}

/**
 * Coerce one untrusted number into its window: non-numbers, non-finite values
 * (NaN included) and negatives fall back to the default; usable values are
 * clamped into `[min, max]` and rounded.
 * @param value - candidate from untrusted JSON.
 * @param bounds - `{ min, max }` clamping window.
 * @param fallback - default taken when the value is unusable.
 * @returns the coerced number.
 */
function boundedNumber(value, bounds, fallback) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
	return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
}

/** Whitelist merge of one untrusted config value over the defaults. */
function mergeConfig(value) {
	const input = isRecord(value) ? value : {};
	const injection = isRecord(input.injection) ? input.injection : {};
	const observer = isRecord(input.observer) ? input.observer : {};
	const storage = isRecord(input.storage) ? input.storage : {};
	return {
		learningEnabled: booleanOr(input.learningEnabled, DEFAULT_CONFIG.learningEnabled),
		injection: {
			enabled: booleanOr(injection.enabled, DEFAULT_CONFIG.injection.enabled),
			maxChars: boundedNumber(injection.maxChars, BOUNDS.injectionMaxChars, DEFAULT_CONFIG.injection.maxChars),
			includeSubagents: booleanOr(injection.includeSubagents, DEFAULT_CONFIG.injection.includeSubagents),
		},
		observer: {
			// M0 ships inherit-only routing (§10.5): any configured modelMode is
			// normalized away until custom routing lands in P1.
			modelMode: DEFAULT_CONFIG.observer.modelMode,
			provider: stringOr(observer.provider, DEFAULT_CONFIG.observer.provider),
			model: stringOr(observer.model, DEFAULT_CONFIG.observer.model),
			maxInputChars: boundedNumber(observer.maxInputChars, BOUNDS.observerMaxInputChars, DEFAULT_CONFIG.observer.maxInputChars),
			timeoutMs: boundedNumber(observer.timeoutMs, BOUNDS.observerTimeoutMs, DEFAULT_CONFIG.observer.timeoutMs),
			maxTurns: boundedNumber(observer.maxTurns, BOUNDS.observerMaxTurns, DEFAULT_CONFIG.observer.maxTurns),
		},
		storage: {
			categoriesEnabled: booleanOr(storage.categoriesEnabled, DEFAULT_CONFIG.storage.categoriesEnabled),
		},
	};
}

function configPath(dir) {
	return join(dir, CONFIG_FILENAME);
}

/**
 * Load `<dir>/config.json` whitelist-merged over the defaults. A missing or
 * corrupt file (or an unreadable path) yields a fresh copy of the defaults;
 * the result is a plain mutable object, never the frozen default itself.
 * @param dir - taste home directory holding `config.json`.
 * @returns the effective configuration.
 */
export async function loadConfig(dir) {
	try {
		return mergeConfig(JSON.parse(await readFile(configPath(dir), "utf8")));
	} catch {
		return mergeConfig(DEFAULT_CONFIG);
	}
}

/**
 * Normalize `config` through the whitelist and atomically persist it at
 * `<dir>/config.json` (parent directories are created; mode 0600).
 * @param dir - taste home directory holding `config.json`.
 * @param config - configuration to normalize and persist.
 * @returns resolves once the file has been replaced.
 */
export async function saveConfig(dir, config) {
	await writeFileAtomic(configPath(dir), `${JSON.stringify(mergeConfig(config), null, 2)}\n`, { mode: 0o600, dirMode: 0o700 });
}
