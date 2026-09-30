# 规划 B 完成：WE 升到 0.2.2（含补丁回流 + peer 放宽）

## 关键发现：上游已到 0.2.2，比 0.1.4 好得多
勘查档原定目标 0.1.4；实测 registry `latest = 0.2.2`（2026-09-26 发布，**在 0.2.0 内核之后**）。改用 0.2.2 后**消除了原定 3 项手写缺口**：

| 原缺口（0.1.4 需手写） | 0.2.2 实测 |
|---|---|
| `FileSystem.readByteRange` | ✅ 已实现（6 文件命中） |
| `SubprocessRuntime.terminalEnvironment` | ✅ 已实现 |
| `SubprocessTerminalHandle.resize` / `inspectActivity` | ✅ 已实现 |

⇒ 原「升版后仍有 3 个抽象成员要补」的结论**作废**，改造面显著缩小。

## 另一项决定性好消息：契约面零变化
`lib/index.d.ts` 在 **已迁移的 0.1.2 与 0.2.2 之间 sha256 完全相同**（`b6c35c085afea250`）
⇒ `@local/dsh-ssh-gui` 依赖的阻断性 `import { remoteWorkspacesRoot }` **在 0.2.2 上成立**（实测导出计数 1）。

## 实际改动（3 项）
1. **补丁 P1 回流**：0.2.2 仍保留 O(k²) 去重（`ids.filter((id,i)=>ids.indexOf(i)===index)`，与未打补丁的 0.1.2 逐字相同）
   ⇒ 应用 `Array.from(new Set(ids))`，**保留 `unique[0] !== undefined` 守卫**（0.1.4+ 的 `noUncheckedIndexedAccess` 会因裸删而 TS2345）。
   实测替换 **4 处**：`lib/client.js` ×2 + `lib/client/row-badges.js` ×2。
2. **peer 范围放宽**：13 条 `^0.1.5-rc.1` → **`^0.1.5-rc.1 || ^0.2.0-rc.1`**（升版本身解决不了 peer 闸门，实测两版范围都拒绝 0.2.0）。
3. **补 `ssh2` 依赖**：0.2.2 的唯一真实 dependency 是 `ssh2`，而新根顶层没有 ⇒ 从 `~/.dsh/profiles/node_modules/dsh-workspace-enhancement/node_modules/ssh2`（v1.17.0）链接入 profile 树。

## 验收（实测）
| 判据 | 结果 |
|---|---|
| `--dump-config` | rc=0 / **199** 条目（与升级前一致，WE 未引入新条目） |
| `disabling`（peer 闸门） | **0** |
| 未激活条目 | **2**（回到基线：`vision-adam`、`session-board` —— 均为 settings 断层，属规划 A） |
| SSH 族 | `ssh-remote` / `ssh-web-channel` / `ssh-gui` **全部激活**（升级前一度 5 个失败，修复后归零） |
| URL 发放 | `http://127.0.0.1:3098` |
| 停栈 | 端口 FREE |

## 附带核实
- `dsh-client-runtime` 在 WE 0.2.2 的 `lib/client.js` 里 **0 处**引用（仅在 `package.json` 的 `dsh.client.inject` 出现 1 次，而该字段经核实是**信息性**的，不影响加载）。
- 0.2.2 已无 `node_modules` 私有岛（这是好事：符合 D10「丢弃私有岛」的方向）。
- 旧件已备份：`we-build/we-0.1.2-migrated-backup/`。

## 遗留
- `@local/dsh-ssh-gui` 客户端硬编码 `CH_DWS = "/dsw"` 的问题**本次未暴露**（ssh-gui 加载成功）。WE 0.2.2 是否已兼容旧 `/dsw` 路径**未实测**；如后续 SSH 远端子功能报错，此处为首查点。
- 规划 A（3 个 settings 插件）与 btw 未做。
