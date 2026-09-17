/**
 * T4 —— 测量点④：失败回滚（新模块抛错 → 保留旧纤维）
 *  4a. ESM 新版本抛错 → hotSwap 返回 ok:false → registry 仍是旧 fiber、旧值仍可用
 *  4b. CJS 新版本抛错 → 同上
 *  4c. 回滚后再改回好版本 → 恢复成功（证明缓存被正确还原，不会吃到"半死"模块）
 */
import { LoadHost } from "../host/loadHost.js";
import {
  ensureFixtures, writeEsmPlugin, writeEsmBroken,
  writeCjsPlugin, writeCjsBroken, url,
} from "./fixtures.js";
import { check, summary } from "./assert.js";

ensureFixtures();

async function esmRollback() {
  const host = new LoadHost({ strategy: "internal" });
  const spec = url(writeEsmPlugin(1));
  const f1 = await host.load("R1", spec);
  check(f1.api.compute(10) === 10, "[4a] v1 loaded");

  writeEsmBroken(); // 磁盘上是会抛错的新模块（不同文件名？不——热换目标 URL 必须一致，故直接覆写原文件）
  // 用同一 URL 覆写抛错版本：
  const { writeFileSync } = await import("node:fs");
  writeFileSync(spec.split("?")[0].replace("file://", ""), `export const version = 99;\nthrow new Error("boom: new module failed to load");\n`);
  const r = await host.hotSwap("R1", spec);
  check(r.ok === false, "[4a] broken ESM swap fails (ok=false)");
  check(r.error?.message?.includes("boom"), "[4a] error surfaced", String(r.error?.message));
  const still = host.registry.get("R1");
  check(still === f1 && still.api.compute(10) === 10, "[4a] old fiber preserved after rollback", `compute=${still.api.compute(10)}`);

  // 修复后恢复
  const spec2 = url(writeEsmPlugin(3));
  const r2 = await host.hotSwap("R1", spec2);
  check(r2.ok && r2.fiber.api.compute(10) === 30, "[4a] recovers after fixing file (v3)", `compute=${r2.fiber.api.compute(10)}`);
  return host;
}

async function cjsRollback() {
  const host = new LoadHost({ strategy: "internal" });
  const spec = url(writeCjsPlugin(1));
  const f1 = await host.load("R2", spec);
  check(f1.api.compute(10) === 10, "[4b] v1 loaded");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(spec.split("?")[0].replace("file://", ""), `module.exports = { version: 99 };\nthrow new Error("boom-cjs: new module failed to load");\n`);
  const r = await host.hotSwap("R2", spec);
  check(r.ok === false, "[4b] broken CJS swap fails (ok=false)");
  check(host.registry.get("R2") === f1 && f1.api.compute(10) === 10, "[4b] old CJS fiber preserved", `compute=${f1.api.compute(10)}`);
  const spec2 = url(writeCjsPlugin(4));
  const r2 = await host.hotSwap("R2", spec2);
  check(r2.ok && r2.fiber.api.compute(10) === 40, "[4b] CJS recovers after fix (v4)", `compute=${r2.fiber.api.compute(10)}`);
  return host;
}

console.log("== T4: failure rollback ==");
await esmRollback();
await cjsRollback();
const ok = summary("T4");
process.exitCode = ok ? 0 : 1;
