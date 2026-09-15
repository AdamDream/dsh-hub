window.__ModuleLoader__.load({
	id: "dsh-workspace-enhancement",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/web-channel.js
		/**
		* Wire identity and envelope adapter of this plugin's browser channel.
		*
		* WHY THIS MODULE EXISTS: the host half used to mount a standalone `/dsw`
		* channel through `connection.rpc.handle`. That API is unusable on the 0.1.5
		* line — `dsh-client-connection`'s `register()` ends in `owner.webServer.register(route)`
		* where `owner` is the Connection service's OWN context, which no longer injects
		* `webServer` (it declares `["credentials"]` alone) — so the registration threw
		* on every host family we support and `/dsw` answered 405 (UPSTREAM-3 F1/F2, see
		* `docs/rounds/R18-F2-dsw-405.md`).
		*
		* The channel therefore rides the OFFICIAL shared transport instead: exact Fetch
		* routes on `/api` (`connection.fetch.register`, the seam
		* `@deepseek-ai/dsh-client-file-upload` uses). Exact routes are matched BEFORE
		* the shared channel's interceptor, which `@deepseek-ai/dsh-api-gateway` already
		* owns (`registerInterceptor` allows exactly one owner per channel), and they
		* keep the same envelope, so the client half keeps calling one unary endpoint at
		* a time. The physical carrier still applies the loopback/Host fence and the
		* browser-session check before our handler runs.
		*
		* BOTH halves import this module, so the path, the namespace and the envelope
		* cannot drift apart (the previous design hard-coded '/dsw' in three places).
		* @module dsh-workspace-enhancement/web-channel
		*/
		/** The shared browser transport channel (`dsh-client-connection`'s `API_PATH`). */
		const API_CHANNEL = "/api";
		/** Endpoint spelling on the wire: what the client passes to `rpc.call`. */
		function channelEndpointOf(endpoint) {
			return `dsw/${endpoint}`;
		}
		//#endregion
		//#region lib/locale/dsw.js
		/**
		* dsw locale dictionary — the single source of truth for the `dsw` namespace.
		*
		* ZH is the key-set source of truth; `src/locale/dsw.en.ts` declares the EN
		* dictionary as `Record<DswKey, string>`, so a missing or surplus key in EN is
		* a compile error. Both halves of the plugin (client UI via `ctx.locale` and
		* the host prompt/tool faces via `src/locale/host.ts`) import THESE SAME
		* files; the namespace is registered as `dsw` on the client and used
		* self-contained on the host.
		*
		* Key naming: `<surface>.<scope>.<item>` (surfaces: flow, form, side,
		* settings, status, rpc, prompt, tool, permission). Template parameters use
		* `{name}` placeholders and are interpolated by `lookup()`, matching the
		* framework's translate semantics. Machine-parseable markers that must stay
		* byte-identical with the official bash tool ([exit code: N], [stderr], ...)
		* deliberately share the same value in both languages.
		*
		* Never put secrets (passwords, passphrases, key material) into a value or a
		* `{param}` — templates carry leaf values only.
		* @module src/locale/dsw
		*/
		/** ZH dictionary — real source of truth for the key set. */
		const zh = {
			"flow.dialog.label": "选择工作区目录",
			"flow.title": "选择工作区目录",
			"flow.close.label": "关闭",
			"flow.cancel": "取消",
			"flow.sidebar.label": "连接与位置",
			"flow.sidebar.local.section": "本机",
			"flow.sidebar.local.title": "本机目录",
			"flow.sidebar.local.subtitle": "选择本机目录作为工作区",
			"flow.sidebar.saved.section": "已保存连接",
			"flow.sidebar.saved.title": "已保存连接",
			"flow.sidebar.saved.loading": "正在加载已保存连接",
			"flow.retry": "重试",
			"flow.sidebar.saved.empty.title": "还没有保存的连接",
			"flow.sidebar.saved.empty.text": "点右下角「＋」新建，或从下方 SSH 配置主机一键添加。",
			"flow.badge.auth.password": "密码",
			"flow.badge.auth.agent": "Agent",
			"flow.badge.auth.key": "私钥",
			"flow.badge.jump": "跳板 ×{n}",
			"flow.connection.delete.label": "删除连接 {label}",
			"flow.connection.delete.title": "删除连接",
			"flow.connection.delete.dialogLabel": "删除远程连接",
			"flow.sidebar.ssh.section": "SSH 配置主机",
			"flow.sidebar.ssh.title": "SSH 配置主机",
			"flow.sidebar.ssh.loading": "正在读取 ~/.ssh/config",
			"flow.sidebar.ssh.error": "无法读取 ~/.ssh/config：{detail}",
			"flow.sidebar.ssh.empty.title": "未发现 SSH 配置主机",
			"flow.sidebar.ssh.empty.text": "在 ~/.ssh/config 中添加 Host 条目后，这里会直接列出，点击即可连接。",
			"flow.ssh.registered.title": "已注册为 {user}@{host}:{port}",
			"flow.ssh.clickRegister.title": "{user}@{host}:{port} — 点击注册并浏览",
			"flow.ssh.noUsername.title": "未指定用户 — 点击打开表单补全",
			"flow.ssh.adding": "正在添加并连接…",
			"flow.ssh.addFailed": "添加失败：{message}",
			"flow.ssh.noUsername": "未指定用户",
			"flow.ssh.added": "已添加",
			"flow.ssh.badge.key": "私钥",
			"flow.ssh.badge.jump": "跳板",
			"flow.connection.new.label": "新建连接",
			"flow.connection.new.title": "新建连接",
			"flow.crumbs.label": "当前路径",
			"flow.crumb.home.label": "回到主目录",
			"flow.crumb.home.title": "主目录",
			"flow.nativePicker.label": "用系统选择器选择文件夹",
			"flow.nativePicker.title": "打开系统文件夹选择器",
			"flow.nativePicker.text": "系统选择器",
			"flow.mkdir.label": "在当前目录新建文件夹",
			"flow.mkdir.title": "新建文件夹",
			"flow.mkdir.dialogLabel": "新建文件夹",
			"flow.hidden.hideLabel": "隐藏以点开头的文件夹",
			"flow.hidden.showLabel": "显示以点开头的文件夹",
			"flow.hidden.hideTitle": "隐藏点开头的文件夹",
			"flow.hidden.showTitle": "显示点开头的文件夹",
			"flow.refresh.label": "刷新当前目录",
			"flow.refresh.title": "刷新",
			"flow.loading.label": "正在加载目录",
			"flow.browse.error.remote": "无法读取远程目录",
			"flow.browse.error.local": "无法读取目录",
			"flow.error.directoryUnavailable": "目录服务不可用（uiWorkspace 未挂载）",
			"flow.auth.complete": "补全认证",
			"flow.empty.title": "没有子文件夹",
			"flow.empty.hidden": "另有 {n} 个点开头的文件夹未显示",
			"flow.empty.text": "可直接在此目录新建文件夹，或选择上方路径",
			"flow.truncated": "文件夹过多，仅显示开头部分。",
			"flow.footer.connecting": "连接中…",
			"flow.footer.pick": "选择此目录",
			"flow.footer.open": "连接并打开",
			"flow.footer.select": "选择目录",
			"flow.mkdir.location": "位置：",
			"flow.mkdir.placeholder": "未命名文件夹",
			"flow.mkdir.create": "创建",
			"flow.connection.delete.confirm": "删除连接「{label}」？",
			"flow.connection.delete.text": "将移除 {u}@{h}:{p} 的注册信息；删除后需要重新添加才能再次连接。",
			"flow.ssh.confirm.title": "添加连接「{alias}」？",
			"flow.ssh.confirm.dialogLabel": "添加 SSH 配置主机",
			"flow.ssh.confirm.text": "将把 {u}@{h}:{p} 保存到「已保存连接」，并打开它的远程目录。",
			"flow.ssh.confirm.text.jump": "将把 {u}@{h}:{p}（经 {n} 级跳板）保存到「已保存连接」，并打开它的远程目录。",
			"flow.ssh.confirm.submit": "添加并连接",
			"flow.error.invalidResponse.title": "无法创建远程会话",
			"flow.error.invalidResponse.text": "宿主返回了无法解析的错误响应——最常见的原因是 SSH 连接失败。请检查该主机的认证与网络配置后重试。",
			"flow.error.auth.title": "认证失败",
			"flow.error.auth.text": "该主机没有可用的私钥或密码，SSH 服务器拒绝了登录。可点击「补全认证」，在表单中填写认证信息后重试。",
			"flow.error.key.title": "私钥不可用",
			"flow.error.key.text": "无法读取或解析私钥文件，请检查路径、口令与文件权限。原始错误：{raw}",
			"flow.error.timeout.title": "连接超时",
			"flow.error.timeout.text": "在超时前未能建立连接，请检查主机名、端口与网络可达性。",
			"flow.error.refused.title": "连接被拒绝",
			"flow.error.refused.text": "目标端口未开放或拒绝了连接，请核对端口。",
			"flow.error.dns.title": "找不到主机",
			"flow.error.dns.text": "域名解析失败，请核对主机名或修正 ~/.ssh/config 中的 HostName。",
			"flow.error.unreachable.title": "网络不可达",
			"flow.error.unreachable.text": "本机无法路由到该主机，请检查网络或跳板配置。",
			"flow.error.generic.title": "无法连接远程主机",
			"flow.route.empty": "session.route 未返回会话目录",
			"flow.resolve.empty": "别名解析结果为空",
			"flow.add.missingId": "注册结果缺少连接 id",
			"flow.mkdir.invalidName": "名称不能包含 / 或 \\，也不能是 . 或 ..",
			"flow.subtitle.local": "选择一个本机目录作为新工作区",
			"flow.subtitle.remote": "正在浏览 {endpoint} 的远程目录",
			"rpc.browseList": "浏览目录列表失败",
			"rpc.sessionRoute": "会话路由失败",
			"rpc.connectionsList": "连接列表失败",
			"rpc.configHosts": "SSH 配置主机读取失败",
			"rpc.pickNative": "系统选择器调用失败",
			"rpc.connectionsResolve": "连接解析失败",
			"rpc.connectionsAdd": "连接添加失败",
			"rpc.browseMkdir": "新建文件夹失败",
			"rpc.connectionsRemove": "连接删除失败",
			"rpc.transportUnavailable": "网页传输不可用",
			"rpc.registryNotMounted": "连接注册表未挂载",
			"rpc.unknownConnectionId": "未知连接 id {id}",
			"rpc.sideStoreNotMounted": "副工作区存储未挂载",
			"rpc.invalidSideRoot": "无效的远程副工作区根 {root}",
			"rpc.unknownMachine": "副工作区引用了未知机器 \"{id}\"",
			"rpc.cannotList": "无法列出 {target}：不是完全限定路径",
			"rpc.cannotCreate": "无法在 {path} 下创建：不是完全限定路径",
			"rpc.notSingleSegment": "\"{name}\" 不是单一路径段",
			"rpc.alreadyExists": "{target} 已存在",
			"rpc.sideWsIdEmpty": "副工作区 id 必须是非空字符串",
			"rpc.sideWsSessionEmpty": "会话 id 必须是非空字符串",
			"rpc.sideWsPathRemote": "副工作区路径必须是 ssh://<id>/<绝对 POSIX 路径>：{path}",
			"rpc.sideWsPathLocal": "副工作区路径必须是绝对本地路径：{path}",
			"rpc.connStoreNotMounted": "会话连接存储未挂载（是否已挂载 dsw/web？）",
			"rpc.connUnknownMachine": "未知机器 id：{ids} — 已知：{known}",
			"rpc.connNoKnownMachines": "（注册表中没有机器）",
			"rpc.connMachineEmpty": "机器 id 必须是非空字符串",
			"rpc.hostEmpty": "host 必须是非空字符串",
			"rpc.usernameEmpty": "username 必须是非空字符串",
			"rpc.portInvalid": "port 必须是 1..65535 的整数：{port}",
			"rpc.cwdShape": "cwd 必须是 POSIX 绝对路径：{cwd}",
			"rpc.jumpHostEmpty": "jump[{index}].host 必须是非空字符串",
			"rpc.invalidWorkdir": "无效的远程工作目录 {dir}",
			"rpc.workdirUnknownConnection": "远程工作目录引用了未知连接 \"{id}\"（是否已挂载 dsw/web？）",
			"rpc.targetUnknownConnection": "目标引用了未知连接 \"{id}\"（是否已挂载 dsw/web？）",
			"form.dialog.label": "新建远程连接",
			"form.title": "新建远程连接",
			"form.subtitle": "保存后将出现在连接侧栏中，可直接浏览其远程目录",
			"form.close.label": "关闭",
			"form.cancel": "取消",
			"form.jump.unresolved": "跳板链中存在无法解析的段",
			"form.jump.summary": "跳板 {count} 段 · {hops}",
			"form.jump.summaryOne": "跳板 {count} · {hops}",
			"form.jump.unresolvedHint": "跳板链中存在无法解析的段，请检查 user@host[:port] 格式",
			"form.resolve.privateKey": "私钥 {path}",
			"form.resolve.jump": "跳板 {hops}",
			"form.error.host": "请填写主机名或 ~/.ssh/config 别名",
			"form.error.required": "必填",
			"form.error.port.number": "端口必须是数字",
			"form.error.port.range": "端口范围 1–65535",
			"form.error.username": "请填写登录用户名",
			"form.config.reading": "正在读取 ~/.ssh/config…",
			"form.config.resolved": "已识别 {alias} → {endpoint}",
			"form.config.resolveFailed": "识别失败：{message}",
			"form.test.noHost": "请先填写主机名",
			"form.test.noPassword": "请填写密码，或改用私钥认证",
			"form.test.noKey": "请填写私钥文件路径，或改用密码认证",
			"form.test.testing": "正在测试连接…",
			"form.test.success": "连接成功，可以保存了",
			"form.test.failed": "连接失败：{message}",
			"form.test.error": "测试失败：{message}",
			"form.save.incomplete": "请先补全上方必填项",
			"form.save.saving": "正在保存…",
			"form.save.missingId": "保存结果缺少机器 id",
			"form.encrypt.fallback": "（⚠ 系统加密后端不可用，密码已明文保存）",
			"form.save.failed": "保存失败：{message}",
			"form.save.flowLabel": "保存并浏览",
			"form.save.settingsLabel": "保存",
			"form.clear.edit": "取消编辑",
			"form.clear.empty": "清空",
			"form.label.host": "主机名 / 别名",
			"form.placeholder.host": "prod 或 server.example.com",
			"form.config.recognize": "识别 ssh 配置",
			"form.config.matching": "正在匹配 ~/.ssh/config…",
			"form.config.hint": "填写 ~/.ssh/config 里的别名可在失焦时自动补全用户名、端口、私钥与跳板",
			"form.config.empty": "~/.ssh/config 里没有可识别的 Host 条目",
			"form.config.badge.key": "[私钥]",
			"form.config.badge.jump": "⛳",
			"form.label.port": "端口",
			"form.label.username": "用户名",
			"form.label.name": "名称（可选）",
			"form.placeholder.name": "默认 user@host",
			"form.label.workspace": "默认工作区（可选）",
			"form.placeholder.workspace": "/home/username（不填则浏览时选择）",
			"form.label.auth": "认证方式",
			"form.auth.keyTab": "私钥文件",
			"form.auth.passwordTab": "密码",
			"form.placeholder.keyPassphrase": "私钥口令（可选）",
			"form.placeholder.keyPath": "~/.ssh/id_ed25519",
			"form.placeholder.password.edit": "留空 = 保持不变",
			"form.placeholder.password.new": "SSH 密码",
			"form.password.hint.edit": "编辑时留空表示保持不变；「加密保存」在下方高级折叠区内。",
			"form.advanced.expanded": "▾ 高级（收起）",
			"form.advanced.collapsed": "▸ 高级",
			"form.label.credentialStore": "密码保管",
			"form.encrypt.checkbox": "加密保存密码（系统钥匙串）",
			"form.label.hostKey": "HostKey 模式",
			"form.hostKey.default": "（默认 accept-new）",
			"form.hostKey.acceptNew": "accept-new（信任首次，之后校验）",
			"form.hostKey.verify": "verify（严格：拒绝陌生主机）",
			"form.hostKey.off": "off（不校验，不推荐）",
			"form.label.remoteApproval": "远程命令审批",
			"form.remoteApproval.off": "off（默认：不拦截）",
			"form.remoteApproval.human": "human（每条远程命令问询）",
			"form.remoteApproval.ai": "ai（只读白名单自动放行，其余问询）",
			"form.remoteApproval.hint": "开启后，这台机器上的远程 shell 命令与终端在执行前需经审批决定（默认关闭，详见 SECURITY 边界说明）。",
			"form.label.remoteSandbox": "远程命令围栏",
			"form.remoteSandbox.off": "off（默认：不围栏）",
			"form.remoteSandbox.readOnly": "read-only（整机只读，禁止写文件）",
			"form.remoteSandbox.workspaceWrite": "workspace-write（只读 + 仅工作区可写）",
			"form.remoteSandbox.hint": "开启后每条远程命令都会先在该远端做一次 bwrap 功能探测，探测不通过就拒绝执行（绝不裸跑）；围栏只覆盖经 spawn 发出的命令，fs/SFTP 写文件不在其内，交互终端在开启时会被拒绝（默认关闭）。",
			"form.label.jump": "跳板链（可选）",
			"form.placeholder.jump": "bastion 或 user@bastion.example.com:2202，多台用逗号分隔",
			"form.jump.clear": "清除",
			"form.test.button": "测试连接",
			"settings.encrypt.fallback": "（⚠ 系统加密后端不可用，密码已明文保存）",
			"settings.saved": "已保存 {label}{fallback}",
			"settings.rpc.listMachines": "读取机器列表失败",
			"settings.delete.confirm": "确定删除这台机器？",
			"settings.rpc.removeFailed": "删除失败",
			"settings.deleted": "已删除",
			"settings.rpc.switchFailed": "切换失败",
			"settings.setCurrent": "已设为当前机器",
			"settings.rpc.forgetKeyFailed": "忘记主机指纹失败",
			"settings.forgotten": "已忘记 {host}:{port} 的主机指纹（下次连接重新记录）",
			"settings.title": "远程工作区（机器管理）",
			"settings.description": "维护多台 SSH 机器（密码 / 私钥 / 主机指纹信任 / 钥匙串）。路径在新建或选择工作区时选：「本机」走系统文件夹对话框；「远程」选一台机器在其远程目录中选择。",
			"settings.machines.title": "已配置的机器",
			"settings.machines.encryptFallbackBadge": "⚠ 加密不可用",
			"settings.machines.gateBadge": "🛡 审批:{mode}",
			"settings.machines.sandboxBadge": "🧱 围栏:{mode}",
			"settings.machines.currentBadge": "· 当前",
			"settings.machines.setCurrent": "设为当前",
			"settings.machines.forgetKey": "忘记指纹",
			"settings.machines.edit": "编辑",
			"settings.machines.delete": "删除",
			"settings.machines.empty": "还没有机器。在下方添加。",
			"settings.form.editTitle": "编辑机器",
			"settings.form.addTitle": "添加机器",
			"settings.label": "远程工作区",
			"side.rpc.failed": "dsw: 请求失败",
			"side.headerAction.title": "关联工作区（本会话的副目录）",
			"side.headerAction.label": "工作区",
			"side.error.unresolvedPath": "无法解析该目录的远程路径，请重新浏览",
			"side.error.noMachine": "请先选择机器",
			"side.error.path.remote": "请输入远程路径（/ 开头）",
			"side.error.path.local": "请输入本地目录路径",
			"side.card.label": "关联工作区",
			"side.card.title": "会话工作区",
			"side.close.label": "关闭",
			"side.loading": "加载中…",
			"side.empty": "未关联任何副目录。副目录是本会话可直接操作的附加根。",
			"side.rename.title": "编辑名称",
			"side.rename.button": "改名",
			"side.remove.title": "移除",
			"side.kind.label": "目录类型",
			"side.kind.local": "本机目录",
			"side.kind.remote": "远程目录",
			"side.machine.label": "机器",
			"side.draft.path.remote": "远程路径，如 /srv/app（或直接点浏览…）",
			"side.draft.path.local": "本地目录绝对路径",
			"side.browse": "浏览…",
			"side.draft.labelPlaceholder": "显示名（默认目录名）",
			"side.mount": "挂载",
			"side.conn.heading": "已连接的机器",
			"side.conn.empty": "本会话未连接任何机器",
			"side.conn.connect": "连接",
			"side.conn.disconnect": "断开",
			"side.conn.busy": "处理中…",
			"side.conn.hint": "连接让本会话获得 sw_exec；官方文件工具经 ssh://<id>/ 路径直达该机器，与这个开关无关。",
			"side.main.heading": "主工作区",
			"side.main.none": "本地会话，无远程主工作区",
			"side.roots.heading": "副工作区",
			"header.remote.label": "远程状态",
			"header.remote.title": "当前会话的远程连接：{machine}（点击重新检测）",
			"status.rpc.failed": "dsw rpc 失败",
			"status.unknown": "未检测",
			"status.active": "已连接",
			"status.offline": "离线",
			"status.checking": "检测中…",
			"status.connecting": "连接中…",
			"status.retryAction.title": "重新检测并尝试连接",
			"status.retryAction.compact": "重连",
			"status.retryAction.full": "重新检测并尝试连接",
			"status.retryAction.recheck": "重新检测",
			"tool.common.noActive": "没有活动的机器——请先在设置页注册机器，再用 sw_connect 把它连到本会话。",
			"tool.common.backgroundSentence": "长时间运行命令请设置 `run_in_background: true`：调用会立即返回任务 id；用 `job_output` 读取输出、`job_kill` 停止。",
			"tool.common.backgroundUnavailable": "后台执行不可用；长时间运行的命令必须在超时内完成。",
			"tool.sw_status.description": "显示当前远程机器（主机/用户/端口）、连接健康（ping）、当前远程工作区与主机指纹策略/状态。先调用它以了解现状，或在某个 sw_* 调用失败时检查连通性。",
			"tool.sw_status.ping.ok": "Ping: 正常 — {prefix} ({outcome})",
			"tool.sw_status.ping.failed": "Ping: 失败 — {detail}",
			"tool.sw_status.outputs.host": "远程主机：{u}@{h}:{p}{source}",
			"tool.sw_status.outputs.workspace": "当前远程工作区：{ws}",
			"tool.sw_status.outputs.workspaceNone": "当前远程工作区：（无——调用 sw_pick_workspace 设置）",
			"tool.sw_status.outputs.connected": "已连接：{yesno}",
			"tool.sw_status.outputs.connList": "本会话已连接机器：{items}",
			"tool.sw_status.outputs.connNone": "本会话已连接机器：（无——请先调用 sw_connect）",
			"tool.sw_status.outputs.hostKey": "主机指纹：{trusted}（模式={mode}）",
			"tool.sw_status.outputs.backend": "密码后端：{backend}",
			"tool.sw_connect.description": "设置本会话可以连接并在其上执行命令的已注册机器。每次调用都**替换**整个集合（不是并集）：`machines: []` 断开全部。机器必须是已注册机器的 id；未注册的 id 会报错并列出已知 id。随后对每台机器做一次有界 ping：可达者记录为已连接，不可达者如实报告但不加入集合；全部不可达时调用失败且不改动既有连接。",
			"tool.sw_connect.param.machines": "要连接的已注册机器 id 数组。空数组断开本会话的全部连接。",
			"tool.sw_connect.output.cleared": "本会话已断开全部机器连接。",
			"tool.sw_connect.output.heading": "本会话已连接机器：",
			"tool.sw_connect.output.reachable": "- {id}（{endpoint}）：可达，已连接",
			"tool.sw_connect.output.unreachable": "- {id}：不可达 — {detail}（未连接）",
			"tool.sw_connect.error.noSession": "sw_connect: 无法解析本会话 id——拒绝改动连接状态",
			"tool.sw_connect.error.storeMissing": "sw_connect: 会话连接存储未挂载（是否已挂载 dsw/web？）",
			"tool.sw_connect.error.unknownMachine": "sw_connect: 未知机器 id：{ids} — 已知：{known}",
			"tool.sw_connect.error.noKnownMachines": "（注册表中没有机器——请先在设置页添加）",
			"tool.sw_connect.error.allUnreachable": "sw_connect: 没有一台机器可达，本会话连接保持不变。\n{details}",
			"tool.sw_connect.error.noDetail": "无错误详情",
			"tool.sw_pick_workspace.description": "设置本会话在已连接远程上视为工作根目录的远程工作区目录。会校验其存在且为目录；并持久化到活动机器（recentWorkspaces 保留最近 8 个）。",
			"tool.sw_pick_workspace.param.path": "远程目录绝对路径，如 /home/dev/code/project",
			"tool.sw_pick_workspace.output": "工作区已设置为 {path}（活动机器：{u}@{h}）。",
			"tool.sw_pick_workspace.error.invalidPath": "sw_pick_workspace: path 必须是远程目录绝对路径：{path}",
			"tool.sw_pick_workspace.error.noActive": "sw_pick_workspace: 没有活动机器——请先调用 sw_connect",
			"tool.sw_pick_workspace.error.notDir": "sw_pick_workspace: {path} 不是目录",
			"tool.sw_exec.description": "在本会话已连接的已注册 SSH 服务器上执行命令并返回其 stdout/stderr。`server` id 选择机器——必须是本会话已连接的注册表 id（见 sw_status 的连接行，或先用 sw_connect 连接）；缺省为本会话主工作区所在机器。目标 OS 每次连接探测一次并记录在第一行：POSIX 运行 `bash -c`，Windows 运行 `pwsh -Command`，unknown 时诚实使用 bash。每次调用都在全新 shell 中运行：调用之间不保留状态（cwd、变量、函数）——请传 `workdir` 而不是用 `cd`。非 0 退出以 `[exit code: N]` 报告——先排查再继续。长输出截断到尾部；完整输出保存到文件并在可用时报告路径。",
			"tool.sw_exec.param.workdir": "目标服务器上的工作目录。缺省为该服务器主工作区；相对路径基于会话工作区解析；`ssh://<id>/<path>` 显式指定机器与目录。",
			"tool.sw_exec.param.server": "目标服务器 id：本会话已连接的注册表机器 id（c1、c2…）。缺省为本会话主工作区所在机器。已注册但未连接到本会话的 id 会报错并列出已连接 id；未知 id 报错并列出已知 id。",
			"tool.sw_exec.output.background": "已在 {server}（{endpoint}）上启动后台任务 {jobId}",
			"tool.sw_exec.output.header": "服务器：{id}（{endpoint}）· 系统：{os}",
			"tool.sw_exec.error.workdirEmpty": "sw_exec: workdir 不能为空",
			"tool.sw_exec.error.invalidWorkdir": "sw_exec: 无效的远程工作目录 {dir}",
			"tool.sw_exec.error.workdirShape": "sw_exec: workdir 必须是 POSIX 路径或 ssh://<id>/<path>（远程世界）",
			"tool.sw_exec.error.relativeNoCwd": "sw_exec: 相对 workdir 需要远程会话 cwd",
			"tool.sw_exec.error.absoluteShape": "sw_exec: workdir 必须是 POSIX 绝对路径或 ssh://<id>/<path>",
			"tool.sw_exec.error.noActive": "sw_exec: 没有活动服务器——请先调用 sw_connect",
			"tool.sw_exec.error.unknownServer": "sw_exec: 未知服务器 \"{id}\"",
			"tool.sw_exec.error.spawnFailed": "sw_exec: 启动失败：{detail}",
			"tool.sw_exec.error.serverRequired": "sw_exec: 本地会话必须提供 server",
			"tool.sw_exec.error.noSession": "sw_exec: 无法解析本会话 id——已拒绝执行（fail closed）",
			"tool.sw_exec.error.notConnectedNone": "sw_exec: 本会话未连接任何机器——请先调用 sw_connect(machines: [...])",
			"tool.sw_exec.error.notConnected": "sw_exec: 服务器 \"{id}\" 未连接到本会话（本会话已连接：{ids}）",
			"tool.bash.description": "在会话的远程 Linux 工作区上执行 bash 命令（`bash -c`）并返回其 stdout/stderr。本主机是 Windows 且没有本地 bash：命令始终在会话路由到的远程服务器上运行，本地（Windows）会话会报错——请在那里使用 pwsh。每次调用都在全新 shell 中运行：调用之间不保留状态（cwd、变量、函数）——请传 `workdir` 而不是用 `cd`。非 0 退出以 `[exit code: N]` 报告——先排查再继续。长输出截断到尾部；完整输出保存到文件并在可用时报告路径。",
			"tool.bash.param.workdir": "该命令的工作目录。缺省为会话工作区；相对路径基于它解析；`ssh://<id>/<path>` 显式指定机器与目录。",
			"tool.bash.output.background": "已启动后台任务 {jobId}",
			"tool.bash.error.localSession": "bash 工具面向远程 Linux 工作区（本机 Windows 无 bash）；请使用 pwsh 或终端面板",
			"tool.bash.error.spawnFailed": "bash: 启动失败：{detail}",
			"tool.param.command": "在目标服务器上执行的命令。",
			"tool.param.description": "简要、主动语态地描述该命令的作用，5-10 个词（界面中显示）。示例：\"ls\" → \"List files in current directory\"；\"git status\" → \"Show working tree status\"；\"npm install\" → \"Install package dependencies\"。",
			"tool.param.timeout": "毫秒级超时（执行器默认 120 秒，上限 600 秒——超出会被钳制）。超时后工具会终止命令并报告 [timed out after Nms]。",
			"tool.param.runInBackground": "后台运行并立即返回任务 id（用 job_output 收集、job_kill 停止）。后台任务无超时。",
			"tool.job.detail.killed": "退出前被终止",
			"tool.job.detail.signal": "信号：{sig}",
			"tool.job.detail.exit": "退出码：{code}",
			"tool.output.dropped": "[some output was dropped from memory; full output: {path}]",
			"tool.output.truncated": "[output truncated; full output: {path}]",
			"tool.output.stderrMarker": "[stderr]",
			"tool.output.empty": "（无输出）",
			"tool.output.timedOut": "[timed out after {ms}ms]",
			"tool.output.killedSignal": "[killed by signal: {sig}]",
			"tool.output.exitCode": "[exit code: {code}]",
			"tool.error.subprocessMissing": "sw_exec: subprocess 接缝未挂载（是否已挂载 dsh-workspace-enhancement？）",
			"tool.error.jobsUnavailable": "后台任务不可用：请加载 @deepseek-ai/dsh-jobs 与 @deepseek-ai/dsh-tool-jobs",
			"tool.error.backgroundDisabled": "该部署禁用 run_in_background（enableRunInBackground: false）",
			"tool.error.aborted": "tool call aborted",
			"tool.param.error.commandEmpty": "无效命令：应为非空字符串",
			"tool.param.error.descriptionEmpty": "无效描述：应为非空字符串",
			"tool.param.error.timeoutInvalid": "无效 timeoutMs：应为正数，实际为 {v}"
		};
		//#endregion
		//#region lib/locale/dsw.en.js
		/**
		* EN dictionary for the `dsw` namespace — compiled against the ZH key set.
		*
		* Declared as `Record<DswKey, string>`: a missing or surplus key relative to
		* `src/locale/dsw.ts` is a compile error, so ZH stays the single key-set
		* source of truth and EN completeness is locked at build time.
		*
		* Values: for the UI/prompt surfaces EN is the translation of the existing
		* Chinese copy; for the `tool.*` surface EN keeps the original (English)
		* model-facing wording and ZH carries the Chinese translation. Machine
		* markers documented as byte-identical ([exit code: N], [stderr], ...) share
		* the same value in both languages by design.
		* @module src/locale/dsw.en
		*/
		/** EN dictionary — type-checked against {@link DswKey}. */
		const en = {
			"flow.dialog.label": "Choose a workspace directory",
			"flow.title": "Choose a workspace directory",
			"flow.close.label": "Close",
			"flow.cancel": "Cancel",
			"flow.sidebar.label": "Connection & location",
			"flow.sidebar.local.section": "Local",
			"flow.sidebar.local.title": "Local directory",
			"flow.sidebar.local.subtitle": "Pick a local directory as the workspace",
			"flow.sidebar.saved.section": "Saved connections",
			"flow.sidebar.saved.title": "Saved connections",
			"flow.sidebar.saved.loading": "Loading saved connections",
			"flow.retry": "Retry",
			"flow.sidebar.saved.empty.title": "No saved connections yet",
			"flow.sidebar.saved.empty.text": "Create one with the ＋ button at the bottom right, or add from an SSH config host below.",
			"flow.badge.auth.password": "Password",
			"flow.badge.auth.agent": "Agent",
			"flow.badge.auth.key": "Private key",
			"flow.badge.jump": "{n}-hop jump",
			"flow.connection.delete.label": "Delete connection {label}",
			"flow.connection.delete.title": "Delete connection",
			"flow.connection.delete.dialogLabel": "Delete remote connection",
			"flow.sidebar.ssh.section": "SSH config hosts",
			"flow.sidebar.ssh.title": "SSH config hosts",
			"flow.sidebar.ssh.loading": "Reading ~/.ssh/config",
			"flow.sidebar.ssh.error": "Cannot read ~/.ssh/config: {detail}",
			"flow.sidebar.ssh.empty.title": "No SSH config hosts found",
			"flow.sidebar.ssh.empty.text": "After adding a Host entry to ~/.ssh/config, it appears here — click to connect.",
			"flow.ssh.registered.title": "Registered as {user}@{host}:{port}",
			"flow.ssh.clickRegister.title": "{user}@{host}:{port} — click to register and browse",
			"flow.ssh.noUsername.title": "No username specified — click to open the form and complete it",
			"flow.ssh.adding": "Adding and connecting…",
			"flow.ssh.addFailed": "Failed to add: {message}",
			"flow.ssh.noUsername": "No username specified",
			"flow.ssh.added": "Added",
			"flow.ssh.badge.key": "Private key",
			"flow.ssh.badge.jump": "Jump",
			"flow.connection.new.label": "New connection",
			"flow.connection.new.title": "New connection",
			"flow.crumbs.label": "Current path",
			"flow.crumb.home.label": "Back to home directory",
			"flow.crumb.home.title": "Home directory",
			"flow.nativePicker.label": "Choose a folder with the system picker",
			"flow.nativePicker.title": "Open the system folder picker",
			"flow.nativePicker.text": "System picker",
			"flow.mkdir.label": "Create a folder in the current directory",
			"flow.mkdir.title": "New folder",
			"flow.mkdir.dialogLabel": "New folder",
			"flow.hidden.hideLabel": "Hide dot-prefixed folders",
			"flow.hidden.showLabel": "Show dot-prefixed folders",
			"flow.hidden.hideTitle": "Hide dot-prefixed folders",
			"flow.hidden.showTitle": "Show dot-prefixed folders",
			"flow.refresh.label": "Refresh current directory",
			"flow.refresh.title": "Refresh",
			"flow.loading.label": "Loading directory",
			"flow.browse.error.remote": "Cannot read the remote directory",
			"flow.browse.error.local": "Cannot read the directory",
			"flow.error.directoryUnavailable": "the directory service (uiWorkspace) is not available",
			"flow.auth.complete": "Complete authentication",
			"flow.empty.title": "No subfolders",
			"flow.empty.hidden": "{n} more dot-prefixed folders are hidden",
			"flow.empty.text": "Create a folder here, or pick a path above",
			"flow.truncated": "Too many folders — only the first ones are shown.",
			"flow.footer.connecting": "Connecting…",
			"flow.footer.pick": "Pick this directory",
			"flow.footer.open": "Connect and open",
			"flow.footer.select": "Select directory",
			"flow.mkdir.location": "Location: ",
			"flow.mkdir.placeholder": "Untitled folder",
			"flow.mkdir.create": "Create",
			"flow.connection.delete.confirm": "Delete connection \"{label}\"?",
			"flow.connection.delete.text": "This removes the registration for {u}@{h}:{p}; you must add it again to reconnect.",
			"flow.ssh.confirm.title": "Add connection \"{alias}\"?",
			"flow.ssh.confirm.dialogLabel": "Add SSH config host",
			"flow.ssh.confirm.text": "Saves {u}@{h}:{p} to \"Saved connections\" and opens its remote directory.",
			"flow.ssh.confirm.text.jump": "Saves {u}@{h}:{p} (via a {n}-hop jump chain) to \"Saved connections\" and opens its remote directory.",
			"flow.ssh.confirm.submit": "Add and connect",
			"flow.error.invalidResponse.title": "Cannot create the remote session",
			"flow.error.invalidResponse.text": "The host returned an unparseable error response — the most common cause is an SSH connection failure. Check this host's authentication and network settings, then retry.",
			"flow.error.auth.title": "Authentication failed",
			"flow.error.auth.text": "This host has no usable private key or password and the SSH server rejected the login. Click \"Complete authentication\" to fill in the credentials and retry.",
			"flow.error.key.title": "Private key unavailable",
			"flow.error.key.text": "Cannot read or parse the private key file — check its path, passphrase, and file permissions. Raw error: {raw}",
			"flow.error.timeout.title": "Connection timed out",
			"flow.error.timeout.text": "The connection was not established before the timeout; check the hostname, port, and network reachability.",
			"flow.error.refused.title": "Connection refused",
			"flow.error.refused.text": "The target port is closed or refused the connection — check the port.",
			"flow.error.dns.title": "Host not found",
			"flow.error.dns.text": "DNS resolution failed; check the hostname or fix HostName in ~/.ssh/config.",
			"flow.error.unreachable.title": "Network unreachable",
			"flow.error.unreachable.text": "This machine cannot route to the host — check the network or jump configuration.",
			"flow.error.generic.title": "Cannot connect to the remote host",
			"flow.route.empty": "session.route returned no session directory",
			"flow.resolve.empty": "Alias resolution returned nothing",
			"flow.add.missingId": "The registration result is missing the connection id",
			"flow.mkdir.invalidName": "The name cannot contain / or \\, and cannot be . or ..",
			"flow.subtitle.local": "Pick a local directory as the new workspace",
			"flow.subtitle.remote": "Browsing the remote directory of {endpoint}",
			"rpc.browseList": "browse.list failed",
			"rpc.sessionRoute": "session.route failed",
			"rpc.connectionsList": "connections.list failed",
			"rpc.configHosts": "config.hosts failed",
			"rpc.pickNative": "local.pickNative failed",
			"rpc.connectionsResolve": "connections.resolve failed",
			"rpc.connectionsAdd": "connections.add failed",
			"rpc.browseMkdir": "browse.mkdir failed",
			"rpc.connectionsRemove": "connections.remove failed",
			"rpc.transportUnavailable": "the web transport is not available",
			"rpc.registryNotMounted": "the connection registry is not mounted",
			"rpc.unknownConnectionId": "unknown connection id {id}",
			"rpc.sideStoreNotMounted": "the side-workspace store is not mounted",
			"rpc.invalidSideRoot": "invalid remote side workspace root {root}",
			"rpc.unknownMachine": "remote side workspace names unknown machine \"{id}\"",
			"rpc.cannotList": "cannot list {target}: not a fully qualified path",
			"rpc.cannotCreate": "cannot create under {path}: not a fully qualified path",
			"rpc.notSingleSegment": "{name} is not a single path segment",
			"rpc.alreadyExists": "{target} already exists",
			"rpc.sideWsIdEmpty": "side workspace id must be a non-empty string",
			"rpc.sideWsSessionEmpty": "session id must be a non-empty string",
			"rpc.sideWsPathRemote": "side workspace path must be an ssh://<id>/<absolute posix path>: {path}",
			"rpc.sideWsPathLocal": "side workspace path must be an absolute local path: {path}",
			"rpc.connStoreNotMounted": "the session-connection store is not mounted (is dsw/web mounted?)",
			"rpc.connUnknownMachine": "unknown machine id(s): {ids} — known: {known}",
			"rpc.connNoKnownMachines": "(no machines registered)",
			"rpc.connMachineEmpty": "a machine id must be a non-empty string",
			"rpc.hostEmpty": "host must be a non-empty string",
			"rpc.usernameEmpty": "username must be a non-empty string",
			"rpc.portInvalid": "port must be an integer in 1..65535: {port}",
			"rpc.cwdShape": "cwd must be an absolute POSIX path: {cwd}",
			"rpc.jumpHostEmpty": "jump[{index}].host must be a non-empty string",
			"rpc.invalidWorkdir": "invalid remote working directory {dir}",
			"rpc.workdirUnknownConnection": "remote working directory names unknown connection \"{id}\" (is dsw/web mounted?)",
			"rpc.targetUnknownConnection": "target names unknown connection \"{id}\" (is dsw/web mounted?)",
			"form.dialog.label": "New remote connection",
			"form.title": "New remote connection",
			"form.subtitle": "After saving, it appears in the connection sidebar where you can browse its remote directory",
			"form.close.label": "Close",
			"form.cancel": "Cancel",
			"form.jump.unresolved": "The jump chain contains an unresolvable segment",
			"form.jump.summary": "{count}-hop jump chain · {hops}",
			"form.jump.summaryOne": "{count} hop · {hops}",
			"form.jump.unresolvedHint": "The jump chain contains an unresolvable segment; check the user@host[:port] format",
			"form.resolve.privateKey": "Private key {path}",
			"form.resolve.jump": "Jump chain {hops}",
			"form.error.host": "Enter a hostname or a ~/.ssh/config alias",
			"form.error.required": "Required",
			"form.error.port.number": "The port must be a number",
			"form.error.port.range": "Port range 1–65535",
			"form.error.username": "Enter the login username",
			"form.config.reading": "Reading ~/.ssh/config…",
			"form.config.resolved": "Resolved {alias} → {endpoint}",
			"form.config.resolveFailed": "Resolution failed: {message}",
			"form.test.noHost": "Enter the hostname first",
			"form.test.noPassword": "Enter a password, or switch to private-key authentication",
			"form.test.noKey": "Enter a private-key path, or switch to password authentication",
			"form.test.testing": "Testing the connection…",
			"form.test.success": "Connection succeeded — you can save now",
			"form.test.failed": "Connection failed: {message}",
			"form.test.error": "Test failed: {message}",
			"form.save.incomplete": "Complete the required fields above first",
			"form.save.saving": "Saving…",
			"form.save.missingId": "The save result is missing the machine id",
			"form.encrypt.fallback": "(⚠ the system encryption backend is unavailable; the password is saved in plaintext)",
			"form.save.failed": "Save failed: {message}",
			"form.save.flowLabel": "Save & browse",
			"form.save.settingsLabel": "Save",
			"form.clear.edit": "Cancel editing",
			"form.clear.empty": "Clear",
			"form.label.host": "Hostname / alias",
			"form.placeholder.host": "prod or server.example.com",
			"form.config.recognize": "Recognize ssh config",
			"form.config.matching": "Matching ~/.ssh/config…",
			"form.config.hint": "An alias from ~/.ssh/config autofills the username, port, private key, and jump chain on blur",
			"form.config.empty": "No recognizable Host entries in ~/.ssh/config",
			"form.config.badge.key": "[key]",
			"form.config.badge.jump": "⛳",
			"form.label.port": "Port",
			"form.label.username": "Username",
			"form.label.name": "Name (optional)",
			"form.placeholder.name": "default user@host",
			"form.label.workspace": "Default workspace (optional)",
			"form.placeholder.workspace": "/home/username (left empty, chosen when browsing)",
			"form.label.auth": "Authentication",
			"form.auth.keyTab": "Private key file",
			"form.auth.passwordTab": "Password",
			"form.placeholder.keyPassphrase": "Private-key passphrase (optional)",
			"form.placeholder.keyPath": "~/.ssh/id_ed25519",
			"form.placeholder.password.edit": "Leave empty to keep unchanged",
			"form.placeholder.password.new": "SSH password",
			"form.password.hint.edit": "While editing, leaving it empty keeps the current value; \"Encrypt save\" is in the advanced section below.",
			"form.advanced.expanded": "▾ Advanced (collapse)",
			"form.advanced.collapsed": "▸ Advanced",
			"form.label.credentialStore": "Credential store",
			"form.encrypt.checkbox": "Encrypt-save the password (system keychain)",
			"form.label.hostKey": "HostKey mode",
			"form.hostKey.default": "(default accept-new)",
			"form.hostKey.acceptNew": "accept-new (trust on first use, verify afterwards)",
			"form.hostKey.verify": "verify (strict: reject unknown hosts)",
			"form.hostKey.off": "off (no verification, not recommended)",
			"form.label.remoteApproval": "Remote command approval",
			"form.remoteApproval.off": "off (default: no gate)",
			"form.remoteApproval.human": "human (ask before every remote command)",
			"form.remoteApproval.ai": "ai (auto-grant read-only whitelist, ask for the rest)",
			"form.remoteApproval.hint": "When enabled, remote shell commands and terminals on this machine require an approval decision before they run (default off; see SECURITY for the honest boundary).",
			"form.label.remoteSandbox": "Remote command fence",
			"form.remoteSandbox.off": "off (default: no fence)",
			"form.remoteSandbox.readOnly": "read-only (whole filesystem read-only, no writes)",
			"form.remoteSandbox.workspaceWrite": "workspace-write (read-only plus a writable workspace)",
			"form.remoteSandbox.hint": "When enabled, each remote command first runs a functional bwrap probe on that host and is REFUSED if the probe fails (never run unconfined); the fence covers spawned commands only — fs/SFTP writes are not confined by it, and interactive terminals are refused while it is on (default off).",
			"form.label.jump": "Jump chain (optional)",
			"form.placeholder.jump": "bastion or user@bastion.example.com:2202; separate multiple with commas",
			"form.jump.clear": "Clear",
			"form.test.button": "Test connection",
			"settings.encrypt.fallback": "(⚠ the system encryption backend is unavailable; the password is saved in plaintext)",
			"settings.saved": "Saved {label}{fallback}",
			"settings.rpc.listMachines": "Failed to read the machine list",
			"settings.delete.confirm": "Delete this machine?",
			"settings.rpc.removeFailed": "Delete failed",
			"settings.deleted": "Deleted",
			"settings.rpc.switchFailed": "Switch failed",
			"settings.setCurrent": "Set as the current machine",
			"settings.rpc.forgetKeyFailed": "Failed to forget the host key",
			"settings.forgotten": "Forgot the host key of {host}:{port} (it will be recorded again on next connect)",
			"settings.title": "Remote workspaces (machine management)",
			"settings.description": "Manage multiple SSH machines (password / private key / host-key trust / keychain). The path is chosen when creating or selecting a workspace: \"Local\" uses the system folder dialog; \"Remote\" picks a machine and selects inside its remote directory.",
			"settings.machines.title": "Configured machines",
			"settings.machines.encryptFallbackBadge": "⚠ encryption unavailable",
			"settings.machines.gateBadge": "🛡 approval:{mode}",
			"settings.machines.sandboxBadge": "🧱 fence:{mode}",
			"settings.machines.currentBadge": "· current",
			"settings.machines.setCurrent": "Set as current",
			"settings.machines.forgetKey": "Forget key",
			"settings.machines.edit": "Edit",
			"settings.machines.delete": "Delete",
			"settings.machines.empty": "No machines yet. Add one below.",
			"settings.form.editTitle": "Edit machine",
			"settings.form.addTitle": "Add machine",
			"settings.label": "Remote workspaces",
			"side.rpc.failed": "dsw: request failed",
			"side.headerAction.title": "Link workspace (side directory of this session)",
			"side.headerAction.label": "Workspace",
			"side.error.unresolvedPath": "Cannot resolve the remote path of this directory — please browse again",
			"side.error.noMachine": "Select a machine first",
			"side.error.path.remote": "Enter a remote path (starting with /)",
			"side.error.path.local": "Enter a local directory path",
			"side.card.label": "Link workspace",
			"side.card.title": "Session workspaces",
			"side.close.label": "Close",
			"side.loading": "Loading…",
			"side.empty": "No side directories linked. Side directories are extra roots this session can operate on directly.",
			"side.rename.title": "Edit name",
			"side.rename.button": "Rename",
			"side.remove.title": "Remove",
			"side.kind.label": "directory type",
			"side.kind.local": "local directory",
			"side.kind.remote": "remote directory",
			"side.machine.label": "machine",
			"side.draft.path.remote": "remote path, e.g. /srv/app (or click Browse…)",
			"side.draft.path.local": "local directory absolute path",
			"side.browse": "Browse…",
			"side.draft.labelPlaceholder": "display name (defaults to the directory name)",
			"side.mount": "Mount",
			"side.conn.heading": "Connected machines",
			"side.conn.empty": "No machines connected to this session",
			"side.conn.connect": "Connect",
			"side.conn.disconnect": "Disconnect",
			"side.conn.busy": "Working…",
			"side.conn.hint": "Connecting gives this session sw_exec; the official file tools reach any registered machine through ssh://<id>/ paths regardless of this switch.",
			"side.main.heading": "Main workspace",
			"side.main.none": "Local session — no remote main workspace",
			"side.roots.heading": "Side workspaces",
			"header.remote.label": "Remote status",
			"header.remote.title": "Remote connection of this session: {machine} (click to re-check)",
			"status.rpc.failed": "dsw rpc failed",
			"status.unknown": "not detected",
			"status.active": "connected",
			"status.offline": "offline",
			"status.connecting": "connecting…",
			"status.checking": "checking…",
			"status.retryAction.title": "Re-check and try to connect",
			"status.retryAction.compact": "Reconnect",
			"status.retryAction.full": "Re-check and try to connect",
			"status.retryAction.recheck": "Re-check",
			"tool.common.noActive": "No active machine — register one in settings, then connect it to this session with sw_connect.",
			"tool.common.backgroundSentence": "Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.",
			"tool.common.backgroundUnavailable": "Background execution is not available; long-running commands must finish within the timeout.",
			"tool.sw_status.description": "Show the current remote machine (host/user/port), connection health (ping), the current remote workspace, and the host-key policy/state. Call this first to orient, or when an sw_* call fails to check connectivity.",
			"tool.sw_status.ping.ok": "Ping: OK — {prefix} ({outcome})",
			"tool.sw_status.ping.failed": "Ping: FAILED — {detail}",
			"tool.sw_status.outputs.host": "Remote host: {u}@{h}:{p}{source}",
			"tool.sw_status.outputs.workspace": "Current remote workspace: {ws}",
			"tool.sw_status.outputs.workspaceNone": "Current remote workspace: (none — call sw_pick_workspace to set one)",
			"tool.sw_status.outputs.connected": "Connected: {yesno}",
			"tool.sw_status.outputs.connList": "Machines connected to this session: {items}",
			"tool.sw_status.outputs.connNone": "Machines connected to this session: (none — call sw_connect first)",
			"tool.sw_status.outputs.hostKey": "Host key: {trusted} (mode={mode})",
			"tool.sw_status.outputs.backend": "Password backend: {backend}",
			"tool.sw_connect.description": "Set which registered machines this session may connect to and run commands on. Every call REPLACES the whole set (it is not a union): `machines: []` disconnects everything. Machines must be ids of registered machines; an unknown id errors with the known list. Each requested machine is then pinged within a bounded budget: reachable ones are recorded as connected, unreachable ones are reported honestly and left out; when none is reachable the call fails and the existing connections stay unchanged.",
			"tool.sw_connect.param.machines": "Array of registered machine ids to connect. An empty array disconnects every machine from this session.",
			"tool.sw_connect.output.cleared": "Disconnected every machine from this session.",
			"tool.sw_connect.output.heading": "Machines connected to this session:",
			"tool.sw_connect.output.reachable": "- {id} ({endpoint}): reachable, connected",
			"tool.sw_connect.output.unreachable": "- {id}: unreachable — {detail} (not connected)",
			"tool.sw_connect.error.noSession": "sw_connect: cannot resolve this session id — refusing to change connection state",
			"tool.sw_connect.error.storeMissing": "sw_connect: the session-connection store is not mounted (is dsw/web mounted?)",
			"tool.sw_connect.error.unknownMachine": "sw_connect: unknown machine id(s): {ids} — known: {known}",
			"tool.sw_connect.error.noKnownMachines": "(no machines registered — add one in the settings page first)",
			"tool.sw_connect.error.allUnreachable": "sw_connect: no requested machine was reachable, so this session's connections are unchanged.\n{details}",
			"tool.sw_connect.error.noDetail": "no failure detail",
			"tool.sw_pick_workspace.description": "Set the remote workspace directory this session should treat as its working root on the connected remote. Verifies it exists (a directory); persists it on the active machine (recentWorkspaces keeps the last 8).",
			"tool.sw_pick_workspace.param.path": "Absolute remote directory path, e.g. /home/dev/code/project",
			"tool.sw_pick_workspace.output": "Workspace set to {path} (active machine: {u}@{h}).",
			"tool.sw_pick_workspace.error.invalidPath": "sw_pick_workspace: path must be an absolute remote directory path: {path}",
			"tool.sw_pick_workspace.error.notDir": "sw_pick_workspace: {path} is not a directory",
			"tool.sw_pick_workspace.error.noActive": "sw_pick_workspace: no active machine — call sw_connect first",
			"tool.sw_exec.description": "Execute a command on a registered SSH server connected to this session and return its stdout/stderr. The `server` id selects the machine — it must be a registry id connected to this session (see the connection line of sw_status, or call sw_connect first); it defaults to the machine of this session's main workspace. The target OS is probed once per connection and reported in the first line: POSIX runs `bash -c`, Windows runs `pwsh -Command`, unknown runs bash honestly. Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]` — investigate failures before moving on. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available.",
			"tool.sw_exec.param.workdir": "Working directory on the target server. Defaults to that server's primary workspace; a relative path is resolved against the session workspace; `ssh://<id>/<path>` names a machine and directory explicitly.",
			"tool.sw_exec.param.server": "Target server id: a registry machine id (c1, c2, …) connected to this session. Defaults to the machine of this session's main workspace. A registered id that is not connected to this session errors with the connected ids; an unknown id errors with the known list.",
			"tool.sw_exec.output.background": "started background job {jobId} on {server} ({endpoint})",
			"tool.sw_exec.output.header": "server: {id} ({endpoint}) · OS: {os}",
			"tool.sw_exec.error.workdirEmpty": "sw_exec: workdir must not be empty",
			"tool.sw_exec.error.invalidWorkdir": "sw_exec: invalid remote working directory {dir}",
			"tool.sw_exec.error.workdirShape": "sw_exec: workdir must be a POSIX path or ssh://<id>/<path> (remote world)",
			"tool.sw_exec.error.relativeNoCwd": "sw_exec: relative workdir requires a remote session cwd",
			"tool.sw_exec.error.absoluteShape": "sw_exec: workdir must be an absolute POSIX path or ssh://<id>/<path>",
			"tool.sw_exec.error.unknownServer": "sw_exec: unknown server \"{id}\"",
			"tool.sw_exec.error.noActive": "sw_exec: no active server — call sw_connect first",
			"tool.sw_exec.error.spawnFailed": "sw_exec: spawn failed: {detail}",
			"tool.sw_exec.error.serverRequired": "sw_exec: server required for local sessions",
			"tool.sw_exec.error.noSession": "sw_exec: cannot resolve this session id — refusing to execute (fail closed)",
			"tool.sw_exec.error.notConnectedNone": "sw_exec: no machine is connected to this session — call sw_connect(machines: [...]) first",
			"tool.sw_exec.error.notConnected": "sw_exec: server \"{id}\" is not connected to this session (connected here: {ids})",
			"tool.bash.description": "Execute a bash command (`bash -c`) on the session's remote Linux workspace and return its stdout/stderr. This host is Windows and has no local bash: the command always runs on the remote server the session routes to, and a local (Windows) session errors — use pwsh there. Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]` — investigate failures before moving on. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available.",
			"tool.bash.param.workdir": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it; `ssh://<id>/<path>` names a machine and directory explicitly.",
			"tool.bash.output.background": "started background job {jobId}",
			"tool.bash.error.localSession": "The bash tool targets remote Linux workspaces (this host is Windows and has no local bash); use pwsh or the terminal panel",
			"tool.bash.error.spawnFailed": "bash: spawn failed: {detail}",
			"tool.param.command": "The command to execute on the target server.",
			"tool.param.description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"npm install\" → \"Install package dependencies\".",
			"tool.param.timeout": "Timeout in milliseconds (executor default 120s, cap 600s — overrides are clamped). The tool kills the command on expiry and reports [timed out after Nms].",
			"tool.param.runInBackground": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.",
			"tool.job.detail.killed": "killed before exit",
			"tool.job.detail.signal": "signal: {sig}",
			"tool.job.detail.exit": "exit code: {code}",
			"tool.output.dropped": "[some output was dropped from memory; full output: {path}]",
			"tool.output.truncated": "[output truncated; full output: {path}]",
			"tool.output.stderrMarker": "[stderr]",
			"tool.output.empty": "(no output)",
			"tool.output.timedOut": "[timed out after {ms}ms]",
			"tool.output.killedSignal": "[killed by signal: {sig}]",
			"tool.output.exitCode": "[exit code: {code}]",
			"tool.error.subprocessMissing": "sw_exec: the subprocess seam is not mounted (is dsh-workspace-enhancement mounted?)",
			"tool.error.jobsUnavailable": "background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs",
			"tool.error.backgroundDisabled": "run_in_background is disabled for this deployment (enableRunInBackground: false)",
			"tool.error.aborted": "tool call aborted",
			"tool.param.error.commandEmpty": "invalid command: expected a non-empty string",
			"tool.param.error.descriptionEmpty": "invalid description: expected a non-empty string",
			"tool.param.error.timeoutInvalid": "invalid timeoutMs: expected a positive number, got {v}"
		};
		//#endregion
		//#region lib/locale/index.js
		/**
		* `dsw` locale dictionary exports — shared by the client half (registered as
		* namespace `dsw` through `ctx.locale`) and the host half (`src/locale/host.ts`).
		*
		* Exported here (all platform-neutral, no framework value imports): the ZH/EN
		* dictionaries, the `DswKey` type, the pure `lookup()` translator used by the
		* host side, and the `registerDswLocale` client wiring primitive. This module
		* is internal — it is NOT re-exported from `src/index.ts` (the plugin's public
		* entry keeps `exports` unchanged).
		* @module src/locale
		*/
		/**
		* Pure dictionary lookup with the same semantics as the framework chain,
		* minus the `common` step (the host dictionary is self-contained — see
		* drafts/i18n-design.md §2.3): `dsw-<active> → dsw-en → 键本身`.
		*
		* `{name}` placeholders are interpolated with the framework's rule: a
		* placeholder whose name exists in `params` is replaced by `String(value)`,
		* otherwise the placeholder text is kept verbatim.
		* @param locale - the active locale.
		* @param key - a key of the `dsw` namespace (compile-time checked).
		* @param params - leaf template values only; never secrets.
		*/
		function lookup(locale, key, params) {
			const text = (locale === "zh" ? zh[key] ?? en[key] : en[key]) ?? key;
			if (params === void 0) return text;
			return text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
		}
		/**
		* Client-side dictionary registration (drafts/i18n-design.md §9): one typed
		* `register('dsw', { zh, en })` call inside `ctx.effect`, so the registration
		* is disposed together with the plugin context. The framework register
		* returns an idempotent disposer and throws on a duplicate (ns, locale)
		* registration — a programming-error guard the caller (client apply) relies on.
		*/
		function registerDswLocale(ctx) {
			ctx.effect(() => ctx.locale.register("dsw", {
				zh,
				en
			}), "dsw: dictionaries");
		}
		//#endregion
		//#region lib/client/status.js
		/**
		* Connection status UI shared by every machine surface (settings rows, the
		* add-workspace flow sidebar, the DOM row layer): the `/dsw/conn.*` wire
		* contract, a small TTL + in-flight dedupe status center, the `useConnStatus`
		* hook, and the tri-state badge component (◇ unknown / ● active / ● offline)
		* with the "re-check and try to connect" affordance.
		*
		* The wire contract mirrors the host's ConnectionStatusView (registry.ts);
		* unknown fields are tolerated. No new dependencies.
		* @module dsh-workspace-enhancement/client/status
		*/
		/**
		* zh baseline translate: the design's backward-compatible default for pure
		* render helpers and for components whose caller does not thread a `t` seat
		* yet — renders the zh dictionary (identical output to the pre-i18n literals).
		*/
		const zhBaseline = (key, params) => lookup("zh", key, params);
		const isRecord$4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		/** Structural check of one conn.status row. */
		function asConnStatus(value) {
			if (!isRecord$4(value)) return null;
			if (typeof value.id !== "string" || typeof value.host !== "string" || typeof value.username !== "string") return null;
			const state = value.state === "active" || value.state === "offline" ? value.state : "unknown";
			const view = {
				id: value.id,
				state,
				connected: value.connected === true,
				label: typeof value.label === "string" ? value.label : value.host,
				host: value.host,
				port: typeof value.port === "number" ? value.port : 22,
				username: value.username,
				hostKeyKnown: value.hostKeyKnown === true
			};
			if (typeof value.lastProbeAt === "string") view.lastProbeAt = value.lastProbeAt;
			if (typeof value.lastProbeLatencyMs === "number") view.lastProbeLatencyMs = value.lastProbeLatencyMs;
			if (typeof value.message === "string") view.message = value.message;
			return view;
		}
		/** Unwrap a wire result into its value (throws the business message). */
		function unwrap$3(result, t) {
			if (!result.ok) throw new Error(result.error.message || t("status.rpc.failed"));
			return result.value;
		}
		const DEFAULT_NETWORK_TTL_MS = 1e4;
		const DEFAULT_PROBE_TTL_MS = 4e3;
		/** Create a status center backed by one `/dsw` RPC channel. */
		function createStatusCenter(rpc, statusTtlMs = DEFAULT_NETWORK_TTL_MS, probeTtlMs = DEFAULT_PROBE_TTL_MS, getT = () => zhBaseline) {
			const cache = /* @__PURE__ */ new Map();
			const inflight = /* @__PURE__ */ new Map();
			const fresh = (id, ttl) => {
				const entry = cache.get(id);
				if (entry === void 0) return null;
				return Date.now() - entry.at < ttl ? entry.view : null;
			};
			const put = (view) => {
				cache.set(view.id, {
					view,
					at: Date.now()
				});
				return view;
			};
			/**
			* P2-①: dedupe keyed by `endpoint:id`, never by id alone. `conn.status`
			* (cache-first read), `conn.probe` (live echo), and `conn.reconnect`
			* (dispose + rebuild + probe) have different semantics and different
			* TTLs — sharing one id slot made a reconnect return a stale probe or a
			* status read latch onto a pending probe and never issue its own request.
			* Each endpoint keeps its own in-flight slot per id; the TTL cache stays
			* per id (the latest view of the entry).
			* (t8: this used to take a per-call `ttl` that nothing consumed — expiry
			* is honored at read time by {@link StatusCenter.peek} / `get` via
			* {@link fresh}; the dead parameter is gone.)
			* (t15-r2: the translate seat is a LIVE PROVIDER, never a snapshot — the
			* unwrap fallback reads the active language at call time, so a language
			* switch needs no re-created center.)
			*/
			const networked = (id, endpoint) => {
				const key = `${endpoint}:${id}`;
				const pending = inflight.get(key);
				if (pending !== void 0) return pending;
				const call = rpc(endpoint, { id }).then((result) => {
					const view = asConnStatus(unwrap$3(result, getT()));
					return view === null ? null : put(view);
				}).catch(() => null).finally(() => {
					inflight.delete(key);
				});
				inflight.set(key, call);
				return call;
			};
			return {
				peek: (id) => fresh(id, Math.max(statusTtlMs, probeTtlMs)),
				get: (id) => {
					const cached = fresh(id, statusTtlMs);
					if (cached !== null) return Promise.resolve(cached);
					return networked(id, "conn.status");
				},
				probe: (id) => networked(id, "conn.probe"),
				reconnect: (id) => networked(id, "conn.reconnect")
			};
		}
		let sharedCenter = null;
		/** The latest live translate provider the shared center unwraps with. */
		let sharedGetT = () => zhBaseline;
		/** The app-wide center (one `/dsw` channel in the client bundle). */
		function getStatusCenter(rpc, getT = () => zhBaseline) {
			sharedGetT = getT;
			sharedCenter ??= createStatusCenter(rpc, void 0, void 0, () => sharedGetT());
			return sharedCenter;
		}
		/** Bind one entry's status to a component (auto-fetch + refresh actions). */
		function useConnStatus(center, id) {
			const [view, setView] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (center === null || id === void 0) return;
				let alive = true;
				setView(center.peek(id));
				center.get(id).then((found) => {
					if (alive) setView(found);
				});
				return () => {
					alive = false;
				};
			}, [center, id]);
			const run = (fn) => {
				return async () => {
					if (center === null || id === void 0) return null;
					setBusy(true);
					try {
						const found = await fn();
						setView(found);
						return found;
					} catch {
						return null;
					} finally {
						setBusy(false);
					}
				};
			};
			return (0, react.useMemo)(() => ({
				view,
				busy,
				refresh: run(() => center !== null && id !== void 0 ? center.get(id) : Promise.resolve(null)),
				reconnect: run(() => center !== null && id !== void 0 ? center.reconnect(id) : Promise.resolve(null))
			}), [
				center,
				id,
				busy,
				view
			]);
		}
		/**
		* The dictionary-key mapping of the tri-state label — the single key source
		* for the React badge AND the DOM row-badge layer (row-badges, t8). The plain
		* legacy label map ({@link CONN_STATE_LABEL}) was removed in t15-r2: its last
		* consumer (the DOM row layer) migrated to the KEY mapping in t8, so the
		* frozen zh-only snapshot only ever threatened to drift from the dictionary.
		*/
		const CONN_STATE_LABEL_KEY = {
			unknown: "status.unknown",
			active: "status.active",
			offline: "status.offline"
		};
		const CONN_STATE_COLOR = {
			unknown: "#8a8f98",
			active: "#98c379",
			offline: "#e06c75"
		};
		/**
		* The tri-state badge: colored dot + label, and (unless `compact`) the
		* "re-check and try to connect" button shown for unknown/offline entries.
		*/
		function ConnStatusBadge({ id, rpc, center, compact = false, t: tSeat }) {
			const t = tSeat ?? zhBaseline;
			const { view, busy, reconnect } = useConnStatus(center !== void 0 ? center : getStatusCenter(rpc, () => t), id);
			const state = view?.state ?? "unknown";
			const label = busy ? t("status.checking") : t(CONN_STATE_LABEL_KEY[state]);
			const actionTitle = t("status.retryAction.title");
			return (0, react_jsx_runtime.jsxs)("span", {
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 4,
					verticalAlign: "middle"
				},
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						title: view?.message !== void 0 && view.message !== "" ? view.message : t(CONN_STATE_LABEL_KEY[state]),
						style: {
							width: 8,
							height: 8,
							borderRadius: "50%",
							background: CONN_STATE_COLOR[state],
							display: "inline-block",
							flexShrink: 0
						}
					}),
					(0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							opacity: .85,
							whiteSpace: "nowrap"
						},
						children: label
					}),
					state !== "active" && (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						title: actionTitle,
						disabled: busy,
						onClick: () => {
							reconnect();
						},
						style: {
							padding: compact ? "1px 5px" : "2px 6px",
							borderRadius: 6,
							border: "1px solid rgba(128,128,128,0.35)",
							background: "rgba(128,128,128,0.08)",
							color: "inherit",
							cursor: busy ? "default" : "pointer",
							fontSize: compact ? 10 : 11,
							whiteSpace: "nowrap"
						},
						children: compact ? t("status.retryAction.compact") : t("status.retryAction.full")
					})
				]
			});
		}
		//#endregion
		//#region lib/client/machine-payload.js
		/**
		* Build the `machines.add`/`machines.test` payload from the form state.
		*
		* 5.11-b: the host's backend resolution keeps the previous machine backend when
		* the payload carries neither `credentialBackend` nor `encryptPassword`, so
		* unchecking the keychain toggle and typing a NEW password alone would leave a
		* keychain machine keychain-backed. An explicit `credentialBackend: 'plain'`
		* opts it back into plaintext. With no new password the payload stays silent
		* (the machine keeps its current backend — no accidental switch).
		*
		* P2-④: `privateKeyPath` follows the 密码 convention — 编辑时留空 = 保持不变.
		* The machine view is secret-free (the form never sees the stored key path),
		* so an EDIT payload with an empty field must OMIT the key entirely
		* (undefined = the host keeps the stored value); a NEW machine sends the
		* trimmed value even when empty ('' = 未配置). A non-empty path is always
		* sent (a typed replacement applies to both new and edited machines).
		*
		* t8: `jump` follows the same wire contract — undefined OMITS the chain (the
		* host keeps the stored one), an EXPLICIT array (even empty) replaces it, so
		* `[]` is the "clear the chain" signal an edit needs (a cleared jump text
		* would otherwise silently keep the old chain). The caller decides which
		* state applies (see {@link jumpChainOf} in machine-form.tsx).
		* @param form - the current form state.
		* @param jump - the parsed ProxyJump chain: `[]` = clear an edited machine's
		*   chain; undefined = omit (unchanged/new); non-empty = replace.
		* @returns the wire payload.
		*/
		function machinePayload(form, jump) {
			const isEdit = form.id !== "";
			return {
				...isEdit ? { id: form.id } : {},
				label: form.name.trim(),
				name: form.name.trim(),
				host: form.host.trim(),
				port: Number(form.port) || 22,
				username: form.username.trim() || "root",
				...form.password !== "" ? { password: form.password } : {},
				...isEdit ? form.privateKeyPath.trim() !== "" ? { privateKeyPath: form.privateKeyPath.trim() } : {} : { privateKeyPath: form.privateKeyPath.trim() },
				...form.passphrase !== "" ? { passphrase: form.passphrase } : {},
				workspace: form.workspace.trim(),
				...form.hostKeyMode !== "" ? { hostKeyMode: form.hostKeyMode } : {},
				remoteApproval: form.remoteApproval,
				remoteSandbox: form.remoteSandbox,
				encryptPassword: form.encryptPassword,
				...form.password !== "" && !form.encryptPassword ? { credentialBackend: "plain" } : {},
				...jump !== void 0 ? { jump: jump.map((hop) => ({
					host: hop.host,
					...hop.port !== void 0 && hop.port !== 22 ? { port: hop.port } : {},
					...hop.username !== void 0 && hop.username !== "" ? { username: hop.username } : {}
				})) } : {}
			};
		}
		//#endregion
		//#region lib/client/machine-form.js
		/**
		* The shared machine/connection form (R2 表单并集): the union of the settings
		* page「添加服务器」form and the add-workspace flow's「新建连接」form — one
		* component, one field set, one interaction set; only the submit action
		* differs by `mode`.
		*
		* Union surface (docs/ui-merge-design.md §2): 主机名/别名（失焦/粘贴自动解析 +
		* 「识别 ssh 配置 ▾」精确别名下拉）、端口、用户名（预填 root）、名称（默认
		* user@host，留空由宿主回退）、默认工作区、认证 tabs（私钥文件/密码；切换
		* 不清空对方）、私钥路径（编辑留空=保持不变，P2-④）、私钥口令、密码（编辑
		* 留空=不变）、高级折叠区（加密保存密码 checkbox——认证=密码时显示；HostKey
		* 模式 select；跳板链文本 + 实时校验摘要 + 清除 + 提交时坏段阻止保存，P2-②）、
		* 测试连接（loading + 结果）、保存（同步 busy 守卫防双击双发，P2-③）。
		*
		* `mode='settings'`：保存后清空表单 + 成功提示（banner 保留）；`mode='flow'`：
		* 保存按钮文案「保存并浏览」，成功后通过 `onSaved(view)` 交给外壳切换目录浏览。
		* Payload 唯一出口是 {@link module:dsh-workspace-enhancement/client/machine-payload}
		* 的 machinePayload（含跳板链）；测试连接走 machines.test；服务端零改动。
		* 全部样式内联、中文标签；无新依赖。
		* @module dsh-workspace-enhancement/client/machine-form
		*/
		const isRecord$3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		/** Parse a `[user@]host[:port]` jump list (comma/space separated). */
		function parseJumpText(text) {
			return text.split(/[\s,]+/).map((entry) => entry.trim()).filter((entry) => entry !== "").map((entry) => {
				let rest = entry;
				let username;
				let port;
				const at = rest.lastIndexOf("@");
				if (at >= 0) {
					username = rest.slice(0, at);
					rest = rest.slice(at + 1);
				}
				const colon = rest.lastIndexOf(":");
				if (colon >= 0) {
					const parsed = Number(rest.slice(colon + 1));
					if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
						port = parsed;
						rest = rest.slice(0, colon);
					}
				}
				return {
					host: rest,
					...port !== void 0 ? { port } : {},
					...username !== void 0 && username !== "" ? { username } : {}
				};
			});
		}
		/** Render one resolved hop as `user@host:port` (defaults hidden). */
		function formatHop(hop) {
			return `${hop.username !== void 0 && hop.username !== "" ? `${hop.username}@` : ""}${hop.host}${hop.port !== void 0 && hop.port !== 22 ? `:${String(hop.port)}` : ""}`;
		}
		/** Realtime jump summary: `3 · user@b1 → host:2202`, or the bad-input hint. */
		function jumpSummaryOf(text, t = zhBaseline) {
			const hops = parseJumpText(text);
			if (hops.length === 0) return "";
			if (hops.some((hop) => hop.host.trim() === "")) return t("form.jump.unresolved");
			const joined = hops.map(formatHop).join(" → ");
			return hops.length === 1 ? t("form.jump.summaryOne", {
				count: hops.length,
				hops: joined
			}) : t("form.jump.summary", {
				count: hops.length,
				hops: joined
			});
		}
		/**
		* P2-②: submit-time jump validation. A non-empty jump text that cannot be
		* parsed into hosts is a hard error — the payload must never silently drop
		* the chain (the old code sent no `jump` when a segment was malformed while
		* the summary already warned). Returns the error text, or null when the jump
		* is absent or fully parseable.
		*/
		function jumpErrorOf(text, t = zhBaseline) {
			const trimmed = text.trim();
			if (trimmed === "") return null;
			const hops = parseJumpText(trimmed);
			if (hops.length === 0 || hops.some((hop) => hop.host.trim() === "")) return t("form.jump.unresolvedHint");
			return null;
		}
		/**
		* t8: the jump chain to put on the wire. A non-empty text parses to its hops.
		* An EMPTY text during an EDIT whose machine HAD a jump chain (the
		* secret-free initial knows only its `jumpText`) yields `[]` — the explicit
		* clear, because an omitted chain keeps the stored one and the operator must
		* be able to REMOVE the chain. A new machine, or an edit of one that never
		* had a chain, yields undefined (omit = no jump). The wire builder
		* (machinePayload) serializes `[]` as-is.
		*/
		function jumpChainOf(text, isEdit, hadJumpText) {
			const jumped = parseJumpText(text);
			if (jumped.length > 0) return jumped;
			return isEdit && (hadJumpText ?? "").trim() !== "" ? [] : void 0;
		}
		/**
		* P2-③: synchronous busy gate. `busy` state turns the buttons `disabled` only
		* after a re-render, so two clicks in one tick both pass the `disabled` check
		* and double-send; the gate flips synchronously on claim and clears in
		* `finally`, which closes that window. Only the current owner may release, so
		* an overlapping operation (resolve/test/save) can never clear another one's
		* busy state — the old code let a late resolve's `finally` re-enable the
		* buttons while a save was still in flight.
		*/
		function createActionGate() {
			let owner = null;
			return {
				busy: () => owner !== null,
				claim(task) {
					if (owner !== null) return false;
					owner = task;
					return true;
				},
				release(task) {
					if (owner !== task) return false;
					owner = null;
					return true;
				}
			};
		}
		/** The one-line resolve summary: alias → user@host:port · identity · jumps. */
		function formatResolvedSummary(resolved, t = zhBaseline) {
			const endpoint = `${resolved.username !== "" ? `${resolved.username}@` : ""}${resolved.host}${resolved.port !== 22 ? `:${String(resolved.port)}` : ""}`;
			const parts = [];
			if (resolved.alias.toLowerCase() !== resolved.host.toLowerCase()) parts.push(`${resolved.alias} → ${endpoint}`);
			else parts.push(endpoint);
			if (resolved.privateKeyPaths[0] !== void 0) parts.push(t("form.resolve.privateKey", { path: resolved.privateKeyPaths[0] }));
			if (resolved.jump.length > 0) parts.push(t("form.resolve.jump", { hops: resolved.jump.map(formatHop).join(" → ") }));
			return parts.join(" · ");
		}
		/** Structural check of a `connections.resolve` result. */
		function asResolved$1(value) {
			const record = isRecord$3(value) ? value : {};
			const jump = Array.isArray(record.jump) ? record.jump.filter(isRecord$3).map((hop) => ({
				host: String(hop.host ?? ""),
				...typeof hop.port === "number" ? { port: hop.port } : {},
				...typeof hop.username === "string" && hop.username !== "" ? { username: hop.username } : {}
			})) : [];
			return {
				host: String(record.host ?? ""),
				username: String(record.username ?? ""),
				port: typeof record.port === "number" ? record.port : 22,
				privateKeyPaths: Array.isArray(record.privateKeyPaths) ? record.privateKeyPaths.filter((path) => typeof path === "string") : [],
				jump,
				alias: String(record.alias ?? "")
			};
		}
		/** Structural check of one machine save result (`machines.add`/`saveMachine`). */
		function asSaveView(value) {
			if (!isRecord$3(value)) return null;
			if (typeof value.id !== "string" || value.id === "") return null;
			return {
				id: value.id,
				label: typeof value.label === "string" ? value.label : String(value.host ?? ""),
				host: typeof value.host === "string" ? value.host : "",
				port: typeof value.port === "number" ? value.port : 22,
				username: typeof value.username === "string" ? value.username : "",
				...value.encryptFallback === true ? { encryptFallback: true } : {}
			};
		}
		function asConfigHosts$1(value) {
			if (!Array.isArray(value)) return [];
			return value.filter(isRecord$3).map((record) => ({
				alias: String(record.alias ?? ""),
				host: String(record.host ?? ""),
				username: String(record.username ?? ""),
				port: typeof record.port === "number" ? record.port : 22,
				identityFile: record.identityFile === true,
				jump: record.jump === true
			})).filter((host) => host.alias !== "");
		}
		/** Shared inline styles (settings-page vocabulary; used by both shells). */
		const inputStyle = {
			flex: 1,
			minWidth: 0,
			boxSizing: "border-box",
			padding: "6px 10px",
			borderRadius: 8,
			border: "1px solid rgba(128,128,128,0.35)",
			background: "rgba(128,128,128,0.08)",
			color: "inherit",
			outline: "none",
			fontSize: 13
		};
		const inputErrorStyle = { borderColor: "#e06c75" };
		const buttonStyle = {
			padding: "6px 12px",
			borderRadius: 8,
			border: "1px solid rgba(128,128,128,0.35)",
			background: "rgba(128,128,128,0.08)",
			color: "inherit",
			cursor: "pointer",
			fontSize: 12,
			whiteSpace: "nowrap"
		};
		const primaryStyle = {
			...buttonStyle,
			border: "none",
			background: "#2563eb",
			color: "#fff",
			fontWeight: 600
		};
		const segmentStyle = (active) => ({
			padding: "4px 10px",
			borderRadius: 6,
			border: active ? "1px solid #2563eb" : "1px solid rgba(128,128,128,0.35)",
			background: active ? "rgba(37,99,235,0.18)" : "rgba(128,128,128,0.08)",
			color: "inherit",
			cursor: "pointer",
			fontSize: 12,
			whiteSpace: "nowrap"
		});
		/** One field row: label column + control. */
		function fieldRow(label, control, key, hint) {
			return (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					gap: 6,
					alignItems: "flex-start",
					marginBottom: 8,
					flexWrap: "wrap"
				},
				children: [(0, react_jsx_runtime.jsx)("label", {
					style: {
						width: 90,
						fontSize: 12,
						opacity: .8,
						flexShrink: 0,
						paddingTop: 8
					},
					children: label
				}), (0, react_jsx_runtime.jsxs)("div", {
					style: {
						flex: 1,
						display: "flex",
						flexDirection: "column",
						gap: 4,
						minWidth: 180
					},
					children: [control, hint !== void 0 ? (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 11,
							opacity: .6
						},
						children: hint
					}) : null]
				})]
			}, key);
		}
		/** The shared form body: fields + feedback + actions (no modal shell). */
		function MachineForm({ mode, rpc, initial, onSaved, onCancel, t: tSeat }) {
			const t = tSeat ?? zhBaseline;
			const initialState = () => ({
				id: initial?.id ?? "",
				name: initial?.name ?? "",
				host: initial?.host ?? "",
				port: initial?.port ?? "22",
				username: initial?.username ?? "root",
				password: "",
				privateKeyPath: initial?.privateKeyPath ?? "",
				passphrase: initial?.passphrase ?? "",
				workspace: initial?.workspace ?? "",
				hostKeyMode: initial?.hostKeyMode ?? "",
				encryptPassword: initial?.encryptPassword ?? false,
				remoteApproval: initial?.remoteApproval ?? "off",
				remoteSandbox: initial?.remoteSandbox ?? "off"
			});
			const [form, setForm] = (0, react.useState)(initialState);
			const [authKind, setAuthKind] = (0, react.useState)(initial?.auth ?? (initial?.encryptPassword === true ? "password" : "key"));
			const [jumpText, setJumpText] = (0, react.useState)(initial?.jumpText ?? "");
			const [advanced, setAdvanced] = (0, react.useState)(initial?.hostKeyMode !== void 0 && initial.hostKeyMode !== "" || initial?.jumpText !== void 0 && initial.jumpText !== "" || initial?.encryptPassword === true || initial?.remoteApproval !== void 0 && initial.remoteApproval !== "off" || initial?.remoteSandbox !== void 0 && initial.remoteSandbox !== "off");
			const [revealed, setRevealed] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [busyTask, setBusyTask] = (0, react.useState)(null);
			const [feedback, setFeedback] = (0, react.useState)(null);
			const [resolveSummary, setResolveSummary] = (0, react.useState)(null);
			const [autoBusy, setAutoBusy] = (0, react.useState)(false);
			const [configOpen, setConfigOpen] = (0, react.useState)(false);
			const [configBusy, setConfigBusy] = (0, react.useState)(false);
			const [configList, setConfigList] = (0, react.useState)(null);
			const [configError, setConfigError] = (0, react.useState)(null);
			const usernameRef = (0, react.useRef)(null);
			const autoGeneration = (0, react.useRef)(0);
			const lastAutoHost = (0, react.useRef)(null);
			const actionGate = (0, react.useRef)(createActionGate()).current;
			(0, react.useEffect)(() => {
				if (initial?.focusUsername === true) usernameRef.current?.focus();
			}, [initial?.focusUsername]);
			const errorsOf = () => {
				const errors = {};
				if (form.host.trim() === "") errors.host = t("form.error.host");
				const portText = form.port.trim();
				if (portText === "") errors.port = t("form.error.required");
				else if (!/^\d+$/.test(portText)) errors.port = t("form.error.port.number");
				else {
					const parsed = Number(portText);
					if (parsed < 1 || parsed > 65535) errors.port = t("form.error.port.range");
				}
				if (form.username.trim() === "") errors.username = t("form.error.username");
				return errors;
			};
			const errorOf = (key) => revealed ? errorsOf()[key] : void 0;
			/** Prefill every field the resolution covers; keep operator edits elsewhere. */
			const applyResolved = (resolved, currentCwd, currentUser) => {
				setForm((prev) => ({
					...prev,
					host: resolved.host,
					...resolved.port !== 22 ? { port: String(resolved.port) } : {},
					...resolved.username !== "" ? { username: resolved.username } : {},
					...resolved.privateKeyPaths[0] !== void 0 ? { privateKeyPath: resolved.privateKeyPaths[0] } : {},
					...currentCwd.trim() === "" && (resolved.username !== "" ? resolved.username : currentUser).trim() !== "" ? { workspace: `/home/${(resolved.username !== "" ? resolved.username : currentUser).trim()}` } : {}
				}));
				if (resolved.privateKeyPaths.length > 0) setAuthKind("key");
				setJumpText(resolved.jump.map(formatHop).join(", "));
				setResolveSummary(resolved);
			};
			/**
			* Silent alias resolution for blur/paste: no validation reveal, no error
			* surface, never disables the form. Guarded by its own generation counter
			* so a stale answer cannot clobber a newer edit.
			*/
			const autoResolve = async (value) => {
				const hostText = value.trim();
				if (hostText === "" || actionGate.busy()) return;
				if (lastAutoHost.current === hostText) return;
				lastAutoHost.current = hostText;
				const current = autoGeneration.current += 1;
				setAutoBusy(true);
				try {
					const result = await rpc("connections.resolve", { host: hostText });
					if (!result.ok) return;
					const resolved = asResolved$1(result.value);
					if (current !== autoGeneration.current) return;
					applyResolved(resolved, form.workspace, form.username);
				} catch {} finally {
					if (current === autoGeneration.current) setAutoBusy(false);
				}
			};
			const resolveExplicit = async (alias, expectedCount = 0) => {
				if (!actionGate.claim("resolve")) return;
				const current = autoGeneration.current += 1;
				setAutoBusy(false);
				setBusy(true);
				setBusyTask("resolve");
				setFeedback({
					kind: "info",
					text: t("form.config.reading")
				});
				try {
					const result = await rpc("connections.resolve", { host: alias.trim() });
					if (!result.ok) throw new Error(result.error.message);
					const resolved = asResolved$1(result.value);
					if (current !== autoGeneration.current) return;
					lastAutoHost.current = resolved.host;
					applyResolved(resolved, form.workspace, form.username);
					setFeedback({
						kind: "success",
						text: t("form.config.resolved", {
							alias: resolved.alias,
							endpoint: `${resolved.username !== "" ? `${resolved.username}@` : ""}${resolved.host}${resolved.port !== 22 ? `:${String(resolved.port)}` : ""}`
						})
					});
					if (expectedCount > 0) setConfigList((previous) => previous === null ? previous : previous.filter((host) => host.alias !== alias));
				} catch (error) {
					setFeedback({
						kind: "error",
						text: t("form.config.resolveFailed", { message: error instanceof Error ? error.message : String(error) })
					});
				} finally {
					if (actionGate.release("resolve")) {
						setBusy(false);
						setBusyTask(null);
					}
				}
			};
			const toggleConfigList = async () => {
				if (configOpen) {
					setConfigOpen(false);
					return;
				}
				setConfigOpen(true);
				if (configList !== null) return;
				setConfigBusy(true);
				setConfigError(null);
				try {
					const result = await rpc("config.hosts");
					if (!result.ok) throw new Error(result.error.message);
					setConfigList(asConfigHosts$1(result.value));
				} catch (error) {
					setConfigList([]);
					setConfigError(error instanceof Error ? error.message : String(error));
				} finally {
					setConfigBusy(false);
				}
			};
			/**
			* The wire payload. P2-②: submissions validate the jump chain before this
			* runs (`jumpErrorOf`), so a malformed segment can no longer be silently
			* dropped — the parsed chain is always passed through verbatim. t8:
			* `jumpChainOf` turns an emptied chain on an edit that previously had one
			* into the explicit `jump: []` clear (an omitted chain would keep it).
			*/
			const payload = () => {
				return machinePayload(form, jumpChainOf(jumpText, form.id !== "", initial?.jumpText));
			};
			const runTest = async () => {
				if (!actionGate.claim("test")) return;
				try {
					setRevealed(true);
					setConfigOpen(false);
					const jumpError = jumpErrorOf(jumpText, t);
					if (jumpError !== null) {
						setFeedback({
							kind: "error",
							text: jumpError
						});
						return;
					}
					const input = payload();
					if (form.host.trim() === "") {
						setFeedback({
							kind: "error",
							text: t("form.test.noHost")
						});
						return;
					}
					const editing = form.id !== "";
					if (authKind === "password" && input.password === void 0 && !editing) {
						setFeedback({
							kind: "error",
							text: t("form.test.noPassword")
						});
						return;
					}
					if (authKind === "key" && (input.privateKeyPath === void 0 || input.privateKeyPath === "")) {
						if (!editing) {
							setFeedback({
								kind: "error",
								text: t("form.test.noKey")
							});
							return;
						}
					}
					setBusy(true);
					setBusyTask("test");
					setFeedback({
						kind: "info",
						text: t("form.test.testing")
					});
					try {
						const result = await rpc("machines.test", input);
						setFeedback(result.ok ? {
							kind: "success",
							text: t("form.test.success")
						} : {
							kind: "error",
							text: t("form.test.failed", { message: result.error.message })
						});
					} catch (error) {
						setFeedback({
							kind: "error",
							text: t("form.test.error", { message: error instanceof Error ? error.message : String(error) })
						});
					}
				} finally {
					if (actionGate.release("test")) {
						setBusy(false);
						setBusyTask(null);
					}
				}
			};
			const runSave = async () => {
				if (!actionGate.claim("save")) return;
				try {
					setRevealed(true);
					setConfigOpen(false);
					const found = errorsOf();
					if (found.host !== void 0 || found.port !== void 0 || found.username !== void 0) {
						setFeedback({
							kind: "error",
							text: t("form.save.incomplete")
						});
						return;
					}
					const jumpError = jumpErrorOf(jumpText, t);
					if (jumpError !== null) {
						setFeedback({
							kind: "error",
							text: jumpError
						});
						return;
					}
					setBusy(true);
					setBusyTask("save");
					setFeedback({
						kind: "info",
						text: t("form.save.saving")
					});
					try {
						const result = await rpc("machines.add", payload());
						if (!result.ok) throw new Error(result.error.message);
						const raw = isRecord$3(result.value) ? result.value.machine : void 0;
						const machineRecord = isRecord$3(raw) ? raw : null;
						const view = asSaveView(machineRecord);
						if (view === null) throw new Error(t("form.save.missingId"));
						const fallbackHint = machineRecord?.encryptFallback === true ? t("form.encrypt.fallback") : "";
						if (mode === "settings") {
							setForm(initialState);
							setJumpText("");
							setAuthKind("key");
							setResolveSummary(null);
							setAdvanced(false);
							setFeedback(null);
						}
						onSaved({
							...view,
							...fallbackHint !== "" ? { encryptFallback: true } : {}
						});
					} catch (error) {
						setFeedback({
							kind: "error",
							text: t("form.save.failed", { message: error instanceof Error ? error.message : String(error) })
						});
					}
				} finally {
					if (actionGate.release("save")) {
						setBusy(false);
						setBusyTask(null);
					}
				}
			};
			const resetForm = () => {
				if (actionGate.busy()) return;
				setForm(initialState);
				setJumpText(initial?.jumpText ?? "");
				setAuthKind(initial?.auth ?? "key");
				setAdvanced(false);
				setResolveSummary(null);
				setFeedback(null);
				setRevealed(false);
			};
			const jumpSummary = jumpSummaryOf(jumpText, t);
			const hostError = errorOf("host");
			const portError = errorOf("port");
			const usernameError = errorOf("username");
			const saveLabel = mode === "flow" ? t("form.save.flowLabel") : t("form.save.settingsLabel");
			return (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 4
				},
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 6,
							alignItems: "center",
							marginBottom: 8,
							flexWrap: "wrap"
						},
						children: [(0, react_jsx_runtime.jsxs)("label", {
							style: {
								width: 90,
								fontSize: 12,
								opacity: .8,
								flexShrink: 0
							},
							children: [t("form.label.host"), (0, react_jsx_runtime.jsx)("span", {
								style: { color: "#e06c75" },
								children: " *"
							})]
						}), (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: 1,
								display: "flex",
								flexDirection: "column",
								gap: 4,
								minWidth: 180
							},
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 6
									},
									children: [(0, react_jsx_runtime.jsx)("input", {
										style: {
											...inputStyle,
											...hostError !== void 0 ? inputErrorStyle : {}
										},
										value: form.host,
										placeholder: t("form.placeholder.host"),
										disabled: busy,
										onChange: (event) => {
											setForm((prev) => ({
												...prev,
												host: event.target.value
											}));
											setResolveSummary(null);
											lastAutoHost.current = null;
										},
										onBlur: () => {
											autoResolve(form.host);
										},
										onPaste: (event) => {
											const text = event.clipboardData.getData("text");
											if (text.trim() !== "") autoResolve(text);
										}
									}), (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										style: buttonStyle,
										disabled: busy,
										onClick: () => {
											toggleConfigList();
										},
										children: [t("form.config.recognize"), " ▾"]
									})]
								}),
								autoBusy && (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										opacity: .7
									},
									role: "status",
									children: t("form.config.matching")
								}),
								hostError !== void 0 && (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										color: "#e06c75"
									},
									children: hostError
								}),
								(0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										opacity: .6
									},
									children: t("form.config.hint")
								})
							]
						})]
					}),
					configOpen && (0, react_jsx_runtime.jsx)("div", {
						style: {
							border: "1px solid rgba(128,128,128,0.35)",
							borderRadius: 8,
							marginBottom: 8,
							maxHeight: 180,
							overflowY: "auto",
							background: "rgba(128,128,128,0.06)"
						},
						children: configBusy ? (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: 8,
								fontSize: 12,
								opacity: .6
							},
							children: t("form.config.reading")
						}) : configError !== null ? (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: 8,
								fontSize: 12,
								color: "#e06c75"
							},
							children: configError
						}) : (configList ?? []).length === 0 ? (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: 8,
								fontSize: 12,
								opacity: .6
							},
							children: t("form.config.empty")
						}) : (configList ?? []).map((host) => (0, react_jsx_runtime.jsxs)("div", {
							onClick: () => {
								resolveExplicit(host.alias, (configList ?? []).length);
							},
							style: {
								padding: "6px 10px",
								cursor: "pointer",
								fontSize: 12,
								borderBottom: "1px solid rgba(128,128,128,0.25)"
							},
							children: [
								host.alias,
								" → ",
								host.host,
								host.username !== "" ? ` (${host.username})` : "",
								host.identityFile ? ` ${t("form.config.badge.key")}` : "",
								host.jump ? " ⛳" : ""
							]
						}, host.alias))
					}),
					resolveSummary !== null && (0, react_jsx_runtime.jsxs)("div", {
						style: {
							fontSize: 12,
							color: "#98c379",
							marginBottom: 8
						},
						role: "status",
						children: ["✓ ", formatResolvedSummary(resolveSummary, t)]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 6,
							alignItems: "center",
							marginBottom: 8,
							flexWrap: "wrap"
						},
						children: [(0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 6,
								alignItems: "center",
								flex: "1 1 220px",
								minWidth: 0
							},
							children: [
								(0, react_jsx_runtime.jsxs)("label", {
									style: {
										width: 90,
										fontSize: 12,
										opacity: .8,
										flexShrink: 0
									},
									children: [t("form.label.port"), (0, react_jsx_runtime.jsx)("span", {
										style: { color: "#e06c75" },
										children: " *"
									})]
								}),
								(0, react_jsx_runtime.jsx)("input", {
									style: {
										...inputStyle,
										maxWidth: 110,
										...portError !== void 0 ? inputErrorStyle : {}
									},
									value: form.port,
									inputMode: "numeric",
									disabled: busy,
									onChange: (event) => {
										setForm((prev) => ({
											...prev,
											port: event.target.value
										}));
									}
								}),
								portError !== void 0 && (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										color: "#e06c75"
									},
									children: portError
								})
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 6,
								alignItems: "center",
								flex: "1 1 220px",
								minWidth: 0
							},
							children: [
								(0, react_jsx_runtime.jsxs)("label", {
									style: {
										width: 90,
										fontSize: 12,
										opacity: .8,
										flexShrink: 0
									},
									children: [t("form.label.username"), (0, react_jsx_runtime.jsx)("span", {
										style: { color: "#e06c75" },
										children: " *"
									})]
								}),
								(0, react_jsx_runtime.jsx)("input", {
									ref: usernameRef,
									style: {
										...inputStyle,
										...usernameError !== void 0 ? inputErrorStyle : {}
									},
									value: form.username,
									disabled: busy,
									onChange: (event) => {
										setForm((prev) => ({
											...prev,
											username: event.target.value
										}));
									}
								}),
								usernameError !== void 0 && (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										color: "#e06c75"
									},
									children: usernameError
								})
							]
						})]
					}),
					fieldRow(t("form.label.name"), (0, react_jsx_runtime.jsx)("input", {
						style: inputStyle,
						value: form.name,
						placeholder: t("form.placeholder.name"),
						disabled: busy,
						onChange: (event) => {
							setForm((prev) => ({
								...prev,
								name: event.target.value
							}));
						}
					}), "name"),
					fieldRow(t("form.label.workspace"), (0, react_jsx_runtime.jsx)("input", {
						style: inputStyle,
						value: form.workspace,
						placeholder: t("form.placeholder.workspace"),
						disabled: busy,
						onChange: (event) => {
							setForm((prev) => ({
								...prev,
								workspace: event.target.value
							}));
						}
					}), "workspace"),
					(0, react_jsx_runtime.jsxs)("div", {
						style: { marginBottom: 8 },
						children: [
							(0, react_jsx_runtime.jsx)("label", {
								style: {
									fontSize: 12,
									opacity: .8,
									display: "block",
									marginBottom: 4
								},
								children: t("form.label.auth")
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 6
								},
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "radio",
									"aria-checked": authKind === "key",
									style: segmentStyle(authKind === "key"),
									disabled: busy,
									onClick: () => {
										setAuthKind("key");
									},
									children: t("form.auth.keyTab")
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "radio",
									"aria-checked": authKind === "password",
									style: segmentStyle(authKind === "password"),
									disabled: busy,
									onClick: () => {
										setAuthKind("password");
									},
									children: t("form.auth.passwordTab")
								})]
							}),
							authKind === "key" ? (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 8,
									display: "flex",
									flexDirection: "column",
									gap: 4
								},
								children: [(0, react_jsx_runtime.jsx)("input", {
									style: inputStyle,
									value: form.privateKeyPath,
									placeholder: t("form.placeholder.keyPath"),
									disabled: busy,
									onChange: (event) => {
										setForm((prev) => ({
											...prev,
											privateKeyPath: event.target.value
										}));
									}
								}), (0, react_jsx_runtime.jsx)("input", {
									type: "password",
									style: inputStyle,
									value: form.passphrase,
									placeholder: t("form.placeholder.keyPassphrase"),
									disabled: busy,
									onChange: (event) => {
										setForm((prev) => ({
											...prev,
											passphrase: event.target.value
										}));
									}
								})]
							}) : (0, react_jsx_runtime.jsxs)("div", {
								style: { marginTop: 8 },
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "password",
									style: inputStyle,
									value: form.password,
									placeholder: form.id !== "" ? t("form.placeholder.password.edit") : t("form.placeholder.password.new"),
									disabled: busy,
									onChange: (event) => {
										setForm((prev) => ({
											...prev,
											password: event.target.value
										}));
									}
								}), (0, react_jsx_runtime.jsx)("span", {
									style: {
										display: "block",
										fontSize: 11,
										opacity: .6,
										marginTop: 4
									},
									children: t("form.password.hint.edit")
								})]
							})
						]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: { marginBottom: 8 },
						children: [(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: {
								background: "none",
								border: "none",
								padding: 0,
								color: "inherit",
								fontSize: 12,
								opacity: .75,
								cursor: "pointer",
								textAlign: "left"
							},
							onClick: () => {
								setAdvanced((value) => !value);
							},
							"aria-expanded": advanced,
							children: advanced ? t("form.advanced.expanded") : t("form.advanced.collapsed")
						}), advanced && (0, react_jsx_runtime.jsxs)("div", {
							style: {
								marginTop: 8,
								display: "flex",
								flexDirection: "column",
								gap: 8
							},
							children: [
								authKind === "password" && (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 8
									},
									children: [(0, react_jsx_runtime.jsx)("span", {
										style: {
											width: 90,
											fontSize: 12,
											opacity: .8,
											flexShrink: 0
										},
										children: t("form.label.credentialStore")
									}), (0, react_jsx_runtime.jsxs)("label", {
										style: {
											fontSize: 12,
											display: "flex",
											gap: 4,
											alignItems: "center"
										},
										children: [(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: form.encryptPassword,
											disabled: busy,
											onChange: (event) => {
												setForm((prev) => ({
													...prev,
													encryptPassword: event.target.checked
												}));
											}
										}), t("form.encrypt.checkbox")]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 8
									},
									children: [(0, react_jsx_runtime.jsx)("span", {
										style: {
											width: 90,
											fontSize: 12,
											opacity: .8,
											flexShrink: 0
										},
										children: t("form.label.hostKey")
									}), (0, react_jsx_runtime.jsxs)("select", {
										style: {
											...inputStyle,
											maxWidth: 260
										},
										value: form.hostKeyMode,
										disabled: busy,
										onChange: (event) => {
											setForm((prev) => ({
												...prev,
												hostKeyMode: event.target.value
											}));
										},
										children: [
											(0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: t("form.hostKey.default")
											}),
											(0, react_jsx_runtime.jsx)("option", {
												value: "accept-new",
												children: t("form.hostKey.acceptNew")
											}),
											(0, react_jsx_runtime.jsx)("option", {
												value: "verify",
												children: t("form.hostKey.verify")
											}),
											(0, react_jsx_runtime.jsx)("option", {
												value: "off",
												children: t("form.hostKey.off")
											})
										]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "flex-start",
										gap: 8,
										flexWrap: "wrap"
									},
									children: [(0, react_jsx_runtime.jsx)("span", {
										style: {
											width: 90,
											fontSize: 12,
											opacity: .8,
											flexShrink: 0,
											paddingTop: 8
										},
										children: t("form.label.remoteApproval")
									}), (0, react_jsx_runtime.jsxs)("div", {
										style: {
											flex: 1,
											display: "flex",
											flexDirection: "column",
											gap: 4,
											minWidth: 180
										},
										children: [(0, react_jsx_runtime.jsxs)("select", {
											style: {
												...inputStyle,
												maxWidth: 260
											},
											value: form.remoteApproval,
											disabled: busy,
											onChange: (event) => {
												setForm((prev) => ({
													...prev,
													remoteApproval: event.target.value
												}));
											},
											children: [
												(0, react_jsx_runtime.jsx)("option", {
													value: "off",
													children: t("form.remoteApproval.off")
												}),
												(0, react_jsx_runtime.jsx)("option", {
													value: "human",
													children: t("form.remoteApproval.human")
												}),
												(0, react_jsx_runtime.jsx)("option", {
													value: "ai",
													children: t("form.remoteApproval.ai")
												})
											]
										}), (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 11,
												opacity: .6
											},
											children: t("form.remoteApproval.hint")
										})]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "flex-start",
										gap: 8,
										flexWrap: "wrap"
									},
									children: [(0, react_jsx_runtime.jsx)("span", {
										style: {
											width: 90,
											fontSize: 12,
											opacity: .8,
											flexShrink: 0,
											paddingTop: 8
										},
										children: t("form.label.remoteSandbox")
									}), (0, react_jsx_runtime.jsxs)("div", {
										style: {
											flex: 1,
											display: "flex",
											flexDirection: "column",
											gap: 4,
											minWidth: 180
										},
										children: [(0, react_jsx_runtime.jsxs)("select", {
											style: {
												...inputStyle,
												maxWidth: 260
											},
											value: form.remoteSandbox,
											disabled: busy,
											onChange: (event) => {
												setForm((prev) => ({
													...prev,
													remoteSandbox: event.target.value
												}));
											},
											children: [
												(0, react_jsx_runtime.jsx)("option", {
													value: "off",
													children: t("form.remoteSandbox.off")
												}),
												(0, react_jsx_runtime.jsx)("option", {
													value: "read-only",
													children: t("form.remoteSandbox.readOnly")
												}),
												(0, react_jsx_runtime.jsx)("option", {
													value: "workspace-write",
													children: t("form.remoteSandbox.workspaceWrite")
												})
											]
										}), (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 11,
												opacity: .6
											},
											children: t("form.remoteSandbox.hint")
										})]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "flex-start",
										gap: 8,
										flexWrap: "wrap"
									},
									children: [(0, react_jsx_runtime.jsx)("span", {
										style: {
											width: 90,
											fontSize: 12,
											opacity: .8,
											flexShrink: 0,
											paddingTop: 8
										},
										children: t("form.label.jump")
									}), (0, react_jsx_runtime.jsxs)("div", {
										style: {
											flex: 1,
											display: "flex",
											flexDirection: "column",
											gap: 4,
											minWidth: 180
										},
										children: [(0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												gap: 6
											},
											children: [(0, react_jsx_runtime.jsx)("input", {
												style: inputStyle,
												value: jumpText,
												placeholder: t("form.placeholder.jump"),
												disabled: busy,
												onChange: (event) => {
													setJumpText(event.target.value);
												}
											}), (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: buttonStyle,
												disabled: busy || jumpText === "",
												onClick: () => {
													setJumpText("");
												},
												children: t("form.jump.clear")
											})]
										}), jumpSummary !== "" && (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 11,
												opacity: .7
											},
											children: jumpSummary
										})]
									})]
								})
							]
						})]
					}),
					feedback !== null && (0, react_jsx_runtime.jsxs)("div", {
						role: feedback.kind === "error" ? "alert" : "status",
						style: {
							fontSize: 12,
							marginBottom: 8,
							padding: "6px 10px",
							borderRadius: 8,
							border: "1px solid rgba(128,128,128,0.25)",
							background: feedback.kind === "success" ? "rgba(152,195,121,0.12)" : feedback.kind === "error" ? "rgba(224,108,117,0.12)" : "rgba(128,128,128,0.08)",
							color: feedback.kind === "success" ? "#98c379" : feedback.kind === "error" ? "#e06c75" : "inherit"
						},
						children: [feedback.kind === "success" ? "✓ " : feedback.kind === "error" ? "✕ " : "··· ", feedback.text]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							justifyContent: "flex-end",
							alignItems: "center",
							flexWrap: "wrap",
							marginTop: 4
						},
						children: [
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: () => {
									runTest();
								},
								children: busyTask === "test" ? t("form.test.testing") : t("form.test.button")
							}),
							mode === "flow" && onCancel !== void 0 && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: onCancel,
								children: t("form.cancel")
							}),
							mode === "settings" && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle,
								disabled: busy,
								onClick: resetForm,
								children: initial?.id !== void 0 ? t("form.clear.edit") : t("form.clear.empty")
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryStyle,
								disabled: busy,
								onClick: () => {
									runSave();
								},
								children: busyTask === "save" ? t("form.save.saving") : saveLabel
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region lib/client/ui.js
		/**
		* Shared UI utilities for the dsh-workspace-enhancement client: a class-name joiner and the
		* dialog behavior every modal reuses — a document-level close stack (Esc
		* always dismisses the topmost dialog only), a Tab focus trap, initial focus,
		* and focus restoration. No external focus-management dependency.
		*/
		/** Join truthy class-name fragments; false/null/undefined drop out. */
		const cx = (...parts) => parts.filter((part) => typeof part === "string" && part !== "").join(" ");
		const FOCUSABLE = [
			"a[href]",
			"button:not([disabled])",
			"input:not([disabled])",
			"select:not([disabled])",
			"textarea:not([disabled])",
			"[tabindex]:not([tabindex=\"-1\"])"
		].join(", ");
		/** Live dialog closers; only the top entry reacts to Esc and Tab. */
		const stack = [];
		/**
		* Dialog accessibility behavior for one modal while `active`.
		* Returns the ref to place on the dialog element.
		*/
		function useDialogA11y(active, onClose) {
			const ref = (0, react.useRef)(null);
			const closeRef = (0, react.useRef)(onClose);
			closeRef.current = onClose;
			(0, react.useEffect)(() => {
				if (!active) return;
				const element = ref.current;
				if (element === null) return;
				const close = () => {
					closeRef.current();
				};
				stack.push(close);
				const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
				const focusables = () => Array.from(element.querySelectorAll(FOCUSABLE)).filter((node) => node.offsetParent !== null);
				element.tabIndex = -1;
				(element.querySelector("input, textarea, select") ?? element).focus();
				const onKeyDown = (event) => {
					if (stack[stack.length - 1] !== close) return;
					if (event.key === "Escape") {
						event.preventDefault();
						close();
						return;
					}
					if (event.key !== "Tab") return;
					const focusable = focusables();
					const first = focusable[0];
					const last = focusable[focusable.length - 1];
					if (first === void 0 || last === void 0) {
						event.preventDefault();
						element.focus();
						return;
					}
					const current = document.activeElement;
					const atStart = current === first || current === element || current === document.body || current === null;
					const atEnd = current === last || current === element || current === document.body || current === null;
					if (event.shiftKey && atStart) {
						event.preventDefault();
						last.focus();
					} else if (!event.shiftKey && atEnd) {
						event.preventDefault();
						first.focus();
					}
				};
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("keydown", onKeyDown, true);
					const index = stack.lastIndexOf(close);
					if (index >= 0) stack.splice(index, 1);
					if (previous !== null && document.contains(previous)) previous.focus();
				};
			}, [active]);
			return ref;
		}
		//#endregion
		//#region lib/client/icons.js
		const base = {
			width: 16,
			height: 16,
			viewBox: "0 0 16 16",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.5,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			"aria-hidden": true,
			focusable: "false"
		};
		function FolderIcon(props) {
			return (0, react_jsx_runtime.jsx)("svg", {
				...base,
				...props,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M1.75 4.75c0-.69.56-1.25 1.25-1.25h3.1c.37 0 .72.16.95.44l.85 1.03h5.35c.69 0 1.25.56 1.25 1.25v6.28c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25V4.75Z" })
			});
		}
		function FolderPlusIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [(0, react_jsx_runtime.jsx)("path", { d: "M1.75 4.75c0-.69.56-1.25 1.25-1.25h3.1c.37 0 .72.16.95.44l.85 1.03h5.35c.69 0 1.25.56 1.25 1.25v6.28c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25V4.75Z" }), (0, react_jsx_runtime.jsx)("path", { d: "M8 7.25v4M6 9.25h4" })]
			});
		}
		function MonitorIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [(0, react_jsx_runtime.jsx)("rect", {
					x: "1.75",
					y: "2.5",
					width: "12.5",
					height: "8.5",
					rx: "1.25"
				}), (0, react_jsx_runtime.jsx)("path", { d: "M5.5 13.5h5M8 11v2.5" })]
			});
		}
		function ServerIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [
					(0, react_jsx_runtime.jsx)("rect", {
						x: "2",
						y: "1.75",
						width: "12",
						height: "5",
						rx: "1.25"
					}),
					(0, react_jsx_runtime.jsx)("rect", {
						x: "2",
						y: "9.25",
						width: "12",
						height: "5",
						rx: "1.25"
					}),
					(0, react_jsx_runtime.jsx)("path", { d: "M4.6 4.25h.01M4.6 11.75h.01" })
				]
			});
		}
		function HomeIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [(0, react_jsx_runtime.jsx)("path", { d: "M2.75 7.25 8 2.5l5.25 4.75" }), (0, react_jsx_runtime.jsx)("path", { d: "M4.25 6.5V13a.5.5 0 0 0 .5.5h6.5a.5.5 0 0 0 .5-.5V6.5" })]
			});
		}
		function PlusIcon(props) {
			return (0, react_jsx_runtime.jsx)("svg", {
				...base,
				...props,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M8 3.25v9.5M3.25 8h9.5" })
			});
		}
		function CloseIcon(props) {
			return (0, react_jsx_runtime.jsx)("svg", {
				...base,
				...props,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M4 4l8 8M12 4l-8 8" })
			});
		}
		function RefreshIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [(0, react_jsx_runtime.jsx)("path", { d: "M13.25 8a5.25 5.25 0 1 1-1.54-3.71" }), (0, react_jsx_runtime.jsx)("path", { d: "M13.5 2.75v2.5h-2.5" })]
			});
		}
		function EyeIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [(0, react_jsx_runtime.jsx)("path", { d: "M1.75 8S4.25 3.75 8 3.75 14.25 8 14.25 8 11.75 12.25 8 12.25 1.75 8 1.75 8Z" }), (0, react_jsx_runtime.jsx)("circle", {
					cx: "8",
					cy: "8",
					r: "2"
				})]
			});
		}
		function TrashIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [
					(0, react_jsx_runtime.jsx)("path", { d: "M2.75 4.5h10.5M6.5 4.5V3.25A.75.75 0 0 1 7.25 2.5h1.5a.75.75 0 0 1 .75.75V4.5" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M4.25 4.5l.5 8a.75.75 0 0 0 .75.7h5a.75.75 0 0 0 .75-.7l.5-8" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M6.75 7.25v3.5M9.25 7.25v3.5" })
				]
			});
		}
		function ChevronIcon(props) {
			return (0, react_jsx_runtime.jsx)("svg", {
				...base,
				...props,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M6.25 3.75 10.5 8l-4.25 4.25" })
			});
		}
		function KeyIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [(0, react_jsx_runtime.jsx)("circle", {
					cx: "5",
					cy: "11",
					r: "2.25"
				}), (0, react_jsx_runtime.jsx)("path", { d: "M6.6 9.4 12.75 3.25M10.75 5.25l1.5 1.5M12.75 3.25l1.5 1.5" })]
			});
		}
		function LockIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [(0, react_jsx_runtime.jsx)("rect", {
					x: "3.25",
					y: "7",
					width: "9.5",
					height: "6.25",
					rx: "1.25"
				}), (0, react_jsx_runtime.jsx)("path", { d: "M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" })]
			});
		}
		function RouteIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [
					(0, react_jsx_runtime.jsx)("circle", {
						cx: "3.5",
						cy: "12.5",
						r: "1.5"
					}),
					(0, react_jsx_runtime.jsx)("circle", {
						cx: "12.5",
						cy: "3.5",
						r: "1.5"
					}),
					(0, react_jsx_runtime.jsx)("path", { d: "M4.75 11.25C8 10.5 10.5 8 11.25 4.75" })
				]
			});
		}
		function AlertIcon(props) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				...base,
				...props,
				children: [(0, react_jsx_runtime.jsx)("path", { d: "M8 2.25 14.5 13.4a.55.55 0 0 1-.48.85H1.98a.55.55 0 0 1-.48-.85L8 2.25Z" }), (0, react_jsx_runtime.jsx)("path", { d: "M8 6.25v3.25M8 11.75h.01" })]
			});
		}
		function CheckIcon(props) {
			return (0, react_jsx_runtime.jsx)("svg", {
				...base,
				...props,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M3 8.6 6.4 12 13 4.5" })
			});
		}
		function SpinnerIcon(props) {
			return (0, react_jsx_runtime.jsx)("svg", {
				...base,
				...props,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M13.25 8A5.25 5.25 0 1 1 8 2.75" })
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/dsh-workspace-enhancement/dsh-workspace-enhancement/src/client/flow.module.css.mjs
		const css$1 = ".O62XYq_overlay{--dshssh-accent:var(--color-primary,var(--accent,var(--primary,#4a6cf7)));--dshssh-accent-fg:#fff;--dshssh-surface:var(--color-bg-elevated,var(--background,var(--card,#17181c)));--dshssh-fg:var(--color-fg,var(--foreground,#e8e9ec));--dshssh-danger:var(--color-danger,var(--destructive,#e5534b));--dshssh-success:var(--color-success,var(--success,#3fb950));--dshssh-scrim:#090a0d94;--dshssh-shadow:0 24px 64px #00000080;--dshssh-surface-2:color-mix(in srgb, var(--dshssh-fg) 3%, var(--dshssh-surface));--dshssh-surface-3:color-mix(in srgb, var(--dshssh-fg) 7%, var(--dshssh-surface));--dshssh-surface-inset:color-mix(in srgb, black 10%, var(--dshssh-surface));--dshssh-line:color-mix(in srgb, var(--dshssh-fg) 8%, var(--dshssh-surface));--dshssh-border:color-mix(in srgb, var(--dshssh-fg) 14%, var(--dshssh-surface));--dshssh-border-strong:color-mix(in srgb, var(--dshssh-fg) 26%, var(--dshssh-surface));--dshssh-fg-muted:color-mix(in srgb, var(--dshssh-fg) 60%, var(--dshssh-surface));--dshssh-fg-subtle:color-mix(in srgb, var(--dshssh-fg) 38%, var(--dshssh-surface));--dshssh-accent-soft:color-mix(in srgb, var(--dshssh-accent) 13%, var(--dshssh-surface));--dshssh-danger-soft:color-mix(in srgb, var(--dshssh-danger) 12%, var(--dshssh-surface));--dshssh-success-soft:color-mix(in srgb, var(--dshssh-success) 12%, var(--dshssh-surface));--dshssh-danger-text:color-mix(in srgb, var(--dshssh-danger) 55%, var(--dshssh-fg));--dshssh-success-text:color-mix(in srgb, var(--dshssh-success) 45%, var(--dshssh-fg))}@media (prefers-color-scheme:light){.O62XYq_overlay{--dshssh-accent:var(--color-primary,var(--accent,var(--primary,#3b5bdb)));--dshssh-surface:var(--color-bg-elevated,var(--background,var(--card,#fff)));--dshssh-fg:var(--color-fg,var(--foreground,#21242a));--dshssh-danger:var(--color-danger,var(--destructive,#c9352f));--dshssh-success:var(--color-success,var(--success,#157f37));--dshssh-scrim:#0f111557;--dshssh-shadow:0 24px 64px #0f111533;--dshssh-surface-2:color-mix(in srgb, var(--dshssh-fg) 3%, var(--dshssh-surface));--dshssh-surface-3:color-mix(in srgb, var(--dshssh-fg) 7%, var(--dshssh-surface));--dshssh-surface-inset:color-mix(in srgb, black 6%, var(--dshssh-surface));--dshssh-line:color-mix(in srgb, var(--dshssh-fg) 8%, var(--dshssh-surface));--dshssh-border:color-mix(in srgb, var(--dshssh-fg) 14%, var(--dshssh-surface));--dshssh-border-strong:color-mix(in srgb, var(--dshssh-fg) 26%, var(--dshssh-surface));--dshssh-fg-muted:color-mix(in srgb, var(--dshssh-fg) 60%, var(--dshssh-surface));--dshssh-fg-subtle:color-mix(in srgb, var(--dshssh-fg) 38%, var(--dshssh-surface));--dshssh-accent-soft:color-mix(in srgb, var(--dshssh-accent) 11%, var(--dshssh-surface));--dshssh-danger-soft:color-mix(in srgb, var(--dshssh-danger) 10%, var(--dshssh-surface));--dshssh-success-soft:color-mix(in srgb, var(--dshssh-success) 10%, var(--dshssh-surface));--dshssh-danger-text:color-mix(in srgb, var(--dshssh-danger) 55%, var(--dshssh-fg));--dshssh-success-text:color-mix(in srgb, var(--dshssh-success) 45%, var(--dshssh-fg))}}.O62XYq_overlay{z-index:1000;background:var(--dshssh-scrim);font-family:var(--font-sans,ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"PingFang SC\", \"Microsoft YaHei\", sans-serif);justify-content:center;align-items:center;padding:24px;display:flex;position:fixed;inset:0}.O62XYq_overlay button,.O62XYq_overlay input{font-family:inherit}.O62XYq_overlay :focus-visible{outline:2px solid var(--dshssh-accent);outline-offset:1px}.O62XYq_gap{flex:auto}.O62XYq_mono{font-family:var(--font-mono,ui-monospace, \"SF Mono\", \"Cascadia Code\", Consolas, monospace)}.O62XYq_spin{animation:.8s linear infinite O62XYq_dshssh-rotate}@keyframes O62XYq_dshssh-rotate{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.O62XYq_spin{animation:none}}.O62XYq_button{border:1px solid var(--dshssh-border);color:var(--dshssh-fg);cursor:pointer;white-space:nowrap;background:0 0;border-radius:7px;justify-content:center;align-items:center;gap:6px;padding:5px 13px;font-size:12.5px;font-weight:500;line-height:1.4;display:inline-flex}.O62XYq_button svg{flex:none}.O62XYq_button:hover:not(:disabled){background:var(--dshssh-surface-3);border-color:var(--dshssh-border-strong)}.O62XYq_primary{background:var(--dshssh-accent);border-color:var(--dshssh-accent);color:var(--dshssh-accent-fg)}.O62XYq_primary:hover:not(:disabled){background:color-mix(in srgb, var(--dshssh-accent) 85%, #fff);border-color:color-mix(in srgb, var(--dshssh-accent) 85%, #fff)}.O62XYq_danger{background:var(--dshssh-danger);border-color:var(--dshssh-danger);color:#fff}.O62XYq_danger:hover:not(:disabled){background:color-mix(in srgb, var(--dshssh-danger) 82%, #fff);border-color:color-mix(in srgb, var(--dshssh-danger) 82%, #fff)}.O62XYq_button:disabled{opacity:.5;cursor:default}.O62XYq_iconButton{width:28px;height:28px;color:var(--dshssh-fg-muted);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;justify-content:center;align-items:center;display:inline-flex}.O62XYq_iconButton:hover:not(:disabled){background:var(--dshssh-surface-3);color:var(--dshssh-fg)}.O62XYq_iconButton:disabled{opacity:.45;cursor:default}.O62XYq_dialog{background:var(--dshssh-surface);width:min(920px,100%);height:min(620px,100vh - 48px);color:var(--dshssh-fg);border:1px solid var(--dshssh-border);box-shadow:var(--dshssh-shadow);border-radius:12px;flex-direction:column;font-size:13px;display:flex;overflow:hidden}.O62XYq_header{align-items:center;gap:10px;padding:14px 16px 10px;display:flex}.O62XYq_headerText{flex:auto;min-width:0}.O62XYq_title{margin:0;font-size:15px;font-weight:600;line-height:1.35}.O62XYq_subtitle{color:var(--dshssh-fg-muted);text-overflow:ellipsis;white-space:nowrap;margin:2px 0 0;font-size:12px;overflow:hidden}.O62XYq_body{flex:auto;min-height:0;display:flex}.O62XYq_sidebar{border-right:1px solid var(--dshssh-line);background:var(--dshssh-surface-2);flex-direction:column;flex:none;width:268px;padding:10px;display:flex;overflow-y:auto}.O62XYq_main{flex-direction:column;flex:auto;min-width:0;display:flex}.O62XYq_sidebarSection{flex-direction:column;display:flex}.O62XYq_sidebarSection+.O62XYq_sidebarSection{border-top:1px solid var(--dshssh-line);margin-top:10px;padding-top:10px}.O62XYq_sidebarAdd{background:var(--dshssh-accent);width:30px;height:30px;color:var(--dshssh-accent-fg);cursor:pointer;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;margin-top:10px;margin-left:auto;padding:0;display:inline-flex;position:sticky;bottom:4px;box-shadow:0 4px 12px #00000047}.O62XYq_sidebarAdd:hover{filter:brightness(1.1)}.O62XYq_sidebarTitle{color:var(--dshssh-fg-subtle);letter-spacing:.08em;text-transform:uppercase;align-items:center;gap:6px;margin:0 0 4px;padding:0 2px;font-size:10.5px;font-weight:600;display:flex}.O62XYq_sidebarCount{background:var(--dshssh-surface-3);color:var(--dshssh-fg-muted);border-radius:8px;padding:0 6px;font-size:11px;font-weight:600;line-height:17px}.O62XYq_sideError{background:var(--dshssh-danger-soft);border:1px solid color-mix(in srgb, var(--dshssh-danger) 28%, transparent);border-radius:8px;flex-direction:column;align-items:flex-start;gap:6px;padding:8px 10px;display:flex}.O62XYq_sideErrorText{color:var(--dshssh-danger-text);overflow-wrap:anywhere;margin:0;font-size:12px}.O62XYq_sideEmpty{flex-direction:column;align-items:flex-start;gap:3px;padding:6px 2px 4px;display:flex}.O62XYq_sideEmptyIcon{color:var(--dshssh-fg-subtle);margin-bottom:2px}.O62XYq_sideEmptyTitle{color:var(--dshssh-fg);margin:0;font-size:12.5px;font-weight:600}.O62XYq_sideEmptyText{color:var(--dshssh-fg-muted);margin:0;font-size:12px;line-height:1.5}.O62XYq_hostWorking{color:var(--dshssh-fg-muted);align-items:center;gap:5px;font-size:12px;display:inline-flex}.O62XYq_hostSpinner{width:12px;height:12px;color:var(--dshssh-accent)}.O62XYq_hostErrorText{color:var(--dshssh-danger-text);overflow-wrap:anywhere;font-size:12px;line-height:1.45}.O62XYq_toolbar{border-top:1px solid var(--dshssh-line);border-bottom:1px solid var(--dshssh-line);background:var(--dshssh-surface-2);align-items:center;gap:8px;min-height:36px;padding:5px 16px;display:flex}.O62XYq_crumbs{flex-wrap:wrap;flex:auto;align-items:center;gap:2px;min-width:0;font-size:12px;display:flex}.O62XYq_crumb{color:var(--dshssh-accent);cursor:pointer;text-overflow:ellipsis;white-space:nowrap;background:0 0;border:none;border-radius:4px;max-width:22ch;padding:2px 5px;font-size:12px;overflow:hidden}.O62XYq_crumb:hover:not(:disabled){background:var(--dshssh-surface-3)}.O62XYq_crumb:disabled{color:var(--dshssh-fg-subtle);cursor:default}.O62XYq_crumbStep{align-items:center;display:inline-flex}.O62XYq_crumbSep{color:var(--dshssh-fg-subtle);padding:0 1px}.O62XYq_crumbCurrent{color:var(--dshssh-fg);text-overflow:ellipsis;white-space:nowrap;max-width:44ch;padding:2px 5px;font-weight:600;overflow:hidden}.O62XYq_toolbarActions{flex:none;align-items:center;gap:4px;display:flex}.O62XYq_toolButton{width:28px;height:28px;color:var(--dshssh-fg-muted);cursor:pointer;background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;display:inline-flex;position:relative}.O62XYq_toolButtonText{border:1px solid var(--dshssh-border);width:auto;color:var(--dshssh-fg);gap:5px;padding:0 9px;font-size:12px;font-weight:500}.O62XYq_toolButton:hover:not(:disabled):not(.O62XYq_toolButtonOn){background:var(--dshssh-surface-3);color:var(--dshssh-fg)}.O62XYq_toolButton:disabled{opacity:.45;cursor:default}.O62XYq_toolButtonOn{background:var(--dshssh-accent-soft);color:var(--dshssh-accent)}.O62XYq_countBadge{background:var(--dshssh-accent);min-width:14px;height:14px;color:var(--dshssh-accent-fg);text-align:center;border-radius:7px;padding:0 3px;font-size:10px;font-weight:600;line-height:14px;position:absolute;top:-3px;right:-5px}.O62XYq_browser{flex:auto;min-height:200px;padding:6px 10px 8px 8px;overflow-y:auto}.O62XYq_browserBusy .O62XYq_entryList{opacity:.55;pointer-events:none}.O62XYq_entryList{flex-direction:column;gap:1px;margin:0;padding:0;list-style:none;display:flex}.O62XYq_entry{width:100%;color:var(--dshssh-fg);text-align:left;cursor:pointer;background:0 0;border:none;border-radius:7px;align-items:center;gap:8px;padding:6px 10px;font-size:13px;display:flex}.O62XYq_entry:hover{background:var(--dshssh-surface-3)}.O62XYq_entryIcon{color:var(--dshssh-fg-muted);flex:none}.O62XYq_entryName{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}.O62XYq_entryHidden .O62XYq_entryName,.O62XYq_entryHidden .O62XYq_entryIcon{opacity:.65}.O62XYq_entryChevron{color:var(--dshssh-fg-subtle);opacity:0;flex:none;transition:opacity .12s}.O62XYq_entry:hover .O62XYq_entryChevron,.O62XYq_entry:focus-visible .O62XYq_entryChevron{opacity:1}.O62XYq_truncated{color:var(--dshssh-fg-subtle);margin:6px 4px 0;font-size:12px}.O62XYq_skeletons{flex-direction:column;gap:10px;padding:10px 6px;display:flex}.O62XYq_skeleton{background:var(--dshssh-surface-3);border-radius:6px;height:12px;animation:1.4s ease-in-out infinite O62XYq_dshssh-pulse}@keyframes O62XYq_dshssh-pulse{0%,to{opacity:.45}50%{opacity:.9}}@media (prefers-reduced-motion:reduce){.O62XYq_skeleton{opacity:.6;animation:none}}.O62XYq_errorPanel{background:var(--dshssh-danger-soft);border:1px solid color-mix(in srgb, var(--dshssh-danger) 28%, transparent);border-radius:8px;align-items:flex-start;gap:10px;margin:10px 6px;padding:10px 12px;display:flex}.O62XYq_errorIcon{color:var(--dshssh-danger-text);flex:none;margin-top:1px}.O62XYq_errorBody{flex:auto;min-width:0}.O62XYq_errorActions{flex-direction:column;flex:none;align-self:center;align-items:stretch;gap:6px;display:flex}.O62XYq_errorTitle{color:var(--dshssh-danger-text);margin:0;font-size:12.5px;font-weight:600}.O62XYq_errorText{color:var(--dshssh-fg-muted);overflow-wrap:anywhere;margin:2px 0 0;font-size:12px}.O62XYq_retryButton{border:1px solid var(--dshssh-border);background:var(--dshssh-surface);color:var(--dshssh-fg);cursor:pointer;border-radius:6px;flex:none;align-items:center;gap:5px;padding:3px 9px;font-size:12px;display:inline-flex}.O62XYq_retryButton:hover{background:var(--dshssh-surface-3)}.O62XYq_emptyState{text-align:center;flex-direction:column;align-items:center;gap:4px;margin:auto;padding:28px 16px;display:flex}.O62XYq_emptyIcon{color:var(--dshssh-fg-subtle);margin-bottom:4px}.O62XYq_emptyTitle{color:var(--dshssh-fg);margin:0;font-size:13px;font-weight:600}.O62XYq_emptyText{color:var(--dshssh-fg-muted);margin:0;font-size:12px}.O62XYq_connectionList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.O62XYq_connectionItem{border-radius:8px;align-items:stretch;gap:2px;display:flex}.O62XYq_connectionStatus{flex:none;align-items:center;padding:0 2px;display:flex}.O62XYq_connectionItem:hover:not(.O62XYq_connectionItemActive){background:color-mix(in srgb, var(--dshssh-fg) 4%, transparent)}.O62XYq_connectionItemActive{background:var(--dshssh-accent-soft)}.O62XYq_connectionMain{min-width:0;color:var(--dshssh-fg);font-size:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:7px;flex:auto;align-items:center;gap:10px;padding:5px 9px;display:flex}.O62XYq_connectionIcon{color:var(--dshssh-fg-muted);flex:none}.O62XYq_connectionItemActive .O62XYq_connectionIcon{color:var(--dshssh-accent)}.O62XYq_connectionInfo{flex-direction:column;flex:auto;gap:1px;min-width:0;display:flex}.O62XYq_connectionLabel{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;overflow:hidden}.O62XYq_connectionDetail{color:var(--dshssh-fg-muted);align-items:center;gap:5px;min-width:0;font-size:11.5px;display:flex}.O62XYq_connectionEndpoint{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.O62XYq_badge{background:color-mix(in srgb, var(--dshssh-fg) 5%, transparent);height:15px;color:var(--dshssh-fg-subtle);border:none;border-radius:4px;flex:none;align-items:center;gap:3px;padding:0 5px;font-size:10.5px;font-weight:500;line-height:14px;display:inline-flex}.O62XYq_connectionItemActive .O62XYq_badge{background:color-mix(in srgb, var(--dshssh-surface) 55%, transparent)}.O62XYq_badge svg{width:11px;height:11px}.O62XYq_badgeAdded{background:var(--dshssh-success-soft);color:var(--dshssh-success-text)}.O62XYq_connectionRemove{width:30px;color:var(--dshssh-fg-subtle);cursor:pointer;opacity:0;background:0 0;border:none;border-radius:7px;flex:none;justify-content:center;align-items:center;transition:opacity .12s;display:inline-flex}.O62XYq_connectionItem:hover .O62XYq_connectionRemove,.O62XYq_connectionRemove:focus-visible,.O62XYq_connectionItemActive .O62XYq_connectionRemove{opacity:1}.O62XYq_connectionRemove:hover{color:var(--dshssh-danger-text);background:var(--dshssh-danger-soft)}@media (hover:none){.O62XYq_connectionRemove{opacity:1}}.O62XYq_skeletonRow{align-items:center;gap:10px;padding:10px 6px;display:flex}.O62XYq_skeletonDot{background:var(--dshssh-surface-3);border-radius:5px;flex:none;width:16px;height:16px;animation:1.4s ease-in-out infinite O62XYq_dshssh-pulse}.O62XYq_skeletonLines{flex-direction:column;flex:auto;gap:6px;display:flex}.O62XYq_skeletonLine{background:var(--dshssh-surface-3);border-radius:5px;height:9px;animation:1.4s ease-in-out infinite O62XYq_dshssh-pulse}.O62XYq_footer{border-top:1px solid var(--dshssh-line);align-items:center;gap:8px;padding:12px 16px 14px;display:flex}.O62XYq_smallDialog,.O62XYq_form{background:var(--dshssh-surface);width:min(520px,100%);max-height:calc(100vh - 48px);color:var(--dshssh-fg);border:1px solid var(--dshssh-border);box-shadow:var(--dshssh-shadow);border-radius:12px;flex-direction:column;gap:12px;padding:16px 18px;font-size:13px;display:flex;overflow-y:auto}.O62XYq_form{width:min(560px,100%)}.O62XYq_formTitle{margin:0;font-size:14px;font-weight:600}.O62XYq_formSub{color:var(--dshssh-fg-muted);margin:2px 0 0;font-size:12px}.O62XYq_formHead{align-items:flex-start;gap:10px;display:flex}.O62XYq_formHeadText{flex:auto;min-width:0}.O62XYq_formGrid{flex-direction:column;gap:12px;display:flex}.O62XYq_formGrid>.O62XYq_field{flex:none}.O62XYq_rowFields{flex-wrap:wrap;gap:10px;display:flex}.O62XYq_field{flex-direction:column;flex:180px;gap:5px;min-width:0;display:flex}.O62XYq_fieldPort{flex:0 96px}.O62XYq_fieldLabel{color:var(--dshssh-fg-muted);font-size:12px;font-weight:500}.O62XYq_required{color:var(--dshssh-danger-text);margin-left:2px}.O62XYq_fieldGroup{flex-direction:column;gap:5px;display:flex}.O62XYq_input{box-sizing:border-box;background:var(--dshssh-surface-inset);border:1px solid var(--dshssh-border);width:100%;color:var(--dshssh-fg);border-radius:7px;outline:none;padding:7px 10px;font-size:13px}.O62XYq_input::placeholder{color:var(--dshssh-fg-subtle)}.O62XYq_input:focus{border-color:var(--dshssh-accent);box-shadow:0 0 0 3px var(--dshssh-accent-soft)}.O62XYq_input:disabled{opacity:.6}.O62XYq_inputError{border-color:var(--dshssh-danger)}.O62XYq_inputError:focus{border-color:var(--dshssh-danger);box-shadow:0 0 0 3px var(--dshssh-danger-soft)}.O62XYq_fieldError{color:var(--dshssh-danger-text);margin:0;font-size:11.5px}.O62XYq_fieldHint{color:var(--dshssh-fg-subtle);font-size:11.5px}.O62XYq_segment{border:1px solid var(--dshssh-line);background:var(--dshssh-surface-inset);border-radius:9px;gap:3px;width:fit-content;padding:3px;display:inline-flex}.O62XYq_segmentButton{color:var(--dshssh-fg-muted);cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:center;gap:6px;padding:4px 14px;font-size:12.5px;font-weight:500;display:inline-flex}.O62XYq_segmentButton:hover:not(.O62XYq_segmentButtonOn):not(:disabled){color:var(--dshssh-fg)}.O62XYq_segmentButtonOn{background:var(--dshssh-surface-3);color:var(--dshssh-fg);box-shadow:inset 0 0 0 1px var(--dshssh-border-strong)}.O62XYq_segmentButtonOn svg{color:var(--dshssh-accent)}.O62XYq_segmentButton:disabled{opacity:.55;cursor:default}.O62XYq_feedback{overflow-wrap:anywhere;border-radius:7px;align-items:flex-start;gap:8px;padding:8px 11px;font-size:12.5px;line-height:1.45;display:flex}.O62XYq_feedback svg{flex:none;margin-top:1px}.O62XYq_feedbackInfo{background:var(--dshssh-surface-2);border:1px solid var(--dshssh-line);color:var(--dshssh-fg-muted)}.O62XYq_feedbackSuccess{background:var(--dshssh-success-soft);border:1px solid color-mix(in srgb, var(--dshssh-success) 26%, transparent);color:var(--dshssh-success-text)}.O62XYq_feedbackError{background:var(--dshssh-danger-soft);border:1px solid color-mix(in srgb, var(--dshssh-danger) 26%, transparent);color:var(--dshssh-danger-text)}.O62XYq_formActions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.O62XYq_createIn{color:var(--dshssh-fg-muted);overflow-wrap:anywhere;margin:0;font-size:12px}.O62XYq_createPath{color:var(--dshssh-fg);font-size:11.5px}.O62XYq_confirmHead{align-items:flex-start;gap:12px;display:flex}.O62XYq_confirmIconWrap{background:var(--dshssh-danger-soft);width:34px;height:34px;color:var(--dshssh-danger-text);border-radius:9px;flex:none;justify-content:center;align-items:center;display:inline-flex}.O62XYq_confirmIconInfo{background:var(--dshssh-accent-soft);color:var(--dshssh-accent)}.O62XYq_confirmText{color:var(--dshssh-fg-muted);overflow-wrap:anywhere;margin:3px 0 0;font-size:12.5px;line-height:1.55}@media (width<=640px){.O62XYq_overlay{padding:12px}.O62XYq_dialog,.O62XYq_smallDialog,.O62XYq_form{max-height:calc(100vh - 24px)}.O62XYq_body{flex-direction:column}.O62XYq_sidebar{border-right:none;border-bottom:1px solid var(--dshssh-line);width:auto;max-height:38%}.O62XYq_main{min-height:0}.O62XYq_errorPanel{flex-wrap:wrap}.O62XYq_errorActions{flex-direction:row;align-self:flex-start}.O62XYq_toolbar,.O62XYq_footer{flex-wrap:wrap}}";
		const tagId$1 = "dsh-workspace-enhancement/flow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-workspace-enhancement";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var flow_module_css_default = {
			"errorTitle": "O62XYq_errorTitle",
			"crumbCurrent": "O62XYq_crumbCurrent",
			"connectionStatus": "O62XYq_connectionStatus",
			"toolButtonOn": "O62XYq_toolButtonOn",
			"errorText": "O62XYq_errorText",
			"connectionIcon": "O62XYq_connectionIcon",
			"gap": "O62XYq_gap",
			"retryButton": "O62XYq_retryButton",
			"sideEmptyText": "O62XYq_sideEmptyText",
			"connectionDetail": "O62XYq_connectionDetail",
			"fieldGroup": "O62XYq_fieldGroup",
			"hostSpinner": "O62XYq_hostSpinner",
			"connectionEndpoint": "O62XYq_connectionEndpoint",
			"skeletonRow": "O62XYq_skeletonRow",
			"entryHidden": "O62XYq_entryHidden",
			"fieldLabel": "O62XYq_fieldLabel",
			"footer": "O62XYq_footer",
			"connectionLabel": "O62XYq_connectionLabel",
			"title": "O62XYq_title",
			"skeletonLines": "O62XYq_skeletonLines",
			"errorActions": "O62XYq_errorActions",
			"skeleton": "O62XYq_skeleton",
			"inputError": "O62XYq_inputError",
			"emptyText": "O62XYq_emptyText",
			"hostWorking": "O62XYq_hostWorking",
			"errorBody": "O62XYq_errorBody",
			"connectionItemActive": "O62XYq_connectionItemActive",
			"sidebar": "O62XYq_sidebar",
			"formActions": "O62XYq_formActions",
			"mono": "O62XYq_mono",
			"button": "O62XYq_button",
			"overlay": "O62XYq_overlay",
			"feedback": "O62XYq_feedback",
			"sideEmpty": "O62XYq_sideEmpty",
			"primary": "O62XYq_primary",
			"sideErrorText": "O62XYq_sideErrorText",
			"sidebarCount": "O62XYq_sidebarCount",
			"truncated": "O62XYq_truncated",
			"connectionRemove": "O62XYq_connectionRemove",
			"toolbarActions": "O62XYq_toolbarActions",
			"fieldPort": "O62XYq_fieldPort",
			"segment": "O62XYq_segment",
			"sidebarAdd": "O62XYq_sidebarAdd",
			"crumb": "O62XYq_crumb",
			"createIn": "O62XYq_createIn",
			"badgeAdded": "O62XYq_badgeAdded",
			"dshssh-rotate": "O62XYq_dshssh-rotate",
			"sideEmptyTitle": "O62XYq_sideEmptyTitle",
			"connectionItem": "O62XYq_connectionItem",
			"body": "O62XYq_body",
			"sidebarSection": "O62XYq_sidebarSection",
			"spin": "O62XYq_spin",
			"feedbackInfo": "O62XYq_feedbackInfo",
			"iconButton": "O62XYq_iconButton",
			"skeletonDot": "O62XYq_skeletonDot",
			"countBadge": "O62XYq_countBadge",
			"segmentButton": "O62XYq_segmentButton",
			"createPath": "O62XYq_createPath",
			"smallDialog": "O62XYq_smallDialog",
			"toolbar": "O62XYq_toolbar",
			"skeletonLine": "O62XYq_skeletonLine",
			"main": "O62XYq_main",
			"entry": "O62XYq_entry",
			"formHead": "O62XYq_formHead",
			"field": "O62XYq_field",
			"entryList": "O62XYq_entryList",
			"rowFields": "O62XYq_rowFields",
			"errorIcon": "O62XYq_errorIcon",
			"connectionMain": "O62XYq_connectionMain",
			"confirmIconInfo": "O62XYq_confirmIconInfo",
			"headerText": "O62XYq_headerText",
			"hostErrorText": "O62XYq_hostErrorText",
			"sidebarTitle": "O62XYq_sidebarTitle",
			"skeletons": "O62XYq_skeletons",
			"formSub": "O62XYq_formSub",
			"subtitle": "O62XYq_subtitle",
			"crumbStep": "O62XYq_crumbStep",
			"fieldHint": "O62XYq_fieldHint",
			"toolButtonText": "O62XYq_toolButtonText",
			"sideError": "O62XYq_sideError",
			"toolButton": "O62XYq_toolButton",
			"entryIcon": "O62XYq_entryIcon",
			"confirmHead": "O62XYq_confirmHead",
			"fieldError": "O62XYq_fieldError",
			"entryName": "O62XYq_entryName",
			"header": "O62XYq_header",
			"entryChevron": "O62XYq_entryChevron",
			"browserBusy": "O62XYq_browserBusy",
			"crumbSep": "O62XYq_crumbSep",
			"input": "O62XYq_input",
			"confirmIconWrap": "O62XYq_confirmIconWrap",
			"dialog": "O62XYq_dialog",
			"formGrid": "O62XYq_formGrid",
			"form": "O62XYq_form",
			"badge": "O62XYq_badge",
			"connectionList": "O62XYq_connectionList",
			"dshssh-pulse": "O62XYq_dshssh-pulse",
			"connectionInfo": "O62XYq_connectionInfo",
			"confirmText": "O62XYq_confirmText",
			"emptyTitle": "O62XYq_emptyTitle",
			"emptyIcon": "O62XYq_emptyIcon",
			"browser": "O62XYq_browser",
			"formTitle": "O62XYq_formTitle",
			"required": "O62XYq_required",
			"feedbackSuccess": "O62XYq_feedbackSuccess",
			"formHeadText": "O62XYq_formHeadText",
			"segmentButtonOn": "O62XYq_segmentButtonOn",
			"errorPanel": "O62XYq_errorPanel",
			"emptyState": "O62XYq_emptyState",
			"feedbackError": "O62XYq_feedbackError",
			"crumbs": "O62XYq_crumbs",
			"sideEmptyIcon": "O62XYq_sideEmptyIcon",
			"danger": "O62XYq_danger"
		};
		//#endregion
		//#region lib/client/form.js
		/** Map the sidebar's draft onto the shared form's initial state. */
		function draftToInitial(draft) {
			if (draft === void 0) return void 0;
			return {
				...draft.label !== void 0 ? { name: draft.label } : {},
				...draft.host !== void 0 ? { host: draft.host } : {},
				...draft.port !== void 0 ? { port: draft.port } : {},
				...draft.username !== void 0 ? { username: draft.username } : {},
				...draft.privateKeyPath !== void 0 ? { privateKeyPath: draft.privateKeyPath } : {},
				...draft.jumpText !== void 0 ? { jumpText: draft.jumpText } : {},
				...draft.cwd !== void 0 ? { workspace: draft.cwd } : {},
				...draft.focusUsername === true ? { focusUsername: true } : {}
			};
		}
		/** The connection form modal (masked password, 密码/私钥二选一). */
		function ConnectionForm({ rpc, draft, t, onClose, onSaved }) {
			const dialogRef = useDialogA11y(true, onClose);
			return (0, react_jsx_runtime.jsx)("div", {
				className: flow_module_css_default.overlay,
				onClick: (event) => {
					if (event.target === event.currentTarget) onClose();
				},
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: flow_module_css_default.form,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("form.dialog.label"),
					ref: dialogRef,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: flow_module_css_default.formHead,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: flow_module_css_default.formHeadText,
							children: [(0, react_jsx_runtime.jsx)("h3", {
								className: flow_module_css_default.formTitle,
								children: t("form.title")
							}), (0, react_jsx_runtime.jsx)("p", {
								className: flow_module_css_default.formSub,
								children: t("form.subtitle")
							})]
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: flow_module_css_default.iconButton,
							"aria-label": t("form.close.label"),
							onClick: onClose,
							children: (0, react_jsx_runtime.jsx)(CloseIcon, {})
						})]
					}), (0, react_jsx_runtime.jsx)("div", {
						className: flow_module_css_default.formGrid,
						children: (0, react_jsx_runtime.jsx)(MachineForm, {
							mode: "flow",
							rpc,
							initial: draftToInitial(draft),
							t,
							onSaved,
							onCancel: onClose
						})
					})]
				})
			});
		}
		//#endregion
		//#region lib/client/flow.js
		/**
		* The add-workspace directory flow of dsh-workspace-enhancement, laid out as a connection
		* sidebar beside a directory browser (VS Code Remote Explorer style): the
		* sidebar lists `~/.ssh/config` hosts (one click resolves, registers, and
		* browses — no form), saved connections, and the local entry; the right pane
		* browses whichever side is active. Picking a remote directory hands the owner
		* an `ssh://<id><path>` workspace path, which the deployment's remote
		* providers consume (see README for the workspace-adoption seam).
		*/
		const EMPTY_PANE = {
			path: null,
			listing: null,
			error: null,
			loading: false
		};
		/** Unwrap a wire result or throw its business error. */
		function unwrap$2(result, fallback) {
			if (!result.ok) throw new Error(result.error.message || fallback);
			return result.value;
		}
		const isRecord$2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		/** Minimal structural check for a wire listing. */
		function asListing(value) {
			const record = isRecord$2(value) ? value : {};
			const wireEntry = (entry) => ({
				name: String(entry?.name ?? ""),
				path: String(entry?.path ?? ""),
				hidden: entry?.hidden === true
			});
			return {
				path: typeof record.path === "string" ? record.path : "",
				home: typeof record.home === "string" ? record.home : "",
				crumbs: Array.isArray(record.crumbs) ? record.crumbs.filter(isRecord$2).map(wireEntry) : [],
				entries: Array.isArray(record.entries) ? record.entries.filter(isRecord$2).map(wireEntry) : [],
				truncated: record.truncated === true
			};
		}
		/** Structural check for one `config.hosts` row. */
		function asConfigHosts(value) {
			if (!Array.isArray(value)) return [];
			return value.filter(isRecord$2).map((record) => ({
				alias: String(record.alias ?? ""),
				host: String(record.host ?? ""),
				username: String(record.username ?? ""),
				port: typeof record.port === "number" ? record.port : 22,
				identityFile: record.identityFile === true,
				jump: record.jump === true
			})).filter((host) => host.alias !== "");
		}
		/** Structural check for one secret-free connection view. */
		function asConnectionView(record) {
			return {
				id: String(record.id ?? ""),
				label: String(record.label ?? ""),
				host: String(record.host ?? ""),
				port: typeof record.port === "number" ? record.port : 22,
				username: String(record.username ?? ""),
				...typeof record.cwd === "string" ? { cwd: record.cwd } : {},
				auth: record.auth === "password" || record.auth === "agent" ? record.auth : "key",
				jumpHosts: Array.isArray(record.jumpHosts) ? record.jumpHosts.map(String) : []
			};
		}
		/** Structural check for a `connections.resolve` result. */
		function asResolved(value) {
			const record = isRecord$2(value) ? value : {};
			return {
				host: typeof record.host === "string" ? record.host : "",
				username: typeof record.username === "string" ? record.username : "",
				port: typeof record.port === "number" ? record.port : 22,
				privateKeyPaths: Array.isArray(record.privateKeyPaths) ? record.privateKeyPaths.map(String) : [],
				jump: Array.isArray(record.jump) ? record.jump.filter(isRecord$2).map((hop) => ({
					host: String(hop.host ?? ""),
					...typeof hop.port === "number" ? { port: hop.port } : {},
					...typeof hop.username === "string" && hop.username !== "" ? { username: hop.username } : {},
					...hop.privateKeyPath !== void 0 ? { privateKeyPath: String(hop.privateKeyPath) } : {}
				})) : [],
				alias: typeof record.alias === "string" ? record.alias : ""
			};
		}
		/** Structural check for a `connections.add` result (its view only). */
		function asAddedView(value) {
			const record = isRecord$2(value) ? value : {};
			return asConnectionView(isRecord$2(record.view) ? record.view : {});
		}
		/**
		* Translate a raw ssh2/web error into a readable remote failure. ssh2 never
		* consults the OS agent or default identities on its own, so a spec without
		* password/privateKey/agent surfaces as `All configured authentication
		* methods failed` — that one gets the auth-completion guidance.
		*/
		function describeRemoteFailure(raw, t) {
			if (/invalid_union/.test(raw)) return {
				title: t("flow.error.invalidResponse.title"),
				text: t("flow.error.invalidResponse.text"),
				needsAuth: false
			};
			if (/all configured authentication methods/i.test(raw)) return {
				title: t("flow.error.auth.title"),
				text: t("flow.error.auth.text"),
				needsAuth: true
			};
			if (/cannot parse privatekey|cannot read private key|invalid private key|no key found/i.test(raw)) return {
				title: t("flow.error.key.title"),
				text: t("flow.error.key.text", { raw }),
				needsAuth: true
			};
			if (/timed?\s?out|etimedout/i.test(raw)) return {
				title: t("flow.error.timeout.title"),
				text: t("flow.error.timeout.text"),
				needsAuth: false
			};
			if (/econnrefused/i.test(raw)) return {
				title: t("flow.error.refused.title"),
				text: t("flow.error.refused.text"),
				needsAuth: false
			};
			if (/enotfound|getaddrinfo|dns/i.test(raw)) return {
				title: t("flow.error.dns.title"),
				text: t("flow.error.dns.text"),
				needsAuth: false
			};
			if (/ehostunreach|enetunreach/i.test(raw)) return {
				title: t("flow.error.unreachable.title"),
				text: t("flow.error.unreachable.text"),
				needsAuth: false
			};
			return {
				title: t("flow.error.generic.title"),
				text: raw,
				needsAuth: false
			};
		}
		/** The directory-flow occupant registered into both workspace holes. */
		function SshWorkspaceFlow(props) {
			const { open, busy, onPicked, onCancel, listLocalDirectory, createLocalDirectory, rpc, suppressSessionRoute = false, pickOnly = false, initialConnectionId = "", t: tSeat } = props;
			const t = tSeat ?? zhBaseline;
			const [mode, setMode] = (0, react.useState)({ kind: "local" });
			const [pane, setPane] = (0, react.useState)(EMPTY_PANE);
			const [connections, setConnections] = (0, react.useState)([]);
			const [connectionsLoading, setConnectionsLoading] = (0, react.useState)(false);
			const [connectionsError, setConnectionsError] = (0, react.useState)(null);
			const [configHosts, setConfigHosts] = (0, react.useState)([]);
			const [configLoading, setConfigLoading] = (0, react.useState)(false);
			const [configError, setConfigError] = (0, react.useState)(null);
			const [hostPending, setHostPending] = (0, react.useState)(null);
			const [hostError, setHostError] = (0, react.useState)(null);
			const [confirmTarget, setConfirmTarget] = (0, react.useState)(null);
			const [formOpen, setFormOpen] = (0, react.useState)(false);
			const [formDraft, setFormDraft] = (0, react.useState)(void 0);
			const [folderDraft, setFolderDraft] = (0, react.useState)(null);
			const [openingRemote, setOpeningRemote] = (0, react.useState)(false);
			const [folderBusy, setFolderBusy] = (0, react.useState)(false);
			const [folderError, setFolderError] = (0, react.useState)(null);
			const [showHidden, setShowHidden] = (0, react.useState)(false);
			const [nativePicking, setNativePicking] = (0, react.useState)(false);
			const [deleteTarget, setDeleteTarget] = (0, react.useState)(null);
			const [removingId, setRemovingId] = (0, react.useState)(null);
			const generation = (0, react.useRef)(0);
			const activeRequest = (0, react.useRef)(null);
			const configGeneration = (0, react.useRef)(0);
			const configRequest = (0, react.useRef)(null);
			const modeRef = (0, react.useRef)(mode);
			modeRef.current = mode;
			const paneRef = (0, react.useRef)(pane);
			paneRef.current = pane;
			const dialogRef = useDialogA11y(open, () => {
				onCancel();
			});
			const folderDialogRef = useDialogA11y(folderDraft !== null, () => {
				if (!folderBusy) setFolderDraft(null);
			});
			const deleteDialogRef = useDialogA11y(deleteTarget !== null, () => {
				if (removingId === null) setDeleteTarget(null);
			});
			const confirmDialogRef = useDialogA11y(confirmTarget !== null, () => {
				if (hostPending === null) setConfirmTarget(null);
			});
			/** List one level, guarding against superseded/closed generations. */
			const loadLevel = async (request) => {
				const current = generation.current += 1;
				const controller = new AbortController();
				activeRequest.current = controller;
				setPane((previous) => ({
					...previous,
					loading: true,
					error: null
				}));
				try {
					const listing = await request(controller.signal);
					if (current !== generation.current || controller.signal.aborted) return;
					setPane({
						path: listing.path,
						listing,
						error: null,
						loading: false
					});
				} catch (error) {
					if (current !== generation.current || controller.signal.aborted) return;
					setPane((previous) => ({
						...previous,
						loading: false,
						error: error instanceof Error ? error.message : String(error)
					}));
				}
			};
			const navigateLocal = (path) => {
				setMode({ kind: "local" });
				loadLevel((signal) => listLocalDirectory(path, signal));
			};
			const navigateRemote = (id, path) => {
				setMode({
					kind: "remote",
					id
				});
				loadLevel(async (signal) => asListing(unwrap$2(await rpc("browse.list", {
					id,
					...path !== void 0 ? { path } : {}
				}, signal), t("rpc.browseList"))));
			};
			const openRemotePath = async () => {
				if (mode.kind !== "remote" || pane.path === null || openingRemote) return;
				setOpeningRemote(true);
				try {
					if (pickOnly || suppressSessionRoute) {
						onPicked(`ssh://${mode.id}${pane.path}`);
						return;
					}
					const routed = unwrap$2(await rpc("session.route", {
						id: mode.id,
						path: pane.path
					}), t("rpc.sessionRoute"));
					const cwd = isRecord$2(routed) && typeof routed.cwd === "string" ? routed.cwd : "";
					if (cwd === "") throw new Error(t("flow.route.empty"));
					onPicked(cwd);
				} catch (error) {
					setPane((previous) => ({
						...previous,
						error: error instanceof Error ? error.message : String(error)
					}));
				} finally {
					setOpeningRemote(false);
				}
			};
			/**
			* Refresh the connection list. `silent` keeps the previous list on screen
			* (post-mutation refreshes) instead of flashing the skeleton. Returns the
			* freshly parsed list ([] when the call failed) so callers can validate an
			* id against the latest registry state.
			*/
			const refreshConnections = async (silent = false) => {
				if (!silent) setConnectionsLoading(true);
				try {
					const value = unwrap$2(await rpc("connections.list"), t("rpc.connectionsList"));
					if (Array.isArray(value)) {
						const list = value.filter(isRecord$2).map(asConnectionView);
						setConnections(list);
						setConnectionsError(null);
						return list;
					}
				} catch (error) {
					setConnectionsError(error instanceof Error ? error.message : String(error));
				} finally {
					if (!silent) setConnectionsLoading(false);
				}
				return [];
			};
			/**
			* Refresh the `~/.ssh/config` host list (the Host re-reads the file on every
			* call). Same generation + abort guard as the directory pane so closing the
			* dialog or a rapid retry can never apply a stale answer.
			*/
			const refreshConfigHosts = async (silent = false) => {
				if (!silent) setConfigLoading(true);
				const current = configGeneration.current += 1;
				const controller = new AbortController();
				configRequest.current = controller;
				try {
					const value = unwrap$2(await rpc("config.hosts", {}, controller.signal), t("rpc.configHosts"));
					if (current !== configGeneration.current || controller.signal.aborted) return;
					setConfigHosts(asConfigHosts(value));
					setConfigError(null);
				} catch (error) {
					if (current !== configGeneration.current || controller.signal.aborted) return;
					setConfigError(error instanceof Error ? error.message : String(error));
				} finally {
					if (current === configGeneration.current && !silent) setConfigLoading(false);
				}
			};
			/** Open: refresh both sidebar lists and browse the initial target (local home, or the saved connection named by `initialConnectionId` when it exists). Closed: abort. */
			(0, react.useEffect)(() => {
				if (!open) {
					generation.current += 1;
					activeRequest.current?.abort();
					activeRequest.current = null;
					configGeneration.current += 1;
					configRequest.current?.abort();
					configRequest.current = null;
					return;
				}
				generation.current += 1;
				const openGeneration = generation.current;
				setPane(EMPTY_PANE);
				setFolderDraft(null);
				setFormOpen(false);
				setFormDraft(void 0);
				setOpeningRemote(false);
				setDeleteTarget(null);
				setRemovingId(null);
				setHostPending(null);
				setHostError(null);
				setConfirmTarget(null);
				setNativePicking(false);
				refreshConfigHosts();
				const initialId = initialConnectionId.trim();
				if (initialId === "") {
					setMode({ kind: "local" });
					refreshConnections();
					loadLevel((signal) => listLocalDirectory(void 0, signal));
					return;
				}
				setMode({
					kind: "remote",
					id: initialId
				});
				(async () => {
					const list = await refreshConnections();
					if (openGeneration !== generation.current) return;
					if (list.some((connection) => connection.id === initialId)) navigateRemote(initialId);
					else {
						setMode({ kind: "local" });
						loadLevel((signal) => listLocalDirectory(void 0, signal));
					}
				})();
			}, [open]);
			/** The active connection view (undefined while browsing locally). */
			const activeConnection = mode.kind === "remote" ? connections.find((connection) => connection.id === mode.id) : void 0;
			const activePath = pane.path ?? "";
			const refreshCurrent = () => {
				if (modeRef.current.kind === "local") navigateLocal(paneRef.current.path ?? void 0);
				else navigateRemote(modeRef.current.id, paneRef.current.path ?? void 0);
			};
			/** One OS folder chooser on the host display; a pick lands straight as the workspace. */
			const pickNative = async () => {
				if (mode.kind !== "local" || nativePicking) return;
				setNativePicking(true);
				try {
					const result = unwrap$2(await rpc("local.pickNative"), t("rpc.pickNative"));
					const path = isRecord$2(result) && typeof result.path === "string" ? result.path : "";
					if (path !== "") onPicked(path);
				} catch (error) {
					setPane((previous) => ({
						...previous,
						error: error instanceof Error ? error.message : String(error)
					}));
				} finally {
					setNativePicking(false);
				}
			};
			/** The registry entry a config alias points at, if it was registered before. */
			const matchConfigHost = (host) => connections.find((connection) => connection.port === host.port && (connection.host.toLowerCase() === host.alias.toLowerCase() || connection.host.toLowerCase() === host.host.toLowerCase()));
			const openForm = (draft) => {
				setFormDraft(draft);
				setFormOpen(true);
			};
			/**
			* One click on a config host: switch to its registered entry when there is
			* one; otherwise resolve the alias first. A missing username routes to the
			* prefilled form (the registry refuses empty usernames); anything else asks
			* for confirmation before it is registered and browsed.
			*/
			const activateConfigHost = async (host) => {
				if (hostPending !== null) return;
				const existing = matchConfigHost(host);
				if (existing !== void 0) {
					setHostError(null);
					navigateRemote(existing.id);
					return;
				}
				setHostError(null);
				setHostPending(host.alias);
				try {
					const resolved = asResolved(unwrap$2(await rpc("connections.resolve", { host: host.alias }), t("rpc.connectionsResolve")));
					if (resolved.host === "") throw new Error(t("flow.resolve.empty"));
					if (resolved.username.trim() === "") {
						openForm({
							label: host.alias,
							host: resolved.host,
							port: String(resolved.port),
							username: "",
							...resolved.privateKeyPaths[0] !== void 0 ? { privateKeyPath: resolved.privateKeyPaths[0] } : {},
							...resolved.jump.length > 0 ? { jumpText: resolved.jump.map((hop) => `${hop.username !== void 0 && hop.username !== "" ? `${hop.username}@` : ""}${hop.host}${hop.port !== void 0 && hop.port !== 22 ? `:${String(hop.port)}` : ""}`).join(", ") } : {},
							focusUsername: true
						});
						return;
					}
					setConfirmTarget({
						host,
						resolved
					});
				} catch (error) {
					setHostError({
						alias: host.alias,
						message: error instanceof Error ? error.message : String(error)
					});
				} finally {
					setHostPending(null);
				}
			};
			/** Confirmed: register the config host and browse its home right away. */
			const confirmAddHost = async () => {
				if (confirmTarget === null || hostPending !== null) return;
				const { host, resolved } = confirmTarget;
				setHostError(null);
				setHostPending(host.alias);
				try {
					const view = asAddedView(unwrap$2(await rpc("connections.add", {
						label: host.alias,
						host: resolved.host,
						port: resolved.port,
						username: resolved.username,
						...resolved.privateKeyPaths[0] !== void 0 ? { privateKeyPath: resolved.privateKeyPaths[0] } : {},
						...resolved.jump.length > 0 ? { jump: resolved.jump } : {}
					}), t("rpc.connectionsAdd")));
					if (view.id === "") throw new Error(t("flow.add.missingId"));
					setConfirmTarget(null);
					await refreshConnections(true);
					await refreshConfigHosts(true);
					navigateRemote(view.id);
				} catch (error) {
					setConfirmTarget(null);
					setHostError({
						alias: host.alias,
						message: error instanceof Error ? error.message : String(error)
					});
				} finally {
					setHostPending(null);
				}
			};
			/** A prefilled form for the connection whose browse just failed on auth. */
			const draftFromConnection = (connection) => ({
				label: connection.label,
				host: connection.host,
				port: String(connection.port),
				username: connection.username,
				...connection.jumpHosts.length > 0 ? { jumpText: connection.jumpHosts.join(", ") } : {}
			});
			const confirmCreateFolder = async () => {
				const name = (folderDraft ?? "").trim();
				if (name === "" || pane.path === null) return;
				if (name === "." || name === ".." || /[/\\]/.test(name)) {
					setFolderError(t("flow.mkdir.invalidName"));
					return;
				}
				setFolderBusy(true);
				setFolderError(null);
				try {
					if (mode.kind === "local") await createLocalDirectory(pane.path, name);
					else unwrap$2(await rpc("browse.mkdir", {
						id: mode.id,
						path: pane.path,
						name
					}), t("rpc.browseMkdir"));
					setFolderDraft(null);
					refreshCurrent();
				} catch (error) {
					setFolderError(error instanceof Error ? error.message : String(error));
				} finally {
					setFolderBusy(false);
				}
			};
			const confirmRemove = async () => {
				if (deleteTarget === null || removingId !== null) return;
				setRemovingId(deleteTarget.id);
				try {
					unwrap$2(await rpc("connections.remove", { id: deleteTarget.id }), t("rpc.connectionsRemove"));
					await refreshConnections(true);
					await refreshConfigHosts(true);
					if (mode.kind === "remote" && mode.id === deleteTarget.id) {
						setMode({ kind: "local" });
						loadLevel((signal) => listLocalDirectory(void 0, signal));
					}
				} catch (error) {
					setConnectionsError(error instanceof Error ? error.message : String(error));
				} finally {
					setRemovingId(null);
					setDeleteTarget(null);
				}
			};
			const formSaved = async (view) => {
				setFormOpen(false);
				setFormDraft(void 0);
				await refreshConnections(true);
				await refreshConfigHosts(true);
				navigateRemote(view.id);
			};
			const hiddenCount = (pane.listing?.entries ?? []).filter((entry) => entry.hidden).length;
			const visibleEntries = (pane.listing?.entries ?? []).filter((entry) => showHidden || !entry.hidden);
			const home = pane.listing?.home ?? "";
			const crumbs = pane.listing?.crumbs ?? [];
			const lastCrumbIndex = crumbs.length - 1;
			const subtitle = mode.kind === "local" ? t("flow.subtitle.local") : t("flow.subtitle.remote", { endpoint: activeConnection !== void 0 ? `${activeConnection.username}@${activeConnection.host}:${activeConnection.port}` : mode.id });
			/** The translated remote failure for the right pane, when there is one. */
			const remoteFailure = mode.kind === "remote" && pane.error !== null ? describeRemoteFailure(pane.error, t) : null;
			if (!open) return null;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: flow_module_css_default.overlay,
				onClick: (event) => {
					if (event.target === event.currentTarget) onCancel();
				},
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: flow_module_css_default.dialog,
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("flow.dialog.label"),
						ref: dialogRef,
						children: [
							(0, react_jsx_runtime.jsxs)("header", {
								className: flow_module_css_default.header,
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: flow_module_css_default.headerText,
									children: [(0, react_jsx_runtime.jsx)("h3", {
										className: flow_module_css_default.title,
										children: t("flow.title")
									}), (0, react_jsx_runtime.jsx)("p", {
										className: flow_module_css_default.subtitle,
										children: subtitle
									})]
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: flow_module_css_default.iconButton,
									"aria-label": t("flow.close.label"),
									onClick: onCancel,
									children: (0, react_jsx_runtime.jsx)(CloseIcon, {})
								})]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: flow_module_css_default.body,
								children: [(0, react_jsx_runtime.jsxs)("nav", {
									className: flow_module_css_default.sidebar,
									"aria-label": t("flow.sidebar.label"),
									children: [
										(0, react_jsx_runtime.jsx)("section", {
											className: flow_module_css_default.sidebarSection,
											"aria-label": t("flow.sidebar.local.section"),
											children: (0, react_jsx_runtime.jsx)("ul", {
												className: flow_module_css_default.connectionList,
												role: "list",
												children: (0, react_jsx_runtime.jsx)("li", {
													className: cx(flow_module_css_default.connectionItem, mode.kind === "local" && flow_module_css_default.connectionItemActive),
													children: (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														className: flow_module_css_default.connectionMain,
														"aria-current": mode.kind === "local" ? "true" : "false",
														onClick: () => {
															if (mode.kind !== "local") navigateLocal();
														},
														children: [(0, react_jsx_runtime.jsx)(MonitorIcon, { className: flow_module_css_default.connectionIcon }), (0, react_jsx_runtime.jsxs)("span", {
															className: flow_module_css_default.connectionInfo,
															children: [(0, react_jsx_runtime.jsx)("span", {
																className: flow_module_css_default.connectionLabel,
																children: t("flow.sidebar.local.title")
															}), (0, react_jsx_runtime.jsx)("span", {
																className: flow_module_css_default.connectionDetail,
																children: (0, react_jsx_runtime.jsx)("span", {
																	className: flow_module_css_default.connectionEndpoint,
																	children: t("flow.sidebar.local.subtitle")
																})
															})]
														})]
													})
												})
											})
										}),
										(0, react_jsx_runtime.jsxs)("section", {
											className: flow_module_css_default.sidebarSection,
											"aria-label": t("flow.sidebar.saved.section"),
											children: [
												(0, react_jsx_runtime.jsxs)("h4", {
													className: flow_module_css_default.sidebarTitle,
													children: [t("flow.sidebar.saved.title"), connections.length > 0 && (0, react_jsx_runtime.jsx)("span", {
														className: flow_module_css_default.sidebarCount,
														children: connections.length
													})]
												}),
												connectionsLoading && (0, react_jsx_runtime.jsx)("div", {
													role: "status",
													"aria-label": t("flow.sidebar.saved.loading"),
													children: [0, 1].map((index) => (0, react_jsx_runtime.jsxs)("div", {
														className: flow_module_css_default.skeletonRow,
														children: [(0, react_jsx_runtime.jsx)("div", { className: flow_module_css_default.skeletonDot }), (0, react_jsx_runtime.jsxs)("div", {
															className: flow_module_css_default.skeletonLines,
															children: [(0, react_jsx_runtime.jsx)("div", {
																className: flow_module_css_default.skeletonLine,
																style: { width: "38%" }
															}), (0, react_jsx_runtime.jsx)("div", {
																className: flow_module_css_default.skeletonLine,
																style: { width: "62%" }
															})]
														})]
													}, index))
												}),
												connectionsError !== null && !connectionsLoading && (0, react_jsx_runtime.jsxs)("div", {
													className: flow_module_css_default.sideError,
													role: "alert",
													children: [(0, react_jsx_runtime.jsx)("span", {
														className: flow_module_css_default.sideErrorText,
														children: connectionsError
													}), (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														className: flow_module_css_default.retryButton,
														onClick: () => {
															refreshConnections();
														},
														children: [(0, react_jsx_runtime.jsx)(RefreshIcon, { style: {
															width: 12,
															height: 12
														} }), t("flow.retry")]
													})]
												}),
												!connectionsLoading && connectionsError === null && connections.length === 0 && (0, react_jsx_runtime.jsxs)("div", {
													className: flow_module_css_default.sideEmpty,
													children: [
														(0, react_jsx_runtime.jsx)(ServerIcon, {
															className: flow_module_css_default.sideEmptyIcon,
															style: {
																width: 18,
																height: 18
															}
														}),
														(0, react_jsx_runtime.jsx)("p", {
															className: flow_module_css_default.sideEmptyTitle,
															children: t("flow.sidebar.saved.empty.title")
														}),
														(0, react_jsx_runtime.jsx)("p", {
															className: flow_module_css_default.sideEmptyText,
															children: t("flow.sidebar.saved.empty.text")
														})
													]
												}),
												!connectionsLoading && connections.length > 0 && (0, react_jsx_runtime.jsx)("ul", {
													className: flow_module_css_default.connectionList,
													role: "list",
													children: connections.map((connection) => {
														const active = mode.kind === "remote" && mode.id === connection.id;
														return (0, react_jsx_runtime.jsxs)("li", {
															className: cx(flow_module_css_default.connectionItem, active && flow_module_css_default.connectionItemActive),
															children: [
																(0, react_jsx_runtime.jsxs)("button", {
																	type: "button",
																	className: flow_module_css_default.connectionMain,
																	"aria-current": active ? "true" : "false",
																	onClick: () => {
																		navigateRemote(connection.id);
																	},
																	children: [(0, react_jsx_runtime.jsx)(ServerIcon, { className: flow_module_css_default.connectionIcon }), (0, react_jsx_runtime.jsxs)("span", {
																		className: flow_module_css_default.connectionInfo,
																		children: [(0, react_jsx_runtime.jsx)("span", {
																			className: flow_module_css_default.connectionLabel,
																			children: connection.label
																		}), (0, react_jsx_runtime.jsxs)("span", {
																			className: flow_module_css_default.connectionDetail,
																			children: [
																				(0, react_jsx_runtime.jsxs)("span", {
																					className: flow_module_css_default.connectionEndpoint,
																					children: [
																						connection.username,
																						"@",
																						connection.host,
																						":",
																						connection.port
																					]
																				}),
																				(0, react_jsx_runtime.jsxs)("span", {
																					className: flow_module_css_default.badge,
																					children: [connection.auth === "password" ? (0, react_jsx_runtime.jsx)(LockIcon, { style: {
																						width: 11,
																						height: 11
																					} }) : (0, react_jsx_runtime.jsx)(KeyIcon, { style: {
																						width: 11,
																						height: 11
																					} }), connection.auth === "password" ? t("flow.badge.auth.password") : connection.auth === "agent" ? t("flow.badge.auth.agent") : t("flow.badge.auth.key")]
																				}),
																				connection.jumpHosts.length > 0 && (0, react_jsx_runtime.jsxs)("span", {
																					className: flow_module_css_default.badge,
																					title: connection.jumpHosts.join(" → "),
																					children: [(0, react_jsx_runtime.jsx)(RouteIcon, { style: {
																						width: 11,
																						height: 11
																					} }), t("flow.badge.jump", { n: connection.jumpHosts.length })]
																				})
																			]
																		})]
																	})]
																}),
																(0, react_jsx_runtime.jsx)("span", {
																	className: flow_module_css_default.connectionStatus,
																	children: (0, react_jsx_runtime.jsx)(ConnStatusBadge, {
																		id: connection.id,
																		rpc,
																		t,
																		compact: true
																	})
																}),
																(0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: flow_module_css_default.connectionRemove,
																	"aria-label": t("flow.connection.delete.label", { label: connection.label }),
																	title: t("flow.connection.delete.title"),
																	onClick: () => {
																		setDeleteTarget(connection);
																	},
																	children: (0, react_jsx_runtime.jsx)(TrashIcon, { style: {
																		width: 14,
																		height: 14
																	} })
																})
															]
														}, connection.id);
													})
												})
											]
										}),
										(0, react_jsx_runtime.jsxs)("section", {
											className: flow_module_css_default.sidebarSection,
											"aria-label": t("flow.sidebar.ssh.section"),
											children: [
												(0, react_jsx_runtime.jsxs)("h4", {
													className: flow_module_css_default.sidebarTitle,
													children: [t("flow.sidebar.ssh.title"), configHosts.length > 0 && (0, react_jsx_runtime.jsx)("span", {
														className: flow_module_css_default.sidebarCount,
														children: configHosts.length
													})]
												}),
												configLoading && (0, react_jsx_runtime.jsx)("div", {
													role: "status",
													"aria-label": t("flow.sidebar.ssh.loading"),
													children: [0, 1].map((index) => (0, react_jsx_runtime.jsxs)("div", {
														className: flow_module_css_default.skeletonRow,
														children: [(0, react_jsx_runtime.jsx)("div", { className: flow_module_css_default.skeletonDot }), (0, react_jsx_runtime.jsxs)("div", {
															className: flow_module_css_default.skeletonLines,
															children: [(0, react_jsx_runtime.jsx)("div", {
																className: flow_module_css_default.skeletonLine,
																style: { width: "38%" }
															}), (0, react_jsx_runtime.jsx)("div", {
																className: flow_module_css_default.skeletonLine,
																style: { width: "62%" }
															})]
														})]
													}, index))
												}),
												configError !== null && !configLoading && (0, react_jsx_runtime.jsxs)("div", {
													className: flow_module_css_default.sideError,
													role: "alert",
													children: [(0, react_jsx_runtime.jsx)("span", {
														className: flow_module_css_default.sideErrorText,
														children: t("flow.sidebar.ssh.error", { detail: configError })
													}), (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														className: flow_module_css_default.retryButton,
														onClick: () => {
															refreshConfigHosts();
														},
														children: [(0, react_jsx_runtime.jsx)(RefreshIcon, { style: {
															width: 12,
															height: 12
														} }), t("flow.retry")]
													})]
												}),
												!configLoading && configError === null && configHosts.length === 0 && (0, react_jsx_runtime.jsxs)("div", {
													className: flow_module_css_default.sideEmpty,
													children: [(0, react_jsx_runtime.jsx)("p", {
														className: flow_module_css_default.sideEmptyTitle,
														children: t("flow.sidebar.ssh.empty.title")
													}), (0, react_jsx_runtime.jsx)("p", {
														className: flow_module_css_default.sideEmptyText,
														children: t("flow.sidebar.ssh.empty.text")
													})]
												}),
												!configLoading && configHosts.length > 0 && (0, react_jsx_runtime.jsx)("ul", {
													className: flow_module_css_default.connectionList,
													role: "list",
													children: configHosts.map((host) => {
														const registered = matchConfigHost(host);
														const working = hostPending === host.alias;
														const failed = hostError !== null && hostError.alias === host.alias;
														return (0, react_jsx_runtime.jsx)("li", {
															className: flow_module_css_default.connectionItem,
															children: (0, react_jsx_runtime.jsxs)("button", {
																type: "button",
																className: flow_module_css_default.connectionMain,
																"aria-current": "false",
																disabled: hostPending !== null,
																title: registered !== void 0 ? t("flow.ssh.registered.title", {
																	user: registered.username,
																	host: registered.host,
																	port: registered.port
																}) : host.username !== "" ? t("flow.ssh.clickRegister.title", {
																	user: host.username,
																	host: host.host,
																	port: host.port
																}) : t("flow.ssh.noUsername.title"),
																onClick: () => {
																	activateConfigHost(host);
																},
																children: [(0, react_jsx_runtime.jsx)(ServerIcon, { className: flow_module_css_default.connectionIcon }), (0, react_jsx_runtime.jsxs)("span", {
																	className: flow_module_css_default.connectionInfo,
																	children: [(0, react_jsx_runtime.jsx)("span", {
																		className: flow_module_css_default.connectionLabel,
																		children: host.alias
																	}), (0, react_jsx_runtime.jsx)("span", {
																		className: flow_module_css_default.connectionDetail,
																		children: working ? (0, react_jsx_runtime.jsxs)("span", {
																			className: flow_module_css_default.hostWorking,
																			children: [(0, react_jsx_runtime.jsx)(SpinnerIcon, { className: cx(flow_module_css_default.spin, flow_module_css_default.hostSpinner) }), t("flow.ssh.adding")]
																		}) : failed && hostError !== null ? (0, react_jsx_runtime.jsx)("span", {
																			className: flow_module_css_default.hostErrorText,
																			role: "alert",
																			children: t("flow.ssh.addFailed", { message: hostError.message })
																		}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
																			className: flow_module_css_default.connectionEndpoint,
																			children: host.username !== "" ? `${host.username}@${host.host}:${host.port}` : t("flow.ssh.noUsername")
																		}), registered !== void 0 ? (0, react_jsx_runtime.jsxs)("span", {
																			className: cx(flow_module_css_default.badge, flow_module_css_default.badgeAdded),
																			children: [(0, react_jsx_runtime.jsx)(CheckIcon, { style: {
																				width: 11,
																				height: 11
																			} }), t("flow.ssh.added")]
																		}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [host.identityFile && (0, react_jsx_runtime.jsxs)("span", {
																			className: flow_module_css_default.badge,
																			children: [(0, react_jsx_runtime.jsx)(KeyIcon, { style: {
																				width: 11,
																				height: 11
																			} }), t("flow.ssh.badge.key")]
																		}), host.jump && (0, react_jsx_runtime.jsxs)("span", {
																			className: flow_module_css_default.badge,
																			children: [(0, react_jsx_runtime.jsx)(RouteIcon, { style: {
																				width: 11,
																				height: 11
																			} }), t("flow.ssh.badge.jump")]
																		})] })] })
																	})]
																})]
															})
														}, host.alias);
													})
												})
											]
										}),
										(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: flow_module_css_default.sidebarAdd,
											"aria-label": t("flow.connection.new.label"),
											title: t("flow.connection.new.title"),
											onClick: () => {
												openForm();
											},
											children: (0, react_jsx_runtime.jsx)(PlusIcon, { style: {
												width: 14,
												height: 14
											} })
										})
									]
								}), (0, react_jsx_runtime.jsxs)("div", {
									className: flow_module_css_default.main,
									children: [(0, react_jsx_runtime.jsxs)("div", {
										className: flow_module_css_default.toolbar,
										children: [(0, react_jsx_runtime.jsxs)("nav", {
											className: flow_module_css_default.crumbs,
											"aria-label": t("flow.crumbs.label"),
											children: [(0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: flow_module_css_default.crumb,
												"aria-label": t("flow.crumb.home.label"),
												title: t("flow.crumb.home.title"),
												disabled: home === "" || pane.loading,
												onClick: () => {
													if (mode.kind === "local") navigateLocal(home);
													else navigateRemote(mode.id, home);
												},
												children: (0, react_jsx_runtime.jsx)(HomeIcon, { style: {
													width: 13,
													height: 13,
													verticalAlign: "-2px"
												} })
											}), crumbs.map((crumb, index) => index === lastCrumbIndex ? (0, react_jsx_runtime.jsx)("span", {
												className: flow_module_css_default.crumbCurrent,
												"aria-current": "page",
												title: crumb.path,
												children: crumb.name
											}, crumb.path) : (0, react_jsx_runtime.jsxs)("span", {
												className: flow_module_css_default.crumbStep,
												children: [(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: flow_module_css_default.crumb,
													disabled: pane.loading,
													onClick: () => {
														if (mode.kind === "local") navigateLocal(crumb.path);
														else navigateRemote(mode.id, crumb.path);
													},
													children: crumb.name
												}), (0, react_jsx_runtime.jsx)("span", {
													className: flow_module_css_default.crumbSep,
													"aria-hidden": true,
													children: "/"
												})]
											}, crumb.path))]
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: flow_module_css_default.toolbarActions,
											children: [
												mode.kind === "local" && (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: cx(flow_module_css_default.toolButton, flow_module_css_default.toolButtonText),
													"aria-label": t("flow.nativePicker.label"),
													title: t("flow.nativePicker.title"),
													disabled: nativePicking || busy,
													onClick: () => {
														pickNative();
													},
													children: [nativePicking ? (0, react_jsx_runtime.jsx)(SpinnerIcon, { className: flow_module_css_default.spin }) : (0, react_jsx_runtime.jsx)(FolderIcon, { style: {
														width: 13,
														height: 13
													} }), t("flow.nativePicker.text")]
												}),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: flow_module_css_default.toolButton,
													"aria-label": t("flow.mkdir.label"),
													title: t("flow.mkdir.title"),
													disabled: pane.listing === null || pane.loading,
													onClick: () => {
														setFolderDraft("");
														setFolderError(null);
													},
													children: (0, react_jsx_runtime.jsx)(FolderPlusIcon, {})
												}),
												(0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: cx(flow_module_css_default.toolButton, showHidden && flow_module_css_default.toolButtonOn),
													"aria-pressed": showHidden,
													"aria-label": showHidden ? t("flow.hidden.hideLabel") : t("flow.hidden.showLabel"),
													title: showHidden ? t("flow.hidden.hideTitle") : t("flow.hidden.showTitle"),
													onClick: () => {
														setShowHidden((previous) => !previous);
													},
													children: [(0, react_jsx_runtime.jsx)(EyeIcon, {}), !showHidden && hiddenCount > 0 && (0, react_jsx_runtime.jsx)("span", {
														className: flow_module_css_default.countBadge,
														"aria-hidden": true,
														children: hiddenCount
													})]
												}),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: flow_module_css_default.toolButton,
													"aria-label": t("flow.refresh.label"),
													title: t("flow.refresh.title"),
													disabled: pane.loading || pane.listing === null,
													onClick: refreshCurrent,
													children: (0, react_jsx_runtime.jsx)(RefreshIcon, { className: pane.loading ? flow_module_css_default.spin : void 0 })
												})
											]
										})]
									}), (0, react_jsx_runtime.jsxs)("div", {
										className: cx(flow_module_css_default.browser, pane.loading && pane.listing !== null && flow_module_css_default.browserBusy),
										"aria-busy": pane.loading,
										children: [
											pane.loading && pane.listing === null && (0, react_jsx_runtime.jsx)("div", {
												className: flow_module_css_default.skeletons,
												role: "status",
												"aria-label": t("flow.loading.label"),
												children: [
													52,
													78,
													64,
													90,
													45,
													71
												].map((width, index) => (0, react_jsx_runtime.jsx)("div", {
													className: flow_module_css_default.skeleton,
													style: { width: `${width}%` }
												}, index))
											}),
											pane.error !== null && !pane.loading && (0, react_jsx_runtime.jsxs)("div", {
												className: flow_module_css_default.errorPanel,
												role: "alert",
												children: [
													(0, react_jsx_runtime.jsx)(AlertIcon, { className: flow_module_css_default.errorIcon }),
													(0, react_jsx_runtime.jsxs)("div", {
														className: flow_module_css_default.errorBody,
														children: [(0, react_jsx_runtime.jsx)("p", {
															className: flow_module_css_default.errorTitle,
															children: remoteFailure !== null ? remoteFailure.title : mode.kind === "remote" ? t("flow.browse.error.remote") : t("flow.browse.error.local")
														}), (0, react_jsx_runtime.jsx)("p", {
															className: flow_module_css_default.errorText,
															children: remoteFailure !== null ? remoteFailure.text : pane.error
														})]
													}),
													(0, react_jsx_runtime.jsxs)("div", {
														className: flow_module_css_default.errorActions,
														children: [remoteFailure?.needsAuth === true && activeConnection !== void 0 && (0, react_jsx_runtime.jsxs)("button", {
															type: "button",
															className: flow_module_css_default.retryButton,
															onClick: () => {
																openForm(draftFromConnection(activeConnection));
															},
															children: [(0, react_jsx_runtime.jsx)(KeyIcon, { style: {
																width: 12,
																height: 12
															} }), t("flow.auth.complete")]
														}), (0, react_jsx_runtime.jsxs)("button", {
															type: "button",
															className: flow_module_css_default.retryButton,
															onClick: refreshCurrent,
															children: [(0, react_jsx_runtime.jsx)(RefreshIcon, { style: {
																width: 12,
																height: 12
															} }), t("flow.retry")]
														})]
													})
												]
											}),
											pane.listing !== null && visibleEntries.length === 0 && !pane.loading && pane.error === null && (0, react_jsx_runtime.jsxs)("div", {
												className: flow_module_css_default.emptyState,
												children: [
													(0, react_jsx_runtime.jsx)(FolderIcon, {
														className: flow_module_css_default.emptyIcon,
														style: {
															width: 22,
															height: 22
														}
													}),
													(0, react_jsx_runtime.jsx)("p", {
														className: flow_module_css_default.emptyTitle,
														children: t("flow.empty.title")
													}),
													(0, react_jsx_runtime.jsx)("p", {
														className: flow_module_css_default.emptyText,
														children: hiddenCount > 0 && !showHidden ? t("flow.empty.hidden", { n: hiddenCount }) : t("flow.empty.text")
													})
												]
											}),
											visibleEntries.length > 0 && (0, react_jsx_runtime.jsx)("ul", {
												className: flow_module_css_default.entryList,
												role: "list",
												children: visibleEntries.map((entry) => (0, react_jsx_runtime.jsx)("li", { children: (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: cx(flow_module_css_default.entry, entry.hidden && flow_module_css_default.entryHidden),
													onClick: () => {
														if (mode.kind === "local") navigateLocal(entry.path);
														else navigateRemote(mode.id, entry.path);
													},
													children: [
														(0, react_jsx_runtime.jsx)(FolderIcon, { className: flow_module_css_default.entryIcon }),
														(0, react_jsx_runtime.jsx)("span", {
															className: flow_module_css_default.entryName,
															children: entry.name
														}),
														(0, react_jsx_runtime.jsx)(ChevronIcon, { className: flow_module_css_default.entryChevron })
													]
												}) }, entry.path))
											}),
											pane.listing?.truncated === true && (0, react_jsx_runtime.jsx)("p", {
												className: flow_module_css_default.truncated,
												children: t("flow.truncated")
											})
										]
									})]
								})]
							}),
							(0, react_jsx_runtime.jsxs)("footer", {
								className: flow_module_css_default.footer,
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: flow_module_css_default.button,
									disabled: busy,
									onClick: onCancel,
									children: t("flow.cancel")
								}), (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: cx(flow_module_css_default.button, flow_module_css_default.primary),
									disabled: pane.listing === null || pane.loading || busy || openingRemote || pane.path === null,
									onClick: () => {
										if (pane.path === null) return;
										if (mode.kind === "local") onPicked(pane.path);
										else if (pickOnly) onPicked(`ssh://${mode.id}${pane.path}`);
										else openRemotePath();
									},
									children: [mode.kind === "remote" && openingRemote && (0, react_jsx_runtime.jsx)(SpinnerIcon, { className: flow_module_css_default.spin }), mode.kind === "remote" ? openingRemote ? t("flow.footer.connecting") : pickOnly ? t("flow.footer.pick") : t("flow.footer.open") : t("flow.footer.select")]
								})]
							})
						]
					}),
					folderDraft !== null && (0, react_jsx_runtime.jsx)("div", {
						className: flow_module_css_default.overlay,
						onClick: (event) => {
							if (event.target === event.currentTarget && !folderBusy) setFolderDraft(null);
						},
						children: (0, react_jsx_runtime.jsxs)("div", {
							className: flow_module_css_default.smallDialog,
							role: "dialog",
							"aria-modal": "true",
							"aria-label": t("flow.mkdir.dialogLabel"),
							ref: folderDialogRef,
							children: [
								(0, react_jsx_runtime.jsx)("h3", {
									className: flow_module_css_default.formTitle,
									children: t("flow.mkdir.title")
								}),
								(0, react_jsx_runtime.jsxs)("p", {
									className: flow_module_css_default.createIn,
									children: [t("flow.mkdir.location"), (0, react_jsx_runtime.jsx)("span", {
										className: cx(flow_module_css_default.mono, flow_module_css_default.createPath),
										children: activePath === "" ? "…" : activePath
									})]
								}),
								(0, react_jsx_runtime.jsx)("input", {
									className: cx(flow_module_css_default.input, folderError !== null && flow_module_css_default.inputError),
									value: folderDraft,
									placeholder: t("flow.mkdir.placeholder"),
									disabled: folderBusy,
									onChange: (event) => {
										setFolderDraft(event.target.value);
									},
									onKeyDown: (event) => {
										if (event.key === "Enter" && !folderBusy) confirmCreateFolder();
									}
								}),
								folderError !== null && (0, react_jsx_runtime.jsx)("p", {
									className: flow_module_css_default.fieldError,
									role: "alert",
									children: folderError
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: flow_module_css_default.formActions,
									children: [
										(0, react_jsx_runtime.jsx)("span", { className: flow_module_css_default.gap }),
										(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: flow_module_css_default.button,
											disabled: folderBusy,
											onClick: () => {
												setFolderDraft(null);
											},
											children: t("flow.cancel")
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: cx(flow_module_css_default.button, flow_module_css_default.primary),
											disabled: folderBusy || (folderDraft ?? "").trim() === "",
											onClick: () => {
												confirmCreateFolder();
											},
											children: [folderBusy && (0, react_jsx_runtime.jsx)(SpinnerIcon, { className: flow_module_css_default.spin }), t("flow.mkdir.create")]
										})
									]
								})
							]
						})
					}),
					deleteTarget !== null && (0, react_jsx_runtime.jsx)("div", {
						className: flow_module_css_default.overlay,
						onClick: (event) => {
							if (event.target === event.currentTarget && removingId === null) setDeleteTarget(null);
						},
						children: (0, react_jsx_runtime.jsxs)("div", {
							className: flow_module_css_default.smallDialog,
							role: "dialog",
							"aria-modal": "true",
							"aria-label": t("flow.connection.delete.dialogLabel"),
							ref: deleteDialogRef,
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: flow_module_css_default.confirmHead,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: flow_module_css_default.confirmIconWrap,
									children: (0, react_jsx_runtime.jsx)(TrashIcon, {})
								}), (0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("h3", {
									className: flow_module_css_default.formTitle,
									children: t("flow.connection.delete.confirm", { label: deleteTarget.label })
								}), (0, react_jsx_runtime.jsx)("p", {
									className: flow_module_css_default.confirmText,
									children: t("flow.connection.delete.text", {
										u: deleteTarget.username,
										h: deleteTarget.host,
										p: deleteTarget.port
									})
								})] })]
							}), (0, react_jsx_runtime.jsxs)("div", {
								className: flow_module_css_default.formActions,
								children: [
									(0, react_jsx_runtime.jsx)("span", { className: flow_module_css_default.gap }),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: flow_module_css_default.button,
										disabled: removingId !== null,
										onClick: () => {
											setDeleteTarget(null);
										},
										children: t("flow.cancel")
									}),
									(0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: cx(flow_module_css_default.button, flow_module_css_default.danger),
										disabled: removingId !== null,
										onClick: () => {
											confirmRemove();
										},
										children: [removingId !== null && (0, react_jsx_runtime.jsx)(SpinnerIcon, { className: flow_module_css_default.spin }), t("flow.connection.delete.title")]
									})
								]
							})]
						})
					}),
					confirmTarget !== null && (0, react_jsx_runtime.jsx)("div", {
						className: flow_module_css_default.overlay,
						onClick: (event) => {
							if (event.target === event.currentTarget && hostPending === null) setConfirmTarget(null);
						},
						children: (0, react_jsx_runtime.jsxs)("div", {
							className: flow_module_css_default.smallDialog,
							role: "dialog",
							"aria-modal": "true",
							"aria-label": t("flow.ssh.confirm.dialogLabel"),
							ref: confirmDialogRef,
							children: [(0, react_jsx_runtime.jsxs)("div", {
								className: flow_module_css_default.confirmHead,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: cx(flow_module_css_default.confirmIconWrap, flow_module_css_default.confirmIconInfo),
									children: (0, react_jsx_runtime.jsx)(ServerIcon, {})
								}), (0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("h3", {
									className: flow_module_css_default.formTitle,
									children: t("flow.ssh.confirm.title", { alias: confirmTarget.host.alias })
								}), (0, react_jsx_runtime.jsx)("p", {
									className: flow_module_css_default.confirmText,
									children: confirmTarget.resolved.jump.length > 0 ? t("flow.ssh.confirm.text.jump", {
										u: confirmTarget.resolved.username,
										h: confirmTarget.resolved.host,
										p: confirmTarget.resolved.port,
										n: confirmTarget.resolved.jump.length
									}) : t("flow.ssh.confirm.text", {
										u: confirmTarget.resolved.username,
										h: confirmTarget.resolved.host,
										p: confirmTarget.resolved.port
									})
								})] })]
							}), (0, react_jsx_runtime.jsxs)("div", {
								className: flow_module_css_default.formActions,
								children: [
									(0, react_jsx_runtime.jsx)("span", { className: flow_module_css_default.gap }),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: flow_module_css_default.button,
										disabled: hostPending !== null,
										onClick: () => {
											setConfirmTarget(null);
										},
										children: t("flow.cancel")
									}),
									(0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: cx(flow_module_css_default.button, flow_module_css_default.primary),
										disabled: hostPending !== null,
										onClick: () => {
											confirmAddHost();
										},
										children: [hostPending !== null && (0, react_jsx_runtime.jsx)(SpinnerIcon, { className: flow_module_css_default.spin }), t("flow.ssh.confirm.submit")]
									})
								]
							})]
						})
					}),
					formOpen && (0, react_jsx_runtime.jsx)(ConnectionForm, {
						rpc,
						draft: formDraft,
						t,
						onClose: () => {
							setFormOpen(false);
							setFormDraft(void 0);
						},
						onSaved: (view) => {
							formSaved(view);
						}
					})
				]
			});
		}
		//#endregion
		//#region lib/client/local-directory.js
		/**
		* Local-pane directory seats for the two `directoryFlow` slots.
		*
		* The local pane browses the HOST filesystem, and the client service that owns
		* that capability is **`uiWorkspace`** — the Workspace Controller's UI face.
		* Upstream builds it as `new UiWorkspaceService(...)` whose constructor runs
		* `super(ctx, "uiWorkspace")` and implements `listDirectory(path, signal)` /
		* `createDirectory(path, name)` there
		* (`dsh-client-ui-workspace/lib/client.js:37`, `:85`, `:90`); the official
		* browse picker calls `ctx.uiWorkspace.listDirectory(path, signal)`
		* (`dsh-client-ui-directory-picker-browse/lib/client.js:1023`).
		*
		* The similarly named **`workspaces`** service is the controller's own face
		* (create / rename / delete / archiveSession / list — Service Catalog
		* `key: "workspaces"`, `dsh-cordis-client-runner/lib/client.js:1488`) and has
		* neither method. Wiring the seats to it made the local pane fail with
		* `ctx.workspaces.listDirectory is not a function` (BUG-3).
		*
		* Resolution is lazy and optional (`ctx.get`, never `inject`): a renamed or
		* missing service must degrade to one localized error line inside the pane,
		* never stop the rest of the plugin (settings page, side workspaces) from
		* mounting.
		*
		* @module dsh-workspace-enhancement/client/local-directory
		*/
		/**
		* Build the local-pane seats.
		*
		* @param resolve - reads the live `uiWorkspace` service; `undefined` while the
		* service is absent (or when the runtime has not mounted it at all).
		* @param unavailable - localized message used when the service (or its
		* directory methods) is missing; the pane renders it as the browse error.
		* @returns seats that forward to the service, or reject with `unavailable()`.
		*/
		function createLocalDirectorySeats(resolve, unavailable) {
			const require = () => {
				const service = resolve();
				if (service === void 0 || typeof service.listDirectory !== "function") throw new Error(unavailable());
				return service;
			};
			return {
				listLocalDirectory: async (path, signal) => require().listDirectory(path, signal),
				createLocalDirectory: async (path, name) => require().createDirectory(path, name)
			};
		}
		//#endregion
		//#region lib/client/route-id.js
		/**
		* The client-side spelling of the host's route-placeholder rule: recover the
		* registry connection id from a local placeholder path
		* (`…/dsw-routes/<id>/<remote path>` or the legacy `dsh-ssh-routes/` tree).
		*
		* WHY IT IS ITS OWN MODULE (t4): two client consumers need the same rule — the
		* DOM row-badge layer (`./row-badges.ts`, which looks the id up on workspace
		* paths) and the official-slot remote-status entry (`./remote-status.ts`, which
		* looks it up on a session cwd). `row-badges.ts` imports `status.tsx` for its
		* palette, and the sandbox test runner cannot load `.tsx` (not even
		* transitively — `ERR_UNKNOWN_FILE_EXTENSION`), so a pure-`.ts` home is what
		* lets the entry's judgment be unit-tested by `npm run test:agent`. The body
		* below is the function `row-badges.ts` used to define; it re-exports it
		* unchanged, so that layer behaves exactly as before.
		* @module dsh-workspace-enhancement/client/route-id
		*/
		/**
		* The registry connection id inside a route-placeholder path, or undefined.
		* Mirrors the host's `routeFromPlaceholder` root/id rules: the id is the first
		* path segment under the placeholder root and must be a safe registry id.
		* @param path - a workspace path or session cwd (any spelling that is not `ssh://`).
		* @returns the connection id, or undefined when the path names no route.
		*/
		function routeIdOf(path) {
			const match = /(?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i.exec(path);
			if (match === null) return void 0;
			const id = match[1];
			if (id === void 0 || !/^[A-Za-z0-9._-]+$/.test(id)) return void 0;
			return id;
		}
		//#endregion
		//#region lib/client/sandbox-badge.js
		/**
		* REQ-I9 (ADR-0022 D1): the machine-list fence badge projection, in its own
		* `.ts` module for the same reason `route-id.ts` exists — the sandbox test
		* runner uses Node's built-in type stripping and cannot load `.tsx`, not even
		* transitively, so a helper that lived in `row-badges.ts` (which imports
		* `status.tsx` for its view type) would be invisible to `npm run test:agent`.
		* `row-badges.ts` re-exports it, so the badge surface keeps ONE implementation.
		*
		* Zero migration is the whole contract here: `'off'` — the default, and every
		* machine record that predates the field — renders the EMPTY string, so an
		* upgraded settings page shows exactly what it showed before.
		*
		* @module dsh-workspace-enhancement/client/sandbox-badge
		*/
		/**
		* The fence badge text of one machine row.
		* @param mode - the machine view's fence mode (untrusted wire value; an older
		*   host that never sends the key passes `undefined`).
		* @param t - the translate seat (active language).
		* @returns the localized badge text, or `''` when nothing should be rendered.
		*/
		function sandboxBadgeOf(mode, t) {
			const normalized = mode === "read-only" || mode === "workspace-write" ? mode : "off";
			return normalized === "off" ? "" : t("settings.machines.sandboxBadge", { mode: normalized });
		}
		//#endregion
		//#region lib/client/row-badges.js
		/**
		* Sidebar row enhancement — DOM compatibility layer (C3).
		*
		* The shipped workspace browser (ui-workspace's `sidebar.workspaces`
		* occupant) exposes no per-row slot, so the tri-state remote badge is
		* injected into the rendered list DOM instead: a MutationObserver watches the
		* document for the session tree, remote entries are matched by workspace /
		* session title against the workspace registry projection (paths under the
		* `dsw-routes` / `dsh-ssh-routes` placeholder roots), and each matched row is
		* decorated with a 🌐 + tri-state badge + a mini "re-check and try to
		* connect" button (unknown/offline only).
		*
		* Degradation contract (all deliberate, no exceptions):
		* - Missing/unexpected DOM shapes → the scan no-ops (latch after repeated
		*   failures; upstream re-renders are picked up by the observer).
		* - Unknown ids / RPC failures → badge stays on `unknown` with no button
		*   noise; the row is never duplicated (the single status-marker idempotence)
		*   and our insertions cannot loop (a re-scan after our own mutation inserts
		*   nothing).
		* - Flat-mode sessions are matched by title against the session projection
		*   (ambiguous titles are skipped); grouped sessions inherit their group's
		*   connection.
		* - C3 same-title guard: a remote title that ALSO belongs to a local
		*   workspace / session (path or cwd without a route placeholder root) is
		*   never marked — a missing badge is the accepted cost, a mis-mark is not.
		*   Remote↔remote ambiguity keeps the skip. Rebuild is 先清后标: badges whose
		*   row no longer qualifies are withdrawn before the next injection pass, so
		*   no stale badge can survive a same-title local workspace appearing, a
		*   remote workspace/session deletion, or a title rename.
		* - t6 (no self-sustaining loop): `rowTitleOf` excludes the badge subtree
		*   (badge-root `data-dsw-badge` mark) and the MutationObserver filters our
		*   own badge-paint mutations (target inside the badge subtree), so a
		*   converged scan performs ZERO DOM writes and zero self-induced scans.
		*
		* F0 regression guard: the row status marker is ONE attribute — markRowStatus
		* writes it, rowStatusOf reads it, and paintConn matches it. Both accessors
		* derive from {@link ROW_STATUS_KEY}, so the write/read keys can never drift
		* apart again.
		*
		* No new dependencies; no React; reversible through the returned disposer.
		* @module dsh-workspace-enhancement/client/row-badges
		*/
		/**
		* The ONE row status-marker key: `data-dsw-conn-id` is the idempotence guard
		* (a row already marked for a connection is skipped) AND the paintConn match
		* key (F0: markRow used to write a different attribute than paintConn read,
		* so badges never painted). The badge element carries a separate copy of the
		* attribute for click delegation; this constant governs the ROW only.
		*/
		const ROW_STATUS_KEY = "dswConnId";
		/**
		* Read the row's current connection marker (undefined = unmarked).
		* @param row - the row element.
		* @returns the connection id the row is marked for, when marked.
		*/
		function rowStatusOf(row) {
			return row.dataset[ROW_STATUS_KEY];
		}
		/**
		* Mark a row for a connection (F0 single-attribute contract). Idempotent:
		* a row already marked for the SAME connection is untouched and reports
		* false; marking for a different connection replaces the marker (the old
		* badge belongs to an element that a React re-render replaces anyway).
		* @param row - the row element.
		* @param connId - the connection id.
		* @returns whether the row was newly marked.
		*/
		function markRowStatus(row, connId) {
			if (row.dataset["dswConnId"] === connId) return false;
			row.dataset[ROW_STATUS_KEY] = connId;
			return true;
		}
		/** Clear the row's status marker (dispose path). */
		function clearRowStatus(row) {
			delete row.dataset[ROW_STATUS_KEY];
		}
		/** A status view while nothing has been probed yet. */
		function unknownView(connId) {
			return {
				id: connId,
				state: "unknown",
				connected: false,
				label: "",
				host: "",
				port: 22,
				username: "",
				hostKeyKnown: false
			};
		}
		/** The `data-dsw-compact` badge attribute: the retry button text variant. */
		const COMPACT_KEY = "dswCompact";
		/**
		* Pure badge-text projection (t15-r2): resolves the state label plus the
		* retry button text/title for ONE language. `paintBadge` replays this after a
		* language switch, and the unit test pins the zh→en transition of the button
		* text and title (the in-place rewrite writes only changed values).
		* @param view - the connection status view.
		* @param compact - the row's compact variant (session child rows).
		* @param t - the translate seat (active language).
		*/
		function badgeTextsOf(view, compact, t) {
			return {
				stateLabel: t(CONN_STATE_LABEL_KEY[view.state]),
				buttonText: compact ? t("status.retryAction.compact") : t("status.retryAction.recheck"),
				buttonTitle: t("status.retryAction.title")
			};
		}
		const STATUS_FRESH_MS = 5e3;
		const STATUS_POLL_MS = 3e4;
		const SCAN_DELAY_MS = 120;
		const SCAN_MIN_GAP_MS = 300;
		const MAX_CONSECUTIVE_FAILURES = 3;
		/**
		* C3: grouped-view index — remote workspace title → connection id.
		*
		* A workspace is remote when its path carries a route placeholder root
		* (`dsw-routes` / legacy `dsh-ssh-routes`); every OTHER title (a local
		* workspace, or an unclassifiable path) forms the local-title set, and a
		* remote title that also exists there is DROPPED before any marking: a local
		* workspace named like a remote one must never be decorated as remote.
		* Remote↔remote ambiguity (two connections, one title) keeps the existing
		* skip — a missing badge is the accepted cost, a mis-mark is not.
		* @param workspaces - the full workspace projection (local + remote rows).
		* @returns title → connId (only unambiguous, non-colliding remote titles).
		*/
		function remoteWorkspaceIndex(workspaces) {
			const localTitles = /* @__PURE__ */ new Set();
			const byTitle = /* @__PURE__ */ new Map();
			for (const workspace of workspaces) {
				if (workspace.title === "") continue;
				const connId = routeIdOf(workspace.path);
				if (connId === void 0) {
					localTitles.add(workspace.title);
					continue;
				}
				byTitle.set(workspace.title, [...byTitle.get(workspace.title) ?? [], connId]);
			}
			const index = /* @__PURE__ */ new Map();
			for (const [title, ids] of byTitle) {
				if (localTitles.has(title)) continue;
				const unique = ids.filter((id, index) => ids.indexOf(id) === index);
				if (unique.length === 1 && unique[0] !== void 0) index.set(title, unique[0]);
			}
			return index;
		}
		/**
		* C3: flat-view index — remote session title → connection id.
		*
		* Sessions are remote when their recorded cwd carries a route placeholder
		* root; every other session (local cwd, or no cwd recorded — unjudgeable)
		* feeds the local-title set, and a remote title colliding with it is dropped:
		* a local/unknown session named like a remote one must never be marked in
		* flat mode. Remote↔remote ambiguity stays skipped.
		* @param sessions - the full session projection.
		* @returns title → connId (only unambiguous, non-colliding remote titles).
		*/
		function remoteSessionIndex(sessions) {
			const localTitles = /* @__PURE__ */ new Set();
			const byTitle = /* @__PURE__ */ new Map();
			for (const session of sessions) {
				if (session.title === "") continue;
				const connId = session.cwd !== void 0 ? routeIdOf(session.cwd) : void 0;
				if (connId === void 0) {
					localTitles.add(session.title);
					continue;
				}
				byTitle.set(session.title, [...byTitle.get(session.title) ?? [], connId]);
			}
			const index = /* @__PURE__ */ new Map();
			for (const [title, ids] of byTitle) {
				if (localTitles.has(title)) continue;
				const unique = ids.filter((id, index) => ids.indexOf(id) === index);
				if (unique.length === 1 && unique[0] !== void 0) index.set(title, unique[0]);
			}
			return index;
		}
		/**
		* C3 撤回: whether one already-marked row still qualifies after a data change.
		* A marked row keeps its badge only when its CURRENT title still maps to the
		* connId it was marked for under the NEW index; everything else — a
		* same-title LOCAL workspace/session that appeared later, a remote
		* workspace/session deleted, a title renamed to something unindexed (or to
		* another connection), or an unreadable title — is withdrawn before the next
		* injection pass, so「重建=先清后标」and no injected badge can linger.
		* @param connId - the connId the row was marked for (rowStatusOf).
		* @param title - the row's current display title (null when unreadable).
		* @param index - the CURRENT (rebuilt) title → connId index of the row's view.
		* @returns whether the badge may stay.
		*/
		function markedRowStillQualifies(connId, title, index) {
			return title !== null && index.get(title) === connId;
		}
		/**
		* `data-dsw-badge`: the ONE attribute marking OUR injected badge ROOT. The
		* badge ALSO carries `data-dsw-conn-id` (click delegation) while the ROW
		* carries the same attribute (F0 marker), so badge-subtree exclusion must key
		* on this dedicated mark — never on a nested conn-id. t6: without it
		* {@link rowTitleOf} returned the badge's own textContent (🌐 + state label +
		* even the display:none reconnect-button text — regularly LONGER than every
		* real title), the C3 撤回 step judged each marked row unmatched, and the
		* badge was withdrawn + re-injected on every scan: the self-sustaining loop.
		*/
		const BADGE_MARK_KEY = "dswBadge";
		const BADGE_MARK_SELECTOR = "[data-dsw-badge]";
		/**
		* The row's display title = the longest non-icon span OUTSIDE the injected
		* badge subtree. t6: badge root and children (marked `data-dsw-badge`) are
		* skipped — the badge's textContent includes the hidden reconnect button and
		* outgrows the real title, which made the C3 撤回 step see every marked row
		* as unmatched (withdraw + re-inject per scan). The 无变更 path needs this:
		* only the REAL title may drive qualification, or a converged scan never
		* converges.
		* @param row - the row (HTMLElement, or a structural fake in tests).
		* @returns the best real title, or null when nothing readable remains.
		*/
		function rowTitleOf(row) {
			let best = "";
			for (const span of Array.from(row.querySelectorAll("span"))) {
				if (span.querySelector("svg") !== null) continue;
				if (span.closest(BADGE_MARK_SELECTOR) !== null) continue;
				const text = span.textContent?.trim() ?? "";
				if (text.length > best.length) best = text;
			}
			return best.length > 0 ? best : null;
		}
		/**
		* t6 观察器自诱过滤: is a MutationRecord's target INSIDE our badge subtree?
		* Our own badge PAINT writes (label textContent replacement; the only
		* childList mutation we ever perform inside a badge) would otherwise re-arm
		* the MutationObserver and schedule a scan that is guaranteed to be a
		* no-write — a self-induced scan per paint. With the badge-root mark, those
		* records are recognized and skipped, so a scan only ever runs for REAL
		* upstream changes (badge append/removal targets the ROW, not the badge, and
		* still schedules). Structural face (no Element/`instanceof` needed): the
		* browser passes `MutationRecord.target` = the mutated parent element.
		* @param target - the mutation record's target (or a structural fake).
		* @returns whether the mutation belongs to our own badge paint.
		*/
		function isOwnBadgeMutation(target) {
			if (target === null || target === void 0) return false;
			const element = target;
			if (element === null || typeof element.closest !== "function") return false;
			return element.closest(BADGE_MARK_SELECTOR) !== null;
		}
		const isElement = (value) => value instanceof HTMLElement;
		/**
		* Install the sidebar row enhancement. Returns the disposer (removes every
		* injected badge, listener, observer, subscription, and timer).
		* @param rpc - the `/dsw` channel call.
		* @param sources - workspace/session projections.
		* @param subscribe - drives a re-scan on feed changes (caller combines stores).
		* @param locale - the locale face (bind = read-time translate seat,
		*   subscribe = language-switch repaint of injected badges); omitted → zh
		*   baseline (pure-helper/test callers keep the pre-i18n texts).
		*/
		function installRowBadges(rpc, sources, subscribe, locale) {
			if (typeof document === "undefined") return () => {};
			const t = locale !== void 0 ? locale.bind("dsw") : zhBaseline;
			/** title → connId; ambiguous titles (two connections, one name) are dropped. */
			let remoteByTitle = /* @__PURE__ */ new Map();
			let remoteSessionTitles = /* @__PURE__ */ new Map();
			const statuses = /* @__PURE__ */ new Map();
			const marked = /* @__PURE__ */ new Map();
			let consecutiveFailures = 0;
			let disposed = false;
			let pendingScan = null;
			let lastScanAt = 0;
			const rebuildRemote = () => {
				remoteByTitle = remoteWorkspaceIndex(sources.workspaces());
				remoteSessionTitles = remoteSessionIndex(sources.sessions());
			};
			const fetchStatus = async (connId, force) => {
				const record = statuses.get(connId);
				if (!force && record !== void 0 && Date.now() - record.at < STATUS_FRESH_MS) return record.view;
				const pendingInFlight = record?.pending;
				if (pendingInFlight !== void 0 && pendingInFlight !== null) return pendingInFlight;
				const pending = (async () => {
					try {
						const result = await rpc("conn.status", { id: connId });
						if (!result.ok) throw new Error(result.error.message);
						const view = result.value;
						if (typeof view !== "object" || view === null || !("id" in view)) {
							statuses.delete(connId);
							return unknownView(connId);
						}
						const parsed = view;
						statuses.set(connId, {
							view: parsed,
							at: Date.now(),
							pending: null
						});
						return parsed;
					} catch {
						statuses.delete(connId);
						return unknownView(connId);
					}
				})();
				statuses.set(connId, {
					view: record?.view ?? unknownView(connId),
					at: record?.at ?? 0,
					pending
				});
				return pending;
			};
			const paintBadge = (badge, view) => {
				const dot = badge.querySelector("[data-dsw-dot]");
				const label = badge.querySelector("[data-dsw-label]");
				const button = badge.querySelector("[data-dsw-action=\"reconnect\"]");
				if (dot !== null) dot.style.background = CONN_STATE_COLOR[view.state];
				const texts = badgeTextsOf(view, badge.dataset[COMPACT_KEY] === "1", t);
				if (label !== null && label.textContent !== texts.stateLabel) label.textContent = texts.stateLabel;
				if (button !== null) {
					const display = view.state === "active" ? "none" : "";
					if (button.style.display !== display) button.style.display = display;
					if (button.textContent !== texts.buttonText) button.textContent = texts.buttonText;
					if (button.title !== texts.buttonTitle) button.title = texts.buttonTitle;
				}
			};
			const paintConn = (connId) => {
				const record = statuses.get(connId);
				if (record === void 0) return;
				for (const [row, badge] of marked) if (rowStatusOf(row) === connId) paintBadge(badge, record.view);
			};
			/**
			* Language-switch repaint (design §7.3): re-derive every injected badge's
			* texts in place. paintBadge's value guard writes only texts that actually
			* differ, and the writes are badge-subtree mutations the observer filter
			* (isOwnBadgeMutation) skips — no scan storm, no badge DOM rebuild.
			*/
			const repaintAll = () => {
				for (const [row, badge] of marked) {
					const connId = rowStatusOf(row);
					if (connId === void 0) continue;
					paintBadge(badge, statuses.get(connId)?.view ?? unknownView(connId));
				}
			};
			const refreshConn = async (connId, force) => {
				const view = await fetchStatus(connId, force);
				if (disposed) return;
				const record = statuses.get(connId);
				if (record !== void 0) record.view = view;
				paintConn(connId);
			};
			const buildBadge = (connId, compact) => {
				const badge = document.createElement("span");
				badge.dataset.dswConnId = connId;
				badge.dataset[BADGE_MARK_KEY] = "1";
				badge.dataset[COMPACT_KEY] = compact ? "1" : "0";
				badge.style.cssText = "display:inline-flex;align-items:center;gap:3px;margin:0 4px;vertical-align:middle;flex-shrink:0;user-select:none;";
				const globe = document.createElement("span");
				globe.textContent = "🌐";
				globe.style.cssText = "font-size:11px;line-height:1;";
				const dot = document.createElement("span");
				dot.dataset.dswDot = "";
				dot.style.cssText = "width:7px;height:7px;border-radius:50%;display:inline-block;background:" + CONN_STATE_COLOR.unknown + ";";
				const label = document.createElement("span");
				label.dataset.dswLabel = "";
				label.style.cssText = "font-size:11px;opacity:.85;white-space:nowrap;";
				label.textContent = t(CONN_STATE_LABEL_KEY.unknown);
				const button = document.createElement("button");
				button.type = "button";
				button.dataset.dswAction = "reconnect";
				button.title = t("status.retryAction.title");
				button.textContent = compact ? t("status.retryAction.compact") : t("status.retryAction.recheck");
				button.style.cssText = "padding:0 5px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.12);color:inherit;cursor:pointer;font-size:10px;line-height:16px;white-space:nowrap;";
				badge.append(globe, dot, label, button);
				return badge;
			};
			const markRow = (row, connId, compact) => {
				if (!markRowStatus(row, connId)) return;
				const badge = buildBadge(connId, compact);
				row.appendChild(badge);
				marked.set(row, badge);
				refreshConn(connId, false);
			};
			/**
			* C3 撤回: withdraw every injected badge whose row no longer qualifies
			* under the CURRENT indexes before the next injection pass
			* (「重建=先清后标」 — otherwise a data change — same-title local workspace
			* appearing, a remote workspace/session deleted, a title renamed — leaves
			* stale badges on rows that must no longer look remote). Grouped session
			* children inherit their section's group row: they stay only while that
			* group still qualifies. Runs on every scan; a no-op while nothing changed.
			*/
			const withdrawStale = () => {
				for (const [row, badge] of [...marked]) {
					const connId = rowStatusOf(row);
					if (connId === void 0) {
						badge.remove();
						marked.delete(row);
						continue;
					}
					const tree = row.closest("[role=\"tree\"]");
					if (tree === null) continue;
					const grouped = Array.from(tree.querySelectorAll("[role=\"treeitem\"][aria-expanded]")).length > 0;
					const title = rowTitleOf(row);
					let qualify = false;
					if (grouped) {
						if (row.getAttribute("aria-expanded") !== null) qualify = markedRowStillQualifies(connId, title, remoteByTitle);
						else {
							const section = row.parentElement;
							const group = section === null ? void 0 : Array.from(section.children).find((child) => isElement(child) && child !== row && rowStatusOf(child) === connId && child.getAttribute("role") === "treeitem" && child.getAttribute("aria-expanded") !== null);
							qualify = group !== void 0 && markedRowStillQualifies(connId, rowTitleOf(group), remoteByTitle);
						}
					} else qualify = markedRowStillQualifies(connId, title, remoteSessionTitles);
					if (qualify) continue;
					badge.remove();
					clearRowStatus(row);
					marked.delete(row);
				}
			};
			const scan = () => {
				if (disposed || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
				try {
					for (const [row, badge] of marked) if (!row.isConnected) {
						badge.remove();
						marked.delete(row);
					}
					withdrawStale();
					const trees = Array.from(document.querySelectorAll("[role=\"tree\"]"));
					for (const tree of trees) {
						const groupRows = Array.from(tree.querySelectorAll("[role=\"treeitem\"][aria-expanded]"));
						if (groupRows.length > 0) for (const row of groupRows) {
							const title = rowTitleOf(row);
							const connId = title !== null ? remoteByTitle.get(title) : void 0;
							if (connId === void 0) continue;
							markRow(row, connId, false);
							const section = row.parentElement;
							if (section === null) continue;
							for (const child of Array.from(section.children)) {
								if (child === row || !isElement(child)) continue;
								if (child.getAttribute("role") !== "treeitem") continue;
								if (rowStatusOf(child) === connId) continue;
								markRow(child, connId, true);
							}
						}
						else if (remoteSessionTitles.size > 0) for (const row of Array.from(tree.querySelectorAll("[role=\"treeitem\"]"))) {
							const title = rowTitleOf(row);
							if (title === null) continue;
							const connId = remoteSessionTitles.get(title);
							if (connId === void 0) continue;
							markRow(row, connId, false);
						}
					}
					consecutiveFailures = 0;
				} catch (error) {
					consecutiveFailures += 1;
					if (consecutiveFailures === 1) console.debug("dsw: sidebar row badges scan failed (degrading):", error);
				}
			};
			const scheduleScan = () => {
				if (disposed || pendingScan !== null) return;
				const elapsed = Date.now() - lastScanAt;
				const delay = elapsed >= SCAN_MIN_GAP_MS ? SCAN_DELAY_MS : SCAN_MIN_GAP_MS - elapsed + SCAN_DELAY_MS;
				pendingScan = setTimeout(() => {
					pendingScan = null;
					lastScanAt = Date.now();
					scan();
				}, delay);
			};
			const onChange = () => {
				rebuildRemote();
				scheduleScan();
			};
			const onClick = (event) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				const button = target.closest("[data-dsw-action=\"reconnect\"]");
				if (button === null) return;
				const badge = button.closest("[data-dsw-conn-id]");
				const connId = badge?.dataset.dswConnId;
				if (badge === null || badge === void 0 || connId === void 0) return;
				event.preventDefault();
				event.stopPropagation();
				const label = badge.querySelector("[data-dsw-label]");
				if (label !== null) label.textContent = t("status.connecting");
				rpc("conn.reconnect", { id: connId }).then((result) => {
					if (!result.ok) throw new Error(result.error.message);
					const view = result.value;
					if (typeof view === "object" && view !== null && "id" in view) {
						const parsed = view;
						statuses.set(connId, {
							view: parsed,
							at: Date.now(),
							pending: null
						});
						paintConn(connId);
					}
				}).catch(() => {
					refreshConn(connId, true).catch(() => void 0);
				});
			};
			const observer = new MutationObserver((records) => {
				if (records.some((record) => !isOwnBadgeMutation(record.target))) scheduleScan();
			});
			const unsubscribe = subscribe(onChange);
			const unsubscribeLocale = locale !== void 0 ? locale.subscribe(repaintAll) : void 0;
			const rootTarget = document.body ?? document.documentElement;
			observer.observe(rootTarget, {
				childList: true,
				subtree: true
			});
			document.addEventListener("click", onClick, true);
			const pollTimer = setInterval(() => {
				if (marked.size === 0 || disposed) return;
				const connIds = /* @__PURE__ */ new Set();
				for (const badge of marked.values()) {
					const connId = badge.dataset.dswConnId;
					if (connId !== void 0) connIds.add(connId);
				}
				for (const connId of connIds) refreshConn(connId, true).catch(() => void 0);
			}, STATUS_POLL_MS);
			onChange();
			return () => {
				disposed = true;
				observer.disconnect();
				document.removeEventListener("click", onClick, true);
				clearInterval(pollTimer);
				if (pendingScan !== null) clearTimeout(pendingScan);
				for (const [row, badge] of marked) {
					badge.remove();
					clearRowStatus(row);
				}
				marked.clear();
				statuses.clear();
				unsubscribeLocale?.();
				unsubscribe();
			};
		}
		//#endregion
		//#region lib/client/remote-status.js
		/**
		* Remote-status header entry — pure logic (REQ-I2 entry point, official-slot
		* route).
		*
		* WHY ITS OWN MODULE (docs/testing.md): the sandbox runner (`test:agent`) never
		* executes `.tsx`, so every judgment the entry makes lives here — the slot and
		* entry identity, the session→connection resolution, the render decision, and
		* the registration options. The `.tsx` beside it only renders.
		*
		* TRUTH SOURCE: a session is remote when its cwd routes to a machine — the very
		* fact the host reads for the remote prompt sections
		* (`src/session-remote-context.ts` → `remoteRouteFromCwd`). The client must not
		* import that module (it drags `node:fs` / `ssh2` into the browser bundle), so
		* the route-id rule is mirrored here through `routeIdOf` of `./route-id.ts`,
		* the single client-side spelling of it, shared with the DOM badge layer.
		*
		* SLOT CHOICE (ADR-0017 + the round's hard constraint): the entry registers
		* into `conversation.session.header.utilities` — the official additive list
		* slot both peer families declare ("Right-aligned Session utilities in ascending
		* order"; the rc.1 catalog lists it with the `session-log-download` occupant, the
		* rc.2 catalog with `open-in-app` + `session-log-download`), so the feature is
		* visible both on the family the live deployment runs and on rc.2. A
		* right-aligned utilities cell is where a remote STATUS belongs: the sibling
		* `conversation.session.header.actions` is the title-adjacent ACTION group,
		* where this plugin already owns the side-workspaces cell.
		*
		* No conditional double registration, ever: `ctx.slots.inject` waits for a
		* declaration and cannot ask whether a key exists, so registering into two
		* seats would render the same status twice on rc.2. Should a live check ever
		* show the utilities seat absent, the fallback is to move this ONE constant to
		* `conversation.session.header.actions` — never to register in both.
		* @module dsh-workspace-enhancement/client/remote-status
		*/
		/**
		* The official additive list slot the entry occupies: "Right-aligned Session
		* utilities in ascending order". Declared by the header entry of
		* `@deepseek-ai/dsh-client-ui-conversation` in both supported families —
		* `kind: 'list'`, `scope: 'session'`, `replaceRisk: 'none'`.
		*/
		const REMOTE_STATUS_SLOT = "conversation.session.header.utilities";
		/**
		* This entry's OWN row identity. No shipped utilities cell uses this id, so the
		* cell is ADDED beside them; reusing a shipped id would replace that cell.
		*/
		const REMOTE_STATUS_ENTRY_ID = "dsh-workspace-enhancement-remote";
		/**
		* The connection id one cwd spelling routes to, or undefined for a local
		* session. Mirrors the host's `remoteRouteFromCwd`: the `ssh://<id>/<path>`
		* form first, then either local placeholder tree (`dsw-routes/<id>/…`, the
		* pre-rename `dsh-ssh-routes/<id>/…`). An unknown/malformed spelling is a
		* local session — never a guess.
		* @param cwd - the session's recorded cwd (any spelling).
		* @returns the registry connection id, or undefined when the cwd is local.
		*/
		function remoteConnectionIdOf(cwd) {
			if (cwd === void 0 || cwd === "") return void 0;
			if (cwd.startsWith("ssh://")) {
				const rest = cwd.slice(6);
				const slash = rest.indexOf("/");
				const id = slash === -1 ? rest : rest.slice(0, slash);
				return /^[A-Za-z0-9._-]+$/.test(id) ? id : void 0;
			}
			return routeIdOf(cwd);
		}
		/**
		* Build the registration options. Pure (a translate seat in, options out) so
		* the id/order contract is unit-testable without the slot registry.
		* @param t - the translate seat of the active language.
		*/
		function remoteStatusRegisterOptions(t) {
			return {
				name: REMOTE_STATUS_SLOT,
				id: REMOTE_STATUS_ENTRY_ID,
				order: 26,
				label: () => t("header.remote.label"),
				locale: "dsw"
			};
		}
		/**
		* Build the seats over the live session feed. Resolution is lazy and optional
		* (`ctx.get` territory): a runtime without the store — or with a store whose
		* shape moved — degrades to "no facts" and the entry stays hidden instead of
		* throwing inside the header's render.
		*
		* The caller hands in the FEED (`sessions.list`, the SessionController's list
		* store), not the `sessions` service face: the face carries `open`/`fork`/
		* `search`/… and exposes the store as `list`.
		* @param resolveFeed - reads the live feed; undefined while it is absent.
		*/
		function createRemoteStatusSeats(resolveFeed) {
			const feed = () => {
				const found = resolveFeed();
				if (found === void 0) return void 0;
				if (typeof found.getSnapshot !== "function" || typeof found.subscribe !== "function") return void 0;
				return found;
			};
			return {
				remoteFacts: (sessionId) => {
					const row = feed()?.getSnapshot().byId[sessionId];
					if (row === void 0) return void 0;
					return typeof row.cwd === "string" ? { cwd: row.cwd } : {};
				},
				subscribeRemote: (onChange) => feed()?.subscribe(onChange) ?? (() => {})
			};
		}
		//#endregion
		//#region lib/client/remote-status-entry.js
		/**
		* The header-action VIEW of the remote-status entry (REQ-I2 entry point). All
		* judgments live in `./remote-status.ts` — this file only renders them, because
		* the sandbox runner never executes `.tsx`.
		*
		* One row in the session header action strip: the tri-state state of the
		* connection the current session's cwd routes to (dot + state label), plus a
		* click that re-checks and reconnects. A local session renders nothing at all —
		* the strip stays exactly as upstream built it.
		* @module dsh-workspace-enhancement/client/remote-status-entry
		*/
		/**
		* Track the session's facts across feed changes. The seat functions are stable
		* across renders (apply builds them once), so the subscription is not
		* re-created; the value guard keeps a feed that fires without a real change
		* from churning renders.
		*/
		function useRemoteFacts(sessionId, seats) {
			const { remoteFacts, subscribeRemote } = seats;
			const [facts, setFacts] = (0, react.useState)(() => remoteFacts(sessionId));
			(0, react.useEffect)(() => {
				const sync = () => {
					const next = remoteFacts(sessionId);
					setFacts((prev) => prev?.cwd === next?.cwd ? prev : next);
				};
				sync();
				return subscribeRemote(sync);
			}, [
				sessionId,
				remoteFacts,
				subscribeRemote
			]);
			return facts;
		}
		/** The remote-status row: dot + state label, click = re-check and reconnect. */
		function RemoteStatusAction(props) {
			const t = props.t ?? zhBaseline;
			const connId = remoteConnectionIdOf(useRemoteFacts(props.sessionId, props)?.cwd);
			const { view, busy, reconnect } = useConnStatus(getStatusCenter(props.rpc, () => t), connId);
			if (connId === void 0) return null;
			const state = view?.state ?? "unknown";
			const machine = view !== null && view.label !== "" ? view.label : connId;
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				"data-dsw-remote-status": connId,
				className: "dsw-remote-status",
				title: t("header.remote.title", { machine }),
				"aria-label": t("header.remote.label"),
				disabled: busy,
				onClick: () => {
					reconnect();
				},
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 4,
					padding: "2px 6px",
					borderRadius: 6,
					border: "1px solid rgba(128,128,128,0.35)",
					background: "rgba(128,128,128,0.08)",
					color: "inherit",
					cursor: busy ? "default" : "pointer",
					fontSize: 11,
					whiteSpace: "nowrap"
				},
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": true,
						style: {
							fontSize: 11,
							lineHeight: 1
						},
						children: "🌐"
					}),
					(0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": true,
						style: {
							width: 8,
							height: 8,
							borderRadius: "50%",
							background: CONN_STATE_COLOR[state],
							display: "inline-block",
							flexShrink: 0
						}
					}),
					(0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							opacity: .85
						},
						children: busy ? t("status.checking") : t(CONN_STATE_LABEL_KEY[state])
					})
				]
			});
		}
		//#endregion
		//#region lib/client/settings.js
		/**
		* Minimal remote-machine management settings page (machine registry edition):
		* machine list (edit / delete / set current / forget host key) plus the shared
		* {@link MachineForm} (mode="settings") — one form component with the flow's
		* add-connection form (R2 表单并集; see docs/ui-merge-design.md). No forwards /
		* audit / update sections — those belong to dsh-remote only and are
		* deliberately not ported.
		*
		* All data rides the package's `/dsw` RPC channel (machines.*, hostkey.forget);
		* all styles are inline.
		* @module dsh-workspace-enhancement/settings
		*/
		const isRecord$1 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		/** Structural check for one machine wire row (unknown fields tolerated). */
		function asMachineView(value) {
			if (!isRecord$1(value)) return null;
			if (typeof value.id !== "string" || typeof value.host !== "string" || typeof value.username !== "string") return null;
			const machine = {
				id: value.id,
				label: typeof value.label === "string" ? value.label : value.host,
				host: value.host,
				port: typeof value.port === "number" ? value.port : 22,
				username: value.username,
				auth: value.auth === "password" || value.auth === "agent" ? value.auth : "key",
				passwordSet: value.passwordSet === true,
				jumpHosts: Array.isArray(value.jumpHosts) ? value.jumpHosts.map(String) : [],
				credentialBackend: typeof value.credentialBackend === "string" ? value.credentialBackend : "plain",
				remoteApproval: value.remoteApproval === "human" || value.remoteApproval === "ai" ? value.remoteApproval : "off",
				remoteSandbox: value.remoteSandbox === "read-only" || value.remoteSandbox === "workspace-write" ? value.remoteSandbox : "off"
			};
			if (typeof value.cwd === "string") machine.cwd = value.cwd;
			if (typeof value.workspace === "string") machine.workspace = value.workspace;
			if (value.hostKeyMode === "accept-new" || value.hostKeyMode === "verify" || value.hostKeyMode === "off") machine.hostKeyMode = value.hostKeyMode;
			if (value.encryptFallback === true) machine.encryptFallback = true;
			if (Array.isArray(value.recentWorkspaces)) machine.recentWorkspaces = value.recentWorkspaces.map(String);
			return machine;
		}
		/** Unwrap a wire result or throw its business error. */
		function unwrap$1(result, fallback) {
			if (!result.ok) throw new Error(result.error.message || fallback);
			return result.value;
		}
		/** Map a machine row onto the shared form's edit initial state (secret-free). */
		function editInitialOf(machine) {
			return {
				id: machine.id,
				name: machine.label,
				host: machine.host,
				port: String(machine.port || 22),
				username: machine.username || "root",
				workspace: machine.workspace ?? machine.cwd ?? "",
				hostKeyMode: machine.hostKeyMode ?? "",
				encryptPassword: machine.credentialBackend !== "" && machine.credentialBackend !== "plain",
				remoteApproval: machine.remoteApproval ?? "off",
				remoteSandbox: machine.remoteSandbox ?? "off",
				auth: machine.auth === "password" || machine.passwordSet === true || machine.credentialBackend !== "" && machine.credentialBackend !== "plain" ? "password" : "key",
				jumpText: machine.jumpHosts.join(", ")
			};
		}
		/**
		* F2: the durable save acknowledgment. The machine form's success text cannot
		* persist — the form remounts when `key={editing?.id}` changes and any in-form
		* feedback vanishes with it — so the settings page owns the banner. The
		* honest fallback marker (encryption requested, OS backend failed) rides
		* along as pure text (no live data; a `MachineSaveView` leaf).
		*/
		function savedBanner(view, t = zhBaseline) {
			return t("settings.saved", {
				label: view.label || `${view.username}@${view.host}`,
				fallback: view.encryptFallback === true ? t("settings.encrypt.fallback") : ""
			});
		}
		/** The registers page component: machine list + shared form. */
		function RemoteWorkspaceSettingsPage({ rpc, t: tSeat }) {
			const t = tSeat ?? zhBaseline;
			const [machines, setMachines] = (0, react.useState)([]);
			const [currentId, setCurrentId] = (0, react.useState)("");
			const [editing, setEditing] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)("");
			const [err, setErr] = (0, react.useState)("");
			const refresh = async () => {
				try {
					const state = unwrap$1(await rpc("machines.list"), t("settings.rpc.listMachines"));
					setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
					setCurrentId(typeof state.currentId === "string" ? state.currentId : "");
				} catch (error) {
					setErr(error instanceof Error ? error.message : String(error));
				}
			};
			(0, react.useEffect)(() => {
				refresh();
			}, []);
			const startEdit = (machine) => {
				setEditing(editInitialOf(machine));
				setErr("");
				setMsg("");
			};
			const del = async (id) => {
				if (!window.confirm(t("settings.delete.confirm"))) return;
				setBusy(true);
				setErr("");
				setMsg("");
				try {
					const state = unwrap$1(await rpc("machines.remove", { id }), t("settings.rpc.removeFailed"));
					setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
					setCurrentId(typeof state.currentId === "string" ? state.currentId : "");
					if (editing?.id === id) setEditing(null);
					setMsg(t("settings.deleted"));
				} catch (error) {
					setErr(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			};
			const useNow = async (id) => {
				setBusy(true);
				setErr("");
				setMsg("");
				try {
					const state = unwrap$1(await rpc("machines.setCurrent", { id }), t("settings.rpc.switchFailed"));
					setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
					setCurrentId(typeof state.currentId === "string" ? state.currentId : "");
					setMsg(t("settings.setCurrent"));
				} catch (error) {
					setErr(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			};
			const forgetKey = async (machine) => {
				setBusy(true);
				setErr("");
				setMsg("");
				try {
					unwrap$1(await rpc("hostkey.forget", { id: machine.id }), t("settings.rpc.forgetKeyFailed"));
					setMsg(t("settings.forgotten", {
						host: machine.host,
						port: machine.port
					}));
				} catch (error) {
					setErr(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			};
			const handleSaved = (view) => {
				setEditing(null);
				setErr("");
				setMsg(savedBanner(view, t));
				refresh();
			};
			const buttonStyle = {
				padding: "6px 12px",
				borderRadius: 8,
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.08)",
				color: "inherit",
				cursor: "pointer",
				fontSize: 12
			};
			const boxStyle = {
				border: "1px solid rgba(128,128,128,0.35)",
				borderRadius: 8,
				background: "rgba(128,128,128,0.06)",
				padding: 10
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: 16,
					display: "flex",
					flexDirection: "column",
					gap: 12,
					maxWidth: 860
				},
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 15,
							fontWeight: 600
						},
						children: t("settings.title")
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 12,
							opacity: .8
						},
						children: t("settings.description")
					}),
					err !== "" ? (0, react_jsx_runtime.jsx)("div", {
						style: {
							color: "#e06c75",
							fontSize: 12
						},
						children: err
					}) : null,
					msg !== "" ? (0, react_jsx_runtime.jsx)("div", {
						style: {
							color: "#98c379",
							fontSize: 12
						},
						children: msg
					}) : null,
					(0, react_jsx_runtime.jsxs)("div", {
						style: boxStyle,
						children: [(0, react_jsx_runtime.jsx)("div", {
							style: {
								marginBottom: 6,
								fontSize: 13,
								fontWeight: 600
							},
							children: t("settings.machines.title")
						}), machines.length > 0 ? machines.map((machine) => (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: "6px 0",
								borderBottom: "1px solid rgba(128,128,128,0.25)"
							},
							children: (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 8,
									alignItems: "flex-start",
									flexWrap: "wrap"
								},
								children: [(0, react_jsx_runtime.jsxs)("div", {
									style: {
										flex: "1 1 220px",
										minWidth: 0,
										fontSize: 13,
										display: "flex",
										flexDirection: "column",
										gap: 4
									},
									children: [(0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											flexWrap: "wrap",
											alignItems: "baseline",
											gap: 6,
											minWidth: 0
										},
										children: [
											(0, react_jsx_runtime.jsx)("span", { children: machine.label }),
											(0, react_jsx_runtime.jsxs)("code", {
												style: {
													fontSize: 12,
													opacity: .8
												},
												children: [
													machine.username,
													"@",
													machine.host,
													":",
													machine.port
												]
											}),
											machine.credentialBackend !== "" && machine.credentialBackend !== "plain" ? " 🗝" : "",
											machine.encryptFallback === true ? (0, react_jsx_runtime.jsxs)("span", {
												style: {
													color: "#e6c07b",
													fontSize: 12
												},
												children: [" ", t("settings.machines.encryptFallbackBadge")]
											}) : "",
											machine.remoteApproval !== "off" ? (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 12,
													opacity: .85
												},
												children: [" ", t("settings.machines.gateBadge", { mode: machine.remoteApproval })]
											}) : "",
											sandboxBadgeOf(machine.remoteSandbox, t) !== "" ? (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 12,
													opacity: .85
												},
												children: [" ", sandboxBadgeOf(machine.remoteSandbox, t)]
											}) : "",
											machine.jumpHosts.length > 0 ? " ⛳" : ""
										]
									}), (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											flexWrap: "wrap",
											alignItems: "center",
											gap: 6,
											minWidth: 0
										},
										children: [(0, react_jsx_runtime.jsx)(ConnStatusBadge, {
											id: machine.id,
											rpc,
											t
										}), machine.id === currentId ? (0, react_jsx_runtime.jsx)("span", {
											style: {
												color: "#98c379",
												fontSize: 12
											},
											children: t("settings.machines.currentBadge")
										}) : null]
									})]
								}), (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										flexWrap: "wrap",
										gap: 6,
										alignItems: "center",
										justifyContent: "flex-end",
										marginLeft: "auto"
									},
									children: [
										(0, react_jsx_runtime.jsx)("button", {
											style: {
												...buttonStyle,
												whiteSpace: "nowrap"
											},
											onClick: () => startEdit(machine),
											children: t("settings.machines.edit")
										}),
										(0, react_jsx_runtime.jsx)("button", {
											style: {
												...buttonStyle,
												whiteSpace: "nowrap"
											},
											onClick: () => void del(machine.id),
											children: t("settings.machines.delete")
										}),
										(0, react_jsx_runtime.jsx)("button", {
											style: {
												...buttonStyle,
												whiteSpace: "nowrap"
											},
											onClick: () => void useNow(machine.id),
											disabled: machine.id === currentId || busy,
											children: t("settings.machines.setCurrent")
										}),
										(0, react_jsx_runtime.jsx)("button", {
											style: {
												...buttonStyle,
												whiteSpace: "nowrap"
											},
											onClick: () => void forgetKey(machine),
											children: t("settings.machines.forgetKey")
										})
									]
								})]
							})
						}, machine.id)) : (0, react_jsx_runtime.jsx)("div", {
							style: {
								opacity: .6,
								fontSize: 12
							},
							children: t("settings.machines.empty")
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: boxStyle,
						children: [(0, react_jsx_runtime.jsx)("div", {
							style: {
								marginBottom: 6,
								fontSize: 13,
								fontWeight: 600
							},
							children: editing !== null ? t("settings.form.editTitle") : t("settings.form.addTitle")
						}), (0, react_jsx_runtime.jsx)(MachineForm, {
							mode: "settings",
							rpc,
							initial: editing ?? void 0,
							t,
							onSaved: handleSaved
						}, editing?.id ?? "blank")]
					})
				]
			});
		}
		//#endregion
		//#region lib/client/cockpit.js
		/**
		* Session workspace cockpit — pure derivation logic (REQ-I11 / ADR-0021 §2.9).
		*
		* WHY ITS OWN MODULE (docs/testing.md): the sandbox runner (`npm run test:agent`)
		* never executes `.tsx`, so every judgment the cockpit makes lives here — which
		* sections exist, where the session actually works, which toggle is on, and how
		* a stale machine id is handled. `./side-workspaces.tsx` only renders what these
		* functions return.
		*
		* TRUTH SOURCES, in order:
		*
		*  - the session cwd (read by the panel through the `remoteFacts` seat over the
		*    sessions store — the same fact `./remote-status.ts` reads) says WHERE the
		*    session works: any accepted route spelling (`ssh://<id>/<path>`, the
		*    `dsw-routes/<id>/…` placeholder tree the host's `session.route` hands back,
		*    the legacy `dsh-ssh-routes/` tree) is the remote main workspace; anything
		*    else is a plain local session (ADR-0021 §2.9 item 1);
		*  - `machines.list` is the machine universe: a connection row exists for every
		*    registry machine and for nothing else;
		*  - `session.conn.list` is the ONLY source of the connected set. This module
		*    keeps no second copy: the panel re-reads it after every mutation and derives
		*    the toggle state from whatever that read returned, so a failed toggle can
		*    never leave the UI optimistically wrong (ADR-0021 §0/§2.9: the panel toggle
		*    and `sw_connect` write one store, and the UI may not disagree with it).
		*
		* THE IMPLICIT MAIN MACHINE (ADR-0021 §2.4; host side `connectedMachinesOf` in
		* `src/exec-tools.ts`): a cwd that routes to a machine the registry still knows
		* counts as CONNECTED without being stored. The panel performs the same union
		* the `sw_exec` gate performs, so what the UI shows as connected is exactly what
		* the tool accepts. The row is flagged `implicit` and is not toggleable, because
		* disconnecting it cannot stick: the connection comes from the session's own cwd,
		* not from the store. (A cwd routing to a machine the registry no longer knows is
		* still shown as the main workspace — that is where the session works — but it is
		* NOT counted as connected, again mirroring the host.)
		*
		* STALE IDS: a connected id the registry no longer knows (a stale `machines.list`)
		* is reported as `staleConnectionIds` and renders NO row. The panel must never
		* offer a toggle for a machine that does not exist, and `side.conn.empty` is about
		* machines the user can actually see.
		* @module dsh-workspace-enhancement/client/cockpit
		*/
		/** The `ssh://<id>/<posix>` spelling: scheme, id, optional POSIX tail. */
		const SSH_SPELLING = /^ssh:\/\/([^/]+)((?:\/.*)?)$/;
		/**
		* The placeholder spelling, mirroring the pattern behind `routeIdOf`
		* (`./route-id.ts`, re-exported through `remoteConnectionIdOf`); this match is
		* only used to slice off the POSIX tail — the id itself always comes from
		* `remoteConnectionIdOf`, the repo's single client-side spelling of the rule.
		*/
		const PLACEHOLDER_SPELLING = /[\\/](?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i;
		const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		/** Split a spelling's tail into a leading-slash POSIX path (`''` → `/`). */
		function posixPathOf(raw) {
			const segments = raw.split(/[\\/]+/).filter((segment) => segment !== "" && segment !== ".");
			return segments.length === 0 ? "/" : `/${segments.join("/")}`;
		}
		/**
		* The route one cwd spelling names, or undefined for a local session. Mirrors
		* the host's `remoteRouteFromCwd` through the two client-side rules the repo
		* already ships: `remoteConnectionIdOf` for the id (both spellings) and the
		* placeholder slice for the path. An unknown or malformed spelling is a local
		* session — never a guess.
		* @param cwd - the session's recorded cwd (any accepted spelling).
		*/
		function routeOfCwd(cwd) {
			const id = remoteConnectionIdOf(cwd);
			if (id === void 0 || cwd === void 0) return void 0;
			const ssh = SSH_SPELLING.exec(cwd);
			if (ssh !== null) return {
				id,
				path: posixPathOf(ssh[2] ?? "")
			};
			const placeholder = PLACEHOLDER_SPELLING.exec(cwd);
			if (placeholder === null) return void 0;
			return {
				id,
				path: posixPathOf(cwd.slice(placeholder.index + placeholder[0].length))
			};
		}
		/**
		* Where one session actually works (ADR-0021 §2.9 item 1): the registry machine
		* + remote path the cwd routes to, or `none` for a plain local session.
		* @param cwd - the session's recorded cwd.
		* @param machines - the registry machines (for the label/host).
		*/
		function mainWorkspaceOf(cwd, machines) {
			const route = routeOfCwd(cwd);
			if (route === void 0) return { kind: "none" };
			const machine = machines.find((entry) => entry.id === route.id);
			if (machine === void 0) return {
				kind: "remote",
				machineId: route.id,
				label: route.id,
				host: "",
				username: "",
				path: route.path,
				machineKnown: false
			};
			return {
				kind: "remote",
				machineId: machine.id,
				label: machine.label,
				host: machine.host,
				username: machine.username,
				path: route.path,
				machineKnown: true
			};
		}
		/**
		* The「已连接的机器」rows: one per registry machine (registry order), each with
		* the toggle state the last `session.conn.list` read implies. The implicit main
		* machine is unioned in exactly like the host's `sw_exec` gate does (and only
		* when the registry still knows it), and is never toggleable.
		* @param machines - the registry machines.
		* @param connectedIds - the ids the store returned (raw).
		* @param mainMachineId - the cwd's machine id when the registry knows it.
		*/
		function connectionRows(machines, connectedIds, mainMachineId) {
			const stored = normalizeIds(connectedIds);
			return machines.map((machine) => {
				const implicit = mainMachineId !== void 0 && machine.id === mainMachineId;
				return {
					id: machine.id,
					label: machine.label,
					host: machine.host,
					username: machine.username,
					connected: implicit || stored.includes(machine.id),
					implicit,
					canToggle: !implicit
				};
			});
		}
		/**
		* The whole cockpit derivation in one pass — the only entry point the view uses.
		* @param cwd - the session's recorded cwd.
		* @param machines - the registry machines.
		* @param connectedIds - the ids the last `session.conn.list` read returned.
		*/
		function cockpitViewOf(cwd, machines, connectedIds) {
			const main = mainWorkspaceOf(cwd, machines);
			const mainMachineId = main.kind === "remote" && main.machineKnown ? main.machineId : void 0;
			const connections = connectionRows(machines, connectedIds, mainMachineId);
			return {
				main,
				connections,
				staleConnectionIds: staleConnectionIdsOf(connectedIds, machines),
				mainMachineId,
				anyConnected: connections.some((row) => row.connected)
			};
		}
		/**
		* The connected ids the registry no longer carries (a stale `machines.list`).
		* They render nowhere; surfacing them keeps the disappearance testable instead
		* of silent.
		* @param connectedIds - the ids the store returned (raw).
		* @param machines - the registry machines.
		*/
		function staleConnectionIdsOf(connectedIds, machines) {
			const known = new Set(machines.map((machine) => machine.id));
			return normalizeIds(connectedIds).filter((id) => !known.has(id));
		}
		/**
		* The RPC one toggle performs, or undefined when the row must not toggle (the
		* implicit main machine, or a blank session id). Pure, so the panel performs no
		* judgment of its own.
		* @param sessionId - the session the toggle belongs to.
		* @param row - the connection row the user clicked.
		*/
		function toggleRequest(sessionId, row) {
			if (!row.canToggle || sessionId.trim() === "") return void 0;
			return {
				endpoint: row.connected ? "session.conn.disconnect" : "session.conn.connect",
				payload: {
					sessionId,
					id: row.id
				}
			};
		}
		/** The `user@host` line of one machine ('' when the registry has no host). */
		function machineEndpointOf(machine) {
			if (machine.host === "") return "";
			return machine.username === "" ? machine.host : `${machine.username}@${machine.host}`;
		}
		/** Normalize a raw id list: strings, trimmed, non-empty, first-seen order. */
		function normalizeIds(values) {
			const out = [];
			for (const value of values) {
				if (typeof value !== "string") continue;
				const id = value.trim();
				if (id === "" || out.includes(id)) continue;
				out.push(id);
			}
			return out;
		}
		/**
		* One `machines.list` row, reduced to the leaf fields the cockpit renders. A row
		* without a usable id is dropped (it can name nothing).
		* @param value - one raw wire row.
		*/
		function asMachine(value) {
			if (!isRecord(value)) return null;
			if (typeof value.id !== "string" || value.id.trim() === "") return null;
			const id = value.id.trim();
			return {
				id,
				label: typeof value.label === "string" && value.label !== "" ? value.label : id,
				host: typeof value.host === "string" ? value.host : "",
				username: typeof value.username === "string" ? value.username : ""
			};
		}
		/** The `machines.list` value (`{ machines: [...] }`) as cockpit machines. */
		function asMachineRows(value) {
			return (isRecord(value) && Array.isArray(value.machines) ? value.machines : []).map(asMachine).filter((row) => row !== null);
		}
		/**
		* One `session.ws.list` row (REQ-I7: declaration only). A row without an id or a
		* root key is dropped.
		* @param value - one raw wire row.
		*/
		function asSideRow(value) {
			if (!isRecord(value)) return null;
			if (typeof value.id !== "string" || typeof value.rootKey !== "string") return null;
			return {
				id: value.id,
				kind: value.kind === "remote" ? "remote" : "local",
				rootKey: value.rootKey,
				label: typeof value.label === "string" ? value.label : value.rootKey
			};
		}
		/** The `session.ws.list` value (`{ items: [...] }`) as side rows. */
		function asSideRows(value) {
			return (isRecord(value) && Array.isArray(value.items) ? value.items : []).map(asSideRow).filter((row) => row !== null);
		}
		/** The `session.conn.*` value (`{ items: string[] }`) as the connected id list. */
		function asConnectedIds(value) {
			return normalizeIds(isRecord(value) && Array.isArray(value.items) ? value.items : []);
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/dsh-workspace-enhancement/dsh-workspace-enhancement/src/client/side-workspaces.module.css.mjs
		const css = ".hr4_CG_action,.hr4_CG_panel{--dswsw-accent:var(--color-primary,var(--accent,var(--primary,#4a6cf7)));--dswsw-accent-fg:#fff;--dswsw-surface:var(--color-bg-elevated,var(--background,var(--card,#17181c)));--dswsw-fg:var(--color-fg,var(--foreground,#e8e9ec));--dswsw-danger:var(--color-danger,var(--destructive,#e5534b));--dswsw-surface-2:color-mix(in srgb, var(--dswsw-fg) 3%, var(--dswsw-surface));--dswsw-surface-3:color-mix(in srgb, var(--dswsw-fg) 7%, var(--dswsw-surface));--dswsw-surface-inset:color-mix(in srgb, black 10%, var(--dswsw-surface));--dswsw-line:color-mix(in srgb, var(--dswsw-fg) 8%, var(--dswsw-surface));--dswsw-border:color-mix(in srgb, var(--dswsw-fg) 14%, var(--dswsw-surface));--dswsw-border-strong:color-mix(in srgb, var(--dswsw-fg) 26%, var(--dswsw-surface));--dswsw-fg-muted:color-mix(in srgb, var(--dswsw-fg) 65%, var(--dswsw-surface));--dswsw-fg-subtle:color-mix(in srgb, var(--dswsw-fg) 38%, var(--dswsw-surface));--dswsw-accent-soft:color-mix(in srgb, var(--dswsw-accent) 13%, var(--dswsw-surface));--dswsw-danger-soft:color-mix(in srgb, var(--dswsw-danger) 12%, var(--dswsw-surface));--dswsw-danger-text:color-mix(in srgb, var(--dswsw-danger) 55%, var(--dswsw-fg));--dswsw-scrim:#090a0d94;--dswsw-shadow:0 24px 64px #00000080}@media (prefers-color-scheme:light){.hr4_CG_action,.hr4_CG_panel{--dswsw-accent:var(--color-primary,var(--accent,var(--primary,#3b5bdb)));--dswsw-surface:var(--color-bg-elevated,var(--background,var(--card,#fff)));--dswsw-fg:var(--color-fg,var(--foreground,#21242a));--dswsw-danger:var(--color-danger,var(--destructive,#c9352f));--dswsw-surface-2:color-mix(in srgb, var(--dswsw-fg) 3%, var(--dswsw-surface));--dswsw-surface-3:color-mix(in srgb, var(--dswsw-fg) 7%, var(--dswsw-surface));--dswsw-surface-inset:color-mix(in srgb, black 6%, var(--dswsw-surface));--dswsw-line:color-mix(in srgb, var(--dswsw-fg) 8%, var(--dswsw-surface));--dswsw-border:color-mix(in srgb, var(--dswsw-fg) 14%, var(--dswsw-surface));--dswsw-border-strong:color-mix(in srgb, var(--dswsw-fg) 26%, var(--dswsw-surface));--dswsw-fg-muted:color-mix(in srgb, var(--dswsw-fg) 65%, var(--dswsw-surface));--dswsw-fg-subtle:color-mix(in srgb, var(--dswsw-fg) 38%, var(--dswsw-surface));--dswsw-accent-soft:color-mix(in srgb, var(--dswsw-accent) 11%, var(--dswsw-surface));--dswsw-danger-soft:color-mix(in srgb, var(--dswsw-danger) 10%, var(--dswsw-surface));--dswsw-danger-text:color-mix(in srgb, var(--dswsw-danger) 55%, var(--dswsw-fg));--dswsw-scrim:#0f111557;--dswsw-shadow:0 24px 64px #0f111533}}.hr4_CG_action{border:1px solid var(--dswsw-border);background:var(--dswsw-surface);color:var(--dswsw-fg);cursor:pointer;white-space:nowrap;border-radius:6px;align-items:center;gap:5px;padding:4px 10px;font-family:inherit;font-size:12px;display:inline-flex}.hr4_CG_action:hover{background:var(--dswsw-surface-3);border-color:var(--dswsw-border-strong)}.hr4_CG_action svg{flex:none}.hr4_CG_panel{z-index:1000;background:var(--dswsw-scrim);font-family:var(--font-sans,ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"PingFang SC\", \"Microsoft YaHei\", sans-serif);justify-content:center;align-items:center;padding:24px;display:flex;position:fixed;inset:0}.hr4_CG_panel button,.hr4_CG_panel input,.hr4_CG_panel select{font-family:inherit}.hr4_CG_panel :focus-visible{outline:2px solid var(--dswsw-accent);outline-offset:1px}.hr4_CG_card{border:1px solid var(--dswsw-border);background:var(--dswsw-surface);width:560px;max-width:92vw;max-height:86vh;color:var(--dswsw-fg);box-shadow:var(--dswsw-shadow);border-radius:12px;flex-direction:column;gap:10px;padding:16px;font-size:13px;display:flex;overflow:auto}.hr4_CG_header{justify-content:space-between;align-items:center;gap:10px;display:flex}.hr4_CG_title{font-size:14px;font-weight:600}.hr4_CG_error{color:var(--dswsw-danger-text);overflow-wrap:anywhere;font-size:12px;line-height:1.45}.hr4_CG_list{flex-direction:column;gap:6px;max-height:240px;display:flex;overflow:auto}.hr4_CG_loading,.hr4_CG_empty{color:var(--dswsw-fg-muted);font-size:12px}.hr4_CG_empty{line-height:1.55}.hr4_CG_row{border:1px solid var(--dswsw-border);background:var(--dswsw-surface-2);border-radius:7px;align-items:center;gap:8px;padding:6px 8px;display:flex}.hr4_CG_rowIcon{color:var(--dswsw-fg-muted);flex:none}.hr4_CG_itemLabel{text-overflow:ellipsis;white-space:nowrap;flex:none;max-width:180px;font-size:12px;font-weight:600;overflow:hidden}.hr4_CG_rowPath{text-overflow:ellipsis;white-space:nowrap;max-width:180px;color:var(--dswsw-fg-muted);flex:none;font-size:11px;overflow:hidden}.hr4_CG_row .hr4_CG_input{flex:auto;width:auto;min-width:0}.hr4_CG_renameButton{border:1px solid var(--dswsw-border);color:var(--dswsw-fg-muted);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;flex:none;padding:3px 8px;font-size:11.5px}.hr4_CG_renameButton:hover{background:var(--dswsw-surface-3);border-color:var(--dswsw-border-strong);color:var(--dswsw-fg)}.hr4_CG_form{border-top:1px solid var(--dswsw-line);flex-direction:column;gap:8px;padding-top:10px;display:flex}.hr4_CG_segment{border:1px solid var(--dswsw-line);background:var(--dswsw-surface-inset);border-radius:9px;gap:3px;width:fit-content;padding:3px;display:inline-flex}.hr4_CG_segmentButton{color:var(--dswsw-fg-muted);cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:center;gap:6px;padding:4px 14px;font-size:12.5px;font-weight:500;display:inline-flex}.hr4_CG_segmentButton:hover:not(.hr4_CG_segmentButtonOn):not(:disabled){color:var(--dswsw-fg)}.hr4_CG_segmentButtonOn{background:var(--dswsw-surface-3);color:var(--dswsw-fg);box-shadow:inset 0 0 0 1px var(--dswsw-border-strong)}.hr4_CG_segmentButton:disabled{opacity:.55;cursor:default}.hr4_CG_fieldRow{gap:8px;display:flex}.hr4_CG_fieldRow .hr4_CG_input{flex:auto;width:auto;min-width:0}.hr4_CG_section{flex-direction:column;gap:8px;display:flex}.hr4_CG_divided{border-top:1px solid var(--dswsw-line);padding-top:10px}.hr4_CG_sectionTitle{letter-spacing:.02em;color:var(--dswsw-fg-muted);font-size:12px;font-weight:600}.hr4_CG_hint{color:var(--dswsw-fg-subtle);font-size:11.5px;line-height:1.5}.hr4_CG_mainRow{border:1px dashed var(--dswsw-border);background:var(--dswsw-surface-inset);border-radius:7px;align-items:center;gap:8px;padding:6px 8px;display:flex}.hr4_CG_mainRow .hr4_CG_itemLabel{max-width:140px}.hr4_CG_mainPath{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dswsw-fg-muted);flex:auto;margin-left:auto;font-size:11px;overflow:hidden}.hr4_CG_rowHost{text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:150px;color:var(--dswsw-fg-subtle);flex:0 auto;font-size:11px;overflow:hidden}.hr4_CG_spacer{flex:auto}.hr4_CG_toggle{border:1px solid var(--dswsw-border);color:var(--dswsw-fg-muted);cursor:pointer;white-space:nowrap;background:0 0;border-radius:999px;flex:none;padding:3px 12px;font-size:11.5px;font-weight:500;line-height:1.5}.hr4_CG_toggle:hover:not(:disabled){background:var(--dswsw-surface-3);border-color:var(--dswsw-border-strong);color:var(--dswsw-fg)}.hr4_CG_toggleOn{border-color:var(--dswsw-accent);background:var(--dswsw-accent-soft);color:var(--dswsw-fg)}.hr4_CG_toggleOn:hover:not(:disabled){border-color:var(--dswsw-accent);background:color-mix(in srgb, var(--dswsw-accent) 22%, var(--dswsw-surface))}.hr4_CG_toggle:disabled{opacity:.5;cursor:default}.hr4_CG_badge{border:1px dashed var(--dswsw-border-strong);color:var(--dswsw-fg-subtle);white-space:nowrap;border-radius:999px;flex:none;padding:2px 9px;font-size:11px}.hr4_CG_input{box-sizing:border-box;border:1px solid var(--dswsw-border);background:var(--dswsw-surface-inset);width:100%;color:var(--dswsw-fg);border-radius:7px;outline:none;padding:6px 9px;font-size:12.5px}.hr4_CG_input::placeholder{color:var(--dswsw-fg-subtle)}.hr4_CG_input:focus{border-color:var(--dswsw-accent);box-shadow:0 0 0 3px var(--dswsw-accent-soft)}.hr4_CG_select{border:1px solid var(--dswsw-border);background:var(--dswsw-surface-inset);min-width:72px;color:var(--dswsw-fg);border-radius:6px;outline:none;flex:none;padding:5px 6px;font-size:12px}.hr4_CG_select:focus{border-color:var(--dswsw-accent);box-shadow:0 0 0 3px var(--dswsw-accent-soft)}.hr4_CG_selectWide{width:100%}.hr4_CG_button{border:1px solid var(--dswsw-border);color:var(--dswsw-fg);cursor:pointer;white-space:nowrap;background:0 0;border-radius:7px;flex:none;justify-content:center;align-items:center;gap:6px;padding:5px 13px;font-size:12.5px;font-weight:500;line-height:1.4;display:inline-flex}.hr4_CG_button svg{flex:none}.hr4_CG_button:hover:not(:disabled){background:var(--dswsw-surface-3);border-color:var(--dswsw-border-strong)}.hr4_CG_primary{background:var(--dswsw-accent);border-color:var(--dswsw-accent);color:var(--dswsw-accent-fg)}.hr4_CG_primary:hover:not(:disabled){background:color-mix(in srgb, var(--dswsw-accent) 85%, #fff);border-color:color-mix(in srgb, var(--dswsw-accent) 85%, #fff)}.hr4_CG_button:disabled{opacity:.5;cursor:default}.hr4_CG_iconButton{width:28px;height:28px;color:var(--dswsw-fg-muted);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;justify-content:center;align-items:center;display:inline-flex}.hr4_CG_iconButton:hover:not(:disabled){background:var(--dswsw-surface-3);color:var(--dswsw-fg)}.hr4_CG_iconButton.hr4_CG_danger{color:var(--dswsw-danger-text)}.hr4_CG_iconButton.hr4_CG_danger:hover{background:var(--dswsw-danger-soft);color:var(--dswsw-danger-text)}.hr4_CG_iconButton:disabled{opacity:.45;cursor:default}@media (width<=640px){.hr4_CG_panel{padding:12px}.hr4_CG_card{max-height:calc(100vh - 24px)}}";
		const tagId = "dsh-workspace-enhancement/side-workspaces.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-workspace-enhancement";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var side_workspaces_module_css_default = {
			"button": "hr4_CG_button",
			"action": "hr4_CG_action",
			"divided": "hr4_CG_divided",
			"select": "hr4_CG_select",
			"mainPath": "hr4_CG_mainPath",
			"rowHost": "hr4_CG_rowHost",
			"toggle": "hr4_CG_toggle",
			"title": "hr4_CG_title",
			"error": "hr4_CG_error",
			"mainRow": "hr4_CG_mainRow",
			"form": "hr4_CG_form",
			"selectWide": "hr4_CG_selectWide",
			"spacer": "hr4_CG_spacer",
			"renameButton": "hr4_CG_renameButton",
			"rowPath": "hr4_CG_rowPath",
			"section": "hr4_CG_section",
			"loading": "hr4_CG_loading",
			"card": "hr4_CG_card",
			"segmentButtonOn": "hr4_CG_segmentButtonOn",
			"segment": "hr4_CG_segment",
			"row": "hr4_CG_row",
			"segmentButton": "hr4_CG_segmentButton",
			"hint": "hr4_CG_hint",
			"list": "hr4_CG_list",
			"header": "hr4_CG_header",
			"fieldRow": "hr4_CG_fieldRow",
			"sectionTitle": "hr4_CG_sectionTitle",
			"toggleOn": "hr4_CG_toggleOn",
			"danger": "hr4_CG_danger",
			"itemLabel": "hr4_CG_itemLabel",
			"panel": "hr4_CG_panel",
			"input": "hr4_CG_input",
			"iconButton": "hr4_CG_iconButton",
			"empty": "hr4_CG_empty",
			"primary": "hr4_CG_primary",
			"badge": "hr4_CG_badge",
			"rowIcon": "hr4_CG_rowIcon"
		};
		//#endregion
		//#region lib/client/side-workspaces.js
		/**
		* R5 → REQ-I7 → REQ-I11: the session header action「⊕ 工作区」and its panel — now
		* the session workspace COCKPIT (ADR-0021 §2.9), three visibly separated
		* sections:
		*
		*   1. 主工作区 — read-only: the registry machine + remote path this session's cwd
		*      routes to, or the local-session copy;
		*   2. 副工作区 — the side-root declaration list and its mount/unmount/rename
		*      behaviour, unchanged (add/edit/remove over the `session.ws.*` endpoints);
		*   3. 已连接的机器 — one toggle per registry machine, reflecting
		*      `session.conn.list` and writing `session.conn.connect` /
		*      `session.conn.disconnect` — the SAME store `sw_connect` writes, re-read
		*      after every mutation so the panel and the model cannot disagree
		*      (ADR-0021 §0/§2.9).
		*
		* Every judgment (which rows exist, where the session works, which toggle is on,
		* how an unknown machine id is handled) lives in `./cockpit.ts`, pure and
		* sandbox-testable; this file only renders it and drives the wire. The picker
		* reuses the shared add-workspace directory flow (`SshWorkspaceFlow`) in
		* `pickOnly` mode, so local and remote browsing go through the very same modal
		* the main add-workspace flow uses.
		*
		* Registered into `conversation.session.header.actions` (official additive list
		* slot; the framework passes `sessionId` as a standard prop, `index.ts` injects
		* the directory seats and the session-feed seats the main-workspace section
		* reads — the same `remoteFacts`/`subscribeRemote` pair the remote-status header
		* cell consumes).
		* @module dsh-workspace-enhancement/client/side-workspaces
		*/
		function unwrap(result, t) {
			if (result.ok) return result.value;
			throw new Error(result.error?.message ?? t("side.rpc.failed"));
		}
		/**
		* The flow delivers a remote pick either as its raw `ssh://<id><posixPath>`
		* spelling (pickOnly / suppressSessionRoute) or as the local placeholder that
		* stands in for a remote route (`<DSH_HOME>/dsw-routes/<id>/<path>`, or the
		* legacy `dsh-ssh-routes` spelling). Detect both; the host normalizes either
		* into the same registry-backed root key.
		*/
		const isRemoteSpelling = (path) => /^ssh:\/\//.test(path) || /[\\/](dsw-routes|dsh-ssh-routes)[\\/]/.test(path);
		/**
		* Follow the session's recorded cwd across feed changes (the main-workspace
		* section's only input). The seat functions are stable across renders (apply
		* builds them once); a seat-less renderer degrades to "local session" rather
		* than throwing inside the panel's render.
		*/
		function useSessionCwd(props) {
			const { sessionId, remoteFacts, subscribeRemote } = props;
			const [cwd, setCwd] = (0, react.useState)(() => remoteFacts?.(sessionId)?.cwd);
			(0, react.useEffect)(() => {
				if (remoteFacts === void 0) {
					setCwd(void 0);
					return;
				}
				const sync = () => {
					const next = remoteFacts(sessionId)?.cwd;
					setCwd((previous) => previous === next ? previous : next);
				};
				sync();
				return subscribeRemote?.(sync);
			}, [
				sessionId,
				remoteFacts,
				subscribeRemote
			]);
			return cwd;
		}
		/** The trigger: one per-session button in the header action row. */
		function SideWorkspacesAction(props) {
			const t = props.t ?? zhBaseline;
			const [open, setOpen] = (0, react.useState)(false);
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: side_workspaces_module_css_default.action,
				onClick: () => setOpen((value) => !value),
				title: t("side.headerAction.title"),
				children: [(0, react_jsx_runtime.jsx)(PlusIcon, {
					width: 13,
					height: 13
				}), t("side.headerAction.label")]
			}), open ? (0, react_jsx_runtime.jsx)(SideWorkspacesPanel, {
				...props,
				t,
				injected: props,
				onClose: () => setOpen(false)
			}) : null] });
		}
		/** The per-session workspace cockpit: main workspace + side roots + connections. */
		function SideWorkspacesPanel(props) {
			const { sessionId, injected, onClose, t: tSeat } = props;
			const t = tSeat ?? zhBaseline;
			const [items, setItems] = (0, react.useState)([]);
			const [machines, setMachines] = (0, react.useState)([]);
			const [connected, setConnected] = (0, react.useState)([]);
			const [busy, setBusy] = (0, react.useState)(true);
			const [toggling, setToggling] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const [draftKind, setDraftKind] = (0, react.useState)("local");
			const [draftPath, setDraftPath] = (0, react.useState)("");
			const [draftMachine, setDraftMachine] = (0, react.useState)("");
			const [draftLabel, setDraftLabel] = (0, react.useState)("");
			const [browseOpen, setBrowseOpen] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)("");
			const [editingLabel, setEditingLabel] = (0, react.useState)("");
			const cardRef = (0, react.useRef)(null);
			const view = cockpitViewOf(useSessionCwd(props), machines, connected);
			/**
			* Re-read every feed the cockpit renders: the side declarations, the machine
			* universe, and the connected set. The connected set comes from the RPC on
			* every pass — the panel owns no copy it could drift from (ADR-0021 §0).
			* @param keepError - keep the current banner (a re-read that follows a FAILED
			*   mutation must not wipe the message that explains why).
			*/
			const refresh = (keepError = false) => {
				setBusy(true);
				if (!keepError) setError("");
				Promise.all([
					injected.rpc("session.ws.list", { sessionId }),
					injected.rpc("machines.list", {}),
					injected.rpc("session.conn.list", { sessionId })
				]).then(([listResult, machinesResult, connResult]) => {
					setItems(asSideRows(unwrap(listResult, t)));
					const rows = asMachineRows(unwrap(machinesResult, t));
					setMachines(rows);
					setConnected(asConnectedIds(unwrap(connResult, t)));
					setDraftMachine((current) => current !== "" ? current : rows[0]?.id ?? "");
					setBusy(false);
				}).catch((reason) => {
					setError(reason instanceof Error ? reason.message : String(reason));
					setBusy(false);
				});
			};
			(0, react.useEffect)(() => {
				refresh();
			}, [sessionId]);
			/**
			* One「已连接的机器」toggle. The endpoint answers with the new set, but the panel
			* still re-reads: a failure clears the in-flight marker and re-reads too, so
			* the UI ends up consistent with the next `session.conn.list` instead of
			* optimistically wrong (ADR-0021 §2.9). The implicit main machine has no
			* toggle at all (`toggleRequest` returns undefined for it): its connection
			* comes from the session's own cwd and cannot be removed from here.
			*/
			const toggleConnection = (row) => {
				const request = toggleRequest(sessionId, row);
				if (request === void 0) return;
				setToggling(row.id);
				setError("");
				injected.rpc(request.endpoint, request.payload).then((result) => {
					setConnected(asConnectedIds(unwrap(result, t)));
					setToggling("");
					refresh();
				}).catch((reason) => {
					setError(reason instanceof Error ? reason.message : String(reason));
					setToggling("");
					refresh(true);
				});
			};
			const draftPathSpelling = () => {
				const path = draftPath.trim();
				if (path === "") return "";
				return draftKind === "remote" ? `ssh://${draftMachine}${path}` : path;
			};
			/**
			* A pick from the shared flow: fill the draft back into the form. The flow
			* runs in pickOnly mode, so a remote pick arrives as the raw
			* `ssh://<id>/<posix>` spelling and a local pick as an absolute path;
			* mounting only goes through the「挂载」button — no `session.ws.add` here.
			*/
			const handlePicked = (path) => {
				setError("");
				if (/^ssh:\/\//.test(path)) {
					const segments = path.slice(6).split("/");
					const id = segments.shift() ?? "";
					setDraftKind("remote");
					setDraftMachine(id);
					setDraftPath(`/${segments.join("/")}`);
				} else if (isRemoteSpelling(path)) {
					const match = /[\\/](dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)(?:[\\/](.*))?$/.exec(path);
					if (match === null) {
						setError(t("side.error.unresolvedPath"));
						setBrowseOpen(false);
						return;
					}
					const rest = (match[3] ?? "").split(/[\\/]+/).filter((segment) => segment !== "").join("/");
					setDraftKind("remote");
					setDraftMachine(match[2] ?? "");
					setDraftPath(rest === "" ? "/" : `/${rest}`);
				} else {
					setDraftKind("local");
					setDraftPath(path);
				}
				setBrowseOpen(false);
			};
			const addSide = () => {
				const path = draftPathSpelling();
				if (draftKind === "remote" && draftMachine === "") {
					setError(t("side.error.noMachine"));
					return;
				}
				if (path === "") {
					setError(draftKind === "remote" ? t("side.error.path.remote") : t("side.error.path.local"));
					return;
				}
				setBusy(true);
				setError("");
				injected.rpc("session.ws.add", {
					sessionId,
					id: `sw-${Date.now().toString(36)}`,
					kind: draftKind,
					path,
					...draftLabel.trim() !== "" ? { label: draftLabel.trim() } : {}
				}).then(() => {
					setDraftPath("");
					setDraftLabel("");
					setBusy(false);
					refresh();
				}).catch((reason) => {
					setError(reason instanceof Error ? reason.message : String(reason));
					setBusy(false);
				});
			};
			const updateLabel = (rootKey, label) => {
				if (label.trim() === "") {
					setEditing("");
					return;
				}
				injected.rpc("session.ws.update", {
					rootKey,
					label: label.trim()
				}).then(() => {
					setEditing("");
					refresh();
				}).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
			};
			const removeSide = (rootKey) => {
				injected.rpc("session.ws.remove", {
					sessionId,
					rootKey
				}).then(() => refresh()).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: side_workspaces_module_css_default.panel,
				onClick: (event) => {
					if (event.target === event.currentTarget) onClose();
				},
				children: [(0, react_jsx_runtime.jsxs)("div", {
					ref: cardRef,
					className: side_workspaces_module_css_default.card,
					role: "dialog",
					"aria-label": t("side.card.label"),
					onKeyDown: (event) => {
						if (event.key === "Escape") onClose();
					},
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: side_workspaces_module_css_default.header,
							children: [(0, react_jsx_runtime.jsx)("strong", {
								className: side_workspaces_module_css_default.title,
								children: t("side.card.title")
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: side_workspaces_module_css_default.iconButton,
								onClick: onClose,
								"aria-label": t("side.close.label"),
								children: (0, react_jsx_runtime.jsx)(CloseIcon, {
									width: 14,
									height: 14
								})
							})]
						}),
						error !== "" ? (0, react_jsx_runtime.jsx)("div", {
							className: side_workspaces_module_css_default.error,
							children: error
						}) : null,
						(0, react_jsx_runtime.jsxs)("div", {
							className: side_workspaces_module_css_default.section,
							children: [(0, react_jsx_runtime.jsx)("div", {
								className: side_workspaces_module_css_default.sectionTitle,
								children: t("side.main.heading")
							}), view.main.kind === "remote" ? (0, react_jsx_runtime.jsxs)("div", {
								className: side_workspaces_module_css_default.mainRow,
								children: [
									(0, react_jsx_runtime.jsx)(ServerIcon, {
										className: side_workspaces_module_css_default.rowIcon,
										width: 13,
										height: 13
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: side_workspaces_module_css_default.itemLabel,
										children: view.main.label
									}),
									machineEndpointOf(view.main) !== "" ? (0, react_jsx_runtime.jsx)("span", {
										className: side_workspaces_module_css_default.rowHost,
										children: machineEndpointOf(view.main)
									}) : null,
									(0, react_jsx_runtime.jsx)("span", {
										className: side_workspaces_module_css_default.mainPath,
										title: view.main.path,
										children: view.main.path
									})
								]
							}) : (0, react_jsx_runtime.jsx)("div", {
								className: side_workspaces_module_css_default.empty,
								children: t("side.main.none")
							})]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: `${side_workspaces_module_css_default.section} ${side_workspaces_module_css_default.divided}`,
							children: [
								(0, react_jsx_runtime.jsx)("div", {
									className: side_workspaces_module_css_default.sectionTitle,
									children: t("side.roots.heading")
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: side_workspaces_module_css_default.list,
									children: [
										busy && items.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
											className: side_workspaces_module_css_default.loading,
											children: t("side.loading")
										}) : null,
										items.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
											className: side_workspaces_module_css_default.empty,
											children: t("side.empty")
										}) : null,
										items.map((item) => (0, react_jsx_runtime.jsxs)("div", {
											className: side_workspaces_module_css_default.row,
											children: [
												item.kind === "remote" ? (0, react_jsx_runtime.jsx)(ServerIcon, {
													className: side_workspaces_module_css_default.rowIcon,
													width: 13,
													height: 13
												}) : (0, react_jsx_runtime.jsx)(FolderIcon, {
													className: side_workspaces_module_css_default.rowIcon,
													width: 13,
													height: 13
												}),
												editing === item.rootKey ? (0, react_jsx_runtime.jsx)("input", {
													className: side_workspaces_module_css_default.input,
													value: editingLabel,
													onChange: (event) => setEditingLabel(event.target.value),
													onKeyDown: (event) => {
														if (event.key === "Enter") updateLabel(item.rootKey, editingLabel);
													}
												}) : (0, react_jsx_runtime.jsx)("span", {
													className: side_workspaces_module_css_default.itemLabel,
													children: item.label
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: side_workspaces_module_css_default.rowPath,
													title: item.rootKey,
													children: item.rootKey
												}),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: side_workspaces_module_css_default.renameButton,
													title: t("side.rename.title"),
													onClick: () => {
														setEditing(item.rootKey);
														setEditingLabel(item.label);
													},
													children: t("side.rename.button")
												}),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: `${side_workspaces_module_css_default.iconButton} ${side_workspaces_module_css_default.danger}`,
													title: t("side.remove.title"),
													onClick: () => removeSide(item.rootKey),
													children: (0, react_jsx_runtime.jsx)(TrashIcon, {
														width: 13,
														height: 13
													})
												})
											]
										}, item.rootKey))
									]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: side_workspaces_module_css_default.form,
									children: [
										(0, react_jsx_runtime.jsxs)("div", {
											className: side_workspaces_module_css_default.segment,
											role: "group",
											"aria-label": t("side.kind.label"),
											children: [(0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: draftKind === "local" ? `${side_workspaces_module_css_default.segmentButton} ${side_workspaces_module_css_default.segmentButtonOn}` : side_workspaces_module_css_default.segmentButton,
												onClick: () => setDraftKind("local"),
												children: t("side.kind.local")
											}), (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: draftKind === "remote" ? `${side_workspaces_module_css_default.segmentButton} ${side_workspaces_module_css_default.segmentButtonOn}` : side_workspaces_module_css_default.segmentButton,
												onClick: () => setDraftKind("remote"),
												children: t("side.kind.remote")
											})]
										}),
										draftKind === "remote" ? (0, react_jsx_runtime.jsx)("select", {
											className: `${side_workspaces_module_css_default.select} ${side_workspaces_module_css_default.selectWide}`,
											value: draftMachine,
											onChange: (event) => setDraftMachine(event.target.value),
											"aria-label": t("side.machine.label"),
											children: machines.map((machine) => (0, react_jsx_runtime.jsx)("option", {
												value: machine.id,
												children: machine.label
											}, machine.id))
										}) : null,
										(0, react_jsx_runtime.jsxs)("div", {
											className: side_workspaces_module_css_default.fieldRow,
											children: [(0, react_jsx_runtime.jsx)("input", {
												className: side_workspaces_module_css_default.input,
												placeholder: draftKind === "remote" ? t("side.draft.path.remote") : t("side.draft.path.local"),
												value: draftPath,
												onChange: (event) => setDraftPath(event.target.value)
											}), (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: side_workspaces_module_css_default.button,
												onClick: () => setBrowseOpen(true),
												children: t("side.browse")
											})]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: side_workspaces_module_css_default.fieldRow,
											children: [(0, react_jsx_runtime.jsx)("input", {
												className: side_workspaces_module_css_default.input,
												placeholder: t("side.draft.labelPlaceholder"),
												value: draftLabel,
												onChange: (event) => setDraftLabel(event.target.value)
											}), (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: `${side_workspaces_module_css_default.button} ${side_workspaces_module_css_default.primary}`,
												disabled: busy,
												onClick: addSide,
												children: t("side.mount")
											})]
										})
									]
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: `${side_workspaces_module_css_default.section} ${side_workspaces_module_css_default.divided}`,
							children: [
								(0, react_jsx_runtime.jsx)("div", {
									className: side_workspaces_module_css_default.sectionTitle,
									children: t("side.conn.heading")
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: side_workspaces_module_css_default.hint,
									children: t("side.conn.hint")
								}),
								!busy && !view.anyConnected ? (0, react_jsx_runtime.jsx)("div", {
									className: side_workspaces_module_css_default.empty,
									children: t("side.conn.empty")
								}) : null,
								(0, react_jsx_runtime.jsx)("div", {
									className: side_workspaces_module_css_default.list,
									children: view.connections.map((row) => (0, react_jsx_runtime.jsxs)("div", {
										className: side_workspaces_module_css_default.row,
										children: [
											(0, react_jsx_runtime.jsx)(ServerIcon, {
												className: side_workspaces_module_css_default.rowIcon,
												width: 13,
												height: 13
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: side_workspaces_module_css_default.itemLabel,
												children: row.label
											}),
											machineEndpointOf(row) !== "" ? (0, react_jsx_runtime.jsx)("span", {
												className: side_workspaces_module_css_default.rowHost,
												children: machineEndpointOf(row)
											}) : null,
											(0, react_jsx_runtime.jsx)("span", { className: side_workspaces_module_css_default.spacer }),
											row.canToggle ? (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: row.connected ? `${side_workspaces_module_css_default.toggle} ${side_workspaces_module_css_default.toggleOn}` : side_workspaces_module_css_default.toggle,
												"aria-pressed": row.connected,
												disabled: busy || toggling !== "",
												onClick: () => {
													toggleConnection(row);
												},
												children: toggling === row.id ? t("side.conn.busy") : row.connected ? t("side.conn.disconnect") : t("side.conn.connect")
											}) : (0, react_jsx_runtime.jsx)("span", {
												className: side_workspaces_module_css_default.badge,
												children: t("side.main.heading")
											})
										]
									}, row.id))
								})
							]
						})
					]
				}), (0, react_jsx_runtime.jsx)(SshWorkspaceFlow, {
					open: browseOpen,
					busy,
					suppressSessionRoute: true,
					pickOnly: true,
					initialConnectionId: draftKind === "remote" ? draftMachine : "",
					onPicked: handlePicked,
					onCancel: () => setBrowseOpen(false),
					onError: (message) => setError(message),
					listLocalDirectory: injected.listLocalDirectory,
					createLocalDirectory: injected.createLocalDirectory,
					rpc: injected.rpc,
					t
				})]
			});
		}
		//#endregion
		//#region lib/client/index.js
		/**
		* Browser half of dsh-workspace-enhancement: the add-workspace directory flow —
		* a connection sidebar (saved connections, `~/.ssh/config` hosts, local entry)
		* beside the directory browser — plus the minimal machine-management settings
		* page (`settings.section`). Registered into both directory-flow holes and the
		* settings section, so mounting `dsh-workspace-enhancement` composes the whole
		* picking interaction. Cross-plane calls ride the shared web transport: local
		* listing through the client `uiWorkspace` service (the Host `directoryPicker`
		* browse capability — NOT the `workspaces` controller face, see BUG-3 and
		* `./local-directory.ts`) and remote listing/connection management through the
		* package's channel on the shared `/api` transport (`../web-channel.ts`).
		*
		* I18N: the `dsw` dictionary pair (src/locale/) is registered against the
		* framework LocaleRuntime at apply time (drafts/i18n-design.md §9) — the
		* `locale` service is a hard client dependency (inject), exactly like the
		* official client-ui packages; the settings page Language row owns switching.
		*/
		/**
		* Required client services: the slot registry, the wire-facing workspace
		* service, and the locale runtime (hard dependency — the `dsw` dictionary pair
		* registers against it; matching the official client-ui packages).
		*/
		const inject = [
			"slots",
			"workspaces",
			"sessions",
			"locale"
		];
		/**
		* Client plugin body: fill both directory-flow holes with the SSH workspace
		* flow, the settings section with the machine page, and install the sidebar
		* row badge layer (DOM compatibility). `slots.inject` waits for each hole's
		* declaration, and the generator installs the two registrations
		* transactionally.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			registerDswLocale(ctx);
			const t = ctx.locale.bind("dsw");
			const rpcError = () => ({
				ok: false,
				error: {
					code: "internal",
					message: t("rpc.transportUnavailable")
				}
			});
			const localSeats = createLocalDirectorySeats(() => ctx.get("uiWorkspace"), () => t("flow.error.directoryUnavailable"));
			const remoteSeats = createRemoteStatusSeats(() => {
				return ctx.get("sessions")?.list;
			});
			const injected = () => ({
				...localSeats,
				...remoteSeats,
				rpc: (endpoint, payload, signal) => {
					const connection = ctx.get("connection");
					if (connection === void 0) return Promise.resolve(rpcError());
					return connection.rpc.call(API_CHANNEL, channelEndpointOf(endpoint), payload ?? {}, signal);
				}
			});
			ctx.slots.inject("conversation.hero.workspace.directoryFlow", () => ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
				yield ctx.slots.register({
					name: "conversation.hero.workspace.directoryFlow",
					locale: "dsw",
					inject: injected
				}, SshWorkspaceFlow);
				yield ctx.slots.register({
					name: "sidebar.workspaces.directoryFlow",
					locale: "dsw",
					inject: injected
				}, SshWorkspaceFlow);
			}));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-workspace-enhancement",
				order: 40,
				label: () => t("settings.label"),
				locale: "dsw",
				inject: injected
			}, RemoteWorkspaceSettingsPage));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "dsh-workspace-enhancement-side",
				order: 25,
				label: () => t("side.headerAction.label"),
				locale: "dsw",
				inject: injected
			}, SideWorkspacesAction));
			ctx.slots.inject(REMOTE_STATUS_SLOT, () => ctx.slots.register({
				...remoteStatusRegisterOptions(t),
				inject: injected
			}, RemoteStatusAction));
			installSidebarRowBadges(ctx);
		}
		/**
		* Install the sidebar row badge layer (C3, DOM compatibility). Feeds project
		* from the runtime workspace/session stores; when a feed is absent (runtime
		* not yet up — the client runtime tier normally mounts before bundles),
		* grouped workspaces still mark and the flat mode degrades quietly.
		*/
		function installSidebarRowBadges(ctx) {
			const workspacesFeed = ctx.get("workspaces")?.list;
			const sessionsFeed = ctx.get("sessions")?.list;
			const dispose = installRowBadges((endpoint, payload, signal) => {
				const connection = ctx.get("connection");
				if (connection === void 0) return Promise.resolve({
					ok: false,
					error: {
						code: "internal",
						message: ctx.locale.bind("dsw")("rpc.transportUnavailable")
					}
				});
				return connection.rpc.call(API_CHANNEL, channelEndpointOf(endpoint), payload ?? {}, signal);
			}, {
				workspaces: () => workspacesFeed?.getSnapshot().items.map((item) => ({
					title: item.title,
					path: item.path
				})) ?? [],
				sessions: () => {
					const state = sessionsFeed?.getSnapshot();
					if (state === void 0) return [];
					return Object.values(state.byId).map((row) => ({
						title: row.displayTitle,
						...typeof row.cwd === "string" ? { cwd: row.cwd } : {}
					}));
				}
			}, (onChange) => {
				const un1 = workspacesFeed?.subscribe(onChange);
				const un2 = sessionsFeed?.subscribe(onChange);
				return () => {
					if (un1 !== void 0) un1();
					if (un2 !== void 0) un2();
				};
			}, ctx.locale);
			ctx.effect(() => dispose, "dsw: sidebar row badges");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map