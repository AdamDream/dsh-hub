# 设置页卡顿修订：只读执行前审计与交付单元裁决

- 审计对象：`/home/CNS2026495165/dsh`
- 审计日期：2026-09-21
- 纪律：本轮只读执行前审计；未修改产品源码、部署件、live bundle、配置、数据库或宿主进程。本文件是本轮唯一新增交付物。
- 已直接读取：
  - 综合报告：`settings-jank-audit-synthesis.md` 及 `settings-jank-audit-*.md`
  - 源码：`dsh-usage/lib/client.js`、`dsh-usage/lib/index.js`、`dsh-btw/node_modules/dsh-better-sidebar/src/client/index.tsx`
  - live/deployed：`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/{client.js,index.js}`、`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`、`.../dsh-client-ui-renderer/lib/client.js`、`/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js`
  - 补丁/回放：`.workspace/lag-fix/patches/usage-plugin.sh`、`usage-plugin.replacements.txt`、`B1-transform.cjs`、`B1-simulate-post-patch.cjs`、`client-runtime-perf.sh`、`workspace-enhancement-perf.sh`
  - 既有 live/部署与回滚证据：`settings-lifecycle-findings.md`、`finding-B1-ctx-scope-inert.md`、`audit-cross-patches.md`、`evidence-crosscheck.md`

## 1. 执行闸门与总裁决

### 1.1 本轮可安全进入修订执行的高置信项

**R4-A：usage 客户端响应代次/卸载保护。** 真实 `dsh-usage/lib/client.js` 的 `loadAll`、`loadSessions`、`loadStatus` 在 await 后直接写 state；筛选变化会改变 callback identity 并启动新批次，旧批次没有 generation/mounted guard。该风险由源码确定，不需要假设现场已经发生乱序。最小改动是 effect-local 或组件级 generation + alive/mounted guard；AbortSignal 只有在确认 `rpc.call` 对第四参数/信号有稳定支持后才加入，不能擅自改变 RPC 签名。

**R4-B：usage host bootstrap disposed/generation guard。** 真实 `dsh-usage/lib/index.js` 的 `queueMicrotask` 内先 await `openUsageDb`、再 await `runIngest`、最后才写 `disposeTimer`。同步 disposer 只读取当时已有的 `db`/timer；卸载发生在任一 await 期间时，后续可能打开 DB、首扫并安装 timer。增加 disposed/generation，且每个 await 后复查；若卸载后 DB 才打开，立即 close，绝不安装 timer。该项是明确生命周期缺口，修复边界小，适合独立交付。

**R4-C：部署/回滚保护。** R4 不能直接整份 source 覆盖 deployed。`usage-plugin.sh` 已明确 source/deployed 是独立拷贝且 deployed 是功能超集；客户端可热载，host `index.js` 需重启。执行前必须分别对两侧做 dry-run、字节/hash 记录和 node 语法检查；host 改动只在备份后重启验收。

### 1.2 只能在证据闸门后执行的项

**R1 SettingsRoot/SettingsPanel memo 隔离：暂不直接落 live。** live `SettingsRoot` 在 `dsh-client-ui-settings-general/lib/client.js:175-227` 订阅 `useSessions`，并在 `:213-219` 直接构造 `SettingsPanel`；无 `memo`。renderer `SlotOutlet` 在 `dsh-client-ui-renderer/lib/client.js:741-749` 每次订阅 version 后直接 `renderOutletContent`。这是强代码证据，但现有活体只证明安静态 panel mutation=0，未计活跃 session/projection 下的 React commit。先做 E1；只有确认 panel commit 随 session churn 同阶，才按最小 selector/memo 边界改动。不得把 `React.memo(SettingsPanel)` 当作无条件安全修复：若 props 中 `renderSlot`、rows、owner props 或 slot version 语义不稳定，可能隐藏合法更新。

**R3 C2 observer/订阅边界：暂不直接把全树观察改成单节点。** deployed `dsh-workspace-enhancement/lib/client.js:4445-4454` 仍对 `document.body` 做 `childList` 观察；`installSidebarRowBadges` 的订阅在 `:5437-5443` 同时连接 `workspacesFeed` 与 `sessionsFeed`。C2 现有 Set 去重（`:4124`）及 sessions snapshot identity memo（`:5418-5436`）只优化映射/去重，不缩小事件边界。收窄目标必须先证明 badge 所需容器与字段，并用 E1/E2 验证无漏标/撤标；否则可能漏掉动态 sidebar row。可安全落地的最小候选是“过滤无关 MutationRecord、保留 childList direct-body 语义、对同一帧 scan 合并”，不是盲目删除 subtree/订阅。

### 1.3 必须排除或降级表述的项

- **P2 stale-row：本轮不改 live。** 现有 `projectList()` forward carry 会在 ids 不变时从旧 `previousProjection.byId` 回拷当前 byId 缺失的 synthetic child；address-chain child 的 currentAddress 消失场景尚未离线复现。先做 E4-P2 harness。若复现，另开最小修订；否则保留 P2，不因猜测回滚或重写。
- **B1 N=200：不宣称完全语义等价，不扩大窗口。** 真实生产 cold path 的 `persistence.list()` header 没有 `updatedAt`，而 `B1-transform.cjs:242-245` 按 `b.updatedAt - a.updatedAt` 排序，故“最近 200”当前不成立；同时 retained 窗口外 running descendant 会漏计。`B1-simulate-post-patch.cjs` 只模拟内存分支，且明确 cold 未覆盖，不能作为生产 cold 语义证明。允许的下一步仅是离线语义修订/测试生产 header 形状；本轮不调整 N、不改 live B1。
- **全量 usage heatmap/查询重写：不重复做。** 当前 live 已有 daily 分段和 sargable fallback，正确 RPC 配对样本低毫秒但样本小；只需按正确 endpoint 做重启后验收，不把离线 0.081ms 当端到端事实。
- **visited/hidden tab 卸载：不在本轮混入。** visited panels 保持 hidden 的实现事实存在，但没有 mount/cleanup 现场计数；不应把“离开后 0 请求”解释成卸载，也不应顺手重写 tab 生命周期。
- **P4、P3、模型全量虚拟化、B2 数据删除/phase 2：排除本轮修订单元。** 它们会扩大范围或改变数据/语义，且现有证据不足以把收益归因到设置页修订。

## 2. 细粒度交付单元

### DU-R4-1：UsageCard `loadAll` 旧响应保护（P0，批准执行）

- **文件/目标**：
  - source：`dsh-usage/lib/client.js`
  - deployed：`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js`
- **函数/范围**：`UsageCard`；`loadAll`（source `:308-340`，deployed 需按真实 bundle 搜索）、初始 effect `:366-370`、轮询回调 `:381-385`。
- **改动内容**：引入单调 generation（推荐 `useRef(0)`）和 mounted/alive 标志；每次新 load 批次先递增 generation，`Promise.all` 返回、失败处理、finally 均仅在当前 generation 且仍 mounted 时写 `summary/timeseries/heatmap/byModel/byProject/byDay/error/loading`。cleanup 递增 generation 并标记 dead。不要先引入 AbortSignal，除非读取 `connection.rpc.call` 类型/实现确认信号参数语义；guard 必须仍能在 RPC 不可取消时保护 UI。
- **验收标准**：
  1. 离线 deferred-RPC harness：A 批次延迟、B 批次先返回；B 的所有数据仍保持，A 完成不得覆盖任何数据或清除 B 的 loading/error。
  2. unmount 后释放 A：所有 Promise settle 后不发生 state commit；无未捕获 rejection。
  3. filter/source/range 快速变化：每次变更至多产生设计允许的批次，最终屏幕只显示最后一批 payload。
  4. usage source/deployed 各自 `node --check`/构建检查；功能冒烟（插件卡、筛选、表格、图表、refresh=0）不回归。
- **热载/重启**：client.js 是插件 client 热面，保存后等待 HMR/rev 变化；核心行为验收建议浏览器整页刷新。无需宿主重启，但必须分别确认 served hash/rev 对应目标。
- **回滚点**：分别建立 source/deployed 的 pre-image；仅按对应 target 回滚，禁止 source 全量覆盖 deployed。client 回滚后刷新页面；保留回滚前后 sha256 与 served rev。

### DU-R4-2：UsageCard `loadSessions` / `loadStatus` 旧响应与卸载保护（P0，批准执行）

- **文件/目标**：同 DU-R4-1。
- **函数/范围**：`loadSessions` `:342-356`、`loadStatus` `:357-365`、共享 effect `:366-370`、必要时 manual refresh `:388-398`。
- **改动内容**：同一 generation contract 或分别使用 sessions/status request generation；`loadSessions` 仅允许当前筛选代次写 `sessionRows/error`，`loadStatus` 仅允许 mounted 写 status。手动 refresh 触发的 load 也必须取得新代次，避免旧自动轮询结果覆盖手动刷新后的筛选。保留 status best-effort 语义。
- **验收标准**：sessions 乱序、status 晚返、离开插件 tab/卸载后 settle 均不得回写；session rows 仍遵守服务端 `limit:200` 当前语义；不改变 RPC method/payload。
- **热载/重启**：client 热载/刷新，无宿主重启。
- **回滚点**：与 DU-R4-1 同一 client pre-image，但执行记录必须标注两个交付单元均回滚，避免半套 generation contract。

### DU-R4-3：Host usage bootstrap disposed/generation guard（P0，批准执行）

- **文件/目标**：
  - source：`dsh-usage/lib/index.js`
  - deployed：`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js`
- **函数/范围**：`apply` `:64-185`；`queueMicrotask` bootstrap `:142-165`；lifecycle disposer `:167-184`。
- **改动内容**：在 `apply` 内建立 activation generation/disposed 标志；bootstrap 捕获本次 generation。`openUsageDb` await 后若 disposed/代次不符，关闭刚打开的 DB 并 return；`ensureSchema`、日志、`runIngest` 前后按边界复查；首扫后再次复查，只有仍 alive 才安装 `ctx.setInterval`/fallback timer。disposer 必须先标记 disposed、使 generation 失效，再清理当前 timer/db；late timer disposer 产生后必须立即执行或由统一句柄收纳。不要改变 RPC 注册时机、DB 路径、ingest 周期或业务数据口径。
- **验收标准**：隔离 stub 延迟 `openUsageDb` 100–500ms，`apply` 后立即执行全部 effect disposer：不得安装 timer，DB 最终 close；延迟首扫同样不得安装 timer。正常路径只安装一个 45s timer，dispose 清 timer+DB；open 失败仍 warn-only；RPC 在 DB 未就绪时维持既有 unavailable 语义。执行 `node --check` 与 host lifecycle unit test。
- **热载/重启**：host cold 面，必须在备份后重启宿主才生效；不得以浏览器 HMR 代替。重启后做 usage 正确 RPC 只读配对与 PID/served hash 记录。
- **回滚点**：独立 host pre-image + manifest；回滚后重启。回滚前检查 live sha 必须属于该单元 pre/post，防止覆盖其他部署。

### DU-R4-4：Host bootstrap 的并发 ingest 保护（P1，条件批准）

- **文件/函数**：同 DU-R4-3，`runIngest` `:82-108`。
- **改动内容**：只有在测试证明 timer tick/手动 `/usage/refresh` 可重入时，增加 single-flight/代次保护；不得把同步 ingest 改成异步假象，也不得在本单元擅自改数据库查询。
- **验收标准**：并发 refresh/tick 不重复进入 fold；dispose 期间不启动新 ingest；失败仍 warn-only；读接口口径不变。
- **热载/重启/回滚**：同 host cold 面。未通过并发实验前列为后续项，不执行。

### DU-R1-1：SettingsRoot selector 收窄（P1，E1 后批准）

- **文件/目标**：live 包 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`；若有可构建源码，必须先找到对应 source，不得只改 bundle。
- **函数/范围**：`SettingsRoot` `:175-227`，尤其 `useSessions((state) => ...)` `:188-191`。
- **改动内容**：仅在 E1 证实 sessions snapshot churn 会导致设置壳 commit 后，把 selector 收窄为真正需要的字段/稳定布尔值；保持 onboarding 的 phase/current/blank 语义。优先 selector equality/稳定派生值，再考虑 memo。不得删除 sessions 订阅而不保留 onboarding 更新。
- **验收标准**：活跃 replay 下 SettingsPanel/Root commit 不再与 session/projection 同阶；onboarding blank session、打开/关闭、tab 切换、默认设置功能冒烟 8/8 不回归；closed/open 对照至少 3 个同 N 窗口。
- **热载/重启**：settings client 热载/rev 后建议整页刷新；不需宿主重启。若只能直接改部署 bundle，必须增加构建/语法和原子发布证据，此项降级为否决。
- **回滚点**：保存该 live bundle 的原子 pre-image；只回滚该文件，不触碰 runtime/C1。

### DU-R1-2：SettingsPanel memo 边界（P1，E1 后批准）

- **文件/函数**：同 DU-R1-1，`SettingsPanel` 定义及 `SettingsRoot` JSX `:213-219`。
- **改动内容**：只有在确认 props identity 与合法 slot updates 后，用 `React.memo` 或等价稳定 renderer 包住 panel；rows/renderSlot/activeId/onSelect/onClose 的稳定性必须单独核对。若 `renderSlot` 随 slot version 变化，memo 必须以正确 comparator 放行该变化；不得无 comparator 粗暴 memo。
- **验收标准**：活跃流 commit 下降且 settings slot 动态更新、插件卡挂载、provider/model 编辑器、locale 切换均正确；性能报告记录 hit/miss 原因，不用安静态 mutation=0 代替 commit 数据。
- **热载/重启/回滚**：同 DU-R1-1。

### DU-R3-1：C2 mutation observer 过滤/节流边界（P1，E1/E2 后批准）

- **文件/目标**：`dsh-workspace-enhancement/lib/client.js` deployed（source 若存在则先对照）；`installRowBadges` observer `:4445-4454`。
- **改动内容**：保留 row-badge 自身 add/remove 的排除逻辑；把 body observer callback 改为只对可能影响 sidebar row/title/cwd/connection 的 childList 记录安排 scan，并在一个 rAF/现有 pending-scan 窗口合并；不得直接将 body observer 删除或把 subtree 改成 direct-only，除非 row container 发现协议和撤标测试证明等价。订阅侧优先 selector 化，仅 title/cwd/连接相关 snapshot 字段变化触发 rebuild；`running/updatedAt` 变化不应重建 badge index，但必须保证运行状态展示另有更新路径。
- **验收标准**：设置面板任意 DOM 变化不触发 badge scan；sidebar row add/remove/rename、workspace connect/disconnect、language change、badge withdraw/reinsert 全通过；sessions running/updatedAt-only replay 不触发 remote title rebuild；3 次同 N 长帧/scan 次数对照有改善且无漏标。
- **热载/重启/回滚**：client plugin 热载后刷新；不需宿主重启。C2 当前脚本只覆盖 Set/memo，不足以安全重放新 observer 变更，应新增独立 patch spec/backup，不改旧 C2 回滚语义。

### DU-E4-P2：P2 stale-row 离线语义裁决（P0 gate，先做实验不改产品）

- **文件/函数**：部署 runtime `projectList()`（综合报告定位约 `:9271-9371`，以当前 hash 重新定位）；现有 C1 patch spec 与 `client-runtime-perf.sh` 仅包含 P1/P2，不能代替 harness。
- **离线用例**：旧 projection `ids=[p]`、`byId={p, syntheticChild}`；下一轮 manager items 仍只有 p，但 `currentAddress` 从 `p→child` 变为空。断言 child 不得残留；同时验证正常 address-chain child 在 currentAddress 仍存在时继续保留。
- **裁决**：复现 stale child → 另立最小 P2-1 修订（移除 carry 的 stale child，仅保留当前地址链所需 synthetic rows）；未复现 → P2 保留，不追加改动。不得用真实会话制造该状态。
- **热载/重启/回滚**：实验离线无热载/重启；若另立修订，runtime client 热载/刷新，独立 pre-image。

### DU-E4-B1：B1 header/窗口语义离线修订（P0 gate，先做实验不改 live）

- **文件/函数**：`.workspace/lag-fix/patches/B1-transform.cjs:230-267` cold path；服务端 live `dsh-host-apiproxy/lib/index.js` 与 `types/api-proxy.js` 对应 `listVisibleSessionSummaries`；`B1-simulate-post-patch.cjs`。
- **离线用例**：用真实生产 header 形状（`agentPreset/createdAt/cwd/delegationDepth/id/origin/parentSession/type/version`，无 updatedAt）和可用 metadata/projcache last activity，验证“最近 200”排序；另构造 201 subagents，第 201 个 running 且挂在顶层，验证窗口外计数是否符合已选策略。
- **裁决**：
  - 若选择“状态完整优先”，不可继续保留服务端 subagent N=200 截断，或必须补充独立 running index；需产品语义批准，不能自行改。
  - 若选择“下发削峰优先”，保留 N=200，但文档/API 明确 running count 是窗口内降级值，并修 cold 排序为有证据的 header/metadata activity key；这仍是离线语义修订，未获批准前不改 live。
- **热载/重启/回滚**：只读 harness 无；任何 server 变更均需 host 重启，且必须复验 `session.list` 200、顶层行完整、窗口/计数语义、无 500。B1 server 与 B1/C1 client/runtime 有共享文件/回滚次序风险，禁止直接用 C1 rollback 覆盖 runtime。

## 3. 运行前最小验证矩阵

1. **E-R4（优先）**：usage client deferred RPC 乱序 + unmount；host delayed DB open/first ingest + immediate dispose。全部隔离 stub，不写真实 DB、不点 refresh。
2. **E-R1**：固定浏览器、viewport、同 N、同一流式会话；settings closed/default/model/plugin 三态，采集 session/projection rate、React commit（Root/Panel/editor）、long task、rAF、panel/sidebar/body mutation。至少 3 个 60s 窗口。
3. **E-R3**：固定 row DOM，分别注入 settings-only DOM、title/cwd 变化、running/updatedAt-only session snapshot；记录 C2 scan/rebuild 次数、badge correctness、long task。
4. **E-P2/B1**：纯离线真实形状 replay，禁止触碰 live session/DB。
5. **E-Live-A**：usage host 重启后正确 RPC 读端点配对，覆盖至少两个 45s ingest tick；记录 PID、heatmap/其它 usage endpoint wall time、host.describe max、浏览器 long task。不得使用裸 `/api/usage/heatmap` 或 `/usage/heatmap` 404 作为验收。
6. **E-Deploy**：source/deployed/live hash 三方记录；host/client 分别记录热载或重启；不使用单次最佳窗口，保留 invalid runs。

## 4. 回滚和发布纪律（执行前必须满足）

- source 与 deployed usage 是独立 inode/功能漂移，禁止整目录或整文件覆盖；每侧独立备份、manifest、pre/post hash。
- client 热面可 HMR，但现有脚本是直接 `cp/install`，没有原子 rename/fsync 证明；执行窗口必须记录 served hash/rev、HMR rebuilt、HTTP 读取错误。若发布实现不能提供原子替换，R4 client 仍可执行但保留 F8 风险，不能宣称零中间态。
- host 冷面统一：备份 → node check/unit test → 重启 → 正确 RPC/host latency 验收。未重启不能说 live host guard 生效。
- runtime `client.js` 被 B1/C1 共享；不得用 C1 rollback 抹掉 B1/C1 行。B1 server/client rollback 也必须做内容指纹而非只看路径存在。
- 所有失败窗口、超阈值窗口、settings-open-failed、payload null/错误 envelope 必须保留并标 invalid，不得挑选最佳窗口。

## 5. 最终结论

本轮高置信、可先进入执行的修订只有 usage 两面生命周期/旧响应保护（DU-R4-1/2/3），且必须分别在 source/deployed 与 client/host 生效面闭环；它们修复真实代码缺口，但不等于设置页全链路不卡。SettingsRoot/SettingsPanel memo 与 C2 订阅边界是强候选放大器，必须先完成活跃流 commit/scan 证据再改。P2 stale-row 和 B1 N=200 只能先做离线语义修订/裁决：P2 复现前不改，B1 不能称最近 200 或完全等价，且窗口外 running 的取舍需要明确产品策略。旧 heatmap 修复只做正确 RPC 的重启后验收，不重复改查询。

正式对外状态应保持：**局部热点已有真实优化；usage 生命周期/旧响应风险可安全单独修订；设置页全链路卡顿尚未证实消除。**
