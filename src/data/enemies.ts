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
//
// LEGACY ROSTER REFRESH (2026-08-21, content-designer): the pre-2026-08-19
// roster (`giant_rat` through `cleric`) predates that date's ~35-card
// keyword-family/rider batch (ward/thorns/bleed/poison hybrids, heavy stat
// debuffs, the burden+splash family, the dulling_hex/sapping_arc curse pair,
// the 8 rider payoff cards) and had never fielded any of it. This pass
// enhances 8 of the 13 legacy kits with a genuinely-fitting new card each —
// SWAPS on any board already at 3 pieces (the roster-wide worst-case deck
// size, `REFERENCE_ENEMY_DECK_SIZE` in `src/run/encounter.ts` — an ADD there
// would silently raise that pack-budget constant), plain ADDS on the two
// boards still at 2 pieces (`stone_beetle`, `necromancer`) since that only
// brings them up TO the existing worst case, never past it. `giant_rat`,
// `ember_imp`, `seraph`, `knight` and `mage` are DELIBERATELY untouched — see
// their own standing comments: each has an established identity (thief
// minimalism, DoT-forward glass caster, the roster's only negate/support
// caster, block-buff-parry, pure MATK glass cannon) that no unused catalog
// card improves without cannibalizing a documented trait. See each edited
// enemy's own "LEGACY REFRESH" comment below for its specific rationale, and
// docs/enemy-design.md for the goldReward before/after table.
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
  //
  // LEGACY REFRESH (2026-08-21, content-designer): adds Barbed Rampart — a
  // beast bleed+guard+chip hybrid (`weapon: 'beast'`, matching Savage Bite's
  // own leg) that layers a SECOND defensive tool (-20% incoming physical, 2
  // turns) on top of Iron Bulwark's flat shield, and opens the roster's
  // FIRST bleed application on an armored tank — the beetle now punishes a
  // slow grind (bleed ticks on the attacker's own turn) as well as simply
  // absorbing hits. `pieces.length` goes 2 -> 3, still at the roster-wide
  // worst-case deck size (3, see `REFERENCE_ENEMY_DECK_SIZE` in
  // `src/run/encounter.ts`) so the pack-budget model is untouched. Bronze
  // card added at its own audited budget, no hand-tuning; goldReward bumped
  // 15 -> 17 for the added board strength (see docs/enemy-design.md's
  // before/after table).
  stone_beetle: {
    id: 'stone_beetle',
    name: 'Stone Beetle',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'nature',
    boardSize: 4,
    pieces: [
      { skillId: 'iron_bulwark', slot: 0 },
      { skillId: 'savage_bite', slot: 2 },
      { skillId: 'barbed_rampart', slot: 3 },
    ],
    goldReward: 17,
    xpReward: 11,
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
  //
  // LEGACY REFRESH (2026-08-21, content-designer): CONSIDERED AND REJECTED a
  // Sword Slash -> Twin Slash swap (same weapon/size, would have primed
  // Follow Through's own "+20 if previous cast was Offense" bonus every
  // cast). Measured first: Twin Slash's audited Bronze price banks its
  // budget in the `extraHitPremium` (2 hits x 6 base + premium + a lighter
  // weight), not in flat power — its total FLAT base is 12 against Sword
  // Slash's 20, a real (not just armor-mitigation) damage cut the "total
  // stat contribution is hit-count-invariant" rule does NOT offset (ATK is
  // 1 at the floor, so the stat term is negligible either way). Against the
  // default drafted-starter hero board this specific matchup is a genuine
  // knife-edge (the ONLY legacy fight that board loses at all), and the
  // swap flipped it from loss to win on EVERY ONE of 300 sampled seeds — not
  // emergent noise (CLAUDE.md's "PL is the balance unit, not winrate" is
  // about not chasing a winrate on an honestly-priced kit; this is the
  // opposite case, a real flat-damage cut this fight cannot absorb). Left
  // UNCHANGED rather than risk it: no other unused sword card both fits
  // "parries as well as swings" and preserves Sword Slash's flat 20. See
  // docs/enemy-design.md for the measured before/after.
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
  //
  // LEGACY REFRESH (2026-08-21, content-designer): SWAPS Savage Bite for
  // Nettle Lash — same weapon (beast), same size-1 Bronze slot,
  // `pieces.length` untouched (3). The Wolf King already carried poison
  // (Venom Fang) and lifesteal (Leeching Fang); Nettle Lash's Thorns 5 adds a
  // THIRD distinct mechanic — a counter-punch — so the alpha now punishes
  // whoever keeps swinging on it, not just whoever it swings on. Trades a
  // flat 20 (+ATK) hit for a smaller 10 (+ATK) hit plus a standing thorns
  // stack: roughly power-neutral (both Bronze), shifted from all-offense to
  // offense-plus-a-passive-punish — goldReward unchanged (60, the roster's
  // top rung; see docs/enemy-design.md's before/after table).
  wolf_king: {
    id: 'wolf_king',
    name: 'The Wolf King',
    baseDepth: 1,
    isBoss: true,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'beast',
    boardSize: 3,
    pieces: [
      { skillId: 'nettle_lash', slot: 0 },
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
  //
  // LEGACY REFRESH (2026-08-21, content-designer): SWAPS Hunter's Shot for
  // Rapid Volley — same weapon (bow), same size-1 Bronze slot,
  // `pieces.length` untouched (3). Hunter's Shot's "Strong vs Beasts" line
  // was flavor text only (no coded weapon-triangle bonus on the card itself
  // — checked against its resolved effects, a flat `damage` action), so
  // nothing mechanical is lost. Rapid Volley (10 (+ATK) Bow damage, twice)
  // reads as the marksman finally unloading after debilitating its target —
  // Concussive Shot disrupts, Piercing Arrow exposes armor, Rapid Volley
  // perforates it. Multi-hit eats mitigation once per hit, so this is a
  // slightly worse matchup into armor than the flat single shot it replaces
  // — goldReward unchanged (see docs/enemy-design.md's before/after table).
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'bow',
    boardSize: 3,
    pieces: [
      { skillId: 'rapid_volley', slot: 0 },
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
  //
  // LEGACY REFRESH (2026-08-21, content-designer): SWAPS Lance Thrust for
  // Piercing Reach — same weapon (lance), same size-1 Bronze slot,
  // `pieces.length` untouched (3). "Reach and thrust" was previously carried
  // entirely by the NAME (Lance Thrust was a plain hit, no reach mechanic on
  // it); Piercing Reach (`shieldBreak` 16, then 16 (+ATK) Lance damage) makes
  // the reach LITERAL — it cracks a banked shield at range before the thrust
  // ever lands, then Crippling Strike cripples the follow-up and Hamstring's
  // `slow` holds the target at bay. Distinct from Warbreaker (axe,
  // `shieldBreak` as a tempo-denial FOLLOW-UP after a burden) and Bleed
  // Reaver (axe, `shieldBreak` opening a bleed) — Lancer's is the roster's
  // only LANCE `shieldBreak`, and its own opener rather than a combo payoff.
  // Against a shieldless target this is a smaller hit (16 vs 20, +ATK) —
  // goldReward unchanged (see docs/enemy-design.md's before/after table).
  rogue: {
    id: 'rogue',
    name: 'Lancer',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    weaponAffinity: 'lance',
    boardSize: 4,
    pieces: [
      { skillId: 'piercing_reach', slot: 0 },
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
  //
  // LEGACY REFRESH (2026-08-21, content-designer): SWAPS Stunning Smash for
  // Cornered Beast — same weapon (axe), same size-1 Bronze slot,
  // `pieces.length` untouched (3, boardSize unchanged at 6 since both are
  // size-1). "Hits harder when hurt" is the literal berserker mechanic
  // (Deal 14 (+ATK) Axe damage, +12 more at or below half HP) — a much
  // tighter fit for "heavy, slow, hits hard" than a generic stun was, and it
  // reads as the brute's own rage: the LOWER it gets, the HARDER its axe
  // swings, on top of Crushing Blow's flat 96 (+ATK) and Iron Maiden's
  // thorns+shield. Trades the roster's only pure `stun` on this board for a
  // desperation payoff — Berserker no longer denies a turn outright, but
  // punishes anyone who lets the fight run long. goldReward unchanged (see
  // docs/enemy-design.md's before/after table).
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
      { skillId: 'cornered_beast', slot: 5 },
    ],
    goldReward: 24,
    xpReward: 16,
  },
  // LEGACY REFRESH (2026-08-21, content-designer): ADDS Dulling Hex as a 3rd
  // piece — a dark curse+damage hybrid (12 (+MATK) Dark damage, then
  // `Curse`: the enemy's next queued card deals 8 less damage for 2 turns).
  // Necromancer already debuffs (Hex of Frailty's -50% MDEF) and burns
  // (Shadow Bolt); Dulling Hex adds the roster's `curse` mechanic — a THIRD,
  // distinct debuff family — making Necromancer the legacy roster's curse
  // showcase (the "curse pair" the 2026-08-18b card batch introduced,
  // Dulling Hex/Sapping Arc, finally gets a caster home for its dark half).
  // `pieces.length` goes 2 -> 3, still at the roster-wide worst-case deck
  // size (see `stone_beetle`'s note above and `REFERENCE_ENEMY_DECK_SIZE` in
  // `src/run/encounter.ts`). Bronze card added at its own audited budget;
  // goldReward bumped 20 -> 22 for the added board strength (see
  // docs/enemy-design.md's before/after table).
  necromancer: {
    id: 'necromancer',
    name: 'Necromancer',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'dark',
    boardSize: 3,
    pieces: [
      { skillId: 'hex_of_frailty', slot: 0 },
      { skillId: 'shadow_bolt', slot: 1 },
      { skillId: 'dulling_hex', slot: 2 },
    ],
    goldReward: 22,
    xpReward: 15,
  },
  // Second Wind (a second, redundant heal alongside Mending Light) swapped
  // for Sanctified Bulwark — `guard` + a small magical shield, the roster's
  // 4th shielded enemy (up from 2) and its only `guard` source. Cleric keeps
  // its Mending Light heal, so the healing archetype identity is unchanged.
  //
  // LEGACY REFRESH (2026-08-21, content-designer): SWAPS Purging Strike for
  // Penitent Mending — same element (holy), same size-1 Bronze slot,
  // `pieces.length` untouched (3). Purging Strike was a token TRUE-damage
  // finisher on an otherwise all-support board; Penitent Mending
  // (`Cleanse` 2, then heal 4 (+MDEF) Holy, +4 more per affliction stack it
  // actually removed, max +12) is instead the roster's first cleanse card
  // that scales its OWN payoff with what it strips — a genuine "warden-
  // healer" answer to the DoT/debuff families rather than a stray attack.
  // Cleric now has zero direct damage, reading as a pure support/denial
  // caster alongside Sanctified Bulwark's guard+shield and Mending Light's
  // heal — goldReward unchanged (see docs/enemy-design.md's before/after
  // table; the roster still has plenty of other damage-dealing casters).
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
      { skillId: 'penitent_mending', slot: 3 },
    ],
    goldReward: 18,
    xpReward: 12,
  },

  // --- Keyword-family roster expansion (2026-08-19): the catalog grew a
  // batch of new keyword-family cards (ward 3->8, thorns 6->10, bleed 4->7,
  // ward+thorns/shield+thorns hybrids, poison hybrids, the roster's first
  // spread-burden card) with no enemy ever fielding most of them — a depth-1
  // player could draft any of these mechanics and never see them played
  // back. Every board below is real catalog cards only (the "an enemy is
  // just a replicable player build" rule), Bronze floor, small 2-3 piece
  // board, universal statline. goldReward is chosen to seat each one at a
  // deliberate rung of the FIGHT_POOL ladder (`src/run/enemyDepth.ts` derives
  // depth bands from goldReward) rather than clustering the new mechanics
  // all at one difficulty — see the per-monster note for its intended band.
  //
  // TOXIC DRUID: nature magical poisoner. All three pieces are
  // poison+damage/heal hybrids (thorn_bite, blooming_vine, poison_bloom) —
  // no pure-damage filler, same "majority of the fight's damage is a DoT
  // tick, not a direct hit" shape as Ember Imp's fire rework, but poison
  // BYPASSES SHIELDS where Ember Imp's burn does not, and poison_bloom heals
  // the Druid back off its own poison application, giving it real DoT-race
  // sustain. `elementAffinity: 'nature'` makes this the roster's first
  // genuinely nature-CASTING enemy (Stone Beetle's nature tag is flavor only
  // — see that enemy's own comment). goldReward 16 seats it in the
  // WEAKEST/tier-0 band (alongside Giant Rat/Stone Beetle/Hunter/Cleric) —
  // deliberately early, so poison stacking is something a fresh run meets
  // immediately, not something saved for a late-game reveal. Counter-play:
  // Ward denies poison outright (poison IS wardable, unlike stun); cleanse
  // strips an applied stack; racing it down before 3 stacks of poison
  // compound also works since none of its 3 cards hit hard on their own.
  toxic_druid: {
    id: 'toxic_druid',
    name: 'Toxic Druid',
    baseDepth: 1,
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    elementAffinity: 'nature',
    boardSize: 3,
    pieces: [
      { skillId: 'thorn_bite', slot: 0 },
      { skillId: 'poison_bloom', slot: 1 },
      { skillId: 'blooming_vine', slot: 2 },
    ],
    goldReward: 16,
    xpReward: 11,
  },

  // REAVER: the roster's bleed+shieldBreak axe duelist. Gutting Cleave IS
  // the requested combo on one card (shatters the target's shield, THEN its
  // bleed can land — bleed is explicitly blocked by shields, unlike
  // poison); Hemorrhage piles a second bleed stack; Armor Break shreds DEF
  // so the bleed damage-over-time and any follow-up hit both land harder.
  // Reads as "breaks your defenses open, then lets you bleed out" — distinct
  // from Berserker (axe, pure stun-brute) and from Warbreaker below (axe,
  // tempo/board-control rather than a HP-attrition race). goldReward 19
  // seats it in tier-1 (`[5,12]`), just above Ember Imp. Counter-play:
  // cleanse or healing that outpaces the bleed ticks, or simply not
  // stacking a shield for Gutting Cleave to shatter in the first place (a
  // shieldless build denies its opening line no target).
  bleed_reaver: {
    id: 'bleed_reaver',
    name: 'Reaver',
    baseDepth: 1,
    weaponAffinity: 'axe',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'gutting_cleave', slot: 0 },
      { skillId: 'hemorrhage', slot: 2 },
      { skillId: 'armor_break', slot: 3 },
    ],
    goldReward: 19,
    xpReward: 13,
  },

  // WARBREAKER: showcase for the roster's first `burden + splash` card
  // (Shockwave Slam) — a tempo-denial axe brute rather than a raw damage race.
  // `burden` taxes weight on the card the target is about to play and `splash`
  // spreads that tax across the band around it (up to 3 pieces at once),
  // stalling its NEXT couple of plays; Shield Splitter then cracks whatever
  // shield the target has banked while it is stalled. Distinct from both axe
  // siblings above: Berserker locks a turn down outright (stun), Reaver races HP
  // down (bleed); Warbreaker instead denies TEMPO — it wants the fight to run
  // long enough for repeated weight taxes to matter. goldReward 22 seats it
  // in tier-2 (`[9,16]`), next to Knight. Counter-play: a board with few,
  // cheap, low-weight pieces recovers from a burden fast (there is nothing to
  // stack — a re-burden just takes the max, per its own design note), and not
  // banking a shield leaves Shield Splitter's shatter with nothing to open.
  warbreaker: {
    id: 'warbreaker',
    name: 'Warbreaker',
    baseDepth: 1,
    weaponAffinity: 'axe',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 3,
    pieces: [
      { skillId: 'shockwave_slam', slot: 0 },
      { skillId: 'shield_splitter', slot: 1 },
    ],
    goldReward: 22,
    xpReward: 15,
  },

  // THORNBACK: the roster's thorns+shield beast — "punishes fast
  // attackers" because thorns fires once per LANDED DIRECT HIT, so a
  // multi-hit/fast-swinging board pays its stack count back over and over
  // in physical damage (their own armor applies) while Thornback just sits
  // behind Bulwark Thicket's 56 shield. Savage Bite is the only offense on
  // the board — this monster's
  // real damage is the counter-punch, not its own swing. Distinct from
  // Stone Beetle (shield, but zero thorns) and from Iron Maiden/Bulwark
  // Thicket's other card-level owners (Berserker, none currently on this
  // roster carries this exact card) — Thornback is the SIGNATURE thorns
  // showcase. goldReward 27 seats it in tier-3 (`[13,∞)`), the roster's
  // toughest band alongside Bandit Duelist. Counter-play: DoT/poison decks
  // never trigger thorns at all (thorns only answers a landed DIRECT hit,
  // never a tick) — the exact matchup Ember Imp's own rework called out as
  // thorns' blind spot — or shieldBreak to strip the 56 shield before
  // committing a big single hit instead of many small ones.
  thorn_beast: {
    id: 'thorn_beast',
    name: 'Thornback',
    baseDepth: 1,
    weaponAffinity: 'beast',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'bulwark_thicket', slot: 0 },
      { skillId: 'savage_bite', slot: 3 },
    ],
    goldReward: 27,
    xpReward: 18,
  },

  // SENTINEL: the roster's ward+guard warded protector. Unbreakable Stance
  // is the requested combo on one card (a ward charge that prevents the
  // next ailment outright, PLUS a -25% incoming-physical guard window);
  // Iron Bulwark banks a flat 48 physical shield on top, and Sword Slash is
  // its only offense. The composite reads as "the wall": a single ward
  // charge alone is a thin denial layer, but stacked with a % guard window
  // and a flat shield pool it becomes genuinely hard to burst OR chip
  // through in the same fight — the hardest denial matchup on the roster,
  // which is why it is tagged `isElite` (a title/encounter-role tag only,
  // per docs/enemy-design.md — not a stat multiplier) the same way Bandit
  // Duelist was the previous hardest normal-pool pick. goldReward 32 seats
  // it in tier-3 (`[13,∞)`), above Bandit Duelist — the new hardest
  // fight-pool anchor. Counter-play: ward only blocks the DoT/debuff/expose
  // family, never `stun` — a stun opener bypasses it entirely; a shieldBreak
  // hit still cracks Iron Bulwark's flat shield even though it can never be
  // warded away (shieldBreak is not in the wardable set either, so it lands
  // regardless of the ward charge).
  warded_sentinel: {
    id: 'warded_sentinel',
    name: 'Sentinel',
    baseDepth: 1,
    isElite: true,
    weaponAffinity: 'sword',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'unbreakable_stance', slot: 0 },
      { skillId: 'iron_bulwark', slot: 1 },
      { skillId: 'sword_slash', slot: 3 },
    ],
    goldReward: 32,
    xpReward: 21,
  },

  // --- Synergy-rider roster expansion (2026-08-21): the 2026-08-19/21 card
  // batch landed 9 "carrier" cards that pay off a status the REST of a board
  // already applies (exploit/stackBonus/shieldBurst/taxBonus) — no enemy
  // fielded any of them, so a player could draft the mechanic and never see
  // it played back. The four monsters below are that fix, one per rider
  // family the brief called out: exploit (poison), shieldBurst (own shield),
  // stackBonus (burn), stackBonus (bleed). Every board is real catalog cards
  // only, Bronze floor, small 2-card board — same rule as every enemy above.

  // VENOM STALKER: the roster's poison->exploit loop. Venom Fang lands the
  // poison; Second Bite checks `exploit poison` BEFORE it acts (+4 damage if
  // the target is already poisoned) and then re-applies its own 4-stack
  // poison, so the very next Venom Fang/Second Bite cycle re-primes the same
  // bonus — a small, fully-visible 2-card combo, not a one-off. Reads as a
  // patient ambusher: no burst, just a bite that gets meaner the longer its
  // venom sits. Distinct from Toxic Druid (nature CASTER, poison+heal
  // sustain, zero exploit) and from Wolf King (Venom Fang + Leeching Fang,
  // lifesteal payoff, not exploit) — this is the roster's only `exploit`
  // showcase. goldReward 25 seats it in tier-2 (`[9,16]`), next to Berserker.
  // Counter-play: cleanse the poison stack between its two casts and Second
  // Bite's exploit bonus never fires (it checks BEFORE the card acts, so a
  // stack removed even one beat earlier denies it outright); poison also
  // bypasses shields, so a shield alone does not answer this one.
  venom_stalker: {
    id: 'venom_stalker',
    name: 'Venom Stalker',
    baseDepth: 1,
    weaponAffinity: 'beast',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 2,
    pieces: [
      { skillId: 'venom_fang', slot: 0 },
      { skillId: 'second_bite', slot: 1 },
    ],
    goldReward: 25,
    xpReward: 17,
  },

  // PYRE ACOLYTE: the roster's burn->stackBonus loop. Cinder Dart and Ember
  // Lash both ignite (3 and 5 stacks); Burn Detonator then reads whatever
  // burn is STILL standing on the target and adds +4 damage per stack (cap
  // +16) — since burn halves every turn, the detonator rewards following its
  // own appliers quickly rather than banking a big pile and waiting. Distinct
  // from Ember Imp (the roster's DoT-attrition caster — no payoff card, its
  // burn is the whole point) — Pyre Acolyte is the same fire-caster shape
  // with one more piece that turns "how much burn is on the target right
  // now" into a third source of direct damage. goldReward 26 seats it in
  // tier-2 (`[9,16]`), just above Venom Stalker. Counter-play: burn halves on
  // its own each turn, so simply outlasting a turn or two before Burn
  // Detonator lands shrinks its bonus for free; a cleanse removes the stacks
  // outright and a Ward charge denies burn from landing in the first place.
  pyre_acolyte: {
    id: 'pyre_acolyte',
    name: 'Pyre Acolyte',
    baseDepth: 1,
    elementAffinity: 'fire',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 3,
    pieces: [
      { skillId: 'cinder_dart', slot: 0 },
      { skillId: 'ember_lash', slot: 1 },
      { skillId: 'burn_detonator', slot: 2 },
    ],
    goldReward: 26,
    xpReward: 17,
  },

  // SHIELD WARDEN: the roster's shieldBurst showcase — teaches the
  // shieldBreak counterplay the brief asked for. Iron Bulwark banks a flat 48
  // physical shield; Aegis Charge then shatters up to 12 of ITS OWN shield
  // and adds exactly that much to its swing, on top of its own 14 (+ATK) —
  // "spend your wall on the way in" rather than sit behind it forever. If the
  // wall is never cracked from outside, the Warden eventually cracks it
  // itself and hits harder for it; if the player's own `shieldBreak` strips
  // Iron Bulwark's shield FIRST, Aegis Charge has nothing left to burst and
  // falls back to its bare 14 (+ATK). Distinct from every other shielded
  // enemy on the roster (Stone Beetle, Knight, Berserker/Iron Maiden,
  // Thornback, Sentinel) — none of them ever spend their own shield as
  // damage; this is the only one that does. goldReward 29 seats it in
  // tier-3 (`[13,∞)`), just below Thornback. Counter-play: shieldBreak (or
  // simply not letting the shield bank in the first place) denies Aegis
  // Charge's burst a target before it is ever spent back at you.
  shield_warden: {
    id: 'shield_warden',
    name: 'Shield Warden',
    baseDepth: 1,
    weaponAffinity: 'sword',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 3,
    pieces: [
      { skillId: 'iron_bulwark', slot: 0 },
      { skillId: 'aegis_charge', slot: 2 },
    ],
    goldReward: 29,
    xpReward: 19,
  },

  // BLOODLETTER: the roster's bleed->stackBonus duelist. Rupturing Strike
  // opens a 5-stack bleed; Bleed Executioner then reads the target's own
  // bleed stack and adds +3 damage per stack (cap +12) on top of its base 14
  // (+ATK) — a single opener already books nearly the whole cap (5*3=15,
  // clamped to +12), so the combo reads clean off just two cards. Distinct
  // from Reaver (`bleed_reaver`, the roster's shieldBreak-then-bleed axe
  // duelist — its payoff is opening the guard, not reading the stack) and
  // from Bandit Duelist (sword tempo/parry, no bleed at all) — Bloodletter is
  // the roster's only `stackBonus`-on-bleed showcase. goldReward 33 seats it
  // in tier-3 (`[13,∞)`), the roster's new top rung above Warded Sentinel.
  // Counter-play: cleanse the bleed stack (or simply out-heal/out-tank the
  // opener) before Bleed Executioner reads it, and the follow-up falls back
  // to its bare 14 (+ATK); bleed is explicitly blocked by shields, so a
  // banked shield denies Rupturing Strike's stack from ever landing.
  blood_duelist: {
    id: 'blood_duelist',
    name: 'Bloodletter',
    baseDepth: 1,
    weaponAffinity: 'axe',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 2,
    pieces: [
      { skillId: 'rupturing_strike', slot: 0 },
      { skillId: 'bleed_executioner', slot: 1 },
    ],
    goldReward: 33,
    xpReward: 22,
  },

  // --- TYPELESS-BAND MOB ROSTER (2026-08-26, content-designer) --------------
  // WHAT WAS MISSING, and it was a DESIGN hole rather than a content wish.
  // `src/data/biomes.ts` makes a wave band declarable: five waves whose mobs,
  // boss, stalls and events all point at ONE of the game's eleven card types,
  // read BEFORE the player commits. Six bands existed against eleven types --
  // frost, lightning, dark, bow and lance had no band, so those five identities
  // could not be DECLARED, only stumbled into (docs/run-structure-patterns.md
  // Q12). The blocker was never biome data: the roster fielded 0 or 1 mobs for
  // each of those five, so a "Frostmarch" would have been a name with no
  // monsters behind it, and `rime_tyrant`/`galewright` rode as guests in bands
  // whose declared identity was something else.
  //
  // AND IT WAS A LIVE BUG ONE LEVEL DOWN. The band forecast prints "<counter>
  // hits these mobs for +50%", derived from the biome's declared LEAN. Five of
  // the six shipped `mobs` lists carried BORROWED off-type members purely
  // because on-type ones did not exist -- the Hallowfield's `necromancer`
  // (dark) and `knight` (sword) take nothing extra from dark -- so that line was
  // false of them. The mobs below are what let those lists be cleaned to
  // on-type members only, which is what makes the line true (asserted in
  // `tests/run/biomeForecastCounter.test.ts`).
  //
  // THIRTEEN mobs: three each for frost / lightning / dark / bow / lance
  // (counting the one existing kit each of the last four already had --
  // `mage`, `necromancer`, `hunter`, `rogue`), plus one HOLY and one NATURE kit
  // so the Hallowfield and the Thornwild do not lose depth coverage when their
  // borrowed members go. Every band ends with >= 2 on-type mobs and 8 of the 11
  // span three of `computeEnemyDepthBands`'s four depth tiers.
  //
  // THE SHAPE IS THE MOB SHAPE, NOT THE BOSS SHAPE. A signature boss is a
  // MONO-TYPE TRIAD with the mono type authored as its affinity (see the boss
  // block below, and `tests/run/bossRoster.test.ts` which pins that contract).
  // These are MOBS: 2-3 real catalog cards, Bronze floor, no gem, no tier
  // override, the universal Level-1 statline, `boardSize` an EXACT fit of the
  // pieces' sizes -- exactly like every mob above. What they DO share with the
  // boss rule is a single-type board: each one's cards are all of its declared
  // type, so the affinity the counter line reads is never contradicted by the
  // board (the legibility bug the 2026-08-18 Warden/Lancer re-themes closed).
  //
  // NEW CARDS ONLY WHERE IT SERVES THE KIT. 34 of the 156 catalog cards had
  // never been fielded by any enemy; these thirteen boards field 26 of them,
  // including the roster's first uses of `swift_march` and `spotters_mark` (two
  // of the six AURA cards in the whole catalog -- the largest built-and-unused
  // surface in the game per docs/run-structure-patterns.md Q2). Where a card is
  // shared with an existing kit the per-monster note says which and why.
  //
  // GOLD SEATS THEM ON THE EXISTING LADDER. `computeEnemyDepthBands` derives
  // depth tiers from `goldReward` RANK, so adding 13 ids re-splits the tiers and
  // legitimately moves which enemy an existing draw indexes into (the same
  // expected shift the 2026-08-19 depth-gating pass documented). Values 13-33
  // stay strictly inside the fight pool's existing 12-33 range, so the bosses
  // (46-74) still sit entirely above it -- `tests/run/bossRoster.test.ts`
  // asserts exactly that.

  // RIME WISP -- FROST, tier 0. The roster's FIRST frost enemy, and the first
  // enemy whose whole board attacks the READINESS economy instead of the HP
  // bar: Glacial Spike is 12 (+MATK) and -20% SPD, Slow Hex is 8 (+MATK) and
  // -30% SPD. Readiness is gained per turn AT SPD (src/engine/combat/simulate.ts),
  // so a 30% cut is a 30% cut to how often the hero acts at all -- the Rime
  // Tyrant's doctrine at mob scale and a fifth of the price. Distinct from
  // `mage` (flat MATK burst, no rider) and `ember_imp` (burn attrition): the
  // Wisp's damage is almost incidental. goldReward 13 seats it in tier 0
  // alongside `giant_rat`, deliberately -- frost is the type the run should
  // meet in its first four fights, since that is where a Frostmarch band is
  // first dealt. Counter-play: LIGHTNING (+50%, lightning beats frost), or
  // simply killing it inside two casts -- nothing here hits hard enough to
  // race, and the SPD debuff is a stat effect, so {{Ward}} does NOT stop it.
  rime_wisp: {
    id: 'rime_wisp',
    name: 'Rime Wisp',
    baseDepth: 1,
    elementAffinity: 'frost',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 2,
    pieces: [
      { skillId: 'glacial_spike', slot: 0 },
      { skillId: 'slow_hex', slot: 1 },
    ],
    goldReward: 13,
    xpReward: 9,
  },

  // HOARFROST ADEPT -- FROST, tier 2. The roster's ANTI-CASTER, and its only
  // MATK debuff: Mind Frost halves the hero's magicPower for 2 turns, Frost
  // Shackle {{Slow}}s the hero's next action by +12 weight while chipping 14
  // (+MATK), and Mana Ward banks a 20 (+MDEF) magical shield in front of
  // whatever survives the halving. A magical build therefore pays twice --
  // half the power, and a shield eating what is left -- which is the exact
  // mirror of `warded_sentinel`'s physical wall and a matchup the roster had no
  // answer to before. goldReward 24 seats it in tier 2 next to `berserker`.
  // Counter-play: PHYSICAL damage walks past both halves (Mind Frost touches
  // MATK only, and Mana Ward is a magical shield), or LIGHTNING for the +50%.
  hoarfrost_adept: {
    id: 'hoarfrost_adept',
    name: 'Hoarfrost Adept',
    baseDepth: 1,
    elementAffinity: 'frost',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 3,
    pieces: [
      { skillId: 'frost_shackle', slot: 0 },
      { skillId: 'mind_frost', slot: 1 },
      { skillId: 'mana_ward', slot: 2 },
    ],
    goldReward: 24,
    xpReward: 16,
  },

  // GLACIAL WARDEN -- FROST, tier 3, and the Frostmarch's CHAMPION (the second
  // face of that band's boss shortlist, the same way `blood_duelist` is the
  // Ironmoot's -- a boss-TITLED mob needs no new statline, since the title
  // supplies the power). Deep Freeze is -40% SPD for THREE turns on a 24
  // (+MATK) hit, Glacial Spike stacks another -20% for two, and Frost Ward
  // (-50% incoming magical) is what buys the time for both to compound. Where
  // the Wisp shaves a turn, the Warden takes the fight's tempo away entirely.
  // Shares Deep Freeze with `rime_tyrant` on purpose -- it is the band's own
  // signature line, and the Warden is what the Tyrant's country produces --
  // but not one of the Tyrant's two gated cards, which stay its alone.
  // goldReward 32 seats it in tier 3. Counter-play: LIGHTNING, or PHYSICAL
  // burst inside the first rotation -- Frost Ward answers magic only, and the
  // Warden has no answer at all to a fight that ends before its third cast.
  glacial_warden: {
    id: 'glacial_warden',
    name: 'Glacial Warden',
    baseDepth: 1,
    elementAffinity: 'frost',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'deep_freeze', slot: 0 },
      { skillId: 'frost_ward', slot: 2 },
      { skillId: 'glacial_spike', slot: 3 },
    ],
    goldReward: 32,
    xpReward: 21,
  },

  // ARC ADEPT -- LIGHTNING, tier 0. The roster's first enemy that buffs its OWN
  // speed: Thunder Step chips 12 (+MATK) and takes +20% SPD for 2 turns, then
  // Chain Spark hits 16 (+MATK) and {{Slow}}s the hero's next action by +8
  // weight. Both halves of the readiness race move at once -- it gets faster
  // while the hero gets later -- which is a different lesson from the Rime
  // Wisp's pure SPD shred (the Wisp slows YOU; the Adept also hurries ITSELF,
  // and a buff is not something {{Cleanse}} can strip off you). Distinct from
  // `mage`, the pure flat-MATK blaster this band's mid tier already holds.
  // goldReward 15 seats it in tier 0. Counter-play: NATURE (+50%, nature beats
  // lightning), or out-damage it -- 28 total flat power across two cards is the
  // thinnest offense in tier 0 after `giant_rat`.
  arc_adept: {
    id: 'arc_adept',
    name: 'Arc Adept',
    baseDepth: 1,
    elementAffinity: 'lightning',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 2,
    pieces: [
      { skillId: 'thunder_step', slot: 0 },
      { skillId: 'chain_spark', slot: 1 },
    ],
    goldReward: 15,
    xpReward: 10,
  },

  // TEMPEST HERALD -- LIGHTNING, tier 3, and the Stormreach's CHAMPION. Every
  // card is the same axis, escalating: Storm Surge is the roster's largest
  // single lightning hit (36 (+MATK)) AND +30% SPD for 2 turns, Arc Cascade
  // taxes +8 weight on the card the hero is about to play and {{Splash}}es that
  // tax onto the pieces either side of it (up to 3 at once), and Storm Guard
  // adds another +20% SPD behind -30% incoming magical. So it acts more often
  // while the hero's whole next band of plays costs more -- the compounding
  // version of what the Arc Adept does once. Distinct from `warbreaker`, the
  // roster's other burden+splash kit, which is a slow AXE brute with no speed
  // of its own. goldReward 30 seats it in tier 3. Counter-play: NATURE, or a
  // board of FEW, CHEAP, LOW-WEIGHT pieces -- a burden tax is only as large as
  // the weight it lands on, and Storm Guard does nothing at all about physical.
  tempest_herald: {
    id: 'tempest_herald',
    name: 'Tempest Herald',
    baseDepth: 1,
    elementAffinity: 'lightning',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'storm_surge', slot: 0 },
      { skillId: 'arc_cascade', slot: 2 },
      { skillId: 'storm_guard', slot: 3 },
    ],
    goldReward: 30,
    xpReward: 20,
  },

  // GRAVE ACOLYTE -- DARK, tier 0. A self-sustaining dark caster, and the
  // roster's first MAGICAL lifesteal (Wolf King's Leeching Fang is the physical
  // beast one): Poison Ritual lays {{Poison}} 5 -- which BYPASSES SHIELDS, so a
  // plated opening does not answer it -- and cleanses up to 2 of the Acolyte's
  // own ailments in the same breath; Siphon Life then deals 16 (+MATK) and
  // heals it 45% of what landed. It goes UP while the hero goes down, and a DoT
  // trade specifically loses to it. Distinct from `necromancer`, the band's
  // mid-tier curse/debuff caster (Hex of Frailty, Dulling Hex): no card is
  // shared and neither steals the other's mechanic. goldReward 16 seats it in
  // tier 0. Counter-play: HOLY (+50%, holy and dark are mutually strong), or
  // BURST -- out-damage one Siphon Life cycle rather than trading with it.
  grave_acolyte: {
    id: 'grave_acolyte',
    name: 'Grave Acolyte',
    baseDepth: 1,
    elementAffinity: 'dark',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 2,
    pieces: [
      { skillId: 'poison_ritual', slot: 0 },
      { skillId: 'siphon_life', slot: 1 },
    ],
    goldReward: 16,
    xpReward: 11,
  },

  // BARROW WIGHT -- DARK, tier 3, and the Duskbarrow's CHAMPION. Two things no
  // other mob on the roster does, on one board. (1) SWIFT MARCH is a PASSIVE
  // AURA -- adjacent cards cost -5 weight -- and it is authored in the MIDDLE
  // slot on purpose, so BOTH neighbours (Graveside Rite and the size-2 Soul
  // Rend) arrive sooner than their printed weight; the roster's only weight-
  // reduction aura, and one of the six aura cards in the entire catalog. (2)
  // SOUL REND is 27 (+best stat) TRUE damage -- it ignores DEF and MDEF
  // outright, so the armor-or-magic-resist answer that works on most of this
  // roster is worth literally nothing here. Graveside Rite's {{Affinity}} Dark
  // half is LIVE (the Wight's authored affinity opens it, the same way `mage`'s
  // lightning opens Arcane Bolt's), so it heals 10 (+MDEF) AND {{Cleanse}}s up
  // to 4 of its own ailments: a DoT deck does not answer it either. goldReward
  // 33 seats it in tier 3, the fight pool's top rung beside `blood_duelist`.
  // Counter-play: HOLY for the +50%, raw maxHp/healing to survive a TRUE hit
  // the aura keeps arriving early, or {{Negate}} -- Soul Rend is one instance,
  // so one charge cancels the whole thing.
  barrow_wight: {
    id: 'barrow_wight',
    name: 'Barrow Wight',
    baseDepth: 1,
    elementAffinity: 'dark',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'graveside_rite', slot: 0 },
      { skillId: 'swift_march', slot: 1 },
      { skillId: 'soul_rend', slot: 2 },
    ],
    goldReward: 33,
    xpReward: 22,
  },

  // CORDON ARCHER -- BOW, tier 1. One enormous arrow behind a door: Marksman
  // Shot is the catalog's largest single bow hit (48 (+ATK), size 2), and
  // Evasive Cordon is a {{Ward}} charge plus a 10 (+DEF) physical shield -- the
  // roster's first DEFENSIVE bow line at all. Where `hunter` is a marksman who
  // debilitates first and perforates after, the Cordon Archer simply survives
  // one exchange and then lands the biggest arrow in the book. goldReward 21
  // seats it in tier 1, the rung the bow band had nothing on. Counter-play:
  // NOTHING counters bow on the weapon triangle (`WEAPON_BEATS` maps
  // sword->axe->lance->sword and bow->beast, with no entry mapping TO bow) --
  // this is a fight the type wheel does not help with, and that is the honest
  // read the Arrowfell's banner prints. What DOES answer it is flat ARMOR (one
  // big physical hit is exactly what flat DEF subtracts best) or a shieldBreak
  // opener onto the Cordon before the shot arrives.
  cordon_archer: {
    id: 'cordon_archer',
    name: 'Cordon Archer',
    baseDepth: 1,
    weaponAffinity: 'bow',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 3,
    pieces: [
      { skillId: 'marksman_shot', slot: 0 },
      { skillId: 'evasive_cordon', slot: 2 },
    ],
    goldReward: 21,
    xpReward: 14,
  },

  // DEADEYE STALKER -- BOW, tier 3, and the Arrowfell's CHAMPION. The board is
  // a SANDWICH and the slot order is the whole kit: Spotter's Mark sits in slot
  // 1, physically touching BOTH shots, so its "adjacent Offense cards deal +10"
  // passive pays on each of them -- Piercing Arrow lands 18 and {{Expose}}s the
  // hero for +30% from every direct hit, and Hunter's Shot then lands 30 into
  // that window. Same aura mechanic `greenwood_sovereign` is built around, at
  // mob scale and with the roster's cheapest possible frame (three size-1
  // cards). It is also the only kit fielding Hunter's Shot, which the 2026-08-21
  // legacy refresh swapped OFF `hunter` -- the card came back where its flat 20
  // is the payoff of a mark rather than a plain opener. goldReward 31 seats it
  // in tier 3. Counter-play: nothing on the wheel (see the Cordon Archer);
  // ARMOR blunts three small physical hits well, and {{Cleanse}} strips the
  // Expose before the marked shot arrives.
  deadeye_stalker: {
    id: 'deadeye_stalker',
    name: 'Deadeye Stalker',
    baseDepth: 1,
    weaponAffinity: 'bow',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 3,
    pieces: [
      { skillId: 'piercing_arrow', slot: 0 },
      { skillId: 'spotters_mark', slot: 1 },
      { skillId: 'hunter_shot', slot: 2 },
    ],
    goldReward: 31,
    xpReward: 21,
  },

  // PIKE CONSCRIPT -- LANCE, tier 0. The cheapest "hit and hold" board in the
  // game and the roster's first tier-0 lance: Lance Thrust is a flat 20 (+ATK),
  // Braced Pike is 12 (+ATK) that also refuses 20% of incoming PHYSICAL for 2
  // turns. Nothing clever -- deliberately, because the Pikewold needs a rung a
  // fight-1 hero can meet, and the band's identity (a line you have to break
  // rather than out-damage) should be legible in its weakest member. Lance
  // Thrust is the card the 2026-08-21 refresh swapped off `rogue`; it comes
  // back here, where a plain thrust is the point. goldReward 14 seats it in
  // tier 0. Counter-play: AXE (+50%, axe beats lance), or MAGICAL damage --
  // Braced Pike's guard is physical-only.
  pike_conscript: {
    id: 'pike_conscript',
    name: 'Pike Conscript',
    baseDepth: 1,
    weaponAffinity: 'lance',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 2,
    pieces: [
      { skillId: 'lance_thrust', slot: 0 },
      { skillId: 'braced_pike', slot: 1 },
    ],
    goldReward: 14,
    xpReward: 9,
  },

  // PHALANX VETERAN -- LANCE, tier 2, and the Pikewold's CHAMPION. A physical
  // attacker pays THREE TIMES and the board says so in order: Retaliation
  // Stance stands {{Thorns}} 6 up behind -20% incoming physical, Impaling
  // Charge hits 36 (+ATK) and deepens the guard to -30%, and Bramblemend adds
  // 5 MORE thorns while healing 10 (+DEF). Eleven standing thorns bill every
  // landed direct hit (physical, so the attacker's own DEF applies -- the
  // 2026-08-21 thorns ruling in docs/enemy-design.md) on top of a third of the
  // damage being refused at the door, and the wall repairs itself. It is the
  // Thornpike Marshal's doctrine without the Marshal's gated cards. Distinct
  // from `thorn_beast` (beast, thorns behind a big flat SHIELD and almost no
  // offense): the Veteran's mitigation is a % GUARD, which no shieldBreak can
  // strip. goldReward 28 seats it in tier 2. Counter-play: AXE, or go MAGICAL /
  // DoT -- neither the physical guard nor thorns touches a magic card or a
  // poison tick (thorns answers a landed DIRECT hit only, never a tick).
  phalanx_veteran: {
    id: 'phalanx_veteran',
    name: 'Phalanx Veteran',
    baseDepth: 1,
    weaponAffinity: 'lance',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'retaliation_stance', slot: 0 },
      { skillId: 'impaling_charge', slot: 1 },
      { skillId: 'bramblemend', slot: 3 },
    ],
    goldReward: 28,
    xpReward: 19,
  },

  // VIGIL KEEPER -- HOLY, tier 3. Authored for the CLEANUP, not for a new band:
  // the Hallowfield's mob list borrowed `knight` (sword) and `necromancer`
  // (dark) to span the depth tiers, and dropping them left holy with two tier-0/1
  // kits and nothing deep. This is the deep one, and it is the roster's {{Ward}}
  // SHOWCASE: Aegis of the Unbroken banks 2 charges and heals 28 (+MDEF),
  // Warding Prayer adds the third -- exactly `MAX_WARD_CHARGES` -- plus a
  // 2-charge {{Cleanse}}. Three ward charges blank the first three affliction
  // APPLICATIONS outright regardless of their stack counts, so the burn/poison/
  // bleed half of the card book simply does not land on this monster. Its own
  // offense is Purging Strike, 9 (+best stat) TRUE, which ignores whatever the
  // hero plated in response. Distinct from `cleric` (heal/guard support, zero
  // ward) and `seraph` (the roster's only {{Negate}}, which cancels a HIT rather
  // than an ailment). goldReward 31 seats it in tier 3. Counter-play: DARK
  // (+50%), or {{Stun}} -- stun is NOT in the wardable set, so it lands through
  // all three charges; burst also works, since 9 TRUE per rotation cannot race.
  vigil_keeper: {
    id: 'vigil_keeper',
    name: 'Vigil Keeper',
    baseDepth: 1,
    elementAffinity: 'holy',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'aegis_of_the_unbroken', slot: 0 },
      { skillId: 'warding_prayer', slot: 2 },
      { skillId: 'purging_strike', slot: 3 },
    ],
    goldReward: 31,
    xpReward: 21,
  },

  // BLIGHT SHAMBLER -- NATURE, tier 2. The other CLEANUP kit: the Thornwild
  // borrowed three beast mobs and a lance one, and nature's own two
  // (`stone_beetle`, `toxic_druid`) both sit in tier 0. This is its mid-depth
  // member, and its loop is the catalog's LARGEST poison read: Nettle Ward
  // stands {{Thorns}} 5 up and lays {{Poison}} 5 (which bypasses shields),
  // Blight Feast then deals 12 (+MATK) and +12 MORE because the target is
  // already poisoned, and Overgrowth heals 30 (+MDEF) behind an 18 (+MDEF)
  // magical shield. So the grind loses on both ends -- chip damage feeds the
  // thorns and the heal outpaces it -- while the poison keeps re-priming a
  // doubled hit. Distinct from `venom_stalker` (beast, +4 exploit, no sustain)
  // and `toxic_druid` (three poison hybrids, no payoff card). Shares Nettle Ward
  // with `bramble_matriarch`, whose own identity is Grove Communion's 64-HP
  // gated heal, not the poison read. goldReward 28 seats it in tier 2.
  // Counter-play: FIRE (+50%, fire beats nature), {{Cleanse}} the poison stack
  // before Blight Feast reads it (it checks BEFORE the card acts, so removing it
  // one beat early denies the whole +12), or BURST over chip -- out-damage one
  // Overgrowth rather than trading with it.
  blight_shambler: {
    id: 'blight_shambler',
    name: 'Blight Shambler',
    baseDepth: 1,
    elementAffinity: 'nature',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 4,
    pieces: [
      { skillId: 'nettle_ward', slot: 0 },
      { skillId: 'blight_feast', slot: 1 },
      { skillId: 'overgrowth', slot: 2 },
    ],
    goldReward: 28,
    xpReward: 19,
  },

  // --- SIGNATURE BOSSES (2026-08-26, content-designer) ----------------------
  // WHAT WAS MISSING. "Boss" in this game is a TITLE assigned by POSITION in
  // the wave (`fightSpecFor` in src/run/runState.ts: pos <= 2 normal, <= 4
  // elite, else boss), and `TITLE_PRESETS.boss` (+4 levels, +4 rank, +2 extra
  // cards) will happily hang that title on whatever mob rolled. What it could
  // NOT do is make the fight RECOGNISABLE: a boss was a random monster with
  // bigger numbers, so no player could ever anticipate one or build a deck
  // against it. (The one real boss-pool entry, `wolf_king`, meant every single
  // boss WAVE was the same monster -- `BOSS_POOL` in runState.ts is
  // `filter(e => e.isBoss)`, and until this batch that was a pool of one.)
  //
  // THE SHAPE, one rule for all of them: a signature boss is a MONO-TYPE TRIAD
  // -- exactly three cards, all of ONE of the game's eleven card types (6
  // elements + 5 weapons), with that same type AUTHORED as its affinity. That
  // single rule buys three things at once:
  //   1. IT NAMES ITS OWN COUNTER. Affinity is purely defensive
  //      (`cardMatchup` in the interpreter reads the DEFENDER's affinity), so
  //      the type stamped on all three card faces is exactly the type the
  //      player must bring to get +50%: Frost answers the Cinder Monarch,
  //      Lance answers the Sworn Colossus, Holy answers the Hollow Crown.
  //   2. IT TURNS THE BOSS'S OWN {{Affinity}} LINES ON. `affinityOpen`
  //      (interpreter.ts) checks the CASTER's authored affinity, so an
  //      attuned boss fires the gated half of its own cards that an ordinary
  //      mob never can. That is the mechanical difference between a boss and a
  //      buffed rat: same Bronze budget, but the conditional half is always
  //      live.
  //   3. IT IS A ROTATION, NOT A PILE. `castCursor` walks pieces in SLOT
  //      order, so slot order here is authored choreography: the Galewright
  //      charges before it detonates, the Hollow Crown exposes before it
  //      executes.
  //
  // COUNT: ELEVEN bosses, one per card type -- the same eleven types
  // `src/data/shopTypes.ts` guarantees a single-type stall for (see
  // tests/run/affinityReachability.test.ts: "identity in one visit", 6.00
  // same-type offers per shelf for all eleven). One boss per type is the
  // smallest set where every identity a player can actually BUILD has a boss
  // it hard-counters, and it is the natural binding for a future biome layer
  // (one signature boss per biome). `wolf_king` already IS the beast entry
  // (mono-beast triad, authored beast affinity) and is left untouched, so this
  // batch adds the other TEN.
  //
  // FLOOR RULE UNCHANGED. Every card below is Bronze, no gems, no tier
  // overrides, universal Level-1 statline, `boardSize` exactly the sum of the
  // pieces' sizes -- docs/enemy-design.md's floor rule, same as every monster
  // above. The extra threat a boss carries is the TITLE's (+4 levels, +4 rank,
  // +2 cards), applied by the run layer, never hand-inflated here.
  //
  // THREE PIECES, NEVER FOUR. `REFERENCE_ENEMY_DECK_SIZE`
  // (src/run/encounter.ts) is derived live as the LARGEST base deck on the
  // roster and prices every pack member's board; a 4-card boss would raise it
  // for the whole game. Bosses buy their presence with card SIZE (a size-3
  // capstone) instead of card COUNT, which costs slots and cast tempo rather
  // than a run-layer budget constant.
  //
  // GOLD SEATS THE BOSS LADDER. `computeEnemyDepthBands` (src/run/enemyDepth.ts)
  // is run over the boss pool separately from the fight pool, sorted by
  // `goldReward`, so these 46-74 values place each boss on the ladder without
  // disturbing the non-boss depth bands at all: waves 5 and 10 draw from the
  // first six, wave 15 from the last five, wave 20+ from the Dawn Arbiter and
  // the Hollow Crown. ---------------------------------------------------------

  // FIRE -- THE BURN AVALANCHE. Countered by FROST (frost beats fire; +50%),
  // and shrugs off NATURE (-25%). The rotation is the whole identity and it
  // reads left to right on the board: Kindling Rite {{Charge}}s Fire (+16 on
  // the next Fire card), Wildfire Rite spends that charge AND fires its
  // {{Affinity}} Fire half for {{Burn}} 16, then Inferno Eruption -- the
  // roster's largest single ignition at 56 + {{Burn}} 20 -- lands on a target
  // already burning. Burn halves fast, so the pile only matters because all
  // three cards feed it in order.
  // COUNTERPLAY: Frost damage, {{Ward}} charges (each cancels one whole
  // affliction APPLICATION regardless of stack count -- three wards blank the
  // entire rotation), or {{Cleanse}}. Armor does nothing: burn is a DoT.
  cinder_monarch: {
    id: 'cinder_monarch',
    name: 'The Cinder Monarch',
    baseDepth: 1,
    isBoss: true,
    elementAffinity: 'fire',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 6,
    pieces: [
      { skillId: 'kindling_rite', slot: 0 },
      { skillId: 'wildfire_rite', slot: 1 },
      { skillId: 'inferno_eruption', slot: 3 },
    ],
    goldReward: 46,
    xpReward: 31,
  },

  // SWORD -- THE WALL THAT SWINGS BACK. Countered by LANCE (lance beats
  // sword; +50%) and by {{Shatter}}/shieldBreak, and it punishes the one thing
  // a player most wants to bring against a sword boss: Oathplate's
  // {{Affinity}} Sword half stacks an ATTUNED Sword shield that eats 2 damage
  // per point from SWORD attacks specifically. Fortress Bastion is the
  // roster's biggest single plating (96 +DEF) and Sworn Edge's gated half
  // doubles its swing (34, then 28 again), so the Colossus is a race against a
  // shield that comes back every rotation.
  // COUNTERPLAY: Lance cards for the triangle, a {{Shatter}} line to open the
  // plating before your big hit, or DoT (poison bypasses shields entirely;
  // bleed does not).
  sworn_colossus: {
    id: 'sworn_colossus',
    name: 'The Sworn Colossus',
    baseDepth: 1,
    isBoss: true,
    weaponAffinity: 'sword',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 6,
    pieces: [
      { skillId: 'oathplate', slot: 0 },
      { skillId: 'fortress_bastion', slot: 1 },
      { skillId: 'sworn_edge', slot: 4 },
    ],
    goldReward: 48,
    xpReward: 32,
  },

  // BOW -- THE MARKED VOLLEY. The one DUAL-affinity boss on the roster, and
  // deliberately so: Bow is the only card type NOTHING beats on the weapon
  // triangle (`WEAPON_BEATS` in src/engine/elements.ts maps sword->axe->lance->
  // sword and bow->beast; no entry maps to bow), so a Bow-only boss would be
  // counter-PROOF -- the exact opposite of a telegraphed fight. Its greenwood
  // is therefore also authored NATURE, which is the counter axis: bring FIRE.
  // The bow leg is not decoration either -- it opens Massed Volley's
  // {{Affinity}} Bow second hit, and it makes BEAST attackers eat -25%.
  // The board is authored as a sandwich: Spotter's Mark sits in slot 2
  // physically touching both volleys, so its "adjacent Offense cards deal +10"
  // passive lands on every one of the four arrows either side of it.
  // COUNTERPLAY: Fire (nature's counter, +50%), or armor -- every hit here is
  // physical and small, which is exactly what flat DEF subtracts best.
  greenwood_sovereign: {
    id: 'greenwood_sovereign',
    name: 'The Greenwood Sovereign',
    baseDepth: 1,
    isBoss: true,
    elementAffinity: 'nature',
    weaponAffinity: 'bow',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 5,
    pieces: [
      { skillId: 'barrage', slot: 0 },
      { skillId: 'spotters_mark', slot: 2 },
      { skillId: 'massed_volley', slot: 3 },
    ],
    goldReward: 50,
    xpReward: 33,
  },

  // NATURE -- THE FIGHT YOU CANNOT OUT-GRIND. Countered by FIRE (fire beats
  // nature; +50%), resistant to LIGHTNING (-25%). Grove Communion's
  // {{Affinity}} Nature half restores 64 (+MDEF) HP on a board that also holds
  // {{Thorns}} and {{Poison}} -- so a slow, safe, chip-damage deck literally
  // cannot win this: the Matriarch heals more per rotation than a chip deck
  // deals, and Nettle Ward's thorns bill every direct hit on the way in. It is
  // the roster's explicit answer to "just play defensively".
  // COUNTERPLAY: Fire, and BURST over chip -- out-damage one heal cycle rather
  // than trading. DoT also ignores the thorns (thorns only answers a landed
  // DIRECT hit).
  bramble_matriarch: {
    id: 'bramble_matriarch',
    name: 'The Bramble Matriarch',
    baseDepth: 1,
    isBoss: true,
    elementAffinity: 'nature',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 5,
    pieces: [
      { skillId: 'nettle_ward', slot: 0 },
      { skillId: 'grove_lash', slot: 1 },
      { skillId: 'grove_communion', slot: 3 },
    ],
    goldReward: 54,
    xpReward: 36,
  },

  // AXE -- THE GUARD-BREAKER. Countered by SWORD (sword beats axe; +50%),
  // resistant to LANCE (-25%). Warlord's Banner is a whole-board passive (ALL
  // cards +5 damage, no adjacency to respect), then Sundering Roar is the
  // single most complete swing in the catalog -- {{Shatter}} 64, {{Expose}}
  // +20%, {{Bleed}} 8 AND 56 damage -- and Warband Cleave's {{Affinity}} Axe
  // half adds a 48 second hit into the hole it just made. A shield-and-plate
  // build is the WRONG answer here; that is the lesson this boss teaches.
  // COUNTERPLAY: Sword cards, and HP/heal over shields (64 shatter eats almost
  // any plating you can hold). {{Ward}} blanks the bleed.
  ruin_warlord: {
    id: 'ruin_warlord',
    name: 'The Ruin-Warlord',
    baseDepth: 1,
    isBoss: true,
    weaponAffinity: 'axe',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 6,
    pieces: [
      { skillId: 'warlord_banner', slot: 0 },
      { skillId: 'sundering_roar', slot: 1 },
      { skillId: 'warband_cleave', slot: 4 },
    ],
    goldReward: 56,
    xpReward: 37,
  },

  // LANCE -- THE PHALANX THAT BILLS YOU FOR ATTACKING. Countered by AXE (axe
  // beats lance; +50%), resistant to SWORD (-25%). Pikewall Oath's
  // {{Affinity}} Lance half is -40% incoming PHYSICAL for 2 turns, and
  // Bramblewrath stands 20 {{Thorns}} up: a physical attacker is therefore
  // paying twice -- 40% of its damage is refused at the door and 20 comes back
  // per landed hit (physical, so the attacker's own DEF applies -- see the
  // 2026-08-21 thorns ruling in docs/enemy-design.md). Phalanx Thrust's gated
  // half then doubles the counter-punch.
  // COUNTERPLAY: Axe for the triangle, ARMOR to blunt the thorns reflect, or
  // go MAGICAL/DoT -- neither the -40% physical guard nor the thorns touches a
  // magic card or a poison tick.
  thornpike_marshal: {
    id: 'thornpike_marshal',
    name: 'The Thornpike Marshal',
    baseDepth: 1,
    isBoss: true,
    weaponAffinity: 'lance',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 6,
    pieces: [
      { skillId: 'pikewall_oath', slot: 0 },
      { skillId: 'bramblewrath', slot: 1 },
      { skillId: 'phalanx_thrust', slot: 4 },
    ],
    goldReward: 62,
    xpReward: 41,
  },

  // FROST -- THE SLOW DEATH. Countered by LIGHTNING (lightning beats frost;
  // +50%), resistant to FIRE (-25%). Nothing here hits hard; the Rime Tyrant
  // wins by taking your TURNS. Deep Freeze is -40% SPD for 3 turns, Hoarfrost
  // Creed's {{Affinity}} Frost half {{Expose}}s you for +30% from every direct
  // hit, and Deepening Frost's gated half hits a second time into that Expose
  // window. Readiness is gained per turn at SPD, so a 40% cut is a 40% cut to
  // how often you act at all -- the longer this runs the further behind you
  // get, which is exactly the fight a player should learn to pre-empt.
  // COUNTERPLAY: Lightning, or SPEED/tempo (act before the debuff lands and
  // finish inside its window). Expose and the SPD debuff are stat effects, not
  // afflictions -- {{Ward}} does NOT stop them.
  rime_tyrant: {
    id: 'rime_tyrant',
    name: 'The Rime Tyrant',
    baseDepth: 1,
    isBoss: true,
    elementAffinity: 'frost',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 6,
    pieces: [
      { skillId: 'deep_freeze', slot: 0 },
      { skillId: 'hoarfrost_creed', slot: 2 },
      { skillId: 'deepening_frost', slot: 4 },
    ],
    goldReward: 64,
    xpReward: 43,
  },

  // LIGHTNING -- CHARGE, STEAL, DETONATE. Countered by NATURE (nature beats
  // lightning; +50%), resistant to FROST (-25%). Thunderhead opens with
  // {{Charge}} Lightning (+40 on the next Lightning card), Gathering Storm
  // spends it AND fires its {{Affinity}} Lightning second hit for 40 -- 28 +40
  // charge +40 gated, the largest scripted burst any Bronze board can assemble
  // -- and Overcharge {{Disrupt}}s 4 banked readiness so the answer does not
  // arrive in time. Recognisable because the wind-up is VISIBLE: the charge
  // lands a full cast before the payoff.
  // COUNTERPLAY: Nature, or kill the window -- {{Negate}} the magical hit, or
  // burst it down during the wind-up cast, which deals almost nothing.
  galewright: {
    id: 'galewright',
    name: 'The Galewright',
    baseDepth: 1,
    isBoss: true,
    elementAffinity: 'lightning',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 5,
    pieces: [
      { skillId: 'thunderhead', slot: 0 },
      { skillId: 'gathering_storm', slot: 2 },
      { skillId: 'overcharge', slot: 4 },
    ],
    goldReward: 66,
    xpReward: 44,
  },

  // HOLY -- THE UNBREAKABLE JUDGE. Countered by DARK (holy and dark are
  // mutually strong; +50% each way), and by nothing else on the wheel. Prism
  // Barrier is the catalog's only TRUE shield: 92 points that block TRUE
  // damage outright and drain 2-per-point against physical/magical, i.e. ~46
  // absorbed from ANY property -- there is no damage type that ignores it, so
  // the usual "go around the shield" answers (TRUE damage, poison-through-
  // shields) do not apply. Hallowed Toll's {{Affinity}} Holy half {{Stun}}s on
  // top, consuming a whole performance. Deliberately the roster's slowest
  // board (Prism Barrier alone is weight 26 across 3 slots) -- it is a siege,
  // not a race.
  // COUNTERPLAY: DARK cards for the +50%, or {{Shatter}}/shieldBreak to strip
  // the barrier the turn it goes up. Stalling loses: it re-plates every cycle.
  dawn_arbiter: {
    id: 'dawn_arbiter',
    name: 'The Dawn Arbiter',
    baseDepth: 1,
    isBoss: true,
    elementAffinity: 'holy',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 7,
    pieces: [
      { skillId: 'hallowed_toll', slot: 0 },
      { skillId: 'prism_barrier', slot: 2 },
      { skillId: 'communion_light', slot: 5 },
    ],
    goldReward: 70,
    xpReward: 47,
  },

  // DARK -- THE ONE YOUR DEFENCES DO NOT ANSWER. Countered by HOLY (+50%),
  // and it is the roster's deepest boss for a reason: Ruinous Hex {{Expose}}s
  // for +50% from every direct hit, Umbral Choir's {{Affinity}} Dark half
  // doubles into that window (36, then 24 again), and Annihilation Strike is
  // 48 (+best stat) TRUE damage -- it ignores DEF and MDEF entirely. Stacking
  // armor or magic resist, the answer to most of this roster, is worth
  // literally nothing against the finisher; only HP, healing, {{Negate}} or
  // killing it first are.
  // COUNTERPLAY: HOLY for the +50%, raw maxHp/heal to survive the TRUE
  // finisher, or out-tempo it -- the Expose window is only 2 turns wide and
  // the rotation is 6 slots long.
  hollow_crown: {
    id: 'hollow_crown',
    name: 'The Hollow Crown',
    baseDepth: 1,
    isBoss: true,
    elementAffinity: 'dark',
    stats: { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 },
    boardSize: 6,
    pieces: [
      { skillId: 'ruinous_hex', slot: 0 },
      { skillId: 'umbral_choir', slot: 1 },
      { skillId: 'annihilation_strike', slot: 3 },
    ],
    goldReward: 74,
    xpReward: 49,
  },
};
