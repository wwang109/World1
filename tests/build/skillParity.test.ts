/**
 * Two AI agents work in this checkout, often at the same time. OpenAI Codex
 * CLI loads skills from `.agents/skills/`; Claude Code loads them from
 * `.claude/skills/`. Neither reads the other's directory — verified
 * 2026-09-05, when Claude Code did not list `world1-game-review`, which then
 * lived only under `.agents/`. A skill BOTH agents must follow therefore has
 * to exist twice, and two hand-maintained copies drift: the same class of bug
 * this project already closed for log renderers (`fmtDamage`) and generated
 * content (`*.v1.json` idempotency). This test makes that drift a red gate.
 *
 * Line endings are normalised before comparison on purpose: this is a Windows
 * checkout with `core.autocrlf=true` and `.gitattributes` does not pin these
 * files, so a CRLF working copy is a checkout artifact, not a content change.
 *
 * The `.gitignore` check asks git itself (`git check-ignore`) rather than
 * grepping for the whitelist lines: `.agents/` is ignored wholesale except for
 * whitelisted skills, and a later pattern can silently re-ignore a twin that
 * the lines alone would still "prove" tracked.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Skills every agent must see. Add here when you add a twin. */
const SHARED_SKILLS = ['world1-handoff', 'world1-game-review'] as const;

/** Vendor-neutral root (Codex, `npx skills`) and the Claude Code root. */
const ROOTS = ['.agents/skills', '.claude/skills'] as const;

/**
 * Frontmatter keys the Agent Skills spec defines. Claude-only keys
 * (`argument-hint`, `user-invocable`, `model`, `context`, `agent`, `hooks`,
 * `paths`, `disable-model-invocation`) stay out of SHARED skills so the same
 * bytes mean the same thing to every loader.
 */
const PORTABLE_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

const lf = (text: string): string => text.replace(/\r\n/g, '\n');

/**
 * Minimal frontmatter reader: `key: value` lines plus folded (`>`) and
 * literal (`|`) block scalars, which long descriptions legitimately use.
 * Anything fancier is deliberately unsupported — a shared skill's frontmatter
 * must stay simple enough for every loader to agree on it.
 */
function frontmatter(text: string): Record<string, string> {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(lf(text));
  if (!m) throw new Error('no frontmatter block');
  const lines = m[1]!.split('\n');
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    let value = kv[2]!.trim();
    if (value === '' || /^[>|][+-]?$/.test(value)) {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) parts.push(lines[++i]!.trim());
      value = parts.join(value.startsWith('|') ? '\n' : ' ');
    }
    out[kv[1]!] = value;
  }
  return out;
}

/** Ask git whether a path is ignored, pattern order and later re-ignores included. */
function gitIgnores(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' });
    return true; // exit 0: ignored
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false; // exit 1: not ignored
    throw err; // 128: git itself failed
  }
}

const skillFile = (root: string, skill: string): string => join(root, skill, 'SKILL.md');

describe('shared agent skills', () => {
  for (const skill of SHARED_SKILLS) {
    describe(skill, () => {
      it('exists under both skill roots', () => {
        for (const root of ROOTS) {
          expect(existsSync(skillFile(root, skill)), `${skillFile(root, skill)} is missing`).toBe(true);
        }
      });

      it('is identical in both roots (modulo line endings)', () => {
        const [a, b] = ROOTS.map((root) => lf(readFileSync(skillFile(root, skill), 'utf8')));
        expect(a, `${skill}: the two SKILL.md copies differ — copy one over the other`).toBe(b);
      });

      it('carries frontmatter every loader accepts', () => {
        const raw = readFileSync(skillFile(ROOTS[0], skill), 'utf8');
        expect(raw.charCodeAt(0), 'a UTF-8 BOM breaks frontmatter detection').not.toBe(0xfeff);
        const fm = frontmatter(raw);
        expect(fm.name, 'name must equal the directory name').toBe(skill);
        expect(fm.name).toMatch(/^[a-z0-9-]{1,64}$/);
        expect((fm.description ?? '').length, 'description is required').toBeGreaterThan(20);
        expect((fm.description ?? '').length, 'Agent Skills caps description at 1024 chars').toBeLessThanOrEqual(1024);
        for (const key of Object.keys(fm)) {
          expect(PORTABLE_KEYS.has(key), `frontmatter key "${key}" is not portable across loaders`).toBe(true);
        }
      });

      it('is not gitignored, so the .agents twin stays tracked', () => {
        const twin = skillFile(ROOTS[0], skill);
        expect(
          gitIgnores(twin),
          `git ignores ${twin} — add "!.agents/skills/${skill}/" and "!.agents/skills/${skill}/SKILL.md" to .gitignore`,
        ).toBe(false);
      });
    });
  }

  it('declares every skill that exists in both roots as shared', () => {
    const inBoth = readdirSync(ROOTS[1], { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(skillFile(ROOTS[0], d.name)))
      .map((d) => d.name)
      .sort();
    expect(inBoth, 'a twin exists that SHARED_SKILLS does not list — it would drift unchecked').toEqual([...SHARED_SKILLS].sort());
  });

  it('is pointed at from both entry files', () => {
    expect(lf(readFileSync('AGENTS.md', 'utf8')), 'AGENTS.md (Codex entry) must name `world1-handoff`').toContain('`world1-handoff`');
    expect(lf(readFileSync('CLAUDE.md', 'utf8')), 'CLAUDE.md (Claude entry) must name `world1-handoff`').toContain('`world1-handoff`');
  });
});

/** The reader is part of the gate, so its edge cases are pinned here. */
describe('frontmatter reader', () => {
  it('reads plain, folded and literal scalars', () => {
    const fm = frontmatter('---\nname: x\ndescription: >\n  first part\n  second part\nnotes: |\n  line a\n  line b\n---\nbody\n');
    expect(fm).toEqual({ name: 'x', description: 'first part second part', notes: 'line a\nline b' });
  });

  it('accepts keys with digits and underscores', () => {
    expect(frontmatter('---\nname: x\nmodel_2: opus\nv1: yes\n---\n')).toEqual({ name: 'x', model_2: 'opus', v1: 'yes' });
  });

  it('stops at the closing rule and ignores a --- inside the body', () => {
    expect(frontmatter('---\nname: x\n---\nintro\n---\nname: y\n')).toEqual({ name: 'x' });
  });

  it('reads CRLF files and files that end at the closing rule', () => {
    expect(frontmatter('---\r\nname: x\r\n---\r\nbody\r\n')).toEqual({ name: 'x' });
    expect(frontmatter('---\nname: x\n---')).toEqual({ name: 'x' });
  });

  it('tolerates trailing whitespace on either rule, as common loaders do', () => {
    expect(frontmatter('--- \nname: x\n---\t\nbody\n')).toEqual({ name: 'x' });
  });

  it('rejects a file with no frontmatter block or no closing rule', () => {
    expect(() => frontmatter('# just markdown\n')).toThrow('no frontmatter block');
    expect(() => frontmatter('---\nname: x\nbody with no closing rule\n')).toThrow('no frontmatter block');
    expect(() => frontmatter('----\nname: x\n---\n')).toThrow('no frontmatter block');
  });
});
