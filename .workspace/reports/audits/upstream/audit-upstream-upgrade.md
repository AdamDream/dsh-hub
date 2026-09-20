# DSH 上游升级审计：0.1.1-rc.2 → 0.1.5-rc.2

> 审计对象：`/home/CNS2026495165/.dsh/profiles/web`（部署态 0.1.1-rc.2）→ 上游 `@deepseek-ai/dsh@0.1.5-rc.2`（`next` 通道）
> 审计原则：**只采信可复现的实验事实**。每条结论都给出文件路径+行号或命令原始输出；无法证实的条目一律进入第 6 节，不做推测性结论。
> 审计时间：2026-09-11

---

## 1. 结论摘要

| 项 | 结论 |
|---|---|
| 包级破坏性 | **上游删除了 `@deepseek-ai/dsh-client-runtime` 包**（版本谱止于 `0.1.1-rc.2`），且它从默认插件树中消失 |
| 对本站的实际冲击 | **3 个自建插件的客户端侧全部不可加载**（btw / wallpaper / taste 的 `dsh.client.inject` 均声明该已删包） |
| 契约级破坏 | `./invariant` 子路径被 8 个包移除；conversation 公共 API 137 增 / 149 删；composer 链 owner props 改名；`dsh-session` 存储层导出重构 |
| **未破坏**（已实测证伪） | profile/bundles/补丁层机制、`cordis.patch.yml` 语义、用户 preset 目录 `.agent-presets`、全部被本站插件使用的槽位名、`useProjection` 标准位、`immediately`/`platform` 字段、projection `wire` 语义 |
| 升级性质 | 纯增量扩容：`dsh` 直接依赖 62 → 72（**+10，-0**）；`@deepseek-ai` 包 199 → 241；默认树插件 134 → 151（+21 / -4） |
| 站点迁移成本主体 | 修复 3 个自建插件的客户端注入与 `defineStore` 来源；重新打 ui-subagent 的 tok/s 补丁 |

---

## 2. 实验环境与可复现命令

### 2.1 制品获取

```bash
mkdir -p /tmp/dsh-upgrade-audit/{tgz,x} && cd /tmp/dsh-upgrade-audit
# 注意：npm pack 产物名带 scope 前缀（deepseek-ai-<pkg>-<ver>.tgz），按 <pkg>-<ver>.tgz 找必然全 MISS
npm pack @deepseek-ai/dsh@0.1.5-rc.2 --pack-destination ./tgz
# 逐版本解包（0.1.1-rc.2 / 0.1.3-alpha.2 / 0.1.5-rc.2）
tar -xzf tgz/deepseek-ai-dsh-0.1.5-rc.2.tgz -C x/0.1.5-rc.2/dsh --strip-components=1
```

### 2.2 隔离 profile（**全程未写入 `/home/CNS2026495165/.dsh/`**）

```bash
mkdir -p /tmp/dsh-iso && cd /tmp/dsh-iso
cat > package.json <<'EOF'
{ "name": "dsh-iso-profile", "private": true,
  "dependencies": { "@deepseek-ai/cordis-plugin-group": "^1.0.1",
                    "@deepseek-ai/dsh": "0.1.5-rc.2" } }
EOF
npm install --no-audit --no-fund          # → added 521 packages in 22s
export DSH_HOME=/tmp/dsh-iso/.dsh-isolated
npx @deepseek-ai/dsh --help
npx @deepseek-ai/dsh --profile web --dump-default-config > /tmp/dsh-upgrade-audit/new-tree.yml
```

旧版默认树用**符号链接**方式在 /tmp 复刻规格导出，避免触碰真实目录：

```bash
mkdir -p /tmp/dsh-old-iso/profiles/web
P=/home/CNS2026495165/.dsh/profiles/web
cp $P/{package.json,cordis.yml,cordis.patch.yml} /tmp/dsh-old-iso/profiles/web/
ln -s $P/node_modules /tmp/dsh-old-iso/profiles/web/node_modules
DSH_HOME=/tmp/dsh-old-iso $P/node_modules/.bin/dsh --profile web --dump-default-config \
  > /tmp/dsh-upgrade-audit/old-tree.yml
```

**未写入证明**（执行后真实文件 mtime 不变）：

```
/home/CNS2026495165/.dsh/profiles/web/cordis.yml        2026-09-11 11:02:35
/home/CNS2026495165/.dsh/profiles/web/cordis.patch.yml  2026-09-11 10:09:24
/home/CNS2026495165/.dsh/profiles/web/package.json      2026-08-25 16:23:24
```

---

## 3. 版本差异矩阵

| 面 | 0.1.1-rc.2 现状 | 0.1.5-rc.2 现状 | 是否破坏性 | 证据 |
|---|---|---|---|---|
| `@deepseek-ai/dsh-client-runtime` 包 | 存在，v0.1.1-rc.2，是默认树插件 | **不存在**（npm 版本谱止于 0.1.1-rc.2） | **是（最高危）** | `npm view @deepseek-ai/dsh-client-runtime versions` → `[…,"0.1.1-rc.1","0.1.1-rc.2"]`；新版树 diff：`- @deepseek-ai/dsh-client-runtime` |
| 客户端插件数 | 43 | 55（+13 / **-1**） | 是（-1 即上述包） | `dsh.client` 字段统计新旧安装目录 |
| 默认树插件数 | 134（name 行 135） | 151（name 行 152） | 部分 | `old-tree.yml` vs `new-tree.yml` 去重 |
| 树中移除项 | — | `dsh-client-runtime`、`dsh-host-apiproxy`、`dsh-tool-str-replace-editor`、`dsh-tool-subagent-report` | 是 | `comm -23 old-names.txt new-names.txt` |
| 树中新增项 | — | 21 个，含 `dsh-api-session-controller`、`dsh-client-ui-chat/session/sidebar-*`、`dsh-session-log-deepseek`、`dsh-session-turn-outline`、`dsh-web-fetch-http`、`dsh-host-open-in-app` 等 | 否（增量） | `comm -13 old-names.txt new-names.txt` |
| `dsh` 直接依赖数 | 62 | 72 | 否（+10 / -0） | `dsh/package.json` `dependencies` |
| `./invariant` 子路径 | 8 包导出 | **全部移除** | **是** | `dsh-base`、`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-client-ui-slots`、`dsh-client-ui-subagent`、`dsh-session-projection`、`dsh-session-stats`、`dsh-web-app` 的 `exports` 对比 |
| `dsh.client.inject`（ui-subagent） | 含 `dsh-client-runtime` | 换为 `dsh-api-session-controller`（其余 4 项不变） | 是（对本机补丁面） | `x/{0.1.1-rc.2,0.1.5-rc.2}/dsh-client-ui-subagent/package.json` |
| composer 链 owner props | `{ interactions, session }` | `{ sessionId, session, pendingInteraction }` + 新 `fallbackOnly` | **是** | `dsh-client-ui-conversation/lib/client.js`：旧 `renderSlotChain("conversation.composer",{interactions:pending,session},…)`；新 `…{sessionId,session,pendingInteraction},{fallback:composerBar,fallbackOnly:sessionId===void 0,overlay:true}` |
| composer.dock 渲染条件 | `variant==="composer" && input!==void 0 && sessionId!==void 0` | **完全一致** | 否 | 两版 client.js 同条件 |
| 关键槽位名 | `conversation.composer`、`conversation.composer.dock`、`conversation.session.header.lineage`、`conversation.composer.bar`、`conversation.session.header.actions`、`settings.general.item` | **全部仍在** | 否 | 逐槽位 grep 新旧安装目录 |
| `useProjection` 标准位 | 存在（ui-conversation 出现 14 次） | 存在（11 次） | 否 | 两版 client.js 计数 |
| `@deepseek-ai/dsh-client-ui-primitives` | 无实体目录，39 → 31 包 inject 它（虚拟模块 id） | 同样无实体目录、仍被 39 次 inject | 否 | 两版顶层均无该目录；`find -maxdepth 6 -type d -name` 皆空 |
| `defineStore` 提供方 | `dsh-client-runtime/client` | **`@deepseek-ai/dsh-client-store`**（虚拟 id） | **是** | `dsh-client-ui-theme/lib/client.js`：旧 `_deepseek_ai_dsh_client_runtime_client.defineStore` → 新 `_deepseek_ai_dsh_client_store.defineStore` |
| `dsh-client-ui-conversation` 公共 API | — | **137 项新增 / 149 项移除**（含 `ChatView`、`ChatNodeSeat`、`AssistantMarkdown`、`CompactionItem` 等） | **是** | `lib/types/*.d.ts` 导出名集合 diff |
| `dsh-client-ui-slots` API | — | 新增键控钩子族：`PropsKeyedHooks`、`KeyedSnapshotSelectorHook`、**`standardHookPropName`**、`StandardSourceBinding` 等 | 是 | 同上 |
| `dsh-session` 存储导出 | `ChunkRow`、`StorageRecord`、`packChunkRuns`、`decodeStorageRecord` | **移除**；新增 `EncodedSeq`、`encodeSeqRanges`、`decodeSeqRanges`、`SessionLogOffset`、`SessionSeqCursor` | **是（存储层重构）** | `dsh-session/lib/types/*.d.ts` diff；`grep -c ChunkRow` 旧命中/新未找到 |
| 会话落盘格式 | `session.jsonl.zstd`（zstd 压缩 JSONL，本机 1548 个 `.zstd`） | 同扩展名 | **未判定**（见 §6） | `find ~/.dsh/sessions -type f \| sed 's/.*\.//' \| sort \| uniq -c` → `1548 zstd` |
| 内置 agent preset | `code`、`cordis`、`minimal`、`standard` | `cordis`、`minimal`、**`ptc`**、`standard` | 是（`code` 消失、`ptc` 新增） | 旧：`dsh/config/agent-presets/`；新：`dsh-agent-presets/presets/` |
| 用户级 preset 目录 | `USER_PRESET_DIR = ".agent-presets"` | **同名字面量未变** | 否 | 新旧 `dsh-agent-presets/lib/index.js` 均含 `const USER_PRESET_DIR = ".agent-presets";` |
| preset 分发方式 | 随 `dsh` 包发布 `config/` | `files` 去掉 `config`；新增 **`dsh.configTrees`** 字段；preset 移入新包 `dsh-agent-presets` | 是（结构变化） | `dsh/package.json`：`files ["lib/*.js","config"]` → `["lib/*.js"]`；新增 `dsh.configTrees[0] = {mount:"config/agent-presets", path:"../../packages/preset/agent-presets/presets", scanRoster:true}` |
| `dsh.profile.bundles` 机制 | 支持，按序分层 | **语义一致** | 否 | 新版 `profile-boot-Dk-7KqJc.js`："stack its patch layers (bundle layers in `dsh.profile.bundles` order, the profile's own `cordis.patch.yml`, `--patch` overlays…)" |
| `cordis.patch.yml` / 根 `cordis.yml` | 用户补丁层 + 空根 `[]` | **一致** | 否 | 新版常量 `PROFILE_ROOT_FILENAME = "cordis.yml"`；`insert` 语义保留 |
| `dsh.bundle.patch`（自建插件用） | 支持（`bundlePatch`/`allPatches`/`homePatches` 均在） | **支持，层序一致** | 否 | 新旧 `profile-boot-*.js` 均含 `function allPatches` → `[...composed.bundlePatches, ...composed.profile.patches, ...composed.homePatches, ...composed.overlays]` |
| `dsh.client.platform` / `immediately` | 支持 | 支持 | 否 | 新旧 `dsh-client-modules`/`dsh-web-app` 均含 `immediately` |
| projection `wire` 语义 | 仅按 `def.wire !== undefined` 决定可见性 | **未变**（`def.wire === void 0` ×4、`.wire !== void 0` ×1） | 否 | `dsh-session-projection/lib/index.js` grep 计数 |
| 运行时底座 | cordis 4.0.1 / schemastery 3.18.1 / cosmokit 1.8.2 | **cordis 4.0.2 / schemastery 3.18.2 / cosmokit 1.8.3** | 是小版本升 | 隔离安装实测 `require(...)` |
| `schemastery` 依赖地位 | 传递依赖 | **提升为 `dsh` 直接依赖，要求 `^3.18.2`（本机 3.18.1 低于下界）** | 是（本机需重装） | `dsh/package.json` 新旧依赖对照 |
| client 插件加载失败语义 | — | 缺失清单 → `MissingClientBundleError` / `ClientPackageCompositionError extends AggregateError`；注释："a page without a valid manifest cannot boot anything（the shell shows the loud failure）" | 是（**硬失败**） | `dsh-client-modules/lib/index.js`、`lib/client.js` |
| CLI 语义 | `--profile` / `--patch` / `--dump-config` / `plugin` | **完全一致** | 否 | `npx @deepseek-ai/dsh --help`（新版） |

---

## 4. 破坏性变更清单

> 每条给出：症状 → 根因 → 修法 → 验证命令。

### B1（最高危）自建插件客户端侧因 `dsh-client-runtime` 被删而无法加载

- **症状**：升级后 btw / wallpaper / taste 三个插件的浏览器侧不出现（或整页 boot 失败报警）。
- **根因**：`@deepseek-ai/dsh-client-runtime` 上游删包（版本谱止于 `0.1.1-rc.2`，新版默认树中亦无该插件）。而三个插件**都在 `dsh.client.inject` 里显式声明了它**：

  | 插件 | 声明 inject 数 | 不可解析项 |
  |---|---|---|
  | `@local/dsh-btw` | 6 | `@deepseek-ai/dsh-client-runtime` |
  | `@local/dsh-wallpaper` | 4 | `@deepseek-ai/dsh-client-runtime` |
  | `@deepseek-ai/dsh-taste` | 3 | `@deepseek-ai/dsh-client-runtime` |
  | `@deepseek-ai/dsh-vision-adam` | 0（纯宿主插件） | 无——**不受影响** |

  其中 `@local/dsh-wallpaper/lib/client.js:15` 是**真实运行时引用**：
  ```js
  const runtime = require("@deepseek-ai/dsh-client-runtime/client");
  ```
- **修法**（逐条）：
  1. `@local/dsh-wallpaper/lib/client.js:15` 改为 `require("@deepseek-ai/dsh-client-store")`（唯一用到的 API 是 `runtime.defineStore`，见 `client.js:307`；新主题包已改用该来源）。
  2. 三个插件 `package.json` 的 `dsh.client.inject` 中删除 `"@deepseek-ai/dsh-client-runtime"`；若需其原宿主能力，按用途替换为 `"@deepseek-ai/dsh-api-session-controller"`（ui-subagent 的做法）或 `"@deepseek-ai/dsh-client-ui-renderer"`（theme 的做法）。
  3. btw / taste 仅 import `@deepseek-ai/dsh-client-ui-primitives`（虚拟 id，**两版均在**），客户端代码本身无需改。
- **验证命令**：
  ```bash
  # inject 可解析性静态判定（新版可用 id 集 vs 插件声明）
  python3 - <<'PY'
  import json,os,re,io
  tree=set(re.findall(r"^  name: '([^']+)'", io.open("/tmp/dsh-upgrade-audit/new-tree.yml").read(), re.M))
  root="/tmp/dsh-iso/node_modules/@deepseek-ai"
  pkgs={json.load(open(f"{root}/{n}/package.json")).get("name") for n in os.listdir(root)
        if (json.load(open(f"{root}/{n}/package.json")).get("dsh") or {}).get("client")}
  avail=tree|pkgs|{"@deepseek-ai/dsh-client-ui-primitives","@deepseek-ai/dsh-client-store"}
  FB="/home/CNS2026495165/.dsh/profiles/node_modules"
  for d in ["@local/dsh-btw","@local/dsh-wallpaper","@deepseek-ai/dsh-taste"]:
      inj=((json.load(open(f"{FB}/{d}/package.json")).get("dsh") or {}).get("client") or {}).get("inject") or []
      print(d, "不可解析:", [x for x in inj if x not in avail])
  PY
  # 期望：三者均输出 不可解析: []（当前输出均为 ['@deepseek-ai/dsh-client-runtime']）
  ```

### B2 `./invariant` 子路径被批量移除

- **症状**：任何 `import … from '@deepseek-ai/dsh-<x>/invariant'` 立即模块解析失败。
- **根因**：8 个包在 `exports` 中删除了 `./invariant`：`dsh-base`、`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-client-ui-slots`、`dsh-client-ui-subagent`、`dsh-session-projection`、`dsh-session-stats`、`dsh-web-app`。
- **修法**：改用包主入口导出的同名校验符号；或按新版 `lib/invariant.js` 仍存在但不导出的事实，改为从 `types` 子路径取类型。本站现有 4 个自建插件**未使用**该子路径（已扫描，无命中），故此项对本机为"零成本但需知悉"。
- **验证命令**：
  ```bash
  grep -rn "/invariant" /home/CNS2026495165/.dsh/profiles/node_modules/@local/*/lib /home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-{taste,vision-adam}/lib
  # 期望：无输出
  ```

### B3 composer 链 owner props 改名（`interactions` → `pendingInteraction`）

- **症状**：`conversation.composer` 链参与者的 `props.interactions` 变为 `undefined`。
- **根因**：`dsh-client-ui-conversation/lib/client.js` 中
  - 旧：`renderSlotChain("conversation.composer", { interactions: pending, session }, { fallback: composerBar, overlay: true })`
  - 新：`renderSlotChain("conversation.composer", { sessionId, session, pendingInteraction }, { fallback: composerBar, fallbackOnly: sessionId === void 0, overlay: true })`
- **修法**：读取处改用 `pendingInteraction`，并接受新增的 `sessionId`/`fallbackOnly`。**本站 4 个插件均未使用 composer 链 props**（grep `interactions`/`conversation.composer` 在插件 lib 下 0 命中），故对本机亦为零成本知悉项。
- **验证命令**：
  ```bash
  grep -rn "conversation.composer\|interactions" /home/CNS2026495165/.dsh/profiles/node_modules/@local/*/lib/*.js
  # 期望：无输出
  ```

### B4 `dsh-session` 存储层导出重构

- **症状**：依赖 `ChunkRow`、`StorageRecord`、`packChunkRuns`、`decodeStorageRecord` 的代码编译失败。
- **根因**：`dsh-session` 由"块行（chunk row）"模型换成"序号区间（seq range）"模型，新增 `EncodedSeq`、`encodeSeqRanges`、`decodeSeqRanges`、`validateSessionEventData`、`validateSurfaceMetadata`、`SessionLogOffset`、`SessionSeqCursor`、`OptionalSessionSeq`、`SessionSeedEventState`。
- **修法**：`dsh-taste` 的 `lib/storage.js` 走 `@deepseek-ai/dsh-atomic-write` 而非这些符号（已扫描，未命中），本站**无需改动**；但会话历史兼容性见 §6 U1。
- **验证命令**：
  ```bash
  grep -rn "ChunkRow\|StorageRecord\|packChunkRuns\|decodeStorageRecord" \
    /home/CNS2026495165/.dsh/profiles/node_modules/@local/*/lib /home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/lib
  # 期望：无输出
  ```

### B5 内置 preset `code` 消失、`ptc` 新增

- **症状**：配置里引用 `code` preset 时 roster 解析不到。
- **根因**：preset 由 `dsh` 包 `config/agent-presets/`（`code/cordis/minimal/standard`）迁入新包 `@deepseek-ai/dsh-agent-presets/presets/`（`cordis/minimal/ptc/standard`），并改由 `dsh.configTrees` + `scanRoster:true` 挂载。
- **修法**：若引用 `code`，改指 `standard` 或 `ptc`。**本站使用自定义 preset `standard-glm`，而 `USER_PRESET_DIR = ".agent-presets"` 字面量两版一致**，故本机 preset 路径不受影响（见 §5）。
- **验证命令**：
  ```bash
  node -e 'const p=require("/tmp/dsh-iso/node_modules/@deepseek-ai/dsh/package.json");console.log(p.files,p.dsh)'
  ls /tmp/dsh-iso/node_modules/@deepseek-ai/dsh-agent-presets/presets/   # cordis minimal ptc standard
  ls /home/CNS2026495165/.dsh/.agent-presets/                            # standard-glm（用户层，仍有效）
  ```

### B6 工具面变化：三个插件退出默认树

- **症状**：agent 可用工具集变化（`str_replace_editor`、`subagent report`、`apiproxy` 相关能力不再默认挂载）。
- **根因**：树 diff 显示移除 `@deepseek-ai/dsh-tool-str-replace-editor`、`@deepseek-ai/dsh-tool-subagent-report`、`@deepseek-ai/dsh-host-apiproxy`。注意 `dsh-tool-str-replace-editor` **包本身仍存在**（在新版安装目录中可见），只是不再进入默认树。
- **修法**：若需保留，在自己 profile 的 `cordis.patch.yml` 里显式 `insert` 回来；否则接受新版默认工具面。
- **验证命令**：
  ```bash
  comm -23 /tmp/dsh-upgrade-audit/old-names.txt /tmp/dsh-upgrade-audit/new-names.txt
  ```

### B7 会话投影 API 与键控钩子重构（`useProjection` 语义面）

- **症状**：读 `useProjection('sessionStats')` 等投影的插件若依赖旧内部 API，编译/运行期报错。
- **根因**：`dsh-client-ui-slots` 引入键控钩子族（`standardHookPropName`、`PropsKeyedHooks`、`KeyedSnapshotSelectorHook`、`StandardSourceBinding`、`KeyedStandardSource`、`KeyedHooksSources`、`ResourceProtocolMap`），并提供方从 `dsh-client-runtime` 迁到 `dsh-api-session-controller`。
- **修法**：`useProjection` 作为**标准位仍在**（`conversation.composer` 链参与者仍可拿到），调用形式不变；仅 inject 依赖名需更新（见 B1）。
- **验证命令**：
  ```bash
  grep -o "useProjection" /tmp/dsh-upgrade-audit/x/0.1.5-rc.2/dsh-client-ui-conversation/lib/client.js | wc -l   # 11（旧 14，仍存在）
  ```

### B8 底座与 schemastery 下界抬升

- **症状**：沿用旧 lockfile 安装时出现 peer/依赖下界不满足。
- **根因**：`dsh` 依赖区间变化：`cordis ^4.0.1→^4.0.2`、`cordis-plugin-hmr ^1.0.16→^1.0.17`、`-include ^1.0.6→^1.0.7`、`-loader ^1.0.2→^1.0.3`、`-timer ^1.1.3→^1.1.4`；且 `@deepseek-ai/schemastery` 从传递依赖升为**直接依赖 `^3.18.2`**（本机实测为 3.18.1，**低于下界**）。
- **修法**：让 profile 重新安装依赖（`npx @deepseek-ai/dsh plugin --profile web <args>` 转发 pnpm，或直接 `npm i @deepseek-ai/dsh@0.1.5-rc.2`），使 schemastery 升到 3.18.2、cordis 升到 4.0.2、cosmokit 升到 1.8.3。
- **验证命令**：
  ```bash
  for p in cordis schemastery cosmokit; do
    node -e "console.log('$p 本机='+require('/home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai/$p/package.json').version)"
    node -e "console.log('$p 新版='+require('/tmp/dsh-iso/node_modules/@deepseek-ai/$p/package.json').version)"
  done
  ```

### B9 ui-subagent 的 tok/s 补丁会被覆盖

- **症状**：升级后 subagent 目录行与子会话页脚的 tok/s 显示消失。
- **根因**：该显示是**直接改在部署态 bundle 上**的（`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`，41,404 → 42,608 B，sha1 `508ed11aec66`，备份 `client.js.bak-20260911-105723`）。任何重装/升级都会重写该文件。
- **修法**：升级后重放补丁（脚本 `/tmp/patch-subagent.py`，5 处锚点，每处替换前校验唯一命中）；并注意新版该包 `dsh.client.inject` 已把 `dsh-client-runtime` 换成 `dsh-api-session-controller`，补丁中的 `typeof useProjection === "function"` 防御性判断可保留。
- **验证命令**：
  ```bash
  stat -c '%s %n' /home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js
  sha1sum .../client.js | cut -c1-12    # 补丁后应为 508ed11aec66
  ```

---

## 5. 已实测证伪的担心（**非破坏性**）

以下项曾被视为高风险，经实验**证伪**，升级不需为其做任何改动：

1. **profile / bundles / 补丁层机制未变**。新版仍为"`dsh.profile.bundles` 顺序的 bundle 层 → profile 自己的 `cordis.patch.yml` → `--patch` overlay → telemetry"，根配置仍叫 `cordis.yml`，`insert` 语义保留。
2. **`dsh.bundle.patch` 仍受支持**。新旧 `profile-boot-*.js` 均含 `allPatches()` → `[...bundlePatches, ...profile.patches, ...homePatches, ...overlays]`。本机 `@local/dsh-wallpaper` 与 `@local/dsh-btw` 的 `dsh.bundle.patch: "./cordis.patch.yml"` 声明继续有效。
3. **用户 preset 目录名未变**。新旧 `dsh-agent-presets/lib/index.js` 均为 `const USER_PRESET_DIR = ".agent-presets";` → `~/.dsh/.agent-presets/standard-glm/` 继续被 roster 扫描（preset 内容由 `dsh` 包迁到 `dsh-agent-presets` 包，但**扫描用户目录的入口未变**）。
4. **本站插件用到的槽位全部健在**：`conversation.session.header.actions`（btw，旧 4 包/新 5 包命中）、`settings.general.item`（wallpaper，两版均 7 包命中）；`conversation.composer`、`conversation.composer.dock`、`conversation.session.header.lineage`、`conversation.composer.bar` 亦均在。
5. **`dsh-client-ui-primitives` 不是破坏点**。它在两版都**没有实体目录**——是客户端模块系统的虚拟 id，被 31（旧）/ 39（新）个包 inject。btw 与 taste 对它的 import 继续有效。
6. **`conversation.composer.dock` 渲染条件未变**：两版均为 `variant === "composer" && input !== void 0 && sessionId !== void 0`。
7. **`dsh.client.platform` / `immediately` 字段仍支持**（两版 `dsh-client-modules`/`dsh-web-app` 均含 `immediately`）。
8. **projection 的 `wire` 可见性语义未变**：新版 `dsh-session-projection/lib/index.js` 仍以 `def.wire === void 0` / `.wire !== void 0` 判定，无按会话或按键的细粒度过滤。
9. **CLI 与 profile 引导语义未变**：`--profile`、`--from-default-profile`、`--patch`、`--dump-config`、`--dump-default-config`、`plugin` 子命令与说明文本一致。
10. **`dsh-vision-adam` 不受影响**：纯宿主插件（无 `dsh.client`，inject 为空），其依赖 `dsh-credentials`/`dsh-settings`/`dsh-launch-environment`/`dsh-tools`/`schemastery` 在新版均存在。

---

## 6. 无法判定项（**未证实，不作结论**）

| 编号 | 未判定内容 | 为何无法判定 | 需要的验证手段 |
|---|---|---|---|
| U1 | 本机既有 `.zstd` 会话日志能否被 0.1.5-rc.2 读取（向后兼容） | 只做了静态比对：`dsh-session` 存储导出由 `ChunkRow`/`packChunkRuns`/`decodeStorageRecord` 换成 seq 编码族，两版都含 `version`/`migrat` 关键字，但**从静态代码无法断定旧记录是否触发迁移或直接失败**；未启动新版服务，无法做端到端读取 | 在隔离 profile 下用 0.1.5-rc.2 打开**旧会话目录的副本**，实际加载若干历史会话；或比对 `session.jsonl.zstd` 解压后的记录 schema 与新版解析器期望 |
| U2 | `@deepseek-ai/dsh-client-ui-primitives` 与 `@deepseek-ai/dsh-client-store` 这两个虚拟模块 id 的**注册方**（哪个包/机制声明它们） | 两版安装目录均无同名实体包，`grep package.json` 只找到 inject 引用而无提供者声明；未定位到运行时注册点 | 抓取运行中服务的 `window.__DSH_BOOT__` 清单（本机 boot 条目 43 条中无 primitives 独立条目），或读 `dsh-client-modules` 的 graph 构造代码 |
| U3 | 三个自建插件改造后**是否还有别的运行期不兼容**（除 inject 之外） | 本次为静态依赖/inject 判定，未在 0.1.5-rc.2 下实际加载这三个插件 | 隔离 profile + 修复 B1 后加载插件，观察浏览器控制台与 `ClientPackageCompositionError` |
| U4 | `dsh-client-ui-conversation` 137 增 / 149 删的具体影响面（哪些下行消费者会断） | 只统计了导出名集合差异，未逐一比对签名兼容性 | 对每个被移除符号做调用方检索（含站点侧自建代码） |
| U5 | `@local/dsh-wallpaper` 自注册槽位（`settings.wallpaper`、`background.target.session`、`background.target.settings`）在新版的运行期行为 | 这些字符串在新旧**上游包中均 0 命中**（属插件自注册 id），无法用上游 grep 判定其在新版 slot 机制下是否仍可注册/渲染 | 修复 B1 后在 0.1.5-rc.2 下实测壁纸设置页 |
| U6 | `dsh-tool-str-replace-editor` / `dsh-tool-subagent-report` 退出默认树后，agent 工具面是否已被新包等价替代 | 仅知包仍在 npm 但不在默认树；未比对替代关系 | 分别 dump 两版 agent 的工具清单（`--dump-default-config` 之后对比工具注册项） |
| U7 | `0.1.5-rc.1`（当前 `latest`）与 `0.1.5-rc.2`（`next`）之间的差异 | 本次以任务指定的 `0.1.5-rc.2` 为准，未展开 rc.1 | 追加一次 `npm pack @deepseek-ai/dsh@0.1.5-rc.1` 并复用本次 diff 脚本 |
| U8 | 0.1.2-rc.1 / 0.1.3-alpha.2 两个中间版本的**逐版**破坏点 | 已取得制品（`x/0.1.3-alpha.2` 等），但本轮聚焦首末版本对比 | 用 `/tmp/dsh-upgrade-audit/diff-pkg.mjs` 对相邻版本逐对运行 |

---

## 7. 迁移成本估计

| 工作项 | 涉及文件 | 预估 |
|---|---|---|
| 修复 3 个插件客户端注入 + `defineStore` 来源 | `@local/dsh-btw`、`@local/dsh-wallpaper`、`@deepseek-ai/dsh-taste` 的 `package.json` 与 `client.js` | 小（每处 2–3 行，见 B1） |
| 重装 profile 依赖（schemastery/cordis/cosmokit 抬升） | `~/.dsh/profiles/web/package.json` 依赖区间 `^0.1.1-rc.2 → ^0.1.5-rc.2` + lockfile | 小（一条安装命令） |
| 重放 ui-subagent tok/s 补丁 | `…/dsh-client-ui-subagent/lib/client.js` | 小（脚本已存在，5 锚点） |
| 会话历史兼容性止损 | — | **未知**（取决于 U1；升级前建议整体备份 `~/.dsh/sessions`） |
| 自建 bundle patch 复核 | `~/.dsh/profiles/web/cordis.patch.yml`（5 条：vision-adam / agent-presets / taste / btw / wallpaper） | 小（机制未变，无需改） |

**总评**：包级为**纯增量**（+10/-0），机制面（bundles / patch 层 / 用户 preset 目录 / 槽位 / wire）经实测**均未破坏**；真实破坏集中在**一个被删除的包 `@deepseek-ai/dsh-client-runtime`**，它恰好被本站三个自建插件的客户端 inject 与一处 `require` 引用——这是本次升级需要动手的全部要害。

---

## 8. 审计脚本与产物索引

| 路径 | 用途 |
|---|---|
| `/tmp/dsh-upgrade-audit/old-tree.yml` | 0.1.1-rc.2 默认 profile 树（503 行） |
| `/tmp/dsh-upgrade-audit/new-tree.yml` | 0.1.5-rc.2 默认 profile 树（539 行） |
| `/tmp/dsh-upgrade-audit/old-names.txt` / `new-names.txt` | 树中插件名去重表（134 / 151） |
| `/tmp/dsh-upgrade-audit/diff-pkg.mjs` | 逐包 `exports` / `dsh` 字段 / `.d.ts` 导出 diff |
| `/tmp/dsh-upgrade-audit/fetch.sh` | 批量取包解包（**产物名必须带 `deepseek-ai-` 前缀**） |
| `/tmp/dsh-iso/` | 隔离的 0.1.5-rc.2 profile（521 包） |
| `/tmp/dsh-old-iso/` | 旧版默认树导出用的规格副本（node_modules 为符号链接） |

**重要**：`/home/CNS2026495165/.dsh/` 在本轮审计中**全程只读**（真实文件 mtime 未变），所有写操作均落在 `/tmp`。
