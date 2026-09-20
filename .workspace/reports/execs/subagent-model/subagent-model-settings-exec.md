# subagent-model-settings-exec — subagent 默认模型 settings 层 + 设置页 GUI 修订执行复核一体报告

- 档位：修订执行复核一体（route adam/deepseek-v4.1-flash），同档完成修改 + 端到端实测 + 自复核。
- 审计契约：`.workspace/subagent-model-gui-audit.md`（§2.3 读取层选点、§3 四件套、§5 P0'/P0）；先例：P0-b（settings 命名空间 + settingsScope 客户端读法）、deploy-vision-settings（四件套）、P0-a（热载边界）。
- 约束遵守：未改 dsh-btw；改动前备份 `~/.dsh/backups/`（dsh-tool-subagent.index.js.bak-20260917-165928、cordis.patch.yml.bak-20260917-165928、settings.yaml.bak-20260917-165928）+ `.workspace/backup-subagent-model-20260917-165928/`；未使用 sandbox_permissions。

---

## 1. 交付单元完成情况

### 单元 1（P0'，核心包 settings 默认层）— **完成，已部署，端到端实测通过**

改动：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js`
- 新增模块级函数 `effectiveConfiguredAgentOptions(runtimeCtx, configured)`（L107-137）：读 `runtimeCtx.get("settings")?.get("dsh-subagent")`，provider/model 非空字符串则逐字段覆写 preset `config.agentOptions`（**settings 优先、preset 兜底**）；settings 服务缺失 / 命名空间未注册 / `get` 抛错 → 原样返回 `configured`（= 现状静态路由，不报错）。
- execute（L525-536）在 `requestedAgentOptions` 合并前插入该层：`effectiveAgentOptions` 替代 `config.agentOptions` 参与 `requiresRoutePreflight` 判定与合并——settings 提供的路由同样走每次派发的 `preflightChildLlmRoute` 实时校验（非法值抛清晰错误，审计 §2.5 风险面覆盖）。
- diff：`.workspace/deploy-subagent-model/dsh-tool-subagent.p0.diff`（46 行，仅 2 处 hunk）；部署位 sha256 与 `dsh-tool-subagent.index.js.patched` 一致。

### 单元 2（settings 命名空间 `dsh-subagent`）— **完成，已部署**

新 host 插件 `@local/dsh-subagent-model/lib/index.js`：
- `NS = settingsNamespace("dsh-subagent")`；`Config = z.object({ provider: z.string(), model: z.string() })`（schemastery 对象键天然可选；实测 `z.string().optional()` 在 schemastery 不存在，已修正——无 `.default()`，默认值由 composition base 承载）。
- `installSettingsSection(ctx, NS, Config, { ...DEFAULT_ROUTE, ...config }, hooks)`，`DEFAULT_ROUTE = {provider: "adam", model: "deepseek-v4.1-flash"}` = 现 preset 固定路由。无段解析实测 = `{provider: adam, model: deepseek-v4.1-flash}`。

### 单元 3（P0 GUI 设置页「子代理模型」）— **完成，已按审计裁决走 @local seam 完整接线**

四件套（照 vision-adam 先例）全部落盘，位置 = **新增包** `~/.dsh/profiles/node_modules/@local/dsh-subagent-model/`（**非官方包内**，依据审计 §3.2/§5「全部走 @local/cordis 可插拔 seam，不 fork 核心包」；官方包仅承担单元 1 的 dispatch 读取层）：

| 件 | 文件 | 状态 |
|---|---|---|
| host `installSettingsSection` | `lib/index.js`（注册 `dsh-subagent` 命名空间） | ✅ 部署 |
| 客户端 bundle | `lib/client.js`（settings.section「子代理模型」，id `@local/dsh-subagent-model`，order 70=未占用；provider/model 下拉取自 `llm-pi-ai` 命名空间 settings（同事实源、热），不可用退化为文本输入；保存走 settingsScope `set/unset` → 原子写 settings.yaml；清空/缺失回退默认） | ✅ 部署 |
| package.json `dsh.client` 声明 | `package.json`：`{"platform":"web","inject":["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-settings"]}` + `exports["./client"]` | ✅ 部署 |
| 注入 | `~/.dsh/profiles/web/cordis.patch.yml` 末尾 insert `{id: dsh-subagent-model, name: '@local/dsh-subagent-model'}`（备份已留） | ✅ 部署 |

> **关于「官方包 lib/ 下无 client 产物」的说明**：单元 3 不要求在官方包内放 client —— 审计 §3.2「部署：cordis.patch.yml insert + package.json dsh.client 声明。全部走 @local/cordis 可插拔 seam，不 fork 核心包」；官方包 `dsh-tool-subagent` 未挂载任何客户端 bundle，其 package.json 未改动（无新增 dsh.client 声明、无需额外备份）。GUI 载体 = 新 @local 包，重启后 client-modules 扫描其 dsh.client 拾取 bundle（冷面，见 §3）。

客户端 bundle 验证：`smoke-client.mjs` PASS（ModuleLoader 注册形状、apply 双命名空间绑定 dsh-subagent+llm-pi-ai、section 注册 order 70/label「子代理模型」、默认态文本输入回退渲染、目录态 2 个 select 渲染含 deepseek-v4.1-flash/glm-5.3 选项与生效行）。**GUI 无法截图**（本会话无浏览器自动化），由主代理/用户在设置页目视核验；渲染级验证已覆盖两态。

**部署缺口补齐核验（主代理 2026-09-17 补录）**：部署位 `lib/` 曾缺失 host 侧 `index.js`（仅 client.js，而 package.json `main`/`exports["."]` 指向 `lib/index.js`，重启必加载失败）；主代理已从本档产物补齐。本档复核（命令与输出见 §2）：
- `lib/index.js` sha256 `e93de18da406…` == `.workspace/deploy-subagent-model/lib/index.js`（逐字节一致）✅
- `lib/client.js` sha256 `5f16927be1db…` == 产物 ✅
- `node --check` 两者通过 ✅
- 从插件目录 `import('./lib/index.js')` 冒烟通过：导出 `apply/inject/name/Config/DEFAULT_ROUTE/NS`，`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-settings` 解析正常 ✅

### 单元 4（端到端实测）— **完成，真实派发，双向证据**

载体：第二实例 `dsh --profile web --port 8091 --no-open`（新代码全量装载，与运行实例 3080 隔离；共享 ~/.dsh home）。全程未重启，settings 改动即时生效。证据（原始抽取存 `evidence/`）：

1. **覆写方向**：settings.yaml 追加 `dsh-subagent: {provider: adam, model: glm-5.3}` → `settings.describe` resolved 立即变 `{adam, glm-5.3}`（revision 0→1，无重启）→ `session.create`+`session.prompt` 真实派发 subagent（parent 会话 tool/call 记录 name=subagent, args 含 "e2e model check"）→ 子代理会话 `subagent/descriptor` **`agentProvider: adam, agentModel: glm-5.3`**、`request/header config: {provider: adam, model: glm-5.3}`、`assistant/message source: {provider: adam, model: glm-5.3}`（子代理实际在 glm-5.3 上跑并回复「子代理就绪」）。
2. **回退方向**：移除该段（settings.yaml 复原）→ resolved 立即回退 `{adam, deepseek-v4.1-flash}`（revision 2）→ 再次真实派发（"e2e fallback check"）→ 子代理 `subagent/descriptor` **`agentModel: deepseek-v4.1-flash`**、`request/header`/`assistant source` 均 `deepseek-v4.1-flash`。
3. **GUI 写路径（settings.mutate）**：set provider+model → ok revision 3，settings.yaml 实盘出现该段；unset 两键 → ok revision 4，resolved 回退默认（= GUI 保存/恢复默认走的是同一条 RPC，客户端 bundle 的 scope.set/unset 即此）。
4. 测试实例已停（8091 无监听）、4 个测试会话目录已清理、settings.yaml 与测试前基线逐字节一致。

---

## 2. 验证清单（全绿）

```text
node --check dsh-tool-subagent/lib/index.js                    ✅（部署位，补丁后）
node --check @local/dsh-subagent-model/lib/index.js             ✅
node --check @local/dsh-subagent-model/lib/client.js            ✅
node --check .workspace/deploy-subagent-model/{lib/index.js,lib/client.js} ✅
node --check smoke-client.mjs 之外：smoke-client.mjs 实跑 PASS
package.json JSON 解析 ✅；cordis.patch.yml insert 片段 YAML 解析 ✅
settings 写→读回环：settings.yaml 手改 / settings.mutate 写 / mutate unset —— 4 次 describe 观测全对上（evidence/describe-observations.txt）
部署位与 workspace 副本 sha 一致；diff 46 行仅 2 hunk
```

## 3. 自复核表 + 自裁决

| 检查项 | 结果 |
|---|---|
| 单元 1 语义：settings 优先 / preset 兜底 / 读失败降级不报错 | ✅ 代码逐分支核对；E2E 覆写+回退双向实证 |
| 单元 2 schema 可选键 + 默认值=现路由 | ✅ 无段解析=adam/deepseek-v4.1-flash（describe base/value 实证） |
| 单元 3 四件套齐备、order 70 未占用、不碰官方包 | ✅ @local seam，diff/清单见 §1 |
| 热载边界：settings 值级热载（P0-b 机制） | ✅ 无重启，describe revision 1/2/3/4 连续推进 |
| 冷面清单 | ① 官方包 lib/index.js（宿主代码）② 新 @local 包宿主装载 ③ 新包 `dsh.client` 声明（client-modules pkgMeta）→ **需重启 web 一次**，重启后全链路热 |
| 未越界：dsh-btw 未碰；备份在位；测试残留已清 | ✅ |
| 客户端 GUI 目视核验 | ⚠️ 未截图（无浏览器自动化），渲染级 smoke 已过；由主代理/用户重启后目视验收 |

**自裁决：PASS**（单元 1/2/3/4 全部完成；唯一待办 = 主代理部署重启一次 + 设置页目视核验）。

## 4. 遗留问题 / 上报

1. **需重启一次**（依据：宿主 lib 代码冷面（P0-a 实测）+ 新插件宿主装载 + 新包 dsh.client 声明（pkgMeta 缓存））。重启后：settings.yaml `dsh-subagent` 段/设置页改动即热生效，无需再重启。
2. **运行实例 3080 未热挂载新插件**（graph 无 `@local/dsh-subagent-model` 条目；插入条目下次启动随 profile 装载生效，无害）。3080 当前仍是旧 dispatch 代码（无 settings 层），期间行为 = 现状。
3. **GUI 目视验收待办**：重启后进设置页确认「子代理模型」页（order 70）出现、改 model 保存后 settings.yaml `dsh-subagent` 段出现、清空后该键消失。
4. **AGENTS.md 建议补充一行**（主代理统一改，本档未直接改 AGENTS.md）：
   > subagent 默认模型可在设置页 / `~/.dsh/settings.yaml` 的 `dsh-subagent` 段调整（provider/model，可选），修改即热生效（默认 = preset 固定路由 adam/deepseek-v4.1-flash）。
5. 非阻塞：`dsh-subagent: {}` 空段与无段解析等价（均回退默认）；设置页「恢复默认」会写成空段属预期。

## 5. 产出索引

- 部署位改动：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js`（补丁）、`~/.dsh/profiles/node_modules/@local/dsh-subagent-model/`（新包）、`~/.dsh/profiles/web/cordis.patch.yml`（insert）
- 交付副本：`.workspace/deploy-subagent-model/`（diff、patched 全文、包三件、smoke-client.mjs、README、settings.example.yaml、evidence/ 原始证据）
- 备份：`~/.dsh/backups/` + `.workspace/backup-subagent-model-20260917-165928/`
