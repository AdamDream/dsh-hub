# R4 交接与 Runbook（重启前后都可照做）

**本轮目标**：只闭环 R4 —— usage 旧响应覆盖 + 宿主 bootstrap 生命周期。**不含** 设置 memo / C2 observer / ingest worker / P2 / B1 / B2 phase2。

**当前状态（2026-09-21）**

| 面 | 文件 | sha256 | 生效方式 | 状态 |
|---|---|---|---|---|
| client | `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` | `cdbd87b6…` | client 热面（刷新即生效） | ✅ 已生效 + 端到端验证 |
| host | `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js` | `743469a5…` | **冷面，需重启宿主** | ⏳ 已部署待加载 |
| source | `dsh-usage/lib/{client,index}.js` | 见 `git diff` | 工作区 | ✅ 已改 |

pre-image 备份：`.workspace/lag-fix/backup/R4-deployed-20260921063032./{pre-client.js,pre-index.js}`

---

## 一、重启（使宿主半生效）

```bash
cd /home/CNS2026495165/dsh
bash .workspace/workstreams/deploy/deploy-lag/dsh-restart.sh --dry-run   # 预览：应锁定 node .../bin/dsh web
bash .workspace/workstreams/deploy/deploy-lag/dsh-restart.sh --yes       # SIGTERM → 启动 → 冒烟 200
```

> 重启会打断正在跑的对话回合（agent 跑在宿主进程里）；会话本身持久化、浏览器自动重连。

## 二、重启后验收（三条，缺一不算闭环）

```bash
# ① 插件是否正常加载（若守卫代码有未声明标识符，这里会立刻暴露）
curl -s -X POST http://127.0.0.1:3080/usage/status -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r4-1","method":"status","payload":{}}' | head -c 300

# ② 会话列表回归哨兵（防 B1 式事故）
curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r4-2","method":"session.list","payload":{}}' | head -c 200

# ③ 客户端守卫端到端判定（期望 verdict=PASS，终值 222222、旧哨兵不出现）
node .workspace/lag-fix/r4-delivery/client-stale-probe.mjs --label after-restart
```

## 三、宿主守卫行为测试（可随时重跑，不依赖运行中的宿主）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/r4-delivery/host-harness
node run.mjs --target ../candidate/index.js        # 期望 13/13 PASS
node run.mjs --target ../backup-pre/index.js       # 期望 FAIL（反证测试台有证伪能力）
```

## 四、回滚（只回 R4，不动其它单元）

```bash
B=/home/CNS2026495165/dsh/.workspace/lag-fix/backup/R4-deployed-20260921063032.
D=/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib
cp "$B/pre-client.js" "$D/client.js"    # 热面：刷新即生效
cp "$B/pre-index.js"  "$D/index.js"     # 冷面：需再重启
sha256sum "$D/client.js" "$D/index.js"  # 期望 eeb5dcf2… / 49f648c4…
```

## 五、重放（部署件被其它批次覆盖后）

```bash
node .workspace/lag-fix/r4-delivery/apply-R4-deployed.mjs            # dry-run：14 处锚点逐一校验 + 候选产物 node --check + 引入标识符校验
node .workspace/lag-fix/r4-delivery/apply-R4-deployed.mjs --apply    # 真写（自动 pre-image 备份）
```

> 脚本 fail-closed：任一锚点命中数 ≠ 1，或引入标识符在本文件内无声明，即拒绝写入。

---

## 未闭环项（不得当成已完成）

1. **重启后 host 半的实效**：只差 §一 + §二①②。
2. **R1 设置 memo / R3 C2 订阅边界**：根因假设已被执行前复核**推翻**（`SettingsRoot` selector 早返回 boolean；`useSyncExternalStoreWithSelector` 比较选择结果；`SessionMaybeProvider` 订阅稳定 provideInfo；C2 生产已有 pendingScan + 300ms）。要动，必须先做活跃流下的 **React commit 计数**。
3. **R7 ingest worker**：仅设计（见 `ingest-gate/audit.md`），需先做合成 fixture 对拍；不得只换 index 的 fold 调用就部署。
4. **R5 B1 冷排序 / P2 stale row / R6 测量框架硬化**：未动。
