// WP4-A / WP4-B: run the REAL 0.2.0-rc.2 dsh-skill-filesystem FileSystemSkillProvider
// against the assembly DSH_HOME. Read-only.
import { resolve as presolve, join } from "node:path";
import { statSync, readdirSync, existsSync } from "node:fs";

const A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020";
const B = join(A, "prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai");
const CWD = "/home/CNS2026495165/dsh";
const DSH_HOME = join(A, "home");

// The resolved bundled skill dir, exactly as the shipped web-app preset computes it.
const baseUrl = "file://" + join(B, "dsh-web-app/presets/cordis.patch.yml");
const mod = process.getBuiltinModule("node:module");
const path = process.getBuiltinModule("node:path");
const customFromShippedPreset = [
  path.join(
    path.dirname(mod.createRequire(baseUrl).resolve("@deepseek-ai/dsh-agent-preset/package.json")),
    "skills",
  ),
];

const providerMod = await import(presolve(B, "dsh-skill-filesystem/lib/index.js"));

const warnings = [];
function makeCtx() {
  return {
    get: () => undefined, // no ctx.fs -> Node fs fallback
    logger: { warn: (...a) => warnings.push(a.map(String).join(" ")) },
    on: () => {},
    effect: () => () => {},
  };
}

function makeProvider(cfg) {
  return new providerMod.FileSystemSkillProvider(
    makeCtx(),
    { signal: new AbortController().signal, invalidate: () => {} },
    { watch: false, dshHome: DSH_HOME, ...cfg },
  );
}

function describePath(p) {
  if (!existsSync(p)) return "MISSING";
  const st = statSync(p);
  if (!st.isDirectory()) return "not-a-dir";
  const entries = readdirSync(p).filter((n) => !n.startsWith("."));
  return `dir, ${entries.length} visible entries`;
}

function report(title, cfg) {
  console.log(`\n########## ${title} ##########`);
  console.log(`config: ${JSON.stringify(cfg)}`);
  return makeProvider(cfg);
}

// ---------- Scenario 1: this deployment (profile patch gives no customSkillDirs) ----------
let p = report("SCENARIO 1 = assembled deployment (host/preset skill-filesystem, no customSkillDirs)", {});

// Scenario 2: shipped web-app preset default (customSkillDirs -> dsh-agent-preset/skills)
const p2 = report("SCENARIO 2 = shipped web-app preset default (customSkillDirs = dsh-agent-preset/skills)", {
  customSkillDirs: customFromShippedPreset,
});

// Scenario 3: with DSH_BUNDLED_SKILL_DIR set (proves the env hook)
const p3 = report("SCENARIO 3 = DSH_BUNDLED_SKILL_DIR explicitly set to dsh-agent-preset/skills", {
  bundledSkillDir: customFromShippedPreset[0],
});

for (const [label, prov] of [
  ["SCENARIO 1 (deployment)", p],
  ["SCENARIO 2 (shipped preset customSkillDirs)", p2],
  ["SCENARIO 3 (bundledSkillDir)", p3],
]) {
  console.log(`\n===== ROOTS / ${label} / cwd=${CWD} =====`);
  const roots = await prov.roots(CWD);
  for (const r of roots) {
    console.log(
      `  rank=${String(r.rank).padStart(3)} source=${String(r.source).padEnd(14)} skipSystem=${!!r.skipSystem} hit=${describePath(r.path)}  ${r.path}`,
    );
  }
}

// ---------- B: per-skill load via list()/get() for the 4 migrated skills ----------
console.log("\n\n########## WP4-B: per-skill load (SCENARIO 1, real provider) ##########");
const listRaw = await p.list({ cwd: CWD });
const candidates = Array.isArray(listRaw) ? listRaw : listRaw.candidates;
console.log(`list() complete=${Array.isArray(listRaw) ? "(plain array => complete)" : listRaw.complete} candidates=${candidates.length}`);

const rows = [];
for (const c of candidates.slice().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))) {
  const row = { name: c.name, rank: c.rank, source: c.source, locator: c.locator.path ?? c.locator };
  try {
    const def = await p.get(c, {});
    if (def === undefined) {
      row.status = "get()->undefined";
    } else {
      row.status = "OK";
      row.modelInvocable = def.invocation?.modelInvocable;
      row.userInvocable = def.invocation?.userInvocable;
      row.version = def.metadata?.version ?? "(none)";
      row.metadataKeys = def.metadata ? Object.keys(def.metadata).join(",") : "(none)";
      row.bodyLen = def.content.length;
      row.resourceBase = def.resourceBase?.path;
    }
  } catch (e) {
    row.status = "THROWS " + e.message;
  }
  rows.push(row);
}
for (const r of rows) {
  console.log(
    `  ${r.name.padEnd(26)} rank=${String(r.rank).padStart(3)} source=${String(r.source).padEnd(10)} ${String(r.status).padEnd(9)} model=${r.modelInvocable} user=${r.userInvocable} version=${r.version} meta=[${r.metadataKeys}] bodyLen=${r.bodyLen ?? "-"}`,
  );
}

console.log(`\n== provider warnings (SCENARIO 1): ${warnings.length} ==`);
for (const w of warnings) console.log("  WARN " + w);

// Scenario 2 candidate names (to answer D: are bundled cordis skills visible?)
const list2 = await p2.list({ cwd: CWD });
const cands2 = Array.isArray(list2) ? list2 : list2.candidates;
console.log(`\n########## SCENARIO 2 candidates (${cands2.length}) ##########`);
for (const c of cands2.slice().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))) {
  console.log(`  ${c.name.padEnd(30)} rank=${String(c.rank).padStart(3)} source=${String(c.source).padEnd(10)} ${c.locator.path ?? c.locator}`);
}

// ---------- machinery checks ----------
console.log("\n\n########## machinery ##########");
console.log("findProjectRoot semantics come from the CLI build:", typeof presolve);
const { execSync } = process.getBuiltinModule("node:child_process");
console.log("cwd .git present:", existsSync(join("/home/CNS2026495165/dsh", ".git")), "-> project root for cwd is /home/CNS2026495165/dsh");
console.log(".dsh/skills under repo root:", describePath(join("/home/CNS2026495165/dsh", ".dsh/skills")));
console.log(".agents/skills under repo root:", describePath(join("/home/CNS2026495165/dsh", ".agents/skills")));
console.log("DSH_AGENTS_HOME env:", process.env.DSH_AGENTS_HOME ?? "(unset)");
console.log("homedir():", (await import("node:os")).homedir());
console.log("DSH_BUNDLED_SKILL_DIR env:", process.env.DSH_BUNDLED_SKILL_DIR ?? "(unset)");
console.log("repo agent-skills/:", describePath("/home/CNS2026495165/dsh/agent-skills"));
void execSync;
