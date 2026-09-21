#!/usr/bin/env node
/**
 * run.mjs — R4 host bootstrap 生命周期行为测试（真实候选文件 + 桩边界模块）
 *
 * 关键点：**被测文件是真实的 index.js**（候选产物或 pre-image），只有它的四个边界依赖
 * （db / ingest-dsh / ingest-cc / rpc）被替换成可注入延迟与故障的桩。因此它验证的是
 * 「真实代码在真实控制流下的行为」，而不是把逻辑抄一遍再测。
 *
 * 用法：
 *   node run.mjs --target ../candidate/index.js      # 期望 5/5 PASS
 *   node run.mjs --target ../backup-pre/index.js     # 期望失败（反证测试台有证伪能力）
 */
import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { control, reset, makeCtx, sleep } from './control.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const target = resolve(HERE, argOf('--target', '../candidate/index.js'));

// 被测文件必须与桩模块同级：它静态 import './db.js' / './ingest-dsh.js' / './rpc.js'，
// 放在子目录里会解析失败（曾实测 ERR_MODULE_NOT_FOUND）。因此复制到 harness 根。
copyFileSync(target, resolve(HERE, 'index-under-test.js'));

let seq = 0;
/** 每个用例拿一份新的模块实例（query 打破 ESM 缓存）。 */
const freshApply = async (ctx) => {
  seq += 1;
  const mod = await import(`./index-under-test.js?v=${seq}`);
  mod.apply(ctx);
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const timerMs = (ctx) => ctx._timers.map((t) => t.ms);

// ── 用例 1：正常路径只装一个 45s timer，且 db 已发布 ────────────────────────
{
  reset();
  const ctx = makeCtx();
  await freshApply(ctx);
  await sleep(250);
  check('1 正常路径：db 已发布', control.rpc?.db() != null, `db=${control.rpc?.db() ? 'handle' : 'null'}`);
  check('1 正常路径：恰好一个存活 45s timer', ctx._timers.length === 1 && timerMs(ctx)[0] === 45000 && control.createdTimers === 1, `live=${JSON.stringify(timerMs(ctx))} created=${control.createdTimers}`);
  check('1 正常路径：首扫执行一次', control.foldCalls === 2 && control.ensureSchemaCalls === 1, `foldCalls=${control.foldCalls}(dsh+cc) schema=${control.ensureSchemaCalls}`);
  ctx._dispose();
}

// ── 用例 2：open 期间被卸载 → 不得发布 db、不得装 timer、late DB 必须关闭 ──
{
  reset({ openDelayMs: 80 });
  const ctx = makeCtx();
  await freshApply(ctx);
  ctx._dispose(); // 卸载发生在 openUsageDb 还在 await 期间
  await sleep(300);
  check('2 卸载于 open 期间：late DB 被关闭', control.closedCount === 1 && control.openedDbs.length === 1, `opened=${control.openedDbs.length} closed=${control.closedCount}`);
  check('2 卸载于 open 期间：db 未被发布', control.rpc?.db() == null, `db=${control.rpc?.db() ? 'handle' : 'null'}`);
  check('2 卸载于 open 期间：无存活 timer', ctx._timers.length === 0 && control.createdTimers === 0, `live=${JSON.stringify(timerMs(ctx))} created=${control.createdTimers}`);
  check('2 卸载于 open 期间：未执行首扫', control.foldCalls === 0, `foldCalls=${control.foldCalls}`);
}

// ── 用例 3：首扫期间被卸载 → 不得装 timer ─────────────────────────────────
{
  reset({ ingestDelayMs: 80 });
  const ctx = makeCtx();
  await freshApply(ctx);
  await sleep(150); // open 已完成，首扫在飞行中
  ctx._dispose();
  await sleep(300);
  // 契约是「卸载后不得留下存活轮询」：允许安装后立即被清除（代码里有这条兜底闸门），
  // 但不允许有存活 timer。
  check('3 卸载于首扫期间：无存活 timer', ctx._timers.length === 0, `live=${JSON.stringify(timerMs(ctx))} created=${control.createdTimers} cleared=${control.clearedTimers}`);
  check('3 卸载于首扫期间：db 已关闭并置空', control.closedCount >= 1 && control.rpc?.db() == null, `closed=${control.closedCount} db=${control.rpc?.db() ? 'handle' : 'null'}`);
}

// ── 用例 4：ensureSchema 抛错 → 不得发布半初始化连接，且必须关闭 ──────────
{
  reset({ schemaShouldThrow: true });
  const ctx = makeCtx();
  await freshApply(ctx);
  await sleep(300);
  check('4 schema 失败：db 未被发布（RPC 拿不到半初始化连接）', control.rpc?.db() == null, `db=${control.rpc?.db() ? 'handle' : 'null'}`);
  check('4 schema 失败：打开的连接被关闭（无泄漏）', control.openedDbs.length === 1 && control.closedCount === 1, `opened=${control.openedDbs.length} closed=${control.closedCount}`);
  check('4 schema 失败：未安装 timer、未首扫', ctx._timers.length === 0 && control.createdTimers === 0 && control.foldCalls === 0, `live=${ctx._timers.length} created=${control.createdTimers} foldCalls=${control.foldCalls}`);
}

// ── 用例 5：dispose 之后 ingest 入口必须成为 no-op ────────────────────────
{
  reset();
  const ctx = makeCtx();
  await freshApply(ctx);
  await sleep(250);
  const before = control.foldCalls;
  ctx._dispose();
  await control.rpc.ingest(); // 飞行中的手动 refresh / 已排队 tick
  await sleep(120);
  check('5 dispose 后 ingest 不再执行', control.foldCalls === before, `before=${before} after=${control.foldCalls}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[target] ${target}`);
console.log(`[verdict] ${failed.length === 0 ? 'PASS' : 'FAIL'}  ${results.length - failed.length}/${results.length}`);
const out = resolve(HERE, `result-${failed.length === 0 ? 'candidate' : 'pre'}.json`);
writeFileSync(out, JSON.stringify({ target, results, verdict: failed.length === 0 ? 'PASS' : 'FAIL' }, null, 2) + '\n');
console.log(`[out] ${out}`);
process.exit(failed.length === 0 ? 0 : 1);
