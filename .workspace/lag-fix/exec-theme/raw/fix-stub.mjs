import fs from 'node:fs';

const p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/proof/stub-apply.mjs';
let s = fs.readFileSync(p, 'utf8');
const NL = String.fromCharCode(10);

// --- (1) buildRunner: always rebind, never call the unbound class constructor ---
const a = s.indexOf('function buildRunner(src, label, patched) {');
const b = s.indexOf('function run(makePresenter, steps, model) {');
if (a === -1 || b === -1) { console.error('buildRunner not found'); process.exit(1); }
const replacement = `function buildRunner(src, label, patched) {
	const classBody = extractClass(src, label);
	const helper = patched ? extractFunction(src, "scheduleThemeColorRefresh", label) : null;
	const sig = patched ? extractFunction(src, "tokenSignature", label) : null;
	/* The class body closes over module-scope helpers, so it is constructed per window with
	 * those helpers bound explicitly; nothing is re-implemented. */
	const compile = patched
		? new Function(
			"document", "getComputedStyle", "scheduleThemeColorRefresh", "tokenSignature",
			\`return class ThemePresenter {\${classBody}};\`
		)
		: new Function("document", "getComputedStyle", \`return class ThemePresenter {\${classBody}};\`);
	const makeHelper = patched
		? new Function(\`const themeColorRefreshQueue = new Map();\\nlet themeColorFrame = 0;\\n\${helper}\\nreturn scheduleThemeColorRefresh;\`)()
		: null;
	const makeSig = patched ? new Function(\`\${sig}\\nreturn tokenSignature;\`)() : null;
	return (win, trace) => {
		trace.presenters = (trace.presenters || 0) + 1;
		return patched
			? new (compile(win.document, win.getComputedStyle, (w, presenter) => makeHelper(w, presenter), makeSig))()
			: new (compile(win.document, win.getComputedStyle))();
	};
}

`;
s = s.slice(0, a) + replacement + s.slice(b);

// --- (2) wrapper: capture the previous colorScheme value BEFORE overriding the property ---
s = s.replace(
  `		const htmlAssign = el.style;
		let lastColorScheme = htmlAssign.colorScheme;
		Object.defineProperty(htmlAssign, "colorScheme", {
			get() { return lastColorScheme; },
			set(v) { trace.writes.push(\`\${name}.style.colorScheme=\${v}\`); lastColorScheme = v; }
		});`,
  `		let lastColorScheme = el.style.colorScheme;
		Object.defineProperty(el.style, "colorScheme", {
			configurable: true,
			get() { return lastColorScheme; },
			set(v) { trace.writes.push(\`\${name}.style.colorScheme=\${v}\`); lastColorScheme = v; }
		});`
);

fs.writeFileSync(p, s);
console.log('stub harness repaired');
