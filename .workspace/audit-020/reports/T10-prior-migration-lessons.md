# T10 · 上一轮私有迁移（0.1.1-rc.2 → 0.1.7-rc.2）历史教训提炼

> **轨道**：T10（历史教训提炼，只读审计，不改代码）
> **产出日期**：2026-09-29（`date -Is` 实测 `2026-09-29T16:44:20+08:00`）
> **用途**：把上一轮迁移的**方法学、死路、历史坑、有效机制、未闭门禁**提炼成可直接指导 **0.2.0-rc.1** 迁移的作战手册。
> **写面**：仅本文件（`.workspace/audit-020/reports/T10-prior-migration-lessons.md`）；本轨另在 `.workspace/audit-020/t10-notes/` 下留了 10 份阅读笔记（N1–N10）作为证据链。

## 证据标注规范（本报告全篇遵守）

- **【本轮实测】**＝本轨道亲自跑命令得到的观测，附命令与值。
- **【文档断言·`文件名`】**＝材料中的既有断言，只保留判据与结论，不做大段摘抄；来源一律写文件名。
- 本报告**不含**会话正文、密钥、原始会话 id；子档/写者一律以角色指代。
- 凡「0.2.0 适用性」判定，若依据是本轮字节级实测则写【本轮实测】；否则写【待验证】。

---

## 1. 结论摘要

1. **上一轮的方法学是可复用的，结论集不可复用**。方法学（隔离根 + 独立 prefix + 并行 profile + 逐单元白名单 + 正负例 + 回滚演练 + 只准备不切换）在 0.2.0 上**可直接照搬**；而所有具体形状常量（配置键、槽位名、端点路径、图标符号、peer 区间、会话代次边界）**必须按 0.2.0 源码重推**【文档断言·`19-39-upgrade-smoke-runbook.md` §0.2、`upgrade-endpoint-boundary-verification.md` §2、`upgrade-settings-migration-units.md`】。
2. **上一轮的真实形态是「机制已通、目标未通过」**：产品组装完成、统一组合 UI 未验收、旧会话 A 发布准入 `NOT READY`、现役未获切换授权。总状态 `NOT READY / STOP`。
   【本轮实测】`_audit/unified-assembly-20260929-121756/STATUS.md` 明写 "Unified UI acceptance is incomplete… verdict passed=false/completed=false/preview=0"；
   【本轮实测】`_audit/a-admission-20260929-700/STATUS` = `R4_RELEASED_P3_MECHANISM_PASS_BUT_FULL_LOSSLESS_GATE_STOP_P4_NOT_RUN`，reason = "v4 compare sourceTransform=false; registry reopen and same-root 654/four-bucket usage not proven"。
3. **0.2.0 与 0.1.7 的差异面比预期窄，但风险面比预期新**——这是本轨最关键的实测结论：
   - **窄**：核心包 `@deepseek-ai/dsh` 的 `lib/**` 在 0.1.7-rc.2 与 0.2.0-rc.1 之间**逐字节相同**（仅 `package.json` 变版本与依赖钉）；`@deepseek-ai/dsh-settings` 的 `lib/**` 同样逐字节相同，**含 `.imported` 改名逻辑**（`lib/index.js` 两版同 sha256 `9432b872…`）。⇒ **「settings 先改名再解析、无回滚点」等 settings 语义类历史坑在 0.2.0 上仍适用，且有字节级机制依据**（详见 §4）。
   - **新**：0.2.0-rc.1 依赖闭包**新增 5 个官方包**并引入一条**默认远端外呼的遥测链**（`dsh-otel` 带 `got` HTTP 栈；`dsh-host-product-telemetry-otel` 的 `endpoint` **默认硬编码** `https://dsh-otel-collector.deepseeksvc.com/v1/logs`）。这是上一轮全部材料**完全没有覆盖**的面，与「零外呼 / 零模型请求」纪律直接冲突（详见 §5.7、§7）。
   - 本轨结论已与协调者硬基线 `MEASURED-BASELINE.md` **交叉核对一致**；本轨的**增量贡献**是「settings 包字节相同 ⇒ 该类坑仍适用」与「遥测默认端点 / 卸载即 drain」两项（见 §5.7(d)）。
4. **对协调者 `PLAN.md` 的一处事实更正**【本轮实测】：`PLAN.md` 记「0.2.0-rc.1 相对 0.1.7 新增依赖：`dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc`」。实测这三个包在 **0.1.7-rc.2 依赖闭包中已存在**（同为 `0.1.7-rc.2`，0.2.0 中升为 `0.2.0-rc.1`）；真正新增的是另一组 5 个包（见 §5.7 表）。依赖边层面 `@deepseek-ai/dsh/package.json` 只新增 `@deepseek-ai/dsh-experimental-schedule-bundle` 一项。
5. **最贵的三条教训**（详见 §2、§7）：
   - ①**「单元/机制 PASS ⇒ 目标 PASS ⇒ 可切换」是上一轮最贵的口径错误**；
   - ②**「取最高代」是数据可见损失的静默入口**（已实测 −614,139 output，且 `failed=0` 无痕）；
   - ③**「测试工具缺陷被当成产品故障」反复制造返工**（多轮重启、重跑、误改产品）。

---

## 2. 迁移方法学（12 步，含每步验收判据）

> 性质：**上一轮实际采用的步骤序列**，由 `office-upgrade-*` 系列 + `upgrade-*` 系列 + `19-36/39/44/51` 交叉重建。
> 每步的判据均为**可判定、多为负向或带具体期望值**。判据写法遵循上一轮已固化的「三件套」：**预期（含具体期望值）→ 失败判据 → 排查**【文档断言·`19-39-upgrade-smoke-runbook.md` §0.2】。

### M0 授权与基线锚定
- **动作**：固定权威顺序（用户明确裁决 > 已授权具体范围 > 未授权不扩展 > 已否决不得复活）；登记「不得重开」清单；确认现役/隔离端口与身份。
- **判据**：
  - 只读核对端口在册且与本轮一致；【本轮实测】`ss -ltn | grep -E ':(3080|3097|3098|3099|3102|3103|9224|9225) '` → **仅 3080、3097 LISTEN**，其余 0 命中（与 `PLAN.md`、交接件一致）。
  - 仓库身份：HEAD = `651b17124a76581f00f1e73ca3d152d21ccba47f`，branch `main`【本轮实测】。
  - **「授权 ≠ 验收」「已裁决 ≠ 已放行」**逐条落纸【文档断言·`office-handoff.md` §4 末、§5 顶部】。
- **失败处置**：任一「不得重开」项被触碰即停，回主档裁决。

### M1 备份与冻结（T_freeze）
- **动作**：全量文件备份 + 自校验；`sessions` 冷备；备份根**放仓库外**。
- **判据**：
  - 备份件数/哈希自校验通过（上一轮实测口径：85 文件备份 + md5 自校验；只读预检 `PASS=26 FAIL=0 WARN=7 TODO=4 exit 0`）【文档断言·`office-upgrade-gates-audit.md` §1.5/§1.6】。
  - **判据的成立前提是写冻结**：实测 `settings.yaml` 曾 3 分钟内被改又改回 ⇒「sha256 与备份一致」在写者存活时是**随机结果**；写者未停时该判据必须降级为「差异 ⊆ 白名单键」【文档断言·`19-36-rollback-and-verification.md`】。
  - 备份根**一律在仓库外** + **禁 `git add -A`**（忽略规则曾把凭据文件、升级备份包、`pre-image/` 70 条一起裸奔）【文档断言·`19-45-repo-state-and-staging.md` §3.2/§3.3/§7、`19-48-compat-shim-vs-codemod.md` §5.4】。
- **失败处置**：备份不自校验即停，不进入任何写入阶段。

### M2 R0 现场重取（**每次落位前必做**）
- **动作**：端口 + uid + socket inode、两处 `cordis.patch.yml` 哈希、本地插件字节、两面会话直方图，全部带**采样时刻**。
- **判据**：现值**一律重取**，**不得据任何历史哈希写入**；冻结作废条件 = **任一字节变化**【文档断言·`upgrade-settings-deployment-manifest.md` §4.1、`19-36-rollback-and-verification.md`】。
- **【本轮实测】R0 采样值**（仅本采样时刻有效）：
  - 现役 patch `513413e7cffb319149a7be2bbab829e898e59c9d626909e33869429794487471`
  - 隔离 patch `61adb8ae5758c12e466e3f08744fb4d7e38a95ec79a427ab3f5c4aa0dd036524`
  - `~/.dsh/settings.yaml` `0f19b0fe0e1b8c801bb9459c743cfa1c9aa84112753c14a1a1b7087a3a03fb57`
  - 三者与交接件 §1 登记值一致；`settings.yaml` 写入者**至今未知**（活值已多次漂移，不做归因）。
  - `git status --short` = **396 行**（交接件记 390 行；本轮 +6 为 `.workspace/audit-020/**` 本批新产物，属预期漂移）。

### M3 私有隔离根建立
- **动作**：全新 `_audit/<name>-<ts>/`（`0700`），prefix + profiles **普通文件独立复制**（非 `cp -a` 直拷整树）。
- **判据**（每条可勾选）：
  1. 私有根 `0700`；`find -perm /077`（非 symlink）= **0**；证据件 `0600`。
  2. **inode 交集 = 0**、`nlink>1 = 0`、全部 `realpath` 落在私有根内、无断链、无外逸。
  3. 源 manifest 复制前后全等（完整 hash/路径/size/mode/link），否则停止并重新冻结。
  4. **`zero external`**：启动器 / patch / 入口 / `NODE_PATH` / `DSH_HOME` / 日志 / DB / 媒体写路径均不得解析到 `~/.dsh`、`~/.dsh-017`、`~/.npm-global*`、以及任何 R/M 面。
  【文档断言·`office-upgrade-unified-assembly-audit.md` §2 B0/§5、`office-upgrade-p0-exec-20260929.md` §12.10、`office-upgrade-p1-exec-20260929.md` §1.1/§1.3/§14-2/§14-3】。
- **已知坑**：`cp -a` 会继承源树模式位（私有根顶层一度 `0775`）、并连源树自带 `.iso-scratch-*` 一起复制（147 symlink 中 **15 条外逸**）⇒ 复制后立即 `chmod -R go-rwx` + 排除 `.*-scratch-*`。**`cp -a` 保留 mtime 本身不是「无共享 inode / 已独立」的证据**【文档断言·`office-upgrade-current-adjudication.md` R0 裁决、`office-upgrade-p0-exec-20260929.md` §12.10.2–12.10.4】。
- **【本轮实测】既有私有根仍在**：`_audit/unified-assembly-20260929-121756`、`_audit/a-admission-20260929-700` 均存在；`CURRENT-MANIFEST.json` → `manifest/MANIFEST-after-ppt.json`，seal `393ccfd83edd7f01e3fe777daa2d9c17bc737b6e9bb18b43118d37fe201c8814`；`STATUS.md` 自述该指针 "is not a new seal or cutover authorization"。

### M4 独立 prefix / 依赖闭包安装
- **动作**：装一份与现役隔离的 prefix（两次实装实测约 522 包 / 518 MB / 25,700 文件），实现「现役树零写入」。
- **判据**：
  - 全树 SHA-256 一致；现役树零写入。
  - **三个硬前提**：① 预建 `<prefix>/lib`（否则 ENOENT / 退出码 254）；② `npm_config_cache` 指向工作区内（否则立刻 EROFS 且**连日志都拿不到**）；③ `XDG_CACHE_HOME` 显式指定。
  - **裸 `PREFIX=` 静默无效**；**不要 `--legacy-peer-deps`**；零副作用冒烟**只有 `--version`**（禁 `web`）。
  【文档断言·`19-44-npm-prefix-install.md` §1.2/§1.4/§3.1/§4.1/§5.3/§7】。
- **失败处置**：出现 EROFS / ENOENT 即按上面前提订正重跑，不降级为「跳过安装」。

### M5 并行新 profile / 实例启动
- **动作**：绝对路径 launcher（**禁 `npx` / 裸 `dsh`**），`HOME=DSH_HOME=<PRIV>/home`，独立空闲端口（上一轮用 3098/3099/3102/3103），`npm_config_cache` + `XDG_CACHE_HOME` 显式指向工作区。
- **判据**（H1–H7）：
  - boot 期间 **prefix 写入 = 0**；
  - `SIGTERM` 自停（实测 **0.254 s**）；
  - 全程用 managed job（`run_in_background: true`）启动并收终态；
  - **不得用 `job_kill` / `kill -9`**；前台 `&` 派生实例**无 job id**，只能按 pid 停栈；
  - ⛔ `pkill -f '<prefix>/bin/dsh'` 会**自杀**，`pkill -f dsh` 会**撞现役**。
  【文档断言·`upgrade-integrated-isolation-exec.md` §5、`upgrade-isolation-rebuild-exec.md` §1bis】。
- **坑**：`npx --no-install` 按 `libnpmexec` 顺序**优先命中全局树**，只改 PATH **无用**；独立 prefix 路线必须同时「移走旧全局 `@deepseek-ai/dsh`」【文档断言·`19-24-parallel-home-hardening.md` F4】。

### M6 配置迁移（settings + patch）
- **动作**：独立 `cp` 冷备 `settings.yaml` + `SHA256SUMS` 自检；隔离 home `settings.yaml` **置空**；**N 段显式手工预迁移，不依赖首启自动 import**。
- **判据**：
  - **「保内容 / 保路径 / 值进运行时」三者正交**，必须分别断言；
  - 置空只买到「import 循环 0 次迭代、不写 patch」，**必然仍被 rename、不保路径**（源码顺序 `existsSync → 无条件 rename → parse`）；
  - 首启必须**同时准备「落地 N 段」与「落地 0 段」两条分支**的验收与恢复动作（竞态下上一轮实测 4 段全败 = 0 段落地，且因文件已改名而**永不复重试**，只剩一条 warn）。
  【文档断言·`19-51-preserve-means-side-effects.md` 勘误1/§6.3/§6.5、`19-53-community-preservation-patterns.md`、`upgrade-isolation-followup-audit.md` §3.1】。
  - **`.imported` 文件出现 ≠ 迁移成功**：它只证明「宿主读过该 settings 路径」，是**隔离旁证**；与置空封口同时成立时反而意味着「这次一个值都没落地」【文档断言·`upgrade-isolation-followup-audit.md` §3.1】。
  - **硬链接影子副本**（`19-27` 曾推荐）已被**推翻**：rename 后影子与 `.imported` 共用同一 inode，就地写会连带改掉影子 ⇒「sha256 不变」是纪律不是物理保证；权威做法换成**工作区独立 `cp -p` + `sha256sum -c` 冷备**【文档断言·`19-51-preserve-means-side-effects.md` §3.3、`19-39-upgrade-smoke-runbook.md` E17】。
  - patch 侧：升级前后取**「字节 + 结构」双指纹**，升级后用**行 id / 双引号包名 / diff** 三判据核对（机器改写会把注释列对齐压平、追加 entry 行、把包名加双引号，实测 4374→13918 B）【文档断言·`19-29-preserve-cordis-patch.md` §1.5/§2.3/§5.2】。
- **失败处置**：投递失败时按「落地面 0 段」分支恢复；`settings/mutate` 会**重排整个 profile patch**（一次保存 = 6 万字符文件全重排）⇒ 必须带 patch 重排风险与回滚口径【文档断言·`office-upgrade-p1-exec-20260929.md` §9 F-9】。

### M7 插件迁移（逐单元白名单）
- **动作**：每件 `before → .bak → copy → after 哈希 → nlink=1 → node --check`；**整目录件（如 btw `lib/` 恰 10 件）用整目录换**，不做逐文件 `cp`（目录漂移会留下陈旧分块，产生「半新半旧」）。
- **判据**：
  - 运行树**新增 0 / 删除 0**，仅白名单变更（`change-sets.json` 三集合：新 / 删 / 变）；
  - **「在册 + served 字节逐字节包含落位件 + 裸 require UNRESOLVED=0 + 退役名 code 命中 0」**；
  - 页面级：无 `did not activate`、`failed to import` = 声明内集合、`[data-slot-error]` = 0、console 错误 = 0。
  【文档断言·`office-upgrade-unified-assembly-exec.md`（change-sets）、`office-upgrade-p1-exec-20260929.md` §8.1/§8.3】。
  - **「row 存在 ≠ 插件可用」**：dump 里 18 行全 OK 与插件 ESM 链接期失败**可同时成立** ⇒ 必须**直接 import 插件入口做链接冒烟**，且该节结论优先于 row 检查【文档断言·`19-39-upgrade-smoke-runbook.md` §3.11/§2.4】。
  - **0.1.7 新增的「插件兼容性闸门」会错误放行**：它只查 `dsh-*` peer 且 `includePrerelease: true`，实测两个真实坏插件（`dsh-workspace-enhancement@0.1.2`、`@local/dsh-ssh-gui@0.2.0`）**双双放行**【文档断言·`19-21-workspace-enhancement-compat.md` §4】。
- **失败处置**：复制前任何失败分支必须 `return` 非零并终止批次（曾经 fail-closed 缺口会用冻结字节覆盖已落位的后继修复）【文档断言·`office-upgrade-p1-exec-20260929.md` §17.1/§17.3】。

### M8 会话 / usage 数据迁移
- **动作**：多代目录**逐目录** `cp -a`（不得通配批拷）；DB 快照只用**只读连接 `VACUUM INTO`**；私有实例 DB 路径落在私有 home。
- **判据**：
  - DB 一致性：对活跃 WAL 库**顺序 `cp` db+wal+shm 实测 12/12 不一致**（4 打不开、8 `quick_check` 失败），而行数看起来都合理 ⇒ **唯一合法路径是只读连接 `VACUUM INTO`**（或主文件 cp + 双 check + ≤3 重试）；只读打开会写 `-shm` 读标记，须登记为**预期副作用**【文档断言·`office-upgrade-p0-b-audit-20260929.md` 附录 K-1】。
  - 无损判据必须**逐键四桶 + 集合 digest**：总和判据对键置换失明；`dsh scanned=` 下降是**幂等自然行为**不能判缩水；`sync_state` 指纹 + 事件四桶 + 日桶逐日三项**逐值不变**。
  - **「隔离 `sessions` 为空」对「隔离创建面成立」零区分力**（与三种互斥情形观测值完全相同）⇒ 必须用**正向四判据**：工件只落 `$NEWHOME/sessions/**`、现役 0 命中该 id、现役 `session.v4*` = 0、现役 v3 集合哈希 before==after【文档断言·`upgrade-isolation-followup-audit.md` §3.3】。
  - 跨进程幂等：重启后第二遍 `new=0` 且三表逐值不变。
- **失败处置**：出现 `-wal/-shm` 异常在**任何 unlink/copy 之前硬停 exit 2**（restore 路径加固口径）。

### M9 端到端验证（正负例）
- **动作**：宿主实例（DB 面 + 日志/闸可观测性）→ 真实 Chrome DOM 席位 → 真实导航正负例 → usage/taste/PPT **同面同时取证**。
- **判据**：
  - 正例：组件**自发** preview **恰 1 次**、HTTP 200 **且**业务 `ok`、载荷 sessionId/deckId 精确匹配；
  - 负例：**0 次**，且负例时间窗内 preview 0；
  - 全窗 console/slot 错误 **0**；
  - **手动 POST ≠ 组件自发**；组件切片 + 伪造 props/假 client **只证组件行为**，不证交付链；
  - 「恰一次」必须有**结构面依据**（如 `useEffect` 依赖表 + 无交付须 `return null` ⇒ RPC 0 次）。
  【文档断言·`office-upgrade-p1-ppt-positive-exec.md` §2、`office-upgrade-p1-final-gates-audit.md` §5.3(g)、`office-upgrade-p1-render-remediation-exec.md` §10、`office-upgrade-ppt-ui-navigation-audit.md` §6】。
  - **正向验证与「没有报错」解耦**：识图要用**已知内容**的图问**可证伪**问题；搜索必须给**具体 URL + 新鲜度**（「触发但零命中」与「被禁用」外观相同）【文档断言·`19-43-silent-failure-guard.md` §4】。
- **失败处置**：任一不满即 NOT PASS；**不得用组件切片或手工 POST 冒充**；未知状态立即留证（before/stop 截图 + network）并停。

### M10 回滚准备与演练
- **动作**：`rollback/` 保存覆盖前件 + manifest；**只在抛弃副本上**演练逐件还原 before 哈希 + 旁路 sentinel 不变。
- **判据**：
  - 回滚不是一条命令，而是**八条独立线**（L1–L8），其中 **L1 全局 launcher 与 L7 sessions 是唯二不可逆线**【文档断言·`19-36-rollback-and-verification.md`】；
  - 回滚演练的判据是**负向验收**：模拟升级态上必须**至少 4 项 ❌**，全绿即证明脚本**假绿**——这比「能回滚」更重要；
  - 逐件还原 before 字节、sentinel 保持、`restoredEqualsBefore=true`（上一轮实测 31 条 touched paths）；
  - 还原后必须「健康 + **基线缺陷复现**」以证明回到已知状态；
  - 验收/回滚脚本**一律不调 launcher 打现役 home**：`--dump-config` / `--help` 共用 `prepareProfile`，**至少写两个东西**（重写 `profiles/web/cordis.yml`、`rm -rf profiles/web/.dsh-module-fallback/`）【文档断言·`19-36-rollback-and-verification.md`、`19-24-parallel-home-hardening.md` F1c/F7】。
- **失败处置**：产物不完整即封存不回写；归档脚本**禁止当上线命令**（TOCTOU / 无 `O_NOFOLLOW` 为已知残留）【文档断言·`office-upgrade-restore-path-guard-exec.md` §1/§4/§6.1】。

### M11 切换预案（**只准备，不执行**）
- **动作**：重取切换前快照（须与现役**逐字节相同**）；产出可粘贴 Runbook（目标路径、停止点、备份、回滚点、现役增量核对、逐项验收命令、**失败即回滚**分支）。
- **判据**：
  - 快照必须与现役**逐字节相同**且 mtime ≥ 最后一次修改；停实例后取；
  - Runbook 每条命令可直接复制执行且标注**预期输出**；
  - **不得**包含自动执行切换的步骤；**未获放行的操作不要留可粘贴形态**（上一轮实测：不可执行阶段在代码块内嵌 `exit 1`，切换段的可复制命令被**整体删除**，恢复可执行形式需闸门全关后由主档重新生成并留版本记录）【文档断言·`office-upgrade-gates-audit.md` G-07/D-2、`19-39-upgrade-smoke-runbook.md` §3.12/§4.1/§4.2】。
- **失败处置**：快照陈旧化即重取（上一轮实测 `cordis.patch.yml.web` 曾比现役少 2 个顶层条目）。

### 汇总判据（14 条，可勾选，跨版本通用）
> 来源：`office-upgrade-*` 系列汇总（见 N10 笔记 §1.2 逐条来源）。0.2.0 迁移应作为**门禁清单原样继承**。
1. 私有根 `0700`；`-perm /077`（非 symlink）= 0；证据件 `0600`。
2. 复制前后源 manifest 全等，否则停止重冻结。
3. 运行树新增 0 / 删除 0，仅白名单变更。
4. 链接 `realpath` 全在私有根内；无断链 / 无硬链 / 无 `(dev,ino)` 共享。
5. `zero external`：无任何路径解析到 P/R/M、现役或旧 prefix。
6. worker 侧可解析 `@deepseek-ai/dsh-home-paths`（否则整条采集**静默变 warn、数据面为 0**）。
7. 新 profile 起后 `applies=live`、异常 fail-closed、四桶不减、两遍幂等、源哈希不变。
8. **跨进程**幂等：重启后第二遍 `new=0`，`sync_state` 指纹与磁盘代次/mtime/size 逐值一致。
9. 真实浏览器：席位在册 + served 字节逐字节包含落位件 + 裸 require UNRESOLVED=0 + 退役名命中 0。
10. 页面级：无 `did not activate`；`failed to import` = 声明内集合；`[data-slot-error]` = 0；console 错误 = 0。
11. 正负例：正例自发 preview 恰 1、负例 0、载荷精确匹配、HTTP 200 且业务 ok。
12. 回滚演练：touched paths 恢复 before 字节、sentinel 保持、`restoredEqualsBefore=true`。
13. 收尾：所有端口释放（`ss` 计数 0）、无残留 job/进程。
14. 全程**零模型请求 / 零外呼**（`unshare -rn` 仅 lo + 硬 fetch 守卫计数 0），无 `sandbox_permissions`。

---

## 3. 死路与被证伪假设清单

> 说明：上一轮**显式登记**的死路集中在交接件 §6（12 条）+ `office-upgrade-*` 系列（58 条）+ 各专题 19-*/upgrade-*（约 100 条）。本节按「不要再试」的价值合并去重，保留**最容易被 0.2.0 重犯**的部分。

### 3.1 交接件 §6 显式死路（12 条，最高优先）
| # | 死路 | 为什么不要再试 | 来源 |
|---|---|---|---|
| E1 | **CDP 恢复浏览器在线**（`Network.overrideNetworkState` / `emulateNetworkConditions`） | 本机 Chrome 153 协议中**不存在**这两个方法，调用后 `navigator.onLine` 仍 false；真实路径 = 官方「连接异常」按钮即时重连（`navigator.onLine=false` 下亦可成功） | 交接件 §6 |
| E2 | **只补 `turnTail` 的 `id`** | `list` 槽**不消费** `entry.select`；只补 id 会把注册期错误换成渲染期 `matched.deckId` TypeError；必须**同批**在组件内做 `deliveryForClosing(turn.data.get(...), seq)` + 无匹配 `return null` | 交接件 §6、`office-upgrade-p1-render-remediation-audit.md` |
| E3 | **`plugins.item` 自动生成五字段表单** | 平台只传 `form`、不画控件；0.1.7 **无 schema→自动表单构件**；且旧 5 字段 UI **从未存在**（0.1.1 也没有） | 交接件 §6/勘误 7 |
| E4 | **给 usage 客户端把 `settingsScope` 改名 `scope`** | 平台对注入键名**零校验**；改名属**超最小修**，已否决（保留原名） | 交接件 §6 |
| E5 | **taste「1 行 store 替换」** | 命中在 **JSDoc 注释**里，是**伪单元**；真实缺陷是 5 个 `Icon*Outline16` 退役图标 | 交接件 §6 |
| E6 | **空库陈旧高代守卫靠库态判据** | `existing.size>0` 门内的守卫**在空库里全不进入** ⇒ 必须走**发现阶段的内容判据**（已实现为 `generationGuard`，默认 true） | 交接件 §6 |
| E7 | **顺序 `cp` 活跃 db+wal+shm 当一致快照** | 实测 **12 次里 0 次一致**；必须 `{readOnly:true}` + `VACUUM INTO` | 交接件 §6 |
| E8 | **裸 `cp` 目录当独立组合** | `cp -a` 会带出指向旧根/`/tmp` 的绝对链接，或触发 router 之外的原生解析（实测 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-scope`）；必须全量 `realpath` 验收 | 交接件 §6 |
| E9 | **「网络命名空间外直接 `ip link set lo up`」** | 需 `unshare -rn` 外层，否则 `RTNETLINK Operation not permitted` | 交接件 §6 |
| E10 | **用 `ps -p <宿主 pid>` 判实例存活** | 本沙箱（`bwrap --unshare-pid`）**结构性不可用**，恒返回 `NO_SUCH_PID`；核验改用「端口 + 隔离 home/prefix 存在性 + patch 哈希 + 会话直方图」 | 交接件 勘误 1、§6 |
| E11 | **`git status` 脏 = 写者冲突** | 不成立；单一写者纪律靠**写面清单**，不靠脏状态推断 | 交接件 §6 |
| E12 | **用 `~/.dsh/.agent-presets/` 目录式 preset 修默认 preset** | 0.1.7 **零处**读取该目录（其自带 skill 明写 "Nothing reads that directory any more"）；正解是改 `profiles/web/cordis.patch.yml` 的**声明行** | 交接件 §6、`19-29-preserve-cordis-patch.md` §3.1/§3.3 |

### 3.2 工具/环境类假阻断（**最容易被当成产品故障**）
| # | 死路 | 为什么不要再试 | 来源 |
|---|---|---|---|
| E13 | **「`ps`/`ss -ltnp` 看不到实例 ⇒ 实例没了」** | 是 `bwrap --unshare-pid` 伪影；宿主 `ss` **看不到隔离 netns 内的服务** | 交接件 §7 条 7、`office-upgrade-r0-audit-20260929.md` 附录 A.5 |
| E14 | **「`node --test <目录>` 通过」** | 静默 exit 0 / 0 测试 = **假绿**；必须显式传 spec 路径 | `office-upgrade-remaining-behavior-exec.md` §4 |
| E15 | **「裸 `curl /` = 200」作判据** | 该版根路径鉴权三态：有效 token ⇒ **303 + set-cookie**；有效 cookie ⇒ 303；**其余一律 401** ⇒ 裸根请求**注定 401** | `upgrade-isolation-followup-audit.md` §3.2 |
| E16 | **「401 可当验收通过」** | 401 只证明「在监听 + 鉴权门已装载」，比「进程活着」强但**不是**通过判据 | `upgrade-isolation-followup-audit.md` §3.2 |
| E17 | **「非 loopback `Host` ⇒ 根页面 403」** | 判据**错位**：403 只作用于 `admit()` 路由族；根页面是 401/303，静态资源是 200；303 恰是 token→cookie **成功**分支 | `upgrade-endpoint-boundary-verification.md` §5.1/§5.2 |
| E18 | **「端点全 404 ⇒ 端点不可达」** | 是**探针形状错误**；有效判别是 **404（命名路由命中）vs 405（fallback 未注册）**；`/api/**` 本身必然 404，**不可**作未注册对照 | `upgrade-endpoint-boundary-verification.md` §3/§4.3 |
| E19 | **「`navigator.onLine===true` 作前置门」** | 已撤销为观测值；改官方 disconnected 按钮 + 当前连接 `$events ready` 同代校验 | `office-upgrade-u-driver-final-audit.md` §4/§5 |
| E20 | **「侧栏标签是 `Close sidebar`」** | 实为 `Collapse sidebar`；错标签导致跳点击分支 | `office-upgrade-finish-driver-crosscheck.md` D2、交接件 §7 条 2 |
| E21 | **「首次配置弹窗必现」** | **不是必现**；必须实现**两分支** | `office-upgrade-finish-onboarding-audit.md` |
| E22 | **「全树字符串清零 = 零外链」** | 假阳性来源；须用 `realpath`/`lstat` | `office-upgrade-unified-assembly-audit.md` §5-5 |
| E23 | **「静态冒烟报的缺导出数量 = 部署面规模」** | 那是**夹具口径**；部署面实测多 2 行（夹具漏了两个自建插件） | `upgrade-isolation-followup-audit.md` §3.6 |
| E24 | **`rsync -a <src> <dst>/` 语义** | 会复制出**同名子目录** ⇒ 逐项 `files=0` ⇒ 静态扫描**全 OK 的假阴性**；夹具操作后必须先验「文件数 > 0」 | `upgrade-isolation-rebuild-exec.md` §6.2 |
| E25 | **「夹具内动态失败 = 插件缺陷」** | 插件自身依赖必须由**夹具根 `node_modules`** 提供，否则全是 `ERR_MODULE_NOT_FOUND` **假失败** | `upgrade-isolation-rebuild-exec.md` §6.2 |
| E26 | **「副本缺 peer 包」时判破坏点** | 会**制造假阳性**（两条「槽协议变更」错误在补包后双双消失 19→17）；且 `grep -rn` 遇 symlink 会**假阴性**，须 `-R` | `19-57-btw-remaining-audit.md` |
| E27 | **审计 `@local/*` 时直接 `grep -r`** | 插件自带 244 MB 的 0.1.1 时代依赖树 ⇒ **假阳性**（曾误判 pptmaster 有 3 个文件 import 已删 API）⇒ 必须 `--exclude-dir=node_modules` | `upgrade-next-isolated-audit.md` |
| E28 | **「`--dump-config` / `--help` 无副作用」** | 两者共用 `prepareProfile`，**至少写两个东西**（重写 `cordis.yml`、`rm -rf .dsh-module-fallback/`） | `19-36-rollback-and-verification.md` |
| E29 | **`settingsScope.bind` / `settings.register` / `installSettingsSection` 仍可用** | 0.1.7 整包对这些符号 **0 命中**；`settings.register` 会 `TypeError`；导出表只剩 3 个 | `19-28-settingsforms-mapping.md`、`19-37-0.1.7-known-bugs.md` |
| E30 | **「0.1.7 有 autoGenerate 客户端消费者」** | 对全部 `dsh-client-ui-*/lib/client.js` grep `autoGenerate` = **0 命中** ⇒ 「删掉客户端注册、指望自动生成设置页」会**静默丢页面** | `upgrade-settings-migration-units.md` |
| E31 | **「`patchReload` 命中数 0 ⇒ 必须重启」** | 该推理在**两个版本都错**：0.1.7 该键静默忽略但监视行为**搬进 hmr 包且无条件**；0.1.1 同样 0 命中却无条件热重放 | `19-40-hmr-reload-semantics.md` |
| E32 | **「把 `hmr.config.root` 配到插件目录即可热载插件宿主代码」** | `loadDependencies()` 对任何含 `/node_modules/` 的 URL **直接返回空集**⇒ 该插件**永不热载**；本机所有 `@local/*` 都在 `profiles/node_modules/` 下 | `19-40-hmr-reload-semantics.md` |
| E33 | **「`optional inject` 可作降级声明」** | 探针实测 required 与 **optional 都把 fiber 停在 state 0**、`apply` 从不执行 ⇒ 插件**整体不加载**；一律用 `ctx.get(name)` **无声明**读 | `upgrade-live-config-preservation-audit.md` §4.2(e) |
| E34 | **「没有报错 ⇒ 通过」** | 缺服务而声明 required inject 时 fiber **静默停在 state 0**（不抛错、日志无守护报文）；cordis 4.0.4 的 `Entry.update()` 不再返回 waterfall promise ⇒ `await` 提前返回 | `upgrade-n13-crosscheck.md` |
| E35 | **「补丁没命中可以忽略」** | 日志 `patch: entry "..." not found` 意味补丁**被静默跳过** ⇒ 实验无效；任何补丁实验都要带「补丁已生效」**前置断言** | `upgrade-isolation-followup-audit.md` §10.3-N2 |
| E36 | **`chmod 444/000` / 只读挂载能保住 `settings.yaml` / `cordis.patch.yml`** | `rename()` 只看**父目录**写权限（实测 0444 文件照改、0555 目录才 EACCES）；`writeFileAtomic` 写同目录临时名再 rename，**顺手把 mode 改成 0600** | `19-27-preserve-settings-yaml.md` S9/§7.1 P1、`19-29-preserve-cordis-patch.md` §2.4 |
| E37 | **「靠升级后比对再还原」保住 settings** | `rename()` 在 Loader settle 之后**毫秒级**发生，操作者来不及介入；且重复 import 会**静默覆盖已存在的 `.imported`**（唯一存档） | `19-27-preserve-settings-yaml.md` §5.2 |
| E38 | **「存在官方 settings 迁移工具 / codemod / `dsh migrate`」** | 三处独立检索全部**不存在**；唯一「迁移器」是 `importLegacyDocument()`，**不可拦、不可预览、先改名** | `19-14-community-upgrade-intel.md` §7 N3/N4 |

### 3.3 架构与数据类死路
| # | 死路 | 为什么不要再试 | 来源 |
|---|---|---|---|
| E39 | **「取最高代」是安全默认** | 现役 3 个 v3 是 09-12 的**陈旧前缀**，机械切换 output `748,788 → 134,649` = **−614,139**（三会话 −70.6%），**可复现**；宿主只按版本号排序、不比较数据量 | `upgrade-generation-preservation-adjudication.md`、`office-upgrade-p0-exec-20260929.md` §12.3 |
| E40 | **「所有代并集」当保全** | 并集 = 把不同代的行相加 = **假保全**；695/224/24 被显式登记为**禁用值** | 同上 |
| E41 | **「把 header 版本改判为 3 即产出合法 v3 工件」** | 真实 v3 读取器 **4/4 拒绝**（`released v2 physical header lacks isSeeded`）；各代是**逐事件**变换；19-54 的驱动用了 identity stub encoder | `19-55-session-repair-exec.md`、`19-54-session-migration-remediation-audit.md` |
| E42 | **「只修描述符就能让全部会话打开」** | 修完会立刻暴露 **357 会话 / 714 消息**的插件快照缺陷（19-23 只看到 4 例，因为另 353 例被描述符闸门**遮蔽**）⇒ 「可见数 ≠ 规模」 | `19-54-session-migration-remediation-audit.md` |
| E43 | **「等官方修」/「下一版会放宽闸门」** | npm 上最新即 `0.1.7-rc.2`，v0 边**仍**硬要求描述符 `version===3` | `19-54-session-migration-remediation-audit.md` |
| E44 | **软链现役 `sessions` / 复制整个 sessions 目录做真回归** | 软链会让新版**往现役库写 vN 代**；现役库有 3 个「v3 快照 vs 仍增长的 v0」分叉会话，一开就把旧快照升成 v4、**永久排除后续 v0 内容** | `19-23-session-format-migration.md` §4.2/§3.3 |
| E45 | **「退回 `0.1.5-rc.3` 是安全回滚点」** | 0.1.5 与 0.1.7 同样「最高代优先」⇒ 选中 v4 后抛 "upgrade the harness"；`list()` **静默跳过**该文件 ⇒ 回滚目标**只有最老版本** | `19-23-session-format-migration.md` §3.2 |
| E46 | **「`session/export` 可充当会话被真实打开」** | 用户裁决：export 只是「持久化读 + 序列化下载」，**不足以**称 open | `upgrade-b567-exec.md` |
| E47 | **「在真实 DB 上重建/清空/重算 dsh 行」** | 现役库为 **3,768** 个会话持有 usage 行，其中约 **1,670** 个源文件**已不存在** ⇒ DB 是这些会话的**唯一持有者**；一切实验只在 `VACUUM INTO` 预映像副本上做 | `upgrade-generation-preservation-adjudication.md` |
| E48 | **「只放宽 glob 就能让 dsh-usage 恢复计数」** | `db.js` UPSERT 是「最新观测胜」而非 `INSERT OR IGNORE` ⇒ 会**静默改写**已有行；`?? file` 兜底会让同会话两代变**两身份** ⇒ 真双计 | `upgrade-usage-v4-compat-audit.md` |
| E49 | **「`Cannot find package` ⇒ 一律缺包，装包补上」** | 同一症状两种根因：A 类包**已改名**（`dsh-workflow-worker-thread` → `dsh-workflow-ptc`）；B 类包**存在**于安装内、是解析基问题。正解是改 preset 行 `id`+`name` **两字段**，**零下载、零重启** | `upgrade-worker-dependency-audit.md`、`upgrade-worker-fix-exec.md` |
| E50 | **「全局 shim 可同时救 7 个插件」** | router 把裸标识供到**安装**基（改安装被明令禁止）⇒ shim 路线在边界内**不可行**；唯一合法路径是逐插件源码迁移 | `upgrade-remaining-delivery-units.md` |
| E51 | **「把 `dsh-client-runtime/client` 机械替换为 `dsh-client-store`、四个插件同一改法」** | pptmaster 唯一消费符号 `isAppendSurfaceEvent` 在 store **0 命中**；照做会把**加载期硬失败降级为迟到的运行期 TypeError**；运行期硬依赖实为 **3 个而非 4 个** | `017-client-store-replacements.md` §0.1/§4-A2/§9.2 |
| E52 | **`require("@deepseek-ai/dsh-client-store/client")` 可用** | seed 查**原始字面**（strip 在后），且该包 `exports` **无 `./client`**；官方 39 个 client bundle **一律裸标识** | `017-client-store-replacements.md` §2-S1/S3 |
| E53 | **「改 `dsh.client.inject` 就算修好 client 半边」** | inject 未知包名**静默跳过**（非致命）⇒ 只改 inject = **假修复**（能过静态包名检查，运行期照样 THROW） | `017-client-store-replacements.md` §2 |
| E54 | **「一份 client.js 可同时服务 0.1.1 与 0.1.7」** | 裸 store **不是 0.1.1 的 seed 字**（0.1.1 seed 仅 7 字）⇒ 替换后的 client 半边在 0.1.1 上**必然 THROW**；只能选一代（回滚 = 复制旧字节） | `017-client-store-replacements.md` §5.3-4 |
| E55 | **「静态冒烟/冻结字节一致 ⇒ 功能可用」** | 冻结字节 **≠** 已生效；替换 specifier **≠** 功能通过；验收必须是**活实例 boot manifest + `require` 失败数 = 0** | `017-client-store-replacements.md` §10-6 |
| E56 | **「本地 subagent 路由 helper 是唯一等价补丁、必须保留」** | 该结论只统计「默认值」**一条轴**，把原生**完全覆盖**的项排除在等价性讨论之外 ⇒ 已被**结论层否决** | `017-native-subagent-model-overlap.md` §4.2、`017-native-subagent-model-adoption-decision.md` §0.1 |
| E57 | **「原生 `subagent-model-selection` 能承接固定子代理默认路由」** | 其 `Config` 只有 `{enabled, allowedModels}`，**无任何默认 route 字段**；形状/触发者/时点三者都不对 | `017-native-subagent-model-adoption-decision.md` §3.1 |
| E58 | **「对 `~/.dsh/profiles/web` 执行 `npm/pnpm install`」** | **仓库级禁令**：曾把 **198 个官方包**装成**未打补丁的本地副本**，运行进程优先加载 ⇒ **全体补丁失效**；且 profile 自身**没有**私有依赖树 | `02-plugin-system.md` §6 硬约束 1、`04-ops-deploy.md` §5 |
| E59 | **「`cordis.patch.yml` 的 `insert` 里可以写文件路径名」** | 运行实例里 `import` **不执行**，且导致**整次回滚**；必须写 **bare 包名** | `02-plugin-system.md` §4.2 硬约束 |
| E60 | **「patch 层可以换行绑定的包 / 改行 id / 只写半个 config / 恢复已删 config 键」** | ①`name` 只做 mismatch 校验后 skip，**不可改**；②id 不可改；③`config` 是**整段替换**（未重述键全丢）；④未知键**不报错但被静默忽略**，配插件 `if (x === void 0) return` 守卫 ⇒ **整插件静默变 no-op** | `19-17-breaking-changes.md` §0.2/§0.3/§5.3 |
| E61 | **「`spill-policy` 写回 `maxInlineBytes` 恢复旧行为」** | 0.1.7 改为 `maxInlineTokens`；写旧键不报错、`apply()` 读到 `undefined` 直接 return ⇒ **spill 整块静默 no-op** | `19-17-breaking-changes.md` §5.3 |
| E62 | **「补丁打不中会报错/中断」** | `applyEntryPatches` 语义 = **warn + 跳过**；0.1.7 自身文档亦印证 "unknown targets … warned and skipped" | `18-upgrade-compat-matrix.md` §0.3 |
| E63 | **「原生能力与本地定制大量重叠、可大批退役」** | 13 项能力里 3 项本来就无本地实现、9 项有原生无法替代的差额，**唯一真并列**只有「子代理设置页入口」 | `017-native-local-feature-overlap.md` §0 |
| E64 | **「客户端的 `installSettingsSection` 缺失只是 warning 级降级」** | `dsh-settings` 是 `"type": "module"`：具名导出缺失 = **ESM link 期 SyntaxError**，插件**整行加载失败** | `19-19-local-plugin-migration.md` §0.1/§2.1 |
| E65 | **「静态兼容缺陷 ⇒ 一定能消除 React #130」** | 静态兼容缺陷**足以**进入有限修订，但**仍需真实导航正负例验证**能否消除当前 React130，**不能声称已捕获其 `element.type`** | `office-upgrade-current-adjudication.md` |
| E66 | **「用假 turn.data / 假 RPC 替代真实正例」** | 明确禁止；`deck/preview` 是**本地文件读**，可用新造私有 v4 会话 / 离线预制 deck **零模型**完成真实正例（此前「必须模型生成」的假设**已撤销**） | 交接件 勘误 6、`office-upgrade-current-adjudication.md` |

### 3.4 治理/口径类死路（**上一轮返工的最大来源**）
| # | 死路 | 为什么不要再试 | 来源 |
|---|---|---|---|
| E67 | **「单元/机制 PASS ⇒ 目标 PASS」** | 协调者裁决 P0 目标**未通过**；执行档 PASS 仅覆盖机制与局部测试 | `office-handoff.md` §5.2/§8、`office-upgrade-doc-sync-exec.md` §2.4 |
| E68 | **「能读 ⇒ 能打开 / 无损迁移」** | adopt 后 v4 视图 `Δ行 −613`、`Δoutput −614139`、`v4 == v3` | `office-handoff.md` §5.2/§7 第 5 条 |
| E69 | **「拒绝 = 迁移完成」** | `held` = **未迁移**；不得把 `generationHeld===1` 写成「数据已保全」 | `office-upgrade-doc-sync-audit.md` §2.4 |
| E70 | **「术语碰撞式转述」** | 「冷恢复已通过」曾指 **subagent 冷恢复**（新造 child），与「旧 0.1.1 会话 agent 级 cold adopt」是**两件事**；需专档勘误 | 交接件 勘误 2 |
| E71 | **「引用旧轮证据」** | 多份报告引用旧轮 `served`/boot 日志得出结论（如把已修的 taste 图标当现行故障）⇒ 结论必须绑定**当轮** served 字节哈希 + 时间戳 | 交接件 §7 条 3 |
| E72 | **「收口后继续执行旧排队消息」** | 多次出现「收口后又执行旧实验/又起服务」⇒ 返工与证据混乱；恢复只能**一条**新指令 | 交接件 §7 条 1 |
| E73 | **「按症状猜根因」** | 「0.1.7 validator 变严导致路由失效」被证伪：三版 validator **逐字相同**，真因是**依赖目录漂移**（`^0.82.1`→`^0.85.1` 后 `opencode-go` 目录删掉 `grok-4.5`） | `19-31-piai-0.1.7-route-compat.md` |
| E74 | **「升到最新 rc 可规避已知缺陷」** | rc.1→rc.2 仅隔 1.024 天，`dsh-settings`、`dsh-session-format*` 的 `lib/index.js` **逐字节相同** ⇒ 已知缺陷全在。正确闸门是**逐包 diff 缺陷所在包是否真的变了**（无需安装） | `19-37-0.1.7-known-bugs.md` |
| E75 | **「`same-service-name ⇒ compatible`」** | `sessions` 服务在、**成员被换掉**；「服务名存在」是最弱判据，必须**逐成员核对** | `btw-017-consolidated-units.md`、`19-56-btw-017-exec.md` |
| E76 | **「测试全绿 ⇒ 契约被覆盖」** | 7 个 host-* 测试**整模块 mock** 掉关键依赖 ⇒ 真 helper 从不执行，全套 277 tests 全绿（**「绿而空」**） | `19-57-btw-remaining-audit.md` |
| E77 | **「本轮改动新增了类型错误 ⇒ 应回滚」** | 对照实验（原源码 + 同 0.1.7 依赖树跑同一 `tsc`）证明**新增错误 = 0**；残留错误是**审计未覆盖的破坏点**，不是回归 | `19-56-btw-017-exec.md` |
| E78 | **「同类修复做掉一个就可推断其余完成」** | 实证**结论相反**：一个为真阻断、另一个是**注释伪单元**。同类单元必须**逐个实读**，不得跨单元推断 | `017-client-store-replacements.md` §14 |
| E79 | **「审计期已冻结的交付树可继续当基线」** | 交付树在审计期间**被并发改写** ⇒ 「代码自某时刻起冻结」的声明**不成立** | `office-handoff.md` §5.1.1 `A-05`、`office-upgrade-p0-generation-guard-supplement.md` 文首 |
| E80 | **「本地私有插件失败形态都一样」** | 实为 **3 硬抛 + 3 静默失效 + 2 无客户端半**，其中两个插件**同时命中两种** | `19-33-client-plugin-contract.md` |

---

## 4. 历史坑 × 0.2.0 适用性判定表

> **排序**：按上一轮**实际代价**降序（数据损失 > 口径错误 > 返工轮次 > 取证成本）。
> **适用性判定依据**：`仍适用`（机制在两版相同，或坑与版本无关）/ `仍适用·实测确认`（本轨字节级实测确认机制未变）/ `待验证`（形状常量必须按 0.2.0 重推）/ `已不适用`。

| 排序 | 坑（现象 → 代价） | 来源 | **0.2.0 适用性** | 依据 |
|---|---|---|---|---|
| 1 | **空库/新 home 首采静默采信陈旧高代**：A 由 654 行/748,788 out 掉到 41 行/134,649 out（−614,139），`failed=0`、无 anomaly、`sync_state` 固化错误指纹 → **数据可见损失 + 无痕** | `office-upgrade-p0-exec-20260929.md` §12.3 | **仍适用**（高危） | 坑在**判据形态**（守卫挂在库态 `existing.size>0`），与版本无关；0.2.0 新 home 首采必然复现同一入口 |
| 2 | **宿主层 `resolveGenerationInDirectory` 只按最高代取、不校验内容包含** → agent 级 adopt 第一步即发布 v4 ⇒ v0 独有内容永不进入 v4 | `office-upgrade-p0-audit-20260929.md` §9.1.5 | **待验证** | 该函数在 `dsh-session-*`/`dsh-base` 面，而 0.2.0 这批包**全部改版**；必须重读 0.2.0 源码确认选代语义是否仍为词法最高代 |
| 3 | **「单元/机制 PASS ⇒ 目标 PASS」口径错误** → 把「机制通了」误读成「数据无损」，上一轮最贵的口径错误 | `office-handoff.md` §5.2/§8、`office-upgrade-doc-sync-exec.md` §2.4 | **仍适用** | 纯治理口径，与版本无关；**0.2.0 迁移必须原样继承分层验收纪律** |
| 4 | **测试工具缺陷被当产品故障**（中文硬编码引导、`Close sidebar` 错标签、`closes===1 && disconnected===0` 跳分支、`sourceTransform` oracle 错、`proto.domains.find` 字段名错、workspace JSON 缺 ISO 时间戳、`HOME`/`DSH_HOME` 与 fixture 根不一致）→ 多轮重启与重跑 | 交接件 §7 条 2、`office-upgrade-u-navigation-root-audit.md`、`office-upgrade-finish-onboarding-audit.md` | **仍适用** | 判据「**先证明产品坏，再改产品**」是跨版本纪律；且 0.2.0 会重写驱动（上一轮的 D1–D9 修复项**全部未执行**） |
| 5 | **对 `~/.dsh/profiles/web` 执行 `npm/pnpm install`** → 198 个官方包变未打补丁副本，**全体补丁失效** | `02-plugin-system.md` §6 硬约束 1、`04-ops-deploy.md` §5 | **仍适用** | 仓库级禁令；0.2.0 的 profile 同样没有私有依赖树 |
| 6 | **`settings.yaml` 「见名即改名」、先改名后解析、不可拦、无回滚点**；失败启动会吃掉 settings 且**永不复重试** → 值面不可逆中间态 | `19-27-preserve-settings-yaml.md`、`19-51-preserve-means-side-effects.md`、`upgrade-isolation-followup-audit.md` §3.1 | **仍适用·实测确认** | 【本轮实测】`@deepseek-ai/dsh-settings` 的 `lib/**` 在 0.1.7-rc.2 与 0.2.0-rc.1 **逐字节相同**，`lib/index.js` 两版同 sha256 `9432b872597b7a31473072eb38a55979ab23375c76bd1d86d751388a692a0136`，`.imported` 改名逻辑 5 处命中两版一致 |
| 7 | **顺序 `cp` 活跃 db+wal+shm 当一致快照** → 12/12 不一致（4 打不开、8 `quick_check` 失败），而行数看起来都合理 | 交接件 §6、`office-upgrade-p0-b-audit-20260929.md` 附录 K-1 | **仍适用** | SQLite WAL 语义与产品版本无关；0.2.0 的 usage/会话库同为 WAL |
| 8 | **裸 `cp -a` 目录当独立组合** → 绝对链接外逸 / router 之外的原生解析（`ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-scope`） | 交接件 §6、`office-upgrade-p0-exec-20260929.md` §12.10.4 | **仍适用**（且更强） | 【本轮实测】0.2.0 依赖闭包**新增 5 包 + 一整条 `got` HTTP 栈**（非 `@deepseek-ai` scope 顶层包增 12 项）⇒ 复制面与解析面均变大 |
| 9 | **patch `config` 整段替换 + 未命中 warn+skip + 旧键静默忽略** → 迁移看起来成功但功能静默 no-op | `19-17-breaking-changes.md` §0.2/§0.3、`18-upgrade-compat-matrix.md` §0.3 | **仍适用** | 【本轮实测】现役 patch 与隔离 patch 的顶层条目类型分布分别为 4 `- id:` + 16 `- insert:` 与 10 `- id:` + 17 `- insert:` ⇒ **本仓库实际依赖大量 id 定向覆盖**，静默 skip 的暴露面很大 |
| 10 | **只补 `turnTail` 的 `id` 的「半修更糟」** → 注册期错误换成渲染期 TypeError 并 abdicate | 交接件 §6、`office-upgrade-p1-exec-20260929.md` §12 BL-1/§18.6 | **待验证** | 坑在「槽不消费 `select`」这一**槽契约形状**；0.2.0 新增 `dsh-client-ui-settings-session-log` 等客户端包 ⇒ 槽位面必须重枚举 |
| 11 | **客户端半是热面 / 宿主半是冷面**；**提前改客户端半会让运行中的旧版当场加载新 API 代码而坏掉** ⇒ 客户端半必须留到重启窗口 | `19-40-hmr-reload-semantics.md`、`19-33-client-plugin-contract.md` | **仍适用**（机制）/ **待验证**（清单） | 冷热边界的机制是「宿主 `lib/*.js` 监视面不含其目录 + `loadDependencies` 对含 `/node_modules/` 的 URL 返回空集」，属 `dsh-hmr` 实现；而 **0.2.0 的 `dsh-hmr` 改版** ⇒ 机制需重读。**种子字清单必变**（0.1.1→0.1.7 由 7 变 9），0.2.0 必须重扫 |
| 12 | **凭据权限与格式门禁**：第三方 CLI 写文件不传 mode ⇒ 664 ⇒ DSH 启动第一句 `assertOwnerOnly` 抛、`ctx.credentials` **整个不存在**；插件 CLI `login` 写文档根级键 ⇒ 解析 REJECTED | `19-34-credentials-compat.md` | **仍适用** | 【文档断言·`19-34`】持有该文件的唯一官方包 `dsh-credentials-local` 在 0.1.1/0.1.5/0.1.7 **三版 `lib/index.js` 同 sha256**；0.2.0 是否仍同待测【待验证】，但纪律（`umask 0077` / `chmod 600` / 启动前硬门禁 / 禁用 `install -m 600`）与版本无关 |
| 13 | **STOP 后仍消费旧排队消息**（收口后又执行旧实验/又起服务） | 交接件 §7 条 1 | **仍适用** | 编排纪律，与版本无关 |
| 14 | **单一写者/写面清单缺失** → 被审件被改 ⇒ 旧哈希结论作废、整体复测 | `office-upgrade-p0-generation-guard-supplement.md` 文首、`office-upgrade-p1-render-remediation-audit.md` §6 | **仍适用** | `_migration/**`、目标组合 patch、交付根均曾出现双写风险 |
| 15 | **探针/测试残留进入交付候选**（探针包、insert 行、6 条 mutate 覆盖行） | `office-upgrade-remaining-behavior-exec.md` §0.0.1/§3.6 | **仍适用** | 0.2.0 迁移同样需要探针，需**分列**产品改动与测试残留并在装配前验残留归零 |
| 16 | **`ps -p` / `ss -ltnp` 在 `bwrap --unshare-pid` 沙箱不可用** ⇒ 假 `NO_SUCH_PID`；多档重复取证 | 交接件 勘误 1、`office-upgrade-r0-audit-20260929.md` §3/§10 D-2 | **仍适用** | 【本轮实测】同一沙箱下 `ss -ltn` 可见 3080/3097（`-p` 需特权）；判据必须继续用「端口 + inode + 哈希 + 直方图」 |
| 17 | **`node --test <目录>` 假绿**（exit 0 / 0 测试） | `office-upgrade-remaining-behavior-exec.md` §4 | **仍适用** | Node 行为与产品版本无关 |
| 18 | **绝对计数过期**（会话库/DB 持续增长：1889→2208…） | `office-upgrade-gates-audit.md` §6 A2、`office-upgrade-p0-b-audit-20260929.md` §7.1 | **仍适用** | 【本轮实测】`git status --short` 已从交接件记的 390 行漂到 **396 行** ⇒ 同类漂移仍在发生；判据用**集合等价 digest**，绝对数**必须带采样时刻** |
| 19 | **`cp -a` 继承模式位 + `.iso-scratch-*` 外逸 symlink** | `office-upgrade-p0-exec-20260929.md` §12.10.2–12.10.4 | **仍适用** | 构建动作固有 |
| 20 | **备份/切换前快照陈旧化**（`cordis.patch.yml.web` 比现役少 2 个顶层条目） | `office-upgrade-gates-audit.md` G-07 | **仍适用** | 【本轮实测】现役 patch 123 行 / 20 顶层条目、隔离 patch 635 行 / 27 顶层条目 ⇒ 条目数本身是敏感量 |
| 21 | **npm prefix 安装三前提**（预建 `<prefix>/lib`、`npm_config_cache`、`XDG_CACHE_HOME`）；裸 `PREFIX=` 静默无效；禁 `--legacy-peer-deps` | `19-44-npm-prefix-install.md` §1.2/§3.1/§4.1/§5.3 | **仍适用** | 【本轮实测】`npm` 10.9.8、`node` v22.23.2；默认 cache 只读，必须指向工作区 |
| 22 | **`npx --no-install` 优先命中全局树**，只改 PATH 无用 | `19-24-parallel-home-hardening.md` F4 | **仍适用** | npm `libnpmexec` 解析顺序 |
| 23 | **忽略规则方向性错误**（不带点的凭据文件不被 `.credentials.yaml` 命中；`**/*.tgz` **静默吞掉**仓内升级备份包；`preimage*/` 匹配不到 `pre-image/`，70 条裸奔） | `19-45-repo-state-and-staging.md` §3.2/§3.3/§7 | **仍适用** | 仓库级；0.2.0 迁移会再产出大量 `.tgz`/`pre-image*` 备份 |
| 24 | **UTC 日桶 oracle 与产品 localtime 口径不一致** → 53/55 假失败 | `office-upgrade-unified-assembly-exec.md` | **仍适用** | 时区口径与版本无关；**不得改产品迁就测试** |
| 25 | **`settings/mutate` 会重排整个 profile patch**（一次保存 = 6 万字符文件全重排） | `office-upgrade-p1-exec-20260929.md` §9 F-9 | **仍适用·实测确认** | 该行为在 `dsh-settings`/profile patch 写路径；【本轮实测】settings 包字节相同 ⇒ 重排行为未变 |
| 26 | **文件权限 `chmod 444` 是伪安全**（`rename()` 只看父目录；`writeFileAtomic` 顺手把 mode 改 0600） | `19-27-preserve-settings-yaml.md` S9 | **仍适用** | 与文件系统语义相关；【本轮实测】settings 写入实现字节相同 |
| 27 | **最高代掩盖事故已在本机发生**（同一会话并存 09-12 的 `session.v3` 快照与之后仍增长的 v0，09-17 还长 12 MB）⇒ 新版选旧快照、后续内容被永久无视 | `19-23-session-format-migration.md` §3.3 | **仍适用**（盘面事实） | 这是**磁盘现状**，不会因目标版本变化而消失；**0.2.0 迁移前必须处置这 3 个分叉会话** |
| 28 | **跨报告冲突未裁决**：`19-27` 的「启动前把 `settings.yaml` 改名挪走」与 `19-49` 的搜索修复**互斥**（前者完全不触发迁移，而新版对该段无硬编码兜底） | `19-49-web-search-carryover.md` §2.4 | **仍适用**（须显式裁决） | 冲突在**方法层**，0.2.0 上同样存在 |
| 29 | **`19-27` 推荐的「硬链接影子副本」被 `19-51` 推翻**（rename 后影子与 `.imported` 同 inode，就地写连带改影子） | `19-51-preserve-means-side-effects.md` §3.3、`19-39-upgrade-smoke-runbook.md` E17 | **已不适用**（该手段作废） | 替代手段 = 工作区独立 `cp -p` + `sha256sum -c` 冷备 |
| 30 | **「0.1.5 + patch 层强制 `disabled:false` 可『装插件但不接管』」** | `19-38-route-matrix.md` | **已不适用** | 冲突发生在**注册缝**而非 patch 层；换 `--patch` 或 home 层覆盖 `disabled` 一样冲突 |

---

## 5. 被证明有效的关键机制（可复用操作要点）

### 5.1 `!!js` / patch 层落地本地定制
- **机制**：`cordis.patch.yml` 是「**在 bundle 层之后应用的、顶层 YAML 数组**」的 loader patch 条目集合：`insert:` 列出新增行、`- id: <id>` 定向覆盖 config、`disabled: true` 停用；**允许 `!!js` 表达式**（文件头注释自述）。
- **【本轮实测】现役与隔离 patch 的真实形状**：
  - 现役 `~/.dsh/profiles/web/cordis.patch.yml`：**123 行 / 20 个顶层条目**（4 `- id:` + 16 `- insert:`），2 处 `!!js`；唯一在用的 `!!js` 是 `config.root: !!js dshHomePath('office-ppt')`。
  - 隔离 `~/.dsh-017/profiles/web/cordis.patch.yml`：**635 行 / 27 个顶层条目**（10 `- id:` + 17 `- insert:`），比现役**多出** `agent-preset-registry` / `llm-pi-ai`（约 214 行的内联 provider 注册表）/ `agent-default-model` / `web-search-deepseek` / `ui-theme` / `web` / `connection` 等 id 定向覆盖。
  - ⇒ **可复用要点**：版本升级时 patch 层**不是「照抄」而是「重推 + 补 id 定向覆盖」**；升级前必须打印两版的「顶层条目 id 全集 + 类型分布」，差值就是迁移工作量。0.2.0 应预期再新增一组 id 覆盖（`telemetry/analytics/session-log` 相关行已在 0.2.0 出现）。
- **硬约束**（违反即静默失败或整次回滚）：
  1. `insert` 的 `name` 必须是 **bare 包名**，用文件路径名在运行实例里 **import 不执行且导致整次回滚**；
  2. 非 insert 补丁的 `config` 是**整段替换**，未重述的键**全丢**；
  3. `name` 不可被任何层改写（只做 mismatch 校验后 skip）；id 不可改；未命中 id **只 warn + skip**；
  4. 装配顺序 = bundles 层 → profile 层 → home 层 → `--patch` overlays。
  【文档断言·`02-plugin-system.md` §4.1/§4.2、`19-17-breaking-changes.md` §0.2】
- **写面纪律**：patch 会被机器无条件重写（`edit()` 内容不变也重排）；**改 patch 前必须确认无在途回合**——写入即触发热重载，实测 **15 ms 内静默销毁两个存活会话的在途回合**（其一已跑 12 分 46 秒），该行为在 **0.1.1 就已存在**【文档断言·`19-53-community-preservation-patterns.md`】。

### 5.2 零模型请求 / 零外呼隔离（可照抄的六层做法）
来源：`upgrade-integrated-isolation-exec.md` §5/§6.2/§6.5/§7。
1. **假 LLM adapter**（fake 路由）替换真实 provider；
2. **假工具体**；
3. **硬 fetch 守卫直接 throw**（对任何外呼抛错）；
4. 进程内**仪器插件**计 `fetch.total`，**用后立即移出 profile**；
5. 进程级 **ESTABLISHED = 0** 断言；
6. 网络命名空间：`unshare -rn` 外层（否则 `RTNETLINK Operation not permitted`），仅 lo，外呼得 `EGRESS_BLOCKED`；`env -i` 清空模型 key。
- 上一轮实测结果：`183 checks / 0 failures` + `PASS ZERO outbound`；`fetch.total = 0`。
- **关键反直觉点**：该版本**在有 credentials 服务时不回落进程环境** ⇒「用进程环境设/清键」**无法覆盖凭据解析**；对照必须**同 host**【文档断言·`upgrade-auth401-audit.md` §3、§4】。
- ⚠️ **本轨必须提出的 0.2.0 修订**：0.2.0 新增 **OTEL 遥测链**（见 §5.7），其 `endpoint` 有**默认远端值**。因此 0.2.0 的零外呼门禁必须**新增一项**：确认遥测 exporter 未被挂载 / 端点被改写 / 卸载 drain 不外呼。仅靠 `unshare -rn` 会得到「被阻断」而非「未发起」，二者在**零外呼纪律**下不等价。

### 5.3 无损证明（逐键 / 逐记录深等）
- **禁止**用 mtime / size / 文件数作无损判据（会被现役自身改写，且 v3↔v4 尺寸相近）。
- **正确形态**：
  - **逐键四桶**（新增 / 删除 / 变更 / 不变），**逐键相等**；上一轮实测 A 口径 `9930047 / 748788 / 221614208 / 0`；
  - **逐记录深等**（官方 v3→v4 全链 **4484 记录**深等）；
  - **集合等价 digest**（`vsetDigest` / `keysDigest`）代替绝对计数；
  - **反并集闸**（防假保全的唯一手段）：受影响会话行数必须等于「**恰好一代**的键集大小」，并把禁用值（695/224/24）显式断言**未出现**；
  - **负向判据**（专有指纹：某文件 mtime 变 / 某目录被删 / 硬编码目录被写）替代不可读事实。
  【文档断言·`upgrade-generation-preservation-adjudication.md`、`office-upgrade-a-reopen-ui-exec.md`、`office-upgrade-p0-b-audit-20260929.md` §6.2、`19-39-upgrade-smoke-runbook.md` §1.7】
- **两道 fail-closed 闸缺一不可**：① 陈旧高代守卫；② 「不删旧行」。即便关掉守卫，仍因「需删旧行」停住并量出 `avoidedShrinkOutput = 614,139`【文档断言·`upgrade-usage-v4-migration-exec.md`】。
- **代次守卫的正确形态**：判据在**发现阶段**、**结构上不依赖库态**；`G-1 同 id → G-2 键集超集 → G-3 逐键四桶不缩 → G-6 双侧 torn 拒绝 → G-7 双侧桶值域拒绝`；元断言「开关必须不同」【文档断言·`office-upgrade-p0-generation-guard-exec.md` §2/§10.1】。
- **两道已知开放边界**（不得包装为已解决）：**帧边界对齐截断原理性不可判**（`torn=undefined` 时纯内容判据无信号，只能用**外部字节锚**，且锚**只适用同源冻结源，live 追加根无锚**）；**低代坏值 ⇒ 比较失明**【文档断言·`office-upgrade-p0-generation-guard-supplement.md` §2/§4、`office-upgrade-p0-generation-guard-exec.md` §9.4-1/2】。

### 5.4 版本增量对比（四类 diff 模板，可直接搬到 0.2.0）
来源：`19-17-breaking-changes.md`、`19-33-client-plugin-contract.md`、`19-24-parallel-home-hardening.md`、`upgrade-settings-deployment-manifest.md`。
1. **依赖名集合 diff**：新旧依赖闭包的**包名集合**与**版本串**（本轮实测正是用此发现 0.2.0 新增 5 包 + `got` 栈）。
2. **patch 结构化行序列 diff**：顶层条目 id 全集 + 类型分布（`- id:` / `- insert:`）+ `!!js` 出现位置（本轮实测现役 20 vs 隔离 27 条目）。
3. **导出与 `exports` 子路径 diff**：`package.json` 的 `exports` 键集合 + `lib/*.js` 具名导出集合（**具名导出缺失 = ESM link 期 SyntaxError = 插件整行加载失败**）。
4. **客户端 `super(ctx,"svc")` 与平台种子表 diff**：种子字集合（0.1.1 → 0.1.7 由 **7 变 9**）+ 全行服务供给表。
- **配套纪律**：
  - **不要按症状猜根因**，先做**三版逐字 diff**（`19-31` 的 validator 误判就是反例）；
  - **rc 换版 ≠ 缺陷已修**：正确闸门是**逐包 diff 缺陷所在包是否真的变了**（无需安装）；
  - **非 canonical 代名对最高代透明**，`MANIFEST.json` 的 `before_sha256` **一律落位前重核**。

### 5.5 manifest / seal / 字节锚
- 分层：`input → before/after → change-sets（新/删/变/不变四集合）→ whitelist → 逐单元 rollback 锚`。
- 旧索引保留为历史，新增 `CURRENT-MANIFEST` 指针并**显式声明「不是新 seal、不是切换授权」**。
- 【本轮实测】U 根 `CURRENT-MANIFEST.json` 字段 `status: "current-static-seal-pointer-not-runtime-release"`、`note: "…does not seal or authorize active cutover."`，seal `393ccfd83e…`，历史 seal `48369877…` 保留。
- **三条哈希口径**：① 落位前必须重算 before，不符即停，**不得直接 `patch`/`cp`**；②「跑着的进程看到的组合」**不是**基线（HMR 已改内存）；③ mtime/size 不足以判未变化。
- **不得伪绿**：`product-final-recheck.pass=false` 应按**获批 delta** 解释，而非造绿。
- **字节锚**：3 件源→U 哈希一致、PPT `d2190648…` 是**唯一获批产品变更**（【本轮实测】U `STATUS.md` 与 `home/.../dsh-pptmaster/lib/client.js` 实测哈希**完全一致**）。

### 5.6 single-writer / 写面纪律
- 每档列**唯一写面表** + **「未写」清单**；审计开工先**钉哈希**，报告写「本档基线哈希」，结论**只对新哈希有效**。
- **「单合同单轮」**：收口后必须 `interrupt` 子档；恢复只用**一条**新指令（上一轮实测有档因积压消息继续写 usage 并起服务，越出收口边界）。
- **`git status` 脏 ≠ 写者冲突**，靠写面清单，不靠脏状态推断。
- 发布用 `fs.link` **独占发布**（非规范代名对最高代透明）；并发用 flock/lease。

### 5.7 【本轮实测·0.2.0 专属】新风险面：遥测链与依赖闭包变化
> 这一节全部是本轨亲自测得，**上一轮材料完全没有覆盖**，请协调者优先派轨道复核。

**(a) 核心包面几乎未变**
| 对比项 | 0.1.7-rc.2 | 0.2.0-rc.1 | 实测结论 |
|---|---|---|---|
| `@deepseek-ai/dsh` `lib/**`（8 个文件含 `bin.js`/`profile-boot.js`/`plugin-*.js`/`types`） | — | — | **逐文件 sha256 全部 SAME** |
| `@deepseek-ai/dsh` `package.json` | 81 deps | 82 deps | 仅 **+`dsh-experimental-schedule-bundle`**；其余 77 项只是版本串升到 `0.2.0-rc.1` |
| `@deepseek-ai/dsh-settings` `lib/**` | — | — | **逐字节相同**（`lib/index.js` 两版同 sha256 `9432b872…`） |
| `@deepseek-ai/dsh-settings` `package.json` | — | — | 仅版本/依赖钉，**schema.d.ts 无差异** |

**(b) 依赖闭包：0.2.0 新增 5 个官方包**
| 新增包 | 作用（按包名/依赖实测） |
|---|---|
| `dsh-otel` | OpenTelemetry 核心，**依赖 `got@^14.6.6` 等一整套 HTTP 栈**（`got`/`cacheable-lookup`/`cacheable-request`/`http2-wrapper`/`http-cache-semantics`/`keyv`/`@keyv`/`decompress-response`/`mimic-response`/`form-data-encoder`/`lowercase-keys`/`byte-counter`） |
| `dsh-host-product-telemetry-otel` | 宿主侧遥测发送器；依赖 `@opentelemetry/{api-logs,otlp-exporter-base,sdk-logs}` |
| `dsh-client-product-analytics` | 客户端侧产品分析 |
| `dsh-client-ui-settings-session-log` | **新增设置页**（session log）——**settings UI 席位面会变** |
| `dsh-experimental-schedule-bundle` | 调度 bundle（也是依赖边层面唯一新增项） |

**（b′）同时有移除项**：`@opentelemetry/exporter-logs-otlp-http` 在 0.1.7 闭包中存在、在 0.2.0 闭包中**消失**（本轨实测 `diff` 确认；与协调者 `MEASURED-BASELINE.md` §3 的"移除"记载**一致**）。
> ⚠️ 方法学自省：本轨最初的闭包 diff **只比对了 `@deepseek-ai` scope 与非 scope 顶层包名**，因此**漏掉了 `@opentelemetry` 等 scope 内的增删**。修正后的做法是**逐 scope 比对**（`diff <(ls node_modules/@scope)`）——这一条本身可作为 0.2.0 依赖 diff 的操作要点。

**(c) 遥测默认值（关键·本轨独有发现）**【本轮实测】
```
dsh-host-product-telemetry-otel/lib/index.js:
  endpoint: z.string().default("https://dsh-otel-collector.deepseeksvc.com/v1/logs")
  channel:  z.string().min(1).default("dsh_otel_report")
  serviceName: z.string().required()      // 无默认
  serviceVersion: z.string().required()   // 无默认
  maxExportBatchSize: 512 / maxQueueSize: 2048 / scheduledDelayMillis: 30000 / …
  注释原文：Mounting alone sends nothing; the owning fiber drains it on unload.
```
- 挂载点：`dsh-web-app` 的 `package.json` 实测引用 `dsh-host-product-telemetry-otel`、`dsh-otel`、`dsh-client-product-analytics`、`dsh-client-ui-settings-session-log`；`dsh-base` 引用 `dsh-otel`。
- **对 0.2.0 迁移的直接含义**：
  1. 「零外呼」不能只靠 `unshare -rn` **阻断**，必须**证明未发起**（否则违反纪律的是「发起」而非「送达」）；
  2. 该插件**无 `enabled/disabled` 开关**（`lib/index.js` 实测 0 命中）⇒ 关闭只能靠**组合层不挂载**或**改写 endpoint**；
  3. `serviceName` / `serviceVersion` 为 **required** ⇒ 组合必须提供，否则是配置面错误；
  4. 卸载（unload）会 drain 队列 ⇒ **停实例的动作本身**是一个潜在外呼时点，验收须覆盖「停止阶段外呼 = 0」。

**（d）与并行轨道的交叉核对**（避免重复与冲突）
- `.workspace/audit-020/reports/MEASURED-BASELINE.md`（协调者硬基线）已登记：`@deepseek-ai/dsh` 的 `lib/**` 在 **0.1.1/0.1.7/0.2.0 三版逐字节相同**（15 文件）、依赖集合新增 5 个 `@deepseek-ai/*` 包 + `got` 栈、移除 `@opentelemetry/exporter-logs-otlp-http`、以及「**55 / 280 个包有真实代码改动**」的 `lib/` churn 表。
- **本轨的结论与之一致**，并在两点上互补：
  1. 本轨额外确认 **`@deepseek-ai/dsh-settings` 整包 `lib/**` 逐字节相同**——这使「settings 语义类历史坑在 0.2.0 仍适用」从推断升级为**字节级机制结论**（§4 第 6/25/26 行）；
  2. 本轨额外发现 **遥测插件的默认远端 endpoint、`serviceName`/`serviceVersion` 必填、无 `enabled` 开关、卸载即 drain**（§5.7(c)）——`MEASURED-BASELINE.md`、`T09-isolated-root-install-path.md`、`T25-isolated-020-boot-attempt.md` **均未登记**（本轨已 grep 确认），属**待协调者裁决的新门禁项**。
- 同时提示：`MEASURED-BASELINE.md` §4 已标出 `dsh-web-search-deepseek` 的 `lib/` churn 为 **75%（最高优先级）**，正与本报告 §4 第 **28** 行「`19-27` 与 `19-49` 的互斥冲突」相交——**0.2.0 迁移前必须先裁决该冲突**。

---

## 6. 上一轮未闭门禁（对 0.2.0 迁移的影响）

> 全部状态：**升级总状态 `NOT READY / STOP` 不变**。以下**不得**包装为通过。

### 6.1 交接件自列的 7 条未核实项（最权威口径）
| # | 未闭项 | 对 0.2.0 的影响 |
|---|---|---|
| U-1 | **统一 U 组合自身 UI 正负例：未执行**（修订驱动就绪未跑；Attempt9 停在 `PRECONDITION: first-use configuration dialog`） | **UI 验收方法学可继承，结论不可继承**。0.2.0 必须重建驱动（上一轮 D1–D9 修复项**全部未执行**），并**先**解决「驱动硬编码中文 vs 英文 UI」的误判类缺陷 |
| U-2 | **A 的引用有效性未通过**（私有副本缺附件对象，分页触发 `ATTACHMENT_NOT_FOUND`） | 0.2.0 迁移若沿用「复制三代日志」的私有副本做法，会**原样复现**。须在计划阶段就裁决「是否复制附件对象」并写成**显式验收项** |
| U-3 | **宿主层 S-4**（`resolveGenerationInDirectory` 按最高代选代、**不校验内容包含**）：机制已证、未修 | **0.2.0 头号前置门**：该函数所在包（`dsh-session`/`dsh-base` 面）在 0.2.0 **全部改版** ⇒ 必须重读源码；若不修，仍需独立「发布前完整性门」 |
| U-4 | 现役 `~/.dsh/settings.yaml` 的**写入者未知**（活值漂移多次观测，不做归因） | 【本轮实测】值仍为 `0f19b0fe…`（与交接件一致）；0.2.0 迁移**必须继续「每轮重取、不据旧哈希写入」** |
| U-5 | **基线采集前的内容缺失不可证明**（用户已接受该边界） | 0.2.0 必须**再次显式接受该边界并写入验收负例**，不得声称全面安全 |
| U-6 | **双面整树 change-detector manifest 未复跑**（只以关键字节代替） | 0.2.0 迁移面更大（依赖闭包 +5 包 + HTTP 栈）⇒ 建议**改为真复跑** |
| U-7 | 逐条目 `fiber.uid` 热载已在另一私有组合验证 7/7，**未在 U 组合复验** | 0.2.0 必须**在新组合内重新验证**；不得跨组合拼接 PASS |

### 6.2 `office-upgrade-*` 系列的 34 条（按组）
- **统一 UI 门（3 条）**：统一 UI 未通过；驱动 D1–D9 修复项未执行；「UI 后续执行已授权 ≠ 验收通过」。
- **A 发布准入（5 条）**：A 维持 `held / NOT READY`；宿主 S-4 是**独立门**；引用边界 `NOT FULL PASS`；P2/P3/P4 部分未完成；7 个新增 system/message id 溯源窄门已闭、**全图同构未证**（候选全部 id 非 100% 落 v0：A 99.5% / B 99.2% / C 90.9%）。
- **P0 三项阻断（1 条，合并口径）**：A 陈旧高代缩水（`Δoutput −614,139`，`v4 == v3`）；usage-v4 未部署；旧会话冷 adopt 的**无损目标**未通过。**机制已验证 ≠ 目标通过**。
- **generation guard 分级（4 条）**：`G-U-6` 帧边界对齐截断仍假通过（真实 A 12.25% 切点）；`G-U-3` 低代坏值 ⇒ 比较失明（语料 0 例但判据未覆盖）；基线采集前缺失不可证明；A `i=329 tool/result` 白名单仍判 **REWORK**。
- **P1 插件/席位面（10 条）**：`F-6` pptmaster `turnTail`；`F-7` taste `React #130`（5 处 `Icon…Outline16`）；`F-8` usage 卡片席位（**候选已回退为私有候选，不得自行在两种槽目标间任选**）；`F-11` entry `usage` 自动配置表**无 UI 承载面**；`A-4c` 越范围修复保留为私有候选未回写；`BL-5` `tsc --noEmit` 级验收不可执行；`BL-6/D-5` `entry.fiber.uid` 口径未统一；`BL-7/B-7` 面向切换的共享/现役部署**未授权**；`BL-8` usage 数据面/统计面部署态验证 **BLOCKED**（F-3 未闭 + 零样本）；`CE4 ≠ 全功能通过`（仍有 2 条席位级 console 错误）。
- **证据/规则面（4 条）**：`R11-b` 已修为**弱实时**（只覆盖已结算 step，非逐 token）；`R11-C` 语料歧义未复现全称断言（btw 实例 UNDETERMINED）；wallpaper `FC-1` 为 latent L2（启动命令未核）；`D9a` 双真源未做、死目录未删。
- **P1/P2 级（5 条）**：现役搜索页/新组合端到端与 **C10** 未跑；V1 客户端 `status` 观测**两口径并存**（引用须指明轮次）；落位 `package.json` 退役 inject 的运行期影响**引用须带时点**；全库代次保全全量复算与 `S-1…S-7/S-9` 未做；**整树 change-detector 未复跑**。
- **治理/程序性（2 条）**：多组裁决项横向挂起（U-A2 / D2 / D5 / D6 / D7 / Q1-Q2）；还原演练旧私有根**未跑 `--force` 正例**，归档脚本**禁止当上线命令**。

### 6.3 其它材料自列的未闭项（摘要）
- `19-36` 系列：**V7 装配等价是当时唯一红灯（参照快照缺失）**，必须在升级前补采；0.1.7 **从未在真环境跑过**（assertServiceable / `DUPLICATE_DIRECTORY` 后果 / 首挂载 `internal/config` 定序均未验证）→【文档断言·`19-36-rollback-and-verification.md`、`19-37-0.1.7-known-bugs.md`】。
- `18-upgrade-compat-matrix.md`：**`dsh-workspace-enhancement@0.1.2` 对 `ctx.ssh` / `rpc.handle` / `directoryPicker` 的依赖未核** ⇒ SSH 远程 workspace 整链「能不能迁都不确定」，是矩阵**唯一整块空白**；另有 **11 个漂移包归属未定** 与 `session-log-deepseek` 隐私面。
- `19-54/55/56/57`：会话线 **U7（隔离实例真正打开产物）未做**、更上一代边（v3→v4）未端到端实跑、全库未复跑；btw 线 **P6 热载端到端与 S1–S6 结构性验收全未验证**、隔离实例端到端未做、**N1–N7 全未关闭**；本地包线「host 修好会拖垮 GUI」**仍是两步推论**。
- `019-41`：本地包三包**都没有 src、只有 lib 产物** ⇒ 改动都是逐行改产物；**vision-adam 的 host 与 client 必须同批修**（只修 host 会把「工具消失」升级成「**整个 Web GUI 起不来**」）。

### 6.4 门禁结论
- 0.2.0 迁移**不得**以「上一轮机制已通过」为由跳过任何一项；所有 `[复核]` 项必须**逐条重跑**。
- 上一轮**未闭门禁不是可继承的豁免**，而是**必须重建的验收项**。

---

## 7. 「0.2.0 迁移必须避免的 10 件事」

1. **不要让「隔离能起、机制能跑」上推为「迁移通过」。** 分层写死五层并禁止上推：隔离/网络硬证据 → 机制 PASS → 目标 PASS → 发布准入 → 切换授权。上一轮最贵的错误就是把单元 PASS 读成数据无损【文档断言·`office-handoff.md` §5.2/§8】。
2. **不要用「最高代」判据，也不要把守卫挂在库态上。** 守卫必须在**发现阶段**、结构上不依赖 `existing.size>0`，并配「恰好一代键集」的反并集闸；空库/新 home 首采要**单独设正负例**。已实测的损失是 `−614,139` output 且 `failed=0` 无痕。
3. **不要在 0.2.0 之前不读源码就沿用 0.1.7 的形状常量。** 具体包括：槽位名与 kind、端点路径与端点段正则、鉴权三态、图标符号集合、客户端 seed 字表、peer 区间、settings 表单基（键 = profile 行 id）、会话代次边界。上一轮**所有**这类常量都是当轮实测得来的，0.2.0 必须重推；**`settings` 包字节相同这一条是好消息，但不构成对其他包的豁免**。
4. **不要对任何 profile 目录执行 `npm/pnpm install`**（仓库级禁令）；也不要裸 `cp -a` 整树当独立组合、不要顺序 `cp` 活跃 db+wal+shm。三者分别对应「补丁全体失效」「链接外逸 / router 之外解析」「不一致快照」三类可复现事故。
5. **不要在未冻结写者时宣布任何哈希判据成立。** 判据必须在 **T_freeze 之后**才有意义；`settings.yaml` 与 `cordis.patch.yml` 是**活值**，每轮重取、带 `sampledAt`，**不得据历史哈希写入**（本轨实测值仅为 2026-09-29 16:44 采样时刻有效）。
6. **不要把测试/驱动缺陷当成产品故障去改产品。** 先证明产品坏，再改产品；上一轮为此付出了 attempt 4→9 的多轮重启代价，且 D1–D9 驱动修复项**至今一项未执行**。
7. **不要在没有「未发起外呼」证据的情况下宣称零外呼。** 0.2.0 新增的 OTEL 遥测链（`dsh-otel` + `got` 栈 + `dsh-host-product-telemetry-otel`）带**默认远端 endpoint**（本轨实测默认值为公开 collector URL），且**卸载即 drain**；`unshare -rn` 只证明「被阻断」，必须另证 `fetch.total = 0` 与停止阶段外呼 = 0。
8. **不要重开已否决项，也不要在两种候选之间自行任选。** 已否决：CDP 恢复在线、只补 turnTail id、`plugins.item` 自动表单、`settingsScope` 改名、taste 一行替换、硬链接影子副本、全局 shim、对 `~/.dsh/profiles` 装包、把 `settings.yaml` 挪走（与 web-search 修复互斥，须**显式裁决**）。候选（如 usage 卡片席位 `settings.section`）是**私有候选**，不得当成已定方案。
9. **不要让单一写面被多于一个写者持有，也不要在收口后继续执行旧指令队列。** 每一档列唯一写面表 + 「未写」清单；审计开工钉哈希；收口即 `interrupt`，恢复只用一条新指令。被审件在复核期间被改 ⇒ 旧哈希结论**整体作废**。
10. **不要把上一轮的未闭门禁当作 0.2.0 的豁免，也不要把它的 PASS 当作 0.2.0 的 PASS。** 具体到 0.2.0 的**首批动作**：① 重跑 peer/semver 判定（本机插件 peer 上界多是 `<0.2.0`，0.2.0-rc.1 落在边界外，上一轮的「全 SAT」**已失效**）；② 重跑「原生是否已具备」列（原生只增不减，`dsh-client-ui-settings-session-log` 等新品会改变重叠面）；③ 先落 `latest` 线观察，再动 `next`；④ 一切绝对计数带采样时刻，判据改用集合 digest。

---

## 8. 引用到的文件清单

> 全部路径前缀 `/home/CNS2026495165/dsh/`。本轨对以下文件**只读**，未做任何修改。

**交接件与裁决（第一权威层）**
- `office-upgrade_NEXT_SESSION_PROMPT.md`（全文，含 §0–§9 + 不编号附录 A/B/C）
- `workbuddy-reverse-proxy/reports/office-upgrade-current-adjudication.md`
- `workbuddy-reverse-proxy/reports/office-upgrade-coordinator-status.md`
- `.dsh/handoffs/office-upgrade_20260928-171539.md`、`.dsh/handoffs/office-upgrade_20260928-182900.md`（归档交接件，仅登记存在）

**兼容矩阵与升级情报**
- `workbuddy-reverse-proxy/reports/18-upgrade-compat-matrix.md`
- `017-native-local-feature-overlap.md`、`017-native-subagent-model-overlap.md`、`017-native-subagent-model-adoption-decision.md`、`017-client-store-replacements.md`
- `19-14-community-upgrade-intel.md`、`19-15-workbuddy-plugin-0.1.7-intel.md`、`19-17-breaking-changes.md`、`19-19-local-plugin-migration.md`、`19-21-workspace-enhancement-compat.md`、`19-23-session-format-migration.md`、`19-24-parallel-home-hardening.md`、`19-27-preserve-settings-yaml.md`、`19-28-settingsforms-mapping.md`、`19-29-preserve-cordis-patch.md`、`19-31-piai-0.1.7-route-compat.md`、`19-33-client-plugin-contract.md`、`19-34-credentials-compat.md`、`19-36-rollback-and-verification.md`、`19-37-0.1.7-known-bugs.md`、`19-38-route-matrix.md`、`19-39-upgrade-smoke-runbook.md`、`19-40-hmr-reload-semantics.md`、`19-41-local-pkgs-vision-taste-board.md`、`19-43-silent-failure-guard.md`、`19-44-npm-prefix-install.md`、`19-45-repo-state-and-staging.md`、`19-46-workbuddy-token-login.md`、`19-47-settings-ui-migration.md`、`19-48-compat-shim-vs-codemod.md`、`19-49-web-search-carryover.md`、`19-50-preset-persona-migration.md`、`19-51-preserve-means-side-effects.md`、`19-52-btw-0.1.7-migration.md`、`19-53-community-preservation-patterns.md`、`19-54-session-migration-remediation-audit.md`、`19-55-session-repair-exec.md`、`19-56-btw-017-exec.md`、`19-57-btw-remaining-audit.md`
- `btw-017-consolidated-units.md`、`btw-017-revision-exec.md`

**升级执行线**
- `upgrade-isolation-followup-audit.md`、`upgrade-isolation-rebuild-exec.md`、`upgrade-integrated-isolation-exec.md`、`upgrade-live-config-preservation-audit.md`、`upgrade-settings-deployment-manifest.md`、`upgrade-endpoint-boundary-verification.md`、`upgrade-auth401-audit.md`、`upgrade-auth401-positive-exec.md`
- `upgrade-generation-preservation-adjudication.md`、`upgrade-generation-preservation-exec.md`、`upgrade-usage-v4-compat-audit.md`、`upgrade-usage-v4-migration-exec.md`、`upgrade-usage-worker-resolution-exec.md`、`upgrade-worker-dependency-audit.md`、`upgrade-worker-fix-exec.md`、`upgrade-worker-resolution-units.md`、`upgrade-subagent-model-exec.md`、`upgrade-subagent-route-preservation-exec.md`、`upgrade-b567-exec.md`、`upgrade-n13-crosscheck.md`、`upgrade-next-isolated-audit.md`、`upgrade-next-isolated-exec.md`、`upgrade-next-exec-brief.md`、`upgrade-ppt-vision-integration-exec.md`、`upgrade-settings-migration-units.md`、`upgrade-settings-tools-exec.md`、`upgrade-wallpaper-settings-exec.md`、`upgrade-wallpaper-coordinator-decision.md`、`upgrade-vision-btw-config-exec.md`、`upgrade-remaining-delivery-units.md`

**办公与 0.2.0 能力审计**
- `20-00-office-capability-decision.md`、`20-01-codex-capability-audit.md`、`20-02-dsh-office-plugin-audit.md`、`20-03-external-workspace-open-audit.md`、`20-04-codex-crosscheck.md`、`20-05-dsh-office-crosscheck.md`

**迁移收口线（`office-upgrade-*`）**
- `office-upgrade-finish-{delivery-audit,driver-crosscheck,onboarding-audit,doc-exec}.md`、`office-upgrade-finish-a-admission-{audit,exec,diagnostic}.md`
- `office-upgrade-a-{id-provenance-audit,v4-readonly-verification,reopen-ui-exec}.md`
- `office-upgrade-unified-assembly-{audit,exec}.md`、`office-upgrade-unified-final-exec.md`、`office-upgrade-u-driver-final-audit.md`、`office-upgrade-u-navigation-root-audit.md`
- `office-upgrade-gates-audit.md`、`office-upgrade-final-coverage-audit.md`、`office-upgrade-r0-audit-20260929.md`
- `office-upgrade-p0-{audit-20260929,b-audit-20260929,exec-20260929,final-repair-audit}.md`、`office-upgrade-p0-generation-guard-{exec,review,supplement}.md`
- `office-upgrade-p1-{contract-crosscheck,current-audit,exec-20260929,final-gates-audit,ppt-positive-exec}.md`、`office-upgrade-p1-render-remediation-{audit,exec}.md`
- `office-upgrade-ppt-ui-navigation-{audit,exec}.md`、`office-upgrade-toolview-remediation-{audit,exec}.md`、`office-upgrade-toolview-runtime-audit.md`
- `office-upgrade-remaining-behavior-{audit,exec}.md`、`office-upgrade-restore-path-guard-exec.md`
- `office-upgrade-doc-sync-{audit,exec}.md`

**文档与工作区制品**
- `docs/program-notebook.md`（§2/§4/§5.3/§5.4/§7/§8/§9）
- `docs/architecture/office-handoff.md`、`docs/architecture/02-plugin-system.md`、`docs/architecture/04-ops-deploy.md`、`docs/architecture/01-architecture-overview.md`、`DOC-STYLE.md`
- `.workspace/audit-020/PLAN.md`（当前主计划）
- `.workspace/audit-020/reports/MEASURED-BASELINE.md`（协调者硬基线，本轨已交叉核对，见 §5.7(d)）
- `.workspace/audit-020/reports/{T09-isolated-root-install-path,T25-isolated-020-boot-attempt,T31-docs-impact-inventory}.md`（并行轨道产物，仅用于交叉核对，**未引用其结论**）
- `.workspace/audit-020/{extracted,pkgs,work}/**`（协调者预置的 0.1.7 / 0.2.0 解包树与依赖闭包，本轨只读）
- `workbuddy-reverse-proxy/_audit/unified-assembly-20260929-121756/{STATUS.md,CURRENT-MANIFEST.json,final-ui-completion-20260929-072952/STATUS.md}`
- `workbuddy-reverse-proxy/_audit/a-admission-20260929-700/STATUS`
- `workbuddy-reverse-proxy/_migration/{usage-v4-017,ppt-017,btw-017,settings-017,web-search-sse-017}/`（仅登记存在）
- `workbuddy-reverse-proxy/proto/generation-preservation/`（`run-a329-attribution.mjs`、`run-p7-restore-drill.mjs`、`lib/expected.mjs` 等，仅登记存在）

**本轨（T10）自身的产物**
- `.workspace/audit-020/reports/T10-prior-migration-lessons.md`（本文件）
- `.workspace/audit-020/t10-notes/N1-upgrade-intel-A.md` … `N10-office-upgrade-J.md`（10 份阅读笔记，逐条带来源文件名）
- `.workspace/audit-020/t10-notes/_x/**`（笔记的分节抽取件，便于复核）

---

## 附 · 本轨本轮实测命令与结果（可复现）

```bash
cd /home/CNS2026495165/dsh
date -Is                                                    # 2026-09-29T16:44:20+08:00
ss -ltn | grep -E ':(3080|3097|3098|3099|3102|3103|9224|9225) '   # 仅 3080、3097 LISTEN
git rev-parse HEAD; git rev-parse --abbrev-ref HEAD          # 651b1712…, main
git status --short | wc -l                                   # 396
node -v; npm -v                                              # v22.23.2 / 10.9.8
sha256sum ~/.dsh/profiles/web/cordis.patch.yml \
          ~/.dsh-017/profiles/web/cordis.patch.yml \
          ~/.dsh/settings.yaml                               # 513413e7… / 61adb8ae… / 0f19b0fe…
sha256sum workbuddy-reverse-proxy/_audit/unified-assembly-20260929-121756/\
home/profiles/node_modules/@local/dsh-pptmaster/lib/client.js
#   d21906483454e92719609d8e03021759cd4b10daf878efe1da8e76dda7ea21d1（与交接件 Runbook 预期完全一致）
#   U CURRENT-MANIFEST.json → seal 393ccfd83edd7f01e3fe777daa2d9c17bc737b6e9bb18b43118d37fe201c8814（一致）
wc -l ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh-017/profiles/web/cordis.patch.yml   # 123 / 635
grep -cE '^- ' ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh-017/profiles/web/cordis.patch.yml
#   20 / 27 个顶层条目；类型分布 4 id + 16 insert（现役）/ 10 id + 17 insert（隔离）
# 0.1.7 vs 0.2.0 包面：.workspace/audit-020/{extracted,pkgs,work}（协调者预置的解包与依赖闭包）
#   @deepseek-ai/dsh lib/** 8 文件 sha256 全 SAME；@deepseek-ai/dsh-settings lib/** 逐字节相同
#   依赖闭包 @deepseek-ai 计数 284(017) → 289(020)，新增 5 包；非 scope 顶层包新增 got/cacheable-*/keyv 等 12 项
#   dsh-host-product-telemetry-otel/lib/index.js: endpoint 默认 https://dsh-otel-collector.deepseeksvc.com/v1/logs
```

**边界声明**：本轨全程只读，未启动任何服务、未发起模型请求、未使用 `sandbox_permissions`、未修改 `.workspace/**` 之外的任何路径；除本文件与 `t10-notes/**` 外无写入。
