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
};
