# 系统级争用取证报告（只读）— incident2 / sys-stalls

- **范围**：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/sys-stalls/`
- **问题**：用户在两处（DSH 设置页、Codex 悬停托盘+跟随鼠标动效）均感到卡顿，需判定是否存在**系统级争用**
- **纪律**：全程只读；未 pkill；未启动浏览器；未改动产品；未传 `sandbox_permissions`
- **采样窗口**：2026-09-22 10:28:44 → 10:35:40（机器 10:01:55 重启，uptime 26→34 min）
- **硬件**：AMD Ryzen 9 9950X（16C/32T）、63 GB RAM、8 GB swap（未用）、NVMe、amdgpu + NVIDIA（Xorg 用 AMDGPU）
- **取证者身份披露**：本档是**二级 subagent**，本身是"调查负载"的一部分。**我没有派发任何二级 subagent**——派发会向被测量的系统额外注入 CPU 负载，污染读数。所有命令串行/少量并行执行。

---

## 0. 一句话结论

> **判定：PASS —— 不存在足以造成界面卡顿的系统级争用。**
>
> 机器在**每一次**采样中都是 **89–93% 空闲**，CPU PSI 全零且 `full total = 0 µs`（整个 33 分钟启动期从未出现过"所有可运行任务一起被 CPU 卡住"），IO PSI ≈ 0.6%，内存 PSI ≈ 0，swap 零使用，无 cgroup 限流（`nr_throttled = 0`），无降频（32 核全在 5.2–5.66 GHz / 上限 5.756 GHz），无热节流，无 OOM/AER/MCE/hung task。
>
> **"我的调查负载是主因"不成立**——按进程计，所有子代理进程累计只消耗 **10.4 CPU 秒 = 全部已消耗 CPU 的 0.3%**。
> 但**调查确实注入了真实、可避免、可复现的干扰**（第 5 节逐条列出），其中**一个失控 bash 独占 1 核约 1 分钟**、**display-input 线以 10–20 秒周期反复触发显示器 EDID/RandR 重探**——这两项在机制上足以在"本就偏慢的 UI"之上叠加抖动。
>
> 最大的单一 CPU 消费者既不是系统守护进程、也不是子代理，而是 **DSH 宿主自身**（`node dsh web`，累计 1515.5 CPU 秒 = 46.1%，持续约 1.0–1.15 核）。
>
> 本报告只能**否证系统级争用**，不能指出用户卡顿的真正成因；证据方向指向**应用层/主线程**（见第 5.4 节）。

---

## 1. 逐条判定表

| # | 检查项 | 判定 | 关键证据 |
|---|---|---|---|
| 1.1 | 整机 CPU 利用率是否饱和 | **PASS** | 7 种独立口径一致：整机忙 5.2–11.5%，空闲 86–93% |
| 1.2 | 是否存在单核被长期打满 | **FAIL（轻微）** | 确实存在：失控 bash 81808 打满 1 核 ~53 s+；宿主 node 持续 ~1.0–1.15 核。但 32 核上有大量空闲核 |
| 1.3 | 三类占比可区分 | **PASS** | 见 §2 表格（瞬时 + 累计双口径） |
| 1.4 | 我（子代理）造成的负载可标注 | **PASS** | 进程级 0.3% 累计；另有 2 项自伤（§5.2） |
| 2.1 | 周期性作业是否在窗口内触发 | **PASS** | 触发过（anacron 10:06:57、snapd 10:07:07），但 CPU 均为 **9–37 ms** 量级 |
| 2.2 | 突发性作业是否有重量级 | **INCONCLUSIVE** | `zstd -19 -c` @ ~10:25（同侪观测）无法复核，见 §3.6 |
| 2.3 | 索引/同步类进程 | **PASS** | 仅 tracker（累计 14.4 s）；baloo/dropbox/onedrive/坚果云/syncthing 均未运行 |
| 2.4 | 内核回收线程 | **PASS** | kswapd0 / kcompactd0 / jbd2 全部 **0.0% CPU** |
| 3.1 | AER / NMI / MCE / 硬件错误 | **PASS** | 整个启动期无一条（命中的全是启动期良性字符串，§4.1） |
| 3.2 | thermal / 热节流 | **PASS** | 无热事件；Tctl 64°C；thermald 因"不支持的 CPU 型号"退出，但也无热问题 |
| 3.3 | 降频 / 节流 | **PASS** | governor=performance，amd_pstate=active，32 核 5.2–5.66 GHz 贴上限 |
| 3.4 | IO error / hung task / soft lockup / RCU stall | **PASS** | 整个启动期无一条 |
| 3.5 | OOM | **PASS** | 无 OOM；可用内存 45–47 GB；swap 零使用 |
| 3.6 | workqueue 内核停顿 | **FAIL（轻微）** | `pm_runtime_work hogged CPU >10000us`，10:12/10:17/10:27/10:31 复现（4→11 次递增） |
| 3.7 | vmstat io wait / 上下文切换 | **PASS（wa）/ 注意（cs）** | wa 0.09–0.43%；但 cs 45k–72k/s，期间峰值 **142k/s** |
| 4.1 | PSI CPU —— 系统级争用硬指标 | **PASS** | `some`/`full` 全 0.00；**`full total = 0 µs`（启动至今）** |
| 4.2 | PSI IO | **PASS** | some total 12.9 s / full 12.2 s ÷ ~2000 s ≈ 0.6%；avg10 ≤0.06 |
| 4.3 | PSI Memory | **PASS** | `total = 4 µs`（约等于零） |
| 4.4 | cgroup CPU 限流（易漏的隐藏争用） | **PASS** | 全树 `nr_periods 0 / nr_throttled 0 / throttled_usec 0`，无 `cpu.max` 配额 |
| 4.5 | cgroup CPU PSI（宿主自身） | **PASS** | `avg10/60/300 = 0.00`；full total 仅 0.47 s / 34 min |
| 4.6 | swap / major fault | **PASS** | pswpin/pswpout = 0；pgmajfault 61201（低）。**注意**：宿主自身 majflt=16871（§4.5） |
| 4.7 | 磁盘饱和度 | **PASS** | nvme %util 3.7–8.63%，aqu-sz 0.12–0.49，await <2 ms |
| 5 | **是否存在足以致卡顿的系统级争用** | **PASS（否）** | 见 §5 |

---

## 2. CPU 争用全景

### 2.1 整机口径（7 种独立方法，结论一致）

| 方法 | 窗口 | 忙 / 空闲 | iowait |
|---|---|---|---|
| `/proc/stat` 差分 | 10 s | 3670/31837 = **11.5% 忙 / 88.5% 闲** | 0.18% |
| `mpstat 1 5`（#1） | 5 s | 13.0% 忙 / **86.96% 闲** | 0.22% |
| `mpstat 1 5`（#2） | 5 s | 10.2% 忙 / **89.79% 闲** | 0.17% |
| `sar`（10 分钟桶 10:10–10:20） | 10 min | 9.3% 忙 / **90.70% 闲** | 0.43% |
| `sar`（10 分钟桶 10:20–10:30） | 10 min | 9.7% 忙 / **90.30% 闲** | 0.23% |
| `iostat` avg-cpu（3 帧） | 3 s | 7.4/8.9/7.2% 忙 | 0.29/0.09/0.09% |
| `cat_cpu.py`（自写，见 §2.2） | 20 s | **6.84% 忙（2.19/32 核）** | — |
| `cum_cpu.py` 累计 | 33 min | 3285.6 CPU-s ÷ 63360 核秒 = **5.19%** | — |

**loadavg 的解读（重要）**：`loadavg` 从 4.69 升到 6.96（10:33），峰值 7.19。但 32 核上 7.19 = **22%**，且对照 `/proc/loadavg` 的 `R` 字段只有 3–5 个可运行任务，其余来自 **D 态（不可中断睡眠）**任务（实测 D=2→5）。因此 loadavg 上升**不是 CPU 排队**，而是少量进程卡在驱动 IO 上（§4.4）。**不能把 loadavg 数值直接当作 CPU 争用证据。**

### 2.2 三类占比（用户要求的三分类）

`cat_cpu.py`：读 `/proc/<pid>/stat` 两次取 `utime+stime` 差分，按 ppid 链回溯 + cmdline 标记分类。20 s 窗口。

| 类别 | 核数 | 占整机 | 占全部忙 CPU |
|---|---|---|---|
| **DSH 宿主**（`node dsh web`，单进程 pid 10806） | 1.152 | 3.60% | **52.7%** |
| **用户进程**（Firefox 全家 + gnome-shell + Xorg + 微信 + 飞书） | 0.845 | 2.64% | **38.6%** |
| **系统守护进程**（内核线程 + systemd + snapd + tracker…） | 0.070 | 0.22% | 3.2% |
| **第三方管理代理**（`/usr/local/.OCular`：LAgent/LSDHelper/LMonitorFileOP…） | 0.113 | 0.35% | 5.2% |
| **DSH 子代理 = 我的调查负载** | **0.008** | **0.02%** | **0.4%** |
| 合计 | 2.19 | 6.84% | 100% |

> **分类修正说明（口径必须交代清楚）**：脚本把 `Xorg`（0.0495 核）和飞书后端（0.005 核）误落进 SYSTEM（标记表里的路径 `"/usr/bin/Xorg"` 与实际 cmdline `"/usr/lib/xorg/Xorg"` 不匹配），上表**已手动归入"用户进程"**，故 SYSTEM 由 0.124 修正为 0.070 核。第三方代理单列，便于用户区分"不是我的应用、也不是 DSH"。
>
> **两张表的口径差异（已知不一致，特此声明）**：§2.3 的累计脚本其"用户进程"标记表**额外包含 `update-manager` 与 Xorg**，而 §2.2 的 20 s 脚本未包含 `update-manager`（它落进了 SYSTEM 的杂项桶）。因此 §2.2 的 USER 0.845 核**不含** `update-manager`，§2.3 的 USER 1460.8 s **含** `update-manager`（110.2 s）与 Xorg（67.8 s）。两者对"系统守护进程总量很小（0.22% / 3.7%）"这一结论**不影响**（`update-manager` 约 5.5% 一核，无论归哪一类都不改变整机 5–7% 利用率与 PSI 全零的判定）。若需严格同口径，请以 §2.3 累计表为准（更长窗口、抗突发，且标记表已修正）。

### 2.3 累计口径（抗突发性，最能回答"谁在耗 CPU"）

`cum_cpu.py`：对当前进程表所有进程的 `utime+stime` 求和（自各自启动至今）。总计 **3285.6 CPU 秒 / 33 分钟**。

| 类别 | CPU 秒 | 占比 | 进程数 | RSS |
|---|---|---|---|---|
| **DSH 宿主** `node dsh web` | **1515.5** | **46.1%** | 1 | 4252 MB |
| **用户进程** | **1460.8** | **44.5%** | 47 | 9038 MB |
| 第三方管理代理（OCular） | 176.1 | 5.4% | 14 | 259 MB |
| 系统守护进程 | 122.8 | 3.7% | 570 | 4497 MB |
| **DSH 子代理（我的调查）** | **10.4** | **0.3%** | 59 | 2783 MB |

**关键推论**：宿主的 CPU 消耗是**子代理进程的 146 倍**（1515.5 vs 10.4 CPU 秒）。
原假设"宿主 node 进程 ~70% CPU 中包含我派出的多条调查线"——**就进程实体而言不成立**：子代理**进程**只占 0.3%。

**必须并存的诚实保留**：子代理的工作**有一部分在宿主进程内执行**（SSE 流解析、逐行 JSON、会话持久化与 zstd 压缩、工具派发、设置页/Web GUI）。这部分开销记在 pid 10806 账上，**从进程外部无法切分**。因此"归属调查"的区间是：
- **下界（进程级，硬事实）：0.3%**
- **上界（工作级，不可外部测量）：不确定，需在宿主内做 profiler 或打点才能定**

### 2.4 用户侧（Firefox 栈）明细 —— 卡顿抱怨的实际现场

| 进程 | 瞬时 | 累计 | RSS |
|---|---|---|---|
| `Isolated Web Co` (10350) — Firefox 内容进程 | **28.7–31.4%** | 460.6 s | 818 MB |
| `firefox` (9042) — 主进程（121 线程） | **25.0%** | 309.9 s | 1148 MB |
| `gnome-shell` (4139) — 合成器 | 5.9–7.0% | 197.9 s | 370 MB |
| `Xorg` (3884) | 4.95–5.8% | 67.8 s | 288 MB |
| `Isolated Web Co` (10133) | 7.05% | 149.4 s | 417 MB |
| `RDD Process` (9360) | 4.10% | 32.3 s | 204 MB |

**没有任何一项接近单线程饱和**：最高的内容进程 31% 一核，合成器仅 6%。这就是"系统无争用"与"用户仍感卡顿"并存的直接证据——**瓶颈不在 CPU 供给**。

### 2.5 值得单独点名的两个非典型消费者

- **`update-manager`（GNOME 自动更新器，pid 6458）累计 110.2 CPU 秒**，持续 33 分钟 ≈ 5.5% 一核常驻。它是"后台自动检查更新"的 GUI 应用，非用户主动操作，建议用户知晓。
- **OCular 第三方管理代理累计 176.1 秒（5.4%），超过全部系统守护进程（3.7%）**。其中 `LSDHelper` cgroup 显示 `system_usec 45.8 s / user_usec 22.2 s` —— **67% 时间在内核态**，典型的文件/系统调用密集型监控代理。这不是 DSH、也不是用户应用。

---

## 3. 周期性作业与突发性作业

### 3.1 systemd timers（窗口内实际触发者）

| 时间 | 单元 | 实际 CPU |
|---|---|---|
| **10:06:57** | `anacron.timer` → 触发 `cron.daily` | `anacron.service` **9 ms**；同秒内 "Job started / terminated / Normal exit"，**无重量级子作业** |
| 10:06:57 | `update-notifier-download.timer` | 37 ms |
| 10:16:54 | `systemd-tmpfiles-clean.timer` | 15 ms |
| 10:05:01 / 10:10:21 / 10:20:13 / 10:30:12 | `sysstat-collect.timer`（每 10 min） | "Deactivated successfully"，量级可忽略 |

**结论**：cron.daily（含 logrotate / man-db / dpkg / apt-compat / apport）+ anacron 在 **10:06:57 同秒内完成**，CPU 记账均为 **9–37 ms** 级。**不存在重量级周期作业。**

- `apt-daily.timer` 上次 9/21 08:19，下次 12:02；`apt-daily-upgrade` 下次 10:51 → 均**不在**窗口内。
- `logrotate.timer` / `dpkg-db-backup.timer` 上次 10:01:58（启动瞬间）；`logrotate.service` 24 ms。
- `/etc/logrotate.conf` = weekly + 默认 gzip；**`/etc/logrotate.d/` 全树 grep 无 `zstd`/`compresscmd`** → logrotate **不是** `zstd -19` 来源。
- `unattended-upgrades.service` 仅 `--wait-for-signal` 空转，CPU 29 ms，`/var/log/unattended-upgrades/` 空。
- 用户 crontab 无法读取（`crontabs/CNS2026495165/: fopen: 权限不够`）；`/etc/crontab` 与 `/etc/cron.d/*` 已完整读取，无异常。

### 3.2 snapd

- `snap changes`：**仅 1 条** —— 10:07「自动刷新 snap "firmware-updater"」。
- `snapd.service` 自启动累计 CPU **3.301 s**（33 分钟）→ 可忽略。
- `snapd.snap-repair.timer` = inactive dead；无活跃自动刷新 timer。
- 日志显示 10:07:24–25 卸载/重挂 `firmware-updater` 并 reload snap-confine profile（有挂载点改名动作），但 CPU 记账证明代价极小。

### 3.3 索引 / 同步类进程

- **运行中**：`tracker-miner-fs-3`（累计 14.4 s，瞬时 1.5%）、`tracker-extract-3`（0.75%，曾重启 etimes=412 s）。
- **未运行**（已逐一确认）：`baloo` / `dropbox` / `onedrive` / `syncthing` / `rclone` / `insync` / `nextcloud` / 坚果云 / `updatedb` / `locate`。
- `baidunetdisk` 于 9/11 安装过（apt history），**当前未运行**。

### 3.4 内核任务

- `kswapd0` / `kcompactd0` / `jbd2/nvme0n1p2-8` / `kblockd` 全部 **0.0% CPU** —— 无内存回收压力、无日志提交压力。
- 但存在**驱动层 kworker 的 D 态**（见 §3.5）。

### 3.5 D 态（不可中断睡眠）任务 —— 本轮唯一的"真实停顿"信号

实测 D=2→5，具体为：
```
713   D  [kworker/u129:17+events_unbound]
2085  D  [.Ocular]                      ← 第三方管理代理
32885 D  [kworker/u128:0+mt76]          ← MediaTek USB 无线网卡驱动
95505 D  [kworker/u128:2+phy0]          ← WiFi phy
440   D  [kworker/u129:5+events_unbound]
```
另有 amdgpu 的 `kworker/u128:*+gfx_0.0.0` / `+sdm` / `+vcn_dec_0` 周期性活动。
**mt76（USB WiFi）驱动的 kworker 反复进入 D 态**是这台机器上最"像系统级停顿"的现象，但它**每次只占几十毫秒**，且 `vmstat` 的 `b` 列在所有 10 帧中恒为 **0**。属于轻微、非致病。

### 3.6 `zstd -19 -c` 突发 —— **INCONCLUSIVE（未能复核）**

这是本报告唯一无法定论的项目，如实记录全部线索与反证：

**线索（来自同侪，非我实测）**：`.workspace/lag-fix/incident2/host-click/report.mjs:102` 记载：
> 「10:25 前后抓到 `zstd -19 -c` 以 100% CPU 运行，且其父进程是**宿主 10806 直接 spawn 的 bash**」

**我做的反证与排查**：
1. **我在 10:28–10:35 的 3 轮 `ps`/`top`/`pidstat` 采样中从未观察到任何 `zstd` 进程**；`ps -eo cmd | grep zstd` 返回 "NO zstd/xz/gzip/tar currently running"。→ 它是**秒级瞬态**。
2. **DSH 代码路径不含 `zstd -19`**：`@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js` 中 `REQUEST_COMPRESSION_ZSTD_LEVEL = 3`（**等级 3，不是 19**），且走 `node:zlib` 的 `zstdCompressSync` —— **进程内压缩，不会产生独立 `zstd` 进程**。
3. **会话持久化也是进程内**：`@deepseek-ai/dsh-session-persistence-jsonl` 直接 `import { zstdCompress, zstdDecompressSync } from "node:zlib"`，同样不 fork `zstd` CLI。
4. **logrotate 不是来源**（§3.1 已否定）。
5. **工作区内 `zstd` CLI 调用只有两处，且都是解压**：`settings-lag/scan_sessions.sh:11` 的 `zstdcat -q`、`settings-lag/census-subagent.mjs:32` 的 `zstd -dc`。**没有 `-19 -c`**。
6. `/usr/bin/zstd` 存在（v1.5.5），所以**任何 agent 的 bash 都能随手跑它**。

**判定：INCONCLUSIVE**，但可以给出**方向性结论**：
> 父进程是"宿主直接 spawn 的 bash" ⇒ 它属于 **DSH/agent 侧**（agent 工具调用正是这样执行的），**不是系统守护进程、不是用户自己的应用**。最可能是**某条调查线的 bash 在压缩文件**（`-c` = 输出到 stdout），属**调查负载**，且为**秒级瞬态**。

**为什么无法定论（工具限制，如实说明）**：
- `acct` 进程记账服务 **inactive** → 无 `lastcomm`，无法回溯已退出进程；`/var/log/account/` 不存在。
- `sar` 二进制历史 `sa22` **仅 10 分钟粒度**（10:10 / 10:20 / 10:30 三个桶）→ 秒级突发在统计上被平均掉，且实测 10:10–10:20 桶 iowait 仅 0.43%。
- 要复核只能等它再次复现时抓现行。

---

## 4. 内核、硬件与压力指标

### 4.1 内核告警（dmesg / journal）

- **`dmesg -T` 读取失败**：`读取内核缓冲区失败: 不允许的操作`（`kernel.dmesg_restrict=1` 且本档无 root，**禁止提权**）。→ 已改用 `journalctl -b`（journald 同含内核环缓冲）作为等价替代，覆盖整个启动期。
- **AER / NMI 错误 / MCE / 硬件错误 / thermal critical / OOM / hung task / soft lockup / RCU stall：整个启动期 0 命中。**
- `journalctl` 中被关键词命中的行经逐行核对**全部是良性启动期字符串**：
  - `ACPI: LAPIC_NMI (acpi_id[0xff] high edge ...)` → ACPI 表配置行
  - `NMI watchdog: Enabled. Permanently consumes one hw-PMU counter.` → 正常启用
  - `thermal_sys: Registered thermal governor '...'` ×5 → 注册调速器
  - `MCE: In-kernel MCE decoding enabled.` → 能力启用
  - `acpi PNP0A08:00: _OSC: OS now controls [... AER ...]` → AER 能力协商
  - `systemd-oomd.service` 启动行 → 只是 OOM killer 服务本身
- **唯一真实内核告警**：`workqueue: pm_runtime_work hogged CPU for >10000us N times, consider switching to WQ_UNBOUND`
  - 复现时刻与次数：**10:12:23 (4) → 10:17:24 (5) → 10:27:26 (7) → 10:31:03 (11)**
  - 每 5–10 分钟复现一次、计数单调递增；`pm_runtime` 指向**GPU 运行时电源管理**（amdgpu/NVIDIA + 多显示器）
  - 量级：单次 >10 ms 的 workqueue 独占，累计 11 次 → **轻微**，但机制上可在渲染路径制造微抖动，**建议保留为后续观察项**

### 4.2 频率与热（**无降频、无节流**）

| 项目 | 实测 |
|---|---|
| cpufreq 驱动 | `amd_pstate` = **active** |
| governor | 32/32 CPU 全部 **performance** |
| 当前频率 | **5.20–5.66 GHz**（cpu0 5652211 kHz，cpu17 5643559 kHz，cpu15 5283755 kHz…） |
| 上限 / 下限 | 5,756,000 kHz / 600,000 kHz |
| 温度 | k10temp **Tctl 64.1°C**；amdgpu edge 43°C；nvme Composite 43.9°C；mt7921 WiFi 60°C；r8169 NIC 41°C |
| thermald | `inactive (dead)` — 因 "Unsupported cpu model or platform" 退出 |
| 节流日志 | 0 命中 |

**全部核心贴近上限频率运行，温度正常，不存在任何降频/热节流。**
（`sensors` 未安装 → 改用 `/sys/class/hwmon/*`；`/sys/class/thermal` 为空，ACPI thermal zone 未暴露。）

### 4.3 PSI —— 判定"系统级争用"的硬指标

```
[cpu]    some avg10=0.00 avg60=0.00 avg300=0.00 total=3722801
         full avg10=0.00 avg60=0.00 avg300=0.00 total=0          ← 关键
[io]     some avg10=0.06 avg60=0.15 avg300=0.07 total=12924659
         full avg10=0.05 avg60=0.13 avg300=0.06 total=12211794
[memory] some avg10=0.00 avg60=0.00 avg300=0.00 total=4
         full avg10=0.00 avg60=0.00 avg300=0.00 total=4
```

- **CPU `full total = 0 µs`**：整个 33 分钟启动期，**从未出现过一次"所有非空闲任务同时被 CPU 阻塞"**。这是"无系统级 CPU 争用"的最强单条证据 —— 若存在会致卡顿的 CPU 争用，这个计数器不可能为 0。
- **Memory `total = 4 µs`** ≈ 零。
- **IO `some total 12.9 s`（占 ~2000 s 的 0.6%）**，且其 `avg60` 在 10:29 时为 0.01，到 10:34 升到 **0.15** —— **这段上升是我自己的取证扫描造成的**（对 561 MB 会话目录做 `grep -r` / `find` / `du`，以及一度超时 60 s 的全库 grep）。**如实计入我的负载贡献（§5.2）**。

### 4.4 cgroup 限流排查（容易漏掉的"隐藏争用"）

若宿主或桌面会话被 cgroup 的 `cpu.max` 限流，则"32 核空闲却仍卡"完全可能。**已逐层排查，全部为无限流**：

```
/sys/fs/cgroup/cpu.stat                   nr_periods 0  nr_throttled 0  throttled_usec 0
/sys/fs/cgroup/user.slice/cpu.stat        nr_periods 0  nr_throttled 0  throttled_usec 0
/sys/fs/cgroup/system.slice/cpu.stat      nr_periods 0  nr_throttled 0  throttled_usec 0
```
- 全 `/sys/fs/cgroup` 扫描：**没有任何 cgroup 出现非零 `nr_throttled`**。
- 全树 `cpu.max` 扫描：**没有任何非 `max 100000`（即无配额）的条目**。
- 宿主自身 cgroup（`.../vte-spawn-3ed82525-....scope`）的 `cpu.pressure`：`some avg10/60/300 = 0.00`，`full avg10/60/300 = 0.00`，`full total` 仅 **467844 µs（0.47 s / 34 min）**。
  → **宿主燃烧 ~1.15 核，却几乎从未在 cgroup 内被 CPU 卡住**，因为 32 核里有的是空闲核。

### 4.5 内存与 IO

| 项目 | 实测 | 判定 |
|---|---|---|
| `free` | 总 60 Gi，已用 14 Gi，**available 45–47 Gi** | 充裕 |
| swap | 8 Gi，**已用 0 B**；`pswpin 0 / pswpout 0` | 零换页 |
| PSI memory | total **4 µs** | 无压力 |
| major fault | 全局 `pgmajfault 61201`（低） | 正常 |
| nvme0n1 | r/s 570→31，%util **3.7–8.63%**，aqu-sz 0.12–0.49，r_await 0.13–0.27 ms，w_await 0.85–1.81 ms | 健康 |
| `vmstat` `b` 列 | **恒为 0**（10/10 帧） | 无 IO 阻塞 |
| `vmstat` `wa` | 0.09–0.43% | 无 IO 等待 |
| 上下文切换 | **45k–72k /s**，扫描期间峰值 **142,079 /s** | 偏高，见下 |
| 进程/线程 | 689 进程 / ~3,136 任务（3114–3220） | 偏高 |

**两点需要点名：**

1. **上下文切换 45k–72k/s（峰值 142k/s）在整机仅 5–7% 利用率下属于异常偏高。** 主要来自浏览器/headless Chromium 的大量空闲线程 + 我自己的并行取证命令。它体现在 `%system`（2.5–5.3%）与 vmstat `in`（37k–80k/s）上。**量级上不足以造成卡顿**（`%sys` 最高 5.3%，`idle` 仍 89%），但确实是这台机器"底噪"较高的原因。

2. **宿主自身有 16,871 次 major page fault（`majflt=16871`，而全系统仅 61,201 次）。** 即 **27.6% 的全系统 major fault 集中在 `node dsh web` 一个进程上**。major fault 需要真实磁盘读；在 45 GB 可用缓存下这个数字偏高，指向宿主侧的页面反复被驱逐/重读。**这不是系统级内存压力（PSI memory ≈ 0、swap 未用），但是宿主自身值得跟进的性能线索。**

---

## 5. 结论

### 5.1 核心判定：**PASS —— 不存在足以造成界面卡顿的系统级争用**

支撑该判定的**硬指标**（按强度排序）：

1. **CPU PSI `full total = 0 µs`**（整段启动期）—— 从未发生"所有任务一起等 CPU"。
2. 7 种独立口径一致：整机 **89–93% 空闲**，累计平均利用率 **5.19%**。
3. **无任何 cgroup CPU 限流**（`nr_throttled 0`，无 `cpu.max` 配额）—— 排除了"核空闲却被配额卡住"这一隐藏路径。
4. **无降频/无热节流**：governor=performance、amd_pstate=active、32 核 5.2–5.66 GHz、Tctl 64°C。
5. **内存/IO 无压力**：available 45–47 GB、swap 零使用、PSI memory ≈ 0、`vmstat b=0`、iowait ≤0.43%、nvme %util <9%。
6. **整个启动期无 AER / NMI 错误 / MCE / OOM / hung task / soft lockup / RCU stall。**

唯一确实存在的异常是**驱动/内核层的轻微停顿**（`pm_runtime_work` workqueue 11 次 >10 ms、mt76+amdgpu kworker 的 D 态、D 态进程 2→5），量级为毫秒级、且 `vmstat b` 恒为 0 —— **可致微抖动，不足以解释持续性界面卡顿**。

### 5.2 **我（调查负载）贡献了多少 —— 如实交代**

**数值贡献（两个口径，均很小）：**
- **进程级瞬时**：0.008 核 = 整机 **0.02%** = 全部忙 CPU 的 **0.4%**（20 s 窗口，当时只剩 4 个轻量轮询器：`host-drift` 0.45%、`raf-face-runner` 0.15%、`host-click-probe` 0.15%、`theme-open-ab` 0.05%）。
- **进程级累计（抗突发，更可靠）**：**10.4 CPU 秒 = 全部已消耗 CPU 的 0.3%**（59 个子代理进程，占 2783 MB RSS）。

**但是 —— 我必须主动交代 4 项"自伤"，它们不在上面的进程统计里：**

| # | 自伤事件 | 证据 | 性质 |
|---|---|---|---|
| **1** | **失控 bash 打满 1 核** —— pid **81808**，`bash -c ... gsettings monitor ...`，属 `incident2/display-input` 调查线 | 10:29:32 测得 **98.0% 一核**、状态 `R`、已运行 53 s；子进程 `[gsettings] <defunct>` 未被回收，bash 空转。10:34 复查已退出 | **最严重**。单核 100% 持续 ~1 分钟。32 核下不造成全局争用，但是**完全可避免的浪费**，且它正在测的恰恰是"显示/输入"——与被投诉的卡顿同一条路径 |
| **2** | **反复触发显示器 EDID / RandR 重探** —— 同一 `display-input` 线（其命令含 `gsettings monitor`、`cat ~/.config/monitors.xml`、gsettings 全项读取） | 日志中 `Modeline` 共 **979 行**；启动期 2 次后，**10:28:54 起以 ~10–20 s 周期反复重探**（10:28:54、10:29:17、10:30:15、10:30:19、10:30:29、10:30:31、10:30:36、10:30:47、10:31:00、10:31:14，每次 30–105 行完整 EDID modeline dump） | **机制敏感**。显示器重探/模式查询正是会在合成器上制造瞬时卡顿的操作。**时间点（10:28:54+）与我的会话启动（10:28:44）严格吻合**，高度指向调查线 |
| **3** | **取证扫描自身推高了 IO PSI 与上下文切换** | IO PSI `avg60` 由 10:29 的 **0.01** 升到 10:34 的 **0.15**；上下文切换峰值 **142,079/s**；page cache 42 GB→45 GB；free 5.9 GB→2.4 GB。诱因：对 **561 MB / 1115 个 `session.jsonl.zstd`** 的会话目录做 `grep -r`（一度超时 60 s）、`find`、`du` | 我的责任。所幸绝对量仍小（IO PSI 占时 0.6%） |
| **4** | **`zstd -19 -c` @ ~10:25** | 仅同侪记载，**我无法复核**（§3.6）。父进程为"宿主 spawn 的 bash" ⇒ **agent 侧**，且已排除 DSH 代码路径（等级=3）与 logrotate | **INCONCLUSIVE**，但方向指向调查/agent 负载 |

**综合判断 —— 对后续裁决至关重要的三句话：**

1. **我的调查负载不是"系统级主因"**：进程级 0.3%，且机器始终 89–93% 空闲。把它当作卡顿成因**不成立**。
2. **但调查确实注入了真实干扰**：一个**打满单核约 1 分钟的失控 bash** + **以 10–20 秒周期反复重探显示器**。这两项都在"显示/渲染"这条与被投诉现象直接相关的路径上，**是可避免的污染**。若后续要用 A/B 或时序对齐来定位卡顿，**必须先消除这两项**，否则测量本身带偏。建议：`display-input` 线的 gsettings/monitors 轮询应加超时与去抖，禁止在测量窗口内反复查询 RandR。
3. **最大单一 CPU 消费者是 DSH 宿主自身，不是子代理**：1515.5 CPU 秒 = **46.1%**（≈持续 1.0–1.15 核），是子代理进程的 146 倍。**子代理"进程"只占 0.3%**；但子代理**工作**（SSE/JSON、会话 append+压缩、工具派发、Web GUI）在宿主进程内执行，其份额**从外部不可切分**。所以"宿主 CPU 高"与"宿主 CPU 高是因为子代理"是两回事——**前者是事实，后者未经证实，需要宿主侧 profiler/打点才能定论。**

### 5.3 明确不在本报告结论内的事项

- 本次取证**只否证系统级争用**，**没有**指出用户卡顿的真正成因。
- **未跑浏览器**（遵纪律），因此**没有**对 DSH 设置页或 Codex 托盘动效做任何应用层/渲染层测量。
- 同侪产物 `.workspace/settings-lag/DIAGNOSIS.md` 中"45 s 同步 ingest 阻塞宿主 924 ms"等结论属**前序审计**，我未复核，**不作为本报告依据**。

### 5.4 证据指向（供后续裁决参考，非本报告结论）

系统侧已被排除，而**所有高 CPU 进程都远未单线程饱和**（宿主 ~103% 一核 / Firefox 内容进程 28–31% / gnome-shell 6%）。这一组合（"系统 89% 空闲 + UI 仍卡"）典型地指向**应用层**：
- 浏览器**主线程**阻塞 / 长任务 / 强制同步布局，
- 悬停动效的**逐帧 JS + 布局抖动**（同侪 `host-click-probe --interval-ms 50` 正在测的正是这条），
- 合成器被反复显示器重探打断（**而这一项部分是我造成的，见 §5.2 第 2 条**），
- 或宿主自身的页面重复缺页（§4.5 第 2 点，majflt 16871）。

---

## 6. 工具与权限限制（如实声明）

| 限制 | 影响 | 替代 |
|---|---|---|
| `dmesg -T` 被拒（`kernel.dmesg_restrict`，无 root，**禁止提权**） | 无法直读内核环缓冲 | 用 `journalctl -b`（journald 同含内核消息），覆盖整个启动期 |
| `acct` 进程记账 **inactive**，`/var/log/account/` 不存在 | **无法** `lastcomm` 回溯已退出进程 | 只能靠采样抓现行 → 直接导致 §3.6 `zstd -19` 无法复核 |
| `sar` 历史 `sa22` 仅 **10 分钟粒度** | 秒级突发在统计中被平均掉 | 以 10:10/10:20/10:30 三桶作背景，突发项单列 |
| 用户 crontab 不可读（权限） | 无法确认用户级 cron | `/etc/crontab` + `/etc/cron.d/*` + systemd timers 已全覆盖 |
| `sensors` **未安装**；`/sys/class/thermal` 为空 | 无 ACPI thermal zone 读数 | 用 `/sys/class/hwmon/*`（k10temp/amdgpu/nvme/mt7921/r8169） |
| 无 root / 禁止提权 | 不能读内核记账、不能 profile 宿主内部 | 已在 §2.3 明确标注"归属不可切分"这一残留不确定性 |

---

## 7. 交付物与原始输出

**主交付**：本文件 `audit.md`

**原始输出（`raw/` 子目录）**

| 文件 | 内容 |
|---|---|
| **`psi-vmstat-dmesg-raw.txt`** | **原始附录**：PSI（cpu/io/memory 全字段）+ loadavg/uptime + `vmstat 1 10` + `free` + `mpstat 1 5` |
| `cat-cpu.txt` | 三类占比瞬时口径（`cat_cpu.py`，20 s） |
| `cum-cpu.txt` | 三类占比累计口径（`cum_cpu.py`，33 min）+ Top18 单进程 |
| `cpu-stat-sample.txt` | `/proc/stat` 10 s 差分 + `vmstat 1 10` + `mpstat 1 5` |
| `mem-io.txt` | `free` / PSI / `/proc/vmstat` / `meminfo` / `iostat -x 1 3` / major fault Top15 / swap / `sar` 历史 |
| `periodic-jobs.txt`、`periodic-jobs2.txt` | `systemctl list-timers --all`、crontab、`/etc/cron.*`、anacron、snapd、apt、索引/同步进程、内核线程 |
| `kernel-warnings.txt` | logrotate 配置核查 + `journalctl -b -p warning` + 40 min 关键词过滤 + dmesg 受限记录 |
| `kernel-stalls.txt` | workqueue hog 事件、显示器重探时间线、anacron 执行明细、systemd 单元 CPU、D 态进程 |
| `cpufreq-thermal.txt` | 32 核 governor/频率、amd_pstate、hwmon 温度、节流检索、thermald 状态 |
| `zstd-forensics.txt`、`dsh-zstd-level.txt`、`dsh-zstd-level2.txt` | `zstd` 溯源：DSH 会话存储（1115 个 `.jsonl.zstd` / 561 MB）、pi-ai `REQUEST_COMPRESSION_ZSTD_LEVEL = 3`、logrotate 否定、CLI 调用点 |
| `correlation.txt` | 浏览器启动 vs 显示器重探、合成器 CPU（pidstat）、gnome-shell/mutter 日志、最终 PSI/vmstat |
| `final-checks.txt`、`final-verification.txt` | 线程普查、R/D 态、宿主 10 s CPU 差分（1198 ticks = **119.8% 一核**）、81808 退出确认 |
| `top-bn2.txt`、`pidstat-u.txt` | `top` 第二迭代（瞬时）+ `pidstat -u 1 3` 原始表 |
| `cat_cpu.py`、`cum_cpu.py` | 两个取证脚本（**只读 `/proc`，不发信号**），可复跑 |

**复跑方式**
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/sys-stalls/raw
python3 cum_cpu.py          # 累计三类占比（秒级，抗突发）
python3 cat_cpu.py 20       # 瞬时三类占比（20 s 窗口）
```

---

*报告完成时间：2026-09-22 10:36 CST · 全程只读 · 未重启/未 pkill/未改产品/未跑浏览器/未提权*
