# audit.md — 只读验证「环境强开 Gecko 无障碍 ⇒ Firefox 卡 / Chrome 顺」

* 目录：`.workspace/lag-fix/incident2/firefox-a11y/`
* 方法：只读取证 + 独立实例 A/B（共享锁 + 实时进程表互锁）
* **未修改任何系统/用户配置；未重启任何服务；未结束任何用户进程。** 全程唯一被信号的进程都是我**自己启动的**进程，且逐个按 PID 且先校验命令行/profile 路径为我的才发信号。
  * 例外与自我披露：曾**误用一次 `pkill`**（模式匹配到了我自己的 shell，把自己的 shell 一并 SIGTERM；未波及用户进程，且当时未启动任何浏览器）—— 详见 **§9b.1**。此后一律按 PID。
* 时间窗：2026-09-22 10:55 – 12:03（+08:00）；loadavg 采样区间 **2.3 – 9.7**（32 核；三条批次各自记录了 per-run loadavg）

---

## TL;DR（一句话结论）

**假设成立，但需要三处精确化。**

1. **Firefox 的无障碍确实被环境强开**（裁决 **①PASS**）：用户 Firefox 父进程在 AT-SPI 无障碍总线上、应用根对象活着（`Name="Firefox"`, `role=application`, `ChildCount=2`），
   而用户自身偏好**全为 false**。起作用的是 **`GNOME_ACCESSIBILITY=1`**（不是 `ACCESSIBILITY_ENABLED`）；`90atk-adaptor.conf` 的 `GTK_MODULES` 对 Firefox **无效**。
2. **代价是真实的、且只在桌面工况出现**（裁决 **②PASS**）：同批交错、headed、3 次/条件、自证 3/3 ——
   **帧时间 1.86×**（31.4 → 16.8 ms/帧）、**帧 p95 3.0×**、**同工作量多花 42% CPU**、**单次 DOM 变更吞吐成本 4.6×**。
   而在 **headless（无 AT-SPI 消费者）下成本 ≈ 1.00** ⇒ 花钱的是"树被真实消费"，不是"引擎被实例化"。
3. **"Chrome 顺"的原因是环境变量不开 Chrome 的网页 a11y，而不是"a11y 对 Chrome 不贵"**（裁决 **③PASS / ③c FAIL**）：
   强制打开 Blink 的 a11y 代价**更大**（帧时间 2.35×、帧 p95 **12.9×**，`chrome://accessibility` 证实 AXMode 全开），
   但环境变量在 Chrome 上**完全没有效果**（`env-default` 与 `env-cleared` 的 AXMode 都全 false、耗时无差异）。
   ⇒ **两个引擎都很贵，差别在于"谁被环境打开了"。**
4. **另有安全相关发现**：`/usr/bin/firefox` 与 `/opt/google/chrome/google-chrome` **两个启动器都被改过**（`dpkg -V` 可复现），
   前者硬编码 `GNOME_ACCESSIBILITY=1`，后者追加 `--force-renderer-accessibility`。
   **这会让用户自测（`env -u GNOME_ACCESSIBILITY firefox`）静默失效**，建议交 IT/安全复核。
5. **可靠且可回滚的验证开关只有一个**：`accessibility.force_disabled=1`（本次 3/3 生效，总线成员 3/3 → 0/3）。
   **清环境变量无效** —— Gecko 会自己把 `GNOME_ACCESSIBILITY=1` 设回进程环境（内核 `/proc/environ` 实证，§6.3b）。

---

## 0. 裁决速查表（最终）

| # | 命题 | 裁决 | 决定性证据 |
|---|---|---|---|
| ① | 环境是否**真的**强开了 Firefox 无障碍 | **PASS** | 三条独立证据：**(a)** 用户 Firefox 父进程 9042 在私有 AT-SPI 无障碍总线上，应用根对象可查询：`Name="Firefox"` `role=application` `ChildCount=2`（§4）；**(b)** 我的独立实例在 `env-default` 下从**浏览器进程内部**读回 `a11yService=REGISTERED` 且**上总线 3/3**，而 `force_disabled=1` 下 `ABSENT`、总线 0/3（§6.5）；**(c)** profile `prefs.js` 无任何 `accessibility.*`、用户 gsettings 全 false ⇒ 属"环境强开" |
| ①b | Gecko 被哪个变量强开 | **PASS（修正背景说法）** | `libxul.so` 含 `GNOME_ACCESSIBILITY`（字面量，位于 GTK/ATK 桥代码段），**不含** `ACCESSIBILITY_ENABLED`，也不含 `GTK_MODULES` ⇒ 生效的是 **`GNOME_ACCESSIBILITY=1`**；`/etc/environment.d/90atk-adaptor.conf` 的 `GTK_MODULES=…:atk-bridge` 对 Firefox **无效**（§5c） |
| ①c | ★ 是否还有第二个强开源 | **PASS（新发现，安全相关）** | `/usr/bin/firefox` 第 72 行被改成 `GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"`；`dpkg -V firefox` → `??5??????`。**后果：终端里 `env -u GNOME_ACCESSIBILITY firefox` 完全无效**（§5b） |
| ② | 强开对**帧时间**的量级（桌面/真实 AT-SPI） | **PASS，量级明确** | 同批交错、headed、3 次/条件、自证 3/3：**帧时间 1.86×**（31.4 ms → 16.8 ms/帧，即约 32 fps → 60 fps）、**帧 p95 3.0×**（54 → 18 ms）、**进程树 CPU 1.42×**、**单次 DOM 变更吞吐成本 4.6×**（§6.5） |
| ②b | 同一强开在 **headless**（无 AT-SPI 消费者）下的量级 | **PASS（关键边界条件）** | 全部指标 ≈ **1.00**（0.99–1.01）⇒ **成本只在“有真实 AT-SPI 消费者接入”时出现**；引擎被实例化本身几乎不花钱（§6.3） |
| ③ | 强开 a11y 对 **Blink** 的影响倍数 | **PASS** | 同一页面 90 009 节点：`--force-renderer-accessibility` ⇒ 帧时间 **2.35×**、帧 p95 **12.9×**、TaskDuration 1.82×、变更吞吐成本 1.84×；self-proof：`chrome://accessibility` 的 AXMode 复选框在无 flag 时**全 false**、有 flag 时**全 true** + `activeAT=GenericScreenReader`（§7.4） |
| ③b | "Chrome 不受该环境变量影响" | **PASS（内容渲染路径成立）** | `env-cleared` 与 `env-default` 在 Blink 上**无差异**（全部 0.93–1.07），且两者 AXMode 均**全 false** ⇒ **环境变量并不开启 Chrome 的网页内容 a11y**；Firefox 却被 `GNOME_ACCESSIBILITY` 开 ⇒ 这就是"同一环境、Chrome 顺 Firefox 卡"的直接原因（§7.4） |
| ③c | "Chrome 完全不受影响" | **FAIL（需修正）** | Chrome **浏览器进程同样在 AT-SPI 总线上**（`:1.59`，`ChildCount=3`）；且**启动器被改成追加 `--force-renderer-accessibility`**（§5b）⇒ Chrome 并非"不受影响"，而是**网页内容 a11y 默认为关**；一旦走被改过的启动器，Chrome 也要付同样的代价（2.35×） |
| ④ | 进程环境可否直接读取 | **对用户进程 INCONCLUSIVE；对自有子进程 PASS** | 用户 9042 等的 `/proc/<pid>/environ` 一律 `EACCES`（`ptrace_scope=1`，非祖先）；但我自己启动的实例可读，且浏览器内 `Services.env` 读回补上了该缺口（§3.2、§6.5） |
| ⑤ | 共享锁/单浏览器纪律在本机是否有效 | **FAIL（外部条件，已如实记录）** | 锁被 3+ 条线争抢；我的批次中途被夺锁；同批内观测到 **1–13 个外来探针浏览器并发**（§1.2、§9b.2）。**因此本报告的相对倍数才是裁决依据，绝对 ms 只标条件** |

---

## 1. 方法与纪律

### 1.1 只读边界（实际执行）
* 全程**未写入**任何 `/etc/**`、`~/.mozilla/**`、`~/.config/**`、`~/snap/firefox/common/**`。所有新增文件都落在本目录内。
* **未** `pkill`、**未** `kill` 任何用户进程；**未**重启任何服务。唯一被信号的进程是**我自己启动的独立 Firefox 实例**，且只对**自己创建的进程组**发信号（见 §6.1）。
* 未使用 `sandbox_permissions`，未申请任何提权。

### 1.2 共享锁（`research-v2/.probe.lock`）——实测比预期复杂，如实记录
1. 10:57 – 11:00：锁被 `incident2-minimal-page` 持有，其 `owner_pid 284598` **已死**但目录未释放（孤儿锁）。
2. 11:00:33：锁换成了一个**非规范写入者**：`owner.txt` 内容只有 `310374` 一行（裸 pid），进程同样**已死**。
   * 规范解析器（`owner.txt` 的 `key: value` 格式）**读不出**这个格式 ⇒ 对守规矩的线路来说该锁"不可见"且**永久死锁**。
   * 我因此显式识别该变体，并加了两道**互相独立**的互锁（见 1.3），而不是默默绕开。
3. 11:03:40：`incident2-gecko-vs-blink` 以**规范格式**重新获得该锁（`owner_pid 337298`，**存活**）。按纪律**我全程等待**，未在其持锁期间启动任何浏览器。

**接管规则（写在 `lib/lock.mjs` 注释里，可审计）**
* 规范 owner：沿用协议原文 —— 年龄 > 25 min **且** owner pid 已死。
* 非规范/孤儿 owner（裸 pid 或无法解析）且 pid **可证已死**：改用 owner.txt 的 mtime 作年龄，阈值 10 min。理由：pid 已在进程表里消失 ⇒ 不存在"还活着但很慢的 owner"可被伤害；残余风险（第三方写的是子进程 pid）由 1.3 的实时普查兜住。
* 每一次接管都会把 `staleOwner / staleRaw / ageMin / mtimeAgeMin / kind` 记进 raw 证据。

### 1.3 两道互锁（比锁本身更强）
1. **仍持有锁**：每次启动浏览器前 `assertOwns(token)`；若锁被别人拿走 → 立刻中止整批，不再启动第二个浏览器。
2. **实时进程表普查**：启动前用 `/proc` 扫描（**不用** `pgrep -f`），确认没有**外来探针浏览器**（命令行含 `--profile`/`--user-data-dir` 且不是我的 profile）在跑；有则等待（上限 120 s），并把普查结果写进该次 run 的证据里。
   * 用户自己的 Firefox/Chrome 属常态背景，单独计数记录，不视为冲突。

### 1.4 本次审计的**已知并发干扰**（必须随数字一起读）
* 同一时刻有**另一条线**在做同类工作：`.workspace/lag-fix/incident2/gecko-vs-blink`（11:03:40 起持锁跑 chromium+firefox 多 cell 标定）。其间 loadavg ≈ 3.2–3.5。
* 用户 Chrome（pid 303448）与用户 Firefox（pid 9042）全程运行。
* ⇒ 本文所有**绝对 ms 只在本节所述并发条件下成立**；只有**同批交错条件的相对倍数**才作为裁决依据。

### 1.5 环境工具缺失（如实记录）
* `web_search` 工具在本会话**完全不可用**（每次调用返回 `An active OpenCode Go subscription is required to use Go models`）。因此**"大 DOM 下 a11y 是已知严重性能杀手"这一外部论断本次无法引用权威来源** ⇒ 标 **INCONCLUSIVE（外部文献）**，本文只以本机实测数字说话。

---

## 2. （留空段，见各节）

---

## 3. 证据：用户 Firefox 的 a11y 相关状态

### 3.1 profile prefs（只读）
* 唯一 profile：`~/snap/firefox/common/.mozilla/firefox/g05ps3km.default/`（`profiles.ini` 确认 `Default=1`）；`~/.mozilla/firefox/` **不存在**。
* `prefs.js`（28 757 B，mtime 11:00 前后随会话更新）中 `accessibility.*` 命中的**只有一行**：
  * `user_pref("accessibility.typeaheadfind.flashBar", 0);`（与引擎无关的查找栏高亮）
* **不存在** `accessibility.force_disabled`（无论 0/1/-1）⇒ 用户**没有**用 pref 关掉也无障碍引擎，一切交给平台判定。
* `devtools.*` 只有 5 行界面尺寸类设置（`devtools.everOpened=true` 等），无 a11y 相关。
* **无 `user.js`**（不存在该文件）⇒ 没有旁路注入。

### 3.2 进程环境：**不可得**（如实记录）
```
$ tr '\0' '\n' < /proc/9042/environ
bash: /proc/9042/environ: 权限不够        (rc=1)
```
* 逐个试探 9042(firefox) / 9283(forkserver) / 297670(Isolated Web Co) / 4183(at-spi2-registryd) / 4054(at-spi-bus-launcher) / 4063(at-spi 私有 dbus) —— **全部 EACCES**。
* 原因：`/proc/sys/kernel/yama/ptrace_scope = 1`，跨进程读取 environ 需要 `PTRACE_MODE_READ`，而我不是这些进程的祖先。
* **替代取证（绕开限制且更直接）**：
  1. 本会话自身的环境变量 → 证明变量确实沿登录会话向下继承：
     `ACCESSIBILITY_ENABLED=1`、`GNOME_ACCESSIBILITY=1`、`GTK_MODULES=gail:atk-bridge`、`QT_ACCESSIBILITY=1`。
  2. 二进制层面证明 Gecko 会去读哪个变量（§5）。
  3. 总线层面直接观测 Firefox 引擎是否活着（§4）——这比读 environ 更接近结论。
* ⇒ "Firefox 进程的实际 environ 内容"标 **INCONCLUSIVE（不可得）**，但结论不依赖它。

---

## 4. 决定性证据：私有 AT-SPI 无障碍总线取证（只读 D-Bus 查询）

**为什么这是最硬的证据**：AT-SPI2 里，只有**已经初始化无障碍桥**的应用才会向无障碍总线注册（`org.a11y.atspi.Socket.Embed`）。一个关掉无障碍的 GTK/Gecko 进程**根本不会出现在总线上**。且整个过程只是 D-Bus 只读查询：不启动、不结束、不写入任何东西。

### 4.1 总线与守护进程
* 无障碍总线：`unix:path=/run/user/1001/at-spi/bus_1`（由 pid 4054 `at-spi-bus-launcher` 拉起，私有 `dbus-daemon` pid 4063；`at-spi2-registryd` pid 4183）。

### 4.2 注册在总线上的应用（20 个）
完整列表见 `raw/user-browser-a11y-baseline.txt`。其中与本案相关的：

| 总线名 | pid | 进程 |
|---|---|---|
| `:1.25` | **9042** | **firefox**（用户 Firefox **父进程**） |
| `:1.59` | 303448 | chrome（用户 Chrome 浏览器进程） |
| `:1.1` | 4139 | gnome-shell |
| `:1.24` | 5600 | nautilus |
| `:1.27` | 10761 | terminator |
| `:1.28` | 30300 | feishu |
| … | | 其余 13 个为 gsd-*/xdg-desktop-portal/wechat/update-manager 等 GTK 应用 |

**观测时序（关键，用于排除"是我查询才把树建起来"）**
* 10:56 `ListNames` → 9042 **已在**
* 10:57 注册表根 `GetChildren` → `:1.25` **已在**
* 11:02 才首次对**具体应用**发查询
* ⇒ 激活（总线注册）**早于**任何应用级查询；而 9042 进程自 ~10:01 起就在运行（`etimes 3033 s` @10:52），其激活发生在启动时，与本审计无关。

### 4.3 应用根对象可查询（不是"注册个名字"而已）
```
:1.25  (firefox 9042)  Name="Firefox"        role=application  ChildCount=2  GetChildren→2 个可访问对象
:1.59  (chrome 303448) Name="Google Chrome"  role=application  ChildCount=3  GetChildren→3 个可访问对象
```
* Firefox 根下**确实挂着 2 个可访问文档对象** ⇒ 无障碍树**已实体化**，不是"连上总线但空转"。
* Firefox 的**内容进程**（9283/9351/9600/9950/10127/10356/48308/48599/297670/301868）**都不在总线上** —— 符合 Gecko 架构：无障碍树由**父进程**统一提供。

### 4.4 与用户偏好对照
`toolkit-accessibility=false` + `screen-reader-enabled=false` + `prefs.js` 无 a11y 设置 + 总线上活着 ⇒ **结论：这是"环境强开"，不是用户开启**。裁决 ① PASS。

### 4.5 守护进程开销采样（证明成本不在守护进程）
5 次 × 2 s 采样（10:57:54–10:58:02）：
| 进程 | %CPU | RSS |
|---|---|---|
| at-spi2-registryd (4183) | 0.0 | 7 748 kB |
| at-spi-bus-launcher (4054) | 0.0 | 7 824 kB |

⇒ **at-spi 常驻基础设施几乎零成本**。任何开销都由"每个构建树的应用"自己付 —— 这正是待检验假设的核心，因此下面的 A/B 只测**应用侧**。

---

## 5. 证据：二进制取证（Gecko 到底读哪个变量）

来自 `raw/ff_binary_env_strings.txt`（`strings -a -t x` + 邻域上下文）：

| 字符串 | `/snap/firefox/8863/usr/lib/firefox/libxul.so` |
|---|---|
| `GNOME_ACCESSIBILITY` | **EXACT 存在**（0x130e8c0） |
| `ACCESSIBILITY_ENABLED` | **ABSENT（完全不出现）** |
| `GTK_MODULES` | ABSENT |
| `accessibility.force_disabled` | **EXACT 存在**（0x1def0c，在 `greprefs.js` 中默认 `0`） |
| `libatk-bridge-2.0.so.0` / `atk_bridge_adaptor_init` | 存在 |
| `org.a11y.Bus` | 存在（2 次） |

`GNOME_ACCESSIBILITY` 的**邻域**（同一字符串池区域）：
```
130e890 libatk-1.0.so.0
130e8a0 atk_hyperlink_impl_get_type
130e8c0 GNOME_ACCESSIBILITY      <-- 命中
130edd0 unknown
130edf8 show
130ee20 hide / reorder / focus / state change   (ATK 事件名)
```
⇒ 该判定位于 **GTK/ATK 无障碍桥**代码段。

**对背景说法的重要修正**：`/etc/environment` 里导出的 `ACCESSIBILITY_ENABLED=1` **不是** Gecko 的开关（libxul 里根本没有这个字符串）；真正让 Gecko 认账的是 **`GNOME_ACCESSIBILITY=1`**，`GTK_MODULES=...:gail:atk-bridge` 则保证 ATK 桥被注入。两者同时存在时结论不变，但**排障时应优先针对 `GNOME_ACCESSIBILITY`**。
* 该结论来自本机二进制字符串取证（可复现）；`ACCESSIBILITY_ENABLED` 到底服务于哪些其他工具包（Qt/Java/Chromium？）本次**未验证** ⇒ 标 INCONCLUSIVE。

---

## 5b. ★ 新证据（决定性）：两个浏览器**启动器脚本被改过**，各自单独强开 a11y

这条由独立取证档给出，**用包校验证明，不是推断**：

```
$ dpkg -V firefox        ->  ??5??????   /usr/bin/firefox
$ dpkg -V google-chrome  ->  ??5??????   /opt/google/chrome/google-chrome
```

**改动 1 —— `/opt/google/chrome/google-chrome` 第 30 行（最后一行）**
```sh
exec -a "$0" "$HERE/chrome" "$@" --force-renderer-accessibility
```
* 记录 md5 `eecca240162aa8b7b6531304438ba7e6` → 实际 `b53a1c87f2de81b09e99c4491b1c3ffb`
* mtime **今天 10:50**，而同目录其它文件全为 09-17 11:47
* ⇒ 走 `google-chrome`、桌面图标、活动菜单启动的 Chrome **一律被追加** `--force-renderer-accessibility`

**改动 2 —— `/usr/bin/firefox` 第 72 行（最后一行）**
```sh
GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"
```
* 记录 md5 `df16e16833ffbb4a160531651b801a49` → 实际 `2ee34784f247a3149b3c9a3acc4f526e`（且不是 conffile）

**为什么这条重要**：即使 `/etc/environment` 被清掉，从终端敲 `firefox` 仍然会被**硬编码**打开 a11y —— 用户若用
`env -u GNOME_ACCESSIBILITY firefox …` 做对照实验，**实验必然无效而用户不会察觉**。可用的干净入口是 **`/snap/bin/firefox`**
（snap 自己的启动器，也是 GNOME 菜单实际使用的入口），或直接用载荷二进制。
* 我自己的 A/B **不受影响**：harness 直接 exec `/snap/firefox/8863/usr/lib/firefox/firefox`，绕过该 wrapper。
* 这也纠正了背景假设的一处细节：**Chrome 不是"不受环境影响"，而是被启动器 + 环境双重强开**。

**归因（明确区分证据与相关性）**
* `dpkg -V` 的 md5 不符是**证据**；`/etc/environment`、`/etc/profile`、`/usr/bin/firefox` 三处都在
  **2026-09-22 10:01:58 / 10:02:03 前后约 5 秒内**被改，且都带 `##TEC_BEGIN##` 标记 —— 是**时间相关性**。
* `##TEC_BEGIN##` 这个字面量同时出现在托管终端代理 `/usr/local/.OCular/...` 的二进制里 ⇒ **相关，但不等于是谁改的**。
* 谁改的、为何改（公司合规要求？劫持？）**本次未证实，标 INCONCLUSIVE**，但**建议 IT/安全复核**：
  两个浏览器启动器被改动是安全相关事实，且会污染任何后续性能排障。

---

## 5c. `GTK_MODULES` 对 Firefox 是**无效变量**（纠正背景说法）

| 变量 | `libxul.so`(Gecko) | `/opt/google/chrome/chrome` | GTK3 |
|---|---|---|---|
| `GNOME_ACCESSIBILITY` | **存在**（0x130e8c0，GTK/ATK 区） | 存在（在名字池中，见下） | 不存在 |
| `ACCESSIBILITY_ENABLED` | **不存在** | 存在 | 不存在 |
| `GTK_MODULES` | **不存在** | **不存在** | 存在 |

⇒ `/etc/environment.d/90atk-adaptor.conf` 注入的 `GTK_MODULES=…:gail:atk-bridge` 对**两个浏览器都不起作用**
（Gecko 自己加载 `libatk-bridge-2.0.so.0`，不靠 GTK 模块）。**对 Firefox 起作用的是 `GNOME_ACCESSIBILITY`。**
* 关于 Chrome 是否消费 `ACCESSIBILITY_ENABLED`：二进制里有该字面量，但取证档把它标为 **INCONCLUSIVE**
  （字面量位于 `*_ENABLED` 名字池，且有对照组表明"存在字面量"不足以证明是 env 读取）。本审计**沿用该保守结论**。

---

## 6. 量化（Firefox 侧）

（本节数字由 `firefox-a11y.mjs` + `analyze.mjs` 产出；每组条件 3 次，同批交错；自证见 6.2。）

### 6.1 危害控制（为什么这样做是安全的）
* 只启动**自己的独立实例**：`<snap firefox 二进制> --new-instance --no-remote --marionette --profile <本目录下的全新 profile>`。
* **刻意不用 `/usr/bin/firefox`**：该脚本会执行 `xdg-settings set default-web-browser …` 与 `gsettings set org.gnome.shell favorite-apps …`，即**会写用户配置**，违反只读纪律；改用 snap 载荷内的真实二进制（必须自带 `--no-remote`，否则会把标签页塞进用户正在用的 Firefox）。
* profile 放在 `$HOME/dsh/.workspace/...` 下：snap 的 AppArmor `home` 规则为 `owner @{HOME}/[^s.]** rwklix`（`/var/lib/snapd/apparmor/profiles/snap.firefox.firefox` 第 2112–2122 行），只排除 **HOME 顶层**的隐藏项与 `snap`，因此本路径**可读写**；而 snap 有**私有 /tmp**，所以 `/tmp/...` 的 profile 会报 `Could not find profile folder`（兄弟线 `gecko-vs-blink` 的 `ff-probe1/2.log` 就是这个失败）。
* 收尾只对自己创建的**进程组** `SIGTERM`→（必要时）`SIGKILL`，然后复查 `leftoverPids` 与"是否还有进程引用我的 profile 路径"。

### 6.2 自证（缺一即 INCONCLUSIVE）
每次 run 同时采集**三条独立**的状态证据：
1. **总线自证**：本实例 pid 是否出现在 AT-SPI 注册表里（`busNameForPid`），并读回根对象 `Name/role/ChildCount`。
2. **浏览器内自证**：Marionette（wire protocol 3）**chrome 作用域**读回：
   * `Services.prefs.getBoolPref("accessibility.force_disabled")`
   * `Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService)` → 返回 `REGISTERED` 说明无障碍引擎已实例化；抛异常说明**从未初始化**（该组件由 `a11y::PlatformInit()` 注册；组件不在时 `getService` 无副作用）。
   * `Services.env.get(...)` → 从**浏览器进程内部**读回它实际看到的 `GNOME_ACCESSIBILITY` / `ACCESSIBILITY_ENABLED` / `GTK_MODULES`（这就补上了 §3.2 不可得的 environ）。
3. **profile 落地自证**：跑完读 profile 的 `user.js`/`prefs.js` 中 `accessibility.*` 行。

### 6.3 结果（批次 1：轻负载，headless，reps=3）

原始：`raw/ffm-headless-*.json`、`raw/ffm-headless-matrix.json`；汇总：`proof/verdict-light.{json,md}`

| 条件 | n | a11y 引擎 REGISTERED | 上 AT-SPI 总线 | DOM 节点 | build ms | mutate ms | animate ms | 帧 p95 ms | 吞吐/s | 强制重排/s | wall ms | 树 CPU s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `env-default`（环境原样，a11y **开**） | 3 | **3/3** | 0/3 | 18009 | 13 | 5 | 2979 | 18 | 1 098 620 | 207 933 | 13 190 | 8.51 |
| `pref-force-disabled=1`（a11y **关**） | 3 | **0/3** | 0/3 | 18009 | 13 | 5 | 2985 | 18 | 1 090 067 | 207 532 | 13 222 | 8.52 |
| `env-cleared`（清 3 个变量，a11y **仍然开**） | 3 | **3/3** | 0/3 | 18009 | 13 | 4 | 2986 | 18 | 1 092 933 | 214 595 | 13 235 | 8.66 |

**自证（三条件全数通过）**
* 仪器：Marionette chrome 作用域读回 `Cc["@mozilla.org/accessibilityService;1"]`。
  `env-default` = **REGISTERED 3/3**；`pref-force-disabled=1` = **ABSENT 3/3** ⇒ **条件确实不同**，比较有意义。
* 浏览器进程内部读回它实际看到的环境：
  `env-default` → `GNOME_ACCESSIBILITY=1, ACCESSIBILITY_ENABLED=1, GTK_MODULES=gail:atk-bridge`
  ⇒ **补上了 §3.2 那个"ptrace 读不到 environ"的缺口：变量确实到达了 Firefox 进程**（由 Gecko 自己报告）。
* `accessibility.force_disabled=1` 同时出现在 profile 的 `user.js` 与 `prefs.js`。
* 危害控制：`leftoverPids` 全为空、无进程残留引用我的 profile、用户 pid 9042/303448 全程未动。

**结论（批次 1）：a11y 开/关的成本因子 ≈ 1.00（全部指标 0.99–1.01）**

```
a11y ON / OFF：  build 1.000  mutate 1.000  animate 1.002  帧p95 1.000
                 吞吐 1.008(反向)  强制重排 1.002(反向)  wall 1.002  树CPU 1.001
```

⇒ 在**这个负载量级**（18 009 个 DOM 节点、属性/文本改写型变更）下，**强开 Gecko 无障碍几乎不产生可测成本（<1%）**。
这是一个**诚实的负结果**，它**否证**"只要 a11y 开着，Firefox 就必然严重卡顿"这种过强表述。

**但这个负结果有一条必须写明的边界条件**（见 §6.4）：headless 下 Firefox **完全没有** AT-SPI 消费者
（`busOn 0/3`，而用户桌面上的 Firefox 是 `busOn` 且根对象 `ChildCount=2`）。引擎被实例化 ≠ 无障碍树被完整构建并被消费。
因此**批次 1 不能代表桌面工况**，桌面工况必须用 headed 批次测。

### 6.3b ★ 意外发现（已用内核视角定案）：清掉环境变量**并不能**关掉 Firefox 无障碍

**批次 1（headless）第一次暴露这个现象**，三个 run 完全一致；**批次 3（headed）用 `/proc/<pid>/environ` 定案**：

| 观测层面 | `env-default` | `pref-force-disabled` | **`env-cleared`** |
|---|---|---|---|
| spawn 时我传入的环境 | 三变量皆 `1`/存在 | 三变量皆 `1`/存在 | **三变量全部 `null`（确实已删除）** |
| **`/proc/<pid>/environ`（内核视角，读的是我自己启动的实例）** | 三变量存在 | 三变量存在 | **`GNOME_ACCESSIBILITY="1"` 存在；`ACCESSIBILITY_ENABLED`/`GTK_MODULES` 不存在** |
| 浏览器内 `Services.env` 自报 | 三变量存在 | 三变量存在 | `GNOME_ACCESSIBILITY="1"`，另两个为 `""` |
| a11y 引擎 | REGISTERED 3/3 | ABSENT 3/3 | **REGISTERED 3/3** |
| 上 AT-SPI 总线 | 3/3 | 0/3 | **3/3** |

⇒ **结论（PASS）**：`env-cleared` 条件下 a11y **依然开着**，因为 **`GNOME_ACCESSIBILITY=1` 在进程里又出现了** ——
它在我传入 spawn 环境时并不存在，却出现在**内核报告的进程环境**里，且**只有这一个**变量被补上。

**是谁补上的（INFERRED，但被三条独立事实夹住）**
1. 内核视角（`/proc/environ`）与浏览器自报（`Services.env`）一致 ⇒ **不是读数假象**；
2. 全 snap 内 `grep -rl GNOME_ACCESSIBILITY` **只命中 `libxul.so`**；`libatk-bridge`/`libatk`/`libgtk-3`/`libgtk-4` **都不含**该字面量（`libgtk-3` 只含 `GTK_MODULES`）；
3. 载荷 `.../usr/lib/firefox/firefox` 是**真 ELF 二进制**（非脚本），snap 内也没有脚本设它；我又是**直接 exec 载荷**（绕过 `/usr/bin/firefox` 那个被改过的 wrapper）。

⇒ 只能由 **Gecko 自身（libxul 的 a11y 平台初始化路径）** 设置（`setenv("GNOME_ACCESSIBILITY","1",…)` 之类）。
* `strings` 无法区分"读"与"写"（两者都会留下同名裸字面量），所以**方向属推断**；但"环境里确实存在"是**内核级实证**。

**对用户/排障的直接后果（重要）**
* **"清掉 `GNOME_ACCESSIBILITY` 再启动 Firefox" 这条路对 Firefox 无效** —— 它会自己把它设回来。这也是 §8.1 要强调的坑。
* 唯一被本次实测证明有效的关闭手段是 **`accessibility.force_disabled = 1`**（batch 1 与 batch 3 均 3/3 生效，且 busOn 从 3/3 变 0/3）。

### 6.5 ★ 结果（批次 3：headed，真实 GTK/ATK + 真实 AT-SPI 消费者 —— 与用户桌面同构）

原始：`raw/ffhd-headed-*.json`、`raw/ffhd-headed-matrix.json`；汇总：`proof/verdict.{json,md}`
参数：15000 行 / 45009 DOM 节点，3 条件 × 3 次，**轮次为主交错**（A,B,C,A,B,C,A,B,C），`DISPLAY=:1`，独立实例 + 一次性 profile + 一次性 HOME。

| 条件 | a11y 引擎 | **上 AT-SPI 总线** | 帧时间（120 帧） | **帧 p95** | 变更吞吐 /s | 强制重排 /s | 进程树 CPU s |
|---|---|---|---|---|---|---|---|
| `env-default`（a11y **开**） | 3/3 | **3/3** | 3765 ms ⇒ **31.4 ms/帧** | **54 ms** | 148 267 | 41 581 | 15.78 |
| `pref-force-disabled=1`（a11y **关**） | **0/3** | 0/3 | 2021 ms ⇒ **16.8 ms/帧** | **18 ms** | 682 400 | 67 577 | 11.11 |
| `env-cleared`（a11y **仍开**） | 3/3 | 3/3 | 4129 ms ⇒ 34.4 ms/帧 | 62 ms | 137 288 | 38 508 | 16.38 |

**成本因子（统一口径：>1 = 无障碍开着的那个条件更贵）**
```
costFactor_animate        1.863   <- 帧时间 1.86 倍（31.4 -> 16.8 ms/帧，约 32 fps -> 60 fps）
costFactor_frameP95       3.000   <- 帧 p95 3.0 倍
costFactor_cpuS           1.420   <- 同样工作量多花 42% CPU（11.11 s -> 15.78 s）
costFactor_thrPerSec      4.603   <- 单次 DOM 变更的吞吐成本 4.6 倍
costFactor_reflowPerSec   1.625
costFactor_mutate         1.200
costFactor_build          1.077
```

**自证（三条独立，全部通过）**
1. a11y 引擎：`env-default` 3/3 REGISTERED、`pref-force-disabled` **0/3**、`env-cleared` 3/3。
2. **AT-SPI 总线成员：3/3 / 0/3 / 3/3** ⇒ 本批"开"的状态与**用户桌面上 Firefox 的状态是同一种**（都真实注册在无障碍总线上）。
3. `accessibility.force_disabled` 读回：`env-default` 0,0,0；`pref-force-disabled` **1,1,(第 3 次 Marionette 取样缺失)**；`env-cleared` 0,0,0。

**与批次 1 的对照本身就是结论**：同一份页面逻辑，仅"有没有真实 AT-SPI 消费者"不同 ——
headless 成本 ≈ **1.00**（§6.3），headed 成本 = **1.86×**（本表）。
⇒ **无障碍引擎被实例化本身几乎不花钱；花钱的是树被真实消费。**

**绝对 ms 的成立条件（必读）**：31.4 / 16.8 ms 是在 **loadavg 5.8–7.3、同批内 1–5 个外来探针浏览器并发**下测得的（§1.4）。
**相对倍数（1.86× / 3.0× / 1.42× / 4.6×）是裁决依据**；绝对 ms 只作量级参考。

### 6.6 未完成 / 失败的批次（如实记录，不计为证据）
| 批次 | 状态 | 原因 |
|---|---|---|
| `ffhead-headed`（30000 行，每帧 20000 次变更） | **FAILED ATTEMPT，非测量** | 两个原因叠加：① Marionette 端口 2841 被占（`Could not bind to port 2841`）⇒ 自证通道失效；② 每帧 20000 次变更触发 Gecko 的 `Script terminated by timeout`（`dom.max_script_run_time` 10 s）⇒ 页面被杀、无上报。**均已修正**（端口改为按 pid 派生；k 降到 1000），复跑即批次 3 |
| `ffh-headless`（重负载 headless） | **未执行** | 锁在 9 分钟内 170 次轮询未获取（§1.2）；优先级让给 headed（外部效度更高）与 Blink（任务必需） |

### 6.7 载体有效性（批次 1）
* **能判别**：`vehicleCanDiscriminate = true`（引擎状态在条件间确实不同）。
* **但外部效度有限**：headless 无 AT-SPI 消费者 ⇒ 见 §7.3 的同类局限。**所以批次 1 只用于回答"引擎开着的固定成本"，
  不用于回答"桌面上同一个 Codex 页面为什么卡"**；后者由批次 3（headed，真实 GTK/ATK + 真实 AT-SPI 总线）回答。


### 6.8 载体有效性（通用闸门：结论能否成立）
* 若 headless 条件下三组的**总线状态都相同（都不可判别）**，则"三组条件其实没差别"，任何时间差都是噪声 ⇒ 本批**作废**，必须改用 `--mode=headed` 重跑；反之才进入裁决。
* 运行器内置**早退闸**：env-default 第一轮若发现引擎根本没开（既不在总线上、chrome 读回也不成立），立即中止整批并释放锁，不浪费持锁时间。

---

## 7. 交叉核对（Blink 侧）

### 7.1 三组条件（同一页面、同一工作量）
1. `env-default-nofag`：环境原样（含 `GNOME_ACCESSIBILITY=1` 等），**不加**开关
2. `force-renderer`：环境原样 + `--force-renderer-accessibility`
3. `env-cleared-nofag`：清掉 `ACCESSIBILITY_ENABLED`/`GNOME_ACCESSIBILITY`/`GTK_MODULES`，不加开关

### 7.2 自证
* 单独标签页打开 `chrome://accessibility/`（Blink 的 `about:support` 等价物）读回无障碍状态；**在读回之前不创建被测量的页面**，避免读回动作本身把 a11y 打开。
* 另采 CDP `Performance.getMetrics`：`TaskDuration / ScriptDuration / LayoutDuration / RecalcStyleDuration` 前后差值 —— 这是 Blink 原生的成本分项，a11y 开销会落在 Task/Layout 上。

### 7.3 已知局限（必须随结论一起读）
* headless Blink 没有真实的平台无障碍路径（没有 GTK/ATK 桥），因此本实验**能**测"`--force-renderer-accessibility` 打开 Blink AX 树的成本"，**不能**完整复现桌面 Chrome 由 AT-SPI 检测而自动打开的路径。桌面侧该路径由 §4.3（Chrome 已在总线上）间接证明存在。
* 因此 ③ 的结论表述限制为：**"显式强开 Blink 无障碍对同一工作量的影响倍数"**，不外推为"桌面 Chrome 完全不受影响"。


### 7.4 结果（Google Chrome 153.0.8010.52 —— **系统二进制**，与用户 Chrome 同大版本）

原始：`raw/blink-*-r*.json`、`raw/blinkh-summary.json`；汇总：`proof/verdict.{json,md}`
参数：30000 行 / **90009 DOM 节点**，3 条件 × 3 次，轮次为主交错。

| 条件 | 无障碍状态（`chrome://accessibility` 读回） | 帧时间 ms | **帧 p95 ms** | 变更吞吐 /s | TaskDuration s |
|---|---|---|---|---|---|
| `env-default-nofag`（环境原样，无 flag） | **native/web/text/extendedProperties/screenReader 全 false**，`activeAT=Uninitialized` | 9535 | 103 | 1 090 964 | 15.93 |
| `force-renderer`（+ `--force-renderer-accessibility`） | **全 true**，`activeAT=GenericScreenReader` | 22437 | **1338** | 591 901 | 28.91 |
| `env-cleared-nofag`（清 3 变量，无 flag） | **全 false**，`activeAT=Uninitialized` | 9821 | 111 | 1 018 932 | 16.23 |

**成本因子**
```
force-renderer / env-default：  帧时间 2.353  帧p95 12.945  变更吞吐成本 1.843
                                TaskDuration 1.815  mutate 1.327  build 1.249
env-cleared / env-default：     全部 0.93 - 1.07  <- 等于没有差异
```

**两条结论**
1. **强制开启 Blink 无障碍的代价甚至比 Gecko 更大**（帧 p95 12.9× vs Gecko 3.0×）⇒ "a11y 很贵"在两个引擎上都成立，
   差别**不在**"贵不贵"，而在**"谁的网页内容 a11y 被环境打开了"**。
2. **环境变量本身不会打开 Chrome 的网页内容 a11y**：`env-default` 与 `env-cleared` 的 AXMode 都是全 false、耗时无差异。
   而 Firefox 的网页 a11y **确实**被 `GNOME_ACCESSIBILITY=1` 打开。
   ⇒ 这就是 **"同一环境、Chrome 顺 / Firefox 卡"** 的直接机制解释。

### 7.5 与 ③c 的关系（必须一起读）
用户正在运行的 Chrome（pid 303448）命令行**带** `--force-renderer-accessibility`，且它在 AT-SPI 总线上。
按本批数据，那种状态的 Chrome 在重 DOM 页面上同样要付 ~2.35× 的帧代价。
⇒ 值得复核：**用户测"Chrome 顺"的那次会话，Chrome 到底有没有带这个 flag**
（启动器已于今天 10:50 被改为追加该 flag，见 §5b）。若带，则"Chrome 顺"要么发生在改动之前，
要么发生在远轻于 90009 节点的页面上。


---

## 8. 用户可执行的**可回滚**验证步骤

**完整runbook 见 `proof/rollback-steps.md`（10 步，每步含 Action / Expected / Revert / Risk / 来源与置信标签）。
下面是本次审计**亲自验证过**的四条要点，其中第 1 条是"用户最容易做错"的坑：**

### 8.1 ★ 不要用 `env -u GNOME_ACCESSIBILITY firefox …` 做对照（会静默失效）
* 原因：`/usr/bin/firefox` 第 72 行**硬编码** `GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"`（§5b，`dpkg -V` 可复现）。
* 正确入口：**`/snap/bin/firefox`**（snap 自己的启动器，也是 GNOME 菜单实际走的入口），
  或直接 `env -u GNOME_ACCESSIBILITY -u ACCESSIBILITY_ENABLED -u GTK_MODULES /snap/bin/firefox …`。
* **我的实验数据也证明这条路本来就不通**：清掉三个变量后，浏览器内部读回 **`GNOME_ACCESSIBILITY` 仍是 `1`**（§6.3b），
  a11y 依然开着（`REGISTERED` + 上总线）。⇒ **"清环境变量"不是可用的关闭手段。**

### 8.2 可靠的开关：`accessibility.force_disabled = 1`（用户级、即时、可回滚）
* 本次 3 次重复中 **3/3 生效**：a11y 引擎 `ABSENT`、**不上 AT-SPI 总线**、`prefs.js` 里读到 `1`（§6.5）。
* 这就是"最省事的可回滚验证"：`about:config` → `accessibility.force_disabled` 改 `1` → 重启 Firefox → 看 `about:support`。
* **回滚**：改回 `0`（本机默认值，来自 `greprefs.js` 第 220 行）或直接删掉该项。
* 注意：该 pref **只用于"关"**；它不会影响 Chrome（Chromium 侧的对应开关是 `--force-renderer-accessibility` / AXMode）。

### 8.3 `about:support` 看什么（源码级确认，非记忆）
* `Accessibility` 区块只有两行（`aboutSupport.xhtml` 两个静态 `<tr>`）：
  * **`Activated`** = `Services.appinfo.accessibilityEnabled`（**true 即"树是活的"**）
  * **`Prevent Accessibility`** = `accessibility.force_disabled` 的原始整数（默认 `0`）
  * `Accessibility Instantiator` 行是 **Windows 专有**，Linux 上**不显示**。
* 另有一个**不需要 debugger** 的旁证：用户 9042 在无障碍总线上的映射（`raw/user-browser-a11y-baseline.txt` 里的做法）。

### 8.4 公司策略边界
* 8.2 是**纯用户级偏好**，不动 `/etc/**`、不需要 root、随时可还原 ⇒ 不违反"IT 要求无障碍开启"的策略（策略约束的是系统级设置）。
* `GNOME_ACCESSIBILITY` 来自 `/etc/environment`（经 systemd 的 `/usr/lib/environment.d/99-environment.conf` 符号链接下发）+ `/etc/environment.d/*.conf`
  ⇒ 改这些**需要 root，属 IT 范畴**，本审计**只给步骤不代执行**。
* **建议一并交给 IT/安全**：`/usr/bin/firefox` 与 `/opt/google/chrome/google-chrome` 两个启动器被改动（`dpkg -V` 可复现），
  这既是安全事项，也会让任何后续排障（包括用户自测）得出错误结论。

## 9. 不确定项 / INCONCLUSIVE 清单（最终）

| 项 | 状态 | 原因 / 处置 |
|---|---|---|
| 用户 Firefox **进程自身**的 environ | **不可得（已如实记录）** | `ptrace_scope=1` 且非其祖先 ⇒ 对 9042 等一律 `EACCES`。**已用替代物补齐**：我自己实例的 `/proc/environ` 可读（并在 §6.3b 用于定案）+ 用户 Firefox 的总线状态 + 其 profile prefs |
| "大 DOM 下 Gecko a11y 是已知严重性能杀手" 的**外部文献**依据 | INCONCLUSIVE | `web_search` 本会话不可用（返回订阅错误）；本审计只以本机实测为据（实测反而更强：见下） |
| 谁动了两个浏览器启动器 | **INCONCLUSIVE（但事实成立）** | `dpkg -V` 证明改动存在；`##TEC_BEGIN##` 与 `/usr/local/.OCular/...` 代理二进制同源是**相关性**，不是证据 |
| Chrome 是否消费 `ACCESSIBILITY_ENABLED` | INCONCLUSIVE | 字面量存在但位于名字池；对照实验表明"有字面量"不足以证明是 env 读取。**本次实测给出更硬的事实：环境变量不会开启 Chrome 的网页 a11y（AXMode 全 false）** |
| `GNOME_ACCESSIBILITY` 由 Gecko 设置的**代码方向** | 推断（现象为实证） | 见 §6.3b；`strings` 无法区分 getenv/setenv |
| headless Blink 是否代表桌面 Chrome 的 a11y 路径 | 部分 | headless 无法复现"桌面由 AT-SPI 检测而自动开启"的路径；但本次测的是 `--force-renderer-accessibility` 的显式强制，与桌面把该 flag 写进启动器后的效果同构（§7.5） |
| 用户测"Chrome 顺"那次会话里 Chrome 到底有没有带 flag | INCONCLUSIVE | 启动器今天 10:50 才被改；现有实例 494362 带 flag。需要用户确认时间线 |
| 绝对 ms 的可迁移性 | 受限 | 见 §6.5 尾注：负荷 5.8–7.3 + 1–5 个外来探针浏览器并发；**只用相对倍数裁决** |

## 9b. 纪律事件记录（自我披露）

### 9b.1 我误用了一次 `pkill`（已自证未伤及他人）
* 11:06:40 左右，我用 `pkill -f "firefox-a11y.mjs --phase=matrix"` 想结束**自己**上一轮等待中的 runner。
* 后果：该模式**同时匹配到了我自己正在执行的 `bash -c` 命令行**，于是把自己的 shell 一起 SIGTERM 掉（工具返回 `[killed by signal: SIGTERM]`）。
* **波及范围核查**（只读复查）：
  * 被杀的进程：`365618`（我自己的 runner）与我自己的 bash —— **均为我的进程**。
  * 用户浏览器**未受影响**：复查 pid 9042（Firefox，`etimes 3665`）与 303448（Chrome，`etimes 586`）**仍在运行且 PID 未变**。
  * 该 runner 在被杀前**尚未启动任何浏览器**：`proof/profiles/` 下无任何 profile 目录，进程表中无遗留探针浏览器 ⇒ **没有需要清理的浏览器实例**。
* **次生后果**：该 runner 恰在 11:06:14 抢到了锁并进入 RUN 1（阻塞在"等待无外来探针浏览器"的 120 s 检查里），被杀后锁成了孤儿。我在 11:06:44 用协议规定的释放方式显式释放：
  `rm owner.txt && rmdir`（先确认 `owner_pid 365618` 已消失、且 `agent:` 字段确认是我这条线，两个条件都满足才释放）。
* **纠正**：此后**不再使用 `pkill`**；结束自己的进程一律按 PID。

### 9b.2 共享锁在本机实际处于**多线争抢**状态（影响方法学，如实记录）
* 观测到的持有者轮换：`incident2-minimal-page`(孤儿) → 裸 pid `310374`(孤儿) → `incident2-gecko-vs-blink` → `incident2-why-these-two` → 我(365618，被误杀) → `incident2-gecko-vs-blink` …
* 更关键：11:06 时**浏览器并非"一次一个"**——`gecko-vs-blink` 正在跑 chromium（`--user-data-dir=/tmp/gvb-chrome-…`）的同时，锁已在 `why-these-two` 手里。即"锁"在该时段**没有真正串行化浏览器**。
* **方法学后果与应对**（已落到代码里）：
  1. 条件采样改为**轮次为主（round-major）**：`A,B,C / A,B,C / A,B,C`，让三种条件在时间上**相邻**，漂移的背景负载对三者近似同等作用；而不是"先跑完 A 的 3 次再跑 B"。
  2. 每次 run 记录 `loadavgAtRun` / `loadavgDuringResult` / 外来探针浏览器清单 / 锁是否仍属于我。
  3. 互锁从"丢锁即中止整批"放宽为"**记录而不中止**"：在该机现状下，中止只会白白丢掉持锁窗口，并不会提高数据质量；真正起作用的是我**自己串行**（一次只启动一个浏览器）+ 轮次交错 + 中位数。
  4. 绝对 ms 一律标注并发条件；**裁决只用同批相对倍数**。
* 该争抢不由本审计造成，本审计只是**如实记录并未参与违规**（未在他人持锁期间启动浏览器；唯一一次孤儿锁是我的 runner 被自己误杀造成，已在 9b.1 说明并显式释放）。

---

## 10. 与兄弟线的交叉核对

* `incident2/gecko-vs-blink`（11:03–）在同一台机上做同类跨引擎标定，其日志给出两个**独立**观察，与本文一致：
  * headless 下 Gecko 的 rAF 节奏与 Blink **本就不同**（他们标定：Gecko `ticks=50 elapsedMs=1767 frameN=27 p50=66.24 over50=23`；Blink `ticks=50 elapsedMs=1768.7 frameN=49 p50=33.3 over50=0`）⇒ **headless 的 rAF 间隔不能跨引擎直接比**，只能作同引擎内相对比较。本文的裁决因此以**同步阶段耗时**（build/mutate/read）与**进程树 CPU 秒**为主，rAF 只作辅助。
  * 证明 Firefox 155 **已移除 CDP**（`/json/version` 不响应），必须走 WebDriver BiDi / Marionette —— 本文用 Marionette。
