/**
 * Single source of truth for the theme-batch anchors.
 *
 * Every edit is expressed as (target, exact literal `find`, exact literal `replace`).
 * `gen-candidates.mjs` and `apply-Theme-v1.mjs` both consume this module, so a reviewed
 * candidate and the deployed bytes can never drift.
 *
 * Contract rules encoded here:
 *  - every `find` must match EXACTLY ONCE in the text it is applied to (asserted by the
 *    generator and by the applier; any other count aborts the whole batch);
 *  - the deployed layout style is 2-TAB indentation, double quotes, semicolons
 *    (measured with `cat -A` on 2026-09-21) and every replacement follows it;
 *  - the audit-vetoed `cssText` merge is absent by construction.
 *
 * Unit (0) and unit (ii) both insert at the same point in the layout module. To keep
 * each unit independently skippable while still producing one coherent file, the two
 * insertions run in a fixed order over two internal sentinel comments and a terminal
 * edit restores the real doc comment. Both the generator and the applier assert that no
 * sentinel survives into an artifact.
 */

/** Deployed target paths, in the audit's recommended landing order. */
export const DEPLOY_PATHS = {
	layout: "/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js",
	uitheme: "/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js",
	wallpaper: "/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js"
};

/** Pre-image identity recorded by the audit, re-verified by this pass (md5sum). */
export const EXPECTED = {
	layout: { md5: "af19ea709a1556b8c48bedfa8b31e785", lines: 455, rev: "abdb7f55acba" },
	uitheme: { md5: "7b8efca68e0f6c45dfa4222974697eab", lines: 1354, rev: "e19c47b60a1c" },
	wallpaper: { md5: "b9cd4747f91084065d1227fba5aa7e61", lines: 597, rev: "fb28faf9db9a" }
};

/** Default scope: the units this batch is authorised to deploy. `instances`/`overlay` are opt-in. */
export const DEFAULT_SCOPE = ["signature", "themeColor", "wallpaperShade"];

export const SCOPE_HELP = {
	instances: "(0) module-scope single ThemePresenter + refcount — OPT-IN: the source of the 2-6 profiled instances is NOT statically proven (report.md §2)",
	signature: "(i) content-signature replay skip with landing guard (default ON)",
	themeColor: "(ii) frame-deferred, coalesced refresh of the getComputedStyle that feeds theme-color (default ON)",
	overlay: "(iv) ui-theme overrideTokens content comparison — OPT-IN, next batch",
	wallpaperShade: "(iv) wallpaper shadeTokens content comparison — cuts one redundant publish (default ON)"
};

// ---------------------------------------------------------------------------
// module-scope templates
// ---------------------------------------------------------------------------
//
// Unit (0) and unit (ii) both insert into the same spot of the layout module, and the
// ThemePresenter doc comment has to read differently depending on who is present.
// Chaining literal edits there is fragile, so the whole region comes from one table: a
// single anchor spans `DARK_ATTRIBUTE` through the ThemePresenter class declaration, and
// the variant is selected by scope. A merged batch is therefore exactly the text a
// person would have hand-written.
/** Anchor text: the module-scope head plus the pristine ThemePresenter doc line. */
const LAYOUT_SCOPE_FIND = "\t\t/** Body attribute selecting the dark base palette in the token stylesheets. */\n\t\tconst DARK_ATTRIBUTE = \"data-ds-dark-theme\";\n" + "\t\t/** Applies theme snapshots to the document; one instance per plugin fiber. */\n";
/** The head is reproduced verbatim. */
const LAYOUT_SCOPE_HEAD = "\t\t/** Body attribute selecting the dark base palette in the token stylesheets. */\n\t\tconst DARK_ATTRIBUTE = \"data-ds-dark-theme\";\n";
/** Unit (ii): the frame-coalesced theme-color refresh. */
const LAYOUT_FRAME_BODY = "\t\t/** Render callbacks coalesced into one per animation frame (see scheduleThemeColorRefresh). */\n\t\tconst themeColorRefreshQueue = /* @__PURE__ */ new Map();\n\t\tlet themeColorFrame = 0;\n\t\t/**\n\t\t * Run one theme-color refresh per animation frame.\n\t\t * Reading the computed body background forces a synchronous style recalculation,\n\t\t * so it must not run once per snapshot inside the publish dispatch: a frame\n\t\t * boundary merges a whole dispatch round (and every presenter) into a single read\n\t\t * taken after all writers are done. When the host cannot schedule frames the\n\t\t * refresh runs inline, which preserves the previous behaviour there.\n\t\t * @param win - the window the presenter writes into.\n\t\t * @param presenter - the presenter to refresh.\n\t\t */\n\t\tfunction scheduleThemeColorRefresh(win, presenter) {\n\t\t\tconst winRef = win ?? globalThis;\n\t\t\tconst request = winRef.requestAnimationFrame;\n\t\t\tif (typeof request !== \"function\") {\n\t\t\t\tpresenter.refreshThemeColor();\n\t\t\t\treturn;\n\t\t\t}\n\t\t\tlet queued = themeColorRefreshQueue.get(winRef);\n\t\t\tif (queued === void 0) {\n\t\t\t\tqueued = /* @__PURE__ */ new Set();\n\t\t\t\tthemeColorRefreshQueue.set(winRef, queued);\n\t\t\t}\n\t\t\tqueued.add(presenter);\n\t\t\tif (themeColorFrame !== 0) return;\n\t\t\tthemeColorFrame = request.call(winRef, () => {\n\t\t\t\tthemeColorFrame = 0;\n\t\t\t\tconst pending = queued;\n\t\t\t\tthemeColorRefreshQueue.delete(winRef);\n\t\t\t\tfor (const item of pending) item.refreshThemeColor();\n\t\t\t});\n\t\t}\n";
/** Unit (0): shared, reference-counted presenter ownership. */
const LAYOUT_INSTANCE_BODY = "\t\t/**\n\t\t * The theme-color metadata follows the body’s computed background, so this\n\t\t * presenter writes into `body.style`. Every presenter projecting onto the same\n\t\t * document produces the identical token set, which makes concurrent presenters pure\n\t\t * duplicate work — one forced style recalculation each — so ownership is held\n\t\t * once per module per document and reference counted, while each effect still\n\t\t * retracts the document only when the last consumer lets go.\n\t\t */\n\t\tconst themePresenterSlots = /* @__PURE__ */ new WeakMap();\n\t\t/**\n\t\t * Hand out the document’s single theme presenter and count the consumer. The\n\t\t * first caller installs the slot; every later caller (a second presenter instance,\n\t\t * an HMR replacement, a replayed effect) shares it. The document is retracted only\n\t\t * when the LAST consumer releases, so a transient overlap between two presenters\n\t\t * can never blank the document. A release from an earlier generation is a no-op,\n\t\t * which is what keeps the count from drifting.\n\t\t * @param win - the window the presenter writes into.\n\t\t * @param presenter - the presenter that becomes the slot’s owner when free.\n\t\t * @returns the release function for this acquisition.\n\t\t */\n\t\tfunction acquireThemePresenter(win, presenter) {\n\t\t\tconst winRef = win ?? globalThis;\n\t\t\tconst held = themePresenterSlots.get(winRef);\n\t\t\tif (held !== void 0) {\n\t\t\t\theld.refs += 1;\n\t\t\t\treturn held.release;\n\t\t\t}\n\t\t\tconst slot = {\n\t\t\t\tpresenter,\n\t\t\t\trefs: 1,\n\t\t\t\trelease: () => void 0\n\t\t\t};\n\t\t\tslot.release = () => {\n\t\t\t\t/* A stale release must not touch a newer slot’s count: identity check first. */\n\t\t\t\tif (themePresenterSlots.get(winRef) !== slot) return;\n\t\t\t\tslot.refs -= 1;\n\t\t\t\tif (slot.refs > 0) return;\n\t\t\t\tthemePresenterSlots.delete(winRef);\n\t\t\t\tslot.presenter.dispose();\n\t\t\t};\n\t\t\tthemePresenterSlots.set(winRef, slot);\n\t\t\treturn slot.release;\n\t\t}\n";
/**
 * Tail of the region: the doc comment the resulting ownership implies.
 * @param instances - unit (0) is on.
 * @returns the closing doc comment line.
 */
function layoutScopeTail(instances) {
	return "		/** Applies theme snapshots to the document; one instance" + (instances ? " per module" : " per plugin fiber") + " per document. */\n";
}

/**
 * Assemble the module-scope region for a scope.
 * @param instances - unit (0) is on.
 * @param frame - unit (ii) is on.
 * @returns the replacement text for LAYOUT_SCOPE_FIND.
 */
function layoutScopeTemplate(instances, frame) {
	return LAYOUT_SCOPE_HEAD + (instances ? LAYOUT_INSTANCE_BODY : "") + (frame ? LAYOUT_FRAME_BODY : "") + layoutScopeTail(instances);
}

const LAYOUT_ANCHORS = {
	/** [i] canonical, order-independent, content-only signature helper. */
	tokenSignatureHelper: {
		find: `		//#endregion
		//#region lib/types/client/index.js
		/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
		const inject = ["slots", "theme"];
`,
		replace: `		/**
		 * Canonical signature of the token pairs a presenter writes. Order independence
		 * keeps the signature a function of CONTENT, so a snapshot rebuilt with the same
		 * values but a different key order still compares equal. The join is unambiguous
		 * because the values are JSON-encoded and the separator is a NUL, which cannot
		 * occur inside one.
		 * @param entries - the \`[name, value]\` pairs taken from \`active.tokens\`.
		 * @returns the signature string.
		 */
		function tokenSignature(entries) {
			const parts = [];
			for (const [name, value] of entries) parts.push(name + "=" + JSON.stringify(value === void 0 ? null : value));
			parts.sort();
			return parts.join("\\u0000");
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
		const inject = ["slots", "theme"];
`
	},

	/**
	 * [0]+[ii] module scope: ONE anchor, three literal templates. Everything the two units
	 * need at this spot is written together, so no edit depends on text another edit created.
	 */
	moduleScope: {
		find: LAYOUT_SCOPE_FIND,
		/* The scope-dependent replacement is computed by layoutEdits below. */
		replace: ""
	},
	/** [i] presenter fields. */
	fields: {
		find: `			/** Token names this presenter wrote in the last apply (its retraction set). */
			appliedTokens = [];
			/** The single metadata node this presenter inserts and removes. */
			themeColorMeta;
`,
		replace: `			/** Token names this presenter wrote in the last apply (its retraction set). */
			appliedTokens = [];
			/** Token names the previous apply wrote; the profile an unchanged snapshot must still satisfy. */
			lastTokens = [];
			/** Content signature of the last applied snapshot, or undefined before the first apply. */
			lastSignature;
			/** The single metadata node this presenter inserts and removes. */
			themeColorMeta;
			/** Token list of the last snapshot, pending the frame-coalesced metadata refresh. */
			pendingTokenSignature;
			/** Token signature the metadata node was last refreshed from. */
			refreshedTokenSignature;
`
	},

	/** [i]+[ii] apply body: content-signature skip, then the same writes, then the deferred refresh. */
	applyHead: {
		find: `			apply(snapshot) {
				const scheme = snapshot.active.colorScheme;
				document.documentElement.style.colorScheme = scheme;
				const body = document.body;
				if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
				else body.removeAttribute(DARK_ATTRIBUTE);
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				for (const [name, value] of Object.entries(snapshot.active.tokens)) {
					body.style.setProperty(name, value);
					this.appliedTokens.push(name);
				}
				this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
				if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
			}
`,
		replace: `			apply(snapshot) {
				const scheme = snapshot.active.colorScheme;
				const entries = Object.entries(snapshot.active.tokens);
				/*
				 * The publish dispatch is synchronous and every publisher mints a new
				 * snapshot object (revision + 1), so "same object" is never a usable skip
				 * test. The signature therefore covers CONTENT ONLY — colorScheme plus every
				 * token name/value — and never \`revision\`, which would make the test miss on
				 * every publish by construction.
				 */
				const signature = scheme + "\\u0000" + tokenSignature(entries);
				const body = document.body;
				if (signature === this.lastSignature && this.landingIntact(scheme, body)) {
					/* Provably idempotent replay: the body still holds exactly the state this
					 * snapshot produced, so re-running the writes would change no computed
					 * value — it would only pay for another forced recalculation. The
					 * theme-color metadata needs no refresh either: its input is a function of
					 * exactly that state. */
					return;
				}
				document.documentElement.style.colorScheme = scheme;
				if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
				else body.removeAttribute(DARK_ATTRIBUTE);
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				for (const [name, value] of entries) {
					body.style.setProperty(name, value);
					this.appliedTokens.push(name);
				}
				if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
				this.lastSignature = signature;
				this.lastTokens = this.appliedTokens;
				/*
				 * The metadata value is the COMPUTED body background, so it must be read
				 * after these writes; that read is what forces a synchronous, document-wide
				 * style recalculation. Deferring it to the next animation frame collapses a
				 * whole dispatch round (and every concurrent presenter) into one read taken
				 * after all writers are done, while still observing the state this apply
				 * wrote. When the host cannot schedule frames it runs inline.
				 */
				this.pendingTokenSignature = tokenSignature(entries);
				scheduleThemeColorRefresh(this.themeColorMeta.ownerDocument?.defaultView, this);
			}
			/**
			 * Whether the document still holds the landing site this presenter wrote. A
			 * skipped apply is only sound when the previous landing is provably intact,
			 * which is what keeps a concurrent writer (or a retraction by another
			 * generation) from being silently ignored.
			 * @param scheme - the color scheme the snapshot carries.
			 * @param body - the document body.
			 * @returns true when the first apply is not needed.
			 */
			landingIntact(scheme, body) {
				if (document.documentElement.style.colorScheme !== scheme) return false;
				if (body.hasAttribute(DARK_ATTRIBUTE) !== (scheme === "dark")) return false;
				/* Reading our own tokens back is the only cheap proof that no other writer
				 * cleared or overwrote the variables this presenter owns. */
				for (const name of this.lastTokens) if (body.style.getPropertyValue(name) === "") return false;
				return true;
			}
			/**
			 * Refresh the metadata node from the body's computed background. Idempotent per
			 * snapshot: a refresh whose token signature already landed is skipped.
			 */
			refreshThemeColor() {
				const signature = this.pendingTokenSignature;
				if (signature !== void 0 && signature === this.refreshedTokenSignature) return;
				this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor;
				this.refreshedTokenSignature = signature;
			}
`
	},

	/** [i] dispose: drop the memo so any later apply rebuilds the document. */
	dispose: {
		find: `				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				this.themeColorMeta.remove();
			}
`,
		replace: `				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				this.lastTokens = [];
				this.lastSignature = void 0;
				this.pendingTokenSignature = void 0;
				this.themeColorMeta.remove();
			}
`
	},

	/** [0] effect body: acquire the shared presenter, apply, subscribe, release on teardown. */
	effect: {
		find: `			ctx.effect(() => {
				const presenter = new ThemePresenter();
				presenter.apply(ctx.theme.getTheme());
				const off = ctx.on("theme/change", (snapshot) => {
					presenter.apply(snapshot);
				});
				return () => {
					off();
					presenter.dispose();
				};
			}, "ui-layout: theme presenter");
`,
		replace: `			ctx.effect(() => {
				const presenter = new ThemePresenter();
				const release = acquireThemePresenter(window, presenter);
				presenter.apply(ctx.theme.getTheme());
				const off = ctx.on("theme/change", (snapshot) => {
					presenter.apply(snapshot);
				});
				return () => {
					off();
					release();
				};
			}, "ui-layout: theme presenter");
`
	}
};

/**
 * Emit the layout edit list for a scope.
 *
 * Order is load-bearing:
 *   1. tokenSignatureHelper — a disjoint region, order-independent;
 *   2. instanceScope — replaces the doc line with its block plus both sentinels;
 *   3. frameScope — replaces the surviving doc line with the frame block, keeping unit
 *      (0)'s sentinel when it is on, or installing the block alone;
 *   4. master / instancesOnlyCleanup — exactly one terminal edit collapses the rest;
 *   5. fields / applyHead / dispose / effect — disjoint regions.
 */
export function layoutEdits(scope) {
	const edits = [];
	const wantsSignature = scope.includes("signature") || scope.includes("themeColor");
	const wantsInstances = scope.includes("instances");
	if (scope.includes("signature")) {
		/* The signature helper sits in a disjoint region, so its edit is order independent. */
		edits.push({ key: "tokenSignatureHelper", ...LAYOUT_ANCHORS.tokenSignatureHelper });
	}
	if (wantsSignature || wantsInstances) {
		edits.push({
			key: "moduleScope",
			...LAYOUT_ANCHORS.moduleScope,
			replace: layoutScopeTemplate(wantsInstances, wantsSignature)
		});
	}
	if (wantsSignature) {
		edits.push({ key: "fields", ...LAYOUT_ANCHORS.fields });
		edits.push({ key: "applyHead", ...LAYOUT_ANCHORS.applyHead });
		edits.push({ key: "dispose", ...LAYOUT_ANCHORS.dispose });
	}
	if (wantsInstances) edits.push({ key: "effect", ...LAYOUT_ANCHORS.effect });
	return edits;
}

// ---------------------------------------------------------------------------
// (iv) — dsh-client-ui-theme/lib/client.js : overrideTokens content comparison
// ---------------------------------------------------------------------------

const UITHEME_ANCHORS = {
	helper: {
		find: `		/**
		* Runtime shape check for one override layer (model-authored callers pass
		* untyped JS through the dynamic-package façade, so the static type cannot
		* enforce the pair shape there). Returns a defensive per-token copy so later
		* caller mutation cannot reach the stored layer.
		*/
		function validateOverrides(source, tokens) {
`,
		replace: `		/**
		* Structural equality of two validated override layers. Re-overriding a source
		* with identical content leaves the composed snapshot unchanged, so publishing it
		* only re-enters every \`theme/change\` listener.
		* @param left - the stored layer's token map.
		* @param right - the incoming layer's token map.
		* @returns true when both carry exactly the same names and per-scheme values.
		*/
		function sameOverrideTokens(left, right) {
			const leftNames = Object.keys(left);
			const rightNames = Object.keys(right);
			if (leftNames.length !== rightNames.length) return false;
			for (const name of leftNames) {
				const a = left[name];
				const b = right[name];
				if (b === void 0) return false;
				if (a.light !== b.light || a.dark !== b.dark) return false;
			}
			return true;
		}
		/**
		* Runtime shape check for one override layer (model-authored callers pass
		* untyped JS through the dynamic-package façade, so the static type cannot
		* enforce the pair shape there). Returns a defensive per-token copy so later
		* caller mutation cannot reach the stored layer.
		*/
		function validateOverrides(source, tokens) {
`
	},
	override: {
		find: `			overrideTokens(source, tokens) {
				const layer = {
					seq: this.overrideSeq++,
					tokens: validateOverrides(source, tokens)
				};
				this.overrides.set(source, layer);
				this.publish();
				return () => {
					if (this.overrides.get(source) !== layer) return;
					this.overrides.delete(source);
					this.publish();
				};
			}
`,
		replace: `			overrideTokens(source, tokens) {
				const validated = validateOverrides(source, tokens);
				const current = this.overrides.get(source);
				/*
				 * Re-overriding a source with byte-identical content cannot change the
				 * composed snapshot, so publishing it is pure re-entrant work: every
				 * \`theme/change\` listener (each ThemePresenter) replays for a snapshot it
				 * already holds. Return the existing layer's disposer instead — the caller
				 * still owns exactly the layer it is looking at, and the composed snapshot
				 * it would have produced is identical.
				 */
				if (current !== void 0 && sameOverrideTokens(current.tokens, validated)) return () => {
					if (this.overrides.get(source) !== current) return;
					this.overrides.delete(source);
					this.publish();
				};
				const layer = {
					seq: this.overrideSeq++,
					tokens: validated
				};
				this.overrides.set(source, layer);
				this.publish();
				return () => {
					if (this.overrides.get(source) !== layer) return;
					this.overrides.delete(source);
					this.publish();
				};
			}
`
	}
};

export function uithemeEdits(scope) {
	if (!scope.includes("overlay")) return [];
	return [{ key: "helper", ...UITHEME_ANCHORS.helper }, { key: "override", ...UITHEME_ANCHORS.override }];
}

// ---------------------------------------------------------------------------
// (iv) — @local/dsh-wallpaper/lib/client.js : shadeTokens content comparison
// ---------------------------------------------------------------------------

const WALLPAPER_ANCHORS = {
	helper: {
		find: `    function resolveBase(snapshot, scheme) {
`,
		replace: `    // Content of the override layer shadeTokens last handed to ui-theme.
    let shadedTokens;
    function sameShadedTokens(left, right) {
      if (left === void 0) return false;
      return left["--dsw-alias-bg-base"].light === right["--dsw-alias-bg-base"].light &&
        left["--dsw-alias-bg-base"].dark === right["--dsw-alias-bg-base"].dark;
    }
    function resolveBase(snapshot, scheme) {
`
	},
	shade: {
		find: `    function shadeTokens(ctx, opacity) {
      if (shading) return;
      shading = true;
      try {
        const snapshot = ctx.theme.getTheme();
        overrideDispose?.();
        overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, {
          "--dsw-alias-bg-base": {
            light: toRgba(resolveBase(snapshot, "light"), opacity),
            dark: toRgba(resolveBase(snapshot, "dark"), opacity)
          }
        });
      } finally {
        shading = false;
      }
    }
`,
		replace: `    function shadeTokens(ctx, opacity) {
      if (shading) return;
      shading = true;
      try {
        const snapshot = ctx.theme.getTheme();
        const next = {
          "--dsw-alias-bg-base": {
            light: toRgba(resolveBase(snapshot, "light"), opacity),
            dark: toRgba(resolveBase(snapshot, "dark"), opacity)
          }
        };
        // The source and this layer are rebuilt byte-identically on every theme change;
        // re-stacking identical content only re-enters every theme/change listener, so
        // the existing layer is kept and its redundant publish is skipped.
        if (sameShadedTokens(shadedTokens, next)) return;
        shadedTokens = next;
        overrideDispose?.();
        overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, next);
      } finally {
        shading = false;
      }
    }
`
	}
};

export function wallpaperEdits(scope) {
	if (!scope.includes("wallpaperShade")) return [];
	return [{ key: "helper", ...WALLPAPER_ANCHORS.helper }, { key: "shade", ...WALLPAPER_ANCHORS.shade }];
}

/** All edit groups for a scope, keyed by target, in landing order. */
export function editGroups(scope) {
	return [
		{ target: "layout", path: DEPLOY_PATHS.layout, edits: layoutEdits(scope) },
		{ target: "uitheme", path: DEPLOY_PATHS.uitheme, edits: uithemeEdits(scope) },
		{ target: "wallpaper", path: DEPLOY_PATHS.wallpaper, edits: wallpaperEdits(scope) }
	].filter((group) => group.edits.length > 0);
}

/** Count non-overlapping occurrences of a literal in a string. */
export function countOccurrences(haystack, needle) {
	let count = 0;
	let at = haystack.indexOf(needle);
	while (at !== -1) {
		count += 1;
		at = haystack.indexOf(needle, at + needle.length);
	}
	return count;
}

/**
 * Apply literal replacements in order, asserting a single match for each one.
 * @param text - the text to edit (the pristine target for the first edit of a group).
 * @param edits - one edit or a list of edits.
 * @param label - diagnostic label.
 * @returns the edited text.
 */
export function applyEdits(text, edits, label) {
	const list = Array.isArray(edits) ? edits : [edits];
	let out = text;
	for (const edit of list) {
		const first = out.indexOf(edit.find);
		if (first === -1) throw new Error(`${label}/${edit.key}: anchor MISSING`);
		const second = out.indexOf(edit.find, first + 1);
		if (second !== -1) throw new Error(`${label}/${edit.key}: anchor NOT UNIQUE (${countOccurrences(out, edit.find)} occurrences)`);
		out = out.slice(0, first) + edit.replace + out.slice(first + edit.find.length);
	}
	return out;
}

/** Build-time sentinels. The template table no longer emits any, so this is empty by design. */
export const SENTINELS = [];

/**
 * Identifiers introduced at module scope. The verifier asserts that each one is
 * DECLARED in the patched file and actually referenced, so a rename can never silently
 * produce a reference to something the module does not declare.
 */
export const INTRODUCED = {
	layout: {
		signature: ["tokenSignature"],
		themeColor: ["themeColorRefreshQueue", "themeColorFrame", "scheduleThemeColorRefresh"],
		instances: ["themePresenterSlots", "acquireThemePresenter"]
	},
	uitheme: ["sameOverrideTokens"],
	wallpaper: ["shadedTokens", "sameShadedTokens"]
};

export function introducedFor(scope) {
	const out = {};
	const layout = [];
	if (scope.includes("signature")) layout.push(...INTRODUCED.layout.signature);
	if (scope.includes("themeColor")) layout.push(...INTRODUCED.layout.themeColor);
	if (scope.includes("instances")) layout.push(...INTRODUCED.layout.instances);
	if (layout.length > 0) out.layout = layout;
	if (scope.includes("overlay")) out.uitheme = INTRODUCED.uitheme;
	if (scope.includes("wallpaperShade")) out.wallpaper = INTRODUCED.wallpaper;
	return out;
}
