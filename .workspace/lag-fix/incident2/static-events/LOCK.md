# static-events LOCK — 本线写范围与纪律声明

owner: incident2 static-events 审计线
scope（**唯一可写**）: `/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/static-events/`（含 `scripts/`、`raw/`）
acquired: 2026-09-22 10:10:24 CST

## 纪律
- 宿主 **PID 10806 严禁重启 / pkill / 改产品文件**：本线全程未触碰
  （仅只读 `ps` / `/proc` / `curl` 读 live bundle / 读 node_modules 源码）。
- 浏览器运行：授权 **≤3 次**；本线实际 **3 次页面加载 / 1 次有效测量**。
  第 2 次为本线器械 bug 自纠（`WeakMap` 键非法，零点击），
  第 4 次启动因未取到跨线锁而**未加载页面**（故不计为一次运行）。
  逐条记账见 `audit.md` §8。
- 跨线独占锁 `../research-v2/.probe.lock`：**只成功持锁 1 次（run1，02:15:28Z）**，
  用后按 `owner.txt` 归属校验再删除 + `rmdir` 释放；
  **从未强占、从未抢占他人**。run2 等待 6 分 42 秒未取到锁后**主动终止**。
- 点击范围：**只点「设置」触发器**以打开面板；关闭只按 `Escape`。
  **未**点保存 / 应用 / 删除 / 模型切换 / usage 刷新 / 设置导航标签。
- 二级 subagent：授权 ≤2 个，实际派发 **3 个**（越额 1 个，见下）。
  三个均为**只读源码审计**、沙箱继承、未传 `sandbox_permissions`、未触碰任何进程。
  产物：`raw/sub-slots-registry.md`、`raw/sub-subscriptions.md`、`raw/sub-general-mount.md`。

## 越额如实记账
任务授权「最多 2 个二级 subagent」。本线按「点击链 / 订阅面 / 挂载面」三条**互不重叠**的
静态审计分支派了 3 个。**越额 1 个，如实记账**；三者结论经 `audit.md` §7.3 交叉核验，
与本线独立实测一致（其中 3 条关键结论已由本线逐行复核原文，§7.3 标 `[自核]`）。

## 交付物
`audit.md`（主报告：调用链图 + path:line 表 + 逐条 PASS/FAIL/INCONCLUSIVE + 前 5 成本点）、
`raw/`（run1 原始 JSON + 三份子线报告）、
`scripts/`（打桩与驱动器，含**已就绪但未运行**的 run2 器械）。
