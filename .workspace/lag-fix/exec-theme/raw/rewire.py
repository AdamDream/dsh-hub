p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs'
s = open(p, encoding='utf8').read()
T = "\t"
NL = chr(10)


def sub_once(text, old, new, label):
    n = text.count(old)
    assert n == 1, (label, n)
    return text.replace(old, new, 1)


# (1) the two FRAME_SCOPE_* constants become one FRAME_FILL
old_consts = (
    '/** [ii] block when unit (0) is OFF: the pristine doc line is replaced by the frame block. */' + NL
    + 'const FRAME_SCOPE_A = FRAME_BODY + "' + T + T + '/** Applies theme snapshots to the document; one instance per plugin fiber. */' + "\\n" + '";' + NL + NL
    + '/** [ii] block when unit (0) is ON: keep its instance sentinel ahead of the doc line. */' + NL
    + 'const FRAME_SCOPE_B = FRAME_BODY + "' + T + T + '" + I + "' + "\\n" + T + T + '/** Applies theme snapshots to the document; one instance per plugin fiber. */' + "\\n" + '";'
)
new_consts = (
    '/**' + NL
    + ' * [ii] fill: the frame block alone. It is substituted for the placeholder line, and the' + NL
    + ' * ThemePresenter doc line written in front of that placeholder stays in place, so one' + NL
    + ' * fill serves whether or not unit (0) inserted the instance sentinel.' + NL
    + ' */' + NL
    + 'const FRAME_FILL = FRAME_BODY;'
)
s = sub_once(s, old_consts, new_consts, 'consts')

# (2) frameScope replacement
s = sub_once(s, '\t\treplace: FRAME_SCOPE_A' + NL + '\t},', '\t\treplace: FRAME_FILL' + NL + '\t},', 'frameScope replace')

# (3) instancesOnlyCleanup must also consume the placeholder line
s = sub_once(
    s,
    '\t\tfind: "' + T + T + '" + I + "' + "\\n" + T + T + '" + F + "' + "\\n" + '",',
    '\t\tfind: "' + T + T + '" + I + "' + "\\n" + T + T + '" + F + "' + "\\n" + T + T + '" + P + "' + "\\n" + '",',
    'ioc find'
)

# (4) master no longer needs a lookahead: the placeholder follows the instance sentinel
s = sub_once(
    s,
    '\t\tfind: "' + T + T + '" + I + "' + "\\n" + T + T + '(?=/** Applies theme snapshots",',
    '\t\tfind: "' + T + T + '" + I + "' + "\\n" + '",',
    'master find'
)

open(p, 'w', encoding='utf8').write(s)
print('rewired ok')
