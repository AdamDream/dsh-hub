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
import { zh } from "./dsw.js";
import { en } from "./dsw.en.js";
export { zh, en };
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
export function lookup(locale, key, params) {
    const template = locale === 'zh' ? (zh[key] ?? en[key]) : en[key];
    const text = template ?? key;
    if (params === undefined)
        return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}
/**
 * Client-side dictionary registration (drafts/i18n-design.md §9): one typed
 * `register('dsw', { zh, en })` call inside `ctx.effect`, so the registration
 * is disposed together with the plugin context. The framework register
 * returns an idempotent disposer and throws on a duplicate (ns, locale)
 * registration — a programming-error guard the caller (client apply) relies on.
 */
export function registerDswLocale(ctx) {
    ctx.effect(() => ctx.locale.register('dsw', { zh, en }), 'dsw: dictionaries');
}
//# sourceMappingURL=index.js.map