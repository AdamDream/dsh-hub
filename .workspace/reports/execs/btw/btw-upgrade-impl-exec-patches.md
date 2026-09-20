# btw 插件升级 v2 — 修订并执行：部署产物档 执行报告

> 执行档子代理（adam/deepseek-v4-flash），工作区写盘，**未改动 `~/.dsh` 任何文件、未使用 sandbox_permissions**。
> 依据：`.workspace/btw-upgrade-impl-audit.md`（U-H / U-G-2 / §8 部署步骤，本线权威）、`.workspace/btw-upgrade-plan.md`（R1-4/R1-5/R1-9）、`.workspace/opencode-deepseek-v4-flash-probe.md`。
> 范围：三阶段闭环「修订并执行」档的**部署产物部分**（vision-adam 新 lib、官方包 patch、settings 段、报告）。btw 内实现（U-A..U-N、U-G-1）不在本档，由其他执行线落地。
> 执行时间：2026-09-12。

---

## 1. 产物清单（全部在 /home/CNS2026495165/dsh/.workspace/deploy/ 下）

| # | 产物 | 路径 | 说明 |
|---|---|---|---|
| 1 | vision-adam 配置化新 lib | `.workspace/deploy/vision-adam/lib/index.js` | 替换 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`（部署期备份后替换；**注意 §5 风险 R-A 的双副本问题**） |
| 2 | 变更说明 | `.workspace/deploy/vision-adam/CHANGES.md` | 逐条变更 + 兼容性 + 已知风险 |
| 3 | 官方包 patch（unified diff） | `.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch` | 目标 `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`；`patch -p1` 可逆应用 |
| 4 | 应用后完整文件副本 | `.workspace/deploy/patches/dsh-host-apiproxy.lib.index.js` | 5561 行；与原文件 md5 不同、与 patch 应用结果字节一致 |
| 5 | patch 应用说明 | `.workspace/deploy/patches/APPLY.md` | 备份/应用/验证/回滚步骤 + 行为验收 |
| 6 | settings.yaml vision-adam 段最终形态 | `.workspace/deploy/settings-vision-adam.snippet.yaml` | 含注释、兼容旧键；yaml.safe_load 解析通过 |
| 7 | 本报告 | `.workspace/btw-upgrade-impl-exec-patches.md` | 产物 + 规格对应 + 验证 + 风险 |

## 2. 与审计规格的逐条对应

### 2.1 U-H（vision-adam 新 lib）— `.workspace/deploy/vision-adam/lib/index.js`

| 审计 U-H 规格 | 落地 | 验证 |
|---|---|---|
| Config 新增 `xApiKey: z.boolean().default(true)`、`sessionHeader: z.boolean().default(true)` | ✓ 已加 | schemastery roundtrip：`{}`→默认 true；`{xApiKey:false}`→false；`{xApiKey:'yes'}`→ValidationError 拒绝 |
| `apiKeyEnv` 默认 → `OPENCODE_GO_API_KEY` | ✓ | `resolveOptions({})` 实测返回 |
| `baseURL` 默认 → `https://opencode.ai/zen/go/v1` | ✓ | 同上 |
| `model` 默认 → `deepseek-v4.1-flash` | ✓ | 同上 |
| `maxTokens` 默认 → 2000 | ✓ | 同上（stub fetch 实测请求体 `max_tokens: 2000`） |
| 请求头 = authorization Bearer +（xApiKey && x-api-key）+（sessionHeader && x-opencode-session 随机 UUID）+ content-type + user-agent | ✓ | stub fetch 实测三头齐全、UUID 格式正确；`{xApiKey:false,sessionHeader:false}` → 仅剩 authorization/content-type/user-agent |
| 图片格式 / `reasoning_content` 回退 / maxBytes / maxVideoBytes / 错误语义保留 | ✓ | 图片仍 `image_url` data URL；stub 实测空 content 回退 `reasoning_content`（trim）；maxBytes/maxVideoBytes 原值保留；错误抛普通 Error 含网关 detail |
| 新增导出 `analyzeImageBytes(opts, apiKey, mediaType, base64, question, signal)` / `resolveOptions(config)` / `resolveApiKey(opts, ctx, signal)` | ✓ | 加载实测 16 项导出齐全（含 `Config/VISION_ADAM_SETTINGS_NAMESPACE/IMAGE_TYPES/VIDEO_TYPES/DEFAULT_* /apply/inject/name`） |
| `node:` 内置与 `@deepseek-ai/*` imports 不变 | ✓ | imports 与基线一致 + 新增 `node:crypto` randomUUID（Node 内置，部署位可解析） |
| `analyze_image` 工具注册保留（行为不变） | ✓ | 名称/描述/参数/output/render 逐字节同基线；execute 复用 `resolveOptions/resolveApiKey/analyzeImageBytes` |
| `apply/inject/name` 不变 | ✓ | `name='vision-adam'`、`inject=['tools','fs','systemPrompt']` |
| 验收 1：node --check（或加载）通过 | ✓ | `node --check`（ESM 模式）+ `vm.SourceTextModule` 双通过；web 依赖上下文真实加载成功 |
| 验收 3：旧 settings 形态（只配 model/maxTokens）不报错 | ✓ | `resolveOptions({model, maxTokens})` 显式优先、其余回落新默认（加载实测） |
| 验收 2/4（真实 API 冒烟、GUI 工具可用） | 部署期 | 见 §5 R-A（加载环境存在阻塞风险） |

### 2.2 U-G-2（官方包 patch）— `.workspace/deploy/patches/`

审计判定 U-G = btw 内实现 handler（U-G-1，本档不做）+ **官方包最小 patch（U-G-2，本档产出）**，非「btw 内实现即跳过」——故 patch 产物已产出。

- 目标：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`（已确认存在，211564 字节；profiles 根 farm `dsh-host-apiproxy → web`，web2/node_modules 无该包）。
- 改法（审计 §3.1 精确落地，`admit()` 内 try 块开头）：
  - 插入 `let effective = content; if (hasImage) { … await ctx.waterfall("session/prompt-image-transform", {agent, content}, () => void 0); … }`；
  - `const nowHasImage = effective.some((part) => part.type === "image");`
  - 门禁 `if (hasImage) {` → `if (nowHasImage) {`（唯一锚点 :2752）；`durablePromptContent(ctx, content)` → `durablePromptContent(ctx, effective)`（唯一调用点 :2762）。
  - 变换瀑布置于 admit 的 try 内 → 变换抛错落入原 catch → `agent-busy` + details.reason（U-G-2 验收 4）。
  - 无监听时 fallback 返回 undefined → effective===content、nowHasImage===hasImage → 行为与现状逐字节等价（U-G-2 验收 2）。
- 产物：unified diff（hunk `@@ -2749,7 +2749,13 @@` + `@@ -2759,7 +2765,7 @@`，`a/lib/index.js`/`b/lib/index.js` 头，`patch -p1` 直接可用）+ 应用后完整副本。
- 验证：`patch -p1 --dry-run` 通过 → 实应用 → 结果与交付副本 **cmp 字节一致**；`ctx.waterfall` 存在性已核（cordis 混入 `waterfall`，cordis lib/index.js:317-331；dsh-agent 同机制调度 `agent/request`，dsh-agent :287-306/:361-363）；监听器形参 `(payload, next)` 与 btw 端 `ctx.on` handler 兼容。
- 验收 1（备份可逆）：备份命令在 APPLY.md §备份；diff 由原文件与应用后副本生成，可逆。

### 2.3 settings 段（审计 §8 步骤 5 / plan §F）— `.workspace/deploy/settings-vision-adam.snippet.yaml`

- `model: deepseek-v4.1-flash`、`baseURL: https://opencode.ai/zen/go/v1`、`apiKeyEnv: OPENCODE_GO_API_KEY`、`maxTokens: 2000`（保留可调），注释给出可选 `xApiKey/sessionHeader/apiKey/maxBytes/maxVideoBytes` 及旧键兼容说明。
- 兼容旧键：旧 `{model, maxTokens}` 显式值优先（插件 Config 默认值兜底）；`yaml.safe_load` 解析通过。

## 3. 验证结果汇总

| 验证项 | 命令/方式 | 结果 |
|---|---|---|
| 新 lib ESM 语法 | `node --check`（temp package.json type=module） | 通过 |
| 新 lib ESM 深解析 | `node --experimental-vm-modules` `vm.SourceTextModule` | 通过（不执行、不解析依赖） |
| 新 lib 真实加载 | 模拟部署位（web 依赖上下文）`import('@deepseek-ai/dsh-vision-adam')` | 成功，16 项导出齐全 |
| 新 lib 默认值 | `resolveOptions({})` | `{apiKeyEnv:'OPENCODE_GO_API_KEY', baseURL:'https://opencode.ai/zen/go/v1', model:'deepseek-v4.1-flash', maxTokens:2000, maxBytes:20971520, maxVideoBytes:52428800, xApiKey:true, sessionHeader:true}` |
| 新 lib 请求构造 | stub `globalThis.fetch` 捕获请求 | url/三头/UUID/model/max_tokens/image_url/reasoning 回退/开关路径 全对 |
| schemastery boolean default | `z.boolean().default(true)` roundtrip | 默认应用/显式覆盖/类型拒绝均正确 |
| patch 可应用性 | `patch -p1 --dry-run` + 实应用 | 通过；应用结果与交付副本字节一致 |
| patch 目标锚点唯一性 | grep | `if (hasImage) {` 仅 1 处、`durablePromptContent(ctx, content),` 调用点仅 1 处 |
| snippet YAML | `yaml.safe_load` | 通过，键值精确 |
| 约束 | 全程 | 只写 `.workspace/deploy/` 与报告；`~/.dsh` 零改动；未使用 sandbox_permissions |

## 4. 部署步骤（主代理执行，对照审计 §8）

```bash
# 1) 备份
mkdir -p ~/.dsh/backups
cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js ~/.dsh/backups/vision-adam.index.js.$(date +%s).bak
cp ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js ~/.dsh/backups/dsh-host-apiproxy.index.js.$(date +%s).bak

# 2) 替换 vision-adam（见 §5 R-A：确认运行副本后再替换对应位置；默认按审计目标 profiles 根）
cp .workspace/deploy/vision-adam/lib/index.js ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js

# 3) 应用 patch（或按 APPLY.md 方式 B 放完整副本）
cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy && patch -p1 < ~/dsh/.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch

# 4) settings.yaml vision-adam 段替换为 .workspace/deploy/settings-vision-adam.snippet.yaml 内容

# 5) 重启 + 验收 6.4.a-f（btw 内实现落地后）
npx @deepseek-ai/dsh web
```

## 5. 已知风险与上报项（如实标注，含证据）

### R-A（部署阻塞级，需审计/主代理裁决）— vision-adam 存在双副本，且 profiles 根副本在 btw 运行时上下文**当前加载失败**

证据链（均实测）：
1. `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam`（真实目录，8月28，审计 U-H 替换目标）在裸 node 下导入**失败**：`The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'`。
2. 根因：profiles 根 farm `dsh-settings → web2`（0.1.5-rc.2），web2 的 dsh-settings 只导出 `SettingsConflictError, SettingsProvider, default, redactSecrets`（grep 零命中 `installSettingsSection`）；web profile 的 dsh-settings 才导出（:618 定义、:638 导出）。
3. **审计 §2.3 只验证了「路径可解析」（`require.resolve` 命中），未验证「实际加载」**；本档补验后 §2.3 的「模块顶层依赖齐备」结论**不成立**（对加载而言）。
4. 从 btw 运行时位置（`profiles/node_modules/@local/dsh-btw/lib`）导入 `@deepseek-ai/dsh-vision-adam`（= farm 根副本）→ **同样失败**。即 U-I 的运行时复用入口在当前布局下会炸。
5. 另有一份副本 `~/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-vision-adam`（9月11，**不同构建**：不 import dsh-settings/settings 集成，裸 node 加载成功，exports=Config,VISION_ADAM_SETTINGS_NAMESPACE,apply,inject,name）。web profile node_modules **无** vision-adam。两个 profile 的 cordis.patch.yml 都 `insert vision-adam`；web2 的 patch 配置 9月12 12:50 更新（今日），web 的 9月11 10:09。
6. 新 lib 保持 `@deepseek-ai/*` imports 不变（审计 U-H 第 4 条），加载行为与现状副本同构：在 dsh-settings 解析到 web 副本（导出 installSettingsSection）的上下文（web 依赖树）**加载成功**（本档实测）；在解析到 web2 副本的上下文（profiles 根 farm / web2 依赖树）**加载失败**。

影响与建议（部署期必须处理，超出本档产物范围）：
- 确认运行进程实际加载的 vision-adam 副本与 btw 运行时 import 的解析路径（审计 §9.1/9.7 未确认项落地）。
- 若运行/btw 上下文解析 dsh-settings → web2：需部署期修正（三选一，主代理/审计裁决）——(a) 将 profiles 根 farm `dsh-settings` 改指 web 副本（`ln -sfn ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-settings ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings`）；(b) 把新 lib 同时部署到 web2/node_modules 对应位置并另行处理其 dsh-settings 解析；(c) 审计澄清 U-H 是否允许弱化 dsh-settings 依赖（如 settings 段缺失时跳过注册）。**当前部署位原副本同样无法加载** → 验收 6.4.f「analyze_image 工具仍可用」在当前环境可能本就为否，需部署期一并修复。

### R-B（兼容点）
- 现有调用方 = `analyze_image` 工具：注册名/描述/参数/output/render 逐字节不变，execute 内部复用新函数（行为不变）。
- 旧 settings `{model, maxTokens}` 有效；新增导出不影响旧导出；`resolveOptions` 签名由 `(ctx, config)` 改为 `(config)`（ctx 原未使用，仅内部调用点受影响）。
- 若部署仍走 adam 网关（自配 baseURL）：显式 `xApiKey: false, sessionHeader: false`（审计 §9.6 未确认项，adam 忽略未知头为通用行为但未单独实测）。

### R-C（与审计未确认清单对齐）
- 视频 `video_url` 经 opencode 网关未实测（probe 仅图片）；默认配置下视频分析失败属预期外，报错透传网关消息。
- 主会话变换失败时 `agent-busy`+details.reason 的 GUI 展示细节未验证（审计 §9.4，人工验收 6.4.c）。
- 子代理会话直发图片（`subagents.prompt` 门禁）不在 R1-3 范围（审计 §9.8），未处理。

### R-D（patch 目标侧）
- patch 目标按审计 §3.1/§8 定稿为 **web** 的 host-apiproxy（farm `dsh-host-apiproxy → web` 已 readlink 确认；web2/node_modules 无 host-apiproxy，web2 场景下经 farm 解析到 web 文件 → 目标仍成立）。原文件 md5 `a1bae6036a18c928614d3c410cdc57ac` 已记录，便于部署期核对基线。

## 6. 结论

- 审计判定 U-G 需官方包 patch → **已产出**（非跳过）；U-H 新 lib、settings 段、执行报告全部落盘。
- 产物语法/加载（web 依赖上下文）/请求构造（stub）/默认值/patch 可应用性全部验证通过。
- **R-A 为部署阻塞级环境问题**（双副本 + farm dsh-settings→web2 缺导出，当前副本加载失败），本档如实上报，需部署期确认运行副本并修正解析后再应用 U-H 产物；patch 与 settings 段不受 R-A 影响。
