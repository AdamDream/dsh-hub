### 完整性校验（从原始累计快照独立重算）

- 校验窗口数：42
- 采集期 delta 与独立重算完全一致：是
- 累计指标回退窗口数：0

### 基线地板（设置页关闭，同页 10s 窗口）

| 指标 | 值 |
|---|---|
| Script | 21.1 ms/s |
| Task | 53.6 ms/s |
| RecalcStyle | 20.7 ms/s |
| Layout | 0.0 ms/s |
| 帧 p50/p95/p99/max | 16.7 / 16.8 / 16.8 / 66.7 ms |
| >50ms 帧 | 1 / 591（0.2 每百帧） |
| LongTask | 0 个，max 0.0 ms |
| WS payload 速率（payload 判别符） | session/projection 6.0/s，session/event 2.0/s |

### 逐标签（10s 打开后窗口，2 次重复取中位）

| 标签 | 状态 | 打开(ms, 变异精度) | Script ms/s | Recalc ms/s | Script 放大 | 帧 p50/p95/p99/max | >50ms 帧/百帧 | LongTask | 面板节点(稳定后) |
|---|---|---|---|---|---|---|---|---|---|
| 通用设置 | PASS | 7.7 | 12.9 | 19.1 | 0.61x | 16.7/16.8/33.3/66.6 | 0.1 | 0 | 777 |
| 模型 | PASS | 6.8 | 24.8 | 30.2 | 1.18x | 16.7/16.8/33.4/116.7 | 0.3 | 0 | 729 |
| 插件 | PASS | 10.8 | 15.1 | 25.8 | 0.71x | 16.7/16.8/25.1/100.1 | 0.3 | 0 | 1027 |
| Agent 预设 | PASS | 12.8 | 23.2 | 33.5 | 1.10x | 16.7/16.8/41.6/133.4 | 0.5 | 0 | 787 |
| 远程工作区 | PASS | 8.0 | 29.2 | 37.3 | 1.38x | 16.7/16.8/33.4/100.0 | 0.4 | 0 | 741 |
| 分布式控制 · dsh-ssh-gui | PASS | 10.4 | 20.1 | 24.7 | 0.95x | 16.7/16.8/25.1/133.3 | 0.4 | 0 | 708 |
| vision-adam 识图设置 | PASS | 6.6 | 9.3 | 14.4 | 0.44x | 16.7/16.8/33.3/83.3 | 0.1 | 0 | 717 |
| 子代理模型 | PASS ⚠饿死 | 10.1 | 7.3 | 11.1 | 0.35x | 16.7/83.4/91.8/216.6 | 11.1 | 0 | 761 |

### 逐标签（停留 20s 窗口，2 次重复取中位）

| 标签 | Script ms/s | Recalc ms/s | 帧 p50/p95/p99/max | >50ms 帧 | LongTask | DOM 节点 |
|---|---|---|---|---|---|---|
| 通用设置 | 22.7 | 31.4 | 16.7/16.8/33.4/83.3 | 3.5 (0.3) | 0 | 777 |
| 模型 | 14.9 | 19.3 | 16.7/16.8/33.3/83.2 | 1.5 (0.1) | 0 | 729 |
| 插件 | 18.6 | 32.1 | 16.7/16.8/33.4/100.1 | 6 (0.5) | 0 | 1027 |
| Agent 预设 | 23.0 | 33.0 | 16.7/16.8/41.7/116.7 | 5 (0.4) | 0 | 787 |
| 远程工作区 | 28.8 | 33.8 | 16.7/16.8/41.7/166.6 | 4.5 (0.4) | 1 | 741 |
| 分布式控制 · dsh-ssh-gui | 14.8 | 19.9 | 16.7/16.8/33.4/100.0 | 3 (0.3) | 1 | 708 |
| vision-adam 识图设置 | 9.9 | 13.9 | 16.7/16.8/25.1/316.7 | 2 (0.2) | 0 | 717 |
| 子代理模型 | 19.2 | 25.2 | 16.7/100.0/174.9/333.3 | 57.5 (7.6) | 1 | 761 |

### 逐窗口帧率（主判据；基线 59.1 fps，< 45 fps 记 ⚠）

| 标签 | r1w1 | r1w2 | r2w1 | r2w2 | 饿死窗口数 |
|---|---|---|---|---|---|
| 通用设置 | 59.2 | 58.5 | 58.8 | 57.8 | 0/4 |
| 模型 | 57.0 | 58.9 | 58.6 | 58.6 | 0/4 |
| 插件 | 59.4 | 58.0 | 57.4 | 58.0 | 0/4 |
| Agent 预设 | 56.1 | 56.0 | 57.9 | 57.9 | 0/4 |
| 远程工作区 | 57.6 | 56.1 | 56.5 | 58.2 | 0/4 |
| 分布式控制 · dsh-ssh-gui | 55.8 | 59.0 | 58.9 | 57.6 | 0/4 |
| vision-adam 识图设置 | 59.0 | 57.4 | 58.8 | 59.3 | 0/4 |
| 子代理模型 | 59.5 | 40.5 ⚠ | 24.8 ⚠ | 35.9 ⚠ | 3/4 |

### 逐标签 WS payload 速率（payload 判别符，非信封类型）

| 标签 | ws10s payload 速率 | ws20s payload 速率 |
|---|---|---|
| 通用设置 | session/projection 3.2/s，session/event 1.1/s，session/queue 0.1/s | session/projection 5.6/s，session/event 43.5/s，session/queue 0.1/s，host/session-status 0.0/s，session/jobs 0.0/s |
| 模型 | session/event 49.6/s，session/projection 6.0/s，session/queue 0.2/s，host/session-status 0.1/s | session/event 54.8/s，session/projection 3.8/s，session/jobs 0.1/s，session/queue 0.1/s |
| 插件 | session/projection 2.9/s，session/event 0.9/s，session/jobs 0.1/s | session/projection 4.0/s，session/event 1.4/s |
| Agent 预设 | session/projection 5.0/s，session/event 21.8/s | session/event 10.2/s，session/projection 4.6/s，session/jobs 0.1/s |
| 远程工作区 | session/event 78.7/s，session/projection 6.7/s，host/remote-event 0.1/s | session/event 198.7/s，session/projection 5.7/s，session/queue 0.1/s，host/session-status 0.0/s，host/session-added 0.0/s，session/subscribed 0.0/s，host/workspace-changed 0.0/s，session/jobs 0.1/s |
| 分布式控制 · dsh-ssh-gui | session/event 90.7/s，session/projection 3.9/s，host/session-status 0.1/s，session/queue 0.1/s，host/session-added 0.1/s，session/subscribed 0.1/s，host/session-removed 0.1/s | session/projection 2.9/s，session/event 18.6/s，session/queue 0.0/s |
| vision-adam 识图设置 | session/projection 1.5/s，session/event 0.5/s，session/jobs 0.1/s | session/projection 1.7/s，session/event 0.6/s |
| 子代理模型 | session/projection 0.8/s，session/event 0.3/s | session/projection 2.3/s，session/event 0.8/s |

### 判定（判据见 criteria）

| 标签 | 用户可感发现 |
|---|---|
| 通用设置 | **无**（干净） |
| 模型 | **无**（干净） |
| 插件 | **无**（干净） |
| Agent 预设 | recalc 1.613x baseline |
| 远程工作区 | recalc 1.796x baseline |
| 分布式控制 · dsh-ssh-gui | **无**（干净） |
| vision-adam 识图设置 | **无**（干净） |
| 子代理模型 | frame rate collapsed to 42.149 fps (< 45); 1 of 2 windows starved；>50ms frames 11.089/100 vs baseline 0.169/100 |
