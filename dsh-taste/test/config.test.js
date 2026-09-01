import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../lib/config.js";

const EXPECTED_DEFAULT = {
	learningEnabled: true,
	injection: { enabled: true, maxChars: 16_000, includeSubagents: false },
	observer: { modelMode: "inherit", provider: "", model: "", maxInputChars: 16_000, timeoutMs: 120_000, maxTurns: 20 },
	storage: { categoriesEnabled: true },
};

async function tempDir() {
	return mkdtemp(join(tmpdir(), "dsh-taste-config-"));
}

async function writeRawConfig(dir, payload) {
	await writeFile(join(dir, "config.json"), payload, "utf8");
}

test("DEFAULT_CONFIG matches the §8 shape and is deeply frozen", () => {
	assert.deepEqual(DEFAULT_CONFIG, EXPECTED_DEFAULT);
	assert.equal(Object.isFrozen(DEFAULT_CONFIG), true);
	assert.equal(Object.isFrozen(DEFAULT_CONFIG.injection), true);
	assert.equal(Object.isFrozen(DEFAULT_CONFIG.observer), true);
	assert.equal(Object.isFrozen(DEFAULT_CONFIG.storage), true);
});

test("loadConfig returns a fresh mutable defaults copy when the file is missing", async () => {
	const dir = await tempDir();
	const first = await loadConfig(dir);
	const second = await loadConfig(dir);
	assert.deepEqual(first, EXPECTED_DEFAULT);
	assert.deepEqual(second, EXPECTED_DEFAULT);
	assert.notEqual(first, second);
	assert.notEqual(first.injection, second.injection);
	first.learningEnabled = false;
	assert.equal(DEFAULT_CONFIG.learningEnabled, true, "the frozen default must not be mutated");
});

test("loadConfig tolerates corrupt JSON and non-object payloads", async () => {
	for (const payload of ["{not json", "", "null", "42", "\"a string\"", "[1, 2, 3]"]) {
		const dir = await tempDir();
		await writeRawConfig(dir, payload);
		assert.deepEqual(await loadConfig(dir), EXPECTED_DEFAULT, `payload: ${JSON.stringify(payload)}`);
	}
});

test("loadConfig merges whitelisted keys and drops unknown ones", async () => {
	const dir = await tempDir();
	await writeRawConfig(dir, JSON.stringify({
		learningEnabled: false,
		unknownTopLevel: "dropped",
		injection: { enabled: true, maxChars: 5000, bogusField: 1 },
		observer: { modelMode: "custom", provider: "deepseek", model: "m", maxInputChars: 20000, timeoutMs: 60000, maxTurns: 5, extra: true },
		storage: { categoriesEnabled: false },
	}));
	assert.deepEqual(await loadConfig(dir), {
		learningEnabled: false,
		injection: { enabled: true, maxChars: 5000, includeSubagents: false },
		observer: { modelMode: "inherit", provider: "deepseek", model: "m", maxInputChars: 20000, timeoutMs: 60000, maxTurns: 5 },
		storage: { categoriesEnabled: false },
	});
});

test("loadConfig keeps defaults for partial configs and non-record sections", async () => {
	const dir = await tempDir();
	await writeRawConfig(dir, JSON.stringify({ injection: { maxChars: 8000 }, observer: "garbage", storage: null }));
	assert.deepEqual(await loadConfig(dir), {
		learningEnabled: true,
		injection: { enabled: true, maxChars: 8000, includeSubagents: false },
		observer: EXPECTED_DEFAULT.observer,
		storage: EXPECTED_DEFAULT.storage,
	});
});

test("loadConfig clamps numbers into their windows and falls back on invalid ones", async () => {
	const dir = await tempDir();
	await writeRawConfig(dir, JSON.stringify({
		injection: { maxChars: 100, includeSubagents: "yes" },
		observer: {
			maxInputChars: 5000.6,
			timeoutMs: -5,
			maxTurns: 0,
			modelMode: "nonsense",
			provider: 42,
		},
	}));
	const config = await loadConfig(dir);
	assert.equal(config.injection.maxChars, 1_000, "below min clamps up to min");
	assert.equal(config.injection.includeSubagents, false, "non-boolean falls back");
	assert.equal(config.observer.maxInputChars, 5_001, "in-window floats are rounded");
	assert.equal(config.observer.timeoutMs, 120_000, "negative falls back to default");
	assert.equal(config.observer.maxTurns, 1, "zero clamps to min");
	assert.equal(config.observer.modelMode, "inherit", "unknown enum falls back");
	assert.equal(config.observer.provider, "", "non-string falls back");

	const high = await tempDir();
	await writeRawConfig(high, JSON.stringify({
		injection: { maxChars: 999_999 },
		observer: { maxInputChars: NaN, timeoutMs: 999_999, maxTurns: 1.2 },
	}));
	const highConfig = await loadConfig(high);
	assert.equal(highConfig.injection.maxChars, 100_000, "above max clamps down to max");
	assert.equal(highConfig.observer.timeoutMs, 180_000, "above max clamps down to max");
	assert.equal(highConfig.observer.maxTurns, 1, "floats round after clamping");
});

test("saveConfig creates parent directories and round-trips through loadConfig", async () => {
	const dir = join(await tempDir(), "nested", "taste");
	await saveConfig(dir, { learningEnabled: false, injection: { maxChars: 8000 } });
	const loaded = await loadConfig(dir);
	assert.equal(loaded.learningEnabled, false);
	assert.equal(loaded.injection.maxChars, 8000);
	const raw = await readFile(join(dir, "config.json"), "utf8");
	assert.match(raw, /\n$/, "file ends with a trailing newline");
	assert.match(raw, /"learningEnabled": false/, "file is pretty-printed JSON");
});

test("saveConfig persists only whitelisted, normalized fields and accepts the frozen default", async () => {
	const dir = await tempDir();
	await saveConfig(dir, DEFAULT_CONFIG);
	assert.deepEqual(JSON.parse(await readFile(join(dir, "config.json"), "utf8")), EXPECTED_DEFAULT);

	const dirty = await tempDir();
	await saveConfig(dirty, { learningEnabled: false, unknown: 1, injection: { maxChars: 2 }, observer: { modelMode: "weird" } });
	assert.deepEqual(JSON.parse(await readFile(join(dirty, "config.json"), "utf8")), {
		learningEnabled: false,
		injection: { enabled: true, maxChars: 1_000, includeSubagents: false },
		observer: EXPECTED_DEFAULT.observer,
		storage: EXPECTED_DEFAULT.storage,
	});
});
