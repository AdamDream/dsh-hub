window.__ModuleLoader__.load({
	id: "@local/dsh-btw",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/controller.ts
		const NOT_OPEN_MESSAGE = "This side conversation is no longer open on the host (it may have restarted). Its saved history is kept — press Try again to resume it.";
		const EMPTY_TRANSCRIPT = Object.freeze({
			seedLength: 0,
			revision: 0,
			messages: Object.freeze([]),
			partial: "",
			reasoning: "",
			running: false
		});
		function remoteFailure(error) {
			return error.message === void 0 ? error.code : error.message;
		}
		function keyOf(sessionId) {
			return String(sessionId);
		}
		var SideChatController = class {
			remote;
			epoch = 0;
			state = Object.freeze({
				epoch: 0,
				phase: "closed",
				...EMPTY_TRANSCRIPT
			});
			listeners = /* @__PURE__ */ new Set();
			parkedByParent = /* @__PURE__ */ new Map();
			openingByParent = /* @__PURE__ */ new Map();
			openingByToken = /* @__PURE__ */ new Map();
			restoringByParent = /* @__PURE__ */ new Map();
			optimisticByToken = /* @__PURE__ */ new Map();
			/** In-memory list caches, invalidated whenever the sessions list changes (U-K). */
			treeByParent = /* @__PURE__ */ new Map();
			projectByParent = /* @__PURE__ */ new Map();
			closing;
			pollTimer;
			disposeList;
			sessions;
			constructor(ctx, remote) {
				this.remote = remote;
				this.sessions = ctx.get("sessions");
				this.disposeList = this.sessions.list.subscribe(() => {
					this.handleSessionChange();
				});
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			getSnapshot = () => this.state;
			currentSessionId() {
				return this.sessions.list.getSnapshot().current;
			}
			binding(sessionId) {
				return sessionId === void 0 ? void 0 : this.sessions.binding(sessionId);
			}
			hasConversation(sessionId) {
				if (sessionId === void 0) return false;
				const key = keyOf(sessionId);
				if (this.state.phase !== "closed" && this.state.parentSessionId !== void 0 && keyOf(this.state.parentSessionId) === key) return true;
				if (this.parkedByParent.has(key)) return true;
				return this.openingByParent.has(key);
			}
			async open(parentSessionId) {
				if (this.state.phase !== "closed") {
					if (this.state.parentSessionId !== void 0 && keyOf(this.state.parentSessionId) === keyOf(parentSessionId)) return;
					this.parkVisible();
				}
				if (this.restoreExisting(parentSessionId)) return;
				if (this.closing !== void 0) await this.closing;
				const chatToken = crypto.randomUUID();
				const attempt = {
					parentSessionId,
					chatToken,
					disposition: "visible"
				};
				this.openingByParent.set(keyOf(parentSessionId), attempt);
				this.openingByToken.set(chatToken, attempt);
				this.publish(this.startingState(attempt));
				try {
					const result = await this.remote.start({
						parentSessionId: String(parentSessionId),
						chatToken
					});
					if (!result.ok) throw new Error(remoteFailure(result.error));
					if (!result.value.ok) throw new Error(result.value.error.message);
					const value = result.value.value;
					const optimistic = this.optimisticByToken.get(value.chatToken);
					const openState = {
						epoch: this.nextEpoch(),
						phase: "open",
						parentSessionId,
						childSessionId: value.childSessionId,
						chatToken: value.chatToken,
						seedLength: value.seedLength,
						revision: value.seedLength,
						...value.model === void 0 ? {} : { model: value.model },
						messages: optimistic === void 0 ? [] : [this.optimisticMessage(optimistic)],
						partial: "",
						reasoning: "",
						running: optimistic !== void 0
					};
					if (attempt.disposition === "closed") {
						this.remote.close({ chatToken: value.chatToken });
						return;
					}
					const current = this.currentSessionId();
					if (attempt.disposition === "parked" || current !== void 0 && keyOf(current) !== keyOf(parentSessionId)) {
						this.parkedByParent.set(keyOf(parentSessionId), openState);
						if (optimistic !== void 0) this.admitOptimistic(optimistic, true);
						return;
					}
					this.publish(openState);
					if (optimistic !== void 0) this.admitOptimistic(optimistic, true);
					this.poll(openState.epoch);
				} catch (error) {
					if (attempt.disposition === "closed") return;
					const optimistic = this.optimisticByToken.get(chatToken);
					const errorState = {
						epoch: this.nextEpoch(),
						phase: "error",
						parentSessionId,
						chatToken,
						...EMPTY_TRANSCRIPT,
						messages: optimistic === void 0 ? [] : [this.optimisticMessage(optimistic)],
						error: error instanceof Error ? error.message : String(error)
					};
					if (attempt.disposition === "parked") this.parkedByParent.set(keyOf(parentSessionId), errorState);
					else this.publish(errorState);
				} finally {
					if (this.openingByParent.get(keyOf(parentSessionId)) === attempt) this.openingByParent.delete(keyOf(parentSessionId));
					if (this.openingByToken.get(chatToken) === attempt) this.openingByToken.delete(chatToken);
				}
			}
			async send(text, attachments) {
				const snapshot = this.state;
				const token = snapshot.chatToken;
				const parentSessionId = snapshot.parentSessionId;
				if (snapshot.phase !== "starting" && snapshot.phase !== "open" || token === void 0 || parentSessionId === void 0 || snapshot.running) return {
					ok: false,
					error: "This side conversation is no longer open."
				};
				if (text.trim() === "" && (attachments === void 0 || attachments.length === 0)) return {
					ok: false,
					error: "This side conversation question cannot be empty."
				};
				const requestId = crypto.randomUUID();
				const optimistic = {
					parentSessionId,
					chatToken: token,
					requestId,
					localMessageId: `optimistic:${requestId}`,
					text: text.trim(),
					...attachments === void 0 || attachments.length === 0 ? {} : { images: attachments }
				};
				this.optimisticByToken.set(token, optimistic);
				this.publish({
					...snapshot,
					messages: [...snapshot.messages, this.optimisticMessage(optimistic)],
					running: true
				});
				if (snapshot.phase === "starting") return { ok: true };
				return this.admitOptimistic(optimistic, false);
			}
			/** Answer the pending btw_ask_user question shown in the panel (U7). */
			async answer(answers) {
				const snapshot = this.state;
				const token = snapshot.chatToken;
				const pendingQuestion = snapshot.pendingQuestion;
				if (snapshot.phase !== "open" || token === void 0 || pendingQuestion === void 0) return {
					ok: false,
					error: "No pending question to answer."
				};
				try {
					const result = await this.remote.answer({
						chatToken: token,
						questionId: pendingQuestion.questionId,
						answers: answers.map((answer) => ({
							id: answer.id,
							selected: answer.selected,
							...answer.custom === void 0 ? {} : { custom: answer.custom }
						}))
					});
					if (!result.ok) return {
						ok: false,
						error: remoteFailure(result.error)
					};
					if (!result.value.ok) return {
						ok: false,
						error: result.value.error.message
					};
					this.updateTokenState(token, (state) => {
						const { pendingQuestion: cleared, ...rest } = state;
						return rest;
					});
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}
			async cancel() {
				const token = this.state.chatToken;
				if (this.state.phase !== "open" || token === void 0) return {
					ok: false,
					error: "This side conversation is no longer open."
				};
				try {
					const result = await this.remote.cancel({ chatToken: token });
					if (!result.ok) return {
						ok: false,
						error: remoteFailure(result.error)
					};
					if (!result.value.ok) return {
						ok: false,
						error: result.value.error.message
					};
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}
			/** Switch the side conversation's model; the host applies it on the next turn. */
			async setModel(model) {
				const token = this.state.chatToken;
				if (this.state.phase !== "open" || token === void 0) return {
					ok: false,
					error: "This side conversation is no longer open."
				};
				try {
					const result = await this.remote.setModel({
						chatToken: token,
						model
					});
					if (!result.ok) return {
						ok: false,
						error: remoteFailure(result.error)
					};
					if (!result.value.ok) return {
						ok: false,
						error: result.value.error.message
					};
					this.publish({
						...this.state,
						model
					});
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}
			async retry() {
				const parent = this.state.parentSessionId;
				if (parent === void 0) return;
				const retainedText = this.state.chatToken === void 0 ? void 0 : this.optimisticByToken.get(this.state.chatToken)?.text;
				const key = keyOf(parent);
				if (this.state.phase === "error" && this.parkedByParent.has(key)) {
					this.publish(this.closedState());
					this.restoreExisting(parent);
					return;
				}
				await this.close();
				await this.open(parent);
				if (retainedText !== void 0 && this.state.phase === "open") await this.send(retainedText);
			}
			async close() {
				const snapshot = this.state;
				const token = snapshot.chatToken;
				const parent = snapshot.parentSessionId;
				this.stopPolling();
				if (parent !== void 0) {
					const key = keyOf(parent);
					this.parkedByParent.delete(key);
					const restore = this.restoringByParent.get(key);
					if (restore !== void 0) {
						restore.disposition = "closed";
						this.restoringByParent.delete(key);
					}
				}
				if (token !== void 0) {
					this.optimisticByToken.delete(token);
					const attempt = this.openingByToken.get(token);
					if (attempt !== void 0) attempt.disposition = "closed";
				}
				this.publish(this.closedState());
				if (token === void 0) return;
				const close = this.remote.close({ chatToken: token }).then((result) => {
					if (!result.ok) console.warn("[dsh-btw] close transport failed", result.error);
					else if (!result.value.ok) console.warn("[dsh-btw] close failed", result.value.error);
					else if (result.value.value.warning !== void 0) console.warn("[dsh-btw]", result.value.value.warning);
				}).catch((error) => {
					console.warn("[dsh-btw] close failed", error);
				}).finally(() => {
					if (this.closing === close) this.closing = void 0;
				});
				this.closing = close;
				await close;
			}
			/**
			* U-K: read the bytes behind one admitted image back for display (R1-10).
			* The refs belong to the host's attachment store and are never in the child
			* session events, so they are served by the `sideChat/readImage` remote.
			*/
			async readImage(attachmentId) {
				const token = this.state.chatToken;
				if (this.state.phase !== "open" || token === void 0) return {
					ok: false,
					error: "This side conversation is no longer open."
				};
				try {
					const result = await this.remote.readImage({
						chatToken: token,
						attachmentId
					});
					if (!result.ok) return {
						ok: false,
						error: remoteFailure(result.error)
					};
					if (!result.value.ok) return {
						ok: false,
						error: result.value.error.message
					};
					return {
						ok: true,
						mediaType: result.value.value.mediaType,
						data: result.value.value.data
					};
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}
			/** U-K: enumerate side conversations under the current session tree (cached). */
			async listTree() {
				const parent = this.currentSessionId();
				if (parent === void 0) return {
					ok: false,
					error: "No active session."
				};
				const key = keyOf(parent);
				const cached = this.treeByParent.get(key);
				if (cached !== void 0) return {
					ok: true,
					entries: cached
				};
				try {
					const result = await this.remote.listTree({ parentSessionId: String(parent) });
					if (!result.ok) return {
						ok: false,
						error: remoteFailure(result.error)
					};
					if (!result.value.ok) return {
						ok: false,
						error: result.value.error.message
					};
					const entries = Object.freeze(result.value.value.entries);
					this.treeByParent.set(key, entries);
					return {
						ok: true,
						entries
					};
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}
			/** U-K: enumerate side conversations grouped by the current session's working directory (cached). */
			async listProject() {
				const parent = this.currentSessionId();
				if (parent === void 0) return {
					ok: false,
					error: "No active session."
				};
				const key = keyOf(parent);
				const cached = this.projectByParent.get(key);
				if (cached !== void 0) return {
					ok: true,
					entries: cached
				};
				try {
					const result = await this.remote.listProject({ parentSessionId: String(parent) });
					if (!result.ok) return {
						ok: false,
						error: remoteFailure(result.error)
					};
					if (!result.value.ok) return {
						ok: false,
						error: result.value.error.message
					};
					const entries = Object.freeze(result.value.value.entries);
					this.projectByParent.set(key, entries);
					return {
						ok: true,
						entries
					};
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}
			/**
			* U-K: jump the main conversation to another parent session and switch this
			* side conversation to it (R0-3). Sequence: open the target main session
			* (parks any visible side chat belonging to another parent), fall back to
			* the subagent catalog address when the target is not in the session list,
			* then open (or restore) the target's side conversation. Idempotent.
			*/
			async jumpTo(parentSessionId) {
				try {
					if (!(this.sessions.list.getSnapshot().byId[keyOf(parentSessionId)] !== void 0)) {
						const address = this.subagentAddressOf(parentSessionId);
						if (address !== void 0) this.sessions.openSubagent(address);
					}
					this.sessions.open(parentSessionId);
					await this.open(parentSessionId);
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}
			/**
			* Locate the catalog address of one subagent session, when discoverable.
			*
			* The catalog snapshot's base shape is declared in a deployment-only package
			* (`dsh-client-connection`); this workspace resolves it structurally instead.
			*/
			subagentAddressOf(sessionId) {
				const catalog = this.sessions.list.getSnapshot().subagentsByParent;
				for (const [parent, snapshot] of Object.entries(catalog)) for (const entry of snapshot?.entries ?? []) {
					if (entry?.id !== sessionId || entry.kind !== "child") continue;
					return {
						parentSessionId: parent,
						childSessionId: sessionId,
						mode: entry.mode === "continuable" ? "continuable" : "one-shot"
					};
				}
			}
			optimisticMessage(optimistic) {
				return {
					id: optimistic.messageId ?? optimistic.localMessageId,
					role: "user",
					text: optimistic.text
				};
			}
			mergeOptimisticMessages(messages, optimistic) {
				const hostId = optimistic.messageId;
				const withoutLocal = messages.filter((message) => message.id !== optimistic.localMessageId);
				if (hostId !== void 0 && withoutLocal.some((message) => message.id === hostId)) return withoutLocal;
				return [...withoutLocal, this.optimisticMessage(optimistic)];
			}
			updateTokenState(chatToken, update) {
				if (this.state.chatToken === chatToken) {
					this.publish(update(this.state));
					return;
				}
				for (const [parentKey, parked] of this.parkedByParent) {
					if (parked.chatToken !== chatToken) continue;
					this.parkedByParent.set(parentKey, Object.freeze(update(parked)));
					return;
				}
			}
			admitOptimistic(optimistic, retainOnFailure) {
				if (optimistic.admission !== void 0) return optimistic.admission;
				const admission = (async () => {
					let error;
					try {
						const result = await this.remote.send({
							chatToken: optimistic.chatToken,
							requestId: optimistic.requestId,
							text: optimistic.text,
							...optimistic.images === void 0 || optimistic.images.length === 0 ? {} : { images: optimistic.images.map(({ mediaType, data, name }) => ({
								type: "image",
								mediaType,
								data,
								...name === void 0 ? {} : { name }
							})) }
						});
						if (!result.ok) error = remoteFailure(result.error);
						else if (!result.value.ok) error = result.value.error.message;
						else {
							optimistic.messageId = result.value.value.messageId;
							this.updateTokenState(optimistic.chatToken, (state) => ({
								...state,
								messages: this.mergeOptimisticMessages(state.messages, optimistic),
								running: true
							}));
							if (this.state.phase === "open" && this.state.chatToken === optimistic.chatToken) this.poll(this.state.epoch);
							return { ok: true };
						}
					} catch (caught) {
						error = caught instanceof Error ? caught.message : String(caught);
					}
					if (this.optimisticByToken.get(optimistic.chatToken) === optimistic) {
						if (retainOnFailure) this.updateTokenState(optimistic.chatToken, (state) => ({
							...state,
							phase: "error",
							messages: this.mergeOptimisticMessages(state.messages, optimistic),
							running: false,
							error
						}));
						else {
							this.optimisticByToken.delete(optimistic.chatToken);
							this.updateTokenState(optimistic.chatToken, (state) => ({
								...state,
								messages: state.messages.filter((message) => message.id !== optimistic.localMessageId && message.id !== optimistic.messageId),
								running: false
							}));
						}
					}
					return {
						ok: false,
						error: error ?? "The side conversation could not accept this message."
					};
				})();
				optimistic.admission = admission;
				return admission;
			}
			async dispose() {
				this.disposeList();
				this.stopPolling();
				if (this.state.phase !== "closed") this.parkVisible();
				this.listeners.clear();
			}
			handleSessionChange() {
				this.treeByParent.clear();
				this.projectByParent.clear();
				const current = this.currentSessionId();
				if (current === void 0) return;
				const parent = this.state.parentSessionId;
				if (this.state.phase !== "closed" && parent !== void 0 && keyOf(parent) !== keyOf(current)) this.parkVisible();
				if (this.state.phase === "closed") this.restoreExisting(current);
			}
			parkVisible() {
				if (this.state.phase === "closed") return;
				this.stopPolling();
				const snapshot = this.state;
				if (snapshot.parentSessionId !== void 0) {
					const key = keyOf(snapshot.parentSessionId);
					const restore = this.restoringByParent.get(key);
					if (snapshot.phase === "starting" && restore !== void 0) restore.disposition = "parked";
					else if (snapshot.phase === "starting" && snapshot.chatToken !== void 0) {
						const attempt = this.openingByToken.get(snapshot.chatToken);
						if (attempt !== void 0) attempt.disposition = "parked";
					} else if (!(snapshot.phase === "error" && this.parkedByParent.has(key))) this.parkedByParent.set(key, snapshot);
				}
				this.publish(this.closedState());
			}
			restoreExisting(parentSessionId) {
				const key = keyOf(parentSessionId);
				const restoring = this.restoringByParent.get(key);
				if (restoring !== void 0) {
					restoring.disposition = "visible";
					this.publish(this.restoringState(restoring));
					return true;
				}
				const parked = this.parkedByParent.get(key);
				if (parked !== void 0) {
					this.parkedByParent.delete(key);
					if (parked.phase !== "open" || parked.chatToken === void 0) {
						this.publish({
							...parked,
							epoch: this.nextEpoch()
						});
						return true;
					}
					const restore = {
						parentSessionId,
						parked,
						disposition: "visible"
					};
					this.restoringByParent.set(key, restore);
					this.publish(this.restoringState(restore));
					this.confirmRestore(restore);
					return true;
				}
				const attempt = this.openingByParent.get(key);
				if (attempt !== void 0) {
					attempt.disposition = "visible";
					this.publish(this.startingState(attempt));
					return true;
				}
				return false;
			}
			async confirmRestore(attempt) {
				const key = keyOf(attempt.parentSessionId);
				const token = attempt.parked.chatToken;
				if (token === void 0) return;
				try {
					const result = await this.remote.read({ chatToken: token });
					if (!result.ok) throw new Error(remoteFailure(result.error));
					if (!result.value.ok) {
						if (result.value.error.code === "not-open") {
							if (attempt.disposition === "visible") this.publish(this.notOpenState(attempt.parentSessionId, token));
							return;
						}
						throw new Error(result.value.error.message);
					}
					const value = result.value.value;
					const { runningTool: previousRunningTool, error: previousError, currentAction: previousCurrentAction, ...base } = attempt.parked;
					const restored = {
						...base,
						epoch: this.nextEpoch(),
						phase: "open",
						revision: value.revision,
						messages: value.messages,
						partial: value.partial,
						reasoning: value.reasoning,
						running: value.running,
						...value.runningTool === void 0 ? {} : { runningTool: value.runningTool },
						...value.currentAction === void 0 ? {} : { currentAction: value.currentAction },
						...value.pendingQuestion === void 0 ? {} : { pendingQuestion: value.pendingQuestion },
						...value.model === void 0 ? {} : { model: value.model }
					};
					if (attempt.disposition !== "visible") {
						if (attempt.disposition === "parked") this.parkedByParent.set(key, restored);
						return;
					}
					this.publish(restored);
					this.poll(restored.epoch);
				} catch (error) {
					if (attempt.disposition === "closed") return;
					this.parkedByParent.set(key, attempt.parked);
					if (attempt.disposition === "visible") this.publish({
						epoch: this.nextEpoch(),
						phase: "error",
						parentSessionId: attempt.parentSessionId,
						chatToken: token,
						...EMPTY_TRANSCRIPT,
						error: error instanceof Error ? error.message : String(error)
					});
				} finally {
					if (this.restoringByParent.get(key) === attempt) this.restoringByParent.delete(key);
				}
			}
			async poll(epoch) {
				this.stopPolling();
				const token = this.state.chatToken;
				if (this.state.phase !== "open" || this.state.epoch !== epoch || token === void 0) return;
				let delay = 700;
				try {
					const result = await this.remote.read({ chatToken: token });
					if (this.state.phase !== "open" || this.state.epoch !== epoch || this.state.chatToken !== token) return;
					if (!result.ok) throw new Error(remoteFailure(result.error));
					if (!result.value.ok) {
						if (result.value.error.code === "not-open") {
							const parent = this.state.parentSessionId;
							if (parent !== void 0) {
								this.parkedByParent.delete(keyOf(parent));
								this.publish(this.notOpenState(parent, token));
							} else this.publish(this.closedState());
							return;
						}
						this.publish({
							...this.state,
							phase: "error",
							running: false,
							error: result.value.error.message
						});
						return;
					}
					const value = result.value.value;
					const optimistic = this.optimisticByToken.get(token);
					const hostHasOptimistic = optimistic?.messageId !== void 0 && value.messages.some((message) => message.id === optimistic.messageId);
					if (optimistic !== void 0 && hostHasOptimistic && !value.running) this.optimisticByToken.delete(token);
					const messages = optimistic === void 0 || hostHasOptimistic && !value.running ? value.messages : this.mergeOptimisticMessages(value.messages, optimistic);
					const running = value.running || optimistic !== void 0 && !(hostHasOptimistic && !value.running);
					delay = running ? 220 : 700;
					const { runningTool: previousRunningTool, pendingQuestion: previousPendingQuestion, currentAction: previousCurrentAction, ...baseState } = this.state;
					this.publish({
						...baseState,
						revision: value.revision,
						messages,
						partial: value.partial,
						reasoning: value.reasoning,
						running,
						...value.runningTool === void 0 ? {} : { runningTool: value.runningTool },
						...value.currentAction === void 0 ? {} : { currentAction: value.currentAction },
						...value.pendingQuestion === void 0 ? {} : { pendingQuestion: value.pendingQuestion },
						...value.model === void 0 ? {} : { model: value.model }
					});
				} catch (error) {
					console.warn("[dsh-btw] transcript read failed", error);
					delay = 1200;
				}
				if (this.state.phase === "open" && this.state.epoch === epoch) this.pollTimer = setTimeout(() => {
					this.poll(epoch);
				}, delay);
			}
			restoringState(attempt) {
				return {
					epoch: this.nextEpoch(),
					phase: "starting",
					parentSessionId: attempt.parentSessionId,
					...attempt.parked.chatToken === void 0 ? {} : { chatToken: attempt.parked.chatToken },
					...EMPTY_TRANSCRIPT
				};
			}
			notOpenState(parentSessionId, chatToken) {
				return {
					epoch: this.nextEpoch(),
					phase: "error",
					parentSessionId,
					chatToken,
					...EMPTY_TRANSCRIPT,
					error: NOT_OPEN_MESSAGE
				};
			}
			startingState(attempt) {
				const optimistic = this.optimisticByToken.get(attempt.chatToken);
				return {
					epoch: this.nextEpoch(),
					phase: "starting",
					parentSessionId: attempt.parentSessionId,
					chatToken: attempt.chatToken,
					...EMPTY_TRANSCRIPT,
					messages: optimistic === void 0 ? [] : [this.optimisticMessage(optimistic)],
					running: optimistic !== void 0
				};
			}
			closedState() {
				return {
					epoch: this.nextEpoch(),
					phase: "closed",
					...EMPTY_TRANSCRIPT
				};
			}
			nextEpoch() {
				this.epoch += 1;
				return this.epoch;
			}
			stopPolling() {
				if (this.pollTimer === void 0) return;
				clearTimeout(this.pollTimer);
				this.pollTimer = void 0;
			}
			publish(next) {
				this.state = Object.freeze(next);
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/locales.ts
		const en = {
			"button.open": "Open btw",
			"button.close": "Close btw",
			"drawer.title": "btw",
			"drawer.subtitle": "Ask aside. Stay on track.",
			"drawer.readOnly": "READ ONLY",
			"drawer.mainRunning": "Main task running",
			"drawer.mainReady": "Main task ready",
			"drawer.emptyTitle": "Ask without drifting",
			"drawer.emptyBody": "This side conversation can read the main context, but cannot change files or external state. It is kept across tasks and restarts.",
			"drawer.placeholder": "Ask a side question…",
			"drawer.send": "Send",
			"drawer.stop": "Stop",
			"drawer.retry": "Try again",
			"drawer.close": "Close btw",
			"drawer.discard": "Kept across tasks and restarts",
			"drawer.you": "You",
			"drawer.assistant": "Side assistant",
			"drawer.thinking": "Thinking",
			"drawer.contextNote": "Inherited context is reference-only. The main conversation stays untouched.",
			"drawer.error": "btw could not open",
			"drawer.questionTitle": "The side assistant is asking you",
			"drawer.questionCustom": "Custom answer",
			"drawer.questionCustomPlaceholder": "Type your own answer…",
			"drawer.answer": "Send answer",
			"drawer.answering": "Sending…",
			"drawer.multiHint": "You may pick several",
			"drawer.shortcut": "⌘⇧.",
			"drawer.minimize": "Minimize btw",
			"drawer.end": "End btw",
			"drawer.endTitle": "End btw?",
			"drawer.endBody": "Ending closes this panel and stops the side assistant. Its saved history stays on disk and reopening resumes it. The main conversation is not affected.",
			"drawer.endCancel": "Cancel",
			"drawer.endConfirm": "End",
			"drawer.ending": "Ending…",
			"drawer.model": "Model",
			"drawer.modelNextTurn": "Takes effect on the next turn",
			"drawer.jumpTitle": "Jump to another btw",
			"drawer.jumpTree": "This session tree",
			"drawer.jumpProject": "Project — all",
			"drawer.jumpLoading": "Loading…",
			"drawer.jumpEmpty": "No other side conversations yet.",
			"drawer.jumpCurrent": "current",
			"drawer.jumpRunning": "running",
			"drawer.jumpJustNow": "just now",
			"drawer.jumpMinutesSuffix": "m ago",
			"drawer.jumpHoursSuffix": "h ago",
			"drawer.jumpDaysSuffix": "d ago",
			"drawer.attachments": "Attached images",
			"drawer.attachmentRemove": "Remove image",
			"drawer.attachmentOpen": "Open image",
			"drawer.lightboxClose": "Close preview",
			"drawer.bannerOutputting": "Outputting…",
			"drawer.bannerCurrentAction": "current action",
			"drawer.toolRunning": "Running…"
		};
		const zh = {
			"button.open": "打开 btw",
			"button.close": "关闭 btw",
			"drawer.title": "btw 侧聊",
			"drawer.subtitle": "临时问一句，主任务不跑偏。",
			"drawer.readOnly": "只读",
			"drawer.mainRunning": "主任务运行中",
			"drawer.mainReady": "主任务已就绪",
			"drawer.emptyTitle": "放心追问，不污染主线",
			"drawer.emptyBody": "这个侧边对话可读取主会话上下文，但不能修改文件或外部状态；内容跨任务、跨重启保留。",
			"drawer.placeholder": "输入一个临时问题…",
			"drawer.send": "发送",
			"drawer.stop": "停止",
			"drawer.retry": "重试",
			"drawer.close": "关闭 btw",
			"drawer.discard": "跨任务、跨重启保留",
			"drawer.you": "你",
			"drawer.assistant": "侧边助手",
			"drawer.thinking": "思考中",
			"drawer.contextNote": "继承内容仅作参考，主会话不会被写入这段追问。",
			"drawer.error": "btw 无法打开",
			"drawer.questionTitle": "侧边助手正在向你提问",
			"drawer.questionCustom": "自定义回答",
			"drawer.questionCustomPlaceholder": "输入你自己的回答…",
			"drawer.answer": "发送回答",
			"drawer.answering": "发送中…",
			"drawer.multiHint": "可多选",
			"drawer.shortcut": "⌘⇧.",
			"drawer.minimize": "收起 btw",
			"drawer.end": "结束 btw",
			"drawer.endTitle": "结束 btw？",
			"drawer.endBody": "结束后会关闭本面板并停止侧边助手；已保存的历史仍在磁盘上，重新打开即可恢复。主会话不受影响。",
			"drawer.endCancel": "取消",
			"drawer.endConfirm": "结束",
			"drawer.ending": "正在结束…",
			"drawer.model": "模型",
			"drawer.modelNextTurn": "下一轮生效",
			"drawer.jumpTitle": "跳转到其他 btw",
			"drawer.jumpTree": "当前会话树",
			"drawer.jumpProject": "项目全部",
			"drawer.jumpLoading": "加载中…",
			"drawer.jumpEmpty": "还没有其他侧聊。",
			"drawer.jumpCurrent": "当前",
			"drawer.jumpRunning": "运行中",
			"drawer.jumpJustNow": "刚刚",
			"drawer.jumpMinutesSuffix": " 分钟前",
			"drawer.jumpHoursSuffix": " 小时前",
			"drawer.jumpDaysSuffix": " 天前",
			"drawer.attachments": "已附加图片",
			"drawer.attachmentRemove": "移除图片",
			"drawer.attachmentOpen": "查看图片",
			"drawer.lightboxClose": "关闭预览",
			"drawer.bannerOutputting": "输出中…",
			"drawer.bannerCurrentAction": "当前动作",
			"drawer.toolRunning": "运行中…"
		};
		//#endregion
		//#region src/client/SideChatSign.tsx
		const SIDE_CHAT_SIGN_VIEW_BOX = "0 0 48 24";
		const SIDE_CHAT_SIGN_UPPER_PATH = "M4 6H44";
		const SIDE_CHAT_SIGN_LOWER_PATH = "M4 14H25C29 14 30 20 35 20H44";
		function SideChatSign({ className, size, title }) {
			const clipId = `dsh-btw-sign-${(0, react.useId)().replaceAll(":", "")}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className,
				viewBox: SIDE_CHAT_SIGN_VIEW_BOX,
				width: size,
				height: size,
				fill: "none",
				role: title === void 0 ? void 0 : "img",
				"aria-hidden": title === void 0 ? true : void 0,
				"aria-label": title,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("clipPath", {
						id: clipId,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: 25,
							y: "0",
							width: "23",
							height: "24"
						})
					}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: SIDE_CHAT_SIGN_UPPER_PATH,
						stroke: "currentColor",
						strokeWidth: "4",
						strokeLinecap: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: SIDE_CHAT_SIGN_LOWER_PATH,
						stroke: "currentColor",
						strokeWidth: "4",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: SIDE_CHAT_SIGN_LOWER_PATH,
						stroke: "#B7E85B",
						strokeWidth: "4",
						strokeLinecap: "round",
						strokeLinejoin: "round",
						clipPath: `url(#${clipId})`
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-btw-css:src/client/side-chat.module.css.mjs
		const css = ".SalQ5q_headerButton,.SalQ5q_headerButtonActive{white-space:nowrap;gap:6px}.SalQ5q_headerButtonActive{border-color:color-mix(in srgb, #b7e85b 60%, var(--dsw-alias-border-l1));background:#b7e85b1a}.SalQ5q_placementRoot{pointer-events:none;position:absolute;inset:0}.SalQ5q_safeAreaProbe{width:0;height:0;padding-top:calc(env(safe-area-inset-top,0px) + var(--dsh-btw-reserve-top,0px));padding-right:calc(env(safe-area-inset-right,0px) + var(--dsh-btw-reserve-right,0px));padding-bottom:calc(env(safe-area-inset-bottom,0px) + var(--dsh-btw-reserve-bottom,0px));padding-left:calc(env(safe-area-inset-left,0px) + var(--dsh-btw-reserve-left,0px));visibility:hidden;pointer-events:none;position:absolute}.SalQ5q_mobileScrim{pointer-events:auto;background:#0507088a;border:0;display:none;position:absolute;inset:0}.SalQ5q_drawer{top:var(--side-chat-top);left:var(--side-chat-left);box-sizing:border-box;width:var(--side-chat-width);height:var(--side-chat-height);max-height:var(--side-chat-max-height);border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb, var(--dsw-alias-bg-base) 96%, #0b0d0e 4%);min-width:0;color:var(--dsw-alias-label-primary);pointer-events:auto;border-radius:16px;flex-direction:column;animation:.18s cubic-bezier(.2,.8,.2,1) SalQ5q_drawer-in;display:flex;position:absolute;overflow:hidden;box-shadow:-18px 12px 70px #1219153d,-1px 0 #b7e85b14}.SalQ5q_surface{flex-direction:column;flex:1;min-width:0;min-height:0;display:flex}.SalQ5q_drawerHeader{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:16px;min-height:68px;padding:12px 14px 12px 16px;display:flex}.SalQ5q_titleCluster{align-items:center;gap:12px;min-width:0;display:flex}.SalQ5q_titleCluster>div{min-width:0}.SalQ5q_titleCluster p{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;margin:2px 0 0;font-size:11px;line-height:15px;overflow:hidden}.SalQ5q_titleLine{align-items:center;gap:8px;display:flex}.SalQ5q_titleLine strong{letter-spacing:-.01em;font-size:14px;font-weight:620}.SalQ5q_railMark{box-sizing:border-box;border:1px solid color-mix(in srgb, #b7e85b 30%, var(--dsw-alias-border-l1));width:28px;height:28px;color:var(--dsw-alias-label-tertiary);background:#b7e85b14;border-radius:8px;flex:none;padding:6px;display:block}.SalQ5q_readOnlyBadge{color:#161a13;font-family:var(--ds-font-family-code);letter-spacing:.08em;background:#b7e85b;border-radius:999px;padding:2px 6px;font-size:9px;font-weight:700;line-height:14px}.SalQ5q_headerActions{flex:none;align-items:center;gap:4px;display:flex}.SalQ5q_endButton{width:30px;height:30px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;background:0 0;border:1px solid #0000;border-radius:999px;place-items:center;padding:0;display:grid}.SalQ5q_endButton:hover{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);color:var(--dsw-alias-state-error-primary)}.SalQ5q_endButton:active{transform:translateY(1px)}.SalQ5q_headerGlyph{font-size:18px;font-weight:400;line-height:1}.SalQ5q_iconButton{width:30px;height:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:999px;flex:none;place-items:center;display:grid}.SalQ5q_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.SalQ5q_iconButton:active{transform:translateY(1px)}.SalQ5q_modelSelect{border:1px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 30%, transparent);height:30px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:999px;flex:none;padding:0 6px;font-size:12px}.SalQ5q_modelSelect:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.SalQ5q_modelSelect:disabled{opacity:.5;cursor:default}.SalQ5q_parentStatus{border-bottom:1px solid var(--dsw-alias-border-l2);min-height:36px;color:var(--dsw-alias-label-secondary);align-items:center;gap:7px;padding:7px 16px;font-size:11px;display:flex}.SalQ5q_statusDot,.SalQ5q_statusDotRunning{background:var(--dsw-alias-label-quaternary);border-radius:50%;flex:none;width:6px;height:6px}.SalQ5q_statusDotRunning{background:#b7e85b;box-shadow:0 0 0 3px #b7e85b21}.SalQ5q_contextNote{color:var(--dsw-alias-label-quaternary);text-overflow:ellipsis;white-space:nowrap;margin-left:auto;overflow:hidden}.SalQ5q_transcript{overscroll-behavior:contain;scrollbar-color:var(--dsw-alias-border-l1) transparent;flex-direction:column;flex:1;gap:18px;min-height:0;padding:22px 18px 32px;display:flex;overflow-y:auto}.SalQ5q_emptyState{flex-direction:column;flex:1;justify-content:center;align-items:flex-start;max-width:310px;min-height:100%;margin:0 auto;display:flex}.SalQ5q_emptyState .SalQ5q_railMark{border-radius:12px;width:42px;height:42px;margin-bottom:22px;padding:8px}.SalQ5q_emptyState strong{letter-spacing:-.035em;max-width:260px;font-size:26px;font-weight:560;line-height:1.05}.SalQ5q_emptyState p{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:13px;line-height:20px}.SalQ5q_errorState{max-width:330px;margin:auto}.SalQ5q_errorRule{background:#e9705b;width:44px;height:3px;margin-bottom:18px;display:block}.SalQ5q_errorState strong{font-size:17px}.SalQ5q_errorState p{color:var(--dsw-alias-label-tertiary);margin:8px 0 16px;font-size:12px;line-height:19px}.SalQ5q_userMessage,.SalQ5q_assistantMessage{max-width:92%;font-size:13px;line-height:21px}.SalQ5q_userMessage{background:color-mix(in srgb, var(--dsw-alias-fill-tsp-secondary) 80%, #b7e85b 5%);border-radius:12px 12px 3px;align-self:flex-end;padding:11px 13px}.SalQ5q_assistantMessage{border-left:2px solid #b7e85bb8;align-self:flex-start;padding-left:12px}.SalQ5q_userMessage p,.SalQ5q_assistantMessage p{white-space:pre-wrap;margin:0}.SalQ5q_messageMeta{color:var(--dsw-alias-label-quaternary);font-family:var(--ds-font-family-code);margin-bottom:5px;font-size:10px;line-height:14px}.SalQ5q_runningBanner{z-index:2;border:1px solid color-mix(in srgb, #b7e85b 24%, var(--dsw-alias-border-l1));background:color-mix(in srgb, var(--dsw-alias-bg-base) 90%, transparent);border-radius:999px;flex:none;align-self:flex-start;align-items:center;padding:3px 8px;display:inline-flex;position:sticky;top:0}.SalQ5q_runningBannerText{white-space:nowrap;height:20px;font:var(--dsw-font-s-strong-14);color:#0000;-webkit-text-fill-color:transparent;background:linear-gradient(90deg,#b7e85b 0% 40%,#d9f39a 50%,#b7e85b 60% 100%) 100% 0/250% 100%;-webkit-background-clip:text;background-clip:text;align-items:center;animation:1.8s linear infinite SalQ5q_btw-banner-shimmer;display:inline-flex}@keyframes SalQ5q_btw-banner-shimmer{to{background-position:0 0}}.SalQ5q_messageTools{flex-direction:column;gap:4px;margin-top:10px;display:flex}.SalQ5q_toolRow{border-radius:6px}.SalQ5q_toolRowRow{position:relative;overflow:hidden}.SalQ5q_toolRow[data-state=running] .SalQ5q_toolRowRow:after{content:\"\";pointer-events:none;background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);width:300px;animation:2.6s ease-out infinite SalQ5q_btw-tool-row-sweep;position:absolute;top:0;bottom:0;left:-300px}@keyframes SalQ5q_btw-tool-row-sweep{0%{left:-300px}90%,to{left:100%}}.SalQ5q_toolRowLeading{flex-shrink:0}.SalQ5q_toolRowChevron{color:var(--dsw-alias-label-secondary)}.SalQ5q_toolRowTitle{font-weight:400}.SalQ5q_toolRowSep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.SalQ5q_toolRowSummary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}.SalQ5q_toolRowErrorSummary{color:var(--dsw-alias-state-error-primary)}.SalQ5q_toolRowIoCard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block-small);border-radius:12px;flex-direction:column;margin:4px 0 4px 4px;display:flex}.SalQ5q_toolRowIoSection{grid-template-columns:max-content 1fr;align-items:baseline;column-gap:14px;max-height:150px;padding:12px 16px;display:grid;overflow-y:auto}.SalQ5q_toolRowIoLabel{color:var(--dsw-alias-label-caption);align-self:start;position:sticky;top:0}.SalQ5q_toolRowIoDivider{background:var(--dsw-alias-border-l2);flex:none;height:1px}.SalQ5q_toolRowIoText{min-width:0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}.SalQ5q_toolRowIoText[data-error]{color:var(--dsw-alias-state-error-primary)}.SalQ5q_questionCard{border:1px solid color-mix(in srgb, #b7e85b 45%, var(--dsw-alias-border-l1));background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 92%, #b7e85b 8%);border-radius:12px;flex-direction:column;flex:none;gap:10px;margin:0 14px 12px;padding:12px 14px;display:flex}.SalQ5q_questionHead{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;font-size:12px;display:flex}.SalQ5q_questionHead strong{font-weight:600}.SalQ5q_questionDot{background:#b7e85b;border-radius:50%;flex:none;width:7px;height:7px;animation:1.6s ease-in-out infinite SalQ5q_btwQuestionPulse;box-shadow:0 0 0 3px #b7e85b2e}@keyframes SalQ5q_btwQuestionPulse{0%,to{box-shadow:0 0 0 3px #b7e85b2e}50%{box-shadow:0 0 0 5px #b7e85b14}}.SalQ5q_questionItem{flex-direction:column;gap:7px;display:flex}.SalQ5q_questionHeader{color:var(--dsw-alias-label-quaternary);font-family:var(--ds-font-family-code);letter-spacing:.06em;text-transform:uppercase;font-size:10px}.SalQ5q_questionText{color:var(--dsw-alias-label-primary);white-space:pre-wrap;margin:0;font-size:13px;line-height:20px}.SalQ5q_questionOptions{flex-direction:column;gap:6px;display:flex}.SalQ5q_questionOption,.SalQ5q_questionOptionActive{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;text-align:left;background:0 0;border-radius:10px;flex-direction:column;gap:3px;padding:8px 11px;display:flex}.SalQ5q_questionOption:hover{background:var(--dsw-alias-interactive-bg-hover)}.SalQ5q_questionOptionActive{border-color:color-mix(in srgb, #b7e85b 60%, var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary);background:#b7e85b1f}.SalQ5q_questionOptionLabel{font-size:12.5px;line-height:18px}.SalQ5q_questionOptionDescription{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.SalQ5q_questionHint{color:var(--dsw-alias-label-quaternary);font-size:10px}.SalQ5q_questionInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:100%;color:var(--dsw-alias-label-primary);font:inherit;border-radius:9px;padding:7px 10px;font-size:12.5px}.SalQ5q_questionInput:focus{border-color:color-mix(in srgb, #b7e85b 55%, var(--dsw-alias-border-l1));outline:0}.SalQ5q_questionInput::placeholder{color:var(--dsw-alias-label-quaternary)}.SalQ5q_questionError{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}.SalQ5q_composerArea{background:color-mix(in srgb, var(--dsw-alias-bg-base) 94%, transparent);padding:0 14px 12px}.SalQ5q_composer{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-module-platform);border-radius:12px;align-items:flex-end;gap:8px;min-height:74px;padding:10px 10px 9px 13px;transition:border-color .12s,box-shadow .12s;display:flex}.SalQ5q_composer:focus-within{border-color:color-mix(in srgb, #b7e85b 55%, var(--dsw-alias-border-l1));box-shadow:0 0 0 3px #b7e85b14}.SalQ5q_composer textarea{resize:none;width:100%;min-height:44px;color:var(--dsw-alias-label-primary);font:inherit;background:0 0;border:0;outline:0;font-size:13px;line-height:20px}.SalQ5q_composer textarea::placeholder{color:var(--dsw-alias-label-tertiary)}.SalQ5q_composer textarea:disabled{opacity:.56}.SalQ5q_sendButton{color:#151912;cursor:pointer;background:#b7e85b;border:0;border-radius:999px;flex:none;place-items:center;width:30px;height:30px;display:grid}.SalQ5q_sendButton:hover:not(:disabled){background:#c7ef7e}.SalQ5q_sendButton:active:not(:disabled){transform:translateY(1px)}.SalQ5q_sendButton:disabled{cursor:not-allowed;opacity:.3}.SalQ5q_composerFoot{color:var(--dsw-alias-label-quaternary);flex-wrap:wrap;justify-content:space-between;gap:3px 12px;padding:6px 2px 0;font-size:9px;line-height:12px;display:flex}.SalQ5q_composerFoot span:last-child{text-align:right;margin-left:auto}.SalQ5q_sendError{color:var(--dsw-alias-state-error-primary);margin:0 2px 7px;font-size:11px;line-height:16px}.SalQ5q_confirmationFooter{justify-content:flex-end;align-items:center;gap:8px;display:flex}.SalQ5q_destructiveButton{border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}.SalQ5q_destructiveButton:hover:not(:disabled){filter:brightness(1.06)}@keyframes SalQ5q_drawer-in{0%{opacity:0;transform:scale(.99)}to{opacity:1;transform:none}}.SalQ5q_placementRoot[data-placement-mode=bottom-sheet] .SalQ5q_drawer{border-radius:16px 16px 0 0}.SalQ5q_jumpList{border-bottom:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 55%, transparent);flex:none}.SalQ5q_jumpToggle{width:100%;min-height:34px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;align-items:center;gap:8px;padding:0 14px;font-size:11.5px;display:flex}.SalQ5q_jumpToggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.SalQ5q_jumpCaret{width:10px;color:var(--dsw-alias-label-quaternary);flex:none;font-size:10px}.SalQ5q_jumpBody{flex-direction:column;gap:8px;max-height:240px;padding:0 14px 12px;display:flex;overflow-y:auto}.SalQ5q_jumpTabs{background:color-mix(in srgb, var(--dsw-alias-fill-tsp-secondary) 70%, transparent);border-radius:9px;flex:none;gap:4px;padding:2px;display:flex}.SalQ5q_jumpTab,.SalQ5q_jumpTabActive{color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;background:0 0;border:0;border-radius:7px;flex:1;padding:5px 8px;font-size:11px}.SalQ5q_jumpTab:hover{color:var(--dsw-alias-label-primary)}.SalQ5q_jumpTabActive{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l1)}.SalQ5q_jumpHint{color:var(--dsw-alias-label-quaternary);padding:10px 2px;font-size:11px;line-height:16px}.SalQ5q_jumpEntries{flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;display:flex}.SalQ5q_jumpEntry,.SalQ5q_jumpEntryActive{border:1px solid var(--dsw-alias-border-l2);width:100%;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;text-align:left;background:0 0;border-radius:10px;flex-direction:column;gap:3px;padding:8px 10px;display:flex}.SalQ5q_jumpEntry:hover{background:var(--dsw-alias-interactive-bg-hover)}.SalQ5q_jumpEntryActive{border-color:color-mix(in srgb, #b7e85b 60%, var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary);background:#b7e85b1a}.SalQ5q_jumpEntryTitle{text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:560;line-height:18px;overflow:hidden}.SalQ5q_jumpEntryMeta{color:var(--dsw-alias-label-quaternary);font-size:10px;line-height:14px}.SalQ5q_jumpEntryPreview{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;overflow:hidden}.SalQ5q_attachmentRail{flex-wrap:wrap;align-items:center;gap:8px;margin:0 2px 8px;display:flex}.SalQ5q_attachmentThumb{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;width:46px;height:46px;position:relative;overflow:hidden}.SalQ5q_attachmentThumb img{object-fit:cover;width:100%;height:100%;display:block}.SalQ5q_attachmentRemove{color:#fff;cursor:pointer;background:#050708ad;border:0;border-radius:999px;place-items:center;width:16px;height:16px;padding:0;font-size:10px;line-height:1;display:grid;position:absolute;top:2px;right:2px}.SalQ5q_attachmentRemove:hover{background:var(--dsw-alias-state-error-primary)}.SalQ5q_attachmentCount{color:var(--dsw-alias-label-quaternary);font-family:var(--ds-font-family-code);font-size:10px}.SalQ5q_messageImages{flex-wrap:wrap;gap:7px;margin-top:9px;display:flex}.SalQ5q_messageImageButton{border:1px solid var(--dsw-alias-border-l2);cursor:zoom-in;background:0 0;border-radius:9px;padding:0;display:block;position:relative}.SalQ5q_messageImageButton:hover{border-color:color-mix(in srgb, #b7e85b 55%, var(--dsw-alias-border-l1))}.SalQ5q_messageImage{object-fit:cover;border-radius:8px;width:84px;height:84px;display:block}.SalQ5q_messageImagePlaceholder{background:var(--dsw-alias-fill-tsp-secondary);border-radius:8px;width:84px;height:84px;display:block}.SalQ5q_messageImageBadge{z-index:1;pointer-events:none;color:#000;font-family:var(--ds-font-family-code);background:#fff;border-radius:6px;padding:0 4px;font-size:10px;line-height:14px;position:absolute;top:4px;left:4px}.SalQ5q_lightboxRoot{z-index:1000;justify-content:center;align-items:center;padding:40px;display:flex;position:fixed;inset:0}.SalQ5q_lightboxMask{background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);position:absolute;inset:0}.SalQ5q_lightboxDialog{z-index:1;justify-content:center;align-items:center;max-width:min(1600px,94vw);max-height:calc(100vh - 80px);display:flex;position:relative}.SalQ5q_lightboxClose{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 88%, transparent);width:32px;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:999px;flex:none;place-items:center;display:grid;position:absolute;top:-40px;right:0}.SalQ5q_lightboxClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.SalQ5q_lightboxImage{object-fit:contain;max-width:min(1600px,94vw);max-height:calc(100vh - 80px);box-shadow:var(--dsw-shadow-lv3);border-radius:10px;display:block}.SalQ5q_lightboxPlaceholder{background:var(--dsw-alias-fill-tsp-secondary);border-radius:10px;width:min(560px,82vw);height:320px;display:block}@media (width<=720px){.SalQ5q_placementRoot[data-placement-mode=bottom-sheet] .SalQ5q_mobileScrim{display:block}.SalQ5q_contextNote{display:none}}@media (width<=980px){.SalQ5q_headerButtonLabel{display:none}}@media (prefers-reduced-motion:reduce){.SalQ5q_drawer{animation:none}.SalQ5q_transcript{scroll-behavior:auto}.SalQ5q_runningBannerText{background-position:0 0;background-size:100% 100%;animation:none}.SalQ5q_toolRow[data-state=running] .SalQ5q_toolRowRow:after{animation:none;display:none}}";
		const tagId = "@local/dsh-btw/side-chat.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@local/dsh-btw";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var side_chat_module_css_default = {
			"assistantMessage": "SalQ5q_assistantMessage",
			"attachmentCount": "SalQ5q_attachmentCount",
			"attachmentRail": "SalQ5q_attachmentRail",
			"attachmentRemove": "SalQ5q_attachmentRemove",
			"attachmentThumb": "SalQ5q_attachmentThumb",
			"btw-banner-shimmer": "SalQ5q_btw-banner-shimmer",
			"btw-tool-row-sweep": "SalQ5q_btw-tool-row-sweep",
			"btwQuestionPulse": "SalQ5q_btwQuestionPulse",
			"composer": "SalQ5q_composer",
			"composerArea": "SalQ5q_composerArea",
			"composerFoot": "SalQ5q_composerFoot",
			"confirmationFooter": "SalQ5q_confirmationFooter",
			"contextNote": "SalQ5q_contextNote",
			"destructiveButton": "SalQ5q_destructiveButton",
			"drawer": "SalQ5q_drawer",
			"drawer-in": "SalQ5q_drawer-in",
			"drawerHeader": "SalQ5q_drawerHeader",
			"emptyState": "SalQ5q_emptyState",
			"endButton": "SalQ5q_endButton",
			"errorRule": "SalQ5q_errorRule",
			"errorState": "SalQ5q_errorState",
			"headerActions": "SalQ5q_headerActions",
			"headerButton": "SalQ5q_headerButton",
			"headerButtonActive": "SalQ5q_headerButtonActive",
			"headerButtonLabel": "SalQ5q_headerButtonLabel",
			"headerGlyph": "SalQ5q_headerGlyph",
			"iconButton": "SalQ5q_iconButton",
			"jumpBody": "SalQ5q_jumpBody",
			"jumpCaret": "SalQ5q_jumpCaret",
			"jumpEntries": "SalQ5q_jumpEntries",
			"jumpEntry": "SalQ5q_jumpEntry",
			"jumpEntryActive": "SalQ5q_jumpEntryActive",
			"jumpEntryMeta": "SalQ5q_jumpEntryMeta",
			"jumpEntryPreview": "SalQ5q_jumpEntryPreview",
			"jumpEntryTitle": "SalQ5q_jumpEntryTitle",
			"jumpHint": "SalQ5q_jumpHint",
			"jumpList": "SalQ5q_jumpList",
			"jumpTab": "SalQ5q_jumpTab",
			"jumpTabActive": "SalQ5q_jumpTabActive",
			"jumpTabs": "SalQ5q_jumpTabs",
			"jumpToggle": "SalQ5q_jumpToggle",
			"lightboxClose": "SalQ5q_lightboxClose",
			"lightboxDialog": "SalQ5q_lightboxDialog",
			"lightboxImage": "SalQ5q_lightboxImage",
			"lightboxMask": "SalQ5q_lightboxMask",
			"lightboxPlaceholder": "SalQ5q_lightboxPlaceholder",
			"lightboxRoot": "SalQ5q_lightboxRoot",
			"messageImage": "SalQ5q_messageImage",
			"messageImageBadge": "SalQ5q_messageImageBadge",
			"messageImageButton": "SalQ5q_messageImageButton",
			"messageImagePlaceholder": "SalQ5q_messageImagePlaceholder",
			"messageImages": "SalQ5q_messageImages",
			"messageMeta": "SalQ5q_messageMeta",
			"messageTools": "SalQ5q_messageTools",
			"mobileScrim": "SalQ5q_mobileScrim",
			"modelSelect": "SalQ5q_modelSelect",
			"parentStatus": "SalQ5q_parentStatus",
			"placementRoot": "SalQ5q_placementRoot",
			"questionCard": "SalQ5q_questionCard",
			"questionDot": "SalQ5q_questionDot",
			"questionError": "SalQ5q_questionError",
			"questionHead": "SalQ5q_questionHead",
			"questionHeader": "SalQ5q_questionHeader",
			"questionHint": "SalQ5q_questionHint",
			"questionInput": "SalQ5q_questionInput",
			"questionItem": "SalQ5q_questionItem",
			"questionOption": "SalQ5q_questionOption",
			"questionOptionActive": "SalQ5q_questionOptionActive",
			"questionOptionDescription": "SalQ5q_questionOptionDescription",
			"questionOptionLabel": "SalQ5q_questionOptionLabel",
			"questionOptions": "SalQ5q_questionOptions",
			"questionText": "SalQ5q_questionText",
			"railMark": "SalQ5q_railMark",
			"readOnlyBadge": "SalQ5q_readOnlyBadge",
			"runningBanner": "SalQ5q_runningBanner",
			"runningBannerText": "SalQ5q_runningBannerText",
			"safeAreaProbe": "SalQ5q_safeAreaProbe",
			"sendButton": "SalQ5q_sendButton",
			"sendError": "SalQ5q_sendError",
			"statusDot": "SalQ5q_statusDot",
			"statusDotRunning": "SalQ5q_statusDotRunning",
			"surface": "SalQ5q_surface",
			"titleCluster": "SalQ5q_titleCluster",
			"titleLine": "SalQ5q_titleLine",
			"toolRow": "SalQ5q_toolRow",
			"toolRowChevron": "SalQ5q_toolRowChevron",
			"toolRowErrorSummary": "SalQ5q_toolRowErrorSummary",
			"toolRowIoCard": "SalQ5q_toolRowIoCard",
			"toolRowIoDivider": "SalQ5q_toolRowIoDivider",
			"toolRowIoLabel": "SalQ5q_toolRowIoLabel",
			"toolRowIoSection": "SalQ5q_toolRowIoSection",
			"toolRowIoText": "SalQ5q_toolRowIoText",
			"toolRowLeading": "SalQ5q_toolRowLeading",
			"toolRowRow": "SalQ5q_toolRowRow",
			"toolRowSep": "SalQ5q_toolRowSep",
			"toolRowSummary": "SalQ5q_toolRowSummary",
			"toolRowTitle": "SalQ5q_toolRowTitle",
			"transcript": "SalQ5q_transcript",
			"userMessage": "SalQ5q_userMessage"
		};
		//#endregion
		//#region src/client/SideChatToolRow.tsx
		/**
		* Simplified variant-leading icon by tool name (approximates the official
		* `VARIANT_ICONS` table; the full per-tool card models are out of scope).
		*/
		function toolIconFor(name) {
			if (name.startsWith("read")) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutline16, { size: 14 });
			if (name.startsWith("search")) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: 14 });
			if (name.startsWith("write") || name.startsWith("edit") || name.includes("patch")) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, { size: 14 });
			if (name === "bash" || name.startsWith("bash") || name.startsWith("exec") || name.startsWith("run")) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconApiOutline14, { size: 14 });
			if (name.startsWith("code")) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCodeOutline16, { size: 14 });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSparkle16, { size: 14 });
		}
		function truncateText(text, limit) {
			return text.length <= limit ? text : `${text.slice(0, limit)}…`;
		}
		/**
		* Layer B ToolRow approximation: a DisclosureRow (official primitive) whose
		* collapsed line shows the tool name + one-line summary, and whose expanded
		* body shows the IN (arguments) / OUT (result) ioCard aligned with the
		* official `GenericToolCard` structure. `data-state` mirrors the official
		* running/error/ok convention (CSS sweep on `running`).
		*/
		function SideChatToolRow({ tool, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const state = tool.running === true ? "running" : tool.isError === true ? "error" : "ok";
			const summary = state === "running" ? t("drawer.toolRunning") : truncateText(tool.result ?? "", 160);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: side_chat_module_css_default.toolRow,
				"data-variant": "generic",
				"data-tool": tool.name,
				"data-state": state,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					rowClassName: side_chat_module_css_default.toolRowRow,
					leadingClassName: side_chat_module_css_default.toolRowLeading,
					titleClassName: side_chat_module_css_default.toolRowTitle,
					chevronClassName: side_chat_module_css_default.toolRowChevron,
					icon: toolIconFor(tool.name),
					title: tool.name,
					open: expanded,
					expandable: true,
					expandOnRowClick: true,
					keepContentWhenOpen: true,
					onToggle: () => {
						setExpanded((previous) => !previous);
					},
					collapsedContent: summary !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: side_chat_module_css_default.toolRowSep,
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: state === "error" ? side_chat_module_css_default.toolRowErrorSummary : side_chat_module_css_default.toolRowSummary,
						children: summary
					})] }),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: side_chat_module_css_default.toolRowIoCard,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: side_chat_module_css_default.toolRowIoSection,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: side_chat_module_css_default.toolRowIoLabel,
								children: "IN"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: side_chat_module_css_default.toolRowIoText,
								children: tool.args
							})]
						}), tool.result !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: side_chat_module_css_default.toolRowIoDivider,
							"aria-hidden": "true"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: side_chat_module_css_default.toolRowIoSection,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: side_chat_module_css_default.toolRowIoLabel,
								children: "OUT"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: side_chat_module_css_default.toolRowIoText,
								"data-error": state === "error" || void 0,
								children: tool.result
							})]
						})] })]
					})
				})
			});
		}
		//#endregion
		//#region src/client/btw-settings.ts
		/** 侧聊默认模型常量（与 host `BTW_FALLBACK_DEFAULT_MODEL` 一致）。 */
		const BTW_DEFAULT_MODEL = "deepseek-v4.1-flash";
		/** 侧聊可路由模型清单常量（与 host `BTW_FALLBACK_MODELS` 一致）。 */
		const BTW_FALLBACK_MODEL_OPTIONS = Object.freeze([
			"deepseek-v4.1-flash",
			"glm-5.3",
			"deepseek-v4-pro"
		]);
		const BTW_SETTINGS_DEFAULTS = Object.freeze({
			ui: Object.freeze({
				banner: true,
				modelSelect: true,
				imageBadge: true
			}),
			vision: Object.freeze({ autoTransform: true }),
			model: Object.freeze({
				default: BTW_DEFAULT_MODEL,
				options: BTW_FALLBACK_MODEL_OPTIONS
			})
		});
		/** Narrow one raw settings section (wire value) to the surface's reads. */
		function decodeBtwSettings(section) {
			const value = section !== null && typeof section === "object" ? section : {};
			const ui = value.ui !== null && typeof value.ui === "object" ? value.ui : {};
			const vision = value.vision !== null && typeof value.vision === "object" ? value.vision : {};
			const model = value.model !== null && typeof value.model === "object" ? value.model : {};
			return {
				ui: {
					banner: ui.banner !== false,
					modelSelect: ui.modelSelect !== false,
					imageBadge: ui.imageBadge !== false
				},
				vision: { autoTransform: vision.autoTransform !== false },
				model: {
					default: typeof model.default === "string" && model.default !== "" ? model.default : BTW_DEFAULT_MODEL,
					options: (() => {
						if (!Array.isArray(model.options) || model.options.length === 0) return BTW_FALLBACK_MODEL_OPTIONS;
						const options = model.options.filter((option) => typeof option === "string");
						return options.length > 0 ? options : BTW_FALLBACK_MODEL_OPTIONS;
					})()
				}
			};
		}
		/**
		* Bind the `dsh-btw` namespace scope on the calling fiber, degrading to
		* `undefined` when the settingsScope service or the namespace is unavailable
		* (the surface then keeps BTW_SETTINGS_DEFAULTS = current behavior).
		*/
		function bindBtwSettings(binder) {
			if (binder === void 0 || typeof binder.bind !== "function") return void 0;
			try {
				return binder.bind({
					namespace: "dsh-btw",
					decode: decodeBtwSettings
				});
			} catch {
				return;
			}
		}
		/**
		* Reactive settings snapshot for the surface (P0-b). Subscribes to the bound
		* scope so settings.yaml edits re-render the surface without a restart; a
		* missing scope degrades to BTW_SETTINGS_DEFAULTS (现状).
		*
		* getSnapshot returns the scope's OWN decoded `value` (a stable reference
		* until the next change — required by useSyncExternalStore) or the frozen
		* DEFAULTS; it never synthesizes a fresh object per call.
		*/
		function useBtwSettings(scope) {
			const subscribe = (0, react.useCallback)((listener) => scope === void 0 ? () => {} : scope.subscribe(listener), [scope]);
			const getSnapshot = (0, react.useCallback)(() => scope === void 0 ? BTW_SETTINGS_DEFAULTS : scope.getSnapshot().value ?? BTW_SETTINGS_DEFAULTS, [scope]);
			return (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
		}
		//#endregion
		//#region src/client/SideChatSurface.tsx
		function useSessionSnapshot(face) {
			const subscribe = (0, react.useCallback)((listener) => face?.subscribe(listener) ?? (() => {}), [face]);
			const getSnapshot = (0, react.useCallback)(() => face?.getSnapshot() ?? null, [face]);
			return (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
		}
		const PASTED_IMAGE_TYPES = /* @__PURE__ */ new Set([
			"image/png",
			"image/jpeg",
			"image/webp",
			"image/gif"
		]);
		function imageTypeOf(type) {
			return PASTED_IMAGE_TYPES.has(type) ? type : void 0;
		}
		/** dataUrl → { mediaType, canonical base64 payload } (slice off the `data:…;base64,` prefix). */
		function payloadOfDataUrl(dataUrl) {
			const match = /^data:([a-z0-9-]+\/[a-z0-9-+.]+);base64,/u.exec(dataUrl);
			if (match === null) return void 0;
			const mediaType = imageTypeOf(match[1] ?? "");
			if (mediaType === void 0) return void 0;
			const comma = dataUrl.indexOf(",");
			return {
				mediaType,
				data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
			};
		}
		function QuestionCard({ pendingQuestion, controller, t }) {
			const [drafts, setDrafts] = (0, react.useState)(() => Object.fromEntries(pendingQuestion.questions.map((question) => [question.id, {
				selected: /* @__PURE__ */ new Set(),
				custom: ""
			}])));
			const [sending, setSending] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setDrafts(Object.fromEntries(pendingQuestion.questions.map((question) => [question.id, {
					selected: /* @__PURE__ */ new Set(),
					custom: ""
				}])));
				setError(null);
			}, [pendingQuestion.questionId, pendingQuestion.questions]);
			const toggle = (questionId, label, multiSelect) => {
				setDrafts((previous) => {
					const draft = previous[questionId] ?? {
						selected: /* @__PURE__ */ new Set(),
						custom: ""
					};
					const selected = new Set(draft.selected);
					if (!multiSelect) selected.clear();
					if (selected.has(label)) selected.delete(label);
					else selected.add(label);
					return {
						...previous,
						[questionId]: {
							selected,
							custom: draft.custom
						}
					};
				});
			};
			const submit = async () => {
				if (sending) return;
				setSending(true);
				setError(null);
				try {
					const result = await controller.answer(pendingQuestion.questions.map((question) => {
						const draft = drafts[question.id] ?? {
							selected: /* @__PURE__ */ new Set(),
							custom: ""
						};
						const custom = draft.custom.trim();
						return custom === "" ? {
							id: question.id,
							selected: [...draft.selected]
						} : {
							id: question.id,
							selected: [...draft.selected],
							custom
						};
					}));
					if (!result.ok) setError(result.error);
				} finally {
					setSending(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: side_chat_module_css_default.questionCard,
				"aria-label": t("drawer.questionTitle"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: side_chat_module_css_default.questionHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: side_chat_module_css_default.questionDot,
							"aria-hidden": "true"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("drawer.questionTitle") })]
					}),
					pendingQuestion.questions.map((question) => {
						const draft = drafts[question.id] ?? {
							selected: /* @__PURE__ */ new Set(),
							custom: ""
						};
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: side_chat_module_css_default.questionItem,
							children: [
								question.header !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: side_chat_module_css_default.questionHeader,
									children: question.header
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: side_chat_module_css_default.questionText,
									children: question.question
								}),
								question.options !== void 0 && question.options.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: side_chat_module_css_default.questionOptions,
									role: question.multi_select === true ? "group" : "radiogroup",
									children: [question.options.map((option) => {
										const active = draft.selected.has(option.label);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: active ? side_chat_module_css_default.questionOptionActive : side_chat_module_css_default.questionOption,
											"aria-pressed": active,
											onClick: () => {
												toggle(question.id, option.label, question.multi_select === true);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: side_chat_module_css_default.questionOptionLabel,
												children: option.label
											}), option.description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: side_chat_module_css_default.questionOptionDescription,
												children: option.description
											})]
										}, option.label);
									}), question.multi_select === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: side_chat_module_css_default.questionHint,
										children: t("drawer.multiHint")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: side_chat_module_css_default.questionInput,
									type: "text",
									value: draft.custom,
									placeholder: t("drawer.questionCustomPlaceholder"),
									"aria-label": t("drawer.questionCustom"),
									onChange: (event) => {
										const value = event.target.value;
										setDrafts((previous) => ({
											...previous,
											[question.id]: {
												selected: previous[question.id]?.selected ?? /* @__PURE__ */ new Set(),
												custom: value
											}
										}));
									},
									onKeyDown: (event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											submit();
										}
									}
								})
							]
						}, question.id);
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: side_chat_module_css_default.questionError,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						variant: "primary",
						disabled: sending,
						onClick: () => {
							submit();
						},
						children: sending ? t("drawer.answering") : t("drawer.answer")
					})
				]
			});
		}
		/**
		* Self-drawn image preview (2026-09-14 btw-ui). The official ImageLightbox is
		* not exported from dsh-client-ui-attachment and the primitives Modal dialog
		* is width-capped (380px), which read as "clicking a thumbnail does not
		* enlarge" — so the preview is a body-portal overlay following the official
		* ImageLightbox interaction: full mask (click to close), Escape to close,
		* close button, focus returns to the opener, large image.
		*/
		function ImageLightbox({ image, dataUrl, dialogLabel, closeLabel, onClose }) {
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.stopPropagation();
					onClose();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [onClose]);
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: side_chat_module_css_default.lightboxRoot,
				role: "presentation",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: side_chat_module_css_default.lightboxMask,
					"aria-hidden": "true",
					onClick: onClose
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: side_chat_module_css_default.lightboxDialog,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": dialogLabel,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: side_chat_module_css_default.lightboxClose,
						"aria-label": closeLabel,
						title: closeLabel,
						onClick: onClose,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, {})
					}), dataUrl === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: side_chat_module_css_default.lightboxPlaceholder,
						"aria-hidden": "true"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
						src: dataUrl,
						alt: image.name ?? "",
						className: side_chat_module_css_default.lightboxImage
					})]
				})]
			}), document.body);
		}
		function SideChatSurface({ controller, parentSessionId, viewStore, t, surfaceMode, settingsScope, onMinimize, onEnd }) {
			const state = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const parent = controller.binding(parentSessionId)?.session;
			const parentSnapshot = useSessionSnapshot(parent);
			const parentKey = String(parentSessionId);
			const subscribeView = (0, react.useCallback)((listener) => viewStore.subscribe(listener), [viewStore]);
			const getView = (0, react.useCallback)(() => viewStore.get(parentKey), [parentKey, viewStore]);
			const view = (0, react.useSyncExternalStore)(subscribeView, getView, getView);
			const settings = useBtwSettings(settingsScope);
			const draft = view.draft;
			const sendError = view.sendError;
			const attachments = view.attachments;
			const [confirmEnd, setConfirmEnd] = (0, react.useState)(false);
			const [ending, setEnding] = (0, react.useState)(false);
			/** attachmentId → data URL of the fetched bytes (U-F/U-L rendering cache). */
			const [imageCache, setImageCache] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [lightbox, setLightbox] = (0, react.useState)(null);
			/** Thumbnail button that opened the preview; focus returns here on close
			(2026-09-14 btw-ui, official ImageLightbox focus-restore pattern). */
			const lightboxOpenerRef = (0, react.useRef)(null);
			/** attachmentId → 'loading' while a fetch is in flight; 'failed' after a
			failed attempt so the next effect run retries once the conversation is
			ready (2026-09-14 btw-ui: fixes thumbnails stuck as non-interactive
			placeholders when a read was issued before the conversation was open). */
			const fetchStateRef = (0, react.useRef)(/* @__PURE__ */ new Map());
			const disposedRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				return () => {
					disposedRef.current = true;
				};
			}, []);
			const inputRef = (0, react.useRef)(null);
			const scrollRef = (0, react.useRef)(null);
			const confirmationFooterRef = (0, react.useRef)(null);
			const endButtonRef = (0, react.useRef)(null);
			const composerFocusTimerRef = (0, react.useRef)(void 0);
			const confirmEndRef = (0, react.useRef)(confirmEnd);
			const restoreEndFocusRef = (0, react.useRef)(false);
			const endingRef = (0, react.useRef)(false);
			confirmEndRef.current = confirmEnd;
			const messages = state.messages;
			const partial = state.partial;
			const reasoning = state.reasoning;
			(0, react.useEffect)(() => {
				const pending = /* @__PURE__ */ new Map();
				for (const message of messages) for (const ref of message.images ?? []) {
					if (imageCache.has(ref.attachmentId)) continue;
					if (fetchStateRef.current.get(ref.attachmentId) === "loading") continue;
					pending.set(ref.attachmentId, ref);
				}
				if (pending.size === 0) return;
				for (const ref of pending.values()) {
					fetchStateRef.current.set(ref.attachmentId, "loading");
					controller.readImage(ref.attachmentId).then((result) => {
						if (disposedRef.current) return;
						if (result.ok) {
							fetchStateRef.current.delete(ref.attachmentId);
							setImageCache((previous) => {
								const next = new Map(previous);
								next.set(ref.attachmentId, `data:${result.mediaType};base64,${result.data}`);
								return next;
							});
						} else fetchStateRef.current.set(ref.attachmentId, "failed");
					}).catch(() => {
						if (disposedRef.current) return;
						fetchStateRef.current.set(ref.attachmentId, "failed");
					});
				}
			}, [
				controller,
				imageCache,
				messages,
				state.phase,
				state.chatToken
			]);
			(0, react.useEffect)(() => {
				if (state.phase !== "starting" && state.phase !== "open" || confirmEndRef.current) return;
				const timer = window.setTimeout(() => {
					if (composerFocusTimerRef.current !== timer) return;
					composerFocusTimerRef.current = void 0;
					if (confirmEndRef.current) return;
					inputRef.current?.focus();
				}, 120);
				composerFocusTimerRef.current = timer;
				return () => {
					window.clearTimeout(timer);
					if (composerFocusTimerRef.current === timer) composerFocusTimerRef.current = void 0;
				};
			}, [state.phase]);
			(0, react.useEffect)(() => {
				scrollRef.current?.scrollTo({
					top: scrollRef.current.scrollHeight,
					behavior: "smooth"
				});
			}, [
				messages.length,
				partial,
				reasoning
			]);
			(0, react.useEffect)(() => {
				if (!confirmEnd) {
					if (restoreEndFocusRef.current) {
						restoreEndFocusRef.current = false;
						endButtonRef.current?.focus();
					}
					return;
				}
				if (composerFocusTimerRef.current !== void 0) {
					window.clearTimeout(composerFocusTimerRef.current);
					composerFocusTimerRef.current = void 0;
				}
				confirmationFooterRef.current?.querySelector("button")?.focus();
				const containEscape = (event) => {
					if (event.key === "Escape") event.stopPropagation();
				};
				document.addEventListener("keydown", containEscape);
				return () => {
					document.removeEventListener("keydown", containEscape);
				};
			}, [confirmEnd]);
			const running = state.running;
			const interactive = state.phase === "starting" || state.phase === "open";
			const canSend = interactive && !running && (draft.trim() !== "" || attachments.length > 0);
			const send = async () => {
				if (!canSend) return;
				const text = draft.trim();
				const pendingImages = attachments;
				viewStore.setDraft(parentKey, "");
				const result = await controller.send(text, pendingImages);
				if (!result.ok) {
					viewStore.setDraft(parentKey, text);
					viewStore.setSendError(parentKey, result.error);
					return;
				}
				viewStore.clearAttachments(parentKey);
			};
			const end = async () => {
				if (endingRef.current) return;
				endingRef.current = true;
				setEnding(true);
				try {
					await onEnd();
					restoreEndFocusRef.current = true;
					setConfirmEnd(false);
				} finally {
					endingRef.current = false;
					setEnding(false);
				}
			};
			const dismissEnd = () => {
				if (endingRef.current) return;
				restoreEndFocusRef.current = true;
				setConfirmEnd(false);
			};
			const closeLightbox = (0, react.useCallback)(() => {
				setLightbox(null);
				lightboxOpenerRef.current?.focus();
			}, []);
			const onComposerKeyDown = (event) => {
				if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
				event.preventDefault();
				send();
			};
			const onComposerPaste = (event) => {
				const pasted = [...event.clipboardData?.files ?? []].filter((file) => imageTypeOf(file.type) !== void 0);
				if (pasted.length === 0) return;
				event.preventDefault();
				for (const file of pasted) {
					const reader = new FileReader();
					reader.onload = () => {
						const payload = payloadOfDataUrl(typeof reader.result === "string" ? reader.result : "");
						if (payload === void 0) return;
						viewStore.addAttachment(parentKey, {
							mediaType: payload.mediaType,
							data: payload.data,
							...file.name === "" ? {} : { name: file.name }
						});
					};
					reader.onerror = () => {};
					reader.readAsDataURL(file);
				}
			};
			const onConfirmationKeyDown = (event) => {
				if (event.key !== "Tab") return;
				const [cancel, confirm] = confirmationFooterRef.current?.querySelectorAll("button") ?? [];
				if (cancel === void 0 || confirm === void 0) return;
				if (event.shiftKey && document.activeElement === cancel) {
					event.preventDefault();
					confirm.focus();
				} else if (!event.shiftKey && document.activeElement === confirm) {
					event.preventDefault();
					cancel.focus();
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: side_chat_module_css_default.surface,
				"data-side-chat-surface-mode": surfaceMode,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: side_chat_module_css_default.drawerHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: side_chat_module_css_default.titleCluster,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideChatSign, { className: side_chat_module_css_default.railMark }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: side_chat_module_css_default.titleLine,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("drawer.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: side_chat_module_css_default.readOnlyBadge,
									children: t("drawer.readOnly")
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("drawer.subtitle") })] })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: side_chat_module_css_default.headerActions,
							children: [
								settings.ui?.modelSelect !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: side_chat_module_css_default.modelSelect,
									value: state.model ?? settings.model?.default ?? "deepseek-v4.1-flash",
									disabled: !interactive,
									"aria-label": t("drawer.model"),
									title: t("drawer.modelNextTurn"),
									onChange: (event) => {
										controller.setModel(event.target.value);
									},
									children: (settings.model?.options ?? BTW_FALLBACK_MODEL_OPTIONS).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: option,
										children: option
									}, option))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									ref: endButtonRef,
									className: side_chat_module_css_default.endButton,
									type: "button",
									"aria-label": t("drawer.end"),
									title: t("drawer.end"),
									onClick: () => {
										setConfirmEnd(true);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: side_chat_module_css_default.headerGlyph,
										"aria-hidden": "true",
										children: "×"
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: side_chat_module_css_default.iconButton,
									type: "button",
									"aria-label": t("drawer.minimize"),
									title: t("drawer.minimize"),
									onClick: onMinimize,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: side_chat_module_css_default.headerGlyph,
										"aria-hidden": "true",
										children: "—"
									})
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: side_chat_module_css_default.parentStatus,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: parentSnapshot?.running ? side_chat_module_css_default.statusDotRunning : side_chat_module_css_default.statusDot }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: parentSnapshot?.running ? t("drawer.mainRunning") : t("drawer.mainReady") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: side_chat_module_css_default.contextNote,
								children: t("drawer.contextNote")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: side_chat_module_css_default.transcript,
						ref: scrollRef,
						"aria-live": "polite",
						children: [
							running && settings.ui?.banner !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: side_chat_module_css_default.runningBanner,
								role: "status",
								"aria-live": "polite",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: side_chat_module_css_default.runningBannerText,
									children: state.currentAction?.kind === "tool" ? `${t("drawer.bannerOutputting")} · ${t("drawer.bannerCurrentAction")}: ${state.currentAction.tool}` : t("drawer.bannerOutputting")
								})
							}),
							state.phase === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: side_chat_module_css_default.errorState,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: side_chat_module_css_default.errorRule }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("drawer.error") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: state.error }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "outline",
										onClick: () => {
											controller.retry();
										},
										children: t("drawer.retry")
									})
								]
							}),
							interactive && messages.length === 0 && partial === "" && !running && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: side_chat_module_css_default.emptyState,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideChatSign, { className: side_chat_module_css_default.railMark }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("drawer.emptyTitle") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("drawer.emptyBody") })
								]
							}),
							messages.map((message) => {
								const images = message.images ?? [];
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
									className: message.role === "user" ? side_chat_module_css_default.userMessage : side_chat_module_css_default.assistantMessage,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: side_chat_module_css_default.messageMeta,
											children: message.role === "user" ? t("drawer.you") : t("drawer.assistant")
										}),
										message.role === "assistant" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text: message.text }), message.tools !== void 0 && message.tools.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: side_chat_module_css_default.messageTools,
											children: message.tools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideChatToolRow, {
												tool,
												t
											}, tool.callId))
										})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: message.text }),
										images.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: side_chat_module_css_default.messageImages,
											children: images.map((ref, index) => {
												const dataUrl = imageCache.get(ref.attachmentId);
												if (dataUrl === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: side_chat_module_css_default.messageImagePlaceholder,
													"aria-hidden": "true"
												}, ref.attachmentId);
												return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: side_chat_module_css_default.messageImageButton,
													title: ref.name ?? t("drawer.attachmentOpen"),
													onClick: (event) => {
														lightboxOpenerRef.current = event.currentTarget;
														setLightbox(ref);
													},
													children: [images.length > 1 && settings.ui?.imageBadge !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: side_chat_module_css_default.messageImageBadge,
														"aria-hidden": "true",
														children: index + 1
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
														src: dataUrl,
														alt: ref.name ?? "",
														className: side_chat_module_css_default.messageImage
													})]
												}, ref.attachmentId);
											})
										})
									]
								}, message.id);
							}),
							reasoning !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: side_chat_module_css_default.assistantMessage,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: side_chat_module_css_default.messageMeta,
									children: t("drawer.thinking")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: reasoning })]
							}),
							partial !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: side_chat_module_css_default.assistantMessage,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: side_chat_module_css_default.messageMeta,
									children: t("drawer.assistant")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
									text: partial,
									streaming: true
								})]
							})
						]
					}),
					interactive && state.pendingQuestion !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuestionCard, {
						pendingQuestion: state.pendingQuestion,
						controller,
						t
					}),
					interactive && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: side_chat_module_css_default.composerArea,
						children: [
							sendError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: side_chat_module_css_default.sendError,
								children: sendError
							}),
							attachments.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: side_chat_module_css_default.attachmentRail,
								role: "list",
								"aria-label": t("drawer.attachments"),
								children: [attachments.map((image, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: side_chat_module_css_default.attachmentThumb,
									role: "listitem",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
										src: `data:${image.mediaType};base64,${image.data}`,
										alt: image.name ?? t("drawer.attachments")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: side_chat_module_css_default.attachmentRemove,
										"aria-label": t("drawer.attachmentRemove"),
										title: t("drawer.attachmentRemove"),
										onClick: () => {
											viewStore.removeAttachment(parentKey, index);
										},
										children: "×"
									})]
								}, `${index}:${image.data.slice(0, 24)}`)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: side_chat_module_css_default.attachmentCount,
									children: attachments.length
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: side_chat_module_css_default.composer,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									ref: inputRef,
									value: draft,
									rows: 2,
									placeholder: t("drawer.placeholder"),
									"aria-label": t("drawer.placeholder"),
									disabled: running,
									onChange: (event) => {
										viewStore.setDraft(parentKey, event.target.value);
									},
									onKeyDown: onComposerKeyDown,
									onPaste: onComposerPaste
								}), running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: side_chat_module_css_default.sendButton,
									type: "button",
									"aria-label": t("drawer.stop"),
									title: t("drawer.stop"),
									onClick: () => {
										controller.cancel().then((result) => {
											if (!result.ok) viewStore.setSendError(parentKey, result.error);
										});
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconStopFill16, {})
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: side_chat_module_css_default.sendButton,
									type: "button",
									"aria-label": t("drawer.send"),
									title: t("drawer.send"),
									disabled: !canSend,
									onClick: () => {
										send();
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSendOutline16, {})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: side_chat_module_css_default.composerFoot,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Shift + Enter" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("drawer.discard") })]
							})
						]
					}),
					lightbox !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageLightbox, {
						image: lightbox,
						dataUrl: imageCache.get(lightbox.attachmentId),
						dialogLabel: lightbox.name ?? t("drawer.attachmentOpen"),
						closeLabel: t("drawer.lightboxClose"),
						onClose: closeLightbox
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: confirmEnd,
						onClose: dismissEnd,
						title: t("drawer.endTitle"),
						closeLabel: t("drawer.endCancel"),
						description: t("drawer.endBody"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							ref: confirmationFooterRef,
							className: side_chat_module_css_default.confirmationFooter,
							onKeyDown: onConfirmationKeyDown,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								disabled: ending,
								onClick: dismissEnd,
								children: t("drawer.endCancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								className: side_chat_module_css_default.destructiveButton,
								size: "sm",
								variant: "primary",
								disabled: ending,
								onClick: () => {
									end();
								},
								children: ending ? t("drawer.ending") : t("drawer.endConfirm")
							})]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/presentation.tsx
		const SIDE_CHAT_TAB_TYPE = "dsh-btw:conversation";
		function supportsBetterSidebar(value) {
			if (value === null || typeof value !== "object") return false;
			const service = value;
			return typeof service.registerTab === "function" && typeof service.isTabEnabled === "function" && typeof service.openTab === "function" && typeof service.closeTab === "function" && Array.isArray(service.features) && service.features.includes("targetedOpen");
		}
		function BetterSidebarSideChat({ hostContext, controller, viewStore, presentation, settingsScope, scope, visible }) {
			const parentSessionId = scope.sessionId;
			const subscribeLocale = (0, react.useCallback)((listener) => hostContext.locale.subscribe(listener), [hostContext]);
			const getLocaleSnapshot = (0, react.useCallback)(() => hostContext.locale.getSnapshot(), [hostContext]);
			(0, react.useSyncExternalStore)(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot);
			const t = hostContext.locale.bind("btw");
			(0, react.useEffect)(() => {
				if (!visible) {
					viewStore.minimize(parentSessionId);
					return;
				}
				viewStore.show(parentSessionId, "better-sidebar");
				if (!controller.hasConversation(parentSessionId)) controller.open(parentSessionId);
			}, [
				controller,
				parentSessionId,
				viewStore,
				visible
			]);
			const minimize = (0, react.useCallback)(() => {
				presentation.minimize(parentSessionId);
			}, [parentSessionId, presentation]);
			const end = (0, react.useCallback)(() => presentation.end(parentSessionId), [parentSessionId, presentation]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideChatSurface, {
				parentSessionId,
				controller,
				viewStore,
				t,
				surfaceMode: "better-sidebar",
				settingsScope,
				onMinimize: minimize,
				onEnd: end
			});
		}
		var SideChatPresentation = class {
			ctx;
			controller;
			viewStore;
			settingsScope;
			attachment;
			constructor(ctx, controller, viewStore, settingsScope) {
				this.ctx = ctx;
				this.controller = controller;
				this.viewStore = viewStore;
				this.settingsScope = settingsScope;
			}
			subscribe(listener) {
				return this.viewStore.subscribe(listener);
			}
			getSnapshot(parentSessionId) {
				return this.viewStore.get(parentSessionId);
			}
			show(parentSessionId) {
				const service = this.attachment?.service;
				const native = service !== void 0 && service.isTabEnabled("dsh-btw:conversation");
				this.viewStore.show(parentSessionId, native ? "better-sidebar" : "drawer");
				this.controller.open(parentSessionId);
				if (native) service.openTab({
					type: SIDE_CHAT_TAB_TYPE,
					id: SIDE_CHAT_TAB_TYPE,
					path: `side-chat:${parentSessionId}`
				}, { sessionId: parentSessionId });
			}
			toggle(parentSessionId) {
				if (this.viewStore.get(parentSessionId).visible) {
					this.minimize(parentSessionId);
					return;
				}
				this.show(parentSessionId);
			}
			minimize(parentSessionId) {
				const mode = this.viewStore.get(parentSessionId).presentation;
				this.viewStore.minimize(parentSessionId);
				if (mode === "better-sidebar") this.attachment?.service.closeTab(SIDE_CHAT_TAB_TYPE, { sessionId: parentSessionId });
			}
			async end(parentSessionId) {
				await this.controller.close();
				this.attachment?.service.closeTab(SIDE_CHAT_TAB_TYPE, { sessionId: parentSessionId });
				this.viewStore.clear(parentSessionId);
			}
			attachBetterSidebar(candidate) {
				this.attachment?.dispose();
				if (!supportsBetterSidebar(candidate)) {
					this.warnFallback("required capabilities are unavailable");
					return () => {};
				}
				let unregister;
				try {
					unregister = candidate.registerTab(this.createDescriptor(candidate));
				} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					this.warnFallback(detail);
					return () => {};
				}
				let disposed = false;
				const attachment = {
					service: candidate,
					dispose: () => {
						if (disposed) return;
						disposed = true;
						unregister?.();
						if (this.attachment !== attachment) return;
						this.attachment = void 0;
						this.viewStore.fallbackVisiblePresentation("better-sidebar", "drawer");
					}
				};
				this.attachment = attachment;
				return attachment.dispose;
			}
			createDescriptor(service) {
				const descriptor = {
					id: SIDE_CHAT_TAB_TYPE,
					title: () => this.ctx.locale.bind("btw")("drawer.title"),
					icon: (size) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideChatSign, { size }),
					single: true,
					hidden: false,
					onClose: (_tab, scope) => {
						this.viewStore.minimize(scope.sessionId);
					},
					component: (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BetterSidebarSideChat, {
						...props,
						hostContext: this.ctx,
						controller: this.controller,
						viewStore: this.viewStore,
						presentation: this,
						settingsScope: this.settingsScope
					})
				};
				if (service.features.includes("badge")) descriptor.badge = () => {
					const snapshot = this.controller.getSnapshot();
					if (snapshot.phase === "error") return "!";
					return snapshot.running ? "…" : null;
				};
				return descriptor;
			}
			warnFallback(detail) {
				console.warn(`[dsh-btw] Better Sidebar unavailable; using drawer: ${detail}`);
			}
		};
		//#endregion
		//#region src/client/SideChatButton.tsx
		function SideChatButton({ sessionId, controller, viewStore, presentation, t }) {
			(0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const parentSessionId = String(sessionId);
			const subscribeView = (0, react.useCallback)((listener) => viewStore.subscribe(listener), [viewStore]);
			const getView = (0, react.useCallback)(() => viewStore.get(parentSessionId), [parentSessionId, viewStore]);
			const view = (0, react.useSyncExternalStore)(subscribeView, getView, getView);
			const active = controller.hasConversation(sessionId);
			const label = view.visible ? t("button.close") : t("button.open");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: active ? "outline" : "toolbar",
				size: "sm",
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {}),
				className: active ? side_chat_module_css_default.headerButtonActive : side_chat_module_css_default.headerButton,
				"aria-pressed": view.visible,
				title: label,
				onClick: () => {
					presentation.toggle(parentSessionId);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: side_chat_module_css_default.headerButtonLabel,
					children: t("drawer.title")
				})
			});
		}
		//#endregion
		//#region src/client/SideChatJumpList.tsx
		function entryTitle(entry) {
			const title = entry.title?.trim();
			if (title !== void 0 && title !== "") return title;
			const cwd = entry.cwd;
			if (cwd !== void 0 && cwd !== "") return cwd.split(/[\\/]/).filter((segment) => segment !== "").at(-1) ?? cwd;
			return entry.parentSessionId;
		}
		function truncate(text, limit) {
			return text.length <= limit ? text : text.slice(0, limit) + " …";
		}
		function SideChatJumpList({ controller, viewStore, parentSessionId, t }) {
			const parentKey = String(parentSessionId);
			const subscribeView = (0, react.useCallback)((listener) => viewStore.subscribe(listener), [viewStore]);
			const getView = (0, react.useCallback)(() => viewStore.get(parentKey), [parentKey, viewStore]);
			const view = (0, react.useSyncExternalStore)(subscribeView, getView, getView);
			const currentParent = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot).parentSessionId;
			const [tab, setTab] = (0, react.useState)("tree");
			const [entries, setEntries] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const now = (0, react.useMemo)(() => Date.now(), [entries]);
			(0, react.useEffect)(() => {
				let cancelled = false;
				setLoading(true);
				setError(null);
				(tab === "tree" ? controller.listTree() : controller.listProject()).then((result) => {
					if (cancelled) return;
					if (result.ok) setEntries(result.entries);
					else {
						setEntries([]);
						setError(result.error);
					}
				}).finally(() => {
					if (!cancelled) setLoading(false);
				});
				return () => {
					cancelled = true;
				};
			}, [
				controller,
				parentSessionId,
				tab
			]);
			const jump = async (entry) => {
				const result = await controller.jumpTo(entry.parentSessionId);
				if (!result.ok) {
					setError(result.error);
					return;
				}
				viewStore.show(String(entry.parentSessionId), "drawer");
			};
			const relativeTime = (lastActiveAt) => {
				const deltaSeconds = Math.max(0, Math.floor((now - lastActiveAt) / 1e3));
				if (deltaSeconds < 60) return t("drawer.jumpJustNow");
				const minutes = Math.floor(deltaSeconds / 60);
				if (minutes < 60) return `${minutes}${t("drawer.jumpMinutesSuffix")}`;
				const hours = Math.floor(minutes / 60);
				if (hours < 24) return `${hours}${t("drawer.jumpHoursSuffix")}`;
				return `${Math.floor(hours / 24)}${t("drawer.jumpDaysSuffix")}`;
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: side_chat_module_css_default.jumpList,
				"aria-label": t("drawer.jumpTitle"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: side_chat_module_css_default.jumpToggle,
					"aria-expanded": view.jumpOpen,
					onClick: () => {
						viewStore.setJumpOpen(parentKey, !view.jumpOpen);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: side_chat_module_css_default.jumpCaret,
						"aria-hidden": "true",
						children: view.jumpOpen ? "▾" : "▸"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("drawer.jumpTitle") })]
				}), view.jumpOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: side_chat_module_css_default.jumpBody,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: side_chat_module_css_default.jumpTabs,
						role: "tablist",
						"aria-label": t("drawer.jumpTitle"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							"aria-selected": tab === "tree",
							className: tab === "tree" ? side_chat_module_css_default.jumpTabActive : side_chat_module_css_default.jumpTab,
							onClick: () => {
								setTab("tree");
							},
							children: t("drawer.jumpTree")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							"aria-selected": tab === "project",
							className: tab === "project" ? side_chat_module_css_default.jumpTabActive : side_chat_module_css_default.jumpTab,
							onClick: () => {
								setTab("project");
							},
							children: t("drawer.jumpProject")
						})]
					}), loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: side_chat_module_css_default.jumpHint,
						children: t("drawer.jumpLoading")
					}) : error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: side_chat_module_css_default.jumpHint,
						children: error
					}) : entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: side_chat_module_css_default.jumpHint,
						children: t("drawer.jumpEmpty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: side_chat_module_css_default.jumpEntries,
						children: entries.map((entry) => {
							const current = currentParent !== void 0 && String(currentParent) === entry.parentSessionId;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: current ? side_chat_module_css_default.jumpEntryActive : side_chat_module_css_default.jumpEntry,
								onClick: () => {
									jump(entry);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: side_chat_module_css_default.jumpEntryTitle,
										children: [entryTitle(entry), current ? ` · ${t("drawer.jumpCurrent")}` : ""]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: side_chat_module_css_default.jumpEntryMeta,
										children: [relativeTime(entry.lastActiveAt), entry.running === true ? ` · ${t("drawer.jumpRunning")}` : ""]
									}),
									entry.preview !== void 0 && entry.preview !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: side_chat_module_css_default.jumpEntryPreview,
										children: truncate(entry.preview, 80)
									})
								]
							}) }, entry.parentSessionId);
						})
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/overlay-placement.ts
		const QUANTUM = 4;
		const REGULAR_CONTENT_PEEK = 320;
		const COMPACT_CONTENT_PEEK = 240;
		const MODE_RESERVE = 16;
		const COMPACT_PREFERRED_WIDTH = 400;
		const BOTTOM_SHEET_RATIO = .48;
		const BOTTOM_SHEET_MIN_HEIGHT = 280;
		const BOTTOM_SHEET_MAX_HEIGHT = 560;
		const BOTTOM_SHEET_MAX_WIDTH = 720;
		const NARROW_SHEET_BREAKPOINT = 480;
		const toEdges = (rect) => ({
			left: rect.left,
			top: rect.top,
			right: rect.left + rect.width,
			bottom: rect.top + rect.height
		});
		const fromEdges = (rect) => ({
			left: rect.left,
			top: rect.top,
			width: Math.max(0, rect.right - rect.left),
			height: Math.max(0, rect.bottom - rect.top)
		});
		const ceilQuantum = (value) => Math.ceil(value / QUANTUM) * QUANTUM;
		const floorQuantum = (value) => Math.floor(value / QUANTUM) * QUANTUM;
		const roundQuantum = (value) => Math.round(value / QUANTUM) * QUANTUM;
		const finite = (value) => Number.isFinite(value);
		const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
		function validRect(rect) {
			return finite(rect.left) && finite(rect.top) && finite(rect.width) && finite(rect.height) && rect.width > 0 && rect.height > 0;
		}
		function intersectEdges(first, second) {
			const value = {
				left: Math.max(first.left, second.left),
				top: Math.max(first.top, second.top),
				right: Math.min(first.right, second.right),
				bottom: Math.min(first.bottom, second.bottom)
			};
			return value.right > value.left && value.bottom > value.top ? value : null;
		}
		function mergeIntervals(intervals) {
			const sorted = [...intervals].filter((interval) => interval.end > interval.start).sort((first, second) => first.start - second.start || first.end - second.end);
			const merged = [];
			for (const interval of sorted) {
				const previous = merged.at(-1);
				if (previous === void 0 || interval.start > previous.end) merged.push({ ...interval });
				else previous.end = Math.max(previous.end, interval.end);
			}
			return merged;
		}
		function complement(start, end, intervals) {
			const result = [];
			let cursor = start;
			for (const interval of mergeIntervals(intervals)) {
				if (interval.end <= start || interval.start >= end) continue;
				const clippedStart = Math.max(start, interval.start);
				const clippedEnd = Math.min(end, interval.end);
				if (clippedStart > cursor) result.push({
					start: cursor,
					end: clippedStart
				});
				cursor = Math.max(cursor, clippedEnd);
			}
			if (cursor < end) result.push({
				start: cursor,
				end
			});
			return result;
		}
		function safeAxis(start, end, leadingInset, trailingInset) {
			const insetStart = ceilQuantum(start + leadingInset);
			const insetEnd = floorQuantum(end - trailingInset);
			if (insetEnd > insetStart) return {
				start: insetStart,
				end: insetEnd
			};
			const frameStart = ceilQuantum(start);
			const frameEnd = floorQuantum(end);
			if (frameEnd > frameStart) return {
				start: frameStart,
				end: frameEnd
			};
			return {
				start,
				end: Math.max(start, end)
			};
		}
		function workArea(input) {
			const base = intersectEdges(toEdges(input.frame), toEdges(input.viewport)) ?? intersectEdges(toEdges(input.frame), toEdges(input.frame)) ?? toEdges(input.frame);
			const margin = Math.max(12, input.safeMargin);
			const horizontal = safeAxis(base.left, base.right, margin + Math.max(0, input.safeArea.left), margin + Math.max(0, input.safeArea.right));
			const vertical = safeAxis(base.top, base.bottom, margin + Math.max(0, input.safeArea.top), margin + Math.max(0, input.safeArea.bottom));
			return {
				left: horizontal.start,
				top: vertical.start,
				right: horizontal.end,
				bottom: vertical.end
			};
		}
		function normalizedObstacles(input, work) {
			const margin = Math.max(12, input.safeMargin);
			const values = [];
			for (const rect of input.occupied) {
				if (!validRect(rect)) continue;
				const source = toEdges(rect);
				const expanded = intersectEdges({
					left: floorQuantum(source.left) - margin,
					top: floorQuantum(source.top) - margin,
					right: ceilQuantum(source.right) + margin,
					bottom: ceilQuantum(source.bottom) + margin
				}, work);
				if (expanded !== null) values.push(expanded);
			}
			return values.sort((first, second) => first.left - second.left || first.top - second.top || first.right - second.right || first.bottom - second.bottom);
		}
		function horizontalLanes(work, obstacles) {
			return complement(work.left, work.right, obstacles.map((obstacle) => ({
				start: obstacle.left,
				end: obstacle.right
			})));
		}
		function verticalLanes(work, obstacles) {
			return complement(work.top, work.bottom, obstacles.map((obstacle) => ({
				start: obstacle.top,
				end: obstacle.bottom
			})));
		}
		function finish(input, rect, mode, degraded, reason) {
			const frame = toEdges(input.frame);
			const right = Math.max(0, frame.right - (rect.left + rect.width));
			const bottom = Math.max(0, frame.bottom - (rect.top + rect.height));
			return {
				mode,
				rect,
				left: rect.left - frame.left,
				top: rect.top - frame.top,
				right,
				bottom,
				width: rect.width,
				height: rect.height,
				maxHeight: rect.height,
				degraded,
				reason
			};
		}
		function chooseRight(input, work, obstacles) {
			const lanes = horizontalLanes(work, obstacles);
			const availableHeight = work.bottom - work.top;
			const desiredWidth = floorQuantum(input.desiredWidth);
			const regular = lanes.filter((lane) => lane.end - lane.start >= desiredWidth + REGULAR_CONTENT_PEEK + MODE_RESERVE).map((lane) => ({
				lane,
				rect: fromEdges({
					left: lane.end - desiredWidth,
					top: work.top,
					right: lane.end,
					bottom: work.bottom
				})
			})).sort((first, second) => second.rect.left + second.rect.width - (first.rect.left + first.rect.width) || second.rect.width - first.rect.width || first.rect.left - second.rect.left);
			if (regular[0] !== void 0) return finish(input, regular[0].rect, "right", false, "regular-side-fit");
			const compact = lanes.flatMap((lane) => {
				const laneWidth = floorQuantum(lane.end - lane.start);
				const maximum = floorQuantum(laneWidth - COMPACT_CONTENT_PEEK - MODE_RESERVE);
				const width = Math.min(COMPACT_PREFERRED_WIDTH, maximum);
				if (width < input.minWidth || availableHeight <= 0) return [];
				return [{ rect: fromEdges({
					left: lane.end - width,
					top: work.top,
					right: lane.end,
					bottom: work.bottom
				}) }];
			}).sort((first, second) => second.rect.left + second.rect.width - (first.rect.left + first.rect.width) || second.rect.width - first.rect.width || first.rect.left - second.rect.left);
			return compact[0] === void 0 ? null : finish(input, compact[0].rect, "compact-right", false, "compact-side-fit");
		}
		function sheetHeight(work) {
			const available = work.bottom - work.top;
			return Math.min(available, clamp(roundQuantum(available * BOTTOM_SHEET_RATIO), Math.min(BOTTOM_SHEET_MIN_HEIGHT, available), BOTTOM_SHEET_MAX_HEIGHT));
		}
		function panelLanes(work, obstacles) {
			const workHeight = work.bottom - work.top;
			return horizontalLanes(work, obstacles.filter((obstacle) => obstacle.bottom - obstacle.top >= workHeight * .7));
		}
		function overlapArea(rect, obstacles) {
			const edges = toEdges(rect);
			return obstacles.reduce((sum, obstacle) => {
				const overlap = intersectEdges(edges, obstacle);
				return sum + (overlap === null ? 0 : (overlap.right - overlap.left) * (overlap.bottom - overlap.top));
			}, 0);
		}
		function candidateSheetTops(work, height, obstacles) {
			const minimum = work.top;
			const maximum = Math.max(minimum, work.bottom - height);
			const values = [maximum, ...obstacles.flatMap((obstacle) => [obstacle.top - height, obstacle.bottom])];
			return [...new Set(values.map((value) => clamp(roundQuantum(value), minimum, maximum)))].sort((first, second) => first - second);
		}
		function sheetOrder(work, first, second) {
			return work.bottom - (first.top + first.height) - (work.bottom - (second.top + second.height)) || second.width - first.width || second.height - first.height || second.left + second.width - (first.left + first.width) || first.left - second.left || first.top - second.top;
		}
		function chooseSheet(input, work, obstacles) {
			const targetHeight = sheetHeight(work);
			const availableHeight = Math.max(0, work.bottom - work.top);
			const minimumHeight = Math.min(BOTTOM_SHEET_MIN_HEIGHT, availableHeight);
			const sheetObstacles = Math.min(input.viewport.width, input.frame.width) <= NARROW_SHEET_BREAKPOINT ? obstacles.filter((obstacle) => {
				const width = obstacle.right - obstacle.left;
				const height = obstacle.bottom - obstacle.top;
				return !(obstacle.left <= work.left && width <= 64 && height >= availableHeight * .7);
			}) : obstacles;
			const sideSafeLanes = panelLanes(work, sheetObstacles);
			const clean = [];
			const tops = candidateSheetTops(work, targetHeight, sheetObstacles);
			for (const safeLane of sideSafeLanes) for (const top of tops) {
				const bottom = top + targetHeight;
				const overlappingY = sheetObstacles.filter((obstacle) => obstacle.bottom > top && obstacle.top < bottom);
				const freeAtThisHeight = complement(safeLane.start, safeLane.end, overlappingY.map((obstacle) => ({
					start: obstacle.left,
					end: obstacle.right
				})));
				for (const freeLane of freeAtThisHeight) {
					const width = Math.min(BOTTOM_SHEET_MAX_WIDTH, floorQuantum(freeLane.end - freeLane.start));
					if (width < input.minWidth) continue;
					const rect = fromEdges({
						left: freeLane.end - width,
						top,
						right: freeLane.end,
						bottom
					});
					if (overlapArea(rect, sheetObstacles) === 0) clean.push(rect);
				}
			}
			for (const lane of sideSafeLanes) {
				const width = Math.min(BOTTOM_SHEET_MAX_WIDTH, floorQuantum(lane.end - lane.start));
				if (width < input.minWidth) continue;
				const right = lane.end;
				const left = right - width;
				const overlappingX = sheetObstacles.filter((obstacle) => obstacle.right > left && obstacle.left < right);
				for (const vertical of verticalLanes(work, overlappingX)) {
					const height = Math.min(targetHeight, floorQuantum(vertical.end - vertical.start));
					if (height < minimumHeight) continue;
					const rect = fromEdges({
						left,
						top: vertical.end - height,
						right,
						bottom: vertical.end
					});
					if (overlapArea(rect, obstacles) === 0) clean.push(rect);
				}
			}
			clean.sort((first, second) => sheetOrder(work, first, second));
			if (clean[0] !== void 0) return finish(input, clean[0], "bottom-sheet", false, "clean-bottom-lane");
			const fallbackCandidates = [];
			for (const lane of sideSafeLanes.length === 0 ? [{
				start: work.left,
				end: work.right
			}] : sideSafeLanes) {
				const laneWidth = Math.max(0, lane.end - lane.start);
				const widths = [...new Set([Math.min(BOTTOM_SHEET_MAX_WIDTH, floorQuantum(laneWidth)), Math.min(floorQuantum(laneWidth), input.minWidth)].filter((width) => width > 0))];
				for (const width of widths) {
					const xValues = [
						lane.start,
						lane.end - width,
						...sheetObstacles.flatMap((obstacle) => [obstacle.left - width, obstacle.right])
					];
					const lefts = [...new Set(xValues.map((value) => clamp(roundQuantum(value), lane.start, Math.max(lane.start, lane.end - width))))];
					for (const left of lefts) for (const top of tops) fallbackCandidates.push({
						left,
						top,
						width,
						height: targetHeight
					});
				}
			}
			fallbackCandidates.sort((first, second) => overlapArea(first, sheetObstacles) - overlapArea(second, sheetObstacles) || sheetOrder(work, first, second));
			const fallback = fallbackCandidates[0] ?? {
				left: work.left,
				top: work.top,
				width: Math.max(0, work.right - work.left),
				height: Math.max(0, work.bottom - work.top)
			};
			return finish(input, fallback, "bottom-sheet", true, fallback.width < input.minWidth || fallback.height < minimumHeight ? "undersized-emergency" : "minimum-overlap-fallback");
		}
		function computeOverlayPlacement(input) {
			const work = workArea(input);
			const obstacles = normalizedObstacles(input, work);
			return chooseRight(input, work, obstacles) ?? chooseSheet(input, work, obstacles);
		}
		//#endregion
		//#region src/client/use-overlay-placement.ts
		const DEFAULT_AVOID_SELECTORS = [
			"[data-dsh-btw-avoid]",
			"[data-dsh-shutdown-float] button",
			"[data-dsh-better-sidebar] button"
		];
		const ZERO_INSETS = {
			top: 0,
			right: 0,
			bottom: 0,
			left: 0
		};
		const FALLBACK_WIDTH = 1280;
		const FALLBACK_HEIGHT = 800;
		function toRect(rect) {
			return {
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height
			};
		}
		function positiveRect(element) {
			if (element === null) return null;
			const rect = element.getBoundingClientRect();
			if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return null;
			const style = getComputedStyle(element);
			if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return null;
			return toRect(rect);
		}
		function isOwnedBySideChat(element, root) {
			return element === root || root.contains(element) || element.matches("[data-dsh-btw-root]");
		}
		function pane(frame, name) {
			const marked = frame.querySelector(":scope > [data-pane=\"" + name + "\"]");
			if (marked !== null) return marked;
			const byClass = [...frame.children].find((element) => element instanceof HTMLElement && element.className.includes(name === "sidebar" ? "sidebarCol" : "detailsCol"));
			if (byClass instanceof HTMLElement) return byClass;
			const overlayIndex = [...frame.children].findIndex((element) => element.matches("[data-shell-overlay]"));
			if (overlayIndex < 3) return null;
			const candidate = name === "sidebar" ? frame.children[0] : frame.children[overlayIndex - 1];
			return candidate instanceof HTMLElement ? candidate : null;
		}
		function configuredSelectors(options) {
			const values = [
				...DEFAULT_AVOID_SELECTORS,
				...options.avoidSelectors ?? [],
				...typeof window === "undefined" ? [] : window.__DSH_SIDE_CHAT_AVOID_SELECTORS__ ?? []
			];
			return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 32);
		}
		function safeQueryAll(selector) {
			try {
				return [...document.querySelectorAll(selector)];
			} catch {
				return [];
			}
		}
		function safeInsets(root) {
			const probe = root.querySelector("[data-dsh-btw-safe-area]");
			if (probe === null) return ZERO_INSETS;
			const style = getComputedStyle(probe);
			const parse = (value) => {
				const parsed = Number.parseFloat(value);
				return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
			};
			return {
				top: parse(style.paddingTop),
				right: parse(style.paddingRight),
				bottom: parse(style.paddingBottom),
				left: parse(style.paddingLeft)
			};
		}
		function visualViewportRect() {
			const visual = window.visualViewport;
			if (visual != null) return {
				left: visual.offsetLeft,
				top: visual.offsetTop,
				width: visual.width,
				height: visual.height
			};
			return {
				left: 0,
				top: 0,
				width: window.innerWidth,
				height: window.innerHeight
			};
		}
		function geometryElements(root, options) {
			const overlay = root.closest("[data-shell-overlay]");
			const frame = overlay?.parentElement ?? null;
			const nativePanes = frame === null ? [] : [pane(frame, "sidebar"), pane(frame, "details")].filter((value) => value !== null);
			const slotHost = root.closest("[data-slot=\"shell.overlay\"]");
			return {
				overlay,
				frame,
				nativePanes,
				siblingEntries: slotHost === null ? [] : [...slotHost.children].filter((element) => element instanceof HTMLElement && !isOwnedBySideChat(element, root)),
				explicitAvoid: configuredSelectors(options).flatMap(safeQueryAll).filter((element) => !isOwnedBySideChat(element, root)),
				slotHost
			};
		}
		function isFullFrameClickThrough(element, rect, frame) {
			if (getComputedStyle(element).pointerEvents !== "none") return false;
			const tolerance = 4;
			return rect.left <= frame.left + tolerance && rect.top <= frame.top + tolerance && rect.left + rect.width >= frame.left + frame.width - tolerance && rect.top + rect.height >= frame.top + frame.height - tolerance;
		}
		function dedupeRects(rects) {
			const seen = /* @__PURE__ */ new Set();
			const result = [];
			for (const rect of rects) {
				const key = [
					rect.left,
					rect.top,
					rect.width,
					rect.height
				].map((value) => value.toFixed(2)).join(":");
				if (seen.has(key)) continue;
				seen.add(key);
				result.push(rect);
			}
			return result;
		}
		function collectOverlayGeometry(root, options = {}) {
			const elements = geometryElements(root, options);
			const frameRect = positiveRect(elements.overlay) ?? positiveRect(elements.frame) ?? visualViewportRect();
			const measured = (element) => {
				const rect = positiveRect(element);
				return rect === null ? [] : [rect];
			};
			const siblingRects = elements.siblingEntries.flatMap((element) => {
				const rect = positiveRect(element);
				if (rect === null || isFullFrameClickThrough(element, rect, frameRect)) return [];
				return [rect];
			});
			const occupied = dedupeRects([
				...elements.nativePanes.flatMap(measured),
				...siblingRects,
				...elements.explicitAvoid.flatMap(measured)
			]);
			const viewport = visualViewportRect();
			const safeArea = safeInsets(root);
			const desiredWidth = options.desiredWidth ?? 448;
			const minWidth = options.minWidth ?? 360;
			const safeMargin = options.safeMargin ?? 12;
			return {
				frame: frameRect,
				viewport,
				safeArea,
				occupied,
				compute: () => computeOverlayPlacement({
					frame: frameRect,
					viewport,
					desiredWidth,
					minWidth,
					safeMargin,
					safeArea,
					occupied
				})
			};
		}
		function fallbackPlacement(options) {
			const frame = {
				left: 0,
				top: 0,
				width: typeof window === "undefined" ? FALLBACK_WIDTH : Math.max(1, window.innerWidth),
				height: typeof window === "undefined" ? FALLBACK_HEIGHT : Math.max(1, window.innerHeight)
			};
			return computeOverlayPlacement({
				frame,
				viewport: frame,
				desiredWidth: options.desiredWidth ?? 448,
				minWidth: options.minWidth ?? 360,
				safeMargin: options.safeMargin ?? 12,
				safeArea: ZERO_INSETS,
				occupied: []
			});
		}
		function samePlacement(first, second) {
			return first.mode === second.mode && first.left === second.left && first.top === second.top && first.right === second.right && first.bottom === second.bottom && first.width === second.width && first.height === second.height && first.degraded === second.degraded && first.reason === second.reason;
		}
		function useOverlayPlacement(rootRef, options = {}) {
			const [placement, setPlacement] = (0, react.useState)(() => fallbackPlacement(options));
			const selectorKey = options.avoidSelectors?.join("\n") ?? "";
			const desiredWidth = options.desiredWidth ?? 448;
			const minWidth = options.minWidth ?? 360;
			const safeMargin = options.safeMargin ?? 12;
			const enabled = options.enabled ?? true;
			(0, react.useLayoutEffect)(() => {
				const root = rootRef.current;
				if (!enabled || root === null) return;
				const stableOptions = {
					desiredWidth,
					minWidth,
					safeMargin,
					avoidSelectors: selectorKey === "" ? [] : selectorKey.split("\n")
				};
				let frameRequest = null;
				let disposed = false;
				const observed = /* @__PURE__ */ new Set();
				const resizeObserver = new ResizeObserver(() => {
					schedule();
				});
				const observeCurrentElements = () => {
					const elements = geometryElements(root, stableOptions);
					const targets = [
						elements.overlay,
						elements.frame,
						...elements.nativePanes,
						...elements.siblingEntries,
						...elements.explicitAvoid
					].filter((value) => value !== null && !isOwnedBySideChat(value, root));
					for (const target of targets) {
						if (observed.has(target)) continue;
						observed.add(target);
						resizeObserver.observe(target);
					}
					return elements;
				};
				const measure = () => {
					frameRequest = null;
					if (disposed) return;
					observeCurrentElements();
					const next = collectOverlayGeometry(root, stableOptions).compute();
					setPlacement((current) => samePlacement(current, next) ? current : next);
				};
				function schedule() {
					if (disposed || frameRequest !== null) return;
					frameRequest = requestAnimationFrame(measure);
				}
				const initial = observeCurrentElements();
				const mutationObserver = new MutationObserver((records) => {
					if (records.some((record) => {
						if (!(record.target instanceof Node) || !root.contains(record.target)) return true;
						return [...record.addedNodes, ...record.removedNodes].some((node) => !(node instanceof Node) || !root.contains(node));
					})) schedule();
				});
				if (initial.frame !== null) mutationObserver.observe(initial.frame, {
					attributes: true,
					attributeFilter: [
						"style",
						"class",
						"data-sidebar-collapsed",
						"data-details-collapsed",
						"data-dragging"
					],
					childList: true
				});
				if (initial.slotHost !== null) mutationObserver.observe(initial.slotHost, {
					childList: true,
					subtree: true
				});
				mutationObserver.observe(document.body, { childList: true });
				for (const target of initial.explicitAvoid) mutationObserver.observe(target, {
					attributes: true,
					childList: true,
					subtree: true
				});
				const visual = window.visualViewport;
				window.addEventListener("resize", schedule, { passive: true });
				visual?.addEventListener("resize", schedule, { passive: true });
				visual?.addEventListener("scroll", schedule, { passive: true });
				schedule();
				return () => {
					disposed = true;
					if (frameRequest !== null) cancelAnimationFrame(frameRequest);
					resizeObserver.disconnect();
					mutationObserver.disconnect();
					window.removeEventListener("resize", schedule);
					visual?.removeEventListener("resize", schedule);
					visual?.removeEventListener("scroll", schedule);
				};
			}, [
				desiredWidth,
				enabled,
				minWidth,
				rootRef,
				safeMargin,
				selectorKey
			]);
			return placement;
		}
		function overlayPlacementStyle(placement) {
			return {
				"--side-chat-left": String(placement.left) + "px",
				"--side-chat-top": String(placement.top) + "px",
				"--side-chat-right": String(placement.right) + "px",
				"--side-chat-bottom": String(placement.bottom) + "px",
				"--side-chat-width": String(placement.width) + "px",
				"--side-chat-height": String(placement.height) + "px",
				"--side-chat-max-height": String(placement.maxHeight) + "px"
			};
		}
		//#endregion
		//#region src/client/SideChatDrawer.tsx
		function SideChatDrawer({ controller, viewStore, parentSessionId, settingsScope, t, onMinimize, onEnd }) {
			const state = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const activeParentSessionId = state.parentSessionId ?? parentSessionId;
			const parentKey = String(activeParentSessionId);
			const subscribeView = (0, react.useCallback)((listener) => viewStore.subscribe(listener), [viewStore]);
			const getView = (0, react.useCallback)(() => viewStore.get(parentKey), [parentKey, viewStore]);
			const view = (0, react.useSyncExternalStore)(subscribeView, getView, getView);
			const placementRootRef = (0, react.useRef)(null);
			const visible = state.phase !== "closed" && state.parentSessionId !== void 0 && String(state.parentSessionId) === parentKey && view.visible && view.presentation === "drawer";
			const placement = useOverlayPlacement(placementRootRef, { enabled: visible });
			(0, react.useEffect)(() => {
				if (!visible) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					onMinimize();
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [onMinimize, visible]);
			if (!visible) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: placementRootRef,
				className: side_chat_module_css_default.placementRoot,
				"data-dsh-btw-root": true,
				"data-placement-mode": placement.mode,
				"data-placement-degraded": placement.degraded || void 0,
				style: overlayPlacementStyle(placement),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: side_chat_module_css_default.safeAreaProbe,
						"data-dsh-btw-safe-area": true,
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: side_chat_module_css_default.mobileScrim,
						"data-dsh-btw-scrim": true,
						"aria-label": t("drawer.minimize"),
						onClick: onMinimize
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
						className: side_chat_module_css_default.drawer,
						"data-dsh-btw-drawer": true,
						role: "complementary",
						"aria-label": t("drawer.title"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideChatJumpList, {
							parentSessionId: activeParentSessionId,
							controller,
							viewStore,
							t
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideChatSurface, {
							parentSessionId: activeParentSessionId,
							controller,
							viewStore,
							t,
							surfaceMode: "drawer",
							settingsScope,
							onMinimize,
							onEnd
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/view-store.ts
		const EMPTY_VIEW = Object.freeze({
			visible: false,
			draft: "",
			sendError: null,
			presentation: "drawer",
			attachments: Object.freeze([]),
			jumpOpen: false
		});
		var SideChatViewStore = class {
			entries = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			get(parentSessionId) {
				return this.entries.get(parentSessionId) ?? EMPTY_VIEW;
			}
			show(parentSessionId, presentation) {
				this.update(parentSessionId, (state) => ({
					...state,
					visible: true,
					presentation
				}));
			}
			minimize(parentSessionId) {
				this.update(parentSessionId, (state) => ({
					...state,
					visible: false
				}));
			}
			setDraft(parentSessionId, draft) {
				this.update(parentSessionId, (state) => ({
					...state,
					draft,
					sendError: null
				}));
			}
			setSendError(parentSessionId, sendError) {
				this.update(parentSessionId, (state) => ({
					...state,
					sendError
				}));
			}
			/** Append one pasted image to the composer rail (R1-1). */
			addAttachment(parentSessionId, image) {
				this.update(parentSessionId, (state) => ({
					...state,
					attachments: Object.freeze([...state.attachments, image])
				}));
			}
			/** Remove one pasted image from the composer rail by index. */
			removeAttachment(parentSessionId, index) {
				this.update(parentSessionId, (state) => {
					if (index < 0 || index >= state.attachments.length) return state;
					return {
						...state,
						attachments: Object.freeze(state.attachments.filter((_, i) => i !== index))
					};
				});
			}
			/** Clear the composer rail (after a successful send). */
			clearAttachments(parentSessionId) {
				this.update(parentSessionId, (state) => state.attachments.length === 0 ? state : {
					...state,
					attachments: Object.freeze([])
				});
			}
			/** Toggle the drawer jump list expansion. */
			setJumpOpen(parentSessionId, jumpOpen) {
				this.update(parentSessionId, (state) => state.jumpOpen === jumpOpen ? state : {
					...state,
					jumpOpen
				});
			}
			clear(parentSessionId) {
				if (!this.entries.delete(parentSessionId)) return;
				this.publish();
			}
			fallbackVisiblePresentation(from, to) {
				let changed = false;
				for (const [parentSessionId, state] of this.entries) {
					if (!state.visible || state.presentation !== from) continue;
					this.entries.set(parentSessionId, Object.freeze({
						...state,
						presentation: to
					}));
					changed = true;
				}
				if (changed) this.publish();
			}
			update(parentSessionId, change) {
				const previous = this.get(parentSessionId);
				const next = Object.freeze(change(previous));
				if (Object.is(previous, next)) return;
				this.entries.set(parentSessionId, next);
				this.publish();
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function joinValues(array, separator = "|") {
			return array.map((val) => stringifyPrimitive(val)).join(separator);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		var Cached = class {
			constructor(getter) {
				this._getter = getter;
				this._value = void 0;
			}
			get value() {
				const getter = this._getter;
				if (getter !== void 0) {
					this._value = getter();
					this._getter = void 0;
				}
				return this._value;
			}
		};
		function cached(getter) {
			return new Cached(getter);
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		/**
		* Whichever object a def's `shape` currently answers from: the one the caller passed until the first read, the frozen copy after it.
		*
		* Its keys and descriptors read without invoking anything, which is what lets a discriminated union check its discriminator, and the cycle walk read a shape, without resolving a getter that references the schema being constructed. A def that answers `shape` from an accessor of its own has none.
		*/
		function rawShape(def) {
			const desc = Object.getOwnPropertyDescriptor(def, "shape");
			return desc?.get ? desc.get.raw : desc?.value;
		}
		function sourceShape(schema) {
			return rawShape(schema._zod.def) ?? schema._zod.def.shape;
		}
		function deferProp(target, key, getter) {
			Object.defineProperty(target, key, {
				get() {
					const value = getter();
					assignProp(this, key, value);
					return value;
				},
				enumerable: true,
				configurable: true
			});
		}
		function putProp(target, key, value) {
			if (key in target) assignProp(target, key, value);
			else target[key] = value;
		}
		/**
		* Copies `keys` of `source`'s shape onto `target`, each value passed through `wrap`.
		*
		* A key the source has resolved is copied through now, so the derived shape states it outright and nothing has to resolve it to learn what it holds. A key the source still defers stays deferred, and reads back through the source's own `shape`, so it resolves once and both shapes get that one schema.
		*/
		function mirrorShape(target, source, keys, wrap) {
			const raw = sourceShape(source);
			for (const key of keys) {
				const desc = Object.getOwnPropertyDescriptor(raw, key);
				if (!desc.enumerable) continue;
				if (desc.get) deferProp(target, key, () => {
					const value = source._zod.def.shape[key];
					return wrap ? wrap(value, key) : value;
				});
				else putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
			}
		}
		function mirrorProps(target, source) {
			for (const key of Reflect.ownKeys(source)) {
				const desc = Object.getOwnPropertyDescriptor(source, key);
				if (!desc.enumerable) continue;
				if (desc.get) deferProp(target, key, () => source[key]);
				else putProp(target, key, desc.value);
			}
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) {
				const descriptors = Object.getOwnPropertyDescriptors(def);
				Object.assign(mergedDescriptors, descriptors);
			}
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function stringifyPrimitive(value) {
			if (typeof value === "bigint") return value.toString() + "n";
			if (typeof value === "string") return `"${value}"`;
			return `${value}`;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = /*@__PURE__*/ (() => ({
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		}))();
		const BIGINT_FORMAT_RANGES = {
			int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
			uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			const newShape = {};
			mirrorShape(newShape, schema, maskedKeys(schema, mask));
			return clone(schema, mergeDefs(currDef, {
				shape: newShape,
				checks: []
			}));
		}
		function maskedKeys(schema, mask) {
			const raw = sourceShape(schema);
			const keys = [];
			for (const key of Reflect.ownKeys(mask)) {
				if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) throw new Error(`Unrecognized key: "${String(key)}"`);
				if (mask[key]) keys.push(key);
			}
			return keys;
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			const omitted = new Set(maskedKeys(schema, mask));
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
			return clone(schema, mergeDefs(currDef, {
				shape: newShape,
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = sourceShape(schema);
				for (const key of Reflect.ownKeys(shape)) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
		}
		function extended(schema, shape) {
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
			mirrorProps(newShape, shape);
			return newShape;
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
		}
		function merge(a, b) {
			if (!b?._zod?.def) throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			const newShape = {};
			mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
			mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
			return clone(a, mergeDefs(a._zod.def, {
				shape: newShape,
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask, name = "partial") {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
			const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({
				type: "optional",
				innerType: value
			})));
			return clone(schema, mergeDefs(schema._zod.def, {
				shape: newShape,
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({
				type: "nonoptional",
				innerType: value
			}));
			return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function attachSchema(issues, start, inst) {
			var _a;
			for (let i = start; i < issues.length; i++) (_a = issues[i]).schema ?? (_a.schema = inst);
		}
		function finalizeIssue(iss, ctx, config) {
			var _a;
			const traits = iss.inst?._zod?.traits;
			if (traits?.has("$ZodType")) {
				if (traits.has("$ZodCheck")) (_a = iss).schema ?? (_a.schema = iss.inst);
				else iss.schema = iss.inst;
			}
			const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const full = {};
			for (const k of Object.keys(iss)) {
				if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__") continue;
				full[k] = iss[k];
			}
			full.path ?? (full.path = []);
			full.message = message;
			if (ctx?.reportInput) full.input = iss.input;
			return full;
		}
		const highSurrogate = /[\uD800-\uDBFF]/;
		function codePointLength(str) {
			const units = str.length;
			if (!highSurrogate.test(str)) return units;
			let count = units;
			for (let i = 0; i < units - 1; i++) if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
				count--;
				i++;
			}
			return count;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function parsedType(data) {
			const t = typeof data;
			switch (t) {
				case "number": return Number.isNaN(data) ? "nan" : "number";
				case "object": {
					if (data === null) return "null";
					if (Array.isArray(data)) return "array";
					const obj = data;
					if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) return obj.constructor.name;
				}
			}
			return t;
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		/**
		* Installs a trait's members on its prototype. Each value builds that member for the instance on first read; the built value shadows the accessor as an own property, so a detached `const { parse } = schema` keeps working.
		*
		* Call this from a `proto` initializer, which runs once per prototype — never per instance.
		*/
		function members(proto, table) {
			for (const key in table) {
				const desc = Object.getOwnPropertyDescriptor(table, key);
				if (desc.get) Object.defineProperty(proto, key, {
					...desc,
					enumerable: false
				});
				else defineBound(proto, key, desc.value);
			}
			for (const sym of Object.getOwnPropertySymbols(table)) defineBound(proto, sym, table[sym]);
		}
		/** Shadows a prototype member with an own value, so a getter that builds from the instance runs once. */
		function own(inst, key, value, enumerable = true) {
			Object.defineProperty(inst, key, {
				configurable: true,
				writable: true,
				enumerable,
				value
			});
			return value;
		}
		/** Like {@link own}, for a member that was never an own data property and has to stay out of `Object.keys`. */
		function hide(inst, key, value) {
			return own(inst, key, value, false);
		}
		/** Adds members a table derives from the instance: each builds on first read and shadows as own data, and assignment shadows the same way, as when these were own properties. */
		function derived(computes, table) {
			for (const key in computes) {
				const compute = computes[key];
				Object.defineProperty(table, key, {
					configurable: true,
					enumerable: true,
					get() {
						return own(this, key, compute(this));
					},
					set(value) {
						own(this, key, value);
					}
				});
			}
			return table;
		}
		function defineBound(proto, key, fn) {
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					return this == null ? fn : own(this, key, fn.bind(this));
				},
				set(value) {
					own(this, key, value);
				}
			});
		}
		/** Returns the prototype to install on, or `undefined` if this group is already installed on it. */
		function claim(inst, sentinel) {
			const proto = Object.getPrototypeOf(inst);
			return sentinel in proto ? void 0 : proto;
		}
		let installing;
		let broke = false;
		const breaker = {
			configurable: true,
			get() {
				broke = true;
			}
		};
		/**
		* Installs a lazily-derived internal on the `_zod` prototype of `inst`'s
		* constructor, computed from the internals object itself and cached there on
		* first read. One accessor per constructor rather than one per instance.
		*/
		function defineLazyInternal(inst, key, compute) {
			const proto = Object.getPrototypeOf(inst._zod);
			if (key in proto && installing !== inst._zod) {
				installing = void 0;
				return;
			}
			installing = inst._zod;
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					Object.defineProperty(this, key, breaker);
					const outer = broke;
					broke = false;
					try {
						const value = compute(this);
						if (broke) delete this[key];
						else Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							value
						});
						broke = broke || outer;
						return value;
					} catch (err) {
						delete this[key];
						broke = broke || outer;
						throw err;
					}
				},
				set(value) {
					Object.defineProperty(this, key, {
						configurable: true,
						writable: true,
						value
					});
				}
			});
		}
		/**
		* Installs `key` on `inst`'s prototype, computed by `make` on first read and cached there as an own
		* data property. One accessor per constructor rather than one per instance, because an own accessor
		* puts every instance after the first into v8 dictionary mode. The key doubles as the sentinel.
		*/
		function installLazyProp(inst, key, make, enumerable) {
			const proto = claim(inst, key);
			if (!proto) return;
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					const desc = {
						configurable: true,
						writable: true,
						enumerable,
						value: void 0
					};
					Object.defineProperty(this, key, desc);
					desc.value = make(this);
					Object.defineProperty(this, key, desc);
					return desc.value;
				},
				set(value) {
					Object.defineProperty(this, key, {
						configurable: true,
						writable: true,
						enumerable,
						value
					});
				}
			});
		}
		/** Marks the thunk `_catch` synthesises for a constant catch value. `Function.length` cannot tell that thunk from a user callback — rest and defaulted parameters both report arity 0 — and a user callback reads `ctx.error`, whose issues only finalize correctly against the caller's per-parse error map. Provenance can say what arity cannot. A plain string key rather than `Symbol.for`, whose call at module scope no bundler can prove pure — the same shape that anchored `urlCanParse` into every build. */
		const CONSTANT_CATCH = "~constantCatch";
		/** Wraps a constant catch value in a thunk tagged with {@link CONSTANT_CATCH}. */
		function constantCatch(value) {
			const fn = () => value;
			fn[CONSTANT_CATCH] = true;
			return fn;
		}
		//#endregion
		//#region node_modules/zod/v4/core/core.js
		var _a$1;
		const _zodDesc = {
			value: void 0,
			enumerable: false
		};
		let _E = "captureStackTrace" in Error ? Error : null;
		function newError(Definition) {
			const E = _E;
			if (E) {
				const saved = E.stackTraceLimit;
				if (typeof saved === "number") {
					try {
						E.stackTraceLimit = 0;
					} catch {
						_E = null;
						return new Definition();
					}
					try {
						return new Definition();
					} finally {
						E.stackTraceLimit = saved;
					}
				}
			}
			return new Definition();
		}
		function $constructor(name, initializer, proto, params) {
			const zodProto = {};
			function Internals(def) {
				this.def = def;
				this.constr = _;
				this.traits = /* @__PURE__ */ new Set();
			}
			Internals.prototype = zodProto;
			const protoMembers = proto;
			const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
			function init(inst, def) {
				if (!inst._zod) {
					_zodDesc.value = new Internals(def);
					try {
						Object.defineProperty(inst, "_zod", _zodDesc);
					} finally {
						_zodDesc.value = void 0;
					}
				}
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				if (initialized) {
					const own = Object.getPrototypeOf(inst);
					const ctorProto = inst._zod.constr.prototype;
					let up = own;
					while (up && up !== ctorProto) up = Object.getPrototypeOf(up);
					const target = up ?? own;
					if (!initialized.has(target)) {
						initialized.add(target);
						members(target, protoMembers);
					}
				}
				const proto = _.prototype;
				for (const k in proto) {
					if (!Object.prototype.hasOwnProperty.call(proto, k)) continue;
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				const inst = params?.Parent ? newError(Definition) : this;
				init(inst, def);
				const deferred = inst._zod.deferred;
				if (deferred) {
					for (const fn of deferred) fn();
					inst._zod.deferred = void 0;
				}
				const pp = globalThis.__zod_globalConfig?.postProcessor;
				if (pp) pp(inst);
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region node_modules/zod/v4/core/errors.js
		function _getMessage() {
			const internals = this._zod;
			internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
			return internals.message;
		}
		function _setMessage(value) {
			this._zod.message = value;
		}
		const _messageDesc = {
			get: _getMessage,
			set: _setMessage,
			enumerable: true,
			configurable: true
		};
		const _issuesDesc = {
			value: void 0,
			enumerable: false
		};
		const _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			_issuesDesc.value = def;
			Object.defineProperty(inst, "issues", _issuesDesc);
			_issuesDesc.value = void 0;
			Object.defineProperty(inst, "message", _messageDesc);
			const proto = Object.getPrototypeOf(inst);
			if (!_installedToString.has(proto)) {
				_installedToString.add(proto);
				Object.defineProperty(proto, "toString", {
					configurable: true,
					enumerable: false,
					get() {
						const value = () => this.message;
						Object.defineProperty(this, "toString", {
							value,
							configurable: true,
							writable: true
						});
						return value;
					},
					set(value) {
						Object.defineProperty(this, "toString", {
							value,
							configurable: true,
							writable: true
						});
					}
				});
			}
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		$constructor("$ZodError", initializer$1, void 0, { Parent: Error });
		/** Get-or-create `obj[key]` as an own data property. A path segment naming an inherited member
		* ("toString", "constructor") would otherwise read through to the prototype, and assigning
		* "__proto__" would hit the setter instead of creating a key. */
		function node(obj, key, make) {
			if (!Object.prototype.hasOwnProperty.call(obj, key)) {
				if (key === "__proto__") Object.defineProperty(obj, key, {
					value: make(),
					writable: true,
					enumerable: true,
					configurable: true
				});
				else obj[key] = make();
			}
			return obj[key];
		}
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
			else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							const terminal = i === fullpath.length - 1;
							if (el === "_errors") {
								if (terminal) curr._errors.push(mapper(issue));
								i++;
								continue;
							}
							if (!Object.prototype.hasOwnProperty.call(curr, el)) Object.defineProperty(curr, el, {
								value: { _errors: [] },
								enumerable: true,
								writable: true,
								configurable: true
							});
							const node = curr[el];
							if (terminal) node._errors.push(mapper(issue));
							curr = node;
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region node_modules/zod/v4/core/parse.js
		function finalizeParams(callee, params) {
			return {
				callee: params?.callee ?? callee,
				Err: params?.Err
			};
		}
		const _parse = (_Err) => {
			const fn = (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					async: false
				} : { async: false };
				const result = schema._zod.run({
					value,
					issues: []
				}, ctx);
				if (result instanceof Promise) throw new $ZodAsyncError();
				if (result.issues.length) {
					const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
					captureStackTrace(e, _params?.callee ?? fn);
					throw e;
				}
				return result.value;
			};
			return fn;
		};
		const _parseAsync = (_Err) => {
			const fn = async (schema, value, _ctx, params) => {
				const ctx = _ctx ? {
					..._ctx,
					async: true
				} : { async: true };
				let result = schema._zod.run({
					value,
					issues: []
				}, ctx);
				if (result instanceof Promise) result = await result;
				if (result.issues.length) {
					const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
					captureStackTrace(e, params?.callee ?? fn);
					throw e;
				}
				return result.value;
			};
			return fn;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? failure(_Err, result.issues, ctx) : {
				success: true,
				data: result.value
			};
		};
		function failure(Err, issues, ctx) {
			let error;
			return {
				success: false,
				get error() {
					if (!error) {
						error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
						issues = void 0;
						ctx = void 0;
					}
					return error;
				},
				set error(e) {
					error = e;
					issues = void 0;
					ctx = void 0;
				}
			};
		}
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? failure(_Err, result.issues, ctx) : {
				success: true,
				data: result.value
			};
		};
		const COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
		const COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
		const validate = ((schema, value, _ctx) => {
			const validator = schema._zod.bag.validator;
			if (validator !== void 0) {
				if (validator(value) !== COMPILE_INVALID) return true;
				if (validator.definite === true && _ctx === void 0) return false;
			}
			return validateFallback(schema, value, _ctx);
		});
		function validateFallback(schema, value, _ctx) {
			const ctx = _ctx ? {
				..._ctx,
				async: false,
				abortEarly: true
			} : {
				async: false,
				abortEarly: true
			};
			const fallbackRun = schema._zod.bag.fallbackRun;
			let result;
			if (fallbackRun) {
				ctx[COMPILE_FALLBACK] = true;
				result = fallbackRun({
					value,
					issues: []
				}, ctx);
			} else result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length === 0;
		}
		const validateAsync$1 = async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true,
				abortEarly: true
			} : {
				async: true,
				abortEarly: true
			};
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length === 0;
		};
		const _encode = (_Err) => {
			const parse = _parse(_Err);
			const fn = (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					direction: "backward"
				} : { direction: "backward" };
				return parse(schema, value, ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _decode = (_Err) => {
			const parse = _parse(_Err);
			const fn = (schema, value, _ctx, _params) => {
				return parse(schema, value, _ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _encodeAsync = (_Err) => {
			const parseAsync = _parseAsync(_Err);
			const fn = async (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					direction: "backward"
				} : { direction: "backward" };
				return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _decodeAsync = (_Err) => {
			const parseAsync = _parseAsync(_Err);
			const fn = async (schema, value, _ctx, _params) => {
				return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		function nanoidOfLength(length) {
			return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
		}
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		/** Anchors a pattern source. The interpolation lives here rather than at the call site because
		* esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
		* will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */
		function anchor(source) {
			return new RegExp(`^${source}$`);
		}
		const date = /*@__PURE__*/ anchor(dateSource);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime(args) {
			const opts = ["Z"];
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const qualified = `${timeSource({
				precision: args.precision,
				seconds: true
			})}(?:${opts.join("|")})`;
			const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const anyString = /^[\s\S]{0,}$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const boolean$1 = /^(?:true|false)$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		/** Default `when` for length-based checks: run only on non-nullish values with a `length`. */
		const _whenHasLength = (payload) => {
			const val = payload.value;
			return !nullish(val) && val.length !== void 0;
		};
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin: numericOriginMap[typeof payload.value] ?? origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin: numericOriginMap[typeof payload.value] ?? origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				if ((typeof input === "string" && units > def.maximum ? codePointLength(input) : units) <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				if ((typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units) >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			def.pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = [], closed = {}) {
				this.content = [];
				this.indent = 0;
				this.args = args;
				this.closed = closed;
			}
			indented(fn) {
				this.indent += 1;
				try {
					fn(this);
				} finally {
					this.indent -= 1;
				}
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const content = this?.content ?? [``];
				return new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${content.join("\n")}\n};`)(...Object.values(this.closed));
			}
		};
		//#endregion
		//#region node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 6,
			patch: 2
		};
		//#endregion
		//#region node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const defChecks = inst._zod.def.checks;
			const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					if (payload.memo) return payload;
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							attachSchema(payload.issues, currLen, inst);
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							attachSchema(payload.issues, currLen, inst);
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
		}, {
			get "~standard"() {
				return hide(this, "~standard", standardProps(this));
			},
			set "~standard"(value) {
				own(this, "~standard", value);
			}
		});
		/** The Standard Schema surface for `inst`. Shared so wrappers can extend it without forcing it. */
		const toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
		async function validateAsync(inst, value) {
			const ctx = { async: true };
			return toStandardResult(await inst._zod.run({
				value,
				issues: []
			}, ctx), ctx);
		}
		function standardProps(inst) {
			return {
				validate: (value) => {
					const ctx = { async: false };
					try {
						const r = inst._zod.run({
							value,
							issues: []
						}, ctx);
						if (!(r instanceof Promise)) return toStandardResult(r, ctx);
					} catch (_) {}
					return validateAsync(inst, value);
				},
				vendor: "zod",
				version: 1
			};
		}
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = def.pattern ?? anyString;
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		/** Parses a URL for `$ZodURL`, applying the one guard the URL constructor cannot express. Returns the parsed URL, or a code naming the stage that rejected it — the runtime needs that distinction to pick an issue note, and compiled code only needs to know it is not a URL. */
		function parseURLObject(trimmed, def) {
			if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) return 1;
			try {
				return new URL(trimmed);
			} catch {
				return 2;
			}
		}
		const asciiTabOrNewline = /[\t\n\r]/g;
		/** The URL parser deletes every ASCII tab, LF and CR from its input before it parses, so `new URL("https://exa\nmple.com")` reports on `example.com`. Applying the same deletion to the returned value closes the half of that divergence which can move the host; the parser's other rewrite, stripping C0 controls at the edges, cannot. */
		function stripTabAndNewline(value) {
			return value.replace(asciiTabOrNewline, "");
		}
		function urlHostnameOk(url, hostname) {
			hostname.lastIndex = 0;
			return hostname.test(url.hostname);
		}
		function urlProtocolOk(url, protocol) {
			protocol.lastIndex = 0;
			return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
		}
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					const url = parseURLObject(trimmed, def);
					if (url === 1) {
						payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid URL format",
							input: payload.value,
							inst,
							continue: !def.abort
						});
						return;
					}
					if (url === 2) {
						payload.issues.push({
							code: "invalid_format",
							format: "url",
							input: payload.value,
							inst,
							continue: !def.abort
						});
						return;
					}
					if (def.hostname && !urlHostnameOk(url, def.hostname)) payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid hostname",
						pattern: def.hostname.source,
						input: payload.value,
						inst,
						continue: !def.abort
					});
					if (def.protocol && !urlProtocolOk(url, def.protocol)) payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid protocol",
						pattern: def.protocol.source,
						input: payload.value,
						inst,
						continue: !def.abort
					});
					payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1)) throw new Error(`Invalid nanoid length: ${def.length}`);
			def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
		});
		/** An IPv6 address is written with hex digits, colons and dots, and nothing else. The guard is what makes the check below an IPv6 check: `new URL("http://[...]")` parses an authority, not an address, so `@` and `\` re-delimit it and `"::@1\\"` validates against the host `0.0.0.1`. The URL parser also deletes ASCII tab, LF and CR rather than failing, which is how `"::1\n"` validated as `::1`. */
		const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
		function isValidIPv6(value) {
			if (!ipv6Alphabet.test(value)) return false;
			try {
				new URL(`http://[${value}]`);
				return true;
			} catch {
				return false;
			}
		}
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (!isValidIPv6(payload.value)) payload.issues.push({
					code: "invalid_format",
					format: "ipv6",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		function isValidCIDRv6(value) {
			const parts = value.split("/");
			if (parts.length !== 2) return false;
			const [address, prefix] = parts;
			if (!prefix) return false;
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) return false;
			if (prefixNum < 0 || prefixNum > 128) return false;
			return isValidIPv6(address);
		}
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (!isValidCIDRv6(payload.value)) payload.issues.push({
					code: "invalid_format",
					format: "cidrv6",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64Charset);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const base64urlCharset = /^[A-Za-z0-9_-]*$/;
		function isValidBase64URL(data) {
			if (!base64urlCharset.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64urlCharset);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			const memo = globalConfig.memoizer;
			memo?.attach(inst);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
				const proms = [];
				const abortEarly = ctx?.abortEarly;
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else {
						handleArrayResult(result, payload, i);
						if (abortEarly && result.issues.length !== 0 && aborted(result)) break;
					}
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, optin, optout) {
			const isPresent = key in input;
			const isOptionalOut = optout === "optional";
			if (!isPresent && isOptionalOut && optin === "optional") return;
			if (result.issues.length) {
				if (optin !== void 0 && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && optin === void 0) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent || optin === "defaulted" && !isOptionalOut) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		const NO_SYMBOL_KEYS = [];
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			const ownSymbols = Object.getOwnPropertySymbols(def.shape);
			const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
			const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
			for (const k of allKeys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				allKeys,
				symbolKeys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const optin = _catchall.optin;
			const optout = _catchall.optout;
			let seen = 0;
			for (const key in input) {
				if (abortEarly && payload.issues.length !== seen) {
					if (aborted(payload, seen)) break;
					seen = payload.issues.length;
				}
				if (keySet.has(key)) continue;
				if (key === "__proto__") {
					if (t === "never") unrecognized.push(key);
					continue;
				}
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
				else handlePropertyResult(r, payload, key, input, optin, optout);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst,
				continue: true
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			const desc = Object.getOwnPropertyDescriptor(def, "shape");
			const sh = desc?.get ? desc.get.raw : def.shape ?? {};
			if (sh) {
				const get = () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					get.raw = newSh;
					return newSh;
				};
				get.raw = sh;
				Object.defineProperty(def, "shape", { get });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazyInternal(inst, "propValues", (zod) => {
				const shape = zod.def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						if (!Object.prototype.hasOwnProperty.call(propValues, key)) assignProp(propValues, key, /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
						if (field.optin !== void 0) propValues[key].add(void 0);
					}
				}
				return propValues;
			});
			const isObject$2 = isObject;
			const catchall = def.catchall;
			let value;
			const memo = globalConfig.memoizer;
			memo?.attach(inst);
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
				const proms = [];
				const shape = value.shape;
				const abortEarly = ctx?.abortEarly;
				let seen = payload.issues.length;
				for (const key of value.allKeys) {
					if (abortEarly && payload.issues.length !== seen) {
						if (aborted(payload, seen)) break;
						seen = payload.issues.length;
					}
					if (key === "__proto__") continue;
					const el = shape[key];
					const optin = el._zod.optin;
					const optout = el._zod.optout;
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
					else handlePropertyResult(r, payload, key, input, optin, optout);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const memo = globalConfig.memoizer;
			const generateFastpass = (shape) => {
				const normalized = _normalized.value;
				const syms = normalized.symbolKeys;
				const doc = new Doc(["payload", "ctx"], {
					shape,
					inst,
					memo,
					syms
				});
				const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.allKeys) ids[key] = `key_${counter++}`;
				doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
				for (const key of normalized.allKeys) {
					if (key === "__proto__") continue;
					const id = ids[key];
					const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
					const isPresent = `${k} in input`;
					const schema = shape[key];
					const optin = schema?._zod?.optin;
					const isOptionalIn = optin !== void 0;
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(k)};`);
					if (isOptionalIn && isOptionalOut) {
						const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
						doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					} else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
					else {
						doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
						if (optin === "defaulted") doc.write(`newResult[${k}] = ${id}.value;`);
						else doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
					}
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				return doc.compile();
			};
			let fastpass;
			const isObject$1 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
			defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazyInternal(inst, "values", (zod) => {
				if (zod.def.options.every((o) => o._zod.values)) return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazyInternal(inst, "pattern", (zod) => {
				if (zod.def.options.every((o) => o._zod.pattern)) {
					const patterns = zod.def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		function discriminatorMap(def) {
			const map = /* @__PURE__ */ new Map();
			for (const option of def.options) {
				const values = option._zod.propValues?.[def.discriminator];
				if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
				for (const value of values) if (map.has(value)) {
					if (value !== void 0) throw new Error(`Duplicate discriminator value "${String(value)}"`);
					map.set(value, null);
				} else map.set(value, option);
			}
			return map;
		}
		const $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
			def.inclusive = false;
			$ZodUnion.init(inst, def);
			const _super = inst._zod.parse;
			defineLazyInternal(inst, "propValues", (zod) => {
				const propValues = {};
				let undefinedCount = 0;
				for (const option of zod.def.options) {
					const pv = option._zod.propValues;
					if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
					if (pv[zod.def.discriminator]?.has(void 0)) undefinedCount++;
					for (const [k, v] of Object.entries(pv)) {
						if (!Object.prototype.hasOwnProperty.call(propValues, k)) assignProp(propValues, k, /* @__PURE__ */ new Set());
						for (const val of v) propValues[k].add(val);
					}
				}
				if (!zod.def.unionFallback && undefinedCount > 1) propValues[zod.def.discriminator]?.delete(void 0);
				return propValues;
			});
			def.options.forEach((option, i) => {
				const propShape = rawShape(option._zod.def);
				if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) throw new Error(`Invalid discriminated union option at index "${i}"`);
			});
			const disc = cached(() => discriminatorMap(def));
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!isObject(input)) {
					payload.issues.push({
						code: "invalid_type",
						expected: "object",
						input,
						inst
					});
					return payload;
				}
				const value = input?.[def.discriminator];
				const opt = disc.value.get(value);
				if (opt && (value !== void 0 || ctx.direction !== "backward")) return opt._zod.run(payload, ctx);
				if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
				payload.issues.push({
					code: "invalid_union",
					errors: [],
					note: "No matching discriminator",
					discriminator: def.discriminator,
					options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
					input,
					path: [def.discriminator],
					inst
				});
				return payload;
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				if (Object.prototype.hasOwnProperty.call(newObj, "__proto__")) delete newObj.__proto__;
				for (const key of sharedKeys) {
					if (key === "__proto__") continue;
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			const keyIssues = /* @__PURE__ */ new Map();
			const collect = (iss, side) => {
				let keys;
				if (iss.code === "unrecognized_keys" && !iss.path?.length) {
					unrecIssue ?? (unrecIssue = iss);
					keys = iss.keys;
				} else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
					const k = String(iss.path[0]);
					if (!keyIssues.has(k)) keyIssues.set(k, iss);
					keys = [k];
				} else return false;
				for (const k of keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k)[side] = true;
				}
				return true;
			};
			for (const iss of left.issues) if (!collect(iss, "l")) result.issues.push(iss);
			for (const iss of right.issues) if (!collect(iss, "r")) result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length) {
				const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
				if (aggregated.length) result.issues.push({
					...unrecIssue,
					keys: aggregated
				});
				for (const k of bothKeys) if (!aggregated.includes(k) && keyIssues.has(k)) result.issues.push(keyIssues.get(k));
			}
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) {
				if (aborted(result)) return result;
				throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			}
			result.value = merged.data;
			return result;
		}
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			defineLazyInternal(inst, "pattern", (zod) => {
				const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
				return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
			});
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
			$ZodType.init(inst, def);
			const values = new Set(def.values);
			inst._zod.values = values;
			defineLazyInternal(inst, "pattern", (zod) => {
				const vals = zod.def.values;
				return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
			});
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (values.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values: def.values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			globalConfig.memoizer?.guard(inst);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				return payload;
			};
		});
		function handleOptionalResult(payload, result) {
			payload.value = result.issues.length ? void 0 : result.value;
			return payload;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
			inst._zod.optout = "optional";
			defineLazyInternal(inst, "values", (zod) => {
				const values = zod.def.innerType._zod.values;
				return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
			});
			defineLazyInternal(inst, "pattern", (zod) => {
				const pattern = zod.def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === void 0) {
					if (def.innerType._zod.optin !== "defaulted") return payload;
					const result = def.innerType._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) return result.then((result) => handleOptionalResult(payload, result));
					return handleOptionalResult(payload, result);
				}
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
			defineLazyInternal(inst, "pattern", (zod) => {
				const pattern = zod.def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazyInternal(inst, "values", (zod) => {
				return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "defaulted";
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "defaulted";
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => {
				const v = zod.def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		function handleCatchResult(payload, result, def, ctx) {
			if (!result.issues.length) {
				payload.value = result.value;
				if (result.memo) payload.memo = true;
				return payload;
			}
			payload.value = def.catchValue({
				...result,
				value: payload.value,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run({
					value: payload.value,
					issues: []
				}, ctx);
				if (result instanceof Promise) return result.then((result) => handleCatchResult(payload, result, def, ctx));
				return handleCatchResult(payload, result, def, ctx);
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
			defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
			defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			if (!payload.memo) payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region node_modules/zod/v4/core/memoizer.js
		var $ZodCyclicError = class extends Error {
			constructor() {
				super(`Cannot parse a reference cycle that closes through a transform`);
				this.name = "ZodCyclicError";
			}
		};
		/** Keyed off the context object every schema in one parse call already shares. */
		const STATE = "~memo";
		const NO_ISSUES = [];
		function isRef(value) {
			return value !== null && (typeof value === "object" || typeof value === "function");
		}
		function cloneIssues(issues) {
			return issues.map((iss) => iss.path ? {
				...iss,
				path: iss.path.slice()
			} : { ...iss });
		}
		const recursive = /*@__PURE__*/ new WeakMap();
		/** What the walk established, in order of certainty: ordered so the strongest answer among children wins. */
		const NONE = 0;
		const ASSUMED = 1;
		const PROVEN = 2;
		/** Whether this schema's subtree contains a cycle, so one parse can re-enter it. */
		function isRecursive(inst, stack, resolve) {
			const cached = recursive.get(inst);
			if (cached !== void 0) return cached ? PROVEN : NONE;
			if (stack.has(inst)) return PROVEN;
			stack.add(inst);
			let result = NONE;
			const check = (child) => {
				if (result !== PROVEN && child?._zod) {
					const answer = isRecursive(child, stack, resolve);
					if (answer > result) result = answer;
				}
			};
			const shape = (sh, spread) => {
				let answer = NONE;
				for (const key of Reflect.ownKeys(sh)) {
					const desc = Object.getOwnPropertyDescriptor(sh, key);
					if (spread && !desc.enumerable) continue;
					const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
					if (child > answer) answer = child;
				}
				return answer;
			};
			const merge = (answer) => {
				if (answer > result) result = answer;
			};
			const def = inst._zod.def;
			switch (def.type) {
				case "object": {
					const raw = rawShape(def);
					merge(raw ? shape(raw, true) : ASSUMED);
					check(def.catchall);
					break;
				}
				case "properties":
					merge(shape(def.shape, false));
					break;
				case "array":
					check(def.element);
					break;
				case "tuple":
					for (const el of def.items) check(el);
					check(def.rest);
					break;
				case "record":
				case "map":
					check(def.keyType);
					check(def.valueType);
					break;
				case "set":
					check(def.valueType);
					break;
				case "union":
					for (const el of def.options) check(el);
					break;
				case "intersection":
					check(def.left);
					check(def.right);
					break;
				case "optional":
				case "nullable":
				case "default":
				case "prefault":
				case "catch":
				case "readonly":
				case "nonoptional":
				case "promise":
				case "success":
					check(def.innerType);
					break;
				case "pipe":
					check(def.in);
					check(def.out);
					break;
				case "function":
					check(def.input);
					check(def.output);
					break;
				case "lazy": {
					const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
					merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
					break;
				}
				case "template_literal":
				case "string":
				case "number":
				case "int":
				case "boolean":
				case "bigint":
				case "symbol":
				case "undefined":
				case "null":
				case "void":
				case "never":
				case "any":
				case "unknown":
				case "date":
				case "nan":
				case "enum":
				case "literal":
				case "file":
				case "transform":
				case "custom": break;
				default: for (const key in def) {
					const desc = Object.getOwnPropertyDescriptor(def, key);
					if (!desc || desc.get) continue;
					const value = desc.value;
					if (!value || typeof value !== "object") continue;
					if (value._zod) check(value);
					else if (Array.isArray(value)) for (const el of value) check(el);
				}
			}
			stack.delete(inst);
			return settle(inst, result);
		}
		/** An assumed answer must not outlive the resolution that settles it, so only a certain one is cached. */
		function settle(inst, answer) {
			if (answer !== ASSUMED) recursive.set(inst, answer === PROVEN);
			return answer;
		}
		function bucketFor(state, inst) {
			let bucket = state.buckets.get(inst);
			if (!bucket) {
				bucket = /* @__PURE__ */ new WeakMap();
				state.buckets.set(inst, bucket);
			}
			return bucket;
		}
		let handoff;
		const open = [];
		const memo = {
			alloc(_inst, payload, empty) {
				const bucket = handoff;
				if (!bucket) return empty;
				handoff = void 0;
				const entry = {
					value: empty,
					issues: null
				};
				bucket.set(payload.value, entry);
				open.push(entry);
				return empty;
			},
			guard(inst) {
				var _a;
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred.push(() => {
					const base = inst._zod.parse;
					const wrapped = (payload, ctx) => {
						if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value)) throw new $ZodCyclicError();
						return base(payload, ctx);
					};
					inst._zod.parse = wrapped;
					if (inst._zod.run === base) inst._zod.run = wrapped;
				});
			},
			attach(inst) {
				var _a;
				let isRecursiveInst;
				let rechecked = false;
				let lastCtx;
				let lastBucket;
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred.push(() => {
					const base = inst._zod.parse;
					const wrapped = (payload, ctx) => {
						if (isRecursiveInst === void 0) {
							const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
							if (walked === NONE) {
								inst._zod.parse = base;
								if (inst._zod.run === wrapped) inst._zod.run = base;
								return base(payload, ctx);
							}
							if (walked === PROVEN || rechecked) isRecursiveInst = true;
							else rechecked = true;
						}
						const input = payload.value;
						if (!isRef(input)) return base(payload, ctx);
						let state = ctx[STATE];
						if (!state) {
							state = {
								buckets: /* @__PURE__ */ new WeakMap(),
								backEdges: void 0
							};
							ctx[STATE] = state;
						}
						let bucket;
						if (lastCtx === ctx) bucket = lastBucket;
						else {
							bucket = bucketFor(state, inst);
							lastCtx = ctx;
							lastBucket = bucket;
						}
						const hit = bucket.get(input);
						if (hit) {
							payload.value = hit.value;
							if (hit.issues) {
								if (hit.issues.length) payload.issues.push(...cloneIssues(hit.issues));
							} else {
								payload.memo = true;
								state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
								state.backEdges.add(hit.value);
							}
							return payload;
						}
						handoff = bucket;
						const depth = open.length;
						const result = base(payload, ctx);
						handoff = void 0;
						const entry = open.length > depth ? open.pop() : void 0;
						if (result instanceof Promise) return result.then((r) => {
							if (entry) entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
							return r;
						});
						if (entry) entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
						return result;
					};
					inst._zod.parse = wrapped;
					if (inst._zod.run === base) inst._zod.run = wrapped;
				});
			}
		};
		/** The memoizer that gives containers cycle support. `zod` installs it by default; `zod/mini` opts in with `config({ memoizer: memoizer() })`. */
		function memoizer() {
			return memo;
		}
		/** Whether this value is a node a back-edge resolved to before it finished. */
		function isBackEdge(ctx, value) {
			const backEdges = ctx[STATE]?.backEdges;
			return backEdges !== void 0 && isRef(value) && backEdges.has(value);
		}
		//#endregion
		//#region node_modules/zod/v4/locales/en.js
		const error = () => {
			const Sizable = {
				string: {
					unit: "characters",
					verb: "to have"
				},
				file: {
					unit: "bytes",
					verb: "to have"
				},
				array: {
					unit: "items",
					verb: "to have"
				},
				set: {
					unit: "items",
					verb: "to have"
				},
				map: {
					unit: "entries",
					verb: "to have"
				}
			};
			function getSizing(origin) {
				return Sizable[origin] ?? null;
			}
			const FormatDictionary = {
				regex: "input",
				email: "email address",
				url: "URL",
				emoji: "emoji",
				uuid: "UUID",
				uuidv4: "UUIDv4",
				uuidv6: "UUIDv6",
				nanoid: "nanoid",
				guid: "GUID",
				cuid: "cuid",
				cuid2: "cuid2",
				ulid: "ULID",
				xid: "XID",
				ksuid: "KSUID",
				datetime: "ISO datetime",
				date: "ISO date",
				time: "ISO time",
				duration: "ISO duration",
				ipv4: "IPv4 address",
				ipv6: "IPv6 address",
				mac: "MAC address",
				cidrv4: "IPv4 range",
				cidrv6: "IPv6 range",
				base64: "base64-encoded string",
				base64url: "base64url-encoded string",
				json_string: "JSON string",
				e164: "E.164 number",
				credit_card: "credit card number",
				iban: "IBAN",
				jwt: "JWT",
				template_literal: "input"
			};
			const TypeDictionary = { nan: "NaN" };
			function getTypeName(type, input) {
				if (type === "number" && typeof input === "number" && !Number.isFinite(input)) return String(input);
				return TypeDictionary[type] ?? type;
			}
			return (issue) => {
				switch (issue.code) {
					case "invalid_type": return `Invalid input: expected ${getTypeName(issue.expected)}, received ${getTypeName(parsedType(issue.input), issue.input)}`;
					case "invalid_value":
						if (issue.values.length === 1) return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
						return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
					case "too_big": {
						const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
						const sizing = getSizing(issue.origin);
						if (sizing) return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
						return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
					}
					case "too_small": {
						const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
						const sizing = getSizing(issue.origin);
						if (sizing) return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
						return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
					}
					case "invalid_format": {
						const _issue = issue;
						if (_issue.format === "starts_with") return `Invalid string: must start with "${_issue.prefix}"`;
						if (_issue.format === "ends_with") return `Invalid string: must end with "${_issue.suffix}"`;
						if (_issue.format === "includes") return `Invalid string: must include "${_issue.includes}"`;
						if (_issue.format === "regex") return `Invalid string: must match pattern ${_issue.pattern}`;
						return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
					}
					case "not_multiple_of": return `Invalid number: must be a multiple of ${issue.divisor}`;
					case "unrecognized_keys": return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
					case "invalid_key": return `Invalid key in ${issue.origin}`;
					case "invalid_union":
						if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) return `Invalid discriminator value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}`;
						if (issue.inclusive === false) return "Invalid input: more than one option matched";
						return "Invalid input";
					case "invalid_element": return `Invalid value in ${issue.origin}`;
					default: return `Invalid input`;
				}
			};
		};
		function en_default() {
			return { localeError: error() };
		}
		//#endregion
		//#region node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class({
				type: "string",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class({
				type: "number",
				checks: [],
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						if (!("input" in _issue)) _issue.input = payload.value;
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region node_modules/zod/v4/core/to-json-schema.js
		function assignProps(target, ...sources) {
			for (const source of sources) for (const key of Reflect.ownKeys(source)) if (Object.prototype.propertyIsEnumerable.call(source, key)) assignProp(target, key, source[key]);
			return target;
		}
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				sharedDefsExtractedFor: void 0,
				sharedEmitDoneFor: void 0,
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				intersections: [],
				deferred: [],
				external: params?.external ?? void 0
			};
		}
		/**
		* Applies the `unrepresentable` setting at a site that has no JSON Schema equivalent. Throws
		* `message` unless the setting (or the handler's return value) says otherwise. Returns `true` if a
		* custom JSON Schema was written into `json`, in which case the caller must not write its own.
		*/
		function handleUnrepresentable(schema, ctx, json, params, message) {
			const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({
				zodSchema: schema,
				path: params.path,
				message
			}) : ctx.unrepresentable;
			if (result === "any") return false;
			if (result === void 0 || result === "throw") throw new Error(message);
			Object.assign(json, result);
			return true;
		}
		function processSchema(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			ctx.sharedDefsExtractedFor = void 0;
			ctx.sharedEmitDoneFor = void 0;
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					processSchema(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) assignProps(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function encodeJSONPointerSegment(segment) {
			return segment.replace(/~/g, "~0").replace(/\//g, "~1");
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external) return;
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}`
					};
				}
				const uriPrefix = `#`;
				const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
				if (entry[1] === root && !entry[1].schema.id) return { ref: uriPrefix };
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + encodeJSONPointerSegment(defId)
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") extractToDef(entry);
				}
			}
			if (ctx.external) ctx.sharedDefsExtractedFor = ctx.external;
		}
		/** Rewrites `anyOf: [{type: "a"}, {type: "b"}]` to `type: ["a", "b"]`, which every JSON Schema draft treats as equivalent and most consumers render far better for the nullable case. Only branches that are a bare type assertion qualify — anything carrying a constraint, `$ref`, `const` or metadata is left alone. Runs after `flattenRef`, so a branch an override decorated or `$defs` extraction turned into a `$ref` is no longer bare and correctly stays in `anyOf`. `oneOf` is excluded: `integer` and `number` overlap, so "exactly one" and "at least one" are not the same there. OpenAPI 3.0 is excluded: its `type` must be a single string. */
		function compactTypeUnion(schema) {
			const options = schema.anyOf;
			if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0) return;
			const types = [];
			for (const option of options) {
				if (!option || typeof option !== "object") return;
				compactTypeUnion(option);
				const keys = Object.keys(option);
				if (keys.length !== 1 || keys[0] !== "type") return;
				const type = option.type;
				for (const member of Array.isArray(type) ? type : [type]) {
					if (typeof member !== "string") return;
					if (!types.includes(member)) types.push(member);
				}
			}
			delete schema.anyOf;
			schema.type = types.length === 1 ? types[0] : types;
		}
		/** Keywords `foldIntersection` knows how to combine. Anything else — `$ref`, `patternProperties`,
		* an annotation like `description` — makes a member unfoldable, so a constraint this does not
		* understand leaves the `allOf` alone instead of being silently dropped or misattributed. */
		const FOLDABLE_KEYS = /* @__PURE__ */ new Set([
			"type",
			"properties",
			"required",
			"additionalProperties"
		]);
		const UNION_KEYS = ["oneOf", "anyOf"];
		/** A member's constraint on a key it does not declare itself. A `catchall` states one; `false`, an absent `additionalProperties`, and the empty schema a loose object emits state nothing. */
		function undeclaredConstraint(member) {
			const extra = member.additionalProperties;
			if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null) return null;
			return Object.keys(extra).length ? extra : null;
		}
		/** Combines object members into the single object they describe together, or returns `null` if any of them carries a keyword outside {@link FOLDABLE_KEYS}. */
		function foldObjects(members) {
			const objects = [];
			for (const member of members) {
				if (typeof member !== "object" || member.type !== "object") return null;
				for (const key in member) if (!FOLDABLE_KEYS.has(key)) return null;
				objects.push(member);
			}
			const properties = {};
			const required = /* @__PURE__ */ new Set();
			for (const object of objects) {
				for (const key in object.properties) {
					if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
					const parts = [];
					for (const other of objects) {
						const part = other.properties?.[key] ?? undeclaredConstraint(other);
						if (part === null || part === void 0) continue;
						if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part))) parts.push(part);
					}
					assignProp(properties, key, parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts });
				}
				for (const key of object.required ?? []) required.add(key);
			}
			const folded = {
				type: "object",
				properties
			};
			if (required.size) folded.required = [...required];
			if (objects.every((object) => object.additionalProperties === false)) folded.additionalProperties = false;
			else {
				const constraints = [];
				for (const object of objects) {
					const constraint = undeclaredConstraint(object);
					if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint))) constraints.push(constraint);
				}
				if (constraints.length === 1) folded.additionalProperties = constraints[0];
				else if (constraints.length > 1) folded.additionalProperties = { allOf: constraints };
			}
			return folded;
		}
		/** `additionalProperties` in an `allOf` member sees only that member's own `properties`, so two
		* closed object members reject each other's keys and the schema validates nothing. Zod's parser
		* pools the key sets instead — `handleIntersectionResults` reports a key as unrecognized only when
		* *every* side rejects it — so the emitted schema has to pool them too, and folding the members
		* into one object is the encoding that says so on every target.
		*
		* This runs from `finalize`, after `extractDefs`, which is what keeps it clear of the `$ref`
		* machinery: a member extracted into `$defs` is already a `$ref` by now and declines to fold, so it
		* keeps its reference and its own closedness rather than being inlined as a stale copy. */
		function foldIntersection(json) {
			const allOf = json.allOf;
			if (!Array.isArray(allOf) || allOf.length < 2) return;
			for (const key of FOLDABLE_KEYS) if (key in json) return;
			const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
			let folded = null;
			if (!unions.length) folded = foldObjects(allOf);
			else {
				const union = unions[0];
				const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
				if (Object.keys(union).length !== 1) return;
				const rest = allOf.filter((m) => m !== union);
				const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
				if (branches.some((b) => !b)) return;
				folded = { [keyword]: branches };
			}
			if (!folded) return;
			delete json.allOf;
			assignProps(json, folded);
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else assignProps(schema, refSchema);
					assignProps(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
				for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
				if (ctx.target !== "openapi-3.0") for (const entry of ctx.seen.entries()) compactTypeUnion(entry[1].def ?? entry[1].schema);
				for (const rewrite of ctx.deferred) rewrite();
				if (ctx.intersections.length) {
					const carriers = /* @__PURE__ */ new Map();
					for (const seen of ctx.seen.values()) for (const json of [seen.schema, seen.def]) {
						const allOf = json?.allOf;
						if (!Array.isArray(allOf)) continue;
						const existing = carriers.get(allOf);
						if (existing) existing.push(json);
						else carriers.set(allOf, [json]);
					}
					for (const allOf of ctx.intersections) for (const json of carriers.get(allOf) ?? []) foldIntersection(json);
				}
			}
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					assignProp(defs, seen.defId, seen.def);
				}
			}
			if (ctx.external) ctx.sharedEmitDoneFor = ctx.external;
			if (ctx.external) {} else if (Object.keys(defs).length > 0) {
				if (ctx.target === "draft-2020-12") result.$defs = defs;
				else result.definitions = defs;
			}
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			processSchema(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			processSchema(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region node_modules/zod/v4/core/json-schema-processors.js
		const narrowMin = (agg, key, value) => {
			if (agg[key] === void 0 || value > agg[key]) agg[key] = value;
		};
		const narrowMax = (agg, key, value) => {
			if (agg[key] === void 0 || value < agg[key]) agg[key] = value;
		};
		const narrowBoth = (agg, value) => {
			narrowMin(agg, "minimum", value);
			narrowMax(agg, "maximum", value);
		};
		const addDivisor = (agg, value) => {
			agg.multipleOf ?? (agg.multipleOf = []);
			if (!agg.multipleOf.includes(value)) agg.multipleOf.push(value);
		};
		const addPattern = (agg, pattern) => {
			agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
			agg.patterns.add(pattern);
		};
		const intersectMime = (agg, mime) => {
			agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
		};
		const setFormat = (agg, format) => {
			agg.format = format;
			if (format.includes("int")) agg.isInt = true;
		};
		const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
		const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
		const formatContributor = (ranges) => (agg, def) => {
			setFormat(agg, def.format);
			const [minimum, maximum] = ranges[def.format];
			narrowMin(agg, "minimum", minimum);
			narrowMax(agg, "maximum", maximum);
		};
		const contributors = {
			greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
			less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
			multiple_of: (agg, def) => addDivisor(agg, def.value),
			number_format: formatContributor(NUMBER_FORMAT_RANGES),
			bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
			min_length: minContributor,
			max_length: maxContributor,
			length_equals: (agg, def) => narrowBoth(agg, def.length),
			min_size: minContributor,
			max_size: maxContributor,
			size_equals: (agg, def) => narrowBoth(agg, def.size),
			string_format: (agg, def) => {
				setFormat(agg, def.format);
				if (def.pattern) addPattern(agg, def.pattern);
				if (def.format === "base64" || def.format === "base64url") agg.contentEncoding = def.format;
				if (def.local || def.precision === -1) agg.laxFormat = true;
			},
			mime_type: (agg, def) => intersectMime(agg, def.mime)
		};
		function aggregateChecks(schema) {
			const agg = {};
			const def = schema._zod.def;
			const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
			for (const ch of list) contributors[ch._zod.def.check]?.(agg, ch._zod.def);
			const bag = schema._zod.bag;
			if (bag.minimum !== void 0) narrowMin(agg, "minimum", bag.minimum);
			if (bag.exclusiveMinimum !== void 0) narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
			if (bag.maximum !== void 0) narrowMax(agg, "maximum", bag.maximum);
			if (bag.exclusiveMaximum !== void 0) narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
			if (bag.multipleOf !== void 0) addDivisor(agg, bag.multipleOf);
			if (bag.format !== void 0) {
				agg.format ?? (agg.format = bag.format);
				if (bag.format.includes("int")) agg.isInt = true;
			}
			if (bag.mime) intersectMime(agg, bag.mime);
			for (const pattern of bag.patterns ?? []) addPattern(agg, pattern);
			return agg;
		}
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const exactPatterns = /* @__PURE__ */ new Map([[base64Charset, base64], [base64urlCharset, base64url]]);
		const exactPattern = (p) => exactPatterns.get(p) ?? p;
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time" || laxFormat) delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const patternList = [...patterns].map(exactPattern);
				if (patternList.length === 1) json.pattern = patternList[0].source;
				else if (patternList.length > 1) json.allOf = [...patternList.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
			json.type = isInt ? "integer" : "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) {
				if (legacy) {
					json.minimum = exclusiveMinimum;
					json.exclusiveMinimum = true;
				} else json.exclusiveMinimum = exclusiveMinimum;
			} else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) {
				if (legacy) {
					json.maximum = exclusiveMaximum;
					json.exclusiveMaximum = true;
				} else json.exclusiveMaximum = exclusiveMaximum;
			} else if (typeof maximum === "number") json.maximum = maximum;
			if (multipleOf) {
				const divisors = /* @__PURE__ */ new Set();
				for (const divisor of multipleOf) if (Number.isFinite(divisor) && divisor !== 0) divisors.add(Math.abs(divisor));
				else handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
				const [first, ...rest] = divisors;
				if (first !== void 0) json.multipleOf = first;
				if (rest.length) json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
			}
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.length === 0) {
				json.not = {};
				return;
			}
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const literalProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			if (def.values.length === 0) {
				json.not = {};
				return;
			}
			const vals = [];
			for (const val of def.values) if (val === void 0) {
				if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema")) return;
			} else if (typeof val === "bigint") {
				if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema")) return;
				vals.push(Number(val));
			} else vals.push(val);
			if (vals.length === 0) {} else if (vals.length === 1) {
				const val = vals[0];
				json.type = val === null ? "null" : typeof val;
				if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
				else json.const = val;
			} else {
				if (vals.every((v) => typeof v === "number")) json.type = "number";
				if (vals.every((v) => typeof v === "string")) json.type = "string";
				if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
				if (vals.every((v) => v === null)) json.type = "null";
				json.enum = vals;
			}
		};
		const customProcessor = (schema, ctx, json, params) => {
			handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (schema, ctx, json, params) => {
			handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = aggregateChecks(schema);
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = processSchema(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		function inputOptin(schema) {
			const def = schema._zod.def;
			if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) return inputOptin(def.out);
			if (def.type === "catch") return inputOptin(def.innerType);
			return schema._zod.optin;
		}
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const shape = def.shape;
			if (Object.getOwnPropertySymbols(shape).length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) return;
			json.type = "object";
			json.properties = {};
			for (const key in shape) assignProp(json.properties, key, processSchema(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			}));
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const field = def.shape[key];
				if (ctx.io === "input") return inputOptin(field) === void 0;
				else return field._zod.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = processSchema(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => processSchema(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = processSchema(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = processSchema(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			const allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
			json.allOf = allOf;
			ctx.intersections.push(allOf);
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		/** Round-trips a default value through JSON so the emitted schema is guaranteed to be valid JSON.
		* A BigInt has no reliable encoding, so it goes through `unrepresentable` like any other
		* unrepresentable value. Returns a sentinel when the caller must not write a default of its own. */
		const UNREPRESENTABLE_DEFAULT = Symbol();
		function serializeDefaultValue(value, schema, ctx, json, params) {
			let unrepresentable = false;
			const serialized = JSON.stringify(value, (_, val) => {
				if (typeof val !== "bigint") return val;
				unrepresentable = true;
				return null;
			});
			if (!unrepresentable) return JSON.parse(serialized);
			handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
			return UNREPRESENTABLE_DEFAULT;
		}
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
			if (value !== UNREPRESENTABLE_DEFAULT) json.default = value;
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io !== "input") return;
			const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
			if (value !== UNREPRESENTABLE_DEFAULT) json._prefault = value;
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
				return;
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			processSchema(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		//#endregion
		//#region node_modules/zod/v4/classic/errors.js
		const _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
		function _lazyMethod(proto, key, make) {
			Object.defineProperty(proto, key, {
				configurable: true,
				enumerable: false,
				get() {
					const value = make(this);
					Object.defineProperty(this, key, {
						value,
						configurable: true,
						writable: true
					});
					return value;
				},
				set(value) {
					Object.defineProperty(this, key, {
						value,
						configurable: true,
						writable: true
					});
				}
			});
		}
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			const proto = Object.getPrototypeOf(inst);
			if (_installedErrorProtos.has(proto)) return;
			_installedErrorProtos.add(proto);
			_lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
			_lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
			_lazyMethod(proto, "addIssue", (self) => (issue) => {
				self.issues.push(issue);
				self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
			});
			_lazyMethod(proto, "addIssues", (self) => (issues) => {
				self.issues.push(...issues);
				self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
			});
			Object.defineProperty(proto, "isEmpty", {
				configurable: true,
				enumerable: false,
				get() {
					return this.issues.length === 0;
				}
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, void 0, { Parent: Error });
		//#endregion
		//#region node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region node_modules/zod/v4/classic/schemas.js
		function _ensureDefaultLocale() {
			if (!globalConfig.localeError) config(en_default());
		}
		function _ensureDefaultMemoizer() {
			if (!globalConfig.memoizer) config({ memoizer: memoizer() });
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			_ensureDefaultLocale();
			$ZodType.init(inst, def);
			inst.def = def;
			inst.type = def.type;
			return inst;
		}, {
			check(...chks) {
				const def = this.def;
				return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
					check: ch,
					def: { check: "custom" },
					onattach: []
				} } : ch)] }), { parent: true });
			},
			with(...chks) {
				return this.check(...chks);
			},
			clone(def, params) {
				return clone(this, def, params);
			},
			brand() {
				return this;
			},
			register(reg, meta) {
				reg.add(this, meta);
				return this;
			},
			refine(check, params) {
				return this.check(refine(check, params));
			},
			superRefine(refinement, params) {
				return this.check(superRefine(refinement, params));
			},
			overwrite(fn) {
				return this.check(/* @__PURE__ */ _overwrite(fn));
			},
			optional() {
				return optional(this);
			},
			exactOptional() {
				return exactOptional(this);
			},
			nullable() {
				return nullable(this);
			},
			nullish() {
				return optional(nullable(this));
			},
			nonoptional(params) {
				return nonoptional(this, params);
			},
			array() {
				return array(this);
			},
			or(arg) {
				return union([this, arg]);
			},
			and(arg) {
				return intersection(this, arg);
			},
			transform(tx) {
				return pipe(this, transform(tx));
			},
			default(d) {
				return _default(this, d);
			},
			prefault(d) {
				return prefault(this, d);
			},
			catch(params) {
				return _catch(this, params);
			},
			pipe(target) {
				return pipe(this, target);
			},
			readonly() {
				return readonly(this);
			},
			describe(description) {
				const cl = this.clone();
				globalRegistry.add(cl, { description });
				return cl;
			},
			meta(...args) {
				if (args.length === 0) return globalRegistry.get(this);
				const cl = this.clone();
				globalRegistry.add(cl, args[0]);
				return cl;
			},
			isOptional() {
				return this.safeParse(void 0).success;
			},
			isNullable() {
				return this.safeParse(null).success;
			},
			apply(fn, ...args) {
				return args.length === 0 ? fn(this) : fn(this, ...args);
			},
			get "~standard"() {
				return hide(this, "~standard", {
					...standardProps(this),
					jsonSchema: {
						input: createStandardJSONSchemaMethod(this, "input"),
						output: createStandardJSONSchemaMethod(this, "output")
					}
				});
			},
			set "~standard"(value) {
				own(this, "~standard", value);
			},
			parse: function _parse(data, params) {
				return parse(this, data, params, { callee: _parse });
			},
			parseAsync: async function _parseAsync(data, params) {
				return await parseAsync(this, data, params, { callee: _parseAsync });
			},
			safeParse(data, params) {
				return safeParse(this, data, params);
			},
			async safeParseAsync(data, params) {
				return safeParseAsync(this, data, params);
			},
			get spa() {
				return this?.safeParseAsync;
			},
			set spa(value) {
				own(this, "spa", value);
			},
			validate(data, params) {
				return validate(this, data, params);
			},
			validateAsync(data, params) {
				return validateAsync$1(this, data, params);
			},
			encode: function _encode(data, params) {
				return encode(this, data, params, { callee: _encode });
			},
			decode: function _decode(data, params) {
				return decode(this, data, params, { callee: _decode });
			},
			encodeAsync: async function _encodeAsync(data, params) {
				return await encodeAsync(this, data, params, { callee: _encodeAsync });
			},
			decodeAsync: async function _decodeAsync(data, params) {
				return await decodeAsync(this, data, params, { callee: _decodeAsync });
			},
			safeEncode(data, params) {
				return safeEncode(this, data, params);
			},
			safeDecode(data, params) {
				return safeDecode(this, data, params);
			},
			async safeEncodeAsync(data, params) {
				return safeEncodeAsync(this, data, params);
			},
			async safeDecodeAsync(data, params) {
				return safeDecodeAsync(this, data, params);
			},
			toJSONSchema(params) {
				return createToJSONSchemaMethod(this, {})(params);
			},
			get description() {
				return globalRegistry.get(this)?.description;
			},
			get _def() {
				return this._zod.def;
			}
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
		}, /*@__PURE__*/ derived({
			format: (inst) => aggregateChecks(inst).format ?? null,
			minLength: (inst) => aggregateChecks(inst).minimum ?? null,
			maxLength: (inst) => aggregateChecks(inst).maximum ?? null
		}, {
			regex(...args) {
				return this.check(/* @__PURE__ */ _regex(...args));
			},
			includes(...args) {
				return this.check(/* @__PURE__ */ _includes(...args));
			},
			startsWith(...args) {
				return this.check(/* @__PURE__ */ _startsWith(...args));
			},
			endsWith(...args) {
				return this.check(/* @__PURE__ */ _endsWith(...args));
			},
			min(...args) {
				return this.check(/* @__PURE__ */ _minLength(...args));
			},
			max(...args) {
				return this.check(/* @__PURE__ */ _maxLength(...args));
			},
			length(...args) {
				return this.check(/* @__PURE__ */ _length(...args));
			},
			nonempty(...args) {
				return this.check(/* @__PURE__ */ _minLength(1, ...args));
			},
			lowercase(params) {
				return this.check(/* @__PURE__ */ _lowercase(params));
			},
			uppercase(params) {
				return this.check(/* @__PURE__ */ _uppercase(params));
			},
			trim() {
				return this.check(/* @__PURE__ */ _trim());
			},
			normalize(...args) {
				return this.check(/* @__PURE__ */ _normalize(...args));
			},
			toLowerCase() {
				return this.check(/* @__PURE__ */ _toLowerCase());
			},
			toUpperCase() {
				return this.check(/* @__PURE__ */ _toUpperCase());
			},
			slugify() {
				return this.check(/* @__PURE__ */ _slugify());
			}
		}));
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
		}, {
			email(params) {
				return this.check(/* @__PURE__ */ _email(ZodEmail, params));
			},
			url(params) {
				return this.check(/* @__PURE__ */ _url(ZodURL, params));
			},
			jwt(params) {
				return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			},
			emoji(params) {
				return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			},
			guid(params) {
				return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
			},
			uuid(params) {
				return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			},
			uuidv4(params) {
				return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			},
			uuidv6(params) {
				return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			},
			uuidv7(params) {
				return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			},
			nanoid(params) {
				return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			},
			cuid(params) {
				return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			},
			cuid2(params) {
				return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			},
			ulid(params) {
				return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
			},
			base64(params) {
				return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
			},
			base64url(params) {
				return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			},
			xid(params) {
				return this.check(/* @__PURE__ */ _xid(ZodXID, params));
			},
			ksuid(params) {
				return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			},
			ipv4(params) {
				return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			},
			ipv6(params) {
				return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			},
			cidrv4(params) {
				return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			},
			cidrv6(params) {
				return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			},
			e164(params) {
				return this.check(/* @__PURE__ */ _e164(ZodE164, params));
			},
			datetime(params) {
				return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
			},
			date(params) {
				return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
			},
			time(params) {
				return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
			},
			duration(params) {
				return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
			}
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			inst.isFinite = true;
		}, /*@__PURE__*/ derived({
			minValue: (inst) => {
				const { minimum, exclusiveMinimum } = aggregateChecks(inst);
				return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
			},
			maxValue: (inst) => {
				const { maximum, exclusiveMaximum } = aggregateChecks(inst);
				return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
			},
			isInt: (inst) => {
				const { isInt, multipleOf } = aggregateChecks(inst);
				return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
			},
			format: (inst) => aggregateChecks(inst).format ?? null
		}, {
			gt(value, params) {
				return this.check(/* @__PURE__ */ _gt(value, params));
			},
			gte(value, params) {
				return this.check(/* @__PURE__ */ _gte(value, params));
			},
			min(value, params) {
				return this.check(/* @__PURE__ */ _gte(value, params));
			},
			lt(value, params) {
				return this.check(/* @__PURE__ */ _lt(value, params));
			},
			lte(value, params) {
				return this.check(/* @__PURE__ */ _lte(value, params));
			},
			max(value, params) {
				return this.check(/* @__PURE__ */ _lte(value, params));
			},
			int(params) {
				return this.check(int(params));
			},
			safe(params) {
				return this.check(int(params));
			},
			positive(params) {
				return this.check(/* @__PURE__ */ _gt(0, params));
			},
			nonnegative(params) {
				return this.check(/* @__PURE__ */ _gte(0, params));
			},
			negative(params) {
				return this.check(/* @__PURE__ */ _lt(0, params));
			},
			nonpositive(params) {
				return this.check(/* @__PURE__ */ _lte(0, params));
			},
			multipleOf(value, params) {
				return this.check(/* @__PURE__ */ _multipleOf(value, params));
			},
			step(value, params) {
				return this.check(/* @__PURE__ */ _multipleOf(value, params));
			},
			finite() {
				return this;
			}
		}));
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
		}, {
			min(n, params) {
				return this.check(/* @__PURE__ */ _minLength(n, params));
			},
			nonempty(params) {
				return this.check(/* @__PURE__ */ _minLength(1, params));
			},
			max(n, params) {
				return this.check(/* @__PURE__ */ _maxLength(n, params));
			},
			length(n, params) {
				return this.check(/* @__PURE__ */ _length(n, params));
			},
			unwrap() {
				return this.element;
			}
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
		}, {
			keyof() {
				return _enum(Object.keys(this._zod.def.shape));
			},
			catchall(catchall) {
				return this.clone(mergeDefs(this._zod.def, { catchall }));
			},
			passthrough() {
				return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
			},
			loose() {
				return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
			},
			strict() {
				return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
			},
			strip() {
				return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
			},
			extend(incoming) {
				return extend(this, incoming);
			},
			safeExtend(incoming) {
				return safeExtend(this, incoming);
			},
			merge(other) {
				return merge(this, other);
			},
			pick(mask) {
				return pick(this, mask);
			},
			omit(mask) {
				return omit(this, mask);
			},
			partial(...args) {
				return partial(ZodOptional, this, args[0]);
			},
			exactPartial(...args) {
				return partial(ZodExactOptional, this, args[0], "exactPartial");
			},
			required(...args) {
				return required(ZodNonOptional, this, args[0]);
			}
		});
		function object(shape, params) {
			const def = {
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			};
			return new ZodObject(def);
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
			ZodUnion.init(inst, def);
			$ZodDiscriminatedUnion.init(inst, def);
		});
		function discriminatedUnion(discriminator, options, params) {
			return new ZodDiscriminatedUnion({
				type: "union",
				options,
				discriminator,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = [...inst._zod.values];
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
			return new ZodEnum({
				type: "enum",
				entries,
				...normalizeParams(params)
			});
		}
		const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
			$ZodLiteral.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
			inst.values = new Set(def.values);
			Object.defineProperty(inst, "value", { get() {
				if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
				return def.values[0];
			} });
		});
		function literal(value, params) {
			return new ZodLiteral({
				type: "literal",
				values: Array.isArray(value) ? value : [value],
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						if (!("input" in _issue)) _issue.input = payload.value;
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					return payload;
				});
				payload.value = output;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		const sideChatErrorSchema = object({
			code: _enum([
				"parent-not-found",
				"already-open",
				"not-open",
				"invalid-input",
				"compatibility",
				"cancelled",
				"internal"
			]),
			message: string()
		}).strict();
		/**
		* The three models a side conversation may route to (provider is always `adam`).
		* `deepseek-v4-flash` was replaced by `deepseek-v4.1-flash` (2026-09-16);
		* persisted legacy selections are mapped host-side (see `sanitizeBtwModel`).
		*/
		const btwModelSchema = _enum([
			"deepseek-v4.1-flash",
			"glm-5.3",
			"deepseek-v4-pro"
		]);
		const startSideChatRequestSchema = object({
			parentSessionId: string().min(1).max(256),
			chatToken: string().uuid(),
			model: btwModelSchema.optional()
		}).strict();
		const startSideChatValueSchema = object({
			parentSessionId: string(),
			childSessionId: string(),
			chatToken: string().uuid(),
			seedLength: number().int().nonnegative(),
			/** Whether this start resumed a persisted child (true) or forked a fresh one (false). */
			resumed: boolean(),
			/** The side conversation's current model (default or persisted). */
			model: btwModelSchema.optional()
		}).strict();
		const startSideChatResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: startSideChatValueSchema
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		const readSideChatRequestSchema = object({ chatToken: string().uuid() }).strict();
		/** The raster formats a pasted side-chat image may carry (aligned with `dsh-attachment`). */
		const sideChatImageMediaTypeSchema = _enum([
			"image/png",
			"image/jpeg",
			"image/webp",
			"image/gif"
		]);
		/**
		* One pasted image carried by a `sideChat/send` request. `data` is the
		* canonical base64 payload; the host admits it through the attachments store
		* before it is ever referenced.
		*/
		const sideChatImagePartSchema = object({
			type: literal("image"),
			mediaType: sideChatImageMediaTypeSchema,
			data: string().min(1),
			name: string().optional()
		}).strict();
		/** A durable image reference echoed in the transcript for display (host-owned refs). */
		const sideChatImageRefSchema = object({
			attachmentId: string(),
			mediaType: sideChatImageMediaTypeSchema,
			name: string().optional()
		}).strict();
		/**
		* Flat summary of one tool call in the child transcript (Layer B). The host
		* collects `tool/call` + `tool/result` events (which the parent digest never
		* reads, see side-chat-service.ts) and projects a lightweight IN/OUT pair for
		* the panel's ToolRow approximation. No full `ToolCallBlock` is transported.
		*/
		const sideChatToolDigestSchema = object({
			callId: string(),
			name: string(),
			/** Raw JSON argument text from the `tool/call` event (IN). */
			args: string(),
			/** Content text of the `tool/result` message (OUT); present once settled. */
			result: string().optional(),
			/** Whether the call failed (`tool/result` isError). */
			isError: boolean().optional(),
			/** Whether the call is still in flight (`tool/call` without `tool/result`); only set while the child runs. */
			running: boolean().optional()
		}).strict();
		/**
		* What the child agent is doing right now, for the running banner (TurnStatus
		* approximation). `turn`/`step` come from the latest persisted `step/start`,
		* falling back to the most recent `tool/call`.
		*/
		const sideChatCurrentActionSchema = discriminatedUnion("kind", [object({
			kind: literal("generating"),
			turn: number().int().nonnegative(),
			step: number().int().nonnegative()
		}).strict(), object({
			kind: literal("tool"),
			tool: string().min(1),
			turn: number().int().nonnegative(),
			step: number().int().nonnegative()
		}).strict()]);
		const sideChatTranscriptMessageSchema = object({
			id: string(),
			role: _enum(["user", "assistant"]),
			text: string(),
			images: array(sideChatImageRefSchema).optional(),
			/** Flat tool call summaries that happened right after this assistant message (Layer B). */
			tools: array(sideChatToolDigestSchema).optional()
		}).strict();
		const readSideChatImageRequestSchema = object({
			chatToken: string().uuid(),
			attachmentId: string().min(1)
		}).strict();
		const readSideChatImageResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: object({
				mediaType: sideChatImageMediaTypeSchema,
				data: string()
			}).strict()
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		/** One question inside a pending btw_ask_user call (mirrors ask_user_question's shape). */
		const btwQuestionSchema = object({
			id: string().min(1),
			question: string().min(1),
			header: string().optional(),
			options: array(object({
				label: string().min(1),
				description: string().optional()
			})).optional(),
			multi_select: boolean().optional()
		}).strict();
		/** The question currently blocking the child agent, surfaced through sideChat/read. */
		const btwPendingQuestionSchema = object({
			questionId: string().uuid(),
			questions: array(btwQuestionSchema).min(1)
		}).strict();
		/** One answered question, echoed back through sideChat/answer. */
		const btwAnswerSchema = object({
			id: string().min(1),
			selected: array(string()),
			custom: string().optional()
		}).strict();
		const readSideChatResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: object({
				chatToken: string().uuid(),
				revision: number().int().nonnegative(),
				messages: array(sideChatTranscriptMessageSchema),
				partial: string(),
				reasoning: string(),
				running: boolean(),
				runningTool: string().optional(),
				currentAction: sideChatCurrentActionSchema.optional(),
				pendingQuestion: btwPendingQuestionSchema.optional(),
				model: btwModelSchema.optional()
			}).strict()
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		const sendSideChatRequestSchema = object({
			chatToken: string().uuid(),
			requestId: string().uuid(),
			/** The user's own text; may be empty when `images` are present (pure-image message). */
			text: string().trim().max(1e5),
			images: array(sideChatImagePartSchema).optional()
		}).strict();
		const sendSideChatValueSchema = object({
			chatToken: string().uuid(),
			requestId: string().uuid(),
			accepted: literal(true),
			messageId: string()
		}).strict();
		const sendSideChatResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: sendSideChatValueSchema
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		const cancelSideChatRequestSchema = object({ chatToken: string().uuid() }).strict();
		const cancelSideChatResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: object({
				chatToken: string().uuid(),
				accepted: literal(true)
			}).strict()
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		const answerSideChatRequestSchema = object({
			chatToken: string().uuid(),
			questionId: string().uuid(),
			answers: array(btwAnswerSchema)
		}).strict();
		const answerSideChatValueSchema = object({
			chatToken: string().uuid(),
			questionId: string().uuid(),
			accepted: literal(true)
		}).strict();
		const answerSideChatResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: answerSideChatValueSchema
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		const closeSideChatRequestSchema = object({ chatToken: string().uuid() }).strict();
		const closeSideChatValueSchema = object({
			chatToken: string().uuid(),
			closed: boolean(),
			/**
			* `kept`: the live runtime state was removed while the persisted child log
			* stays on disk for a later resume; `absent`: no live entry existed.
			*/
			cleanup: _enum(["kept", "absent"]),
			warning: string().optional()
		}).strict();
		const closeSideChatResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: closeSideChatValueSchema
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		const setSideChatModelRequestSchema = object({
			chatToken: string().uuid(),
			model: btwModelSchema
		}).strict();
		const setSideChatModelValueSchema = object({
			chatToken: string().uuid(),
			accepted: literal(true)
		}).strict();
		const setSideChatModelResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: setSideChatModelValueSchema
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		/**
		* One enumerated side conversation: a tree/project node (identified by
		* `parentSessionId`) joined with its persisted btw index record and, when the
		* node is live, fresh session metadata.
		*/
		const sideChatTreeEntrySchema = object({
			parentSessionId: string(),
			childSessionId: string(),
			title: string().optional(),
			cwd: string().optional(),
			lastActiveAt: number(),
			preview: string().optional(),
			running: boolean().optional()
		}).strict();
		const listSideChatTreeRequestSchema = object({ parentSessionId: string().min(1).max(256) }).strict();
		const listSideChatTreeResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: object({ entries: array(sideChatTreeEntrySchema) }).strict()
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		const listSideChatProjectRequestSchema = object({ parentSessionId: string().min(1).max(256) }).strict();
		const listSideChatProjectResultSchema = discriminatedUnion("ok", [object({
			ok: literal(true),
			value: object({ entries: array(sideChatTreeEntrySchema) }).strict()
		}).strict(), object({
			ok: literal(false),
			error: sideChatErrorSchema
		}).strict()]);
		//#endregion
		//#region src/remote-descriptors.ts
		const PACKAGE = "@local/dsh-btw";
		function directDescriptor(method, requestSymbol, requestSchema, resultSymbol, resultSchema, line) {
			return {
				id: `${PACKAGE}#sideChat/${method}`,
				service: "sideChat",
				namespace: "sideChat",
				method,
				invocation: { kind: "direct" },
				parameters: [{
					name: "request",
					wire: "request",
					source: "json",
					codec: {
						mode: "strict",
						typeSymbol: `${PACKAGE}#${requestSymbol}`,
						schema: requestSchema
					}
				}],
				result: {
					mode: "strict",
					typeSymbol: `${PACKAGE}#${resultSymbol}`,
					schema: resultSchema
				},
				sourceLocation: {
					file: "src/host/side-chat-service.ts",
					line,
					column: 3
				}
			};
		}
		//#endregion
		//#region src/client/remote.ts
		const TYPERT_REMOTE = {
			package: "@local/dsh-btw",
			descriptors: Object.freeze([
				directDescriptor("start", "StartSideChatRequest", startSideChatRequestSchema, "StartSideChatResult", startSideChatResultSchema, 444),
				directDescriptor("read", "ReadSideChatRequest", readSideChatRequestSchema, "ReadSideChatResult", readSideChatResultSchema, 784),
				directDescriptor("send", "SendSideChatRequest", sendSideChatRequestSchema, "SendSideChatResult", sendSideChatResultSchema, 793),
				directDescriptor("answer", "AnswerSideChatRequest", answerSideChatRequestSchema, "AnswerSideChatResult", answerSideChatResultSchema, 870),
				directDescriptor("cancel", "CancelSideChatRequest", cancelSideChatRequestSchema, "CancelSideChatResult", cancelSideChatResultSchema, 886),
				directDescriptor("close", "CloseSideChatRequest", closeSideChatRequestSchema, "CloseSideChatResult", closeSideChatResultSchema, 899),
				directDescriptor("setModel", "SetSideChatModelRequest", setSideChatModelRequestSchema, "SetSideChatModelResult", setSideChatModelResultSchema, 924),
				directDescriptor("readImage", "ReadSideChatImageRequest", readSideChatImageRequestSchema, "ReadSideChatImageResult", readSideChatImageResultSchema, 943),
				directDescriptor("listTree", "ListSideChatTreeRequest", listSideChatTreeRequestSchema, "ListSideChatTreeResult", listSideChatTreeResultSchema, 977),
				directDescriptor("listProject", "ListSideChatProjectRequest", listSideChatProjectRequestSchema, "ListSideChatProjectResult", listSideChatProjectResultSchema, 1e3)
			])
		};
		//#endregion
		//#region src/client/index.ts
		const name = "dsh-btw/client";
		const inject = [
			"slots",
			"sessions",
			"remote",
			"locale",
			"settingsScope"
		];
		async function apply(ctx) {
			const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
			ctx.inject(["remote.sideChat"], (remoteCtx) => {
				installSideChat(remoteCtx);
			});
			return disposeRemote;
		}
		function installSideChat(ctx) {
			const controller = new SideChatController(ctx, ctx.remote.sideChat);
			const viewStore = new SideChatViewStore();
			const settingsScope = bindBtwSettings(ctx.settingsScope);
			const presentation = new SideChatPresentation(ctx, controller, viewStore, settingsScope);
			ctx.effect(() => ctx.locale.register("btw", {
				zh,
				en
			}), "btw: client dictionaries");
			ctx.effect(() => () => {
				controller.dispose();
			}, "btw: controller lifecycle");
			ctx.inject(["betterSidebar"], (betterSidebarCtx) => {
				betterSidebarCtx.effect(() => presentation.attachBetterSidebar(betterSidebarCtx.betterSidebar), "btw: Better Sidebar adapter");
			});
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "dsh-btw.action",
				order: 40,
				locale: "btw",
				inject: (_sessionId) => ({
					controller,
					viewStore,
					presentation
				})
			}, SideChatButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-btw.drawer",
				order: 100,
				locale: "btw",
				inject: () => {
					const parentSessionId = controller.getSnapshot().parentSessionId ?? controller.currentSessionId();
					const activeParent = () => controller.getSnapshot().parentSessionId;
					return {
						controller,
						viewStore,
						presentation,
						settingsScope,
						parentSessionId,
						onMinimize: () => {
							const current = activeParent();
							if (current !== void 0) presentation.minimize(String(current));
						},
						onEnd: async () => {
							const current = activeParent();
							if (current !== void 0) await presentation.end(String(current));
						}
					};
				}
			}, SideChatDrawer));
			ctx.effect(() => {
				const onKeyDown = (event) => {
					if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== "Period") return;
					event.preventDefault();
					const current = controller.currentSessionId();
					if (current !== void 0) presentation.toggle(String(current));
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, "btw: keyboard shortcut");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
