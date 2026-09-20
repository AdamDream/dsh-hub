/**
 * dsh-session-board · test/grouping-ttl.test.mjs —— B1 分组键 TTL 再解析（FIX-PROPOSAL.md §6.1）
 *
 * 零新增依赖（node:test / node:assert）；经 createGrouping({ ttlMs, resolveKey }) 注入假解析器，
 * 不触真实 git、不等 60s。断言要点：
 * ① TTL 内不发二次解析；② 过期后原子替换且 groupKeySync 同步到新键；
 * ③ onChange 恰好一次、参数 (id, 旧键, 新键)；④ 在飞窗口 groupKeySync 非 undefined；
 * ⑤ 失败保留旧值、groupKeySync 不抖动。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createGrouping } from "../lib/grouping.js";

test("TTL 内复用缓存，过期后原子再解析并触发 onChange", async () => {
  const keys = ["/repo", "/repo/.git"];
  let i = 0;
  const changes = [];
  const { groupKeyFor, groupKeySync } = createGrouping({
    ttlMs: 50,
    resolveKey: async () => keys[i++], // 假解析器：第一次 /repo，之后 /repo/.git
    onChange: (id, o, n) => changes.push([id, o, n])
  });
  const session = { id: "s1", header: { cwd: "/repo" } };

  assert.equal(await groupKeyFor(session), "/repo"); // 首解
  assert.equal(groupKeySync("s1"), "/repo");

  assert.equal(await groupKeyFor(session), "/repo"); // TTL 内：复用，resolveKey 不再调用（i 仍=1）
  assert.equal(i, 1);

  await new Promise((r) => setTimeout(r, 60)); // 等过期
  assert.equal(await groupKeyFor(session), "/repo/.git"); // 过期再解析 → 新键
  assert.equal(groupKeySync("s1"), "/repo/.git"); // 原子替换完成
  assert.deepEqual(changes, [["s1", "/repo", "/repo/.git"]]); // 键变回调一次
});

test("再解析期间 groupKeySync 不抖动；失败保留旧值", async () => {
  let fail = false;
  const { groupKeyFor, groupKeySync } = createGrouping({
    ttlMs: 10,
    resolveKey: async () => {
      if (fail) throw new Error("boom"); // 失败场景
      await new Promise((r) => setTimeout(r, 20)); // 慢解析，暴露「在飞」窗口
      return "/new";
    }
  });
  const session = { id: "s2", header: { cwd: "/r" } };
  assert.equal(await groupKeyFor(session), "/new"); // 首解
  await new Promise((r) => setTimeout(r, 15)); // 过期
  const p = groupKeyFor(session); // 触发再解析（在飞）
  assert.equal(groupKeySync("s2"), "/new"); // 在飞期间仍返回旧值，非 undefined
  await p;

  fail = true;
  await new Promise((r) => setTimeout(r, 15)); // 再次过期
  assert.equal(await groupKeyFor(session), "/new"); // 失败保留旧值
  assert.equal(groupKeySync("s2"), "/new"); // 仍未抖动
});
