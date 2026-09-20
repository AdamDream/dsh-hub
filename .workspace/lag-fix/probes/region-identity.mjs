// 独立核对：本补丁命中的 4 个区域在两侧是否**逐字节相同**（决定「是否需要合并」）
import { readFileSync } from "node:fs";
const SRC = "/home/CNS2026495165/dsh/dsh-usage/lib/";
const DEP = "/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/";
const spec = readFileSync("patches/usage-plugin.replacements.txt", "utf8");
const blocks = {}; let cur = null, pair = null;
for (const raw of spec.split("\n")) {
  const line = raw.replace(/\r$/, "");
  if (line.startsWith("@@JOB ")) { cur = { pairs: [] }; blocks[line.slice(6).trim()] = cur; pair = null; }
  else if (line.startsWith("@@OLD") && cur) { pair = { old: [], new: [], sect: "old" }; cur.pairs.push(pair); }
  else if (line.startsWith("@@NEW") && pair) pair.sect = "new";
  else if (pair && (pair.sect === "old" || pair.sect === "new")) pair[pair.sect].push(line);
}
const fileOf = { "db-route": "db.js", "db-rebuild": "db.js", "client-range": "client.js", "client-poll": "client.js" };
const load = (base) => ({ "db.js": readFileSync(base + "db.js", "utf8"), "client.js": readFileSync(base + "client.js", "utf8") });
const s = load(SRC), d = load(DEP);
let allIdentical = true, total = 0;
console.log("区域 = 每个替换点的 OLD 块（补丁命中的原文）在两侧是否逐字节相同：\n");
for (const job of Object.keys(fileOf)) {
  const f = fileOf[job];
  blocks[job].pairs.forEach((p, i) => {
    const old = p.old.join("\n") + "\n";
    const inSrc = s[f].includes(old), inDep = d[f].includes(old);
    total++;
    const same = inSrc && inDep;
    if (!same) allIdentical = false;
    console.log(`  [${same ? "逐字节相同" : "不一致"}] ${job} #${i} (${f}) src=${inSrc} dep=${inDep} 行数=${p.old.length}`);
  });
}
console.log(`\n共 ${total} 个替换区域，两侧逐字节相同 = ${allIdentical}`);
console.log(allIdentical
  ? "→ 结论：补丁命中的区域两侧完全一致，**不存在需要合并的冲突**；两侧各自应用同一份补丁即可。"
  : "→ 结论：存在区域级差异，必须人工合并（不得盲覆盖）。");
// 额外：两侧在这些区域之外的差异行数（供报告引用）
process.exit(allIdentical ? 0 : 1);
