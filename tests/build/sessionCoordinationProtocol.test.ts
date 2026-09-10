import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const PROTOCOL = 'docs/coordination/session-orchestration.md';
const BOARD = '.superpowers/sdd/ACTIVE-WORK.md';
const SKILLS = [
  '.agents/skills/world1-handoff/SKILL.md',
  '.claude/skills/world1-handoff/SKILL.md',
] as const;

const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('cross-session orchestration protocol', () => {
  it('keeps a durable protocol and a machine-local live board', () => {
    expect(existsSync(PROTOCOL), `${PROTOCOL} is missing`).toBe(true);
    expect(existsSync(BOARD), `${BOARD} is missing`).toBe(true);
  });

  it('requires ownership, heartbeat, evidence, dependencies, and a next action', () => {
    const protocol = read(PROTOCOL);
    for (const field of ['Task ID', 'Session / agent', 'Status', 'Heartbeat', 'File claims', 'Dependencies', 'Latest evidence', 'Next action']) {
      expect(protocol, `coordination protocol must define ${field}`).toContain(field);
    }
    for (const status of ['ACTIVE', 'READY_FOR_REVIEW', 'CHANGES_REQUESTED', 'AWAITING_USER', 'BLOCKED', 'UNCLAIMED', 'CONFLICT']) {
      expect(protocol, `coordination protocol must define ${status}`).toContain(`\`${status}\``);
    }
  });

  it('makes the live board mandatory from both shared handoff skills', () => {
    for (const skill of SKILLS) {
      const text = read(skill);
      expect(text, `${skill} must point to the durable protocol`).toContain(PROTOCOL);
      expect(text, `${skill} must point to the live board`).toContain(BOARD);
      expect(text, `${skill} must reject overlapping active file claims`).toContain('CONFLICT');
    }
  });

  it('keeps the durable protocol discoverable from the owner index', () => {
    expect(read('docs/INDEX.md')).toContain('[`coordination/session-orchestration.md`]');
  });
});
