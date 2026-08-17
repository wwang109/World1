/**
 * ASCII-safe JSON serialization, shared by the content exporters
 * (exportContent.ts, exportGems.ts).
 *
 * Node's `JSON.stringify` writes non-ASCII characters (e.g. the em dash `—`
 * or middle dot `·` that show up in rescued balance-derivation comments) as
 * raw UTF-8 bytes. `src/data/content/skills.v1.json` is committed in the
 * ASCII-safe form instead — every such character escaped as `\uXXXX` — so
 * that the file is robust across editors/tooling/encodings and diffs cleanly
 * as plain ASCII text. An exporter that writes raw UTF-8 therefore rewrites
 * every one of those escape sites on every run even when no content changed:
 * pure diff churn that makes the tool unsafe to run for routine edits.
 *
 * Escaping is done by UTF-16 CODE UNIT, not by code point. That is what makes
 * a supplementary-plane character (astral emoji, etc.) come out correct: JS
 * strings already hold such a character as a surrogate PAIR (two code units,
 * each individually > 0x7f), and JSON's `\uXXXX` escape is itself limited to
 * a single UTF-16 code unit — so escaping unit-by-unit reproduces exactly the
 * surrogate-pair escape form the JSON spec expects (`😀`, etc.)
 * without any extra surrogate-pair-splitting logic.
 */

/** Escapes every UTF-16 code unit outside printable ASCII (0x20-0x7e) as `\uXXXX`, lowercase hex, zero-padded to 4 digits — matching the form already committed in the content JSON. */
export function escapeNonAscii(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out += code > 0x7f ? `\\u${code.toString(16).padStart(4, '0')}` : text[i];
  }
  return out;
}

/** `JSON.stringify` followed by `escapeNonAscii` — the ASCII-safe drop-in for a pretty-printed content document. */
export function asciiSafeStringify(value: unknown, space: string | number): string {
  return escapeNonAscii(JSON.stringify(value, null, space));
}
