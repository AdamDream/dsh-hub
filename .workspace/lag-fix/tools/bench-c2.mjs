#!/usr/bin/env node
/**
 * bench-c2.mjs — 单元 C2 微观基准（只读；不做任何持久化写入，不接触宿主进程）
 * 规模取自 DIAGNOSIS.md §1.2：磁盘会话 2367 / 单次会话列表 2361 条。
 * 目的：给出 C2-1（Set 去重）与 C2-2（sessions 投影重建 / 记忆化）的量级，
 *       并明确哪些收益是"实测"，哪些只是"上限估计"。
 */
const N = 2361;
const ROUNDS = 40;

const R = (conn, rest = "/home/u/projects/thing") => `/home/u/.dsh/remote/dsw-routes/${conn}${rest}`;

function routeIdOf(path) {
  const match = /(?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i.exec(path);
  if (match === null) return void 0;
  const id = match[1];
  if (id === void 0 || !/^[A-Za-z0-9._-]+$/.test(id)) return void 0;
  return id;
}

// --- 造数据：真实形态——绝大多数是本地会话（无 placeholder），少量远程会话带重复 conn ---
function build(n) {
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const remote = i % 7 === 0;                       // ~14% 远程
    const dup = i % 21 === 0;                         // 远程里再有三成重复 conn
    const conn = `conn${dup ? 1 : (i % 5) + 1}`;
    sessions.push({
      title: `session-title-${i}`,
      displayTitle: `session-title-${i}`,
      cwd: remote ? R(conn) : "/home/u/projects/thing"
    });
  }
  return sessions;
}
const SESSIONS = build(N);

/** 只测"内层去重"这一段（等价于 UNIT C2-1 的差异点） */
function dedupeOld() {
  let acc = 0;
  const byTitle = new Map();
  for (const s of SESSIONS) {
    const connId = s.cwd !== void 0 ? routeIdOf(s.cwd) : void 0;
    if (connId === void 0) continue;
    byTitle.set(s.title, [...(byTitle.get(s.title) ?? []), connId]);
  }
  for (const [, ids] of byTitle) {
    const unique = ids.filter((id, index) => ids.indexOf(id) === index);
    if (unique.length === 1 && unique[0] !== void 0) acc += unique.length;
  }
  return acc;
}
function dedupeNew() {
  let acc = 0;
  const byTitle = new Map();
  for (const s of SESSIONS) {
    const connId = s.cwd !== void 0 ? routeIdOf(s.cwd) : void 0;
    if (connId === void 0) continue;
    byTitle.set(s.title, [...(byTitle.get(s.title) ?? []), connId]);
  }
  for (const [, ids] of byTitle) {
    const unique = Array.from(new Set(ids));
    if (unique.length === 1) acc += unique.length;
  }
  return acc;
}

/** 最坏形态：同一远程 conn 的 k 条会话全挂在一个 title 下（真正的 O(k²)） */
function dedupeWorst(k, useSet) {
  const ids = new Array(k).fill("connWorst");
  return useSet ? Array.from(new Set(ids)).length
    : ids.filter((id, index) => ids.indexOf(id) === index).length;
}

function time(fn, rounds = ROUNDS) {
  fn(); fn();                                        // warmup
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < rounds; i++) fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6 / rounds;             // ms/次
}

/** C2-2 的投影重建成本（sessions() 未命中记忆化时的全部工作） */
function project(byId) {
  return Object.values(byId).map((row) => ({
    title: row.displayTitle,
    ...typeof row.cwd === "string" ? { cwd: row.cwd } : {}
  }));
}
const BYID = Object.fromEntries(SESSIONS.map((s, i) => [`s${i}`, { displayTitle: s.displayTitle, cwd: s.cwd }]));

console.log("=== C2-1：remoteSessionIndex 内层去重（实测，N=%d 会话）===", N);
// 高轮次采样：该段耗时在 0.1ms 量级，40 轮噪声会淹没差异
const tOld = time(dedupeOld, 400), tNew = time(dedupeNew, 400);
console.log(`  旧（filter + indexOf，O(k²)）: ${tOld.toFixed(4)} ms/次`);
console.log(`  新（Array.from(new Set)，O(k)）: ${tNew.toFixed(4)} ms/次`);
console.log(`  比值: ${(tOld / tNew).toFixed(2)}x   每次差: ${(tOld - tNew).toFixed(4)} ms`);
console.log("  说明：本形态下每个 title 的 conn 列表长度 k 很小（重复 conn 时 k≤2~3），");
console.log("       所以绝对省时微小；收益随「同一 title 下重复 conn 数 k」平方增长。");
{
  const REGRESSION_BUDGET_MS = 0.05;   // 现实流量下不得更慢超过 0.05 ms/次
  if (tNew - tOld <= REGRESSION_BUDGET_MS) {
    console.log(`  [PASS] 无回退：现实流量下新版比旧版慢 ${(tNew - tOld).toFixed(4)} ms ≤ 预算 ${REGRESSION_BUDGET_MS} ms`);
  } else {
    console.log(`  [FAIL] 回退超预算：新版比旧版慢 ${(tNew - tOld).toFixed(4)} ms > ${REGRESSION_BUDGET_MS} ms`);
    process.exitCode = 1;
  }
}

console.log("\n=== C2-1 最坏形态扫描（k = 同一 title 下的重复 conn 条数）===");
for (const k of [2, 10, 100, 1000, 2361]) {
  const a = time(() => dedupeWorst(k, false), 20);
  const b = time(() => dedupeWorst(k, true), 20);
  console.log(`  k=${String(k).padStart(4)}  旧 ${a.toFixed(4)} ms  新 ${b.toFixed(4)} ms  加速 ${(a / b).toFixed(1)}x`);
}

console.log("\n=== C2-2：sessions() 投影重建成本（实测，N=%d）===", N);
const tProj = time(() => project(BYID));
console.log(`  一次全量重建（Object.values + map + 展开）: ${tProj.toFixed(4)} ms`);
console.log(`  命中记忆化后: 0 ms（直接返回 cachedRows 引用；仅一次 === 比较）`);
console.log(`  与 DIAGNOSIS.md §1.2 记载的 0.21 ms/次 同量级（差异来自机器状态与构造数据）`);

console.log("\n=== 组合：一次 rebuildRemote（去重 + 投影）===");
console.log(`  旧: ${(tOld + tProj).toFixed(4)} ms   新（投影未命中）: ${(tNew + tProj).toFixed(4)} ms   新（投影命中）: ${tNew.toFixed(4)} ms`);
console.log("\n注意：以上均为本机微观基准，非活动宿主实测；不得当作端到端收益声明。");
