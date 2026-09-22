# raw/ 证据索引（provenance）

所有文件均由 `probe*.mjs` 在页面内插桩（`lib-instrument.mjs`，只做观测式包装）后落盘。
时间戳为 UTC（本地 = UTC+8）。`analysis.json` 由 `analyze.py` 从这些文件复算，可重跑。

| 文件 | 对应探针 | 说明 |
|---|---|---|
| `click-raw-2026-09-22T03-05-16-050Z.json` | probe1（**失败运行**） | 忘了挂 `addInitScript`，`window.__PP__` 未定义 → 三个场景全 `error`。保留仅作过程记录，**不要用于任何结论**。 |
| `click-raw-2026-09-22T03-05-41-992Z.json` | probe1（超时被 SIGTERM 截断） | 同样**不可用于结论**（输出被 60 s 工具超时杀掉）。 |
| `click-raw-2026-09-22T03-06-46-699Z.json` | probe1（有效） | 首轮有效数据。含两个后来被证实的 rig 假象：① 导航点击的 `watch` 等了永不出现的 `plugin_entries` → CDP 窗口被拉长到 30 s（`Timestamp` delta ≈ 30.03 s）；② 阳性对照用 `Runtime.evaluate` 注入 → LongTask 报 0（通道盲区，见 `click2` 的三路对照）。 |
| `click2-raw-2026-09-22T03-12-41-979Z.json` | probe2（主证据） | 紧窗口（watch 只等 primary 选择器）+ 8 次导航点击 / 6 次 tab 点击序列 + **三路注入阳性对照** + 每次点击前的 300 ms 配对空闲窗。 |
| `click3-raw-2026-09-22T03-14-38-726Z.json` | probe3 | SVG/DOM 结构归因（178 SVG = 177 chevron + 1 搜索图标）+ 配对空闲窗（250/500 ms ×3）+ 搜索过滤序列（**被突发噪声污染，不可用于定斜率**）。 |
| `click4-raw-2026-09-22T03-15-25-845Z.json` | probe4 | `DOMDebugger.getEventListeners`：card `<button>` = 1 个 click、`<li>`/`<strong>`/`<svg>` = 0。 |
| `click5-raw-2026-09-22T03-16-31-387Z.json` | probe5 | `--force-renderer-accessibility` A/B（用户 Chrome 实开该 flag）。 |
| `host-rpc-bench.json` | 无浏览器 | 直接 HTTP 打 `/api/pluginInventory/list`（177 条 / 21.7 KB）vs 9 字节对照 `/api/agentPreset/list`，各 n=40×2。 |
| `discover.json` + `discover-*.png` | discover.mjs | 设置面板结构、默认 tab 现场证据（点击「插件」落在 `插件配置`，非 `插件列表`）。 |
| `user-chrome-cmdline.txt` | `ps` 只读快照 | 用户 Chrome 启动参数：`--force-renderer-accessibility --ozone-platform=x11`。 |

## 纪律与边界
- 全程单浏览器实例串行；只点「设置 / 通用设置 / 插件 / 插件列表 tab」与搜索框输入；**未点保存/应用/删除/禁用**。
- 未重启宿主（PID 301709 全程存活）、未 pkill 用户浏览器（PID 303448 全程存活）、未改任何产品文件（宿主侧全部只读定位到 `path:line`）。
- 共享锁 `research-v2/.probe.lock`：我在 03:00:33Z 写入 `owner.txt` pid=310374；**03:17:52Z 被另一条线（pid 408162）替换**，其 owner.txt 我未删除。
