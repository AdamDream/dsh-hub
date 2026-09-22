# tab-switch LOCK — 本线写范围与纪律声明

owner: incident2 tab-switch 审计线（设置页栏目切换 / 滚动卡顿）
scope（**唯一可写**）: `/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch/`

## 锁协议
- 共享跨线独占锁：`/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock`（目录）
  - 取得：启动任何浏览器**之前** `mkdir`（原子，EEXIST=被占用）；重试 15–20s；最长等 25min
  - owner.txt：`agent / pid / started_at / purpose`
  - 释放：`rm owner.txt && rmdir`（先校验 owner.txt 归属，绝不强占）
  - 非浏览器工作（静态读码、复算、写文档）**不持锁**
- 本地互斥闸：`./.lock`（本线自己的串行闸）
- 并发门禁：每窗口前/后各断言一次「系统主浏览器实例数 − 自身实例数 == 0」；
  按 `/proc/*/exe` 精确统计（**禁用会自匹配的 `pgrep -f`**，见 incident2 §六.1）。
  未达标的窗口标 `invalid`，结论标 INCONCLUSIVE。

## 纪律
- 宿主 **PID 301709 严禁重启 / pkill**；不 pkill 用户浏览器；不改产品文件。
- 单浏览器实例串行（A→B→C 不并发）；只关自己的 `browser.close()`。
- **点击范围**：只点「设置」触发器、设置面板内**栏目导航标签**、关闭（Escape / 遮罩）。
  **不点**保存 / 应用 / 删除 / 模型切换 / usage 刷新 / 任何写入路径。
- 滚动：仅在设置面板容器内**程序化**滚动（`scrollTop` 赋值），不注入滚轮事件到宿主。
- 子代理授权 ≤2 个；继承沙箱、禁止 `sandbox_permissions`。

## 交付物
`audit.md`（主报告，逐条 PASS/FAIL/INCONCLUSIVE）、`raw/`（原始 JSON）、`scripts/`（器械）。
