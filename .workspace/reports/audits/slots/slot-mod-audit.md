# 改官方槽使 directoryFlow 支持多消费者 / 远程主机文件夹 —— 可行性与成本审计

> 只读调研（不改代码）。审计对象：0.1.1-rc.2 现网（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh`，profile 软链指向同树）与 0.1.5-rc.2 归档（`~/.dsh/profiles-archive/web2-20260915-105429`）。
> 复核并扩展了 `ssh-gui-exec.md §0`（E1–E6 证据本审计逐条复核一致，新增「运行时加载架构」证据 E7–E9，这是评估改槽成本的关键）。
> 路由：adam/deepseek-v4-flash（本档）。

---

## 0. 结论摘要（先读）

1. **改槽（Path A，把 directoryFlow 从 `single` 改成 `list/keyed/chain`）可行，但远不是"改一行 kind"**：
   最小改动面 = 官方 `dsh-client-ui-workspace` client.js 2 处 kind 声明 + **官方 WorkspacePickFlow 消费端必须新增"选哪个流"的交互改造** + 底座 `dsh-workspace-enhancement` 补 `id`（list 槽注册强制要求 `id`，不补则底座注册直接 throw）+ ssh-gui 补注册与 props 适配。
   渲染语义冲突是**结构性**的：`list` 槽多消费者会**同时挂载、同时响应同一个 owner 的 `open` 标志**（官方把槽占用当布尔、流对话是单次会话），不改造消费端则两个对话框同时弹出/两个 native driver 同时拉起。`chain` 槽更糟：官方消费端用的是 `renderSlot`，对 chain 声明**直接 throw**，必须改 `renderSlotChain`。
   结论：**Path A 的成本大头在"官方消费端语义改造"，不在槽机制本身**；且它把官方 picker（browse/native，均无 `id` 注册）的契约变成地雷。

2. **Path B（不动 directoryFlow，新增 sidecar list 槽）是推荐路径**：官方 `sidebar.workspaces` 条目新增一个 `sidebar.workspaces.remoteHosts`（list/root）子槽声明 + WorkspaceBrowser 一个渲染点；底座/官方 picker/官方流对话**零改动**；ssh-gui 以其 `id` 注册进新槽渲染「远程主机」文件夹树（组件已就绪，仅换注册点）。空槽自动零渲染（SlotOutlet 无条目时返回空），不装 ssh-gui 时 UI 无任何变化。风险面最小。

3. **0.1.5 没有任何可借的**：0.1.5-rc.2 的 directoryFlow **仍是 `single`**（同名、同 children、同 flowSource、同渲染器 kind 分派；其 shell bundle 内嵌 SlotCore 的 single 语义文案与 0.1.1 逐字相同）。0.1.5 相对 0.1.1 只新增了与多消费者无关的 `hostInfo`（RemoteHostFacts）钩子。**Path C（cherry-pick 0.1.5）= 空集**，官方版本线至今没有动 directoryFlow。

4. **关键运行时架构发现（决定改槽成本）**：
   - 浏览器里真正执行的 SlotCore **编译在 web shell 预构建 bundle 里**（`dsh-web-frontend/dist/assets/index-ClqxG24t.js` 的 staticModules 含 `"@deepseek-ai/dsh-client-ui-slots"`）→ **改 node_modules 里 `dsh-client-ui-slots/lib/index.js` 对运行无任何效果**（要改 register 语义必须重建/改预构建 bundle，成本高）。
   - 但 **slot kind 是声明数据**：`dsh-client-ui-workspace/lib/client.js`（children 表）与 renderer 是按 `/plugins/<id>/client.js` 从 node_modules **动态服务**的 → **改 workspace client.js 的 kind 声明即时生效**（重启 + 刷新即可，内嵌 SlotCore 已原生支持 list/keyed/chain）。
   - 即：**"改官方槽"唯一值得改的文件是 `dsh-client-ui-workspace/lib/client.js`**（+ 需要时 `dsh-workspace-enhancement/lib/client.js`、`dsh-ssh-gui/lib/client.js`），且该文件在 `.npm-global` DSH 全局安装树里（profile 软链共用）→ 补丁链要按"全局官方文件补丁"登记备份/重放。

5. **推荐**：**Path B**（sidecar list 槽，先做 sidebar 侧），成本 ≈ 官方包 +2 处小改动、ssh-gui +1 处注册，无流对话改造、无底座/官方 picker 改动；作为远期可再议 Path A（若愿意改造官方流对话为"流选择器"）。0.1.5 不提供任何捷径。

---

## 1. 现状复核（证据表，file:line）

| # | 证据 | 位置 | 内容 |
|---|---|---|---|
| E1 | directoryFlow 双孔均为 `single` | `~/.npm-global/.../@deepseek-ai/dsh-client-ui-workspace/lib/client.js` L2436-2439（sidebar）、L2446-2449（conversation）；契约 `lib/types/client/contract/slots.d.ts` L49-60 | `children: { "sidebar.workspaces.directoryFlow": { kind: "single", scope: "root" } }`；`'conversation.hero.workspace.directoryFlow': { kind: 'single'; scope: 'root' }` |
| E2 | single 槽同 priority 二次注册 throw；异 priority=shadow（最低渲染） | `dsh-client-ui-slots/lib/index.js` L70-75（实物副本 `dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js` L71-75 同） | `case "single": { const occupant = rec.entries.find(e => (e.options.priority ?? 0) === priority); if (occupant) throw new Error('single slot "…" already has a registration …') }`；L69 注释 "register at a different priority to shadow it (lowest renders)" |
| E3 | 多消费者仅 list/keyed/chain 支持 | 同上 L76-91 | list 要求 `options.id`、keyed 要求 `options.key`、chain 要求 `options.select`；`entriesOfSlot` L179-194：single/keyed/list 按 cell 取 shadowing winner，chain 返回原始 entries 全量 |
| E4 | 底座已占双孔 | `dsh-workspace-enhancement/lib/client.js` L5364-5375 | 两次 `ctx.slots.register({name: "<hole>", locale: "dsw", inject}, SshWorkspaceFlow)`，无 `id/priority` |
| E5 | occupied 布尔语义 | workspace client.js L830（WorkspacePickFlow `flowAvailable = useDirectoryFlow(o => o)`）、L1654（WorkspaceBrowser `directoryFlowAvailable`）、L2380-2383（`flowSource` getSnapshot = `ctx.slots.entries(hole).length > 0`） | 官方把槽占用当布尔：占用 → 显示"Add workspace…"入口并由唯一消费者接管渲染 |
| E6 | 官方两个 picker 也是无 `id` 注册，当前组成未启用 | browse `dsh-client-ui-directory-picker-browse/lib/client.js` L1026-1034、native L64-72；`cordis.patch.yml`（`~/.dsh/profiles/web/`）disable `directory-picker`、只 insert `dsh-host-directory-picker-browse`（主机侧，无 dsh.client） | 现网 directoryFlow 唯一占用者 = 底座 SshWorkspaceFlow；官方 browse/native 的 client 未组成 |
| E7 | **运行时 SlotCore 在预构建 shell bundle 内** | `dsh-web-frontend/dist/assets/index-ClqxG24t.js`：staticModules 映射含 `"@deepseek-ai/dsh-client-ui-slots": g6`；`dsh-client-runtime/lib/client.js` L8/L25 `require("@deepseek-ai/dsh-client-ui-slots")` + `_core = new SlotCore()` | 权威注册表实例由 runtime 创建，但类实现来自 shell 内嵌静态模块 → 改 node_modules slots 源码对运行无效 |
| E8 | 插件 client 半部按 `/plugins/<id>/client.js` 动态服务 | `dsh-client-modules/lib/index.js` L152-160（graphRow url）、L199-249（boot 注入）、`lib/client.js` L251-260（makeRequire：seed→memo→factory） | workspace/renderer/底座/ssh-gui 的 client.js 从 node_modules 实时读取；改文件后需重启（rev=内容 hash，`ClientModuleRegistry.rebuilt` 才刷新） |
| E9 | renderer kind 分派原生支持 list/keyed/chain | `dsh-client-ui-renderer/lib/client.js` L794-847（single L794-798 / keyed L799-803 / chain L804-827 且 L288 `declared.kind === "chain"` 时 `renderSlot` throw / list L829-847，L845 `opts.only` 过滤） | list 槽无需改 renderer：多 consumer 各自带 `id` 注册即共存渲染 |
| E10 | 0.1.5 directoryFlow 未变 | 归档 `dsh-client-ui-workspace/lib/client.js` L2796-2799/L2806-2809（children 仍 `kind: "single"`）、L2740-2743（flowSource 同）、L1211/L2325（renderDirectoryFlow 同）；`lib/types/client/contract/slots.d.ts` L51-58（single）；归档 shell `index-BKQ_L1z6.js` single 文案与 0.1.1 逐字同 | **0.1.5 无多消费者支持、无新增槽**；仅新增 `hostInfo`（L2745-2748，RemoteHostFacts）与 uiWorkspace 门面重构，均与多消费者无关 |
| E11 | ssh-gui 现状 = 降级 | `deploy-ssh-gui/dsh-ssh-gui/lib/client.js` L641-654（仅 `settings.section` id=`@local/dsh-ssh-gui` order=50、`conversation.session.header.actions` id=`@local/dsh-ssh-gui-actions` order=26）；L9-10/L444 注释明示"directoryFlow 槽为单消费者被底座占用，此处为同 UX 降级入口" | 未注册任何 directoryFlow seam；RemoteBrowser（L124）已实现「打开为工作区」（L164 `workspaces.connectWorkspace`），可复用 |

> 注：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-slots` 是悬空软链（指向已清理的 npx 缓存），已由 E7 解释为何不影响运行（浏览器不从这里加载）。

---

## 2. 槽机制全景（决定"改哪几处"的依据）

- **SlotCore（注册表）**：`register(options, component)` 按 `spec.kind` 校验——single 同 priority 唯一、keyed 按 key、list 按 id、chain 按 select（E2/E3）；`entriesOfSlot` 投影 shadowing winner；声明只能由父条目的 `children` 表建立（`register` L66 "slot not declared"）。
- **渲染契约（renderer）**：消费方通过 props 里的 `renderSlot(key, owner)` 渲染自己声明的子槽；`SlotOutlet` 按 kind 分派（E9）；**list 槽把所有 winner 按 `order` 堆叠渲染到同一个锚点**，每个 consumer 收到**同一份 owner props**。
- **占用即布尔**：官方消费端把 directoryFlow 占用投影为 `useDirectoryFlow(occupied)`，入口显隐（E5）。
- **加载架构（新增，E7/E8）**：SlotCore 语义代码在 shell 预构建 bundle；kind 声明数据在动态服务的 workspace client.js。→ 改 kind 可行、改 register 语义不可行（不重建 shell）。

---

## 3. 路径 A：改 slot kind（single → list / keyed / chain）

### 3.1 最小改动面

| # | 改动 | 文件:行 | 内容 |
|---|---|---|---|
| A1 | kind 声明 | `dsh-client-ui-workspace/lib/client.js` L2437、L2447 | `kind: "single"` → `kind: "list"`（2 处）；同步 `types/client/contract/slots.d.ts` L50/L56（契约卫生，非运行必需） |
| A2 | **消费端语义改造（成本大头）** | 同文件 L821-946（WorkspacePickFlow）、L1960-1993（sidebar 入口） | list 槽多消费者同锚点堆叠 + 共享 owner `open` → 必须新增"流选择"（如 Add 子菜单/分段控件），按用户选择只给目标流 `open=true`，其余 `open=false`；或用 `renderSlot(key, owner, {only: id})`（E9 L845）逐流渲染——两者都需要消费端知道各流 id（需订阅 `entries(hole)` 而非布尔）。**不改则：点一次 Add，底座 SSH 流与 ssh-gui 流同时弹出/同时拉起 native driver，互抢一次 onPicked 会话** |
| A3 | 底座适配 | `dsh-workspace-enhancement/lib/client.js` L5365-5369、L5370-5374 | 两个 register 补 `id: "dsh-workspace-enhancement"`（list 槽无 id 注册直接 throw，底座不补 = 注册失败，Add 入口消失） |
| A4 | ssh-gui 适配 | `dsh-ssh-gui/lib/client.js` | 新增 2 个 register（双孔，id=`@local/dsh-ssh-gui-remote`）；RemoteBrowser 适配 DirectoryFlowOwnerProps（`open/busy/onPicked/onCancel/onError`，onPicked 交回 `ssh://` 路径或目录路径，复用 L164 链路）——组件已就绪，改动小 |
| A5 | 契约地雷 | 官方 browse/native picker（E6） | 若未来启用官方 browse/native client，其无 `id` 的注册会对 list 槽 throw；需一并改（或保持不启用并登记为已知限制） |

### 3.2 影响面 / 风险

- **官方 picker 流**：当前未组成（E6）无即时影响，但契约层面被破坏（无 id 注册即废）。
- **底座 SshWorkspaceFlow**：必须同步补丁（A3），否则底座流整体失效——底座与官方槽形成**耦合补丁**（一次升级/换版要同批重放）。
- **现有 UI**：Add 交互从"点一下开一个流"变成"选流"，官方空态菜单的 UX 被改动（官方代码被我们改）。
- **风险等级：中高**。渲染语义冲突是结构性的（E9 同 owner 堆叠），A2 是官方组件重设计，超出"小补丁"范畴；若 A2 不做对，轻则双弹窗、重则流对话状态错乱（busy 标志互相覆盖）。

---

## 4. 路径 B：新增 sidecar 槽（推荐）

### 4.1 最小改动面

| # | 改动 | 文件:行 | 内容 |
|---|---|---|---|
| B1 | 新子槽声明 | `dsh-client-ui-workspace/lib/client.js` L2436-2439 children 表 | 追加 `"sidebar.workspaces.remoteHosts": { kind: "list", scope: "root" }`（与 directoryFlow 平级；同步 slots.d.ts 追加 SlotMap key，契约卫生） |
| B2 | 新渲染点 | 同文件 WorkspaceBrowser，L2013 `listArea` 之前 | `wide && renderSlot("sidebar.workspaces.remoteHosts", {})`（不传 owner 亦可：root 域条目自带 `useSessions/useWorkspaces` 标准钩子 L540-542；ssh-gui 自己的 inject 提供 rpc/workspaces/sessions）。**空槽时 SlotOutlet 无条目 → 渲染空（display:contents 锚点），不装 ssh-gui 时 UI 零变化** |
| B3 | ssh-gui 注册 | `dsh-ssh-gui/lib/client.js` apply() | 新增 `ctx.slots.inject("sidebar.workspaces.remoteHosts", () => ctx.slots.register({ name: "sidebar.workspaces.remoteHosts", id: "@local/dsh-ssh-gui-remote-hosts", order: 10, label: () => "远程主机", inject: () => ({ rpc, workspaces, sessions }) }, SidebarRemoteHostsTree))`；组件 = RemoteBrowser 的 sidebar 版（顶部「远程主机」→ 各主机 → 目录下钻 → 打开为工作区，全部已实现，L124/L164/L241） |
| B4 | 可选扩展 | 同上 | 如需空态 picker 也出现远程项，可再在 `conversation.hero.workspace` children 加同名子槽并渲染（v1 不建议，菜单空间小） |

### 4.2 影响面 / 风险

- **官方 picker / 底座 / 现有 UI**：零改动、零影响（directoryFlow 仍是 single，底座占用不动；新槽是增量，无注册冲突）。
- **风险等级：低**。唯一注意点：B2 的 DOM 位置在 sidebar 树区上方，需给 section 定高（如 max-height + 内部滚动），避免挤压会话树；list 槽意味着未来任何插件都能加自己的文件夹 section（可扩展性好）。
- **与「真·文件浏览器集成」的达成度**：侧栏内获得独立的「远程主机」目录树（与底座 SSH 流并列，不互斥），点目录即「打开为工作区」——满足"远程主机文件夹真集成"，只是**不在 Add-workspace 流对话框里**，而是独立 section（这正是 single 槽语义下不被底座排斥的唯一干净形态）。

---

## 5. 路径 C：0.1.5 借用 —— 空集

- directoryFlow 契约 0.1.5 与 0.1.1 **逐字相同**（E10：children `single`、flowSource、renderer kind 分派、SlotCore single 文案均一致）；0.1.5 无新增相关槽。
- 0.1.5 唯一相关增量 `hostInfo`（RemoteHostFacts 钩子，workspace L2745-2748）与多消费者无关；`uiWorkspace` 门面重构只是服务访问方式变化。
- 结论：**无 cherry-pick 价值**；官方版本线尚未解决此问题，等官方不如自己 Patch B。

---

## 6. 与现有补丁链（replay）的关系

现网补丁链模式（已核实）：
- 官方包补丁直接改 `.npm-global` DSH 全局安装树（profile 软链共用同一文件），备份归档在 `~/dsh-upgrade-backup/patched-official-files.tgz`（含 dsh-client-ui-subagent / dsh-web-search-deepseek / dsh-agent-loop），升级重放记录在 `port-*.md` / `switch-web2-runbook.md`。
- 自建插件走 `deploy.sh`（dry-run/apply/rollback 三段式，拷贝到 `~/.dsh/profiles/node_modules` + 改 `cordis.patch.yml`）。

Path A/B 都需要对**官方包 `@deepseek-ai/dsh-client-ui-workspace`** 打补丁（Path A 还需 `dsh-workspace-enhancement`）→ **replay 脚本需扩展**：
1. 新增一个 `patch-official-slots.sh`（沿用 deploy.sh 的 dry-run/apply/rollback 三段式）：备份 `dsh-client-ui-workspace/lib/client.js`（+Path A 时 `dsh-workspace-enhancement/lib/client.js`）→ 按行锚点替换（children kind / 新增子槽 / renderSlot 点）→ 语法自检（`node --check`）→ 提示重启 dsh + 刷新。
2. 归档条目加入 `patched-official-files.tgz` 清单与 `switch-web2-runbook.md` 的 replay 表（升级后重打）。
3. 生效方式：改的是动态服务的 client.js（E8），**重启 dsh（或触发 ClientModuleRegistry.rebuilt）后浏览器刷新即可**；不需要重建 web shell。
4. 全局影响提示：workspace 包被所有 profile 共用，补丁是**全局官方修改**，回滚靠备份还原（rollback 步骤必须写）。

---

## 7. 推荐与落地单元

**推荐：Path B（sidebar sidecar list 槽）**。理由：改动面最小（官方 2 处 + ssh-gui 1 处，约 10-20 行）、不碰底座与官方 picker、无流对话语义冲突、空槽零 UI 影响、组件已就绪；与"底座已占两孔位"的现状完全兼容。

落地单元（供修订执行复核一体档逐条实现）：
1. `dsh-client-ui-workspace/lib/client.js`：sidebar.workspaces children 追加 `sidebar.workspaces.remoteHosts`（list/root）；WorkspaceBrowser 在 listArea 前加 `renderSlot` 渲染点（带 section 样式约束）。
2. `dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts`：SlotMap 追加新 key（契约卫生）。
3. `dsh-ssh-gui/lib/client.js`：apply() 注册新槽（id/order/inject），SidebarRemoteHostsTree 复用 RemoteBrowser 逻辑。
4. `patch-official-slots.sh`（dry-run/apply/rollback）+ 备份登记 + runbook replay 表更新。
5. 验收：不装 ssh-gui 时侧栏无变化；装后侧栏出现「远程主机」树，可下钻、打开为工作区；底座 SSH 流/官方 picker 行为不变；`node --check` 全绿；重启 + 刷新后生效。

**不推荐现在做 Path A**（消费端流选择器改造属于官方组件重设计，成本≈Path B 的 3-5 倍且耦合底座补丁）；**Path C 无内容**。若未来官方把 directoryFlow 声明为 list（E10 显示至今未动），再平滑迁移到 Path A 也不迟——届时底座与 ssh-gui 按 id 共存即可。
