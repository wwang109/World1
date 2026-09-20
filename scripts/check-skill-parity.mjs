// Shared-skill parity checker — the gate that keeps the two skill roots in step.
//
// Two AI agents work in this checkout, often at the same time. OpenAI Codex
// CLI loads skills from `.agents/skills/`; Claude Code loads them from
// `.claude/skills/`. Neither reads the other's directory — verified
// 2026-09-05, when Claude Code did not list `world1-game-review`, which then
// lived only under `.agents/`. A skill BOTH agents must follow therefore has
// to exist twice, and two hand-maintained copies drift: the same class of bug
// this project already closed for log renderers (`fmtDamage`) and generated
// content (`*.v1.json` idempotency). This script makes that drift a red gate.
//
// Line endings are normalised before comparison on purpose: this is a Windows
// checkout with `core.autocrlf=true` and `.gitattributes` does not pin these
// files, so a CRLF working copy is a checkout artifact, not a content change.
//
// The `.gitignore` check asks git itself (`git check-ignore`) rather than
// grepping for the whitelist lines: `.agents/` is ignored wholesale except for
// whitelisted skills, and a later pattern can silently re-ignore a twin that
// the lines alone would still "prove" tracked.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

/** Skills every agent must see. Add here when you add a twin. */
const SHARED_SKILLS = [
  'world1-handoff',
  'world1-codemap',
  'world1-card-text',
  'world1-game-review',
  'world1-balance',
  'world1-combat-log',
  'world1-screens',
  'world1-testing',
];

/** Vendor-neutral root (Codex, `npx skills`) and the Claude Code root. */
const ROOTS = ['.agents/skills', '.claude/skills'];

/**
 * Skills that intentionally live under ONLY `.claude/skills` — Claude-specific
 * slash-command drivers with no Codex equivalent. Adding a name here is a
 * deliberate decision to make that skill invisible to the other agent; it
 * must not also exist under `.agents/skills`.
 */
const CLAUDE_ONLY_SKILLS = ['orchestrate', 'team-combat'];

/**
 * Skills that intentionally live under ONLY `.agents/skills` — Codex-specific,
 * no Claude Code equivalent. Empty today; adding a name here is the Codex-side
 * mirror of `CLAUDE_ONLY_SKILLS` and carries the same "deliberately hidden
 * from the other agent" meaning.
 */
const CODEX_ONLY_SKILLS = [];

/**
 * Frontmatter keys the Agent Skills spec defines. Claude-only keys
 * (`argument-hint`, `user-invocable`, `model`, `context`, `agent`, `hooks`,
 * `paths`, `disable-model-invocation`) stay out of SHARED skills so the same
 * bytes mean the same thing to every loader.
 */
const PORTABLE_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

const lf = (text) => text.replace(/\r\n/g, '\n');

/**
 * Minimal frontmatter reader: `key: value` lines plus folded (`>`) and
 * literal (`|`) block scalars, which long descriptions legitimately use.
 * Anything fancier is deliberately unsupported — a shared skill's frontmatter
 * must stay simple enough for every loader to agree on it.
 */
function frontmatter(text) {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(lf(text));
  if (!m) throw new Error('no frontmatter block');
  const lines = m[1].split('\n');
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === '' || /^[>|][+-]?$/.test(value)) {
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(value.startsWith('|') ? '\n' : ' ');
    }
    out[kv[1]] = value;
  }
  return out;
}

/** Ask git whether a path is ignored, pattern order and later re-ignores included. */
function gitIgnores(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' });
    return true; // exit 0: ignored
  } catch (err) {
    if (err.status === 1) return false; // exit 1: not ignored
    throw err; // 128: git itself failed
  }
}

// Every path this checker holds is POSIX-separated on EVERY platform, the same
// invariant `check-boundaries.mjs` keeps: a failure line has to read the same
// on Windows and on CI.
const skillDir = (root, skill) => posix.join(root, skill);
const skillFile = (root, skill) => posix.join(root, skill, 'SKILL.md');

/**
 * Every FILE under `dir`, recursively, as POSIX-style relative paths, sorted.
 * Generic over filenames on purpose: a shared skill's `references/*.md` set
 * is authored by whichever agent owns that skill, not by this script.
 */
function walkFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = posix.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(posix.relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

const dirNames = (root) =>
  readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const violations = [];

// ---- Per-skill checks: presence, identical file sets, identical bytes,
// portable frontmatter, git-tracked, plain references/.
for (const skill of SHARED_SKILLS) {
  let present = true;
  for (const root of ROOTS) {
    if (!existsSync(skillDir(root, skill))) {
      violations.push(`${skillDir(root, skill)}: shared skill directory does not exist`);
      present = false;
    } else if (!existsSync(skillFile(root, skill))) {
      violations.push(`${skillFile(root, skill)}: shared skill is missing its SKILL.md`);
      present = false;
    }
  }
  if (!present) continue;

  const [a, b] = ROOTS.map((root) => walkFiles(skillDir(root, skill)));
  if (!sameList(a, b)) {
    const onlyA = a.filter((f) => !b.includes(f));
    const onlyB = b.filter((f) => !a.includes(f));
    for (const f of onlyA) violations.push(`${skillDir(ROOTS[0], skill)}/${f}: exists only under ${ROOTS[0]} — the twin under ${ROOTS[1]} is missing`);
    for (const f of onlyB) violations.push(`${skillDir(ROOTS[1], skill)}/${f}: exists only under ${ROOTS[1]} — the twin under ${ROOTS[0]} is missing`);
  } else {
    for (const file of a) {
      const [ta, tb] = ROOTS.map((root) => lf(readFileSync(posix.join(skillDir(root, skill), file), 'utf8')));
      if (ta !== tb) violations.push(`${skill}/${file}: the two copies differ (modulo line endings) — copy one over the other`);
    }
  }

  const entry = skillFile(ROOTS[0], skill);
  const raw = readFileSync(entry, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) violations.push(`${entry}: starts with a UTF-8 BOM, which breaks frontmatter detection`);
  let fm = null;
  try {
    fm = frontmatter(raw);
  } catch (err) {
    violations.push(`${entry}: ${err.message}`);
  }
  if (fm) {
    if (fm.name !== skill) violations.push(`${entry}: frontmatter name "${fm.name ?? ''}" must equal the directory name "${skill}"`);
    if (!/^[a-z0-9-]{1,64}$/.test(fm.name ?? '')) violations.push(`${entry}: frontmatter name "${fm.name ?? ''}" must match /^[a-z0-9-]{1,64}$/`);
    const desc = fm.description ?? '';
    if (desc.length <= 20) violations.push(`${entry}: description is required and must be longer than 20 chars (got ${desc.length})`);
    if (desc.length > 1024) violations.push(`${entry}: Agent Skills caps description at 1024 chars (got ${desc.length})`);
    for (const key of Object.keys(fm)) {
      if (!PORTABLE_KEYS.has(key)) violations.push(`${entry}: frontmatter key "${key}" is not portable across loaders`);
    }
  }

  for (const file of a) {
    const path = posix.join(skillDir(ROOTS[0], skill), file);
    if (gitIgnores(path)) {
      violations.push(
        `${path}: git ignores it — extend .gitignore's recursive whitelist for "${skill}" ` +
        `(!.agents/skills/${skill}/ then !.agents/skills/${skill}/**)`
      );
    }
    if (file.startsWith('references/') && file.endsWith('.md')) {
      const text = lf(readFileSync(path, 'utf8'));
      if (text.startsWith('---\n')) {
        violations.push(`${skill}/${file}: has a frontmatter block — references/ are plain markdown, not loadable skill entries`);
      }
    }
  }
}

// ---- Every skill that exists in either root must be shared or explicitly
// single-root; an unlisted one would drift unchecked, or hide from the other
// agent.
const agentsSkills = dirNames(ROOTS[0]);
const claudeSkills = dirNames(ROOTS[1]);

for (const name of CLAUDE_ONLY_SKILLS) {
  if (agentsSkills.includes(name)) violations.push(`${skillDir(ROOTS[0], name)}: "${name}" is in CLAUDE_ONLY_SKILLS but also exists under ${ROOTS[0]} — remove it from the allowlist`);
  if (!claudeSkills.includes(name)) violations.push(`${skillDir(ROOTS[1], name)}: "${name}" is in CLAUDE_ONLY_SKILLS but is missing from ${ROOTS[1]}`);
}
for (const name of CODEX_ONLY_SKILLS) {
  if (claudeSkills.includes(name)) violations.push(`${skillDir(ROOTS[1], name)}: "${name}" is in CODEX_ONLY_SKILLS but also exists under ${ROOTS[1]} — remove it from the allowlist`);
  if (!agentsSkills.includes(name)) violations.push(`${skillDir(ROOTS[0], name)}: "${name}" is in CODEX_ONLY_SKILLS but is missing from ${ROOTS[0]}`);
}

const allowlisted = new Set([...CLAUDE_ONLY_SKILLS, ...CODEX_ONLY_SKILLS]);
const shared = new Set(SHARED_SKILLS);
for (const name of [...new Set([...agentsSkills, ...claudeSkills])].sort()) {
  if (allowlisted.has(name) || shared.has(name)) continue;
  const where = ROOTS.filter((root) => existsSync(skillDir(root, name))).join(' and ');
  violations.push(
    `${where}/${name}: skill is neither in SHARED_SKILLS nor an explicit single-root allowlist ` +
    `(CLAUDE_ONLY_SKILLS / CODEX_ONLY_SKILLS) — it would drift unchecked, or hide from the other agent`
  );
}

// ---- Both entry files must point at every shared skill.
const entryFiles = [
  ['AGENTS.md', 'Codex entry'],
  ['CLAUDE.md', 'Claude entry'],
];
for (const [file, role] of entryFiles) {
  let text;
  try {
    text = lf(readFileSync(file, 'utf8'));
  } catch {
    violations.push(`${file}: ${role} file is missing`);
    continue;
  }
  for (const skill of SHARED_SKILLS) {
    if (!text.includes(`\`${skill}\``)) violations.push(`${file}: ${role} must name \`${skill}\``);
  }
}

if (violations.length > 0) {
  console.error('Shared skill parity violations (.agents/skills and .claude/skills must carry identical twins of every shared skill):');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('skill parity OK');
