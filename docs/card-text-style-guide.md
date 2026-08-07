# Card Text Style Guide

Canonical vocabulary and phrasing for every card's `text` field in
`src/data/skills.ts`. This is a **reference document, not a rewrite** — no
card text is changed by this guide. Future cards (and future edits to
existing cards) should look up their wording here instead of improvising.

A drift-guard test will eventually assert that every number appearing in a
card's `text` matches that card's `effects` data exactly. Never let prose and
data disagree — if you change a magnitude, change both.

---

## 1. Keyword glossary

Precise in-engine meaning of every concept a card's text can reference.
Source of truth: `src/engine/types.ts`, `CLAUDE.md` "Core mechanics (locked)".

### Properties (`SkillDef.property`)

| Property | Damage | Heal / Shield / Buff | Shield blocks |
|---|---|---|---|
| **Physical** | vs Armor, **+ Attack** (flat) | + Attack (flat) | Physical damage only |
| **Magical** | vs Magic Resist, **+ Magic Power** (flat) | + Magic Power (flat) | Magical damage only |
| **True** | ignores Armor/Magic Resist entirely, **+ the caster's higher** of Attack/Magic Power | **FLAT** amount — no stat added, no reduction | ALL damage types |

**Flat model:** a card's `power` is a FLAT base amount. At cast time the caster's
scaling stat (per the property above) is ADDED on top — `damage = power + stat`.
Damage/HP scale linearly (never multiplicatively). TRUE heals/shields are the one
exception: pure flat `power`, no stat added.

### Typed shields

Shields are typed (Physical / Magical / True) by the card's property.
Same-type shield amounts **stack** when multiple shield casts land, **carry
over** between turns (they don't expire at end of turn), and are **capped at
the combatant's max HP**. A physical shield never blocks magical damage and
vice versa; a true shield blocks everything.

### Elements (`SkillDef.element`) — required on every Magical card; TRUE cards may carry one cosmetically

Six elements form a wheel plus one opposed pair:

```
Fire → Nature → Lightning → Frost → Fire      (cycle, each beats the next)
Holy ↔ Dark                                    (mutual opposition)
```

An enemy with an `elementAffinity` takes **+50%** damage from the element
that beats it and **−25%** from the element it beats. Matchups are
PL-neutral (not priced into the card — the swing lives on the enemy's
affinity, not the card's budget).

### Weapon types (`SkillDef.weapon`) — required on every Physical card (damage or not)

Five weapon types; three form a triangle, two sit outside it:

```
Sword → Axe → Lance → Sword     (triangle, each beats the next)
Bow beats Beast                  (one-way, both outside the triangle)
```

Beast = natural weapons (fangs, claws, monster attacks), used by beast-type
cards and enemies. Same ±50%/−25% matchup rule and PL-neutral pricing as
elements.

### Global-turn durations

`turns` on `poison`, `burn`, `buffStat`, and `debuffStat` count **global
turns** (every performance by either side advances the global turn counter),
not "my next N turns." A 2-turn debuff can expire mid-exchange regardless of
whose card is executing.

### Action kinds (the `effects: Action[]` union)

| Kind | Engine behavior |
|---|---|
| `damage` | Deals flat `power` **+ the scaling stat** as damage (true adds the higher stat). |
| `heal` | Restores flat `power` **+ the scaling stat** HP (true heal is pure flat `power`, no stat). |
| `shield` | Grants a typed shield worth flat `power` **+ the scaling stat** (true shield is pure flat `power`, no stat). |
| `poison` | Applies `stacks` poison stacks lasting `turns` global turns; each turn the victim takes `activeStacks × perStackDamage`. Per-stack damage = `max(1, floor(scalingStat / 5))` (physical→Attack, magical→Magic Power, true→higher), **snapshotted at cast** with the card's matchup baked in. **Bypasses shields.** |
| `burn` | Same stacking model as poison (`stacks × perStackDamage`, snapshotted at cast) but **consumed by shields** (unlike poison). Ticks at the start of each global turn for `turns` turns. |
| `bleed` | Same stacking model, ticking each time the victim **PERFORMS a cast** (not per global turn) for `turns` performances. **Bypasses shields** like poison. Fast, multi-cast enemies bleed faster; turtling stalls it. |
| `stun` | Consumes the victim's next performance(s) — not a global turn skip, a *performance* skip. `turns` counts performances consumed. |
| `buffStat` | Raises the caster's `stat` by `pct`% for `turns` global turns. |
| `debuffStat` | Lowers the enemy's `stat` by `pct`% for `turns` global turns. |
| `expose` | The mirror of `guard`: the enemy takes **+`pct`% damage from all direct hits** for `turns` global turns (floored; DoT ticks unaffected). Applied on the enemy. Clamped to ≤50% at apply time. |
| `cleanse` | Removes up to `charges` ailment STACKS from the caster, **expiring-soonest first, ties by application order**. Each charge strips one stack from a poison/burn/bleed pile (removing that instance at 0 stacks) or removes a stun/stat debuff/expose whole. Buffs/guards/negate are never removed. |
| `guard` | Reduces incoming damage of the matching `property` by `pct`% (multiplicative, floored, min 1) for `turns` global turns. Applied on the caster (self). Clamped to ≤60% at apply time. |
| `negate` | Grants `charges` counter-charges on the caster (self) that fully cancel the next direct hits of the matching `property`. DoT ticks, fatigue and attrition never spend a charge. Total charges of a property clamped to ≤3 at apply time. |

`BuffableStat` display names as they actually ship in card text (short
abbreviations — chosen for card-face space, and now the locked convention;
this supersedes any earlier "always spell out the full name" guidance):
`attack` → **ATK**, `magicPower` → **MATK**, `armor` → **DEF**,
`magicResist` → **MDEF**, `speed` → **SPD**, `critPct` → **Crit Chance**
(no established short form; spell out if ever needed). `HP` is used verbatim
for health, never abbreviated further.

### Special-ability riders (combined-archetype cards only)

| Rider | Engine behavior |
|---|---|
| `slow` | The enemy's next action becomes `weight` heavier (comes out later). |
| `disrupt` | Drains `amount` from the enemy's banked initiative readiness. |
| `lifesteal` | Heals the caster for `pct`% of the damage *this same cast* dealt. Placed after `damage` in `effects`. |
| `shieldBreak` | Shatters up to `amount` of the enemy's shield before the hit lands. Placed before `damage` in `effects`. |
| `comboBonus` | +`pct`% damage on this cast if the caster's previous cast shared an archetype with this one. Placed first in `effects`, but see §2 for how it's *phrased* (it is not a leading clause). |

---

## 2. Phrasing templates

One canonical sentence template per Action kind and per rider.
`{Stat}` always uses the display names from §1. `{Property}` is lowercase
("physical" / "magical") except TRUE, which is always spelled in caps.

### Main verbs

**Number-first grammar (2026-08-04 pass):** every damage/heal/shield clause
leads with the flat `{power}`, attaches the scaling stat clause directly to
that number, and names the damage/shield *type* (weapon, element, or TRUE)
as the trailing noun/adjective — never `"... damage +{power} (+STAT)."` The
old shape read like engineer notation (verb, object, then a `+{power}`
tacked on at the end); the number-first shape reads the way a player parses
a sentence: **how much, boosted by what, of what kind.**

| Kind | Template |
|---|---|
| `damage` (physical, weapon) | `Deal {power} (+ATK) {Weapon} damage.` — `{Weapon}` is the capitalized weapon noun (Sword/Axe/Lance/Bow/Beast). |
| `damage` (magical, element) | `Deal {power} (+MATK) {Element} damage.` — `{Element}` is the capitalized element noun (Fire/Lightning/Nature/Frost/Holy/Dark). |
| `damage` (true) | `Deal {power} (+best stat) TRUE damage — ignores DEF/MDEF.` |
| `heal` (physical) | `Restore {power} (+DEF) HP.` — healing is DEFENSIVE output, so it scales off Armor, not Attack (see the role note below). |
| `heal` (magical) | `Restore {power} (+MDEF) HP.` — likewise Magic Resist, not Magic Power. |
| `heal` (true) | `Restore {power} HP.` (or `Restore {power} TRUE HP.` when a card already spells out "TRUE" for flavor emphasis) — no stat clause; the omitted "(+stat)" is what signals it's flat (per §3). |
| `shield` (physical) | `Gain {power} (+DEF) physical shield.` — "physical shield" already implies it blocks physical only; don't restate it. Scales off Armor, not Attack (see the role note below). |
| `shield` (magical) | `Gain {power} (+MDEF) magical shield.` — likewise; the type name carries the blocking rule. Scales off Magic Resist, not Magic Power. |
| `shield` (true) | `Gain {power} TRUE shield — blocks all damage types.` (flavor may extend this, e.g. `"— blocks TRUE damage fully; physical/magical drain it 2:1."`) |
| `poison` | `Poison {stacks} stacks ({turns} turns).` — each stack deals damage scaling with your scaling stat; append `(poison bypasses shields)` the first/only time a card introduces poison, to disambiguate from burn. |
| `burn` | `Burn {stacks} stacks ({turns} turns).` |
| `bleed` | `Bleed {stacks} stacks ({turns} performances) — bleed ticks when the enemy performs.` — the "performances" unit and the "ticks when the enemy performs" clause disambiguate it from poison/burn (which tick per turn). |
| `stun` (turns = 1) | `Stun — the enemy's next performance is consumed.` — no numeral (the drift guard exempts `turns = 1`). |
| `stun` (turns > 1) | `Stun — the enemy's next {turns} performances are consumed.` |
| `buffStat` | `Gain +{pct}% {Stat} for {turns} turns.` |
| `debuffStat` | `Reduce the enemy's {Stat} by {pct}% for {turns} turns.` |
| `expose` | `Expose the enemy — +{pct}% damage from all direct hits ({turns} turns).` |
| `cleanse` | `Remove up to {charges} of your ailments.` — name the number of removable effects; "ailments" covers poisons/burns/bleeds/stuns/debuffs/expose. |
| `guard` | `Reduce incoming {property} damage by {pct}% for {turns} turns.` — name the `property` in lowercase ("physical"/"magical"), or **"TRUE" in caps** for true. **Never say "all"/"all types."** Guard only ever reduces damage of its own matching `property` (`src/engine/combat/interpreter.ts`, the guard loop keys off `s.property !== property`) — a TRUE guard blocks TRUE damage ONLY, not physical/magical too. (A 2026-08-06 bug: `purify_echo`'s text claimed "all types" for a TRUE-property guard; the gem only ever cut TRUE damage. Fixed in data + this row — don't reintroduce it.) |
| `negate` | `Negate the next {charges} {property} attack(s).` — name the `property` in lowercase ("physical"/"magical"), or **"TRUE" in caps** for true. **Never say "any."** Negate is the same matching-`property` shape as guard (`s.property === property` in the interpreter) — a TRUE negate cancels TRUE hits ONLY. Singular "attack" and NO numeral if `charges` = 1 (the drift guard exempts `charges = 1`, mirroring `stun`). |

Examples from the live card set: `arcane_bolt` → `"Deal 18 (+MATK) Lightning
damage."`; `mending_light` → `"Restore 48 (+MDEF) HP."`; `iron_bulwark` →
`"Gain 48 (+DEF) physical shield."`; `soul_rend` → `"Deal 27 (+best stat)
TRUE damage — ignores DEF/MDEF."`

#### Which stat token: the ROLE picks the side, the property picks the stat

The `(+STAT)` token is NOT a function of the card's `property` alone. The
card's `property` picks WHICH stat; the ROLE of that clause picks WHICH SIDE
of the stat sheet to read (user-approved 2026-08-04, engine commit `9960720`;
`scaleStat` / `scaleDefStat` in `src/engine/combat/interpreter.ts`):

| Clause role | physical | magical | TRUE |
|---|---|---|---|
| OFFENSE — `damage` | `(+ATK)` | `(+MATK)` | `(+best stat)` |
| DEFENSE — `shield`, `heal` | `(+DEF)` | `(+MDEF)` | *no token* (flat by identity) |

Two consequences worth stating, because both look like mistakes and are not:

- **One card may carry two different tokens.** A card that attacks *and*
  shields correctly reads `"Deal 20 (+ATK) Sword damage · Gain 18 (+DEF)
  physical shield."` The tokens differ because the roles differ.
- **The token is not a re-price.** ATK/MATK/DEF/MDEF all cost 1 PL per +1
  and all start at 1, so the output bought per PL spent is unchanged — only
  WHICH stat buys it moves. Never "rebalance" a card because its token changed.

### Riders

| Rider | Template |
|---|---|
| `slow` | `{{Slow}} the enemy's next action by +{weight} weight.` |
| `disrupt` | `{{Disrupt}} {amount} banked readiness.` (joined with `and`) |
| `lifesteal` | `heal for {pct}% of the damage dealt.` (joined with `and`, always follows `damage`) |
| `shieldBreak` | `Shatter up to {amount} enemy shield, then` — leads the sentence, main verb follows in lowercase. |
| `comboBonus` | `+{pct}% if your previous cast was also a(n) {Archetype} card.` (joined to the main clause with `;`, *trailing* — see below) |

### Gem rider phrasing (`src/data/gems.ts`)

Gems append a `damage`/`heal`/`shield` action onto whichever card they're
socketed into, so a gem's own text can't name a specific stat — it inherits
the HOST CARD's scaling stat at cast time, resolved by the same ROLE rule as
main-card text: a `damage` gem reads ATK/MATK (higher of the two for TRUE),
while a `heal`/`shield` gem reads DEF/MDEF. The old `"(+stat)"` placeholder
read like a raw variable name; the fix keeps the same number-first shape as
main-card text but spells out both stats the gem could possibly scale with:

| Gem action | Template |
|---|---|
| `damage` | `+{power} damage (+ATK/MATK).` |
| `heal` | `+{power} HP (+DEF/MDEF).` |
| `shield` | `+{power} shield (+DEF/MDEF).` |

**No leading "Also" (2026-08-06 fix).** Gem text never gets concatenated
after a host card's text — every render site (shop shelf, wiki gem list,
event reward panel, deck-build socket row) shows a gem's `text` completely
standalone, in its own box, never appended to another card's sentence. An
opener that means "in addition to [the preceding clause]" when there is no
preceding clause is a dangling fragment, not a style choice — this was
raised more than once and is now the locked rule: **gem text never starts
with "Also".** Every gem line must read as a complete, self-contained
phrase:

- **Effects whose template already opens on a symbol or a `{{Keyword}}`
  token** (a leading `+`/`-` number, or a capitalized keyword like `{{Slow}}`,
  `{{Lifesteal}}`, `{{Shatter}}`, `{{Disrupt}}`, `{{Combo}}`) — just drop
  "Also "; the result is already a well-formed fragment, no other edit
  needed. Covers `damage`/`heal`/`shield` (above), `slow`, `lifesteal`,
  `shieldBreak`, `disrupt`, `comboBonus`, `buffStat`, `debuffStat`, and
  `guard`, e.g. `{{Slow}} the enemy's next action by +8 weight.`,
  `-10% enemy DEF (2 turns).`, `-20% incoming TRUE damage (1 turn).`
- **Effects whose template opens on a bare lowercase verb** (`poison`,
  `burn` use `apply {{Keyword}} ...`) — drop "Also " AND capitalize the
  verb, since it is now the sentence-initial word: `apply {{Poison}} 2
  (poison bypasses shields).` → `Apply {{Poison}} 2 (poison bypasses
  shields).` Dropping "Also" alone here would leave a lowercase orphaned
  verb, which is not a complete phrase.

Every gem's `text` must still stand alone as a complete phrase with no
lead-in — this is the same requirement as any other card text, just without
an "Also" shortcut to paper over it.

### Composing multi-effect cards

Data order in `effects[]` and sentence order are **not always the same** —
follow these rules, which match the existing 26 cards:

1. **`shieldBreak` leads the sentence** (data-first, prose-first): `"Shatter
   up to {amount} enemy shield, then deal {power} (+STAT) ... damage."`
2. **The main verb clause** comes next (or first, if no `shieldBreak`):
   damage / heal / shield / poison / burn / stun / buffStat / debuffStat,
   using the templates above.
3. **Trailing riders** follow the main verb, in the same order they appear in
   `effects[]`, each joined with `and` (for a second mechanical effect —
   e.g. `poison`, `debuffStat`, `disrupt`, `lifesteal`) or `;` (for
   `slow` and `comboBonus`, which read as asides rather than parallel
   clauses).
   - `comboBonus` is a data-first effect but a **prose-last** rider: even
     though it appears first in `effects[]` (it must multiply the damage
     that follows), it is *phrased* as a trailing conditional — see
     `follow_through`: `"Deal 10 (+ATK) Sword damage · +20 if previous cast
     was Offense."`
4. **One optional trailing flavor clause** last (see §3).

Worked examples from the current card set (verbatim `text`, post the
2026-08-04 number-first pass):

- `shield_splitter` (shieldBreak → damage): `"{{Shatter}} 24 enemy shield,
  then deal 42 (+ATK) Axe damage."`
- `venom_fang` (damage → poison): `"Deal 12 (+ATK) Beast damage ·
  {{Poison}} 5 (poison bypasses shields)."`
- `leeching_fang` (damage → lifesteal): `"Deal 16 (+ATK) Beast damage ·
  heal 45% of damage dealt."`
- `hamstring` (damage → slow): `"Deal 12 (+ATK) Lance damage · {{Slow}}
  the enemy's next action by +16 weight."`
- `follow_through` (comboBonus → damage, phrased damage-then-bonus):
  `"Deal 10 (+ATK) Sword damage · +20 if previous cast was Offense."`
- `frost_ward` (`guard`, sole effect): `"-50% incoming magical damage
  (2 turns)."`
- `ward_of_silence` (`negate`, sole effect): `"{{Negate}} the next magical
  attack."`

---

## 3. Style rules

- **Numbers**: always whole integers, no decimals, no leading zeros.
  Percentages are `{n}%` with no space before the `%`. A number in text must
  always equal the corresponding field in `effects` — this will be enforced
  by an automated drift-guard test, so never round or approximate in prose.
- **Stat names**: capitalize proper stat names exactly as in the §1 table
  (Attack, Magic Power, Armor, Magic Resist, Speed, Crit Chance, HP). Name
  the scaling stat explicitly for every physical/magical damage, heal, and
  shield effect. Omit the stat name for TRUE effects — say "your higher
  power stat" for true damage, or nothing at all for true heal/shield/flat
  effects (the flat number speaks for itself — the omitted "(+Stat)" is the
  cue that nothing is added).
- **Flavor / clarifying clauses**: at most **one** optional trailing clause
  per card, appended after every mechanical clause, separated by a period or
  em dash. It may restate a matchup rule (`"Bows are strong against
  Beasts."`), a tempo note (`"Heavy (weight 24)."`, `"Light and quick (weight
  8)."`), a span note (`"Spans 3 turns."`), or a mechanical disambiguation
  (`"poison bypasses shields"`). It must never introduce a mechanical claim
  that isn't backed by `effects` or `speedWeight`/`size` data.
- **Tense / voice**: imperative present tense, addressed to the caster
  implicitly (no "You deal..." — just "Deal...", "Gain...", "Restore...",
  "Reduce...", "Remove..."). The opponent is always "the enemy" /
  "the enemy's" (never "your opponent", "the foe", etc.).
- **Sentence count**: one sentence for the mechanical effect(s) (joined with
  `and`/`;` per §2), plus at most one more sentence/clause for flavor. Do not
  split a single card's effects across more than two sentences.

---

## Drift guard (forthcoming)

A test will parse the numbers embedded in each card's `text` and assert they
match `effects` exactly (power/amount/turns/pct/weight values). When adding
or editing a card, always update text and data together, using the templates
above, so that test stays green.
