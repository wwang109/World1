import { boardAffinities } from '../engine/combat/typeIdentity';
import type { EventDefV2, EventRequirementV2 } from '../data/eventContentV2';
import { skillBook } from '../data/skills';
import { biomeFor } from './biome';
// `eventEligible` below is a test-only mirror of the LIVE selection gate in
// `rollEventForNode`/`firstEligibleConditionalEvent` (events.ts). It has no
// production caller, but a duplicate lottery is exactly the drift bug class
// this repo has been bitten by before (see `featheredCairn.test.ts`), so it
// delegates to the one real rarity gate instead of re-deriving its own.
// Imported from `eventOpportunityHint` (not `events`) so this stays a leaf:
// `events.ts` itself imports `eventRequirementMet` FROM this module, and an
// import of the events module here would close that into a two-file cycle.
import { eventRarityEligible } from './eventOpportunityHint';
import type { RunCard, RunNode, RunState } from './runState';

export interface EventEligibilityContext {
  state: RunState;
  node: RunNode;
  event: EventDefV2;
}

function ownedCards(state: RunState, where: Extract<EventRequirementV2, { fact: 'owned.card.count' }>['args']['where']) {
  if (where === 'board') return state.pieces;
  const bagCards = state.bagSlots.filter((card): card is Exclude<typeof card, null> => card != null);
  if (where === 'bag') return bagCards;
  if (where === 'held') return state.held ? [state.held] : [];
  return [...state.pieces, ...bagCards, ...(state.held ? [state.held] : [])];
}

/** Keep the first owned location for each stable card instance. A card cannot
 * become extra ownership merely by appearing in two run containers. */
function uniqueOwnedCards(cards: readonly RunCard[]): readonly RunCard[] {
  const instanceIds = new Set<string>();
  return cards.filter((card) => {
    if (instanceIds.has(card.instanceId)) return false;
    instanceIds.add(card.instanceId);
    return true;
  });
}

function mostRecentDrawDepth(state: RunState, eventId: string): number | undefined {
  let mostRecent: number | undefined;
  for (const instance of Object.values(state.eventInstances)) {
    if (instance.eventId !== eventId) continue;
    if (mostRecent === undefined || instance.drawnDepth > mostRecent) mostRecent = instance.drawnDepth;
  }
  return mostRecent;
}

export function eventRequirementMet(context: EventEligibilityContext, requirement: EventRequirementV2): boolean {
  if ('all' in requirement) return requirement.all.every((child) => eventRequirementMet(context, child));
  if ('any' in requirement) return requirement.any.some((child) => eventRequirementMet(context, child));
  if ('not' in requirement) return !eventRequirementMet(context, requirement.not);

  if (requirement.fact === 'biome.current') {
    return requirement.args.ids.includes(biomeFor(context.state.map.seed, context.node.wave, context.node.biomeId).id);
  }
  if (requirement.fact === 'board.affinity') {
    // Same fix as `eventRequirementMetV3`'s `board.affinity` case
    // (eventEligibilityV3.ts): check BOTH axes, not the element-first
    // collapse — a board can hold an element affinity AND a weapon affinity
    // at once, and this schema-v2 fact is a gate, not a display label.
    const affinities = boardAffinities(
      context.state.pieces.flatMap((piece) => {
        const skill = skillBook[piece.skillId];
        return skill ? [skill] : [];
      }),
    );
    return affinities.element === requirement.args.affinityId || affinities.weapon === requirement.args.affinityId;
  }
  if (requirement.fact === 'owned.card.count') {
    let matches = 0;
    for (const card of uniqueOwnedCards(ownedCards(context.state, requirement.args.where))) {
      const skill = skillBook[card.skillId];
      if (skill && requirement.args.match.weapons.includes(skill.weapon as typeof requirement.args.match.weapons[number])) {
        matches += 1;
      }
    }
    return matches >= requirement.args.count;
  }
  return context.state.eventCallbackQueue.some((entry) => entry.callbackId === requirement.args.callbackId);
}

export function eventEligible(context: EventEligibilityContext): boolean {
  const { state, node, event } = context;
  const biome = biomeFor(state.map.seed, node.wave, node.biomeId);
  if (event.biomeIds !== undefined && !event.biomeIds.includes(biome.id)) return false;

  if (!eventRarityEligible(event, node)) return false;

  const lastDrawnDepth = mostRecentDrawDepth(state, event.id);
  if (event.once === 'run' && lastDrawnDepth !== undefined) return false;
  if (event.once === 'node' && state.eventInstances[node.id]?.eventId === event.id) return false;
  if (event.cooldownNodes > 0 && lastDrawnDepth !== undefined && node.depth <= lastDrawnDepth + event.cooldownNodes) return false;

  return eventRequirementMet(context, event.eligibility);
}
