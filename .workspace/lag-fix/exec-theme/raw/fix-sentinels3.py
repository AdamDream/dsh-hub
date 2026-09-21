import re

p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs'
s = open(p, encoding='utf8').read()

I = "/*@INSTANCE@*/"
F = "/*@FRAME@*/"
TAB = "\t"
BT = chr(96)
NL = chr(10)

frame_body = """\t\t/** Render callbacks coalesced into one per animation frame (see scheduleThemeColorRefresh). */
\t\tconst themeColorRefreshQueue = /* @__PURE__ */ new Map();
\t\tlet themeColorFrame = 0;
\t\t/**
\t\t * Run one theme-color refresh per animation frame.
\t\t * Reading the computed body background forces a synchronous style
\t\t * recalculation, so it must not run once per snapshot inside the publish
\t\t * dispatch: a frame boundary merges a whole dispatch round (and every
\t\t * presenter) into a single read, taken after all writers are done. When the
\t\t * host cannot schedule frames the refresh runs inline, which preserves the
\t\t * previous behaviour there.
\t\t * @param win - the window the presenter writes into.
\t\t * @param presenter - the presenter to refresh.
\t\t */
\t\tfunction scheduleThemeColorRefresh(win, presenter) {
\t\t\tconst winRef = win ?? globalThis;
\t\t\tconst request = winRef.requestAnimationFrame;
\t\t\tif (typeof request !== "function") {
\t\t\t\tpresenter.refreshThemeColor();
\t\t\t\treturn;
\t\t\t}
\t\t\tlet queued = themeColorRefreshQueue.get(winRef);
\t\t\tif (queued === void 0) {
\t\t\t\tqueued = /* @__PURE__ */ new Set();
\t\t\t\tthemeColorRefreshQueue.set(winRef, queued);
\t\t\t}
\t\t\tqueued.add(presenter);
\t\t\tif (themeColorFrame !== 0) return;
\t\t\tthemeColorFrame = request.call(winRef, () => {
\t\t\t\tthemeColorFrame = 0;
\t\t\t\tconst pending = queued;
\t\t\t\tthemeColorRefreshQueue.delete(winRef);
\t\t\t\tfor (const item of pending) item.refreshThemeColor();
\t\t\t});
\t\t}
"""

DOC = TAB*2 + "/** Applies theme snapshots to the document; one instance per plugin fiber. */" + NL
DOCF = TAB*2 + "/** Applies theme snapshots to the document; one instance per module per document. */" + NL
SENT_A = TAB*2 + I + NL
SENT_B = TAB*2 + F + NL
INST_LINE = TAB*2 + I + NL
FRAME_LINE = TAB*2 + F + NL

# --- the three terminal/insert anchors, written as plain literals (no lookahead) ---
block = (
    NL + TAB + "/**" + NL
    + TAB + " * [0] only: no deferred refresh is inserted, so the frame sentinel is collapsed" + NL
    + TAB + " * away and the instance sentinel becomes the real doc comment. Applies AFTER" + NL
    + TAB + " * frameScope whenever both are in scope." + NL
    + TAB + " */" + NL
    + TAB + "instancesOnlyCleanup: {" + NL
    + TAB*2 + "find: " + BT + SENT_A.replace(I, I + "\\n" + TAB*2 + F) + BT + "," + NL
    + TAB*2 + "replace: " + BT + "\\t\\t" + DOCF.strip() + "\\n" + BT + NL
    + TAB + "}," + NL + NL
    + TAB + "/**" + NL
    + TAB + " * [ii] frame-coalesced theme-color refresh. Anchored on the pristine ThemePresenter" + NL
    + TAB + " * doc comment so unit (0) does not have to run first; the replacement variant table" + NL
    + TAB + " * below supplies the block, with or without unit (0)'s instance sentinel in front." + NL
    + TAB + " */" + NL
    + TAB + "frameScope: {" + NL
    + TAB*2 + "find: " + BT + DOC + BT + "," + NL
    + TAB*2 + "replace: FRAME_SCOPE_A" + NL
    + TAB + "}," + NL + NL
    + TAB + "/** [0]+[ii]: collapse the leftover instance sentinel into the real doc comment. */" + NL
    + TAB + "master: {" + NL
    + TAB*2 + "find: " + BT + INST_LINE + BT + "," + NL
    + TAB*2 + "replace: " + BT + "\\t\\t" + DOCF.strip() + "\\n" + BT + NL
    + TAB + "}," + NL
)

start = s.index(NL + TAB + "/**" + NL + TAB + " * [0] only:")
end = s.index(NL + TAB + "/** [i] presenter fields:")
s = s[:start] + block + s[end:]

# --- variant table + chooser, placed immediately above layoutEdits ---
variant_a = frame_body + DOC
variant_b = frame_body + INST_LINE + DOC
table = (
    "/** [ii] block, inserted ahead of the pristine ThemePresenter doc comment. */" + NL
    + "const FRAME_SCOPE_A = " + BT + variant_a + BT + ";" + NL
    + "/** Same block when unit (0)'s instance sentinel sits in front of the doc comment. */" + NL
    + "const FRAME_SCOPE_B = " + BT + variant_b + BT + ";" + NL + NL
)
s = s.replace("/**\n * Emit the layout edit list for a scope.", table + "/**\n * Emit the layout edit list for a scope.", 1)

old_emit = (
    TAB + 'if (scope.includes("themeColor")) {' + NL
    + TAB*2 + 'edits.push({ key: "frameScope", ...LAYOUT_ANCHORS.frameScope });' + NL
    + TAB*2 + 'edits.push({ key: "master", ...LAYOUT_ANCHORS.master });'
)
new_emit = (
    TAB + 'if (scope.includes("themeColor")) {' + NL
    + TAB*2 + 'edits.push({ key: "frameScope", ...LAYOUT_ANCHORS.frameScope, replace: scope.includes("instances") ? FRAME_SCOPE_B : FRAME_SCOPE_A });' + NL
    + TAB*2 + 'edits.push({ key: "master", ...LAYOUT_ANCHORS.master });'
)
assert s.count(old_emit) == 1, ('emit', s.count(old_emit))
s = s.replace(old_emit, new_emit)

open(p, 'w', encoding='utf8').write(s)
print("rewritten")
