import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { createTasteTools } from "../lib/learner-tools.js";

/** Bullet lines with a Confidence marker, the parseable taste entry shape. */
const bullet = (statement, confidence) => `- ${statement} Confidence: ${confidence}`;
const isBulletLine = (line) => line.trimStart().startsWith("- ") && line.includes("Confidence:");
const bulletCount = (content) => content.split(/\r?\n/).filter(isBulletLine).length;

/** Fresh isolated scope roots; neither scope directory is created up front. */
async function makeScopes() {
	const root = await mkdtemp(join(tmpdir(), "dsh-taste-tools-"));
	return {
		globalDir: join(root, "global", "taste"),
		projectDir: join(root, "project", "repo", ".dsh", "taste"),
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

function setup(scopes) {
	return createTasteTools({
		resolveGlobalDir: () => scopes.globalDir,
		resolveProjectDir: () => scopes.projectDir,
		log: () => {},
	});
}

function toolOf(tools, name) {
	const tool = tools.find((entry) => entry.name === name);
	assert.ok(tool, `tool ${name} must be defined`);
	return tool;
}

/** Seed a file (creating parent directories) outside of the tools under test. */
async function seed(file, content) {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	await writeFile(file, content, { mode: 0o600 });
	return file;
}

describe("createTasteTools", () => {
	test("exposes read/write/edit_taste_file with scope+path parameters", () => {
		const tools = setup({ globalDir: "/unused/global", projectDir: "/unused/project" });
		assert.deepEqual(tools.map((tool) => tool.name), [
			"read_taste_file",
			"write_taste_file",
			"edit_taste_file",
		]);
		for (const tool of tools) {
			assert.equal(typeof tool.execute, "function");
			assert.deepEqual(tool.parameters.properties.scope.enum, ["global", "project"]);
		}
		assert.deepEqual(tools[0].parameters.required, ["scope", "path"]);
		assert.deepEqual(tools[1].parameters.required, ["scope", "path", "content"]);
		assert.deepEqual(tools[2].parameters.required, ["scope", "path", "old_text", "new_text"]);
	});

	test("read_taste_file returns the file content", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const file = await seed(join(scopes.globalDir, "taste.md"), "hello taste\n");
		const [read] = setup(scopes);
		assert.equal(await read.execute({ scope: "global", path: "taste.md" }, {}), await readFile(file, "utf8"));
	});

	test("read_taste_file reads a category file from the project scope", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		await seed(join(scopes.projectDir, "coding", "taste.md"), bullet("Prefers pnpm.", 0.8) + "\n");
		const [read] = setup(scopes);
		const result = await read.execute({ scope: "project", path: "coding/taste.md" }, {});
		assert.match(result, /Prefers pnpm\./);
	});

	test("read_taste_file reports a missing file when the scope directory does not exist", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const [read] = setup(scopes);
		assert.equal(await read.execute({ scope: "global", path: "taste.md" }, {}), "(file does not exist)");
	});

	test("read_taste_file rejects paths outside the whitelist", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const [read] = setup(scopes);
		for (const path of ["notes.md", "a/b/taste.md", "../escape.md", "sub/dir/deep/taste.md", ""]) {
			const result = await read.execute({ scope: "global", path }, {});
			assert.match(result, /^error: /, `path ${JSON.stringify(path)} must be rejected`);
		}
	});

	test("write_taste_file writes verbatim into a missing scope directory", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const [, write] = setup(scopes);
		const content = bullet("Write tooling stays pnpm.", 0.9) + "\n";
		const result = await write.execute({ scope: "project", path: "taste.md", content }, {});
		assert.equal(result, "wrote taste.md");
		assert.equal(await readFile(join(scopes.projectDir, "taste.md"), "utf8"), content);
	});

	test("write_taste_file creates a category directory on demand", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const [, write] = setup(scopes);
		const result = await write.execute(
			{ scope: "global", path: "workflow/taste.md", content: bullet("Prefer small PRs.", 0.7) + "\n" },
			{},
		);
		assert.equal(result, "wrote workflow/taste.md");
		assert.ok(await readFile(join(scopes.globalDir, "workflow", "taste.md"), "utf8"));
	});

	test("write_taste_file merges over the on-disk state and keeps concurrent additions", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const existing = bullet("Always use tabs over spaces.", 0.9);
		const file = await seed(join(scopes.globalDir, "taste.md"), existing + "\n");
		const [, write] = setup(scopes);
		const result = await write.execute(
			{ scope: "global", path: "taste.md", content: bullet("Prefers pnpm over npm.", 0.8) + "\n" },
			{},
		);
		assert.equal(result, "wrote taste.md");
		const saved = await readFile(file, "utf8");
		assert.match(saved, /Always use tabs over spaces\./);
		assert.match(saved, /Prefers pnpm over npm\./);
		assert.equal(bulletCount(saved), 2);
	});

	test("write_taste_file refuses unparsable content over a populated file", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const existing = bullet("Keep error messages actionable.", 0.8);
		const file = await seed(join(scopes.projectDir, "taste.md"), existing + "\n");
		const [, write] = setup(scopes);
		const result = await write.execute(
			{ scope: "project", path: "taste.md", content: "just some prose notes, no taste entries" },
			{},
		);
		assert.match(result, /^error: /);
		assert.match(result, /edit_taste_file/);
		assert.equal(await readFile(file, "utf8"), existing + "\n");
	});

	test("write_taste_file writes verbatim when the current file holds no entries", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const file = await seed(join(scopes.globalDir, "taste.md"), "# Notes\n\nscaffold only\n");
		const [, write] = setup(scopes);
		const content = "raw replacement text\n";
		const result = await write.execute({ scope: "global", path: "taste.md", content }, {});
		assert.equal(result, "wrote taste.md");
		assert.equal(await readFile(file, "utf8"), content);
	});

	test("write_taste_file serializes concurrent writers and keeps every entry", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const file = join(scopes.projectDir, "taste.md");
		const [, write] = setup(scopes);
		await Promise.all([
			write.execute({ scope: "project", path: "taste.md", content: bullet("Entry A from writer one.", 0.9) + "\n" }, {}),
			write.execute({ scope: "project", path: "taste.md", content: bullet("Entry B from writer two.", 0.9) + "\n" }, {}),
		]);
		const saved = await readFile(file, "utf8");
		assert.match(saved, /Entry A from writer one\./);
		assert.match(saved, /Entry B from writer two\./);
		assert.equal(bulletCount(saved), 2);
	});

	test("write_taste_file rejects paths outside the whitelist", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const [, write] = setup(scopes);
		const result = await write.execute({ scope: "global", path: "../evil.md", content: bullet("No.", 0.5) }, {});
		assert.match(result, /^error: /);
	});

	test("edit_taste_file replaces a unique match", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const file = await seed(
			join(scopes.globalDir, "taste.md"),
			bullet("Use TypeScript strict mode.", 0.9) + "\n" + bullet("Prefer vitest.", 0.7) + "\n",
		);
		const [, , edit] = setup(scopes);
		const result = await edit.execute(
			{ scope: "global", path: "taste.md", old_text: "Confidence: 0.7", new_text: "Confidence: 0.95" },
			{},
		);
		assert.equal(result, "edited taste.md");
		const saved = await readFile(file, "utf8");
		assert.match(saved, /Confidence: 0\.95/);
		assert.doesNotMatch(saved, /Confidence: 0\.7\b/);
		assert.match(saved, /Prefer vitest\./);
	});

	test("edit_taste_file edits a category file in the project scope", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const file = await seed(join(scopes.projectDir, "testing", "taste.md"), bullet("Run tests before commit.", 0.6) + "\n");
		const [, , edit] = setup(scopes);
		const result = await edit.execute(
			{ scope: "project", path: "testing/taste.md", old_text: "Run tests before commit.", new_text: "Run lint before commit." },
			{},
		);
		assert.equal(result, "edited testing/taste.md");
		assert.match(await readFile(file, "utf8"), /Run lint before commit\./);
	});

	test("edit_taste_file rejects old_text that does not occur", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const existing = bullet("Unchanged entry stays.", 0.9);
		const file = await seed(join(scopes.globalDir, "taste.md"), existing + "\n");
		const [, , edit] = setup(scopes);
		const result = await edit.execute(
			{ scope: "global", path: "taste.md", old_text: "not present anywhere", new_text: "x" },
			{},
		);
		assert.match(result, /^error: /);
		assert.match(result, /not found/);
		assert.equal(await readFile(file, "utf8"), existing + "\n");
	});

	test("edit_taste_file rejects an ambiguous old_text and leaves the file unchanged", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const entry = bullet("Duplicated entry appears twice.", 0.9);
		const file = await seed(join(scopes.globalDir, "taste.md"), entry + "\n" + entry + "\n");
		const [, , edit] = setup(scopes);
		const result = await edit.execute(
			{ scope: "global", path: "taste.md", old_text: "Duplicated entry appears twice.", new_text: "clobbered" },
			{},
		);
		assert.match(result, /^error: /);
		assert.match(result, /exactly one|matches 2/);
		assert.equal(await readFile(file, "utf8"), entry + "\n" + entry + "\n");
	});

	test("edit_taste_file reports a missing file without creating it", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const [, , edit] = setup(scopes);
		const result = await edit.execute(
			{ scope: "project", path: "taste.md", old_text: "a", new_text: "b" },
			{},
		);
		assert.equal(result, "error: file does not exist");
	});

	test("edit_taste_file rejects an empty old_text", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const [, , edit] = setup(scopes);
		const result = await edit.execute({ scope: "global", path: "taste.md", old_text: "", new_text: "x" }, {});
		assert.match(result, /^error: /);
	});

	test("argument validation rejects an unknown scope before any filesystem work", async (t) => {
		const scopes = await makeScopes();
		t.after(scopes.cleanup);
		const [read] = setup(scopes);
		await assert.rejects(read.execute({ scope: "bogus", path: "taste.md" }, {}));
	});
});
