// WP4 evidence dump: env facts, skills tree hashes, pptmaster provider registrations,
// D1-D4 deployment-action checks. Read-only.
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020";
const B = join(A, "prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
const LEG = "/home/CNS2026495165/.dsh";
const LEG17 = "/home/CNS2026495165/.dsh-017";
const REPO = "/home/CNS2026495165/dsh";

const out = [];
const log = (...a) => out.push(a.join(" "));

// ---------- env ----------
log("## ENV (this probe process)");
for (const k of ["DSH_HOME", "DSH_AGENTS_HOME", "DSH_BUNDLED_SKILL_DIR", "DSH_PPT_DESIGN_SYSTEM_ROOT", "DSH_WORKBUDDY_PPT_SKILL_ROOT", "HOME"]) {
  log(`  ${k} = ${process.env[k] ?? "(unset)"}`);
}

// ---------- skills tree hash (fidelity of the copy) ----------
function treeHash(root) {
  const h = createHash("sha256");
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(p);
      if (st.isDirectory()) walk(p, r);
      else {
        h.update(r);
        h.update(readFileSync(p));
      }
    }
  };
  walk(root, "");
  return h.digest("hex");
}
log("\n## SKILLS TREE HASH (content-addressed copy fidelity)");
for (const [label, root] of [
  ["~/.dsh/skills", join(LEG, "skills")],
  ["~/.dsh-017/skills", join(LEG17, "skills")],
  ["$A/home/skills", join(A, "home/skills")],
]) {
  log(`  ${label.padEnd(18)} exists=${existsSync(root)} sha256=${existsSync(root) ? treeHash(root) : "-"}`);
}

// ---------- pptmaster provider registration points ----------
const ppt = join(A, "home/profiles/node_modules/@local/dsh-pptmaster/lib/index.js");
const pptSrc = readFileSync(ppt, "utf8").split("\n");
log("\n## @local/dsh-pptmaster: ctx.skills.registerProvider(...) call sites");
pptSrc.forEach((line, i) => {
  if (line.includes("registerProvider")) log(`  :${i + 1}  ${line.trim()}`);
});

// ---------- D1-D4 ----------
log("\n## D1: DSH_HOME/skills contents (the 4 dirs)");
for (const d of ["grill-me", "ppt-master", "program-notebook", "session-handoff"]) {
  const p = join(A, "home/skills", d, "SKILL.md");
  log(`  ${d.padEnd(18)} SKILL.md=${existsSync(p)} bytes=${existsSync(p) ? statSync(p).size : "-"}`);
}
log("  undeclared extras in $DSH_HOME/skills: " + JSON.stringify(readdirSync(join(A, "home/skills"))));

log("\n## D2: $DSH_HOME/.agent-presets/standard-glm");
for (const f of ["agent.cordis.yml", "preset.yml"]) {
  const p = join(A, "home/.agent-presets/standard-glm", f);
  const lp = join(LEG, ".agent-presets/standard-glm", f);
  const p17 = join(LEG17, ".agent-presets/standard-glm", f);
  const md5 = (x) => (existsSync(x) ? createHash("md5").update(readFileSync(x)).digest("hex") : "-");
  log(`  ${f.padEnd(18)} assembly=${md5(p)}  ~/.dsh=${md5(lp)}  ~/.dsh-017=${md5(p17)}`);
}

log("\n## D3: preset selector row id");
for (const [label, f] of [
  ["assembly", join(A, "home/profiles/web/cordis.patch.yml")],
  ["~/.dsh (0.1.1)", join(LEG, "profiles/web/cordis.patch.yml")],
  ["~/.dsh-017 (0.1.7)", join(LEG17, "profiles/web/cordis.patch.yml")],
]) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/^-\s*id:\s*agent-presets?(-registry)?\s*$/.test(l.trim()))
      log(`  ${label.padEnd(18)} :${i + 1} ${l.trim()} -> next: ${lines[i + 1]?.trim()} / ${lines[i + 2]?.trim()}`);
  });
}

log("\n## D4: profile bundles + catalog reservation");
const pkg = JSON.parse(readFileSync(join(A, "home/profiles/web/package.json"), "utf8"));
log("  bundles = " + JSON.stringify(pkg.dsh.profile.bundles));
log("  sdk-app in bundles = " + pkg.dsh.profile.bundles.some((b) => b.includes("sdk-app")));

// ---------- presence matrix ----------
log("\n## ASSET PRESENCE MATRIX (skill-visibility lens)");
const rows = [
  ["skills/", "skills"],
  [".agent-presets/", ".agent-presets"],
  ["wallpapers/", "wallpapers"],
  ["taste/", "taste"],
  ["office-ppt/", "office-ppt"],
  ["AGENTS.md", "AGENTS.md"],
  [".agents/skills", ".agents/skills"],
];
for (const [label, rel] of rows) {
  log(
    `  ${label.padEnd(18)} $DSH_HOME=${existsSync(join(A, "home", rel)) ? "HIT" : "MISS"}   ~/.dsh=${existsSync(join(LEG, rel)) ? "HIT" : "MISS"}   ~/.dsh-017=${existsSync(join(LEG17, rel)) ? "HIT" : "MISS"}   $HOME(real)=${existsSync(join("/home/CNS2026495165", rel)) ? "HIT" : "MISS"}`,
  );
}

// ---------- pptmaster/office-ppt reference ----------
log("\n## office-ppt reference roots");
for (const [label, d] of [
  ["~/.dsh-017/office-ppt", join(LEG17, "office-ppt")],
  ["~/.dsh/office-ppt", join(LEG, "office-ppt")],
  ["$A/home/office-ppt", join(A, "home/office-ppt")],
]) {
  log(`  ${label.padEnd(22)} exists=${existsSync(d)} entries=${existsSync(d) ? readdirSync(d).length : "-"}`);
}

// ---------- repo distribution snapshot ----------
log("\n## repo distribution snapshot");
const snap = join(REPO, "agent-skills");
const walkTop = (d, depth = 0) =>
  readdirSync(d)
    .slice(0, 20)
    .map((n) => "  ".repeat(depth) + n)
    .join("\n");
log(`  ${snap}:`);
if (existsSync(snap)) log(readdirSync(snap).map((n) => "    " + n).join("\n"));
log("  git-tracked? " + (() => { try { return execFileSync("git", ["-C", REPO, "ls-files", "agent-skills"], { encoding: "utf8" }).trim().split("\n").length + " files"; } catch (e) { return "ERR " + e.message; } })());

// ---------- DSH_BUNDLED_SKILL_DIR readers/writers across the whole prefix tree ----------
log("\n## DSH_BUNDLED_SKILL_DIR occurrences in prefix tree (writer search)");
try {
  const g = execFileSync("grep", ["-rn", "DSH_BUNDLED_SKILL_DIR", join(A, "prefix-cli-rc2")], { encoding: "utf8" });
  for (const l of g.trim().split("\n")) log("  " + l.replace(A, "$A"));
} catch (e) {
  log("  (no matches / grep rc=" + e.status + ")");
}
void walkTop;
console.log(out.join("\n"));
