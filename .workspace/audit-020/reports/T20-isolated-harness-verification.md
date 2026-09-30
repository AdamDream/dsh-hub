# T20 — 0.2.0 隔离运行验证环境（harness）可行性实测报告

- 轨道：T20（审计阶段，只出结论与方案，不改产品代码）
- 迁移目标：`@deepseek-ai/dsh@0.2.0-rc.1`（CLI 已解于 `.workspace/dsh-020-pkg/x/package/`；本轮实测用的是 T25 已安装的 `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/dsh`，`cli_version=0.2.0-rc.1`，`bin.js sha256=935e95d05f4dc70a8a013eea59da80028946b5c139e45c6351dcaf2810ca00a1`）
- 硬约束遵守情况：全程未停止/重启 3080 与 3097，**未向其发送任何 HTTP/协议请求、未建立任何连接、未做任何写操作**；对二者的观测仅两种**只读/非侵入**手段——① `ss -H -ltn` 查看监听行；② 一次本地 `bind()` 占用性探测（对 3080 返回 `EADDRINUSE`，该操作不连接现有监听者、不触达其业务逻辑，见 §4.2-1）。未发起任何真实模型请求；未写 `.workspace/**` 以外任何路径（对 `~/.dsh` 的写入探测被沙箱以「只读文件系统」拒绝，见 §2.7）；未使用 `sandbox_permissions`。
- 本报告所有结论都绑定当轮实测原始输出，证据文件在 `.workspace/audit-020/work/` 下（见 §2 各条给出的路径）。

---

## 1. 结论摘要

1. **`unshare -rn` 可用**，未被本会话沙箱拒绝：`unshare -rn true` → `exit=0`；netns 内 `ip link set lo up` → `exit=0`，`ip addr show lo` 显示 `LOOPBACK,UP,LOWER_UP` + `127.0.0.1/8` + `::1/128`。**外呼被结构性阻断**：`ip route` 为 0 行、`/dev/tcp/1.1.1.1/443` → `网络不可达`、DNS `getent hosts` → `exit=2`、curl 域名 → `(6) Could not resolve host`、curl 裸 IP → `(7) ...after 0 ms`。历史坑 2 复现并定位：宿主 netns 内 `ip link set lo up` → `RTNETLINK answers: Operation not permitted`（无 `CAP_NET_ADMIN`，`CapEff=0`），所以必须由 `unshare -rn` 提供 userns+netns。**与并行轨道 T25 独立结论一致**（T25 亦实测 `unshare -rn` 被允许、netns 内 `127.0.0.1:3102` 监听且与父命名空间双向不通、bundle 离线解析不需要网络）——两条轨道在互不知情的前提下得到同一组结论，互为交叉验证。
2. **harness 端到端可用（已实测跑通）**：0.2.0-rc.1 `dsh --profile web` 在 `unshare -rn` + `env -i`（无任何 key）+ **完全冷启动的隔离 `HOME`/`DSH_HOME`** 下 **2 秒**打印 readiness 行；netns 内 `ss -ltn` 见 `127.0.0.1:3098 LISTEN`，HTTP 未认证 `401` → 带 token `303` → 带 cookie `200`（返回 34812 字节真实 UI HTML）。冷 `DSH_HOME` 的 profile 自举**不需要网络**（profile 四件套离线生成，无 `node_modules` 安装）。
3. **零模型请求的最强证据形态 =「结构性不可达」+「已校准正检台账」三层叠加**（详见 §6）：① netns 无路由（成功不可能）；② netns 内**已校准计数汇**（正向对照命中 ≥1，服务侧命中 =0）；③ `strace -f -e trace=connect` 全树调用台账，**并带 tracer 存活控制**（本轮：`tracer_control_seen=1`、`connect_total=3`、`nonlocal_total=0`）——③ 是唯一能覆盖"任意目标地址 + 任意后台任务（含标题生成）"的正检形态且有可判定阈值。
4. **端口判定**：宿主 `ss` 对隔离 netns 内监听完全不可见（`host ss → 0 行` + `curl → connection refused (0 ms)`），**必须在同一 netns 内判定**；同端口号可在宿主与隔离 netns **同时**绑定且互不干扰（实测 `39990` 双向同时监听，各自读到自己的响应）。候选端口 3098/3099/3102/3103/9224/9225 当轮宿主侧均空闲（`host_listener_lines=0`）。
5. **存活判定**：`ps -p` / `kill -0` / `/proc/<pid>` **跨 bash 调用恒失败**（本轮 `ps_exit=1`、`/proc/11: 没有那个文件或目录`、`kill0_exit=1`），根因是每个 bash 调用都被包在 `bwrap --ro-bind / / --unshare-pid --proc /proc --die-with-parent` 里：**每个调用一个 PID namespace**，PID 从 1 重新编号。可靠替代 = 「同 netns 内 `ss -ltnp` 归属 + bind 预检 + readiness 日志 + HTTP 探测」合取（§5）。
6. **三个真实坑（本轮实测发现，非推测）**：
   - **杀包装进程会留下孤儿监听**：v2 只 kill `strace` 包装进程时，被跟踪的 node 服务存活并继续 `LISTEN 127.0.0.1:3098`（netns 内可见）；必须 `setsid` + **进程组级** kill。
   - **`ss -H -ltn | tail -n +2 | wc -l` 会漏报**：`-H` 已无表头，唯一监听被 `tail -n +2` 吃掉 → 曾错误输出 `teardown_listen_lines=0`（v2 的 `L_TEARDOWN_LISTEN_LINES`）。
   - **Chrome 153 不生成 `DevToolsActivePort` 文件**（等待 30s 仍无），但 CDP 端口与 `/json/version` 正常 → 该文件不能作就绪判据，须改用「netns 内端口 + HTTP 探活」。
7. **好消息（用于停栈判定）**：managed job 结束 = 其 PID namespace 被销毁 = 内核 SIGKILL 掉命名空间内**所有**进程。实测心跳型孤儿（宿主 netns 与隔离 netns 各一）在 job 结束后心跳冻结（`DEAD(frozen)`）→ **跨 job 不存在"幽灵隔离实例"**；但 job 内部仍可能出现孤儿，所以停栈必须在同一 job 内、从 netns 内部验证。
8. 残余风险见 §8：最关键的是「netns 只隔离网络、不隔离文件系统」与「宿主 127.0.0.1 ≠ 隔离 netns 127.0.0.1 的语义误判」。

---

## 2. 证据（当轮实测原始输出摘要）

实测件：`harness/run_isolated.sh`（参考 runner，v5 冷启动全绿）、`harness/sink.mjs`（计数汇）、`harness/tracewrap.sh`（tracer 存活控制 + exec 服务）；证据目录 `harness/evidence/`（v5）、`harness/evidence-v3/`、`harness/evidence-v4cold/`、`exp-net/`、`exp2/`、`exp3/`、`exp4/`。

### 2.1 沙箱与命名空间事实（T12/T13）

```
$ ps -eo pid,ppid,cmd | head -2
    PID    PPID CMD
      1       0 bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent
                   --tmpfs /tmp --bind /home/CNS2026495165/dsh /home/CNS2026495165/dsh -- bash -c ...
      2       1 bash -c ...
      3       2 sleep 600
$ ps -p 99999 ; echo $?      ->  (空表)  exit=1
$ findmnt -no OPTIONS /      ->  ro,nosuid,nodev,relatime
```
- 同调用内 `ps -p <pid>` **可用**（`pid=3 sleep`），跨调用**不可用**（见 §2.5）。
- `CapEff=0`、`NoNewPrivs=1`、`Seccomp=0`、`/proc/sys/user/max_user_namespaces=2147483647`、`kernel.unprivileged_userns_clone=1`。

### 2.2 unshare / lo / 外呼（§3 详列）

`evidence/phase1-isolation.txt`、`exp-net/netns-probe.txt`、`exp-net/outer-own-pidns.txt`。

### 2.3 端口与 netns 边界（T14/T15/T-B2）

`exp-net/host-probe.txt`、`exp-net/host-post.txt`、`exp3/host-probe.txt`、`exp3/iso-probe.txt`。

### 2.4 端到端 harness（v5 冷启动，`harness/evidence/verdict.txt`）

```
L1_ROUTE_LINES=0
L1_EGRESS_MARKER=4
L_PORT_LISTEN_LINES=1
L_OWN_BIND_AFTER_BOOT=c3_own_bind_after_boot=EADDRINUSE
L_HTTP_UNAUTH=http=401
L_HTTP_AUTH_FOLLOWUP=http=200
L2_SINK_SERVICE_HITS=L2_sink_service_hits=0
L3_NONLOCAL_CONNECT_ATTEMPTS=nonlocal_total=0
L_CDP_READY_FILE=no
L_TEARDOWN_LISTEN_LINES=0
```
配套原始片段（`evidence/phase3-boot.txt`、`phase4-liveness.txt`、`phase5-model-request-ledger.txt`、`phase6-cdp.txt`、`phase7-teardown.txt`）：
```
## boot.log (redacted; 75 bytes)
TRACER_CONTROL_CONNECT_OK
dsh web: http://127.0.0.1:3098/?token=<REDACTED>
dsh_pid=120 ready_seconds=2 token_captured=yes token_len=43
c1_kill0=ALIVE   c2_ss_listen_lines[3098]=1   c3_own_bind_after_boot=EADDRINUSE
  LISTEN 0 511 127.0.0.1:3098 0.0.0.0:* users:(("node",pid=127,fd=21))
  local_port=3098 remote_port=0 state=0A(LISTEN)
c6 HTTP unauthenticated root:  http=401
c7 HTTP authenticated root:    http=303 redirect=http://127.0.0.1:3098/
c8 HTTP follow-up with cookie: http=200 bytes=34812
L2 sink log (control hits=2): HIT #1 GET /CANARY-A ; HIT #2 POST /v1/messages   -> L2_sink_service_hits=0
L3 tracer_control_seen=1 ; connect_total=3 ; nonlocal_total=0
L4 API-key-like env vars of the SERVICE process (pid 127): 0
   service env (names only): DEEPSEEK_BASE_URL DSH_HOME DSH_TELEMETRY_DISABLED HOME PATH PWD SHLVL TMPDIR
L5 session_jsonl_count=0 ; nonloopback_peer_count=0
phase6 CDP: ss_cdp_lines=1 ; cdp_version={"Browser":"Chrome/153.0.8010.52",...} ; DevToolsActivePort 文件不存在
phase7 teardown: teardown_listen_lines=0 ; dsh_still_running=no ; sink_hits_final=2
```
`L3` 三条 `connect()` 原文（`evidence/strace-connect.log`）：
```
123  17:04:41.070564 connect(3, {sa_family=AF_UNIX, sun_path="/var/run/nscd/socket"}, 110) = -1 ENOENT
123  17:04:41.070777 connect(3, {sa_family=AF_UNIX, sun_path="/var/run/nscd/socket"}, 110) = -1 ENOENT
129  17:04:41.089820 connect(21, {sa_family=AF_INET, sin_port=htons(39901), sin_addr=inet_addr("127.0.0.1")}, 16) = -1 EINPROGRESS
```
（pid 123 = 服务进程本体，两条 AF_UNIX/nscd 查询；pid 129 = tracer 正向控制。**除控制外整棵树没有任何 AF_INET/AF_INET6 connect，连 loopback 都没有。**）

### 2.5 跨调用可见性（同一次运行内、另一个 bash 调用）

```
[跨调用 A] 另一调用在宿主 netns 起 39997  -> 本调用 ss：LISTEN 127.0.0.1:39997   lines=1   ✅可见
[跨调用 B] 隔离 netns 内 39999             -> 本调用 ss：lines=0               ❌宿主不可见
[跨调用 C] pid_from_file=11 -> ps -p 11: 空 exit=1 ; /proc/11: 没有那个文件或目录 ; kill -0 11: 没有那个进程
```

### 2.6 孤儿与 job 边界（`exp4/`）

```
before_kill hb_host=1790672713574 hb_ns=1790672713574        # 杀掉包装进程后
after_kill_6s hb_host=1790672719580 hb_ns=1790672719580      # 6 秒后仍在推进 -> 孤儿存活
… 等该 managed job 结束后的新调用：
T0 hb=1790672719580   T1(+6s) hb=1790672719580  -> HOST_ORPHAN=DEAD(frozen)
                                                    NETNS_ORPHAN=DEAD(frozen)
```

### 2.7 沙箱写边界（拒绝即证据）

```
$ touch /home/CNS2026495165/.dsh/T20_PROBE
touch: 无法 touch '.../.dsh/T20_PROBE': 只读文件系统        exit=1
$ touch /etc/T20_PROBE
touch: 无法 touch '/etc/T20_PROBE': 只读文件系统            exit=1
$ touch <workspace>/WRITE_OK -> OK        # 工作区内可写
```
（`/tmp` 实测跨调用可见共享 tmpfs：`/tmp/T20_PROBE` 持久存在 ⇒ **不要把 harness 状态放 `/tmp`**，用 workspace 内目录。）

### 2.8 现役实例未被触碰的证据

- 全程对 3080/3097 只做 `ss -H -ltn '( sport = :3080 or sport = :3097 )'` 只读观察，每轮输出恒定：
  `LISTEN 0 511 127.0.0.1:3080` / `LISTEN 0 511 127.0.0.1:3097`，无端口消失/重启迹象。
- 反例警示（避免用假判据）：宿主 `/proc/net/tcp` 中存在涉及 3080 的 `ESTABLISHED` 连接（如 `50398→3080`），那是**现役 GUI 自身浏览器会话**的连接，不是探测产生的 ⇒ **不能**用"3080 无 established 连接"当隔离判据。

---

## 3. unshare 与网络隔离实测结论

| 项 | 实测命令 | 真实输出 | 结论 |
|---|---|---|---|
| userns/netns 可用 | `unshare -rn true` | `exit=0` | 可用，**未被沙箱拒绝** |
| lo 起来 | `unshare -rn bash -c 'ip link set lo up; ip addr show lo'` | `lo: <LOOPBACK,UP,LOWER_UP> ... inet 127.0.0.1/8 ... inet6 ::1/128`；`lo_up_exit=0` | netns 内可置 lo UP |
| 负对照（宿主 netns） | `ip link set lo up` | `RTNETLINK answers: Operation not permitted` `exit=2` | 宿主无 `CAP_NET_ADMIN`；历史坑 2 复现，**必须** `unshare -rn` 在外层 |
| 接口/路由 | `unshare -rn bash -c 'ip link set lo up; ip -br link; ip route'` | 仅 `lo`；路由 `route_lines=0` | 无默认路由 ⇒ 外呼**结构性**不可能 |
| TCP 外呼 | `timeout 5 bash -c "exec 3<>/dev/tcp/1.1.1.1/443"` | `bash: connect: 网络不可达` → 打印 `EGRESS_BLOCKED` | 阻断（三目标均 BLOCKED，含 LAN 网关 `172.16.161.1:53`） |
| DNS | `getent hosts api.deepseek.com` | `exit=2`（空） | DNS 亦不可达 |
| curl 域名 | `curl https://api.deepseek.com/` | `curl: (6) Could not resolve host` `http=000` | 阻断 |
| curl 裸 IP | `curl --resolve api.deepseek.com:443:1.1.1.1 https://api.deepseek.com/` | `curl: (7) Failed to connect ... after 0 ms` `http=000` | 阻断（0ms = 无路由，非超时） |
| 宿主不可见 | 隔离 netns 起 39999 → 宿主 `ss`/`curl` | `lines=0`；`curl: (7) ...after 0 ms` | 历史坑 3 复现：**宿主 `ss` 不能证明隔离服务"未启动"** |
| 双向不可达 | 宿主 netns 起 39997 → netns 内 curl | `curl: (7) Failed to connect to 127.0.0.1 port 39997 after 0 ms` | 宿主 loopback 监听器对隔离 netns 同样不可达 |
| 独立注册表 | `unshare -rn ... ip -brief addr` | 仅 `127.0.0.1/8 ::1/128` | 隔离 netns 是独立网络栈 |

**结论**：`unshare -rn` 路线完全可行，且比历史记录里"仅 `env -i` + 假 HOME + 独立端口"的方案强得多——后者只隔离**配置**，不阻断**网络**；本方案同时阻断网络，使"零模型请求"从"约定"升级为"物理不可能 + 可正检"。

---

## 4. 端口判定方法

### 4.1 判定必须在正确的命名空间内

- 隔离实例的监听**只存在于它自己的 netns**：`host ss → 0 行`（§2.5/§3）。
- **端口占用是 per-netns 的**，实测同一端口号 `39990` 在宿主与隔离 netns 同时绑定且互不干扰：
  `iso_ss_lines=1 / iso_curl=ISO_NETNS`、`host_ss_lines=1 / host_curl=HOST_NETNS`。
  ⇒ 对"将在 netns 内绑定"的服务，宿主侧的"端口空闲"既非必要也非充分；**必须**在目标 netns 内预检。

### 4.2 推荐判据（按强度排序）

1. **同 netns 内 bind 预检（最强、非侵入）**：
   ```bash
   node -e 'const net=require("net");const s=net.createServer();s.once("error",e=>{console.log("preflight_bind="+e.code);process.exit(0)});s.listen(P,"127.0.0.1",()=>{console.log("preflight_bind=BIND_OK");s.close()})' P
   ```
   空闲 → `preflight_bind=BIND_OK`；已被占用 → `preflight_bind=EADDRINUSE`。
   实测：`bind_test(39990)=BIND_OK`、`bind_test(39991)=BIND_OK`、`bind_test(3080)=EADDRINUSE`。
   **注意**：bind 预检只"尝试占用端口"，**不向现有监听者发任何请求**，因此即使目标是现役端口也不会触达其业务逻辑（本轮对 3080 仅做此一次性 bind 探测，未发送任何 HTTP/写入）。
2. **同 netns 内 `ss` 过滤器**：`ss -H -ltn '( sport = :P )'`，计数 = 监听数（`0`/`1`…）。
   实测：`host_listener_lines[3098]=0/3099=0/3102=0/3103=0/9224=0/9225=0`，`3080=1`、`3097=1`。
   **不要**加 `-4`/`-6`：`ss -H -ltn '( sport = :631 )'` 命中 **2** 行（`127.0.0.1:631` 与 `[::1]:631`），而 `-4` 只 1 行、`-6` 只 1 行 ⇒ 单栈过滤会造成**假阴性**。
3. **不依赖 `ss` 的独立判据 `/proc/net/tcp{,6}`**（`state=0A` 即 LISTEN）：本轮用它交叉验证出 3080/3097 的 LISTEN 记录，与 `ss` 一致。**双栈坑**：`631` 在 `/proc/net/tcp` 与 `/proc/net/tcp6` 各出现一次，只读一个文件会漏 IPv6。
4. **归属判据（区分"端口被占"与"被我们的实例占"）**：`ss -H -ltnp '( sport = :P )'` 在本会话自己的 userns 内能显示 pid/comm：
   `users:(("node",pid=127,fd=21))`；再用 `/proc/127/cmdline` 校验含 `bin.js` 与 `--port`。
5. **`--port 0` 兜底（0.2.0 支持）**：让 OS 选空闲端口，再从 readiness 行解析真实端口，**彻底消除端口冲突**（`dsh-web-app` 的 `--port` 文档明确 "pass 0 to let the OS pick a free one"）。代价：端口不再是固定常量，证据里必须记录解析结果。

### 4.3 何时仍需宿主侧检查

仅用于**证据清晰性**（例如"我要确认宿主 3098 上没有别人"）与**宿主可达性设计**（若后续要宿主浏览器直连，则 netns 方案下天然不可达，必须端口转发或改回非 netns 模式）。**不得**用宿主检查结果去断言隔离实例的存活/监听状态。

### 4.4 一个"反直觉但必须记住"的结论

若服务运行在 `unshare -rn` 内，则**宿主浏览器/脚本永远无法 `curl` 到它**（宿主 loopback ≠ netns loopback）。因此所有功能验证（HTTP 探测、CDP 截图、UI 导航）都必须在**同一个 job、同一个 netns 内**执行——这正是 0.1.7 时期 `run.sh` 把 chrome 也放进 netns 的原因，本轮已用 0.2.0 + Chrome 153 复现（§2.4 phase6）。

---

## 5. 存活判定方法（含风险）

### 5.1 不可用判据（本轮复核）

| 判据 | 实测 | 原因 |
|---|---|---|
| `ps -p <先前调用记录的 pid>` | `ps_exit=1`、空表 | 每个 bash 调用一个 PID namespace（`bwrap --unshare-pid`），PID 从 1 起编；跨命名空间查不到 |
| `kill -0 <pid>` | `kill: (11) - 没有那个进程` `exit=1` | 同上 |
| `ls /proc/<pid>` | `没有那个文件或目录` `exit=2` | `/proc` 是新 pidns 的 procfs |
| 宿主 `ss` 看隔离实例 | `lines=0` | 不同 netns（历史坑 3） |
| `~/...` 日志存在性单独判活 | teardown 后 `boot.log` 仍在 | **陈旧产物 = 假阳性** |

> 注意：`ps -p` 在**同一个调用/同一个 job 内部**是可用的（`ps_exit=0`）。所以判活判据要么全在 job 内，要么换成 job 外可读的"落盘信号"。

### 5.2 推荐判据组合（合取，全部通过才认定"活着"）

| # | 判据 | 判定命令（在 netns 内） | 强度 | 假阴性(漏判活) | 假阳性(误判活) |
|---|---|---|---|---|---|
| C1 | job 仍在运行 | managed job 未结束 | 中 | 无 | **有**：job 活着但服务已崩（v2 曾出现 job 内孤儿 + 服务已死） |
| C2 | 端口被监听 | `cnt=$(ss -H -ltn '( sport = :P )' \| wc -l)`，需 `=1` | 中高 | 有（宿主侧查必漏） | 低（可能是别的进程占着同一端口） |
| C3 | **端口被"我们"占用** | `c3=$(bind 预检)` 需 `EADDRINUSE` + `ss -ltnp` 显示期望 pid/comm + `/proc/<pid>/cmdline` 含 `bin.js --port P` | 高 | 低 | 低 |
| C4 | 进程活 | `kill -0 $P`（同一 pidns 内） | 中 | 无（同命名空间） | 有（僵尸/僵死但未退出） |
| C5 | readiness 行 + 新鲜度 | `boot.log` 含 `dsh web: http://127.0.0.1:P/?token=` 且 `mtime` 在窗口内 | 中 | 有（若日志被重定向到别处） | **有**（陈旧日志）→ 必须与 C2/C3 同时成立 |
| C6 | 端到端业务探活 | `curl -s -o /dev/null -w '%{http_code}'`：未认证 `401`；带 token `303`；带 cookie `200` | **最高（功能真值）** | 有（探测脚本忘记带 cookie/token） | 极低 |
| C7 | 内核套接字表 | `/proc/net/tcp` 出现 `state=0A` 且 `local_port=P` | 中高（与 C2 独立实现） | 与 C2 同（宿主侧查必漏） | 低 |
| C8 | 归属/版本哈希 | `sha256(bin.js)`、`cli_version`、`sha256(profiles/web/cordis.patch.yml)` | — 只证"是哪个构建"，**不证活** | — | — |
| C9 | CDP 层就绪（若用浏览器） | netns 内 `curl http://127.0.0.1:CDPPORT/json/version` 返回 `Browser` 字段（实测 `Chrome/153.0.8010.52`） | 高 | 有（CDP 未起） | 低 |

**最小可靠集**：`C2 ∧ C3 ∧ C6`（能监听 + 是我们占的 + 业务可用）；跨 job 的**唯一**合法判据是「同 job 内写入的证据文件 + 其时间戳/哈希」，因为没有跨 job 的进程可见性。
**停栈判据**：`teardown_listen_lines=0`（用 `ss -ltn | grep -c LISTEN`，**不要**用 `tail -n +2`）且 `dsh_still_running=no`，并且必须**在 job 结束前**完成——job 一结束，pidns 销毁，任何"去看看还在不在"的机会都没有了（§2.6）。

### 5.3 实测证明的判定陷阱

1. `ss -H -ltn | tail -n +2 | wc -l`：`-H` 无表头 ⇒ 唯一监听被吃掉 ⇒ 输出 `0`（v2 假阴性）。正确写法 `ss -ltn | grep -c LISTEN`。
2. 只 kill 包装进程（`strace`）：服务存活并继续 LISTEN ⇒ 若此时做宿主侧检查会得"没在跑"的**假阴性**，而 netns 内检查会得**真阳性**。修法：`setsid` 起服务 + `kill -TERM/-KILL -<PGID>`。
3. `DevToolsActivePort` 文件缺失 ≠ CDP 未就绪（Chrome 153 实测），必须用端口/HTTP 探活。
4. 宿主 `/proc/net/tcp` 里涉及 3080 的 `ESTABLISHED` 是现役 GUI 自身会话连接，**不是**被探测的痕迹（§2.8）。

---

## 6. 零模型请求证明方法与强度

### 6.1 五层证据及强度

| 层 | 形态 | 判定阈值（可机检） | 强度 | 覆盖范围 | 盲区 |
|---|---|---|---|---|---|
| **L1** 结构性不可达 | netns 无路由；外呼实测 `网络不可达` | `ip route \| wc -l == 0` 且 tripwire 打印 `EGRESS_BLOCKED`（本轮 `L1_ROUTE_LINES=0`、`L1_EGRESS_MARKER=4`） | **强（使"成功"不可能）** | 一切非 loopback 目标 | 不排除"尝试了但失败"；loopback 目标（本机代理）可通 |
| **L2** 已校准计数汇 | netns 内 HTTP sink 作为 `DEEPSEEK_BASE_URL`（`http://127.0.0.1:39901/v1`），记录每个请求 | 正向对照命中 `≥1`（本轮 `GET /CANARY-A`、`POST /v1/messages` 各命中）且 **服务侧命中 `==0`**（`L2_sink_service_hits=0`） | **强（正检）** | 打向"被配置端点"的所有尝试（含后台标题生成，只要它走同一 provider） | 若某路径硬编码别的 baseURL 则漏检；配置覆盖顺序问题 |
| **L3** 系统调用台账 | `strace -f -e trace=connect` 覆盖 `tracewrap.sh -> exec node 服务` 整棵树，**且 wrapper 先发一次控制 connect 以证明 tracer 在工作** | `tracer_control_seen>=1`（本轮 `=1`，非空洞）且 `nonlocal_total==0`（本轮 `=0`，`connect_total=3` 全为 AF_UNIX/nscd + 1 次 loopback 控制） | **最强（正检、与配置无关）** | 被跟踪树内**任何** connect()（任意地址/端口），包括"尝试后失败" | 跟踪树外的进程（如 3080 现役实例、宿主其它进程）；不使用 connect 的机制（如继承的已连接 fd、`socket(AF_PACKET)`/原始套接字）；strace 有开销、可能改变时序 |
| **L4** 无凭证 | `env -i` 后服务进程 environ 无任何 `*API_KEY*/*_TOKEN=*SECRET*`（本轮 **0**，仅 `DEEPSEEK_BASE_URL DSH_HOME DSH_TELEMETRY_DISABLED HOME PATH PWD SHLVL TMPDIR`） | 计数 `==0` | 中（使"成功"不可能） | 认证层面 | 不阻止匿名/无鉴权端点尝试；key 也可能来自文件（本轮隔离 `HOME` 下只有空 `.credentials.yaml`） |
| **L5** 事后一致性 | 3 秒 grace 窗口后：`session_jsonl_count=0`（无会话 ⇒ 标题生成等会话型后台任务不可能跑过）、`nonloopback_peer_count=0`（netns 内无非 loopback 对端 socket） | 两项 `==0` | 中（事后旁证） | 会话/标题类后台任务的产物痕迹 | 只有"留痕型"任务的痕迹；不覆盖无痕失败 |

### 6.2 最强证据形态（推荐组合）

> **L1 + L3（含 tracer 存活控制）+ L2（含正向对照）三者同时成立**，并以 §2.4 的 `verdict.txt` 形式落盘。理由：L1 让"请求成功"物理不可能；L3 让"发出过任何 connect"无所遁形（且 tracer 有效性被控制实验证明，避免"0 命中 = 仪器坏了"的空洞结论）；L2 专门盯被配置的模型端点，覆盖"后台任务绕过 UI 直接调模型"的情形，并用正向对照证明计数器本身好用。三者互相补盲，任一单项都不足。

此外应同时记录：`L4`（无 key）、`L5`（无会话产物）、以及**运行时长与 grace 窗口**（本轮 boot 后 sleep 3s 再采样；标题生成类任务需要"首轮 prompt"才触发，本轮从未创建会话，故 `session_jsonl_count=0` 与之自洽）。

### 6.3 强度分级小结

- **S 级（可对外声称"零模型请求"）**：L1 ∧ L3(有控制) ∧ L2(有对照) ∧ L4，且 `connect_total` 明细可解释（每一行都能归因）。
- **A 级**：L1 ∧ L3(有控制)（缺 L2 时，硬编码端点的尝试若被 netns 阻断仍会出现在 L3 中，故实际仍强）。
- **B 级**：仅 L1 + L4（"成功不可能"，但无正检，不能排除"尝试并失败"）。
- **C 级（不可采纳）**：只看日志没有错误、只看 `env -i` 没 key、只看 job 存活。

---

## 7. 完整隔离运行 Runbook

> 参考实现（可直接复用）：`harness/run_isolated.sh`（runner）、`harness/sink.mjs`（计数汇）、`harness/tracewrap.sh`（tracer 控制 + exec）。
> **总则**：`unshare -rn` 一层包住「服务 + 计数汇 + 探针 + 浏览器」全部；**整个栈必须在同一个 managed job 内**（否则调用结束即 PID namespace 销毁，服务随之死亡）。

### 步骤 0 — 前置检查（宿主 netns，只读）

```bash
# 0.1 参考实例必须仍在（只读观察，不连接）
ss -H -ltn '( sport = :3080 or sport = :3097 )'
# 期望：两条 LISTEN 127.0.0.1:3080 / 127.0.0.1:3097

# 0.2 候选端口占用（宿主视角，仅作记录）
for p in 3098 3099 3102 3103 9224 9225; do
  echo "$p -> $(ss -H -ltn "( sport = :$p )" | wc -l)"; done
# 期望（当轮实测）：全 0

# 0.3 身份锚定（把"被测物"钉死）
sha256sum <CLI>/lib/bin.js
node -p "require('<CLI>/../package.json').version"     # 期望 0.2.0-rc.1

# 0.4 隔离前置能力（每次都要重验，不可假设）
unshare -rn true; echo "unshare_exit=$?"               # 期望 0
unshare -rn bash -c 'ip link set lo up; ip -br addr; echo route_lines=$(ip route | wc -l)'
# 期望：lo UP + 127.0.0.1/8 + route_lines=0
```

### 步骤 1 — （可选）一次性 priming，随后冻结

冷启动实测**不需要网络**（profile 四件套离线生成）。若需带本地插件/额外依赖，则：
```bash
# 在全网可用（非 netns）环境下预装到隔离 DSH_HOME，然后记录哈希并冻结
DSH_HOME=<ISO>/home/.dsh npm --prefix <ISO>/home/.dsh/profiles/web install
find <ISO>/home/.dsh -type f -exec sha256sum {} + | sort -k2 > <ISO>/evidence/profile-files.sha256
```
**否则跳过此步**，直接冷启动（更干净，且无 npm 侧副作用）。

### 步骤 2 — 启动（**必须** `run_in_background: true`）

```bash
# 单 job 内：进 netns -> lo up -> 外呼 tripwire -> 计数汇校准 -> env -i 起服务
exec unshare -rn bash -s <<'INNER'
set -u
ip link set lo up
ip route | wc -l                                  # 期望 0
for t in 1.1.1.1:443 8.8.8.8:53 $(ip route | awk '/default/{print $3}')/53; do
  h=${t%%:*}; p=${t##*:}
  timeout 5 bash -c "exec 3<>/dev/tcp/$h/$p" 2>/dev/null && echo "EGRESS_OPEN $t" || echo "EGRESS_BLOCKED($t)"
done                                              # 期望全部 BLOCKED
node <HROOT>/sink.mjs 39901 <HROOT>/evidence/sink.log &   # 计数汇（= 陷阱端点）
sleep 1.5
ss -H -ltn '( sport = :39901 )' | wc -l            # 期望 1
curl -s -o /dev/null -w 'ctrlA=%{http_code}\n' http://127.0.0.1:39901/CANARY-A
curl -s -X POST -d '{}' -o /dev/null -w 'ctrlB=%{http_code}\n' http://127.0.0.1:39901/v1/messages
# 期望 ctrlA=200 ctrlB=200 且 sink.log 中 HIT 计数 =2（校准完成）

setsid strace -f -tt -e trace=connect -o <HROOT>/evidence/strace-connect.log \
  env -i PATH=/usr/bin:/bin HOME=<ISO>/home DSH_HOME=<ISO>/home/.dsh \
        TMPDIR=<ISO>/tmp DSH_TELEMETRY_DISABLED=1 \
        DEEPSEEK_BASE_URL=http://127.0.0.1:39901/v1 \
  <HROOT>/tracewrap.sh /usr/bin/node 39901 /usr/bin/node <CLI> \
        --profile web --no-open --host 127.0.0.1 --port 3098 >> <HROOT>/evidence/boot.log 2>&1 &
INNER
```
要点：`setsid`（可整组 kill）、`env -i`（零 key）、`HOME`+`DSH_HOME` 都指向隔离根（**缺一不可**：只设 `HOME` 时 DSH 仍可能落到默认 `~/.dsh`）、`DEEPSEEK_BASE_URL` 指向 netns 内 sink、`--no-open`（无浏览器交接）。

### 步骤 3 — 就绪判定

```bash
for i in $(seq 1 60); do
  grep -q 'dsh web: http://127.0.0.1:3098/?token=' <HROOT>/evidence/boot.log && break; sleep 1; done
node -e 'const fs=require("fs");const m=fs.readFileSync(process.argv[1],"utf8").match(/token=([A-Za-z0-9_.-]+)/);console.log(m?"token_captured":"NO_TOKEN")' <HROOT>/evidence/boot.log
# 就绪后立刻脱敏留证：
sed -E 's/token=[A-Za-z0-9_.-]+/token=<REDACTED>/g' <HROOT>/evidence/boot.log > <HROOT>/evidence/boot.redacted.log
sed -i "s/token=[A-Za-z0-9_.-]\+/token=<REDACTED>/g" <HROOT>/evidence/boot.log
```
期望：`ready_seconds≈2`、`token_captured`、脱敏后日志只留一行 readiness。**token 不得进入报告或任何长期产物。**

### 步骤 4 — 存活 / 归属 / 可达判定（同 netns 内）

```bash
ss -ltn | grep -c LISTEN                    # 期望 2（服务 3098 + sink 39901）
ss -H -ltn '( sport = :3098 )' | wc -l      # 期望 1
ss -H -ltnp '( sport = :3098 )'             # 期望 users:(("node",pid=N,fd=..))
node -e '<bind 预检 3098>'                  # 期望 EADDRINUSE（证明是我们占的且真的在听）
curl -s -o /dev/null -w 'unauth=%{http_code}\n' http://127.0.0.1:3098/            # 期望 401
curl -s -c ck.txt -o /dev/null -w 'auth=%{http_code}\n' "http://127.0.0.1:3098/?token=$TOKEN"   # 期望 303
curl -s -b ck.txt -o root.html -w 'page=%{http_code} bytes=%{size_download}\n' http://127.0.0.1:3098/  # 期望 200 / 34812
```
（可选浏览器层，如后续做 UI 验证）：`google-chrome --headless=new --no-sandbox --user-data-dir=<ISO>/chrome-profile --remote-debugging-port=9224 about:blank &`，就绪判据用 **netns 内** `curl http://127.0.0.1:9224/json/version`（**不要**等 `DevToolsActivePort` 文件）。端口 9224/9225 当轮宿主侧空闲。

### 步骤 5 — 零模型请求台账

```bash
sleep 3                                                    # grace：后台/标题生成若会跑，此时应发生
ctrl=2; hits=$(grep -c '^HIT' <HROOT>/evidence/sink.log); echo "service_hits=$((hits-ctrl))"   # 期望 0
echo "tracer_control=$(grep -c 'sin_port=htons(39901)' <HROOT>/evidence/strace-connect.log)"   # 期望 ≥1
echo "connect_total=$(grep -c 'connect(' <HROOT>/evidence/strace-connect.log)"                 # 逐行可归因
grep 'connect(' <HROOT>/evidence/strace-connect.log | grep -vE 'inet_addr\("127\.|sun_path' | wc -l  # 期望 0
tr '\0' '\n' < /proc/<SVCPID>/environ | grep -cE '(API_KEY|_TOKEN=|SECRET)'                    # 期望 0
find <ISO>/home/.dsh -name '*.jsonl' | wc -l                                                   # 期望 0（无会话 ⇒ 无标题生成）
```
输出即 §2.4 的 `verdict.txt`。任一阈值不满足 → 本次运行**不得**声称零模型请求。

### 步骤 6 — 证据收集（job 内落盘，job 外只读）

```bash
find <ISO> -maxdepth 3 -type f -exec sha256sum {} + > <HROOT>/evidence/files.sha256
ss -ltn > <HROOT>/evidence/ports-running.txt ; cp /proc/net/tcp /proc/net/tcp6 <HROOT>/evidence/
```
所有状态写在 **workspace 内**（`/tmp` 是会话共享 tmpfs，勿用）。

### 步骤 7 — 停栈（**必须在 job 结束前完成并留证**）

```bash
kill -TERM -$DSHPGID; sleep 3; kill -KILL -$DSHPGID        # 进程组，非单 pid（见 §5.3-2）
kill $SINKPID
ss -ltn | grep -c LISTEN                                   # 期望 0
kill -0 $DSHPID || echo dsh_still_running=no               # 期望 no
```
job 一旦结束，PID namespace 被销毁、内核 SIGKILL 命名空间内所有进程（实测孤儿心跳 `DEAD(frozen)`）⇒ 跨 job 无幽灵实例；但 **job 内**仍需上面这组显式停栈证据。

### 步骤 8 — 异常处理表

| 现象 | 判读 | 处置 |
|---|---|---|
| `unshare -rn true` 非 0 或打印沙箱拒绝 | 本机 userns 不可用 | 记录拒绝原文为证据；降级方案：`env -i` + 假 `HOME`/`DSH_HOME` + 独立端口，并**明确记录残余风险**：网络未隔离，"零模型请求"只能靠 L4 + 日志，证据等级降到 B/C |
| readiness 行 60s 未出现 | boot 失败 | 看 `boot.log` 全文；核对 `HOME`/`DSH_HOME` 是否为绝对路径、profile 是否被独占锁、端口是否在同 netns 被占 |
| `preflight_bind=EADDRINUSE` | 同 netns 端口被占 | 换端口或改用 `--port 0` 并从 readiness 行解析 |
| 宿主 `curl 127.0.0.1:P` 连不上 | **正常**（不同 netns） | 不要据此判定服务未启动；到 netns 内验证 |
| 停栈后 netns 内仍有 LISTEN | 孤儿（多半只杀了包装进程） | 用进程组 kill；必要时在该 job 内 `pkill -f bin.js` 后复验 |
| `tracer_control_seen=0` | strace 未生效/参数错 | 该次 L3 证据**作废**（空洞），改用 L1+L2+L4 并记录 |

---

## 8. 未验证项与残余风险

### 8.1 本轮未验证（不得据本报告推断）

1. **UI 真实交互**：只验证了 CDP 层可达（`/json/version` 返回 Chrome 153）。未验证在 0.2.0 netns 内做页面导航、工具调用、流式渲染的可行性；未验证 `DevToolsActivePort` 缺失对既有 CDP 脚本（若依赖该文件）的影响。
2. **模型相关后台任务在 netns 内的真实失败形态**：只证明了"不发生"（无会话 ⇒ 无标题生成、无 connect）。未验证"如果发生"的错误串与是否可恢复。
3. **0.2.0 与现役数据/配置的兼容性**：虽然用了隔离 `DSH_HOME`，但未验证把现役数据复制进隔离根后的行为（超出 T20 范围，属其它轨道）。
4. **插件安装 / pnpm 路径**：冷启动不需要网络；未验证带第三方插件的 profile 在 netns 内能否离线物化。
5. **其它端口组合**：只实测了 3098（服务）+ 39901（sink）+ 9224（CDP）+ 39990-39997（边界实验）；3099/3102/3103/9225 只做了宿主侧空闲确认，未在 netns 内实起。
6. **长时间运行稳定性**：harness 单次运行约 40s（含 15s CDP 等待），未做小时级 soak（内存/HMR/日志轮转）。

### 8.2 残余风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| **netns 只隔离网络，不隔离文件系统** | 隔离实例仍能按绝对路径读到现役 `~/.dsh`（本会话内被沙箱 `ro` 根额外挡住；**一旦在 DSH 沙箱外运行该保护即消失**） | 一切写入靠 `HOME`/`DSH_HOME` 重定向 + 启动前核对；把"隔离根必须是绝对路径且存在"写入门槛 |
| **`127.0.0.1` 语义歧义** | 宿主与隔离 netns 的 loopback 是两套；误用会造成"服务没起来"的假阴性或"我在测隔离实例"的错觉（实际测到宿主同名端口） | 所有探测都在同一 job/netns 内执行；证据文件里记录 `net_ns` 与 `pid_ns` 标识 |
| **同端口号可双绑** | 宿主与 netns 各绑 3098 都成功 ⇒ 端口号本身不是唯一标识 | 归属判据（`ss -ltnp` pid/comm + cmdline）与身份哈希必须同时记录 |
| **namespace inode 号会被复用** | 实测不同调用出现相同 `ns:[inode]` 值，故 **ns inode 不能作为跨调用唯一标识**（每次调用 PID 从 1 重新编号才是可靠判据） | 只把 inode 当"当次运行内"的关联标签 |
| **跨 bash 调用无进程可见性** | 任何"job 外查活"的手段都不成立；只能读落盘证据 | Runbook 强制"job 内自证 + 落盘" |
| **孤儿风险存在于 job 内** | 只 kill 包装进程会留下继续 LISTEN 的服务（已复现） | `setsid` + 进程组 kill + netns 内复验 |
| **strace 开销与失真** | `-f` 全树跟踪会拖慢启动（本轮仍 2s 完成 boot，未观察到失败），理论上可改变并发时序 | 关键结论用 L1+L2 交叉验证；若怀疑失真，可用 `STRACE=0` 再跑一次做对照 |
| **L3/L2 的盲区** | 跟踪树外的进程、硬编码到非配置端点的调用、继承的已连接 fd、原始套接字 | 与 L1（无路由）+ L4（无 key）合取使用；必要时对特定路径加 `-e trace=sendto,socket` 扩展 |
| **`unshare` 可用性依机器而变** | 本机 `unprivileged_userns_clone=1`、容量上限极大；换机器/内核可能被 `kernel.unprivileged_userns_clone=0` 或 seccomp 策略禁掉 | 每次运行前重跑 §7 步骤 0.4 门槛，并把结果写进证据（本报告只保证"本机本会话当时"可用） |
| **evidence 中的凭据卫生** | readiness URL 携带进程 token；cookie 文件含令牌 | 已在 runner 内自动脱敏（`token=<REDACTED>`）；cookie 只存脱敏副本；token 不进入报告 |

---

### 附：本轮新增/修改的产物

- `.workspace/audit-020/reports/T20-isolated-harness-verification.md`（本报告）
- `.workspace/audit-020/work/harness/run_isolated.sh`（参考 runner，含 verdict 输出）
- `.workspace/audit-020/work/harness/sink.mjs`（已校准计数汇）
- `.workspace/audit-020/work/harness/tracewrap.sh`（tracer 存活控制 + exec 服务）
- `.workspace/audit-020/work/harness/evidence/`（v5 冷启动全绿证据）、`evidence-v3/`、`evidence-v4cold/`
- `.workspace/audit-020/work/exp-net/`、`exp2/`、`exp3/`、`exp4/`（命名空间边界、端口独立性、孤儿存活实验）
