window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-taste",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region dsh-taste Web GUI (gui-design.md §3/§4; gui-mutation-design §4) — handwritten, build-free client bundle.
		// Viewer + curated mutations for the taste library: per-source tabs
		// (global / project / Command Code), category → file → entry folding,
		// confidence bars, a learning/injection/queue/breaker status strip, an
		// inline two-step entry delete (Command Code stays read-only), and a
		// learner model-route form fed by the settings.yaml registry. Data comes
		// from the host's `/taste` RPC channel via ctx.connection.rpc (design §0
		// 裁定 B); 10s polling while the panel is open replaces push, and every
		// mutation triggers an immediate refresh.
		//#endregion
		//#region styles (data-plugin style + --dsw-* tokens, official idiom)
		const css = ".ts_root{position:fixed;top:12px;right:12px;bottom:12px;z-index:40;box-sizing:border-box;width:480px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);border-radius:12px;box-shadow:var(--dsw-shadow-lv3);pointer-events:auto}.ts_header{box-sizing:border-box;flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex;border-bottom:1px solid var(--dsw-alias-border-l1)}.ts_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px}.ts_headerActions{align-items:center;gap:6px;display:flex}.ts_iconBtn{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:none;border:none;border-radius:999px;justify-content:center;align-items:center;padding:0;display:inline-flex}.ts_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.ts_iconBtn:disabled{opacity:.4;cursor:default}.ts_spin{display:inline-flex;animation:ts_spin 1s linear infinite}@keyframes ts_spin{to{transform:rotate(360deg)}}.ts_status{box-sizing:border-box;flex:none;flex-wrap:wrap;gap:6px;padding:8px 12px;display:flex;border-bottom:1px solid var(--dsw-alias-border-l1)}.ts_chip{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:10px;padding:2px 8px;font-size:11px;line-height:16px;display:inline-flex}.ts_chipOn{color:var(--dsw-alias-state-success-primary)}.ts_chipOff{color:var(--dsw-alias-label-caption)}.ts_chipWarn{color:var(--dsw-alias-state-warn-primary)}.ts_error{box-sizing:border-box;flex:none;margin:8px 12px 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.ts_errorDetail{color:var(--dsw-alias-label-caption);font-family:var(--ds-font-family-code,monospace);font-size:11px;word-break:break-all}.ts_body{flex:1;min-height:0;display:flex;flex-direction:column;padding:8px 12px 12px}.ts_tabs{flex:none;gap:4px;margin-bottom:8px;display:flex}.ts_tab{color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font:inherit;font-size:12px}.ts_tab:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.ts_tab:disabled{opacity:.4;cursor:default}.ts_tabActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);border-color:var(--dsw-alias-border-inverted)}.ts_scopeBody{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px}.ts_cat{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;flex:none}.ts_catHead{width:100%;color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:none;align-items:center;gap:6px;padding:6px 10px;font:inherit;font-size:12px;font-weight:500;display:flex;text-align:left}.ts_catHead:hover{background:var(--dsw-alias-interactive-bg-hover)}.ts_chevron{flex:none;color:var(--dsw-alias-label-caption);transition:transform .12s;display:inline-flex}.ts_chevronClosed{transform:rotate(-90deg)}.ts_catName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ts_catCount{color:var(--dsw-alias-label-caption);margin-left:auto;flex:none;font-size:11px}.ts_catFiles{display:flex;flex-direction:column;padding:2px 0 6px}.ts_file{display:flex;flex-direction:column}.ts_fileHead{width:100%;color:var(--dsw-alias-label-primary);cursor:pointer;background:none;border:none;align-items:center;gap:6px;padding:4px 10px 4px 18px;font:inherit;font-size:12px;display:flex;text-align:left}.ts_fileHead:hover{background:var(--dsw-alias-interactive-bg-hover)}.ts_fileName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,monospace);font-size:11px}.ts_fileCount{color:var(--dsw-alias-label-caption);margin-left:auto;flex:none;font-size:11px}.ts_entries{display:flex;flex-direction:column;gap:6px;padding:2px 10px 8px 26px}.ts_entry{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;display:flex;flex-direction:column;gap:4px}.ts_entryText{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;word-break:break-word}.ts_entryMeta{align-items:center;gap:8px;display:flex}.ts_entryConfLabel{color:var(--dsw-alias-label-caption);flex:none;font-size:11px;font-variant-numeric:tabular-nums}.ts_barTrack{background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;flex:1;height:4px;overflow:hidden}.ts_barFill{height:100%;border-radius:999px}.ts_barHigh{background:var(--dsw-alias-state-success-primary)}.ts_barMid{background:var(--dsw-alias-state-warn-primary)}.ts_barLow{background:var(--dsw-alias-label-tertiary)}.ts_empty{color:var(--dsw-alias-label-tertiary);padding:16px 4px;text-align:center;font-size:12px}.ts_emptyAll{color:var(--dsw-alias-label-tertiary);margin:auto;padding:24px;text-align:center;font-size:13px;line-height:20px}.ts_trigger{height:36px;max-width:100%;color:var(--dsw-alias-label-primary);cursor:pointer;background:none;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 10px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}.ts_trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}.ts_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.ts_iconBtnActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.ts_deleteBtn{flex:none;color:var(--dsw-alias-label-tertiary)}.ts_deleteBtn:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}.ts_readonly{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-interactive-bg-hover);border-radius:8px;padding:0 6px;margin-left:6px;font-size:10px;line-height:14px;display:inline-flex;vertical-align:1px}.ts_confirm{align-items:center;gap:8px;flex-wrap:wrap;border-top:1px dashed var(--dsw-alias-border-l2);padding-top:6px;display:flex}.ts_confirmText{color:var(--dsw-alias-state-warn-primary);flex:none;font-size:11px}.ts_confirmOk{color:var(--dsw-alias-state-error-primary);background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;padding:2px 8px;font:inherit;font-size:11px}.ts_confirmOk:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.ts_confirmOk:disabled{opacity:.4;cursor:default}.ts_confirmCancel{color:var(--dsw-alias-label-secondary);background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;padding:2px 8px;font:inherit;font-size:11px}.ts_confirmCancel:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.ts_confirmCancel:disabled{opacity:.4;cursor:default}.ts_actionError{margin:8px 12px 0;margin-bottom:0}.ts_settings{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:12px}.ts_settingsTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}.ts_field{display:flex;flex-direction:column;gap:4px}.ts_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:11px}.ts_fieldRow{align-items:center;gap:8px;display:flex}.ts_input{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px}.ts_modeRow{gap:4px;display:flex}.ts_modeToggle{color:var(--dsw-alias-label-secondary);background:none;border:none;cursor:pointer;padding:0;font:inherit;font-size:11px;text-decoration:underline}.ts_modeToggle:hover{color:var(--dsw-alias-label-primary)}.ts_hint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}.ts_saveRow{align-items:center;gap:8px;display:flex}.ts_saveBtn{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-border-inverted);border-radius:999px;cursor:pointer;padding:4px 14px;font:inherit;font-size:12px}.ts_saveBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.ts_saveBtn:disabled{opacity:.4;cursor:default}.ts_saved{color:var(--dsw-alias-state-success-primary);font-size:11px}";
		const tagId = "@deepseek-ai/dsh-taste/TastePanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-taste";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region locale dictionaries (zh is the key-set source of truth; en checked complete)
		const NS = "taste";
		const zh = {
			"trigger": "偏好库 (taste)",
			"title": "偏好库 · dsh-taste",
			"tab.global": "全局",
			"tab.project": "项目",
			"tab.commandcode": "Command Code",
			"empty": "该来源暂无偏好条目。",
			"empty.all": "还没有任何偏好。学习开启后，我会在对话中沉淀你的偏好。",
			"empty.gated": "所有偏好条目的置信度都低于注入阈值 {minConfidence}，已全部隐藏。",
			"gated.hint": "已按置信度阈值 {minConfidence} 隐藏 {count} 条低置信度条目",
			"error.load": "加载失败，请重试或查看 host 日志。",
			"loading": "加载中…",
			"refresh": "刷新",
			"confidence": "置信度",
			"entryCount": "{count} 条",
			"status.on": "开",
			"status.off": "关",
			"status.learning.on": "学习：开启",
			"status.learning.off": "学习：关闭",
			"status.injection": "注入：{enabled}（≤{maxChars} 字符，置信度≥{minConfidence}）",
			"status.queue": "队列：{pending} 待处理，{state}",
			"status.queue.idle": "空闲",
			"status.queue.running": "运行中",
			"status.breaker.cooling": "熔断冷却中（约 {minutes} 分钟）",
			"status.breaker.armed": "熔断：已就绪",
			"status.modelMode": "学习模型：{mode}",
			"category.root": "根目录",
			"settings": "模型设置",
			"settings.title": "学习模型路由",
			"settings.mode": "路由模式",
			"settings.mode.inherit": "跟随主模型",
			"settings.mode.custom": "指定模型",
			"settings.provider": "Provider",
			"settings.model": "模型 ID",
			"settings.mode.registry": "从列表选择",
			"settings.mode.free": "手动输入",
			"settings.hint": "列表来自 ~/.dsh/settings.yaml 的 llm-pi-ai 注册表；保存后下个 learner 生效。",
			"settings.registryEmpty": "未解析到该 provider 的模型注册表，可直接输入模型 ID。",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.saved": "已保存，下个 learner 生效",
			"settings.loadError": "设置加载失败。",
			"retry": "重试",
			"delete": "删除",
			"delete.confirm": "删除这条偏好？",
			"delete.ok": "确认删除",
			"cancel": "取消",
			"readonly": "只读",
			"error.action": "操作失败，请重试。",
			"close": "关闭",
		};
		const en = {
			"trigger": "Taste preferences",
			"title": "Preferences · dsh-taste",
			"tab.global": "Global",
			"tab.project": "Project",
			"tab.commandcode": "Command Code",
			"empty": "No preference entries from this source yet.",
			"empty.all": "No preferences yet. Once learning is on, they are distilled from your conversations.",
			"empty.gated": "Every entry is below the injection confidence threshold {minConfidence}; all are hidden.",
			"gated.hint": "{count} entries below the {minConfidence} confidence threshold are hidden",
			"error.load": "Failed to load. Retry or check the host logs.",
			"loading": "Loading…",
			"refresh": "Refresh",
			"confidence": "Confidence",
			"entryCount": "{count} entries",
			"status.on": "on",
			"status.off": "off",
			"status.learning.on": "Learning: on",
			"status.learning.off": "Learning: off",
			"status.injection": "Injection: {enabled} (≤{maxChars} chars, confidence ≥{minConfidence})",
			"status.queue": "Queue: {pending} pending, {state}",
			"status.queue.idle": "idle",
			"status.queue.running": "running",
			"status.breaker.cooling": "Breaker cooling (~{minutes} min)",
			"status.breaker.armed": "Breaker: armed",
			"status.modelMode": "Learning model: {mode}",
			"category.root": "Root",
			"settings": "Model settings",
			"settings.title": "Learner model route",
			"settings.mode": "Route mode",
			"settings.mode.inherit": "Follow main model",
			"settings.mode.custom": "Custom model",
			"settings.provider": "Provider",
			"settings.model": "Model ID",
			"settings.mode.registry": "Pick from list",
			"settings.mode.free": "Type manually",
			"settings.hint": "List from the llm-pi-ai registry in ~/.dsh/settings.yaml; applies from the next learner.",
			"settings.registryEmpty": "No registry parsed for this provider; type the model ID directly.",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.saved": "Saved; applies from the next learner",
			"settings.loadError": "Failed to load settings.",
			"retry": "Retry",
			"delete": "Delete",
			"delete.confirm": "Delete this preference?",
			"delete.ok": "Confirm delete",
			"cancel": "Cancel",
			"readonly": "read-only",
			"error.action": "Action failed. Please retry.",
			"close": "Close",
		};
		//#endregion
		//#region constants
		const POLL_MS = 10_000;
		const CHANNEL = "/taste";
		const TAB_KEYS = { global: "tab.global", project: "tab.project", commandCode: "tab.commandcode" };
		//#endregion
		//#region shared open/close store (factory closure; both slots share it)
		function createTasteStore() {
			let open = false;
			const listeners = new Set();
			const emit = () => {
				for (const listener of [...listeners]) {
					try {
						listener();
					} catch (error) {
						console.error("[dsh-taste] store listener threw:", error);
					}
				}
			};
			const store = {
				toggle() {
					open = !open;
					emit();
				},
				close() {
					if (open) {
						open = false;
						emit();
					}
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot() {
					return open;
				},
				useOpen() {
					return (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
				},
			};
			return store;
		}
		//#endregion
		//#region current-session cwd feed (design §3.3: `sessions` → getTree project source)
		/**
		 * Bind a React hook over the sessions service's list snapshot store and
		 * select the current session's `cwd`. `SessionRuntime.projectList` copies
		 * `entry.cwd` into `byId[id]` (dsh-client-runtime lib/client.js:9233), and
		 * `list` is a bare snapshot store (`subscribe`/`getSnapshot`) — the same
		 * source the renderer's standard `useSessions` hook binds. `apply()`
		 * closes over `ctx.sessions` (declared in the bundle inject, so cordis
		 * gates the property access in) and hands the hook to the panel through
		 * the slot's `inject()` — the project source of `getTree({cwd})`.
		 * A missing or double-shaped sessions service degrades to a hook that
		 * yields `undefined` cwd, which the bridge already renders as
		 * `present: false` (project tab disabled) — never a crash.
		 */
		function createSessionCwdHook(sessions) {
			const list = sessions?.list;
			if (list === void 0 || typeof list.subscribe !== "function" || typeof list.getSnapshot !== "function") {
				return function useSessionCwdAbsent() {
					return void 0;
				};
			}
			// Stable subscribe/getSnapshot closures: useSyncExternalStore
			// resubscribes when its subscribe argument changes identity, and
			// getSnapshot must return an Object.is-stable value — here the cwd
			// string (or undefined), recomputed only on store updates.
			const subscribe = (onStoreChange) => list.subscribe(onStoreChange);
			const getSnapshot = () => {
				const snapshot = list.getSnapshot();
				const id = snapshot?.current;
				return id === void 0 ? void 0 : snapshot.byId?.[id]?.cwd;
			};
			return function useSessionCwd() {
				return (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
			};
		}
		//#endregion
		//#region view helpers
		/** Group one scope's files by their category directory segment (root first). */
		function groupFiles(files) {
			const groups = [];
			const byCategory = new Map();
			for (const file of Array.isArray(files) ? files : []) {
				const relPath = String(file?.relPath ?? "");
				const slash = relPath.indexOf("/");
				const category = slash > 0 ? relPath.slice(0, slash) : "";
				let group = byCategory.get(category);
				if (!group) {
					group = { category, files: [] };
					byCategory.set(category, group);
					groups.push(group);
				}
				group.files.push(file);
			}
			return groups;
		}
		/** Confidence bar tier: ≥0.7 success, 0.4–0.7 warn, <0.4 muted (§4.1). */
		function barClass(confidence) {
			const value = Number(confidence);
			if (!Number.isFinite(value)) return "ts_barLow";
			if (value >= 0.7) return "ts_barHigh";
			if (value >= 0.4) return "ts_barMid";
			return "ts_barLow";
		}
		/**
		 * Injection confidence-gate threshold for display: clamped into [0, 1]
		 * and rendered at two decimals; a missing status falls back to "0.70"
		 * (same default as injection.minConfidence server-side). The bundle
		 * never decides visibility itself — the bridge filters the tree — this
		 * only labels the chip/hints.
		 */
		function thresholdText(status) {
			const value = Number(status?.injection?.minConfidence);
			return (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.7).toFixed(2);
		}
		//#endregion
		//#region components
		/**
		 * entries — except in the read-only Command Code source, which instead
		 * carries an explicit "只读" badge in the same slot.
		 * delete button: backend `read-only-source` refusal is the second half
		 * of that double insurance). The confidence label shows the stored
		 * value at two decimals (`0.88`-style), while the bar width keeps the
		 * integer percent. Writable sources get a trailing delete button; an
		 * inline two-step confirm row (no modal exists in this bundle) renders
		 * as the entry's third row while this entry holds `confirmingKey`.
		 */
		function TasteEntry({ t, entry, scopeName, relPath, deleteControl }) {
			const value = Number(entry?.confidence);
			const text = entry?.statement;
			const conf = Number.isFinite(value) ? value.toFixed(2) : "0.00";
			const pct = Math.round((Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0) * 100);
			const deletable = scopeName !== "commandCode" && deleteControl;
			const entryKey = `${scopeName}\0${relPath ?? ""}\0${entry?.statement ?? ""}`;
			const confirming = deleteControl?.confirmingKey === entryKey;
			const busy = deleteControl?.busy === true;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "ts_entry",
				children: [
					(0, react_jsx_runtime.jsxs)("div", { className: "ts_entryText", children: [
						text,
						scopeName === "commandCode"
							? (0, react_jsx_runtime.jsx)("span", { className: "ts_readonly", children: t("readonly") })
							: null,
					] }),
					(0, react_jsx_runtime.jsxs)("div", { className: "ts_entryMeta", children: [
						(0, react_jsx_runtime.jsx)("span", { className: "ts_entryConfLabel", children: `${t("confidence")} ${conf}` }),
						(0, react_jsx_runtime.jsx)("div", { className: "ts_barTrack", children: (0, react_jsx_runtime.jsx)("div", {
							className: `ts_barFill ${barClass(entry?.confidence)}`,
							style: { width: `${pct}%` },
						}) }),
						deletable ? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "ts_iconBtn ts_deleteBtn",
							"aria-label": t("delete"),
							title: t("delete"),
							disabled: busy,
							onClick: () => deleteControl.onBegin(entryKey),
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, { size: 12 }),
						}) : null,
					] }),
					confirming ? (0, react_jsx_runtime.jsxs)("div", { className: "ts_confirm", children: [
						(0, react_jsx_runtime.jsx)("span", { className: "ts_confirmText", children: t("delete.confirm") }),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "ts_confirmOk",
							disabled: busy,
							onClick: () => deleteControl.onConfirm({ scopeName, relPath, statement: entry?.statement }),
							children: t("delete.ok"),
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "ts_confirmCancel",
							disabled: busy,
							onClick: () => deleteControl.onCancel(),
							children: t("cancel"),
						}),
					] }) : null,
				],
			});
		}

		function TasteFileRow({ t, file, scopeName, collapsedKeys, onToggleKey, deleteControl }) {
			const fileKey = `file:${file?.relPath ?? ""}`;
			const collapsed = collapsedKeys[fileKey] === true;
			return (0, react_jsx_runtime.jsxs)("div", { className: "ts_file", children: [
				(0, react_jsx_runtime.jsxs)("button", { type: "button", className: "ts_fileHead", onClick: () => onToggleKey(fileKey), children: [
					(0, react_jsx_runtime.jsx)("span", { className: `ts_chevron${collapsed ? " ts_chevronClosed" : ""}`, children: "▾" }),
					(0, react_jsx_runtime.jsx)("span", { className: "ts_fileName", children: file?.relPath }),
					(0, react_jsx_runtime.jsx)("span", { className: "ts_fileCount", children: t("entryCount", { count: file?.count ?? 0 }) }),
				] }),
				!collapsed && (0, react_jsx_runtime.jsx)("div", { className: "ts_entries", children: (file?.entries ?? []).map((entry, index) => (0, react_jsx_runtime.jsx)(
					TasteEntry,
					{ t, entry, scopeName, relPath: file?.relPath ?? "", deleteControl },
					index,
				)) }),
			] });
		}

		function TasteCategoryGroup({ t, group, scopeName, collapsedKeys, onToggleKey, deleteControl }) {
			const catKey = `cat:${group.category || "(root)"}`;
			const collapsed = collapsedKeys[catKey] === true;
			const total = group.files.reduce((sum, file) => sum + (file?.count ?? 0), 0);
			return (0, react_jsx_runtime.jsxs)("div", { className: "ts_cat", children: [
				(0, react_jsx_runtime.jsxs)("button", { type: "button", className: "ts_catHead", onClick: () => onToggleKey(catKey), children: [
					(0, react_jsx_runtime.jsx)("span", { className: `ts_chevron${collapsed ? " ts_chevronClosed" : ""}`, children: "▾" }),
					(0, react_jsx_runtime.jsx)("span", { className: "ts_catName", children: group.category || t("category.root") }),
					(0, react_jsx_runtime.jsx)("span", { className: "ts_catCount", children: t("entryCount", { count: total }) }),
				] }),
				!collapsed && (0, react_jsx_runtime.jsx)("div", { className: "ts_catFiles", children: group.files.map((file, index) => (0, react_jsx_runtime.jsx)(
					TasteFileRow,
					{ t, file, scopeName, collapsedKeys, onToggleKey, deleteControl },
					file?.relPath ?? index,
				)) }),
			] });
		}

		function TasteScopeBody({ t, scope, collapsedKeys, onToggleKey, deleteControl }) {
			const files = scope?.files ?? [];
			if (files.length === 0) return (0, react_jsx_runtime.jsx)("div", { className: "ts_empty", children: t("empty") });
			return (0, react_jsx_runtime.jsx)("div", { className: "ts_scopeBody", children: [
				...groupFiles(files).map((group, index) => (0, react_jsx_runtime.jsx)(
					TasteCategoryGroup,
					{ t, group, scopeName: scope?.name, collapsedKeys, onToggleKey, deleteControl },
					group.category || `root:${index}`,
				)),
			] });
		}

		/** Sidebar footer trigger: icon button (label only when wide), toggles the panel. */
		function TasteTrigger({ wide, t, onToggle }) {
			const label = t("trigger");
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label,
				delayMs: 500,
				disabled: wide,
				children: (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "ts_trigger",
					"aria-label": label,
					"data-taste-trigger": true,
					onClick: () => onToggle(),
					children: [
						(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPersonalizationOutline16, { size: wide ? 14 : 18 }),
						wide ? (0, react_jsx_runtime.jsx)("span", { className: "ts_triggerLabel", children: label }) : null,
					],
				}),
			});
		}

		/**
		 * Model settings form (gui-mutation-design §4.4): the learner's observer
		 * route (inherit / custom provider+model). The model field is dual-mode
		 * — a registry `<select>` fed by getSettings' modelsByProvider (the
		 * settings.yaml registry is re-read per call, so registry updates
		 * follow), falling back to a free-text `<input>` whenever the chosen
		 * provider has no registry entries. The form re-syncs whenever fresh
		 * data lands (open / retry / post-save reload), so the authoritative
		 * values always win. Server-side validation is authoritative; the
		 * disabled-save mirror is UX only. No timers: the saved flash clears on
		 * the next edit.
		 */
		function TasteSettings({ t, rpc, data, loadError, onSaved, onRetry }) {
			const [form, setForm] = (0, react.useState)({ modelMode: "inherit", provider: "", model: "" });
			const [inputMode, setInputMode] = (0, react.useState)("registry");
			const [saving, setSaving] = (0, react.useState)(false);
			const [savedFlash, setSavedFlash] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);

			// Resync from authoritative data whenever its reference changes.
			(0, react.useEffect)(() => {
				if (!data?.observer) return;
				setForm({
					modelMode: data.observer.modelMode === "custom" ? "custom" : "inherit",
					provider: String(data.observer.provider ?? ""),
					model: String(data.observer.model ?? ""),
				});
				setSavedFlash(false);
				setSaveError(null);
			}, [data]);

			const registry = (data?.modelsByProvider ?? {})[String(form.provider ?? "").trim()] ?? [];
			const effectiveMode = inputMode === "registry" && registry.length === 0 ? "free" : inputMode;
			const customReady = form.modelMode === "custom" && (!form.provider.trim() || !form.model.trim());

			const edit = (patch) => {
				setForm((previous) => ({ ...previous, ...patch }));
				setSavedFlash(false); // Any edit retires the stale saved flash (no timers).
			};
			const save = async () => {
				if (!rpc || typeof rpc.call !== "function") return;
				setSaving(true);
				setSaveError(null);
				try {
					const result = await rpc.call(CHANNEL, "setObserver", {
						modelMode: form.modelMode,
						provider: form.provider,
						model: form.model,
					});
					if (result?.ok) {
						setSavedFlash(true); // Optimistic feedback; onSaved() then backfills authoritative values.
						await onSaved?.();
					} else {
						setSaveError(result?.error ?? { code: "internal", message: "unknown rpc failure" });
					}
				} catch (cause) {
					setSaveError({ code: "transport", message: String(cause?.message || cause) });
				} finally {
					setSaving(false);
				}
			};

			if (loadError) {
				return (0, react_jsx_runtime.jsxs)("div", { className: "ts_settings", children: [
					(0, react_jsx_runtime.jsx)("div", { className: "ts_settingsTitle", children: t("settings.title") }),
					(0, react_jsx_runtime.jsxs)("div", { className: "ts_error", children: [
						(0, react_jsx_runtime.jsx)("div", { children: t("settings.loadError") }),
						loadError.message ? (0, react_jsx_runtime.jsx)("div", { className: "ts_errorDetail", children: String(loadError.message) }) : null,
					] }),
					(0, react_jsx_runtime.jsx)("div", { className: "ts_saveRow", children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "ts_confirmCancel",
						onClick: () => void onRetry?.(),
						children: t("retry"),
					}) }),
				] });
			}
			if (!data) {
				return (0, react_jsx_runtime.jsx)("div", { className: "ts_settings", children: (0, react_jsx_runtime.jsx)("div", { className: "ts_hint", children: t("loading") }) });
			}
			const pinnedModel = form.model.trim() !== "" && !registry.includes(form.model);
			return (0, react_jsx_runtime.jsxs)("div", { className: "ts_settings", children: [
				(0, react_jsx_runtime.jsx)("div", { className: "ts_settingsTitle", children: t("settings.title") }),
				(0, react_jsx_runtime.jsxs)("div", { className: "ts_field", children: [
					(0, react_jsx_runtime.jsx)("span", { className: "ts_fieldLabel", children: t("settings.mode") }),
					(0, react_jsx_runtime.jsx)("div", { className: "ts_modeRow", children: ["inherit", "custom"].map((mode) => (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: `ts_tab${form.modelMode === mode ? " ts_tabActive" : ""}`,
						onClick: () => edit({ modelMode: mode }),
						children: t(mode === "inherit" ? "settings.mode.inherit" : "settings.mode.custom"),
					}, mode)) }),
				] }),
				(0, react_jsx_runtime.jsxs)("div", { className: "ts_field", children: [
					(0, react_jsx_runtime.jsx)("span", { className: "ts_fieldLabel", children: t("settings.provider") }),
					(0, react_jsx_runtime.jsx)("input", {
						type: "text",
						className: "ts_input",
						value: form.provider,
						onChange: (event) => edit({ provider: event?.target?.value ?? "" }),
					}),
				] }),
				(0, react_jsx_runtime.jsxs)("div", { className: "ts_field", children: [
					(0, react_jsx_runtime.jsx)("span", { className: "ts_fieldLabel", children: t("settings.model") }),
					(0, react_jsx_runtime.jsxs)("div", { className: "ts_fieldRow", children: [
						effectiveMode === "registry"
							? (0, react_jsx_runtime.jsxs)("select", {
								className: "ts_input",
								value: form.model,
								onChange: (event) => edit({ model: event?.target?.value ?? "" }),
								children: [
									pinnedModel ? (0, react_jsx_runtime.jsx)("option", { value: form.model, children: `${form.model}（当前）` }, "__pinned__") : null,
									registry.map((id) => (0, react_jsx_runtime.jsx)("option", { value: id, children: id }, id)),
								],
							})
							: (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								className: "ts_input",
								value: form.model,
								onChange: (event) => edit({ model: event?.target?.value ?? "" }),
							}),
						registry.length > 0 ? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "ts_modeToggle",
							onClick: () => {
								setInputMode(effectiveMode === "registry" ? "free" : "registry");
								setSavedFlash(false);
							},
							children: t(effectiveMode === "registry" ? "settings.mode.free" : "settings.mode.registry"),
						}) : null,
					] }),
				] }),
				(0, react_jsx_runtime.jsx)("div", { className: "ts_hint", children:
					registry.length === 0 && form.modelMode === "custom" ? t("settings.registryEmpty") : t("settings.hint"),
				}),
				(0, react_jsx_runtime.jsxs)("div", { className: "ts_saveRow", children: [
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "ts_saveBtn",
						disabled: saving || customReady, // Mirrors the server contract; the server stays authoritative.
						onClick: () => void save(),
						children: saving ? t("settings.saving") : t("settings.save"),
					}),
					savedFlash ? (0, react_jsx_runtime.jsx)("span", { className: "ts_saved", children: t("settings.saved") }) : null,
				] }),
				saveError ? (0, react_jsx_runtime.jsxs)("div", { className: "ts_error", children: [
					(0, react_jsx_runtime.jsx)("div", { children: t("error.action") }),
					saveError.message ? (0, react_jsx_runtime.jsx)("div", { className: "ts_errorDetail", children: String(saveError.message) }) : null,
				] }) : null,
			] });
		}

		/** Full overlay panel: closed → null; open → status strip + per-source tabs. */
		function TastePanel({ t, useOpen, rpc, onClose, useSessionCwd }) {
			const open = useOpen();
			const rootRef = (0, react.useRef)(null);
			// Project source: the current session's cwd, subscribed through the
			// inject()-provided sessions feed that apply() binds from
			// ctx.sessions.list (design §3.3). Undefined without an active
			// session — the bridge answers present:false, disabling the tab.
			const cwd = typeof useSessionCwd === "function" ? useSessionCwd() : void 0;
			const [status, setStatus] = (0, react.useState)(null);
			const [tree, setTree] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(false);
			const [tab, setTab] = (0, react.useState)("global");
			const [collapsedKeys, setCollapsedKeys] = (0, react.useState)({});
			// Mutation surfaces (gui-mutation-design §4.1): the settings view, its
			// loaded data, the inline delete confirmation and the last failed
			// action — all panel-internal, the slot inject contract is unchanged.
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const [settings, setSettings] = (0, react.useState)(null);
			const [settingsLoadError, setSettingsLoadError] = (0, react.useState)(null);
			const [confirmingKey, setConfirmingKey] = (0, react.useState)(null);
			const [deleting, setDeleting] = (0, react.useState)(false);
			const [actionError, setActionError] = (0, react.useState)(null);
			const toggleKey = (0, react.useCallback)((key) => {
				setCollapsedKeys((previous) => ({ ...previous, [key]: !previous[key] }));
			}, []);

			// One manual/auto refresh: getTree + getStatus in parallel. The host
			// handler never throws; it answers {ok,value}|{ok,error}.
			const refresh = (0, react.useCallback)(async () => {
				if (!rpc || typeof rpc.call !== "function") return;
				setLoading(true);
				try {
					const [treeResult, statusResult] = await Promise.all([
						rpc.call(CHANNEL, "getTree", { cwd }),
						rpc.call(CHANNEL, "getStatus", {}),
					]);
					if (treeResult?.ok && statusResult?.ok) {
						setTree(treeResult.value);
						setStatus(statusResult.value);
						setError(null);
					} else {
						const failure = (treeResult && !treeResult.ok && treeResult.error) || (statusResult && !statusResult.ok && statusResult.error) || null;
						setError(failure ?? { code: "internal", message: "unknown rpc failure" });
					}
				} catch (cause) {
					setError({ code: "transport", message: String((cause && cause.message) || cause) });
				} finally {
					setLoading(false);
				}
			}, [rpc, cwd]);

			// Settings feed (gui-mutation-design §4.4): loaded when the settings
			// view opens — every open re-pulls getSettings, so the settings.yaml
			// registry is never stale by more than one interaction.
			const reloadSettings = (0, react.useCallback)(async () => {
				if (!rpc || typeof rpc.call !== "function") return;
				try {
					const result = await rpc.call(CHANNEL, "getSettings", {});
					if (result?.ok) {
						setSettings(result.value);
						setSettingsLoadError(null);
					} else {
						setSettingsLoadError(result?.error ?? { code: "internal", message: "unknown rpc failure" });
					}
				} catch (cause) {
					setSettingsLoadError({ code: "transport", message: String((cause && cause.message) || cause) });
				}
			}, [rpc]);
			(0, react.useEffect)(() => {
				if (settingsOpen) void reloadSettings();
			}, [settingsOpen, reloadSettings]);

			// After a saved route: backfill the form with authoritative values and
			// refresh the status strip so the modelMode chip updates immediately.
			const onSettingsSaved = (0, react.useCallback)(async () => {
				await reloadSettings();
				void refresh();
			}, [reloadSettings, refresh]);

			// GUI delete (gui-mutation-design §4.5): one RPC, then refresh on BOTH
			// outcomes — success shows the removal, failure resyncs (e.g. a
			// concurrent learner/forget already removed it → not-found). No
			// optimistic tree rewriting: the poll/refresh last-writer-wins keeps
			// the view convergent.
			const confirmDelete = (0, react.useCallback)(async ({ scopeName, relPath, statement }) => {
				if (!rpc || typeof rpc.call !== "function") return;
				setDeleting(true);
				try {
					const result = await rpc.call(CHANNEL, "deleteEntry", { scope: scopeName, relPath, statement, cwd });
					if (result?.ok) {
						setConfirmingKey(null);
						setActionError(null);
					} else {
						setConfirmingKey(null);
						setActionError(result?.error ?? { code: "internal", message: "unknown rpc failure" });
					}
					void refresh();
				} catch (cause) {
					setActionError({ code: "transport", message: String((cause && cause.message) || cause) });
				} finally {
					setDeleting(false);
				}
			}, [rpc, cwd, refresh]);
			const beginDelete = (0, react.useCallback)((key) => {
				setConfirmingKey(key);
				setActionError(null);
			}, []);
			const cancelDelete = (0, react.useCallback)(() => setConfirmingKey(null), []);
			const deleteControl = {
				confirmingKey,
				busy: deleting,
				onBegin: beginDelete,
				onConfirm: confirmDelete,
				onCancel: cancelDelete,
			};

			// 10s polling runs only while the panel is open; close/unmount clears it.
			(0, react.useEffect)(() => {
				if (!open) return undefined;
				let cancelled = false;
				const tick = () => {
					if (!cancelled) void refresh();
				};
				tick();
				const timer = setInterval(tick, POLL_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [open, refresh]);

			// Esc / click outside (except the trigger) closes the panel (§4.3).
			(0, react.useEffect)(() => {
				if (!open || typeof document === "undefined") return undefined;
				const onKeyDown = (event) => {
					if (event.key === "Escape") onClose();
				};
				const onMouseDown = (event) => {
					const target = event.target;
					if (rootRef.current && target instanceof Node && !rootRef.current.contains(target)) {
						const fromTrigger = target.closest ? target.closest("[data-taste-trigger]") : null;
						if (!fromTrigger) onClose();
					}
				};
				document.addEventListener("keydown", onKeyDown);
				document.addEventListener("mousedown", onMouseDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
					document.removeEventListener("mousedown", onMouseDown);
				};
			}, [open, onClose]);

			if (!open) return null;
			const scopes = tree?.scopes ?? [];
			const activeScope = scopes.find((scope) => scope.name === tab && scope.present !== false)
				?? scopes.find((scope) => scope.name === "global")
				?? scopes[0];
			const totalEntries = scopes.reduce((sum, scope) => sum + (scope?.files ?? []).reduce((inner, file) => inner + (file?.count ?? 0), 0), 0);
			const breakerMinutes = status ? Math.max(0, Math.ceil(((status.queue?.cooldownUntil ?? 0) - Date.now()) / 60_000)) : 0;
			return (0, react_jsx_runtime.jsxs)("div", { className: "ts_root", ref: rootRef, children: [
				(0, react_jsx_runtime.jsxs)("div", { className: "ts_header", children: [
					(0, react_jsx_runtime.jsx)("div", { className: "ts_title", children: t("title") }),
					(0, react_jsx_runtime.jsxs)("div", { className: "ts_headerActions", children: [
						(0, react_jsx_runtime.jsx)("button", { type: "button", className: "ts_iconBtn", onClick: () => void refresh(), disabled: loading, "aria-label": t("refresh"), title: t("refresh"), children: (0, react_jsx_runtime.jsx)("span", { className: loading ? "ts_spin" : void 0, children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, { size: 14 }) }) }),
						(0, react_jsx_runtime.jsx)("button", { type: "button", className: `ts_iconBtn${settingsOpen ? " ts_iconBtnActive" : ""}`, onClick: () => setSettingsOpen((open) => !open), "aria-label": t("settings"), title: t("settings"), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutline16, { size: 14 }) }),
						(0, react_jsx_runtime.jsx)("button", { type: "button", className: "ts_iconBtn", onClick: () => onClose(), "aria-label": t("close"), title: t("close"), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 }) }),
					] }),
				] }),
				status && (0, react_jsx_runtime.jsxs)("div", { className: "ts_status", children: [
					(0, react_jsx_runtime.jsx)("span", { className: `ts_chip ${status.learning ? "ts_chipOn" : "ts_chipOff"}`, children: t(status.learning ? "status.learning.on" : "status.learning.off") }),
					(0, react_jsx_runtime.jsx)("span", { className: "ts_chip", children: t("status.injection", {
						enabled: status.injection?.enabled ? t("status.on") : t("status.off"),
						maxChars: status.injection?.maxChars ?? 0,
						minConfidence: thresholdText(status),
					}) }),
					(0, react_jsx_runtime.jsx)("span", { className: "ts_chip", children: t("status.queue", {
						pending: status.queue?.pending ?? 0,
						state: status.queue?.running ? t("status.queue.running") : t("status.queue.idle"),
					}) }),
					(0, react_jsx_runtime.jsx)("span", { className: `ts_chip${status.breakerCooling ? " ts_chipWarn" : ""}`, children: status.breakerCooling
						? t("status.breaker.cooling", { minutes: breakerMinutes })
						: t("status.breaker.armed") }),
					(0, react_jsx_runtime.jsx)("span", { className: "ts_chip", children: t("status.modelMode", { mode: status.modelMode ?? "inherit" }) }),
				] }),
				error && (0, react_jsx_runtime.jsxs)("div", { className: "ts_error", children: [
					(0, react_jsx_runtime.jsx)("div", { children: t("error.load") }),
					error.message ? (0, react_jsx_runtime.jsx)("div", { className: "ts_errorDetail", children: String(error.message) }) : null,
				] }),
				actionError && (0, react_jsx_runtime.jsxs)("div", { className: "ts_error ts_actionError", children: [
					(0, react_jsx_runtime.jsx)("div", { children: t("error.action") }),
					actionError.message ? (0, react_jsx_runtime.jsx)("div", { className: "ts_errorDetail", children: String(actionError.message) }) : null,
				] }),
				settingsOpen
					? (0, react_jsx_runtime.jsx)(TasteSettings, { t, rpc, data: settings, loadError: settingsLoadError, onSaved: onSettingsSaved, onRetry: reloadSettings })
					: tree === null && !error
						? (0, react_jsx_runtime.jsx)("div", { className: "ts_emptyAll", children: t("loading") })
						: tree !== null && totalEntries === 0 && !error
							? (0, react_jsx_runtime.jsx)("div", { className: "ts_emptyAll", children: tree.gatedCount > 0
								? t("empty.gated", { minConfidence: thresholdText(status) })
								: t("empty.all") })
							: (0, react_jsx_runtime.jsxs)("div", { className: "ts_body", children: [
								(0, react_jsx_runtime.jsx)("div", { className: "ts_tabs", children: scopes.map((scope) => (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `ts_tab${activeScope && scope.name === activeScope.name ? " ts_tabActive" : ""}`,
									disabled: scope.present === false,
									onClick: () => setTab(scope.name),
									children: t(TAB_KEYS[scope.name] ?? scope.name),
								}, scope.name)) }),
								tree?.gatedCount > 0 ? (0, react_jsx_runtime.jsx)("div", {
									className: "ts_hint",
									children: t("gated.hint", { count: tree.gatedCount, minConfidence: thresholdText(status) }),
								}) : null,
								activeScope ? (0, react_jsx_runtime.jsx)(TasteScopeBody, { t, scope: activeScope, collapsedKeys, onToggleKey: toggleKey, deleteControl }) : null,
							] }),
			] });
		}
		//#endregion
		//#region plugin face (bundle exports.inject = service names; apply registers slots)
		const inject = ["slots", "locale", "connection", "sessions"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-taste: dictionaries");
			// Module-level open/close store shared by both slots (factory closure).
			const store = createTasteStore();
			const rpc = ctx.connection.rpc;
			// Sessions feed (design §3.3): `sessions` is a declared inject service
			// (cordis gates ctx.sessions on the bundle's inject list), so bind the
			// cwd hook once here and hand it to the panel through the slot inject.
			const useSessionCwd = createSessionCwdHook(ctx.sessions);
			// Entry slot: sidebar footer icon button (declared by dsh-client-ui-sidebar).
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "taste",
				order: 90,
				locale: NS,
				inject: () => ({ onToggle: () => store.toggle() }),
			}, TasteTrigger));
			// Panel slot: app-wide floating surface (declared by dsh-client-ui-layout;
			// closed → renders null, so it costs nothing while dismissed).
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "taste-panel",
				order: 100,
				locale: NS,
				inject: () => ({ useOpen: () => store.useOpen(), rpc, onClose: () => store.close(), useSessionCwd }),
			}, TastePanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
