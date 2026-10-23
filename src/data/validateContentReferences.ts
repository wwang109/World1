import type { ContentProblem } from './validateSkillContent';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function entries(document: unknown, key: string): Record<string, unknown>[] {
  if (!object(document) || !Array.isArray(document[key])) return [];
  return document[key].filter(object);
}
function versions(entry: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(entry.versions) ? entry.versions.filter(object) : [];
}
function canonical(value: unknown): string {
  const ordered = (input: unknown): unknown => Array.isArray(input) ? input.map(ordered)
    : object(input) ? Object.fromEntries(Object.keys(input).sort().map(key => [key, ordered(input[key])])) : input;
  return JSON.stringify(ordered(value));
}

/** Catalog-dependent checks run only after the individual document schemas. */
export function validateContentReferences(documents: {
  skills: unknown; gems: unknown; enemies: unknown; modifiers: unknown;
}): ContentProblem[] {
  const problems: ContentProblem[] = [];
  const skillIds = new Set(entries(documents.skills, 'cards').map(card => card.id));
  const gemPayloads = new Map<unknown, Set<string>>();
  for (const entry of entries(documents.gems, 'gems')) {
    const payloads = new Set<string>();
    for (const version of versions(entry)) {
      if (!object(version.def)) continue;
      const { notes: _notes, name, ...payload } = version.def;
      payloads.add(canonical({ id: entry.id, ...payload }));
      payloads.add(canonical({ id: entry.id, name, ...payload }));
    }
    gemPayloads.set(entry.id, payloads);
  }
  const cardReference = (id: unknown, where: string): void => {
    if (typeof id === 'string' && !skillIds.has(id)) problems.push({ where, message: `unknown skill id "${id}"; references must resolve in the candidate skill catalog` });
  };
  for (const entry of entries(documents.modifiers, 'modifiers')) for (const version of versions(entry)) {
    if (!object(version.def) || !Array.isArray(version.def.cards)) continue;
    version.def.cards.forEach((id, index) => cardReference(id, `modifiers.${String(entry.id)}@v${String(version.version)}.cards[${index}]`));
  }
  for (const entry of entries(documents.enemies, 'enemies')) for (const version of versions(entry)) {
    if (!object(version.def)) continue;
    const where = `enemies.${String(entry.id)}@v${String(version.version)}`;
    if (Array.isArray(version.def.pieces)) version.def.pieces.forEach((piece, index) => {
      if (!object(piece)) return;
      const at = `${where}.pieces[${index}]`;
      cardReference(piece.skillId, `${at}.skillId`);
      if (!object(piece.gem)) return;
      const payloads = gemPayloads.get(piece.gem.id);
      if (!payloads) problems.push({ where: `${at}.gem`, message: `unknown gem id "${String(piece.gem.id)}"; inline gems must resolve in the candidate gem catalog` });
      else if (!payloads.has(canonical(piece.gem))) problems.push({ where: `${at}.gem`, message: `inline gem payload does not match a retained canonical definition of "${String(piece.gem.id)}"; author supported mechanics in gems.v1.json before wiring them to an enemy` });
    });
    if (Array.isArray(version.def.growth)) version.def.growth.forEach((milestone, index) => {
      if (!object(milestone) || !Array.isArray(milestone.candidates)) return;
      milestone.candidates.forEach((candidate, candidateIndex) => {
        if (object(candidate)) cardReference(candidate.skillId, `${where}.growth[${index}].candidates[${candidateIndex}].skillId`);
      });
    });
  }
  return problems;
}
