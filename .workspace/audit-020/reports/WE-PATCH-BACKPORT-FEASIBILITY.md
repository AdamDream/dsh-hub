# WE 三处本地补丁回流 0.1.4 源码 —— 可行性勘察报告

> 档位：只读可行性勘察（未改任何产品代码；未碰 `~/.dsh/**` 与 `~/.dsh-017/**`；未启监听端口；零模型请求）
> 解包实验与脚本落位：`.workspace/audit-020/we-probe/`
> 证据标注口径：`[部署件实测]` = 直接读/哈希/diff 部署构建产物；`[源码实读]` = 直接读 0.1.4 `src/`；`[实测验证]` = 跑了工具/命令得到结果；`[推断]` = 由证据推导但未直接实测。

---

## 1. 结论摘要

1. **三处补丁全部精确定位到 0.1.4 源码位置**，且全部落在 **`src/client/**`（浏览器半）**，服务端半与公开契约文件未受影响：
   - **P1** `src/client/row-badges.ts:250` —— `remoteSessionIndex()` 内的 O(k²) 去重改 `Set`；
   - **P2** `src/client/settings.tsx` —— `RemoteWorkspaceSettingsPage()` 的 `refresh`（140–149 行）+ `useRef` import（14 行）；
   - **P3** `src/client/index.ts:258–265` —— `installSidebarRowBadges()` 内 `sources.sessions` 改按快照引用记忆化。
   - 第三处（任务中「尚未被命名」的一处）**已找到并命名**：**`sessions()` 全量重建 → 按快照引用记忆化**（C2-2）。
2. **回流「机械可行」，但分两条路线、结论不同**：
   - **产物路线（改 0.1.4 已发布的 `lib/client.js`）：完全机械可行且已实测验证** —— 三处 hunk 逐字命中 0.1.4 tgz 构建产物，补丁后 diff 恰为 3 个 hunk / 78 行、`node --check` 通过、标记计数与现役部署件**完全一致**。
   - **源码路线（按用户裁决改 `src/` 再构建）：2 处逐字可行，1 处必须适配** —— P1 去掉 `unique[0] !== undefined` 守卫在 0.1.4 的 `tsconfig`（`noUncheckedIndexedAccess: true`）下**编译报错 TS2345**（已用 typescript 6.0.3 实测复现），需保留收窄写法；另 P2 需补 `useRef` 到 import。
3. **升到 0.1.4 后对 0.2.0 仍有剩余缺口，且是「硬编译错误」而非静默降级**：剩余恰为 3 个新抽象成员 —— `SubprocessRuntime.terminalEnvironment`、`SubprocessTerminalHandle.resize`、`SubprocessTerminalHandle.inspectActivity`；而 `FileSystem.readByteRange` **0.1.4 已实现**。
4. **两个必须先决策的连带问题**（本次新发现，均与「3 处代码补丁」不同层面）：
   - **`package.json` 是第 4 处本地偏离**（部署件 0.1.2 的 `package.json` 已被本地改过，mtime 9/15）：peer 与依赖范围、新增原生依赖 `cpu-features`/`koffi`/`node-pty`、`ssh2` 升版。回流后必须决定是否沿用。
   - **peer 闸门升到 0.1.4 后依然会被 0.2.0 触发**：0.1.2 的 `^0.1.1-rc.2` 与 0.1.4 的 `^0.1.5-rc.1` 实测**都拒绝 `0.2.0-rc.1`**（含 `includePrerelease: true` 口径）。升级本身不解决 peer 问题，必须改写范围（属第 5 处偏离）。
5. **另一条独立风险**：0.1.4 把 RPC 通道从独立 `/dsw` 改成共享 `/api` + `dsw/` 命名空间；而 `@local/dsh-ssh-gui@0.2.0` 的客户端仍硬编码 `CH_DWS = "/dsw"`（`lib/client.js:62`）—— 升 WE 到 0.1.4 会**打断 ssh-gui 对该通道的调用**，需一并排期。

---

## 2. 证据基线（本次实际找到的路径与版本）

### 2.1 现役部署件（被改对象）

| 项 | 值 | 证据 |
|---|---|---|
| 路径 | `/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement` | `[部署件实测]` |
| 版本 | `0.1.2` | `[部署件实测]` |
| `lib/client.js` | 267838 B / 5469 行，mtime **2026-09-22 16:39** | `[部署件实测]` |
| `lib/client.js` sha256 | `56faaf956705a4067939bfbe441e03141cc9f16feb13e2150fc83426b40cee5e` | `[部署件实测]` |
| 包内其余文件 | 除 `lib/client.js` 与 `package.json` 外，与上游 0.1.2 tgz **逐字节相同** | `[部署件实测]` `diff -rq` |

**关键指纹**：`lib/` 目录 mtime `9-20 15:39`、其余文件 `9-14 14:54`，**唯独 `lib/client.js` 是 `9-22 16:39`** —— 即产物被分两次本地改写（见 §2.4 时间线）。

### 2.2 WE 全部副本指纹（8 份，全部同一 hash）

`[部署件实测]` 逐份 sha256：`~/.dsh`、`~/.dsh-017`、`unified-assembly-20260929-121756`、`audit-020/assembly-020`、`audit-020/t17/probe`、`audit-020/sandbox-017`、`audit-020/sandbox-020`、`audit-020/t32` —— **8/8 均为 `56faaf95…`（同一份已打补丁的 client.js）**，即补丁存在于**每一份部署拷贝**、而不在任何 tgz。这与协调者「119/119 逐字节相同」的实测一致。

### 2.3 上游 tgz（未被污染的三份）

| 版本 | 路径 | `lib/client.js` sha256 | 三处补丁标记 |
|---|---|---|---|
| 0.1.2 | `.workspace/workstreams/research/research/tgz/workspace-enhancement-0.1.2.tgz`（解包于 `.../tgz/x-we-0.1.2/package`） | `aef0a3e663af487abe91698135c7cc70b3138ad4716475fdd5a52e1293fed094` | 0 命中 |
| 0.1.3 | 同目录 `…-0.1.3.tgz`（`x-we-0.1.3/package`） | `908b8cfec834a92a950f1df4b7fc10281b7097ee6e8f245b11ed71f2135338f2` | 0 命中 |
| 0.1.4 | 同目录 `…-0.1.4.tgz`（`x-we-0.1.4/package`） | `f22181122304842638a2b3a514a4eca71f22cd3def39789c467fb9494bbb6169` | 0 命中 |

`[实测验证]` 逐份 `grep -c`：`ids.indexOf(id) === index` = **2/2/2**，`Array.from(new Set(ids))` = **0/0/0**，`dsh-perf-fix K1-3` = **0/0/0**，`refreshGenerationRef` = **0/0/0**，`cachedRows` = **0/0/0**。⇒ **三处补丁在上游 0.1.2/0.1.3/0.1.4 全部 0 命中**（协调者结论独立复核成立）。

### 2.4 补丁来源与时间线（权威佐证，本次实读）

- `.workspace/lag-fix/patches/workspace-enhancement-perf.sh` —— 重放脚本，头部明确标注单元 **C2**：
  - `C2-1 remoteSessionIndex 内层 O(k²) 去重 → Set（保持首次出现顺序与判定语义）`
  - `C2-2 sessions() 全量重建 → 按快照引用记忆化（返回值语义等价：内容与顺序一致）`
  - 脚本内常量：`LIVE_PRE_SHA = aef0a3e6…`（=上游 0.1.2）、`PATCHED_SHA = 7df7a655…`（=仅 C2 的打补丁态）。
- `.workspace/lag-fix/patched/workspace-enhancement.client.js.diff`（1837 B）—— **恰好 2 个 hunk**：C2-1 + C2-2。
- `.workspace/lag-fix/patched/workspace-enhancement.client.js` 267026 B / mtime `9-20 15:17`（= C2 已应用）。
- `[实测验证]` `diff` 该 9/20 产物 vs 现役部署件 = **恰 1 个 hunk**，内容即 `/* dsh-perf-fix K1-3 keep-alive guards v1 … */` 那一段。

**时间线**：`9-20 15:01–15:17` 应用 **C2（P1+P3）** → `9-22 16:39` 追加 **K1-3（P2）** → 现役 sha `56faaf95…`。与「产物里 3 处补丁」完全对齐。

### 2.5 0.1.4 源码（工作区唯一带 `src/` 的 WE 线）

| 项 | 值 |
|---|---|
| 路径 | `.workspace/workstreams/research/repos/dsh-workspace-enhancement` |
| version / git | `0.1.4`；tag `v0.1.4`；HEAD `ee25ed1 chore: prepare npm v0.1.4 release (#17)`；工作树 clean `[源码实读]` |
| 重复副本 | `.workspace/workstreams/research/research-dsh-workerspace/repos/dsh-workspace-enhancement`（同 tag/HEAD，内容同源） |
| 无 `lib/` | 仓库树**不含** `lib/` ⇒ `lib/` 是构建产物 `[源码实读]` |

---

## 3. 0.1.4 源码树与构建链

### 3.1 构建脚本与工具链

`[源码实读]` `package.json` → `scripts`：

```
build        : tsc && tsdown          ← 两段式：先 tsc 出 lib/，再 tsdown 把客户端半打成单文件
typecheck    : tsc --noEmit
test         : node --import tsx --test "test/**/*.test.ts"
check:static : node scripts/check.mjs
slots        : node scripts/slot-catalog.mjs
check        : check:static && typecheck && test && build && node scripts/pack-smoke.mjs
prepublishOnly: npm run check
```

- **构建工具 = `tsc`（TypeScript 6）+ `tsdown`**（不是 esbuild/rollup 直用）。`devDependencies`：`typescript ^6.0.0`、`tsdown ^0.22.2`、`lightningcss ^1.32.0`、`react ^18.3.1`。
- `tsconfig.json`：`rootDir: src`、`outDir: lib`、`declaration`、`sourceMap`、`target es2024`、`strict`、**`noUncheckedIndexedAccess: true`**、`exactOptionalPropertyTypes: true`、`noImplicitOverride: true`。⇒ **本项目开 `noUncheckedIndexedAccess`（对 P1 回流是决定性的，见 §5.2）**。
- `tsdown.config.ts` `[源码实读]`：`entry = lib/client/index.js` → `outDir lib`、`format cjs`、`platform browser`、`entryFileNames: 'client.js'`、`clean: false`（保留 node 半产物）、banner/footer 用 `window.__ModuleLoader__.load({ id: 'dsh-workspace-enhancement', factory })` 包裹；`neverBundle`/`alwaysBundle` 双白名单（`react`、`cordis`、`dsh-client-ui-slots` 等外部化，其余必须内联）；自研插件 `dsh-client-bundle-purity`（非平台模块的 `@deepseek-ai/` 值导入 = **构建报错**）与 `dsh-css-modules-inline`（lightningcss 编译 CSS Modules 并自动注入 `<style>`）。
  ⇒ **`lib/client.js`（三处补丁的落点）是 tsdown 第二段产物**，源码对应 `lib/client/index.js` ← `src/client/index.ts`。

### 3.2 `src/` 目录结构（51 个文件）

`[源码实读]` 服务端半（`src/*.ts`，29 个）：`connection / credential / environment / exec-tools / filesystem / hostkey / index / listing / mixed / model-prompts / output / picker / plugin / process / registry / remote-approval-gate / remote-sandbox-fence / remote-sandbox / runtime / session-connections / session-remote-context / session-workspaces / ssh-core / subprocess / terminal / tools / transport / web-channel / web`。
客户端半（`src/client/**`，22 个）：`cockpit.ts / flow.tsx(+.module.css) / form.tsx / icons.tsx / index.ts / local-directory.ts / machine-form.tsx / machine-payload.ts / remote-status.ts / remote-status-entry.tsx / route-id.ts / row-badges.ts / sandbox-badge.ts / settings.tsx / side-workspaces.tsx(+.module.css) / status.tsx / ui.ts`。

**三处补丁全部落在客户端半**（`row-badges.ts` / `settings.tsx` / `index.ts`），服务端半与 `src/web-channel.ts` 无需改动。

### 3.3 构建是否需要网络

`[源码实读]` 仓库**无 `node_modules`**（`count: 0`）⇒ 正常路径需要 `npm install`。
`[实测验证]` **离线工具链在盘上存在**，无需外网即可凑齐：
- `typescript 6.0.3`、`tsdown 0.22.14`、`lightningcss 1.33.0`、`react 18.3.1` → 现役 WE 自带 `node_modules`：`/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/node_modules/`（另有 `audit-020/sandbox-017`、`audit-020/sandbox-020` 两份同版本副本）。
- 0.1.4 所需 peer 类型（`^0.1.5-rc.1`）→ `.dsh/profiles-archive/web2-20260915-105429/node_modules/@deepseek-ai/`（**0.1.5-rc.2**，实测满足 0.1.4 peer 范围）。
- npm 前置（协调者给定）：`npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache`（`_cacache` 已有 2069 条 index）、`npm_config_logs_dir=…/npm-logs`；registry 默认 `https://registry.npmjs.org/`。

⇒ **结论：离线构建「可行但需自行拼接 node_modules」，本次未实跑构建（见 §9 未验证项）。**

---

## 4. 三处补丁的 `产物 → 源码` 映射表

### 4.1 总表

| # | 名称（权威单元号） | 部署产物文件:行 | 0.1.4 构建产物对应位置 | **0.1.4 源码：文件 : 函数 / 行** | 意图 | 依据 |
|---|---|---|---|---|---|---|
| **P1** | **C2-1** dedupe→Set | `lib/client.js:4124`（hunk `@@ -4121,8`） | `lib/client.js:4410`（hunk `@@ -4407,8`） | **`src/client/row-badges.ts:250`**，函数 **`remoteSessionIndex()`**（声明 233–254） | 去重由 `ids.filter((id,index)=>ids.indexOf(id)===index)`（内层 O(k²)）改 `Array.from(new Set(ids))`（O(k)），**保持首次出现顺序与判定语义**；顺带去掉 `unique[0] !== undefined` 冗余守卫 | `[部署件实测]`+`[源码实读]`+lag-fix 脚本 C2-1 标签 |
| **P2** | **K1-3** keep-alive guards v1 | `lib/client.js:4558–4585`（hunk `@@ -4558,13`，新增块起 4561） | `lib/client.js:5052–5078`（hunk `@@ -5052,13`） | **`src/client/settings.tsx:140–149`**，函数 **`RemoteWorkspaceSettingsPage()`**（声明 131）；**并需在 14 行补 `useRef`** | 挂载 effect **此前无 cleanup** ⇒ `machines.list` 在飞 promise 落进已死组件。新增 `aliveRef` + `refreshGenerationRef`：`refresh` 每次调用自增 generation，回调前用 `current()` 校验（`aliveRef.current && generation === refreshGenerationRef.current`）后才 `setState`/`setErr`；卸载时置 `aliveRef=false` 并自增 generation 使在飞请求作废。**仅覆盖自持取数 `refresh`**，对话框手动触发的保存/删除路径**故意不在本单元范围** | 同上（注释文本 `dsh-perf-fix K1-3 keep-alive guards v1`，形状注明「照抄 `@local/dsh-usage:840-852`」） |
| **P3** | **C2-2** sessions 记忆化 | `lib/client.js:5434–5452`（hunk `@@ -5415,14`） | `lib/client.js:6268–6286`（hunk `@@ -6265,14`） | **`src/client/index.ts:258–265`**，函数 **`installSidebarRowBadges()`**（声明 251）的 `sources` 对象 `sessions` 键 | `sources.sessions()` 原本**每次调用全量重建**投影（`Object.values(state.byId).map(...)`）。改为 IIFE 持有 `cachedState`/`cachedRows`：**快照引用不变即原样复用上次结果**（注释：feeds 每次更新发布新 state 对象，故引用不变 ⇒ 行不变；「内容与顺序一致」）。**返回值语义等价** | 同上（lag-fix 脚本 C2-2 标签） |

### 4.2 逐处源码前后对照（0.1.4 `src/`）

**P1 — `src/client/row-badges.ts`（`remoteSessionIndex`，233–254）**

```ts
// before (250–251)
const unique = ids.filter((id, index) => ids.indexOf(id) === index)
if (unique.length === 1 && unique[0] !== undefined) index.set(title, unique[0])
// after（注意：守卫不可裸删，见 §5.2）
const unique = Array.from(new Set(ids))
const first = unique[0]
if (unique.length === 1 && first !== undefined) index.set(title, first)
```

⚠️ **同名孪生点**：**`src/client/row-badges.ts:216`（`remoteWorkspaceIndex()` 内）文本与 250 行完全相同**，上游 0.1.2/0.1.4 产物中该模式各出现 **2 次**；现役补丁**只改了 session 侧**（`[实测验证]` 部署产物 `indexOf(...)===index` 剩 1 次、`Array.from(new Set(ids))` 1 次）。⇒ 回流时**必须锚定 session 侧**（锚点 `byTitle.set(session.title,`），全局替换会误改 workspace 侧、产生第 4 处非预期差异。

**P2 — `src/client/settings.tsx`**

```ts
// 14 行
import { useEffect, useRef, useState } from 'react'   // 原为 { useEffect, useState }

// 139/140 行之间插入（bundle 侧原样为 (0, react.useRef)）
const aliveRef = useRef(true)
const refreshGenerationRef = useRef(0)
useEffect(() => {
  aliveRef.current = true
  return () => {
    aliveRef.current = false
    refreshGenerationRef.current += 1
  }
}, [])

// refresh 内（原 140–149）
const refresh = async (): Promise<void> => {
  const generation = ++refreshGenerationRef.current
  const current = (): boolean => aliveRef.current && generation === refreshGenerationRef.current
  try {
    const result = await rpc('machines.list')
    const state = unwrap<…>(result, t('settings.rpc.listMachines'))
    if (!current()) return
    setMachines(…)
    setCurrentId(…)
  } catch (error) {
    if (current()) setErr(error instanceof Error ? error.message : String(error))
  }
}
```

**P3 — `src/client/index.ts`（`installSidebarRowBadges`）**

```ts
// before（256–266 内的 sessions 键）
sessions: () => {
  const state = sessionsFeed?.getSnapshot()
  if (state === undefined) return []
  return Object.values(state.byId).map(row => ({
    title: row.displayTitle,
    ...(typeof row.cwd === 'string' ? { cwd: row.cwd } : {}),
  }))
},
// after
sessions: (() => {
  /** Memoized by snapshot identity: … */
  let cachedState: … 
  let cachedRows: … = []
  return () => {
    const state = sessionsFeed?.getSnapshot()
    if (state === cachedState) return cachedRows
    cachedState = state
    cachedRows = state === undefined ? [] : Object.values(state.byId).map(row => ({
      title: row.displayTitle,
      ...(typeof row.cwd === 'string' ? { cwd: row.cwd } : {}),
    }))
    return cachedRows
  }
})(),
```

### 4.3 第 4 处偏离（非代码补丁，但必须一并裁决）

`[部署件实测]` 现役 `package.json`（mtime **9-15 10:07**）与上游 0.1.2 不同，内容为**本地编辑**，非 3 处代码补丁：

```diff
 peerDependencies:
-  "@deepseek-ai/dsh-system-prompt": "^0.1.0-rc.6"      →  "^0.1.1-rc.2"
-  "@deepseek-ai/dsh-tools":         "^0.1.0-rc.6"      →  "^0.1.1-rc.2"
 dependencies:
-  dsh-host-directory-picker{,-native}: ^0.1.0-rc.6     →  ^0.1.1-rc.2
-  ssh2: ^1.16.0                                        →  ^1.17.0
+  新增 cpu-features ^0.0.10, koffi ^3.3.0, node-pty ^1.2.0-beta.15
```

协调者给的「现为 `>=0.1.1-rc.2 <0.2.0`」与实读一致（`^0.1.1-rc.2` 的 semver 展开就是 `>=0.1.1-rc.2 <0.2.0-0`，`[实测验证]` semver 实测确认）——**不是矛盾，是同一范围的两种写法**。
⚠️ 三点提示：① `cpu-features`/`koffi`/`node-pty` 在 0.1.4 的**任何源码里 0 引用**（`[源码实读]` `grep`），0.1.4 只用 `ssh2`（`src/ssh-core.ts:18` 等）⇒ 这几项是**部署侧需求**而非上游需求；② 0.1.4 的 `engines.node` 已升到 `>=22.8.0`（本机 `22.23.2` ✓）；③ 回流后若不沿用这几项，需确认部署侧无原生 PTY 依赖。

---

## 5. 回流可行性与精确改动点

### 5.1 产物路线：**已实测，完全机械可行**

`[实测验证]` 脚本 `.workspace/audit-020/we-probe/patch014.py`，输入上游 0.1.4 产物 `x-we-0.1.4/package/lib/client.js`（306461 B / 6292 行），输出 `we-probe/up14-patched.client.js`（307647 B / 6319 行，sha256 `fbf4c5bf69b14f537e40cd506e60dce45b6fa7ca53bdce601abd05b595ad1528`）：

| 校验项 | 结果 |
|---|---|
| P1 旧块命中 | 全 bundle **2 次**（workspace 4379 / session 4410）；脚本按锚点 `byTitle.set(session.title,` 只改 **session 侧 1 次** ✓ |
| P2 旧块命中 | **1 次** ✓ |
| P3 旧块命中 | **1 次** ✓ |
| 结果 diff | **恰 3 个 hunk / 78 行**（`we-probe/up14-patch.diff`） |
| `node --check` | **SYNTAX OK** ✓ |
| 标记计数 vs 部署件 | `Array.from(new Set(ids))` 1=1；`ids.indexOf(id)` 1=1；`refreshGenerationRef` 4=4；`aliveRef` 4=4；`cachedRows` 4=4；`cachedState` 3=3 —— **六项全等** ✓ |

⇒ **对 0.1.4 构建产物而言，三处补丁「零适配」可用**。这是一条**低风险捷径**（尤其当 0.1.4 源码线暂时无法构建时）。

### 5.2 源码路线：**2 处逐字可行，P1 必须适配（已实测证明）**

`[实测验证]` 用**现役部署自带的 typescript 6.0.3** + 0.1.4 仓库的 `tsconfig` 关键开关，对 P1 改写后形态做最小复现：

```
t.ts(5,43): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
```

原因：`tsconfig.json` 开了 **`noUncheckedIndexedAccess: true`** ⇒ `unique[0]` 类型是 `string | undefined`；`unique.length === 1` **不会**收窄索引访问。上游源码里的 `&& unique[0] !== undefined` 正是为满足该开关而写的**类型守卫**。
⇒ **必须的适配**：保留收窄（如 `const first = unique[0]; if (unique.length === 1 && first !== undefined) index.set(title, first)`），或改 `unique[0]!`（依赖 `noImplicitOverride`/lint 口径，不推荐）。
⇒ **重要含义**：一旦保留守卫，**P1 在源码层面就只剩「`filter`+`indexOf` → `Set`」这一处实质改动**（语义等价、纯性能）；「删守卫」只对构建产物有意义。回流时**不要**为了「与产物逐字节一致」而硬删守卫——那会直接构建失败。

其余适配点：
- **P2**：`settings.tsx` 14 行 import 补 `useRef`（产物里是 `(0, react.useRef)`，因为 tsdown 把 react 命名空间化了；源码需直接写 `useRef`）。`aliveRef`/`refreshGenerationRef`/`current` 的类型可推断，无需显式标注；`exactOptionalPropertyTypes` 对该段无影响。
- **P3**：`sources` 的类型标注是 `const sources: RowBadgeSources`，**IIFE 后 `sessions` 仍是 `() => Row[]`，类型签名不变**；只需保证 `cachedRows` 推断为 `SessionRowLike[]`（初值 `[]` 配 `let` 会推成 `any[]`/`never[]`，建议显式标注 `let cachedRows: SessionRowLike[] = []` 之类，避免 `noImplicitAny` 之外的推断偏差 —— 具体形态 `[推断]`，需 typecheck 实证）。
- 三处均**不涉及** `cordis.patch.yml`、`exports`、`dsh.client.inject`、`index.ts` 导出符号。

### 5.3 回流后「是否还有剩余改造」小结

| 事项 | 结论 |
|---|---|
| 3 处补丁回流到 0.1.4 `src/` | 可行；P1 需保留类型守卫（1 行适配），P2 需补 import |
| 回流后 WE 能否在 **0.1.7-rc.2 / 0.1.5-rc.2** 上运行 | `[推断]` 可以（peer 语义 + API_PATH 一致） |
| 回流后 WE 能否在 **0.2.0-rc.1** 上直接跑 | **否** —— 缺 3 个新抽象成员（硬编译错误，见 §7.2）+ peer 范围需改写（§8.2） |

---

## 6. 回归风险（每处补丁若被遗忘的具体后果）

| # | 忘掉后的后果 | 表现形态 | 严重度评估 |
|---|---|---|---|
| **P1** | `remoteSessionIndex()` 恢复内层 O(k²) 去重（`indexOf` 在 `ids` 上线性扫描）。`ids` = **共享同一 session 标题的 connId 列表**，k 通常为 1 | **静默**（无报错、无警告），仅 CPU 微增 | **低**。逐标题 k 极小，实测收益主要来自 P3（见下） |
| **P2** | 挂载 effect 无 cleanup + `refresh` 无 generation 守卫：① 组件卸载后在飞 `machines.list` 落回已死组件；② **慢的旧响应覆盖快的新响应**（`setMachines`/`setCurrentId` 被更早发起的请求回写），表现为注册表页机器列表 / 当前机器**瞬时回跳为旧值** | **静默**。React 18 已移除「unmount 后 setState」警告 ⇒ **无任何控制台提示**，只能靠观察列表回跳发现 | **中高**。唯一「功能性」（非纯性能）的一处；且难以察觉。注意其范围仅 `refresh`，保存/删除路径本就不在补丁内 |
| **P3** | `sources.sessions()` 每次调用全量重建投影（`Object.values(state.byId).map` + 每行对象字面量）。调用点在 `src/client/row-badges.ts:383` 的 `remoteSessionIndex(sources.sessions())`，位于**每次徽章重建**路径上（该模块常量：`STATUS_POLL_MS 30_000`、`SCAN_DELAY_MS 120`、`SCAN_MIN_GAP_MS 300`） | **静默**，per-scan 分配/GC 抖动 | **中**（这正是 C2 单元「同热点路径开销」的主项） |

**额外副作用提示（P3）**：记忆化后返回的是**同一个数组实例**。`[源码实读]` 当前唯一消费者 `remoteSessionIndex()` 只做 `for...of` 迭代、**不排序不改写**，故安全；但如果将来有消费者对 `sources.sessions()` 结果做 `sort()`/就地改写，会**污染缓存**并在后续 scan 中返回被改写的数据。回流时建议在源码注释中显式记下「返回值为共享只读数组」的契约。

**P1 的另一层提示**：现役产物把 workspace 侧（`src/client/row-badges.ts:216`）**故意留在原状**。若回流时顺手把两处都改，会**扩大与现役行为的差异面**（超出已回归验证的范围）。建议**严格只改 session 侧**，保持与现役 1:1。

---

## 7. 0.1.2 → 0.1.4 契约变化与对 0.2.0 的剩余缺口

### 7.1 公开契约变化

**未变（逐字节相同，`[实测验证]` sha256）**：

| 契约面 | 证据 |
|---|---|
| **导出符号** | `lib/index.d.ts` 在 0.1.2 / 0.1.3 / 0.1.4 **同一 sha256 `b6c35c085afea2501b705f825415692fba8b64765199b1ba5636c8ef5c003aa9`**，17 行 `export` 全等。含 **`remoteWorkspacesRoot`**、`SshRuntime`、`SshSubprocessRuntime`、`SshFileSystem`、`SshDirectoryPicker`、`SshRegistry`、`parseSshRoute`、`HostKeyStore`、`saveSecret/getSecret/deleteSecret`、`apply` 等 ⇒ **`@local/dsh-ssh-gui@0.2.0` 的阻断性上游依赖 `import { remoteWorkspacesRoot } from 'dsh-workspace-enhancement'`（`…/@local/dsh-ssh-gui/lib/index.js:50`）在 0.1.4 上依然成立** |
| **profile patch 条目** | `cordis.patch.yml` 三版同一 sha256 `f7b12bc740bc0bfb268aff5db6abd9c8c68221f3912fd0bb4cebf9453314c77f` |
| **`dsh.client.inject`** | 三版同为 6 项：`dsh-client-{connection,locale,runtime,ui-conversation,ui-sidebar,ui-workspace}`；`dsh.bundle.patch` 同为 `./cordis.patch.yml` |
| **`exports` 子路径映射** | `.` / `./ssh` / `./subprocess` / `./fs` / `./picker` / `./web` / `./client` / `./package.json` 三版完全一致 |
| **注册的 cordis 服务名** | `ctx.set('subprocess', …)`（0.1.2 `lib/plugin.js:88`、0.1.4 `lib/plugin.js:110`）；全包 `ctx.set` 均只此一处 |

**已变（重要）**：

1. **RPC 通道改写（破坏性）** `[部署件实测]`+`[源码实读]`
   - 0.1.2 / 0.1.3：客户端 `connection.rpc.call('/dsw', endpoint, payload, signal)`（产物各 2 处）；宿主 `ctx.connection.rpc.handle('/dsw', dispatch, { authority: 'loopback' })`（0.1.2 `lib/web.js:504`）。
   - 0.1.4：新增共享模块 **`src/web-channel.ts`**（`lib/web-channel.js`），两端同源：`API_CHANNEL = '/api'`（= `dsh-client-connection` 的 `API_PATH`）、`CHANNEL_NAMESPACE = 'dsw'`、`channelEndpointOf(e) => \`dsw/${e}\``、`channelPathOf(e) => '/api/' + 'dsw/…'`；宿主注册该行的 `/api/dsw/*` 通道，**旧的独立 `/dsw` 通道被移除**（源码注释：旧设计在三处硬编码 `/dsw`；该通道在部分宿主家族返回 **405**，UPSTREAM-3 F1/F2）。
   - **对 0.2.0 是好消息**：`[实测验证]` 0.2.0-rc.1 的 `dsh-client-connection` 仍导出 `API_PATH = "/api"`（`lib/types/api-path.d.ts:6`，`lib/index.js:14`）⇒ **0.1.4 的通道方案与 0.2.0 兼容**。
   - **⚠️ 连带风险**：`@local/dsh-ssh-gui@0.2.0` 的客户端仍**硬编码 `CH_DWS = "/dsw"`**（`…/@local/dsh-ssh-gui/lib/client.js:62`，注释自称「底座已有点位」）。升 WE 到 0.1.4 后该通道不再存在 ⇒ **ssh-gui 经 /dsw 的调用会失效**，须与 WE 升版一并排期（这是跨插件破坏，不在 3 处补丁范围内）。
2. **peer/dependency 拓扑重构（实质是修复根因）** `[部署件实测]`
   - 0.1.2：`dependencies` = 13 个 `@deepseek-ai/*` @ `^0.1.1-rc.2` + `ssh2`；`peerDependencies` **仅 2 项** @ `^0.1.0-rc.6`。
   - 0.1.3：`dependencies` **仅 `ssh2`**；`peerDependencies` **15 项** @ `^0.1.2-rc.1`。
   - 0.1.4：同上，peer **15 项** @ **`^0.1.5-rc.1`**；`dependencies` 仅 `ssh2 ^1.16.0`。
   - 效果：`@deepseek-ai/*` 从「真依赖（会在插件内装第二份）」变为「peer（从 profile 解析，单实例）」。现役 0.1.2 确实在插件内自带一份 `node_modules/@deepseek-ai/dsh-fs@0.1.1-rc.2` 等（`[部署件实测]`），这正是 `peer-deps-check.mjs` 头部所述「dependencies 不满足会装出第二份实例，是真正要消除的（单实例原则）」所指问题；**0.1.4 从结构上解决了它**。
3. **engines**：`node >=22.0.0` → **`>=22.8.0`**（0.1.3 起）。本机 `22.23.2` ✓。
4. **`files`**：0.1.2 `["lib","cordis.patch.yml"]`（随包发 `.js.map`）→ 0.1.3+ 追加 `!**/*.map`。
5. **内部（非公开导出）**：0.1.4 新增 `src/model-prompts.ts` → `lib/model-prompts.d.ts`；`MixedSubprocessRuntime` 构造参数由 3 个（`…, sides`）降为 2 个（0.1.2 `lib/plugin.js:88` vs 0.1.4 `lib/plugin.js:110`）。`Mixed*` 不在 `index.d.ts` 导出面内，属内部实现变化。
6. `lib/` 全树差异：0.1.2→0.1.4 共 **99 条**；0.1.3→0.1.4 共 **61 条**。

### 7.2 对 0.2.0 的剩余缺口：**恰为 3 个成员，全部硬编译错误**

`[实测验证]` 解包 0.2.0-rc.1 tgz（`.workspace/dsh-020-pkgs/tgz/`，42 个包）实读声明，并用 `.dsh/profiles-archive/web2-20260915-105429` 的 **0.1.5-rc.2** 对照：

| 0.2.0 要求成员 | 0.2.0 声明出处 | 0.1.5-rc.2 是否有 | **WE 0.1.4 现状** | 后果 |
|---|---|---|---|---|
| **`FileSystem.readByteRange`** | `dsh-fs/lib/types/index.d.ts` | — | **✅ 已实现**：`src/filesystem.ts:250`（`async readByteRange`）与 `:679`（委托 `this.engine.readByteRange`）；`src/mixed.ts:190,356`；且已出现在 `lib/filesystem.d.ts` / `lib/mixed.d.ts` | **无剩余工作** |
| **`SubprocessRuntime.terminalEnvironment(signal?)`** | `dsh-subprocess/lib/types/index.d.ts:94`（`abstract`） | **无**（0.1.5-rc.2 抽象集仅 `resolveExecutable`/`spawn`/`spawnTerminal`） | **❌ 缺失**（`src/` 与 `lib/*.d.ts` 均 0 命中） | `class SshSubprocessRuntime extends SubprocessRuntime`（`src/subprocess.ts:306`）→ **TS2515** 非抽象类未实现继承的抽象成员 ⇒ **构建失败** |
| **`SubprocessTerminalHandle.resize(cols, rows)`** | `dsh-subprocess/lib/types/types.d.ts:255` | **无** | **❌ 缺失**（0 命中） | `class SshTerminalHandle implements SubprocessTerminalHandle`（`src/terminal.ts:28`）→ **TS2420** ⇒ **构建失败** |
| **`SubprocessTerminalHandle.inspectActivity()`** | `dsh-subprocess/lib/types/types.d.ts:265` | **无** | **❌ 缺失**（0 命中） | 同上 TS2420 ⇒ **构建失败** |

补充口径：0.2.0 的 `SubprocessTerminalHandle` 接口 **6 个成员全部非可选**（`[实测验证]` 接口体内 `?` 计数 = **0**）：`write` / `resize` / `inspectForeground` / `inspectActivity` / `signalForeground` / `terminate`；WE 0.1.4 精确实现了 **0.1.5-rc.x 的 4 个**（`SRC terminal.ts` 内 `write`(48)、`inspectForeground`(59)、`signalForeground`(64)、`terminate`(69) 区域），差的正是新增的 2 个。`SubprocessRuntime` 抽象集 0.2.0 有 4 个，WE 0.1.4 精确实现了 0.1.5-rc.x 的 3 个（`resolveExecutable`/`spawn`/`spawnTerminal`），差的正是 `terminalEnvironment`。

⇒ **结论**：升到 0.1.4 **不消除** 0.2.0 适配工作；剩余工作 = **新增 3 个成员**（并引入 0.2.0 的 `SubprocessTerminalEnvironment` / `SubprocessTerminalActivity` 返回类型）。这是**编译期硬失败**、绝不容错，性质上是「不补就构建不过」而非「静默降级」。同时 `readByteRange` 一项可以**从待办里划掉**。

---

## 8. 构建与落位方案

### 8.1 两条可选路线

**路线 A（源码回流，符合用户裁决方向）**

```bash
# 1) 取 0.1.4 源码线（工作区已有，无需网络）
SRC=/home/CNS2026495165/dsh/.workspace/workstreams/research/repos/dsh-workspace-enhancement
git -C "$SRC" status --porcelain        # 已确认 clean；回流前再确认
# 2) 按 §4.2 / §5.2 改 3 个文件：src/client/row-badges.ts、src/client/settings.tsx、src/client/index.ts
#    （P1 必须保留类型守卫；P2 必须补 useRef import）
# 3) 依赖：正常路径 npm install（需网络或拼离线 node_modules，见 §3.3）
export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs
npm install --legacy-peer-deps     # 仓库 .npmrc 已设 legacy-peer-deps=true
# 4) 构建（= tsc → lib/ ，再 tsdown → lib/client.js）
npm run typecheck && npm run build
#    更严：npm run check（check:static + typecheck + test + build + pack-smoke）
# 5) 打包
npm pack            # → dsh-workspace-enhancement-0.1.4.tgz
```

**路线 B（产物回流，零构建、本次已实测）**

```bash
# 对上游 0.1.4 tgz 解包后的 lib/client.js 应用 §4.1 三处 hunk
python3 .workspace/audit-020/we-probe/patch014.py    # 已产出 up14-patched.client.js
node --check up14-patched.client.js                   # 已通过
diff -u <orig> up14-patched.client.js | grep -c '^@@' # 必须 = 3
```

### 8.2 落位路径与校验

| 步骤 | 内容 |
|---|---|
| 落位目标 | `<profile>/node_modules/dsh-workspace-enhancement/`（现役：`/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement`）。⚠️ 本次任务**禁止触碰 `~/.dsh/**`**，故本报告只给方案、不落位 |
| 关键校验 | ① `lib/client.js` 三处标记计数：`Array.from(new Set(ids))`=1、`ids.indexOf(id)`=1、`refreshGenerationRef`=4、`aliveRef`=4、`cachedRows`=4、`cachedState`=3；② `node --check lib/client.js`；③ `lib/index.d.ts` sha256 **必须仍为 `b6c35c08…`**（证明公开契约未被误伤）；④ `cordis.patch.yml` sha256 必须仍为 `f7b12bc7…`；⑤ 与上游 0.1.4 产物 diff **恰 3 个 hunk**；⑥ `@local/dsh-ssh-gui` 的 `import { remoteWorkspacesRoot }` 仍可解析 |
| 部署后功能回归 | 注册表页机器列表在快速切换/删除后不出现旧值回跳（P2）；侧栏远程徽章在 SSG 扫描与语言切换后仍正确标记（P1/P3 语义等价，应无可见变化） |
| 注意 | 现役部署件的 `lib/client.js.map` **已失真**（lag-fix 脚本明示「只改 client.js；client.js.map 不动（会失真，非本单元范围）」）；0.1.4 的 `files` 已排除 `**/*.map`，该问题在 0.1.4 上不复存在 |

### 8.3 是否必须更新 `peerDependencies`（结论：**必须，且升版本身不解决**）

`[实测验证]` 用 semver 实测（`includePrerelease: true` 与 strict 两口径都跑）：

| 范围 | 0.1.1-rc.2 | 0.1.5-rc.2 | 0.1.7-rc.2 | **0.2.0-rc.1** |
|---|---|---|---|---|
| `^0.1.0-rc.6`（**上游** 0.1.2） | ✗/✗ | ✗/✓ | ✗/✓ | **✗** |
| `^0.1.1-rc.2`（**现役部署** 0.1.2 本地改后） | ✓/✓ | ✗/✓ | ✗/✓ | **✗** |
| `^0.1.2-rc.1`（0.1.3） | ✗/✗ | ✗/✓ | ✗/✓ | **✗** |
| `^0.1.5-rc.1`（**0.1.4**） | ✗/✗ | ✓/✓ | ✗/✓ | **✗** |

（「strict/includePrerelease」；`^0.1.5-rc.1` 展开 = `>=0.1.5-rc.1 <0.2.0-0`）

⇒ 三点硬结论：
1. **0.1.4 的 `^0.1.5-rc.1` 与 0.1.2 的 `^0.1.1-rc.2` 一样，都把 `0.2.0-rc.1` 判为不满足**（连 `0.2.0` 正式版也不满足，因上界是 `<0.2.0-0`）。**升到 0.1.4 不会自动通过 0.2.0 的 peer 闸门。**
2. **预发布规则的坑**：即使 0.1.7-rc.2 在集合内，`^0.1.5-rc.1` 在 **strict** 口径下也判 **不满足**（`0.1.7-rc.2` 的 `[major,minor,patch]` 元组 0.1.7 ≠ 范围内带预发布标签比较器的 0.1.5 元组）；只有 `includePrerelease: true` 才放行。0.1.7-rc.2 线的部署**依赖这个放宽口径**。
3. **建议范围**（实测可同时满足 0.1.5-rc.2 与 0.2.0-rc.1，两种口径都过）：
   - `^0.1.5-rc.1 || ^0.2.0-rc.1`，或
   - `>=0.1.5-rc.1 || >=0.2.0-rc.1`
   （纯 `*` / `>=0.1.5-rc.1` / `>=0.1.5-rc.1 <0.3.0` 在 strict 口径下**都拒绝** `0.2.0-rc.1`。`^0.2.0-rc.1` 单项亦可但会丢掉 0.1.x 线。）

**闸门实际严重度**：`[部署件实测]` 部署自带 `peer-deps-check.mjs` 头部明确记载「本 profile 显式配置 `autoInstallPeers:false` + `strict-peer-dependencies` 关闭，**peer 不满足 = 警告不阻断**；但 **dependencies 不满足会装出第二份实例，是真正要消除的（单实例原则）**」。
⇒ `[推断]` 就本 profile 的配置而言，peer 越界**不阻断运行**（这也是现役 0.1.2 能在 peer `^0.1.1-rc.2` 下跑 0.1.1-rc.2 之外的组合而不崩的原因之一）；但既然 0.1.4 已把全部 harness 包移入 peer，**`dependencies` 侧已无越界风险**，这部分风险随升版自然消除。**是否要把 peer 范围改写，取决于 0.2.0 部署走哪条安装路径**——若那条路径执行严格 peer 校验，则必须改写（第 5 处偏离）。

---

## 9. 未验证项

1. **未实跑 0.1.4 构建**（`npm install` + `tsc` + `tsdown`）。依据：仓库无 `node_modules`，拼接离线依赖会写盘且耗时；本档为只读勘察。§3.3 的「离线可行」是**基于盘上工具链/类型可得的 `[推断]`，非实测**。
2. **P3 源码改写的最终 TS 形态未过 `tsc`**。`cachedRows` 的初值/标注（`let cachedRows: SessionRowLike[] = []` 抑或从 `cachedState` 派生类型）在 `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 下的精确写法**须以实跑 `npm run typecheck` 为准**；本档只证明了「产物路线逐字可行」与「P1 必须带守卫」。
3. **0.2.0 上 WE 的可运行性未实跑**（未在 0.2.0 profile 里加载 0.1.4 / 回流后的 WE）。§7.2 的 3 个缺口是**类型声明层面的实测结论**（缺成员 → TS2515/TS2420 硬错误），但未观察运行时行为。
4. **`@local/dsh-ssh-gui` 经 `/dsw` 的调用失败面未实测**。已确认 ssh-gui 客户端硬编码 `CH_DWS = "/dsw"`（`lib/client.js:62`）与 WE 0.1.4 移除该通道（`lib/web-channel.js`、`lib/web.js:663` 注释），但**未逐一走查 ssh-gui 的 4 处 `/dsw` 引用在 0.1.4 下的具体表现**（哪些调用点是死代码、哪些是真回归）。
5. **peer 闸门在 0.2.0 部署路径下的实际执行口径未实测**。「peer 不阻断」是**读取部署自带 `peer-deps-check.mjs` 头部说明**得到的 `[推断]`；0.2.0 的安装/部署脚本是否沿用同一开关**未核**。
6. **`cpu-features`/`koffi`/`node-pty` 三项本地新增依赖的真实用途未查**（0.1.4 源码 0 引用 ⇒ 部署侧需求；是 ssh-gui 还是别处拉的，未核）。
7. **0.1.2 源码线确认不存在**：本次只在工作区找到 **0.1.4** 一条带 `src/` 的 WE 线（两份同源副本），**未找到 0.1.2/0.1.3 的 `src/`**。⇒ 与协调者「0.1.2 源码线已不存在，仅存构建产物」一致；因此**产物→源码的映射是「0.1.4 源码」反推 + lag-fix 脚本单元标签双向确认**，而非 0.1.2 源码直读。本档未对该映射在 0.1.2 源码上的形态做任何断言。
8. **本档未读任何其他审计报告**（仅列过 `reports/` 目录名），全部结论来自本次亲自读到的文件/哈希/命令输出，以规避本项目既往的「转抄致幻」问题。

---

## 附录：本次产生的证据文件（均在 `.workspace/audit-020/we-probe/`）

| 文件 | 内容 |
|---|---|
| `dep-vs-up12.client.js.diff` | 部署件 vs 上游 0.1.2 的 3-hunk unified diff（本报告 §4.1 的行号来源） |
| `lagfix-vs-deployed.diff` | lag-fix 9/20 C2 产物 vs 现役部署件 → **恰 1 hunk（K1-3）**，确立补丁时间线 |
| `patch014.py` / `try-patch-014.mjs` | 0.1.4 产物打补丁脚本（前者为最终可用版，含锚点定位与断言） |
| `up14-patched.client.js` / `up14-patch.diff` | 打补丁后的 0.1.4 产物（sha256 `fbf4c5bf…`）与 3-hunk diff |
| `tstest/` | TS2345 最小复现（typescript 6.0.3 + `noUncheckedIndexedAccess: true`） |
| `x020/` | 0.2.0-rc.1 的 `dsh-subprocess` / `dsh-fs` / `dsh-client-connection` 解包与声明实读 |
| `e12.txt` / `e14.txt` | 0.1.2 与 0.1.4 `lib/index.d.ts` 的 export 行清单（diff 为空） |
