/**
 * run-all.mjs —— 依次跑 T1..T5，汇总通过/失败。
 * 用法：node --expose-internals --expose-gc run-all.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tests = ["t1-cjs.mjs", "t2-esm.mjs", "t3-mixed.mjs", "t4-rollback.mjs", "t6-hook.mjs", "t7-query-dep.mjs"];

let failed = 0;
for (const t of tests) {
  console.log(`\n===== ${t} =====`);
  const r = spawnSync(process.execPath, ["--expose-internals", "--expose-gc", join(here, "tests", t)], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`>>> ${t} FAILED (exit ${r.status})`);
    failed++;
  }
}

// T5：每个策略独立进程跑，避免 loadCache/RSS 相互污染
for (const strategy of ["internal", "query"]) {
  console.log(`\n===== t5-memory.mjs (${strategy}) =====`);
  const r = spawnSync(process.execPath, ["--expose-internals", "--expose-gc", join(here, "tests", "t5-memory.mjs"), strategy], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`>>> t5 (${strategy}) FAILED (exit ${r.status})`);
    failed++;
  }
}
console.log(`\n===== SUMMARY: ${tests.length + 2 - failed}/${tests.length + 2} runs passed =====`);
process.exitCode = failed ? 1 : 0;
