p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/lib/patches.mjs'
s = open(p, encoding='utf8').read()
T = "\t"
NL = chr(10)
DOC = T + T + '/** Applies theme snapshots to the document; one instance per plugin fiber. */' + "\\n"


def sub_once(text, old, new, label):
    n = text.count(old)
    assert n == 1, (label, n, repr(old)[:160])
    return text.replace(old, new, 1)


# (1) FRAME_FILL keeps the doc line it replaces; the frame body is inserted ahead of it.
s = sub_once(
    s,
    'const FRAME_FILL = FRAME_BODY;',
    'const FRAME_FILL = FRAME_BODY + "' + DOC + '";',
    'FRAME_FILL'
)

# (2) frameScope anchors on the pristine doc line and restores it after the frame body.
s = sub_once(
    s,
    '\t\tfind: "' + T + T + '/*@PLACEHOLDER@*/' + '\\n",',
    '\t\t/* The pristine doc line is the anchor: unit (0) leaves a copy of it inside its own\n'
    + '\t\t * block plus the placeholder, and this fill then lands the frame body ahead of it. */\n'
    + '\t\tfind: "' + DOC + '",',
    'frameScope find'
)

# (3) the terminal edit is master whenever (ii) is on: the placeholder is always present
#     then, and master consumes it; the count of terminal edits stays at exactly one.
s = sub_once(
    s,
    '\t\tfind: "' + T + T + '" + I + "' + "\\n" + '",',
    '\t\tfind: "' + T + T + '" + P + "' + "\\n" + '",',
    'master find'
)

# (4) unit (0) alone: drop the frame sentinel AND the placeholder, restore the doc line.
s = sub_once(
    s,
    '\t\tfind: "' + T + T + '" + I + "' + "\\n" + T + T + '" + F + "' + "\\n" + T + T + '" + P + "' + "\\n" + '",',
    '\t\tfind: "' + T + T + '" + F + "' + "\\n" + T + T + '" + P + "' + "\\n',",
    'ioc find'
)

open(p, 'w', encoding='utf8').write(s)
print('rewired ok')
