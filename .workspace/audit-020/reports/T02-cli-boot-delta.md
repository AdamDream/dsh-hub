# T02 — CLI 与启动引导层源码增量审计（0.1.7-rc.2 → 0.2.0-rc.1）

- 轨道：T02（审计阶段，只读；除 `.workspace/**` 外未写任何路径）
- 审计时间：2026-09-29（当轮实测）
- 对照物：`deepseek-ai-dsh-0.1.7-rc.2.tgz` / `deepseek-ai-dsh-0.2.0-rc.1.tgz`（`workbuddy-reverse-proxy/_audit/sub/`）
- 产物目录：`.workspace/audit-020/{extracted,packs,probe,evidence,fakehome,fakehome017}`
- 硬约束遵守：未启动任何监听端口的服务；未发起模型请求；未改 `~/.dsh/**`、`~/.dsh-017/**`、`~/.npm-global*/**`、仓库既有文件

---

## 1. 结论摘要

**核心结论：CLI 与启动引导层在 0.1.7-rc.2 → 0.2.0-rc.1 之间是「代码零增量」。**

1. **`@deepseek-ai/dsh`（CLI 包）整个 tarball 20 个文件里只有 1 个不同：`package.json`。**
   `lib/*.js`（7 个）与 `lib/types/*.d.ts`（8 个）**逐个 sha256 完全相同**；`README*/LICENSE` 也逐字节相同。
   `package.json` 的差异也只是：`version`、`dependencies` 73 个钉版本号、`devDependencies` 41 个钉版本号，
   外加 `dependencies` **新增 1 个条目** `@deepseek-ai/dsh-experimental-schedule-bundle`。
   `bin` / `exports` / `type` / `main` / `files` / `scripts` **完全未变**。
2. **运行中的 0.1.7 安装（3097 实例）里的 CLI 文件与 0.2.0-rc.1 tarball 逐字节相同**；
   从 npm 真实安装出来的 0.2.0 CLI 的 `lib/` 也与 tarball 逐字节相同。⇒ CLI 行为不可能因版本而变。
3. **引导层依赖同样几乎全冻结**：`dsh-app-boot` 的**唯一代码差异**是 `OPTIONAL_BUNDLES` 增加一行
   `"@deepseek-ai/dsh-experimental-schedule-bundle"`（1 个 hunk，+1 行）。
   `dsh-home-paths` / `dsh-cmdline` / `dsh-launch-environment` / `dsh-http-proxy` / `dsh-atomic-write` /
   `dsh-plugin-manager` **只有 `package.json` 的版本位不同**，`lib/**` 与 `lib/types/**` 全部逐字节相同。
4. **路径与引导约定零变化**：`$DSH_HOME`（`DSH_HOME` 环境变量 > `~/.dsh`）、`profiles/`、`cordis.patch.yml`、
   `cordis.yml`、`pnpm-workspace.yaml`、`compatibility.json`、双锚解析（安装锚优先 → profile 目录）
   **全部与 0.1.7 相同**；默认 profile 名集合 `acp / web / headless / sdk / sdk-minimal` 未变；
   `DSH_*` 环境变量名集合**无增无减**（`DSH_HOME` / `DSH_TELEMETRY_DISABLED` / `DSH_SNAPSHOT` /
   `DSH_LAUNCH_ENVIRONMENT_KEY`）。
5. **历史"官方包重指符号链接"策略在 0.2.0 已不存在——而且在 0.1.7 就已不存在**：
   `@deepseek-ai/*` 全树**没有任何符号链接创建代码**（0.2.0 安装树命中数 0；0.1.7 唯一 `symlinkSync` 命中是
   无关的 `@img/sharp-wasm32` 预编译胶水）。该策略属于 0.1.5 时代的 link backend（`symlinkSync(target, link, "junction")` + 重指逻辑）。
   启动期唯一的符号链接变更是 `removeLinkProjections`：**只** unlink 指向 `<profile>/.dsh-module-fallback/node_modules`
   的链接并删除该遗留目录，"从不剪枝非官方条目"这半个断言在 0.2.0 仍成立。
6. **无新增 onboarding / 无新增硬编码中文**：CLI 包与全部引导层依赖的 `.js` 中 **CJK 命中数均为 0**。
   客户端里存在 onboarding（`dsh-client-ui-settings-general` 的 `useOnboardingSteps`），但 0.1.7 与 0.2.0
   是**同一段实现**（片段逐字相同），不是 0.2.0 新增；客户端 `client.js` 里的中文来自内联 `const zh = {...}`
   locale 表，属合法 i18n，不是硬编码文案。
7. **对隔离根的直接含义**：0.2.0 迁移在"CLI/启动引导"这一层**没有需要改的东西**；
   风险不在 CLI 代码，而在 (a) 依赖闭包与 bundle 补丁内容的增量（属 T01），
   (b) 老 `DSH_HOME` 首次被 0.1.7+ 启动时会执行 `removeLinkProjections` 的破坏性清理，
   (c) `DSH_HOME` 只能由继承环境提供，**不能写进 `.env`**。

---

## 2. 证据（当轮实测命令与输出摘要）

> 所有 boot/dump 探针均把 `DSH_HOME` 指向 `.workspace/audit-020/` 内目录；未对 3080/3097 做任何操作。
> 两端口在本轮始终 LISTEN（`ss -ltn` 复核），未被我触碰。

### E1 tarball 真实性（绑定 npm registry integrity）

```
$ openssl dgst -sha512 -binary <tgz> | openssl base64 -A
0.1.7-rc.2 : SQFhriLvza8GnFApnC5/32AgpcyKxrWnYXhvwDOLJdgWpkCX2EexyR9c8kCkMITJXnFLEN3Qb2CEh0W36vkLyw==
0.2.0-rc.1 : F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng==

$ npm view @deepseek-ai/dsh@0.2.0-rc.1 dist.integrity
sha512-F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng==
$ npm view @deepseek-ai/dsh@0.1.7-rc.2 dist.integrity
sha512-SQFhriLvza8GnFApnC5/32AgpcyKxrWnYXhvwDOLJdgWpkCX2EexyR9c8kCkMITJXnFLEN3Qb2CEh0W36vkLyw==
```
⇒ 两个本地 tarball 与 npm 官方发布物**逐字节一致**（sha256：0.2.0 `ceb66beb…`，0.1.7 `5f2da727…`），
下方"零增量"结论不是"拿错包"造成的假象。

### E2 CLI 包文件级对比

```
$ diff <(cd v017/package && find . -type f | sort) <(cd v020/package && find . -type f | sort)
(无输出；两侧均 20 个文件)

$ diff -rq extracted/v017/package extracted/v020/package
文件 extracted/v017/package/package.json 和 extracted/v020/package/package.json 不同
```
⇒ 唯一差异文件 = `package.json`。

CJK 扫描（Python，`[\u4e00-\u9fff]`）：`CLI 0.2.0: 0 code files contain CJK`、`CLI 0.1.7: 0 code files contain CJK`。

### E3 与"正在运行的 0.1.7"逐字节对齐

```
$ sha256sum ~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/<f>  vs  extracted/v020/package/<f>
SAME lib/bin.js                      935e95d05f4dc70a
SAME lib/profile-boot.js             c53d4e2caf21428e
SAME lib/profile-boot-BZ2ZjNWi.js    c394b2aa2ce08a3b
SAME lib/plugin-DkYIj96-.js          2103210a39731866
SAME lib/dump-config-BEDI-dNY.js     fa34d3397b9ac942
SAME lib/dump-config-crgOY3tW.js     4183d3918048badf
SAME lib/dump-config-schema-DhhNOaro.js 85c7eef6eee45325

$ diff -rq <npm 安装出的 0.2.0>/@deepseek-ai/dsh/lib  extracted/v020/package/lib
IDENTICAL lib trees      (installed version = 0.2.0-rc.1)
```

### E4 引导层依赖包对比（本地 `npm pack` 0.1.7 与 0.2.0 双向）

```
deepseek-ai-dsh-app-boot    : filelistdiff=NO changed_or_added_files=4   (仅 lib/index.js + package.json + 2 个 README)
deepseek-ai-dsh-cmdline     : 仅 package.json 不同
deepseek-ai-dsh-launch-environment : 仅 package.json 不同
deepseek-ai-dsh-http-proxy  : 仅 package.json 不同
deepseek-ai-dsh-atomic-write: 仅 package.json 不同
deepseek-ai-dsh-home-paths  : 仅 package.json 不同
deepseek-ai-dsh-plugin-manager : 仅 package.json 不同
```

`dsh-app-boot` 的**完整**源码差异（`diff -u` 全部 hunk）：

```diff
@@ -552,7 +552,8 @@
 const OPTIONAL_BUNDLES = [
 	"@deepseek-ai/dsh-experimental-agent-team-profile",
 	"@deepseek-ai/dsh-experimental-voice-input-bundle",
-	"@deepseek-ai/dsh-experimental-auto-review"
+	"@deepseek-ai/dsh-experimental-auto-review",
+	"@deepseek-ai/dsh-experimental-schedule-bundle"
 ];
```
⇒ 全部 `lib/**`（含 `PROFILE_TEMPLATES`、`resolveProfileDir`、`loadProfile`、`createRuntimeResolution`、
`linkedProfileRoots`、`removeLinkProjections`、`PROFILE_PNPM_WORKSPACE`）与 `lib/types/**`、
`lib/worker/profile-resolution-bootstrap.js` **逐字节相同**。`lib/types/profile.d.ts` 等公共 API 声明未变。

### E5 `--help` A/B（离线实跑，未启动服务）

```
$ node <017 install>/lib/bin.js --help > evidence/help-017.txt
$ node <0.2.0>/lib/bin.js      --help > evidence/help-020.txt
$ diff evidence/help-017.txt evidence/help-020.txt
(无输出，0 行差异)   ⇒ 启动器 help 文本完全相同
```

### E6 子命令面实跑（全部离线、无监听）

| 命令（`DSH_HOME` 指向工作区内） | 实测结果 |
|---|---|
| `dsh --help` | 打印启动器 help（Usage / Options / Examples），exit 0 |
| `dsh --version` | `0.2.0-rc.1`，exit 0 |
| `dsh`（无参数） | `error: --profile <name> is required`，exit 1 |
| `dsh --profile web --dump-config` | 打印合成后的条目列表（`# == @deepseek-ai/dsh-base` …），exit 0 |
| `dsh web --dump-config` | 与上一行等价（`dsh <name>` 缩写展开为 `--profile <name>`），exit 0 |
| `dsh --profile web --dump-default-config` | 打印不含 user 层与 `--patch` 的层，exit 0 |
| `dsh --profile web --dump-config-schema` | 打印 841,100 字节 JSON Schema，**exit 1**（`x-cordis.complete=false`，6 条 diagnostic） |
| `dsh --profile web --dump-config --dump-config-schema` | `error: --dump-config, --dump-default-config, and --dump-config-schema are mutually exclusive` |
| `dsh --profile web --dump-config extra` | `error: config dumps take no app arguments, got "extra"` |
| `dsh --profile desktop --dump-config` | `error: profile "desktop" is managed exclusively by the Electron application` |
| `dsh --profile zzz --from-default-profile nope --dump-config` | `Error: dsh: unknown default profile "nope"; expected one of "acp", "headless", "sdk", "sdk-minimal", "web"`（未捕获栈直出，exit 1） |
| `dsh plugin --help` | `error: required option '--profile <name>' not specified`，exit 1（017/020 相同） |
| `dsh plugin --profile web` | `error: plugin needs pnpm arguments to forward (e.g. add <package>)`，exit 1 |
| `dsh plugin --profile web version-exemptions` | `{}`，exit 0 |
| `dsh plugin --profile web allow-version some-pkg@1.0.0 --dsh-version 0.2.0-rc.1 --accept-risk` | 打印风险警告 + `dsh: allowed some-pkg@1.0.0 for DSH 0.2.0-rc.1`，exit 0 |

### E7 profile 首引导实测（workspace 内 DSH_HOME）

```
$ DSH_HOME=<ws>/fakehome node <0.2.0>/lib/bin.js --profile web --dump-config   # exit 0
⇒ 生成：
DSH_HOME/profiles/web/package.json        {"name":"dsh-profile-web","private":true,"dependencies":{},
                                           "dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]}}}
DSH_HOME/profiles/web/cordis.patch.yml    空数组 + 注释模板
DSH_HOME/profiles/web/pnpm-workspace.yaml packages: [.] / nodeLinker: hoisted / autoInstallPeers: false
DSH_HOME/profiles/web/cordis.yml          "# dsh profile root — an empty entry list. …" []
DSH_HOME/profiles/node_modules            × 未创建（拦截层按需，不预建）
```
另实测 `dsh plugin --profile web allow-version …` 生成
`DSH_HOME/profiles/web/compatibility.json` → `{"some-pkg@1.0.0": ["0.2.0-rc.1"]}`。

### E8 环境分层策略实测（`loadLayeredEnv`，离线）

```
1) 无 .env：layers: process=present project-env=absent user-env=absent；
   DSH_HOME 来源 = process
2) $DSH_HOME/.env 内写 DSH_HOME=… ⇒ THREW：
   dsh: <home>/.env sets "DSH_HOME", which only the launching environment may set …; export DSH_HOME instead of putting it in a .env file
3) $DSH_HOME/.env 内写 HTTP_PROXY ⇒ accepted; source= user-env
4) <cwd>/.env 内写 HTTP_PROXY ⇒ THREW（同款文案）
```
源码佐证（017/020 逐字节相同）：`BOOTSTRAP_PREFIXES = ["DSH_","XDG_","DYLD_","BASH_FUNC_"]`，
`BOOTSTRAP_NAMES` 含 PATH/HOME/NODE_OPTIONS/LD_PRELOAD/GIT_*/EDITOR 等；
`HOME_LAYER_PROXY_NAMES = {HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY}` 仅在 `$DSH_HOME/.env` 被放行。
⇒ **`DSH_*` 系列一律不能放 `.env`**。

### E9 合成内容对比（机制相同、内容不同，指向 T01）

同一 `--dump-config --profile web`，017 安装 vs 0.2.0 安装，输出**不同**（45,065 B vs 45,660 B），差异全部来自 bundle 补丁内容：

```diff
> - id: otel
>   name: '@deepseek-ai/dsh-otel'
>     maxRequestBytes: 4000000
<         'https://harness-telemetry.deepseeksvc.com/v1/logs'
>         'https://dsh-otel-collector.deepseeksvc.com/v1/logs'
> - id: desktop-product-telemetry
>   name: '@deepseek-ai/dsh-host-product-telemetry-otel'   (disabled unless profile name = desktop)
```
`--dump-config-schema` 两版均 `complete=false`、`$defs=106`、diagnostics=6（020 多一条
`unrecognized Loader tree carrier`，对应新增行）。⇒ 合成**管线**未变，**内容**增量属 T01。

### E10 符号链接策略与"启动期破坏性清理"

```
0.1.5 app-boot（历史 link backend）：
  symlinkSync(target, link, "junction");
  if (symlinkPointsTo(link, target)) return;  unlinkSync(link);   ← 重指行为在此版本

0.1.7 / 0.2.0：
  grep -rl "symlinkSync" <0.2.0 安装树>/@deepseek-ai  ⇒ 0 个文件
  grep -rl "symlinkSync" <0.1.7 安装树>/@deepseek-ai  ⇒ 1 个文件，且为 @img/sharp-wasm32/lib/sharp-wasm32-0.35.4.node.js（无关预编译胶水）

0.2.0 启动期唯一的链接变更（app-boot:602-607，经 loadProfile:977 调用）：
  removeLinkProjections(dir):
    if (!existsSync(dir/.dsh-module-fallback)) return;
    仅 unlink 指向 <profile>/.dsh-module-fallback/node_modules 的链接
    然后 rmSync(.dsh-module-fallback, {recursive, force})
```
**本轮一次意外触达与自查（如实记录）**：E6/E7 之外的第一次 dump 探针未设 `DSH_HOME`，于是落在默认 home `~/.dsh`。
沙箱以 `EROFS: read-only file system` 拒绝了 `rmSync('<~/.dsh>/profiles/web/.dsh-module-fallback')`。
**已核验未发生任何改动**：`~/.dsh/profiles/web/node_modules` 目录**不存在**（`ls` 报 ENOENT），
故 `symlinksUnder()` 返回空数组、unlink 循环零次迭代；唯一尝试的变更就是被拒的 `rmSync`；
`.dsh-module-fallback` 目录 mtime 仍为 `9月 11 15:19`、其中 `node_modules` 为空，未变。此后所有探针均显式设 `DSH_HOME` 到工作区内。

---

## 3. 文件级变化（0.1.7-rc.2 → 0.2.0-rc.1）

### 3.1 `@deepseek-ai/dsh`（CLI 包，20 个文件）

| 文件 | 状态 | 说明 |
|---|---|---|
| `lib/bin.js` | **未变** | sha256 `935e95d0…`；CLI 入口、参数解析、4 种 mode 分发 |
| `lib/profile-boot.js` | **未变** | `c53d4e2c…`；re-export 门面 |
| `lib/profile-boot-BZ2ZjNWi.js` | **未变** | `c394b2aa…`；`runProfile`/`prepareProfile`/`initializeProfileFromDefault`/`INSTALL_ANCHOR`/`homePatchPath`/`PROFILE_ROOT_FILENAME` |
| `lib/plugin-DkYIj96-.js` | **未变** | `2103210a…`；`dsh plugin` |
| `lib/dump-config-BEDI-dNY.js` | **未变** | `fa34d339…`；`runDumpConfig` + `collectConfigDumpLayers` |
| `lib/dump-config-crgOY3tW.js` | **未变** | `4183d391…`；re-export 门面 |
| `lib/dump-config-schema-DhhNOaro.js` | **未变** | `85c7eef6…`；`runDumpConfigSchema` |
| `lib/types/{args,bin,dump-config,dump-config-schema,plugin,process-shutdown,profile-boot,startup-diagnostics}.d.ts` | **未变**（8 个） | 公共类型面零变化 |
| `package.json` | **改** | `version`；`dependencies` 81→82（73 个钉版本号全升；**+1** `@deepseek-ai/dsh-experimental-schedule-bundle`）；`devDependencies` 47→47（41 个钉版本号升）。`bin`/`exports`/`type`/`files`/`scripts`/`engines` 未变 |
| `README.md` / `README.zh.md` / `README.i18n.yaml` / `LICENSE` | **未变** | `diff -rq` 确认无差异 |

**文件增删：无。** 无新文件、无删除文件。

### 3.2 引导层依赖包

| 包 | 代码文件变化 | 行为含义 |
|---|---|---|
| `dsh-app-boot` | `lib/index.js` 仅 1 hunk：`OPTIONAL_BUNDLES` +1 行 | 安装自带的"可选 bundle（默认关闭）"清单多一个 schedule-bundle；其余全部相同 |
| `dsh-home-paths` | 无（仅 package.json） | `DSH_HOME` 解析规则不变 |
| `dsh-cmdline` | 无（仅 package.json） | 内层 app 参数注入不变 |
| `dsh-launch-environment` | 无（仅 package.json） | env 分层与 bootstrap 规则不变 |
| `dsh-http-proxy` | 无（仅 package.json） | 启动代理安装不变 |
| `dsh-atomic-write` | 无（仅 package.json） | `withFileLock`/原子写不变 |
| `dsh-plugin-manager` | 无（仅 package.json） | `runPluginCommand`/版本豁免不变 |

---

## 4. 路径与引导机制结论（含与 0.1.7 的差异）

### 4.1 profile 引导如何定位各路径（源码 + 实测）

| 目标 | 解析规则（源码位置） | 0.1.7 差异 |
|---|---|---|
| **DSH_HOME** | `resolveDshHome()`（`dsh-home-paths`）：显式配置 > `$DSH_HOME`（空白视为未设）> `~/.dsh`；目录名常量 `.dsh` | **无** |
| **profile 目录** | `resolveProfileDir(name, home=resolveDshHome())` → `join(home, "profiles", name)`；名为空/含 `/`、`\`、`.`、`..`、`node_modules` 时抛错 | **无** |
| **profile 根配置** | `join(profile.dir, "cordis.yml")`，**每次启动重写**为空数组（防止 Loader 回写把 bundle 行固化导致重复插入） | **无** |
| **profile 用户层** | `join(profile.dir, "cordis.patch.yml")` | **无** |
| **home 级用户层** | `join(resolveDshHome(), "cordis.patch.yml")`，**每次调用重新解析**（`$DSH_HOME` 可能在 import 后被设置）；优先级**高于** profile 层 | **无** |
| **安装锚 installAnchor** | `INSTALL_ANCHOR = new URL("../package.json", import.meta.url)` → `<dsh 包>/package.json` | **无** |
| **bundle 解析** | 双锚：`resolveBundleDir` 先按 `installAnchor`，再按 `<profileDir>/package.json`。**安装锚优先是契约**（in-box bundle 永不来自 profile 本地副本） | **无** |
| **依赖闭包** | `collectInstallationScopePackages(installAnchor)`：从 dsh 的 `package.json` 出发按 `dependencies`+`peerDependencies` BFS 递归，得"安装域"包表 | **无** |
| **运行时解析根** | 进程内 Node ESM/CJS resolver 拦截（`PluginPackages` + `RuntimeResolution`），而非写符号链接；拦截层名义位置 = `join(home,"profiles")/node_modules`（`profileDir` 为 `undefined` 时不含 profile 域条目） | **无** |
| **profile 域包** | `<profile>/node_modules` 里存在 `package.json` 的已声明依赖（`installedProfilePackageNames`） | **无** |
| **linkedRoots** | `<profile>/node_modules` 中**真实路径位于 profiles 树与自身之外**的链接（只读收集，不重指、不创建） | **无** |
| **env 来源** | `loadLayeredEnv("dsh")`：继承环境（process）> `<cwd>/.env`（project）> `$DSH_HOME/.env`（user）；`DSH_*` 等 bootstrap-only 一律拒绝 | **无** |
| **默认 profile 名** | `PROFILE_TEMPLATES` = `acp`、`web`、`headless`、`sdk`、`sdk-minimal`；无模板名走 `DEFAULT_PROFILE_BUNDLES = ["@deepseek-ai/dsh-base"]` | **无**（实测报错文本一致） |
| **兼容性豁免** | `<profile>/compatibility.json`（`PROFILE_COMPATIBILITY_FILENAME`），键=包名@版本，值=DSH 版本数组 | **无** |

**结论：0.1.7 → 0.2.0 没有任何目录新增、改名、环境变量改名或默认 profile 名变化。**

### 4.2 新增目录/文件的唯一相关项

- `OPTIONAL_BUNDLES` 新增 `@deepseek-ai/dsh-experimental-schedule-bundle`：这是**安装自带但"默认关闭、可选开启"**的 bundle 清单
  （同时它也是 CLI `dependencies` 新增的那一项）。它**不出现在**任何 `PROFILE_TEMPLATES`，因此不会改变既有 profile 的启动内容；
  只有通过插件管理器主动开启才生效。这与 0.2.0 新增依赖 `dsh-workflow-ptc`、`dsh-tool-subagent-control` 的宣传面不同（后两项属于 T01/T03 范围）。

### 4.3 启动期唯一"破坏性"行为（017/020 相同，非 0.2.0 新增）

`loadProfile` → `removeLinkProjections(dir)`：若 `<profile>/.dsh-module-fallback` 存在，
则删除其中间投影并 `rmSync` 该目录。**只**影响指向该目录的链接，pnpm 安装的包与其他符号链接一律保留。
⇒ 对从 0.1.5/0.1.1 老 home 平移过来的隔离根，首次启动会**自动清理**该遗留目录；这是预期迁移动作，但需在迁移前对该目录做备份。

---

## 5. 子命令与 plugin 管理差异

### 5.1 启动器子命令面：**无新增/无移除/无改名**

`bin.js` 的 4 个 mode（`profile` / `plugin` / `dump-config` / `dump-config-schema`）与全部 flag
（`--profile`、`--from-default-profile`、`--patch`、`--dump-config`、`--dump-default-config`、
`--dump-config-schema`、`-V/--version`）**逐字节相同**；
`--help` 文本 A/B 差 0 行（E5）。`dsh <name>` 缩写（注入 `--profile`）、
"启动器 flag 必须在前、其后原样透传给内层 app（`ctx.cmdlineArgs`）"、
`desktop` profile 由 Electron 独占而拒绝、`--dump-config`/`--dump-default-config`/`--dump-config-schema`
互斥、config dump 不接受 app 参数——**行为全部不变**，均已当轮实跑复现（E6）。

内层 app 参数不属于启动器：`--port`、`--no-open` 等由 web app 自己解析。
本轮从既有审计记录中读到的 0.1.7 隔离实例真实启动形态为
`.../bin/dsh --profile web --port 3097 --no-open`，与 0.2.0 的透传机制一致。

### 5.2 `dsh plugin`：行为与清单格式不变

- 非 DSH 自有子命令的参数**原样转发给 pnpm**，工作目录 = 调用目录，profile 目录由 `--profile` 决定（首次使用即初始化）。
- DSH 自有子命令（0.1.7 已存在，0.2.0 相同）：
  - `allow-version <pkg@ver> --dsh-version <exact> --accept-risk`
  - `revoke-version <pkg@ver> --dsh-version <exact>`
  - `version-exemptions`
  写入/读取 `<profile>/compatibility.json`（键 `包名@版本` → DSH 版本数组，2 空格 JSON + 尾换行，`mode 384`），
  以 `<profile>/package.json` 为锁文件（`withFileLock`，`waitMs=120000`）。
- **插件清单文件格式**：`<profile>/package.json` 的
  `dsh.profile.bundles`（有序 bundle 列表）+ 普通 `dependencies`（out-of-tree 插件）；
  `<profile>/pnpm-workspace.yaml` 固定为 `packages: [.]`、`nodeLinker: hoisted`、`autoInstallPeers: false`
  （实测生成内容一致）；profile 用户层 `<profile>/cordis.patch.yml`。
- 诊断文案：pnpm 缺失 → `dsh: pnpm was not found; install pnpm and make it available on PATH.`；
  不兼容插件 → 提示 `dsh plugin --profile <p> allow-version … --accept-risk`；
  git-hosted 插件 → 提示在 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 中放行，**均未变**。

### 5.3 官方包符号链接策略：**必须更新历史结论**

| 版本 | 事实（当轮实测） |
|---|---|
| 0.1.5 | app-boot 有 link backend：`symlinkSync(target, link, "junction")`，并在目标不符时 `unlinkSync` 后重指 |
| 0.1.7 | `@deepseek-ai/*` 全树**无任何符号链接创建**（唯一 `symlinkSync` 命中为无关的 `@img/sharp-wasm32` 胶水） |
| 0.2.0 | 同上，命中数 **0** |

⇒ 历史结论"DSH 启动时只给官方包重指符号链接、从不剪枝非官方条目"中：
- "**只给官方包重指符号链接**"这半边在 **0.1.7 起就已不存在**——符号链接方案已被
  **进程内 Node resolver 拦截（`PluginPackages` / `RuntimeResolution`）** 取代；
- "**从不剪枝非官方条目**"这半边在 0.2.0 **仍然成立**：启动期唯一的删除动作
  `removeLinkProjections` 只碰 `<profile>/.dsh-module-fallback` 下的投影及其目录。

### 5.4 首次引导 / onboarding / 硬编码文案

- **CLI 包**：CJK 命中 0；无 onboarding/first-run 逻辑（只有 profile 首引导的**文件脚手架**：
  `package.json`/`cordis.patch.yml`/`pnpm-workspace.yaml`/`cordis.yml`，实测见 E7，文案全英文）。
- **全部引导层依赖**（app-boot / home-paths / cmdline / launch-environment / http-proxy / plugin-manager）：
  CJK 命中 0。
- **客户端 onboarding 不是新增**：`dsh-client-ui-settings-general/lib/client.js` 含
  `useOnboardingSteps` / `onboardingSteps` / `completedOnboarding`；同一片段在 0.1.7 安装树中**逐字存在**
  （该文件两版 sha256 不同，属正常演进，但 onboarding 机制非 0.2.0 引入）。
- **客户端中文来源已定性**：`client.js` 中的 CJK 命中集中在内联 `const zh = { "trigger": "设置", … }` locale 表，
  属合法 i18n 数据，**不是硬编码 UI 文案**。跨版本 CJK 文件数 60（0.2.0）vs 59（0.1.7），差异为代码自然增长。
- ⇒ **0.1.7 时代那种"中文硬编码引导卡 UI 验收"的形态在 0.2.0 未复现**（CLI/引导层范围内）。

---

## 6. 隔离根最小启动清单

### 6.1 磁盘清单

```
<prefix>/                                     # npm -g 前缀（实测 ~/.npm-global-dsh017 形态）
├── bin/dsh -> ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js
└── lib/node_modules/@deepseek-ai/
    ├── dsh/                                  # CLI 包：package.json + lib/{bin.js,profile-boot.js,
    │                                         #   profile-boot-*.js,plugin-*.js,dump-config-*.js} + lib/types/*
    │   └── node_modules/@deepseek-ai/…      # 嵌套布局（实测 017：283 个同域包）
    └── …（或 hoist 到 lib/node_modules/@deepseek-ai/…；两种布局都被 packageDirFromAnchor 支持）
```
- **必需**：`dsh` 包的**完整依赖闭包**（`collectInstallationScopePackages` 从 dsh 的 `package.json`
  递归 `dependencies`+`peerDependencies`；缺一个被选中的 bundle 就会进 `skippedBundles` 并 stderr 告警，
  缺到 `dsh-base` 级别则启动失败）。因此**不能只拷 CLI 的 lib 目录**。
- **必需**：Node 运行时（本轮实测 `node v22.23.2`；`bin.js` 用 `import.meta.main`，需现代 Node）。
- **仅 `dsh plugin` 需要**：`pnpm` 在 PATH 上（缺失时退出码 127 + 提示）。启动 profile 本身不需要 pnpm。

```
$DSH_HOME/                                    # 隔离根自己的 home（强烈建议独立目录）
├── profiles/<name>/package.json               # dsh.profile.bundles（首引导自动生成）
├── profiles/<name>/cordis.patch.yml           # 用户补丁层（首引导自动生成）
├── profiles/<name>/pnpm-workspace.yaml        # 首引导自动生成；dsh plugin 需要
├── profiles/<name>/cordis.yml                 # 每次启动被重写，无需预置
├── profiles/<name>/compatibility.json         # 可选：插件版本豁免
├── cordis.patch.yml                           # 可选：home 级用户层，优先级高于 profile 层
├── .env                                       # 可选；**不得含 DSH_* 等 bootstrap-only 变量**
├── logs/                                      # 启动失败时才创建（startup-*.log，mode 0600）
└── cache/                                     # 按需创建，非启动必需
```
- `profiles/node_modules`（拦截层）**不需要预建**（实测未创建）。
- `<cwd>/.env` 也会被读取（project 层），优先级低于继承环境、高于 `$DSH_HOME/.env`。

### 6.2 启动命令的精确形态

```bash
export DSH_HOME=/abs/path/to/isolate/home      # 必须在**继承环境**里 export，不能写进 .env
/abs/path/to/prefix/bin/dsh --profile web --port <PORT> --no-open
# 等等价缩写：
/abs/path/to/prefix/bin/dsh web --port <PORT> --no-open
# 直接调脚本亦可（bin 指向的同一文件）：
DSH_HOME=/abs/path/to/isolate/home node /abs/path/to/prefix/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile web --port <PORT> --no-open
```
要点：
1. `--profile`（或省略 `--profile` 的 `<name>` 缩写）必须在**启动器自有 flag 最先出现**；其后所有 token 原样透传给内层 app。
2. **不要**把 `DSH_HOME` 放进 `.env`（E8 实测会抛错中断启动）。
3. 首次启动会自动在 `$DSH_HOME/profiles/<name>/` 生成 4 个脚手架文件；若该目录已有 `package.json` 则按初始化语义**不覆盖**。
4. 启动前若沿用老 home，先备份 `$DSH_HOME/profiles/<name>/.dsh-module-fallback`（会被自动清理）。

---

## 7. 建议迁移动作

1. **CLI/引导层不需要任何代码或配置改动**：确认迁移工作量为 0，把精力集中在 bundle/插件内容增量（T01）与 settings schema（T03）。
2. **隔离根用独立 `DSH_HOME`**（新目录），并在**启动命令前 export**；不要把 `DSH_HOME` 写进任何 `.env`。
3. **迁移前备份 `$DSH_HOME/profiles/<name>/.dsh-module-fallback`**（若存在），因为 0.1.7/0.2.0 首次启动会静默清理它。
4. **不要在隔离根之间复用同一 `DSH_HOME`**：`cordis.yml` 每次启动被重写、`compatibility.json` 会被豁免写入，
   且 `removeLinkProjections` 具破坏性。
5. **验证用的"非监听"通道**：`--dump-config` / `--dump-default-config` / `--dump-config-schema`
   可在不起任何端口、不挂载插件的前提下验证 profile 合成与包解析，适合作为隔离根冒烟第一步
   （注意 `--dump-config-schema` 在自带 `web` profile 上**必然 exit 1**（`complete=false`），两版一致，不能当作失败）。
6. **`dsh plugin` 相关**：若隔离根要保持现有 9 个本地插件，插件清单与豁免文件格式未变，
   迁移时只需保证 `<profile>/package.json`、`pnpm-workspace.yaml`、`compatibility.json` 一并平移。
7. **验收口径**：`--help` 文本、子命令 error 文案、首引导脚手架文件内容在两版之间可逐字节对比（E5/E6/E7），
   可直接作为回归基线。

---

## 8. 未验证项

1. **未启动任何真实 profile**（`web`/`headless`/`sdk`/`acp`，含隔离根）——硬约束禁止起监听端口，
   因此"启动到 LISTEN 并可访问"的端到端行为未验证；本报告的"启动清单"来自源码 + 非监听模式实测。
2. **未触发 `dsh plugin … add/remove`**（会经 pnpm 联网安装），故 pnpm 转发的真实行为、
   `allowBuilds` 指引的实际生效、退出码映射未验证。
3. **未验证 0.2.0 全量依赖闭包**（289 个同域包）中除 7 个引导相关包之外的增量——属 T01 范围。
4. **未验证桌面/Electron 侧的 `desktop` profile 联动**（仅验证了启动器会拒绝该 profile 名）。
5. **未验证 `--dump-config-schema` 的 `complete=false` 是否会在 0.2.0 后续 rc 修复**（仅记录两版一致）。
6. **未验证 GUI 侧 onboarding 的完整渲染**（仅做了源码片段与 CJK 来源定性；客户端 UI 属其他轨道）。
7. **未验证 `<cwd>/.env` 与 `$DSH_HOME/.env` 极端组合**（如两处同时声明同一变量时的优先级），仅验证了单点行为。
8. **未在真实老 home 上执行 `removeLinkProjections`**（本轮被沙箱拒绝），只验证了它被调用的时机与作用范围。
9. **`ps` 在本沙箱内输出为空**，故未独立复核 3080/3097 的进程命令行；其启动形态引用自既有审计记录的文本。

*证据留存：`.workspace/audit-020/evidence/`（help A/B、schema A/B 及 diagnostics、dump A/B）、
`.workspace/audit-020/extracted/`（两版 CLI 与引导依赖包解包）、`.workspace/audit-020/fakehome*/`（首引导实测产物）。*
