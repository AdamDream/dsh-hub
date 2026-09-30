# WP6 方案 2（降级）代码草案：把远程主机树并进 `@local/dsh-ssh-gui` 自己

> **本文件是草案，不是已应用的改动。** 目标文件
> `$A/home/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js` 属既有文件，
> WP6 工单明确「只产出方案与代码草案，不要改任何既有文件」。

## 为什么是「降级」

方案 1 新写一个薄插件（`@local/dsh-remote-hosts`），职责单一、可整体回滚。
方案 2 不新增包，直接复用 ssh-gui 里**已经写好、已经能渲染**的
`SidebarDistributedNodesTree`（`lib/client.js:939-1015`）——它现在挂在 0.1.7 起就被删除的
`sidebar.workspaces.remoteHosts` 上，只是**换一个宿主席位**。代价是：ssh-gui 的
`dsh.client.inject` 必须补上 `@deepseek-ai/dsh-client-ui-sidebar-right`（加载序），
且以后 ssh-gui 的任何改动都会牵动侧栏展示面（耦合上升）。

## 改动文件清单（方案 2）

| 文件 | 改动 |
|---|---|
| `$A/home/profiles/node_modules/@local/dsh-ssh-gui/lib/client.js` | ① `CH_DWS` 由 `"/dsw"` 改为 `"/api"`，并把 `/dsw` 调用点的 endpoint 前缀改成 `dsw/…`；② 新增 tab 类型注册 + 两个席位注册（见下 diff）；③ `inject` 数组补 `locale`（若要用 NS 文案）或维持现状用硬编码中文 |
| `$A/home/profiles/node_modules/@local/dsh-ssh-gui/package.json` | `dsh.client.inject` 增加 `"@deepseek-ai/dsh-client-ui-sidebar-right"` |
| `$A/home/profiles/web/cordis.patch.yml` | **不需要改**（ssh-gui 行已存在且未 disabled） |

## diff 草案（`lib/client.js`）

```diff
@@ 顶部常量
-		const CH_DWS = "/dsw";
+		// dsh-workspace-enhancement 0.2.2：底座通道 = /api + 命名空间 dsw（web-channel.js:26,28）。
+		// 0.1.2 的 ctx.connection.rpc.handle('/dsw', …) 已随 F1/F2 退役；继续用 "/dsw" 会 404。
+		const CH_DWS = "/api";
 		const CH_SSH = "/ssh-gui";
+		/** /api 通道下 dsh-workspace-enhancement 的命名空间前缀。 */
+		const DWS = (endpoint) => `dsw/${endpoint}`;
@@ 每一处 rpc(CH_DWS, "<x>", …) 调用点（共 7 处：154/224/586/628/675/688/700）
-		rpc(CH_DWS, "conn.probe", { id })
+		rpc(CH_DWS, DWS("conn.probe"), { id })
-		rpc(CH_DWS, "session.route", { id: machineId, path: listing.path })
+		rpc(CH_DWS, DWS("session.route"), { id: machineId, path: listing.path })
-		rpc(CH_DWS, "conn.status", { id: node.id })
+		rpc(CH_DWS, DWS("conn.status"), { id: node.id })
-		rpc(CH_DWS, "machines.test", { … })
+		rpc(CH_DWS, DWS("machines.test"), { … })
-		rpc(CH_DWS, "conn.reconnect", { id: machine.id })
+		rpc(CH_DWS, DWS("conn.reconnect"), { id: machine.id })
-		rpc(CH_DWS, "hostkey.forget", { id: machine.id })
+		rpc(CH_DWS, DWS("hostkey.forget"), { id: machine.id })

@@ apply(ctx) 末尾：旧席位 → 右栏停靠面席位
 		const inject = ["slots", "connection", "sessions", "workspaces"];
 		function apply(ctx) {
 			…既有三个注册保持不动…
-			ctx.slots.inject("sidebar.workspaces.remoteHosts", () => ctx.slots.register({
-				name: "sidebar.workspaces.remoteHosts",
-				id: "@local/dsh-ssh-gui-remote-hosts",
-				order: 10,
-				label: () => "分布式节点",
-				inject: () => ({ rpc, workspaces: ctx.workspaces, sessions: ctx.sessions }),
-			}, SidebarDistributedNodesTree));
+			// 旧席位（sidebar.workspaces.remoteHosts）在 0.1.7 起已不存在 ⇒ 删除该死注册。
+			// 改挂 0.2.0 的右栏停靠面，复用同一个组件，正文一字不改。
+			const REMOTE_HOSTS_ID = "@local/dsh-ssh-gui/remote-hosts";
+			ctx.sidebarRightTabs.register({
+				id: REMOTE_HOSTS_ID,
+				kind: "remote-hosts",
+				priority: "extension",
+				title: () => "分布式节点",
+				guide: [{ id: "remote-hosts", order: 30, title: () => "分布式节点", description: () => "查看/切换远程主机与串口节点" }],
+			});
+			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
+				name: "sidebar.right.pane.tab",
+				key: REMOTE_HOSTS_ID,
+				inject: () => ({ rpc, workspaces: ctx.workspaces, sessions: ctx.sessions }),
+			}, (props) => h(SidebarDistributedNodesTree, { ...props, ...props.useTabInfo().tab.params })));
+			ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
+				name: "sidebar.right.pane.tab.title",
+				key: REMOTE_HOSTS_ID,
+			}, ({ useTabInfo }) => h(react.Fragment, null, "🖧 ", useTabInfo().tab.title)));
 		}
```

要点：
- **正文组件零改动**：`SidebarDistributedNodesTree(props)` 只要求 `{ rpc, workspaces, sessions }`，
  这三样在 0.2.0 上都能从 `ctx.workspaces` / `ctx.sessions` 与本地 `rpc` 垫片拿到。
- `useTabInfo()` 是框架注入的 hook（`slots.d.ts:196-202`），`tab.signal` 应传给
  `SidebarDistributedNodesTree` 内部的 `RemoteBrowser` 以支持切 tab 中止（当前组件未接，
  属**可选**改进，不在最小改动内）。
- 类型 id 用了 `/`（`@local/dsh-ssh-gui/remote-hosts`），官方 `id` 只要求「全部注册中唯一」。

## 数据流（方案 2）

读：`rpc("/ssh-gui", "nodes.list")` + `rpc("/ssh-gui", "config.get")`（组件的 `refresh()`，`lib/client.js:955-962`）
写：节点 CRUD 仍在 `settings.section` 页里走 `rpc("/ssh-gui", "nodes.add"|"nodes.remove"|"nodes.setCurrent")`；
    右栏 tab **只读**，写回路径不变。
SSH 侧：`session.route`（开远端目录为工作区）经 `CH_DWS` 修正后走 `/api/dsw/session.route`。

## 验收标准（方案 2）

1. `node --check` 通过；`ctx.sidebarRightTabs.register` / 两个席位注册的入参满足方案 1 的 H9/H14/H16-H20 同款断言（把 harness 里的插件路径换成本文件即可复用）。
2. 右栏「添加控件 → 分布式节点」能开出一个 tab；正文显示与 0.1.1 侧栏树相同的节点列表。
3. 端口 3099 的一次性验证实例上：`nodes.json` 为空时显示空态文案而不是报错。
4. 原 `settings.section`「分布式控制 · dsh-ssh-gui」页行为不变（回归检查点）。

## 风险与回滚（方案 2）

| 风险 | 说明 | 回滚 |
|---|---|---|
| 加载序 | ssh-gui 未声明对 `dsh-client-ui-sidebar-right` 的客户端依赖，`sidebarRightTabs` 可能尚未 provide | 补 `package.json.dsh.client.inject`；若仍竞争，回退到方案 1（独立包，声明依赖更干净） |
| 耦合 | ssh-gui 的 `apply` 膨胀为「面板 + 头部按钮 + 设置页 + 右栏 tab」四出入口 | 回退 git 版本（ssh-gui 在 `$A` 与两处现役根均逐字节相同，`md5 fa6d88b5dbe952f5619936e6679cca5c`） |
| 通道改名 | `CH_DWS` 7 处调用点改错会连带打断远程工作区开通流程 | 只在 `CH_DWS` 常量与 `DWS()` 前缀两处改动，diff 可逐行审；`grep -c '"/dsw"'` 应为 0 |
| 写回 | 无新增写路径（tab 只读），写回仍只经 `/ssh-gui` | — |

## 与方案 1 的取舍

- 方案 1：新包、零既有文件改动、可单独卸载/回滚；代价是新增一个 `@local` 包与一条 profile 行。
- 方案 2：零新包、复用已验证组件；代价是改 `$A` 既有文件 + 加载序耦合 + 未来 ssh-gui 变更的连带面。
- **推荐方案 1**（D18 的「重新实现」语义也更贴近），方案 2 作为回退。
