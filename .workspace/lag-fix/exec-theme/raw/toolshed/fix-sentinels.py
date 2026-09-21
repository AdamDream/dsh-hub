import re, io

p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs'
s = open(p, encoding='utf8').read()

I = "/*@INSTANCE@*/"
F = "/*@FRAME@*/"
TAB = "\t"
BT = chr(96)

start = s.index("\t/**\n\t * [0] only:")
end = s.index("\t/** [i] presenter fields:")

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

block = f"""\t/**
\t * [0] only: the shared presenter needs no deferred refresh, so the frame sentinel
\t * is dropped and the instance sentinel is collapsed to the real doc comment.
\t * The lookahead keeps the placeholder's line terminator out of the match.
\t */
\tinstancesOnlyCleanup: {{
\t\tfind: {BT}{TAB}{TAB}{I}\\n{TAB}{TAB}(?={F}\\n){BT},
\t\treplace: {BT}\\t\\t/** Applies theme snapshots to the document; one instance per module per document. */\\n{BT}
\t}},

\t/**
\t * [ii] frame-coalesced theme-color refresh. Anchored on the pristine ThemePresenter
\t * doc comment so unit (0) does not have to run first; the first alternative picks
\t * the placeholder up when unit (0) did run.
\t */
\tframeScope: {{
\t\tfind: {BT}{TAB}{TAB}(?={F})|{TAB}{TAB}(?=/\\*\\* Applies theme snapshots to the document; one instance per plugin fiber\\. \\*/\\n){BT},
\t\treplace: {BT}{frame_body}{TAB}{TAB}/** Applies theme snapshots to the document; one instance per plugin fiber. */\\n{BT}
\t}},

\t/** [0]+[ii]: collapse the leftover instance sentinel into the real doc comment. */
\tmaster: {{
\t\tfind: {BT}{TAB}{TAB}{I}\\n{TAB}{TAB}(?=/\\*\\* Applies theme snapshots){BT},
\t\treplace: {BT}\\t\\t/** Applies theme snapshots to the document; one instance per module per document. */\\n{BT}
\t}},

"""

s = s[:start] + block + s[end:]
open(p, 'w', encoding='utf8').write(s)
print("rewritten")
