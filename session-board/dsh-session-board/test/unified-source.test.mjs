/**
 * dsh-session-board · test/unified-source.test.mjs —— B2 注入与 query_peers 同源读
 * （FIX-PROPOSAL.md §6.2，按 FIX-AUDIT.md R1 修订：临时文件路径直传 readPeerFile，
 * 不触碰真实 ~/.dsh/session-board/peers/，零污染、零新依赖）。
 *
 * 收敛点：mirrorLoad(gk, ...) / mirrorRead(gk) 以 groupKey 为键，与文件名无关；
 * readPeerFile 签名接受任意 filePath。端到端用例经 createQueryPeersTool 注入全部
 * deps（peerFile 指向临时文件），证明 execute 后镜像与返回值同源。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "../lib/storage.js";
import { createQueryPeersTool } from "../lib/tool.js";

test("query_peers 统一读路径：readPeerFile→mirrorLoad→mirrorRead 与注入侧同源", async () => {
  const gk = "/repo/.git";
  const dir = await mkdtemp(join(tmpdir(), "sb-test-"));
  try {
    const filePath = join(dir, "group.json");
    const peerA = { schemaVersion: 1, sessionId: "a", label: "a", cwd: gk, groupKey: gk,
      isSubagent: false, publishedAt: 1, lastActivityAt: Date.now(), turn: 3,
      goal: null, todos: null, recentFiles: [], recentAssistantTail: "" };
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, groupKey: gk, updatedAt: Date.now(), peers: { a: peerA } }));
    const { readPeerFile, mirrorLoad, mirrorRead } = createStorage();
    assert.deepEqual(mirrorRead(gk), {}); // 镜像未刷新
    const board = await readPeerFile(filePath); // 1) 读磁盘（临时文件，真实读）
    mirrorLoad(gk, board.peers); // 2) 整组替换镜像
    assert.equal(mirrorRead(gk).a.sessionId, "a"); // 3) 与注入侧同源
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("读失败（文件不存在）→ 空组，镜像被清空，不抛", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sb-test-"));
  try {
    const gk = "/no/such/repo";
    const { readPeerFile, mirrorLoad, mirrorRead } = createStorage();
    const board = await readPeerFile(join(dir, "nope.json")); // ENOENT → 空骨架（临时路径，零污染）
    assert.deepEqual(board.peers, {});
    mirrorLoad(gk, board.peers);
    assert.deepEqual(mirrorRead(gk), {}); // query_peers 将返回空 peers
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("端到端：createQueryPeersTool.execute 后镜像与返回值同源（他进程写入可见）", async () => {
  const gk = "/repo/.git";
  const dir = await mkdtemp(join(tmpdir(), "sb-test-"));
  try {
    const filePath = join(dir, "group.json");
    // 模拟「另一进程」写磁盘组文件（peer a；调用方是 self，不会被排除）
    const peerA = { schemaVersion: 1, sessionId: "a", label: "a", cwd: gk, groupKey: gk,
      isSubagent: false, publishedAt: 1, lastActivityAt: Date.now(), turn: 3,
      goal: null, todos: null, recentFiles: [], recentAssistantTail: "" };
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, groupKey: gk, updatedAt: Date.now(), peers: { a: peerA } }));

    const { readPeerFile, mirrorLoad, mirrorRead } = createStorage();
    const tool = createQueryPeersTool({
      current: () => ({ activeWindowMinutes: 30, queryLimit: 5 }),
      groupKeyFor: async () => gk, // 生产中 = groupKeyFor(agent.session)；测试直注入
      peerFile: () => filePath, // 生产中 = sha256(gk) 哈希路径；测试指向临时文件
      readPeerFile,
      mirrorLoad,
      mirrorRead
    });
    const result = await tool.execute({}, { agent: { session: { id: "self" } } });
    assert.equal(result.groupKey, gk);
    // 同源证明：execute 内部 mirrorLoad 已把磁盘 peer 刷进镜像，返回值与 mirrorRead 读到同一份
    assert.equal(mirrorRead(gk).a.sessionId, "a");
    assert.equal(result.peers.length, 1);
    assert.equal(result.peers[0].sessionId, "a");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
