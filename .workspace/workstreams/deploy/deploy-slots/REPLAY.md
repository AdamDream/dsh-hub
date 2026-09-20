# 重放登记 —— 槽位路径 B（官方 ui-workspace 补丁 + ssh-gui 客户端接入）

> 依据：`.workspace/slot-mod-audit.md` §6/§7（replay 体系要求）与 `master-runbook.md` §1b（npm 遮蔽事故教训：
> 官方包补丁必须登记进重放体系，重装/换版后一键恢复）。
> 本次落地（修订执行复核一体档，`.workspace/deploy-slots/slot-b-exec.md`）。

## 1. 新增重放条目（本次引入）

| 重放条目 | 内容 | 载体 | 生效方式 |
|---|---|---|---|
| S-B1 | 官方 `@deepseek-ai/dsh-client-ui-workspace` 槽位路径 B 补丁（`lib/client.js` children 声明 + WorkspaceBrowser 渲染点；`slots.d.ts` 契约卫生） | **独立脚本** `.workspace/deploy-slots/patch-official-slots.sh`（dry-run/--apply/--rollback 三段式，备份 + patch -p1 + 锚点校验 + 幂等） | 重启 dsh web + 浏览器刷新（动态服务 client.js，E8） |
| S-B2 | ssh-gui 客户端新增 `sidebar.workspaces.remoteHosts` 注册（SidebarRemoteHostsTree） | 已并入插件源码 `@local/dsh-ssh-gui/lib/client.js`，由现有 `deploy-ssh-gui/deploy.sh --apply`（整目录拷贝）重放，**无需新脚本** | 重启 + 刷新（插件 client 由插件目录静态伺服） |

**重放命令**（重装全局树/换版后）：
```bash
# 1) 官方补丁（先在目标树验证未应用状态）
cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh            # dry-run 预检
cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --apply    # 真实应用
# 2) ssh-gui 插件（若插件目录被清）：
cd ~/dsh/.workspace/deploy-ssh-gui && bash deploy.sh --apply
# 3) 重启 dsh web + 刷新浏览器
```

**回滚**：`cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --rollback`（还原最新备份）。

## 2. 补丁表登记（请主代理粘贴进 master-runbook.md §0 已部署清单 / §4 回滚节）

建议行（`master-runbook.md` 是 .workspace 根文件，修订执行档受写入边界约束未直接改动，此表为待粘贴内容）：

```markdown
| 槽位路径 B | 官方 ui-workspace sidecar list 槽 `sidebar.workspaces.remoteHosts`（children 声明 + WorkspaceBrowser 渲染点 + slots.d.ts 契约）+ ssh-gui 客户端「远程主机」文件夹树（侧栏目录流真集成，不碰 directoryFlow single 槽） | 全局树 dsh-client-ui-workspace（patch-official-slots.sh）+ @local/dsh-ssh-gui client |
```

回滚节追加：
```markdown
# 槽位路径 B 官方补丁回滚
cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --rollback
# ssh-gui 侧栏条目随插件整目录移除（deploy-ssh-gui/deploy.sh --rollback）
```

## 3. 是否并入 replay-lag-fix.sh —— 决策：**不并入，独立脚本**（理由）

1. **模式语义不同**：`replay-lag-fix.sh` 是 `run / --dry-run / --rollback`（默认执行）；`patch-official-slots.sh` 沿用 `deploy.sh` 的 `dry-run / --apply / --rollback`（默认只读预检）。两套语义并存会增加误操作面（例如在 lag-fix 默认 run 模式下误执行）。
2. **单元域不同**：lag-fix 的单元是「卡顿修复 + P0 子代理打开」（agent-loop / ui-subagent / web-search / host-apiproxy / dsh-subagent / settings）；槽位路径 B 是独立的特性域（sidebar 目录流集成）。混入后，回滚 lag-fix 批次会连带回滚/备份槽位补丁，耦合不该耦合的域。
3. **官方包改动面独立**：路径 B 只碰 `dsh-client-ui-workspace`（lag-fix 未碰此包）；`dsh-client-ui-workspace` 补丁与 lag-fix 各包之间无顺序依赖（均独立文件、独立锚点），分开不影响任何执行顺序。
4. **SSH-gui 客户端无需新重放载体**：插件改动随 `deploy.sh --apply` 整目录重放（既有机制），仅在 REPLAY.md 登记。

> 若未来 Path A（改 directoryFlow kind）实施，官方消费端/底座将形成耦合补丁（audit A3/A4），届时建议把这些 workspace 域官方补丁统一收进一个 `patch-official-workspace.sh` 家族（仍与 lag-fix 分离），由主代理裁决。

## 4. 升级注意事项（沿用 master-runbook §1b 约定）

- **绝不对 `~/.dsh/profiles/web` 执行 npm/pnpm install**——会装未打补丁的本地副本，遮蔽本补丁（全局树官方文件）。
- 补丁是全局官方修改（workspace 包被所有 profile 共用），回滚必须走 `--rollback` 备份还原。
- 生效条件：重启 dsh web + 刷新浏览器（动态服务 client.js，E8；无需重建 shell bundle）。
