import type { EnemyDef } from '../engine/types';

// Demo enemy presets, authored at a Bronze / lowest-level FLOOR: every card
// here is Bronze, every board is small (2-3 cards, no gems, no tier
// overrides). Tier/board/HP difficulty (bigger boards, tier-ups, HP/stat
// scaling) is a run-layer SCALING concern, applied later by depth/level — it
// is deliberately NOT baked into these depth-1 definitions. See
// docs/enemy-design.md for the full rule. Do NOT retune these numbers
// against simulated fight outcomes — the fight result is emergent and
// depends on the player's own build; that's intended.
//
// UNIFIED STAT SYSTEM (locked 2026-07-24): every enemy's floor `stats` is now
// the SAME universal Level-1 statline the hero starts from (maxHp 100, atk 1,
// magicPower 1, armor 1, magicResist 1, speed 10) — there is no bespoke floor
// identity any more. A monster's combat identity instead lives entirely in
// its cards, its `MONSTER_PROFILES` weight profile (how it spends level-up
// PL — see `src/run/leveling.ts`), and its Title. Do NOT hand-tune floor
// stats per monster; add/adjust its profile weights instead.
//
// `isElite`/`isBoss` are identity/encounter-role tags (used by the run layer
// to place the monster), not stat multipliers — an elite or boss at the
// floor still has a small 2-3 card board and the universal statline; its
// intended extra difficulty comes from Title + depth-scaling, not from
// hand-inflated numbers here.
export const enemies: Record<string, EnemyDef> = {
  // --- Basic floor: 2-3 Bronze cards, one mechanic each. ---
  // THIEF read (2026-08-18 theme pass): the roster's fastest, lightest board
  // — 2 cards, no size-2/3 card, no defensive investment — wins by chip
  // damage (a bite plus a poison tick) rather than one big hit. Cards
  // unchanged; this is a naming/reporting pass, not a re-kit.
  giant_rat: {
    id: 'giant_rat',
    name: 'Giant Rat',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'beast',
    boardSize: 2,
    pieces: [
      { skillId: 'savage_bite', slot: 0 },
      { skillId: 'venom_fang', slot: 1 },
    ],
    goldReward: 12,
    xpReward: 8,
  },
  // WARDEN re-theme (2026-08-18): dropped `weaponAffinity: 'beast'` — Iron
  // Bulwark, its shield, is a `weapon: 'sword'` card, so the old dual
  // affinity claimed a weapon identity its own board never showed (an
  // authored affinity that the board contradicts is exactly the legibility
  // bug this pass is closing). Nature is a flavour/matchup identity ON THE
  // CREATURE ITSELF (its shell), not a claim that its cards are nature-typed
  // — the same convention every caster on the roster (Ember Imp, Seraph,
  // Mage, Necromancer, Cleric) already uses, just without a weapon leg. No
  // pieces changed: still the roster's armored tank (shield + a bite), now
  // read as a Warden rather than a mislabeled Beast-weapon user.
  stone_beetle: {
    id: 'stone_beetle',
    name: 'Stone Beetle',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'nature',
    boardSize: 3,
    pieces: [
      { skillId: 'iron_bulwark', slot: 0 },
      { skillId: 'savage_bite', slot: 2 },
    ],
    goldReward: 15,
    xpReward: 10,
  },
  // DoT-forward re-kit (2026-08-18): every card on this board applies burn
  // alongside modest direct damage — no pure-damage filler at all (the old
  // `arcane_bolt`, a mismatched Lightning hit, is dropped). Over a fight the
  // majority of Ember Imp's total damage comes from burn ticks, not direct
  // hits, which is the deliberate "bad matchup" thorns never had before
  // (thorns only fires on a landed direct hit, never a DoT tick) and the
  // real target Ward's affliction-prevention was missing.
  ember_imp: {
    id: 'ember_imp',
    name: 'Ember Imp',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'fire',
    boardSize: 4,
    pieces: [
      { skillId: 'fireball', slot: 0 },
      { skillId: 'cinder_dart', slot: 2 },
      { skillId: 'ember_lash', slot: 3 },
    ],
    goldReward: 18,
    xpReward: 12,
  },

  // --- Elite floor: a balanced human sword-duelist, hero-baseline statline,
  // 2-card basic board (its "elite" encounter role is a run-layer concern). ---
  // Adds Bramble Ward (thorns + a small physical shield) — a duelist who
  // parries as well as swings, and the roster's 3rd shielded enemy (up from
  // 2), widening the `shieldBreak` / bleed-through-shield target set.
  bandit_duelist: {
    id: 'bandit_duelist',
    name: 'Bandit Duelist',
    baseDepth: 1,
    isElite: true,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'sword',
    boardSize: 3,
    pieces: [
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'follow_through', slot: 1 },
      { skillId: 'bramble_ward', slot: 2 },
    ],
    goldReward: 30,
    xpReward: 20,
  },

  // --- Boss floor: a beast, modestly tougher than the basics but not a
  // wall — a bow counter-pick is the intended way in via the weapon
  // triangle. Its "boss" difficulty is future depth-scaling, not baked in
  // here. ---
  wolf_king: {
    id: 'wolf_king',
    name: 'The Wolf King',
    baseDepth: 1,
    isBoss: true,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'beast',
    boardSize: 3,
    pieces: [
      { skillId: 'savage_bite', slot: 0 },
      { skillId: 'venom_fang', slot: 1 },
      { skillId: 'leeching_fang', slot: 2 },
    ],
    goldReward: 60,
    xpReward: 40,
  },

  // --- Signature monster roster: fixed decks, no theme/faction system, each
  // its own recognizable combat identity at the Bronze floor (small 2-3 card
  // board, all Bronze cards, modest default statline). ---
  // Adds Ward of Silence — the roster's only `negate` card (1 magical
  // charge). This is the sole source of `negate` in the whole roster: it
  // makes the multi-hit premium's justification ("negate cancels one hit
  // per charge") real for magical multi-instance casts, and gives the
  // player's magical single-hit spells a genuine denial to play around,
  // exactly the way the player's own Ward of Silence would.
  seraph: {
    id: 'seraph',
    name: 'Seraph',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'holy',
    boardSize: 4,
    pieces: [
      { skillId: 'mending_light', slot: 0 },
      { skillId: 'judgment_light', slot: 2 },
      { skillId: 'ward_of_silence', slot: 3 },
    ],
    goldReward: 20,
    xpReward: 13,
  },
  // WARDEN (2026-08-18): swaps Iron Bulwark for Iron Riposte — the roster's
  // only PHYSICAL `negate` (Ward of Silence is the sole magical one),
  // deliberately placed here rather than on whichever board "happened to
  // have room": Knight is the roster's one dedicated shield-and-block
  // identity, so a second denial tool belongs on it. This is a SWAP, not an
  // addition — `pieces.length` stays 3 (unlike an add, which would push the
  // roster's worst-case deck size past 3 and silently move
  // `REFERENCE_ENEMY_DECK_SIZE`, a run-layer pack-budget constant, out from
  // under gameplay-programmer). Iron Bulwark's passive shield is replaced by
  // a HARDER defensive tool (a parry that denies a hit outright, then
  // counters); War Banner (aura) and Sword Slash (its own swing) are
  // untouched. Iron Bulwark's shielded-enemy slot moves to Berserker (below)
  // to keep the roster's 4 shielded enemies whole.
  knight: {
    id: 'knight',
    name: 'Knight',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'sword',
    boardSize: 3,
    pieces: [
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'iron_riposte', slot: 1 },
      { skillId: 'war_banner', slot: 2 },
    ],
    goldReward: 22,
    xpReward: 15,
  },
  // LIGHTNING re-theme (2026-08-18): declared `elementAffinity: 'fire'` while
  // its board carried Fireball (fire) AND Arcane Bolt (lightning) — a
  // straight affinity/card contradiction, and a redundant one, since Ember
  // Imp already owns "fire" as a roster identity (the DoT-forward imp).
  // Swapped Fireball for Static Jolt (also lightning) so BOTH cards on the
  // board agree with the declared affinity: Mage is now the roster's pure
  // arcane blaster (no rider, no DoT, no debuff — a flat MATK glass cannon),
  // cleanly distinct from Ember Imp (fire/burn) and Necromancer (dark/curse).
  mage: {
    id: 'mage',
    name: 'Mage',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'lightning',
    boardSize: 2,
    pieces: [
      { skillId: 'static_jolt', slot: 0 },
      { skillId: 'arcane_bolt', slot: 1 },
    ],
    goldReward: 19,
    xpReward: 13,
  },
  // Adds Piercing Arrow — a bow card carrying `expose` (+damage from all
  // direct hits), rounding Hunter out into a marksman who softens armor
  // ahead of its follow-up shots.
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'bow',
    boardSize: 3,
    pieces: [
      { skillId: 'hunter_shot', slot: 0 },
      { skillId: 'concussive_shot', slot: 1 },
      { skillId: 'piercing_arrow', slot: 2 },
    ],
    goldReward: 17,
    xpReward: 11,
  },
  // LANCE re-theme (2026-08-18), renamed Rogue -> Lancer: declared
  // `weaponAffinity: 'beast'` while 2 of its 3 cards (Crippling Strike,
  // Hamstring) were already `weapon: 'lance'` — a majority-vs-declared
  // affinity contradiction, and the roster had ZERO lance-identity enemy to
  // show for it (sword x2, axe x1, bow x1, beast x3, lance x0 among the
  // physical fighters). Swapped the one beast card (Venom Fang) for Lance
  // Thrust so all three cards agree, and fixed the declared affinity to
  // match. Reads as reach-and-thrust: Lance Thrust closes distance, Crippling
  // Strike cripples the follow-up, Hamstring holds the enemy at bay with
  // `slow` — the id stays `rogue` (referenced by MONSTER_PROFILES/save data),
  // only the display name and kit change.
  rogue: {
    id: 'rogue',
    name: 'Lancer',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'lance',
    boardSize: 4,
    pieces: [
      { skillId: 'lance_thrust', slot: 0 },
      { skillId: 'crippling_strike', slot: 1 },
      { skillId: 'hamstring', slot: 3 },
    ],
    goldReward: 20,
    xpReward: 13,
  },
  // BRUTE (2026-08-18): Battle Howl (a redundant self-buff) was already
  // swapped for Stunning Smash — a pure `stun`, a full turn spent stunning
  // instead of attacking, no free lunch. Adds Iron Maiden (thorns + a
  // physical shield) as a 3rd piece — thick hide that punishes whoever hits
  // it, reinforcing "heavy, slow, hits hard" rather than diluting it (Iron
  // Maiden is itself a size-2, naturally-heavy card; zero speed-weighted
  // profile spend, see MONSTER_PROFILES) — and picks up the roster's 4th
  // shielded enemy, the slot Knight's Iron Bulwark vacated above.
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'axe',
    boardSize: 6,
    pieces: [
      { skillId: 'crushing_blow', slot: 0 },
      { skillId: 'iron_maiden', slot: 3 },
      { skillId: 'stunning_smash', slot: 5 },
    ],
    goldReward: 24,
    xpReward: 16,
  },
  necromancer: {
    id: 'necromancer',
    name: 'Necromancer',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'dark',
    boardSize: 2,
    pieces: [
      { skillId: 'hex_of_frailty', slot: 0 },
      { skillId: 'shadow_bolt', slot: 1 },
    ],
    goldReward: 20,
    xpReward: 13,
  },
  // Second Wind (a second, redundant heal alongside Mending Light) swapped
  // for Sanctified Bulwark — `guard` + a small magical shield, the roster's
  // 4th shielded enemy (up from 2) and its only `guard` source. Cleric keeps
  // its Mending Light heal, so the healing archetype identity is unchanged.
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'holy',
    boardSize: 4,
    pieces: [
      { skillId: 'mending_light', slot: 0 },
      { skillId: 'sanctified_bulwark', slot: 2 },
      { skillId: 'purging_strike', slot: 3 },
    ],
    goldReward: 18,
    xpReward: 12,
  },
};
