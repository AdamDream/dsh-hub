import fs from 'node:fs';

const p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs';
let s = fs.readFileSync(p, 'utf8');
const T = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const J = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// Replace the sentinel mechanism with a literal module-scope template table.
// The module-scope region is edited by ONE anchor and one of three literal
// templates, so no edit depends on text another edit created.
// ---------------------------------------------------------------------------
const startMarker = '// ---------------------------------------------------------------------------' + NL +
  '// sentinel placeholders (build-time device only)' + NL +
  '// ---------------------------------------------------------------------------';
const endMarker = NL + T + '/** [i] presenter fields. */';
const a = s.indexOf(startMarker);
const b = s.indexOf(endMarker);
if (a === -1 || b === -1 || b < a) { console.error('region not found'); process.exit(1); }
const region = s.slice(a, b);
if (!region.includes('INSTANCE_BLOCK') || !region.includes('frameScope')) { console.error('unexpected region'); process.exit(1); }
s = s.slice(0, a) + '@@REGION@@' + s.slice(b + 1);

const scr = (lines) => lines.join(NL) + NL;

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

const instanceBody = scr([
  T + T + '/**',
  T + T + ' * The theme-color metadata follows the body\u2019s computed background, so this',
  T + T + ' * presenter writes into `body.style`. Every presenter projecting onto the same',
  T + T + ' * document produces the identical token set, which makes concurrent presenters',
  T + T + ' * pure duplicate work \u2014 one forced style recalculation each \u2014 so ownership is',
  T + T + ' * held once per module per document and reference counted, while each effect',
  T + T + ' * still retracts the document only when the last consumer lets go.',
  T + T + ' */',
  T + T + 'const themePresenterSlots = /* @__PURE__ */ new WeakMap();',
  T + T + '/**',
  T + T + ' * Hand out the document\u2019s single theme presenter and count the consumer. The',
  T + T + ' * first caller installs the slot; every later caller (a second presenter',
  T + T + ' * instance, an HMR replacement, a replayed effect) shares it. The document is',
  T + T + ' * retracted only when the LAST consumer releases, so a transient overlap',
  T + T + ' * between two presenters can never blank the document. A release from an',
  T + T + ' * earlier generation is a no-op, which is what keeps the count from drifting.',
  T + T + ' * @param win - the window the presenter writes into.',
  T + T + ' * @param presenter - the presenter that becomes the slot\u2019s owner when free.',
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
  T + T + T + T + '/* A stale release must not touch a newer slot\u2019s count: identity check first. */',
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

const regionNew = scr([
  '// ---------------------------------------------------------------------------',
  '// module-scope templates',
  '// ---------------------------------------------------------------------------',
  '//',
  '// Unit (0) and unit (ii) both insert into the same spot of the layout module, and the',
  '// ThemePresenter doc comment has to read differently depending on who is present.',
  '// Chaining literal edits there is fragile, so the whole region is written from one',
  '// table: a single anchor spans `DARK_ATTRIBUTE` through the ThemePresenter class',
  '// declaration, and the variant is chosen by scope. A merged batch is therefore exactly',
  '// the text a person would have hand-written.',
  '/** Anchor text: the module-scope head plus the pristine ThemePresenter doc line. */',
  'const LAYOUT_SCOPE_FIND = ' + J(head) + ' + ' + J(docLine) + ';',
  '/** Module-scope head, unchanged. */',
  'const LAYOUT_SCOPE_HEAD = ' + J(head) + ';',
  '/** Unit (ii): the frame-coalesced theme-color refresh. */',
  'const LAYOUT_FRAME_BODY = ' + J(frameBody) + ';',
  '/** Unit (0): shared, reference-counted presenter ownership. */',
  'const LAYOUT_INSTANCE_BODY = ' + J(instanceBody) + ';',
  '/** Tail of the region: the doc comment the scope-appropriate ownership implies. */',
  'const LAYOUT_SCOPE_TAIL = (instances) => "' + T + T + '/** Applies theme snapshots to the document; one instance"',
  T + ' + (instances ? " per module" : " per plugin fiber") + " per document. */' + '\\n";',
  '',
  '/**',
  ' * Assemble the module-scope region for a scope.',
  ' * @param instances - unit (0) is on.',
  ' * @param frame - unit (ii) is on.',
  ' * @returns the replacement text for LAYOUT_SCOPE_FIND.',
  ' */',
  'function layoutScopeTemplate(instances, frame) {',
  T + 'return LAYOUT_SCOPE_HEAD + (instances ? LAYOUT_INSTANCE_BODY : "") + (frame ? LAYOUT_FRAME_BODY : "") + LAYOUT_SCOPE_TAIL(instances);',
  '}',
  ''
]);

s = s.replace('@@REGION@@', regionNew);
fs.writeFileSync(p, s);
console.log('region replaced');
