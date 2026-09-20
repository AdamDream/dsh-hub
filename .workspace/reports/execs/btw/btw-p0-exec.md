# btw「子代理会话无法打开」P0 修订执行复核报告（路线 a）

- 路由：adam/deepseek-v4-flash ｜ 阶段：修订执行复核一体 ｜ 诊断：`../btw-open-p0-diagnosis.md` ④
- 裁决：打开不要求 parent 当前 live，**存在即可**；路线 a——官方 dsh-subagent 增加「仅 materialize、不投递模型轮」的公开方法，btw host 冷恢复持久化子代理 parent 时调用。
- **自裁决：PASS（通过）**。问题清单（非阻塞，见 §6）。

---

## 1. 改动文件与行号

### 1.1 btw 侧（源码，仅 1 处判定 + 支持性辅助）

| 文件 | 位置 | 内容 |
|---|---|---|
| `dsh-btw/src/host/side-chat-service.ts` | :130-138 | `SubagentsLike` 增补 `materializeContinuableChild?(parent, childId, options)` 结构类型 |
| 同上 | :142-145 | 新增 `SessionRecordLike` 结构类型（corpus 记录：id/cwd/origin/parentSession） |
| 同上 | :163-170 | 新增模块级 `findSessionRecord()`（按 id 找 corpus 记录） |
| 同上 | :594-601 | **核心改动**：live 门（原 :571-573 `agents.get` + `parent-not-found`）→ 先查 live，否则 `recoverParent()` 冷恢复；`undefined`（会话不存在）→ `parent-not-found`「The parent conversation does not exist.」；`{error}`（存在但恢复失败）→ 同码 + 细分文案 |
| 同上 | :677-726 | 新增 `recoverParent()`：① live→现路径；② 子代理（`header.origin==='subagent'`）→ 沿 `header.parentSession` **递归**恢复直接父后调 `subagents.materializeContinuableChild(directParent, id, {signal})`（`seen` 防环）；③ 普通会话→`agents.resume({resumeSessionId, signal})`（官方 dsh-api-remotes 先例形态）；④ corpus 不可用/无记录→`undefined` 或明确错误（**不做盲 resume**，防绕过子代理所有权语义） |
| 同上 | :728-734 | 新增 `corpusRecord()`：经 `sessionQuery.listSessions()`（btw 既有注入，listProject 同源）读存在性 + origin |

未动：`btw-registry.ts`、`src/client/*`、`src/shared/remote.ts`（错误码 schema 不变）、`locales.ts`（drawer 标题保留通用「btw 无法打开」，细分文案在 host 错误 message，Surface `<p>` 展示）。

### 1.2 官方 dsh-subagent 补丁（交付于 `.workspace/deploy-p0/`，未改 live 安装）

| 产物 | 说明 |
|---|---|
| `deploy-p0/dsh-subagent.materialize.patch` | unified diff（`patch -p0` 于 `@deepseek-ai` 根应用；含 lib/index.js + lib/types/index.d.ts） |
| `deploy-p0/dsh-subagent.lib.index.js` | 补丁后完整文件副本（sha256 `64088a4b…67b5`） |
| `deploy-p0/dsh-subagent.lib.types.index.d.ts` | 补丁后完整文件副本（sha256 `36c832b6…adf9`） |
| `deploy-p0/APPLY-P0.md` | 备份/应用/验证/回滚/重启实测手册 |

补丁内容（对 `lib/index.js`）：
- `SubagentContinuationManager` 新增 `materializeContinuableChild(parent, childId, options)`：`locks.run(childId)` 串行 → 已 live 返回现 Agent（`authorizeLineage` 复核）；否则照 `coldResume` 同序 inspect → `throwIfAborted` → `assertAdmitting` → `authorizeLineage` → `foldSubagentDescriptor`（非 continuable 抛 `NOT_RESUMABLE`）→ `materialize({..., parked: true})` → **不 submit**，返回 `activation.handle.agent`。
- `materializeTracked` 末尾：`if (inputs.parked !== true) this.watchSettlement(activation);` —— parked 激活不被 settlement watcher 自动回收（**驻留**至 manager drain / 父离开注册表）。
- `SubagentRuntime` 新增同名公开方法委托 `requireContinuations()`；`lib/types/index.d.ts` 增补方法声明（`options: { readonly signal?: AbortSignal }`）。

### 1.3 测试

`dsh-btw/tests/host-recovery.spec.ts`（新增，7 例）：live parent 现路径零咨询 / 冷普通 resume / 冷子代理 materialize（mock 断言父=main、id=sub，无模型轮）/ 双层冷链递归顺序 / 会话不存在报错 / materialize 运行时补丁缺失提示 / resume 失败提示。mock：`agents.get/create/resume`、`subagents.materializeContinuableChild`、`sessionQuery.listSessions`。

### 1.4 重放脚本

`deploy-lag/replay-lag-fix.sh`：新增 **P0 单元**——`SUBAGENT_JS/TYPES`、`P0_PATCH`（默认 `../deploy-p0/dsh-subagent.materialize.patch`，可覆盖）、`p0_applied()` 双文件锚点（幂等 SKIP）、`patch_subagent()`（dry-run 预检→应用）、`verify_p0()`（node --check + 锚点 JS=3/d.ts=1）；`backup_all` 与 `--rollback` 循环纳入 `dsh-subagent` 包；`needs_apply` 纳入；`--dry-run` 实测通过。

## 2. 测试摘要

- 新增：`host-recovery.spec.ts` 7 例全过。
- 全量（dsh-btw）：**22 文件 / 193 passed / 2 skipped**（2 skip 为 `sign-contract.spec.ts` 既有，与本次无关）；既有 `host-opening.spec.ts` 10 例未回归。

## 3. 全量验证（dsh-btw，二进制直跑）

| 项 | 结果 |
|---|---|
| `oxlint src tests tsdown.config.ts vitest.config.ts` | 0 warnings / 0 errors |
| `tsc -p tsconfig.json` / `tsconfig.client.json` / `tsconfig.tests.json` | 通过 |
| `vitest run` | 193 passed / 2 skipped（22 文件） |
| `tsdown` | Build complete（lib 含新逻辑：`recoverParent`/`materializeContinuableChild` 锚点） |
| `scripts/smoke-build.mjs` | ok（断言数不变） |
| `publint --level error` | **All good!**（以 `--pack npm` + `npm_config_cache=/tmp/publint-npm-cache` 运行，见 §6-1） |

官方补丁静态验证：`node --check` 通过；锚点 `materializeContinuableChild` JS×3 / d.ts×1 / `inputs.parked`×1；以**原始安装文件 + patch -p0 fresh 应用**的产物与交付副本逐字节 `cmp` 一致。

## 4. 自复核（对照诊断④与裁决）

| 诊断④ / 裁决项 | 状态 |
|---|---|
| ④.1 live parent → 现路径零改动 | ✓ 短路实现；既有 10 例 + 新「untouched」例覆盖 |
| ④.2 冷普通会话 → `agents.resume` 冷恢复（官方先例） | ✓ |
| ④.3 冷子代理 → 新 dsh-subagent materialize 方法（路线 a） | ✓ 含冷链递归；不投递模型轮 |
| ④.4 会话不存在才抛错、文案区分 | ✓ `does not exist` vs `could not be recovered: <detail>`；错误码保留 |
| 主会话路径零回归 | ✓ 22 文件全绿 |
| registry / client / 路由未动 | ✓ diff 确认 |
| 错误语义保留/细化 | ✓（locales.ts:69 标题保留通用，host message 细分） |
| 附带（可选）：listEntries live 字段 / locale 文案 | 未做（非必须）——见 §6-5 |

## 5. 部署注意点

1. **官方补丁**：`cd ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai && patch --batch -p0 < /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.materialize.patch`（先 dry-run；备份/校验/回滚见 APPLY-P0.md §1/§4/§6）。**未应用前**，btw 对冷子代理返回「materializeContinuableChild runtime patch is not applied」明确错误（有测试覆盖）。
2. **btw lib 拷贝**：`dsh-btw/lib/`（已重建）全量拷入 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`（先删旧 `remote-*` 存量）；**需重启 DSH** 生效。重启后实测：跳转列表/侧聊打开冷子代理成功（首次触发一次 parent 冷 materialize，不跑模型轮，parent 驻留）。
3. **replay 脚本**：`replay-lag-fix.sh` 已纳入 P0 单元（备份含 dsh-subagent / 应用 dry-run 预检 / 锚点校验 / `--rollback` 覆盖 / `P0_PATCH` 可覆盖）；全局树重装后重跑可恢复本补丁 + 全部 lag 补丁。
4. **语义约定**：`materializeContinuableChild(parent, childId, options)` 要求 `parent` 为精确 **live 直接父**（与 `followup`/`coldResume` 同一授权线 `authorizeLineage`）。

## 6. 问题清单（客观描述，非阻塞，供主 agent 知悉）

1. **publint 环境 workaround**：本环境 `pnpm` 损坏（`pnpm --version` 即 `unable to open database file`，与 btw 无关），且 `~/.npm` 在沙箱只读（EROFS）。故以 `--pack npm` + `npm_config_cache=/tmp/publint-npm-cache` 复验，结果 "All good!"（level error）。部署侧若 pnpm 正常可直接 `publint --level error`。
2. **冷普通会话 parent 的工具组合限制**：路线 a 的子代理 materialize 经 `applyChildComposition`（composeFrom 父组合）完整恢复工具；冷**普通**顶层会话走裸 `agents.resume`（未复制 host-apiproxy 的 composeAgent/preset 挂载——避免范围扩张与 preset id 语义偏差），若部署 read-only 工具均按 per-agent preset 组合，该分支的 btw 子聊 read-only 工具可能为空（Q&A 可用）。属诊断④.2 未指定细节的已知边界。
3. **parked 子代理行为变化**：被 btw materialize 的子代理本次进程内驻留；其后正常 send_message 可执行，但完成时不再向主会话发 settlement 通知（通知随激活自动回收发出；parked 不自动回收）。符合诊断④「恢复的 parent 会驻留」预期，记录为行为变化。
4. **存在性判定依赖 `sessionQuery.listSessions`**：sessionQuery 不可用时返回「session corpus is unavailable」错误，不做盲 resume（防子代理 id 被普通 resume 绕过所有权造成双 Activation）。
5. **locales.ts:69 未改**：drawer.error 标题保留通用「btw 无法打开」，细分靠 host message（SideChatSurface `<p>` 展示）；如需标题级区分可后续再加 key。
