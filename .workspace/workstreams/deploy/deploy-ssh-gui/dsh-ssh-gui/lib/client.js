window.__ModuleLoader__.load({
	id: "@local/dsh-ssh-gui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region @local/dsh-ssh-gui Web GUI —— 手写、零构建链 client bundle（照 @local/dsh-usage 先例）。
		// 「分布式控制」面板：统一节点抽象 node = { id, name, transport, target }，
		// transport ∈ ssh://（远端主机，走底座链路）/ serial://（本地 USB 串口）/
		// serial-tcp://（ser2net/socat TCP 串口服务器）。GUI 只做 连接管理/节点状态/
		// 命令执行（exec.run）/文件操作（file.get/put）/目录浏览——不内嵌交互终端。
		// 入口三个：settings.section 新条目（节点 CRUD + keyRef + serial/serial-tcp 表单 +
		// 目录/控制台树）、conversation.session.header.actions 新条目（「节点」按钮 →
		// 命令面板 / 文件树对话框，按节点类型适配）、sidebar.workspaces.remoteHosts
		// sidecar list 槽（「分布式节点」文件夹树，槽由官方 ui-workspace 补丁声明，
		// 见 .workspace/deploy-slots/）。数据走两个 loopback 通道：
		//   /dsw（底座已有点位：machines.* / conn.* / session.route / hostkey.forget）
		//   /ssh-gui（本插件通道：nodes.* / node.status / keyref.* / exec.run / file.* /
		//     serial.open/send/read/close/ports / config.get）。
		//#endregion
		//#region styles（data-plugin style + --dsw-* tokens，官方 idiom）
		const css = ".sg_root{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}"
			+ ".sg_head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sg_title{font-size:15px;font-weight:600}.sg_sub{color:var(--dsw-alias-label-caption);font-size:11px}"
			+ ".sg_toolbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.sg_btn{color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-border-inverted);border-radius:8px;padding:2px 10px;font:inherit;font-size:12px}"
			+ ".sg_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.sg_btn:disabled{opacity:.4;cursor:default}.sg_btnPrimary{background:var(--dsw-state-business-primary);border-color:transparent;color:#fff}"
			+ ".sg_btnDanger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-border-l2)}"
			+ ".sg_input{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:3px 8px;font:inherit;font-size:12px}"
			+ ".sg_select{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:2px 6px;font:inherit;font-size:12px}"
			+ ".sg_textarea{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;font:inherit;font-size:12px;font-family:var(--ds-font-family-code,monospace)}"
			+ ".sg_error{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px;word-break:break-all}"
			+ ".sg_msg{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary));font-size:12px}"
			+ ".sg_panel{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}"
			+ ".sg_panelTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}"
			+ ".sg_table{width:100%;border-collapse:collapse;font-size:12px}.sg_table th{color:var(--dsw-alias-label-caption);text-align:left;font-weight:500;padding:3px 6px;border-bottom:1px solid var(--dsw-alias-border-l2)}"
			+ ".sg_table td{padding:3px 6px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:middle}"
			+ ".sg_badge{display:inline-block;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 8px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary)}"
			+ ".sg_tree{display:flex;flex-direction:column;gap:2px;font-size:12px}.sg_treeRow{display:flex;align-items:center;gap:6px;padding:2px 4px;border-radius:6px;cursor:pointer}"
			+ ".sg_treeRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.sg_treeRowActive{background:var(--dsw-alias-interactive-bg-hover)}"
			+ ".sg_treeFolder{color:var(--dsw-alias-label-secondary)}.sg_treeName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
			+ ".sg_treeMeta{color:var(--dsw-alias-label-caption);font-size:11px;white-space:nowrap}.sg_crumbs{display:flex;gap:4px;align-items:center;flex-wrap:wrap;color:var(--dsw-alias-label-caption);font-size:12px;word-break:break-all}"
			+ ".sg_crumb{cursor:pointer;color:var(--dsw-alias-label-secondary)}.sg_crumb:hover{text-decoration:underline}.sg_output{box-sizing:border-box;width:100%;max-height:320px;overflow:auto;background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary)}"
			+ ".sg_overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px 16px;z-index:200}"
			+ ".sg_dialog{box-sizing:border-box;width:min(760px,100%);max-height:80vh;overflow:auto;background:var(--dsw-alias-surface-bg,var(--dsw-alias-bg-primary,#1e1e1e));border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}"
			+ ".sg_tabs{display:flex;gap:6px}.sg_tab{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:3px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);background:transparent}"
			+ ".sg_tabActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-inverted)}"
			+ ".sg_form{display:flex;flex-direction:column;gap:8px}.sg_formRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sg_formLabel{min-width:72px;color:var(--dsw-alias-label-secondary);font-size:12px}"
			+ ".sg_note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}.sg_dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}"
			+ ".sg_dotUnknown{background:var(--dsw-alias-label-tertiary)}.sg_dotActive{background:var(--dsw-state-success-primary,#3fb950)}.sg_dotOffline{background:var(--dsw-alias-state-error-primary)}"
			+ ".sg_sidebar{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:8px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);border-top:1px solid var(--dsw-alias-border-l2);max-height:min(300px,36vh);overflow-y:auto}";
		const tagId = "@local/dsh-ssh-gui/ssh-gui.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@local/dsh-ssh-gui";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region helpers
		const h = react.createElement;
		const CH_DWS = "/dsw";
		const CH_SSH = "/ssh-gui";
		const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		function unwrap(result, fallback) {
			if (!result || !result.ok) throw new Error((result && result.error && result.error.message) || fallback || "rpc failed");
			return result.value;
		}
		function fmtBytes(n) {
			const v = Number(n || 0);
			if (v >= 1048576) return (v / 1048576).toFixed(1) + " MB";
			if (v >= 1024) return (v / 1024).toFixed(1) + " KB";
			return v + " B";
		}
		/** 节点视图扁平化（nodes.list 记录 → GUI 节点对象）。 */
		function asNode(record) {
			if (!isRecord(record)) return null;
			if (typeof record.id !== "string" || record.id === "" || typeof record.transport !== "string") return null;
			const target = isRecord(record.target) ? record.target : {};
			const node = {
				id: record.id,
				name: typeof record.name === "string" && record.name !== "" ? record.name : record.id,
				transport: record.transport,
			};
			if (record.transport === "ssh://") {
				node.host = typeof target.host === "string" ? target.host : "";
				node.port = typeof target.port === "number" ? target.port : 22;
				node.username = typeof target.username === "string" ? target.username : "";
				node.keyRef = typeof target.keyRef === "string" ? target.keyRef : "";
				node.workspace = typeof target.workspace === "string" ? target.workspace : "";
				node.agent = typeof target.agent === "string" ? target.agent : "";
			}
			else if (record.transport === "serial://") {
				node.port = typeof target.port === "string" ? target.port : "";
				node.baudRate = typeof target.baudRate === "number" ? target.baudRate : 115200;
				node.backend = typeof target.backend === "string" ? target.backend : "stty";
			}
			else {
				node.host = typeof target.host === "string" ? target.host : "";
				node.port = typeof target.port === "number" ? target.port : 0;
				node.tty = typeof target.tty === "string" ? target.tty : "";
			}
			return node;
		}
		function isSshNode(node) { return !!node && node.transport === "ssh://"; }
		function isConsoleNode(node) { return !!node && (node.transport === "serial://" || node.transport === "serial-tcp://"); }
		function transportLabel(transport) {
			if (transport === "ssh://") return "SSH";
			if (transport === "serial://") return "串口";
			if (transport === "serial-tcp://") return "TCP串口";
			return String(transport || "");
		}
		function nodeIcon(transport) {
			if (transport === "ssh://") return "🖥";
			if (transport === "serial://") return "🔌";
			return "🌐";
		}
		function nodeMeta(node) {
			if (!node) return "";
			if (node.transport === "ssh://") return node.username + "@" + node.host + ":" + node.port;
			if (node.transport === "serial://") return node.port + " @ " + node.baudRate;
			return node.host + ":" + node.port + (node.tty ? " (" + node.tty + ")" : "");
		}
		function asBinding(record) {
			if (!isRecord(record)) return null;
			if (typeof record.machineId !== "string" || typeof record.refName !== "string") return null;
			return { machineId: record.machineId, refName: record.refName, configured: record.configured === true };
		}
		function asListing(value) {
			const record = isRecord(value) ? value : {};
			const entries = Array.isArray(record.entries) ? record.entries.filter(isRecord).map((e) => ({
				name: String(e.name ?? ""),
				path: String(e.path ?? ""),
				isDir: e.isDir === true,
				size: typeof e.size === "number" ? e.size : 0,
				hidden: e.hidden === true,
			})).filter((e) => e.name !== "") : [];
			return {
				path: typeof record.path === "string" ? record.path : "",
				home: typeof record.home === "string" ? record.home : "",
				entries,
				truncated: record.truncated === true,
			};
		}
		//#endregion
		//#region StatusDot —— ssh 三态徽章（unknown/active/offline），点击触发 conn.probe
		function StatusDot(props) {
			const { rpc, id, state } = props;
			const [current, setCurrent] = react.useState(state);
			react.useEffect(() => { setCurrent(state); }, [state]);
			const onClick = async (event) => {
				event.stopPropagation();
				try {
					const value = unwrap(await rpc(CH_DWS, "conn.probe", { id }), "probe failed");
					if (value && typeof value.state === "string") setCurrent(value.state);
				} catch { /* best-effort */ }
			};
			const cls = current === "active" ? "sg_dotActive" : current === "offline" ? "sg_dotOffline" : "sg_dotUnknown";
			const label = current === "active" ? "已连接" : current === "offline" ? "离线" : "未知";
			return h("span", { title: "状态（点击探测）", onClick, style: { cursor: "pointer", whiteSpace: "nowrap" } },
				h("span", { className: "sg_dot " + cls }), label);
		}
		//#endregion
		//#region ConsoleStatusDot —— serial/serial-tcp 会话状态（closed/open/error），点击刷新 node.status
		function ConsoleStatusDot(props) {
			const { rpc, node } = props;
			const [state, setState] = react.useState("unknown");
			const refresh = () => {
				rpc(CH_SSH, "node.status", { id: node.id })
					.then((value) => {
						const v = unwrap(value, "node.status failed");
						setState(typeof v.state === "string" ? v.state : "unknown");
					})
					.catch(() => { /* best-effort */ });
			};
			react.useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [node.id]);
			const onClick = (event) => {
				event.stopPropagation();
				refresh();
			};
			const cls = state === "open" ? "sg_dotActive" : state === "error" ? "sg_dotOffline" : "sg_dotUnknown";
			const label = state === "open" ? "会话开" : state === "error" ? "错误" : "关闭";
			return h("span", { title: "会话状态（点击刷新）", onClick, style: { cursor: "pointer", whiteSpace: "nowrap" } },
				h("span", { className: "sg_dot " + cls }), label);
		}
		//#endregion
		//#region RemoteBrowser —— ssh 节点目录树（「打开为工作区」复用 /dsw session.route + workspaces.create）
		function RemoteBrowser(props) {
			const { rpc, workspaces, sessions, machineId, allowFiles, onMessage } = props;
			const [listing, setListing] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState("");
			const [opening, setOpening] = react.useState(false);
			const generation = react.useRef(0);
			const load = async (path, signal) => {
				const current = (generation.current += 1);
				const controller = signal || new AbortController();
				setLoading(true);
				setError("");
				try {
					const value = unwrap(await rpc(CH_SSH, "file.list", { id: machineId, ...(path !== undefined ? { path } : {}) }, controller.signal), "browse failed");
					if (current !== generation.current || controller.signal.aborted) return;
					setListing(asListing(value));
				} catch (cause) {
					if (current !== generation.current || controller.signal.aborted) return;
					setError(cause instanceof Error ? cause.message : String(cause));
					setListing(null);
				} finally {
					if (current === generation.current) setLoading(false);
				}
			};
			react.useEffect(() => {
				if (!machineId) { setListing(null); return; }
				generation.current += 1;
				const controller = new AbortController();
				void load(undefined, controller);
				return () => { generation.current += 1; controller.abort(); };
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [machineId]);
			const openAsWorkspace = async () => {
				if (!listing || !listing.path || opening) return;
				setOpening(true);
				try {
					const routed = unwrap(await rpc(CH_DWS, "session.route", { id: machineId, path: listing.path }), "session.route failed");
					const cwd = isRecord(routed) && typeof routed.cwd === "string" ? routed.cwd : "";
					if (cwd === "") throw new Error("session.route returned an empty cwd");
					const workspace = await workspaces.create({ path: cwd });
					const sessionId = await workspaces.connectWorkspace(workspace.workspaceId);
					await sessions.open(sessionId);
					if (onMessage) onMessage("已打开远程工作区：" + listing.path);
				} catch (cause) {
					if (onMessage) onMessage("打开失败：" + (cause instanceof Error ? cause.message : String(cause)));
				} finally {
					setOpening(false);
				}
			};
			const upload = async (file) => {
				if (!listing || !file) return;
				const reader = new FileReader();
				reader.onload = async () => {
					const dataUrl = String(reader.result || "");
					const comma = dataUrl.indexOf(",");
					const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
					if (!base64) { if (onMessage) onMessage("读取文件失败"); return; }
					try {
						const target = (listing.path.endsWith("/") ? listing.path : listing.path + "/") + file.name;
						const value = unwrap(await rpc(CH_SSH, "file.put", { id: machineId, remotePath: target, base64 }), "upload failed");
						if (onMessage) onMessage("已上传 " + file.name + "（" + fmtBytes(value && value.size) + "）");
						void load(listing.path);
					} catch (cause) {
						if (onMessage) onMessage("上传失败：" + (cause instanceof Error ? cause.message : String(cause)));
					}
				};
				reader.onerror = () => { if (onMessage) onMessage("读取文件失败"); };
				reader.readAsDataURL(file);
			};
			const download = async (entry) => {
				try {
					const value = unwrap(await rpc(CH_SSH, "file.get", { id: machineId, remotePath: entry.path }), "download failed");
					const binary = atob(value.base64);
					const bytes = new Uint8Array(binary.length);
					for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
					const blob = new Blob([bytes], { type: "application/octet-stream" });
					const url = URL.createObjectURL(blob);
					const anchor = document.createElement("a");
					anchor.href = url;
					anchor.download = value.name || entry.name;
					document.body.appendChild(anchor);
					anchor.click();
					document.body.removeChild(anchor);
					setTimeout(() => URL.revokeObjectURL(url), 4000);
					if (onMessage) onMessage("已下载 " + entry.name);
				} catch (cause) {
					if (onMessage) onMessage("下载失败：" + (cause instanceof Error ? cause.message : String(cause)));
				}
			};
			if (!machineId) return h("div", { className: "sg_note" }, "请先在「节点管理」中添加 SSH 节点");
			const crumbs = (listing ? listing.path.split("/").filter(Boolean) : []);
			const visible = (listing ? listing.entries : []).filter((e) => allowFiles || e.isDir);
			return h("div", { className: "sg_panel" },
				h("div", { className: "sg_panelTitle" }, "目录浏览（SSH）"),
				h("div", { className: "sg_crumbs" },
					h("span", { className: "sg_crumb", onClick: () => void load(undefined) }, "⌂"),
					crumbNav(crumbs, listing, load)),
				loading && !listing ? h("div", { className: "sg_note" }, "加载中…") : null,
				error ? h("div", { className: "sg_error" }, error) : null,
				!loading && !error && visible.length === 0 ? h("div", { className: "sg_note" }, listing ? "（空目录）" : "无法浏览") : null,
				h("div", { className: "sg_tree" },
					visible.map((entry) => h("div", { className: "sg_treeRow", key: entry.path,
							onClick: () => { if (entry.isDir) void load(entry.path); } },
						h("span", { className: "sg_treeFolder" }, entry.isDir ? "▸" : "·"),
						h("span", { className: "sg_treeName", title: entry.path }, entry.name),
						entry.isDir ? null : h("span", { className: "sg_treeMeta" }, fmtBytes(entry.size)),
						!entry.isDir && allowFiles
							? h("button", { type: "button", className: "sg_btn", onClick: (e) => { e.stopPropagation(); void download(entry); } }, "下载")
							: null))),
				listing && listing.truncated ? h("div", { className: "sg_note" }, "（列表超上限被截断）") : null,
				h("div", { className: "sg_toolbar" },
					h("button", { type: "button", className: "sg_btn", disabled: !listing || loading, onClick: () => void load(listing ? listing.path : undefined) }, "刷新"),
					listing && allowFiles
						? h("label", { className: "sg_btn", style: { cursor: "pointer" } },
								"上传", h("input", { type: "file", style: { display: "none" }, onChange: (e) => { const f = e.target.files && e.target.files[0]; if (f) void upload(f); e.target.value = ""; } }))
						: null,
					h("button", { type: "button", className: "sg_btn sg_btnPrimary", disabled: !listing || opening, onClick: () => void openAsWorkspace() },
						opening ? "打开中…" : "打开为工作区")));
		}
		function crumbNav(crumbs, listing, load) {
			const items = [];
			let acc = "";
			crumbs.forEach((segment, index) => {
				acc += "/" + segment;
				const isLast = index === crumbs.length - 1;
				items.push(isLast
					? h("span", { key: acc }, segment)
					: h("span", { key: acc, className: "sg_crumb", onClick: () => void load(acc) }, segment));
				if (!isLast) items.push(h("span", { key: acc + "/" }, "/"));
			});
			return items.length > 0 ? items : [h("span", { key: "/" }, "/")];
		}
		//#endregion
		//#region SerialConsolePanel —— serial:// / serial-tcp:// 节点命令面（状态 + 发送 + 读取 + 会话管理）
		// 只做命令/状态/日志——不内嵌交互终端；文件传输不支持 console 传输（用 ssh:// 节点）。
		function SerialConsolePanel(props) {
			const { rpc, node, config } = props;
			const [status, setStatus] = react.useState(null);
			const [command, setCommand] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [lines, setLines] = react.useState([]);
			const [error, setError] = react.useState("");
			const [msg, setMsg] = react.useState("");
			const [confirming, setConfirming] = react.useState(false);
			const refreshStatus = async () => {
				try {
					const v = unwrap(await rpc(CH_SSH, "node.status", { id: node.id }), "node.status failed");
					setStatus(v);
				} catch { setStatus(null); }
			};
			react.useEffect(() => { void refreshStatus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [node.id]);
			const open = async () => {
				setBusy(true); setError(""); setMsg("");
				try {
					const v = unwrap(await rpc(CH_SSH, "serial.open", { id: node.id }), "serial.open failed");
					setMsg("会话已打开" + (v.logPath ? "：日志 " + v.logPath : ""));
					await refreshStatus();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally { setBusy(false); }
			};
			const close = async () => {
				setBusy(true); setError(""); setMsg("");
				try {
					const v = unwrap(await rpc(CH_SSH, "serial.close", { id: node.id }), "serial.close failed");
					setMsg("会话已关闭" + (v.logPath ? "：日志 " + v.logPath : ""));
					await refreshStatus();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally { setBusy(false); }
			};
			const doRun = async () => {
				setBusy(true); setError(""); setMsg("");
				try {
					const v = unwrap(await rpc(CH_SSH, "exec.run", { id: node.id, command, lineEnding: "lf" }), "exec.run failed");
					const meta = (v.exitCode === null ? "console" : "exit " + v.exitCode) + (v.timedOut ? " · 超时" : "") + (v.truncated ? " · 截断" : "");
					setLines((previous) => [...previous, { text: v.stdout || "（无输出）", meta }]);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally { setBusy(false); }
			};
			const run = async () => {
				if (!command.trim()) { setError("命令不能为空"); return; }
				setError("");
				if (config && config.security && config.security.confirmExec) { setConfirming(true); return; }
				await doRun();
			};
			const readMore = async () => {
				setError("");
				try {
					const v = unwrap(await rpc(CH_SSH, "serial.read", { id: node.id, timeoutMs: 1500, maxBytes: 4096 }), "serial.read failed");
					if (v.data) setLines((previous) => [...previous, { text: v.data, meta: "read" + (v.moreAvailable ? "（截断）" : "") }]);
					else setMsg("（无新数据）");
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			};
			const statusLine = status
				? (status.state === "open"
					? "会话开 · 收 " + fmtBytes(status.receivedBytes) + " · 发 " + fmtBytes(status.sentBytes) + (status.logPath ? " · 日志 " + status.logPath : "")
					: (status.state === "error"
						? "会话错误：" + (status.readError || "unknown")
						: "会话关闭" + (status.logPath ? "（上次日志 " + status.logPath + "）" : "")))
				: "状态未知";
			return h("div", { className: "sg_panel" },
				h("div", { className: "sg_panelTitle" }, transportLabel(node.transport) + " 控制台 · " + node.name),
				h("div", { className: "sg_note" }, "目标：" + nodeMeta(node) + " · " + statusLine),
				h("div", { className: "sg_toolbar" },
					h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => void open() }, "打开会话"),
					h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => void close() }, "关闭会话"),
					h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => void refreshStatus() }, "刷新状态")),
				h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "命令"),
					h("input", { className: "sg_input", style: { flex: 1 }, value: command, onChange: (e) => setCommand(e.target.value), placeholder: "发送到串口控制台（自动追加换行 \\n）" }),
					h("button", { type: "button", className: "sg_btn sg_btnPrimary", disabled: busy || !command.trim(), onClick: () => void run() }, busy ? "发送中…" : "发送"),
					h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => void readMore() }, "读取更多")),
				error ? h("div", { className: "sg_error" }, error) : null,
				msg ? h("div", { className: "sg_msg" }, msg) : null,
				lines.length > 0
					? h("div", { className: "sg_output", style: { maxHeight: 200 } },
							lines.map((line, index) => h("div", { key: index, style: { margin: "2px 0" } },
								(line.meta ? "[" + line.meta + "] " : "") + line.text)))
					: null,
				confirming
					? h("div", { className: "sg_overlay", onClick: (e) => { if (e.target === e.currentTarget && !busy) setConfirming(false); } },
							h("div", { className: "sg_dialog", style: { width: "min(560px,100%)" } },
								h("div", { className: "sg_panelTitle" }, "确认发送到串口控制台？"),
								h("div", { className: "sg_note" }, "目标：" + node.name + "（" + nodeMeta(node) + "）"),
								h("div", { className: "sg_output", style: { maxHeight: 160 } }, command),
								h("div", { className: "sg_toolbar" },
									h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => setConfirming(false) }, "取消"),
									h("button", { type: "button", className: "sg_btn sg_btnPrimary", disabled: busy, onClick: () => { setConfirming(false); void doRun(); } }, "确认发送"))))
					: null,
				h("div", { className: "sg_note" }, "本面板只做命令/状态——不内嵌交互终端；文件传输不支持 " + node.transport + "（请用 ssh:// 节点）。收发与命令均落盘日志。"));
		}
		//#endregion
		//#region NodeForm —— 节点新建/编辑表单（传输类型选择 + 条件字段 + keyRef/口令/测试连接）
		function NodeForm(props) {
			const { rpc, draft, bindings, ports, busy, onSave, onTest, onCancel } = props;
			const empty = { id: "", name: "", transport: "ssh://", host: "", username: "", port: "22", agent: "", password: "", keyRef: "", serialPort: "", baudRate: "115200", backend: "stty", tcpHost: "", tcpPort: "", tty: "" };
			const [form, setForm] = react.useState(Object.assign({}, empty, draft || {}));
			const [error, setError] = react.useState("");
			const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));
			const setTransport = (event) => setForm((previous) => ({ ...previous, transport: event.target.value }));
			const buildPayload = () => {
				const base = { ...(form.id ? { id: form.id } : {}), ...(form.name.trim() ? { name: form.name.trim() } : {}), transport: form.transport };
				if (form.transport === "ssh://") {
					if (!form.host.trim()) { setError("host 不能为空"); return null; }
					if (!form.username.trim()) { setError("user 不能为空"); return null; }
					const port = Number(form.port);
					if (!Number.isInteger(port) || port <= 0 || port > 65535) { setError("port 需为 1–65535 的整数"); return null; }
					const target = { host: form.host.trim(), username: form.username.trim(), port };
					if (form.agent.trim()) target.agent = form.agent.trim();
					const payload = { node: { ...base, target } };
					if (form.password) payload.password = form.password;
					if (form.keyRef.trim()) payload.keyRef = form.keyRef.trim();
					return payload;
				}
				if (form.transport === "serial://") {
					if (!form.serialPort.trim()) { setError("设备路径不能为空（如 /dev/ttyUSB0）"); return null; }
					const baudRate = Number(form.baudRate);
					if (!Number.isInteger(baudRate) || baudRate < 50 || baudRate > 4000000) { setError("波特率需为 50–4000000 的整数"); return null; }
					if (form.backend !== "stty" && form.backend !== "serialport") { setError("后端需为 stty 或 serialport"); return null; }
					return { node: { ...base, target: { port: form.serialPort.trim(), baudRate, backend: form.backend } } };
				}
				if (!form.tcpHost.trim()) { setError("TCP 主机不能为空"); return null; }
				const tcpPort = Number(form.tcpPort);
				if (!Number.isInteger(tcpPort) || tcpPort <= 0 || tcpPort > 65535) { setError("TCP 端口需为 1–65535 的整数"); return null; }
				const tcpTarget = { host: form.tcpHost.trim(), port: tcpPort };
				if (form.tty.trim()) tcpTarget.tty = form.tty.trim();
				return { node: { ...base, target: tcpTarget } };
			};
			const submit = async (withTest) => {
				setError("");
				const payload = buildPayload();
				if (payload === null) return;
				if (withTest) { await onTest(form, payload); return; }
				await onSave(payload);
			};
			return h("div", { className: "sg_form" },
				h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "类型"),
					h("select", { className: "sg_select", style: { flex: 1 }, value: form.transport, onChange: setTransport },
						h("option", { value: "ssh://" }, "SSH 主机"),
						h("option", { value: "serial://" }, "本地串口"),
						h("option", { value: "serial-tcp://" }, "TCP 串口服务器"))),
				h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "显示名"),
					h("input", { className: "sg_input", style: { flex: 1 }, value: form.name, onChange: set("name"), placeholder: "可选，默认 = id" })),
				form.transport === "ssh://"
					? h(react.Fragment, null,
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "主机 host"),
								h("input", { className: "sg_input", style: { flex: 1 }, value: form.host, onChange: set("host"), placeholder: "192.168.1.10 或 hostname" })),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "用户 user"),
								h("input", { className: "sg_input", style: { flex: 1 }, value: form.username, onChange: set("username") })),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "端口 port"),
								h("input", { className: "sg_input", style: { width: 90 }, value: form.port, onChange: set("port") }),
								h("span", { className: "sg_note" }, "默认 22")),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "SSH agent"),
								h("input", { className: "sg_input", style: { flex: 1 }, value: form.agent, onChange: set("agent"), placeholder: "可选（如 %default / pageant）" })),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "口令"),
								h("input", { className: "sg_input", style: { flex: 1 }, type: "password", value: form.password, onChange: set("password"), placeholder: "可选（编辑时留空=保持不变）" })),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "keyRef"),
								h("input", { className: "sg_input", style: { flex: 1 }, value: form.keyRef, onChange: set("keyRef"), placeholder: "credentials ref 名（如 MY_SSH_KEY，见 ~/.dsh/.credentials.yaml）" })),
							bindings && bindings.length > 0
								? h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "已绑定 ref（可复用）"),
									h("select", { className: "sg_select", value: form.keyRef, onChange: set("keyRef") },
										h("option", { value: "" }, "（不选）"),
										bindings.map((b) => h("option", { key: b.refName, value: b.refName }, b.refName + (b.configured ? "" : "（未配置）")))))
								: null)
					: null,
				form.transport === "serial://"
					? h(react.Fragment, null,
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "设备路径"),
								h("input", { className: "sg_input", style: { flex: 1 }, value: form.serialPort, onChange: set("serialPort"), placeholder: "/dev/ttyUSB0" }),
								ports && ports.length > 0
									? h("select", { className: "sg_select", value: form.serialPort, onChange: set("serialPort") },
										h("option", { value: "" }, "（本机端口…）"),
										ports.map((p) => h("option", { key: p.path, value: p.path }, p.label ? p.path + " (" + p.label + ")" : p.path)))
									: null),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "波特率"),
								h("input", { className: "sg_input", style: { width: 110 }, value: form.baudRate, onChange: set("baudRate") }),
								h("span", { className: "sg_note" }, "默认 115200")),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "后端"),
								h("select", { className: "sg_select", value: form.backend, onChange: set("backend") },
									h("option", { value: "stty" }, "stty（零依赖）"),
									h("option", { value: "serialport" }, "serialport（需安装）"))))
					: null,
				form.transport === "serial-tcp://"
					? h(react.Fragment, null,
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "TCP 主机"),
								h("input", { className: "sg_input", style: { flex: 1 }, value: form.tcpHost, onChange: set("tcpHost"), placeholder: "10.0.0.5（ser2net/socat 服务器）" })),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "TCP 端口"),
								h("input", { className: "sg_input", style: { width: 110 }, value: form.tcpPort, onChange: set("tcpPort") }),
								h("span", { className: "sg_note" }, "如 4001")),
							h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "远端 tty"),
								h("input", { className: "sg_input", style: { flex: 1 }, value: form.tty, onChange: set("tty"), placeholder: "可选（如 /dev/ttyS0，仅说明）" })),
							h("div", { className: "sg_note" }, "serial-tcp 为 raw TCP，无凭据（ser2net/socat 侧自行控制访问）"))
					: null,
				error ? h("div", { className: "sg_error" }, error) : null,
				h("div", { className: "sg_toolbar" },
					h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => void submit(true) }, "测试连接"),
					h("button", { type: "button", className: "sg_btn sg_btnPrimary", disabled: busy, onClick: () => void submit(false) }, busy ? "保存中…" : "保存"),
					h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: onCancel }, "取消")));
		}
		//#endregion
		//#region DistributedControlSettingsPage —— settings.section 条目（id @local/dsh-ssh-gui，order 50）
		function DistributedControlSettingsPage(props) {
			const { rpc, workspaces, sessions, close } = props;
			const [nodes, setNodes] = react.useState([]);
			const [currentId, setCurrentId] = react.useState("");
			const [bindings, setBindings] = react.useState([]);
			const [config, setConfig] = react.useState({ file: { maxBytes: 10485760 }, security: { confirmExec: true } });
			const [ports, setPorts] = react.useState([]);
			const [statuses, setStatuses] = react.useState({});
			const [busy, setBusy] = react.useState(false);
			const [err, setErr] = react.useState("");
			const [msg, setMsg] = react.useState("");
			const [formOpen, setFormOpen] = react.useState(false);
			const [formDraft, setFormDraft] = react.useState(null);
			const [expandedId, setExpandedId] = react.useState("");
			const refresh = async (silent) => {
				if (!silent) setBusy(true);
				try {
					const [nodesValue, bindingsValue, configValue, portsValue] = await Promise.all([
						rpc(CH_SSH, "nodes.list", {}),
						rpc(CH_SSH, "keyref.list", {}),
						rpc(CH_SSH, "config.get", {}),
						rpc(CH_SSH, "serial.ports", {}),
					]);
					const nodeState = unwrap(nodesValue, "nodes.list failed");
					const nodesList = Array.isArray(nodeState.nodes) ? nodeState.nodes.map(asNode).filter((n) => n !== null) : [];
					setNodes(nodesList);
					setCurrentId(typeof nodeState.currentId === "string" ? nodeState.currentId : "");
					const bindingState = unwrap(bindingsValue, "keyref.list failed");
					setBindings(Array.isArray(bindingState.bindings) ? bindingState.bindings.map(asBinding).filter((b) => b !== null) : []);
					setConfig(unwrap(configValue, "config.get failed"));
					const portState = unwrap(portsValue, "serial.ports failed");
					setPorts(Array.isArray(portState.ports) ? portState.ports : []);
					setErr("");
					const statusEntries = {};
					await Promise.all(nodesList.map(async (node) => {
						try {
							let state = "unknown";
							if (node.transport === "ssh://") {
								const value = unwrap(await rpc(CH_DWS, "conn.status", { id: node.id }), "conn.status failed");
								state = typeof value.state === "string" ? value.state : "unknown";
							}
							else {
								const value = unwrap(await rpc(CH_SSH, "node.status", { id: node.id }), "node.status failed");
								state = typeof value.state === "string" ? value.state : "unknown";
							}
							statusEntries[node.id] = state;
						} catch { statusEntries[node.id] = "unknown"; }
					}));
					setStatuses(statusEntries);
				} catch (cause) {
					setErr(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (!silent) setBusy(false);
				}
			};
			react.useEffect(() => { void refresh(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
			const bindingOf = (machineId) => bindings.find((b) => b.machineId === machineId);
			const saveNode = async (payload) => {
				setBusy(true); setErr(""); setMsg("");
				try {
					const value = unwrap(await rpc(CH_SSH, "nodes.add", payload), "nodes.add failed");
					setFormOpen(false);
					setFormDraft(null);
					setMsg("已保存节点 " + (value.node && value.node.name ? value.node.name : ""));
					await refresh(true);
				} catch (cause) {
					setErr(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};
			const testNode = async (form, payload) => {
				setBusy(true); setErr(""); setMsg("");
				try {
					if (form.id) {
						const value = unwrap(await rpc(CH_SSH, "nodes.test", { id: form.id }), "nodes.test failed");
						setMsg((value.ok ? "测试通过：" : "测试失败：") + value.detail);
					}
					else if (form.transport === "ssh://") {
						unwrap(await rpc(CH_DWS, "machines.test", {
							host: payload.node.target.host,
							username: payload.node.target.username,
							port: payload.node.target.port,
							...(payload.password ? { password: payload.password } : {}),
						}), "machines.test failed");
						setMsg("测试连接成功");
					}
					else {
						setErr("请先保存节点，再测试连接");
					}
				} catch (cause) {
					setErr("测试失败：" + (cause instanceof Error ? cause.message : String(cause)));
				} finally {
					setBusy(false);
				}
			};
			const removeNode = async (node) => {
				if (!window.confirm("删除节点「" + node.name + "」（" + transportLabel(node.transport) + " " + nodeMeta(node) + "）？")) return;
				setBusy(true); setErr(""); setMsg("");
				try {
					unwrap(await rpc(CH_SSH, "nodes.remove", { id: node.id }), "nodes.remove failed");
					setMsg("已删除 " + node.name);
					await refresh(true);
				} catch (cause) {
					setErr(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};
			const setCurrent = async (node) => {
				setBusy(true); setErr(""); setMsg("");
				try {
					unwrap(await rpc(CH_SSH, "nodes.setCurrent", { id: node.id }), "nodes.setCurrent failed");
					setMsg("当前节点已设为 " + node.name);
					await refresh(true);
				} catch (cause) {
					setErr(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};
			const bindKey = async (machine, refName) => {
				if (!refName) { setErr("请输入 keyRef 名"); return; }
				setBusy(true); setErr(""); setMsg("");
				try {
					unwrap(await rpc(CH_SSH, "keyref.set", { machineId: machine.id, refName }), "keyref.set failed");
					try { unwrap(await rpc(CH_DWS, "conn.reconnect", { id: machine.id }), "conn.reconnect failed"); } catch { /* best-effort */ }
					setMsg("已绑定 " + refName);
					await refresh(true);
				} catch (cause) {
					setErr(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};
			const unbindKey = async (machine) => {
				setBusy(true); setErr(""); setMsg("");
				try {
					unwrap(await rpc(CH_SSH, "keyref.unbind", { id: machine.id }), "keyref.unbind failed");
					try { unwrap(await rpc(CH_DWS, "conn.reconnect", { id: machine.id }), "conn.reconnect failed"); } catch { /* best-effort */ }
					setMsg("已解绑 keyRef");
					await refresh(true);
				} catch (cause) {
					setErr(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};
			const forgetKey = async (machine) => {
				setBusy(true); setErr(""); setMsg("");
				try {
					unwrap(await rpc(CH_DWS, "hostkey.forget", { id: machine.id }), "hostkey.forget failed");
					setMsg("已忘记主机密钥 " + machine.name);
				} catch (cause) {
					setErr(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};
			const startEdit = (node) => {
				const draft = { id: node.id, name: node.name === node.id ? "" : node.name, transport: node.transport };
				if (node.transport === "ssh://") {
					const binding = bindingOf(node.id);
					draft.host = node.host;
					draft.username = node.username;
					draft.port = String(node.port);
					draft.agent = "";
					draft.password = "";
					draft.keyRef = binding ? binding.refName : "";
				}
				else if (node.transport === "serial://") {
					draft.serialPort = node.port;
					draft.baudRate = String(node.baudRate);
					draft.backend = node.backend;
				}
				else {
					draft.tcpHost = node.host;
					draft.tcpPort = String(node.port);
					draft.tty = node.tty || "";
				}
				setFormDraft(draft);
				setErr("");
				setFormOpen(true);
			};
			const statusCell = (node) => (node.transport === "ssh://"
				? h(StatusDot, { rpc, id: node.id, state: statuses[node.id] || "unknown" })
				: h(ConsoleStatusDot, { rpc, node }));
			return h("div", { className: "sg_root" },
				h("div", { className: "sg_head" },
					h("div", { className: "sg_title" }, "分布式控制 · dsh-ssh-gui"),
					h("div", { className: "sg_sub" }, "统一节点：SSH 主机 / 本地串口 / TCP 串口服务器（nodes.json 一张表）；终端交外部，本面板只做 连接管理/状态/命令/文件/目录浏览。侧栏「分布式节点」文件夹走官方 sidecar list 槽（sidebar.workspaces.remoteHosts）；设置页内为同 UX 补全入口。")),
				h("div", { className: "sg_toolbar" },
					h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => void refresh(false) }, "刷新"),
					h("button", { type: "button", className: "sg_btn sg_btnPrimary", disabled: busy, onClick: () => { setFormDraft(null); setErr(""); setFormOpen(true); } }, "新建节点"),
					close ? h("button", { type: "button", className: "sg_btn", onClick: close }, "完成") : null),
				err ? h("div", { className: "sg_error" }, err) : null,
				msg ? h("div", { className: "sg_msg" }, msg) : null,
				formOpen
					? h("div", { className: "sg_panel" },
							h("div", { className: "sg_panelTitle" }, formDraft && formDraft.id ? "编辑节点" : "新建节点"),
							h(NodeForm, { rpc, draft: formDraft, bindings, ports, busy, onSave: saveNode, onTest: testNode, onCancel: () => { setFormOpen(false); setFormDraft(null); } }))
					: null,
				h("div", { className: "sg_panel" },
					h("div", { className: "sg_panelTitle" }, "节点列表（" + nodes.length + "）"),
					nodes.length === 0
						? h("div", { className: "sg_note" }, "暂无节点。点击「新建节点」添加（SSH / 串口 / TCP 串口服务器）。")
						: h("table", { className: "sg_table" },
								h("thead", null, h("tr", null,
									h("th", null, "节点"), h("th", null, "传输"), h("th", null, "目标"),
									h("th", null, "keyRef"), h("th", null, "状态"), h("th", null, "操作"))),
								h("tbody", null, nodes.map((node) => {
									const binding = bindingOf(node.id);
									const isCurrent = node.id === currentId;
									return h("tr", { key: node.id },
										h("td", null, nodeIcon(node.transport) + " " + node.name + (isCurrent ? "（当前）" : "")),
										h("td", null, h("span", { className: "sg_badge" }, transportLabel(node.transport))),
										h("td", null, nodeMeta(node)),
										h("td", null, node.transport === "ssh://"
											? (binding
												? h("span", { className: "sg_badge", title: binding.configured ? "已配置" : "未在 credentials 中配置" },
													binding.refName + (binding.configured ? "" : "（未配置）"))
												: h("span", { className: "sg_note" }, "—"))
											: h("span", { className: "sg_note" }, "—")),
										h("td", null, statusCell(node)),
										h("td", null, h("div", { className: "sg_toolbar", style: { gap: 4 } },
											h("button", { type: "button", className: "sg_btn", onClick: () => startEdit(node) }, "编辑"),
											isCurrent ? null : h("button", { type: "button", className: "sg_btn", onClick: () => void setCurrent(node) }, "设当前"),
											h("button", { type: "button", className: "sg_btn", onClick: () => { void rpc(CH_SSH, "nodes.test", { id: node.id }).then((value) => { const v = unwrap(value, "nodes.test failed"); setMsg((v.ok ? "测试通过：" : "测试失败：") + v.detail); }).catch((cause) => setErr("测试失败：" + (cause instanceof Error ? cause.message : String(cause)))); } }, "测试"),
											node.transport === "ssh://"
												? h(react.Fragment, null,
													h("button", { type: "button", className: "sg_btn", onClick: () => void forgetKey(node) }, "忘记密钥"),
													binding
														? h("button", { type: "button", className: "sg_btn", onClick: () => void unbindKey(node) }, "解绑 keyRef")
														: h("button", { type: "button", className: "sg_btn", onClick: () => { const ref = window.prompt("输入 credentials ref 名（如 MY_SSH_KEY）", ""); if (ref) void bindKey(node, ref.trim()); } }, "绑定 keyRef"))
												: null,
											h("button", { type: "button", className: "sg_btn sg_btnDanger", onClick: () => void removeNode(node) }, "删除"))));
								})))),
				h("div", { className: "sg_panel" },
					h("div", { className: "sg_panelTitle" }, "节点 → 目录浏览 / 串口控制台"),
					nodes.length === 0
						? h("div", { className: "sg_note" }, "无节点可浏览。")
						: h("div", { className: "sg_tree" },
								nodes.map((node) => {
									const expanded = expandedId === node.id;
									return h("div", { key: node.id },
										h("div", { className: "sg_treeRow" + (expanded ? " sg_treeRowActive" : ""), onClick: () => setExpandedId(expanded ? "" : node.id) },
											h("span", { className: "sg_treeFolder" }, expanded ? "▼" : "▶"),
											h("span", { className: "sg_treeName" }, nodeIcon(node.transport) + " " + node.name),
											h("span", { className: "sg_treeMeta" }, transportLabel(node.transport) + " · " + nodeMeta(node))),
										expanded
											? h("div", { style: { paddingLeft: 18 } },
												node.transport === "ssh://"
													? h(RemoteBrowser, { rpc, workspaces, sessions, machineId: node.id, allowFiles: false, onMessage: (text) => setMsg(text) })
													: h(SerialConsolePanel, { rpc, node, config }))
											: null);
								}))),
				h("div", { className: "sg_note" }, "文件传输上限：" + fmtBytes(config.file && config.file.maxBytes) + "（settings dsh-ssh-gui.file.maxBytes 可配）；超大文件请用 sw_* 工具。" +
					" 命令执行" + (config.security && config.security.confirmExec ? "需二次确认" : "已关闭二次确认（settings dsh-ssh-gui.security.confirmExec）") + "。"));
		}
		//#endregion
		//#region CommandPanel —— ssh 节点远端命令执行（exec.run，客户端二次确认）
		function CommandPanel(props) {
			// nodes：ssh 节点（asNode）；hostId/onHostId 由父级（header 对话框）受控。
			const { rpc, nodes, currentId, config, hostId, onHostId } = props;
			const [cwd, setCwd] = react.useState("");
			const [command, setCommand] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");
			const [output, setOutput] = react.useState(null);
			const [confirming, setConfirming] = react.useState(false);
			const run = async () => {
				if (!command.trim()) { setError("命令不能为空"); return; }
				if (!hostId) { setError("请选择节点"); return; }
				setError("");
				if (config.security && config.security.confirmExec) {
					setConfirming(true);
					return;
				}
				await execute();
			};
			const execute = async () => {
				setBusy(true); setError("");
				try {
					const value = unwrap(await rpc(CH_SSH, "exec.run", {
						id: hostId,
						command,
						...(cwd.trim() ? { cwd: cwd.trim() } : {}),
					}), "exec.run failed");
					setOutput(value);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
					setOutput(null);
				} finally {
					setBusy(false);
				}
			};
			const confirmDialog = confirming
				? h("div", { className: "sg_overlay", onClick: (e) => { if (e.target === e.currentTarget && !busy) setConfirming(false); } },
						h("div", { className: "sg_dialog", style: { width: "min(560px,100%)" } },
							h("div", { className: "sg_panelTitle" }, "确认在远端执行命令？"),
							h("div", { className: "sg_note" }, "目标：" + (nodes.find((n) => n.id === hostId)?.name || hostId) + (cwd.trim() ? " · cwd=" + cwd.trim() : "")),
							h("div", { className: "sg_output", style: { maxHeight: 160 } }, command),
							h("div", { className: "sg_toolbar" },
								h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => setConfirming(false) }, "取消"),
								h("button", { type: "button", className: "sg_btn sg_btnPrimary", disabled: busy, onClick: () => { setConfirming(false); void execute(); } }, "确认执行"))))
				: null;
			const host = nodes.find((n) => n.id === hostId);
			return h("div", { className: "sg_form" },
				h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "节点"),
					h("select", { className: "sg_select", style: { flex: 1 }, value: hostId, onChange: (e) => onHostId(e.target.value) },
						nodes.map((n) => h("option", { key: n.id, value: n.id }, n.name + (n.id === currentId ? "（当前）" : "")))),
					host ? h(StatusDot, { rpc, id: host.id, state: undefined }) : null),
				h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "cwd"),
					h("input", { className: "sg_input", style: { flex: 1 }, value: cwd, onChange: (e) => setCwd(e.target.value), placeholder: "留空 = 节点默认远程目录（" + (host && host.workspace ? host.workspace : "workspace/cwd") + "）" })),
				h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "命令"),
					h("textarea", { className: "sg_textarea", value: command, onChange: (e) => setCommand(e.target.value), placeholder: "如 ls -la / 或 uname -a" })),
				error ? h("div", { className: "sg_error" }, error) : null,
				h("div", { className: "sg_toolbar" },
					h("button", { type: "button", className: "sg_btn sg_btnPrimary", disabled: busy || !command.trim() || !hostId, onClick: () => void run() }, busy ? "执行中…" : "执行"),
					output ? h("button", { type: "button", className: "sg_btn", disabled: busy, onClick: () => void execute() }, "再执行") : null),
				output
					? h("div", { className: "sg_panel" },
							h("div", { className: "sg_panelTitle" }, "输出（exit " + output.exitCode + (output.signal ? " · signal " + output.signal : "") + (output.timedOut ? " · 超时" : "") + (output.truncated ? " · 已截断" : "") + "）"),
							h("div", { className: "sg_output" },
								output.stdout || (output.stderr ? "（无 stdout）" : "（无输出）"),
								output.stderr ? "\n[stderr]\n" + output.stderr : ""))
					: null,
				confirmDialog);
		}
		//#endregion
		//#region DistributedControlActions —— conversation.session.header.actions 条目（「节点」按钮）
		function DistributedControlActions(props) {
			const { rpc, workspaces, sessions } = props;
			const [open, setOpen] = react.useState(false);
			const [tab, setTab] = react.useState("cmd");
			const [nodes, setNodes] = react.useState([]);
			const [currentId, setCurrentId] = react.useState("");
			const [config, setConfig] = react.useState({ file: { maxBytes: 10485760 }, security: { confirmExec: true } });
			const [err, setErr] = react.useState("");
			react.useEffect(() => {
				if (!open) return;
				let alive = true;
				Promise.all([rpc(CH_SSH, "nodes.list", {}), rpc(CH_SSH, "config.get", {})])
					.then(([nodesValue, configValue]) => {
						if (!alive) return;
						const nodeState = unwrap(nodesValue, "nodes.list failed");
						setNodes(Array.isArray(nodeState.nodes) ? nodeState.nodes.map(asNode).filter((n) => n !== null) : []);
						setCurrentId(typeof nodeState.currentId === "string" ? nodeState.currentId : "");
						setConfig(unwrap(configValue, "config.get failed"));
						setErr("");
					})
					.catch((cause) => { if (alive) setErr(cause instanceof Error ? cause.message : String(cause)); });
				return () => { alive = false; };
			}, [open]);
			const [nodeId, setNodeId] = react.useState("");
			react.useEffect(() => {
				if (!nodeId && nodes[0]) setNodeId(currentId || nodes[0].id);
			}, [nodes, currentId, nodeId]);
			const node = nodes.find((n) => n.id === nodeId);
			const sshNodes = nodes.filter((n) => n.transport === "ssh://");
			const dialog = open
				? h("div", { className: "sg_overlay", onClick: (e) => { if (e.target === e.currentTarget) setOpen(false); } },
						h("div", { className: "sg_dialog", role: "dialog", "aria-modal": "true", "aria-label": "分布式控制面板" },
							h("div", { className: "sg_head" },
								h("div", { className: "sg_title" }, "分布式控制 · dsh-ssh-gui"),
								h("div", { className: "sg_toolbar", style: { marginLeft: "auto" } },
									h("button", { type: "button", className: "sg_btn", onClick: () => setOpen(false) }, "关闭"))),
							err ? h("div", { className: "sg_error" }, err) : null,
							nodes.length === 0
								? h("div", { className: "sg_note" }, "暂无节点——请在设置页「分布式控制 · dsh-ssh-gui」中添加。")
								: h(react.Fragment, null,
										h("div", { className: "sg_formRow" }, h("span", { className: "sg_formLabel" }, "节点"),
											h("select", { className: "sg_select", style: { flex: 1 }, value: nodeId, onChange: (e) => setNodeId(e.target.value) },
												nodes.map((n) => h("option", { key: n.id, value: n.id }, nodeIcon(n.transport) + " " + n.name + (n.id === currentId ? "（当前）" : "") + " · " + transportLabel(n.transport))))),
										h("div", { className: "sg_tabs" },
											h("button", { type: "button", className: "sg_tab" + (tab === "cmd" ? " sg_tabActive" : ""), onClick: () => setTab("cmd") }, "命令"),
											h("button", { type: "button", className: "sg_tab" + (tab === "file" ? " sg_tabActive" : ""), onClick: () => setTab("file") }, "文件")),
										tab === "cmd"
											? (node && node.transport === "ssh://"
												? h(CommandPanel, { rpc, nodes: sshNodes, currentId, config, hostId: nodeId, onHostId: setNodeId })
												: h(SerialConsolePanel, { rpc, node, config }))
											: (node && node.transport === "ssh://"
												? h(RemoteBrowser, { rpc, workspaces, sessions, machineId: nodeId, allowFiles: true, onMessage: (text) => setErr(text) })
												: h("div", { className: "sg_note" }, "文件传输不支持 " + (node ? node.transport : "该节点") + "——请选择 ssh:// 节点；超大文件请用 sw_* 工具。")))))
				: null;
			return h(react.Fragment, null,
				h("button", { type: "button", className: "sg_btn", onClick: () => setOpen((value) => !value), title: "分布式控制：命令 / 文件 / 节点" }, "节点"),
				dialog);
		}
		//#endregion
		//#region SidebarDistributedNodesTree —— sidebar.workspaces.remoteHosts 条目（「分布式节点」文件夹）
		// 侧栏目录流真集成（slot-mod-audit.md §4 路径 B）：官方 ui-workspace 补丁声明 sidecar
		// list 槽，本组件以其 id 注册。顶层「分布式节点」→ 各节点（三类传输）→ 展开：
		// ssh 节点 = 目录浏览 + 「打开为工作区」（复用 /dsw session.route + workspaces.create +
		// connectWorkspace）；serial/serial-tcp 节点 = 串口控制台（状态/命令/日志）。
		// 串口节点不做工作区（只做命令/文件面）。section 定高在组件内实现——官方渲染点
		// 是裸 renderSlot，空槽零 UI 影响（不装本插件时侧栏无变化）。
		function SidebarDistributedNodesTree(props) {
			const { rpc, workspaces, sessions } = props;
			const [nodes, setNodes] = react.useState([]);
			const [expandedId, setExpandedId] = react.useState("");
			const [msg, setMsg] = react.useState("");
			const [err, setErr] = react.useState("");
			const [config, setConfig] = react.useState({ security: { confirmExec: true } });
			const refresh = async () => {
				try {
					const [nodesValue, configValue] = await Promise.all([
						rpc(CH_SSH, "nodes.list", {}),
						rpc(CH_SSH, "config.get", {}),
					]);
					const value = unwrap(nodesValue, "nodes.list failed");
					setNodes(Array.isArray(value.nodes) ? value.nodes.map(asNode).filter((n) => n !== null) : []);
					setConfig(unwrap(configValue, "config.get failed"));
					setErr("");
				} catch (cause) {
					setErr(cause instanceof Error ? cause.message : String(cause));
				}
			};
			react.useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
			return h("div", { className: "sg_sidebar", "data-sg-section": "remote-hosts" },
				h("div", { className: "sg_head" },
					h("span", { className: "sg_treeFolder" }, "🗀"),
					h("span", { className: "sg_title" }, "分布式节点"),
					h("span", { className: "sg_treeMeta" }, nodes.length + " 个")),
				err ? h("div", { className: "sg_error" }, err) : null,
				nodes.length === 0
					? h("div", { className: "sg_note" }, "暂无节点——在设置页「分布式控制 · dsh-ssh-gui」添加")
					: h("div", { className: "sg_tree" },
							nodes.map((node) => {
								const expanded = expandedId === node.id;
								return h("div", { key: node.id },
									h("div", { className: "sg_treeRow" + (expanded ? " sg_treeRowActive" : ""), onClick: () => setExpandedId(expanded ? "" : node.id) },
										h("span", { className: "sg_treeFolder" }, expanded ? "▼" : "▶"),
										h("span", { className: "sg_treeName", title: nodeMeta(node) }, nodeIcon(node.transport) + " " + node.name),
										h("span", { className: "sg_treeMeta" }, transportLabel(node.transport))),
									expanded
										? h("div", { style: { paddingLeft: 14 } },
											node.transport === "ssh://"
												? h(RemoteBrowser, { rpc, workspaces, sessions, machineId: node.id, allowFiles: false, onMessage: (text) => setMsg(text) })
												: h(SerialConsolePanel, { rpc, node, config }))
										: null);
							})),
				msg ? h("div", { className: "sg_msg" }, msg) : null);
		}
		//#endregion
		//#region plugin face
		const inject = ["slots", "connection", "sessions", "workspaces"];
		function apply(ctx) {
			const rpc = (channel, endpoint, payload, signal) => {
				const connection = ctx.get ? ctx.get("connection") : ctx.connection;
				if (!connection || !connection.rpc || typeof connection.rpc.call !== "function") {
					return Promise.resolve({ ok: false, error: { code: "internal", message: "connection transport unavailable" } });
				}
				return connection.rpc.call(channel, endpoint, payload ?? {}, signal);
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "@local/dsh-ssh-gui",
				order: 50,
				label: () => "分布式控制 · dsh-ssh-gui",
				inject: () => ({ rpc, workspaces: ctx.workspaces, sessions: ctx.sessions }),
			}, DistributedControlSettingsPage));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "@local/dsh-ssh-gui-actions",
				order: 26,
				label: () => "节点",
				inject: () => ({ rpc, workspaces: ctx.workspaces, sessions: ctx.sessions }),
			}, DistributedControlActions));
			ctx.slots.inject("sidebar.workspaces.remoteHosts", () => ctx.slots.register({
				name: "sidebar.workspaces.remoteHosts",
				id: "@local/dsh-ssh-gui-remote-hosts",
				order: 10,
				label: () => "分布式节点",
				inject: () => ({ rpc, workspaces: ctx.workspaces, sessions: ctx.sessions }),
			}, SidebarDistributedNodesTree));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
