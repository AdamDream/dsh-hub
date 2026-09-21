p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs'
s = open(p, encoding='utf8').read()

I = "/*@INSTANCE@*/"
F = "/*@FRAME@*/"
TAB = "\t"
BT = chr(96)
NL = chr(10)


def lit(text):
    """Render a Python string as a JS template literal body: real tabs/newlines stay."""
    return text


frame_body = (
    TAB*2 + "/** Render callbacks coalesced into one per animation frame (see scheduleThemeColorRefresh). */" + NL
    + TAB*2 + "const themeColorRefreshQueue = /* @__PURE__ */ new Map();" + NL
    + TAB*2 + "let themeColorFrame = 0;" + NL
    + TAB*2 + "/**" + NL
    + TAB*2 + " * Run one theme-color refresh per animation frame." + NL
    + TAB*2 + " * Reading the computed body background forces a synchronous style" + NL
    + TAB*2 + " * recalculation, so it must not run once per snapshot inside the publish" + NL
    + TAB*2 + " * dispatch: a frame boundary merges a whole dispatch round (and every" + NL
    + TAB*2 + " * presenter) into a single read, taken after all writers are done. When the" + NL
    + TAB*2 + " * host cannot schedule frames the refresh runs inline, which preserves the" + NL
    + TAB*2 + " * previous behaviour there." + NL
    + TAB*2 + " * @param win - the window the presenter writes into." + NL
    + TAB*2 + " * @param presenter - the presenter to refresh." + NL
    + TAB*2 + " */" + NL
    + TAB*2 + "function scheduleThemeColorRefresh(win, presenter) {" + NL
    + TAB*3 + "const winRef = win ?? globalThis;" + NL
    + TAB*3 + "const request = winRef.requestAnimationFrame;" + NL
    + TAB*3 + 'if (typeof request !== "function") {' + NL
    + TAB*4 + "presenter.refreshThemeColor();" + NL
    + TAB*4 + "return;" + NL
    + TAB*3 + "}" + NL
    + TAB*3 + "let queued = themeColorRefreshQueue.get(winRef);" + NL
    + TAB*3 + "if (queued === void 0) {" + NL
    + TAB*4 + "queued = /* @__PURE__ */ new Set();" + NL
    + TAB*4 + "themeColorRefreshQueue.set(winRef, queued);" + NL
    + TAB*3 + "}" + NL
    + TAB*3 + "queued.add(presenter);" + NL
    + TAB*3 + "if (themeColorFrame !== 0) return;" + NL
    + TAB*3 + "themeColorFrame = request.call(winRef, () => {" + NL
    + TAB*4 + "themeColorFrame = 0;" + NL
    + TAB*4 + "const pending = queued;" + NL
    + TAB*4 + "themeColorRefreshQueue.delete(winRef);" + NL
    + TAB*4 + "for (const item of pending) item.refreshThemeColor();" + NL
    + TAB*3 + "});" + NL
    + TAB*2 + "}" + NL
)

DOC = TAB*2 + "/** Applies theme snapshots to the document; one instance per plugin fiber. */" + NL
DOCF_BODY = "\\t\\t/** Applies theme snapshots to the document; one instance per module per document. */\\n"

block = (
    NL + TAB + "/**" + NL
    + TAB + " * [0] only: no deferred refresh is inserted, so the frame sentinel is collapsed" + NL
    + TAB + " * away and the instance sentinel becomes the real doc comment. Applies AFTER" + NL
    + TAB + " * frameScope whenever both are in scope." + NL
    + TAB + " */" + NL
    + TAB + "instancesOnlyCleanup: {" + NL
    + TAB*2 + "find: " + BT + TAB*2 + I + "\\n" + TAB*2 + F + "\\n" + BT + "," + NL
    + TAB*2 + "replace: " + BT + DOCF_BODY + BT + NL
    + TAB + "}," + NL + NL
    + TAB + "/**" + NL
    + TAB + " * [ii] frame-coalesced theme-color refresh. Anchored on the pristine ThemePresenter" + NL
    + TAB + " * doc comment so unit (0) does not have to run first; the chosen replacement variant" + NL
    + TAB + " * supplies the block with or without unit (0)'s instance sentinel in front." + NL
    + TAB + " */" + NL
    + TAB + "frameScope: {" + NL
    + TAB*2 + "find: " + BT + TAB*2 + "/** Applies theme snapshots to the document; one instance per plugin fiber. */" + "\\n" + BT + "," + NL
    + TAB*2 + "replace: FRAME_SCOPE_A" + NL
    + TAB + "}," + NL + NL
    + TAB + "/** [0]+[ii]: collapse the leftover instance sentinel into the real doc comment. */" + NL
    + TAB + "master: {" + NL
    + TAB*2 + "find: " + BT + TAB*2 + I + "\\n" + BT + "," + NL
    + TAB*2 + "replace: " + BT + DOCF_BODY + BT + NL
    + TAB + "}," + NL
)

start = s.index(NL + TAB + "/**" + NL + TAB + " * [0] only:")
end = s.index(NL + TAB + "/** [i] presenter fields:")
s = s[:start] + block + s[end:]

table = (
    "/** [ii] block, inserted ahead of the pristine ThemePresenter doc comment. */" + NL
    + "const FRAME_SCOPE_A = " + BT + frame_body + DOC + BT + ";" + NL
    + "/** Same block when unit (0)'s instance sentinel sits in front of the doc comment. */" + NL
    + "const FRAME_SCOPE_B = " + BT + frame_body + TAB*2 + I + NL + DOC + BT + ";" + NL + NL
)
marker = "/**\n * Emit the layout edit list for a scope."
if "const FRAME_SCOPE_A = " not in s:
    assert s.count(marker) == 1, s.count(marker)
    s = s.replace(marker, table + marker, 1)

open(p, 'w', encoding='utf8').write(s)
print("rewritten ok")
