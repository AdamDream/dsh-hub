window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-vision-adam",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region dsh-vision-adam Web GUI — handwritten, build-free client bundle.
		// Settings section for the vision-adam plugin (host Config keys, same
		// defaults): model / baseURL / apiKeyEnv / maxTokens. Reads and writes the
		// `vision-adam` section of settings.yaml through the settings-namespace
		// scope contract (`ctx.settingsScope.bind`), the exact transport the
		// official settings pages use. Field-level writes only — untouched keys
		// (apiKey / maxBytes / maxVideoBytes / xApiKey / sessionHeader) are never
		// rewritten or cleared, so old configs stay compatible.
		//#endregion
		//#region styles (settings-page idiom, --dsw-* tokens)
		const css = ".vva_root{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;font-size:13px;line-height:20px}.vva_title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600}.vva_sub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}.vva_form{display:flex;flex-direction:column;gap:10px;max-width:520px}.vva_field{display:flex;flex-direction:column;gap:4px}.vva_label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}.vva_hint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:15px}.vva_input{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px}.vva_input:focus{outline:none;border-color:var(--dsw-alias-border-inverted)}.vva_toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.vva_btn{color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-border-inverted);border-radius:8px;padding:4px 12px;font:inherit;font-size:12px}.vva_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.vva_btn:disabled{opacity:.45;cursor:default}.vva_ok{color:var(--dsw-alias-state-success-primary,var(--dsw-state-success-primary));font-size:12px}.vva_error{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px}.vva_note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}";
		const tagId = "@deepseek-ai/dsh-vision-adam/settings-section.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-vision-adam";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region section model
		/** The four editable fields (host Config keys; apiKey and the advanced flags stay untouched). */
		const FIELDS = [
			{ key: "model", label: "识图模型", type: "text", hint: "vision-adam 请求所用的视觉模型 id。默认 deepseek-v4.1-flash（opencode 网关实测可看图）。" },
			{ key: "baseURL", label: "网关 Base URL", type: "text", hint: "OpenAI 兼容 /chat/completions 网关。默认 https://opencode.ai/zen/go/v1。" },
			{ key: "apiKeyEnv", label: "API Key 凭据引用", type: "text", hint: "凭据服务/启动环境中的键名，每次分析时解析。默认 OPENCODE_GO_API_KEY。" },
			{ key: "maxTokens", label: "单次分析最大输出 tokens", type: "number", hint: "正整数。默认 2000。" },
		];
		function stringOf(value) {
			return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
		}
		/** Draft for one snapshot: effective values as form strings, empty when unavailable. */
		function draftFrom(snapshot) {
			const value = snapshot && snapshot.status === "ready" && snapshot.value !== void 0 ? snapshot.value : void 0;
			const out = {};
			for (const field of FIELDS) out[field.key] = value === void 0 ? "" : stringOf(value[field.key]);
			return out;
		}
		/** The raw user-layer value of one field, or undefined when not stored. */
		function userValueOf(snapshot, key) {
			const user = snapshot && typeof snapshot.user === "object" && snapshot.user !== null ? snapshot.user : void 0;
			return user === void 0 ? void 0 : user[key];
		}
		/**
		 * Collect the write ops for a save: a field is written only when its form
		 * value differs from what the document already carries (user layer when
		 * stored, effective value otherwise); an emptied field becomes an unset so
		 * it re-inherits the schema default. Untouched fields produce no op.
		 */
		function saveOps(snapshot, draft) {
			const ops = [];
			for (const field of FIELDS) {
				const input = stringOf(draft[field.key]).trim();
				if (input === "") {
					if (userValueOf(snapshot, field.key) !== void 0) ops.push({ field: field.key, op: "unset" });
					continue;
				}
				const stored = userValueOf(snapshot, field.key);
				const target = stored === void 0 ? stringOf(snapshot && snapshot.value !== void 0 ? snapshot.value[field.key] : void 0) : stringOf(stored);
				if (input === target) continue;
				ops.push({ field: field.key, op: "set", value: field.key === "maxTokens" ? Number(input) : input });
			}
			return ops;
		}
		/** The four fields' effective values shown as the current configuration line. */
		function effectiveLine(snapshot) {
			if (snapshot === void 0 || snapshot.status !== "ready" || snapshot.value === void 0) return "";
			const value = snapshot.value;
			return "当前生效：model=" + stringOf(value.model)
				+ " · baseURL=" + stringOf(value.baseURL)
				+ " · apiKeyEnv=" + stringOf(value.apiKeyEnv)
				+ " · maxTokens=" + stringOf(value.maxTokens);
		}
		//#endregion
		//#region section component
		/** The `settings.section` component for vision-adam (controlled form + save). */
		function VisionAdamSection(props) {
			const scope = props.scope;
			const [draft, setDraft] = react.useState({});
			const [ready, setReady] = react.useState(false);
			const [unavailable, setUnavailable] = react.useState("");
			const [message, setMessage] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			react.useEffect(() => {
				if (scope === void 0 || typeof scope.subscribe !== "function") {
					setUnavailable("settingsScope 服务不可用：vision-adam 设置页无法读取配置。");
					return;
				}
				const apply = () => {
					let snapshot;
					try {
						snapshot = scope.getSnapshot();
					} catch {
						setUnavailable("读取 vision-adam 配置失败。");
						return;
					}
					if (snapshot === void 0) return;
					if (snapshot.status === "unavailable") {
						setUnavailable("vision-adam 配置不可用：设置命名空间未注册（vision-adam 插件未加载？）或当前连接不支持写入。");
						return;
					}
					if (snapshot.status === "loading") return;
					setReady(true);
					setUnavailable("");
					setDraft(draftFrom(snapshot));
				};
				const unsubscribe = scope.subscribe(apply);
				apply();
				return () => {
					if (typeof unsubscribe === "function") unsubscribe();
				};
			}, [scope]);
			const onSave = async () => {
				if (scope === void 0 || busy) return;
				setBusy(true);
				setMessage(null);
				try {
					let snapshot;
					try {
						snapshot = scope.getSnapshot();
					} catch (error) {
						throw error;
					}
					if (snapshot === void 0 || snapshot.status !== "ready") throw new Error("vision-adam 配置尚未就绪。");
					if (snapshot.mode !== "host") throw new Error("当前连接为 memory 模式，写入不会持久化到 settings.yaml。");
					const ops = saveOps(snapshot, draft);
					if (ops.length === 0) {
						setMessage({ kind: "ok", text: "没有需要保存的改动。" });
						return;
					}
					for (const op of ops) {
						if (op.op === "unset") await scope.unset(op.field);
						else await scope.set(op.field, op.value);
					}
					setMessage({ kind: "ok", text: "已保存 " + ops.length + " 项到 settings.yaml 的 vision-adam 段（" + ops.map((op) => op.field).join("、") + "）。" });
				} catch (error) {
					setMessage({ kind: "error", text: "保存失败：" + (error instanceof Error ? error.message : String(error)) });
				} finally {
					setBusy(false);
				}
			};
			const onReset = async () => {
				if (scope === void 0 || busy) return;
				setBusy(true);
				setMessage(null);
				try {
					const snapshot = scope.getSnapshot();
					if (snapshot === void 0 || snapshot.status !== "ready") throw new Error("vision-adam 配置尚未就绪。");
					for (const field of FIELDS) {
						if (userValueOf(snapshot, field.key) !== void 0) await scope.unset(field.key);
					}
					setMessage({ kind: "ok", text: "已清除 vision-adam 段的覆盖项，恢复为插件默认值。" });
				} catch (error) {
					setMessage({ kind: "error", text: "恢复默认失败：" + (error instanceof Error ? error.message : String(error)) });
				} finally {
					setBusy(false);
				}
			};
			const setField = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
			const children = [];
			children.push(react.createElement("div", { className: "vva_title" }, "vision-adam 识图设置"));
			children.push(react.createElement("div", { className: "vva_sub" }, "图片/视频转文本工具（analyze_image 与 btw 图片分析的视觉模型配置）。保存后写入 settings.yaml 的 vision-adam 段；键名与插件 Config 一致，旧配置未涉及的字段保持默认值。" + (ready ? " " + effectiveLine(scope !== void 0 ? scope.getSnapshot() : void 0) : "")));
			if (unavailable !== "") {
				children.push(react.createElement("div", { className: "vva_error" }, unavailable));
				return react.createElement.apply(react, ["div", { className: "vva_root" }].concat(children));
			}
			children.push(react.createElement("div", { className: "vva_form" }, FIELDS.map((field) => react.createElement("div", { className: "vva_field", key: field.key },
				react.createElement("label", { className: "vva_label", htmlFor: "vva-" + field.key }, field.label),
				react.createElement("input", {
					id: "vva-" + field.key,
					className: "vva_input",
					type: field.type,
					value: stringOf(draft[field.key]),
					onChange: (event) => setField(field.key, event.target.value),
				}),
				react.createElement("div", { className: "vva_hint" }, field.hint)))));
			children.push(react.createElement("div", { className: "vva_toolbar" },
				react.createElement("button", { type: "button", className: "vva_btn", disabled: busy, onClick: () => void onSave() }, busy ? "保存中…" : "保存到 settings.yaml"),
				react.createElement("button", { type: "button", className: "vva_btn", disabled: busy, onClick: () => void onReset() }, "恢复默认")));
			if (message !== null) children.push(react.createElement("div", { className: message.kind === "ok" ? "vva_ok" : "vva_error" }, message.text));
			children.push(react.createElement("div", { className: "vva_note" }, "注意：apiKey（字面密钥）、maxBytes、maxVideoBytes、xApiKey、sessionHeader 等键不在本页编辑，保存不会改动它们。"));
			return react.createElement.apply(react, ["div", { className: "vva_root" }].concat(children));
		}
		//#endregion
		//#region plugin face (bundle exports.inject = service names; apply registers the settings section)
		const inject = ["slots", "settingsScope"];
		function apply(ctx) {
			let scope;
			try {
				scope = ctx.settingsScope.bind({ namespace: "vision-adam" });
			} catch (error) {
				ctx.logger?.warn?.("vision-adam: settingsScope 不可用，设置页将显示不可用状态: " + (error instanceof Error ? error.message : String(error)));
			}
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "@deepseek-ai/dsh-vision-adam",
				order: 60,
				label: "vision-adam 识图设置",
				inject: () => ({ scope }),
			}, VisionAdamSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
