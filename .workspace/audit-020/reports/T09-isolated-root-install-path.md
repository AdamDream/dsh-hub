# T09 — 0.2.0 全新隔离根的安装与启动路径（审计 + 执行前勘察）

- 轨道：T09（执行前勘察；**只产出方案与判定，未改任何产品代码，未启动任何服务**）
- 日期：2026-09-29（当轮）
- 沙箱模式：`workspace-write`（`workspace=/home/CNS2026495165/dsh`）；**未使用 `sandbox_permissions`，未申请提权**
- 硬约束遵守：除 `.workspace/**` 外零写入；对家目录只做**一次性探测**且未产生任何残留（见 §2.1.3）
- 结论绑定当轮实测命令输出（每节标注实测命令与原始输出）

---

## 1. 结论摘要

**C-1（决定性）本沙箱内「家目录新根」不可行。** 家目录所在文件系统在本进程挂载命名空间内被 **只读挂载**（`/dev/nvme0n1p2 / ext4 ro,...`），只有工作区被单独 rw 挂载。实测 `mkdir ~/.dsh-020-stage` → **EROFS「只读文件系统」**。因此 `~/.dsh-020` + `~/.npm-global-dsh020` 这一「与 0.1.7 同形」的双根方案**必须改用工作区内隔离根**，或由具备更宽权限的真宿主 shell 执行。

**C-2 隔离根首选形态 = 工作区内单根 + 伪装 HOME。** 唯一被本轮实测证明可写的布局是
`/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09/`，其中并列 `home/`（伪装 `$HOME`）、`dsh-home/`（`$DSH_HOME`）、`npm-global/`（npm prefix）、`ws/`（启动 cwd）。安装已在该根内**真实跑通**（546 包 / 23 秒 / 521 MB / exit 0）。

**C-3 `--port` 是强制项，不是可选项。** 0.2.0 组合树的默认端口**硬编码为 3080**——与现役端口完全相同：
`config: { host: !!js ctx.webStartup.host ?? '127.0.0.1', port: !!js ctx.webStartup.port ?? 3080 }`。
不带 `--port` 启动 0.2.0 会立刻 `EADDRINUSE`；更坏的是**一旦现役 3080 短暂掉线，新实例会抢占生产端口**。启动命令中 `--port` 必须显式给出并纳入闸门。

**C-4 `DSH_HOME` 是唯一的 harness-home 开关，但不足以隔离——必须同时覆盖 `HOME`。** 实测：`defaultDshHome()` 在 0.2.0 全树**零调用点**（除自身模块），harness 数据面 9 个包统一走 `resolveDshHome()`（读 `DSH_HOME`）；但 `homedir()` 仍被 20+ 处直接使用（`dsh-skill-filesystem` 的 `~/.agents`、`dsh-workspace-changes`、`dsh-spill-local`、`libreoffice-kit` 字体目录、`@aws-sdk/*`、`@anthropic-ai/sdk`、`@earendil-works/pi-ai` …）。**只设 `DSH_HOME` 会把这些泄漏到真家目录；覆盖 `HOME` 才能一次覆盖全部 `homedir()` 站点。**

**C-5 `DSH_HOME` 空白值会静默回退到真 `~/.dsh`。** 实测 `resolveDshHome()` 对 `DSH_HOME="   "` 返回 `/home/CNS2026495165/.dsh`。任何「变量没展开/被引号吞掉」的脚本错误都会**静默打到现役 home**，因此启动前必须有 `DSH_HOME` 非空 + 绝对路径 + 落在隔离根内的三重断言。

**C-6 本沙箱内 `ps -p <宿主 pid>` 恒不可用，且原因已定性。** 每个 `bash` 调用都在 `bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent --tmpfs /tmp --bind <workspace> <workspace>` 内运行；`ps aux` 只可见 bwrap 自身与本次命令，`/proc` 是新 PID namespace 的 procfs。但 `ss` 读的是**宿主网络命名空间**（bwrap 未 `--unshare-net`），仍能看到 3080/3097。⇒「未污染现役」的判据只能建立在**端口连续性 + 配置文件哈希 + bind 冲突对照**上，不能建立在 PID 上。

**C-7 `/tmp` 在本沙箱内**跨调用零持久化**。`bwrap --tmpfs /tmp` 每次调用重建：写入哨兵文件后下一次调用 `ls /tmp` = 0 项、哨兵不存在。**所有暂存、日志、pidfile、闸门输出一律不得放 `/tmp`**，必须落 `.workspace/**`。

**C-8 家目录只读是一道免费的防误伤保险。** 实测 `~/.npmrc`、`~/.npm-global/**` 均为 EROFS。因此即使在伪 HOME 下误执行 `npm install -g`（实测此时 npm prefix 会退化为 `/usr`，而非 `~/.npm-global`），也**物理上不可能**污染现役全局 prefix。反之在真宿主下这条保险不存在，方案必须显式给 `--prefix`。

**C-9 `settings.yaml` 的首启导入是**破坏性 rename**，只能发生在副本上。** `dsh-settings` 的 `importLegacyDocument()` 对 `<profile.home>/settings.yaml` **无条件先 rename 成 `settings.yaml.imported`，再 parse**（`dsh-settings/lib/index.js:348-362`）。它只作用于 `profile.home`（= 本根 `$DSH_HOME`），**不会跨根去读真 `~/.dsh/settings.yaml`**（隔离性由实测确认：本轮全部操作后真 home 仍无 `settings.yaml.imported`）。0.1.7 隔离面的 0 字节 `settings.yaml.imported` 正是该机制的历史产物。

**C-10 `install-plugins.sh` 是 `$HOME` 基、不是 `DSH_HOME` 基，是一个活雷。** 其内容为 `FB="$HOME/.dsh/profiles/node_modules/@deepseek-ai"`（硬编码默认 home 名 `.dsh`）。在「真 HOME + 非默认 `DSH_HOME`」的会话里跑它，会**写进现役 `~/.dsh/profiles/node_modules`**。0.2.0 隔离迁移必须改写该脚本（改读 `DSH_HOME`），或只在伪 HOME 下执行以使其自然失效。`~/.dsh/install-plugins.sh` 与 `~/.dsh-017/install-plugins.sh` 实测**逐字节相同**（`diff` 无输出）。

**C-11 `--dump-config` 不能作为遥测开关的验证手段。** `telemetryDisabledEnv` 只在真实启动路径 `lib/profile-boot-*.js:269` 注入；`--dump-config` 走 `dump-config-*.js` 独立路径，实测带 `DSH_TELEMETRY_DISABLED=1` 时组合树里 `session-telemetry-otel` 行**没有任何 `disabled: true` 变化**。⇒ 该开关「生效」列为未验证项（§9）。

**C-12 `unshare -rn` 可用但需补 `ip link set lo up`。** 实测 `unshare -rn /bin/true` exit 0；netns 内 `lo` 默认 `<LOOPBACK> state DOWN`、无地址、DNS 解析失败（`getent hosts registry.npmjs.org` exit 2）、宿主监听不可见（`ss -ltn` 0 行）。实测 `ip link set lo up`（非特权，在自有 netns 内）**成功**，随后 `bind 127.0.0.1:3098` 成功。⇒ 若要在 netns 内做**无外网冒烟启动**，启动前必须显式拉起 `lo`；且**端口闸门必须在 netns 之外执行**（netns 内看不到宿主占用，闸门恒为假阳性）。

---

## 2. 证据（当轮实测）

### 2.1 可写性探测

#### 2.1.1 家目录新根 —— **失败（EROFS）**

```
$ mkdir -p ~/.dsh-020-stage
mkdir: 无法创建目录 "/home/CNS2026495165/.dsh-020-stage": 只读文件系统
mkdirA_exit=1
$ echo probe > ~/.dsh-020-stage/probe.txt
bash: 行 4: /home/CNS2026495165/.dsh-020-stage/probe.txt: 没有那个文件或目录
writeA_exit=1
```

补充阴性对照：

```
$ touch /home/CNS2026495165/.t09-probe
touch: 无法 touch '/home/CNS2026495165/.t09-probe': 只读文件系统      # exit=1
$ touch /home/CNS2026495165/.npmrc
touch: 无法 touch '/home/CNS2026495165/.npmrc': 只读文件系统          # exit=1
$ touch /home/CNS2026495165/.npm-global/.probe
touch: 无法 touch '/home/CNS2026495165/.npm-global/.probe': 只读文件系统  # exit=1
$ touch /run/user/1001/.t09-probe
touch: 无法 touch '/run/user/1001/.t09-probe': 只读文件系统            # exit=1
```

挂载层证据（说明这不是权限位问题，而是**文件系统只读**）：

```
$ grep -E ' /home| / ' /proc/mounts
/dev/nvme0n1p2 / ext4 ro,nosuid,nodev,relatime 0 0
/dev/nvme0n1p2 /home/CNS2026495165/dsh ext4 rw,nosuid,nodev,relatime 0 0
```

⇒ `/`（含家目录）ro-bind，工作区单独 rw 挂载。**这正是 bwrap 的 `--ro-bind / / --bind <ws> <ws>` 结构。**

#### 2.1.2 工作区内隔离根 —— **成功**

```
$ mkdir -p /home/CNS2026495165/dsh/.workspace/iso-020/home
mkdirB_exit=0
$ echo probe > /home/CNS2026495165/dsh/.workspace/iso-020/home/probe.txt
writeB_exit=0
-rw-rw-r-- 1 CNS2026495165 CNS2026495165 6 ... probe.txt
```

#### 2.1.3 探测残留清理（家目录零残留）

- `~/.dsh-020-stage`：**从未被创建**（EROFS 拒绝），`rm -rf` 为 no-op；事后 `ls -d` → exit 2「没有那个文件或目录」。
- `/home/CNS2026495165/.t09-probe`：**从未被创建**（EROFS），事后 `ls -l` → exit 2。
- `/home/CNS2026495165/.npm-global-test`：从未创建，事后 `ls -d` → exit 2。
- `/tmp` 哨兵：`/tmp` 每次调用重建，事后 0 项。
- ⇒ **家目录探测零残留，无需清理。**

**一处需要如实声明的探测副作用**：2.1.2 的工作区探测创建了 `.workspace/iso-020/home/`（该路径随后被**其它轨道**（`bin/`、`pkgs/`、`lockgen/` 等，见 §2.1.2 之外的同级目录，当时时间戳 16:46–16:52）用作其自身工作区）。本轮写入的 `probe.txt` 事后已不在（`ls -l .workspace/iso-020/home/` → 0 项）。T09 后续实测统一改在**专属根 `.workspace/audit-020/iso-020-t09/`**，与各轨道无写入交集。

### 2.2 现有隔离形态（`~/.dsh-017` + `~/.npm-global-dsh017`）如何被创建与绑定

**权威来源不是推测，而是仓库内的历史创建脚本**：`workbuddy-reverse-proxy/proto/dsh-0.1.7-isolated-home.sh`（隔离 home 创建）与 `workbuddy-reverse-proxy/proto/dsh-0.1.7-preflight.sh`（纯只读预检）。二者给出的绑定关系经本轮只读复核，逐条如下。

| 绑定轴 | 0.1.7 隔离形态实际值 | 绑定机制 / 证据 |
|---|---|---|
| harness home | `DSH_HOME=/home/CNS2026495165/.dsh-017` | 启动时以环境变量注入（历史报告记载启动行为 `DSH_HOME=… .npm-global-dsh017/bin/dsh --profile web --port 3097 --no-open`）；`resolveDshHome()` 的 `$DSH_HOME` 分支（0.2.0 实测见 §2.4） |
| npm 全局 prefix | `/home/CNS2026495165/.npm-global-dsh017` | 安装期 `npm install -g --prefix "$STAGE"`；`$STAGE/lib/node_modules/@deepseek-ai/dsh` + `$STAGE/bin/dsh` 是 npm 的 prefix 布局，与本轮实测产出的布局**结构一致**（§2.3） |
| `PATH` | 不经 PATH 解析 | 预检脚本显式把「`$STAGE/bin` 入 PATH / 用 `npx` / 用裸 `dsh`」列为**隔离失效**（launcher 会被解析回现役 `$GLOBALPREFIX`）；启动一律用**绝对路径 launcher**。本轮实测的「隔离自证」即 `readlink -f <prefix>/bin/dsh` 必须落在 prefix 内（§2.3.3） |
| profile 目录约定 | `$DSH_HOME/profiles/<name>/` | 0.2.0 CLI help 明示 `--profile <name>` 是「the profile under `$DSH_HOME/profiles` to boot」；`dsh-app-boot` 常量 `PROFILES_DIR = "profiles"`、`PROFILE_PATCH_FILENAME = "cordis.patch.yml"`、`PROFILE_COMPATIBILITY_FILENAME = "compatibility.json"` |
| `profiles/web/cordis.patch.yml` | `~/.dsh-017/profiles/web/cordis.patch.yml`（sha256 前缀 `61adb8ae…`，本档复核一致） | 用户在 profile 层的补丁层，在 bundle 层之后、`--patch` 覆盖层之前应用；另有**家庭层** `<DSH_HOME>/cordis.patch.yml`（`loadOptionalPatches(join(context.home, "cordis.patch.yml"))`） |
| 非闭包插件（`@local/*` 等 12 个名字） | `$DSH_HOME/profiles/node_modules/**` **物理落盘** | 创建脚本 §⑤/⑥/⑦ 逐个 `cp -a` 并逐名校验 `package.json` 存在；**0.1.7 不重建任何链接**。0.2.0 侧只清理指向 `<profile>/.dsh-module-fallback/node_modules` 的、由自己创建的符号链接（`removeLinkProjections`），pnpm 安装物与其它链接不动 ⇒ 物理目录仍是安全形态 |
| `install-plugins.sh` | `$DSH_HOME/install-plugins.sh`（与现役逐字节相同） | 作用：把本地识图插件 `dsh-vision-adam` 从硬编码源路径 `cp -r` 进 `$HOME/.dsh/profiles/node_modules/@deepseek-ai/`。**它是 `$HOME` 基而非 `DSH_HOME` 基**（见结论 C-10） |
| 凭据/预设/技能 | `.credentials.yaml`(600) / `.agent-presets/` / `skills/` / `taste/` / `AGENTS.md` 由现役 `cp -a` 而来 | 创建脚本 §② |
| `settings.yaml` | 创建脚本**置 0 字节**（§③「零写入封口」） | 首启后 rename 成 `settings.yaml.imported`（0 B）。本轮 `~/.dsh-017/settings.yaml.imported` = 0 字节、目录内**无** `settings.yaml` ⇒ 与源码 `:351` 一致 |
| 端口 | 3097（`--port 3097 --no-open`） | 显式 `--port`，非默认 |
| 运行期数据面 | `$DSH_HOME/{logs,sessions,storages,session-board,btw,office-ppt}/` | 创建脚本 §①；本轮实测 `logs/dsh-host.jsonl`、`storages/usage/usage.db*`、`sessions/` 分区目录均在位 |

### 2.3 npm 安装实测（工作区内，真实安装）

#### 2.3.1 前置只读探测

```
$ node -v ; npm -v ; pnpm --version
v22.23.2
10.9.8
11.26.0

$ npm config get prefix
/home/CNS2026495165/.npm-global          # ← 来自 user config /home/CNS2026495165/.npmrc（prefix=…）

$ npm config list
; "user" config from /home/CNS2026495165/.npmrc
prefix = "/home/CNS2026495165/.npm-global"
; "env" config from environment
cache = "/home/CNS2026495165/dsh/.workspace/npm-cache"
logs-dir = "/home/CNS2026495165/dsh/.workspace/npm-logs"
```

⇒ **`npm_config_cache` / `npm_config_logs_dir` 必须显式导出**；且 **`npm_config_prefix` 必须显式覆盖**（否则用户级 `.npmrc` 会把全局安装指向现役 prefix——本沙箱内虽因 ro 而失败，真宿主下则会真的写进去）。

目标包元数据：

```
$ npm view @deepseek-ai/dsh@0.2.0-rc.1 dist --json
{ "shasum": "205c3522…", "tarball": "https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.1.tgz",
  "fileCount": 20, "integrity": "sha512-F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng==",
  "unpackedSize": 69936 }
$ npm view @deepseek-ai/dsh dist-tags --json
{ "alpha": "0.1.7-alpha.2", "latest": "0.1.7-rc.2", "next": "0.2.0-rc.1" }
```

tarball 哈希与协调者给的值**逐字符一致**：

```
$ sha256sum .workspace/audit-020/work/deepseek-ai-dsh-0.2.0-rc.1.tgz
ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216
```

#### 2.3.2 真实安装（成功）

```
$ export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
$ export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs
$ R=/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09
$ mkdir -p "$R/npm-global" "$R/home"
$ npm install -g --prefix "$R/npm-global" @deepseek-ai/dsh@0.2.0-rc.1 --no-audit --no-fund

=== start 2026-09-29T16:44:15+08:00 ===
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
added 546 packages in 23s
=== install_exit=0 end 2026-09-29T16:44:38+08:00 ===
```

产出的 prefix 布局（与 0.1.7 同形）：

```
$ ls -la "$R/npm-global/"
drwxrwxr-x  bin
drwxrwxr-x  lib
$ ls -l "$R/npm-global/bin/dsh"
dsh -> ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js
$ readlink -f "$R/npm-global/bin/dsh"
/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09/npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
$ node -e "console.log(require('$R/npm-global/lib/node_modules/@deepseek-ai/dsh/package.json').version)"
0.2.0-rc.1
$ find "$R/npm-global/lib/node_modules" -type f | wc -l ; du -sh "$R/npm-global"
26134
521M
```

**对历史硬前提的实测修正**：0.1.7 预检脚本记载两条硬前提——①`mkdir -p "$STAGE/lib"`（缺它 npm ENOENT/lstat、退出码 254）；③ `XDG_CACHE_HOME` 必须导出（koffi/cnoke 构建缓存）。**本轮二者均未做且安装成功**（`$STAGE` 在安装前完全不存在，npm 自行创建 `bin/` 与 `lib/`；`XDG_CACHE_HOME` 全程未设置）。⇒ 这两条在该 npm 版本 + 该包（无源码构建）下**已不是必要条件**；但它们仍是**便宜且无风险的保险**，下列创建命令予以保留。

#### 2.3.3 隔离自证

`readlink -f <prefix>/bin/dsh` 落在隔离 prefix 内（上面输出），**未**被解析回现役 `~/.npm-global`。这是 0.1.7 预检定义的「隔离自证」判据，本轮通过。

补充：伪 HOME 下 npm 的 prefix 会退化为 `/usr`，进一步排除「误落到现役全局 prefix」：

```
$ env -u DSH_HOME HOME="$R/home" npm config get prefix
/usr
$ env -u DSH_HOME HOME="$R/home" npm config get userconfig
/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09/home/.npmrc     # 不存在，属默认值
```

伪 HOME 下 npm 确实把缓存/日志就近落下（证明 HOME 覆盖有效）：

```
$ find "$R/home"
home/.npm/_logs/2026-09-29T08_47_02_*.log      # 未设 npm_config_logs_dir 时 npm 的回退位置
```

### 2.4 `DSH_HOME` / `HOME` 解析实测（0.2.0 包内 `dsh-home-paths@0.2.0-rc.1`）

| 场景 | 环境 | `resolveDshHome()` 实测输出 |
|---|---|---|
| A | `DSH_HOME=$R/dsh-home-A`（HOME 为真） | `$R/dsh-home-A` ✅；同时 `defaultDshHome()` = `/home/CNS2026495165/.dsh`（即真 home，**调用它不是错误但会泄漏**） |
| B | `HOME=$R/home` + `DSH_HOME=$R/dsh-home-B` | `$R/dsh-home-B` ✅；`homedir()` = `$R/home` ✅ |
| C | `HOME=$R/home`，**无** `DSH_HOME` | `$R/home/.dsh` ✅（⇒ 仅覆盖 HOME 也足以迁移 harness home） |
| D | `DSH_HOME="   "`（空白） | `/home/CNS2026495165/.dsh` ⚠️ **静默回退到真 home** |

`defaultDshHome()` 全树调用点排查（0.2.0 安装树）：

```
$ grep -rn "defaultDshHome" <tree> --include=*.js | grep -v "dsh-home-paths/lib"
(无输出)
```

`resolveDshHome` 的调用方包（harness 数据面）：

```
@deepseek-ai/dsh
@deepseek-ai/dsh-agent-instructions
@deepseek-ai/dsh-anonymous-user-id
@deepseek-ai/dsh-app-boot
@deepseek-ai/dsh-attachment-local
@deepseek-ai/dsh-credentials-local
@deepseek-ai/dsh-llm-deepseek
@deepseek-ai/dsh-shell-env
@deepseek-ai/dsh-skill-filesystem
```

而 `homedir()` **未**被 `DSH_HOME` 收编的代表性站点（⇒ 必须覆盖 HOME）：

```
dsh-skill-filesystem/lib/index.js:78   agentsHome = config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents")
dsh-workspace-changes/lib/index.js:660 home: await canonicalPath(homedir())
dsh-api-workspace-controller/lib/index.js:636 ... === (internals.home ?? homedir())
dsh-host-open-in-app/lib/index.js:390  const home = internals.home ?? homedir()
dsh-host-directory-picker-browse/lib/index.js:166 const home = homedir()
dsh-native-command/lib/index.js:410    desktopDataDirectories(env.HOME ?? homedir(), env)
libreoffice-kit/lib/index.js:984       systemFontDirectories(platform, home = homedir(), env)
```

⇒ 建议启动环境额外显式设 `DSH_AGENTS_HOME="$ROOT/home/.agents"`，消除唯一一个**可被配置放大的** `homedir()` 泄漏。

**`.env` 无法改写隔离边界（强保证）**：`dsh-app-boot` 的 `isBootstrapOnly()` 把前缀 `DSH_`、`XDG_`、`DYLD_`、`BASH_FUNC_` 与一票具名项（`DEEPSEEK_BASE_URL`、`HTTP(S)_PROXY`、`GIT_*`、`SSL_CERT_*`、`NODE_TLS_REJECT_UNAUTHORIZED` …）列为「只能由继承环境提供」。**调用目录的 `.env` 声明这些名字会直接抛错终止**；**harness-home 的 `.env` 也只额外允许 4 个代理名**。⇒ 任何 `.env` 都不能移动 `DSH_HOME`，**进程环境是唯一权威**。（实测仓库根与 `~/.dsh` 下均无 `.env`。）

### 2.5 端口检测实测

```
$ ss -Hltn | awk '{print $4}' | grep -E ':(3080|3097|3098|3099|3102|3103|9224|9225)$'
127.0.0.1:3080
127.0.0.1:3097

$ for P in …; do ss -Hltn "sport = :$P" | wc -l ; nc -z -w1 127.0.0.1 $P ; done
port=3080 ss_listen_lines=1 tcp_connect=open
port=3097 ss_listen_lines=1 tcp_connect=open
port=3098 ss_listen_lines=0 tcp_connect=closed
port=3099 ss_listen_lines=0 tcp_connect=closed
port=3102 ss_listen_lines=0 tcp_connect=closed
port=3103 ss_listen_lines=0 tcp_connect=closed
port=9224 ss_listen_lines=0 tcp_connect=closed
port=9225 ss_listen_lines=0 tcp_connect=closed
```

**强力闸门（bind-only 探针，只 `bind()` 不 `listen()`，随即 `close()`）**：

```
$ node -e '<bind-only 探针，见 §5.2>'
port=3080 bind=FAIL errno=EADDRINUSE
port=3097 bind=FAIL errno=EADDRINUSE
port=3098 bind=OK (closed immediately)
port=3099 bind=OK (closed immediately)
port=3102 bind=OK (closed immediately)
port=3103 bind=OK (closed immediately)
port=9224 bind=OK (closed immediately)
port=9225 bind=OK (closed immediately)
```

3080/3097 的 `EADDRINUSE` 是**阳性对照**，证明探针真的能判冲突；候选端口全部 `bind=OK`。该探针**不调用 `listen()`**，不接受任何连接，不是「启动服务」。

`ss -ltnp` 无进程列（跨 PID namespace 不可解析宿主进程）；`ss -p` 在本沙箱属已知不可用，故闸门**不使用 `-p`**。

### 2.6 `unshare -rn` 网络隔离实测

```
$ command -v unshare ; unshare --version
/usr/bin/unshare
unshare，来自 util-linux 2.39.3
$ unshare -rn /bin/true ; echo $?
0

$ unshare -rn sh -c 'ip -o link show; ip -o addr show; ss -ltn | tail -n +2 | wc -l; timeout 5 getent hosts registry.npmjs.org'
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN mode DEFAULT group default qlen 1000\    link/loopback …
(ip addr 无输出)
0
getent_failed=2

$ unshare -rn sh -c 'ip link set lo up; echo lo_up_exit=$?; ip -o addr show lo; node -e "<bind 127.0.0.1:3098>"'
lo_up_exit=0
1: lo    inet 127.0.0.1/8 scope host lo\       valid_lft forever preferred_lft forever
1: lo    inet6 ::1/128 scope host \       valid_lft forever preferred_lft forever
bind=OK in netns
```

⇒ 三个必须在方案里体现的后果：① netns 内 `lo` 默认 DOWN，**不拉起 `lo` 则 `dsh web` 绑不上 127.0.0.1**；② netns 内**完全无外网**（DNS 都失败）⇒ 可用于「无模型请求的无网冒烟」，但**装了包才能跑**（安装必须在 netns 外做）；③ netns 内看不见宿主监听 ⇒ **端口闸门必须在 netns 外执行**。

### 2.7 未污染判据实测（操作前 / 操作后同值）

操作前基线（16:44 前）与操作后（16:5x）**逐项一致**：

| 判据 | 操作前 | 操作后 | 结论 |
|---|---|---|---|
| `~/.dsh/profiles/web/cordis.patch.yml` sha256 前 16 | `513413e7cffb3191` | `513413e7cffb3191` | ✅ 未变（与协调者值一致） |
| `~/.dsh/settings.yaml` sha256 前 16 | `0f19b0fe0e1b8c80` | `0f19b0fe0e1b8c80` | ✅ 未变（与协调者值一致） |
| `~/.dsh-017/profiles/web/cordis.patch.yml` sha256 前 16 | `61adb8ae5758c12e` | `61adb8ae5758c12e` | ✅ 未变（与协调者值一致） |
| `~/.dsh/settings.yaml` mtime | `2026-09-29 16:31:03.856405514` | 同 | ✅ 未被写 |
| `~/.dsh/profiles/web/cordis.patch.yml` mtime | `2026-09-25 14:56:16.715184271` | 同 | ✅ 未被写 |
| `~/.npm-global` / `.npm-global/lib` mtime | `2026-08-25 16:18:1x` | 同 | ✅ 现役全局 prefix 未被动 |
| `~/.dsh-017/sessions` 内 `session*` 文件数 | 27 | 27 | ✅ 隔离会话面未动 |
| `ss -ltn` 3080/3097 | LISTEN | LISTEN | ✅ 两实例未重启、未掉线 |
| 真 home 是否出现 `settings.yaml.imported` | 无 | **无** | ✅ 未触发任何对真 home 的破坏性 rename |
| 现役 `~/.dsh/**` 可写性 | EROFS | EROFS | ✅ 结构上不可写 |

### 2.8 组合树与 CLI 面实测（不启服务）

```
$ env -i PATH=/usr/bin:/bin HOME=$R/home DSH_HOME=$R/dsh-home … node <bin.js> --version
0.2.0-rc.1                      # exit=0

$ node <bin.js> --help          # 关键行
--profile <name>                the profile under $DSH_HOME/profiles to boot
--from-default-profile <name>   initialize a new custom profile from a shipped profile template
--dump-config                   print the composed profile tree and exit

$ node <bin.js> web --help      # 关键行
--host <host>                   bind host
--no-open                       do not open the Web UI in the default browser
--port <port>                   listen port; pass 0 to let the OS pick a free one
--trusted-host <authority...>   extra authority the /api browser-trust fence accepts

$ node <bin.js> --profile web --dump-config      # exit=0, 1259 行
```

**`dsh web --help` 会自动播种 profile 骨架**（这是新建 `DSH_HOME` 的绑定动作，无需手工建目录）：

```
$ find "$R/dsh-home"
dsh-home/profiles/web/cordis.patch.yml
dsh-home/profiles/web/package.json
dsh-home/profiles/web/pnpm-workspace.yaml
dsh-home/profiles/web/cordis.yml
```

其中 `package.json` 为 `{"name":"dsh-profile-web","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]}}}` —— **`dependencies` 为空，且 `--dump-config` 仍能成功组合 1259 行**，说明**默认 bundle 由 harness 自身解析，不要求 profile 内先跑 pnpm 安装**（自建/本地插件另论，见 §8）。

组合树中的端口来源（`dump-config` 行 479–486 原文）：

```yaml
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 3080          # ← 默认 = 现役端口
    compression: gzip
```

CLI 安全护栏实测（`dsh-web-app/lib/startup.js`）：`--host 0.0.0.0` 被**设计性拒绝**（"intentionally not supported yet for safety: it would expose remote code execution to the network"）；`--port` 非数字报错；`--port 0` 由 OS 选空闲端口。

---

## 3. 隔离根布局

### 3.1 首选（本沙箱内唯一实测可行）：工作区内单根 + 伪装 HOME

```
ISO=/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09
├── home/           # 伪装 HOME      （HOME=…；npm/git/ssh/各 homedir() 站点的落点）
│   └── .agents/    # 供 DSH_AGENTS_HOME 显式指向（消除 dsh-skill-filesystem 的 homedir() 泄漏）
├── dsh-home/       # DSH_HOME       （profiles/ logs/ sessions/ storages/ settings.yaml …）
├── npm-global/     # npm prefix     （bin/dsh + lib/node_modules/**；本轮已实测装成）
├── npm-cache/      # npm 缓存       （可复用 .workspace/npm-cache）
├── npm-logs/       # npm 日志       （可复用 .workspace/npm-logs）
├── ws/             # 启动 cwd       （**空目录**；绝不使用仓库根，避免新实例把仓库当工作区）
├── run/            # 日志/pidfile/闸门输出（**不得用 /tmp**，见 C-7）
└── evidence/       # 闸门输出与哈希基线（操作前/后对照）
```

**为什么必须是「单根 + 伪装 HOME」而不是「只设 DSH_HOME」**：见 C-4。`DSH_HOME` 只管 harness 数据面；`HOME` 覆盖才同时收编 `homedir()` 的全部 20+ 站点（`~/.agents`、npm 缓存/日志、git/ssh 全局配置、libreoffice 字体缓存、aws/anthropic sdk 配置等）。

**为什么 `ws/` 必须是空目录**：新实例的默认工作区 = 启动 cwd。若从仓库根启动，0.2.0 会拿到**真仓库**作为工作区（其文件工具可以改真代码）。这是本方案里最容易忽略的一条边界。

**路径风险（必须写进 Runbook）**：
1. `resolveDshHome()` 对非绝对路径执行 `resolve(...)`（相对 cwd）⇒ **`DSH_HOME`/`HOME`/`npm_config_prefix` 一律用绝对路径**；启动脚本第一件事就是 `cd` 固定或干脆不 `cd`（用 `--prefix`/绝对 launcher）。
2. 隔离根路径较深（`…/.workspace/audit-020/iso-020-t09/…`）。Node/工具的路径长度无问题，但**人肉复制时极易漏层**，故一律用变量 `${ISO}` 而非字面量。
3. **不要**把 `ISO/npm-global/bin` 加进 `PATH`：0.1.7 预检把「`$STAGE/bin` 入 PATH / 用 `npx` / 用裸 `dsh`」明确列为**隔离失效**（launcher 可能被解析回现役）。启动一律用**绝对 launcher 路径**，并跑「隔离自证」（§5.3）。
4. `.env` 无法改写 `DSH_HOME`（§2.4），所以不必为 `.env` 做额外防护；但**必须**防「变量为空」（C-5）。

### 3.2 备用 A（最终迁移形态，本沙箱不可用）：家目录双根，与 0.1.7 同形

```
~/.dsh-020            # DSH_HOME
~/.npm-global-dsh020  # npm prefix
```

- 优点：与现役/0.1.7 面完全对称，路径短、无伪装 HOME 的语义扭曲、跨会话稳定。
- 阻塞：本轮实测 `mkdir ~/.dsh-020` → **EROFS**（C-1、§2.1.1）。
- 解锁条件（**任选其一，均超出本轨道权限**）：① 由**真宿主 shell**（非本委托沙箱）执行；② 由协调者把该轨道的 sandbox mode 放宽到可写家目录。两者都需要**协调者/用户裁决**，不要自行提权重试。
- 若解锁，创建命令只需把 §4 中的 `${ISO}/dsh-home` → `~/.dsh-020`、`${ISO}/npm-global` → `~/.npm-global-dsh020`、并**去掉 HOME 覆盖**（改用真 HOME + `DSH_HOME`）；此时 §3.1 的路径风险 1/3/4 仍然全部适用。

### 3.3 备用 B：`/tmp` 暂存 —— **明确排除**

`bwrap --tmpfs /tmp` 使 `/tmp` 每次 bash 调用重建（§C-7 实测：写哨兵 → 下次调用 `ls /tmp` = 0 项）。`/var/tmp`、`/dev/shm` 未验证但同属根 fs（ro）可疑。⇒ **隔离根的任何一个组件都不放 `/tmp`**。

---

## 4. 逐条创建命令（对照新根，可直接复制）

> 前置纪律：本节的 `${ISO}` 必须落在 `.workspace/**` 内（沙箱唯一可写面）。命令**不启动任何服务**。

```bash
set -euo pipefail

# ── 0. 变量（全部绝对路径；禁止相对路径）
export ISO=/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09
export HOME_ISO="$ISO/home"
export DSH_HOME_ISO="$ISO/dsh-home"
export PREFIX_ISO="$ISO/npm-global"
export WS_ISO="$ISO/ws"
export NPM_CACHE=/home/CNS2026495165/dsh/.workspace/npm-cache
export NPM_LOGS=/home/CNS2026495165/dsh/.workspace/npm-logs
export DSH_VER=0.2.0-rc.1

# ── 0b. 清场：本 shell 可能已继承现役 DSH_*（**实测本会话即继承了 4 个**）
unset DSH_HOME DSH_SESSION_ID DSH_SESSION_JSONL DSH_SHELL DSH_WEB_URL || true

# ── 1. npm 硬前提：cache/logs 必须显式指向工作区（否则默认 cache 只读 → EROFS）
mkdir -p "$NPM_CACHE" "$NPM_LOGS"
export npm_config_cache="$NPM_CACHE"
export npm_config_logs_dir="$NPM_LOGS"
# 保险（0.1.7 记载的硬前提③；本轮实测非必需，见 §2.3.2）
export XDG_CACHE_HOME="$NPM_CACHE/xdg"

# ── 2. 建隔离根骨架
mkdir -p "$HOME_ISO/.agents" "$DSH_HOME_ISO/profiles/web" \
         "$PREFIX_ISO/lib" \
         "$WS_ISO" "$ISO/run" "$ISO/evidence"

# ── 3. 实测：家目录新根在本沙箱不可写（本步是**探测**，非创建；失败即证明 C-1）
if mkdir -p "$HOME/.dsh-020" 2>/dev/null; then
  echo "WARN: 家目录可写 → 可改用 §3.2 双根方案（请先裁决）"
else
  echo "OK: 家目录只读（EROFS），按 §3.1 工作区内根继续"
fi

# ── 4. 装 0.2.0 到隔离 prefix（网络需在 netns 之外；本步实测 546 包 / 23s）
npm install -g --prefix "$PREFIX_ISO" "@deepseek-ai/dsh@$DSH_VER" --no-audit --no-fund

# ── 5. 隔离自证①：launcher 必须解析在隔离 prefix 内
LAUNCHER="$PREFIX_ISO/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
RESOLVED="$(readlink -f "$PREFIX_ISO/bin/dsh")"
case "$RESOLVED" in
  "$PREFIX_ISO"/*) echo "OK 隔离自证: $RESOLVED" ;;
  *) echo "FAIL: launcher 解析到 $RESOLVED（隔离失效）" >&2; exit 1 ;;
esac

# ── 6. 隔离自证②：版本必须等于目标
test "$(node -e "console.log(require('$LAUNCHER/../../package.json').version)")" = "$DSH_VER" \
  && echo "OK 版本 $DSH_VER" || { echo "FAIL 版本不符" >&2; exit 1; }

# ── 7. 用伪装 HOME + DSH_HOME 跑一次只读 CLI，自动播种 profile 骨架
#      （--help 不 bind 端口；实测会在 $DSH_HOME/profiles/web/ 落 4 个文件）
env -i PATH=/usr/bin:/bin \
       HOME="$HOME_ISO" DSH_HOME="$DSH_HOME_ISO" \
       LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=dumb \
       node "$LAUNCHER" web --help >/dev/null

# ── 8. 组合树冒烟（不 bind）：必须 exit 0 且行数 > 1000
env -i PATH=/usr/bin:/bin \
       HOME="$HOME_ISO" DSH_HOME="$DSH_HOME_ISO" \
       LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=dumb \
       DSH_TELEMETRY_DISABLED=1 \
       node "$LAUNCHER" --profile web --dump-config > "$ISO/evidence/dump-config.yml"
test "$(wc -l < "$ISO/evidence/dump-config.yml")" -gt 1000 && echo "OK 组合树可组"

# ── 9. 隔离自证③：harness home 必须落在隔离根内（防 C-5 空白回退）
node --input-type=module -e "
import { resolveDshHome } from '$PREFIX_ISO/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-home-paths/lib/index.js';
const h = resolveDshHome();
if (!h.startsWith('$ISO/')) { console.error('FAIL home 越界: ' + h); process.exit(1); }
console.log('OK home = ' + h);
"   # 需在 HOME/DSH_HOME 已导出的环境里执行

# ── 10. 记录操作前基线（供 §7 未污染对照）
{
  sha256sum /home/CNS2026495165/.dsh/profiles/web/cordis.patch.yml \
            /home/CNS2026495165/.dsh/settings.yaml \
            /home/CNS2026495165/.dsh-017/profiles/web/cordis.patch.yml
  stat -c '%y %n' /home/CNS2026495165/.dsh/settings.yaml
  ss -Hltn | awk '{print $4}' | grep -E ':(3080|3097)$' | sort
  find /home/CNS2026495165/.dsh-017/sessions -type f -name 'session*' | wc -l
  ls /home/CNS2026495165/.dsh/settings.yaml.imported 2>&1 || true
} > "$ISO/evidence/baseline-live.txt"
```

**关于 `install-plugins.sh`（0.1.7 继承物）**：不要直接复制执行。它硬编码 `$HOME/.dsh/profiles/node_modules/@deepseek-ai`，在真 HOME 下会写现役（C-10）。若 0.2.0 仍需该插件，改写为
`FB="${DSH_HOME:?DSH_HOME 未设，拒绝执行}/profiles/node_modules/@deepseek-ai"` 后再用。

---

## 5. 端口分配与闸门命令

### 5.1 端口分配

| 端口 | 归属 | 本轮实测 |
|---|---|---|
| 3080 | **现役 0.1.1-rc.2 —— 绝对禁用** | LISTEN + bind=EADDRINUSE |
| 3097 | **隔离 0.1.7-rc.2 —— 绝对禁用** | LISTEN + bind=EADDRINUSE |
| **3098** | **0.2.0 隔离实例首选** | ss 无监听、nc closed、bind=OK |
| 3099 / 3102 / 3103 / 9224 / 9225 | 备用池（按顺序回退） | 全部 bind=OK |

分配规则：**首选 3098**；若 §5.2 闸门失败，按 `3099 → 3102 → 3103 → 9224 → 9225` 顺序回退，并把最终取值写入启动脚本变量 `NEWPORT`（禁止散落字面量）。**不要复用 3097**（容易与 0.1.7 隔离面混淆，且会掩盖「误启在旧根」的故障）。**不要用 `--port 0`**：OS 随机端口每次不同，闸门与验收脚本无法固定目标（仅作为「只验证能 bind」的最后手段）。

### 5.2 启动前必须通过的闸门（全部只读 / 无 `listen()`）

```bash
set -euo pipefail
ISO=/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09
declare -i FAIL=0
g(){ printf '\n── %s ──\n' "$1"; }

# G1 端口被占用即拒绝（ss 判 LISTEN；不用 -p，跨 PID ns 不可用）
g "G1 目标端口未被监听 (NEWPORT=3098)"
if ss -Hltn 2>/dev/null | awk '{print $4}' | grep -qE ':(3098)$'; then
  echo "FAIL: 3098 已在 LISTEN"; FAIL+=1
else echo "PASS: 3098 无监听"; fi

# G2 端口真的可 bind（阳性对照 3080 必须 EADDRINUSE，否则说明探针失灵）
g "G2 bind-only 探针（不调用 listen()）"
node -e '
const net=require("net");const ports=[3080,3098];let bad=0;
let i=0;(function n(){ if(i>=ports.length){process.exit(bad);}
 const p=ports[i++],s=net.createServer();
 s.on("error",e=>{const want=p===3080?"EADDRINUSE":"OK";
   console.log(`port=${p} ${e.code} ${p===3080&&e.code==="EADDRINUSE"?"PASS-对照":(p===3098?"FAIL":"INFO")}`);
   if(p===3098)bad=1; n();});
 s.listen({host:"127.0.0.1",port:p,exclusive:true},()=>{s.close(()=>{
   console.log(`port=${p} bind=OK ${p===3098?"PASS":"FAIL-对照未占用"}`);
   if(p===3080)bad=1; n();});});
})();'

# G3 隔离根落在工作区内（结构保证可写、且证明未用家目录方案）
g "G3 隔离根位置"
case "$ISO" in /home/CNS2026495165/dsh/.workspace/*) echo "PASS: 根在工作区内" ;;
  *) echo "FAIL: 越界根 $ISO"; FAIL+=1 ;; esac

# G4 DSH_HOME 非空、绝对、且落在隔离根内（防 C-5 空白静默回退）
g "G4 DSH_HOME 边界"
DH="${DSH_HOME_ISO:-}"; [ -z "$DH" ] && DH="$ISO/dsh-home"     # 闸门默认取本档变量
case "$DH" in
  "$ISO"/*) echo "PASS: DSH_HOME=$DH" ;;
  "")       echo "FAIL: DSH_HOME 为空 ⇒ 会静默回退到真 home"; FAIL+=1 ;;
  *)        echo "FAIL: DSH_HOME 越界: $DH"; FAIL+=1 ;;
esac

# G5 npm 生态三变量（缺 cache 会在真宿主上撞只读 cache）
g "G5 npm 变量"
for v in npm_config_cache npm_config_logs_dir npm_config_prefix; do
  eval "val=\${$v:-}"; [ -n "$val" ] && echo "PASS $v=$val" || { echo "WARN $v 未设"; }
done

# G6 隔离自证：launcher 解析在隔离 prefix 内
g "G6 隔离自证"
R="$(readlink -f "$ISO/npm-global/bin/dsh")"
case "$R" in "$ISO/npm-global"/*) echo "PASS launcher=$R" ;;
  *) echo "FAIL launcher 越界: $R"; FAIL+=1 ;; esac

# G7 现役基线（用于 §7 事后对照）
g "G7 现役基线快照"
sha256sum /home/CNS2026495165/.dsh/profiles/web/cordis.patch.yml \
          /home/CNS2026495165/.dsh/settings.yaml \
          /home/CNS2026495165/.dsh-017/profiles/web/cordis.patch.yml
ss -Hltn | awk '{print $4}' | grep -E ':(3080|3097)$' | sort
find /home/CNS2026495165/.dsh-017/sessions -type f -name 'session*' | wc -l

g "闸门汇总"
[ "$FAIL" -eq 0 ] && echo "ALL GATES PASS → 允许进入 §6 启动序列" || { echo "FAIL=$FAIL → 禁止启动"; exit 1; }
```

---

## 6. 启动 0.2.0 隔离实例的最小命令序列

> **本轨道未执行本序列**（硬约束「不启服务」）。下列每一步的**预期输出**均来自本轮的等价只读实测（`--version` / `--help` / `--dump-config` 已实跑通过，§2.8），唯一未实测的是真正的 `bind`+`serve` 那一步。

### 6.1 变体 A：**无外网冒烟启动**（推荐首次使用；`unshare -rn`，不可能发出任何外网请求）

```bash
set -euo pipefail
ISO=/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09
LAUNCHER="$ISO/npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
NEWPORT=3098

# ① 闸门（必须在 netns 之外跑；netns 内看不到宿主占用 → 恒假阳性）
bash "$ISO/run/gates.sh"                      # 预期: ALL GATES PASS
# ② 基线快照
bash -c '…§5.2 G7…' > "$ISO/evidence/baseline-live.txt"   # 预期: 3 行 sha256 + 2 行端口 + "27"
# ③ 干净启动：白名单环境（env -i）+ netns + 拉起 lo（实测必需）
mkdir -p "$ISO/run"
unshare -rn bash -lc '
  set -euo pipefail
  ip link set lo up                            # 预期: 无输出（exit 0）
  exec env -i \
    PATH=/usr/bin:/bin \
    HOME="'"$ISO"'/home" \
    DSH_HOME="'"$ISO"'/dsh-home" \
    DSH_AGENTS_HOME="'"$ISO"'/home/.agents" \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=dumb \
    DSH_TELEMETRY_DISABLED=1 \
    npm_config_prefix="'"$ISO"'/npm-global" \
    npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache \
    npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs \
    /usr/bin/node "'"$LAUNCHER"'" --profile web --port '"$NEWPORT"' --no-open --host 127.0.0.1
' > "$ISO/run/iso-020.stdout.log" 2> "$ISO/run/iso-020.stderr.log" &
echo $! > "$ISO/run/iso-020.pid"
```

**逐步预期输出**

| 步骤 | 预期 |
|---|---|
| `ip link set lo up` | 无输出，exit 0（本轮实测 `lo_up_exit=0`） |
| `dsh --profile web --port 3098 --no-open` | stdout 打印形如 `http://127.0.0.1:3098` 的 URL（`web-runtime` 的 `printUrl: true`）；随后进入 serve |
| `--no-open` | 不尝试拉起浏览器（`openBrowser:false`），netns 内也无浏览器可拉 |
| `DSH_TELEMETRY_DISABLED=1` | 生效与否**不可由 `--dump-config` 观察**（C-11）；需在启动后查日志/`cordis` 面 |
| 现役侧 | `ss -Hltn` 仍只有 3080/3097（netns 隔离，宿主看不到 3098 的监听） |

> **重要限制**：变体 A 的 GUI **无法从宿主浏览器访问**（netns 内 127.0.0.1 与宿主 127.0.0.1 不同）。它只用于「能否无外网启动」的冒烟。**不要**把它当成可用 GUI。

### 6.2 变体 B：**宿主可达的隔离 GUI**（`unshare -rn` **不用**；靠显式 `--port` + 闸门保证不撞现役）

```bash
set -euo pipefail
ISO=/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09
LAUNCHER="$ISO/npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
NEWPORT=3098

bash "$ISO/run/gates.sh"                                     # 预期: ALL GATES PASS

cd "$ISO/ws"                                                 # ★ 空目录，绝不用仓库根
exec env -i \
  PATH=/usr/bin:/bin \
  HOME="$ISO/home" \
  DSH_HOME="$ISO/dsh-home" \
  DSH_AGENTS_HOME="$ISO/home/.agents" \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=dumb \
  DSH_TELEMETRY_DISABLED=1 \
  npm_config_prefix="$ISO/npm-global" \
  npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache \
  npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs \
  /usr/bin/node "$LAUNCHER" --profile web --port "$NEWPORT" --no-open --host 127.0.0.1 \
  > "$ISO/run/iso-020.stdout.log" 2> "$ISO/run/iso-020.stderr.log" &
echo $! > "$ISO/run/iso-020.pid"
sleep 5
ss -Hltn | awk '{print $4}' | grep -E ':(3080|3097|'"$NEWPORT"')$' | sort
# 预期: 3080 / 3097 / 3098 三行 —— 前两者是现役与 0.1.7，第三条是本次隔离实例
```

**日志落点（全部在隔离根内，绝不用 `/tmp`）**

| 日志 | 位置 |
|---|---|
| 进程 stdout/stderr | `$ISO/run/iso-020.stdout.log` / `.stderr.log` |
| DSH 宿主结构化日志 | `$ISO/dsh-home/logs/dsh-host.jsonl`（沿用 0.1.7 的同一约定，实测在位） |
| npm 安装/操作日志 | `/home/CNS2026495165/dsh/.workspace/npm-logs/` |
| 闸门与基线证据 | `$ISO/evidence/` |

**环境变量清理清单（为什么用 `env -i` 白名单而不是逐个 `unset`）**：本会话实测继承了 `DSH_HOME=/home/CNS2026495165/.dsh`、`DSH_SESSION_ID`、`DSH_SESSION_JSONL`、`DSH_SHELL=1`、`DSH_WEB_URL=http://127.0.0.1:3080`，另有 `XDG_RUNTIME_DIR=/run/user/1001`（**指向根 fs，是越界引用**）、`SSH_AUTH_SOCK`、`XAUTHORITY`、`DISPLAY`、`DBUS_SESSION_BUS_ADDRESS`、`GPG_AGENT_INFO`、`LD_LIBRARY_PATH`、`PYTHONPATH` 等宿主会话残留。**黑名单极易漏项**（`BOOTSTRAP_PREFIXES` 就包含 `DSH_`/`XDG_` 两个前缀族）；白名单只需 8 个变量即可让 `--version` 与 `--dump-config` 正常通过（本轮实测），因此**白名单是默认做法**。

**`unshare -rn` 的位置（关键判定）**：
- 用 `unshare -rn` ⟺ 放弃宿主可达的 GUI，换取「结构上不可能发出任何外网/模型请求」（DNS 都失败）。
- 要宿主可达的 GUI ⟹ **不要** `unshare -rn`；此时「不发起模型请求」只能靠**不触发**来保证（不对话、不建会话），属于**流程纪律而非结构保证**，必须写进 Runbook 并在事后用日志扫描核对（0.1.7 的历史档即用「宿主日志内 0 条模型请求类记录」作为判据）。
- **两种变体都不要把 `--port` 省掉**（C-3）。

---

## 7. 回滚路径与「未污染现役」判据

### 7.1 一键废弃新根（不触碰任何现役面）

```bash
set -euo pipefail
ISO=/home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09
STAMP="$(date +%Y%m%d-%H%M%S)"

# ① 停实例（若在跑）：优先 SIGTERM，观察 graceful
if [ -f "$ISO/run/iso-020.pid" ]; then
  PID="$(cat "$ISO/run/iso-020.pid")"
  kill -TERM "$PID" 2>/dev/null || true
  for i in $(seq 1 10); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
  kill -KILL "$PID" 2>/dev/null || true
fi
# 兜底：netns 内的实例在宿主 ps 里不可见，只能靠端口判活
ss -Hltn | awk '{print $4}' | grep -qE ':3098$' \
  && echo "WARN: 3098 仍在 LISTEN，需人工确认后处理" || echo "OK: 3098 已释放"

# ② 归档而不是直接删（保留证据链）
mv "$ISO" "$ISO.rolled-back-$STAMP"
# 或彻底删除（仅在确认无需证据时）
# rm -rf "$ISO"

# ③ 事后校验（见 §7.2）
bash "$ISO.rolled-back-$STAMP/run/verify-no-pollution.sh"
```

**因为整个隔离根是工作区内的单目录**，回滚的爆炸半径恒等于「`.workspace/audit-020/iso-020-t09/**` 一个目录」——这正是选择工作区内单根（而非散落 `~/.dsh-020` + `~/.npm-global-dsh020` + `~/.agents` 等多点布局）的**首要可回滚理由**。

### 7.2 「未污染现役」判据（本沙箱可用的替代判据）

**为什么不能用 PID**：本沙箱每个命令都在 `bwrap --unshare-pid` 内，`/proc` 是新 PID namespace 的 procfs；`ps aux` 只见 bwrap 自身与本次命令，宿主 dsh 进程**结构上不可见**（实测 §2.1.1 附注）。历史档记载的 `ps -p <宿主 pid>` → `NO_SUCH_PID` 由此定性，**与现场健康无关**。

**替代判据（四级，全部本轮实测有效）**

| # | 判据 | 命令 | 通过标准 | 本轮实测 |
|---|---|---|---|---|
| **P1** | **配置字节不变**（最强内容判据） | `sha256sum ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/settings.yaml ~/.dsh-017/profiles/web/cordis.patch.yml` | 与 §5.2 G7 基线逐字符相同；且 mtime 不变 | ✅ `513413e7…` / `0f19b0fe…` / `61adb8ae…` 操作前后同值 |
| **P2** | **端口未掉线 + 未被抢**（等价于「进程未重启」） | `ss -Hltn \| awk '{print $4}' \| grep -E ':(3080\|3097)$' \| sort` | 两次采样都恰有这两行；且 3080/3097 的 **bind-only 探针恒为 EADDRINUSE** | ✅ LISTEN 连续；bind 探针 EADDRINUSE |
| **P3** | **隔离面未被写** | `find ~/.dsh-017/sessions -type f -name 'session*' \| wc -l`；`ls ~/.dsh/settings.yaml.imported` | 计数与基线同（27）；真 home **不得**出现 `.imported` | ✅ 27 / 不存在 |
| **P4** | **结构不可写**（最根本） | `grep -E ' / ' /proc/mounts`；`touch ~/.dsh/.probe` | `/ ext4 ro`；touch → EROFS | ✅ ro / EROFS |

**P2 的「未重启」推理说明**：本沙箱无法读 PID。但 3080/3097 的监听**从未间断**、且进程若重启，其 `bind()` 窗口在竞态下必然出现 `EADDRINUSE` 之外的结果。更稳的加强判据（本轮未用，因需宿主可见性）：**宿主侧** `ss -ltnp` 取 pid → `/proc/<pid>/stat` 第 22 字段 starttime 前后一致，或 `/proc/<pid>/environ` 校验 `DSH_HOME`。真宿主执行时**应加上这两条**，本沙箱内只能退回 P1–P4。

**P4 的额外价值**：`/` 是 ro-bind ⇒ 本轮（以及任何在此沙箱内运行的轨道）对 `~/.dsh/**`、`~/.dsh-017/**`、`~/.npm-global*/**` 的**内容级污染在结构上不可能发生**。这是比任何哈希比对更强的保证，也是为什么本档敢把「零写入」写成事实而非推断。

**护栏（回滚流程自身不得越界）**：回滚脚本只允许触碰 `$ISO` 与其父目录下的归档名；**禁止** `rm -rf ~/.dsh*`、`rm -rf /home/CNS2026495165/.*`、禁止按通配符删除家目录条目。

---

## 8. 本档未验证项（不得当成已验证）

| # | 未验证项 | 为什么未验证 | 后续验证方式 |
|---|---|---|---|
| U-1 | **0.2.0 隔离实例真正 `bind` + serve 成功** | 硬约束「不得启动监听端口的服务」，本轨道不启服务。所有**前置**阶段（版本、help、组合树 1259 行、launcher 隔离自证）已实测通过 | 由执行轨道按 §6 跑一次，以 `ss` 出现 `127.0.0.1:3098` + stdout 打印 URL 为通过标准 |
| U-2 | `DSH_TELEMETRY_DISABLED=1` 是否真的停用遥测行 | 实测该开关只在真实启动路径 `lib/profile-boot-*.js:269` 注入；`--dump-config` 走独立路径，组合树里对应行**无 `disabled: true`**（C-11） | 实启后查 `$ISO/dsh-home/logs/dsh-host.jsonl` 或走 `cordis` 面读该 entry 的 disabled 状态 |
| U-3 | 自建/本地插件（`@local/*` 等 9–12 个）在 0.2.0 下能否解析 | 本档只验证**默认 bundle** 可组合（profile `dependencies` 为 `{}` 时 `--dump-config` 成功）。物理落盘/链接形态属迁移面 | 由插件迁移轨道按「非闭包名字必须物理落盘」核对；0.2.0 仅清理指向 `.dsh-module-fallback` 的自建链接，形态仍适用 |
| U-4 | `dsh plugin --profile web …`（pnpm 侧）在隔离根内可跑 | 本轮未做任何 plugin 安装操作（只读勘察） | 需要时在隔离根内跑；注意 `pnpm` 实测位于**现役** `~/.npm-global/bin/pnpm`（11.26.0），其 store 会落伪 HOME → 需显式 `PNPM_HOME`/store 收编 |
| U-5 | Vite 前端产物、`--trusted-host` 语义、LAN 可达性 | 未启服务，无法观测 | 实启后按需验证；注意 `--host 0.0.0.0` 被**设计性拒绝** |
| U-6 | `/var/tmp`、`/dev/shm` 的可写性 | 只实测了 `/tmp`（每次调用重建，零持久化）与家目录（ro） | 不必要：方案已规定「所有暂存只落 `.workspace/**`」 |
| U-7 | 卸载/回滚后 3098 的释放时序 | 未启服务，无从观察 | 回滚时按 §7.1 的端口释放等待循环实测 |
| U-8 | 0.1.7 预检脚本引用的 `NEWBIN` 变量 | 该脚本自身**未定义** `NEWBIN`（`workbuddy-reverse-proxy/proto/dsh-0.1.7-preflight.sh:293,300`），是历史脚本的缺陷，与本档无关 | 若复用该脚本，先补 `NEWBIN` 定义 |

**未验证项的安全含义**：U-1 是「尚未证明能跑」，**不是**「已验证能跑」。任何下游结论（例如「0.2.0 迁移路径可用」）都**不得**建立在 U-1 之上。

---

## 9. 附：本档生成的关键常量（供下游脚本引用）

```
ISO（本轮实测根）  = /home/CNS2026495165/dsh/.workspace/audit-020/iso-020-t09
PREFIX             = $ISO/npm-global
LAUNCHER           = $ISO/npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
DSH_HOME           = $ISO/dsh-home
HOME（伪装）       = $ISO/home
启动 cwd           = $ISO/ws          （必须为空目录）
首选端口           = 3098             （备用 3099 → 3102 → 3103 → 9224 → 9225）
禁用端口           = 3080（现役 0.1.1-rc.2）/ 3097（隔离 0.1.7-rc.2）
DSH_VER            = 0.2.0-rc.1
tarball sha256     = ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216
npm integrity      = sha512-F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng==
安装规模           = 546 包 / 26134 文件 / 521 MB / 23 s
运行版本           = node v22.23.2 / npm 10.9.8 / pnpm 11.26.0
现役基线(patch)    = 513413e7cffb3191…  ~/.dsh/profiles/web/cordis.patch.yml
现役基线(settings) = 0f19b0fe0e1b8c80…  ~/.dsh/settings.yaml
隔离基线(patch)    = 61adb8ae5758c12e…  ~/.dsh-017/profiles/web/cordis.patch.yml
```

---

## 10. 与协调者基线（`.workspace/audit-020/reports/MEASURED-BASELINE.md`）的交叉核对

本档写入后，该文件已由协调者发布（同期）。逐项核对结果：

| 项 | 本档实测 | 基线文件 | 结论 |
|---|---|---|---|
| 0.2.0-rc.1 tarball sha256 | `ceb66beb…d216` | `ceb66beb…d216` | ✅ 一致 |
| 0.2.0 已有一次成功的工作区内隔离 prefix 安装 | 本档：`.workspace/audit-020/iso-020-t09/npm-global`（546 包 / 26134 文件 / 521 MB / 23 s） | 基线：`.workspace/iso-020/npm-global`（540 MB，flat 布局） | ✅ **两条独立轨道各自装成一次**，互为复现证据（体积差异来自测量口径，非内容差异） |
| 现役 / 隔离配置哈希 | `513413e7…` / `0f19b0fe…` / `61adb8ae…` | 同（见 PLAN.md §已核实事实） | ✅ 一致 |
| dist-tags | `latest=0.1.7-rc.2`、`next=0.2.0-rc.1`、`alpha=0.1.7-alpha.2` | 同 | ✅ 一致 |

**一条对 T09 结论有实质加强作用的交叉结论**：基线 §2 记载 `@deepseek-ai/dsh` 的 `lib/**` 在 0.1.1-rc.2 / 0.1.7-rc.2 / 0.2.0-rc.1 之间**逐字节相同**。这意味着本档关于 CLI/引导层的全部实测结论——`--profile`/`--port`/`--help` 语义、`$DSH_HOME/profiles` 约定、默认端口 `?? 3080`、`telemetryDisabledEnv` 只在 `profile-boot-*.js` 注入、`.env` 的 bootstrap-only 拒绝——**同等地适用于 0.1.7**。

由此得到两个推论（本档据此把 §2.2 的「历史形态」当作**有效的 0.2.0 先例**而非仅历史记载）：

1. **默认端口 3080 不是 0.2.0 的新回归**，0.1.7 亦然；0.1.7 隔离面之所以安全，正是因为它显式传了 `--port 3097`。⇒ 结论 C-3 应从「0.2.0 注意事项」升格为「DSH 隔离启动的通用强制纪律」。
2. **`settings.yaml` 破坏性 rename 语义在 0.1.7 上已生效**（`~/.dsh-017/settings.yaml.imported` 0 字节是其实证），故 C-9 同样是既有机制而非新引入；0.1.7 隔离面「置 0 字节 `settings.yaml` + 独立冷备」的做法可**直接沿用**到 0.2.0。

**对备用方案 §3.2 的补强**：基线文件末尾记载 `.workspace/iso-020/npm-global` 是 **flat 布局、`node_modules/@deepseek-ai/` 直接可解析**，与本档 §2.3.2 观察到的 prefix 布局一致。⇒ 无论根落在工作区还是家目录，**npm 侧的隔离手段（`--prefix` + `npm_config_cache`/`logs_dir`）都不变**；差异只在 `HOME`/`DSH_HOME` 的取值与「家目录是否可写」这一前提上。
