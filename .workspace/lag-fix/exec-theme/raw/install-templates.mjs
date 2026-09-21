import fs from 'node:fs';

const p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs';
let s = fs.readFileSync(p, 'utf8');
const T = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const J = (v) => JSON.stringify(v);
const scr = (lines) => lines.join(NL) + NL;
const must = (needle, what) => {
  if (s.split(needle).length - 1 !== 1) { console.error('MISS ' + what); process.exit(1); }
  return needle;
};

// ---------------------------------------------------------------------------
// STEP 1: drop the sentinel constants + FRAME_BODY/FRAME_FILL/INSTANCE_BLOCK.
// Find the boundary by content, not by a fixed line count.
// ---------------------------------------------------------------------------
const markerA = '// sentinel placeholders (build-time device only)';
const markerB = 'const LAYOUT_ANCHORS = {';
const ia = s.indexOf(markerA);
const ib = s.indexOf(markerB);
if (ia === -1 || ib === -1) { console.error('boundaries not found'); process.exit(1); }
// keep the `// ---` separator line right above markerA
const ia2 = s.lastIndexOf('// ' + '-'.repeat(75), ia);
s = s.slice(0, ia2) + '@@TPL@@' + s.slice(ib);

// ---------------------------------------------------------------------------
// STEP 2: the template table
// ---------------------------------------------------------------------------
const frameBody = scr([
  T + T + '/** Render callbacks coalesced into one per animation frame (see scheduleThemeColorRefresh). */',
  T + T + 'const themeColorRefreshQueue = /* @__PURE__ */ new Map();',
  T + T + 'let themeColorFrame = 0;',
  T + T + '/**',
  T + T + ' * Run one theme-color refresh per animation frame.',
  T + T + ' * Reading the computed body background forces a synchronous style recalculation,',
  T + T + ' * so it must not run once per snapshot inside the publish dispatch: a frame',
  T + T + ' * boundary merges a whole dispatch round (and every presenter) into a single read',
  T + T + ' * taken after all writers are done. When the host cannot schedule frames the',
  T + T + ' * refresh runs inline, which preserves the previous behaviour there.',
  T + T + ' * @param win - the window the presenter writes into.',
  T + T + ' * @param presenter - the presenter to refresh.',
  T + T + ' */',
  T + T + 'function scheduleThemeColorRefresh(win, presenter) {',
  T + T + T + 'const winRef = win ?? globalThis;',
  T + T + T + 'const request = winRef.requestAnimationFrame;',
  T + T + T + 'if (typeof request !== "function") {',
  T + T + T + T + 'presenter.refreshThemeColor();',
  T + T + T + T + 'return;',
  T + T + T + '}',
  T + T + T + 'let queued = themeColorRefreshQueue.get(winRef);',
  T + T + T + 'if (queued === void 0) {',
  T + T + T + T + 'queued = /* @__PURE__ */ new Set();',
  T + T + T + T + 'themeColorRefreshQueue.set(winRef, queued);',
  T + T + T + '}',
  T + T + T + 'queued.add(presenter);',
  T + T + T + 'if (themeColorFrame !== 0) return;',
  T + T + T + 'themeColorFrame = request.call(winRef, () => {',
  T + T + T + T + 'themeColorFrame = 0;',
  T + T + T + T + 'const pending = queued;',
  T + T + T + T + 'themeColorRefreshQueue.delete(winRef);',
  T + T + T + T + 'for (const item of pending) item.refreshThemeColor();',
  T + T + T + '});',
  T + T + '}'
]);

const DASH = String.fromCharCode(8212);
const RSQ = String.fromCharCode(8217);
const instanceBody = scr([
  T + T + '/**',
  T + T + ' * The theme-color metadata follows the body' + RSQ + 's computed background, so this',
  T + T + ' * presenter writes into `body.style`. Every presenter projecting onto the same',
  T + T + ' * document produces the identical token set, which makes concurrent presenters pure',
  T + T + ' * duplicate work ' + DASH + ' one forced style recalculation each ' + DASH + ' so ownership is held',
  T + T + ' * once per module per document and reference counted, while each effect still',
  T + T + ' * retracts the document only when the last consumer lets go.',
  T + T + ' */',
  T + T + 'const themePresenterSlots = /* @__PURE__ */ new WeakMap();',
  T + T + '/**',
  T + T + ' * Hand out the document' + RSQ + 's single theme presenter and count the consumer. The',
  T + T + ' * first caller installs the slot; every later caller (a second presenter instance,',
  T + T + ' * an HMR replacement, a replayed effect) shares it. The document is retracted only',
  T + T + ' * when the LAST consumer releases, so a transient overlap between two presenters',
  T + T + ' * can never blank the document. A release from an earlier generation is a no-op,',
  T + T + ' * which is what keeps the count from drifting.',
  T + T + ' * @param win - the window the presenter writes into.',
  T + T + ' * @param presenter - the presenter that becomes the slot' + RSQ + 's owner when free.',
  T + T + ' * @returns the release function for this acquisition.',
  T + T + ' */',
  T + T + 'function acquireThemePresenter(win, presenter) {',
  T + T + T + 'const winRef = win ?? globalThis;',
  T + T + T + 'const held = themePresenterSlots.get(winRef);',
  T + T + T + 'if (held !== void 0) {',
  T + T + T + T + 'held.refs += 1;',
  T + T + T + T + 'return held.release;',
  T + T + T + '}',
  T + T + T + 'const slot = {',
  T + T + T + T + 'presenter,',
  T + T + T + T + 'refs: 1,',
  T + T + T + T + 'release: () => void 0',
  T + T + T + '};',
  T + T + T + 'slot.release = () => {',
  T + T + T + T + '/* A stale release must not touch a newer slot' + RSQ + 's count: identity check first. */',
  T + T + T + T + 'if (themePresenterSlots.get(winRef) !== slot) return;',
  T + T + T + T + 'slot.refs -= 1;',
  T + T + T + T + 'if (slot.refs > 0) return;',
  T + T + T + T + 'themePresenterSlots.delete(winRef);',
  T + T + T + T + 'slot.presenter.dispose();',
  T + T + T + '};',
  T + T + T + 'themePresenterSlots.set(winRef, slot);',
  T + T + T + 'return slot.release;',
  T + T + '}'
]);

const head = T + T + '/** Body attribute selecting the dark base palette in the token stylesheets. */' + NL +
  T + T + 'const DARK_ATTRIBUTE = "data-ds-dark-theme";' + NL;
const docLine = T + T + '/** Applies theme snapshots to the document; one instance per plugin fiber. */' + NL;

const tpl = scr([
  '// ' + '-'.repeat(75),
  '// module-scope templates',
  '// ' + '-'.repeat(75),
  '//',
  '// Unit (0) and unit (ii) both insert into the same spot of the layout module, and the',
  '// ThemePresenter doc comment has to read differently depending on who is present.',
  '// Chaining literal edits there is fragile, so the whole region comes from one table: a',
  '// single anchor spans `DARK_ATTRIBUTE` through the ThemePresenter class declaration, and',
  '// the variant is selected by scope. A merged batch is therefore exactly the text a',
  '// person would have hand-written.',
  '/** Anchor text: the module-scope head plus the pristine ThemePresenter doc line. */',
  'const LAYOUT_SCOPE_FIND = ' + J(head) + ' + ' + J(docLine) + ';',
  '/** The head is reproduced verbatim. */',
  'const LAYOUT_SCOPE_HEAD = ' + J(head) + ';',
  '/** Unit (ii): the frame-coalesced theme-color refresh. */',
  'const LAYOUT_FRAME_BODY = ' + J(frameBody) + ';',
  '/** Unit (0): shared, reference-counted presenter ownership. */',
  'const LAYOUT_INSTANCE_BODY = ' + J(instanceBody) + ';',
  '/**',
  ' * Tail of the region: the doc comment the resulting ownership implies.',
  ' * @param instances - unit (0) is on.',
  ' * @returns the closing doc comment line.',
  ' */',
  'function layoutScopeTail(instances) {',
  T + 'return "' + T + T + '/** Applies theme snapshots to the document; one instance" + (instances ? " per module" : " per plugin fiber") + " per document. */' + '\\n";',
  '}',
  '',
  '/**',
  ' * Assemble the module-scope region for a scope.',
  ' * @param instances - unit (0) is on.',
  ' * @param frame - unit (ii) is on.',
  ' * @returns the replacement text for LAYOUT_SCOPE_FIND.',
  ' */',
  'function layoutScopeTemplate(instances, frame) {',
  T + 'return LAYOUT_SCOPE_HEAD + (instances ? LAYOUT_INSTANCE_BODY : "") + (frame ? LAYOUT_FRAME_BODY : "") + layoutScopeTail(instances);',
  '}',
  '',
  'const LAYOUT_ANCHORS = {'
]);

s = s.replace('@@TPL@@', tpl);

// ---------------------------------------------------------------------------
// STEP 3: replace the five chained anchors with the single moduleScope anchor
// ---------------------------------------------------------------------------
const startA = s.indexOf('\t/** [0] module scope: replace the "one presenter per fiber" doc line with the shared holder. */');
const endA = s.indexOf('\t/** [i] presenter fields. */');
if (startA === -1 || endA === -1 || endA < startA) { console.error('anchor region not found'); process.exit(1); }
const single = [
  '\t/**',
  '\t * [0]+[ii] module scope: ONE anchor, three literal templates. Everything the two units',
  '\t * need at this spot is written together, so no edit depends on text another edit created.',
  '\t */',
  '\tmoduleScope: {',
  '\t\tfind: LAYOUT_SCOPE_FIND,',
  '\t\treplace: layoutScopeTemplate(instances, frame)',
  '\t},',
  ''
].join(NL);
s = s.slice(0, startA) + single + s.slice(endA);

// ---------------------------------------------------------------------------
// STEP 4: emit the single anchor from layoutEdits
// ---------------------------------------------------------------------------
const emitOld = s.slice(s.indexOf('export function layoutEdits(scope) {'));
const emitEnd = emitOld.indexOf('\n}\n');
const emitBody = [
  'export function layoutEdits(scope) {',
  '\tconst edits = [];',
  '\tconst wantsSignature = scope.includes("signature") || scope.includes("themeColor");',
  '\tconst wantsInstances = scope.includes("instances");',
  '\tif (scope.includes("signature")) {',
  '\t\t/* The signature helper sits in a disjoint region, so its edit is order independent. */',
  '\t\tedits.push({ key: "tokenSignatureHelper", ...LAYOUT_ANCHORS.tokenSignatureHelper });',
  '\t}',
  '\tif (wantsSignature || wantsInstances) {',
  '\t\tedits.push({',
  '\t\t\tkey: "moduleScope",',
  '\t\t\t...LAYOUT_ANCHORS.moduleScope,',
  '\t\t\treplace: layoutScopeTemplate(wantsInstances, wantsSignature)',
  '\t\t});',
  '\t}',
  '\tif (wantsSignature) {',
  '\t\tedits.push({ key: "fields", ...LAYOUT_ANCHORS.fields });',
  '\t\tedits.push({ key: "applyHead", ...LAYOUT_ANCHORS.applyHead });',
  '\t\tedits.push({ key: "dispose", ...LAYOUT_ANCHORS.dispose });',
  '\t}',
  '\tif (wantsInstances) edits.push({ key: "effect", ...LAYOUT_ANCHORS.effect });',
  '\treturn edits;',
  '}'
].join(NL);
s = s.replace(emitOld.slice(0, emitEnd + 3), emitBody + NL);

// ---------------------------------------------------------------------------
// STEP 5: sentinels are gone
// ---------------------------------------------------------------------------
s = s.replace(
  '/** Sentinel literals that must never survive into an artifact. */\nexport const SENTINELS = [I, F, P];',
  '/** Build-time sentinels. The template table no longer emits any, so this is empty by design. */\nexport const SENTINELS = [];'
);

fs.writeFileSync(p, s);
console.log('template table installed');
