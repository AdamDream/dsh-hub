# T27 — DSH 0.2.0 离线安装包集与打包方案

- 审计轨道：T27（审计阶段，只产出结论与方案，未改产品代码）
- 审计对象：`@deepseek-ai/dsh@0.2.0-rc.1` 的**完整安装闭包**解析、离线下载、离线安装实测与 Runbook
- 审计时间：2026-09-29（当轮实测，所有结论绑定本轮真实下载与真·无网安装）
- 工作区：`/home/CNS2026495165/dsh/.workspace/iso-020/`
- 环境：Node `v22.23.2` / npm `10.9.8` / Linux `6.14.0-27-generic` x64 / registry `https://registry.npmjs.org/`

---

## 1. 结论摘要

| # | 结论 | 判定 |
|---|---|---|
| C1 | **0.2.0 安装闭包已完整解析并落盘**：`@deepseek-ai/dsh@0.2.0-rc.1` 的实际安装闭包为 **606 个包（name@version）**，全部拿到 `resolved` tarball URL + `sha512` integrity，无一条缺失 | ✅ 已实测 |
| C2 | **已实际下载整个闭包**：**607 个 tgz / 552.4 MiB / 105.4 s**（并发 6），逐包校验 npm `sha512` integrity **607/607 通过**，0 失败 | ✅ 已实测 |
| C3 | **离线安装已实测成功**：在 `unshare -rn` 真·无网命名空间内（前置断言 `NET_UNREACHABLE: EAI_AGAIN`），预热 cacache + `npm install --offline` → **`added 546 packages in 12s`**；`npm ci --offline` → **`added 548 packages in 3s`** | ✅ 已实测 |
| C4 | **无任何 native addon 需要编译**：闭包内 5 个带 install 脚本的包全部走**预编译产物**（`node-pty` 自带 7 平台 prebuilds、`koffi` 走 `@koromix/koffi-*` 预编译包、`sharp` 走 `@img/sharp-*`、`sherpa-onnx-*`、`@deepseek-ai/node-addon-system-linux-x64`）。离线安装**不需要 node-gyp / gcc / python** | ✅ 已实测（koffi / sharp / node-pty 实际 `require` 成功） |
| C5 | **规模主要由跨平台二进制造成，而非 JS**：552.4 MiB 中 **499.1 MiB（90.4%）属于 74 个 os/cpu 限定包**；其中 `@deepseek-ai/libreoffice-kit` 五平台变体合计 **307.9 MiB**、sharp 家族 **102.3 MiB**、`sherpa-onnx-*` **59.9 MiB**、ripgrep **22.8 MiB**。**linux-x64 相关子集仅 542 个包 / 128.3 MiB**（可省 423.8 MiB / 64 个包） | ✅ 已实测 |
| C6 | **值得缓存，且缓存放工作区**：npm cache 默认路径只读（`EROFS`），必须重定向到工作区；预热后 cacache 705 MiB，可支持 `npm ci --offline` 3 秒级重建 | ✅ 已实测 |
| C7 | **仅"tgz 目录"本身不足以离线安装**：`npm cache add <tgz>` 只写入 `pacote:tarball:file:...` 键，缺 registry packument，`--offline` 直接 `ENOTCACHED`。离线包必须包含**预热后的 cacache**（或额外产出 registry 元数据） | ✅ 反向实测（有价值） |
| C8 | 打包命令序列**可直接复制执行**：见 §6，`WORK=<工作区> bash bin/dl-020.sh all '@deepseek-ai/dsh@0.2.0-rc.1' 0.2.0-rc.1 6`。脚本已在本轮被真实执行并产出全部交付物（dogfooding） | ✅ 已实测 |
| C9 | **下载集 607 ≠ 闭包 606**：多出的 `@xterm/headless@6.1.0-beta.303` 是自研解析器的 prerelease 排序余量（npm 正确解析为 `6.0.0`），**不参与安装**。两份 sha256 清单已分别覆盖"`pkgs/` 全量 607"与"闭包子集 606"，无歧义 | ✅ 已实测 |

**总判定：审计**「方案可行且已落地」——离线安装包集已就位，Runbook 命令已在本轮真实跑通，后续执行档可直接复制使用。

---

## 2. 证据（命令与真实输出）

### E1 环境与 npm 前置

```
$ node -v ; npm -v
v22.23.2
10.9.8
$ npm config get cache            # 未重定向时
/home/CNS2026495165/.npm/_cacache
```

本轮全部 npm 操作均显式设置（协调者已实测默认 cache 只读 `EROFS`）：

```
export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs
```

### E2 registry 可达性 + 版本存在性

```
$ npm view @deepseek-ai/dsh@0.2.0-rc.1 dist.tarball dist.integrity --json
{
  "dist.tarball": "https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.1.tgz",
  "dist.integrity": "sha512-F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng=="
}
(real 0m0.415s)

$ npm view @deepseek-ai/dsh versions --json   # 过滤后
total versions: 28
with 0.2.0: 0.2.0-rc.1
last 8: 0.1.5-rc.3, 0.1.6-alpha.1, 0.1.6-alpha.2, 0.1.7-alpha.1, 0.1.7-alpha.2, 0.1.7-rc.1, 0.1.7-rc.2, 0.2.0-rc.1
```

→ `0.2.0-rc.1` 是当前最新发布版；根包 tgz 已由协调者下载，本轮独立复核 sha256 一致：

```
$ sha256sum .workspace/dsh-020-pkg/deepseek-ai-dsh-0.2.0-rc.1.tgz
ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216
$ grep 'deepseek-ai-dsh-0.2.0-rc.1.tgz' manifests/dsh-0.2.0-rc.1.sha256
ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216  deepseek-ai-dsh-0.2.0-rc.1.tgz
```

两条独立下载路径得到同一 sha256 → 清单与协调者 tarball **互相印证**。

### E3 闭包解析（npm Arborist 权威路径 + 自研递归解析器交叉校验）

**主路径**：用一个只声明 root 依赖的干净工程调 `npm install --package-lock-only`，让 npm 自己的 Arborist 解析：

```
$ cd .workspace/iso-020/lockgen && npm install --package-lock-only --include=optional --no-audit --no-fund
up to date in 10s        (real 0m9.907s)

lockfileVersion: 3
entries: 612             # packages 表（含嵌套层级）
distinct names: 594
multi-version names: 12
  @smithy/node-http-handler 4.12.1,4.7.3
  @aws-sdk/token-providers 3.1138.0,3.1048.0
  chokidar 5.0.0,4.0.3
  readdirp 5.1.1,4.1.2
  fflate 0.8.2,0.8.3
  @opentelemetry/core 2.9.0,2.11.0
  @opentelemetry/resources 2.9.0,2.11.0
  negotiator 0.6.4,1.1.0
  debug 2.6.9,4.4.3
  ms 2.1.3,2.0.0
  path-key 4.0.0,3.1.1
  powershell-utils 0.2.1,0.1.0
entries without resolved: 0        # 全部有 tarball URL
link entries: 0
platform-specific entries: 74
hasInstallScript/gypfile: 5
```

**关键交叉验证 1 — 无 devDependencies 泄漏**：用 `--omit=dev` 再生成一份锁文件并逐条对比：

```
$ npm install --package-lock-only --omit=dev --include=optional ...
full: 594   omitdev: 594
ONLY_IN_FULL (0):
ONLY_IN_OMITDEV (0):
VERSION_DIFF: (无)
```

→ 闭包中不含 CLI 的 `devDependencies`（`@types/js-yaml`、`@types/ws` 确实不在闭包内）。个别 CLI devDep 名（如 `ws`、`execa`、`ajv`、`@agentclientprotocol/sdk`）出现在闭包中，是因为它们**同时**是某些插件运行时的 prod 依赖，不是 devDep 泄漏。与 0.1.7 实测口径一致（0.1.7 的 profile 安装就是"CLI prod 闭包"的形态）。

**交叉验证 2 — 自研递归解析器**：`bin/resolve-closure.mjs` 直接走 registry abbreviated metadata（`application/vnd.npm.install-v1+json`）递归展开 `dependencies` + `optionalDependencies`（**不做 os/cpu 过滤，产出全平台超集**）：

```
packages=567 edges=1840 problems=18 platformSpecific=74 nativeCandidates=0
```

`problems=18` 全部是 `version-conflict`（同名多版本，npm 用嵌套解决，扁平清单需并列保留），例如：

```
{"reason":"version-conflict","name":"chokidar","wanted":"5.0.0","already":"4.0.3","from":"@deepseek-ai/dsh-skill-filesystem@0.2.0-rc.1"}
{"reason":"version-conflict","name":"debug","wanted":"4.4.3","already":"2.6.9","from":"http-proxy-agent@7.0.2"}
```

两条路径的差异（自研解析器 567 vs 锁文件 594 名）**全部**是 27 个 `@deepseek-ai/dsh-*` 包——它们是**通过 `peerDependencies` 引入**的，自研解析器只展开 `dependencies`/`optionalDependencies`，故漏；npm Arborist 会把 peer 依赖实体化安装。**并且自研解析器在 `@xterm/headless` 上把 `6.1.0-beta.303` 误选为最高版本（prerelease 排序缺陷）**，npm 正确解析为 `6.0.0`。

> **裁决：以 npm 生成的 `package-lock.json` 为权威闭包**（它就是真正执行安装的引擎），自研解析器仅作为 `optionalDependencies`/platform/native 候选的辅助识别。下载集 = 锁文件闭包 ∪ 解析器补充（仅多出 `@xterm/headless@6.1.0-beta.303` 这一个余量包，无坏处）。

### E4 manifest 与下载

```
$ WORK=/home/CNS2026495165/dsh/.workspace bash bin/dl-020.sh resolve '@deepseek-ai/dsh@0.2.0-rc.1' 0.2.0-rc.1
[resolve] npm Arborist 解析 @deepseek-ai/dsh@0.2.0-rc.1 -> .../lockgen/0.2.0-rc.1/package-lock.json
up to date in 371ms
[resolve] manifest: 606 个包 -> .../meta/manifest-0.2.0-rc.1.json
packages=567 edges=1840 problems=18 platformSpecific=74 nativeCandidates=0

$ node bin/fetch-pkgs.mjs meta/manifest-draft.json pkgs 6
  ... 50/607 (1s)   ... 200/607 (5s)   ... 350/607 (63s)   ... 600/607 (99s)
total=607 downloaded=607 cached=0 failed=0 bytes=579240676 (552.4 MiB) elapsed=105.4s
```

下载报告：`meta/download-report.json`（607 条，每条含 `name/version/integrity/tarball/file/bytes/sha256/status`）。

### E5 sha256 清单与独立复核

```
$ WORK=... bash bin/dl-020.sh verify 0.2.0-rc.1
[verify] 全量 607 个 tgz -> .../manifests/dsh-0.2.0-rc.1.sha256
[verify] 闭包 606/606 个 tgz -> .../manifests/dsh-0.2.0-rc.1.closure.sha256
[verify] 注意：pkgs/ 内有 1 个闭包之外的余量 tgz（见 closure 清单差异，不影响安装）
[verify] sha256sum -c 通过（独立复核，全量）
[verify] pkgs/*.tgz 实际 607 个，清单 607 行

$ cd pkgs && sha256sum -c ../manifests/dsh-0.2.0-rc.1.sha256 --quiet
（无输出即全部通过）
SHA256 MANIFEST OK
```

→ 用系统 `sha256sum` 独立重算全部 607 个 tgz，与生成器结果一致（非脚本自证）；且 `pkgs/` 内无未被清单覆盖的文件（607 = 607）。

**两份清单的分工**（避免把"下载到什么"和"闭包要什么"混为一谈）：

| 清单 | 行数 | 含义 |
|---|---|---|
| `manifests/dsh-0.2.0-rc.1.sha256` | **607** | `pkgs/` 实际全部内容，`sha256sum -c` **全量可校验** |
| `manifests/dsh-0.2.0-rc.1.closure.sha256` | **606** | 安装真正用到的闭包子集 |

两者差 1 个文件 = `xterm-headless-6.1.0-beta.303.tgz`（见 §E3 的自研解析器 prerelease 排序余量，npm 正确版本是 `6.0.0`，已在闭包内）。该余量包**不参与安装**，保留仅为完整性证据。

### E6 体积与耗时

| 阶段 | 命令 | 真实耗时 | 体积 |
|---|---|---|---|
| 解析（首次，含全量 packument 拉取） | `npm install --package-lock-only` | 9.9 s | — |
| 解析（二次命中缓存） | 同上 | 0.37 s | — |
| 自研递归解析器 | `resolve-closure.mjs` | ~55 s | — |
| **下载闭包** | `fetch-pkgs.mjs`（并发 6，manifest 当时为 607 条超集） | **105.4 s** | **552.4 MiB**（607 tgz） |
| 重复下载（幂等，全部命中） | 同上 | 0.9 s | 0 变更 |
| 解包为目录源 | `tar -xzf` × 607 | ~60 s | 1.6 GiB |
| 种子化空 cache | `seed-cache.sh` | 110.4 s | 552.8 MiB |
| **离线安装（install）** | `unshare -rn npm install --offline` | **12.1 s** | 521 MiB node_modules |
| **离线安装（ci）** | `unshare -rn npm ci --offline` | **2.85 s** | 521 MiB node_modules |
| 工作区 cacache（预热后） | — | — | 705 MiB |

吞吐：552.4 MiB / 105.4 s ≈ **5.24 MiB/s**（并发 6）。

### E7 最大包（说明体积构成）

```
    68.06 MiB  deepseek-ai-libreoffice-kit-win32-x64-0.1.2.tgz
    65.51 MiB  deepseek-ai-libreoffice-kit-darwin-x64-0.1.1.tgz
    64.81 MiB  deepseek-ai-libreoffice-kit-win32-arm64-0.1.2.tgz
    63.62 MiB  deepseek-ai-libreoffice-kit-darwin-arm64-0.1.1.tgz
    45.85 MiB  deepseek-ai-libreoffice-kit-wasm-0.1.1.tgz
    13.27 MiB  sherpa-onnx-linux-arm64-1.13.8.tgz
    10.67 MiB  sherpa-onnx-darwin-x64-1.13.8.tgz
    10.58 MiB  sherpa-onnx-linux-x64-1.13.8.tgz
     9.58 MiB  sherpa-onnx-darwin-arm64-1.13.8.tgz
     8.52 MiB  img-sharp-libvips-darwin-x64-1.3.4.tgz
```

---

## 3. 依赖闭包清单

- 权威闭包：**606 个 `name@version`**（来自 `lockgen/0.2.0-rc.1/package-lock.json`，`--omit=dev` 已交叉验证等价）
- 分类：平台限定 **74** 个 / CLI 直接依赖 **82** 个（全部命中闭包，0 缺失）/ 其余为传递依赖
- **包·版本·tgz sha256 全表**（606 行）：`meta/closure-table.md`
- **CLI 直接依赖解析表**（82 行，声明 range → 解析版本 → sha256 前缀）：`meta/direct-deps.md`
- **机器可读 manifest**：`meta/manifest-0.2.0-rc.1.json`
- **sha256 清单**：`manifests/dsh-0.2.0-rc.1.sha256`（607 行，`pkgs/` 全量）；`manifests/dsh-0.2.0-rc.1.closure.sha256`（606 行，闭包子集）

### 3.1 CLI 直接依赖（82 个）解析摘要

全部 82 条均命中闭包（`notFound: []`）。其中 4 条非 `@deepseek-ai/` 三方依赖为：

| 直接依赖 | 声明 range | 解析版本 |
|---|---|---|
| `commander` | `^15.0.0` | 15.0.0 |
| `js-yaml` | `^4.2.0` | 4.3.2 |
| `node-addon-require-builtin` | `^0.1.6` | 0.1.6 |
| `@deepseek-ai/cordis` | `~4.0.4` | 4.0.4 |
| `@deepseek-ai/cordis-plugin-include` | `~1.0.9` | 1.0.9 |
| `@deepseek-ai/cordis-plugin-loader` | `~1.0.5` | 1.0.5 |
| `@deepseek-ai/cordis-plugin-timer` | `~1.1.6` | 1.1.6 |
| `@deepseek-ai/schemastery` | `~3.18.4` | 3.18.4 |

其余 74 条为 `@deepseek-ai/dsh-*@0.2.0-rc.1` 精确版本（全部为 `0.2.0-rc.1`）。完整 82 行见 `meta/direct-deps.md`。

### 3.2 平台限定包（74 个 / 499.1 MiB）按家族

| 家族 | 条目数 | 合并体积 | 说明 |
|---|---|---|---|
| `@deepseek-ai/libreoffice-kit-{darwin-*,win32-*,wasm}` | 5 | **307.9 MiB** | LibreOffice 运行时，每平台一个 ~64-68 MiB 大包；其中 `-wasm` 45.85 MiB |
| `@img/sharp-*` + `@img/sharp-libvips-*` | 25 | **102.3 MiB** | sharp 0.35.5 的 libvips 预编译产物（glibc/musl × 6 架构 × 多 OS） |
| `sherpa-onnx-*` | 6 | **59.9 MiB** | 语音输入（`dsh-experimental-voice-input-bundle`）的 onnx runtime 二进制 |
| `@vscode/ripgrep-*` | 12 | **22.8 MiB** | ripgrep 单文件二进制（`dsh-tool-fs-search` 依赖） |
| `@koromix/koffi-*` | 15 | **5.5 MiB** | koffi 3.1.1 FFI 预编译产物（15 个平台/OS 组合） |
| `node-addon-require-builtin-*` | 7 | **0.7 MiB** | 原生 require 垫片 |
| `@deepseek-ai/node-addon-system-{linux,darwin}-{x64,arm64}` | 4 | **0.1 MiB** | 系统信息原生 addon |
| **合计** | **74** | **499.1 MiB** | 即 §E6 中 552.4 MiB 的 90.4% |

> 注意 `@deepseek-ai/libreoffice-kit-wasm@0.1.1` 声明 `os:["linux"]` 但 `cpu` 为空（wasm，全架构通用），因此计入 linux-x64 子集。

### 3.3 同名多版本（12 组，扁平化时必须并列保留）

`@smithy/node-http-handler`(4.12.1/4.7.3)、`@aws-sdk/token-providers`(3.1138.0/3.1048.0)、`chokidar`(5.0.0/4.0.3)、`readdirp`(5.1.1/4.1.2)、`fflate`(0.8.2/0.8.3)、`@opentelemetry/core`(2.9.0/2.11.0)、`@opentelemetry/resources`(2.9.0/2.11.0)、`negotiator`(0.6.4/1.1.0)、`debug`(2.6.9/4.4.3)、`ms`(2.1.3/2.0.0)、`path-key`(4.0.0/3.1.1)、`powershell-utils`(0.2.1/0.1.0)

---

## 4. 离线安装实测结果

测试机为 `unshare -rn` 真·无网命名空间（未使用 `sandbox_permissions`，未启动任何监听端口）。

### 4.1 反向测试（失败，有价值）：仅 tgz 目录 + 空 cache

```
$ npm cache add <607 个本地 tgz>          # 只写入 pacote:tarball:file: 键
seeded=607 failed=0

$ unshare -rn npm install --offline       # cache 为空目录
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/@deepseek-ai%2fdsh failed:
          cache mode is 'only-if-cached' but no cached response is available.
          at RegistryFetcher.packument (pacote/lib/registry.js:90:19)
```

叠加的 netns 断言证明该环境确实无网：

```
NET_UNREACHABLE: EAI_AGAIN
```

**结论 C7**：`npm cache add <本地 tgz>` 生成的缓存键是

```
pacote:tarball:file:/home/CNS2026495165/dsh/.workspace/iso-020/pkgs/js-yaml-4.3.2.tgz
```

——**含绝对路径且不是 registry 键**，`--offline` 解析 packument 时是 cache-miss。**离线包不能只给 tgz；必须包含预热后的 cacache（含 registry packument + registry tarball 键）**。

### 4.2 主测试（成功）：预热 cacache + 真·无网 + `npm install --offline`

```
$ unshare -rn sh -c 'node -e "fetch(...)"'
NET_UNREACHABLE: EAI_AGAIN

$ cd off-test/app && unshare -rn npm install --offline --no-audit --no-fund
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 546 packages in 12s
real 0m12.105s

$ node -e 'console.log(require("./node_modules/@deepseek-ai/dsh/package.json").version)'
0.2.0-rc.1
$ ls node_modules/@deepseek-ai | wc -l
289
$ du -sh node_modules
521M
```

> 546 = 606 − 60：`--include=optional` 生成的锁文件记录了全部平台变体，但实际安装时 npm 会按当前平台 `os`/`cpu` 过滤掉不匹配的 optional 包（安装后锁定 612 条 / 实际落地 546 个）。这是**正确行为**，不是缺包。
>
> 形态 1（`npm ci`）落地 **548 个**、形态 2（`npm install` 无锁文件）落地 **546 个**，差 2 个的原因是两者的 lock 状态不同：`npm ci` 用的是 Arborist 全平台 lock（612 条），`npm install` 现场重新求解；两者都通过自检。差异属正常范围，**不是缺包**。

### 4.3 主测试变体（成功，最快）：`npm ci --offline`

```
$ cp lockgen/0.2.0-rc.1/{package.json,package-lock.json} off-test-ci/
$ cd off-test-ci && unshare -rn npm ci --offline --no-audit --no-fund
added 548 packages in 3s
real 0m2.849s
dsh version: 0.2.0-rc.1
```

**推荐路径**：带锁文件 + 预热 cacache + `npm ci --offline` → 3 秒级、可复现、零网络。

### 4.4 功能校验：native addon 真实加载

```
$ unshare -rn node -e '<require koffi / sharp / node-pty> ...'
koffi OK: function 3.1.1
sharp OK: 0.35.5
node-pty OK, exports: native,spawn,fork,createTerminal,open

$ unshare -rn node lib/node_modules/@deepseek-ai/dsh/lib/bin.js --version
0.2.0-rc.1
（exit=0，无监听端口，无模型请求）
```

### 4.5 交付形态：预置 node_modules 树（推荐给迁移执行档）

```
$ cp -a off-test/app/node_modules ship-test/lib/node_modules    # 换个全新路径
$ unshare -rn node lib/node_modules/@deepseek-ai/dsh/lib/bin.js --version
bin --version => 0.2.0-rc.1
$ du -sh lib/node_modules
521M

$ cd off-test-popt   # 预置 node_modules + 空 cache + 真·无网
$ unshare -rn npm install --offline
up to date in 431ms          # 零下载、零 registry 依赖
```

→ 521 MiB 的 `node_modules` 树**位置无关**，可直接拷贝为离线交付物，不依赖 registry、不依赖 cacache。

---

## 5. 平台限定与 native addon 说明

### 5.1 是否有需要编译的 native addon —— **没有**

锁文件里 5 个带 install 脚本/gypfile 的包，全部是**预编译分发**：

| 包 | 版本 | 形态 | 离线安装影响 |
|---|---|---|---|
| `node-pty` | 1.2.0-beta.15 | 自带 `prebuilds/{linux,darwin,win32}-{x64,arm64}/pty.node`（7 平台） | 无（postinstall 只做 prebuild 选择） |
| `koffi` | 3.1.1 | 主包 + `optionalDependencies: @koromix/koffi-<os>-<cpu>`（15 个预编译包） | 无；**linux-x64 需要 `@koromix/koffi-linux-x64` 在闭包内** |
| `@google/genai` | 1.52.0 | install 脚本非编译（无 gyp） | 无 |
| `protobufjs` | 7.6.6 | postinstall 仅生成静态 JS | 无 |
| `@deepseek-ai/dsh-subprocess-local` | 0.2.0-rc.1 | 非编译脚本 | 无 |

实际运行验证：`unshare -rn` 无网环境下 `koffi` / `sharp` / `node-pty` 三个 native 模块全部 `require` 成功（见 4.4）。

**结论**：离线安装**不需要 node-gyp、gcc/g++、make、python3**，也**不需要预先下载 node-gyp 头文件**（`~/.cache/node-gyp` 无需准备）。

### 5.2 平台限定可选依赖清单（离线包必须覆盖目标平台）

若离线包只面向 **linux-x64**（glibc），必须包含以下"平台分支中与 linux-x64 匹配"的那一个：

- `@koromix/koffi-linux-x64@3.1.1`
- `@img/sharp-linux-x64@0.35.5` + `@img/sharp-libvips-linux-x64@1.3.4`
- `@vscode/ripgrep-linux-x64@1.18.0`
- `@deepseek-ai/node-addon-system-linux-x64@0.1.2`
- `node-addon-require-builtin-linux-x64-gnu@0.1.6`
- `sherpa-onnx-linux-x64@1.13.8`
- `@deepseek-ai/libreoffice-kit-wasm@0.1.1`
- `node-pty` 主包（自带 prebuilds，非 `optionalDependencies`）

**缺失后果**：npm 在离线安装时会因 optional 包缺失而**静默跳过**（optional 语义），CLI 仍能装上但相关功能在运行时报错——例如缺 `@koromix/koffi-linux-x64` 则 koffi 加载失败，缺 `@vscode/ripgrep-linux-x64` 则 `grep` 工具不可用。因此**离线包应做安装后自检**（见 §7 的 smoke test）。

### 5.3 musl（Alpine）注意

闭包同时包含 glibc 与 musl 两套 sharp 的 linux 预编译包（`@img/sharp-linuxmusl-*`），**无需额外处理**。但 `@vscode/ripgrep-linux-x64` 只有 glibc 变体（无 musl 专用包），`@deepseek-ai/node-addon-system-linux-x64` 同时含 `bin/glibc/system.node` 与 `bin/musl/system.node`（单包双 ABI）。

### 5.4 跨平台不可替代性

74 个平台限定包中 **64 个 / 423.8 MiB 与 linux-x64 无关**（darwin、win32、linux-arm/arm64/ppc64/riscv64/s390x、freebsd、openbsd、wasm32、ia32）。它们是否纳入离线包，是一个**召回 vs 体积**的取舍：

| 方案 | 包数 | 体积 | 适用 |
|---|---|---|---|
| **A 全平台超集（本轮采用，推荐）** | 606 / 607 tgz | **552.4 MiB** | 一次下载，任意平台/架构可离线安装；无需因换机器重下 |
| B 仅 linux-x64 | 542 | **128.3 MiB**（省 423.8 MiB） | 明确只在 linux-x64 部署；换平台（含 arm64 服务器、musl）需重下 |

**建议采用 A**：552 MiB 相对工作区（本工作区已用数 GiB）成本可接受，避免迁移期间因平台变更返工。若磁盘紧张，B 方案可用 manifest 的 `os`/`cpu` 字段一条命令筛出：

```bash
node -e 'const m=require("./meta/manifest-0.2.0-rc.1.json");
console.log(m.entries.filter(e=>(!e.os||e.os.includes("linux"))&&(!e.cpu||e.cpu.includes("x64"))).map(e=>e.name+"@"+e.version).join("\n"))'
```

---

## 6. Runbook 命令序列（可直接复制执行）

> 全部命令只写 `<WORK>` 内路径（`WORK` 必须是工作区绝对路径）。
> 前置：`WORK=/home/CNS2026495165/dsh/.workspace`；脚本已落盘在本轮工作区。

### 6.0 准备（一次性）

```bash
export WORK=/home/CNS2026495165/dsh/.workspace
export npm_config_cache="$WORK/npm-cache"        # 默认 ~/.npm/_cacache 只读(EROFS)，必须重定向
export npm_config_logs_dir="$WORK/npm-logs"
mkdir -p "$WORK/npm-cache" "$WORK/npm-logs"
```

### 6.1 下载闭包（扩展版 dl.sh，支持 0.2.0）

```bash
WORK=/home/CNS2026495165/dsh/.workspace \
  bash "$WORK/iso-020/bin/dl-020.sh" all '@deepseek-ai/dsh@0.2.0-rc.1' 0.2.0-rc.1 6
```

内部等价于三步（可分开跑，见 `bin/dl-020.sh` 源码 `resolve` / `download` / `verify` 子命令）：

```bash
# (a) 解析闭包 -> meta/manifest-0.2.0-rc.1.json（npm Arborist，--omit=dev，含全部平台 optional）
# (b) 并发下载  -> pkgs/*.tgz + meta/download-report.json（逐包 sha512 integrity 校验）
# (c) 生成 sha256 清单 -> manifests/dsh-0.2.0-rc.1.sha256（全量 607）
#                              manifests/dsh-0.2.0-rc.1.closure.sha256（闭包 606）
```

预期输出：`total=607 downloaded=607 cached=0 failed=0 bytes=579240676 (552.4 MiB) elapsed≈105s`

### 6.2 校验（sha256 清单 + 独立复核）

```bash
WORK=/home/CNS2026495165/dsh/.workspace \
  bash "$WORK/iso-020/bin/dl-020.sh" verify 0.2.0-rc.1
# 实测输出：
#   [verify] 全量 607 个 tgz -> .../manifests/dsh-0.2.0-rc.1.sha256
#   [verify] 闭包 606/606 个 tgz -> .../manifests/dsh-0.2.0-rc.1.closure.sha256
#   [verify] sha256sum -c 通过（独立复核，全量）
#   [verify] pkgs/*.tgz 实际 607 个，清单 607 行

# 只要纯校验（不重生成），也可直接：
cd "$WORK/iso-020/pkgs"
sha256sum -c ../manifests/dsh-0.2.0-rc.1.sha256 --quiet && echo "SHA256 MANIFEST OK"
```

- `manifests/dsh-0.2.0-rc.1.sha256`（**607** 行）= `pkgs/` 全量，`sha256sum -c` 原生兼容（`<sha256>  <文件名>`，两空格）。
- `manifests/dsh-0.2.0-rc.1.closure.sha256`（**606** 行）= 安装真正用到的闭包子集。
- 两者差 1 = `xterm-headless-6.1.0-beta.303.tgz`（余量包，不参与安装）。
- 配套核对包数：`ls *.tgz | wc -l` 应为 **607**。

### 6.3 离线安装（三种形态，按部署场景选）

**形态 0（最省事，一键验收）：直接用验收脚本**

```bash
WORK=/home/CNS2026495165/dsh/.workspace \
  bash "$WORK/iso-020/bin/offline-verify.sh" 0.2.0-rc.1 ci
# mode: ci | install   日志自动落 $WORK/iso-020/logs/offline-verify-<时间戳>.log
# 实测输出（ci 模式）：
#   --- 闸门：断言无网命名空间内网络不可达 ---
#   NET_UNREACHABLE: EAI_AGAIN
#   --- 离线安装（cache=.../npm-cache）---
#   added 548 packages in 3s     real 0m2.781s
#   --- 自检 ---
#   dsh: 0.2.0-rc.1 / native addons OK / ripgrep OK / 0.2.0-rc.1
#   ### PASS：真·无网离线安装 + 自检全部通过
```

脚本内置**网络闸门**：先在 `unshare -rn` 内断言 registry 不可达（`NET_REACHABLE` 则直接 `exit 1`），再执行安装与自检——避免"以为离线其实联网"的假验收。

**形态 1（推荐，最快）：带锁文件 + 预热 cacache + `npm ci --offline`**

```bash
# 离线包需同时携带：manifests/ + meta/manifest-*.json + lockgen/<tag>/package-lock.json + npm-cache/
APP="$WORK/iso-020/target"                 # 目标安装目录（工作区内）
mkdir -p "$APP" && cd "$APP"
cp "$WORK/iso-020/lockgen/0.2.0-rc.1/package.json" .
cp "$WORK/iso-020/lockgen/0.2.0-rc.1/package-lock.json" .
export npm_config_cache="$WORK/npm-cache"
npm ci --offline --no-audit --no-fund      # 实测：added 548 packages in 3s（真·无网）
```

**形态 2：`npm install --offline`（无锁文件，按 semver 重解析）**

```bash
mkdir -p "$WORK/iso-020/target2" && cd "$WORK/iso-020/target2"
printf '{"name":"dsh-020","version":"0.0.0","private":true,"dependencies":{"@deepseek-ai/dsh":"0.2.0-rc.1"}}\n' > package.json
export npm_config_cache="$WORK/npm-cache"
npm install --offline --no-audit --no-fund  # 实测：added 546 packages in 12s（真·无网）
```

**形态 3（完全不吃 registry / 不吃 cache）：预置 node_modules 树**

```bash
# 离线包携带 521 MiB 的 node_modules 树；部署即拷贝，位置无关（已实测换路径可直接运行）
mkdir -p "$APP/lib"
tar -xzf dsh-020-node_modules-0.2.0-rc.1.tgz -C "$APP/lib"
cd "$APP" && ./lib/node_modules/.bin/dsh --version    # => 0.2.0-rc.1
```

### 6.4 安装后自检（smoke）

```bash
cd "$APP"
node -e 'console.log("dsh:", require("./node_modules/@deepseek-ai/dsh/package.json").version)'
node -e 'require("node-pty"); require("sharp"); require("koffi"); console.log("native addons OK")'
node -e 'require.resolve("@vscode/ripgrep-linux-x64/package.json"); console.log("ripgrep OK")'
./node_modules/.bin/dsh --version      # 只读；勿在此步启动 web 服务
```

本轮实测输出：

```
dsh: 0.2.0-rc.1
native addons OK
ripgrep OK
0.2.0-rc.1
```

> 自检项均已逐条实跑。注意 `@vscode/ripgrep-linux-x64` 没有 `main` 导出（纯二进制包），必须用
> `require.resolve("@vscode/ripgrep-linux-x64/package.json")` 校验，直接 `require(...)` 会失败。

### 6.5 打包为可搬运归档（可选）

```bash
cd "$WORK/iso-020"
tar -cf - pkgs manifests meta/manifest-0.2.0-rc.1.json lockgen bin \
  | zstd -19 -T0 -o dsh-020-offline-0.2.0-rc.1.tar.zst      # 或 gzip -9
# 若采用形态 1/2，附带预热 cacache（+705 MiB）：
tar -cf - -C "$WORK" npm-cache | zstd -19 -T0 -o dsh-020-npm-cache-0.2.0-rc.1.tar.zst
```

---

## 7. 失败处置

| 症状 | 根因 | 处置 |
|---|---|---|
| `npm error code EROFS` / cache 写失败 | 默认 cache `~/.npm/_cacache` 只读 | 必须 `export npm_config_cache=<WORK>/npm-cache`（§6.0） |
| `npm error code ENOTCACHED ... only-if-cached but no cached response` | 缓存里只有 `pacote:tarball:file:...` 键（仅 `npm cache add <本地 tgz>`），缺 registry packument | ①用 §6.3 形态 1/2（预热 cacache）；②或补种子：在**有网**机器跑一次 `npm ci`（同一 `npm_config_cache`）后再归档；③或回退形态 3（预置 node_modules） |
| `integrity mismatch (sha512)` / `EINTEGRITY` | tgz 损坏或中间人 | 删该 tgz 重下：`rm pkgs/<file> && node bin/fetch-pkgs.mjs meta/manifest-0.2.0-rc.1.json pkgs 6`（幂等，只补缺失）；仍失败则比对 `manifests/dsh-0.2.0-rc.1.sha256` 与 registry `dist.integrity` 是否漂移（**发布方重新发版**才可能漂移，需重跑 `dl-020.sh resolve` 出新 manifest） |
| 缺包（`failed>0` 或安装后 `Cannot find module`） | 下载中断 / optional 平台分支缺失 | 补缺失：`fetch-pkgs.mjs` 可重复运行，只下缺的；平台分支缺失见 §5.2 清单逐条确认 |
| `--offline` 报某 optional 包 404 | 该 optional 包不在离线包内 | optional 语义下 npm 会跳过而不报错；若确实需要，按 `manifest` 的 `os`/`cpu` 补下该平台变体 |
| 换机器/换平台安装失败 | 离线包只含单平台子集（方案 B） | 切方案 A 全平台超集，或在新平台重跑 `dl-020.sh resolve` 生成新 manifest |
| `npm ci` 报 `lock file does not satisfy` | 携带的锁文件与 package.json 不匹配 | 用同一 tag 目录下的 `package.json` + `package-lock.json` **成对**拷贝（`lockgen/<tag>/`） |

**幂等性**：`fetch-pkgs.mjs` 对已存在且 sha256 匹配的 tgz 直接跳过（`status: cached`），可安全反复运行补齐缺失；`seed-cache.sh` 同理可重复。

**幂等性回归实测**（`download` 连跑 2 次）：

```
[merge] 既往账本 607 条，可沿用 607 条
total=607 downloaded=1 cached=606 failed=0 bytes=579240676 (552.4 MiB) elapsed=0s
[merge] 既往账本 607 条，可沿用 607 条
total=607 downloaded=1 cached=606 failed=0 bytes=579240676 (552.4 MiB) elapsed=0s
```

> 注：`downloaded=1` 是因为本轮为恢复被 §7.1-D2 旧脚本丢弃的余量包条目而人工补录了一条（正常"首次全量下载"时为 `downloaded=607`）。

### 7.1 本轮修复的两个脚本缺陷（幂等回归测试发现）

| 缺陷 | 现象 | 修复 |
|---|---|---|
| **D1 `verify` 的全量清单来源于"本次运行报告"** | 重跑 `download` 后全量清单由 607 行缩到 606 行，`pkgs/` 出现**未被清单覆盖**的 tgz（仅 `[verify] WARN`） | `verify` 改为**直接扫描 `pkgs/*.tgz` 用系统 `sha256sum` 现算**，不依赖任何报告；清单与目录数量不一致时 `exit 1` 硬失败（原先只是 WARN） |
| **D2 `fetch-pkgs.mjs` 账本合并判定用了对象引用比较** | `prev.root === manifest.root` 对**对象**恒为 `false`（内容相同也 false），导致每次重跑都按"新闭包"重建账本，历史条目（含余量包）被丢弃：实测 `ledger 607 → 606` | 改为 `JSON.stringify(prev.root ?? null) === JSON.stringify(manifest.root ?? null)`；输出改为**本轮结果 ∪ 既往有效条目**的并集，使账本单调只增；新增 `[merge]` 日志便于观测 |

两个缺陷均已修复，并用**连跑 2 次 `download`** 的回归测试验证账本稳定在 607。这属于打包工具链自身的质量，直接影响"离线包完整性可追溯"，故记录在案。

---

## 8. 体积与缓存评估（C6 展开）

- **下载闭包 552.4 MiB**；解包成目录源 1.6 GiB；预热 cacache 705 MiB；安装后 `node_modules` 521 MiB。
- **是否值得缓存：值得。** 理由（均为本轮实测数字）：
  1. 一次下载 105 s、552 MiB，换来**后续所有安装零网络**；
  2. `npm ci --offline` **2.85 s** 完成（对比有网首次安装同量级 10 s 起 + 可能受网络波动）；
  3. 迁移期需要**反复重建**安装树（多轮试装/回退/对照隔离环境），缓存把每轮成本从"网络下载"降到"本地解包"。
- **缓存放哪：必须放工作区内。** 本机 `~/.npm/_cacache` 只读（实测 `EROFS`），且硬约束禁止写 `~/.npm-global*/`、`~/.dsh/**`、`~/.dsh-017/**`。建议：
  - 工作区缓存：`<WORK>/npm-cache`（本轮实际使用，705 MiB）
  - 若需与其它审计轨道隔离，用 `npm_config_cache=<WORK>/iso-020/cache-<tag>` 每 tag 一份（注意会重复占用 ~700 MiB）
- **压缩潜力**：`pkgs/*.tgz` 已是压缩包，二次压缩收益有限（预计 5-10%）；真正的体积杠杆是 §5.4 的方案 A/B 取舍（423.8 MiB）。

---

## 9. 未验证项（明确边界）

1. **未在有网环境重跑一次"从零预热 cache"**：本轮 `npm-cache` 的预热由协调者前期操作与本轮 `npm install`/`npm ci` 共同完成，因此 cacache 具体由哪一次操作写入哪些键**未逐键审计**；只验证了"该 cacache 足以支撑真·无网 `npm install`/`npm ci`"这一结果（4.2/4.3）。→ 执行档若要**全新**产出可搬运 cache，请显式跑一次 §6.3 形态 1（有网）+ `tar` 归档，再在无网机验收。
2. **未验证"纯目录源（`pkgs-extracted/` 作为 registry 替换）"的完整离线安装**。已实测的偏差：把 root 依赖写成 `file:` 只安装 1 个包（`added 1 package in 162ms`），说明本地目录源需要**逐包改写依赖为 file: 的锁文件**才能闭环。该路径未完成验证，故**不推荐**；`pkgs-extracted/`（1.6 GiB）仅作为 tgz 的可选解包形式保留，**不参与推荐 Runbook**。
3. **未验证 0.2.0 的"部署形态"**（profile 目录、`~/.dsh` 迁移、settings 兼容、web 构建产物）——属其它审计轨道范围；本轮只证明"依赖闭包可完整到手并离线安装"，未证明"安装即可正常启动/服务"。
4. **未验证非 linux-x64 平台的离线安装**（darwin/win32/linux-arm64/musl）。闭包**已收录**这些平台的包（方案 A），但安装动作仅在 linux-x64 上实测。
5. **未验证 `bin/dl-020.sh` 对 0.1.x 版本的兼容**。脚本设计上通用（spec/tag 参数化），但本轮只对 `0.2.0-rc.1` 实跑；0.1.1/0.1.5/0.1.7 的回归未做（历史 `dl.sh` 的 0.1.x 产物仍在 `workbuddy-reverse-proxy/_audit/sub/`）。
6. **`resolve-closure.mjs` 的两个已知缺陷**（已在本报告 §E3 记录，不影响权威闭包）：不展开 `peerDependencies`；prerelease 最高版本排序缺陷（把 `@xterm/headless@6.1.0-beta.303` 误选为最高）。它以辅助角色留在工具链中，**权威闭包一律取 npm 锁文件**。
7. **未做安装树的运行时功能回归**（只做了 `--version` 与 native `require` smoke）；`dsh web` 等需监听端口的验证按硬约束未执行。
8. **本轮在审计过程中修复了打包脚本自身的 2 个缺陷（§7.1 D1/D2）**：`dl-020.sh` 的 `verify` 与 `fetch-pkgs.mjs` 的账本合并。两处均已用回归测试验证。除 `bin/` 下这三个脚本（`dl-020.sh` / `fetch-pkgs.mjs` / 新增 `offline-verify.sh`）外，**未改动任何产品代码**。
9. **`iso-020/` 下存在并发写入者（非本轮产物）**：本轮执行期间，另有进程在 `iso-020/npm-global/` 目录（`package.json` 声明 `"@deepseek-ai/dsh": "^0.2.0-rc.1"`，含 540 MiB `node_modules`）执行 0.2.0 安装。它不是本 T27 轨道的产物，也**不参与**本报告任何结论。本轮交付物已在其存在的情况下做过完整复核：`pkgs/` 607 个 tgz、`sha256sum -c` 607/607 通过、manifest 606 条、账本 607 条，均未被污染。若后续执行档要复用 `iso-020/`，请注意该目录可能被其它轨道同时使用（建议各轨道使用独立子目录 + 独立 `npm_config_cache`）。

---

## 10. 交付物索引

| 路径（相对 `<WORK>=/home/CNS2026495165/dsh/.workspace`） | 说明 |
|---|---|
| `iso-020/pkgs/*.tgz` | **607 个 tgz，552.4 MiB**（下载完毕的唯一真实产物） |
| `iso-020/manifests/dsh-0.2.0-rc.1.sha256` | **607 行** sha256 清单（`pkgs/` 全量，`sha256sum -c` 兼容，已独立复核） |
| `iso-020/manifests/dsh-0.2.0-rc.1.closure.sha256` | **606 行** sha256 清单（闭包子集） |
| `iso-020/meta/manifest-0.2.0-rc.1.json` | 606 条权威闭包（含 `os`/`cpu`/`hasInstallScript`/`integrity`/`tarball`） |
| `iso-020/meta/download-report.json` | 下载账本：**607** 条（每包状态、字节数、sha256、失败列表），单调只增、可重复运行（见 §7.1） |
| `iso-020/meta/closure-table.md` | 闭包全表（包·版本·sha256·体积·类别，606 行） |
| `iso-020/meta/direct-deps.md` | CLI 82 个直接依赖的 range→解析版本对照 |
| `iso-020/meta/closure-resolver-0.2.0-rc.1.json` | 自研递归解析器输出（platform/native 候选交叉校验） |
| `iso-020/lockgen/0.2.0-rc.1/{package.json,package-lock.json}` | **离线安装形态 1 所需的锁文件对** |
| `iso-020/lockgen-omitdev/package-lock.json` | `--omit=dev` 交叉验证证据（与 full 逐条等价） |
| `iso-020/bin/dl-020.sh` | **扩展版下载脚本**（resolve/download/verify/all 四个子命令） |
| `iso-020/bin/offline-verify.sh` | **一键离线验收脚本**（网络闸门 + 离线安装 + 自检，ci/install 两模式） |
| `iso-020/bin/resolve-closure.mjs` | registry 递归闭包解析器（辅助） |
| `iso-020/bin/fetch-pkgs.mjs` | 并发下载 + sha512 integrity 校验 + sha256 记录（幂等） |
| `iso-020/bin/seed-cache.sh` | 用本地 tgz 种子化空 cache（注：仅够 `cache add`，不足以 `--offline`，见 C7） |
| `iso-020/off-test/{app,cache-empty,npm-logs}` | 离线安装主测试现场（负向 + 正向日志） |
| `iso-020/off-test-ci/` | `npm ci --offline` 测试现场 |
| `iso-020/off-test-popt/` | 预置 node_modules 形态测试现场 |
| `iso-020/off-test-file/` | 纯目录源测试现场（**负向结论**，见 §9.2） |
| `iso-020/ship-test/lib/node_modules` | 可搬运安装树样本（521 MiB，已验位置无关） |
| `iso-020/meta/notes.txt` | 各阶段真实耗时汇总 |
| `iso-020/pkgs-extracted/` | tgz 解包目录源（1.6 GiB，**不推荐路径，仅供参考**） |
