# usage 图表改造 + btw 图像修复 · 重启验收 Runbook

批次提交：`0f2741b0`（= origin/main）｜生成：2026-09-18 ｜ 依据：真实部署盘面与落盘证据，非记忆

所有命令可直接复制执行。**预期输出**逐条给出，判据不确定的项已明确标注。

---

## 0. 前置盘面（执行前先确认）

```bash
cd /home/CNS2026495165/dsh
git log --oneline -1
git status --porcelain          # 预期：空
ps -eo pid,lstart,cmd | grep 'dsh web' | grep -v grep
curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:3080/
```
预期：`HEAD=0f2741b0`、工作区干净、**单一** dsh web 进程、`http=200`。

---

## 1. 冷/热面总览（决定"现在能看到什么"）

| 改动 | 面 | 生效条件 |
|---|---|---|
| 面积图平滑曲线 + 蓝配色、柱状图黄→橙、标签修复 | **热**（客户端 bundle） | 刷新浏览器即生效（已实测：3080 返回的 bundle 与部署位逐字节一致） |
| 小时聚合（`rpc.js` 白名单+传值、`db.js` HOUR_SQL/分支） | **冷**（宿主 ESM） | **需重启** |
| btw D1（历史图 refs 重建）、D2（白名单加 `analyze_image`） | **冷**（宿主 lib） | **需重启** |

> 未重启前面积图会显示「趋势（按日）」——这是**预期降级**：新客户端请求 `granularity: "hour"`，旧宿主以 `invalid-params` 拒绝，客户端回退到日序列而不是白屏（`client.js` 里 hour 调用刻意放在 all-or-nothing 检查之外）。

---

## 2. 刷新浏览器（验证热面，先做）

刷新 GUI 页面，看 usage 卡片：
- **趋势面板**：平滑曲线（不是折线折角），浅蓝描边 + 深蓝半透明幅底；面板标题显示「趋势（按日）」
- **柱状图**（趋势面板右上角下拉切到"柱状图"）：按日柱子呈**黄→橙**，值越大越橙（峰值日 09-12 最橙）
- X 轴标签**不再重复**（旧版小时键会退化成同一串 `09-xx`）

若柱子仍是单色 / 曲线仍是折线 → 说明浏览器缓存了旧 bundle：
```bash
curl -s "http://127.0.0.1:3080/plugins/@local/dsh-usage/client.js?rev=$(date +%s)" | grep -c 'du-trend-line'
```
预期 ≥1（=0 说明部署位文件不对，回到 §1 核对 `cmp`）。

---

## 3. 重启（冷面生效）

```bash
cd /home/CNS2026495165/dsh/.workspace/deploy-lag
./dsh-restart.sh --dry-run      # 零副作用预览：打印目标 PID / 重启命令 / 冒烟 URL
./dsh-restart.sh --yes          # 真正重启（会中断当前会话，之后重开本会话）
```
预期：dry-run 只打印不动作；`--yes` 输出 `SIGTERM → dispose → 重启 → ✅ http://127.0.0.1:3080/ (HTTP 200)`。

**重启后回到本会话跟我说一声**，我按 §4 逐项核验并贴原始输出。

---

## 4. 重启后验收矩阵

### 4.1 进程与端口（我可代跑）
```bash
ps -eo pid,lstart,cmd | grep 'dsh web' | grep -v grep
curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:3080/
```
预期：**新 PID + 新启动时刻**（与 §0 记下的旧值不同）、`http=200`。

### 4.2 宿主真的接受小时粒度（核心判据）
1. 刷新 GUI → 趋势面板标题应变成 **「趋势（3 小时合并）」**
2. 曲线形态：**连绵的日峰**（不是一排贴地尖峰串），7 天约 8 个刻度
```bash
# 旁证：宿主 SQL 两种粒度在真实库上的桶数差（不依赖 GUI）
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db=new DatabaseSync('/home/CNS2026495165/.dsh/storages/usage/usage.db',{readOnly:true});
const now=Date.now(), from=now-7*86400000;
for (const [n,sql] of [['day',\"strftime('%Y-%m-%d',ts/1000,'unixepoch','localtime')\"],['hour',\"strftime('%Y-%m-%d %H',ts/1000,'unixepoch','localtime')\"]])
  console.log(n, db.prepare('SELECT '+sql+' AS b FROM usage_events WHERE ts>=? AND ts<=? GROUP BY b').all(from,now).length);
db.close();"
```
预期：`day 6` 左右、`hour 58` 左右（hour 必须明显多于 day）。

### 4.3 btw D1：历史图恢复（关抽屉再打开）
1. 打开一条**含历史图片**的旧侧聊（例如今天 10:24 那条，或 9/17 17:57 那条）
2. 预期：历史消息的**图片缩略图回来了**（修复前：关掉抽屉再打开就消失）
3. 反证检查：修复前 `sideChat/readImage` 对历史 id 回 `Unknown attachment id`；修复后应能取到字节

### 4.4 btw D2：侧聊可用 `analyze_image`（可选，需文本模型才看得出差别）
侧聊默认模型 `deepseek-v4.1-flash` **声明了 image**、走原图直传，本来就不需要 `analyze_image`。
要验证 D2 需在抽屉里切到**不声明 image** 的模型（如 `glm-5.3`），此时模型会经 vision-adam 转文本；`analyze_image` 加入白名单意味着侧聊也有这条兜底路径。
```bash
grep -c "analyze_image" ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js   # 预期 1
```

---

## 5. 回滚

| 项 | 回滚 |
|---|---|
| usage 客户端（配色/平滑/标签/补零） | `git -C /home/CNS2026495165/dsh checkout 3029012d -- .workspace/dsh-usage-src/lib && install -m 600 .workspace/dsh-usage-src/lib/client.js ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js`，再刷新浏览器（热） |
| usage 宿主（小时聚合） | 同上把 `db.js`/`rpc.js` 换回 `3029012d` 版本后**重启一次** |
| btw D1/D2 | `cp -r /home/CNS2026495165/dsh/.workspace/backup-btw-*/* ~/.dsh/profiles/node_modules/@local/dsh-btw/`（注意：备份是 v4.1 切换前的更早态，会连带退掉后续单元）或 `git checkout 3029012d -- dsh-btw && cd dsh-btw && node_modules/.bin/tsdown` 重建后部署，再重启一次 |
| 全部 | 见上一批次的 `.workspace/RESTART-ACCEPTANCE.md` §3（已修正过的回滚表） |

---

## 6. 附：本批次已验证过的证据（不需重做）

| 验证 | 结果 |
|---|---|
| `dev/verify-trend-v2.mjs`（内联一致性 + 几何不变量） | **68/68 通过** |
| `dev/verify-inline.mjs`（既有内联校验，已补 `bucketLabel`） | **PASS** |
| 单调三次平滑最大过冲 | **0.0000 px**（不会凭空造峰） |
| 客户端补 0 / 3 小时合并 | 169 桶 → 57 桶，末桶 `hours=1` 标记部分；求和守恒 |
| 真库粒度对比（离线） | day 6 桶 / hour 58 桶 / 不传粒度仍 6 桶（向下兼容） |
| btw 类型检查（host + tests）与单测 | 通过；**233 passed | 2 skipped**（新增 D1/D2 两条） |
| btw 构建可复现性 | 未改源码直接 `tsdown` → 产物与 `lib/` 及部署位**逐字节一致** |
| 部署位一致性 | usage 4 文件 + btw index/client **逐字节一致**；`node --check` 全过 |
| 客户端热载 | 3080 返回的 `client.js` 与新部署位文件**逐字节一致** |
