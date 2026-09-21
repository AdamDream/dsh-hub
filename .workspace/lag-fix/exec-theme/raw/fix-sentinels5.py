p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs'
s = open(p, encoding='utf8').read()

I = "/*@INSTANCE@*/"
F = "/*@FRAME@*/"
TAB = "\t"
BT = chr(96)
NL = chr(10)

block = (
    NL + TAB + "/**" + NL
    + TAB + " * [0] only: no deferred refresh is inserted, so the frame sentinel is collapsed" + NL
    + TAB + " * away and the instance sentinel becomes the real doc comment. Applies AFTER" + NL
    + TAB + " * frameScope whenever both are in scope." + NL
    + TAB + " */" + NL
    + TAB + "instancesOnlyCleanup: {" + NL
    + TAB*2 + "find: " + BT + TAB*2 + I + "\\n" + TAB*2 + F + "\\n" + BT + "," + NL
    + TAB*2 + "replace: " + BT + "\\t\\t/** Applies theme snapshots to the document; one instance per module per document. */\\n" + BT + NL
    + TAB + "}," + NL + NL
    + TAB + "/**" + NL
    + TAB + " * [ii] frame-coalesced theme-color refresh. Anchored on the pristine ThemePresenter" + NL
    + TAB + " * doc comment so unit (0) does not have to run first; the selected replacement" + NL
    + TAB + " * variant supplies the block with or without unit (0)'s instance sentinel in front." + NL
    + TAB + " */" + NL
    + TAB + "frameScope: {" + NL
    + TAB*2 + "find: " + BT + TAB*2 + "/** Applies theme snapshots to the document; one instance per plugin fiber. */" + "\\n" + BT + "," + NL
    + TAB*2 + "replace: FRAME_SCOPE_A" + NL
    + TAB + "}," + NL + NL
    + TAB + "/**" + NL
    + TAB + " * [0]+[ii]: collapse the leftover instance sentinel into the real doc comment." + NL
    + TAB + " * The lookahead pins the match to the sentinel that unit (0) inserted, so the" + NL
    + TAB + " * same literal inside an earlier replacement cannot shadow it." + NL
    + TAB + " */" + NL
    + TAB + "master: {" + NL
    + TAB*2 + "find: " + BT + TAB*2 + I + "\\n" + TAB*2 + "(?=/** Applies theme snapshots" + BT + "," + NL
    + TAB*2 + "replace: " + BT + "\\t\\t/** Applies theme snapshots to the document; one instance per module per document. */\\n" + BT + NL
    + TAB + "}," + NL
)

start = s.index(NL + TAB + "/**" + NL + TAB + " * [0] only:")
end = s.index(NL + TAB + "/** [i] presenter fields:")
s = s[:start] + block + s[end:]
open(p, 'w', encoding='utf8').write(s)
print("final sentinel block written")
