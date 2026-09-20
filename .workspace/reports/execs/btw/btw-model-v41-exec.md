# btw 侧边对话默认模型切换 deepseek-v4-flash → deepseek-v4.1-flash：修订执行复核一体报告（2026-09-17）

阶段：修订执行复核一体（route: adam/deepseek-v4.1-flash）。同一档内完成：按交付单元逐条落地 + 兼容性实测 + 全量验证 + 部署 + 自复核。
目标：dsh-btw 侧边对话（btw）默认模型从 `deepseek-v4-flash` 换成 `deepseek-v4.1-flash`（provider 恒为 `adam`），保留抽屉内模型选择 UI。
约束遵守：只改 `dsh-btw/`（源码/测试/README/构建产物）与部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw/`；未触碰 dsh-tool-subagent / vision-adam / FEATURE-MAP.md；未使用 sandbox_permissions；pnpm/npm 未执行（无网，全直调 node_modules 二进制）。

---

## 1. 交付单元落地清单（逐条）

### 单元 1：模型标识统一替换 ✅
| 文件 | 改动 |
|---|---|
| `src/shared/remote.ts:13-18` | `btwModelSchema = z.enum(['deepseek-v4.1-flash', 'glm-5.3', 'deepseek-v4-pro'])`；注释说明替换与 legacy 处理 |
| `src/host/side-chat-service.ts:74-95` | `BTW_MODELS = ['deepseek-v4.1-flash', 'glm-5.3', 'deepseek-v4-pro']`；`DEFAULT_BTW_MODEL = 'deepseek-v4.1-flash'`；新增 `BTW_LEGACY_MODEL_MAP`（`deepseek-v4-flash` → `deepseek-v4.1-flash`）；`sanitizeBtwModel` 改为「枚举直通 → legacy 映射 → 默认」三级解析并 `export`（供测试直接断言） |
| `src/client/SideChatSurface.tsx:449,457-459` | select 默认值 `state.model ?? 'deepseek-v4.1-flash'`；option 列表 = `deepseek-v4.1-flash` / `glm-5.3` / `deepseek-v4-pro` |

**关于是否保留旧 v4-flash 的决定（按"替换"语义）：不保留。** 旧标识从 schema 枚举与抽屉选项列表全部移除（它不再是可路由模型）；既有会话持久化的旧值由 host 侧 legacy 映射承接（见单元 2）。`BTW_PROVIDER = 'adam'` 未动。

### 单元 2：向后兼容（必须处理并实测）✅
旧值落点与处理路径（全链路排查）：
1. **每会话持久化的旧值 = 子会话 request header 的 `config.model`**（`~/.dsh/` 下子会话 log 头；btw index.json 不存模型）。resume 时 `installBtwModelSelection` 的 `get current` 读 `requestHeader()?.config` → `sanitizeBtwModel(logged.model)` → legacy 映射 → `deepseek-v4.1-flash`。**不崩、不白屏，直接落到替换模型（即默认值）**。
2. **wire schema 永不携带旧值**：host 所有发射出口（`startValue`、`transcript`）都先过 `sanitizeBtwModel`；typert strict 校验（`readSideChatResultSchema` / `startSideChatResultSchema` / `setSideChatModelRequestSchema`）因此不可能因旧值 reject。客户端 `state.model` 只收 host 清洗后的值；select 兜底默认也已是 v4.1-flash。
3. **混合版本（旧 host + 新 client）**：旧 host 若发射旧值会被新 client strict 校验拒收，controller 的 read/confirmRestore 已有 `!result.ok → error state` 降级路径（非崩溃/白屏）——属滚动升级中间态，本档不改变该既有行为。

**实测证据（构造旧值 → 读取 → 结果，全部真实跑过）：**
- `tests/host-opening.spec.ts`「resumes a persisted legacy deepseek-v4-flash header on deepseek-v4.1-flash」：fake 子会话 `requestHeader()` 返回 `{ config: { provider: 'adam', model: 'deepseek-v4-flash' } }`，经真实 `composeChild → installBtwModelSelection` 生产路径后 `read()` 返回 `model: 'deepseek-v4.1-flash'`，无异常。
- `tests/host-opening.spec.ts`「defaults the side-chat model to deepseek-v4.1-flash without crashing」：无 header（未持久化模型）→ start/read 均 `model: 'deepseek-v4.1-flash'`；`resolveChildAgentOptions` 收到 `{ provider: 'adam', model: 'deepseek-v4.1-flash' }`。
- `tests/remote-contract.spec.ts`「routes the wire model enum on deepseek-v4.1-flash only」：`btwModelSchema.parse('deepseek-v4-flash')` 抛错、`setSideChatModelRequestSchema` 带旧值抛错、`readSideChatResultSchema` 带旧 model 抛错 → **证明 host 必须先清洗再发射**（代码即如此）。
- `tests/host-opening.spec.ts` `sanitizeBtwModel` 单测：legacy → 替换值；枚举值直通；undefined/未知 → 默认。

### 单元 3：README 与测试同步 ✅
- `README.md` 新增「Side-chat model」小节：默认与可路由集合、抽屉选项、legacy 映射说明（README.zh.md 未改——单元只要求 README.md；如需可后续同步）。
- 测试更新（+8）：`remote-contract.spec.ts` +1、`host-opening.spec.ts` +5、`side-chat-surface.spec.tsx` +2（select 默认值与 option 列表断言、跟随 host 模型断言）。
- `tests/capability-detect.spec.ts` 中的 `'deepseek-v4-flash'` 夹具**未改**：它们是 vision 能力检测的通用模型名字符串（`resolveAgentRoute`/`modelAcceptsImage` 行为测试），与 btw 模型枚举无关，改它们属越界。

### 单元 4：重建 + 部署 ✅
构建（直调 tsdown）：`node node_modules/tsdown/dist/run.mjs` → host ESM（index/typert.host/typert.remote-client + 2 个 hash chunk + d.ts）+ client CJS ModuleLoader bundle 全部生成。
部署：先备份 `~/.dsh/profiles/node_modules/@local/dsh-btw/` 整目录 → `.workspace/backup-btw-20260917-170146/`（7.8M）；再把仓库 `lib/` + `package.json`（diff 证实与部署位一致）同步过去；清理部署位 3 个未被引用的旧 hash chunk（`remote-descriptors-xg8tvseq.js`、`remote-DxLkxvnp.js`、`remote-BmXjp3i9.d.ts`）；部署后 `node --check` `lib/index.js` 与 `lib/client.js` 均通过。

### 单元 5：验证并落盘 ✅（全部真实输出见 §2）

---

## 2. 验证输出（命令与真实结果）

工作目录 `cd /home/CNS2026495165/dsh/dsh-btw`，全部直调二进制（pnpm 无网不可用）：

| 命令 | 结果 |
|---|---|
| `node node_modules/tsdown/dist/run.mjs` | ✔ Build complete（host 9 files 125.37 kB；client.js 334.62 kB gzip 70.90 kB） |
| `node node_modules/oxlint/bin/oxlint src tests tsdown.config.ts vitest.config.ts` | ✔ Found 0 warnings and 0 errors（53 files, 96 rules） |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | ✔（root OK） |
| `node node_modules/typescript/bin/tsc -p tsconfig.client.json` | ✔（client OK） |
| `node node_modules/typescript/bin/tsc -p tsconfig.tests.json` | ✔（tests OK） |
| `node node_modules/vitest/vitest.mjs run` | ✔ Test Files 24 passed (24)，Tests **226 passed | 2 skipped (228)**（基线 218 → +8） |
| `node scripts/smoke-build.mjs` | ✔ smoke ok: @local/dsh-btw build artifacts consistent |
| `node node_modules/publint/src/cli.js --level error` | ✔ All good! |

构建产物内容实测：
- `lib/remote-Dv1GpyGK.js` 内 `const btwModelSchema = z.enum(["deepseek-v4.1-flash","glm-5.3","deepseek-v4-pro"])`；`readSideChatResultSchema` / `startSideChatValueSchema` 内嵌 model enum 同为三值新集。
- `lib/index.js`（host）含 `deepseek-v4.1-flash` ×4、`deepseek-v4-flash` 仅 1 处（legacy 映射键）。
- `lib/client.js` 含 `deepseek-v4.1-flash` ×5、`deepseek-v4-flash` 1 处（打包进 client 的 JSDoc 注释，非代码；option 列表与枚举均无旧值）。
- 部署位运行时加载：`import('./lib/index.js')` → name `dsh-btw`、`TYPERT.invocations.length = 10`、`TYPERT_REMOTE.descriptors.length = 10`、`BTW_SETTINGS_SCHEMA()` 空段 → `{ui:{banner:true,modelSelect:true,imageBadge:true},vision:{autoTransform:true}}`。
- 部署位 `node --check lib/index.js` / `node --check lib/client.js` → 均 syntax OK。

---

## 3. 部署与回滚

**已部署**（本档完成）：
1. `cp -r ~/.dsh/profiles/node_modules/@local/dsh-btw/. .workspace/backup-btw-20260917-170146/`（备份）
2. `cp -r dsh-btw/lib/. ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` + `cp dsh-btw/package.json` 部署位（package.json 与仓库一致）
3. 清理 3 个无引用旧 hash chunk；`node --check` 两 lib 文件通过
4. **生效方式**：宿主 lib 代码属冷面（P0-a/P0-b 经验：宿主插件代码改动需重启 web/重挂插件一次）；客户端 bundle 替换 + 刷新页面即生效。重启后 btw 模型切换即为热路径。

**回滚**：
- `cp -r .workspace/backup-btw-20260917-170146/. ~/.dsh/profiles/node_modules/@local/dsh-btw/`（整目录还原，含旧 lib 与旧 hash chunk），或按需只还原 `lib/` + `package.json`；随后重启 web 一次。
- 源码回滚：`git checkout -- dsh-btw/`（注意仓库 lib/ 为构建产物，还原后如需重新部署需重建）。

---

## 4. 自复核表 + 自裁决

| 项 | 结论 |
|---|---|
| 枚举/常量/客户端三处标识统一 | ✅ grep 证实 src 仅 legacy 映射与注释提及旧值 |
| 抽屉模型选择 UI 保留 | ✅ `settings.ui?.modelSelect !== false` 分支未动，仅默认值与选项更新 |
| 向后兼容（旧值不崩/不白屏） | ✅ legacy 映射 + host 全出口清洗 + 8 个新测试（含生产路径 resume 实测） |
| wire strict 校验不被旧值触发 | ✅ host 清洗先行；remote-contract 证明 schema 拒旧值且 host 永不发射 |
| README 同步 | ✅ README.md 新增 Side-chat model 小节 |
| 构建 + 部署 + node --check | ✅ tsdown 直调重建；备份→部署→清 stale→check 通过 |
| 验证全绿 | ✅ oxlint 0/0、3×tsc、vitest 226 passed、smoke ok、publint error 级 All good |
| 范围 | ✅ 未触碰 dsh-tool-subagent / vision-adam / FEATURE-MAP.md；无 sandbox_permissions |

**自裁决：PASS。**

**问题清单（非阻塞，供主代理知悉）：**
1. **部署需一次 web 重启**（宿主 lib 冷面）：本档只改工作区 + 部署位文件，重启验收由主代理执行（与 P0-b 同批节奏）。
2. **`capability-detect.spec.ts` 的 `'deepseek-v4-flash'` 夹具保留**：属 vision 能力检测通用字符串，非 btw 枚举；若希望全局无旧 id 痕迹可另派清理（不建议，会弱化该夹具的"任意模型名"语义）。
3. **client bundle 内嵌 1 处旧 id（JSDoc 注释）**：打包进 client 的 shared/remote.ts 注释（说明替换关系），非代码路径；如需零痕迹可删注释后重建（不值得）。
4. **README.zh.md 未同步**：单元只要求 README.md；中文版如需同步可后续补。
5. **vision 直传行为变化（预期内）**：默认模型变为 `deepseek-v4.1-flash` 后，侧聊带图将走能力检测直传路径（peer 背景信息证实 v4.1-flash 声明 image 输入），不再走 vision-adam 转文本——这是模型替换的预期副作用，非回归；若需保持旧行为可显式切 glm-5.3/设置 autoTransform。

---

## 5. 追加交付单元：settings 热读 btw 默认模型（2026-09-17，同档内完成）

**做法落地**（沿用 P0-b「host 每次调用读新值 + client settingsScope 订阅」热载模式）：

| 文件 | 改动 |
|---|---|
| `src/index.ts` | `BTW_SETTINGS_SCHEMA` 新增 `model` 段：`default`（string，默认 `deepseek-v4.1-flash`）+ `options`（string 数组，默认 = 现有清单 `['deepseek-v4.1-flash','glm-5.3','deepseek-v4-pro']`）；schemastery 无 `.optional()`，缺失/空数组由 host 侧回退常量 |
| `src/host/vision.ts` | `readBtwSettings` 返回类型扩展 `model?: { default?: string; options?: readonly string[] }`（P0-b 同款读点） |
| `src/host/side-chat-service.ts` | 常量改名 `BTW_FALLBACK_MODELS` / `BTW_FALLBACK_DEFAULT_MODEL`（语义=无 settings 时回退）；新增 `btwRoutableModels(ctx)` / `btwDefaultModel(ctx)`（每次调用读 `dsh-btw.model.options` / `model.default`，缺失/空/非法回退常量）；`sanitizeBtwModel` 增加可选 `routable` 参（legacy 映射优先）；`installBtwModelSelection`、`start`/`startResumed` 的 agentOptions、`transcript`/`startValue`（`btwCurrentModel`）、`setModel`（pick 按当前 options 归一化）全部改为每调用热读 |
| `src/client/btw-settings.ts` | `BtwSettingsSection` 增 `model` 段；`BTW_DEFAULT_MODEL` / `BTW_FALLBACK_MODEL_OPTIONS` 常量；`decodeBtwSettings` 防御性解码（缺失/空数组回退常量） |
| `src/client/SideChatSurface.tsx` | select 默认值 `state.model ?? settings.model?.default ?? BTW_DEFAULT_MODEL`；option 列表改为 `settings.model?.options` 映射（缺失回退常量清单）——抽屉选项与默认随 settings 热载 |
| `README.md` | settings 表增 `dsh-btw.model.default` / `dsh-btw.model.options` 两行；Side-chat model 小节补热读说明与 wire 契约边界 |
| `tests/` | +5：host-opening「hot-reads the settings default model between starts（同进程改 settings → 下一条侧聊默认变，无重启）」「normalizes setModel pick against settings routable options」「sanitizeBtwModel honors a custom routable set」；surface「settings-driven model options and default」「falls back when settings omit model.options」 |
| `scripts/verify-btw-model-hotread.mjs` | 新增验收脚本：对构建产物跑「settings 文件热改 → 新开侧聊默认模型跟着变；清空 → 回退」 |

**验收证据（真实输出）**：`node scripts/verify-btw-model-hotread.mjs`（同进程，settings 每次调用读文件，等价 settings.yaml 保存 → dsh-settings-file → per-call get）：
```
✓ settings dsh-btw.model.default=glm-5.3 → new chat default model = glm-5.3
✓ create agentOptions.model = glm-5.3 (routed to the settings default)
✓ hot edit → dsh-btw.model.default=deepseek-v4-pro → new chat default model = deepseek-v4-pro
✓ cleared/absent section → fallback constant default = deepseek-v4.1-flash
PASS: btw default model is settings-driven and hot-read (no restart needed for value changes)
```
vitest 同场景断言（`hot-reads the settings default model between starts`）全绿；全量 **231 passed / 2 skipped**（上一单元 226 → +5）。

**「是否仍需重启」结论**：**仍需一次重启**——本单元改了宿主代码（`BTW_SETTINGS_SCHEMA` 新增 `model` 段 + side-chat-service 读点），宿主 lib 属冷面（P0-a/P0-b 经验），需重启 web/重挂插件一次以加载新 schema 与新代码（与上一单元默认值切换合并为同一次重启）。**重启之后**：改 `~/.dsh/settings.yaml` 的 `dsh-btw.model.default` / `model.options` 为**值级热载**（host 每次调用重读 + client settingsScope 重渲染），无需再重启——本档脚本与 vitest 已实测该读点路径；farm 侧 yaml→发布链路由 P0-b 实测。

**追加单元自复核**：读点全覆盖（start/startResumed/installBtwModelSelection/transcript/startValue/setModel + client select）✅；缺失/清空/非法回退常量 ✅；无网直调二进制全量验证绿（oxlint 0/0、3×tsc、vitest 231/2、smoke、publint error 级）✅；构建 + 部署（备份 `backup-btw-20260917-172915`，`diff -rq` 证实部署位 lib 与仓库字节一致）✅；范围未越界 ✅。

**问题清单（追加）**：① `model.options` 若配置 wire 契约（`btwModelSchema` 编译期三值）之外的模型，选择它会被 client strict 校验拒绝（README 已注明，属配置边界）；② schemastery 无 `.optional()`，options 键以「schema 默认 = 现有清单 + host 空数组回退」实现，语义等价；③ 实时 web 端「改真实 settings.yaml → GUI 开侧聊」的端到端目视确认需主代理重启后按验收矩阵执行（本档给出 host 读点 + 构建产物层证据）。

---

## 6. 部署与回滚（含追加单元）

**已部署**（本档累计两次备份）：上一单元 `backup-btw-20260917-170146`；追加单元 `backup-btw-20260917-172915`（部署前整目录快照，回滚用后者即可覆盖两单元）。
1. `cp -r dsh-btw/lib/.` + `cp package.json` → `~/.dsh/profiles/node_modules/@local/dsh-btw/`；`node --check` 两 lib 文件通过；运行时加载（name `dsh-btw` / TYPERT 10 / descriptors 10 / `BTW_SETTINGS_SCHEMA()` model 段 = `{default:'deepseek-v4.1-flash',options:[三值]}`）通过。
2. **生效方式**：宿主 lib 冷面 → 重启 web/重挂插件一次；此后 `model.default`/`model.options` 值级热载。

**回滚**：`cp -r .workspace/backup-btw-20260917-172915/. ~/.dsh/profiles/node_modules/@local/dsh-btw/`（整目录还原）或按需还原 lib/ + package.json；随后重启 web 一次。源码回滚 `git checkout -- dsh-btw/`（lib 为构建产物，还原后需重建再部署）。

---

## 7. 自复核表 + 自裁决（含追加单元）

**追加单元自裁决：PASS**（见 §5 自复核）。

| 项 | 结论 |
|---|---|
| 追加单元全部落地 | ✅ schema 键 + host/client 读点 + README + 测试 + 验收脚本 |
| settings 热读实测 | ✅ 脚本 + vitest 同进程改值 → 下一条侧聊默认变；清空 → 回退 v4.1-flash |
| 全量验证（追加后） | ✅ oxlint 0/0、3×tsc、vitest **231 passed / 2 skipped**、smoke ok、publint error 级 All good |
| 部署位 | ✅ 已同步（字节一致），备份 `backup-btw-20260917-172915` |
| 范围 | ✅ 仅 dsh-btw/ + 部署位 lib；未触碰 dsh-tool-subagent / vision-adam / FEATURE-MAP.md；无 sandbox_permissions |

**终局自裁决：PASS（两单元合计）。**
