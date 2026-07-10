import type { EnchantBook, EnchantDef } from '../engine/types';
import defs from './enchants.json';

// Enchant data lives in enchants.json; this wrapper types it and indexes by
// id. Enchants attach to a PLACED card (per board piece, via the Card Library
// page) and are sidegrades by design: they trade target QUALITY or tempo for
// raw power instead of adding PL. High-aggro targeting is the engine default,
// so it needs no enchant; taunt/lure cards will manipulate aggro itself later.
export const enchantBook: EnchantBook = Object.fromEntries(
  (defs as EnchantDef[]).map((e) => [e.id, e]),
);
