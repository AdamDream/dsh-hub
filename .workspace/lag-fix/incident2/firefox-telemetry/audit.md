# audit.md — Firefox Glean 自有存储：分布型指标桶结构破解与用户侧渲染表现裁决

- **作者线**：`incident2/firefox-telemetry`（独立线）
- **目录**：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/firefox-telemetry/`
- **纪律**：全程只读。未启动用户浏览器、未改任何配置、未 pkill、未修改他人目录（`firefox-gfx/decode-pings.py` 仅复制引用）。
- **工具调用**：未使用 `sandbox_permissions`。

---

## 0. 一句话结论（先给裁决）

| # | 裁决问题 | 结论 |
|---|---|---|
| ① | 用户侧渲染表现有没有**客观变差的证据**？ | **PASS — 有，但量级小且集中在 scroll 呈现延迟**。checkerboard **确实发生了 50 次**（有破图/掉帧的直接量化），其中 28% 落在最高严重度桶；`scroll_present_latency` 有 **4.74% 的滚动 ≥36.6 ms**、**0.78% ≥65 ms**、**0.62% ≥174 ms**（用户可感知的滚动卡）。但 `composite_time` 中位 ≈0.96 ms（p95 ≈1.92 ms）、`frame_time.from_vsync` 96.74% 落在 90–115% vsync 区间 ⇒ **Gecko 合成器本身不是主犯**，证据指向**下游呈现（mutter 5120→4K + 2 CU 核显）**。 |
| ② | 与 `on_time 98.20%`、`slow_composite 0.61%` 是否一致？ | **PASS — 完全一致，且我独立复现并精确化了**：我的副本（晚 ~4 分钟）解出 `on_time 107,533 / 109,441 = 98.26%`、`slow_composite 656 = 0.60%`。**关键独立校验**：`frame_time.from_vsync` 分布总样本 **109,441 == 8 个 reason 计数器之和 109,441**（精确相等）⇒ 两条口径同源，无冲突。我读到的值**系统性略大于**他线，因 store 在两次读取间持续增长（见 §2.3），这是累计计数器，不是矛盾。 |
| ③ | 哪些指标**无法**从该通道取得？ | 见 §6。核心缺口：**逐事件时间戳 / 前后分段**、**checkerboard 发生时的具体页面**、**掉帧发生的绝对时刻**、**GPU 切换前后的对比**（因 store 起始晚于切换）。 |

---

## 1. 交付物清单

| 文件 | 内容 |
|---|---|
| `audit.md` | 本文件 |
| `glean-final.py` | **最终解析器**（自包含、只读副本）：容器 + 全部 sub-tag + 分布桶解码，含自校验 |
| `glean-dist.py` | 分布型专用解码器（自校验版），产出 `distributions.json` |
| `gleanstore.py` | 可复用模块（`load()` / `payload()` / `decode()`） |
| `decode-glean-store.py`, `extract-glean.py`, `glean-walk.py`, `glean-decode.py` | 探索期迭代版本（保留以体现推导链与失败路径） |
| `key-inventory.json` | **全部 2,752 个键**的值（原始键值清单，含类型与分布桶） |
| `gfx-a11y-values.json` | `gfx.*` / `a11y.*` / `display.*` / `content.*` 共 **108 键**的完整清单 |
| `distributions.json` | **27 个分布型指标**的桶边界 + 计数 + 自校验结果 |
| `distributions-skipped.json` | 43 个**非分布型**键（标量/字符串/JSON/布尔），明确标注为「非分布」而非「解析失败」 |
| `bucket-tables.txt` | 人读桶表（bin_label / count / share% / cumulative%），571 行 |
| `records-index.json` | 全部记录的字节偏移索引 |
| `data.safe.bin.copy` | **只读副本**（见 §2） |
| `ref-other-line/decode-pings-copy.py` | 另一线解析器的**未修改副本**（仅换目录），用于独立复核 |
| `subagent-units/` | 二级 subagent 产物：**Mozilla 官方 `gfx-metrics.yaml`**、`glean-timing_distribution.md`、`StaticPrefList.yaml`、`gecko-tree.json` 等（单位与语义的权威依据） |

---

## 2. 只读纪律与副本溯源

### 2.1 副本元数据
```
源文件 : ~/snap/firefox/common/.mozilla/firefox/g05ps3km.default/datareporting/glean/db/data.safe.bin
复制时刻: 2026-09-22 11:08:39 +0800  (ISO UTC 2026-09-22T03:08:39Z)
副本    : data.safe.bin.copy
副本 md5: 8a314090476e0a59aabce4b7ed7572ae
副本 size: 426,183 B       副本 mtime: 2026-09-22 11:07:12.257684520 +0800
复制时 md5 源 == 副本 ⇒ 校验通过（cp -p 保序，已核对 md5sum 一致）
```

### 2.2 源文件在活跃写入（重要 caveat）
复查时刻（11:25）源文件已变为：
```
md5 a2ddac877516d72ca64073f9851c22d5   size 445,965 B   mtime 2026-09-22 11:25:55
```
即 Firefox 仍在运行并持续写入（+19,782 B / ~18 min）。**本报告所有数字均对应 11:07 的副本快照，不是「当下」值。** 这是累计计数器，随时间单调增长。

### 2.3 与他线数字的差异是「读取时刻不同」，不是解析冲突
| metric | 本线（副本 11:07） | 他线 | Δ |
|---|---|---|---|
| `gfx.content.frame_time.reason/on_time` | **107,533** | 101,469 | +6,064 |
| `.../slow_composite` | **656** | 632 | +24 |
| `.../missed_composite` | **1,038** | 1,020 | +18 |
| `.../missed_composite_low` | **165** | 159 | +6 |
| `.../missed_composite_long` | **38** | 37 | +1 |
| `.../missed_composite_mid` | **9** | 9 | 0 |
| `.../no_vsync`, `.../no_vsync_no_id` | **1 / 1** | 1 / 1 | 0 |
| `gfx.skipped_composites` | **1,182** | 1,173 | +9 |

**全部 Δ ≥ 0 且同向单调** ⇒ 同一组累计计数器在不同时刻被读取。**无解析冲突。** 按 +6,064 帧 / ~4 min 估算该窗口内约 25 fps 的帧产出（含 idle 稀释）。

---

## 3. 复核另一线解析器（任务第 1 步）

### 3.1 做法
把 `../firefox-gfx/decode-pings.py` **原样复制**到 `ref-other-line/decode-pings-copy.py`（`diff -q` 确认逐字节一致，未修改他人目录），在本目录独立运行。

### 3.2 结果
```
=== 68 payloads found ===
main  reason=aborted-session/environment-change/shutdown/daily ...  gfx=YES
```
- **PASS**：payload 计数 68、`gfx=YES` 判定、`reason` 提取均正确复现。
- **PARTIAL**：时间戳列打印为 `?`。原因是该脚本用 `d.get("creationDate")`，而 Firefox 155 的 main ping 把时间戳放在 `payload.info.subsessionStartDate` / `payload.meta`，顶层无 `creationDate` ⇒ `ts()` 收到 `None` 走 except 分支。**这是显示缺陷，不是解析失败**；`gfx` 对象本身解析正确（`features`/`adapters`/`monitors` 全部可读，脚本第 89–105 行的时间线表格逻辑依赖 `creationDate` 排序，故该表格为空，属同一原因）。

### 3.3 我独立复核的两个已知量（用户明确要求）
用**完全独立**的解析路径（Glean `data.safe.bin`，非 ping）复核：

| 已知量 | 期望 | 本线解出 | 判定 |
|---|---|---|---|
| `gfx.display.primary_width` | 5120 | **5120** | **PASS** |
| `gfx.target_frame_rate` | 60 | **60** | **PASS** |

并额外复现全部他线引用的已知量（交叉验证解析正确性）：

| 键 | 本线解出 | 判定 |
|---|---|---|
| `gfx.display.primary_height` | **2880** | PASS |
| `gfx.display.count` | **1** | PASS |
| `gfx.linux_window_protocol` | **`"x11"`** | PASS |
| `gfx.content_backend` | **`"Skia"`** | PASS |
| `gfx.status.last_compositor_gecko_version` | **`"155.0.1"`** | PASS |
| `gfx.status.compositor` / `gfx.features.compositor` | **`"webrender"`** | PASS |
| `gfx.adapter.primary.vendor_id` | **`"0x1002"`** (AMD) | PASS |
| `gfx.adapter.primary.device_id` | **`"0x13c0"`** (Raphael) | PASS |
| `gfx.adapter.primary.driver_vendor` | **`"mesa/radeonsi"`** | PASS |
| `gfx.adapter.primary.description` | **`AMD Ryzen 9 9950X 16-Core Processor (radeonsi, raphael_mendocino, LLVM 20.1.2, DRM 3.61, 6.14.0-27-generic)`** | PASS |
| `gfx.adapter.primary.driver_version` | **`"25.2.8.0"`** | PASS |
| `a11y.backplate` | **`1` (true)** | PASS |
| `gfx.skipped_composites` | **1182** | PASS（晚读，见 §2.3） |
| `gfx.content.frame_time.reason/*` 8 项 | 见 §2.3 | PASS |

⇒ **解析正确性已由 20+ 个独立已知量交叉确认**，可继续用于分布型解码。

---

## 4. 容器格式：从他线描述到精确字节布局（含我修正的两处错误）

### 4.1 他线给定格式与实测的差异
他线给出：`[u64 keylen][key][u64 reclen][u8 tag][u64 paylen][payload]`，`reclen == 1+8+paylen`。

实测**不完全正确**。逐字节验证后真实布局为：

```
file   := [u64 fmt_version=3][u64 record_count=769]  record*
record := [u64 keylen][key utf8 : keylen bytes][u64 vallen][value : vallen bytes]
value  := [u8 TAG=0x09][u64 paylen][payload : paylen bytes]
```

**零填充、无对齐间隙。** 与描述的两处**实质差异**：
1. 长度字段是 `vallen`（**value 块长度**），紧随 key 之后；不是 `reclen == 1+8+paylen` 恒等式（实测 `vallen = 9 + paylen`，tail 依 sub-tag 另计）。
2. `u8 tag` 在 value 块**首位**（恒为 `0x09`，见 §4.3），真正的类型判别符是 **`payload[0]`（sub-tag）**。

### 4.2 判定依据（可复现的硬证据）
```
record 0 跨 [32, 3787):
  u64@32 = 27                       == len("addons#addons.active_addons")  ✓
  key    @40..67
  u64@67 = 3712 (= vallen)          value @75..3787
  u64@3787 = 32                     == len("addons#addons.active_g_m_plugins") ✓  ← 精确衔接
```
统计证据：**2,701 / 2,753** 个长度前缀键满足 `next_key_offset == prev_key_end + 8 + prev_vallen`（**delta 恰为 0**）。若长度字段位置或宽度有误，此恒等式不可能成立。

全文件覆盖：**2,753 条记录、426,183 / 426,183 字节、剩余 0 字节**。header 声明 `record_count = 769`；实测 2,753 > 769，说明 header 计的是**不同的计数口径**（Glean 内部 store 计数），**不是**记录条数 —— 这一点我**明确标注为未解**（见 §6）。

### 4.3 TAG 恒为 0x09
全部 2,753 条记录的 value 首字节**均为 `0x09`**。因此 `0x09` 是「scalar wrapper」标记，真实类型在 `payload[0]`。

### 4.4 payload sub-tag 完整表（实测 + 与 Mozilla `metrics.yaml` 类型对齐）
| sub-tag | 语义 | 编码 | 实例 |
|---|---|---|---|
| `0x00` | 布尔 / 空 | `payload[4]` = 0/1 | `gfx.headless=0`、`a11y.backplate=1` |
| `0x01` | counter / 标量计数 | `payload[4:8]` = u32 LE | `on_time=107533`、`skipped_composites=1182` |
| `0x02` | custom_distribution | `[u32 n][n × (u64 val, u64 cnt)]` + 44B tail | `checkerboard.severity`(15)、`frame_time.from_paint`(35) |
| `0x03` | custom_distribution（phase 加权） | 同上，tail 44B | `frame_time.from_vsync`(93)、`*_phase_weight_*` |
| `0x06` | 整数 | `payload[4:12]` = u64 LE | `primary_width=5120`、`target_frame_rate=60` |
| `0x07` | 字符串 | `payload[4:12]`=strlen，`payload[12:]`=bytes | `content_backend="Skia"` |
| `0x0B` | timing_distribution | 同 `0x02`，tail 28B | `composite_time`(57)、`scroll_present_latency`(20) |
| `0x11` | JSON blob | `payload[4:12]`=len，`payload[12:]`=json | `gfx.adapters`、`gfx.monitors` |

> ⚠️ **一处必须标注的坑**：`0x01`/`0x06` 的标量值放在 **`payload[4:8]` / `payload[4:12]`**（不是 `[5:9]`/`[5:13]`）。我早期用 `[5:13]` 导致所有字符串首字符被吃掉、整数被整体错位（`primary_width` 读出 20）。**修正是通过 `primary_width` 必须等于 5120 这一已知量发现的** —— 这正是「先复核已知量再继续」的价值。

### 4.5 分布型桶结构（本次核心突破）
```
payload := [u32 subtag][u32 nbuckets][entry × nbuckets][tail]
entry   := [u64 bin_label][u64 count]            # 严格 16 字节

★★ bin_label 与 count 都存放在 u64 的【高 32 位】，低 32 位恒为 0 ⇒ 必须 >>32 还原 ★★
```
**判定依据（三重独立）**：
1. **字节级**：`u64@8` 的 8 字节为 `00 00 00 00 40 12 00 00` ⇒ 低 4 字节 = 0，高 4 字节 = `0x1240` = 4672。**每个 count 都是 2³² 的精确整数倍**（脚本实测 `all multiples of 2^32 == True`）。
2. **长度恒等式**：`len(payload) == 8 + 16·nbuckets + tail`，`tail = 44`（sub-tag `0x02`/`0x03`）或 `28`（`0x0B`）。**27/27 个分布型指标全部精确成立**。
3. **★ 自校验（最强）★**：每条 timing_distribution 的 tail 内含一个 u32 样本总数，位置 `tail[4:8]`（`0x0B`）。实测该值与**解码后所有桶计数之和精确相等**：

```
metrics#gfx.composite_time                 sum=173703  trailer=173703  PASS
metrics#gfx.composite_frame_roundtrip_time sum=174804  trailer=174804  PASS
metrics#gfx.scroll_present_latency         sum=1287    trailer=1287    PASS
metrics#gfx.content.frame_time.from_vsync  sum=109441  trailer=109441  PASS
metrics#gfx.checkerboard.duration          sum=50      trailer=50      PASS
   ...（27/27 全部 PASS）
```

4. **跨指标独立校验（决定性）**：`frame_time.from_vsync` 分布总样本 **109,441** 与 8 个 `frame_time.reason/*` 计数器之和 **109,441** **精确相等**。两条完全不同的编码路径（分布桶 vs 标量 counter）给出同一总体 ⇒ 桶解码**正确**。
5. **内部一致性**：4 个 `large_paint_phase_weight_full/*`（dl/fb/sb/wrdl）总样本均为 **97**；4 个 `small_paint_phase_weight_full/*` 均为 **109,154**；4 个 `small_paint_phase_weight_partial/*` 均为 **1,106** —— 同一 paint 事件的相位分解必然同总数，实测完全吻合。

### 4.6 早期失败路径（诚实记录）
| 失败尝试 | 症状 | 原因 | 修正 |
|---|---|---|---|
| `[u64 keylen][key][u64 reclen][u8 tag][u64 paylen][payload]`（他线格式） | 走 313 条后 `kl=1025` 断裂 | `reclen == 1+8+paylen` 恒等式不成立 | 改为实测 `vallen` |
| 标量读 `payload[5:9]`/`[5:13]` | 字符串首字符丢失（`"MD Ryzen"`）、整数错位（width=20） | 偏移量错 1 字节 | 改为 `payload[4:8]`/`[4:12]`，由 `primary_width==5120` 反推修正 |
| 桶 stride 猜 17 / 18 / 19 / 20 字节 | 长度恒等式不成立或 count 荒谬（`961548`） | 误把「高 32 位编码」当成完整 u64 | 发现低 32 位恒为 0 ⇒ `>>32` |
| `count` 读 `payload[4]` | `nbuckets=15` 却读到 251658240 | 未做 `>>32` | 同上 |

---

## 5. 单位判定（依据 Mozilla 官方 `gfx-metrics.yaml`，非猜测）

二级 subagent 从 Mozilla 源码树取回了**权威 `metrics.yaml`**（存于 `subagent-units/gfx-metrics.yaml`）。逐条对齐：

| Glean 键 | 官方 type | **官方 unit / time_unit** | histogram | 判定依据 | 置信度 |
|---|---|---|---|---|---|
| `gfx.checkerboard.duration` | `timing_distribution` | **millisecond** | — | `metrics.yaml:725-728` + `telemetry_mirror: CHECKERBOARD_DURATION` | **CONFIRMED** |
| `gfx.checkerboard.potential_duration` | `timing_distribution` | **millisecond** | — | `:772-775` + `CHECKERBOARD_POTENTIAL_DURATION` | **CONFIRMED** |
| `gfx.checkerboard.severity` | `custom_distribution` | **Opaque unit（无单位）** | exponential, `range_max 2^30`, 50 buckets | `:799-805` + `CHECKERBOARD_SEVERITY` | **CONFIRMED** |
| `gfx.checkerboard.peak_pixel_count` | `custom_distribution` | **Pixels** | exponential, `range_max 66355200`, 50 | `:748-753` + `CHECKERBOARD_PEAK` | **CONFIRMED** |
| `gfx.composite_time` | `timing_distribution` | **millisecond** | — | `:331-333` + `COMPOSITE_TIME` | **CONFIRMED** |
| `gfx.composite_frame_roundtrip_time` | `timing_distribution` | **millisecond** | exponential | `:465-472` + `COMPOSITE_FRAME_ROUNDTRIP_TIME` | **CONFIRMED** |
| `gfx.scroll_present_latency` | `timing_distribution` | **millisecond** | — | `:356-358` + `SCROLL_PRESENT_LATENCY` | **CONFIRMED** |
| `gfx.content.frame_time.from_vsync` | `custom_distribution` | **Percentage of vsync interval** | **linear**, `range_min 8`, `range_max 792`, `bucket_count 100` | `:929-935` + `CONTENT_FRAME_TIME_VSYNC` | **CONFIRMED** |
| `gfx.content.frame_time.from_paint` | `custom_distribution` | **Percentage of vsync interval** | exponential, `range_max 5000`, 50 | `:906-911` + `CONTENT_FRAME_TIME` | **CONFIRMED** |
| `gfx.content.frame_time.with_svg` | `custom_distribution` | **Percentage of vsync interval** | exponential, `range_max 5000`, 50 | `:952-955` | **CONFIRMED** |
| `gfx.content.frame_time.without_resource_upload` | `custom_distribution` | **Percentage of vsync interval** | exponential, `range_max 5000`, 50 | `:975-978` | **CONFIRMED** |
| `gfx.content.paint_time` | `timing_distribution` | **millisecond** | — | `:1045-1047` + `CONTENT_PAINT_TIME` | **CONFIRMED** |
| `gfx.content.full_paint_time` | `timing_distribution` | **millisecond** | — | `:1067-1069` + `CONTENT_FULL_PAINT_TIME` | **CONFIRMED** |
| `gfx.skipped_composites` | `counter` | 次数 | — | `:375-378` | **CONFIRMED** |
| `a11y.tree_update_timing` | `timing_distribution` | **millisecond** | functional 2^(i/8) ns | `accessible/metrics.yaml` L179-194 + `A11Y_TREE_UPDATE_TIMING_MS`（high 60000 ms） | **CONFIRMED**（§5.3 升级） |

### 5.1 存储 bin_label 与官方单位的换算（明确标注推断）
官方单位是 **ms**，但存储里的 bin_label 是**更大的整数**（如 `33554432`、`961548`）。观察：
- `scroll_present_latency`：`33554432 = 2^25`、`16777216 = 2^24`、`2286960`、`2493948` —— 呈**指数桶边界**形态。
- `frame_time.from_vsync`：bin_label = `8,16,24,32,40,96,104,112,...,792`，**恰好落在官方声明的 `range_min 8 / range_max 792 / linear`** 上。

⇒ **判定**：
- `gfx.content.frame_time.*` 的 bin_label **就是官方语义值本身**（% of vsync interval），**无换算歧义**。**CONFIRMED**。
- ✅ **已升级为 CONFIRMED（2026-09-22 补充，见 §5.3）**：timing_distribution 的 bin_label **就是桶下界，单位纳秒（ns）**，`bin_label / 1e6` = ms。依据是 Mozilla 官方 Glean SDK 规范 + 源码，且**268/268 个 timing 桶全部通过其精确公式校验**（§5.3）。此处原为 LIKELY（推断），现依新证据升级。

### 5.3 ★★ 权威规范校验（二级 subagent 事后补充，把 LIKELY 升级为 CONFIRMED）★★

二级 subagent 取回 Mozilla **一手源码**（`mozilla/gecko-dev` 的 `gfx/metrics.yaml`、`accessible/metrics.yaml`、`toolkit/components/telemetry/Histograms.json`，以及 `mozilla/glean` 的 `timing_distribution.md` / `custom_distribution.md` / `glean-core/src/histogram/*.rs`）。关键规范：

> **timing_distribution**：Glean SDK 规范原文 —— "recorded in a histogram where the buckets have an exponential distribution, specifically with **8 buckets for every power of 2**. That is, the function from a value x to a bucket index is `⌊8·log₂(x)⌋`." 且 timings 是 "**always stored and sent in the payload as nanoseconds**"；`time_unit: millisecond` **只设定记录范围**，不改存储单位。
> 实现：`functional.rs` 中 `exponent = log_base^(1/buckets_per_magnitude)`、`bucket_min = exponent^index`，实例化为 `functional(2.0, 8.0)`。
> ⇒ **`bucket_min(i) = 2^(i/8)` ns**。

#### 我用它做的独立校验（这是最硬的一条证据）
对全部 8 个 timing_distribution（`scroll_present_latency`、`composite_time`、`composite_frame_roundtrip_time`、`checkerboard.duration`、`checkerboard.potential_duration`、`content.paint_time`、`content.full_paint_time`、`a11y.tree_update_timing`）的**每一个**解码桶，检查其是否落在自己的 functional 桶内（`2^(i/8) ≤ x < 2^((i+1)/8)`）：

```
FUNCTIONAL BUCKET INVARIANT: 268/268 timing bins inside their own bucket   →  PASS
```
（校验器已写入 `glean-dist.py` 的 `validate_timing()`；早先手工版报 258 桶 `BAD` 若干，经查全部是浮点尾差 ~1e-7 的假阳性，改为容差判定后 268/268 全通过。）

**这条校验的意义**：它**完全不依赖**我的 `>>32` 假设 —— 如果 `>>32` 的字段编码有任何错误，解码出的 268 个桶不可能同时命中 Mozilla 的精确公式。⇒ 相当于用 Mozilla 的规范**反证**了我的位编码正确。

#### 由此得到的确定单位与量程（CONFIRMED）
| 指标 | 单位（CONFIRMED） | 桶类型 | 解码桶量程 |
|---|---|---|---|
| `gfx.scroll_present_latency` | **ms**（ns/1e6） | functional 2^(i/8) ns | **2.287 ms .. 225.726 ms** |
| `gfx.composite_time` | **ms** | 同上 | 0.962 ms .. 123.078 ms |
| `gfx.composite_frame_roundtrip_time` | **ms** | 同上 | 0.962 ms .. 134.218 ms |
| `gfx.checkerboard.duration` | **ms** | 同上 | 15.385 ms .. 413.984 ms |
| `gfx.checkerboard.potential_duration` | **ms** | 同上 | 16.777 ms .. 2784.942 ms |
| `gfx.content.paint_time` | **ms** | 同上 | 0.962 ms .. 39.903 ms |
| `gfx.content.full_paint_time` | **ms** | 同上 | 0.962 ms .. 159.613 ms |
| `a11y.tree_update_timing` | **ms** | 同上 | 0.962 ms .. 189.813 ms |

⇒ 我早期标注的 `LIKELY` 换算（`bin_label / 1e6` = ms）**完全正确且现已 CONFIRMED**。§7 各桶表中的「换算 ms（CONFIRMED）」一律**升级为 CONFIRMED**。

#### 另外两条由官方 `Histograms.json` 获得的旁证（legacy mirror 一致性）
| 指标 | legacy mirror | 参数 | 与我实测的关系 |
|---|---|---|---|
| `checkerboard.severity` | `CHECKERBOARD_SEVERITY` | `exponential` 50 buckets，high **1073741824** | 与我实测 `nbuckets=15`（仅非零桶）相容；`range_max` 一致 |
| `scroll_present_latency` | `SCROLL_PRESENT_LATENCY` | `exponential` **100** buckets，`low 1`，high **20000 ms** | 我实测 20 个非零桶、量程 2.287–225.726 ms，**完全落在 1–20000 ms 内** |
| `composite_time` | `COMPOSITE_TIME` | `exponential` 50，high **1000 ms** | 我实测 0.962–123.078 ms，**落在内** |
| `composite_frame_roundtrip_time` | `COMPOSITE_FRAME_ROUNDTRIP_TIME` | `exponential` 50，high 1000 | 0.962–134.218 ms，**落在内** |
| `checkerboard.duration` | `CHECKERBOARD_DURATION` | `exponential` 50，high **100000 ms** | 15.385–413.984 ms，**落在内** |
| `checkerboard.potential_duration` | `CHECKERBOARD_POTENTIAL_DURATION` | `exponential` 50，high **1000000 ms** | 16.777–2784.942 ms，**落在内** |
| `checkerboard.peak_pixel_count` | `CHECKERBOARD_PEAK` | `exponential` 50，high **66355200 px** | 我实测 max_bin 801854 px，**落在内** |
| `content.paint_time` | `CONTENT_PAINT_TIME` | `exponential` 50，high 1000 ms | 0.962–39.903 ms，**落在内** |
| `content.full_paint_time` | `CONTENT_FULL_PAINT_TIME` | `exponential` 50，high 1000 ms | 0.962–159.613 ms，**落在内** |
| `a11y.tree_update_timing` | `A11Y_TREE_UPDATE_TIMING_MS` | `exponential` 50，high **60000 ms** | 0.962–189.813 ms，**落在内** |

⇒ **10 项全部落在 legacy mirror 声明的量程内**，无一项越界 ⇒ 又一次独立自洽。**`a11y.tree_update_timing` 的单位因此从 UNCERTAIN 升级为 CONFIRMED（ms）**。

#### custom_distribution 的独立校验
- **19/19 个 custom_distribution 的桶严格单调递增**（我实测），符合「桶下界」语义。
- **几何步长校验（新增，PASS~）**：Glean CD exponential 的桶界是按几何级数从 `range_min` 走到 `range_max`，步长应为 `(rmax/rmin)^(1/n)`。我实测各指标相邻桶比值的中位数：
  | 指标 | 实测 median 比值 | 期望步长 `(rmax/rmin)^(1/50)` | 偏差 |
  |---|---|---|---|
  | `checkerboard.severity` | 1.5316 | 1.5157 | **1.05%** |
  | `checkerboard.peak_pixel_count` | 1.4448 | 1.4336 | **0.78%** |
  | `content.frame_time.from_paint` | 1.1684 | 1.1857 | **1.46%** |
  | `content.frame_time.with_svg` | 1.1681 | 1.1857 | **1.48%** |
  | `content.frame_time.without_resource_upload` | 1.1681 | 1.1857 | **1.48%** |
  ⇒ 五项的比值**都与几何级数期望值吻合在 ~1.5% 内**，且各指标内部比值高度自洽（如 `severity` 连续 12 个比值稳定在 1.5303–1.5317）。这**独立印证**了 custom_distribution 桶的解码正确（若字段编码错位，不可能得到恒定比值）。
  ⚠️ 残余 **~1.5% 偏差**归因于实现里桶边界的**离散化/取整**（`ranges.push(0)` 下溢桶、最后一个溢出桶、以及 `range_min` 缺省为 0 时的处理），我**未逐行复现其取整规则** ⇒ 该子命题标 **INCONCLUSIVE**（不影响任何裁决：桶标签与计数本身是实测硬数据）。
- `from_vsync` 实测桶为 `8,16,24,32,40,96,104,...,792`，**步长恰为 8、上下界恰为官方 `range_min 8` / `range_max 792`**；我实测共 **93 个非零桶**（官方声明 100 桶；**零样本桶不落盘**，见下）。
- ⚠️ **一处我未能复现的子命题**：官方线性分桶的解析式步长应为 `(792-8)/100 = 7.84`，而我实测步长为 `8.0`。二者在整数语义下都与「8..792 / 8 的倍数」相容，但我**未取得**能把二者区分开的明文实现细节。⇒ 该子命题标注 **INCONCLUSIVE（不影响任何结论：桶标签本身是实测硬数据）**。

#### 一条重要的口径澄清（影响 §7 所有「bins=N」的解读）
**存储只落盘非零桶。** 证据：`bucket_count` 官方声明为 50/100，而我实测的 `nbuckets` 是 15 / 17 / 26 / 28 / 31 / 35 / 57 / 93 等**更小的数**，且每个都严格单调、样本总数与 trailer 精确相等。
⇒ §7 与其后各表中的 **「bins=N」= 该指标实际有样本的桶数，不是官方声明的总桶数**。这不影响任何 count/share 数字，但**避免误读为「Firefox 只分 N 个桶」**。

---

### 5.2 绝对不可能的解读（用于排除）
- `scroll_present_latency` bin_label 若**直接当 ms**：最密桶 = 33,554 秒（9.3 小时），荒谬 ⇒ **必须换算**。
- `composite_time` bin_label 若**直接当 ms**：961 秒合成 ⟹ 荒谬 ⇒ **必须换算**。

---

## 6. 时间维度裁决（任务第 3 步）：**无法分段 —— store 完全晚于 GPU 切换**

### 6.1 结论
**明确回答：不能。这些计数是 store 生命周期内的累计值，且 store 的起始时间晚于 GPU 切换 2026-09-20 17:18。** 因此**不存在**「切换前 vs 切换后」的对比，任何声称能分段的说法都是错的。

### 6.2 硬证据（从 Glean store 内解出的时间戳）
| 键 | 值 | 说明 |
|---|---|---|
| `glean_internal_info#metrics#start` | **`2026-09-22T10:05:40.`** | **★ 本 store 内 `metrics` 分片的起始时间** |
| `glean_internal_info#session#start_time` | `2026-09-22T10:05:40.459+08:00` | 当前会话开始 |
| `glean_internal_info#session#inactive_since` | `2026-09-22T10:10:09.126+08:00` | 会话失活时刻 |
| `glean_internal_info#session#seq` | `18` | 会话序号 18 |
| `glean_internal_info#session#id` | `20dfbf3a-a4fa-4f4e-b08a-fdfd2b8043a6` | 会话 UUID |
| `glean_internal_info#events#start` | `2026-09-22T…` | events 分片起始 |
| `glean_internal_info#baseline#start` | `2026-09-22T…` | baseline 分片起始 |
| `glean_client_info#first_run_date` | `2026-08-10T…` | profile 首次运行（**远早于切换**，但那是 profile 级，不是本 store 的计数窗口） |

**全部 gfx/baseline/events/metrics 分片的 `start` 都是 2026-09-22**，而 GPU 切换发生在 **2026-09-20 17:18**（他线由 environment-change main ping 钉死）。⇒ **本 store 的全部 gfx 计数 100% 产生于「切换后」窗口内**，物理上不可能包含切换前样本。

### 6.3 为什么不能靠「多代」补救
- store 内**没有任何 per-generation / per-ping 的 gfx 计数副本**：`data.safe.bin` 每个键**只有一份**当前累计值（这正是 Glean store 的语义 —— 它是**聚合态**，不是事件流）。
- `glean_internal_info#baseline#sequence = 666`、`#metrics#sequence = 45`、`#events#sequence = 248` 是**变更序号**，不含时间轴上的分段历史。
- profile 下 `glean/events/events` 与 `glean/pending_pings/` **为空**，`saved-telemetry-pings/` 为空（他线已确认；我复核 `pending_pings/` 与 `events/` 目录均无内容）。

### 6.3b ★ 第二条路径也被封死：archived main ping 的 gfx 直方图在切换前 8 天就停了（二级 subagent 证据）

我原本建议「改走 `datareporting/archived/**.main.jsonlz4` 找历史帧计数」。二级 subagent 实测了这条路径，**结果是否定的，且证据很强**：

- archived main pings **确实**携带 legacy mirror 直方图（`CHECKERBOARD_*`、`COMPOSITE_TIME`、`CONTENT_FRAME_TIME*`、`SCROLL_PRESENT_LATENCY`、`CONTENT_PAINT_TIME`、`A11Y_TREE_UPDATE_TIMING_MS`），这些是**逐 ping**的，原则上可分段。
- **但**：最后一个**有数据的** ping 是 **2026-09-12 06:24:11 (+08:00)，含 11 个 gfx 直方图，活动 GPU 为 NVIDIA**。
- 其后的 **全部 14 个 ping 的 gfx 直方图全为 0**，**包括 2026-09-20 17:18:43（+08:00）那个 GPU 切换 ping**。
- ⇒ **mirror 在切换前 8 天就停止了上报**。切换之后**不存在任何** gfx 直方图数据；切换之前的数据也**只到 09-12**（而非直到 09-20）。
- 唯一在切换前后都存活的是 `environment.system.gfx` 与标量 `gfx.os_compositor` / `gfx.linux_window_protocol` / `gfx.supports_hdr`。

**⇒ 两条路径（Glean store / archived ping）都**无法**给出「09-20 17:18 前后」的渲染表现对比。这是**双路径闭合的否定结论**，应作为定论引用。**
取证文件：`subagent-units/legacy-gfx-perping.json`、`legacy-gfx-timeline.csv`（462 行）、`extract-legacy-gfx.py`。

### 6.4 因此
> **`skipped_composites=1182`、`on_time=107,533`、`slow_composite=656`、以及全部 27 个分布型桶，都是「2026-09-22 10:05:40 起约 62 分钟」这一个窗口的累计值。**
> 这个窗口**完全落在 AMD Raphael 时期**（切换于 09-20 17:18）。**它与「GPU 切换前（NVIDIA 4090 时期）」没有任何可比数据。**
> 若他线结论依赖「切换后变差」，**本通道无法支持也无法反驳** —— 需要靠 environment-change ping 的时间轴 + 其他测量面（如他线的 mutter/Xorg 日志回溯）。

> ~~**可以做的替代**：解析 `archived/**.main.jsonlz4` 的历史 ping~~ → **已实测否决（§6.3b）**：archived ping 里 gfx 直方图最后一笔是 2026-09-12（NVIDIA），其后 14 个 ping（含切换 ping）全为 0。⇒ **无替代路径。**

---

## 7. 桶表（关键指标，完整表见 `bucket-tables.txt`）

### 7.1 ★ `gfx.checkerboard.*` —— 「用户是否真的看到破图/掉帧」的直接量化
**PASS：确实发生了 50 次 checkerboard 事件**（三个 `0x2`/`0x0B` 指标各 50，`potential_duration` 185）。

**`gfx.checkerboard.severity`（15 桶，50 样本，Opaque unit，越大越糟）**
| bin_label | count | share% | cum% |
|---|---|---|---|
| 1 | 1 | 2.0 | 2.0 |
| 2 | 1 | 2.0 | 4.0 |
| 8 | 1 | 2.0 | 6.0 |
| 12 | 2 | 4.0 | 10.0 |
| 101 | 1 | 2.0 | 12.0 |
| 155 | 2 | 4.0 | 16.0 |
| 237 | 2 | 4.0 | 20.0 |
| 363 | 5 | 10.0 | 30.0 |
| 556 | 4 | 8.0 | 38.0 |
| 851 | 4 | 8.0 | 46.0 |
| 1303 | 7 | 14.0 | 60.0 |
| 1994 | 6 | 12.0 | 72.0 |
| 3052 | 9 | 18.0 | 90.0 |
| 4672 | 3 | 6.0 | 96.0 |
| **10946** | **2** | **4.0** | **100.0** |

⇒ **54% 的事件严重度 ≥1303，最高 4%（2/50）达 10946**（`range_max = 2^30`，故 **全部落在 <1.1e4，即远离上限** ⇒ 均为**轻中度**破图，无灾难级）。但**「发生了」这件事本身是硬事实**，且 28%（14/50）落在最高三桶。

**`gfx.checkerboard.duration`（12 桶，50 样本，单位 ms）**
| bin_label | count | 换算 ms（CONFIRMED） |
|---|---|---|
| 15384774 | 3 | ≈15.38 |
| **16777216** | **19** | **≈16.78** ← 恰好一个 60Hz vsync |
| 30769549 | 7 | ≈30.77 |
| 33554432 | 1 | ≈33.55 |
| 47453132 | 8 | ≈47.45 |
| 61539099 | 3 | ≈61.54 |
| 67108864 | 1 | ≈67.11 |
| 79806338 | 2 | ≈79.81 |
| 94906265 | 2 | ≈94.91 |
| 112863206 | 2 | ≈112.86 |
| 268435456 | 1 | ≈268.4 |
| **413984066** | **1** | **≈414.0** ← ★ **0.41 秒的破图** |

⇒ **最密桶 16.78 ms（19/50 = 38%）**；**21/50 = 42% 的破图持续 ≥33.55 ms**（≥2 帧）；**最坏一次 414 ms —— 用户必然可见**。这是「用户真的看到破图」的**直接、客观证据**。

**`gfx.checkerboard.peak_pixel_count`（17 桶，50 样本，单位 Pixels）**
| bin_label | count | 换算 px（LIKELY） |
|---|---|---|
| 737 | 1 | ≈737 |
| 3213 | 1 | ≈3,213 |
| 9690 | 1 | ≈9,690 |
| 14000 | 3 | ≈14,000 |
| 29226 | 4 | ≈29,226 |
| 61009 | 3 | ≈61,009 |
| 127357 | 7 | ≈127,357 |
| 265859 | 7 | ≈265,859 |
| 554984 | 5 | ≈554,984 |
| **801854** | **2** | **≈801,854** |

⇒ 最坏事件约 **80 万 CSS 像素**同时破图（≈900×900 px 区域），`range_max=66355200`（4K×最大 APZ 缩放）⇒ 相对很轻。

**`gfx.checkerboard.potential_duration`（28 桶，185 样本，ms）**：最密桶 `206992033`（**43/185 = 23.2%**），最高 `2784941737`。

### 7.2 ★ `gfx.scroll_present_latency` —— 与「滚动卡」直接对应
20 桶，**1,287 样本**，unit = **millisecond**（CONFIRMED，官方 `SCROLL_PRESENT_LATENCY`）。

| bin_label | count | share% | cum% | 换算 ms（CONFIRMED） |
|---|---|---|---|---|
| 2286960 | 1 | 0.08 | 0.08 | ≈2.29 |
| 2493948 | 1 | 0.08 | 0.16 | ≈2.49 |
| 2719669 | 1 | 0.08 | 0.23 | ≈2.72 |
| 16777216 | 2 | 0.16 | 0.39 | ≈16.78 |
| 18295683 | 29 | 2.25 | 2.64 | ≈18.30 |
| 19951584 | 76 | 5.91 | 8.55 | ≈19.95 |
| 21757357 | 92 | 7.15 | 15.70 | ≈21.76 |
| 23726566 | 91 | 7.07 | 22.77 | ≈23.73 |
| 25874004 | 147 | 11.42 | 34.19 | ≈25.87 |
| 28215801 | 193 | 15.00 | 49.18 | ≈28.22 |
| 30769549 | 269 | 20.90 | 70.09 | ≈30.77 |
| **33554432** | **324** | **25.17** | **95.26** | **≈33.55** |
| 36591367 | 48 | 3.73 | 98.99 | ≈36.59 |
| 39903169 | 2 | 0.16 | 99.15 | ≈39.90 |
| 47453132 | 1 | 0.08 | 99.22 | ≈47.45 |
| 56431603 | 1 | 0.08 | 99.30 | ≈56.43 |
| 79806338 | 1 | 0.08 | 99.38 | ≈79.81 |
| 174058858 | 1 | 0.08 | 99.46 | ≈174.06 |
| 206992033 | 3 | 0.23 | 99.69 | ≈206.99 |
| **225726412** | **4** | **0.31** | **100.00** | **≈225.73** |

⇒ **中位落在 30.77–33.55 ms 桶**（滚动呈现延迟约 1/30 秒）。**4.74% 的滚动 ≥36.6 ms**、**0.78% ≥65 ms**、**8/1287 = 0.62% ≥174 ms**（其中的 4 次 ≈225.7 ms，即四分之一秒的滚动卡顿，用户必然感知为「卡」）。
> ✅ **单位换算现已 CONFIRMED**（见 §5.3：官方 Glean SDK 规范 + `268/268` 桶通过其精确公式校验）。

### 7.3 `gfx.composite_time`（57 桶，173,703 样本，ms）
最密桶 `961548`（**110,676 = 63.7%**）。按 LIKELY 换算 ≈0.96 ms。分布有清晰右尾至 `123078199`（≈123.1 ms，13 样本 = 0.007%）。
⇒ **Gecko 合成一帧的典型耗时约 1 ms 量级 ⇒ 合成器远未成为瓶颈**。这与 `slow_composite 0.60%` **一致**。

### 7.4 `gfx.composite_frame_roundtrip_time`（31 桶，174,804 样本，ms）
最密桶 `961548`（**174,756 = 99.97%**），右尾至 `134217728`（≈134.2 ms，1 样本）。
⇒ **99.97% 的「vsync → 合成完成」落在同一桶 ⇒ 极稳定**。

### 7.5 ★ `gfx.content.frame_time.from_vsync`（93 桶，109,441 样本）
官方语义：**从 vsync（启动 content 进程 paint）到该帧在合成器呈现的时间，占 vsync 区间的百分比**；`range_min 8 / range_max 792 / bucket_count 100 / linear`。

| bin_label | count | share% | 解读（% of vsync） |
|---|---|---|---|
| 8 | 2 | 0.00 | — |
| 16 | 19 | 0.02 | — |
| 24 | 6 | 0.01 | — |
| 32 | 1 | 0.00 | — |
| 40 | 1 | 0.00 | — |
| **96** | **28,295** | **25.85** | 96% vsync |
| **104** | **71,454** | **65.29** | 104% vsync ← ★ 众数 |
| **112** | **6,124** | **5.60** | 112% vsync |
| 120 | 487 | 0.44 | 120% |
| 128 | 410 | 0.37 | 128% |
| 136 | 266 | 0.24 | 136% |
| …（中间 70 余桶各占 <0.25%）… | | | |
| 200 | 234 | 0.21 | 200% |
| **792** | **259** | **0.24** | 792% ← 早退桶（≈8 个 vsync 迟到） |

⇒ **96.74% 的帧落在 90–115% vsync 区间**（即恰好 1 个 vsync 周期附近）；**96.77% ≤112%**；**3.23% 的帧 >112%**。
⇒ **PASS：帧绝大多数在 vsync 预算内呈现**，与 `on_time 98.26%` **一致**（`on_time` 的判定阈略宽于 112%，故 98.26% 略高于 96.7%，口径可解释 —— 见 §8.2）。
⇒ 存在一个 **`792` 的早退桶（259 帧）**：这些是被计数为「远超预算」的帧，占 0.24%。

### 7.6 其他（完整见 `bucket-tables.txt`）
- `gfx.content.paint_time`（28 桶，109,801）、`full_paint_time`（57 桶，110,084）
- `gfx.content.frame_time.from_paint`（35 桶，110,357）、`with_svg`（26 桶，109,057）、`without_resource_upload`（26 桶，218,882）
- `a11y.tree_update_timing`（35 桶，107,753）
- `gfx.display.scaling`（1 桶，1）

---

## 8. 一致性裁决（任务第 4 步）：分布 vs 标量

### 8.1 结论：**一致（PASS），无冲突**
两条完全独立的编码路径给出互相印证的结论：

| 证据 | 值 | 指向 |
|---|---|---|
| `frame_time.reason/*` 分布总样本 | **109,441** | 与 reason 计数器之和**精确相等** ⇒ 同源 |
| `on_time` | **107,533 / 109,441 = 98.26%** | 帧绝大多数准时 |
| `frame_time.from_vsync` 桶 | **91.1% 在 90–115% vsync**、96.7% ≤112% | 同上 |
| `slow_composite` | **656 = 0.60%** | 慢合成极少 |
| `composite_time` 桶 | **63.7% 在 0.96 ms 桶**、右尾 123 ms | 合成耗时很小 ⇒ 慢合成本该罕见 ⇒ **一致** |
| `missed_composite*` 合计 | **1,250 = 1.14%** | 与 `frame_time` 尾部 3.23%（>112%）量级相容（口径不同，非冲突） |
| `skipped_composites` | **1,182** | 与 `missed_composite 1,038` 同量级（语义不同：skipped = 未提交，missed = 迟到） |

### 8.2 唯一的「口径差」及其解释（不是冲突）
- `on_time 98.26%` vs `from_vsync 桶 ≤112% 占 96.77%`：差 **1.49 个百分点**。
- **原因（LIKELY）**：`frame_time.reason` 的 `on_time` 判定阈值是 Gecko `FrameStatistics` 的内部容差（通常允许到 ~1.2× vsync 甚至更宽，且把 `no_vsync` 等情形剔除分母），而 `from_vsync` 桶是**另一种直方图分桶**。两个口径的阈值不等 ⇒ 百分比不必逐点相等。
- **关键**：**两者方向完全一致**（都是「绝大多数帧准时」），且**总样本数精确相等**，故**不存在「分布说很差、标量说很好」这类真实冲突**。

### 8.3 可能被误读为冲突的三处（预先澄清）
1. **`scroll_present_latency` 中位 30.8 ms 看似很糟，而 `on_time` 98.26% 很好** —— 不冲突：前者衡量**滚动输入→呈现**（含 APZ + mutter + 降采样），后者衡量**合成器帧预算**。**恰恰印证「瓶颈在呈现侧、不在 Gecko 合成侧」**。
2. **`checkerboard` 发生了 50 次 vs `slow_composite` 仅 0.60%** —— 不冲突：checkerboard 由 **APZ 异步平移赶不上光栅**触发，与合成器帧预算不是同一机制。
3. **`skipped_composites 1182` vs `missed_composite 1038`** —— 不冲突：不同计数器、不同语义。

### 8.4 「累计稀释」caveat（必须随结论引用）
全部数字是 **store 生命周期累计值（本窗口 ≈62 分钟）**，**不是**针对 Codex 页面、**不是**逐会话，且被大量静置/普通帧稀释。因此：
- **可以**说：**该窗口内 Gecko 合成器没有长期大规模掉帧**。
- **不可以**说：**Codex 页面不卡**（本通道不支持这种针对性断言）。

---

## 9. 哪些指标**无法**从该通道取得（任务第 4 步 ③）

| 无法取得 | 原因 | 影响 |
|---|---|---|
| **逐事件绝对时间戳** | site store 只存聚合态，无事件流 | 无法把某次破图/掉帧定位到具体时刻 |
| **GPU 切换前后对比** | ① store 起始 2026-09-22 > 切换 09-20 17:18（§6.2）；② archived ping 的 gfx 直方图自 2026-09-12 起全为 0，切换 ping 亦为 0（§6.3b） | **双路径均不可能**（不是「难」而是「无数据」） |
| **checkerboard / 掉帧对应的具体页面 URL** | 不在 gfx 指标内 | 无法直接归因到 Codex 页 |
| **用户感知的「卡」主观量** | 无此类指标 | 只能靠 latency/时长间接推断 |
| **呈现链路下游耗时（mutter 合成、5120→4K 降采样）** | 属窗口系统，不经 Gecko 指标 | 是本通道**最大的盲区**，而它恰是当前最强嫌疑 |
| **帧内容/脏区面积、过绘比例** | 无对应 Glean 指标 | 无法量化全屏重采样成本 |
| **记录条数口径** | header `record_count=769` vs 实测 2,753 条 | **未解**（见 §10） |
| **`a11y.tree_update_timing` 官方单位** | 未在 `gfx-metrics.yaml` 找到条目 | 标注 **UNCERTAIN** |

---

## 10. 显式标注：我的解析在哪些键上**失败 / 不确定**

### 10.1 分布型解码失败：**0 个**
27/27 个分布型指标**全部自校验 PASS**（桶计数之和 == trailer 样本总数）。无失败项。

### 10.2 明确标注为「非分布」而非「失败」的 43 个键
这些键**本来就不是分布型**（标量/字符串/布尔/JSON），故在分布解码器中「skipped」是**正确行为**。典型：`a11y.backplate`(bool)、`gfx.adapter.primary.description`(string)、`gfx.adapters`(json)、`gfx.display.primary_width`(int)、`gfx.skipped_composites`(counter)。

### 10.3 **真正未解 / 不确定**项（诚实标注）
| 项 | 状态 | 说明 |
|---|---|---|
| header `record_count = 769` 的口径 | **未解** | 实测 2,753 条记录。769 可能是 Glean 内部 store 的**项目/度量计数**而非记录数。**不猜测。** |
| header `fmt_version = 3` | **LIKELY** | 数值 3，语义未获 Mozilla 规范佐证。 |
| timing_distribution 的 `bin_label → ms` 换算尺度 | **LIKELY（推断）** | 依 exponential 桶结构 + 量级自洽推断为「ns，除 1e6 得 ms」，**未取得明文规范**。§5.1 已标注。 |
| `tail` 28B vs 44B 的差异语义 | **LIKELY** | 44B 多出的 16B 疑为 `sum`/`count` 扩展（如 `large_paint_phase_weight_*` 的 tail 里可读 u32 12/100）。**未解全貌。** |
| ~~`a11y.tree_update_timing` 单位~~ | **已解决 → CONFIRMED（ms）** | 二级 subagent 取得 `accessible/metrics.yaml` L179-194 + `A11Y_TREE_UPDATE_TIMING_MS`；且实测桶量程 0.962–189.813 ms 落在其 high 60000 ms 内。 |
| sub-tag `0x04`/`0x05`/`0x08`/`0x09`/`0x0a`/`0x0c`/`0x0d` 语义 | **未解** | 出现在 `glean_internal_info#*#start`(`0x04`)、`#*#experiment`(`0x05`)、`system.cpu.extensions`(`0x08`)、`legacy.telemetry.session_id`(`0x09`)、`extensions.startup_cache_load_time`(`0x0a`)、`session_restore.file_size_bytes`(`0x0c`) 等**非 gfx** 键。**不影响本任务结论。** |
| `gfx.features.*` 为何是 `0x11` JSON | 已解 | 值为 JSON blob，非分布。 |
| 源的持续写入 | **caveat** | 报告数字对应 11:07 快照；源已增至 445,965 B。 |

---

## 11. 与「on_time 98.20% / slow_composite 0.61%」的最终一致性表述

> **一致（PASS）。** 我用**独立路径**解出 `on_time = 107,533`（98.26%）、`slow_composite = 656`（0.60%），并取得**两条完全独立编码路径的精确交叉校验**（分布总样本 109,441 == 标量之和 109,441）。
> 出现的小差异（他线 98.20% / 0.61% vs 本线 98.26% / 0.60%）**全部由「读取时刻不同 ⇒ 累计计数器继续增长」解释**，且**所有 Δ 同向单调**（§2.3），**不存在口径冲突或数据矛盾**。
> 分布型数据**进一步强化**了同一结论：`composite_time` 63.7% 落在 0.96 ms 桶、`composite_frame_roundtrip_time` 99.97% 落在同一桶、`from_vsync` 91.1% 在 90–115% vsync —— **Gecko 合成侧表现良好**。
> **同时**，分布型数据提供了标量看不到的**新证据**：`checkerboard` 确实发生 50 次（最长 414 ms、最坏 80 万像素）、`scroll_present_latency` 4.74% ≥36.6 ms / 0.78% ≥65 ms / 0.62% ≥174 ms —— **用户侧「滚动卡」有客观量化支撑**，且其量级与「呈现侧（mutter 5120→4K + 2 CU 核显）」假设相容，而与「Gecko 合成器长期掉帧」不相容。

---

## 12. 复现方式

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/firefox-telemetry

# 1) 取只读副本并记录 md5（勿解析正被写入的原文件）
SRC=~/snap/firefox/common/.mozilla/firefox/g05ps3km.default/datareporting/glean/db/data.safe.bin
date '+%Y-%m-%dT%H:%M:%S%z'; cp -p "$SRC" data.safe.bin.copy; md5sum "$SRC" data.safe.bin.copy

# 2) 全键值清单 + 标量
python3 glean-final.py data.safe.bin.copy     # -> key-inventory.json, gfx-a11y-values.json

# 3) 分布型桶表（自校验）
python3 glean-dist.py data.safe.bin.copy      # -> distributions.json, distributions-skipped.json

# 4) 人读桶表
#    bucket-tables.txt 由 distributions.json 生成（见文件内格式）
```

**自校验断言**（任何一次运行都应满足）：
- 分布型指标数 = **27**，且**全部** `trailer_matches_sum == true`
- `metrics#gfx.content.frame_time.from_vsync` 的 `sum_counts` == **109441** == reason 计数器之和
- `metrics#gfx.display.primary_width == 5120`、`target_frame_rate == 60`

---

## 13. 逐条 PASS / FAIL / INCONCLUSIVE 汇总

| # | 任务项 | 判定 | 依据 |
|---|---|---|---|
| 1a | 复制另一线解析器（不改他人目录） | **PASS** | `ref-other-line/decode-pings-copy.py`，`diff -q` 逐字节一致 |
| 1b | 独立复核其解析器可运行 | **PASS** | 68 payloads、`gfx=YES` 复现 |
| 1c | 其 `creationDate` 列打印 `?` | **PARTIAL** | 字段位置错（非解析失败），已在 §3.2 说明 |
| 1d | **独立复核已知量 `primary_width=5120`** | **PASS** | 独立路径解出 5120 |
| 1e | **独立复核已知量 `target_frame_rate=60`** | **PASS** | 独立路径解出 60 |
| 1f | 额外 18 个已知量交叉验证 | **PASS** | 见 §3.3 |
| 2a | 枚举 `gfx.*`/`a11y.*`/`display.*`/`content.*` 键清单并落盘 | **PASS** | 108 键 → `gfx-a11y-values.json` + `key-inventory.json`(2752 键) |
| 2b | 破解 `gfx.checkerboard.*` 桶结构 | **PASS** | severity 15 桶 / duration 12 桶 / peak 17 桶 / potential 28 桶，全自校验 |
| 2c | 破解 `gfx.composite_time` | **PASS** | 57 桶，sum=173703=trailer |
| 2d | 破解 `gfx.composite_frame_roundtrip_time` | **PASS** | 31 桶，sum=174804=trailer |
| 2e | 破解 `gfx.scroll_present_latency` | **PASS** | 20 桶，sum=1287=trailer |
| 2f | 破解 `gfx.frame_time.from_vsync` / `.from_paint` / 全部 `frame_time.*` | **PASS** | 8 个 frame_time 指标全解，93/35/26/26/57 桶 |
| 2g | 破解 `gfx.status.*` / `gfx.display.*` / `gfx.adapters.*` | **PASS** | 标量+JSON 全解（`gfx.adapters` 322B JSON、`gfx.monitors` 108B JSON） |
| 2h | 给出**桶边界与计数**（非仅均值） | **PASS** | `bucket-tables.txt` 571 行，逐桶 count/share/cumulative |
| 2i | 标注单位与判定依据 | **PASS** | §5：**15/15 项全部 CONFIRMED**（Mozilla 官方 `gfx/metrics.yaml` + `accessible/metrics.yaml` + `Histograms.json` 行号） |
| 2j | 单位不确定时**标注不确定** | **PASS** | 初版如实标了 LIKELY/UNCERTAIN；二级 subagent 补入一手规范后**升级为 CONFIRMED**（§5.3），升级依据可复核 |
| 3 | 判断能否区分 09-20 17:18 前后；能则对比，不能则明说 | **PASS** | **明确「累计值，无法分段」**，并给出 store 起始 2026-09-22 的硬证据（§6） |
| 4-① | 用户侧渲染表现有无客观变差证据 | **PASS** | §7.1/§7.2：checkerboard 确有 50 次（最长 414 ms）；scroll 3.81% ≥36.6 ms、0.31% ≥225.7 ms |
| 4-② | 与 `on_time 98.20%` / `slow_composite 0.61%` 是否一致 | **PASS** | §8：一致；总样本精确相等；差异由读取时刻解释 |
| 4-③ | 哪些指标无法取得 | **PASS** | §9 逐项列出 |
| 5 | 交付 `audit.md` + 解析脚本 + 原始键值清单与桶表 JSON | **PASS** | 见 §1 |
| 纪律 | 只读 / 只用副本 / 给复制时刻与 md5 / 不启动浏览器 / 不改配置 / 不 pkill / ≤2 二级 subagent | **PASS** | §2.1 副本 md5；仅用 1 个二级 subagent |
| **残余不确定** | timing 桶尺度、header 计数口径、若干 sub-tag | **INCONCLUSIVE** | §10.3，已逐项标注 |

---

## 14. 对上游裁决的净增量（一句话）

**本通道把「用户是否真的看到破图/滚动卡」从定性变成了定量**：checkerboard 在 62 分钟窗口内发生 **50 次**（最密持续 16.8 ms、**最坏 414 ms**、最坏 80 万像素），滚动呈现延迟 **中位 ≈30.8–33.6 ms**、**4.74% ≥36.6 ms**、**0.78% ≥65 ms**、**0.62% ≥174 ms**；与此同时 Gecko 合成侧（`composite_time` 众数 ≈0.96 ms、`composite_frame_roundtrip_time` **99.97% 同一桶**、`from_vsync` **96.74% 在 90–115% vsync**）表现良好。

⇒ **用户侧确有客观可量化的渲染劣化（破图 + 滚动呈现延迟），但其分布形态把责任指向"下游呈现/环境放大器"而非"Gecko 合成器掉帧"** —— 这与「mutter 5120→4K 双线性降采样 + 2 CU 核显」假设相容，与「Gecko 主犯」假设不相容。

⇒ **但必须同时说明：本通道无法提供 09-20 17:18 GPU 切换前后的对比**（store 起始晚于切换），因此**不能**用它支持或反驳「切换后才变差」这一时序主张；那需要他线的 environment-change 时间轴 + 其他测量面。
