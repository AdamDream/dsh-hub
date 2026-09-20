# 3080 上的 dsh web：旧进程 vs 新进程 —— 只读取证报告

- 取证时间：2026-09-17 17:47–17:50 (+08:00)
- 取证者：只读事实侦察档（沙箱 bwrap `--ro-bind / / --unshare-pid`，文件策略 workspace-write）
- 取证对象：监听 `127.0.0.1:3080` 的 dsh web 实例
- 约束遵守：除本报告与同目录一份 bundle 留证副本外未写任何文件；未重启、未杀进程、未改 settings、未使用 sandbox_permissions

---

## 1. 结论

**新进程（已重启并加载本批次冷面代码）——置信度 高（~95%）。**

一句话理由：**该进程在 17:47:04 派发给我的子代理描述符里写着 `agentModel:"deepseek-v4.1-flash"`；而 17:47 时刻 `~/.dsh/settings.yaml` 里根本没有 `dsh-subagent` 段（settings 热载路径不可能生效），该值只能来自启动时装配的 preset（`agent.cordis.yml`，16:49:11 写入）+ 17:00:28 新写入的 `dsh-tool-subagent` 宿主代码；而 16:49:52 的旧子代理在同一 preset 已落盘的情况下仍用 `deepseek-v4-flash`，证明旧进程从未读到过该 preset。二值对比只能由"进程在 17:34:59 之后重启"解释。**

启动时刻可判定的上下界（见 §3.2）：**17:34:59.99 < 进程启动时刻 ≤ 17:47:04**。

---

## 2. 原始命令与原始输出（逐条粘贴，未改写）

### 2.1 3080 是否真的由 dsh web 提供（HTTP 首包特征）

```
$ date -Is
2026-09-17T17:47:11+08:00

$ curl -s -i --max-time 10 http://127.0.0.1:3080/ | head -60
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
Date: Thu, 17 Sep 2026 09:47:11 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

<!doctype html>
<html lang="en">
  <head><base href="/"><script>(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id==="@deepseek-ai/dsh-client-modules")
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: @deepseek-ai/dsh-client-modules/client.js requested external "'+specifier+'" before the module system existed')
    })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: @deepseek-ai/dsh-client-modules/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()</script><script src="/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=7eb526320903"></script><script src="/plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=aba836a0c42d"></script><script>globalThis["__DSH_BOOT__"] = {"rev":"7704aa37bbaf","entries":[ ... ]}</script>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>DeepSeek Harness</title>
    <script type="module" crossorigin src="/assets/index-ClqxG24t.js"></script>
```

同一次响应中 `__DSH_BOOT__` 的 `entries` 末尾（原样摘录）：

```
{"id":"@local/dsh-subagent-model","url":"/plugins/@local/dsh-subagent-model/client.js?rev=d0b7a565217f","rev":"d0b7a565217f","inject":["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-settings"]}
```

> 判读：`<title>DeepSeek Harness</title>` + `/plugins/@deepseek-ai/dsh-client-modules/client.js` bootstrap 门面 + `globalThis["__DSH_BOOT__"]` 是 DSH Web（`dsh web`）独有的首包特征，HTTP 层 `Keep-Alive: timeout=5` / `Transfer-Encoding: chunked` 为 node:http 特征。**3080 = dsh web 无疑**。`@local/dsh-subagent-model` 在会话入口图（loader entries，启动时装配）中存在。

### 2.2 运行态 bundle 与磁盘产物的内容同一性

```
$ curl -s -o /dev/null -w "http=%{http_code} size=%{size_download} type=%{content_type}\n" \
    "http://127.0.0.1:3080/plugins/@local/dsh-subagent-model/client.js?rev=d0b7a565217f"
http=200 size=17099 type=text/javascript; charset=utf-8

$ curl -s "http://127.0.0.1:3080/plugins/@local/dsh-subagent-model/client.js?rev=d0b7a565217f" -o live-subagent-model-client.js
$ sha1sum live-subagent-model-client.js | cut -c1-12
d0b7a565217f
$ sha1sum ~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/client.js | cut -c1-12
d0b7a565217f
$ stat -c '%s %y %n' live-subagent-model-client.js ~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/client.js
17099 2026-09-17 17:49:28.068558621 +0800 live-subagent-model-client.js
17099 2026-09-17 17:04:13.097862191 +0800 /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/client.js
```

运行态 bundle 内容 grep（新设置分区证据）：

```
$ curl -s "http://127.0.0.1:3080/plugins/@local/dsh-subagent-model/client.js?rev=d0b7a565217f" \
  | grep -o -E '子代理模型|subagent-model|dsh-subagent|order: ?70|deepseek-v4.1-flash' | sort | uniq -c
      3 子代理模型
      3 deepseek-v4.1-flash
     18 dsh-subagent
      1 order: 70
      1 subagent-model
```

> 判读：**live bundle 与磁盘产物 sha1 逐位相同**，且运行态 bundle 含 `order: 70` 的「子代理模型」设置分区与 `dsh-subagent` 命名空间字样。
> **反证提示（重要）**：DSH 的 bundle rev 是**按请求实时从磁盘重新 sha1** 得到的
> （`dsh-client-modules/lib/index.js:328` `const rev = shortHash(readFileSync(record.meta.clientPath));`），
> 所以"bundle 存在且是新的"**只证明磁盘有新产物，不能单独证明进程重启**。此条仅作旁证。

### 2.3 冷面文件 mtime 基线

```
$ stat -c '%Y %y %n' <各冷面文件>
1789638402 2026-09-17 17:46:42.834760660 +0800 /home/CNS2026495165/.dsh/settings.yaml
1789635899 2026-09-17 17:04:59.430875667 +0800 /home/CNS2026495165/.dsh/profiles/web/cordis.patch.yml
1789634951 2026-09-17 16:49:11.877568039 +0800 /home/CNS2026495165/.dsh/.agent-presets/standard-glm/agent.cordis.yml

$ stat -c '%y %s %n' ~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/client.js \
    ~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js \
    ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
2026-09-17 17:04:13.0978621910 .../@local/dsh-subagent-model/lib/client.js
2026-09-17 17:34:59.9951942170 .../@local/dsh-subagent-model/lib/index.js
2026-09-17 17:00:28.408965911  .../dsh-tool-subagent/lib/index.js
```

`cordis.patch.yml` 末尾（new 插件 insert 条目）：

```
# dsh-subagent-model（子代理默认模型设置页 + dsh-subagent 设置命名空间，P0'/P0）；
# settings 命名空间 dsh-subagent 由插件自注册（默认 = preset 固定路由 adam/deepseek-v4.1-flash）
- insert:
    - id: dsh-subagent-model
      name: '@local/dsh-subagent-model'
```

> 纠正：任务简报给出的 `dsh-tool-subagent/lib/index.js` / `dsh-goal-round-driver/lib/index.js` 路径不存在（见 §4），实际路径在 `~/dsh/.../dsh/node_modules/@deepseek-ai/` 下。

### 2.4 决定性证据：当前在跑的子代理模型（运行态自证）

```
$ cd ~/.dsh/sessions/--home-CNS2026495165-dsh--/
$ zstd -dc 2851e16e-20ce-4879-b5e8-f86692044ce3/session.jsonl.zstd | head -1
{"type":"session","version":0,"id":"2851e16e-20ce-4879-b5e8-f86692044ce3","createdAt":1789638424537,"cwd":"/home/CNS2026495165/dsh","parentSession":"session-cb106ec3-2628-43f5-8403-13f6c836a8dd","origin":"subagent","delegationDepth":1,"agentPreset":"standard-glm"}

$ zstd -dc 5be87202-f51e-4af9-bd99-47ac8351a7fb/session.jsonl.zstd | head -1
{"type":"session","version":0,"id":"5be87202-f51e-4af9-bd99-47ac8351a7fb","createdAt":1789638424538,"cwd":"/home/CNS2026495165/dsh","parentSession":"session-cb106ec3-2628-43f5-8403-13f6c836a8dd","origin":"subagent","delegationDepth":1,"agentPreset":"standard-glm"}

$ zstd -dc 2851e16e-.../session.jsonl.zstd | head -3 | grep -o '"agentModel":"[^"]*"'
"agentModel":"deepseek-v4.1-flash"
```

即：`createdAt=1789638424537` = **2026-09-17 17:47:04**，`origin=subagent`，`agentPreset=standard-glm`，
**`agentModel=deepseek-v4.1-flash`**。`1789638424537` 与本文档自身（本会话）的创建时刻一致——**本侦察档就是被该进程在 17:47:04 派发出来的子代理之一**，模型自证。

### 2.5 旧进程的同项反例（决定性的二值对比）

```
$ for f in $(ls -t */session.jsonl.zstd | head -40); do
    h=$(zstd -dc "$f" | head -1); case "$h" in *'"origin":"subagent"'*)
      cr=$(echo "$h" | grep -o '"createdAt":[0-9]*' | cut -d: -f2)
      am=$(zstd -dc "$f" | head -5 | grep -o '"agentModel":"[^"]*"' | head -1)
      printf '%s created=%s %s %s\n' "$f" "$cr" "$am" "$(date -d @$((cr/1000)) '+%F %T')";;
    esac; done    # 摘录与本判定相关的行

.../2851e16e-.../session.jsonl.zstd  created=1789638424537  "agentModel":"deepseek-v4.1-flash"  2026-09-17 17:47:04
.../5be87202-.../session.jsonl.zstd  created=1789638424538  "agentModel":"deepseek-v4.1-flash"  2026-09-17 17:47:04
.../b8b24727-.../session.jsonl.zstd  created=1789634992231  "agentModel":"deepseek-v4-flash"    2026-09-17 16:49:52
.../08dd8176-.../session.jsonl.zstd  created=1789634992230  "agentModel":"deepseek-v4-flash"    2026-09-17 16:49:52
```

### 2.6 该模型值的来源只能是 preset（settings 热载路径被排除）

```
$ grep -n "dsh-subagent" ~/.dsh/settings.yaml
ABSENT in settings.yaml

$ diff -u ~/.dsh/backups/settings.yaml.bak-20260917-165928 ~/.dsh/settings.yaml
（无输出 = 与 16:59:28 备份逐字节相同；17:46:42 的 mtime 变化不是内容变化）

$ grep -n "deepseek-v4.1-flash\|deepseek-v4-flash" ~/.dsh/.agent-presets/standard-glm/agent.cordis.yml | head
192:        # 子代理固定走 adam 网关的 deepseek-v4.1-flash，不随主会话模型变化。
195:          model: deepseek-v4.1-flash
203:        # 同上：fork 子代理固定 deepseek-v4.1-flash。
206:          model: deepseek-v4.1-flash
```

### 2.7 新宿主代码是唯一能提供 `dsh-subagent` 热载层的代码

```
$ grep -n "dsh-subagent\|hot-reload" <新 dsh-tool-subagent/lib/index.js (mtime 17:00:28, 37296B)>
108:* hot-reloaded `dsh-subagent` settings namespace over the preset-static
123:		settingsValue = settings === void 0 || typeof settings.get !== "function" ? void 0 : settings.get("dsh-subagent");
527:						// P0' `dsh-subagent` settings default layer: hot, per-dispatch read.

$ grep -c "dsh-subagent" ~/.dsh/backups/dsh-tool-subagent.index.js.bak-20260917-165928   # 改前备份 (mtime 16:59:28, 35309B)
1        # 唯一一处是 import ... from "@deepseek-ai/dsh-subagent"（包名），无设置读取

$ grep -n "settings\.get\|hot-reload" ~/.dsh/backups/dsh-tool-subagent.index.js.bak-20260917-165928
（无输出 = 改前完全没有 settings 读取）
```

---

## 3. 证据链

### 3.1 指向"新进程"的证据

| # | 证据 | 指向 |
|---|---|---|
| E1 | 该进程于 **17:47:04** 写出子代理会话描述符 `agentModel="deepseek-v4.1-flash"`（§2.4），且本档自身即该子代理 | 派生该子代理的路由解析发生在 17:47:04 的**运行态内存**中 |
| E2 | 同一 preset 下，**16:49:52** 的旧子代理仍是 `deepseek-v4-flash`（§2.5），而 preset 写入时刻为 **16:49:11**（早于 16:49:52） | 旧进程**没有**读到 16:49:11 的新 preset → preset 非热载（与 AGENTS.md "preset 文件本身不热" 一致） |
| E3 | 17:47 时刻 `settings.yaml` **无** `dsh-subagent` 段（§2.6） | 17:47:04 的 v4.1-flash **不可能**来自 settings 热载层 |
| E4 | 因此 17:47:04 的 v4.1-flash 只能来自"启动时装配的 preset"（E2+E3 交集） | 该进程的启动时刻 **晚于** preset 写入（16:49:11），更晚于新宿主代码写入（17:00:28） |
| E5 | 新宿主代码（17:00:28）才新增 `settings.get("dsh-subagent")` 热载层；改前备份完全没有 settings 读取（§2.7） | 该进程加载了**本批次新宿主代码** |
| E6 | `__DSH_BOOT__` 入口图含 `@local/dsh-subagent-model`，且 live bundle sha1 = 磁盘 sha1 = boot rev（§2.1/§2.2） | 启动时装配面已含新插件（**旁证**，见反证 R1） |
| E7 | 17:46:42 后 `settings.yaml` 未被再次写入（§2.6 diff 为空），且其 mtime 晚于 17:04/17:34 全部冷面文件 | 进程读取 settings 的时刻 ≥ 17:46:42 |

### 3.2 启动时刻的上下界

- **下界（最强）**：`@local/dsh-subagent-model/lib/index.js` mtime = **17:34:59.9951942170**
  ——该文件是本批次最后落盘的冷面宿主产物；进程若早于此刻启动，则不可能运行现行冷面代码。
- **上界**：本进程于 **17:47:04** 已能派发子代理（E1）。
- 结合 E4/E5：启动时刻 **> 17:00:28**（新宿主代码写入）已被 E5 单独锁定；结合现行插件产物则 **> 17:34:59**。
- **结论：进程启动时刻落在 (17:34:59, 17:47:04] 区间内**，晚于全部冷面文件 mtime → **新进程**。

### 3.3 反证与已排除的替代表释

- **R1（最强反证，已排除其单独定论力）**：bundle rev 是**每请求实时 sha1 磁盘文件**得出的
  （`dsh-client-modules/lib/index.js:328`），因此"bundle 存在且是新的"**只证明磁盘新、不证明进程新**。
  → 本报告不把 E6 当作定论依据，定论由 E1–E5 承担。
- **R2（已排除）**：`cordis.patch.yml` 的 insert 是否可能在运行中被热组合，从而让旧进程的入口图也含新插件？
  → 即便成立，`dsh-subagent-model` 只提供 settings 命名空间与设置页；`E3` 已证明 settings 路径未参与，
  17:47:04 的 v4.1-flash 仍只能来自 preset，preset 非热载（E2），故 R2 不改变结论。
- **R3（已排除）**：`settings.yaml` 17:46:42 的 mtime 变化是否就是本次重启的触发器？
  → 该 diff 为空（§2.6），mtime 变化非内容变化（疑为外部 touch/原子复写），与结论无关但**不构成反驳**。
- **R4（已排除）**：是否可能是"旧进程 + 旧代码，而 v4.1-flash 来自旧 preset"？
  → 旧 preset 值为 `deepseek-v4-flash`（§2.5 的 16:49:52 观测），非 v4.1-flash。
- **未能取得的反证**：无任何观测显示"早于 17:00:28 启动的进程能产出 v4.1-flash 子代理路由"。

---

## 4. 未能定论的部分与缺失的观测手段

1. **精确启动墙钟时刻（秒级）无法在本沙箱取得**。
   沙箱为 `bwrap --ro-bind / / --unshare-pid`，PID 命名空间隔离，`ps/pgrep` 仅见自身与 bwrap：
   ```
   $ ls -d /proc/[0-9]* | wc -l
   4
   $ ps -ef | head -20
   UID          PID    PPID  C STIME TTY          TIME CMD
   CNS2026+       1       0  0 17:47 ?        00:00:00 bwrap --ro-bind / / ...
   CNS2026+       2       1  0 17:47 ?        00:00:00 bash -c echo "=== /proc of web pid? ===" ...
   CNS2026+      20       2  0 17:47 ?        00:00:00 bash -c ...
   CNS2026+      21      20  0 17:47 ?        00:00:00 ps -ef
   ```
   `/proc/net/tcp` 可见监听套接字（`0100007F:0C08 ... inode 10452371`），但其 inode 落在自身 PID 命名空间之外，
   无法据此反查 pid，也无法读取 `/proc/<pid>` 的目录时间戳来取启动时刻。
2. **宿主未留下 pid 文件 / 启动日志 / 启动时间戳**。
   `~/.dsh/` 下无 `logs/ state/ run/ *.pid`；`~/.dsh/backups/dsh-restart.log` 全为 dry-run 预览（mtime 09-16 13:02），
   `dsh-restart-watch.log` 末行为"只杀 watcher，不动 dsh web 进程"；`/tmp` 在本沙箱为 tmpfs（空），
   `~/.bash_history`（mtime 09-15）无本次启动记录。
3. **补哪个观测即可秒级定论（任选其一）**：
   - 宿主上执行 `ps -o lstart=,etimes=,cmd= -p $(ss -ltnpH 'sport = :3080' | grep -o 'pid=[0-9]*' | cut -d= -f2)`（或 `ls -ld --time-style=full-iso /proc/<pid>`）直接读进程启动时刻；
   - 或在宿主 `~/.dsh/` 下放置启动打点（如重启脚本落 `startedAt` 到 `~/.dsh/backups/dsh-restart.log`）；
   - 或给 DSH 加一个只读 HTTP 端点暴露 host `process.uptime()` / 构建 rev（当前 `/api/*` 仅 RPC 通道，未暴露启动时刻）。

> 注：本次定论**不依赖**上述缺失观测——E1–E5 已构成充分链：模型值 17:47:04 变了（E1/E2），
> 而 settings 路径被排除（E3），故只能是 preset 冷读，即进程在 17:34:59 之后重启。

---

## 5. 附：本报告引用的留证文件

| 文件 | 说明 |
|---|---|
| `live-subagent-model-client.js`（本目录） | 从 3080 原样抓取的 `@local/dsh-subagent-model` 客户端 bundle，sha1 前 12 位 `d0b7a565217f`，17099 字节，与磁盘产物逐字节一致 |

只读取证过程未修改任何其它文件（除本目录新建的两个留证文件外，工作区无改动：
`git status --short` 仅显示先前既有的 `?? .workspace/mmt-probe/pasted-2048.png`、`?? .workspace/push-log3.txt`）。
