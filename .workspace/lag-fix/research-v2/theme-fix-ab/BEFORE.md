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
