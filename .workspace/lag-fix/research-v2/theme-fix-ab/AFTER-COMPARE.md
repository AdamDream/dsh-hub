# 主题修复 A/B 结果与裁决（before-vs-after）

- 采集：`exec-theme/experiments/run-theme-experiments.sh before|after`，8 变体 × 3 场景 × 每窗门禁
- 门禁：全部窗口 `gateOutcome=EXCLUSIVE`（`before` 24 窗口、`after` 24 窗口）
- 生效证据：宿主注入 rev = 磁盘 sha1-12（`ui-layout 82cca1a6178a`、`wallpaper 826d9217a8fc`），服务端下发同值 ⇒ 页面刷新即生效

## 一、预注册判据的机械裁决：**BATCH VERDICT: FAIL**

原始输出（`theme-ab.mjs --compare`）三场景全部 FAIL，触发条目如下：

| 场景 | 触发条目 |
|---|---|
| home-idle | `P1: rafOver50 drop 0.2 < 0.5` |
| long-session-idle | `reconcileRatio 0.773 outside 0.9-1.1 (instrument is not trustworthy)` |
| settings-dwell | `reconcileRatio 0.701 outside 0.9-1.1 (instrument is not trustworthy)` |

## 二、实际数值（每场景逐条）

| 判据 | home-idle | long-session-idle | settings-dwell |
|---|---|---|---|
| `apply/s`（PRIMARY） | 7.156 → **0**（drop 1.0） | 6.516 → **0**（1.0） | 5.219 → **0**（1.0） |
| `applyMs/s`（PRIMARY） | 11.064 → **0** | 56.119 → **0** | 57.063 → **0** |
| `rafOver50`/窗（PRIMARY） | 1.25 → 1（drop 0.2 ✗） | 5.875 → **0.75**（0.872 ✓） | 5.875 → **0.75**（0.872 ✓） |
| `rafP50`（SENTINEL） | 16.7 → **16.7** ✓ | 16.7 → **16.7** ✓ | 16.7 → **16.7** ✓ |
| `reconcileRatio`（PRIMARY） | 0.943 → 0.9 ✓ | **0.647** → 0.773 ✗ | **0.772** → 0.701 ✗ |
| nodes（同尺度） | 621.8 → 605.1 ✓ | 2842.3 → 2851 ✓ | 3022.4 → 3022 ✓ |
| ref `RecalcStyle/Task` | 0.16 → **0.049** | 0.235 → **0.039** | 0.249 → **0.062** |
| ref `raf/s` | 60.25 → 60.48 | 57.06 → **60.44** | 53.45 → **60.37** |
| ref `rafP99` | 16.8 → 16.8 | 50.08 → **16.8** | 68.79 → **16.8** |
| ref `applyMs/busyMs` | 0.255 → 0 | 0.295 → 0 | 0.405 → 0 |

## 三、协调者裁决

**结论：主效果达成；机械 FAIL 成立但不构成"修复无效"。两条 FAIL 触发器的性质已查明，且都在修复前后同源。**

1. **`rafOver50` 在 home-idle 是地板效应**：基线仅 **1.25 帧/窗**，"降幅 ≥50%" 在该场景**不可满足**（从 1.25 到 1 已是下限附近）。该判据只对有 headroom 的场景有意义——long/dwell 两场景实测 **drop 0.872 ✓**。
2. **`reconcileRatio` 是器械自检，且基线同样带外**：`reconcileRatio = busyMs ÷ (ScriptDuration + RecalcStyleDuration)`，判据只检查 **after** 是否落在 0.9–1.1；但 **before 自身是 0.647 / 0.772，同样带外** ⇒ 该比率在本工作负载下**系统性偏移**，与已确立的事实同源（`apply ÷ ScriptDuration = 2.5–3.8×`：profile 归因帧含 Blink 强制重算时间，与 CDP 的 JS 计时不是同一把尺）。**它拒绝的是器械，且在修复前就拒绝了** ⇒ 不能作为否定修复的证据。

**处置（不洗绿、不改判据）**：
- **FAIL 原样保留在报告与台账里**，并附本节说明；**不**事后放宽 `rafOver50` 或 `reconcileRatio` 阈值。
- 两条判据的正确修法是**重新定义**（而非放宽）：① `rafOver50` 增设"基线 <5 帧/窗时改用绝对阈值（≤1 帧/窗）"的分支；② `reconcileRatio` 的分母改用**含强制重算的归因口径**或直接改为"同窗相对比较 + 绝对值不参与判定"。**修订须由审计确认后再采纳**，本轮不动。
- **可对外表述**：`apply` 的每次重放被完全消除（`apply/s` 与 `applyMs/s` 归零、`applyCalls` 70/31 → **0**），长会话与设置停留的 **p99 从 50.1/68.8 ms 降到 16.8 ms**、**raf/s 升到 ~60.4**、**每窗 >50ms 帧从 5.875 降到 0.75**、`RecalcStyle÷Task` 从 0.235/0.249 降到 0.039/0.062，同时 `rafP50` 哨兵与节点尺度不变（"没坏"）。
- **边界照旧**：apply 归零后仍有 **65–100 ms/s 未归因残留**（审计 §6.3），**本批不宣称"卡顿已解决"**。

## 四、单元 (0) 状态（仍未定性，且现已大概率失效）

`after` 批的 v2 探针输出 **`determination = NOT-OBSERVED`**（`applyCalls=0`、`bursts=0`），并明确声明"这对实例数什么也没说，**不是** single presenter"；
其 stack 通道的 preflight 自证仍未通过（`svDelta=0`，合成帧未捕获）。⇒ **单元 (0) 无法据此关闭**，但也**不再紧迫**：
修复后 `apply` 在窗口内**零工作**（`applyCalls` 70/31 → 0），即使存在多 presenter 也已不再产生可测成本。
<b>后续</b>：若要把 (0) 用于进一步收益，需先修好 stack 通道自证或改用 cordis 旁路（探针自陈 `window.__ModuleLoader__.__loader is not exposed`）。
