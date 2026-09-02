# dsh-session-board 修复方案（FIX-PROPOSAL.md）

> 范围：仅设计，不实施。所有论断标注源码依据（`文件:行号`），源码根
> `/home/CNS2026495165/dsh/session-board/dsh-session-board/`，与已安装副本
> `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-board/` 一致。

---

## 1. 修复方案总览

### B1：分组键 TTL 再解析（grouping.js + index.js）

根因（`lib/grouping.js:102-132`）：`resolved: Map<sessionId, GroupKey>` 首次解析后回填，`groupKeyFor`
经 `pending` 去重后永不再解析；`groupKeySync`（`grouping.js:140-142`）只读 `resolved`。repo 身份
（`.git` 出现/消失 / worktree 迁移）变化后，旧键永不失效，同组被劈成两个落盘文件。

修复机制：给分组键加 **TTL 再解析**，挂在现有 `refreshLiveGroups` 周期上（`index.js:152-155` →
`refreshGroup` → `groupKeyFor`，`index.js:143-150`），**不新增线程/定时器类别**。

```
refreshLiveGroups()  ── 每 refreshIntervalSeconds(默认10s, index.js:127-131)
  └─ 对每个 root agent → refreshGroup(session)          (index.js:143-150)
       └─ groupKeyFor(session)                          (grouping.js, 改造后)
            ├─ resolvedAt 距今 < TTL(60s)？ ── 是 → 复用 resolved 旧值（不发 git）
            └─ 否（过期/首次）→ resolveGroupKey(cwd) 重解析
                 ├─ 成功 → 原子替换 resolved[id]=新键、resolvedAt[id]=now
                 │         ├─ 键变(旧≠新) → onChange(id,旧键,新键) 记 warn
                 │         └─ 键未变 → 静默
                 └─ 失败 → 保留旧值，resolved/resolvedAt 均不动 → 下轮重试
       └─ readPeerFile(peerFile(gk)) → mirrorLoad(gk, peers)   (镜像整体切到新键)
```

关键不变式：`groupKeySync` **只读 `resolved`**（`grouping.js:140-142` 原样），而 `resolved` 只在解析
**成功后**原子写。因此再解析进行中 `groupKeySync` 仍返回旧值，**绝不出现 `undefined` 抖动**；
解析失败也不清空旧值。键变日志经 `ctx.logger?.warn ?? console.warn` 兜底，顺带服务未解渲染异常的
未来定位（记录「谁、旧键、新键、何时」）。

### B2：注入与 query_peers 收敛到同一数据源（tool.js + index.js）

根因（两条路径读不同来源）：
- 注入 `renderBoardFor`（`inject.js:71-89`）读进程内镜像 `mirrorRead(gk)`（`inject.js:74-77`），
  `mirrorRead` 无磁盘回退（`storage.js:243-246` 未命中返回 `{}`）。
- `query_peers`（`tool.js:178-197`）读磁盘 `readPeerFile(peerFile(await groupKeyFor(agent.session)))`
  （`tool.js:182-184`）。

修复机制：让 `query_peers` **先做一次与 `refreshGroup` 等价的磁盘加载**，再与注入侧同源读镜像。

```
统一数据源 = 内存镜像 mirror（经 mirrorRead 读取）

  inject.renderBoardFor:  groupKeySync(id) ──→ mirrorRead(gk)          [同步，只读镜像]
  query_peers.execute:    groupKeyFor(agent.session)
                            ──→ readPeerFile(peerFile(gk))             [磁盘最新]
                            ──→ mirrorLoad(gk, peers)                  [等价 refreshGroup 的整组替换]
                            ──→ mirrorRead(gk)                         [与注入侧同源]
```

效果：两条路径读同一 `mirror`；`query_peers` 顺手把磁盘（含他进程写入）刷新进镜像，板上与工具结果
不再互相矛盾。失败语义各自保持：注入永不 throw 返回 `""`（`inject.js:86-88`）；`query_peers` 无
agent 抛错（`tool.js:180`）、读失败按空组（`readPeerFile` 兜底空骨架 `storage.js:131-135,140-142`，
`mirrorLoad(gk,{})` 清空镜像 → `mirrorRead` 返回 `{}`）。防越组读不放松：分组键仍只从
`groupKeyFor(agent.session)` 推导（`tool.js:182`）。

---

## 2. 逐文件改动清单

### 2.1 `lib/grouping.js`（改动核心）

改动点：`createGrouping` 增加可选 deps 与 TTL；`groupKeyFor` 增加再解析分支；`groupKeySync` 不变。

- **新增模块常量** `GROUP_KEY_TTL_MS`（文件顶部，`resolveGroupKey` 附近）：
  ```js
  /** 分组键再解析 TTL（模块常量，不入 Config；可经 createGrouping({ ttlMs }) 覆盖以便测试）。 */
  const GROUP_KEY_TTL_MS = 60 * 1000;
  ```
- **`createGrouping(deps)` 签名扩展**（`grouping.js:102`）：
  ```js
  export function createGrouping({ ttlMs = GROUP_KEY_TTL_MS, onChange, resolveKey = resolveGroupKey } = {}) {
  ```
  三个可选入参：`ttlMs`（测试缩短）、`onChange`（键变回调，由 index.js 注入日志）、
  `resolveKey`（解析函数注入点，默认 `resolveGroupKey`，测试用假解析器）。
- **内部三张 Map**（替换 `grouping.js:104-106`）：
  ```js
  const pending = new Map();    // sessionId -> Promise<GroupKey>（在飞解析去重；settle 后删除）
  const resolved = new Map();   // sessionId -> GroupKey（groupKeySync 只读；仅成功时写）
  const resolvedAt = new Map(); // sessionId -> epoch ms（TTL 判断基准）
  ```
- **`groupKeyFor` 重写**（替换 `grouping.js:115-132`）：
  ```js
  async function groupKeyFor(session) {
    const sessionId = session?.id;
    const cwd = session?.header?.cwd;
    if (!cwd) {
      resolved.set(sessionId, "no-cwd");
      resolvedAt.set(sessionId, Date.now());
      return "no-cwd";
    }
    const inflight = pending.get(sessionId);
    if (inflight) return inflight;                    // 去重在飞（首次或再）解析
    const prev = resolved.get(sessionId);
    if (prev !== undefined && Date.now() - (resolvedAt.get(sessionId) ?? 0) < ttlMs) {
      return prev;                                    // TTL 内：复用旧值，不发 git
    }
    const p = (async () => {
      try {
        const key = await resolveKey(cwd);
        // 仅成功才原子替换旧值；此段执行期间 groupKeySync 仍读到 prev
        resolved.set(sessionId, key);
        resolvedAt.set(sessionId, Date.now());
        if (prev !== undefined && prev !== key) {
          try { onChange?.(sessionId, prev, key); } catch { /* 日志失败不影响键更新 */ }
        }
        return key;
      } catch {
        // 解析失败：保留旧值（resolved/resolvedAt 不动 → 下轮 refreshGroup 重试）
        return prev ?? "no-cwd";
      }
    })();
    pending.set(sessionId, p);
    const clear = () => { if (pending.get(sessionId) === p) pending.delete(sessionId); };
    p.then(clear, clear);                             // settle 后清除，保证过期能再次再解析
    return p;
  }
  ```
  - 原子替换实现手法：`resolved` 只在 `resolveKey` 成功返回后 `set`；解析期间不预清空。
    `groupKeySync`（`grouping.js:140-142`）读到的永远是「上一次成功值」，故无 `undefined` 抖动。
  - 失败保留旧值：`catch` 分支返回 `prev`（首次失败则 `"no-cwd"`），且不动 `resolved/resolvedAt`，
    使 `resolvedAt` 保持过期，下一轮 `refreshGroup` 自动重试。
  - 并发再解析：`pending.get` → `pending.set` 之间无 `await`，同一 tick 内多次调用去重到同一
    在飞 Promise；`p.then(clear)` 保证 settle 后清除，避免旧 Promise 常驻挡住后续再解析。
- **`groupKeySync` 不动**（`grouping.js:140-142`）：仍 `return resolved.get(sessionId);`。

### 2.2 `lib/index.js`（装配两处，逻辑零改动）

- **`createGrouping` 装配**（`index.js:86`）注入键变日志：
  ```js
  const { groupKeyFor, groupKeySync } = createGrouping({
    onChange: (sessionId, oldKey, newKey) => {
      (ctx.logger?.warn ?? console.warn)(
        `session-board group key changed for session ${sessionId}: ${oldKey} -> ${newKey}`
      );
    }
  });
  ```
  （`ctx.logger?.warn` 缺席时 `console.warn` 兜底；含 sessionId + 旧键→新键，即 B1 要求的 warn，
  兼作未解渲染异常的诊断线索。）
- **`createQueryPeersTool` 装配**（`index.js:96`）补传镜像两函数：
  ```js
  const queryPeersTool = createQueryPeersTool({
    current, groupKeyFor, peerFile, readPeerFile, mirrorLoad, mirrorRead
  });
  ```
  （`mirrorLoad`/`mirrorRead` 已在 `index.js:87` 从 `createStorage()` 解构，无需新增。）
- `refreshGroup`（`index.js:143-150`）与 `refreshLiveGroups`（`index.js:152-155`）**体不变**：
  `refreshGroup` 内的 `await groupKeyFor(session)` 因 B1 的 TTL 而在过期时自动触发再解析，
  这就是再解析的集成点；后续 `readPeerFile → mirrorLoad` 天然把镜像切到新键。

### 2.3 `lib/tool.js`（B2 统一读路径）

- **deps 扩展**（`tool.js:149-150` 解构 + JSDoc `tool.js:141-146`）：增加 `mirrorLoad`、`mirrorRead`。
- **`execute` 读路径改造**（替换 `tool.js:182-190` 的读盘段）：
  ```js
  const groupKey = await groupKeyFor(agent.session);   // 只从调用方 cwd 推导（防越组读，不变）
  const file = await readPeerFile(peerFile(groupKey)); // 磁盘最新；损坏/缺失→空骨架不抛
  mirrorLoad(groupKey, file.peers);                    // 等价 refreshGroup：整组替换镜像
  const peersObj = mirrorRead(groupKey);               // 与注入侧同源读镜像
  const now = Date.now();
  const activeWindowMs = current().activeWindowMinutes * 60 * 1000;
  const rawLimit = args?.limit;
  const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit >= 0
    ? Math.floor(rawLimit) : current().queryLimit;
  const peers = Object.values(peersObj)
    .filter((p) => p !== null && typeof p === "object")
    .filter((p) => p.sessionId !== agent.session.id)
    .filter((p) => matches(p, args?.query))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, limit);
  return { groupKey, peers: peers.map((p) => enrichPeer(p, activeWindowMs, now)) };
  ```
  - 失败语义不变：`readPeerFile` 永不 reject（`storage.js:127-156`），读失败返回空骨架 →
    `mirrorLoad(gk,{})` → `mirrorRead(gk)=={}` → `peers=[]`（按空组处理，与现状一致）。
  - 无 agent 抛错分支（`tool.js:180`）保持不变。
  - 越组读防护不变：`groupKey` 仍仅来自 `groupKeyFor(agent.session)`（`tool.js:182`），
    `mirrorLoad/mirrorRead` 只操作该 `groupKey`，无任何外部路径入参。

### 2.4 不改的文件（及原因）

- `lib/inject.js`：仍走 `groupKeySync → mirrorRead`（`inject.js:74-77`），B2 使镜像在
  query_peers/refreshGroup 侧被更及时刷新，注入侧无需改动，失败语义保持 `""`（`inject.js:86-88`）。
- `lib/storage.js`：`mirrorLoad`（`storage.js:230-236`）、`mirrorRead`（`storage.js:243-246`）、
  `readPeerFile`（`storage.js:127-156`）均为既有函数，直接复用；**锁与原子写**
  （`upsertPeer` `storage.js:182-198`、`withFileLock`/`writeFileAtomic`）零改动；retention
  （`pruneRetention` `storage.js:166-172`、`RETENTION_MS` `storage.js:71`）零改动。
- `lib/board.js`：预算/渲染逻辑不触碰（范围红线）。
- `PROPOSAL.md` / `AUDIT.md`：历史文档，不动。

---

## 3. 边界情况

| 边界 | 处理 | 依据/手法 |
|---|---|---|
| **再解析失败** | 保留旧值，`resolved/resolvedAt` 不动；下一轮 `refreshGroup`（10s 周期）自动重试 | `grouping.js` `catch` 分支返回 `prev ?? "no-cwd"` |
| **再解析进行中** | `groupKeySync` 返回旧值（`resolved` 只在成功时写），绝不 `undefined`；并发 `groupKeyFor` 经 `pending` 去重 | `groupKeySync` 只读 `resolved`；`pending.get→set` 间无 `await` |
| **并发再解析** | 同一 tick 内多次调用共享同一在飞 Promise；settle 后 `clear` 删除，允许下次再解析 | `pending.set` + `p.then(clear,clear)` |
| **键未变** | 静默更新 `resolvedAt`，不触发 `onChange`（`prev === key` 跳过） | `if (prev !== undefined && prev !== key)` |
| **`cwd` 为空** | 直接 `resolved.set(id,"no-cwd")` 并刷新 `resolvedAt`，不进 `resolveKey`（会话 cwd 稳定，等价终态） | `grouping.js` 首段分支 |
| **镜像中旧键残留** | 键切换后旧键镜像条目（`mirror[旧键]`）不再被 `groupKeySync` 读取（注入侧已指向新键）；新键经 `refreshGroup` 的 `mirrorLoad` 建立。旧键**落盘文件**不删除，靠 7 天 retention 自然过期（`storage.js:71,166-172`；`upsertPeer` 每次锁内 `pruneRetention`），无需迁移 | B1 原子替换 + 7 天 retention |
| **测试如何缩短 TTL** | `createGrouping({ ttlMs: 50, resolveKey: 假解析器 })`；`resolveKey` 注入假函数可返回可控新键/抛错/延迟，避免真实 `git` 与 60s 等待 | 见 §6 测试 a |
| **query_peers 读失败** | `readPeerFile` 返回空骨架 → `mirrorLoad(gk,{})` → `mirrorRead(gk)=={}` → 空组；不抛 | `storage.js:131-135,140-142` |
| **query_peers 使镜像与磁盘一致** | `mirrorLoad` 整组替换，与 `refreshGroup` 同源同语义；进程内 `mirrorSet` 只在上盘成功后执行（`index.js:112-113`），故镜像 ⊆ 磁盘，`mirrorLoad` 不会丢有效条目 | `index.js:112-113`、`storage.js:230-236` |

---

## 4. CONTRACT.md 修订文本

> 仅列替换/新增段落。改动集中在 §1.1、§1.6、§3。其余章节不动。

### 4.1 §1.1 `lib/grouping.js`（分组键）

**替换「精确 export 清单」块**（原 `CONTRACT.md:65-70`）中 `createGrouping` 一行：

```js
export function resolveGroupKey(cwd)          // 纯函数，无缓存，永不 throw
export function createGrouping(deps?)         // 工厂，返回 { groupKeyFor, groupKeySync }
```

**替换 `createGrouping` 签名 JSDoc**（原 `CONTRACT.md:83-88`）：

```js
/**
 * 创建每-apply 一份的分组键缓存工厂（TTL 再解析，见下）。
 * @param {{
 *   ttlMs?: number,       // 分组键再解析 TTL，默认 GROUP_KEY_TTL_MS（60_000）；测试可缩短
 *   onChange?: (sessionId: string, oldKey: GroupKey, newKey: GroupKey) => void,  // 键变化回调（warn 日志）
 *   resolveKey?: (cwd: string | undefined) => Promise<GroupKey>   // 解析函数注入点，默认 resolveGroupKey（测试用）
 * }} [deps]
 * @returns {{ groupKeyFor: Function, groupKeySync: Function }}
 */
export function createGrouping(deps) {}
```

**替换 `groupKeyFor` JSDoc**（原 `CONTRACT.md:91-96`）：

```js
/**
 * 取某会话的分组键（异步；TTL 内复用缓存，TTL 过期后再解析）。
 * 再解析成功且键变化时经 deps.onChange 通知；失败保留旧值。
 * @param {{ id: string, header: { cwd: string | undefined } }} session
 * @returns {Promise<GroupKey>}
 */
groupKeyFor(session)
```

**替换「实现约束」段**（原 `CONTRACT.md:106-110`，整体替换为）：

```js
**实现约束**（契约内必须满足）：
- 工厂内部维护三张 Map：`pending: Map<sessionId, Promise<GroupKey>>`（在飞解析去重，settle 后清除）、
  `resolved: Map<sessionId, GroupKey>`（`resolveGroupKey` 成功后回填，供同步读）、
  `resolvedAt: Map<sessionId, number>`（最近成功解析的 epoch ms，TTL 判断基准）。
- `groupKeyFor`：`session.header.cwd` 为空 → 直接返回 `"no-cwd"` 并写入 `resolved`/`resolvedAt`；
  否则：有在飞 `pending` → 返回它；`resolved` 存在且 `Date.now() - resolvedAt < ttlMs` → 返回旧值
  （不发 git）；过期或首次 → 重新 `resolveKey(cwd)`，**成功后**才原子写 `resolved`+`resolvedAt`，
  键变化时调 `onChange(sessionId, oldKey, newKey)`；**失败保留旧值**（`resolved`/`resolvedAt` 不动，
  返回 `prev ?? "no-cwd"`，下轮重试）。
- `groupKeySync`：只读 `resolved`，未命中返回 `undefined`（**绝不**同步触发异步解析）；因 `resolved`
  仅在成功时写，再解析期间返回旧值，**绝不因再解析出现 `undefined` 抖动**。
- `resolveGroupKey` 用 `execFile("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { encoding:"utf8", timeout:2000, windowsHide:true })`；相对结果用 `resolve(cwd, rel)` 拼成绝对路径后 `realpath`。**必须用 `--git-common-dir`，禁用 `--git-dir`**（后者对链接 worktree 返回私有路径，会切组）。
- `GROUP_KEY_TTL_MS = 60_000` 为模块常量，不入 Config（同 `storage.js` 的 `RETENTION_MS` 先例，§9-A2）；
  仅测试经 `deps.ttlMs` 覆盖。
```

### 4.2 §1.6 `lib/tool.js`（`query_peers`）

**替换 `createQueryPeersTool` deps JSDoc**（原 `CONTRACT.md:464-473`）：

```js
/**
 * @param {{
 *   current: () => Config,
 *   groupKeyFor: (session: object) => Promise<GroupKey>,
 *   peerFile: (groupKey: GroupKey) => string,
 *   readPeerFile: (filePath: string) => Promise<GroupFile>,
 *   mirrorLoad: (groupKey: GroupKey, peers: Record<string, PeerStatus>) => void,
 *   mirrorRead: (groupKey: GroupKey) => Record<string, PeerStatus>
 * }} deps
 * @returns {object} defineTool(...) 的返回值（registry-ready）
 */
export function createQueryPeersTool(deps) {}
```

**替换「实现约束」execute 第 3 步**（原 `CONTRACT.md:501`）：

```js
3. `const file = await readPeerFile(peerFile(groupKey)); mirrorLoad(groupKey, file.peers);`
   （读前先做一次与 refreshGroup 等价的磁盘加载，把组文件整组替换进镜像，统一数据源）
   `const peersObj = mirrorRead(groupKey);`（与注入侧同源读镜像；`readPeerFile` 损坏/缺失已兜底空骨架，
   故 `mirrorRead` 得到 `{}`，读失败按空组处理，不抛）
```

并同步把第 4 步（原 `CONTRACT.md:502`）的 `board.peers` 改为 `peersObj`：

```js
4. `const peers = Object.values(peersObj).filter(p => p.sessionId !== agent.session.id).filter(p => matches(p, args.query)).sort((a,b) => b.lastActivityAt - a.lastActivityAt).slice(0, args.limit ?? current().queryLimit);`
```

### 4.3 §3 `lib/index.js` 装配清单

**替换步骤 1 两处装配**（原 `CONTRACT.md:604-617`）：

```js
  /* 1. 工厂装配 */
  const lastTurn = new Map();                                        // sessionId -> turn（发布幂等，仅 index.js 持有）
  const { groupKeyFor, groupKeySync } = createGrouping({             // §1.1
    onChange: (sessionId, oldKey, newKey) => {                       // 键变诊断（兼未解渲染异常定位）
      (ctx.logger?.warn ?? console.warn)(`session-board group key changed for session ${sessionId}: ${oldKey} -> ${newKey}`);
    }
  });
  const { readPeerFile, upsertPeer, mirrorSet, mirrorLoad, mirrorRead } = createStorage();  // §1.2
  const projections = ctx.get("sessionProjections");                 // F18；可能 undefined（M2）
  const { isSubagent, trackRecent, captureStatus } = createCapture({ // §1.4
    projections,
    maxPeerEntries: current().maxPeerEntries,
    queryDetailBytes: current().queryDetailBytes
  });
  const { register } = createInjector({                              // §1.5
    ctx, current, groupKeySync, mirrorRead
  });
  const queryPeersTool = createQueryPeersTool({                      // §1.6
    current, groupKeyFor, peerFile, readPeerFile, mirrorLoad, mirrorRead
  });
```

> `refreshGroup`（§3 步骤 6 辅助，`CONTRACT.md:654-661`）体不变：其 `await groupKeyFor(session)` 在
> TTL 过期时自动再解析，是本修复的再解析集成点，无需在 §3 再改 `refreshGroup` 伪代码。

---

## 5. README 已知限制新增段落原文

在 `README.md` 「## 已知限制」末尾（`README.md:36` 之后）新增：

```markdown
- **repo 身份变更/组迁移**：分组键按 cwd → `git rev-parse --git-common-dir` → realpath 归一分组，带
  TTL（默认 60s，模块常量，不入配置）再解析。当同一 cwd 下 `.git` 出现/消失或 worktree 迁移时，会话
  会在下一个 TTL 窗口内重新解析到新分组键；旧键落盘文件里的孤儿条目不会被删除，靠 7 天 retention
  自然过期，活跃 peer 在 TTL 窗口后收敛到新键并互相可见。切换窗口内可能出现短暂「新键文件为空」，
  属预期过渡态。
```

---

## 6. 测试设计（两个冒烟，node:test，零新依赖）

> 目标：`node --test`（或 `node test/*.mjs`）零新增依赖可跑。测试 a 仅用 node 内置模块，可在源码树
> 直接跑；测试 b 需 `@deepseek-ai/dsh-atomic-write` 可被解析（既有 peer 依赖，非新增）——在已安装
> 副本 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-board/` 下运行，或先在源码树
> `ln -s ~/.dsh/profiles/node_modules ./node_modules`（由主 agent 重装/链接后执行，不属本方案改动）。

### 6.1 `test/grouping-ttl.test.mjs`（B1）

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createGrouping } from "../lib/grouping.js";

test("TTL 内复用缓存，过期后原子再解析并触发 onChange", async () => {
  const keys = ["/repo", "/repo/.git"];
  let i = 0;
  const changes = [];
  const { groupKeyFor, groupKeySync } = createGrouping({
    ttlMs: 50,
    resolveKey: async () => keys[i++],                 // 假解析器：第一次 /repo，之后 /repo/.git
    onChange: (id, o, n) => changes.push([id, o, n])
  });
  const session = { id: "s1", header: { cwd: "/repo" } };

  assert.equal(await groupKeyFor(session), "/repo");   // 首解
  assert.equal(groupKeySync("s1"), "/repo");

  assert.equal(await groupKeyFor(session), "/repo");   // TTL 内：复用，resolveKey 不再调用（i 仍=1）
  assert.equal(i, 1);

  await new Promise((r) => setTimeout(r, 60));          // 等过期
  assert.equal(await groupKeyFor(session), "/repo/.git"); // 过期再解析 → 新键
  assert.equal(groupKeySync("s1"), "/repo/.git");        // 原子替换完成
  assert.deepEqual(changes, [["s1", "/repo", "/repo/.git"]]); // 键变回调一次
});

test("再解析期间 groupKeySync 不抖动；失败保留旧值", async () => {
  let fail = false;
  const { groupKeyFor, groupKeySync } = createGrouping({
    ttlMs: 10,
    resolveKey: async () => {
      if (fail) throw new Error("boom");               // 失败场景
      await new Promise((r) => setTimeout(r, 20));      // 慢解析，暴露「在飞」窗口
      return "/new";
    }
  });
  const session = { id: "s2", header: { cwd: "/r" } };
  assert.equal(await groupKeyFor(session), "/new");    // 首解
  await new Promise((r) => setTimeout(r, 15));          // 过期
  const p = groupKeyFor(session);                       // 触发再解析（在飞）
  assert.equal(groupKeySync("s2"), "/new");             // 在飞期间仍返回旧值，非 undefined
  await p;

  fail = true;
  await new Promise((r) => setTimeout(r, 15));          // 再次过期
  assert.equal(await groupKeyFor(session), "/new");     // 失败保留旧值
  assert.equal(groupKeySync("s2"), "/new");             // 仍未抖动
});
```

断言要点：①TTL 内不发二次解析（`i` 不变）；②过期后原子替换且 `groupKeySync` 同步到新键；
③`onChange` 恰好一次、参数 `(id,旧键,新键)`；④在飞窗口 `groupKeySync` 非 `undefined`；
⑤失败保留旧值、`groupKeySync` 不抖动。

### 6.2 `test/unified-source.test.mjs`（B2）

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage, peerFile } from "../lib/storage.js";   // 复用真实 readPeerFile/mirrorLoad/mirrorRead

test("query_peers 统一读路径：磁盘→镜像→mirrorRead 与注入侧同源", async () => {
  const gk = "/repo/.git";
  const dir = await mkdtemp(join(tmpdir(), "sb-test-"));
  const file = peerFile(gk);                                    // 固定哈希路径（不依赖 dir，但需可写）
  // 模拟「另一进程」写入磁盘组文件
  const peerA = { schemaVersion: 1, sessionId: "a", label: "a", cwd: gk, groupKey: gk,
    isSubagent: false, publishedAt: 1, lastActivityAt: Date.now(), turn: 3,
    goal: null, todos: null, recentFiles: [], recentAssistantTail: "" };
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "peers"), { recursive: true });

  const { readPeerFile, mirrorLoad, mirrorRead } = createStorage();
  // 镜像初始状态：空（模拟未刷新）
  assert.deepEqual(mirrorRead(gk), {});

  // B2 序列：等价 query_peers.execute 的读路径
  const board = await readPeerFile(peerFile(gk));               // 1) 读磁盘
  mirrorLoad(gk, board.peers);                                   // 2) 整组替换镜像
  const got = mirrorRead(gk);                                    // 3) 与注入侧同源读镜像
  assert.equal(got.a.sessionId, "a");                            // 镜像已含磁盘 peer
  await rm(dir, { recursive: true, force: true });
});

test("读失败（文件不存在）→ 空组，镜像被清空，不抛", async () => {
  const gk = "/no/such/repo";
  const { readPeerFile, mirrorLoad, mirrorRead } = createStorage();
  const board = await readPeerFile(peerFile(gk));                // ENOENT → 空骨架
  assert.deepEqual(board.peers, {});
  mirrorLoad(gk, board.peers);
  assert.deepEqual(mirrorRead(gk), {});                          // query_peers 将返回空 peers
});
```

> 注：`peerFile(gk)` 落到 `~/.dsh/session-board/peers/`（`storage.js:96-99`），测试 b 用 `readPeerFile`
> 直读该路径即可，无需写盘（写盘属 `upsertPeer` 职责，本测试不触碰锁/原子写）；若想模拟「磁盘有他
> 进程写、镜像未刷」的完整对照，可在 setUp 直接 `writeFile` 到 `peerFile(gk)` 的父目录。真实
> `createQueryPeersTool.execute`（`tool.js:178-197`）的端到端断言在依赖可解析（已安装副本）时补充：
> 执行后 `mirrorRead(groupKey)` 应与返回值 `peers` 逐条一致（同源证明）。

---

## 7. 风险与不做清单

**风险**
- 60s TTL 意味着 `.git` 刚 init 后的最多 60s 内仍沿用旧键（发布/板短暂落旧键文件）。这是有界、
  可接受的过渡态（README 已标注）；把 TTL 调到更低会增加 `git rev-parse` 频率，60s 是
  「成本/收敛」平衡点。
- `query_peers` 新增 `mirrorLoad` 副作用：这是 `refreshGroup` 既有语义（每 10s 已整组替换），且
  进程内 `mirrorSet` 仅在上盘成功后执行（`index.js:112-113`），镜像 ⊆ 磁盘，`mirrorLoad` 不会丢
  有效条目，无回归。
- 再解析成本：最多每会话每分钟 1 次 `git rev-parse`（仅 live root agent，`refreshLiveGroups` 驱动），
  且经 `pending` 去重，可忽略。
- 未解渲染异常（新键标签 + 旧 turn 数据）**本次不修**：键变 warn 日志（含 sessionId/旧键/新键）已
  提供定位线索，待复现后另案处理。

**不做清单（范围红线）**
- 不改 `board.js` 预算/渲染（`board.js` 全体不动）。
- 不改 `storage.js` 的锁与原子写（`withFileLock`/`writeFileAtomic`/`upsertPeer` 零改动），仅复用既有
  `mirrorLoad`/`mirrorRead`/`readPeerFile`。
- 不动 `PROPOSAL.md` / `AUDIT.md`。
- 不做数据迁移：旧键文件孤儿条目靠 7 天 retention（`storage.js:71,166-172`）自然过期。
- 不装不推：不运行 `install.sh`、不 `npm install`、不重装（主 agent 负责）。
- 不新增线程/定时器类别：B1 挂在既有 `ctx.effect` 的 `setInterval`（`index.js:127-131`）上。
- 不新增 Config 字段：TTL 为 `grouping.js` 模块常量（同 `RETENTION_MS` 先例，`CONTRACT §9-A2`）。
