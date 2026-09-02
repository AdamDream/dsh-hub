import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";
//#region test/client.test.js
/**
 * Executable smoke tests for the handwritten client bundle (gui-design.md
 * §3/§5.2): the bundle compiles as a plain script, registers exactly one
 * factory under the package id, and the factory — driven with a mock require
 * table for the seed words — exports { apply, inject } with the documented
 * service list, registers the two real slot keys, and installs a zh/en locale
 * pair with identical key sets (R5).
 */

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");
const code = readFileSync(bundlePath, "utf8");

/** Seed-word require mock (design §1.5/§5.2): the only modules the bundle needs. */
function requireMock() {
	const modules = {
		"react/jsx-runtime": { jsx: (...args) => args, jsxs: (...args) => args, Fragment: { $$fragment: true } },
		react: {
			useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
			useEffect: () => {},
			useCallback: (fn) => fn,
			useRef: (value) => ({ current: value }),
			useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
		},
		"@deepseek-ai/dsh-client-ui-primitives": {
			Tooltip: () => null,
			IconPersonalizationOutline16: () => null,
			IconRefreshOutline16: () => null,
			IconCloseOutline16: () => null,
		},
	};
	return (spec) => {
		if (!(spec in modules)) throw new Error(`require mock: unexpected module "${spec}"`);
		return modules[spec];
	};
}

/** Compile + register the bundle in a sandboxed window; return the capture. */
function loadBundle() {
	// 1) Syntax gate without executing anything (equivalent to node --check).
	new vm.Script(code, { filename: "lib/client.js" });
	// 2) Execute registration only: the factory must not run yet (no CSS/DOM side effects).
	const captured = [];
	const sandbox = {
		window: {
			__ModuleLoader__: {
				load: (registration) => captured.push(registration),
			},
		},
	};
	vm.runInNewContext(code, sandbox, { filename: "lib/client.js" });
	assert.equal(captured.length, 1, "the bundle must register exactly one factory");
	assert.equal(captured[0].id, "@deepseek-ai/dsh-taste");
	assert.equal(typeof captured[0].factory, "function");
	return captured[0];
}

describe("client bundle registration (design §3.1)", () => {
	it("compiles as a plain script and registers one factory without side effects", () => {
		loadBundle();
	});
});

describe("client bundle factory (design §5.2)", () => {
	it("exports { apply, inject } with the documented service-name list", () => {
		const { factory } = loadBundle();
		const bundle = factory(requireMock());
		// Cross-realm note: the array was created inside the vm context, so
		// spread it into a host array before deepStrictEqual.
		assert.deepEqual([...bundle.inject], ["slots", "locale", "connection", "sessions"]);
		assert.equal(typeof bundle.apply, "function");
	});

	it("rejects require specifiers outside the seed-word table", () => {
		const mock = requireMock();
		assert.throws(() => mock("@deepseek-ai/dsh-web-app"), /unexpected module/);
	});

	it("apply registers both real slot keys and the taste locale pair", () => {
		const { factory } = loadBundle();
		const bundle = factory(requireMock());
		const state = { effects: [], locale: [], slotInjects: [], slotRegisters: [] };
		const ctx = {
			effect: (fn, label) => state.effects.push({ fn, label }),
			locale: { register: (ns, dicts) => state.locale.push({ ns, dicts }) },
			connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
			slots: {
				inject: (key, callback) => state.slotInjects.push({ key, callback }),
				register: (options, component) => state.slotRegisters.push({ options, component }),
			},
		};
		bundle.apply(ctx);
		// The two slot keys the design pins (sidebar footer entry + overlay panel).
		assert.deepEqual(state.slotInjects.map((entry) => entry.key), ["sidebar.footer.action", "shell.overlay"]);
		for (const entry of state.slotInjects) entry.callback();
		assert.equal(state.slotRegisters.length, 2);
		const [trigger, panel] = state.slotRegisters;
		assert.equal(trigger.options.name, "sidebar.footer.action");
		assert.equal(trigger.options.id, "taste");
		assert.equal(trigger.options.locale, "taste");
		assert.deepEqual(Object.keys(trigger.options.inject()), ["onToggle"]);
		assert.equal(typeof trigger.component, "function");
		assert.equal(panel.options.name, "shell.overlay");
		assert.equal(panel.options.id, "taste-panel");
		assert.equal(panel.options.order, 100);
		assert.equal(panel.options.locale, "taste");
		assert.deepEqual(Object.keys(panel.options.inject()), ["useOpen", "rpc", "onClose", "useSessionCwd"]);
		assert.equal(typeof panel.component, "function");
		// Locale: the effect factory must be activated (as cordis does on apply)
		// for the namespace "taste" registration to run with zh/en dicts.
		const dictionaries = state.effects.find((effect) => effect.label === "ui-taste: dictionaries");
		assert.ok(dictionaries, "the locale registration must ride a labeled effect");
		dictionaries.fn();
		assert.equal(state.locale.length, 1);
		assert.equal(state.locale[0].ns, "taste");
		assert.deepEqual(Object.keys(state.locale[0].dicts).sort(), ["en", "zh"]);
		assert.deepEqual(Object.keys(state.locale[0].dicts.zh), Object.keys(state.locale[0].dicts.en));
		assert.ok(state.effects.some((effect) => effect.label === "ui-taste: dictionaries"));
	});

	it("exposes the sessions cwd channel through the panel inject (design §3.3)", () => {
		const { factory } = loadBundle();
		const bundle = factory(requireMock());
		// Fake sessions service: SessionRuntime.list is a bare snapshot store
		// whose snapshot is { ids, byId, current, … } with byId[id].cwd carried
		// from the host feed (dsh-client-runtime projectList). The react mock's
		// useSyncExternalStore returns getSnapshot(), so calling the hook must
		// select the CURRENT session's cwd out of that snapshot.
		const snapshot = { ids: ["s1"], byId: { s1: { id: "s1", cwd: "/workspace/a" } }, current: "s1" };
		const listeners = new Set();
		const sessions = {
			list: {
				subscribe: (fn) => {
					listeners.add(fn);
					return () => listeners.delete(fn);
				},
				getSnapshot: () => snapshot,
			},
		};
		let panelOptions;
		bundle.apply({
			effect: () => {},
			locale: { register: () => {} },
			connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
			sessions,
			slots: {
				inject: (key, callback) => {
					if (key === "shell.overlay") callback();
				},
				register: (options) => {
					panelOptions = options;
				},
			},
		});
		const injected = panelOptions.inject();
		assert.equal(typeof injected.useSessionCwd, "function", "the panel inject must carry the sessions cwd channel");
		assert.equal(injected.useSessionCwd(), "/workspace/a", "the hook must select the current session's cwd");
		// No active session → undefined cwd (bridge renders present:false), and a
		// missing sessions service must degrade to the same, never throw.
		snapshot.current = void 0;
		assert.equal(injected.useSessionCwd(), void 0);
		snapshot.current = "s1";
		const absent = factory(requireMock());
		let absentOptions;
		absent.apply({
			effect: () => {},
			locale: { register: () => {} },
			connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
			slots: {
				inject: (key, callback) => {
					if (key === "shell.overlay") callback();
				},
				register: (options) => {
					absentOptions = options;
				},
			},
		});
		assert.equal(absentOptions.inject().useSessionCwd(), void 0, "absent sessions service must yield undefined cwd");
	});
});
//#endregion
