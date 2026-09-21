// Synthetic fixture builder for the "fold into Worker" equivalence comparison.
// PURELY OFFLINE: writes only under the given synthetic root; never touches
// ~/.dsh/sessions, ~/.claude/projects, or the real usage.db.
//
// Uses the REAL deployed modules for (a) zstd framing (so the fixture frames are
// genuine concatenated zstd frames exactly as the host writes them) and
// (b) sync_state seeding (so the seeded rows have the deployed schema/semantics).
import { mkdirSync, writeFileSync, truncateSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdCompressSync } from "node:zlib";

/** Deployed (real) plugin under test — read-only import, never modified. */
export const DEPLOYED_LIB = join(homedir(), ".dsh", "profiles", "node_modules", "@local", "dsh-usage", "lib");
const { upsertSyncState } = await import(join(DEPLOYED_LIB, "db.js"));

/** Fixed mtime for every fixture file → mtime is identical across baseline/candidate roots. */
export const FIXED_MTIME = Math.floor(Date.UTC(2026, 8, 20, 12, 0, 0) / 1000);

const j = (o) => JSON.stringify(o);

/** Encode lines as ONE independent zstd frame (host writes one frame per batch). */
export const frame = (lines) => zstdCompressSync(Buffer.from(lines.map(j).join("\n") + "\n", "utf8"));

export function writeFixtures(root) {
	const dshRoot = join(root, "dsh");
	const ccRoot = join(root, "cc");
	const cleanRoot = join(root, "clean");
	mkdirSync(cleanRoot, { recursive: true });

	// ---------------------------------------------------------------- dsh A: normal
	// Exercises: multi-frame zstd, request/header switching, chunk-vs-message
	// priority, EXCLUDED_TYPES, missing turn/step, bad JSON line, provider/model
	// attribution by nearest preceding header.
	const aDir = join(dshRoot, "sessions", "sessA");
	mkdirSync(aDir, { recursive: true });
	const aFrames = [
		frame([{ type: "session", id: "sessA", createdAt: 1_700_000_000_000, cwd: "/home/CNS2026495165/dsh" }]),
		frame([
			// header 1
			{ type: "request/header", data: { header: { config: { provider: "alpha", model: "m-1" } } } },
			// message-only (fallback path), gets header 1
			{ type: "assistant/message", time: 1_756_000_000_000, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5 } } },
			// EXCLUDED_TYPES: must be skipped outright even though they carry usage
			{ type: "compaction/summary", time: 1_756_000_000_100, data: { turn: 1, step: 2, usage: { inputTokens: 999, outputTokens: 999 } } },
			{ type: "session/title-llm-request", time: 1_756_000_000_101, data: { turn: 1, step: 3, usage: { inputTokens: 999, outputTokens: 999 } } },
			{ type: "web/deepseek-search-llm-request", time: 1_756_000_000_102, data: { turn: 1, step: 4, usage: { inputTokens: 999, outputTokens: 999 } } },
			// no turn/step → skipped
			{ type: "assistant/message", time: 1_756_000_000_103, data: { usage: { inputTokens: 7, outputTokens: 7 } } },
			// assistant/chunk usage (primary carrier), still header 1
			{ type: "assistant/chunk", time: 1_756_000_000_104, data: { turn: 1, step: 5, chunk: { type: "usage", usage: { inputTokens: 11, outputTokens: 22, cacheReadTokens: 3 } } } },
			// non-usage chunk → ignored
			{ type: "assistant/chunk", time: 1_756_000_000_105, data: { turn: 1, step: 6, chunk: { type: "text", text: "hi" } } },
		]),
		frame([
			"NOT VALID JSON {{{",
			// header 2 (must take over attribution for everything after it)
			{ type: "request/header", data: { header: { config: { provider: "beta", model: "m-2" } } } },
			// header with malformed config → `currentHeader` must stay at header 2
			{ type: "request/header", data: { header: { config: "not-an-object" } } },
			{ type: "assistant/message", time: 1_756_000_100_000, data: { turn: 2, step: 1, usage: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 1 } } },
			{ type: "assistant/chunk", time: 1_756_000_100_000, data: { turn: 2, step: 1, chunk: { type: "usage", usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 30 } } } },
			// header 3 → applies to turn 2 step 2 only
			{ type: "request/header", data: { header: { config: { provider: "gamma", model: "m-3" } } } },
			{ type: "assistant/chunk", time: 1_756_000_200_000, data: { turn: 2, step: 2, chunk: { type: "usage", usage: { inputTokens: 8, outputTokens: 9 } } } },
			// ts absent → `Number.isFinite(undefined)` false → never inserted
			{ type: "assistant/chunk", data: { turn: 3, step: 1, chunk: { type: "usage", usage: { inputTokens: 42, outputTokens: 42 } } } },
			// ts as non-number → same
			{ type: "assistant/chunk", time: "1756000300000", data: { turn: 3, step: 2, chunk: { type: "usage", usage: { inputTokens: 43, outputTokens: 43 } } } },
		]),
	];
	const aPath = join(aDir, "session.jsonl.zstd");
	writeFileSync(aPath, Buffer.concat(aFrames));

	// ---------------------------------------------------------------- dsh B: torn tail
	// A complete frame plus a truncated final frame (writer mid-append).
	const bDir = join(dshRoot, "sessions", "sessB");
	mkdirSync(bDir, { recursive: true });
	const bFull = frame([
		{ type: "session", id: "sessB", cwd: "/home/CNS2026495165/dsh/dsh-usage" },
		{ type: "request/header", data: { header: { config: { provider: "alpha", model: "m-1" } } } },
		{ type: "assistant/chunk", time: 1_756_001_000_000, data: { turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 3, outputTokens: 4 } } } },
	]);
	const bPath = join(bDir, "session.jsonl.zstd");
	const bTorn = frame([
		{ type: "assistant/chunk", time: 1_756_001_100_000, data: { turn: 1, step: 2, chunk: { type: "usage", usage: { inputTokens: 5, outputTokens: 6 } } } },
	]);
	writeFileSync(bPath, Buffer.concat([bFull, bTorn]));
	truncateSync(bPath, bFull.length + Math.max(1, Math.floor(bTorn.length / 2)));

	// ---------------------------------------------------------------- dsh C: corrupt structure
	// Bad frame magic → `parseDshSession` throws → failedFiles + fingerprint, no scan.
	const cDir = join(dshRoot, "sessions", "sessC");
	mkdirSync(cDir, { recursive: true });
	writeFileSync(join(cDir, "session.jsonl.zstd"), Buffer.from("this-is-not-a-zstd-frame-at-all", "utf8"));

	// ---------------------------------------------------------------- cc
	mkdirSync(join(ccRoot, "-home-CNS2026495165-dsh"), { recursive: true });
	const ccMain = join(ccRoot, "-home-CNS2026495165-dsh", "ccsess1.jsonl");
	const ccMainLines = [
		j({ type: "assistant", sessionId: "ccsess1", timestamp: "2026-09-18T10:00:00.000Z", cwd: "/home/CNS2026495165/dsh",
			uuid: "u1", message: { id: "msg-1", model: "claude-sonnet-4", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 10 } } }),
		j({ type: "assistant", sessionId: "ccsess1", timestamp: "2026-09-18T10:00:10.000Z", cwd: "/home/CNS2026495165/dsh",
			uuid: "u2", message: { id: "msg-2", model: "claude-sonnet-4", usage: { input_tokens: 50, output_tokens: 5 } } }),
		"BROKEN JSON LINE",
		j({ type: "assistant", sessionId: "ccsess1", timestamp: "2026-09-18T10:00:20.000Z", cwd: "/home/CNS2026495165/dsh",
			uuid: "u3", message: { id: "msg-3", model: "claude-sonnet-4", usage: { input_tokens: 7, output_tokens: 8, cache_read_input_tokens: 100, cache_creation_input_tokens: 100 } } }),
		j({ type: "user", sessionId: "ccsess1", timestamp: "2026-09-18T10:00:30.000Z", message: { role: "user" } }),
	];
	writeFileSync(ccMain, ccMainLines.join("\n") + "\n");
	const ccMainBytes = Buffer.byteLength(ccMainLines.join("\n") + "\n");

	// subagent file (same sessionId + colliding dedup key msg-1 with DIFFERENT values).
	// Cross-file readdir order must not be able to change the outcome: with
	// "latest observation wins" (WHERE excluded.ts >= old.ts) the msg-1 rows carry
	// ts 10:00:00 vs 10:05:00, so the subagent row wins at ANY visit order.
	mkdirSync(join(ccRoot, "-home-CNS2026495165-dsh", "subagents"), { recursive: true });
	const ccSub = join(ccRoot, "-home-CNS2026495165-dsh", "subagents", "agent-x.jsonl");
	const ccSubLine = j({ type: "assistant", sessionId: "ccsess1", timestamp: "2026-09-18T10:05:00.000Z", cwd: "/home/CNS2026495165/dsh",
		uuid: "u9", message: { id: "msg-1", model: "claude-sonnet-4", usage: { input_tokens: 11, output_tokens: 12 } } });
	writeFileSync(ccSub, ccSubLine + "\n");

	// deterministic mtimes on every fixture file
	for (const p of [aPath, bPath, join(cDir, "session.jsonl.zstd"), ccMain, ccSub]) {
		utimesSync(p, FIXED_MTIME, FIXED_MTIME);
	}

	return {
		root, dshRoot, ccRoot, cleanRoot,
		aPath, bPath, cPath: join(cDir, "session.jsonl.zstd"), ccMain, ccSub,
		ccMainBytes, aFrames, bFull,
	};
}

/**
 * Seed `sync_state` exactly as a PREVIOUS completed pass would have left it, so
 * that this pass must take the incremental path under test. Values are written
 * through the DEPLOYED `upsertSyncState` (real schema/semantics).
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {ReturnType<typeof writeFixtures>} f
 */
export function seedSyncState(db, f) {
	// dsh B: the previous pass consumed exactly the first (complete) frame.
	upsertSyncState(db, {
		source: `dsh:${f.bPath}`,
		mtime: FIXED_MTIME,
		size: f.bFull.length, // stale size → mtime/size gate MISSES → fold re-reads the file
		fingerprint: null,
		last_offset: f.bFull.length,
	});
	// cc main: the previous pass consumed every complete line (full file).
	upsertSyncState(db, {
		source: `cc:${f.ccMain}`,
		mtime: FIXED_MTIME,
		size: f.ccMainBytes, // stale size → gate misses → offset path is exercised
		fingerprint: null,
		last_offset: f.ccMainBytes,
	});
	// cc subagent: a bogus cursor LARGER than the real file → `size >= last_offset`
	// is false → offset must reset to 0 (full rescan).
	upsertSyncState(db, {
		source: `cc:${f.ccSub}`,
		mtime: 1, // stale mtime → gate misses
		size: 1,
		fingerprint: null,
		last_offset: 10_000_000,
	});
}
