# lag-fix-exec：subagent 多开卡顿修复【修订并执行】执行报告

> 阶段：三阶段闭环 · 修订并执行（只改工作区产物，不碰部署位）。路由：adam/deepseek-v4-flash。
> 执行时间：2026-09-12。权威输入：`lag-fix-audit.md`（§7 交付单元 U-1..U-9）、
> `lag-audit-mechanism.md`、`lag-audit-diff.md`、`execution-2b.md`、
> `~/dsh-upgrade-backup/patched-official-files.tgz`（补丁源）、live 全局树（只读参考）、
> `~/.dsh/settings.yaml`（只读参考）。
> 约束遵守：**只写** `.workspace/deploy-lag/` 与本报告；未改 `~/.npm-global` 与 `~/.dsh` 任何文件；
> 未使用 sandbox_permissions（继承会话沙箱，直接写工作区）。

---

## 0. 结论摘要

4 项裁决全部落地为工作区产物，逐单元验证通过（含全流程模拟测试）：

| 裁决 | 交付单元 | 状态 |
|---|---|---|
| ① 恢复 3 个丢失补丁 | U-1 / U-2 / U-3（restore/） | **完成**，与 tgz 字节全等，sha256 与审计良值一致 |
| ② 加固 apiproxy | U-4 / U-5（hardening/ + patches/） | **完成**，订阅 seam（零行为变化）+ FrameQueue 有界化，node --check PASS |
| ③ 重放脚本固化 | U-9（replay-lag-fix.sh + patches/ + known-sha256.txt） | **完成**，bash -n PASS，dry-run/执行/幂等/回滚/重装模拟全流程 PASS |
| ④ settings 990000 | U-6 / U-7 / U-8（settings/） | **完成**，三条断言 pyyaml + node yaml 双解析通过，精确 diff 可 `patch -p0` 应用 |

**单元歧义（如实上报，已按审计口径落地）**：
- U-4「订阅过滤」审计已澄清：纯服务端改动无法降帧（mux downlink-only、RPC 与 WS 无连接令牌、
  无客户端兴趣信号源），本单元落地为「订阅集合 seam + 过滤（订阅=全量，行为零变化）」；
  真实降帧由 U-1（②b 恢复）+ U-5 承担。按审计 §7 U-4 备注照做，未自行扩展协议级改动。
- U-7「追加」按字面 = opencode-go.models 列表**末尾**追加（grok-4.5 之后、adam 之前），
  与 pyyaml `models.append()` 行为一致；审计 §3.2 的示例片段为条目格式参照。
- U-8 与已产出 `.workspace/deploy/settings-vision-adam.snippet.yaml` 合并：新 lib 默认
  `DEFAULT_MAX_TOKENS=2000` 不动、settings 显式 `maxTokens: 2000` 优先，二者相等无冲突。

---

## 1. 产物清单（全部在 /home/CNS2026495165/dsh/.workspace/deploy-lag/ 下）

| 路径 | 说明 | 字节 |
|---|---|---|
| `restore/agent-loop.lib.index.js` | U-1 ②b 非流式补丁完整文件（tgz `dsh-agent-loop/lib/index.js` 原样） | 48,119 |
| `restore/client-ui-subagent.client.js` | U-2 tok/s 显示补丁完整文件（tgz `dsh-client-ui-subagent/lib/client.js`） | 42,608 |
| `restore/web-search-deepseek.index.js` | U-3 x-opencode-session 补丁完整文件（tgz `dsh-web-search-deepseek/lib/index.js`） | 13,746 |
| `hardening/host-apiproxy.lib.index.js` | U-4+U-5 加固后 apiproxy 完整文件（live 原厂 + 6 hunk 精确改动） | 211,588 |
| `hardening/hardening-changes.md` | 加固改法说明（原厂/加固双行号锚点 + 改动前后片段 + 语义 + 验证表） | — |
| `settings/settings-lag-fix.snippet.yaml` | settings 修改片段（含注释）：U-6/U-7/U-8 最终形态 | — |
| `settings/settings.yaml.diff` | 精确 unified diff（`patch -p0` 可直接应用，锚点 = 当前 settings.yaml） | — |
| `patches/dsh-host-apiproxy.u4.patch` | U-4 订阅 seam patch（5 hunk，相对路径，`patch -p0` 于 $ROOT 应用） | — |
| `patches/dsh-host-apiproxy.u5.patch` | U-5 有界化 patch（2 hunk，同上） | — |
| `known-sha256.txt` | 3 补丁已知 sha256（审计良值）+ 加固文件参考 sha256 | — |
| `replay-lag-fix.sh` | U-9 重放脚本（chmod +x；run / --dry-run / --rollback / --help） | 15,963 |

部署位（live 全局树与 `~/.dsh/settings.yaml`）**未改动**，由主代理部署期应用本产物或运行重放脚本。

---

## 2. 逐单元状态与验证结果

### U-1 恢复 dsh-agent-loop ②b 非流式补丁 —— 完成
- 产物：`restore/agent-loop.lib.index.js`；合并方式 = tgz 解包 cp（审计推荐方式）。
- 与 tgz 字节全等（`cmp` PASS）；sha256 = `b20d42dc…c53e6` == 审计良值。
- 与 live 原厂 diff = **恰 2 hunk**，与 execution-2b.md L6-15 逐字一致：
  L611 后 `isSubagent` 判定 + L621 `if (!isSubagent)` 门控（`assembler.push(chunk)` 在外）。
- `node --check` PASS；`grep -n isSubagent` = 2 命中。

### U-2 恢复 dsh-client-ui-subagent tok/s 补丁 —— 完成
- 产物：`restore/client-ui-subagent.client.js`；与 tgz 字节全等；sha256 = `ac7cbb97…1a04` == 良值。
- 与 live 原厂 diff = 4 hunk，与审计 patch（`.workspace/tmp-tgz-audit/dsh-client-ui-subagent.patch`）
  的 +/- 行**逐字节一致**（`formatTokensPerSecond`/`decodeTokensPerSecond` 定义 +
  lineage metrics 接线 + `SubagentReadOnlyComposer` speed 显示）。
- `node --check` PASS；`grep formatTokensPerSecond|decodeTokensPerSecond` = 2 命中。

### U-3 恢复 dsh-web-search-deepseek x-opencode-session 补丁 —— 完成
- 产物：`restore/web-search-deepseek.index.js`；与 tgz 字节全等；sha256 = `9e48db07…79c` == 良值。
- 与 live 原厂 diff = 1 hunk：`"user-agent": USER_AGENT,` 后加 `"x-opencode-session": crypto.randomUUID()`。
- `node --check` PASS；`grep x-opencode-session` = 1 命中。

### U-4 apiproxy mux 会话级订阅过滤（seam，零行为变化）—— 完成
- 产物：`hardening/host-apiproxy.lib.index.js`（含 U-4+U-5 全部改动）+ `patches/dsh-host-apiproxy.u4.patch`。
- 改动 5 处，严格按审计 §7 U-4 精确改法：
  1. mux() `const queue = new FrameQueue();` 后加 `const subscribed = /* @__PURE__ */ new Set();`（原厂 L3525→副本 L3530）
  2. `subscribeSession(queue, subscribed, session)` 签名 + 函数体 baseline 帧前 `subscribed.add(session.id);`（原厂 L1158→副本 L1161）
  3. 连接时全量订阅调用点传参（原厂 L3527→副本 L3532）
  4. `session/event` 监听器首行 `if (!subscribed.has(session.id)) return;`（原厂 L3556→副本 L3562，openCalls 处理之前）
  5. `session/created` 订阅调用点传参（原厂 L3577→副本 L3583）
- 行为：连接时订阅全部 live 会话 + 新会话自动订阅 → 过滤恒真 → 与现状完全一致（零降帧、零破坏）；
  为将来客户端驱动订阅留 seam。**不降帧**——按审计结论由 U-1+U-5 承担真实降帧。
- `node --check` PASS；`grep subscribed.has(session.id)` = 1；`subscribeSession(queue, subscribed, session)` = 2。

### U-5 apiproxy FrameQueue 有界化 —— 完成
- 改动 2 处，严格按审计 §2.2 精确改法：
  1. FrameQueue 类注释前加模块级常量（原厂 L1094 前→副本 L1095）：
     `/** SSE 帧队列上限：溢出丢最旧帧保 UI 响应（仅在消费者积压时触发）。 */\nconst MAX_QUEUED_FRAMES = 4096;`
  2. `push()` 溢出丢最旧帧（原厂 L1099-1103→副本 L1101-1107）：
     `if (this.buffer.length >= MAX_QUEUED_FRAMES) this.buffer.shift();` 后再 `this.buffer.push(item);`
- 语义：正常流量 buffer≈0 零丢弃；仅消费者积压 ≥4096 帧时封顶内存、丢最旧帧、新帧优先；
  丢帧只影响实时推送、会话日志（真相源）不受影响。mux/host 两流共用该类均封顶。
- `node --check` PASS；`grep MAX_QUEUED_FRAMES` = 2（定义+使用）。
- **改动边界**：`diff -u live 加固副本` = 恰 6 hunk，全部落在审计指定函数
  （FrameQueue / subscribeSession / mux）；同名监听器 L1840（session/projection 广播）
  与 host() 的 FrameQueue 实例（L3610）未改动。

### U-6/U-7/U-8 settings 修改 —— 完成
- 产物：`settings/settings-lag-fix.snippet.yaml`（含注释的完整新段）+ `settings/settings.yaml.diff`（精确 diff）。
- U-6：`llm-pi-ai.providers.adam.models[deepseek-v4-flash].maxTokens` 786432 → **990000**（当前 L80，全文件唯一）。
- U-7：opencode-go.models **末尾追加** `deepseek-v4.1-flash` 条目
  （name=DeepSeek V4.1 Flash / contextWindow=1000000 / maxTokens=990000）；同族 v4-flash 的 384000 不改。
- U-8：`vision-adam` 段整体替换为 snippet 4 键段：
  model=deepseek-v4.1-flash / baseURL=https://opencode.ai/zen/go/v1 / apiKeyEnv=OPENCODE_GO_API_KEY /
  maxTokens=2000（lib 默认 2000 不动、settings 优先，二者相等无冲突）。
- 验证：`settings.yaml.diff` 对原厂 `patch -p0` 应用后三条断言全过；pyyaml 结构化改写
  （脚本内嵌实现）+ 写回后重解析断言全过；node `yaml` 包双解析全过；
  3 个 snippet 片段分别 `yaml.safe_load` 解析通过（值正确）。

### U-9 重放脚本 —— 完成
- 产物：`replay-lag-fix.sh`（chmod 755，bash -n PASS）+ `patches/` + `known-sha256.txt`。
- 规格符合审计 §4：模式 run / --dry-run（只打印 + 全前置校验，零写入）/ --rollback（最新备份还原）/
  --help（含 Runbook）；每单元独立幂等（已应用 → SKIP）；每单元 备份 → 应用 → 校验；
  应用失败即 FAIL 并退出非零（不回滚，人工介入或 --rollback）。
- 目标路径常量：`ROOT=${DSH_ROOT:-…全局树}` / `TGZ=${PATCH_TGZ:-~/dsh-upgrade-backup/…tgz}` /
  `SETTINGS=${SETTINGS_FILE:-~/.dsh/settings.yaml}` / `LAG_BACKUP_DIR`（测试可覆盖）。
- U-1..U-3：tgz 解包 → sha256 与 known-sha256.txt 比对（防损坏/被换）→ cp 覆盖 → node --check + 锚点。
- U-4/U-5：`patch --batch -p0 --dry-run` 预检（未命中即中止提示重新锚定）→ 应用 → 锚点 + node --check。
- U-6..U-8：python3 pyyaml 结构化改写（解析失败即中止未写回）→ 写回后解析断言。

---

## 3. 脚本全流程模拟测试记录（fake root，不碰部署位）

以 `DSH_ROOT=tmp/fakeroot`（4 包 live 原厂副本）+ `SETTINGS_FILE=tmp/fakesettings/settings.yaml` +
`LAG_BACKUP_DIR=tmp/fakebackup` 全流程实测：

| 场景 | 结果 |
|---|---|
| `--dry-run`（干净态） | 打印全部步骤 + 前置校验通过；**零写入**（backup 目录未创建、文件未变） |
| 首次执行（干净态） | 备份 → 8 单元全 PASS，exit 0；fake live 4 文件与 restore/hardening 产物**字节全等** |
| 二次执行（已应用） | 「全部单元均已应用，无操作。」exit 0（幂等） |
| 部分应用（仅 U-1 已打） | U-1 SKIP，其余单元应用 + 验证全 PASS |
| `--rollback` | 还原 4 包 + settings.yaml，与原厂**字节全等** |
| 无备份 rollback | 提示未找到备份，exit 1 |
| 重装模拟（恢复原厂后再跑） | 全 PASS（重装再抹补丁后可重跑恢复） |
| `bash -n` | PASS |

---

## 4. 验证命令清单（全部在工作区产物上执行）

| 验证 | 命令 | 结果 |
|---|---|---|
| 语法 | `node --check` × 4（3 restore + 1 hardening） | 全 PASS |
| 字节一致 | `cmp` restore/×3 vs tgz 解包；`cmp` patch 组合 vs hardening | 全等 |
| sha256 | `sha256sum` vs known-sha256.txt（审计良值） | 3/3 一致 |
| 锚点 | isSubagent×2 / tok/s×2 / x-opencode-session×1 / MAX_QUEUED_FRAMES×2 / subscribed.has×1 | 全命中 |
| 改动边界 | `diff -u live 加固副本` | 恰 6 hunk，仅审计指定函数 |
| patch 预检 | `patch --batch -p0 --dry-run` u4/u5 vs 原厂；两种应用顺序产物与 hardening 字节全等 | CLEAN MERGE ×2 |
| yaml 解析 | pyyaml + node yaml：U-6 adam=990000、U-7 v4.1-flash=990000、U-8 vision-adam 四键 | 双解析全过 |
| diff 应用 | `patch -p0 < settings.yaml.diff` → 断言 | 通过 |
| 脚本语法 | `bash -n replay-lag-fix.sh` | PASS |

---

## 5. 遗留问题 / 未确认项（沿用审计 §9，未在本阶段消解）

1. **部署期生效**：agent-loop / host-apiproxy / settings 均需**重启 DSH** 生效（非热载）；
   ui-subagent 客户端补丁刷新浏览器即生效。settings.yaml 有 chokidar watch（大概率热载），仍建议随重启统一生效。
2. **adam 网关对 max_tokens=990000 的服务端硬上限未确认**（0.99M < contextWindow 1M 自洽；若网关拒绝会请求报错，裁决已定 990000，照做）。
3. **U-4 降帧预期修正**：订阅过滤为 seam（零降帧），降帧由 U-1（②b 恢复）+ U-5 承担；
   按「可见会话」过滤需协议级改动（dsh-client-connection 放宽 downlink-only + mux 订阅信封 +
   客户端上报可见会话集），列为后续项。
4. **FrameQueue 丢帧的客户端表现未确认**：丢帧仅影响实时推送，会话日志完整；浏览器缺帧可刷新/历史回拉补齐。
5. **应答帧（approval/question）是否需「永不被丢」守卫**：U-5 溢出策略的额外决策，留用户裁决（审计 §6-3）。
6. **vision-adam 插件当前 disabled**（cordis.patch.yml），settings 段写入后的即时生效边界取决于
   btw-upgrade 线的 lib 部署与插件启用（本修复只写 settings 段）。
7. **运行时验收未做**：重启后派 subagent 观测「0 条 assistant/chunk、1 条 assistant/message、
   主会话打字机照常」需部署期执行（execution-2b.md L33-44 Runbook 已固化进脚本 --help）。
8. **重装再抹风险**：任何 `npm i -g @deepseek-ai/dsh…` 会再次抹掉 4 个被改包；tgz 与脚本均在
   全局树外，重装后重跑 `replay-lag-fix.sh` 即恢复（脚本已实测重装模拟）。

---

## 6. 约束与边界声明

- 本阶段**未改动** `~/.npm-global` 与 `~/.dsh` 任何文件（只读参考 live 原厂与 settings.yaml）；
  部署位改动由主代理部署期按本产物应用。
- 未使用 `sandbox_permissions`；仅写 `.workspace/deploy-lag/`（产物）与 `.workspace/lag-fix-exec.md`（本报告）。
- 未做设计决策、未扩范围；审计明确判定的修正（U-4 seam 语义、U-7 追加位置、U-8 合并方式）按审计口径落地并在 §0 如实上报。
