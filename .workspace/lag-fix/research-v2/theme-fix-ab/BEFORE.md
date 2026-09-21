# 主题修复 A/B：修复前基线（门禁全通过）

- 时间：2026-09-21 16:39–16:47（本地）
- 采集：`cpu-profile/scripts/capture6.mjs --scenarios home-idle,settings-general-open,settings-dwell,long-session-idle --reps 2 --win 20000 --stamp before-theme`
- **门禁**：每窗 `foreign=0 / mine=1 / lock=MINE` ⇒ **8/8 窗口 EXCLUSIVE**（本机首个门禁全通过批次）
- 宿主 PID 1390375（未重启）；锁由协调者持有并如实标注归属（`capture6` 的 `lockHeldByMe` 判据 = owner.txt 前两行含 "cpu-profile"）

## 一、修复前实测

| 场景 | n | script ms/s | task ms/s | recalc ms/s | layout ms/s | busy ms/s | raf/s | raf p50 | raf >50ms | LongTask | 第一热点 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| home-idle | 2/2 | 23.6 | 63.4 | 22.3 | 0.03 | 45.7 | 60.4 | 16.7 | **2** | 0 | **apply 46.2** |
| long-session-idle | 2/2 | 28.8 | 293.1 | 99.9 | 33.8 | 123.1 | 55.6 | 16.7 | **39** | 0 | **apply 185.0** |
| settings-general-open | 2/2 | 26.4 | 359.3 | 117.3 | 46.7 | 129.2 | 54.6 | 16.7 | **24** | 0 | **apply 206.7** |
| settings-dwell | 2/2 | 24.1 | 352.6 | 108.8 | 44.3 | 118.7 | 51.8 | 16.7 | **44** | 5 | **apply 193.4** |

逐窗 `top` 全部为 `apply@dsh-client-ui-layout/client.js:366`（8/8）。`errors: []`。

派生比值（修复前）：
- `recalc ÷ task` = **34.1% / 34.1% / 32.6% / 30.9%**（home / long / settings-open / dwell）
- `layout ÷ task` = 0.04% / 11.5% / 13.0% / 12.6%
- `script ÷ task` = 37.2% / 9.8% / 7.4% / 6.8%

## 二、⚠️ 阈值必须重新推导（重要裁决）

主题审计给出的验收阈值（`RecalcStyle÷Task 60%→≤15%`）是在**受污染批次**上定的，而**独占基线实测是 31–35%，不是 60%**。
⇒ **不得沿用那条绝对阈值**（它会把"正常"判成"失败"）。本批次改用**相对降幅**（同门禁、同场景、同窗口长度）：

| 判据 | 修订后的形式 |
|---|---|
| 主判据 | `apply` 自时间 **相对降幅 ≥50%**（4 场景中 ≥3 场景成立，且方向一致） |
| 伴随判据 | `recalc ÷ task` 与 `apply` 自时间**同向**下降（证明 recalc 确由 apply 引发） |
| 可感判据 | `raf >50ms` 帧数在 long-idle / dwell 两场景**相对降幅 ≥50%** |
| **"没坏"哨兵** | `raf p50` **保持 16.7ms**；`errors: []`；主题功能（dark/light、壁纸、locale、token 覆盖）逐项可用 |

**条件**：`after` 批次必须同样满足 `foreign=0 / lock=MINE`；若做不到，只报相对比值并标 INCONCLUSIVE。

## 三、修复后（待采）

落主题批（热面）后，用**完全相同的命令**但 `--stamp after-theme` 重跑，按 §二 判据比对。

---

## 四、单元 (0)「实例去重」的开闸探针：**结论无效（协调者核实）**

执行档交付的 `exec-theme/experiments/probe-instances.mjs` 在两个场景下均输出 `instances=0 / urls={}` 与
`VERDICT: single presenter — unit (0) has nothing to remove in this window`。**但同一窗口 `data.applyCalls = 70 / 31`**，
且 **`data.sample` 为空**（栈扫描一帧都没记录）。

⇒ **"instances=0" 是探测器失效，不是"单实例"**：`Error.prepareStackTrace` 路径未能捕获任何 `apply` 帧。
⇒ 与执行档此前用 profile `bundles[].fns` 数出的「line 366 函数对象 **4/4**（home-idle）、**6**（settings-open / models-tab）」**直接矛盾**。
⇒ **裁决**：单元 (0) 仍**未定性**，退回返工（要求：器械自证 + 第二种独立口径复核 + 明确 `instanceCount` 与 `applyCalls` 的口径差异）；
**不得**用空样本关闭该单元，也**不得**据此宣称"单 presenter"。

### 4.1 探针顺带产出的一条可用事实（并推翻该档一处静态结论）
`body background rules` 实测**存在** `body{background: var(--dsw-alias-bg-base, #fff)}`，
且四值相等：`computedBodyBackgroundColor == inlineTokenBgBase == computedBodyBgBaseToken == themeColorMetaContent`
（本次均为 `rgba(255, 255, 255, 0.88)`）。
⇒ 该档"**没有任何规则给 body 设 background**"的静态结论**是错的**（它据此否决 ii-a）。
⇒ 但 `(ii-b)` 仍应保留：它读的是**计算值本身**，在 token 未定义/被第三方覆盖时同样保值；`(ii-a)` 依赖"token 存在且等于计算值"这一前提。

## 五、协调者对执行档三处偏离的裁决

| 偏离 | 裁决 | 理由 |
|---|---|---|
| `(ii-b)` 取代审计首推的 `(ii-a)` | **接受** | 真实理由是**无条件保值**（不是该档给出的"无 body background 规则"——那句已被 §4.1 推翻） |
| 守卫 `appliedTokens` → `lastTokens` | **接受** | 原守卫因 `:373` 先清空而**恒真**（等价无守卫），属真实缺陷修正 |
| 阈值逐字抄自审计 §4 | **部分接受** | 相对降幅类判据为主；`recalcOverTask ≤0.15`、`applyMs/busyMs ≤0.10` 等**绝对值取自受污染批**（独占实测 31–35%）⇒ 仅作参考并在报告标注来源 |

