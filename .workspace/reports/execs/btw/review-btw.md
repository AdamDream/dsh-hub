# btw 执行复核报告（Review 阶段）

> 复核对象：`/home/CNS2026495165/dsh/dsh-btw/`（执行产物）对照 `audit-btw-subagent.md`（§5 方案 / §6 单元 U0–U10）与 `execute-btw.md`（执行自报）。
> 方法：源码级逐行独立核对 + 上游 `/tmp/side-chat` diff + 本地部署包（`~/.dsh/profiles/`）实测互证 + 质量链独立复跑（vitest / tsc / oxlint / 部署位导入冒烟）。不采信执行自报，关键论断逐项重验。

---

## 1. 结论

## **通过**（附条件，见 §4）

- U0–U10 **全部落地**，实现与审计 §5 修订方案一致，含全部四处关键修正（不加白 `ask_user_question`、父↔子映射不写回 child meta、peerDeps semver 元组真解、digest 构造性规避剪枝双计）。
- 执行报告与代码**无虚报**：5 处函数级抽查全部吻合；"全量质量链全绿"经独立复跑基本可信（vitest 132+2、typecheck×3、oxlint 0 错均复现），但 **vitest 存在一个低概率 flaky 测试**（本会话早期触发 3 次，详见 §4.1），"全绿"不是确定性的。
- 唯一实质遗留：**重启后的 8 步手工端到端验收未执行**（执行报告已如实声明，理由"重启即终止执行会话自身"成立，复核阶段同样无法代做）。这不构成返工项，是验收流程的收尾步骤。

---

## 2. 逐条单元核对（U0–U10）

| 单元 | 判定 | 证据（独立复核，非自报） |
|---|---|---|
| **U0** 执行期验证 | ✅ 落地 | V1：web 根 `require.resolve('@local/dsh-btw/package.json')` 实测成功；内核 seed 表 `Jd()`（dsh-web-frontend dist index-ClqxG24t.js）实测含 react、react/jsx-runtime、react-dom、react-dom/client、cordis、**ui-slots**、**ui-primitives** 七模块；client-modules 增量扫描以插件自身 pkgName 为单位（parseDshClient/clientExportOf），inject 条目只随 wire 下发——"死链不阻塞"论断成立。V2：typert-loader `validateTypertManifest` 实测强制 `manifest.package === pkgName`；api-gateway `claimsEndpoint` 两段式 + `ctx.typert.local` strict 解析链确认；fork 四处 package 字段统一。V3：node_modules 367 包在位、typecheck/lint/产物复跑通过。运行中进程 `/plugins/@local/dsh-btw/client.js` HTTP 200（274556B，与 lib/client.js 一致）。 |
| **U1** fork 骨架 | ✅ 落地 | 目录完整（src 22 文件 + tests 15 + lib + 配置）；MIT LICENSE / THIRD_PARTY_NOTICES 保留；README 双语 fork 横幅在标题区；`grep dsh-side-chat` 仅剩 README 致谢、package.json 元数据与 sign-contract 的上游命令断言（性质合理，满足"仅 README 命中"精神）。 |
| **U2** peerDeps 对齐 | ✅ 落地 | package.json 全部 15 个 `@deepseek-ai/*` peerDeps = `">=0.1.1-rc.2 <0.2.0"`，**无任何 `^0.1.0-rc.*` 残留**（grep 实证）；semver prerelease 元组冲突真解（0.1.1 元组区间含 0.1.1-rc.2）；better-sidebar 移出 peerDependencies（保留 devDeps，type-only 不进产物）；devDeps 全钉 0.1.1-rc.2。 |
| **U3** 客户端接线 | ✅ 落地（方案 B） | 保留上游 slots+typert：两个槽位注入（`dsh-btw.action`/`dsh-btw.drawer`）；lib/client.js 为 ModuleLoader bundle，banner id=`@local/dsh-btw`（= graph row id）；tsdown CLIENT_EXTERNALS 与内核 seed ∩ boot graph 一致。方案 B 的两个前提（内核 seed 提供 slots/primitives、官方 inject 先例）均已独立实证。运行时开合验收待重启（与自报一致）。 |
| **U4** 移除 30min 清理 | ✅ 落地 | grep 全 src/tests 无 `SIDE_CHAT_IDLE_TTL_MS`/`evaluateSideChatLease`/`scheduleExpiry`/`touch`/`expiresAt`/`cleanupMode`/`EXPIRED_MESSAGE`/`no-completed-turn` 任何功能残留（仅剩 `settle()` 局部函数与注释）；controller `NOT_OPEN_MESSAGE` 替代 expired 态并带重试；host-lease.spec 3 例验证 fake timers 推进 31/60 分钟后 read 仍 ok、start 值无过期字段。 |
| **U5** 持久化索引+resume | ✅ 落地 | `btw-registry.ts`：`~/.dsh/btw/index.json`（DSH_HOME 兜底）、原子写（唯一临时文件+rename+失败清理）、实例内串行写链、损坏容忍读。`start()` 先查索引 → `startResumed()` → `ctx.agents.resume({resumeSessionId, agentOptions, setup: composeChild})` 重放四层只读+persona+guard+btw_ask_user；resume 失败清索引降级新建（L348-355）。`close()` 不 `archiveSession`（L707-714，索引保留）。**映射只在 sidecar**：`hiddenSideChatMeta` 仍剥离 parentSession 保留 `origin:'subagent'`（L73-81），child header 无父链——审计 §7-2 的危险改法已规避。`seedLength` 取 `header.seedLength ?? 0`：本地 dsh-subagent L539 确认 `childSessionMeta` 在 >0 时持久化 seedLength，官方 L1156 同款读取模式，语义正确。⚠️ 附带：其索引落盘测试为低概率 flaky（§4.1）。 |
| **U6** 进行中摘要 | ✅ 落地 | `buildProgressDigest`（L117-198）：状态行 + `turn/end` 后缀 + **surface.nodes 逆序**找最近 user/message（回退原始后缀）+ tool/call（名称+参数截断 120、最多 5）+ assistant/chunk 按 turn:step 聚合剔除已定稿；外层 try/catch 降级。**剪枝双计以构造性方式规避**：只读 log-only 事件（turn/end、tool/call、assistant/chunk）+ surface 投影，**完全不读 tool/result**（pruner 只替换 tool/result）——审计 §4.4 要求满足。注入：新建（boundary 后第二条 plugin notice）+ resume（仅 digest，不重复 boundary，L446-451）；同活条目 duplicate/adoptToken 早退不刷屏。**空 seed 允许**：no-completed-turn 拒绝已删除（错误码枚举中移除）；host-opening L147-166 验证首回合 running 父会话可开、seedLength 0、boundary+digest 双注入、digest 含 running 与工具名。 |
| **U7** 问答通道 | ✅ 落地（修正方案） | **未加白 ask_user_question**（CANDIDATES/SET 均无，tool-policy.spec 断言拒绝）——审计 §7-1 最关键修正确认执行。`btw_ask_user` 注册于 `composeChild`（create/resume 共用，L478-573）：参数 schema 逐字段对齐 ask_user_question（questions[{id,question,header?,options?,multi_select?}] → answers[{id,selected,custom?}]）；execute 挂起 Promise，`exec.signal` abort → reject；单未决问题约束。守卫层放行（READ_ONLY_TOOL_SET 含 btw_ask_user）、可见层不含（scoped 注册不进全局名单——本地 dsh-tools `restrict` 实测"scope-local names fail / scoped registrations remain visible"确认设计正确）。`sideChat/read` 加 `pendingQuestion`、新增 `sideChat/answer` remote（6 invocation）、controller `answer()`、QuestionCard（radiogroup/group、aria-pressed、custom 输入、提交/错误态）。`READ_ONLY_DENIAL` 指路 btw_ask_user。写类全拒断言在位。 |
| **U8** grill-me 注入 | ✅ 落地 | `persona()` 懒加载一次性 `readFileSync(~/.dsh/skills/grill-me/SKILL.md)`（DSH_HOME 兜底），**剥 frontmatter**（`/^---\n[\s\S]*?\n---\n?/`），`<grill-me>` 包裹 + "grill me"→btw_ask_user 分轮编号衔接指引；缺失/为空降级纯 persona（L604-617）。本地 SKILL.md 实测存在，剥壳后正文以 "Interview the user relentlessly…" 开头，与自报一致。 |
| **U9** 白名单本地核对 | ✅ 落地 | CANDIDATES 26 项与上游一致（含 web_search、skill、get_goal）；SET = CANDIDATES + run_code + btw_ask_user；`visibleReadTools(parent)` 运行时交集滤除未注册项的机制保持（上游同款）；写类全拒（write/edit/bash/ssh_exec/subagent/mnemon_remember/ask_user_question 均断言）。 |
| **U10** 部署接线 | ✅ 部署完成，⚠️ 重启验收待做（与自报一致） | 部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw/` 为**真实目录**（readlink 非 symlink）；diff 与源目录除刻意剔除的 .npmrc/package-lock.json 外**完全同步（含 lib IN SYNC）**；web/cordis.patch.yml 追加 `- insert: [{id: btw, name: '@local/dsh-btw'}]`（YAML 合法，无端口钉死）；部署位 `lib/index.js` 从真实运行树导入冒烟**独立复现成功**（name=dsh-btw、11 导出、typert package=@local/dsh-btw、6 invocations、策略断言全对）。重启 + 8 步手工验收未做——自报如实，理由成立。 |

---

## 3. 报告-代码一致性抽查（5 处函数级）

| execute-btw.md 声称 | 代码实证 | 一致 |
|---|---|---|
| U5 "startResumed 用 agents.resume 重放 setup" | side-chat-service.ts L410-462，`parent.ctx.agents.resume({resumeSessionId, agentOptions, signal, setup: composeChild})` | ✓ |
| U6 "digest 读 surface、不读 tool/result" | L127-198：surface.nodes 逆序找 user/message；suffix 内仅 tool/call 与 assistant/chunk；全程无 tool/result 读取 | ✓ |
| U7 "btw_ask_user 参数同 ask_user_question + execute 挂起" | L478-573：schema 逐字段对齐；`new Promise` 挂起 + abort reject + 单未决约束 | ✓ |
| U4 "read() 不再是续租心跳" | L619-626：纯 transcript 读取，无 touch/续租 | ✓ |
| U8 "frontmatter 剥离 + 缺文件降级" | L604-617：正则剥壳 + try/catch 降级 | ✓ |

未发现任何虚报或夸大。

---

## 4. 发现的 bug / 遗漏 / 副作用

### 4.1 【中】host-persistence.spec "records a freshly forked child in the durable index" 低概率 flaky

- **现象**：本会话独立复跑触发 3 次失败（首次全量 + 单文件循环 3 次中 2 次），失败耗时 1004ms = `vi.waitFor` 默认 1000ms 超时；随后系统空闲时 18/18 全过（单文件 10 次 + 全量 8 次）。负载相关、非确定复现，但**真实存在**。
- **根因**（两因素叠加）：
  1. 该 spec 的 4 个用例**共享同一 DSH_HOME 索引文件**（beforeAll mkdtemp 一次），但每个用例各建新 `SideChatService`（各持独立 `BtwRegistry`，实例内写串行化不跨实例）。
  2. 测试1 resume 成功后 `void this.registry.touch(parent-1)`（side-chat-service.ts L453）是 **fire-and-forget**，其 load→write→rename 链可飞行至测试2 期间；与测试2 的 `set(parent-2)` 跨实例交错时，touch 基于旧快照的后完成 rename **覆盖丢失 parent-2 条目** → waitFor 永远等不到 → 超时。
- **生产风险评估**：低。生产中 `SideChatService` 单例，所有 set/touch/remove 走同一实例串行队列，丢更新窗口不存在。残余风险仅为进程崩溃时丢最近一次索引写（下次打开降级 fresh fork，功能不出错）——可接受。
- **修法**（测试侧，最小改动）：`tests/host-persistence.spec.ts` 改为 **beforeEach mkdtemp + afterEach rm** 每用例独立 DSH_HOME，彻底消除跨用例共享文件；现 seedIndex/waitFor 逻辑不变。（备选：registry 增加 flush() 并在 close/disposeAll 时 await——对生产也有崩溃窗口收益，但非必需。）

### 4.2 【低】fire-and-forget 索引写的崩溃窗口

- side-chat-service.ts L389（`void this.registry.set(...).catch(() => undefined)`）、L453（touch）、L657（send 路径 touch）：`.catch(() => undefined)` 吞错 + 不等待。宿主异常退出时最近一次写可能未落盘。
- 影响：索引少一条/旧一条 → 下次打开 fresh fork 而非 resume，**功能降级而非故障**。与 4.1 同源，可一并处理（flush on dispose），亦可接受现状。

### 4.3 【极低】safe-boundary.spec 用例名实不符

- `tests/safe-boundary.spec.ts` L10-13：用例名 "has no idle lease: nothing schedules an automatic close"，断言内容却是 `READ_ONLY_TOOL_SET.has('btw_ask_user')`——U4 重写时的命名残留，无功能影响。建议改名（如 "allows the ask-back channel through the guard"）。

### 4.4 【备注，无需行动】

- `BtwRegistry.get()` 不经写队列直接 load：单实例生产下 start() 首查时队列恒空，无影响；未来若多实例/并发扩展需注意。
- 三个 host spec 复用同一 TOKEN 常量：跨 service 实例无冲突（byToken 每实例独立）。
- 上游 diff 客户端侧（presentation/Drawer/overlay 等）逐文件核对：全部为重命名/End 文案/expired 移除，**无功能性副作用**（过滤关键词后零剩余行）。
- 运行中进程（11:36 启动）`/plugins/@local/dsh-btw/client.js` 已 HTTP 200：`/plugins/` 路由按请求动态解析文件系统；boot graph 仍需重启生效——与"重启后验收"声明一致，非新发现。

---

## 5. 10 条待澄清项裁决建议

| # | 事项 | 裁决建议 |
|---|---|---|
| 1 | close（End）后索引条目保留 | **执行档拍板合理，无需主 agent 裁决**（建议知悉）。语义自洽：End=关面板非删数据，locale 文案已同步"重开可恢复"，且留了"删一行即改彻底断开"的后路。若主 agent 视 End 为产品级"彻底断开"语义，属后续偏好调整，非本单元缺陷。 |
| 2 | digest 在 resume 时也注入 | **执行档拍板合理**。直接服务 U6 验收场景（重启后主 agent 进行中，btw 能答"现在在干嘛"）；重复注入有防刷屏早退；副作用（子日志追加 notice，面板不显示）已声明。 |
| 3 | btw_ask_user 同时仅一个未决问题 | **执行档拍板合理**。与 wire 单数契约、单卡 UI 自洽；并发多问需改协议+重做卡片，超出 U7 范围，上报边界正确。 |
| 4 | 线协议简化（删 expiresAt/cleanupMode、close 枚举改 kept/absent、start 加 resumed） | **执行档拍板合理**。两侧同包同装无兼容负担；`resumed` 是 U5 验收"无新 fork"的必要观测字段，最小增量。 |
| 5 | slots/primitives 保留在 peerDeps（范围 rc.2） | **执行档拍板合理**。内核 seed 已实证兜底（U0/V1 复核确认）；npm 侧 0.1.1-rc.2 registry 可满足；忠实上游结构。 |
| 6 | dsh-better-sidebar 留 devDependencies | **执行档拍板合理**。审计仅要求移除 optional peer；type-only 引用不进构建产物（presentation diff 与 bundle 实证），部署树已排除 node_modules。 |
| 7 | sign-contract trackedPngNames 由 git ls-files 改目录列举 | **执行档拍板合理**。fork 无 .git 元数据，git 命令返回空使原断言必挂；目录列举语义等价（提交物即目录内容），属执行环境适配而非方案变更。 |
| 8 | grill-me frontmatter 剥离 | **执行档拍板合理且必要**。`disable-model-invocation` 只约束 skill 工具调用路径；内联注入时保留该行会误导模型忽略文本。判断正确。 |
| 9 | start 应答时序改 setImmediate 轮询 | **执行档拍板合理**。多一跳本地 fs 读是 U5 索引查询的必然代价；测试适配时序而非掩盖行为（子创建仍未落定时应答的语义保持）。 |
| 10 | README fork 横幅置于标题区 | **执行档拍板合理**。sign-contract 8 例断言全保持（实测通过），上游安装命令原文保留在正文。 |

**总评**：10 条全部属于"执行档应自行拍板"的实现细节/环境适配/最小增量，**无一是方案级歧义**——不需要主 agent 逐条裁决。仅 #1（End 语义）最接近产品决策，建议主 agent 知悉并默认采纳现状。

---

## 6. 对"全量质量链全绿"自报的独立判断

| 环节 | 自报 | 独立复跑结果 | 可信度 |
|---|---|---|---|
| vitest | 132 通过 + 2 跳过 | 稳定态 132 passed + 2 skipped（134 总数吻合）；**但存在低概率 flaky**（§4.1，本会话早期 3/12 触发，后期 0/18） | 基本可信，非确定性 |
| typecheck ×3 | 全过 | `tsc -p` 三配置独立复跑全过 | ✓ 可信 |
| oxlint | 全过 | 0 warnings 0 errors（37 文件 96 规则） | ✓ 可信 |
| tsdown build | lib/ 产出 | 未重跑构建；以产物实证佐证——lib 与部署位 IN SYNC（diff 为空）、bundle banner/结构/导出实测正确、部署位真实运行树导入冒烟成功 | ✓ 高可信（间接） |
| publint | "All good!" | 未复跑（package.json exports/files 结构规范，低风险） | 未验（低风险） |

**判断**：执行自报在其当时运行中大概率属实（数量、断言细节、产物均能对上），非虚报；但"vitest 全绿"不构成确定性保证——flaky 测试（§4.1）应在下次改动时顺手修复，避免污染后续回归信号。

---

## 7. 后续动作（非返工，验收收尾）

1. **重启 `npx @deepseek-ai/dsh web`** 并执行 execute-btw.md U10 的 8 步手工验收（加载→问答→只读→反向提问→进行中摘要→闲置>30min→重启恢复→End 关闭）。这是唯一未闭环项。
2. （建议）修复 §4.1 flaky 测试：host-persistence.spec 每用例独立 DSH_HOME。
3. （可选）§4.2：disposeAll 时 flush 索引写队列。
4. （可选）§4.3：safe-boundary.spec 用例改名。
