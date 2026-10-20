import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import { HERO_BOARD_SLOTS } from '../../data/heroes';
import { bagAsBoardPieces, canPlace } from '../loadout';
import type { RunState, RunCard, RunBoardPiece } from '../runState';
import type { CardSource, CardDestination, DeckIntent } from './types';

export function cardAt(state: RunState, source: CardSource): RunCard | RunBoardPiece {
  const card = source.kind === 'board' ? state.pieces.find(card => card.instanceId === source.instanceId)
    : source.kind === 'bag' ? state.bagSlots.find(card => card?.instanceId === source.instanceId)
      : state.held?.instanceId === source.instanceId ? state.held : null;
  if (!card) throw new Error('Card is not owned at this source');
  return card;
}
function at(state: RunState, source: CardSource): CardDestination {
  const card = cardAt(state, source);
  if (source.kind === 'held') return { kind: 'held' };
  return { kind: source.kind, slot: source.kind === 'board' ? (card as RunBoardPiece).slot : state.bagSlots.findIndex(value => value?.instanceId === source.instanceId) };
}
function remove(state: RunState, source: CardSource): void {
  if (source.kind === 'board') state.pieces = state.pieces.filter(card => card.instanceId !== source.instanceId);
  else if (source.kind === 'bag') state.bagSlots = state.bagSlots.map(card => card?.instanceId === source.instanceId ? null : card);
  else state.held = null;
}
function put(state: RunState, card: RunCard | RunBoardPiece, destination: CardDestination): void {
  if (destination.kind === 'held' && state.held) throw new Error('Holding is occupied');
  if (destination.kind !== 'held') {
    const pieces = destination.kind === 'board' ? state.pieces : bagAsBoardPieces(state.bagSlots);
    if (!Number.isSafeInteger(destination.slot) || !canPlace(pieces, skillBook, card.skillId, destination.slot, HERO_BOARD_SLOTS)) throw new Error('Destination is occupied or outside the board');
  }
  const plain: RunCard = { instanceId: card.instanceId, skillId: card.skillId, tier: card.tier, ...(card.points === undefined ? {} : { points: card.points }) };
  if (destination.kind === 'board') state.pieces.push({ ...plain, slot: destination.slot, ...('gem' in card && card.gem ? { gem: card.gem } : {}) });
  else {
    if ('gem' in card && card.gem) state.gemInventory.push(card.gem.id);
    if (destination.kind === 'bag') state.bagSlots[destination.slot] = plain;
    else state.held = plain;
  }
}
export function inventoryFingerprint(state: RunState): string {
  const cards = [...state.pieces, ...state.bagSlots.filter((card): card is RunCard => !!card), ...(state.held ? [state.held] : [])];
  if (new Set(cards.map(card => card.instanceId)).size !== cards.length) throw new Error('Duplicate owned card');
  return JSON.stringify({ cards: cards.map(card => [card.instanceId, card.skillId, card.tier, card.points ?? 0]).sort(), gems: [...state.gemInventory, ...state.pieces.flatMap(piece => piece.gem ? [piece.gem.id] : [])].sort() });
}
export function applyDeckIntent(state: RunState, intent: DeckIntent): RunState {
  if (state.status !== 'active') throw new Error('Deck changes require an active run');
  const before = inventoryFingerprint(state);
  const next: RunState = { ...state, pieces: state.pieces.map(card => ({ ...card })), bagSlots: [...state.bagSlots], gemInventory: [...state.gemInventory] };
  if (intent.kind === 'moveCard') {
    const card = cardAt(next, intent.source); remove(next, intent.source); put(next, card, intent.destination);
  } else if (intent.kind === 'swapCards') {
    if (intent.source.instanceId === intent.other.instanceId) throw new Error('Cannot swap the same card');
    const first = cardAt(next, intent.source), second = cardAt(next, intent.other);
    const firstAt = at(next, intent.source), secondAt = at(next, intent.other);
    remove(next, intent.source); remove(next, intent.other); put(next, first, secondAt); put(next, second, firstAt);
  } else {
    const piece = next.pieces.find(piece => piece.instanceId === intent.instanceId);
    if (!piece) throw new Error('Only a board card has a socket');
    if (intent.kind === 'detachGem') {
      if (!piece.gem) throw new Error('Socket is empty');
      next.gemInventory.push(piece.gem.id); delete piece.gem;
    } else {
      const id = next.gemInventory[intent.pouchIndex];
      if (id === undefined || !gemBook[id]) throw new Error('Gem is not owned');
      next.gemInventory.splice(intent.pouchIndex, 1);
      if (piece.gem) next.gemInventory.push(piece.gem.id);
      piece.gem = structuredClone(gemBook[id]);
    }
  }
  if (inventoryFingerprint(next) !== before) throw new Error('Inventory conservation failed');
  next.pieces.sort((a, b) => a.slot - b.slot);
  return next;
}
