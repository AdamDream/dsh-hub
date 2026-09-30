# T25 — 隔离根内 0.2.0 安装与启动实测报告

- 轨道：T25（执行勘察，含实际安装实测）
- 日期：2026-09-29（本地时区 +08:00）
- 目标版本：`@deepseek-ai/dsh@0.2.0-rc.1`（npm dist-tag `next`）
- 本档角色：受协调者派发的子代理；继承 `workspace-write` 沙箱；**未使用任何提权**，**未改动任何现役资产**

---

## 1. 结论摘要

**能跑起来。**

0.2.0-rc.1 在**本沙箱内、工作区内的隔离根中**完成了「真实 npm 安装 → 离线可用性检查 → 隔离网络命名空间内启动 web 实例 → 干净停栈」的**全链路实测，全部成功**：

| 环节 | 结果 |
|---|---|
| npm 安装 | ✅ 成功（`added 546 packages in 12s`，exit 0） |
| CLI 离线可用 | ✅ `--version` = `0.2.0-rc.1`；`--help` 正常；`--dump-config` / `--dump-default-config` 正常 |
| 隔离 web 实例启动 | ✅ **成功**，boot 后约 1s 内监听 `127.0.0.1:3102`（netns 内） |
| 网络隔离 | ✅ `unshare -rn` 被沙箱**允许**；实例完全无出网能力（无路由、DNS 死） |
| 真实模型请求 | ✅ 未发生（出网被物理阻断；且显式置空所有模型 key） |
| 停栈 | ✅ 干净：node 子进程确认消失，3102 无监听，无残留进程 |
| 现役 3080 / 3097 | ✅ 全程未受影响（收尾复测 3080→HTTP 200、3097→HTTP 401） |

**唯一非阻塞瑕疵**：`--dump-config-schema` 返回 **rc=1** 并报 4 条 `unrecognized Loader tree carrier` 错误（详见 §4.3），但它**不影响启动**——同一份 profile 的 web 实例照常启动成功。这更像 0.2.0 配置校验器的口径问题，建议后续轨道单独跟进。

**关键结论**：0.2.0 的 web profile 在「packages 依赖为空」的形态下，**bundle 由 CLI 自身 `node_modules` 解析，因此启动阶段完全不需要联网、也不需要 pnpm install**。这是隔离根能一次装成、且能在无网命名空间内启动的根本原因。

---

## 2. 隔离根布局

全部位于工作区内，**未写入任何工作区之外的路径**：

```
/home/CNS2026495165/dsh/.workspace/iso-020/
├── home/                                  # 伪装 HOME（沙箱内可写）
│   └── .dsh-020/                          # DSH_HOME（伪装）
│       └── profiles/web/                  # 首次 --dump-default-config 时自举生成
│           ├── cordis.patch.yml
│           ├── cordis.yml
│           ├── package.json               # dependencies: {}  ← 关键
│           └── pnpm-workspace.yaml
├── npm-global/                            # npm prefix
│   ├── package.json                       # npm 自建（mount 根）
│   ├── package-lock.json                  # 373,986 B（完整依赖锁）
│   └── node_modules/                      # 540M / 26,146 files
├── logs/
│   ├── install.log                        # 安装原始输出
│   ├── install-fingerprint.txt            # 安装物指纹（防篡改校验）
│   ├── run-web-in-netns.sh                # 受控启动脚本（含看门狗 + trap 清理）
│   ├── web-netns.out                      # 实例 stdout
│   └── web-netns.evidence.log             # 启动/隔离/停栈全过程证据
└── reports/                               # （无；报告落在 audit-020/reports）
```

约定：
- 伪装 HOME：`/home/CNS2026495165/dsh/.workspace/iso-020/home`
- `DSH_HOME`：`/home/CNS2026495165/dsh/.workspace/iso-020/home/.dsh-020`
- npm prefix：`/home/CNS2026495165/dsh/.workspace/iso-020/npm-global`
- 端口：**3102**（3098 备用，两者启动前均确认空闲）

> ⚠️ **共享工作区注意事项**：本轨道执行期间，另有参与者（疑似 T09 或同轨并行档）在**同一** `.workspace/iso-020/` 下并发写入 `bin/`、`lockgen/`、`lockgen-omitdev/`、`manifests/`、`meta/`、`npm-logs/`、`off-test/`、`pkgs/`（16:46–16:57 时间戳，非本档创建）。本档**只写入 `iso-020/home/`、`iso-020/npm-global/`、`iso-020/logs/`**，未与他人路径冲突；`npm-global` 全程未被他人触碰（安装物指纹前后一致）。建议后续协调者对 `iso-020/` 做子目录归属划分，避免同名路径互踩。

---

## 3. 安装实测

### 3.1 环境

```
node v22.23.2   npm 10.9.8
~ (真实 HOME) = 只读文件系统（touch 探测确认：只读文件系统）
→ 必须使用工作区内的伪装 HOME
npm_config_cache    = /home/CNS2026495165/dsh/.workspace/npm-cache   （275M，可写）
npm_config_logs_dir = /home/CNS2026495165/dsh/.workspace/npm-logs
```

### 3.2 命令（真实执行）

```sh
env -i PATH=/usr/bin:/bin \
  HOME=$ISO/home \
  npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache \
  npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs \
  npm install @deepseek-ai/dsh@0.2.0-rc.1 \
    --prefix /home/CNS2026495165/dsh/.workspace/iso-020/npm-global \
    --no-fund --no-audit
```

### 3.3 原始输出（`logs/install.log` 全文）

```
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 546 packages in 12s
EXIT_CODE=0
```

### 3.4 实测指标

| 指标 | 实测值 |
|---|---|
| 结果 | **成功**，exit code 0 |
| 耗时 | **12.5 s**（`12.488870510`，含依赖解析+下载+解包） |
| 顶层依赖包目录 | 546 packages（npm 报告）/ `node_modules` 下 147 个 `package.json`（去重后实体包） |
| `@deepseek-ai/*` scope 包数 | **289** |
| 安装体积 | **540 M**（`node_modules`），26,146 个文件 |
| package-lock.json | 373,986 B |
| npm cache 增量 | 273–275 M（全新 cache） |
| 磁盘余量 | 1.5 T 可用（`/dev/nvme0n1p2`） |
| 唯一告警 | `node-domexception@1.0.0` 已废弃（来自传递依赖，无影响） |

**布局说明**：`--prefix` 加在「无项目 package.json 的目录」上时，npm 10 采用**本地前缀布局**——生成 `npm-global/package.json` + `package-lock.json` + `node_modules/`，**而非** `npm-global/lib/node_modules/` 的全局布局。因此任务描述里的路径 `npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js` **不存在**，实际路径为：

```
npm-global/node_modules/@deepseek-ai/dsh/lib/bin.js
```

（若需要 `lib/node_modules` 全局布局，应改用 `npm install -g --prefix <iso>/npm-global ...`；本档未采用，因 `--prefix` 形式已满足「隔离根内可运行」这一目标，且行为可复现。）

### 3.5 完整性与防篡改

```
原始 tarball sha256（安装后复测）:
ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216   ← 与协调者给定值一致 ✅

安装物指纹（安装后 / 停栈后两次测量一致）:
935e95d05f4dc70a8a013eea59da80028946b5c139e45c6351dcaf2810ca00a1  .../@deepseek-ai/dsh/lib/bin.js
6c5d2b98ca97920fffe81eaff8455dfd1e97524c8b3a7a3b0cac4c960ebb363c  .../@deepseek-ai/dsh/package.json

解析版本核对（均为 0.2.0-rc.1）:
@deepseek-ai/dsh / dsh-web-app / dsh-base / dsh-tool-bash / dsh-client-ui-chat
```

registry 侧核对（隔离前只读查询，非安装必需）：`dist-tags = {alpha: 0.1.7-alpha.2, latest: 0.1.7-rc.2, next: 0.2.0-rc.1}`，CLI 直接依赖 82 项。

---

## 4. 离线可用性检查

全部在 `env -i` + 伪装 HOME/DSH_HOME 下执行，**未联网**。

### 4.1 `--version` / `--help` ✅

```
$ node .../@deepseek-ai/dsh/lib/bin.js --version
0.2.0-rc.1
rc=0

$ node .../@deepseek-ai/dsh/lib/bin.js --help
Usage: dsh [--profile] <name> [options] [app-args...]
       dsh plugin --profile <name> <pnpm-args...]
Options:
  -V, --version                  output the version number
  --profile <name>               the profile under $DSH_HOME/profiles to boot
  --from-default-profile <name>  initialize a new custom profile from a shipped template
  --patch <path>                 extra patch-list overlay applied after the profile layer (repeatable)
  --dump-config                  print the composed profile tree and exit
  --dump-config-schema           print JSON Schema for profile entries and patches without mounting
  --dump-default-config          print the profile tree without its user layer or --patch overlays and exit
rc=0
```

### 4.2 `--dump-default-config` / `--dump-config` ✅

```
$ ... --profile web --dump-default-config     → rc=0，1259 行组合树
$ ... --profile web --dump-config             → rc=0，1259 行组合树
```

确认关键监听配置项默认值（源自 dump）：

```yaml
- id: ...
  name: '@deepseek-ai/dsh-host-webserver'
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 3080        # ← 默认 3080，与现役实例同端口，必须显式 --port 覆盖
```

### 4.3 `--dump-config-schema` ⚠️ 可用但 rc=1

```
$ ... --profile web --dump-config-schema
rc=1   stdout=841,073 bytes（合法 JSON，title="Cordis configuration for profile web", $defs=106 项）
stderr:
  dsh: warning: [/112] config/contactFormUrl: regular-expression syntax or Unicode semantics require native validation
  dsh: warning: [/149] config/transcriptView: loose validation can replace invalid values with defaults
  dsh: error: [/179] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
  dsh: error: [/180] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
  dsh: error: [/181] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
  dsh: error: [/182] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
```

判读：
- schema **本身产出完整且是合法 JSON**，说明「打印 schema」这件事是通的；
- rc=1 来自 4 条 `[/179..182] unrecognized Loader tree carrier` **校验错误**（配置校验器比启动路径更严格）；
- **不阻塞启动**：同一 profile 的 web 实例随后启动成功（§5）。这 4 个条目大概率是 `dsh-web-app` bundle 里用了非 `cordis:group`/`cordis:include` 的子集合载体；
- 不带 `--profile` 调用时行为不同：`error: --profile <name> is required`（rc=1，0 字节输出），属正常参数校验。

### 4.4 副作用（需周知）

`--profile web --dump-default-config` 会在**空的 DSH_HOME 上自举生成** `profiles/web/`（`cordis.yml`、`cordis.patch.yml`、`package.json`、`pnpm-workspace.yaml`）。生成的 `package.json` 关键内容：

```json
{ "name": "dsh-profile-web", "private": true, "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }
```

`dependencies` 为 **空** ⇒ bundle 是从 CLI 自身 `node_modules` 解析的 ⇒ **启动不需要 pnpm install、不需要网络**。这是本次实测能成立的前提，也解释了为什么 `unshare -rn` 内启动毫无障碍。

---

## 5. 启动实测

### 5.1 网络隔离方式 ✅ `unshare -rn`（沙箱**允许**，未提权）

```
$ unshare -rn sh -c '...'
in-netns
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN
```

**净网证据（实例运行期间，netns 内实测）**：

| 探测 | 结果 | 判读 |
|---|---|---|
| `ip route` | 空 | 无默认路由，物理无出网路径 |
| 出网 `curl https://registry.npmjs.org/` | `curl: (6) Could not resolve host`，code `000` | 阻断 ✅ |
| 出网 `curl https://api.deepseek.com/` | `curl: (6) Could not resolve host`，code `000` | **真实模型端点不可达** ✅ |
| `getent hosts registry.npmjs.org` | rc=2（解析失败） | DNS 撕毁 ✅ |
| 从 netns 内访问**父**命名空间的 `127.0.0.1:3080` / `:3097` | `curl: (7) Couldn't connect` | 现役服务在隔离实例侧**不可见、不可达** ✅ |

**反向隔离证据（父命名空间侧，实例运行期间）**：

| 探测 | 结果 | 判读 |
|---|---|---|
| 父 netns `ss -ltn \| grep :3102` | **无匹配** | 实例监听在父侧完全不可见 |
| 父 netns `curl http://127.0.0.1:3102/` | `curl: (7) Failed to connect ... Couldn't connect to server` | 父侧无法访问实例 ✅ |
| netns inode | 实例侧 `net:[4026533537]`，父侧 `net:[4026531840]` | 确为两个不同网络命名空间 |

结论：**双向都不通**，是真实 netns 隔离，而非同命名空间内换端口。

### 5.2 启动命令

外层（`run_in_background: true`，长任务）：

```sh
PORT=3102 LIFETIME=200 timeout 300 unshare -rn sh \
  /home/CNS2026495165/dsh/.workspace/iso-020/logs/run-web-in-netns.sh
```

内层实例（脚本以 `env -i` 清理环境）：

```sh
env -i PATH=/usr/bin:/bin \
  HOME=/home/CNS2026495165/dsh/.workspace/iso-020/home \
  DSH_HOME=/home/CNS2026495165/dsh/.workspace/iso-020/home/.dsh-020 \
  DEEPSEEK_API_KEY= OPENAI_API_KEY= ANTHROPIC_API_KEY= \
  NO_PROXY='*' no_proxy='*' \
  node /home/CNS2026495165/dsh/.workspace/iso-020/npm-global/node_modules/@deepseek-ai/dsh/lib/bin.js \
    --profile web --no-open --port 3102
```

要点：
- 显式 `--port 3102`（**默认是 3080，与现役实例冲突，必须覆盖**）；`--no-open` 避免拉起浏览器。
- 显式 `--host` 未传，走默认 `127.0.0.1`；且 0.2.0 自身**拒绝** `--host 0.0.0.0`（源码 `startup.js` 明确 `program.error(...)`，防 RCE），等于多一层保险。
- **空模型 key** 三重保险：`env -i` 丢弃父环境 + 显式置空三个 key 变量 + netns 无出网。
- 端口占用**启动前确认**：3098/3102 均 `FREE`（`ss` 无匹配且 TCP connect refused）。

### 5.3 启动结果：**成功**（证据来源 `logs/web-netns.evidence.log`）

```
[16:54:46] launching: node .../dsh/lib/bin.js --profile web --no-open --port 3102
[16:54:46] node child pid=57
[16:54:46] waiting for the app to boot (poll every 1s, up to 120s)
[16:54:47] READY after 1s: HTTP 401 on 127.0.0.1:3102          ← boot 约 1 秒
[16:54:47] --- in-netns HTTP evidence ---
[16:54:47] GET / headers:
           HTTP/1.1 401 Unauthorized
           cache-control: no-store
           content-type: text/plain; charset=utf-8
           Connection: keep-alive
           Keep-Alive: timeout=5
           Transfer-Encoding: chunked
[16:54:47] GET / body bytes: 68
[16:54:47] GET / body head: dsh web authentication required; reopen the URL printed by dsh web.
[16:54:47] tokenized URL present in stdout: yes (token value redacted, sha256=7b6a2029a289d300)
[16:54:47] GET /?token=<redacted> -> HTTP 303
[16:54:47] listener inside netns:
           LISTEN 0      511        127.0.0.1:3102      0.0.0.0:*
[16:54:47] netns inode of node process: net:[4026533537]
[16:54:47] node socket fd count: 1
[16:54:47] waiting LIFETIME=200 s before clean stop
```

实例 stdout（`logs/web-netns.out`，**token 值已脱敏**）：

```
dsh web: http://127.0.0.1:3102/?token=<REDACTED>
```

「是否真的起来了」的判据（同时满足，故判定为**真启动**）：
1. 进程存活（node 子进程 pid=57 持续存在至停栈）；
2. 端口**真实监听**：netns 内 `ss` 显示 `LISTEN 127.0.0.1:3102`，node 持有 1 个 socket fd；
3. **HTTP 层应答**：`GET /` 返回结构化 `401 + 明确业务文案`（非 TCP 层连接成功而已）；
4. **业务路径可用**：带 stdout 打印的 token 访问 `/?token=…` 返回 `303`（认证跳转），证明 token 鉴权链路工作；
5. 父命名空间侧对该端口**完全不可见**（排除同命名空间串扰）。

### 5.4 一次失败尝试（如实记录，属自测方法学问题）

**第 1 次尝试未取得有效证据**，原因是**我的就绪判据写错**，非产品问题：

- 错误：`curl ... -w '%{http_code}'` 在连接失败时会把 `000` 写进 stdout，而我的判断条件是「`!= "000"` 且非空」，`2>/dev/null || echo "000"` 的写法又把 stderr 吞掉，导致返回值拼接成 `000000`，**假通过**；
- 后果：在 t=0 就误判 READY，紧接着立即探测（此时应用尚未监听）→ `curl: (7) Couldn't connect`，**没有采到任何有效启动证据**；
- 修正：改为 `[1-9][0-9][0-9]` 的严格匹配 + 1s 轮询窗口，第 2 次尝试即在 1s 处正确捕获 `HTTP 401`；
- 附注：该次实例**干净停栈成功**（16:53:29，pid 56 confirmed gone），可视为对停栈路径的一次有效验证。

> 教训（供其他轨道复用）：**不得**用 `curl -w '%{http_code}'` 的裸输出判定服务就绪；must 用 3 位数字且首位非 0 的严格匹配。

---

## 6. 停栈与残留检查

### 6.1 停栈机制

脚本内置**双保险**：`trap cleanup INT TERM HUP` + 绝对寿命看门狗（`LIFETIME=200s` 后自杀）。`cleanup` 依次 `SIGTERM` → 轮询至多 10s → `SIGKILL` 兜底 → 复核进程消失 + 端口状态。

### 6.2 停栈证据（`logs/web-netns.evidence.log` 尾部，无人工干预，自动完成）

```
[16:58:06] WATCHDOG fired after 200s
[16:58:06] CLEANUP invoked
[16:58:06] sending SIGTERM to 57
[16:58:07] node pid 57 confirmed gone           ← 我启动的进程已消失
[16:58:07] port state after stop (inside netns): no listener   ← 端口已释放
[16:58:07] RUNNER exit
UNSHARE-OUTER-RC=0
```

### 6.3 收尾独立复核（停栈后另起命令实测）

| 检查项 | 结果 |
|---|---|
| 端口 3098 / 3102 | **均 FREE**（`ss -ltn` 无匹配，无监听） |
| 残留进程 | 无 iso-020 / unshare / `bin.js` 进程（bgrep 命中的仅为本次检查自身的 `bwrap` 包装器） |
| 现役 3080 | `HTTP 200` ✅ 未受影响 |
| 现役 3097 | `HTTP 401` ✅ 未受影响 |
| 写入范围 | 仅 `.workspace/iso-020/**` 与 `.workspace/audit-020/reports/**` |
| `~/.npm-global*` | 未安装、未写入 ✅ |
| `sandbox_permissions` | 全程未使用（**提权一次都没发生**） |

**停栈干净，无残留。**

---

## 7. 阻塞点与下一步

### 7.1 阻塞点：**无硬阻塞** —— 目标已达成

0.2.0-rc.1 确实能在本沙箱、本工作区隔离根内跑起来，无需任何提权，无需网络（启动阶段）。

### 7.2 需要跟进的非阻塞问题

| # | 问题 | 影响 | 建议下一步 |
|---|---|---|---|
| B1 | `--dump-config-schema` rc=1，4 条 `[/179..182] unrecognized Loader tree carrier` | 不影响启动；但迁移验收若用该命令做「配置可校验」判据会**误判失败** | 定位 `dsh-web-app` bundle 中 179–182 号条目用的子集合载体写法（应为 `cordis:group` / `cordis:include`），判定是 0.2.0 校验器收紧还是产品缺陷 |
| B2 | `--prefix` 非全局布局（无 `lib/node_modules`、无 `bin/` shim） | 直接用 `dsh` 命令名不可用，需全路径 `node <iso>/…/bin.js` | 若要贴近生产形态，改用 `npm install -g --prefix <iso>/npm-global` 复测 |
| B3 | 隔离根 `.workspace/iso-020/` 被多参与者并发使用 | 本次未冲突（已指纹校验），但存在路径互踩风险 | 协调者划分 `iso-020/<track>/` 子目录归属 |
| B4 | 每个 DSH bash 命令在独立 PID 命名空间（`bwrap --unshare-pid`）内运行 | 跨命令**看不到**彼此进程；不能靠 `ps` 判定「我启动的进程是否还在」 | 判定存活请用「端口是否监听」「HTTP 判据」；本档复位后 `ps` 查不到实例并非残留证据 |

### 7.3 后续轨道可直接复用的结论

1. **安装**：`npm install @deepseek-ai/dsh@0.2.0-rc.1 --prefix <iso>/npm-global`（配 `npm_config_cache` 指向可写 cache），约 12.5s / 540M / 546 包，可稳定复现。
2. **启动**：`env -i HOME=<fake> DSH_HOME=<fake>/.dsh-020 node <iso>/npm-global/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --no-open --port <free>` —— web profile 的 `dependencies` 为空，**启动零联网、零 pnpm install**。
3. **必须显式 `--port`**：默认 3080 会直接撞现役实例。
4. **隔离首选 `unshare -rn`**：本沙箱允许，且是「真实模型请求不可能发生」的最强证明（比空 key 强）。
5. **就绪判据**：`HTTP 401`（无 token）或 `HTTP 303`（带 token）才是真起来。

---

## 8. 未验证项（明确边界）

以下**本次未做**，不得据本报告推断：

1. **未做浏览器级 UI 验证**：仅在 HTTP 层确认 `401`/`303` 与监听；未跟随 303 落地页、未加载 SPA 资产、未验证 WebSocket/会话创建。前端 bundle 是否完整可用**未验证**。
2. **未验证会话/对话功能**：**全程未发起任何真实模型请求**（按要求且被 netns 阻断），因此 LLM 链路、工具调用、会话持久化**均未验证**。
3. **未做 0.1.7 → 0.2.0 的会话数据/配置兼容迁移实测**：本次是**全新空 DSH_HOME 冷启动**，未接入任何现役 `~/.dsh` 会话或配置，**不构成迁移兼容性结论**。
4. **未测 TUI / headless / acp / sdk 等其它 profile**：只测了 `web`。
5. **未测长期稳定性**：实例只存活 200s（受控寿命），未观察长时运行、内存增长、或 HMR/热载行为。
6. **未测 `dsh plugin` 子命令**：`plugin` 走 pnpm，在无网 netns 内预期失败，未实测。
7. **未验证 3098 端口实际启动**：仅确认空闲，实例实际使用的是 3102。
8. **B1 的根因未定位**：仅记录现象，未读完 `[/179..182]` 对应条目源码。
9. **在线安装侧的一个边界**：本次安装**联网进行**（按任务要求）；「离线安装（预置 tarball + 离线 cache）」未实测。

---

## 附：本档产生的文件

```
.workspace/audit-020/reports/T25-isolated-020-boot-attempt.md   ← 本报告
.workspace/iso-020/logs/install.log                             ← 安装原始输出
.workspace/iso-020/logs/install-fingerprint.txt                 ← 安装物指纹
.workspace/iso-020/logs/run-web-in-netns.sh                     ← 受控启动脚本
.workspace/iso-020/logs/web-netns.out                           ← 实例 stdout（token 已脱敏）
.workspace/iso-020/logs/web-netns.evidence.log                  ← 启动/隔离/停栈全证据
.workspace/iso-020/logs/dump-config.out                         ← 组合配置树（1259 行）
.workspace/iso-020/logs/dump-default-web.out                    ← 默认配置树（1259 行）
.workspace/iso-020/logs/dump-config-schema.json                 ← 配置 schema（841 KB）
.workspace/iso-020/logs/dump-config-schema.err                  ← schema 校验告警/错误
```

> 本报告不含会话正文、不含任何密钥、不含原始会话 id。
> 实例打印的 web 访问 token：证据日志中仅以 `sha256` 前 16 位（`7b6a2029a289d300`）留痕；
> 原始 `logs/web-netns.out` 中的 token 明文已在收尾时**就地脱敏**（`token=<REDACTED-sha256-…>`），
> 全部产物均已复扫确认无明文残留。该 token 对应的实例进程已停栈销毁，token 亦已失效。
