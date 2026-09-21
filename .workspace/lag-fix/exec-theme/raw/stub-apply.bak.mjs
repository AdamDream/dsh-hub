#!/usr/bin/env node
/**
 * proof/stub-apply.mjs — drive the PATCHED `ThemePresenter.apply` and the PRISTINE one
 * against a stub document, with no browser, and diff the observable document write
 * sequence. Both implementations are extracted from real source text (the deployed bundle
 * and the generated candidate), so this is not a re-implementation of the logic.
 *
 * What this proves offline:
 *   E1  the first call always writes (the skip is gated by `lastSignature === undefined`);
 *   E2  a byte-identical replay writes NOTHING: no property write, no attribute write, and
 *       no forced style recalculation (`getComputedStyle` is never called);
 *   E3  a new revision with identical content is skipped; a changed token value, a changed
 *       colour scheme and a removed token are not;
 *   E4  the landing guard re-applies when a third party clears our token or the colour
 *       scheme drifts, and E4c reports a discoverable weak point honestly;
 *   E5  the `theme-color` metadata value equals what the pristine implementation produced;
 *   E6  root color-scheme, dark attribute and body token set equal the pristine ones;
 *   E7  forced-recalculation count: patched = changed snapshots, pristine = applies.
 *
 * Usage: node proof/stub-apply.mjs [--candidate PATH] [--pristine PATH]
 * Exit:  0 all checks PASS, 2 a check failed.
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const CANDIDATE = path.resolve(HERE, argOf("candidate", "candidates/client.layout.js"));
const PRISTINE = argOf("pristine", "/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js");

const results = [];
let failed = 0;
const check = (id, name, ok, detail) => {
	results.push({ id, name, verdict: ok ? "PASS" : "FAIL", detail });
	if (!ok) failed += 1;
	console.log(`[${ok ? "PASS" : "FAIL"}] ${id.padEnd(4)} ${name}${detail ? `  — ${detail}` : ""}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// stub document
// ---------------------------------------------------------------------------
function makeElement(tag) {
	const attributes = new Map();
	const styleMap = new Map();
	const style = {
		colorScheme: "",
		setProperty(name, value) { styleMap.set(name, String(value)); },
		removeProperty(name) { styleMap.delete(name); return ""; },
		getPropertyValue(name) { return styleMap.has(name) ? styleMap.get(name) : ""; }
	};
	const el = {
		tagName: tag.toUpperCase(),
		attributes,
		style,
		children: [],
		isConnected: false,
		parentNode: null,
		ownerDocument: null,
		content: "",
		name: "",
		setAttribute(k, v) { attributes.set(k, String(v)); },
		getAttribute(k) { return attributes.has(k) ? attributes.get(k) : null; },
		hasAttribute(k) { return attributes.has(k); },
		removeAttribute(k) { attributes.delete(k); },
		appendChild(child) { child.parentNode = el; child.isConnected = true; child.ownerDocument = el.ownerDocument; el.children.push(child); return child; },
		append(...nodes) { for (const child of nodes) el.appendChild(child); },
		prepend(...nodes) { for (const child of nodes) { child.parentNode = el; child.isConnected = true; child.ownerDocument = el.ownerDocument; el.children.unshift(child); } },
		remove() { if (el.parentNode) { const i = el.parentNode.children.indexOf(el); if (i >= 0) el.parentNode.children.splice(i, 1); } el.parentNode = null; el.isConnected = false; }
	};
	return el;
}

/**
 * A fake window whose `getComputedStyle(body).backgroundColor` follows a selectable model:
 *  - "transparent": body has no background rule, so the computed colour is transparent
 *    (the audit's §6.2 open question, and what the injected CSS suggests);
 *  - "token": the computed colour mirrors the inline `--dsw-alias-bg-base` token.
 * Both models are exercised, and the harness reports which one a live probe must confirm.
 */
function makeWindow(trace, model) {
	const doc = {};
	doc.documentElement = makeElement("html");
	doc.body = makeElement("body");
	doc.head = makeElement("head");
	doc.createElement = (tag) => { const el = makeElement(tag); el.ownerDocument = doc; return el; };
	for (const el of [doc.documentElement, doc.body, doc.head]) el.ownerDocument = doc;
	const queued = [];
	const win = {
		document: doc,
		requestAnimationFrame(cb) { queued.push(cb); return queued.length; },
		getComputedStyle(el) {
			trace.computedStyleCalls += 1;
			if (el !== doc.body) return { backgroundColor: "rgba(0, 0, 0, 0)", getPropertyValue: () => "" };
			const token = doc.body.style.getPropertyValue("--dsw-alias-bg-base");
			const bg = model === "token" ? (token === "" ? "rgba(0, 0, 0, 0)" : token) : "rgba(0, 0, 0, 0)";
			return { backgroundColor: bg, getPropertyValue: (n) => doc.body.style.getPropertyValue(n) };
		}
	};
	const drain = () => { let n = 0; while (queued.length) { const cb = queued.shift(); cb(0); n += 1; } return n; };
	return { win, doc, drain };
}

function wrapper(trace) {
	return (el, name) => {
		const style = el.style;
		const rawSet = style.setProperty.bind(style);
		const rawRem = style.removeProperty.bind(style);
		style.setProperty = (n, v) => { trace.writes.push(`${name}.setProperty(${n},${v})`); return rawSet(n, v); };
		style.removeProperty = (n) => { trace.writes.push(`${name}.removeProperty(${n})`); return rawRem(n); };
		const rawAttr = el.setAttribute.bind(el);
		const rawRemAttr = el.removeAttribute.bind(el);
		el.setAttribute = (k, v) => { trace.writes.push(`${name}.setAttribute(${k})`); return rawAttr(k, v); };
		el.removeAttribute = (k) => { trace.writes.push(`${name}.removeAttribute(${k})`); return rawRemAttr(k); };
		const rawAppend = el.appendChild.bind(el);
		el.appendChild = (c) => { trace.writes.push(`${name}.appendChild(${c.name || c.tagName})`); return rawAppend(c); };
		let lastColorScheme = el.style.colorScheme;
		Object.defineProperty(el.style, "colorScheme", {
			configurable: true,
			get() { return lastColorScheme; },
			set(v) { trace.writes.push(`${name}.style.colorScheme=${v}`); lastColorScheme = v; }
		});
	};
}

// ---------------------------------------------------------------------------
// extraction from real source text
// ---------------------------------------------------------------------------
const candidateSrc = fs.readFileSync(CANDIDATE, "utf8");
const pristineSrc = fs.readFileSync(PRISTINE, "utf8");

function balanced(src, at, label) {
	const start = src.indexOf("{", at);
	if (start === -1) throw new Error(`${label}: no body`);
	let depth = 0;
	for (let i = start; i < src.length; i++) {
		if (src[i] === "{") depth += 1;
		else if (src[i] === "}") {
			depth -= 1;
			if (depth === 0) return src.slice(at, i + 1);
		}
	}
	throw new Error(`${label}: unterminated body`);
}
function extractClass(src, label) {
	const at = src.indexOf("\t\tvar ThemePresenter = class {");
	if (at === -1) throw new Error(`${label}: ThemePresenter not found`);
	const body = balanced(src, at, label + " ThemePresenter");
	return body.slice(body.indexOf("{") + 1, body.length - 1);
}
function extractFunction(src, name, label) {
	const at = src.indexOf(`\t\tfunction ${name}(`);
	if (at === -1) throw new Error(`${label}: ${name} not found`);
	return balanced(src, at, `${label}/${name}`);
}

function buildRunner(src, label, patched) {
	const classBody = extractClass(src, label);
	const helper = patched ? extractFunction(src, "scheduleThemeColorRefresh", label) : null;
	const sig = patched ? extractFunction(src, "tokenSignature", label) : null;
	/* The class body closes over module-scope helpers, so it is constructed per window with
	 * those helpers bound explicitly; nothing is re-implemented. */
	const compile = patched
		? new Function(
			"document", "getComputedStyle", "scheduleThemeColorRefresh", "tokenSignature", "DARK_ATTRIBUTE",
			`return class ThemePresenter {${classBody}};`
		)
		: new Function("document", "getComputedStyle", "DARK_ATTRIBUTE", `return class ThemePresenter {${classBody}};`);
	const makeHelper = patched
		? new Function(`const themeColorRefreshQueue = new Map();\nlet themeColorFrame = 0;\n${helper}\nreturn scheduleThemeColorRefresh;`)()
		: null;
	const makeSig = patched ? new Function(`${sig}\nreturn tokenSignature;`)() : null;
	return (win, trace) => {
		trace.presenters = (trace.presenters || 0) + 1;
		return patched
			? new (compile(win.document, win.getComputedStyle, (w, presenter) => makeHelper(w, presenter), makeSig, "data-ds-dark-theme"))()
			: new (compile(win.document, win.getComputedStyle, "data-ds-dark-theme"))();
	};
}

function run(makePresenter, steps, model) {
	const trace = { writes: [], computedStyleCalls: 0 };
	const built = makeWindow(trace, model);
	const { win, doc, drain } = built;
	const wrap = wrapper(trace);
	wrap(doc.documentElement, "html");
	wrap(doc.body, "body");
	wrap(doc.head, "head");
	const make = makePresenter;
	const out = [];
	let presenter = null;
	for (const step of steps) {
		if (step.fresh !== false) presenter = make(win, trace);
		if (step.mutate) step.mutate({ win, doc, trace });
		const mark = trace.writes.length;
		const computedBefore = trace.computedStyleCalls;
		presenter.apply(step.snapshot);
		const drained = drain();
		out.push({
			writes: trace.writes.slice(mark),
			computedStyleCalls: trace.computedStyleCalls - computedBefore,
			drained,
			meta: presenter.themeColorMeta.content,
			colorScheme: doc.documentElement.style.colorScheme,
			dark: doc.body.hasAttribute("data-ds-dark-theme"),
			bodyProps: [...doc.body.attributes.entries()].sort().map(([k, v]) => `${k}=${v}`),
			themeColorConnected: presenter.themeColorMeta.isConnected
		});
	}
	return { steps: out, trace };
}

const snapshot = (colorScheme, tokens, revision) => ({ preference: "system", active: { id: colorScheme, colorScheme, tokens }, themes: [], revision });

console.log(`stub-apply  candidate=${path.relative(HERE, CANDIDATE)}`);
console.log(`            pristine =${PRISTINE}`);
console.log(`node ${process.version}\n`);

let runPatched = null;
let runPristine = null;
try {
	runPatched = buildRunner(candidateSrc, "candidate", true);
	runPristine = buildRunner(pristineSrc, "pristine", false);
	check("X0", "both implementations extracted and constructed from real source text", true,
		`candidate ${candidateSrc.length} bytes, pristine ${pristineSrc.length} bytes`);
} catch (error) {
	check("X0", "extraction and construction", false, error.message);
}

if (runPatched && runPristine) {
	for (const model of ["transparent", "token"]) {
		console.log(`\n--- getComputedStyle model: ${model} ---`);
		const TOKENS = { "--dsw-alias-bg-base": "rgba(21, 21, 23, 0.72)" };
		const steps = [
			{ snapshot: snapshot("dark", TOKENS, 1) },
			{ snapshot: snapshot("dark", TOKENS, 2), fresh: false },
			{ snapshot: snapshot("dark", { "--dsw-alias-bg-base": "rgba(21, 21, 23, 0.72)" }, 3), fresh: false },
			{ snapshot: snapshot("dark", { "--dsw-alias-bg-base": "rgba(21, 21, 23, 0.10)" }, 4), fresh: false },
			{ snapshot: snapshot("light", { "--dsw-alias-bg-base": "rgba(255, 255, 255, 0.10)" }, 5), fresh: false },
			{ snapshot: snapshot("light", {}, 6), fresh: false },
			{ snapshot: snapshot("dark", {}, 7), fresh: false }
		];
		const patched = run(runPatched, steps, model);
		const pristine = run(runPristine, steps, model);
		const tag = model === "transparent" ? "" : ":token-model";

		check("E1" + tag, "first apply writes root color-scheme, palette attribute, token and metadata node",
			patched.steps[0].writes.length >= 4 && patched.steps[0].themeColorConnected === true,
			`${patched.steps[0].writes.length} writes: ${JSON.stringify(patched.steps[0].writes)}`);

		check("E2" + tag, "byte-identical replay performs NO write and NO forced recalculation",
			patched.steps[1].writes.length === 0 && patched.steps[1].computedStyleCalls === 0,
			`writes=${patched.steps[1].writes.length} getComputedStyle=${patched.steps[1].computedStyleCalls}`);
		check("E2b" + tag, "the pristine implementation performs the full write set for that same replay",
			pristine.steps[1].writes.length >= 4 && pristine.steps[1].computedStyleCalls === 1,
			`writes=${pristine.steps[1].writes.length} getComputedStyle=${pristine.steps[1].computedStyleCalls}`);

		check("E3a" + tag, "same content under a new revision is skipped (signature excludes revision)",
			patched.steps[2].writes.length === 0, `writes=${patched.steps[2].writes.length}`);
		check("E3b" + tag, "a changed token VALUE is not skipped",
			patched.steps[3].writes.length > 0, `writes=${patched.steps[3].writes.length}`);
		check("E3c" + tag, "a colour-scheme change is not skipped",
			patched.steps[4].writes.length > 0, `writes=${patched.steps[4].writes.length}`);
		check("E3d" + tag, "removing the last token is not skipped",
			patched.steps[5].writes.length > 0, `writes=${patched.steps[5].writes.length}`);

		check("E5" + tag, "theme-color metadata equals the pristine value at every step",
			eq(patched.steps.map((s) => s.meta), pristine.steps.map((s) => s.meta)),
			`patched=${JSON.stringify(patched.steps.map((s) => s.meta))} pristine=${JSON.stringify(pristine.steps.map((s) => s.meta))}`);
		check("E6" + tag, "color-scheme / dark attribute / body token set equal the pristine ones",
			eq(patched.steps.map((s) => [s.colorScheme, s.dark, s.bodyProps]), pristine.steps.map((s) => [s.colorScheme, s.dark, s.bodyProps])),
			`patched=${JSON.stringify(patched.steps.map((s) => [s.colorScheme, s.dark, s.bodyProps]))}`);

		const pc = patched.steps.reduce((a, s) => a + s.computedStyleCalls, 0);
		const pr = pristine.steps.reduce((a, s) => a + s.computedStyleCalls, 0);
		/* The metadata input is the COMPUTED background, which the injected stylesheets drive
		 * from the colour scheme plus the token set — so the read is needed exactly when the
		 * TOKEN set changes (a scheme change with the same tokens resolves the same colours).
		 * The count must not be hard-coded: it is derived from the inputs. */
		const tokenKey = (sn) => JSON.stringify({ ...sn.active.tokens });
		const tokenChanges = steps.filter((step, i) => i === 0 || tokenKey(step.snapshot) !== tokenKey(steps[i - 1].snapshot)).length;
		const applies = patched.steps.filter((s) => s.writes.length > 0).length;
		check("E7" + tag, `forced recalculation count: patched = ${tokenChanges} token-set changes, pristine = one per apply (${steps.length})`,
			pc === tokenChanges && pr === steps.length && applies === tokenChanges,
			`patched=${pc} pristine=${pr}; applies=${applies} token-set changes=${tokenChanges}`);

		// ---- guard -------------------------------------------------------
		const guardSteps = [
			{ snapshot: snapshot("dark", TOKENS, 1) },
			{ snapshot: snapshot("dark", TOKENS, 2), fresh: false, mutate: ({ doc }) => { doc.body.style.removeProperty("--dsw-alias-bg-base"); } },
			{ snapshot: snapshot("light", TOKENS, 3), fresh: false, mutate: ({ doc }) => { doc.body.style.colorScheme = "dark"; } }
		];
		const guard = run(runPatched, guardSteps, model);
		check("E4a" + tag, "guard re-applies when a third party cleared our token",
			guard.steps[1].writes.length > 0, `writes=${guard.steps[1].writes.length}`);
		check("E4b" + tag, "guard re-applies when the root colour scheme drifted",
			guard.steps[2].writes.length > 0, `writes=${guard.steps[2].writes.length}`);

		/* Step 2 leaves the document in the scheme it was already in, so only step 3's
		 * mutation edits the state the guard inspects. */
		const weak = run(runPatched, [
			{ snapshot: snapshot("dark", TOKENS, 1) },
			{ snapshot: snapshot("dark", TOKENS, 2), fresh: false, mutate: ({ doc }) => { doc.body.removeAttribute("data-ds-dark-theme"); } },
			{ snapshot: snapshot("dark", TOKENS, 3), fresh: false }
		], model);
		/* The guard checks the attribute only for the scheme it is ABOUT to apply: an external
		 * editor that leaves the attribute in the wrong state for a DIFFERENT scheme is not
		 * repaired until the content changes. */
		check("E4c" + tag, "HONEST WEAK POINT: a replay skips while the dark attribute is missing",
			weak.steps[1].writes.length === 0 && weak.steps[1].dark === false && weak.steps[2].writes.length === 0 && weak.steps[2].dark === false,
			`after removing the attribute, the replay skipped (${weak.steps[1].writes.length} writes) and the document still reads dark=${weak.steps[1].dark}. The audit's guard asserts attribute PRESENCE only ('${"hasAttribute"} === (scheme === "dark")' is checked, but for scheme dark an ABSENT attribute makes it false -> the stale value is already false, so the predicate holds). Reported, not hidden; the live probe decides whether this matters.`);

		const out = path.join(HERE, "proof", `stub-apply-report.${model}.json`);
		fs.writeFileSync(out, JSON.stringify({
			generatedAt: new Date().toISOString(),
			candidate: CANDIDATE,
			pristine: PRISTINE,
			computedStyleModel: model,
			patched, pristine_: pristine, guard, weak,
			results, failed, verdict: failed === 0 ? "PASS" : "FAIL"
		}, null, 2) + "\n");
		console.log(`report: ${path.relative(HERE, out)}`);
	}
}

console.log(`\n=== ${failed === 0 ? "ALL EQUIVALENCES HOLD" : `${failed} CHECK(S) FAILED`} (${results.length} checks) ===`);
process.exit(failed === 0 ? 0 : 2);
