# 锁协议（本目录）
- 共享跨线锁：.workspace/lag-fix/research-v2/.probe.lock（mkdir 原子/20-40s 重试/最长 30min/跑完 rmdir）
- 本地互斥：.workspace/lag-fix/incident2/headed-vs-headless/.lock （本线自己的串行闸）
- 纪律：浏览器串行（A→B→C 不并发）；每个 arm 单浏览器实例；只关自己 browser.close()
- 禁止：pkill / killall / 对非自己进程投信号 / 点保存应用删除
