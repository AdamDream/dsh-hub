import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import * as storage from "../lib/storage.js";
import {
	clipText,
	ensureProjectTasteDir,
	isValidTasteFilePath,
	listTasteFiles,
	loadCommandCodeTaste,
	loadTasteSnapshot,
	normalizePreferenceKey,
	parseTasteFile,
	projectRootFor,
	readTasteFile,
	redactSensitive,
	renderTasteFile,
	resolveTastePath,
	reorganizeIfNeeded,
	withTasteLock,
	writeFileAtomicTaste,
} from "../lib/storage.js";

/** Bullet lines with a Confidence marker, the parseable taste entry shape. */
const bullet = (statement, confidence) => `- ${statement} Confidence: ${confidence}`;
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Fresh isolated case root under the OS temp dir, removed on cleanup. */
async function makeCase(label) {
	const root = await mkdtemp(join(tmpdir(), `dsh-taste-storage-${label}-`));
	return {
		root,
		path: (...parts) => join(root, ...parts),
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

/** Seed a file (creating parent directories) outside of the unit under test. */
async function seed(file, content) {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	await writeFile(file, content, { mode: 0o600 });
	return file;
}

/** Map of relative file path -> content for everything under `dir`. */
async function snapshotTree(dir) {
	const files = {};
	async function walk(current, prefix) {
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(join(current, entry.name), rel);
			else files[rel] = await readFile(join(current, entry.name), "utf8");
		}
	}
	await walk(dir, "");
	return files;
}

/** Six workflow bullets — one past the reorganize threshold of five. */
const sixWorkflowBullets = () =>
	[
		["one", "0.9"],
		["two", "0.8"],
		["three", "0.7"],
		["four", "0.6"],
		["five", "0.5"],
		["six", "0.4"],
	]
		.map(([word, confidence]) => bullet(`Workflow entry ${word} needs recording.`, confidence))
		.join("\n");

describe("storage contract surface", () => {
	test("exports every contract function", () => {
		for (const name of [
			"parseTasteFile",
			"renderTasteFile",
			"isValidTasteFilePath",
			"resolveTastePath",
			"readTasteFile",
			"listTasteFiles",
			"writeFileAtomicTaste",
			"withTasteLock",
			"redactSensitive",
			"clipText",
			"normalizePreferenceKey",
			"projectRootFor",
			"ensureProjectTasteDir",
			"reorganizeIfNeeded",
			"loadCommandCodeTaste",
			"loadTasteSnapshot",
		]) {
			assert.equal(typeof storage[name], "function", `export ${name}`);
		}
	});
});

describe("parseTasteFile / renderTasteFile", () => {
	test("roundtrips entries including a Chinese full stop statement", () => {
		const text = [
			"# Notes",
			"",
			"- Prefers pnpm over npm. Confidence: 0.9",
			"- 提交信息使用中文。Confidence: 0.8",
			"- Uses tabs over spaces. Confidence: 0.5",
			"prose lines and headings are ignored",
		].join("\n");
		const entries = parseTasteFile(text);
		assert.deepEqual(entries, [
			{ statement: "Prefers pnpm over npm.", confidence: 0.9 },
			{ statement: "提交信息使用中文。", confidence: 0.8 },
			{ statement: "Uses tabs over spaces.", confidence: 0.5 },
		]);
		assert.deepEqual(parseTasteFile(renderTasteFile(entries)), entries);
		for (const line of renderTasteFile(entries).trimEnd().split("\n")) {
			assert.match(line, /^- .+ Confidence: \d\.\d$/);
		}
	});

	test("tolerates a Chinese full stop with or without a space before Confidence", () => {
		assert.deepEqual(parseTasteFile("- 提交信息使用中文。Confidence: 0.8"), [
			{ statement: "提交信息使用中文。", confidence: 0.8 },
		]);
		assert.deepEqual(parseTasteFile("- 提交信息使用中文。 Confidence: 0.8"), [
			{ statement: "提交信息使用中文。", confidence: 0.8 },
		]);
	});

	test("skips headings, prose, short statements, and confidence-less bullets", () => {
		const text = [
			"# Heading",
			"plain prose",
			"- ab Confidence: 0.9",
			"- This statement lacks confidence",
			"-   Spaced bullet statement.   Confidence:   0.6   ",
		].join("\n");
		assert.deepEqual(parseTasteFile(text), [{ statement: "Spaced bullet statement.", confidence: 0.6 }]);
	});

	test("clamps confidence into [0, 1] and drops unparsable lines", () => {
		assert.deepEqual(parseTasteFile("- Overshoot statement here. Confidence: 2.5"), [
			{ statement: "Overshoot statement here.", confidence: 1 },
		]);
		assert.deepEqual(parseTasteFile("- Zero statement goes here. Confidence: 0"), [
			{ statement: "Zero statement goes here.", confidence: 0 },
		]);
		assert.deepEqual(parseTasteFile("- Not a number statement. Confidence: high"), []);
		assert.deepEqual(parseTasteFile("- Negative statement here. Confidence: -0.5"), []);
	});

	test("renders the exact line sequence with a trailing newline", () => {
		assert.equal(
			renderTasteFile([{ statement: "Uses tabs over spaces.", confidence: 0.9 }]),
			"- Uses tabs over spaces. Confidence: 0.9\n",
		);
		assert.equal(
			renderTasteFile([{ statement: "Big statement about tests.", confidence: 1 }]),
			"- Big statement about tests. Confidence: 1.0\n",
		);
		assert.equal(renderTasteFile([]), "");
	});
});

describe("path whitelist", () => {
	test("isValidTasteFilePath accepts exactly taste.md and {category}/taste.md", () => {
		const valid = [
			"taste.md",
			"taste.md/",
			"./taste.md",
			"coding/taste.md",
			"工作流/taste.md",
			`${"a".repeat(64)}/taste.md`,
		];
		for (const relPath of valid) assert.equal(isValidTasteFilePath(relPath), true, relPath);
		const invalid = [
			"",
			"   ",
			".",
			"..",
			"notes.md",
			"a/b/taste.md",
			"sub/dir/deep/taste.md",
			"../escape.md",
			"foo/../../taste.md",
			"/taste.md",
			"/abs/taste.md",
			"\\taste.md",
			"C:\\taste.md",
			"C:/taste.md",
			"c:/taste.md",
			"con/taste.md",
			"CON/taste.md",
			"com1/taste.md",
			"lpt4/taste.md",
			"nul/taste.md",
			"aux/taste.md",
			"prn/taste.md",
			`${"a".repeat(65)}/taste.md`,
			"cat./taste.md",
			"-lead/taste.md",
			".hidden/taste.md",
		];
		for (const relPath of invalid) assert.equal(isValidTasteFilePath(relPath), false, relPath);
	});

	test("resolveTastePath returns absolute in-scope paths and throws off-whitelist", async (t) => {
		const testCase = await makeCase("resolve");
		t.after(testCase.cleanup);
		const scopeDir = testCase.path("scope");
		assert.equal(resolveTastePath(scopeDir, "taste.md"), resolve(scopeDir, "taste.md"));
		assert.equal(resolveTastePath(scopeDir, "coding/taste.md"), resolve(scopeDir, "coding", "taste.md"));
		assert.equal(resolveTastePath(scopeDir, "./taste.md"), resolve(scopeDir, "taste.md"));
		for (const bad of ["../escape.md", "/abs/taste.md", "C:\\taste.md", "notes.md", "", "a/b/taste.md", "con/taste.md"]) {
			assert.throws(() => resolveTastePath(scopeDir, bad), /taste path .* refused/, bad);
		}
	});

	test("readTasteFile returns content and rejects a missing file", async (t) => {
		const testCase = await makeCase("read");
		t.after(testCase.cleanup);
		const scopeDir = testCase.path("scope");
		await seed(join(scopeDir, "taste.md"), "seeded content\n");
		assert.equal(await readTasteFile(scopeDir, "taste.md"), "seeded content\n");
		await assert.rejects(() => readTasteFile(scopeDir, "missing/taste.md"), /ENOENT/);
	});

	test("listTasteFiles lists the root plus one-level categories only", async (t) => {
		const testCase = await makeCase("list");
		t.after(testCase.cleanup);
		const scopeDir = testCase.path("scope");
		await seed(join(scopeDir, "taste.md"), "root\n");
		await seed(join(scopeDir, "coding", "taste.md"), "coded\n");
		await seed(join(scopeDir, "skipped dir", "taste.md"), "unsafe name\n");
		await seed(join(scopeDir, "--skip", "taste.md"), "double dash\n");
		await seed(join(scopeDir, "empty", "other.md"), "no taste here\n");
		await seed(join(scopeDir, "stray.md"), "not taste.md\n");
		assert.deepEqual(await listTasteFiles(scopeDir), ["taste.md", "coding/taste.md"]);
		assert.deepEqual(await listTasteFiles(testCase.path("missing")), []);
	});
});

describe("writeFileAtomicTaste / withTasteLock", () => {
	test("writes atomically with 0600 file and 0700 parent modes and no leftovers", async (t) => {
		const testCase = await makeCase("atomic");
		t.after(testCase.cleanup);
		const file = testCase.path("deep", "nested", "taste.md");
		await writeFileAtomicTaste(file, "first\n");
		assert.equal(await readFile(file, "utf8"), "first\n");
		await writeFileAtomicTaste(file, "second\n");
		assert.equal(await readFile(file, "utf8"), "second\n");
		assert.equal((await stat(file)).mode & 0o777, 0o600);
		assert.equal((await stat(testCase.path("deep"))).mode & 0o777, 0o700);
		const leftovers = (await readdir(dirname(file))).filter((name) => name.endsWith(".tmp") || name.endsWith(".lock"));
		assert.deepEqual(leftovers, []);
	});

	test("withTasteLock serializes concurrent operations and passes results through", async (t) => {
		const testCase = await makeCase("lock");
		t.after(testCase.cleanup);
		const file = testCase.path("taste.md");
		await writeFileAtomicTaste(file, "");
		const order = [];
		const first = withTasteLock(file, async () => {
			order.push("one-start");
			await sleep(50);
			order.push("one-end");
			return "a";
		});
		await sleep(20);
		const second = withTasteLock(file, async () => {
			order.push("two-start");
			order.push("two-end");
			return "b";
		});
		assert.deepEqual([await first, await second], ["a", "b"]);
		assert.deepEqual(order, ["one-start", "one-end", "two-start", "two-end"]);
	});

	test("withTasteLock releases the lock when the operation fails", async (t) => {
		const testCase = await makeCase("lockfail");
		t.after(testCase.cleanup);
		const file = testCase.path("taste.md");
		await writeFileAtomicTaste(file, "");
		await assert.rejects(
			() =>
				withTasteLock(file, async () => {
					throw new Error("boom");
				}),
			/boom/,
		);
		assert.equal(await withTasteLock(file, async () => "recovered"), "recovered");
	});
});

describe("redactSensitive", () => {
	test("redacts sk-/ghp_/github_pat_/xox tokens and Bearer headers", () => {
		assert.equal(redactSensitive("token sk-abcdefgh12345678 end"), "token [REDACTED_TOKEN] end");
		assert.equal(redactSensitive("key ghp_1234567890abcdef"), "key [REDACTED_TOKEN]");
		assert.equal(redactSensitive("github_pat_11abcdefghijklmnop"), "[REDACTED_TOKEN]");
		assert.equal(redactSensitive("xoxb-1234567890abcd"), "[REDACTED_TOKEN]");
		assert.equal(
			redactSensitive("Authorization: Bearer eyJhbGciOiJIUzI1NiIs"),
			"Authorization: Bearer [REDACTED_TOKEN]",
		);
	});

	test("redacts api_key/password/secret assignments and keeps benign text", () => {
		assert.equal(redactSensitive("api_key = supersecretvalue1"), "api_key = [REDACTED]");
		assert.equal(redactSensitive("password:hunter2hunter2"), "password:[REDACTED]");
		assert.equal(redactSensitive("secret: 'topsecretvalue'"), "secret: '[REDACTED]'");
		assert.equal(redactSensitive("access_token=abcdefghijklmnop"), "access_token=[REDACTED]");
		assert.equal(redactSensitive("api_key=abc"), "api_key=abc");
		assert.equal(redactSensitive("no credentials in this plain line"), "no credentials in this plain line");
	});
});

describe("clipText", () => {
	test("keeps head and tail around the clipped marker within budget", () => {
		const value = "A".repeat(40) + "B".repeat(40) + "C".repeat(40);
		const clipped = clipText(value, 50);
		assert.equal(clipped.length, 50);
		assert.ok(clipped.startsWith("A".repeat(17)));
		assert.ok(clipped.endsWith("C".repeat(18)));
		assert.ok(clipped.includes("[...clipped...]"));
	});

	test("passes short values through and handles tiny budgets", () => {
		assert.equal(clipText("short", 50), "short");
		assert.equal(clipText("x".repeat(50), 50), "x".repeat(50));
		assert.equal(clipText("abcdef", 3), "abc");
	});
});

describe("normalizePreferenceKey", () => {
	test("lowercases, strips punctuation/whitespace and the confidence marker", () => {
		assert.equal(normalizePreferenceKey("Prefer pnpm, over npm!"), "prefer pnpm over npm");
		assert.equal(normalizePreferenceKey("Use tabs. Confidence: 0.9"), "use tabs");
		assert.equal(normalizePreferenceKey("ＡＬＷＡＹＳ　tabs"), "always tabs");
	});

	test("gives equal keys to statements differing only in case or punctuation", () => {
		assert.equal(
			normalizePreferenceKey("Prefer pnpm, over npm!"),
			normalizePreferenceKey("prefer  pnpm  over npm"),
		);
	});
});

describe("projectRootFor", () => {
	test("walks up to the nearest .git directory", async (t) => {
		const testCase = await makeCase("git");
		t.after(testCase.cleanup);
		const root = testCase.path("repo");
		await mkdir(join(root, ".git"), { recursive: true });
		await mkdir(join(root, "deep", "nested"), { recursive: true });
		assert.equal(projectRootFor(join(root, "deep", "nested")), resolve(root));
	});

	test("accepts a .git file (worktree style)", async (t) => {
		const testCase = await makeCase("gitfile");
		t.after(testCase.cleanup);
		const root = testCase.path("worktree");
		await seed(join(root, ".git"), "gitdir: elsewhere\n");
		assert.equal(projectRootFor(root), resolve(root));
	});

	test("returns the cwd itself when no .git is found", async (t) => {
		const testCase = await makeCase("nogit");
		t.after(testCase.cleanup);
		const plain = testCase.path("plain");
		await mkdir(plain, { recursive: true });
		assert.equal(projectRootFor(plain), resolve(plain));
	});
});

describe("ensureProjectTasteDir", () => {
	test("creates the directory plus a * .gitignore and never clobbers one", async (t) => {
		const testCase = await makeCase("gitignore");
		t.after(testCase.cleanup);
		const dir = testCase.path("project", ".dsh", "taste");
		await ensureProjectTasteDir(dir);
		assert.ok((await stat(dir)).isDirectory());
		assert.equal((await stat(dir)).mode & 0o777, 0o700);
		assert.equal(await readFile(join(dir, ".gitignore"), "utf8"), "*");
		await ensureProjectTasteDir(dir);
		assert.equal(await readFile(join(dir, ".gitignore"), "utf8"), "*");
		await seed(join(dir, ".gitignore"), "custom\n");
		await ensureProjectTasteDir(dir);
		assert.equal(await readFile(join(dir, ".gitignore"), "utf8"), "custom\n");
	});
});

describe("reorganizeIfNeeded", () => {
	test("moves a >5 heading section into its slug folder and leaves a See link", async (t) => {
		const testCase = await makeCase("reorg");
		t.after(testCase.cleanup);
		const scopeDir = testCase.path("scope");
		const rootContent = `# Workflow\n${sixWorkflowBullets()}\n`;
		await seed(join(scopeDir, "taste.md"), rootContent);
		assert.equal(await reorganizeIfNeeded(scopeDir), true);
		assert.equal(await readFile(join(scopeDir, "workflow", "taste.md"), "utf8"), rootContent);
		assert.equal(
			await readFile(join(scopeDir, "taste.md"), "utf8"),
			"# Workflow\nSee [workflow/taste.md](workflow/taste.md)\n",
		);
	});

	test("moves several over-threshold sections in one pass", async (t) => {
		const testCase = await makeCase("reorgmulti");
		t.after(testCase.cleanup);
		const scopeDir = testCase.path("scope");
		await seed(
			join(scopeDir, "taste.md"),
			`# Alpha\n${sixWorkflowBullets().replaceAll("Workflow", "Alpha")}\n# Beta\n${sixWorkflowBullets().replaceAll("Workflow", "Beta")}\n`,
		);
		assert.equal(await reorganizeIfNeeded(scopeDir), true);
		assert.equal(
			await readFile(join(scopeDir, "taste.md"), "utf8"),
			"# Alpha\nSee [alpha/taste.md](alpha/taste.md)\n# Beta\nSee [beta/taste.md](beta/taste.md)\n",
		);
		assert.match(await readFile(join(scopeDir, "alpha", "taste.md"), "utf8"), /Alpha entry one needs recording\./);
		assert.match(await readFile(join(scopeDir, "beta", "taste.md"), "utf8"), /Beta entry one needs recording\./);
	});

	test("leaves five or fewer learnings and unheaded bullets alone", async (t) => {
		const testCase = await makeCase("reorgsmall");
		t.after(testCase.cleanup);
		const fiveBullets = ["a", "b", "c", "d", "e"]
			.map((word) => bullet(`Small entry ${word} stays put.`, "0.5"))
			.join("\n");
		const sevenBullets = ["a", "b", "c", "d", "e", "f", "g"]
			.map((word) => bullet(`Headless entry ${word} stays put.`, "0.5"))
			.join("\n");
		const scopeDir = testCase.path("scope");
		await seed(join(scopeDir, "taste.md"), `# Small\n${fiveBullets}\n`);
		const headlessScope = testCase.path("headless");
		await seed(join(headlessScope, "taste.md"), `${sevenBullets}\n`);
		assert.equal(await reorganizeIfNeeded(scopeDir), false);
		assert.equal(await reorganizeIfNeeded(headlessScope), false);
		assert.equal(await readFile(join(scopeDir, "taste.md"), "utf8"), `# Small\n${fiveBullets}\n`);
		assert.equal(await readFile(join(headlessScope, "taste.md"), "utf8"), `${sevenBullets}\n`);
		assert.deepEqual(await readdir(scopeDir), ["taste.md"]);
	});

	test("is idempotent once sections hold See links", async (t) => {
		const testCase = await makeCase("reorgagain");
		t.after(testCase.cleanup);
		const scopeDir = testCase.path("scope");
		await seed(join(scopeDir, "taste.md"), `# Workflow\n${sixWorkflowBullets()}\n`);
		assert.equal(await reorganizeIfNeeded(scopeDir), true);
		const rootAfter = "# Workflow\nSee [workflow/taste.md](workflow/taste.md)\n";
		assert.equal(await readFile(join(scopeDir, "taste.md"), "utf8"), rootAfter);
		assert.equal(await reorganizeIfNeeded(scopeDir), false);
		assert.equal(await readFile(join(scopeDir, "taste.md"), "utf8"), rootAfter);
	});

	test("hash-falls back for unsafe slugs and caps slug length at 64", async (t) => {
		const testCase = await makeCase("reorgslug");
		t.after(testCase.cleanup);
		const scopeDir = testCase.path("scope");
		const longName = "X".repeat(80);
		await seed(
			join(scopeDir, "taste.md"),
			`# ????\n${sixWorkflowBullets()}\n# ${longName}\n${sixWorkflowBullets()}\n`,
		);
		assert.equal(await reorganizeIfNeeded(scopeDir), true);
		const names = (await readdir(scopeDir)).sort();
		const hashed = names.find((name) => /^category-[0-9a-f]{12}$/.test(name));
		assert.ok(hashed, "hashed slug directory exists");
		assert.equal(await readFile(join(scopeDir, hashed, "taste.md"), "utf8"), `# ????\n${sixWorkflowBullets()}\n`);
		assert.ok(names.includes("x".repeat(64)));
		assert.ok(!names.includes("x".repeat(80)));
		const rootAfter = await readFile(join(scopeDir, "taste.md"), "utf8");
		assert.match(rootAfter, /# \?\?\?\?\nSee \[category-[0-9a-f]{12}\/taste\.md\]\(category-[0-9a-f]{12}\/taste\.md\)\n/);
		// The root keeps the original heading verbatim; only the link uses the slug.
		assert.match(
			rootAfter,
			new RegExp(`# ${longName}\nSee \\[${"x".repeat(64)}\\/taste\\.md\\]\\(${"x".repeat(64)}\\/taste\\.md\\)\n`),
		);
	});
});

describe("loadCommandCodeTaste", () => {
	test("scans root and one-level categories read-only, skipping foreign dirs", async (t) => {
		const testCase = await makeCase("commandcode");
		t.after(testCase.cleanup);
		const home = testCase.path("home");
		const projectRoot = testCase.path("repo");
		await seed(join(home, ".commandcode", "taste", "taste.md"), "- Cc global root entry. Confidence: 0.9\n");
		await seed(join(home, ".commandcode", "taste", "coding", "taste.md"), "- Cc coding entry. Confidence: 0.7\n");
		await seed(join(home, ".commandcode", "taste", "--skip", "taste.md"), "- Cc skipped entry. Confidence: 0.6\n");
		await seed(join(home, ".commandcode", "taste", "has space", "taste.md"), "- Cc spaced entry. Confidence: 0.6\n");
		await seed(join(projectRoot, ".commandcode", "taste", "taste.md"), "- Cc project entry. Confidence: 0.5\n");
		const before = await snapshotTree(testCase.root);
		const entries = await loadCommandCodeTaste(home, projectRoot);
		assert.deepEqual(entries, [
			{ statement: "Cc global root entry.", confidence: 0.9 },
			{ statement: "Cc coding entry.", confidence: 0.7 },
			{ statement: "Cc project entry.", confidence: 0.5 },
		]);
		assert.deepEqual(await snapshotTree(testCase.root), before);
	});

	test("dedupes statements across stores in scan order", async (t) => {
		const testCase = await makeCase("ccdedupe");
		t.after(testCase.cleanup);
		const home = testCase.path("home");
		const projectRoot = testCase.path("repo");
		await seed(join(home, ".commandcode", "taste", "taste.md"), "- Duplicate statement here. Confidence: 0.9\n");
		await seed(join(projectRoot, ".commandcode", "taste", "taste.md"), "- duplicate  statement here! Confidence: 0.4\n");
		assert.deepEqual(await loadCommandCodeTaste(home, projectRoot), [
			{ statement: "Duplicate statement here.", confidence: 0.9 },
		]);
	});

	test("returns [] when the stores are missing", async (t) => {
		const testCase = await makeCase("ccempty");
		t.after(testCase.cleanup);
		assert.deepEqual(await loadCommandCodeTaste(testCase.path("home"), testCase.path("repo")), []);
	});
});

describe("loadTasteSnapshot", () => {
	test("merges project, global, and commandcode scopes with project priority", async (t) => {
		const testCase = await makeCase("snapshot");
		t.after(testCase.cleanup);
		const globalDir = testCase.path("global", "taste");
		const projectDir = testCase.path("project", ".dsh", "taste");
		await seed(
			join(globalDir, "taste.md"),
			"- Global only statement. Confidence: 0.5\n- Shared statement here. Confidence: 0.4\n",
		);
		await seed(join(globalDir, "coding", "taste.md"), "- Global category statement. Confidence: 0.8\n");
		await seed(
			join(projectDir, "taste.md"),
			"# Project\n- Project statement alpha. Confidence: 0.9\n- Shared statement here. Confidence: 1.0\n",
		);
		await seed(
			testCase.path(".commandcode", "taste", "taste.md"),
			"- Commandcode statement. Confidence: 0.6\n- Global only statement. Confidence: 0.3\n",
		);
		await seed(testCase.path("project", ".commandcode", "taste", "taste.md"), "- Project cc statement. Confidence: 0.7\n");
		assert.equal(
			await loadTasteSnapshot(globalDir, projectDir),
			[
				"- Project statement alpha. Confidence: 0.9",
				"- Shared statement here. Confidence: 1.0",
				"- Global only statement. Confidence: 0.5",
				"- Global category statement. Confidence: 0.8",
				"- Commandcode statement. Confidence: 0.6",
				"- Project cc statement. Confidence: 0.7",
			].join("\n") + "\n",
		);
	});

	test("returns an empty string when nothing exists anywhere", async (t) => {
		const testCase = await makeCase("snapempty");
		t.after(testCase.cleanup);
		assert.equal(
			await loadTasteSnapshot(testCase.path("global", "taste"), testCase.path("project", ".dsh", "taste")),
			"",
		);
		assert.equal(await loadTasteSnapshot(testCase.path("global", "taste")), "");
	});

	test("renders global-only scopes without a project", async (t) => {
		const testCase = await makeCase("snapglobal");
		t.after(testCase.cleanup);
		const globalDir = testCase.path("global", "taste");
		await seed(join(globalDir, "taste.md"), "- Global alone statement. Confidence: 0.4\n");
		assert.equal(await loadTasteSnapshot(globalDir), "- Global alone statement. Confidence: 0.4\n");
	});
});
