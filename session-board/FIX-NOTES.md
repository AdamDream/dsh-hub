# dsh-session-board 修复记录（FIX-NOTES.md）

## 诊断证据链

**Bug 1 · 分组键缓存冻结 repo 身份**
- `lib/grouping.js:102-132`：`groupKeyFor` 首次解析后写 `resolved`（`grouping.js:126`），经
  `pending` 去重后永不再解析；`groupKeySync`（`grouping.js:140-142`）只读 `resolved`。
- 现场：工作区 `~/dsh` 于 17:55:49 `git init`（`.git` 创建），但同 host 既有会话仍持旧键
  `/home/CNS2026495165/dsh`（非 git 回退 `realpath(cwd)`）；dsh-taste 会话 18:34:52 turn 13 发布仍写
  旧键文件 `~/.dsh/session-board/peers/a9d3e4a0…`（`sha256("/home/CNS2026495165/dsh")` 前 32 位）。
- host 18:36:18 重启后全部解析到新键 `/home/CNS2026495165/dsh/.git`（`bde9397c…`），但该文件从未被
  写 → 同一工作组劈成两个文件，互相不可见。
- 根因：repo 身份变化后缓存永不失效。

**Bug 2 · 注入与 query_peers 数据源不一致**
- 注入 `renderBoardFor`（`lib/inject.js:71-89`）读进程内镜像 `mirrorRead(gk)`（`inject.js:74-77`），
  `mirrorRead` 无磁盘回退（`storage.js:243-246`）。
- `query_peers`（`lib/tool.js:178-197`）读磁盘 `readPeerFile(peerFile(await groupKeyFor(...)))`
  （`tool.js:182-184`）。
- 实害：新键磁盘文件缺失而镜像有旧发布 → 板上显示、`query_peers` 空；反向亦然。两条路径未收敛。

**未解渲染异常（诚实记录，非本次必修）**：18:38 后某快照出现「新键标签 + 他 turn-12 数据」组合，
现有路径推不出来；本次仅加键变诊断日志助未来定位。

## 修复设计（对应 FIX-PROPOSAL.md）

- **B1**：`grouping.js` 增 `GROUP_KEY_TTL_MS = 60_000` 模块常量与 `createGrouping({ ttlMs, onChange,
  resolveKey })` 三可选入参；内部三张 Map（`pending` 去重 / `resolved` 只读 / `resolvedAt` TTL 基准）。
  `groupKeyFor` 在 TTL 过期后再解析，成功才原子替换 `resolved`，键变经 `onChange` 记
  `ctx.logger?.warn ?? console.warn`（含 sessionId + 旧键→新键）；失败保留旧值。集成点 = 既有
  `refreshLiveGroups → refreshGroup → groupKeyFor`（`index.js:143-155`），无新定时器。
- **B2**：`query_peers.execute` 改为 `readPeerFile → mirrorLoad → mirrorRead`（`lib/tool.js`），
  `index.js:96` 补传 `mirrorLoad`/`mirrorRead`，与注入侧同源读镜像；失败语义不变（无 agent 抛错、
  读失败空组），越组读防护不变（键仅从调用方 `agent.session` 推导）。
- **文档**：`CONTRACT.md` §1.1/§1.6/§3、`README.md` 已知限制同步；旧键落盘文件组迁移后不再被写入
  （retention 清理仅在 `upsertPeer` 锁内、即同键下一次发布时触发），其孤儿条目不会被自动清理而是
  永久留存——但无会话再读旧键，属无害死文件（若干 KB），无需数据迁移，如需回收可手动删除
  `~/.dsh/session-board/peers/<旧键哈希>.json`（FIX-AUDIT.md R2 修正「7 天自然过期」的失真表述）。
- **测试**：`test/grouping-ttl.test.mjs`（TTL 注入缩短 + 假解析器，验证再解析/原子替换/不抖动/
  失败保留旧值）；`test/unified-source.test.mjs`（模拟磁盘 + 镜像，验证统一读路径与读失败空组）。
