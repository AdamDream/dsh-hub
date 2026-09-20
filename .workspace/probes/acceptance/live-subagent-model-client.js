window.__ModuleLoader__.load({
	id: "@local/dsh-subagent-model",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region @local/dsh-subagent-model Web GUI — handwritten, build-free client bundle.
		// Settings section for the subagent default route (P0 of
		// .workspace/subagent-model-gui-audit.md): provider / model selects fed
		// from the `llm-pi-ai` settings namespace (same fact source as the model
		// catalog — settings.yaml `llm-pi-ai.providers.*.models`, hot), writing
		// the `dsh-subagent` section of settings.yaml through the
		// settings-namespace scope contract (`ctx.settingsScope.bind`), the exact
		// transport the official settings pages use. Field-level writes only —
		// untouched keys are never rewritten or cleared. Emptying a field unsets
		// it so it re-inherits the preset default (adam / deepseek-v4.1-flash).
		//#endregion
		//#region styles (settings-page idiom, --dsw-* tokens)
		const css = ".smm_root{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;font-size:13px;line-height:20px}.smm_title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600}.smm_sub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}.smm_form{display:flex;flex-direction:column;gap:10px;max-width:520px}.smm_field{display:flex;flex-direction:column;gap:4px}.smm_label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}.smm_hint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:15px}.smm_input{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px}.smm_input:focus{outline:none;border-color:var(--dsw-alias-border-inverted)}.smm_select{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px}.smm_select:focus{outline:none;border-color:var(--dsw-alias-border-inverted)}.smm_toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.smm_btn{color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-border-inverted);border-radius:8px;padding:4px 12px;font:inherit;font-size:12px}.smm_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.smm_btn:disabled{opacity:.45;cursor:default}.smm_ok{color:var(--dsw-alias-state-success-primary,var(--dsw-state-success-primary));font-size:12px}.smm_error{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px}.smm_note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}";
		const tagId = "@local/dsh-subagent-model/settings-section.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@local/dsh-subagent-model";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region section model
		/** The two editable fields (host Config keys). */
		const FIELDS = [
			{ key: "provider", label: "Provider", hint: "子代理 LLM 网关。默认 adam（preset standard-glm 固定路由）。" },
			{ key: "model", label: "Model", hint: "子代理默认模型 id。默认 deepseek-v4.1-flash。" },
		];
		/** Preset fixed route shown as the fallback default. */
		const DEFAULT_ROUTE = { provider: "adam", model: "deepseek-v4.1-flash" };
		function stringOf(value) {
			return typeof value === "string" ? value : "";
		}
		/** Draft for one snapshot: effective values as strings, empty when unavailable. */
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
		 * it re-inherits the preset default. Untouched fields produce no op.
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
				ops.push({ field: field.key, op: "set", value: input });
			}
			return ops;
		}
		/** Whether the user layer overrides either route field. */
		function overridden(snapshot) {
			return userValueOf(snapshot, "provider") !== void 0 || userValueOf(snapshot, "model") !== void 0;
		}
		/** The effective route shown as the current configuration line. */
		function effectiveLine(snapshot) {
			if (snapshot === void 0 || snapshot.status !== "ready" || snapshot.value === void 0) return "";
			const value = snapshot.value;
			return "当前生效：provider=" + stringOf(value.provider)
				+ " · model=" + stringOf(value.model)
				+ (overridden(snapshot) ? "（settings 段覆盖 preset 默认 " + DEFAULT_ROUTE.provider + "/" + DEFAULT_ROUTE.model + "）" : "（无覆盖 = preset 默认 " + DEFAULT_ROUTE.provider + "/" + DEFAULT_ROUTE.model + "）");
		}
		/**
		 * Read the `llm-pi-ai` namespace snapshot into a provider list
		 * ([{id, models: string[]}]), or undefined when unavailable.
		 */
		function catalogOf(snapshot) {
			if (snapshot === void 0 || snapshot.status !== "ready" || snapshot.value === void 0) return void 0;
			const providers = snapshot.value.providers;
			if (typeof providers !== "object" || providers === null) return void 0;
			const out = [];
			for (const [id, profile] of Object.entries(providers)) {
				const models = (profile && Array.isArray(profile.models) ? profile.models : [])
					.map((entry) => (entry && typeof entry.id === "string" ? entry.id : ""))
					.filter((modelId) => modelId.length > 0);
				out.push({ id, models });
			}
			return out;
		}
		/** Option ids, keeping the current value visible even when it is not catalogued. */
		function optionsFor(ids, current) {
			const seen = new Set();
			const out = [];
			for (const id of ids) {
				if (seen.has(id)) continue;
				seen.add(id);
				out.push(id);
			}
			if (current !== "" && !seen.has(current)) out.push(current);
			return out;
		}
		//#endregion
		//#region section component
		/** The `settings.section` component for dsh-subagent-model (controlled form + save). */
		function SubagentModelSection(props) {
			const scope = props.scope;
			const catalogScope = props.catalogScope;
			const [draft, setDraft] = react.useState({});
			const [ready, setReady] = react.useState(false);
			const [catalog, setCatalog] = react.useState(void 0);
			const [unavailable, setUnavailable] = react.useState("");
			const [message, setMessage] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			react.useEffect(() => {
				if (scope === void 0 || typeof scope.subscribe !== "function") {
					setUnavailable("settingsScope 服务不可用：无法读取子代理模型配置。");
					return;
				}
				const apply = () => {
					let snapshot;
					try {
						snapshot = scope.getSnapshot();
					} catch {
						setUnavailable("读取 dsh-subagent 配置失败。");
						return;
					}
					if (snapshot === void 0) return;
					if (snapshot.status === "unavailable") {
						setUnavailable("dsh-subagent 配置不可用：设置命名空间未注册（@local/dsh-subagent-model 插件未加载？）或当前连接不支持写入。");
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
			react.useEffect(() => {
				if (catalogScope === void 0 || typeof catalogScope.subscribe !== "function") {
					setCatalog(void 0);
					return;
				}
				const apply = () => {
					let snapshot;
					try {
						snapshot = catalogScope.getSnapshot();
					} catch {
						setCatalog(void 0);
						return;
					}
					if (snapshot === void 0 || snapshot.status !== "ready") {
						setCatalog(void 0);
						return;
					}
					setCatalog(catalogOf(snapshot));
				};
				const unsubscribe = catalogScope.subscribe(apply);
				apply();
				return () => {
					if (typeof unsubscribe === "function") unsubscribe();
				};
			}, [catalogScope]);
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
					if (snapshot === void 0 || snapshot.status !== "ready") throw new Error("dsh-subagent 配置尚未就绪。");
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
					setMessage({ kind: "ok", text: "已保存 " + ops.length + " 项到 settings.yaml 的 dsh-subagent 段（" + ops.map((op) => op.field).join("、") + "）。" });
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
					if (snapshot === void 0 || snapshot.status !== "ready") throw new Error("dsh-subagent 配置尚未就绪。");
					for (const field of FIELDS) {
						if (userValueOf(snapshot, field.key) !== void 0) await scope.unset(field.key);
					}
					setMessage({ kind: "ok", text: "已清除 dsh-subagent 段的覆盖项，恢复为 preset 默认 " + DEFAULT_ROUTE.provider + "/" + DEFAULT_ROUTE.model + "。" });
				} catch (error) {
					setMessage({ kind: "error", text: "恢复默认失败：" + (error instanceof Error ? error.message : String(error)) });
				} finally {
					setBusy(false);
				}
			};
			const setField = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
			const onProviderChange = (value) => {
				setDraft((current) => {
					const next = { ...current, provider: value, model: "" };
					const entry = catalog && catalog.find((provider) => provider.id === value);
					if (entry && entry.models.length > 0) next.model = entry.models[0];
					return next;
				});
			};
			const catalogReady = Array.isArray(catalog) && catalog.length > 0;
			const providerOptions = catalogReady ? optionsFor(catalog.map((entry) => entry.id), stringOf(draft.provider)) : [];
			const selectedCatalog = catalogReady ? catalog.find((entry) => entry.id === stringOf(draft.provider)) : void 0;
			const modelOptions = catalogReady && selectedCatalog ? optionsFor(selectedCatalog.models, stringOf(draft.model)) : [];
			const children = [];
			children.push(react.createElement("div", { className: "smm_title" }, "子代理模型"));
			children.push(react.createElement("div", { className: "smm_sub" }, "subagent / subagent_fork 派发的默认 LLM 路由。保存后写入 settings.yaml 的 dsh-subagent 段，每次派发热读，立即生效（无需重启）；清空字段恢复 preset 默认。" + (ready ? " " + effectiveLine(scope !== void 0 ? scope.getSnapshot() : void 0) : "")));
			if (unavailable !== "") {
				children.push(react.createElement("div", { className: "smm_error" }, unavailable));
				return react.createElement.apply(react, ["div", { className: "smm_root" }].concat(children));
			}
			const formChildren = FIELDS.map((field) => {
				const control = field.key === "provider"
					? catalogReady
						? react.createElement("select", {
							id: "smm-" + field.key,
							className: "smm_select",
							value: stringOf(draft[field.key]),
							onChange: (event) => onProviderChange(event.target.value),
						}, providerOptions.map((option) => react.createElement("option", { key: option, value: option }, option)))
						: react.createElement("input", {
							id: "smm-" + field.key,
							className: "smm_input",
							type: "text",
							value: stringOf(draft[field.key]),
							onChange: (event) => setField(field.key, event.target.value),
						})
					: catalogReady
						? react.createElement("select", {
							id: "smm-" + field.key,
							className: "smm_select",
							value: stringOf(draft[field.key]),
							onChange: (event) => setField(field.key, event.target.value),
						}, modelOptions.map((option) => react.createElement("option", { key: option, value: option }, option)))
						: react.createElement("input", {
							id: "smm-" + field.key,
							className: "smm_input",
							type: "text",
							value: stringOf(draft[field.key]),
							onChange: (event) => setField(field.key, event.target.value),
						});
				return react.createElement("div", { className: "smm_field", key: field.key },
					react.createElement("label", { className: "smm_label", htmlFor: "smm-" + field.key }, field.label),
					control,
					react.createElement("div", { className: "smm_hint" }, field.hint));
			});
			if (!catalogReady) {
				formChildren.push(react.createElement("div", { className: "smm_hint", key: "catalog-fallback" }, "llm-pi-ai 模型清单不可用（设置命名空间未注册？），已退化为文本输入。" + (catalogScope === void 0 ? "" : " 当前连接可能为 memory 模式。")));
			}
			children.push(react.createElement("div", { className: "smm_form" }, formChildren));
			children.push(react.createElement("div", { className: "smm_toolbar" },
				react.createElement("button", { type: "button", className: "smm_btn", disabled: busy, onClick: () => void onSave() }, busy ? "保存中…" : "保存到 settings.yaml"),
				react.createElement("button", { type: "button", className: "smm_btn", disabled: busy, onClick: () => void onReset() }, "恢复默认")));
			if (message !== null) children.push(react.createElement("div", { className: message.kind === "ok" ? "smm_ok" : "smm_error" }, message.text));
			children.push(react.createElement("div", { className: "smm_note" }, "模型清单取自 settings.yaml 的 llm-pi-ai.providers.*.models（热更新）。改动只影响后续派发的 subagent / subagent_fork 默认路由；AGENTS.md 的 preset 固定路由裁决不受影响（默认值不变，设置页/设置文件即用户显式指令的载体）。"));
			return react.createElement.apply(react, ["div", { className: "smm_root" }].concat(children));
		}
		//#endregion
		//#region plugin face (bundle exports.inject = service names; apply registers the settings section)
		const inject = ["slots", "settingsScope"];
		function apply(ctx) {
			let scope;
			let catalogScope;
			try {
				scope = ctx.settingsScope.bind({ namespace: "dsh-subagent" });
			} catch (error) {
				ctx.logger?.warn?.("dsh-subagent-model: settingsScope 不可用，设置页将显示不可用状态: " + (error instanceof Error ? error.message : String(error)));
			}
			try {
				catalogScope = ctx.settingsScope.bind({ namespace: "llm-pi-ai" });
			} catch (error) {
				ctx.logger?.warn?.("dsh-subagent-model: llm-pi-ai 命名空间不可用，下拉将退化为文本输入: " + (error instanceof Error ? error.message : String(error)));
			}
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "@local/dsh-subagent-model",
				order: 70,
				label: "子代理模型",
				inject: () => ({ scope, catalogScope }),
			}, SubagentModelSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
