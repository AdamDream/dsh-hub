import sys

p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs'
s = open(p, encoding='utf8').read()

I = "/*@INSTANCE@*/"
F = "/*@FRAME@*/"
TAB = "\t"
BT = chr(96)

start = s.index("\n\t/**\n\t * [0] only:")
end = s.index("\n\t/** [i] presenter fields:")

block = f"""
\t/**
\t * [0] only: no deferred refresh is inserted, so the frame sentinel is collapsed
\t * away and the instance sentinel becomes the real doc comment. Applies AFTER
\t * frameScope whenever both are in scope, which is why it needs no lookahead.
\t */
\tinstancesOnlyCleanup: {{
\t\tfind: {BT}{TAB}{TAB}{I}\\n{TAB}{TAB}{F}\\n{BT},
\t\treplace: {BT}\\t\\t/** Applies theme snapshots to the document; one instance per module per document. */\\n{BT}
\t}},

\t/**
\t * [ii] frame-coalesced theme-color refresh. Anchored on the pristine ThemePresenter
\t * doc comment so unit (0) does not have to run first; the placeholder alternative
\t * picks it up from unit (0)'s insertion, where the frame sentinel is the only
\t * thing between the instance sentinel and the doc comment.
\t */
\tframeScope: {{
\t\tfind: {BT}{TAB}{TAB}/** Applies theme snapshots to the document; one instance per plugin fiber. */\\n{BT},
\t\treplace: {BT}{{PLACEHOLDER}}{BT}
\t}},

\t/** [0]+[ii]: collapse the leftover instance sentinel into the real doc comment. */
\tmaster: {{
\t\tfind: {BT}{TAB}{TAB}{I}\\n{BT},
\t\treplace: {BT}\\t\\t/** Applies theme snapshots to the document; one instance per module per document. */\\n{BT}
\t}},
"""

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

# frameScope's replacement depends on whether unit (0)'s sentinel is present. The
# generator/apply pipeline only ever applies ONE frameScope variant per scope, so the
# variant is selected by which literal the running text contains. Both variants are
# expressed as a two-entry table so the patch module stays declarative.
variant_a = frame_body + "\t\t/** Applies theme snapshots to the document; one instance per plugin fiber. */\n"
variant_b = frame_body + f"\t\t{I}\n" + "\t\t/** Applies theme snapshots to the document; one instance per plugin fiber. */\n"

block = block.replace("{{PLACEHOLDER}}", "FRAME_SCOPE_BODY")

s = s[:start] + block + s[end:]

# Emit the two variants as a table and make frameScope a small chooser.
s = s.replace(
    "\texport function layoutEdits(scope) {",
    f"""\t/** [ii] block, inserted ahead of the ThemePresenter doc comment. */
\tconst FRAME_SCOPE_A = {BT}{variant_a}{BT};
\t/** Same block when unit (0)'s instance sentinel sits in front of the doc comment. */
\tconst FRAME_SCOPE_B = {BT}{variant_b}{BT};

\texport function layoutEdits(scope) {{""")

s = s.replace(
    f"""\tif (scope.includes("themeColor")) {{
\t\tedits.push({{ key: "frameScope", ...LAYOUT_ANCHORS.frameScope }});
\t\tedits.push({{ key: "master", ...LAYOUT_ANCHORS.master }});""",
    f"""\tif (scope.includes("themeColor")) {{
\t\tedits.push({{ key: "frameScope", ...LAYOUT_ANCHORS.frameScope, replace: scope.includes("instances") ? FRAME_SCOPE_B : FRAME_SCOPE_A }});
\t\tedits.push({{ key: "master", ...LAYOUT_ANCHORS.master }});""")

open(p, 'w', encoding='utf8').write(s)
print("rewritten")
