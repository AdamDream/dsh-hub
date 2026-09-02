# dsh-session-board 修复方案审计（FIX-AUDIT.md）

> 审计对象：`FIX-PROPOSAL.md`（2026-09-02 版）
> 源码根：`/home/CNS2026495165/dsh/session-board/dsh-session-board/lib/*.js` + `CONTRACT.md` + `README.md`
> 结论先行：**需修订**。B1/B2 核心机制设计正确、可落地；两处需按修订指令修正后方可交执行者照办。

---

## 一、结论

| 维度 | 结论 |
|---|---|
| B1 分组键 TTL 再解析 | **通过**（不抖动 / 失败保旧值 / 原子替换 / 挂 refreshLiveGroups 均成立） |
| B2 注入与 query_peers 同源 | **通过**（readPeerFile→mirrorLoad→mirrorRead 收敛成立，失败语义与防越组读保留） |
| 文档同步（CONTRACT/README/FIX-NOTES） | **部分需修订**（CONTRACT 行号全对；README retention 表述失真；FIX-NOTES 未列入交付清单） |
| 测试设计 | **需修订**（test b 第一个用例不可执行，见 D1） |
| 整体 | **需修订**（非否决：核心方案无方向性错误，仅落地细节需修正） |

---

## 二、核验表（源码逐条对照）

### 2.1 现状描述与行号核对

| # | 提案论断 | 源码核对 | 判定 |
|---|---|---|---|
| 1 | `grouping.js:102-132` `resolved` 首解后回填、经 `pending` 去重永不再解析 | `createGrouping` L102、`resolved` 回填 L126、`pending` 去重 L122-131 | ✅ 属实 |
| 2 | `groupKeySync`（`grouping.js:140-142`）只读 `resolved` | L140-142 `return resolved.get(sessionId)` | ✅ 属实 |
| 3 | `refreshLiveGroups`（`index.js:152-155`）→ `refreshGroup`（`index.js:143-150`）→ `groupKeyFor` | 完全对应 | ✅ 属实 |
| 4 | `refreshIntervalSeconds` 默认 10s（`index.js:127-131`） | L127-131 `setInterval(refreshLiveGroups, ...)` | ✅ 属实 |
| 5 | `createGrouping` 装配（`index.js:86`）、`createQueryPeersTool` 装配（`index.js:96`）、`mirrorLoad/mirrorRead` 解构（`index.js:87`） | L86/87/96 完全对应 | ✅ 属实 |
| 6 | `mirrorSet` 仅在上盘成功后执行（`index.js:112-113`） | L112 `await upsertPeer` → L113 `mirrorSet` | ✅ 属实 |
| 7 | `query_peers` 读盘（`tool.js:182-184`）、无 agent 抛错（`tool.js:180`）、deps 解构（`tool.js:149-150`）、JSDoc（`tool.js:141-146`） | 完全对应 | ✅ 属实 |
| 8 | `renderBoardFor`（`inject.js:71-89`）、`mirrorRead`（`inject.js:74-77`，实际调用在 L77）、永不 throw 返回 `""`（`inject.js:86-88`） | L71-89 完全对应 | ✅ 属实（L74-77 区间表述可接受） |
| 9 | `storage.js`：`mirrorRead` 无回退（243-246）、`readPeerFile`（127-156）、空骨架兜底（131-135/140-142）、`mirrorLoad`（230-236）、`upsertPeer`（182-198）、`pruneRetention`（166-172）、`RETENTION_MS`（71）、`peerFile`（96-99） | 全部逐行命中 | ✅ 属实 |
| 10 | CONTRACT.md 引用行号：65-70 / 83-88 / 91-96 / 106-110 / 464-473 / 501 / 502 / 604-617 / 654-661 | 全部逐行命中（§1.1/§1.6/§3） | ✅ 属实 |
| 11 | README.md「已知限制」末尾 = `README.md:36`（全文件 36 行） | 第 36 行即末行 | ✅ 属实 |

**结论：提案对现状的描述与全部行号/函数签名均属实，无一处凭空捏造。**

### 2.2 B1 设计核对（硬性要求逐条）

| 要求 | 提案实现手法 | 核对 | 判定 |
|---|---|---|---|
| 不新增线程/定时器类别 | 挂 `refreshLiveGroups`（既有 `ctx.effect` setInterval，L127-131），`refreshGroup` 内 `await groupKeyFor` 在 TTL 过期时自动再解析 | `groupKeyFor` 只被既有调用点（publish / query_peers / refreshGroup）触发，无新 timer | ✅ |
| 再解析期间 groupKeySync 绝不 undefined | `resolved` 仅在 `resolveKey` 成功后 `set`；解析期间不预清空；`groupKeySync` 只读 `resolved` | `resolved.set` 在 `await resolveKey` 之后、`groupKeySync` 只 `resolved.get` | ✅ |
| 失败保留旧值 | `catch` 返回 `prev ?? "no-cwd"`，`resolved`/`resolvedAt` 不动 → 下轮重试 | `catch` 分支不写任何 Map | ✅（注：生产 `resolveGroupKey` 永不 throw，此路径实为防御/测试注入用，无害） |
| 原子替换 | 成功后才 `resolved.set + resolvedAt.set`，键变才 `onChange` | `resolved` 无预清空、无中间态 | ✅ |
| 键变记 warn（含旧键→新键 + sessionId） | `onChange` 回调经 `(ctx.logger?.warn ?? console.warn)(...)`，index.js 装配注入 | 含 `sessionId`/`oldKey`/`newKey`，兼作未解异常定位 | ✅ |
| TTL 时长论证 | 60s 模块常量，不入 Config，与 `RETENTION_MS` 先例一致，成本/收敛平衡 | 理由充分；经 `deps.ttlMs` 可缩短供测试 | ✅ |

并发去重核实：`pending.get → pending.set` 之间**无 await**（§2.1 代码 L99-122 全为同步路径），同一 tick 内多次调用共享同一在飞 Promise；`p.then(clear, clear)` settle 后清除。✅ 正确。

### 2.3 B2 设计核对（硬性要求逐条）

| 要求 | 提案实现手法 | 核对 | 判定 |
|---|---|---|---|
| 注入与 query_peers 收敛同源 | query_peers 改 `readPeerFile(peerFile(gk)) → mirrorLoad(gk, file.peers) → mirrorRead(gk)`，与注入侧 `mirrorRead` 同源 | 两条路径最终都读 `mirror` | ✅ |
| 注入永不 throw 返回 `""` | inject.js 不改 | L86-88 try/catch 保留 | ✅ |
| query_peers 无 agent 抛错 | `tool.js:180` 保持不变 | L180 不动 | ✅ |
| 读失败按空组 | `readPeerFile` 永不 reject → 空骨架 → `mirrorLoad(gk,{})` → `mirrorRead(gk)=={}` → peers=[] | 语义与现状一致 | ✅ |
| 防越组读不放松 | `groupKey` 仍仅 `groupKeyFor(agent.session)`；`mirrorLoad/mirrorRead` 只操作该键 | 无外部路径入参 | ✅ |
| 防御过滤不回归 | §2.3 代码保留 `.filter(p => p !== null && typeof p === "object")` | 与现状 L191 一致 | ✅ |

关键不变式核实：**「镜像 ⊆ 磁盘」成立**——`mirrorSet` 仅在 `upsertPeer`（磁盘写）成功后执行（index.js L112-113），故 `mirrorLoad`（镜像=磁盘快照）不会丢任何已落盘有效条目，query_peers 新增 `mirrorLoad` 副作用无回归。✅

### 2.4 回归点核对

| 回归点 | 核对结论 |
|---|---|
| Channel A pre-step 路径 | `renderBoardFor` 用 `groupKeySync`，再解析期间返回旧值（非 undefined），板稳定；键切换后经 refreshGroup/query_peers 的 mirrorLoad 切到新键镜像。无回归。✅ |
| mirrorLoad 整组替换对并发发布 | 见上「镜像 ⊆ 磁盘」不变式；与 refreshGroup 既有每 10s 语义同源，无新风险类。✅ |
| retention 交互 | **表述需修正**，见缺陷 D2。 |

---

## 三、缺陷分级

| 级别 | 编号 | 位置 | 描述 | 是否阻断 |
|---|---|---|---|---|
| **D1（阻断）** | 测试不可执行 | §6.2 `test/unified-source.test.mjs` 第一个用例 | 断言 `got.a.sessionId === "a"` 但**从未把 peerA 写盘**；`peerFile(gk)` 指向真实 `~/.dsh/session-board/peers/`（`homeDir()` 读 `DSH_HOME ?? ~/.dsh`），`mkdir(join(dir,"peers"))` 与 peerFile 路径无关（是 temp 下的 `peers`，而 peerFile 是 `<home>/session-board/peers/`）；提案自注「无需写盘」与断言自相矛盾 → 该用例**必失败**或污染真实 home。 | 是 |
| **D2（文档失真）** | retention「自然过期」表述不准确 | §3 边界表、§5 README 新增段、FIX-NOTES.md L35-36 | `pruneRetention` 只在 `upsertPeer` 内触发（storage.js L194），即**仅在同键下一次发布时清理**。组迁移后旧键文件不再被写入 → retention **永不**在该文件上运行 → 孤儿条目不会「7 天自然过期」，而是**永久留存**（无害死文件：无会话再读旧键）。「靠 7 天 retention 自然过期」的机制表述不成立，需改为「不再写入、不再被读，无害；如需回收需手动删除」。 | 否（仅文档准确性） |
| **D3（轻微）** | FIX-NOTES.md 未列入交付清单 | 提案全文无 FIX-NOTES.md 的交付条目 | 任务需求 3 明确要求新增 FIX-NOTES.md；该文件虽已存在且与诊断一致，但提案作为完整计划应显式列出其「新增/更新」动作，否则执行者可能漏同步。 | 否 |
| **N1（可选 nit）** | CONTRACT §1.6 step-4 简化表述 | §4.2 第 4 步用 `args.limit ?? current().queryLimit`，而 §2.3 实际代码用防御式 `limit`（处理负数/非有限） | 与 CONTRACT 既有伪代码风格一致（原 L502 亦如此），非错误；如追求严格一致可同步。 | 否 |

---

## 四、修订指令（执行者照办）

### R1（D1，必做）：重写 `test/unified-source.test.mjs` 第一个用例

放弃 `peerFile` + 真实 home 路径，改用**临时文件路径**直传 `readPeerFile`（`readPeerFile` 签名接受任意 `filePath`，B2 的收敛点在于 `mirrorLoad(gk, ...)` / `mirrorRead(gk)` 用 groupKey、而非文件名），零污染、零新依赖：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "../lib/storage.js";

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
    assert.deepEqual(mirrorRead(gk), {});          // 镜像未刷新
    const board = await readPeerFile(filePath);     // 1) 读磁盘（临时文件，真实读）
    mirrorLoad(gk, board.peers);                    // 2) 整组替换镜像
    assert.equal(mirrorRead(gk).a.sessionId, "a");  // 3) 与注入侧同源
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

第二个用例（读失败→空组）**保持不动**（`readPeerFile(peerFile("/no/such/repo"))` 对不存在的哈希文件返回空骨架，无污染，语义正确）；若想彻底隔离，同样改用临时不存在路径 `join(dir, "nope.json")`。补充一条端到端断言（可选，依赖可解析时）：`createQueryPeersTool` 注入 `{ current, groupKeyFor, peerFile, readPeerFile, mirrorLoad, mirrorRead }` 后执行，`mirrorRead(groupKey)` 与返回值 `peers` 逐条一致（同源证明）。

### R2（D2，必做）：修正 retention 表述（README + FIX-NOTES + 提案 §3 边界表）

将「靠 7 天 retention 自然过期」统一改为准确表述，例如：

> 旧键落盘文件不再被写入（`pruneRetention` 仅在 `upsertPeer` 锁内、即同键下一次发布时触发），故其孤儿条目不会被 retention 自动清理，而是永久留存；但组迁移后无会话再读旧键，属无害死文件（若干 KB），**无需数据迁移**，如需回收可手动删除 `~/.dsh/session-board/peers/<旧键哈希>.json`。

同步修订：提案 §3 边界表「镜像中旧键残留」行、§5 README 新增段、FIX-NOTES.md L35-36。**保留**「无需数据迁移」「活跃 peer 在 TTL 窗口后收敛到新键」结论（这两条仍正确）。

### R3（D3，必做）：提案补列 FIX-NOTES.md 交付项

在提案 §4（或 §2.4 / §7）显式增加：`FIX-NOTES.md`（`/home/CNS2026495165/dsh/session-board/FIX-NOTES.md`）——记录诊断证据链 + 修复设计，内容与 §1 根因、§2 设计一致（该文件已存在，确认其与最终修订后的 §2 设计一致即可，无需重写证据链）。

### R4（N1，可选）：统一 CONTRACT §1.6 step-4 与 §2.3 代码的 limit 表述

若执行者追求文档与代码严格一致，可将 §4.2 第 4 步文本同步为防御式 `limit` 计算；否则保持 CONTRACT 伪代码风格亦可，不阻断。

---

## 五、范围红线复核

- 不改 `board.js` 预算/渲染：提案未触碰 board.js。✅
- 不改 `storage.js` 锁与原子写（`withFileLock`/`writeFileAtomic`/`upsertPeer`）：仅复用 `mirrorLoad/mirrorRead/readPeerFile`。✅
- 不动 `PROPOSAL.md`/`AUDIT.md`：§7 明示。✅
- 不装不推：§7 明示。✅
- 不新增 Config 字段：TTL 为 `grouping.js` 模块常量，与 `RETENTION_MS`（§9-A2）先例一致。✅

---

*审计完成。B1/B2 核心设计批准；执行前须先落实 R1（重写 test b）、R2（retention 表述）、R3（补 FIX-NOTES 交付项）。R4 为可选优化。*
