/**
 * T3 —— 测量点③：混合形态替换正确性
 *  3a. ESM 入口 import CJS dep：改 CJS dep → 清 dep 的 loadCache + require.cache → 重 import 入口 → 新值生效
 *  3b. CJS 入口 require ESM dep（Node 22.23.2 免 flag）：改 ESM dep → 清 dep 的 loadCache → 重 import 入口 → 新值生效
 *  3c. ESM 入口 import ESM dep：改 ESM dep → 清 dep 的 loadCache → 重 import 入口 → 新值生效
 * 关键：混合下必须「双缓存同清」——只清一侧会吃到陈旧模块（T1/T2 已证），此处验证入口-依赖双层链路。
 */
import { LoadHost } from "../host/loadHost.js";
import {
  ensureFixtures, writeCjsDep, writeEsmDep,
  writeEsmEntry, writeCjsEntry, writeEsmEntryEsmDep, url,
} from "./fixtures.js";
import { check, summary } from "./assert.js";

ensureFixtures();

async function mixedEsmCjs() {
  // 3a: ESM entry imports CJS dep
  const host = new LoadHost({ strategy: "internal" });
  const entry = url(writeEsmEntry(1));
  const dep = url(writeCjsDep(2));
  const f = await host.load("M1", entry);
  check(f.api.compute(10) === 20, "[3a] entry sees CJS dep factor=2", `compute=${f.api.compute(10)}`);

  // 改 CJS dep → 换纤维（dep 属于变更文件，须进 accepted 集合：入口 + dep 双清缓存）
  writeCjsDep(5);
  const r = await host.hotSwap("M1", entry, undefined, [dep]);
  check(r.ok, "[3a] swap ok");
  check(r.fiber.api.compute(10) === 50, "[3a] ESM->CJS dep refresh via accepted-set clear (now 50)", `compute=${r.fiber.api.compute(10)}`);
  return host;
}

async function mixedCjsEsm() {
  // 3b: CJS entry requires ESM dep (dynamic import inside CJS)
  const host = new LoadHost({ strategy: "internal" });
  const entry = url(writeCjsEntry(1, "-b"));
  const dep = url(writeEsmDep(3, "-b"));
  const f = await host.load("M2", entry);
  check((await f.api.compute(10)) === 30, "[3b] CJS entry sees ESM dep factor=3", `compute=${await f.api.compute(10)}`);

  writeEsmDep(7, "-b");
  const r = await host.hotSwap("M2", entry, undefined, [dep]);
  check(r.ok, "[3b] swap ok");
  check((await r.fiber.api.compute(10)) === 70, "[3b] CJS->ESM dep refresh works (now 70)", `compute=${await r.fiber.api.compute(10)}`);
  return host;
}

async function mixedEsmEsm() {
  const host = new LoadHost({ strategy: "internal" });
  const entry = url(writeEsmEntryEsmDep(1, "-c"));
  const dep = url(writeEsmDep(4, "-c"));
  const f = await host.load("M3", entry);
  check(f.api.compute(10) === 40, "[3c] ESM entry sees ESM dep factor=4", `compute=${f.api.compute(10)}`);
  writeEsmDep(9, "-c");
  const r = await host.hotSwap("M3", entry, undefined, [dep]);
  check(r.ok && r.fiber.api.compute(10) === 90, "[3c] ESM->ESM dep refresh works (now 90)", `compute=${r.fiber.api.compute(10)}`);
  return host;
}

console.log("== T3: mixed CJS<->ESM dependency replacement ==");
await mixedEsmCjs();
await mixedCjsEsm();
await mixedEsmEsm();
const ok = summary("T3");
process.exitCode = ok ? 0 : 1;
