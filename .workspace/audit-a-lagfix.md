# audit-a-lagfix.md — 卡顿修复与官方补丁完整性 · 独立交叉审计（审计阶段）

- 审计档：adam/deepseek-v4-flash（两阶段闭环·阶段 1 审计）
- 方式：**只读**；以真实部署盘面与全局树为准，不信任何执行报告；证据 = 文件:行号 / 命令输出
- 审计时间：2026-09-15（settings.yaml mtime 10:25；live DSH 进程 PID 1669657 于 10:38 启动）
- 全局树：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
- 结论：**PASS（6/6 项通过；3 条低危观察，无阻断问题）**

---

## 1. ②b 非流式（dsh-agent-loop）— ✅ PASS

文件：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`

| 锚点 | 位置 | 证据 |
|---|---|---|
| isSubagent 判定 | L612 | `const isSubagent = (this.options.subagentDepth ?? 0) > 0 \|\| (this.session.header?.delegationDepth ?? 0) > 0;`（grep 命中 2 处，见下） |
| chunk append 条件化 | L622 | `if (!isSubagent) chunkSeqs.push(this.session.append("assistant/chunk", {...}).seq);`；`assembler.push(chunk)` 在 if 之外（L627），最终 `assistant/message`（L674-682）不受影响 |
| node --check | — | `node --check` → NODE_CHECK_OK |
| 与 execution-2b.md 语义一致 | — | 与备份 diff 仅 2 处，逐字等于 execution-2b.md L8/L12 记载代码；子代理不逐 chunk 落盘、一轮结束写 1 条 message，主会话/btw 仍流式（判定 `(a>0)||(b>0)`，depth=0 时逐 chunk） |

**补丁面量化**：与 deploy-lag 两份补丁前备份（backup-20260912-160759 / 160832）diff，仅 2 行：

```
+		const isSubagent = (this.options.subagentDepth ?? 0) > 0 || (this.session.header?.delegationDepth ?? 0) > 0;   (L612)
-		chunkSeqs.push(this.session.append("assistant/chunk", {
+		if (!isSubagent) chunkSeqs.push(this.session.append("assistant/chunk", {                                             (L622)
```

无其它改动。锚点计数：`grep -c isSubagent` = **2**（≥2 ✅）。

**运行时解析（无本地遮蔽）**：
- `~/.dsh/profiles/web/node_modules` **不存在**（ls 报 no such file）；`~/.dsh/profiles/web/node_modules/@deepseek-ai` 不存在；`web/.dsh-module-fallback/node_modules` 为空目录。
- `cd ~/.dsh/profiles/web && require.resolve('@deepseek-ai/dsh-agent-loop')` → `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`（**全局打补丁副本**）。
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-loop` = 符号链接 → 全局（`ls -ld` 确认）；该层 @deepseek-ai 共 249 个符号链接、仅 5 个真实目录（dsh-session-board / dsh-taste / dsh-vision-adam 等本地插件，均非 5 个补丁包）。
- live 进程：`node /home/CNS2026495165/.npm-global/bin/dsh web`（PID 1669657，今日 10:38 启动）；补丁文件 mtime 2026-09-12 16:08 < 进程启动 → **运行进程装载的即打补丁代码**。
- live 字节 = tgz 交付字节（sha256 `b20d42dc…` 与 known-sha256.txt 一致）。

**⚠️ 观察 L-1（低危）**：`~/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-agent-loop` 为**真实目录、未打补丁（isSubagent=0）**，且 web2 整包版本不同（`"@deepseek-ai/dsh": "0.1.5-rc.2"`，全局为 0.1.1-rc.2；245 个真实目录非符号链接）。web2 为 9月11 遗留的全量安装 profile，**非当前活动 profile**（live 进程用 web；web/cordis.yml mtime 与进程启动同时 10:38），故当前无遮蔽；若未来启用 web2 profile 则整套补丁缺失。建议归档或删除 web2。

## 2. apiproxy 加固（dsh-host-apiproxy）— ✅ PASS

文件：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`（同目录 `index.js.orig` = 加固后/btw 前基线）

| 锚点 | 位置 | 证据 |
|---|---|---|
| FrameQueue MAX_QUEUED_FRAMES | L1095（定义 `const MAX_QUEUED_FRAMES = 4096;`）/ L1108（push 溢出判断） | `grep -c MAX_QUEUED_FRAMES` = **2**（≥2 ✅） |
| isAnswerableFrame 应答帧守卫 | L1097-1102（定义，approval/question 四型）/ L1111-1116（push 溢出只丢普通帧、应答帧不丢） | `grep -c isAnswerableFrame` = **3**（定义+2 使用） |
| mux 订阅过滤 | L3581 `if (!subscribed.has(session.id)) return;`（session/event 监听器首行） | u4 全接缝在场：L1174-1175 `subscribeSession(queue, subscribed, session)` + `subscribed.add`；L3549 `const subscribed = new Set()`；L3551 全量订阅传参；L3602 session/created 订阅传参 |
| `session/prompt-image-transform` waterfall（btw 官方补丁） | L2771 `const transformed = await ctx.waterfall("session/prompt-image-transform", { agent, content }, () => void 0);` | 语义与官方补丁逐字一致：`effective` 变换 → `nowHasImage` 门禁 → `durablePromptContent(ctx, effective)`（官方补丁在 `.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch`，与 live 逐字比对一致） |
| node --check | — | NODE_CHECK_OK |

**补丁分层验证**：
- `diff index.js.orig(16:08) vs live(16:59)` = 仅 8 行，正是 btw sessions-prompt-transform 补丁（.orig 已含 u4/u5/u5b：三锚点均在 .orig 中命中）。
- `.workspace/deploy-lag/hardening/host-apiproxy.lib.index.js`（加固副本）与 live **diff 0 行**（完全一致）。
- 范围界定（hardening-changes.md）：L1840 同名监听器与 L3610 host() 的 FrameQueue 实例不改（共用 FrameQueue 类自动获得有界化）——与审计规格一致，非缺陷。

**⚠️ 观察 L-2（低危）**：replay-lag-fix.sh 只重放 u4/u5/u5b 三个 patch，**不覆盖 btw sessions-prompt-transform 补丁**；若 apiproxy 被还原到官方版（如重装全局树）后仅跑 replay，该补丁会丢失。btw 补丁另有独立应用文档 `.workspace/deploy/patches/APPLY.md`（含备份/应用/验证 runbook），但 replay 未并入（见第 5 项）。

## 3. 其余补丁 — ✅ PASS

| 包 | 锚点 | 位置 | 证据 |
|---|---|---|---|
| dsh-client-ui-subagent | tok/s | lib/client.js L273、L717 `formatTokensPerSecond(tps) tok/s` | `grep -cE 'formatTokensPerSecond\|decodeTokensPerSecond'` = **5**（≥2 ✅）；node --check OK；live sha `ac7cbb97…` = tgz/known |
| dsh-web-search-deepseek | x-opencode-session | lib/index.js L141 `"x-opencode-session": crypto.randomUUID()` | 命中 1；node --check OK；live sha `9e48db07…` = tgz/known |
| dsh-subagent | materializeContinuableChild | lib/index.js L1199（完整实现：locks.run→activate→authorizeLineage→descriptor.mode==="continuable"→materialize）、L2524/L2525（requireContinuations 委托）；lib/types/index.d.ts L151 声明 | js **3** / d.ts **1**（与 verify_p0 断言 3/1 吻合）；node --check OK |

**sha 与 deploy-p0 交付一致**：
- live `lib/index.js` sha256 `64088a4be6f84f1e5c803f9848899cd8cba7b38537d5fb9aa523fbead8c467b5` == `.workspace/deploy-p0/dsh-subagent.lib.index.js` ✅
- live `lib/types/index.d.ts` sha256 `36c832b62a710be8a0574ad918bd2e2f983a792962fe8351d70c83cbc713adf9` == `dsh-subagent.lib.types.index.d.ts` ✅
- `dsh-subagent.materialize.patch` hunks（+75 行 impl / +17 行委托 / d.ts +1 方法）与 live 代码吻合。

## 4. settings token 上限 + vision-adam + llm-pi-ai 可服务性 — ✅ PASS

文件：`~/.dsh/settings.yaml`（mtime 2026-09-15 10:25）

| 项 | 位置 | 证据 |
|---|---|---|
| adam deepseek-v4-flash | L78-80 | `- id: deepseek-v4-flash` / `contextWindow: 1000000` / `maxTokens: 990000` ✅（注：L21-24 的 384000 版本属于 opencode-go 路由，非同条目，正常） |
| vision-adam | L135-139 | `model: deepseek-v4.1-flash` / `baseURL: https://opencode.ai/zen/go/v1` / `apiKeyEnv: OPENCODE_GO_API_KEY` / `maxTokens: 393216` ✅ |
| agent-default-model | L132-134 | provider adam / model deepseek-v4-flash（与 990000 条目同段） |
| llm-pi-ai 可服务性 | — | 用 `.workspace/diag-piai-route.mjs`（复刻 dsh-llm-pi-ai resolveRouteModels L607-641 / assertServiceable L979，默认值 262144/32768 与源码 L940-941 一致）核**当前** settings 快照（由现网 YAML 现生成 /tmp/settings-now.json）：`[OK] opencode-go (catalog=true, models=16)`、`[OK] adam (catalog=false, models=46, routeApi=openai-completions)`，**exit 0 = 全部 route 可服务** ✅ |

## 5. 重放脚本覆盖（replay-lag-fix.sh）— ✅ PASS（含 2 条观察）

文件：`.workspace/deploy-lag/replay-lag-fix.sh`（418 行，mtime 09-14 10:38）

| 要求 | 证据 |
|---|---|
| 覆盖 4 包 + dsh-subagent | U-1..U-3（L371-376：agent-loop / client-ui-subagent / web-search-deepseek，tgz+sha256+cp）、U-4/5/5b（L384-386：host-apiproxy，patch dry-run 预检+应用）、P0（L392：dsh-subagent，deploy-p0 patch）、U-6/7/8（L398：settings pyyaml） |
| 备份单元 | `backup_all`（L147-161）：5 包整目录 `cp -r` + settings.yaml → `backup-<时间戳>/`；仅当任一单元需应用时执行（L349-368） |
| 应用单元 | `restore_unit`（tgz 内 sha256 与 known-sha256.txt 比对后 cp）；`patch_unit`（--dry-run 未命中即中止）；`patch_subagent`；`apply_settings`（改完写回后 settings_check 断言） |
| 校验单元 | `verify_u1/u2/u3/u45/p0/settings`（L284-314）：node --check + 锚点计数（isSubagent≥2、tok/s≥2、MAX_QUEUED_FRAMES≥2、materialize 3/1、settings 三断言）——**与本次审计实测计数逐一吻合**（2/5/2/3/1、3/1） |
| 回滚单元 | `--rollback`（L319-339）：取最新 `backup-*` 还原 5 包 + settings.yaml，提示重启 DSH |
| bash -n | BASH_N_OK ✅ |
| --dry-run 对 live 树判定 | 实测 `./replay-lag-fix.sh --dry-run` → 前置校验通过 → **"全部单元均已应用，无操作"**，exit 0（**SKIP 判定正确**）✅ |

**⚠️ 观察 L-2（同第 2 项，低危）**：脚本不重放 btw sessions-prompt-transform 补丁（host-apiproxy 还原到官方后重放会丢失该补丁）。
**⚠️ 观察 L-3（低危，文档漂移）**：execution-2b.md L23/L27-30 回滚 runbook 引用 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-agent-loop.orig-20260908/`，该目录已不存在（web profile 现无 node_modules）；当前有效回滚路径 = deploy-lag `backup-20260912-160759/160832`（实测为补丁前基线：agent-loop isSubagent=0、apiproxy 加固锚点=0）+ `replay-lag-fix.sh --rollback`。

## 6. 无遮蔽核验 — ✅ PASS

- `ls ~/.dsh/profiles/web/node_modules/@deepseek-ai` → **不存在**（该路径整个 node_modules 不存在）。
- `~/.dsh/profiles/web/node_modules` → 不存在（无任何依赖，更无官方包遮蔽）。
- `~/.dsh/profiles/web/.dsh-module-fallback/node_modules` → 空目录。
- `~/.dsh/profiles/node_modules/@deepseek-ai/`：5 个补丁相关包（agent-loop / host-apiproxy / client-ui-subagent / web-search-deepseek / subagent）全部为**符号链接 → 全局打补丁副本**；5 个真实目录均为本地/非官方插件（dsh-session-board、dsh-taste、dsh-vision-adam）。
- web profile package.json：deps 仅 cordis-plugin-group / dsh（^0.1.1-rc.2）/ ssh2（非官方），bundles = dsh-base + dsh-web-app。
- 另：`/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-agent-loop` = 符号链接 → profiles → 全局（打补丁）✅。

---

## 问题清单（按严重度）

| # | 严重度 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| L-1 | 低 | web2 profile 含**未打补丁**的真实 dsh-agent-loop（isSubagent=0）且版本体系不同（0.1.5-rc.2 vs 全局 0.1.1-rc.2，245 真实目录） | `grep -c isSubagent ~/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js` = 0；web2/package.json | 非活动 profile，当前无影响；建议归档/删除 web2，防止误启用后整套补丁缺失 |
| L-2 | 低 | replay-lag-fix.sh 不重放 btw `session/prompt-image-transform` 补丁（仅 u4/u5/u5b）；apiproxy 还原官方版后重放会丢该补丁 | 脚本 L384-386 无 prompt-image-transform 引用；补丁仅存在于 `.workspace/deploy/patches/` | 将 btw 补丁并入 replay（或至少在 verify_u45 增加锚点检查并在 APPLY.md 显式标注重放顺序） |
| L-3 | 低 | execution-2b.md 回滚 runbook 引用已不存在的 `.orig-20260908` 目录（文档漂移） | `find ~/.dsh /home/CNS2026495165/dsh -name '*agent-loop.orig*'` 无结果；web profile 无 node_modules | 更新 execution-2b.md 回滚段指向 deploy-lag 备份 + replay --rollback |

## 裁决

**PASS**：6/6 审计项通过。所有补丁（②b 非流式、apiproxy u4/u5/u5b+btw、tok/s、x-opencode-session、materializeContinuableChild、settings 上限、llm-pi-ai 路由）均在**全局 live 树**真实在场且与交付规格逐字节/逐行一致；运行时解析无本地遮蔽；replay 脚本幂等判定正确（--dry-run 对 live 树 SKIP）；3 条低危观察不阻断。无需返工。
