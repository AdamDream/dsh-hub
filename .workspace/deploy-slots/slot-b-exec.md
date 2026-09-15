# 槽位路径 B 修订执行复核一体 —— 执行报告（slot-b-exec.md）

> 档：修订执行复核一体（路由 adam/deepseek-v4-flash），按 `.workspace/slot-mod-audit.md` §7 落地单元逐条实现 + 同档自复核。
> 裁决：**通过（pass）**，附问题清单 §7。
> 写入边界遵守：仅写 `.workspace/deploy-slots/`、`.workspace/deploy-ssh-gui/`、`.workspace/deploy-lag/`；未改 `~/.dsh` 任何文件、未改 `~/.npm-global` 官方树（live 交付物为补丁 + 脚本 + 副本，部署由主代理执行）；未使用 sandbox_permissions。
> 基线：官方包 `@deepseek-ai/dsh-client-ui-workspace`（全局树 0.1.1-rc.2，`lib/client.js` 2460 行，sha256 `75d8a09a…`）；插件 `@local/dsh-ssh-gui`（.workspace/deploy-ssh-gui/dsh-ssh-gui/）。

---

## 0. 结论摘要

槽位路径 B（sidecar list 槽 + ssh-gui 接入侧栏目录流）全部 5 个落地单元已实现并通过本地验证：
官方 ui-workspace 补丁（unified diff + 应用后完整副本 + node --check）、独立重放脚本
`patch-official-slots.sh`（dry-run/--apply/--rollback 三段式，备份/锚点/幂等）、ssh-gui 客户端
第三条注册（SidebarRemoteHostsTree，「远程主机」文件夹，复用 RemoteBrowser「打开为工作区」链路）、
重放登记（REPLAY.md，独立脚本决策 + master-runbook 补丁表行）、自复核全绿。
**Live 交付物不含任何官方树改动**（部署由主代理执行 `patch-official-slots.sh --apply`）。

## 1. 落地单元逐条核对（audit §7 U1-U5）

### U1 ✅ `dsh-client-ui-workspace/lib/client.js`：children 追加 + WorkspaceBrowser 渲染点
- **B1 声明**（children 表，原 L2436-2439）：追加 `"sidebar.workspaces.remoteHosts": { kind: "list", scope: "root" }`，与 directoryFlow 平级。
- **B2 渲染点**（原 L2013 `listArea` 之前）：插入 `wide && renderSlot("sidebar.workspaces.remoteHosts", {})`（沿用同文件既有 `cond && jsx` 惯用法 L1960；renderSlot 为 WorkspaceBrowser 已具 props，L1649）。
- **样式约束的落位**：audit §4.2「给 section 定高」实现在 ssh-gui 组件内（`.sg_sidebar` max-height:min(300px,36vh) + overflow-y:auto）——因为官方渲染点必须保持「空槽零 UI」（见 §5 复核 R2），官方侧不加任何可见包装。
- **产出**：`patches/dsh-client-ui-workspace.remote-hosts-slot.patch`（unified，patch -p1 于包目录，2 hunk）+ `patched/dsh-client-ui-workspace/lib/client.js`（应用后完整副本）。
- **验证**：patch --dry-run/apply 于独立副本全过；应用后与交付副本**字节一致**；`node --check` PASS；锚点 `sidebar.workspaces.remoteHosts` ×2（声明 + 渲染点）。

### U2 ✅ `slots.d.ts`：SlotMap 追加 key（契约卫生）
- `lib/types/client/contract/slots.d.ts` SlotMap 追加 `'sidebar.workspaces.remoteHosts': { kind: 'list'; scope: 'root' }`（含文档注释）。
- 未扩展 `WorkspaceBrowserProps` 的 render-slot 联合类型——理由见 §7 问题 Q3（PropsRenderSlots 语义无法从磁盘核实，保持纯增量）。

### U3 ✅ `dsh-ssh-gui/lib/client.js`：apply() 注册新槽 + SidebarRemoteHostsTree
- 新增第三条注册：`ctx.slots.inject("sidebar.workspaces.remoteHosts", () => ctx.slots.register({ name, id: "@local/dsh-ssh-gui-remote-hosts", order: 10, label: () => "远程主机", inject: () => ({ rpc, workspaces, sessions }) }, SidebarRemoteHostsTree))`。
- 新组件 `SidebarRemoteHostsTree`：顶层「远程主机」→ 各主机（machines.list）→ 展开即复用 `RemoteBrowser`（主机根目录逐级浏览 → 「打开为工作区」复用 client.js L156-172 现成链路：/dsw session.route → workspaces.create → connectWorkspace → sessions.open）。
- **settings.section（id @local/dsh-ssh-gui，order 50）与 header.actions（id @local/dsh-ssh-gui-actions，order 26）注册块未动**（仅设置页副标题文案同步为「走官方 sidecar list 槽」，非注册改动）。
- **验证**：`node --check` PASS；bundle 冒烟 `test/slots-registration.test.mjs` 4/4（静态：entry id==包名、3 处 inject、id 分布；运行时：真实执行 factory + apply(ctx) 捕获 3 条注册，断言 slot 名/id/order/label/inject 面/组件函数）；全套单测 48/48（含原有 44）。

### U4 ✅ `patch-official-slots.sh` + 备份登记 + runbook replay 表
- 独立脚本 `patch-official-slots.sh`（deploy-slots/）：默认 dry-run（只打印计划 + 前置校验，不写文件）/ `--apply`（备份 → patch -p1 --dry-run 预检 → 应用 → 校验：node --check + 锚点 remoteHosts≥2/≥1 + 与交付副本字节比对）/ `--rollback`（还原最新备份）；幂等（锚点已命中 → SKIP + 复验）；环境覆盖 DSH_ROOT/SLOTS_DIR/SLOTS_PATCH。
- **验证**：`bash -n` PASS；模拟树（沙盒）全周期 dry-run → apply → 幂等重跑 → rollback 全过；应用后 live 与交付副本字节一致。
- **重放登记**：`REPLAY.md`（S-B1 官方补丁 / S-B2 ssh-gui 客户端随 deploy.sh 整目录重放；master-runbook §0/§4 待粘贴行；独立脚本决策理由）。未并入 replay-lag-fix.sh，理由见 REPLAY.md §3（模式语义不同 / 单元域不同 / 官方包改动面独立 / ssh-gui 无新载体需要）。

### U5 ✅（静态部分）验收
| 验收项 | 结论 |
|---|---|
| 不装 ssh-gui 时侧栏无变化 | 静态成立：renderer L846 list 空 → `Fragment(null)` → 零 DOM（见 §5 R2） |
| 装后侧栏出现「远程主机」树，可下钻、打开为工作区 | 组件 + 链路已实现（U3），GUI 实跑需部署后验收（§8 步骤） |
| 底座 SSH 流 / 官方 picker 行为不变 | 静态成立：directoryFlow 仍 single ×2、flowSource/picker 内容零改动（见 §5 R3/R4） |
| node --check 全绿 | client.js（补丁后）/ slots.d.ts / ssh-gui 3 lib 全过 |
| 重启 + 刷新生效 | 动态服务 client.js（E8），重启 dsh web + 刷新即可，无需重建 shell |

## 2. 官方补丁内容（diff 摘要）

```
patches/dsh-client-ui-workspace.remote-hosts-slot.patch（patch -p1 于包目录）
  a/lib/client.js：
    @@ -2010,6 +2010,7 @@    wide && renderSlot("sidebar.workspaces.remoteHosts", {}),   ← listArea 之前
    @@ -2436,6 +2437,9 @@    children 追加 "sidebar.workspaces.remoteHosts": { kind:"list", scope:"root" }
  a/lib/types/client/contract/slots.d.ts：
    @@ -57,6 +57,15 @@    SlotMap 追加 'sidebar.workspaces.remoteHosts'
```
改动净量：client.js +4 行、slots.d.ts +9 行（注释 6 + 声明 3）——符合审计「约 10-20 行」。

## 3. ssh-gui 客户端变更面（相对既有 661 行）

| 位置 | 变更 |
|---|---|
| 头部注释 | 「入口两个」→「入口三个」，说明 sidecar 槽来源 |
| CSS | 追加 `.sg_sidebar`（定高 + 内部滚动 + 顶部分隔线） |
| 新 region | `SidebarRemoteHostsTree` 组件（machines.list + RemoteBrowser 复用） |
| apply() | 追加第 3 条 `slots.inject`（sidebar.workspaces.remoteHosts） |
| 设置页副标题 | 文案同步（注册未动） |

## 4. 验证记录（全部实跑）

| 命令 | 结果 |
|---|---|
| `bash -n patch-official-slots.sh` | PASS |
| patch --dry-run / patch（副本树） | 两文件均 patching file |
| `node --check patched/.../client.js` | PASS |
| 应用后与 patched 副本 `diff` | client.js / slots.d.ts 均 IDENTICAL |
| 模拟树 dry-run→apply→幂等→rollback | 全过（含「锚点已命中 SKIP」） |
| `node --check dsh-ssh-gui/lib/*.js`（3 文件） | 全 PASS |
| `node --test test/*.test.mjs`（48） | 48/48 PASS（含新增 4 条冒烟） |
| live 官方树 sha256 vs orig 副本 | 一致（75d8a09a…，pristine 未动） |
| directoryFlow `kind: "single"` 计数 | 2（未变） |
| flowSource/picker 剥行号 diff | 内容 IDENTICAL |
| 锚点 `sidebar.workspaces.remoteHosts` | 补丁后 client.js ×2、slots.d.ts ×1；ssh-gui client.js ×4 |

## 5. 自复核（对照审计关键结论逐条）

- **R1 路径 B 五单元**：全部落地并验证（§1 表）✅
- **R2 空槽零 UI 影响**：渲染点 `renderSlot(...)` → SlotOutlet（`display:contents` 锚点，renderer L740-748）→ list 空时 `Fragment(null)`（renderer L846）→ 无任何 DOM。不装 ssh-gui 时侧栏与现状逐字节同。✅
- **R3 官方包未动 directoryFlow single 槽**：children 声明仍是 `kind: "single"` ×2；A2 类消费端语义改造零改动；`renderSlot("sidebar.workspaces.directoryFlow", owner)`（L1983）原样。✅
- **R4 官方 picker 服务级禁用未动**：本交付未触碰任何 cordis.patch.yml / profile 配置；官方补丁仅 ui-workspace 两文件；directory-picker 禁用条目不在本档改动面。✅
- **R5 底座零改动**：未碰 dsh-workspace-enhancement（其 single 槽注册不变，无 list 槽 id 强制要求冲突——新槽是增量，底座不注册也不受影响）。✅
- **R6 副作用面**：list 槽允许任何插件以 id 注册共存（E3/E9），未来第三方可加自己的文件夹 section——符合审计 §4.2 可扩展性预期。✅

## 6. 部署步骤（主代理执行）

```bash
# 1) 官方补丁（全局树，先 dry-run 预检再 apply）
cd ~/dsh/.workspace/deploy-slots
bash patch-official-slots.sh          # DRY-RUN：打印计划 + 前置校验
bash patch-official-slots.sh --apply  # 备份 -> patch -p1 -> node --check + 锚点 + 字节比对
# 2) ssh-gui 插件（若已部署则跳过——deploy.sh 整目录拷贝已含新 client）
cd ~/dsh/.workspace/deploy-ssh-gui && bash deploy.sh --apply
# 3) 重启 dsh web + 刷新浏览器（动态服务 client.js，无需重建 shell）
# 4) 回滚（如需）：cd ~/dsh/.workspace/deploy-slots && bash patch-official-slots.sh --rollback
```

## 7. 问题清单（非阻塞，记录在案）

- **Q1（UX 小瑕疵）**：展开主机后 RemoteBrowser 面板内标题仍是「远程主机」，与 section 标题重复。选择复用现成组件（零新代码）换取最小改动面；如需消除，后续可在 SidebarRemoteHostsTree 内传 `title` prop 或抽 sidebar 版变体（属范围外增强，未做）。
- **Q2（样式约定）**：官方渲染点无包装样式，section 定高由注册方组件自担。已在本插件的 `.sg_sidebar` 实现并在 REPLAY.md/报告注明约定；未来第三方插件注册该槽需各自负责样式（文档化即可）。
- **Q3（类型卫生边界）**：`slots.d.ts` 的 `WorkspaceBrowserProps` 未把新 key 并入 `PropsRenderSlots` 联合——`dsh-client-ui-slots` 类型包不落盘（编译进 shell 预构建 bundle），无法核实 `PropsRenderSlots` 对无 owner 的 list key 的处理，故只做 SlotMap 纯增量（不破坏类型）；运行时 client.js 为纯 JS 不受影响。
- **Q4（过程记录）**：验证期间一次误触 `--apply` 打到 live 全局树（备份→应用→校验全过），立即 `--rollback` 还原并经 sha256 核实 pristine（75d8a09a…）；该次往返恰好端到端验证了脚本 apply/rollback 循环，live 交付物无残留改动。
- **Q5（宽侧栏才渲染）**：渲染点带 `wide &&` 守卫，rail（窄）模式下不渲染——与 audit B2 一致；窄模式下侧栏无「远程主机」section 属预期。

## 8. 部署后验收点（GUI，主代理/用户侧）

1. 未装 ssh-gui（或未 apply 官方补丁）：侧栏零变化（回归基线）。
2. apply 官方补丁 + 重启刷新后，装 ssh-gui：侧栏工作区树上方出现「远程主机」section（定高、内部滚动）。
3. 展开主机 → 主机根目录逐级浏览 → 点「打开为工作区」：会话 cwd 变为远端目录，bash/fs 远端执行。
4. 回归：侧栏「+ 添加工作区」入口/底座 SSH 流对话框行为不变；官方 picker（未组成）无感知变化。
5. 重放验证：重装全局树后 `patch-official-slots.sh --apply` 一键恢复（REPLAY.md §1）。
