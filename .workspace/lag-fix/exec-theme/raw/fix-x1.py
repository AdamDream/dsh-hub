p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/proof/check-experiment-logic.mjs'
s = open(p, encoding='utf8').read()
NL = chr(10)
T = chr(9)

start = s.index(T + 'const names = [...text.matchAll(')
end = s.index(NL + 'check("X1"', start)
block = NL.join([
    T + 'const names = [...text.matchAll(/^const (INIT|RESET|COLLECT|PROBE|DUMP) = /gm)].map((m) => m[1]);',
    T + 'if (names.length === 0) { check(`X1:${path.basename(file)}`, "page-side function found", false, "none found"); continue; }',
    T + 'for (const name of names) {',
    T + T + 'const startAt = text.indexOf(`const ${name} = (`);',
    T + T + 'const rest = text.slice(startAt);',
    T + T + 'const marker = new RegExp("\\\\n[ " + T + "]*\\\\}\\\\);?");',
    T + T + 'const stop = rest.search(marker);',
    T + T + 'if (stop === -1) { check(`X1:${path.basename(file)}:${name}`, "page-side function terminates", false, "no terminator"); continue; }',
    T + T + 'const source = rest.slice(0, stop + 1).replace(/;$/, "");',
    T + T + 'try {',
    T + T + T + 'const factory = new Function("window", "document", "performance", "requestAnimationFrame", "WebSocket", "Error", "getComputedStyle", "location", `return (${source});`);',
    T + T + T + 'const fn = factory({}, {}, { now: () => 0 }, () => 0, function () { }, Error, () => ({}), {});',
    T + T + T + 'if (typeof fn !== "function") throw new Error("not a function");',
    T + T + T + 'parsed += 1;',
    T + T + '} catch (error) {',
    T + T + T + 'check(`X1:${path.basename(file)}:${name}`, "page-side function parses", false, error.message);',
    T + T + '}',
    T + '}'
])
s = s[:start] + block + s[end + 1:]
open(p, 'w', encoding='utf8').write(s)
print('X1 block rewritten')
