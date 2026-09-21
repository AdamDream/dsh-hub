### 完整性校验（从原始累计快照独立重算）

- 校验窗口数：42
- 采集期 delta 与独立重算完全一致：是
- 累计指标回退窗口数：0

### 基线地板（设置页关闭，同页 10s 窗口）

| 指标 | 值 |
|---|---|
| Script | 48.8 ms/s |
| Task | 105.2 ms/s |
| RecalcStyle | 43.1 ms/s |
| Layout | 0.0 ms/s |
| 帧 p50/p95/p99/max | 16.7 / 16.8 / 33.4 / 66.7 ms |
| >50ms 帧 | 6 / 572（1.0 每百帧） |
| LongTask | 0 个，max 0.0 ms |
| WS payload 速率（payload 判别符） | session/event 69.8/s，session/projection 11.7/s |

### 逐标签（10s 打开后窗口，2 次重复取中位）

| 标签 | 状态 | 打开(ms, 变异精度) | Script ms/s | Recalc ms/s | Script 放大 | 帧 p50/p95/p99/max | >50ms 帧/百帧 | LongTask | 面板节点(稳定后) |
|---|---|---|---|---|---|---|---|---|---|
| 通用设置 | PASS | 8.4 | 54.6 | 65.6 | 1.12x | 16.7/33.4/50.1/133.3 | 1.6 | 0 | 772 |
| 模型 | PASS ⚠饿死 | 24.2 | 69.6 | 85.9 | 1.43x | 50.0/116.6/158.3/183.3 | 31.9 | 1 | 728 |
| 插件 | PASS ⚠饿死 | 20.1 | 63.4 | 104.9 | 1.30x | 16.7/83.3/125.0/216.6 | 19.1 | 1 | 1025 |
| Agent 预设 | PASS | 8.5 | 56.8 | 83.3 | 1.16x | 16.7/41.5/58.5/150.0 | 1.8 | 0 | 786 |
| 远程工作区 | PASS | 13.1 | 34.4 | 44.0 | 0.71x | 16.7/25.1/50.0/100.0 | 1.2 | 1 | 740 |
| 分布式控制 · dsh-ssh-gui | PASS | 7.3 | 26.1 | 35.6 | 0.54x | 16.7/16.8/33.4/83.4 | 0.2 | 0 | 707 |
| vision-adam 识图设置 | PASS | 9.3 | 30.6 | 34.5 | 0.63x | 16.7/16.8/50.0/283.3 | 0.8 | 0 | 716 |
| 子代理模型 | PASS | 7.5 | 29.8 | 35.5 | 0.61x | 16.7/33.3/50.0/150.0 | 0.9 | 2 | 760 |

### 逐标签（停留 20s 窗口，2 次重复取中位）

| 标签 | Script ms/s | Recalc ms/s | 帧 p50/p95/p99/max | >50ms 帧 | LongTask | DOM 节点 |
|---|---|---|---|---|---|---|
| 通用设置 | 63.7 | 85.1 | 16.7/33.3/66.7/116.6 | 17 (1.6) | 0 | 776 |
| 模型 | 95.3 | 113.7 | 33.4/108.3/158.3/316.6 | 98.5 (27.5) | 2 | 728 |
| 插件 | 65.8 | 115.0 | 16.7/50.0/100.0/200.0 | 39 (4.3) | 3 | 1025 |
| Agent 预设 | 67.4 | 96.6 | 16.7/50.0/91.6/200.0 | 44 (5.2) | 0 | 786 |
| 远程工作区 | 41.5 | 51.5 | 16.7/25.1/41.7/183.3 | 10 (0.9) | 0 | 740 |
| 分布式控制 · dsh-ssh-gui | 28.4 | 36.5 | 16.7/16.8/41.7/283.3 | 5.5 (0.5) | 0 | 707 |
| vision-adam 识图设置 | 25.4 | 29.6 | 16.7/16.8/41.7/183.4 | 6 (0.5) | 0 | 716 |
| 子代理模型 | 44.5 | 54.1 | 16.7/33.3/58.4/150.0 | 14.5 (1.3) | 0 | 760 |

### 逐窗口帧率（主判据；基线 57.2 fps，< 45 fps 记 ⚠）

| 标签 | r1w1 | r1w2 | r2w1 | r2w2 | 饿死窗口数 |
|---|---|---|---|---|---|
| 通用设置 | 54.5 | 54.3 | 50.9 | 52.8 | 0/4 |
| 模型 | 41.2 ⚠ | 15.0 ⚠ | 13.2 ⚠ | 42.3 ⚠ | 4/4 |
| 插件 | 52.9 | 51.0 | 20.1 ⚠ | 43.0 ⚠ | 2/4 |
| Agent 预设 | 49.1 | 40.9 ⚠ | 56.1 | 54.5 | 1/4 |
| 远程工作区 | 54.6 | 54.4 | 56.4 | 56.7 | 0/4 |
| 分布式控制 · dsh-ssh-gui | 57.4 | 57.0 | 59.0 | 56.0 | 0/4 |
| vision-adam 识图设置 | 55.8 | 56.3 | 55.5 | 57.4 | 0/4 |
| 子代理模型 | 54.5 | 53.4 | 54.3 | 54.5 | 0/4 |

### 逐标签 WS payload 速率（payload 判别符，非信封类型）

| 标签 | ws10s payload 速率 | ws20s payload 速率 |
|---|---|---|
| 通用设置 | session/event 186.9/s，session/projection 10.8/s，session/jobs 0.1/s，session/subscribed 0.1/s，host/session-added 0.1/s | session/event 132.9/s，session/projection 14.9/s，session/jobs 0.1/s，question/resolved 0.0/s，session/subscribed 0.0/s，host/session-added 0.0/s |
| 模型 | session/event 39.2/s，session/projection 9.3/s，session/queue 0.1/s，host/session-status 0.1/s | session/event 92.0/s，session/projection 11.1/s，session/jobs 0.1/s，host/session-status 0.0/s，session/queue 0.1/s |
| 插件 | session/event 57.1/s，session/projection 8.7/s | session/event 40.5/s，session/projection 11.5/s，question/requested 0.0/s，host/session-status 0.0/s，session/queue 0.1/s，host/session-removed 0.0/s |
| Agent 预设 | session/event 25.5/s，session/projection 12.8/s | session/projection 13.3/s，session/event 52.5/s，session/queue 0.1/s，session/jobs 0.0/s，question/resolved 0.0/s |
| 远程工作区 | session/event 100.9/s，session/projection 8.8/s，session/queue 0.1/s | session/event 133.8/s，session/projection 10.2/s，session/queue 0.1/s，session/jobs 0.0/s |
| 分布式控制 · dsh-ssh-gui | session/projection 6.4/s，session/event 2.3/s，session/jobs 0.1/s | session/event 31.4/s，session/projection 6.5/s，session/jobs 0.1/s，session/queue 0.0/s |
| vision-adam 识图设置 | session/event 278.9/s，session/projection 5.3/s | session/event 177.7/s，session/projection 5.3/s，session/jobs 0.1/s |
| 子代理模型 | session/event 73.1/s，session/projection 5.8/s | session/event 122.0/s，session/projection 9.7/s |

### 判定（判据见 criteria）

| 标签 | 用户可感发现 |
|---|---|
| 通用设置 | recalc 1.523x baseline |
| 模型 | frame rate collapsed to 27.196 fps (< 45); 2 of 2 windows starved；recalc 1.993x baseline；>50ms frames 31.944/100 vs baseline 1.049/100；1 longtask(s), max 50ms |
| 插件 | frame rate collapsed to 36.498 fps (< 45); 1 of 2 windows starved；recalc 2.433x baseline；>50ms frames 19.139/100 vs baseline 1.049/100；1 longtask(s), max 50ms |
| Agent 预设 | recalc 1.934x baseline |
| 远程工作区 | 1 longtask(s), max 87ms |
| 分布式控制 · dsh-ssh-gui | **无**（干净） |
| vision-adam 识图设置 | **无**（干净） |
| 子代理模型 | 2 longtask(s), max 97ms |
