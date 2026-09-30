# 3098 重启与验收 Runbook（dsh-020 · 2026-09-30）

> 本轮所有改动都已落盘，但 **0.2.0 宿主的宿主半插件是 ESM 模块，改动需要重启宿主才生效**
> （旧模块已在进程内存里）。重启只影响 `3098`；**`3080` / `3097` 一动都不要动。**
>
> **这一次重启同时覆盖两件事**（否则要重启两次）：
> 1. 两个模型路由插件的 `.volatile()` 修复（设置页「设置命名空间未注册」）；
> 2. **启动脚本的桌面会话变量转发**（右上角 "Open in App" 的 VS Code / 终端无响应）
>    —— 细节与源码级因果链见 `reports/OPEN-IN-APP-FIX.md`。
>
> ⚠ 第 2 项**必须在你真实的桌面终端里**运行本脚本才会生效；
> 若经由 `sudo` / `nohup` / `systemd-run` / `ssh` 之类的入口启动，桌面变量本就为空，转发无从谈起
> （脚本会**明确告警**而不是假装正常）。

---

## 0. 为什么必须重启（机制，不是猜测）

设置页那两句「设置命名空间未注册」的真因是 **0.2.0 的设置面只暴露 `.volatile()` 字段**：

| 事实 | 位置 |
|---|---|
| *"Forms expose only volatile fields from active, uniquely addressed profile entries."* | `$B/dsh-settings/README.md:12,33` |
| `volatileForm(schema) === undefined` ⇒ **整条条目被 `describe()` 跳过**，不进 served 列表 | `$B/dsh-settings/lib/index.js:418-419` |
| 写入还会直接抛 `Plugin entry "<ns>" has no volatile fields` | `$B/dsh-settings/lib/index.js:505-507` |
| 命名空间不在 view 里 ⇒ 客户端快照 `status:"unavailable"`（就是那句报错） | `$B/dsh-client-ui-settings/lib/client.js:1226-1233` |

两个插件原本的 `Config` **一个 volatile 字段都没有**，所以被整条跳过。
本轮给它们按官方同形（`$B/dsh-agent-default-model/lib/index.js:21-25`）补上了 `.volatile()`。

`$B = /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`

---

## 1. 重启前闸门（先跑，确认该重启了）

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020
node verify-settings-served.mjs 3098
```

**重启前的预期输出**（这就是你截图里的现象，已复现）：

```
served count    : 25
MISSING  subagent-model
MISSING  vision-adam
OK       wallpaper  applies=live ...
OK       ssh-gui    applies=live ...
RESULT: FAIL — 2 个命名空间未 served。
```

---

## 2. 重启 3098

```bash
# 2.0 【新增】先干跑一次，确认脚本会带上桌面会话变量（不启动、不占端口）
#     期望：命中 >0 项，并能看到 DISPLAY / XDG_RUNTIME_DIR / DBUS_SESSION_BUS_ADDRESS
#     若命中 0 项 → 说明你当前这个终端就没有桌面环境，先解决这个再重启
bash /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/boot-web.sh 3098 --dry-run

# 2.1 确认现状（3098 是要重启的；3080/3097 必须仍在监听）
ss -ltn | grep -E ':(3080|3097|3098) '

# 2.2 停 3098：在启动它的那个终端按 Ctrl-C；或者：
pkill -f 'port 3098'

# 2.3 启动（会打印带 token 的 URL，首次必须用它打开；裸地址会返回
#     "dsh web authentication required"，那是预期行为）
bash /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/boot-web.sh 3098
```

> `boot-web.sh` 自带端口占用闸门（bind-only 探针），占用会直接 `ABORT` 而不是抢占。
> 启动时会打印「桌面会话变量转发（白名单 15 项，实际命中 N 项）」，并写侧车
> `logs/web-3098.env.txt`，事后可核对"这次到底带了什么"。
> **必须在你真实的桌面终端里运行**；经 `sudo`/`nohup`/`systemd-run`/`ssh` 启动会让桌面变量为空。

---

## 3. 重启后验收

### 3.1 自动闸门（一条命令，必过）

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020
node verify-settings-served.mjs 3098
```

**期望**：

```
served count    : 27          # 25 + 恰好新增这 2 个
OK       subagent-model  applies=live revision=0 value={"provider":"adam","model":"deepseek-v4-pro"}
OK       vision-adam     applies=live revision=0 value={"apiKeyEnv":"ADAM_API_KEY","baseURL":"https://llmapi.roboscience.xyz/v1","model":"gpt-6-astra","maxTokens":393216}
OK       wallpaper       ...
OK       ssh-gui         ...
RESULT: PASS — 设置页将能渲染这 4 个条目。
```

> 这两行 `value` 同时证明了 **P0-B 的 settings 投放已生效**（`vision-adam` 用的是现役 settings.yaml 的原值，
> 不是插件默认的 opencode 网关）。

### 3.2 GUI 验收（在浏览器里，用 token URL 打开）

| # | 位置 | 期望 |
|---|---|---|
| 1 | 设置 → **子代理模型** | 出现 `provider`/`model` 两个可编辑输入框 + 保存按钮；不再显示「设置命名空间未注册」 |
| 2 | 设置 → **vision-adam 识图设置** | 出现 4 个输入框（识图模型 / 网关 Base URL / API Key 凭据引用 / 最大输出 tokens）；当前生效行显示 `model=gpt-6-astra · baseURL=https://llmapi.roboscience.xyz/v1 · apiKeyEnv=ADAM_API_KEY · maxTokens=393216` |
| 3 | 新建会话 | 技能目录含 `ppt-master`、`program-notebook`、`session-handoff`、`ppt-template-fidelity`、`workbuddy-ppt`（**5 条**；`grill-me` 是 `/grill-me` 用户手势技能，不出现属预期） |
| 4 | 会话列表 | 历史工作区/会话出现（本轮已把 2508 份历史转换后落盘到 `$DSH_HOME/sessions`） |
| 5 | 设置 → 壁纸 | 能显示/保存当前壁纸（`wallpaper` 条目已 served） |
| 6 | **右上角 "Open in App" → VS Code** | 打开浏览器 **Network 面板**，点它，记录状态码；**真实窗口出现**、打开的是你点的目录 |
| 7 | **右上角 "Open in App" → 终端** | 同上；新终端里执行 `pwd` 与 `printf '%s\n' "$HOME"`，核对工作目录与实际 HOME |

> 第 6/7 条的**结案标准是真实窗口 + 正确工作目录**，**不以 HTTP 200 或命令退出 0 结案**
> （`dsh-host-open-in-app:366-367` 的观察窗口到期即判 `launched`，与窗口是否出现无关）。
> 若仍失败：记录**应用名 / 时间 / HTTP 状态 / 脱敏错误输出**，不要复制认证 token。
>
> 取舍须知：默认**不转发** `XDG_CONFIG_HOME` 等用户数据根（保隔离）⇒ VS Code 会用**隔离 HOME 的配置**，
> 与你平时那个 VS Code 实例/窗口不同。想让 GUI 应用用真实用户配置：
> `DSH_FORWARD_XDG_ROOTS=1 bash .../boot-web.sh 3098`（代价是 GUI 应用可读写真实 `~/.config`、`~/.local`）。

### 3.3 改完设置后的热生效验证（可选，但推荐做一次）

在设置页把「子代理模型」的 model 改成一个别的值 → 保存 → 再跑一次
`node verify-settings-served.mjs 3098`，`subagent-model` 的 `value` 与 `revision` 应同步变化。
> 消费侧是 `$B/dsh-tool-subagent/lib/index.js:68-84` 的本地补丁，**每次派发实时读**
> `settings.describe()` 的 `value`，所以改完对**下一次派发**即生效，不需要再重启。
> ⚠️ 但**正在运行中的会话与子代理**保留旧值——要看到新值请开新会话。

---

## 4. 回滚

本轮所有改动都在 `.workspace/audit-020/assembly-020/` 内，且都有改前原件：

```bash
A=/home/CNS2026495165/dsh/.workspace/audit-020
BK=$A/volatile-fix-backup

# 回滚两个插件宿主半
cp -p $BK/subagent-model.index.js.orig   $A/assembly-020/home/profiles/node_modules/@local/dsh-subagent-model/lib/index.js
cp -p $BK/vision-adam.index.js.orig      $A/assembly-020/home/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js
# 回滚 profile（会同时撤掉 P0-B 的 vision-adam / wallpaper / ssh-gui 三段投放）
cp -p $BK/cordis.patch.yml.orig          $A/assembly-020/home/profiles/web/cordis.patch.yml

# 回滚启动脚本（撤掉 Open in App 的桌面变量转发，回到"Open in App 不可用"的旧行为）
cp -p $A/openinapp-fix-backup/boot-web.sh.orig $A/assembly-020/boot-web.sh
```

回滚后重启 3098 即恢复原状（此时 `verify-settings-served.mjs` 应再次报那 2 条 MISSING）。

**注意**：回滚 profile 会撤掉 P0-B 三段投放；若只想撤两段中的某一段，请手工编辑
`$A/assembly-020/home/profiles/web/cordis.patch.yml`，不要整文件覆盖。

---

## 5. 不要做的事

- 不要动 `3080`（0.1.1 现役，历史与回滚路径都压在它身上）与 `3097`（0.1.7；D4 是用户手动择时退役）。
- 不要删 `~/.dsh/sessions` 或 `~/.dsh/attachments`——它们仍是**唯一原件**；
  本轮的转换产物只落在`.workspace/**` 与隔离根里。
- 不要往隔离根的会话目录里放未压缩 `.jsonl`——0.2.0 会把**整根**判为 `legacyLayout` 并拒绝
  （`$B/dsh-session-persistence-jsonl/lib/index.js:3429-3455`）。
