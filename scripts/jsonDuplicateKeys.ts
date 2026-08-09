/**
 * RAW-TEXT DUPLICATE-KEY SCAN for JSON documents.
 *
 * WHY THIS EXISTS: duplicate keys inside one JSON object are NOT a parse error.
 * `JSON.parse('{"power":20,"power":999}')` yields `{power: 999}` — every parser
 * silently keeps the last one. So a content document can tell a structural lie
 * that no post-parse validator can ever see: the first value simply does not
 * exist by the time `validateSkillDocument` runs.
 *
 * That is unacceptable for a contract, and it is closeable — but ONLY against
 * the raw bytes, which is why this runs at the build/test gate (which reads the
 * file from disk) and not in the loader (which receives an already-parsed
 * object). The gate is what blocks a deploy, so that is the right place.
 *
 * This is deliberately NOT a full JSON parser. It walks strings, objects and
 * arrays just far enough to know whether a given `"..."` token is a KEY in the
 * current object scope, and reports two identical keys in the same scope with
 * line numbers. Anything malformed enough to confuse it will be caught by
 * `JSON.parse` moments later anyway.
 */
export interface DuplicateKey {
  key: string;
  line: number;
  firstLine: number;
  path: string;
}

interface Scope {
  isObject: boolean;
  keys: Map<string, number>;
  label: string;
}

export function findDuplicateKeys(text: string): DuplicateKey[] {
  const out: DuplicateKey[] = [];
  const stack: Scope[] = [];
  let i = 0;
  let line = 1;
  let expectKey = false;

  const top = (): Scope | undefined => stack[stack.length - 1];
  const pathOf = (): string => stack.map((s) => s.label).filter((l) => l.length > 0).join('.') || '<root>';

  const readString = (): { value: string; startLine: number } => {
    const startLine = line;
    i += 1; // opening quote
    let value = '';
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '\\') {
        const next = text[i + 1] ?? '';
        if (next === 'n') value += '\n';
        else if (next === 't') value += '\t';
        else if (next === 'u') { value += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16) || 0); i += 4; }
        else value += next;
        i += 2;
        continue;
      }
      if (ch === '"') { i += 1; break; }
      if (ch === '\n') line += 1;
      value += ch;
      i += 1;
    }
    return { value, startLine };
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }

    if (ch === '{') { stack.push({ isObject: true, keys: new Map(), label: '' }); expectKey = true; i += 1; continue; }
    if (ch === '[') { stack.push({ isObject: false, keys: new Map(), label: '' }); expectKey = false; i += 1; continue; }
    if (ch === '}' || ch === ']') { stack.pop(); expectKey = false; i += 1; continue; }
    if (ch === ',') { expectKey = top()?.isObject === true; i += 1; continue; }
    if (ch === ':') { expectKey = false; i += 1; continue; }

    if (ch === '"') {
      const scope = top();
      const isKey = expectKey && scope?.isObject === true;
      const { value, startLine } = readString();
      if (isKey && scope) {
        const seenAt = scope.keys.get(value);
        if (seenAt !== undefined) {
          out.push({ key: value, line: startLine, firstLine: seenAt, path: pathOf() });
        } else {
          scope.keys.set(value, startLine);
        }
        // Label the scope by its identifying field so reports are locatable.
        if (value === 'id' || value === 'version') {
          const save = i;
          let j = i;
          while (j < text.length && (text[j] === ' ' || text[j] === ':')) j += 1;
          if (text[j] === '"') { i = j; const v = readString(); scope.label = v.value; }
          else { let n = ''; while (j < text.length && /[0-9]/.test(text[j] ?? '')) { n += text[j]; j += 1; } if (n) { scope.label = 'v' + n; i = j; } else i = save; }
        }
        expectKey = false;
      }
      continue;
    }
    i += 1; // number, true, false, null — skipped token-wise
  }
  return out;
}
