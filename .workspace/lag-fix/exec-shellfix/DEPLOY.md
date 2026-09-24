# DEPLOY.md — ShellFix v1 落地与回滚手册（U-SH1 / U-SH2 / U-SH3）

> 本档（`exec-shellfix`）**未写入任何部署路径**：`dsh-client-ui-layout` 全树对本档只读。
> 候选字节、补丁脚本、验证证据全部落在 `.workspace/lag-fix/exec-shellfix/`。
> **落地由协调者执行**（写 `dsh-client-ui-layout` 会触发用户页面 HMR 热刷新 ⇒ 需明确要求用户强刷）。

---

## 0. 落地集合

| 项 | 值 |
|---|---|
| 推荐落地单元 | **`--units=ush1,ush2,ush3`**（= `candidates/deploy.*`） |
| 不落地 | **`ush4`**（收益缺乏可感证据且与审计预期相反，见 report.md §5） |
| 目标文件 1 | `$H/dsh-client-ui-layout/lib/client.js`（**热面**：`/plugins/<id>/client.js?rev=` 直服，刷新即生效，无需重建 Web 产物、无宿主改动） |
| 目标文件 2 | `$H/dsh-client-ui-layout/lib/types/client/columns.d.ts`（**纯文档**，类型声明；无运行时作用） |
| `$H` | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` |

### 基线（落地前必须逐字节相符，脚本会强制校验 client.js）

| 文件 | md5 | 行数 |
|---|---|---|
| `lib/client.js` | `ed91f7f345cb91c87a941088fc5dba71` | 907 |
| `lib/types/client/columns.d.ts` | `5cc5169b7511062170f442167b08c904` | 60 |

### 候选（本档验证过的字节）

| 文件 | md5 | 行数 | 说明 |
|---|---|---|---|
| `candidates/deploy.client.js` | **`feaedc5d28fcfb5c29ec59036bf65cce`** | 1028 | **落地目标字节**（ush1+ush2+ush3；含'取消处理器挂到渲染 props'修正） |
| `candidates/deploy.columns.d.ts` | `66e47c34a0f1983f91aa2a511cb85eef` | 68 | 文档改口径 |
| `candidates/ush4-only.client.js` | `3f7f90b1960b426a0ccea20799a047ef` | 911 | **候选，仅供 A/B；不落地** |

---

## 1. 落地（推荐路径）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-shellfix

# ① 干跑（零写入）：核对锚点唯一命中 + 依赖序
node tools/apply-ShellFix-v1.mjs --units=ush1,ush2,ush3

# ② 落地（自动 pre-image + node --check + 原子 rename；锚点非唯一则整轮零写入）
node tools/apply-ShellFix-v1.mjs --apply --units=ush1,ush2,ush3 \
     --json=raw/apply-DEPLOY.json
```

脚本行为保证：

1. **dry-run 默认**：不带 `--apply` 零写入。
2. **锚点唯一命中否则零写入**：任一 span 的 `old` 命中数 ≠ 1 ⇒ 整轮放弃，不写一个字节。
3. **自动 pre-image**：首次写入前 `cp <target> <target>.pre-ShellFix-v1.bak`（已存在则不覆盖），
   sha256 前后值写进 `raw/apply-DEPLOY.json`。
4. **`node --check`**：`client.js` 先写 `<target>.shellfix-v1.tmp.js` 做语法检查，通过才原子 `rename`；
   失败即删除临时文件并中止。`.d.ts` 用括号配平检查（TS 语法 `node --check` 不支持）。
5. **幂等**：单元新文本已存在 ⇒ 报 `already-applied` 并跳过，重复执行不产生二次改写
   （实测：二次 `--apply` 后 md5 不变）。
6. **每单元独立回滚**：见 §2。

### 落地后必须让用户做的事

- **强刷页面**（Ctrl+Shift+R）。客户端插件字节变更会被 HMR 热刷，但用户需强刷以确保拿到新字节；
  强刷同时清掉拖拽残留（U-SH1③ 修复后不再需要，但旧会话的 `data-dragging` 残留只能靠 reload 清）。
- 校验新字节：`curl -s "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layout/client.js" | md5sum`
  ⇒ 应等于 `feaedc5d28fcfb5c29ec59036bf65cce`（served == 磁盘）。

---

## 2. 回滚

```bash
# 单单元回滚（依赖序：ush3 必须先回滚，再回滚 ush1）
node tools/apply-ShellFix-v1.mjs --rollback --units=ush3
node tools/apply-ShellFix-v1.mjs --rollback --units=ush1        # 或 ush2 / ush1,ush2
```

- ⚠️ **`ush3` 与 `ush1` 有文本级依赖**：`ush3` 给 `DragHandle` 的渲染面补 `onPointerCancel` /
  `onLostPointerCapture`，其定义由 `ush1` 的处理器 span 引入。脚本**强制**该依赖：
  在 `ush3` 仍存在于目标文件时回滚 `ush1` 会被**拒绝**（实测 `✖ 回滚 ush1 被拒：依赖它的 ush3 仍存在于目标文件`）。
- **逐字节往返**：`--apply(ush1,ush2,ush3)` 后再逐个 `--rollback` ⇒ 两个文件都回到基线 md5
  （实测 `client.js` → `ed91f7f3…`、`columns.d.ts` → `5cc5169b…`，与基线**逐字节一致**）。
- **兜底**：`<target>.pre-ShellFix-v1.bak` 即基线副本，可直接 `cp` 回去。
- **原子性**：回滚同样先写临时文件 + 语法检查 + `rename`，失败则不动原文件。

---

## 3. 落地后最小验收（协调者或用户 5 分钟内可跑）

本档提供的自动化验收（headless，不写部署树；**用路由改写注入候选字节**，可在不落地的情况下先看效果）：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-shellfix
node tools/probe-shellfix.mjs            # 全窗（约 5 分钟，含 U-SH4 A/B）
node tools/verify-ush2-equivalence.mjs   # U-SH2 纯函数等价性（0.3 秒，无需浏览器）
```

落地后的人工抽查（3 条）：

1. 拖侧栏到最右后再往回拖 10px ⇒ 面板**立即**跟手（旧行为要先回退 140px+）。
2. Tab 键能落进侧栏手柄（可见焦点环 + 12×32 药丸提示），→/← 改宽度，aria-valuenow 同步。
3. 把侧栏拖到 380 ⇒ **刷新** ⇒ 仍是 380；`localStorage` 多出恰好 1 个键 `dsh.layout.panels`。

---

## 4. 已知风险与注意事项

| 项 | 说明 |
|---|---|
| **CONFLICT-1**（重要） | ush1④ 消除死区后，**饱和路径回退到抓取点的读数为钳制边界（264/420）而非拖拽前读数（280）**。两者数学上互斥（report.md §6 给出单调性证明）。若协调者判定宁可保留"回原点精确复原 280"而放弃死区修复：**只回滚 ush1 的 `appframe-deadzone` span**（脚本未提供 span 级回滚 ⇒ 需手工删掉那 3 行 `if (next !== raw) …` 重定位行，或整体回滚 ush1）。 |
| **持久化侧效应** | `attachPersistence` 是**整份 state** 持久化 ⇒ `narrow` / `narrowExpanded` 也跨刷新存活（手动窄屏展开跨刷新粘住）。列宽持久化无法只持久化部分字段——除非改 `dsh-client-runtime`（**不在本档授权范围**）。 |
| **aria-label 硬编码** | 标签写死中文（与线上 UI 语言一致，实测该部署按钮 aria-label 全为中文）。真正 i18n 需把 `ctx.locale` 接进手柄 —— 超出本单元范围。 |
| **新增 2 个 Tab 落点** | 侧栏展开时 +1、详情打开时再 +1。实测设置弹窗内 Tab×25 逃逸仍为 **0**（U-A11Y1 陷阱未回归）。 |
| 不改动面 | 本档**未**触碰 `@local/dsh-btw`、`dsh-client-ui-renderer`、`primitives`、`dsh-client-runtime`。 |
