# T18 — 依赖 / 运行时 / 原生模块迁移风险审计（0.1.7-rc.2 → 0.2.0-rc.1）

- 轨道：T18（审计阶段，只读；仅写 `.workspace/**`）
- 采样时刻：2026-09-29（当轮实测；所有版本号/哈希均来自本轮命令输出）
- 审计目标：`@deepseek-ai/dsh@0.2.0-rc.1`（npm dist-tag `next`）
- 基线：`0.1.7-rc.2`（隔离副本 `~/.npm-global-dsh017`，实测在册）；参考对照 `0.1.1-rc.2`（现役 3080）
- 本轮未触碰监听端口、未发起模型请求、未改动现役与隔离安装、未写 `~/.dsh/**` 与 `~/.dsh-017/**`

---

## 1. 结论摘要

| # | 结论 | 判定 |
|---|---|---|
| C1 | **node v22.23.2 满足 0.2.0 全部依赖的 engines 要求。** 612 条解析入口中 196 个声明 `engines.node`，195 个满足；唯一不满足项 `@img/sharp-win32-ia32@0.35.5`（`^20.9.0`）是 **win32/ia32 平台门控可选依赖**，在 linux/x64 上永不安装且被 npm 正常跳过 | **通过** |
| C2 | **0.2.0 依赖树规模 612 条（0.1.7 为 593 条）**，第三方新增 19 个包（`got@14.6.6` HTTP 栈一族），移除 6 个（koffi 平台变体 + 旧 otlp exporter）；**第三方大版本跃迁 0 个** | 通过 |
| C3 | **唯一第三方版本回退：`koffi` 3.3.2 → 3.1.1**。原因是 0.2.0 把 6 个包的 `koffi` 依赖从 `^3.1.0` 改为**精确 `3.1.1`**。这是本轮最需要注意的依赖面变化（见 §3.3） | **需知悉** |
| C4 | **完全离线安装已实测成功。** 606 个 tarball（554 MB，逐一 sha512 校验通过）+ 锁定 lockfile，`npm ci --offline`（死代理、空 HOME）2–3 秒装出 548 个包，与联网安装**逐包一致**（仅多 2 个 musl sharp 变体） | **通过（方案见 §5）** |
| C5 | **冷缓存 `--offline` 必定失败**（`ENOTCACHED`）。npm 即使有 lockfile 也要读 registry packument 才能解析传递依赖范围 ⇒ 「离线」必须等于「预置 lockfile + 预热 npm cache」，或改用别的网络隔离手段 | **关键限制** |
| C6 | **安全面默认值零变化。** `dsh-sandbox-policy` / `dsh-fs-sandbox` / `dsh-user-approval` / `dsh-credentials-local` / `dsh-sandbox` 源码**逐字节相同**；`dsh-base` 的沙箱模式（`workspace-write`）、审批策略（`ask`）、凭据文件（`~/.dsh/.credentials.yaml`，0600 校验）在 0.1.7→0.2.0 之间无任何改动 | **通过** |
| C7 | **但遥测出口端点发生变更**：`DSH_TELEMETRY_OTLP_URL` 缺省值由 `harness-telemetry.deepseeksvc.com` 改为 `dsh-otel-collector.deepseeksvc.com`，并新增 `maxRequestBytes: 4000000`、新增挂载 `@deepseek-ai/dsh-otel` 行。默认 `mode` 仍为 `FEEDBACK_ONLY`（仅在用户主动提交反馈后才上传），实际行为不变 | **需知悉** |
| C8 | **原生 addon 面健康**：6 个原生模块在 node v22.23.2 下全部加载成功，`node-pty` 真实 spawn PTY 成功（exit 0），landlock 沙箱 `probe()` 返回 `full`（"fully enforced"），与 0.1.7 一致 | **通过** |
| C9 | 安装期**无需联网除 registry 外**的额外主机；**无需 postinstall 即可工作**（本平台全部原生产物来自预编译可选依赖，未触发 gyp 构建） | 通过 |

---

## 2. 证据（当轮命令与版本号）

> **与并行轨道 T27（`reports/T27-npm-offline-packaging.md`）的关系**：
> T27 与本轨道在**同一台机上独立实测、互不共享中间结果**，在共同覆盖面上数值一致：
> 闭包 **606** 个包、`npm ci --offline` → `added 548 packages`、预热后 cacache **705 MiB**、
> 以及「只有 tgz 目录 + 空 cache ⇒ `ENOTCACHED`」这一反向结论。
> 本轨道**不重复** T27 已覆盖的打包/下载工程化内容（脚本化下载器、体量归因、逐包 sha256 全表），
> 增量集中在 T27 未覆盖的四个面：**① engines 满足性逐包判定；② `koffi` 精确锁定回退；**
> **③ 安全包 sandbox/approval/credentials 默认值 diff；④ `EBADPLATFORM` 平铺陷阱与 composition 遥测端点变更。**
> T27 用 `unshare -rn` 真·无网命名空间，本轨道用死代理（`HTTPS_PROXY=http://127.0.0.1:9`）+ 空 HOME——
> **两种网络隔离手段独立得出同一结论**，互为交叉验证。

### 2.1 运行时与平台

```
$ node -v            → v22.23.2
$ npm -v             → 10.9.8
$ ldd --version      → ldd (Ubuntu GLIBC 2.39-0ubuntu8.5) 2.39
$ uname -m           → x86_64
process.platform=linux  arch=x64  napi=10  modules ABI=127
no musl loader (/lib/ld-musl-x86_64.so.1 absent) ⇒ 纯 glibc 系统
```

构建工具链（仅在需要 gyp 回退时相关）：`python3=/usr/bin/python3`、`make=/usr/bin/make`、`gcc=/usr/bin/gcc`、全局 `node-gyp 13.0.2`（`~/.npm-global`）。

### 2.2 两个安装副本的在册版本（只读）

```
~/.npm-global/lib/node_modules/@deepseek-ai/dsh              → 0.1.1-rc.2   （现役 3080）
~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh       → 0.1.7-rc.2   （隔离 3097）
.workspace/dsh-020-pkg/x/package/package.json                → 0.2.0-rc.1   （CLI 解包件）
```

0.2.0 CLI 自身声明：`dependencies` 82 个、`devDependencies` 47 个、**无 `engines` 字段**（与 0.1.7 相同）。

### 2.3 依赖树解析方法（可复现）

```bash
export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs
# 0.2.0
npm install --package-lock-only --ignore-scripts --no-audit --no-fund @deepseek-ai/dsh@0.2.0-rc.1
# 0.1.7
npm install --package-lock-only --ignore-scripts --no-audit --no-fund @deepseek-ai/dsh@0.1.7-rc.2
# 另以 npm install --dry-run 交叉验证：0.2.0 "added 612 packages"
```

- `0.2.0-rc.1` lockfile：**612** 条 `packages` 入口，distinct tarball URL **606** 个
- `0.1.7-rc.2` lockfile：**593** 条入口
- 生成物：`.workspace/audit-020/t18/lock-020.json`、`lock-017.json`、`delta.json`
- 0.2.0 lockfile sha256：`68ec67521373fee5f82840f9022be4b15cbe352963dedac1cadeac216a418d3a`
  （副本存于 `.workspace/audit-020/offline/dsh-020.rc1.package-lock.json`）

`engines` 判定所用 semver 为仓库内实测安装的 `semver@7.8.5`（`.workspace/audit-020/t18/tools/`）。

---

## 3. 依赖树差异清单（0.1.7-rc.2 → 0.2.0-rc.1，含传递依赖）

规模对账（三路一致）：`npm ls --all` 实装 0.1.7 树 597 个不同包；lockfile 解析 0.1.7 = 593、0.2.0 = 612；`npm install --dry-run` 报 0.2.0 = 612。

### 3.1 新增（25 个）

**@deepseek-ai 新增 5 个**（均由上行包直接拉入）：

| 包 | 版本 | 拉入者 |
|---|---|---|
| `@deepseek-ai/dsh-experimental-schedule-bundle` | 0.2.0-rc.1 | `@deepseek-ai/dsh`（CLI 直依赖，**唯一新增的 CLI 直依赖**） |
| `@deepseek-ai/dsh-otel` | 0.2.0-rc.1 | `@deepseek-ai/dsh-base`（新挂载行） |
| `@deepseek-ai/dsh-host-product-telemetry-otel` | 0.2.0-rc.1 | `@deepseek-ai/dsh-web-app` |
| `@deepseek-ai/dsh-client-product-analytics` | 0.2.0-rc.1 | `@deepseek-ai/dsh-web-app` |
| `@deepseek-ai/dsh-client-ui-settings-session-log` | 0.2.0-rc.1 | `@deepseek-ai/dsh-web-app` |

**第三方新增 20 个**，全部由 `@deepseek-ai/dsh-otel` 拉入的 **got HTTP 栈**（纯 JS，无原生、无安装脚本）：

```
got@14.6.6
├─ @sindresorhus/is@7.2.0        ├─ cacheable-lookup@7.0.0
├─ byte-counter@0.1.0            ├─ cacheable-request@13.0.19
├─ decompress-response@10.0.0    ├─ form-data-encoder@4.1.0
├─ http2-wrapper@2.2.1           ├─ lowercase-keys@3.0.0
├─ mimic-response@4.0.0          ├─ normalize-url@8.1.1
├─ p-cancelable@4.0.1            ├─ responselike@4.0.2
├─ resolve-alpn@1.2.1            ├─ quick-lru@5.1.1
└─ type-fest@4.41.0
cacheable-request → http-cache-semantics@4.2.0, @types/http-cache-semantics@4.2.0, keyv@5.6.0
keyv → @keyv/serialize@1.1.1
```

第三方新增的 **engines 全部满足**（最严为 `got`/`byte-counter` 的 `>=20`）。

### 3.2 移除（6 个）

| 包 | 0.1.7 | 说明 |
|---|---|---|
| `@koromix/koffi-android-arm64` / `-android-x64` | 3.3.2 | koffi 平台变体（0.2.0 上游不再发布/不再解析） |
| `@koromix/koffi-linux-arm` / `-linux-ppc64` | 3.3.2 | 同上 |
| `@koromix/koffi-openbsd-arm64` | 3.3.2 | 同上 |
| `@opentelemetry/exporter-logs-otlp-http` | 0.220.0 | 改用新版 `@deepseek-ai/dsh-otel` 自带显式 OTLP JSON transport |

> 注意：这 6 项均为**平台变体或内部实现包**，不影响 linux/x64 运行时能力。`@opentelemetry/exporter-logs-otlp-http` 的移除与新 `dsh-otel` 的自建 `OTLPExporterBase` transport 是配套改动。

### 3.3 版本变化（第三方 16 个，全部是 `koffi` 一族；@deepseek-ai 289 个为 0.1.7-rc.2 → 0.2.0-rc.1 版号升迁）

**重大发现：`koffi` 回退。**

```
0.1.7 依赖声明：6 个包 → koffi: "^3.1.0"    ⇒ 实装落点 3.3.2
0.2.0 依赖声明：6 个包 → koffi: "3.1.1"      ⇒ 实装落点 3.1.1（精确锁定）
```

涉及包（两版完全相同的 6 个消费方）：
`dsh-fs-local`、`dsh-host-directory-picker-native`、`dsh-sandbox-windows-acl`、
`dsh-session-persistence-jsonl`、`dsh-subprocess-local`、`dsh-win32-process`。

- 性质：**不是版本倒退 bug，而是上游把范围锁成了精确版本**（`^3.1.0` → `3.1.1`）。registry 上 `koffi` 存在 3.1.1…3.3.2 全部版本。
- 影响：现役环境 `koffi 3.3.2` → 迁移后 `koffi 3.1.1`，是**行为等价的向下对齐**。本轮实测 `koffi@3.1.1` 在 node v22.23.2 下 `require` 成功、`koffi.version === "3.1.1"`。
- 迁移风险：**低**，但要注意——凡是对 `koffi` FFI 结构体/回调语义有依赖的本地插件，若曾按 3.3.x 行为调试过，迁移后应重测（本轨道未做插件级 FFI 行为回归，列入 §8 未验证项）。
- 附带收益：精确锁定消除了「同版本 DSH 在不同时间安装得到不同 koffi」的不可复现性（0.1.7 的 `^3.1.0` 就有这个隐患）。

**第三方大版本跃迁：0 个**（按 semver major 比对，`koffi` 3→3 属 minor 号段内的回退）。

### 3.4 `peerDependencies` 变化

- **无实质变化**：0.2.0 中 297 个包声明 peerDependencies，全部是 **DSH monorepo 内部包**的精确版号同步（`0.1.7-rc.2` → `0.2.0-rc.1`）或 `@deepseek-ai/cordis: ~4.0.4`（两版相同）。
- 与安全面相关的 5 个包（`dsh-sandbox-policy` / `dsh-sandbox-local` / `dsh-fs-sandbox` / `dsh-user-approval` / `dsh-credentials-local` / `dsh-permission-presets`）的 `peerDependencies` **集合完全相同**，仅版号同步。
- 原生相关的 peer：`@deepseek-ai/cordis-plugin-loader@1.0.5` → peer `node-addon-require-builtin: "^0.1.6"`，且 `peerDependenciesMeta` 标为 **optional**（两版一致）。
- 无新增的外部（非 `@deepseek-ai`）peer 依赖；`ws` / `zod` / `bufferutil` / `utf-8-validate` 的 peer 均为 optional，两版一致。

### 3.5 native addon 相关变化

实装 `.node` 产物（0.2.0 离线实装树，16 个）：

```
@koromix/koffi-linux-x64/{musl_x64,linux_x64}/koffi.node
@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.5.node
node-pty/prebuilds/<7 个平台>/pty.node|conpty.node          （0.1.7 同构，版本未变）
@deepseek-ai/node-addon-system-linux-x64/bin/{musl,glibc}/system.node
node-addon-require-builtin-linux-x64-gnu/prebuilt/linux-x64-gnu-napi-v9.node
sherpa-onnx-linux-x64/sherpa-onnx.node
```

| 原生包 | 0.1.7 | 0.2.0 | 变化 |
|---|---|---|---|
| `node-pty` | 1.2.0-beta.15 | 1.2.0-beta.15 | **无变化**（含预编译 prebuilds，无需 gyp） |
| `koffi` | 3.3.2 | **3.1.1** | 见 §3.3 |
| `sharp` | 0.35.4 | **0.35.5** | `@img/*` 全族同步；`@img/sharp-libvips-linux-x64` 1.3.3 → **1.3.4** |
| `@deepseek-ai/node-addon-system(-linux-x64)` | 0.1.2 | 0.1.2 | **无变化**（`engines.node: >=20`） |
| `node-addon-require-builtin(-linux-x64-gnu)` | 0.1.6 | 0.1.6 | **无变化**（`engines.node: >=20`） |
| `sherpa-onnx-node` / `-linux-x64` | 1.13.8 | 1.13.8 | **无变化** |
| `@vscode/ripgrep(-linux-x64)` | 1.18.0 | 1.18.0 | **无变化** |
| `node-addon-api` | 7.1.1 | 7.1.1 | **无变化** |

**`.node` 产物增减：0**（两版都是 15–16 个，差异只在 koffi 3.1.1 变体集合与 sharp 版本号）。
**gyp 构建：两版都不需要**（0.1.7 实装树中 `find -name '*.gyp'` 为空）。

---

## 4. engines 满足性判定（node v22.23.2）

### 4.1 总体

```
total resolved packages : 606   （有 name@version 的解析入口）
declare engines.node    : 196
  satisfied             : 195
  NOT satisfied         : 1
no engines.node         : 410
unparsable ranges       : 0
```

### 4.2 唯一不满足项

| 包 | engines.node | 后果 |
|---|---|---|
| `@img/sharp-win32-ia32@0.35.5` | `^20.9.0` | **无后果。** 该包 `os=["win32"] cpu=["ia32"]`，被声明为 optionalDependency；在 linux/x64 上 npm 直接跳过，永不安装。它不是「node 版本不合格」，而是「这条 win32 专用包的 range 写法比其他 sharp 变体旧」（同族其他变体都是 `>=20.9.0`）。**无需处理。** |

### 4.3 最严档（`>=22.19.0`，共 9 个）— 全部满足

```
@deepseek-ai/libreoffice-kit@0.1.2              >=22.19.0   SATISFIED
@deepseek-ai/libreoffice-kit-darwin-arm64@0.1.1 >=22.19.0   SATISFIED
@deepseek-ai/libreoffice-kit-darwin-x64@0.1.1   >=22.19.0   SATISFIED
@deepseek-ai/libreoffice-kit-wasm@0.1.1         >=22.19.0   SATISFIED
@deepseek-ai/libreoffice-kit-win32-arm64@0.1.2  >=22.19.0   SATISFIED
@deepseek-ai/libreoffice-kit-win32-x64@0.1.2    >=22.19.0   SATISFIED
@earendil-works/pi-ai@0.85.1                    >=22.19.0   SATISFIED
@earendil-works/pi-telemetry@0.85.1             >=22.19.0   SATISFIED
undici@8.11.2                                   >=22.19.0   SATISFIED
```

`node v22.23.2` ≥ `22.19.0` ✓。**这就是 0.2.0 的运行时下限，22.23.2 有 4 个 patch 的余量。**

### 4.4 其他档位的高水位

`>=20.19.0`(2)、`^18.19.0 || >=20.6.0`(9)、`>=20.9.0`(16)、`>=22`(2)、`>=22.12.0`(1)、
`>=20 <23`(1，node-addon-require-builtin-win32-ia32-msvc，win32 专用)、`>12.22.7`(1)。
全部满足。

### 4.5 DSH 自身包的 engines

`@deepseek-ai/dsh` 及其 296 个同族包中，**仅 11 个声明 engines 且全部满足**（6 个 `>=22.19.0`、5 个 `>=20`）；其余 285 个不声明。CLI 根包无 `engines` 字段。

### 4.6 现役本地插件（9 个）的 engines 交叉核验

| 插件 | 版本 | engines.node | 判定 |
|---|---|---|---|
| `@local/dsh-btw` | 0.4.0-btw.1 | `^22.19.0 \|\| >=24.0.0` | SATISFIED |
| `@local/dsh-pptmaster` | 0.1.0 | `^22.19.0 \|\| >=24.0.0` | SATISFIED |
| `@local/dsh-ssh-gui` | 0.2.0 | `^22.19.0 \|\| >=24.0.0` | SATISFIED |
| `@local/dsh-subagent-model` | 0.1.0 | `^22.19.0 \|\| >=24.0.0` | SATISFIED |
| `@local/dsh-usage` | 0.1.0 | `^22.19.0 \|\| >=24.0.0` | SATISFIED |
| `@local/dsh-workerspace` | 0.1.0 | `>=22.0.0` | SATISFIED |
| `@local/dsh-logfile` | 0.1.0 | — | 无 engines |
| `@local/dsh-wallpaper` | 0.5.0 | — | 无 engines |
| `@local/dsh-web-search-sse` | 0.1.0 | — | 无 engines |

**结论：node v22.23.2 对 0.2.0 上游闭包与现役本地插件均满足，无需升 node。**

### 4.7 运行时实测（不只是静态判定）

在离线实装树上直接加载原生模块：

```
koffi@3.1.1                                  OK   version=3.1.1
node-pty@1.2.0-beta.15                       OK   spawn=function
sharp@0.35.5                                 OK   sharp=0.35.5 vips=8.18.7
node-addon-require-builtin@0.1.6             OK   requireBuiltin,isAllowedInternalId,getBindingInfo,default
sherpa-onnx-node@1.13.8                      OK   24 exports
@deepseek-ai/node-addon-system/landlock-run  OK   LAUNCHER_BIN=landlock-run, FAILURE_EXIT=125
FAILURES: 0 / 6

node-pty 真实 spawn 功能测试：
  pty.spawn("/bin/bash", ["-c","echo HELLO_FROM_PTY; exit 0"])
  → pty exit=0 output="HELLO_FROM_PTY"

landlock 沙箱 probe：
  0.2.0 树 probe() => "full"（landlock-run --probe → "landlock: fully enforced", exit=0）
  0.1.7 树 同二进制同输出 "landlock: fully enforced", exit=0
```

---

## 5. 离线安装方案与 tgz 清单生成命令

### 5.1 安装期风险审计结论

| 风险面 | 实测结论 |
|---|---|
| 除 registry 外是否需联网 | **不需要**。全部 tarball 来自 `registry.npmjs.org`；无 git 依赖、无外部二进制下载、无脚本内 `curl/wget`。 |
| 是否需 postinstall | **不需要**（本平台）。带脚本的包仅 5 个（见下），且全部因预编译产物齐全而免执行/无副作用。 |
| 平台限定可选依赖 | **74 个**平台门控可选依赖（`os`/`cpu`/`libc` 门控），全部是 sharp / koffi / ripgrep / sherpa-onnx / libreoffice-kit / node-addon-system / node-addon-require-builtin 的多平台变体。linux-x64-glibc 正确落点为：`@img/sharp-linux-x64@0.35.5` + `@img/sharp-libvips-linux-x64@1.3.4`、`@koromix/koffi-linux-x64@3.1.1`、`@vscode/ripgrep-linux-x64@1.18.0`、`sherpa-onnx-linux-x64@1.13.8`、`@deepseek-ai/node-addon-system-linux-x64@0.1.2`、`node-addon-require-builtin-linux-x64-gnu@0.1.6`、`@deepseek-ai/libreoffice-kit-wasm@0.1.1`。 |
| `engines` 门控 | 无（0.2.0 无 `engine-strict`、无包因 node 版本被拒）。 |
| node-gyp 触发 | **未触发**。`node-pty` 的 `install: node scripts/prebuild.js \|\| node-gyp rebuild` 走 prebuild 分支成功；`koffi` 的 `install: node ./cnoke.cjs --prebuild` 因 `@koromix/koffi-linux-x64` 预编译产物存在而免构建。系统已备 python3/make/gcc/node-gyp 13.0.2 作兜底。 |

**带安装脚本的 5 个包（完整清单）**：

```
@deepseek-ai/dsh-subprocess-local@0.2.0-rc.1   postinstall: node scripts/ensure-spawn-helper.mjs
koffi@3.1.1                                     install:     node ./cnoke.cjs -P . -D src/koffi --prebuild --release
node-pty@1.2.0-beta.15                          install:     node scripts/prebuild.js || node-gyp rebuild
                                                postinstall: node scripts/post-install.js
protobufjs@7.6.6                                postinstall: node scripts/postinstall
@google/genai@1.52.0                            preinstall:  echo 'preinstall: no-op'
```
（两版对比：`koffi` 与 `node-pty` 的脚本形态在 0.1.7/0.2.0 间未变。）

### 5.2 推荐离线方案（已实测通过）

> **方案：预置 lockfile + 预热 npm cache + `npm ci --offline`。**
> 实测命令、死代理（`HTTPS_PROXY=http://127.0.0.1:9`）与空 `HOME` 下 2–3 秒完成，
> 装出 548 个包，与联网 `npm install` 结果**逐包一致**。

**为什么不能用「纯 tgz 目录 + `--offline`」**（本轮实测的两次失败，务必避开）：

1. **冷缓存必失败**：`npm ci --offline` / `npm install --offline` 在空 cache 下报
   `ENOTCACHED ... cache mode is 'only-if-cached' but no cached response is available`。
   即使 lockfile 已锁定全部版本，**npm 仍需 registry packument 才能解析传递依赖范围**。
   ⇒ 「离线」= lockfile **+ 预热 cache**，缺一不可。
2. **把平台门控可选依赖写成显式 `file:` 依赖会 `EBADPLATFORM`**：
   把 606 个 tarball 全部平铺成直接依赖后，npm 报
   `notsup Unsupported platform for @deepseek-ai/libreoffice-kit-darwin-arm64`（当前 linux/x64）。
   显式 `file:` 依赖不享受"平台不匹配则跳过"的可选语义。
   ⇒ 平铺清单**必须剔除 74 个 `os`/`cpu`/`libc` 门控包**，让它们作为传递 optionalDependency 自然解析；
   但这样又会把 linux 变体（含 musl）固化为直接依赖，**跨机器不可移植**。
   ⇒ 因此**推荐 lockfile 路线**，而非平铺路线。

**实测结果对照**

| 安装方式 | 结果 | 与联网安装差异 |
|---|---|---|
| `npm install`（联网） | 540 个不同包 | 基准 |
| `npm ci --offline`（lockfile + 预热 cache，死代理） | 542 个不同包 | 联网侧 0 个独有；离线侧多 2 个：`@img/sharp-linuxmusl-x64@0.35.5`、`@img/sharp-libvips-linuxmusl-x64@1.3.4`（glibc 系统上不加载，无害） |
| 平铺 520 个 `file:` 依赖 + `--offline` | 546 个包 | 可用但不推荐：linux 变体被固化，跨机器不可移植 |
| 平铺 606 个 `file:` 依赖（含门控包） | **失败** `EBADPLATFORM` | — |
| 空 cache + `--offline` | **失败** `ENOTCACHED` | — |

### 5.3 tgz 清单生成命令

```bash
# ---- 环境（前置，必须）----
export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs
BUNDLE=/home/CNS2026495165/dsh/.workspace/audit-020/offline
mkdir -p "$BUNDLE/tgz" "$BUNDLE/work" && cd "$BUNDLE/work"

# ---- 步骤 1：解析 authoritative lockfile（需一次联网，只读 packument，不装包）----
echo '{ "name": "dsh-020-bundle", "version": "1.0.0", "private": true }' > package.json
npm install --package-lock-only --ignore-scripts --no-audit --no-fund \
    @deepseek-ai/dsh@0.2.0-rc.1
# 期望输出：up to date in ~10-25s
# 期望：package-lock.json 含 612 条 packages 入口、606 个 distinct resolved URL
node -e 'const l=require("./package-lock.json");console.log("entries",Object.keys(l.packages).length-1)'
# 本轮实测 sha256：68ec67521373fee5f82840f9022be4b15cbe352963dedac1cadeac216a418d3a
cp package-lock.json "$BUNDLE/dsh-020.rc1.package-lock.json"

# ---- 步骤 2：生成 tgz 清单并下载全部 tarball（sha512 校验）----
# 脚本：.workspace/audit-020/t18/make-tgz-list.mjs
node /home/CNS2026495165/dsh/.workspace/audit-020/t18/make-tgz-list.mjs \
     "$BUNDLE/dsh-020.rc1.package-lock.json" \
     "$BUNDLE/tgz" \
     "$BUNDLE/tgz-plan.json"
# 期望输出：
#   distinct tarballs: 606 -> manifest .../tgz-plan.json
#   downloaded 606 already-present 0 failed 0 planned 606
# 期望体积：554 MB（606 个 tgz）

# ---- 步骤 3：预热 npm cache（离线安装的硬前提）----
# cache 复用步骤 1+2 写好的 $npm_config_cache。步骤 1 只写入 packument 条目；
# 必须再经一次联网解析/下载让 registry tarball 键也进入 cache，否则 --offline 仍 ENOTCACHED（见 §5.2）。
# 若需搬运到另一台机：整个 $npm_config_cache 目录一起拷
du -sh "$npm_config_cache"        # 预热完成后本轮实测 705M（主体为 _cacache）
# 交叉印证：独立轨道 T27 在相同路径测得同一数值 705 MiB
```

**tgz 清单本身**（606 行，含 sha512 与来源 URL）：
`.workspace/audit-020/t18/T18-tgz-manifest.tsv`

### 5.4 离线安装（目标机执行）

```bash
export npm_config_cache=<搬运过来的 cache 目录>
export npm_config_userconfig=<空文件>            # 隔离用户 npmrc，避免继承 registry 覆盖
export HOME=<空目录>                             # 隔离 HOME
export HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9   # 死代理：任何真实网络请求立即失败

mkdir -p /path/to/install && cd /path/to/install
cp <bundle>/dsh-020.rc1.package-lock.json ./package-lock.json
# npm ci 要求 package.json 与 lockfile 根依赖完全一致，否则静默跳过安装
node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync("package-lock.json","utf8")).packages[""];
fs.writeFileSync("package.json",JSON.stringify({name:r.name,version:r.version,private:true,dependencies:r.dependencies},null,1))'

npm ci --offline --ignore-scripts --no-audit --no-fund --loglevel=warn
# 期望输出：added 548 packages in ~3s      （本轮实测）
node -e 'console.log(require("./node_modules/@deepseek-ai/dsh/package.json").version)'   # 期望 0.2.0-rc.1
```

`--ignore-scripts` 后如需 `dsh-subprocess-local` 的 spawn-helper，单独补跑：

```bash
cd node_modules/@deepseek-ai/dsh-subprocess-local && node scripts/ensure-spawn-helper.mjs
```

---

## 6. 安全面默认值变化与迁移影响

### 6.1 逐包源码等价性（sha256 聚合比对，排除 package.json/README）

| 包 | 0.1.7 → 0.2.0 源码 | 差异细节 |
|---|---|---|
| `dsh-sandbox-policy` | **逐字节相同** | 仅 `package.json` 版号 |
| `dsh-fs-sandbox` | **逐字节相同** | 仅 `package.json` 版号 |
| `dsh-user-approval` | **逐字节相同** | 仅 `package.json` 版号 |
| `dsh-credentials-local` | **逐字节相同** | 仅 `package.json` 版号 |
| `dsh-sandbox` | **逐字节相同** | 仅 `package.json` 版号 |
| `dsh-sandbox-local` | **有改动**（552→556 行，6 行 diff） | 新增 win32-only ACL 诊断技能注册 |
| `dsh-permission-presets` | **有改动**（667 行，2 行 diff） | 仅 `SessionEventMap` 类型声明增补事件 |

唯一实质代码改动（`dsh-sandbox-local/lib/index.js`）：

```diff
-import { AclWriteGrant, assertTempRootOutsideWorkspace, tempWriteSid, workspaceWriteSid } from "@deepseek-ai/dsh-sandbox-windows-acl";
+import { AclWriteGrant, assertTempRootOutsideWorkspace, registerAclDiagnosisSkill, tempWriteSid, workspaceWriteSid } from "@deepseek-ai/dsh-sandbox-windows-acl";
...
+/* v8 ignore next 3 -- Windows-only registration; the Linux coverage lane cannot take this branch */
+if (process.platform === "win32" && this.runnerCommand === void 0) ctx.inject(["skills"], (skillsCtx) => {
+    registerAclDiagnosisSkill(skillsCtx);
+});
```

⇒ **linux 路径行为零变化**（`process.platform === 'win32'` 短路）。无新增默认值、无新增配置项。

`dsh-permission-presets` 的 2 行 diff 只发生在 `lib/typert.host.js` 的**类型声明字符串**里（`feedback/record`、`goal/change`、`feedback/message-put/delete`、`schedule/change` 的声明位置重排），**无 preset 默认值变化**。

### 6.2 默认值逐条核对（`dsh-base/cordis.patch.yml`，两个版本行号仅差 1）

| 配置项 | 默认值（0.1.7 = 0.2.0） | 迁移影响 |
|---|---|---|
| 沙箱模式 | `mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'` | **无变化。** 现役 workspace-write 语义保持 |
| 沙箱工作根 | `workspaceRoot: process.cwd()` | **无变化** |
| 审批策略 | `policy: (DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'` | **无变化。** 现役（workspace-write）继续为 `ask` |
| 权限预设三元组 | `read-only→ask` / `workspace-write→ask` / `danger-full-access→never` | **无变化** |
| `dsh-bash-sandbox` / `dsh-fs-sandbox` / `dsh-sandbox-local` / `dsh-sandbox-policy` / `dsh-user-approval` / `dsh-permission-presets` 挂载行 | 完全一致 | **无变化** |
| 凭据存储 | `~/.dsh/.credentials.yaml`（`CREDENTIALS_FILENAME = ".credentials.yaml"`，`resolve(config.path ?? join(resolveDshHome(config.dshHome), ".credentials.yaml"))`） | **无变化**（两版源码同哈希） |
| 凭据文件权限 | POSIX 下启动时校验 group/other 位，非 0600 直接抛错并提示 `chmod 600` | **无变化。** 迁移不会放宽也不会收紧 |
| 凭据加密方式 | 文件型明文 YAML（`version: 1` / `refs:`），**无加密**，靠 0600 + 目录权限保护 | **无变化**（安全性未提升，也未退步） |

**⇒ 结论：现役沙箱/审批/凭据配置迁移到 0.2.0 无需任何默认值适配。**

### 6.3 唯一的配置面变化：遥测出口端点（`dsh-base/cordis.patch.yml`）

```diff
+    - id: otel
+      name: '@deepseek-ai/dsh-otel'
+
     - id: session-telemetry-otel
       name: '@deepseek-ai/dsh-session-telemetry-otel'
       config:
         mode: !!js process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'
         shutdownTimeoutMillis: 3000
+        maxRequestBytes: 4000000
         exporter:
-          url: !!js process.env.DSH_TELEMETRY_OTLP_URL ?? 'https://harness-telemetry.deepseeksvc.com/v1/logs'
+          url: !!js process.env.DSH_TELEMETRY_OTLP_URL ?? 'https://dsh-otel-collector.deepseeksvc.com/v1/logs'
           compression: gzip
           timeoutMillis: 1000
```

| 变化 | 迁移影响 |
|---|---|
| 缺省出口 URL 改为 `dsh-otel-collector.deepseeksvc.com` | 若现役**未**设置 `DSH_TELEMETRY_OTLP_URL`（本轮实测当前进程 env 中 `DSH_TELEMETRY_*` / `DSH_PERMISSION_MODE` / `DSH_PRODUCT_ANALYTICS_*` 全部未设置），迁移后缺省目标随之更换。因 `mode=FEEDBACK_ONLY`，**仅在用户主动提交反馈时才可能外发**，日常活动不外发 |
| 新增 `maxRequestBytes: 4000000` | 仅影响大 payload 分片；无安全语义变化 |
| 新增 `@deepseek-ai/dsh-otel` 挂载行 | 该包是**纯 transport**（`createLogExporter` / `OTLPExporterBase`），无自动采集；挂载本身不发送任何数据 |
| `got@14.6.6` 随之进入依赖树 | 纯 JS HTTP 客户端，无原生、无安装脚本、engines `>=20` |

### 6.4 新增的产品遥测面：**在 web profile 下不可达**（重点核实）

`@deepseek-ai/dsh-web-app` 新增两个直接依赖，且在 `web-app/cordis.patch.yml` 新增两行：

```yaml
- id: desktop-product-telemetry
  name: '@deepseek-ai/dsh-host-product-telemetry-otel'
  disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"
  config:
    serviceName: deepseek-harness-desktop
    serviceVersion: !!js process.env.DSH_CLIENT_VERSION
    endpoint: !!js process.env.DSH_PRODUCT_ANALYTICS_OTLP_URL

- id: product-analytics
  name: '@deepseek-ai/dsh-client-product-analytics'
  disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"
  config:
    enabled: true
    appVersion: !!js process.env.DSH_CLIENT_VERSION
```

- 两行**均以 `profileContext.name !== 'desktop'` 为 disabled 条件** ⇒ 现役与目标部署走 **web profile**，两行始终 disabled，**不挂载、不外发**。
- 该包 schema 对 `endpoint` 的缺省值为 `https://dsh-otel-collector.deepseeksvc.com/v1/logs`，但只有在 desktop profile 且未被 env 覆盖时才可能用到。
- `dsh-web-app` 的另一处新增 `ui-settings-session-log` 是设置页入口（Session 日志导出面板），与遥测无关。
- **⇒ 对现役 web 部署无迁移影响。** 若将来上 desktop 版，需重新评估。

### 6.5 其他 composition 变化（安全性无关，供交叉参考）

`dsh-web-app/cordis.patch.yml`（562 → 565 行）除上述两行外：
- **移除** `time-context`、`schedule`、`ui-schedule` 三行（均为 `disabled: true`），改由新增的 `dsh-experimental-schedule-bundle`（CLI 直依赖）承载；
- **新增** `ui-settings-session-log` 一行。
- 这些行原本就是 disabled 或纯 UI，**无安全面影响**。

---

## 7. 安装 Runbook

### 7.1 联网路径（简化，当前机器可用）

```bash
export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs

# 全新隔离前缀安装（勿动 ~/.npm-global*，勿动现役/隔离副本）
PREFIX=/home/CNS2026495165/dsh/.workspace/audit-020/t18/install-prefix
npm install --prefix "$PREFIX" --ignore-scripts --no-audit --no-fund @deepseek-ai/dsh@0.2.0-rc.1
echo "exit=$?"          # 期望 0
node -e "console.log(require('$PREFIX/node_modules/@deepseek-ai/dsh/package.json').version)"
# 期望输出：0.2.0-rc.1
```

**期望输出**：`added 612 packages`（dry-run 计数）/ 实装约 548 个可加载包（平台门控项按 linux/x64 收敛）。
**耗时**：本轮实测冷装 ~3–25 秒（cache 已预热时）。

### 7.2 完全离线路径（推荐，已实测）

见 §5.3（打包侧三步）+ §5.4（安装侧）。关键断言点：

| 检查 | 期望 | 失败处置 |
|---|---|---|
| `npm install --package-lock-only` | `up to date`，612 条入口 | 检查 `npm_config_cache` 可写、registry 可达 |
| `make-tgz-list.mjs` | `downloaded 606 ... failed 0` | `failed>0` 时按 URL 单独重试；`FILENAME COLLISION` 说明命名规则被破坏（不应发生） |
| bundle 体积 | 554 MB / 606 tgz | 体积显著偏小 ⇒ 存在 0 字节或残缺文件，重跑（脚本按 sha512 校验并重下） |
| `npm ci --offline` | `added 548 packages`，exit 0 | `ENOTCACHED` ⇒ **cache 没预热到位**（见 §7.3）；`EBADPLATFORM` ⇒ 误把门控包写成显式依赖（改用 lockfile 路线）；`npm ci` 静默跳过 ⇒ package.json 根依赖与 lockfile 不一致 |
| 安装后 CLI 版本 | `0.2.0-rc.1` | — |
| `koffi` 版本 | `3.1.1`（**预期回退，不是故障**） | 若期望 3.3.2，需改本地上游依赖范围，属产品决策 |
| `landlock-run --probe` | `landlock: fully enforced`, exit 0 | 非 0 ⇒ 内核 Landlock 不可用，沙箱降级 |

### 7.3 失败处置速查

| 症状 | 根因 | 处置 |
|---|---|---|
| `ENOTCACHED ... only-if-cached` | cache 为空/不完整 | 预热 cache（§5.3 步骤 1+3），或改用联网安装 |
| `EBADPLATFORM ... libreoffice-kit-darwin-arm64` | 把平台门控可选依赖写成了显式依赖 | 改用 lockfile 路线；平铺路线须剔除 `os`/`cpu`/`libc` 门控包 |
| `npm ci` 报错要求 package.json 与 lockfile 一致 | 根依赖不匹配 | 按 §5.4 从 lockfile 的 `packages[""]` 生成 package.json |
| `npm ci` 提示 `up to date` 但没装任何包 | 上一行的静默形态 | 同上；确认 `package.json.dependencies` 与 lock 根完全一致 |
| `koffi` 装成 3.1.1 | **设计如此**（精确锁定） | 不是故障；如需 3.3.x 属产品改动 |
| `node-pty` 触发 node-gyp 构建失败 | prebuild 缺失 | 系统已有 python3/make/gcc/node-gyp 13.0.2；或保持 `--ignore-scripts` 并用预编译 prebuilds（本轮实测 linux-x64 prebuild 齐全） |
| 凭据文件权限报错 | `.credentials.yaml` 非 0600 | `chmod 600 ~/.dsh/.credentials.yaml`（0.1.7 起既有行为，非 0.2.0 新增） |

---

## 8. 未验证项

以下**本轮未实测**，不得据本报告推断为「已验证」：

1. **完整运行时启动未测。** 未启动 `dsh` 进程、未加载 profile、未验证 0.2.0 在本机真实 boot（受轨道约束：不启动监听端口、不发模型请求）。本报告的 engines 与原生结论基于**静态解析 + 模块加载级实测**。
2. **本地插件（9 个）在 0.2.0 下的加载兼容性未测。** 仅核验了它们声明的 engines 满足性；未测其与 0.2.0 的 API/设置命名空间兼容性（属其他轨道）。
3. **koffi 3.3.2 → 3.1.1 的行为回归未测。** 仅验证 `require` 与 `koffi.version`；未对任何 FFI 调用路径（结构体布局、回调、异步）做行为对比。
4. **`dsh-session-query-sqlite` 的 sqlite 依赖未审计。** 该包在 `dsh-otel` 引入的 `got` 栈之外另有原生面，本轮未展开其 `.node` 产物来源。
5. **`@deepseek-ai/libreoffice-kit-wasm@0.1.1` 的 wasm 运行时未加载验证**（`dsh-skill-office` 路径）。
6. **跨机器离线可移植性未实测。** 本轮的 606-tgz bundle 与安装均在**同一台 linux/x64/glibc 2.39** 上完成；未在第二种平台验证，也未测 musl 目标。`npm ci --offline` 路线的 cache 需要同机预热这一限制已在 §5.2 说明，但「拷到另一台 glibc 机器后 cache 仍可复用」**未验证**。
7. **`npm audit` 安全漏洞面未做。** 本轮未跑 `npm audit`，未审计 CVE。§6 的「安全面」仅指 sandbox/approval/credentials 的**默认值与语义**。
8. **`dsh-experimental-schedule-bundle` 的内容与行为未审计**（仅确认它是 CLI 唯一新增直依赖、并被 composition 用于替代原 `time-context`/`schedule` 行）。
9. **0.1.1-rc.2 → 0.2.0 的直接差异未展开。** 本轨道按任务要求以 0.1.7 为基线；现役是 0.1.1，其 62 个 CLI 直依赖与 0.1.7 的 81 个之间存在额外落差，未纳入本次依赖树 diff。
10. **遥测默认端点的可用性/归属未核实。** 仅记录 URL 字符串变化（`harness-telemetry` → `dsh-otel-collector`），未解析 DNS、未验证证书或归属方。

---

## 附：本轮证据文件索引（均在 `.workspace/audit-020/t18/`）

| 文件 | 内容 |
|---|---|
| `lock-020.json` / `lock-017.json` | 两版完整解析树（612 / 593 条） |
| `delta.json` / `delta.txt` | 新增/移除/版本变化三类差异原始清单 |
| `manifests-020.json` | 0.2.0 闭包全部 612 个包的 registry manifest（engines/os/cpu/libc/scripts/peer） |
| `engines-report.txt` | engines 判定完整输出 |
| `check-engines.mjs` / `diff-trees.js` / `fetch-manifests.mjs` | 本轮分析脚本 |
| `make-tgz-list.mjs` | 离线 bundle 构建器（Runbook 步骤 2） |
| `T18-tgz-manifest.tsv` | **606 个 tarball 清单**（文件名 + sha512 + URL） |
| `tgz-plan.json` | 同一清单的结构化形式（含 `usedBy` 反查） |
| `sec/{0.1.7-rc.2,0.2.0-rc.1}/` | 7 个安全面包的源码对照解包件 |
| `base/{0.1.7-rc.2,0.2.0-rc.1}/` | `dsh-base` composition 对照解包件 |
| `wa017/web-app-017`、`wa/web-app-020` | `dsh-web-app` composition 对照解包件 |
| `tele/` | 新增遥测包解包件（`dsh-otel` 等 5 个） |
| `../offline/tgz/` | 554 MB / 606 个 tarball（全部 sha512 校验通过） |
| `../offline/dsh-020.rc1.package-lock.json` | 权威 lockfile（sha256 `68ec6752…`） |
