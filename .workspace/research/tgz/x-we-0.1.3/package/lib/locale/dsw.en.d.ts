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
import type { DswKey } from './dsw.ts';
/** EN dictionary — type-checked against {@link DswKey}. */
declare const en: Record<DswKey, string>;
/** EN dictionary — value type kept for index.ts exports. */
export { en };
