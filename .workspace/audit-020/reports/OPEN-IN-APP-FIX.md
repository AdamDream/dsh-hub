# Open in App（VS Code / 终端）无响应 —— 修复报告

- 日期：2026-09-30
- 工单：用户报告「3098 页面右上角 Open in App 的 VS Code 无响应、终端提示打开失败」
- 状态：**已实施最小修复（启动脚本），已在脚本层面实证；真实窗口验收待用户重启后执行**
- 改动范围：**仅 `assembly-020/boot-web.sh` 一个文件**（+35 → 114 行）
- 备份：`.workspace/audit-020/openinapp-fix-backup/boot-web.sh.orig`
  （sha256 `5cf89d43a6eea494660b2eab822c80308cb9df36bfdb14211cabefc3b417f2a1`）
- 新件 sha256：`356f8bcc78ad7d903154197869a92ee2639a96454215840d740d7045659e0df3`
- diff：`.workspace/audit-020/openinapp-fix.diff`（109 行）

---

## 1. 我把用户诊断里那条"强间接证据"升级成了**源码级闭环**

用户报告的因果链方向正确，但留了一个缺口：「尚未直接读取运行中宿主 PID 的白名单环境；
当前实例与启动脚本的对应为强间接证据」。本轮把这条补齐，靠的是**读启动链的源码**，而不是猜宿主环境。

```
$N = assembly-020/home/profiles/node_modules/@deepseek-ai      （profile 侧挂载的包）
$B = assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai

① 应用启动：$N/dsh-host-open-in-app/lib/index.js:348-357
     const launchDetachedApp = (...) => new Promise((resolve, reject) => {
       const child = spawn(command, [...args], {
         detached: true, stdio: "ignore", windowsHide: options.windowsHide,
         env: { ...scrubbedParentEnv(), ...options.env }     // ← 子进程环境来自宿主 process.env
       });
       …
       const watch = setTimeout(() => { settle(resolve); }, …);   // ← 观察窗口到期仍运行 ⇒ 判 launched
     });
   ⇒ `stdio:"ignore"` ⇒ **被启动应用的 stderr 被丢弃**（用户报告说的"诊断缺口"，源码成立）
   ⇒ 观察窗口非零退出才 reject；分离后退出 0 即计 launched ⇒ **"已发起" ≠ "窗口已出现"**（源码成立）

② 宿主环境怎么来的：$B/dsh-subprocess/lib/index.js:50-56
     function scrubbedParentEnv() {
       const env = {};
       for (const [k, v] of Object.entries(process.env))
         if (v !== void 0 && !SENSITIVE_ENV_PATTERN.test(k) && !k.toUpperCase().startsWith("DSH_")) env[k] = v;
       …
     }
   $B/dsh-subprocess/lib/index.js:32
     const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;
   ⇒ **这是"凭据擦洗"，不是白名单。**它转发 process.env 里的**一切**，只剔除凭据形状名与 `DSH_*`。

③ 逐项核对桌面变量会不会被擦掉（用②的真正则实跑）：
     keep  DISPLAY / WAYLAND_DISPLAY / **XAUTHORITY** / DBUS_SESSION_BUS_ADDRESS
     keep  XDG_RUNTIME_DIR / XDG_SESSION_TYPE / XDG_CURRENT_DESKTOP / XDG_DATA_DIRS / LANG / LC_ALL
     drop  ADAM_API_KEY（凭据形状）、DSH_WEB_URL（DSH_ 前缀）
   > 勘误：我第一遍测试误用了含 `AUTH` 的臆造正则，把 `XAUTHORITY` 误判成被丢弃；
   > 已用源码真正则 `/KEY|PASSWORD|SECRET|TOKEN/i` 复核——`XAUTHORITY` **不在**擦除集内。

④ 启动脚本（改动前）：`env -i` + 只设 `HOME / DSH_HOME / PATH / DSH_TELEMETRY_MODE`
   ⇒ 宿主 `process.env` 里**根本没有** ①要转发的那批变量。

⑤ 路由映射：`$N/dsh-host-open-in-app/lib/index.js:1390-1399`
     if (outcome === "launched") sendJson(res, 200, { ok: true });
     else sendJson(res, 502, { code: "launch-failed", … });
   `launchWatchMs` 在组合树里实测 = **1000**（`logs/dump020-final.yaml:626`）。
```

**结论（源码级）**：断点唯一且明确——**`env -i` 把这批变量清掉了**。
①③ 证明"只要宿主有，就一定会传给被启动的应用"；④ 证明"宿主不会有"。
⇒ 用户报告里"强间接证据"这一档，本轮可升级为**源码级闭环**。

### 另一条实测：桌面会话确实存在（不是"机器没有桌面"）

```
[实跑] /run/user/1001/  →  bus（srw-rw-rw- 套接字）、dconf、gvfs、gvfsd、pulse、systemd、ICEauthority、at-spi*
```
⇒ 本机有活跃 GNOME 会话（uid 1001）。故障**不是**"没有桌面"，而是"宿主进程不知道桌面在哪"。

### 证据边界（诚实标注）

- 我**没有**、也**无法**读到运行中宿主 PID 的 `environ`：本工具跑在
  `bwrap --unshare-pid --tmpfs /tmp` 里，既看不到宿主进程 `/proc`，`/tmp` 也被 tmpfs 遮蔽
  （实测 `ls /tmp/.X11-unix` → No such file，所以连 X socket 都够不到）。
- 我的工具环境**不可**当作宿主环境的证据（里面混着 harness 注入的 `DSH_*`、`NO_COLOR`、`VIPSHOME` 等）。
  用户报告里"不采纳工具环境等同宿主环境"的判断，**我同意并维持**。
- 因此「运行中的 3098 是不是由 boot-web.sh 启动」仍是**强间接证据**（端口一致、`web-3098.log` 内容
  与 `exec … | tee` 的形态一致、单实例）。**但这对修复不构成阻碍**：只要是 `env -i` 起的，就必然缺这批变量；
  修复对两种情况都正确。

---

## 2. 已实施的最小修复

**只改启动脚本，保留 `env -i` 与全部隔离边界，不硬编码 `DISPLAY=:0`，不继承全部宿主环境。**

```bash
DESKTOP_ENV_WHITELIST=(
  DISPLAY WAYLAND_DISPLAY XAUTHORITY XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS
  XDG_SESSION_TYPE XDG_SESSION_DESKTOP XDG_CURRENT_DESKTOP
  XDG_DATA_DIRS XDG_CONFIG_DIRS
  LANG LANGUAGE LC_ALL LC_CTYPE LC_MESSAGES
)   # 15 项；命中多少转发多少，缺谁不补谁

exec env -i HOME=… DSH_HOME=… PATH=/usr/bin:/bin DSH_TELEMETRY_MODE=DISABLED \
     "${FORWARDED[@]}" node "$CLI" --profile web --port "$PORT" 2>&1 | tee "$LOG"
```

### 两条刻意的设计选择（都是取舍，不是遗漏）

1. **默认不转发 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME`。**
   它们是"真实用户数据根"，带上会让 GUI 应用读写真实 `~/.config`、`~/.local`，与"伪装 HOME 隔离"冲突。
   需要时显式 opt-in：`DSH_FORWARD_XDG_ROOTS=1 bash boot-web.sh 3098`。
   > ⚠ 代价要知悉：默认下 VS Code 会用**隔离 HOME 的配置**，是一个与平时不同的 profile/窗口实例；
   > 这正是用户报告点出的"伪 HOME 影响应用配置和实例复用、不能推导为绝对不能复用窗口"。
2. **没有桌面会话时明确告警，不假装正常**（用户报告的要求）：
   命中 0 项时打印 `!! 未检测到任何桌面会话变量 … "Open in App" **将无法工作** … 这是可见的降级，不是故障`。
   同时明确否定硬编码 `DISPLAY=:0`。
   仍未做的：**禁用/置灰界面上的桌面入口**——那要改官方件 `dsh-client-ui-open-in-app`，
   按用户报告「暂不改动安装包」的裁决**不做**。

### 新增可复跑开关与取证

- `bash boot-web.sh <PORT> --dry-run`：只打印将要转发的变量与最终命令，**不启动、不占端口**。
- 每次启动写侧车 `logs/web-<PORT>.env.txt`（变量名 + 非敏值 + 白名单命中数），便于事后取证。

---

## 3. 已实证（可复跑）

| # | 判据 | 结果 |
|---|---|---|
| V1 | `bash -n boot-web.sh` | **通过** |
| V2 | 空数组 + `set -u`（最容易踩的坑） | bash 5.2 下 `"${E[@]}"` 展开安全，**不报 unbound** |
| V3 | `--dry-run` 无桌面变量 | 命中 **0/15** → 打印降级告警；命令仍是 `env -i`，无多余变量 |
| V4 | `--dry-run` 带桌面变量 | 命中 **7/15**（DISPLAY/XAUTHORITY/XDG_RUNTIME_DIR/DBUS/XDG_SESSION_TYPE/XDG_CURRENT_DESKTOP/LANG），引号正确 |
| V5 | **环境确实到达子进程**（把组装出的 argv 原样执行，只把 CLI 换成打印 `process.env` 的探针） | 对照 A（无桌面变量）：`DISPLAY=None`；对照 B：`DISPLAY=":1"`、`XDG_RUNTIME_DIR="/run/user/1001"`、`DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1001/bus"` |
| V6 | **隔离性未回归** | 两种情况 `HOME` 都是伪装根、`XDG_CONFIG_HOME=None`、**`ADAM_API_KEY=None`（凭据未泄漏）** |
| V7 | 侧车取证 | `logs/web-3098.env.txt` 正确记录 `whitelist_size=15 forwarded_count=4` 与逐项值 |

---

## 4. **未验证**（不得当作已修好）

1. **真实窗口是否出现** —— 验收标准是「VS Code 与终端的真实窗口 + 正确工作目录」，
   本轮**只到脚本层**。**没有**真实点击、**没有**重启 3098、**没有**捕获 HTTP 状态码。
   > 我**不能**自行重启 3098：本会话就跑在该进程里，重启会杀掉会话。
2. **用户点击时的实际 HTTP 状态码**：用户报告说这一条是源码推导。本轮也仍是源码推导；
   抓取需要在重启后于浏览器 Network 面板核对（见 §5）。
3. **`XDG_CONFIG_HOME` 默认不转发这一取舍带来的实际影响**（VS Code 用隔离 profile 的表现）——需实测。
4. **`DBUS_SESSION_BUS_ADDRESS` 打通后，GNOME Terminal 是否会经用户会话总线激活服务、
   从而不再继承 DSH 的隔离 HOME** —— 这是用户报告自己点出的隔离风险，**本轮未验证**，需要用户在重启前明确接受。
5. 官方件的可用性检查 / 错误日志 / 状态语义（`stdio:"ignore"` 丢错误、launched 语义过宽）**未改**。

---

## 5. 验收步骤（与用户报告的验收清单对齐，可在**同一次重启**里顺便做掉）

> 这次重启可以**一次覆盖两件事**：两个模型路由插件的 `.volatile()` 修复 + 本次 Open in App 修复。
> 主 Runbook 见 `reports/RESTART-AND-VERIFY-RUNBOOK.md`。

```bash
# 5.1 在【用户真实桌面终端】里核对（只看有无与路径/编号，不输出 cookie 内容）
for v in DISPLAY WAYLAND_DISPLAY XAUTHORITY XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE; do
  printf '%-26s %s\n' "$v" "${!v:-<空>}"
done

# 5.2 干跑：确认脚本会带上它们（应命中 >0 项）
bash /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/boot-web.sh 3098 --dry-run

# 5.3 停旧实例 → 用修订脚本重启（不要另开端口冒充原页面已修好）
pkill -f 'port 3098'
bash /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/boot-web.sh 3098

# 5.4 刷新原页面，打开浏览器 Network 面板，分别点「VS Code」与「GNOME Terminal」，
#     记录 HTTP 状态码（200 / 502）、实际窗口是否出现
# 5.5 在新开的终端里执行：
pwd; printf '%s\n' "$HOME"        # 核对工作目录与实际 HOME
```

**结案标准**（沿用用户报告）：两种应用的**真实窗口与工作目录均正确**。
**不以 HTTP 200 或命令退出 0 结案。** 若仍失败，记录：应用名 / 时间 / HTTP 状态 / 脱敏错误输出（不复制 token）。

---

## 6. 回滚

```bash
cp -p /home/CNS2026495165/dsh/.workspace/audit-020/openinapp-fix-backup/boot-web.sh.orig \
      /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/boot-web.sh
```
回滚后重启即回到"Open in App 不可用"的旧行为。
