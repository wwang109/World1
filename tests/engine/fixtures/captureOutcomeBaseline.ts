/**
 * Regenerates `outcomeBaseline.json` from the CURRENT engine.
 *
 *   npx tsx tests/engine/fixtures/captureOutcomeBaseline.ts
 *
 * The fixture is a REGRESSION LOCK, not a spec: it pins the exact logs of the
 * shared sweep (`tests/engine/helpers/sweepConfigs.ts`) so that a change which
 * is supposed to be scoped to one mechanic cannot silently move anything else.
 * `outcomeRule.test.ts` reads it to guard the ATTRITION THRESHOLD BOUNDARY —
 * fights decided before turn `ATTRITION_START_TURN` must be untouched by
 * attrition work.
 *
 * Regenerate ONLY for a deliberate, reviewed rule change (and say so in the
 * `note` below), never to make a red test go green. Prints a per-case diff
 * against the existing fixture so the blast radius is visible.
 *
 * Not a `*.test.ts` file, so vitest never collects it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { simulate, ATTRITION_START_TURN } from '../../../src/engine/combat/simulate';
import { sweepCases } from '../helpers/sweepConfigs';
import { outcomeHash as hash } from '../helpers/outcomeHash';
import type { CombatConfig } from '../../../src/engine/types';

const OFF = 1_000_000;
const OUT = new URL('./outcomeBaseline.json', import.meta.url);

interface Entry {
  result: string;
  turns: number;
  hash: string;
}

function capture(extra: Partial<CombatConfig>): Entry[] {
  return sweepCases(0xba5e11, 200, { maxTurns: 200, ...extra }).map(({ config, seed }) => {
    const r = simulate(structuredClone(config), seed);
    return { result: r.result, turns: r.turns, hash: hash({ events: r.events, finalState: r.finalState, result: r.result }) };
  });
}

const next = {
  normalization:
    'Hashes are taken through tests/engine/helpers/outcomeHash.ts (shared with outcomeRule.test.ts), ' +
    'which strips PRESENTATION/AUTHORING-ONLY card fields before hashing: `text` anywhere, `name` ' +
    'on SkillDef-shaped objects, and (2026-08-17) `tierUpgrades` on SkillDef-shaped objects. The ' +
    'sim reads none of them at resolved-skill time, so a content copy-edit or a tier-authoring ' +
    'change no longer forces a fixture regeneration. Everything the engine consumes — the full ' +
    'event log, all combatant state (incl. each combatant `name`), and every behavioural SkillDef ' +
    'field (effects, property, size, speedWeight, cooldownTurns, tier, rarity, element, weapon, ' +
    'scope, aura, special) — is still hashed byte-for-byte. OBJECT KEYS ARE SORTED before ' +
    'stringify (2026-08-09), so the hash is a function of VALUES ONLY and no ' +
    'rebuild-in-a-different-field-order can churn it. ARRAY order is untouched and ' +
    'still fully load-bearing.',
  note:
    'Regression lock recaptured (2026-08-18) for the SLOW LIFETIME RULE — a REAL, REVIEWED RULE ' +
    'CHANGE, user-locked verbatim: "a slow is only applied to that 1 card and doesn\'t stay — so ' +
    'after the turn it was applied on, the slow effect is removed". The engine did not do that. ' +
    'The unit-scope tax (`CombatantState.nextWeightPenalty`) was cleared ONLY in the perform path ' +
    '(after the `cost` event), which is an "until you next act" lifetime, not a turn lifetime: a ' +
    'victim too poor to pay the taxed weight kept the tax INDEFINITELY, and every fresh slow ' +
    '`Math.max`ed on top of a debt it had never discharged — the audited lockout of 5 performances ' +
    'in 40 turns. THE NEW RULE: the tax has two exits and takes whichever comes first — the ' +
    'victim\'s next resolved cast THIS TURN (which pays it, exactly as before), or the END OF THAT ' +
    'TURN, which drops it PAID OR NOT. The new clear is one line in the turn loop beside ' +
    '`expireStatuses` (`for (const c of units) c.nextWeightPenalty = 0;`), deliberately placed ' +
    'AFTER the resolve loop (a slow landed early in a turn still taxes a victim that performs later ' +
    'in that same turn) and AFTER the `wait` explanation pass (a `cantAfford` line still reports ' +
    'the taxed weight that actually stopped the unit). A victim who is stunned, busy mid-span, ' +
    'cooling or simply cannot afford the taxed weight now carries NOTHING forward, so accumulation ' +
    'across turns is impossible BY CONSTRUCTION and the engine deliberately adds no clamp. It emits ' +
    'no new event — the `end` event immediately after it already marks the boundary. ' +
    'BLAST RADIUS verified BEFORE regenerating, from a read-only RAW dump (full event log + turns + ' +
    'result + finalState, NOT normalized, NOT hashed) of both 200-fight sweeps taken immediately ' +
    'before and immediately after the change: 100/200 logs moved in EACH sweep. Of those 100, 82 ' +
    'are EVENT-LOG movers and 18 have a BYTE-IDENTICAL event log and differ only in finalState — ' +
    'and for all 18 the complete set of differing field paths is `nextWeightPenalty` alone, whose ' +
    'residual values are 8, 12 and 16: exactly `chain_spark`, `frost_shackle` and `hamstring`\'s ' +
    'authored slow weights, left pending in a fight that ended mid-turn and now zeroed. Fights get ' +
    'SHORTER, which is what un-stalling a victim must do: 16 turn changes with attrition off (15 ' +
    'shorter, 1 longer) and 17 with it on, and 3 winner flips in each (#155, #181, #188, all ' +
    'win->loss, the same three cases in both sweeps). CONTAINMENT PROVEN BY EXHAUSTION, BOTH ' +
    'DIRECTIONS: 0/400 logs moved without carrying one of the frozen pool\'s three slow cards, and ' +
    '0/400 moved without an actual `slowed` event in the log — and for every one of the 82 ' +
    'event-log movers the FIRST divergence is at or after that log\'s first `slowed` event, with ' +
    'the diverging event kinds exclusively tempo-shaped (33 performStart, 30 play, 13 wait, 5 ' +
    'wait->performStart, 1 noPerformer->performStart) — no damage/heal/status kind diverges first. ' +
    'In the other direction 136/200 configs carry a slow card and 36 of them did NOT move: 31 never ' +
    'emitted a `slowed` event at all (the card was never reached), and the remaining 5 are ' +
    'enumerated individually — #19, #52, #161 and #186 END on the very turn the slow lands (the ' +
    'victim never plays again and the end-of-turn clear is never reached), and #101\'s victim PAID ' +
    'the tax inside the same turn it landed, which both rules resolve identically. `splash` ' +
    '(`PieceState.nextWeightPenalty`, card scope) is DELIBERATELY UNCHANGED and cannot appear here ' +
    'anyway: its only carrier, `shockwave_slam`, is not in the frozen sweep pool. No price moved ' +
    '(`PRICE.slowPerWeightNum/Den` untouched), so every slow card still lands exactly on its tier ' +
    'budget and balance.test.ts is green — the honesty of that rate against the weaker effect is ' +
    'flagged for a separate balance pass, not patched here. See src/engine/combat/simulate.ts (the ' +
    'end-of-turn clear beside `expireStatuses`), src/engine/combat/interpreter.ts (the `slow` arm), ' +
    'src/engine/combat/state.ts, src/engine/types.ts, src/engine/combat/castSelect.ts and ' +
    'tests/engine/slowLifetime.test.ts. It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-18) for the EXPOSE APPLICATION RULE — a REAL, REVIEWED '  +
    'RULE CHANGE closing a pricing defect LIVE on shipped content. The 2026-08-17 regen below made '  +
    'expose ONE PILE PER VICTIM, REFRESHED, taking `max(pct)` and the longer duration. That let a '  +
    'WEAK application deliver a STRONG one\'s amplification: with `ruinous_hex`\'s pile (50%/2t, '  +
    'priced 100 deci) standing, every `piercing_arrow` cast (authored 30%, priced 30 deci) emitted '  +
    '`pct=50` and re-armed the window — a third of the price for the whole effect, on two cards '  +
    'that both ship and are both in the frozen sweep pool. The same branch ran for ANY expose '  +
    'action whatever its pct and set `fresh = true` every time, and `expireStatuses` skips a fresh '  +
    'pile\'s decrement, so a card whose cadence was no longer than its duration held its pile '  +
    'FOREVER (an "expose 10% for 1 turn" on a 0-cooldown rotation measured 20 applications / 0 '  +
    'expiries) and an `expose pct: 0` action — priced at nothing — kept a standing 50% pile alive '  +
    'indefinitely. THE NEW RULE: applications are SEPARATE and never compound. `dealDamage` '  +
    'amplifies by the STRONGEST standing pile (max, not sum — compounding accelerates without '  +
    'bound and would break expose\'s parity pricing with `guard`, whose own stacking diminishes). '  +
    'The pile set is an ANTICHAIN: an application some standing pile dominates (>= pct AND >= '  +
    'turnsLeft) is ABSORBED — no pile, no refresh, no ward spent, no event; an application that '  +
    'dominates standing piles REPLACES them (each dropped with its own `statusExpired` before the '  +
    'new `statusApplied`, so a replay\'s status set cannot desync); anything else COEXISTS and the '  +
    'max rule reads whichever is strongest per hit. An `expose` of 0% or 0 turns applies nothing '  +
    'at all (it would otherwise be a free affliction — anti-heal trigger, cleanse bait, ward drain '  +
    '— bought for 0 deci). The invariant satisfied in BOTH directions: a card delivers what it was '  +
    'priced for whatever else is on the target — it can neither borrow a stronger card\'s pct nor '  +
    'have its own weakened by a cheaper recast. BLAST RADIUS verified BEFORE regenerating, from a '  +
    'read-only RAW dump (full event log + turns + result + finalState, NOT normalized, NOT hashed) '  +
    'of both 200-fight sweeps taken immediately before and immediately after the change: 6/400 '  +
    'logs moved (3 fights, each appearing in both sweeps), with ZERO winner flips and ZERO turn '  +
    'changes. CONTAINMENT PROVEN BY EXHAUSTION: 194/400 configs carry `ruinous_hex` or '  +
    '`piercing_arrow` (the frozen pool\'s only expose carriers) and ALL 6 movers are inside that '  +
    'set — 0 moved without one. Every mover\'s FIRST divergence is an expose event, enumerated '  +
    'individually: #042 and #079 (a second application now SUPERSEDES a shorter-lived pile: '  +
    '`statusExpired` then `statusApplied`, +1 event) and #109 (a dominated application is now '  +
    'ABSORBED outright, -1 event). The 188 carrying configs that did NOT move never had two expose '  +
    'windows overlap on one victim, which is the only situation the rule changes. TWO OTHER '  +
    'DEFECT FIXES RODE IN THE SAME CHANGE AND MOVED 0/400 LOGS, which is itself the evidence they '  +
    'are contained: (1) `autoScaleTier` (src/engine/cards.ts) no longer re-derives its own copy of '  +
    'the price — it prices every candidate kit through `powerLevelDeci` itself, closing a FOURTH '  +
    'mirror whose `actionsPriceDeci` calls dropped `scope` (an AoE card was solved at '  +
    'single-target prices and then priced at the 1.32x reach multiplier: 32% OVER budget at every '  +
    'tier) and whose multi-hit premium was hand-rolled; no shipped card sets `scope`, and tier '  +
    'resolution never runs in this sweep (no piece carries a tier); (2) a triggered `comboBonus` '  +
    'is now SPENT by the first damage action that reads it, instead of being accumulated and read '  +
    'again by every own-hit of a multi-hit host (`follow_through_echo`\'s +16 was landing +16 on '  +
    'EACH of Barrage\'s / Rapid Volley\'s / Twin Slash\'s two hits); the book\'s only '  +
    'comboBonus-authoring card, `follow_through`, has exactly one damage action, and no sweep '  +
    'board sockets a gem. See src/engine/combat/interpreter.ts (the `expose` arm, `dealDamage`\'s '  +
    'expose read, `readsComboBonus`), src/engine/cards.ts (`autoScaleTier`), '  +
    'tests/engine/bleedExpose.test.ts, tests/engine/comboBonus.test.ts and '  +
    'tests/engine/tierUpgrades.test.ts. '  +
    'It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-17) for the EXPOSE DURATION FIX — a REAL, REVIEWED RULE ' +
    'CHANGE, and a defect fix rather than a design pass. `expose` was the ONLY turn-durationed ' +
    'status missing from `expireStatuses`\'s decrement set (stun decrements on consumption, DoTs in ' +
    'tickTurnDot/tickBleed, negate/ward are charge-based, thorns is stack-based), so its ' +
    '`turnsLeft` was NEVER decremented: a card priced `pct x turns` (`exposePerPctTurnNum`, ' +
    'balance.ts) delivered `pct x infinity`. Compounded by `applyAction`\'s expose arm calling ' +
    '`addStatus` with no merge, so every recast opened ANOTHER pile and `dealDamage` multiplied ' +
    'them: a card printing "expose 50% for 1 turn", recast on its rotation, measured 30 -> 45 -> ' +
    '67 -> 100 -> 181 -> 316 -> 546 -> 913 -> 1531 damage on a fixed 20-power hit, with ZERO ' +
    '`statusExpired` events. FIX, both halves: (a) the decrement set is now the named, exhaustive ' +
    '`TURN_DURATIONED_STATUS_KINDS` (buff/debuff/guard/expose) in combat/state.ts, which also ' +
    'documents the mechanism expiring every OTHER kind, so a kind belonging to none is a red test ' +
    'rather than a silent infinity; (b) expose is ONE PILE PER VICTIM, REFRESHED — a ' +
    're-application takes the STRONGER pct and the LONGER remaining duration and becomes `fresh` ' +
    'again. REFRESH rather than a second pile (the `guard` precedent) or a stack merge (the ' +
    'DoT/thorns precedent) because `dealDamage` compounds piles MULTIPLICATIVELY and the two ' +
    'mirrors compound in OPPOSITE directions: guard\'s second pile is worth less than its first ' +
    '(50% then 50% leaves 25%, diminishing), expose\'s is worth MORE (+50% then +50% is x2.25, ' +
    'accelerating) — so guard-parity pricing only survives if the offensive mirror does not stack. ' +
    'Merging `pct` would have breached the documented <=50 apply-time clamp on the first recast. ' +
    'The engine already draws this line for the other offensive non-additive debuff (`slow` takes ' +
    'the strongest pending value). Ward still taxes a refresh exactly as it taxes a DoT merge. ' +
    'BLAST RADIUS verified BEFORE regenerating, from a read-only RAW dump (full event log + turns ' +
    '+ result + finalState, NOT normalized, NOT hashed) of both 200-fight sweeps taken immediately ' +
    'before and immediately after the change: 59/200 logs moved in EACH sweep (141/200 ' +
    'byte-identical), with 4 turn changes + 1 winner flip in attritionOn (#35 6->7, #84 11->12, ' +
    '#106 10->11, #177 6->8, #93 win->loss) and 5 turn changes + 1 winner flip in attritionOff ' +
    '(the same five cases, #93 additionally 17->18). Fights get LONGER and the player loses more ' +
    'of them — exactly what removing an unbounded damage amplifier must do. CONTAINMENT PROVEN BY ' +
    'EXHAUSTION, BOTH DIRECTIONS: 0/400 logs moved without APPLYING an expose, and the moved set ' +
    'is a subset of the 97/200 configs carrying `ruinous_hex` (50%/2t) or `piercing_arrow` ' +
    '(30%/2t) — the frozen sweep pool\'s only expose carriers. Of the 11 logs that DID apply an ' +
    'expose yet did not move: 9 ended within the pile\'s own window (endTurn <= applyTurn + 2, so ' +
    'neither engine ever reached a decrement that mattered) and 2 (#44, #89) had the pile CLEANSED ' +
    'before the first divergence — enumerated individually, not inferred. THREE OTHER DEFECT FIXES ' +
    'RODE IN THE SAME CHANGE AND MOVED 0/400 LOGS, which is itself the evidence they are contained: ' +
    '(1) a caster killed mid-cast (only thorns reflect can do it) now stops casting via ' +
    '`castCutShort` = `!caster.alive || anySideWiped` in `applyCast`, replacing a bare ' +
    '`anySideWiped` that was accidentally correct at 1v1 and wrong in every pack fight; (2) a hit ' +
    'fully nullified by `negate` no longer spends a thorn stack (`dealDamage` now REPORTS whether ' +
    'it took effect and `applyStrike` reflects only then); (3) a negative heal request is CLAMPED ' +
    'TO ZERO at the new shared `restoreHp` seam instead of driving HP below zero with `alive` ' +
    'still true and emitting nothing. None can reach this sweep: NEITHER thorns card ' +
    '(`bramble_ward`, `nettle_lash`) is in the frozen sweep pool, and every authored `healFlat` in ' +
    'the book and gem set is positive. See src/engine/combat/simulate.ts (`expireStatuses`), ' +
    'src/engine/combat/state.ts (`TURN_DURATIONED_STATUS_KINDS`), src/engine/combat/interpreter.ts ' +
    '(the `expose` arm, `castCutShort`, `dealDamage`\'s return, `restoreHp`) and ' +
    'tests/engine/statusExpiry.test.ts, tests/engine/casterDeathMidCast.test.ts, ' +
    'tests/engine/healSafety.test.ts, tests/engine/thorns.test.ts. ' +
    'It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-17) for STRIPPING `tierUpgrades` from the hash — a ' +
    'REPRESENTATION-ONLY change that moves EVERY hash and NO behaviour. `tierUpgrades` is ' +
    '*input* consumed only by `applyTier`/`autoScaleTier` (src/engine/cards.ts) at resolve time; ' +
    'the combat loop never reads it. `resolveEffectiveSkill` returns an UNTIERED piece\'s base ' +
    '`SkillDef` BY REFERENCE (`piece.tier ? applyTier(def, piece.tier) : def`), so its ' +
    '`tierUpgrades` rode along into the hash unread — editing an unused tier block used to move ' +
    'the lock for zero behaviour change. For a TIERED piece the field was never the sole carrier ' +
    'of a difference either: `applyTier` folds any authored override or the auto-scaler\'s derived ' +
    'numbers into `effects`/`tier` on the SAME resolved object the hash sees, so a real tier-block ' +
    'change still moves the hash through those fields with `tierUpgrades` itself excluded. WHY NOW: ' +
    'unblocks deleting purify\'s three hand-authored `tierUpgrades` blocks (silver/gold/diamond) — ' +
    'filler TRUE heals bolted on before cleanse could scale with tier — now that `autoScaleTier` ' +
    'derives the same budget-honest cleanse-charge ladder (6/8/10) on its own (see ' +
    'tests/engine/tierUpgrades.test.ts, cleanse tier-scaling user-locked 2026-08-17). CONTAINMENT ' +
    'PROVEN, in the strongest available form: a read-only raw `simulate` dump (full event log, ' +
    '`turns`, `result`, `finalState` — NOT normalized, NOT hashed) over both 200-fight sweeps, ' +
    'taken immediately before and immediately after the normalizer edit, was byte-identical in ' +
    'all 400 cases (SHA-256 of the two dumps matched exactly) — proving `simulate()` itself was ' +
    'untouched and only the hash DOMAIN moved. Blast radius on the hash itself: 200/200 attritionOn ' +
    'and 200/200 attritionOff logs changed (188/200 of each decided before ATTRITION_START_TURN), ' +
    'because 25 of the book\'s 72 skills carry an authored `tierUpgrades` block and all 25 are in ' +
    'the frozen sweep pool (tests/engine/fixtures/frozenSweepSkillIds.ts) — with boards drawing ' +
    'several pieces each, nearly every fight includes at least one. `result` and `turns` moved in ' +
    '0/400 cases (confirmed against `prev` below): every diff is attributable to bytes leaving the ' +
    'hash input, not to any change in what was simulated. ACCEPTANCE TEST, run immediately after ' +
    'this regeneration: deleting purify\'s three `tierUpgrades` blocks moved 0/400 of THIS baseline ' +
    '(vs 200/200 before this normalizer change) — direct proof the narrowing does what it claims. ' +
    'See tests/engine/helpers/outcomeHash.ts. It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-09) for CANONICAL KEY ORDER in the hash ' +
    'normalizer — a REPRESENTATION-ONLY change that moves EVERY hash and NO ' +
    'behaviour. `outcomeHash` ends in JSON.stringify, which serialises object keys ' +
    'in INSERTION order, so until now the physical FIELD ORDER of every hashed ' +
    'object fed the lock. That is not a behaviour: nothing in the engine iterates ' +
    'Object.keys of a SkillDef to decide anything, and the card literals in ' +
    'src/data/skills.ts already order their fields inconsistently (some put `weapon` ' +
    'before `size`, some after). normalizeForHash now sorts keys at every depth; ' +
    'ARRAY order is deliberately left alone, because array order IS behaviour here ' +
    '(effects fire in order, the event log is a sequence). ' +
    'WHY NOW: this is a PREREQUISITE for the content-format migration. A loader that ' +
    'builds SkillDef objects from a data file necessarily picks its own key order, ' +
    'and would otherwise have re-hashed all 400 cases for a provably ' +
    'behaviour-neutral change — a regeneration whose churn could hide a real ' +
    'regression, which is precisely what this fixture exists to prevent. Paying it ' +
    'ONCE here, in isolation, buys permanent immunity: from now on only VALUES can ' +
    'move a hash. ' +
    'CONTAINMENT PROVEN, and in the strongest available form — the sim output was ' +
    'shown to be UNCHANGED rather than merely similar. Read-only probe over both ' +
    '200-fight sweeps, BEFORE regenerating: (a) the CURRENT engine reproduced ' +
    '400/400 of the OLD fixture hashes under the OLD normalizer, so the simulation ' +
    'is byte-identical and every delta below is attributable to the normalizer ' +
    'alone; (b) result moved 0/400 and turns moved 0/400; (c) re-hashing THAT SAME ' +
    'unchanged sim output under the sorted normalizer moved 400/400 hashes (0/400 ' +
    'were already in canonical order — consistent with `id` leading every SkillDef ' +
    'literal while sorting demands `archetypes` first). A pure key-order delta is ' +
    'therefore the only thing in this regeneration. ' +
    'INCIDENTALLY PROVEN, and worth recording: (a) held the whole time an unrelated ' +
    'in-flight engine change (the echo-gem statStrike `echoHostPower` / gem ' +
    '`weightIncreasePct` work) was present in the tree — reproducing 400/400 old ' +
    'hashes is a direct proof that work is sweep-neutral, as its own byte-identity ' +
    'claim predicted; and (b) the same 400/400 reproduction re-confirms that ' +
    'FREEZING the sweep id pool (tests/engine/fixtures/frozenSweepSkillIds.ts, ' +
    '2026-08-08) cost zero regeneration. ' +
    'See tests/engine/helpers/outcomeHash.ts and the key-order guards in ' +
    'tests/engine/outcomeHash.test.ts. It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-07) for the MULTI-HIT STAT SPLIT ' +
    '(user-locked 2026-08-07): a REAL, REVIEWED RULE CHANGE that moves real damage ' +
    'numbers. The caster\'s scaling stat (Attack / Magic Power / higher for TRUE) is ' +
    'now a PER-CAST resource split across a cast\'s `damage` actions, not a full add ' +
    'RE-DELIVERED by each one. Twin Slash at ATK 20 was 2x(6+20) = 52 and is now ' +
    '2x(6+10) = 32; a cast\'s total stat contribution is finally HIT-COUNT-INVARIANT. ' +
    'WHY: multi-hit previously scaled SUPERLINEARLY with hero stats (a 3-hit card ' +
    'delivered 3x the stat) while powerLevelDeci priced only the summed flat base ' +
    'plus a FLAT PRICE.extraHitPremium — a fixed 3 PL against an effect worth ' +
    '(hits-1)x(ATK-DEF), i.e. ~1 PL at ATK 10 but ~21 PL at ATK 50 and ~40 PL at the ' +
    'level-30 ceiling. Splitting the stat is what makes an honest flat price possible ' +
    'at all. The split is exact integer arithmetic (`statShare`): shares sum to ' +
    'EXACTLY the stat for any hit count and any sign, with the remainder FRONT-LOADED ' +
    '(earlier hits carry the odd point) so the share most likely to land before a ' +
    'first-to-fall break is the larger one. At one hit it is the IDENTITY, so every ' +
    'single-hit card in the book is byte-identical. GEM-APPENDED damage actions JOIN ' +
    'the split (the count is taken from the EFFECTIVE effect list), which is what ' +
    'makes the user-reported case behave as printed: soul_rend_echo ("+16 damage") ' +
    'used to deliver +36 at ATK 20 and +66 at ATK 50, and now delivers exactly +16 on ' +
    'every host at every stat line. [SUPERSEDED IN PART, SAME DAY — NO REGENERATION: ' +
    'gem-appended hits were REMOVED from the split\'s divisor and made unbuffable ' +
    '(see `GemAppended` in src/engine/types.ts). Joining the divisor made a "+damage" ' +
    'gem net-NEGATIVE against armor (-4 on sword_slash at DEF 8, -9 at DEF 16) because ' +
    'it took a share from the base hit AND paid mitigation a second time. A gem hit is ' +
    'now self-contained: outside the divisor, no stat share, no mods.damageFlat, no ' +
    'comboBonus — so it still delivers exactly +16, and the host card is untouched. ' +
    'The fixture below is UNCHANGED and was NOT recaptured: the sweep ' +
    '(tests/engine/helpers/sweepConfigs.ts) sockets NO gems at all and no card uses the ' +
    'new `statStrike` action, so a read-only recompute moved 0/200 logs in BOTH sweeps. ' +
    'Rules are pinned in tests/engine/gemStrike.test.ts.] DELIBERATELY UNCHANGED (user-locked the same ' +
    'day): `mods.damageFlat` — card-scope stat gems and board auras — and a ' +
    'triggered `comboBonus` still apply IN FULL to EVERY hit, so a +4 card-scope gem ' +
    'is still worth +8 on a 2-hit card. Blast radius verified BEFORE regenerating, ' +
    'over both 200-fight sweeps: 94/200 logs moved in EACH (89 of them decided before ' +
    'ATTRITION_START_TURN), with 1 winner flip (#8, the same log in both sweeps) and ' +
    '18 turn changes — the expected consequence of multi-hit casts hitting for less. ' +
    'CONTAINMENT PROVEN BY EXHAUSTION, BOTH DIRECTIONS: the moved set is EXACTLY the ' +
    'set of logs that CAST twin_slash, rapid_volley or barrage (the book\'s only ' +
    'multi-damage-action cards) — 0 logs moved without casting one, and 0 logs that ' +
    'cast one stayed put. 124/200 configs carry one on a board; the 30 that carry one ' +
    'yet did not move are precisely those where it never fired, proven by their bytes ' +
    'standing still. NOT REPRICED HERE (deliberate, out of this agent\'s scope): ' +
    'PRICE.extraHitPremium still charges 30 deci for what is now a strictly WEAKER ' +
    'effect (multi-hit still eats mitigation once per hit, so it is now worse than a ' +
    'single-hit card of the same budget against armor), and the user\'s tier/slot ' +
    'gate for multi-hit cards is a balance-designer pass on top of this one. See ' +
    'src/engine/combat/interpreter.ts (`HitSplit`, `statShare`, `countDamageActions`, ' +
    'the `damage` case and `applyCast`) and tests/engine/multiHit.test.ts. ' +
    'It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-06) for the HEAL DERIVATION BLOCK ' +
    '(`heal.calculation`): an ADDITIVE, PRESENTATION-ONLY EVENT FIELD — NOT a rule ' +
    'change. The sim reads nothing from it and every number it reports was already ' +
    'being applied. The heal event now carries { power, statBonus, healFlat, ' +
    'property }, the sibling of shieldGain.calculation, so the battle log can print ' +
    '"H: base 48 + (1 MDEF) - (9 ANTI-HEAL) = 40" instead of a request that appears ' +
    'from nowhere; the alternative — re-deriving the split in the renderer — would ' +
    're-run gem/aura/stat resolution outside the engine and could silently disagree ' +
    'with it. TRUE heals report a ZERO stat term (flat by identity, exactly as TRUE ' +
    'shields do), and the OTHER emitter of this event, the LIFESTEAL rider, OMITS ' +
    'the block entirely: its request is a percentage of damage dealt, with no card ' +
    'base and no stat term to split (same contract as damage.calculation, which ' +
    'DoT/fatigue/attrition damage omits). Blast radius verified BEFORE regenerating, ' +
    'over both 200-fight sweeps and IDENTICAL in each: 137/200 logs moved (128 of ' +
    'them decided before ATTRITION_START_TURN), with ZERO winner flips and ZERO turn ' +
    'changes — the signature of a field the sim never consumes. CONTAINMENT PROVEN ' +
    'BY EXHAUSTION, both directions: the moved set is EXACTLY the set of logs ' +
    'containing a heal-ACTION heal (0 logs moved without one; 0 logs carrying one ' +
    'stayed put). 142 logs contain a heal event at all, and the 5 that did NOT move ' +
    '(#4, #14, #92, #142, #192) are precisely the logs whose ONLY heal is a ' +
    '`leeching_fang` LIFESTEAL — the deliberate omission above, proven by their ' +
    'bytes standing still. 45 of the moved logs carry only zero-term (TRUE/flat) ' +
    'heal calculations: they move because the BLOCK itself is new, unlike the ' +
    '2026-08-05 stat-scaling regen where zero-term heals stayed put. ON THE ' +
    'NORMALIZER (see `normalization` above): stripping `calculation` there instead — ' +
    'which would have cost no fixture churn at all — was evaluated FIRST and ' +
    'REJECTED. It is engine-derived ARITHMETIC, not authored copy: two heals with ' +
    'the same landed amount but a different (power, statBonus, healFlat) split are a ' +
    'real difference in the sim\'s math, and this lock is what would catch it. A ' +
    'blanket strip would also drop the ALREADY-HASHED damage.calculation and ' +
    'shieldGain.calculation and re-hash nearly every one of the 200 logs — a BIGGER ' +
    'regeneration buying permanently LESS coverage. See ' +
    'src/engine/combat/interpreter.ts (the `heal` and `lifesteal` cases), ' +
    'src/engine/combat/events.ts (heal.calculation docs), src/game/battleTimeline.ts ' +
    '(formatHeal) and tests/engine/effects.test.ts. It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-05) for DEFENSIVE-STAT SCALING of shields ' +
    'and heals (user-approved 2026-08-04): a REAL, REVIEWED RULE CHANGE. A card\'s ' +
    '`property` still picks WHICH stat scales its output, but the ROLE of the action ' +
    'now picks WHICH SIDE of the stat sheet that lookup reads — defensive output ' +
    '(shield / heal) scales off Armor (physical) and Magic Resist (magical) via the ' +
    'new `scaleDefStat`, where it previously read Attack / Magic Power via ' +
    '`scaleStat`. TRUE stays flat by identity (0 stat term), exactly as before. ' +
    'PL-NEUTRAL: attack/magicPower/armor/magicResist all cost 1 PL per +1 and all ' +
    'start at 1 (LEVEL_STAT_COST, BASE_HERO_STATS in src/run/leveling.ts), so no ' +
    'price in src/engine/balance.ts moves — only WHICH stat buys the output. ' +
    'Blast radius verified BEFORE regenerating, over both 200-fight sweeps: ' +
    '153/200 logs moved in EACH sweep (142 of them decided before ' +
    'ATTRITION_START_TURN), with 2 winner flips (#9 and #138, the same two in both ' +
    'sweeps) and 13 turn changes — the expected consequence of every shield pool and ' +
    'heal resizing. CONTAINMENT PROVEN BY EXHAUSTION: 0 logs moved WITHOUT containing ' +
    'a shieldGain or heal event, so nothing outside the changed mechanic drifted. The ' +
    '15 logs that DO contain one and did NOT move are each explained: 12 carry only a ' +
    'zero stat term (TRUE shields/heals, flat by identity under both rules) and 3 ' +
    '(#4, #65, #142) carry only a `leeching_fang` LIFESTEAL heal, which is a ' +
    'percentage of damage dealt and never had a stat-scaling term under either rule. ' +
    'See src/engine/combat/interpreter.ts (`scaleDefStat` and its `scaleStat` ' +
    'sibling), src/engine/combat/events.ts (shieldGain.calculation.statBonus docs) ' +
    'and tests/engine/effects.test.ts. It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-04) for the FIRST-TO-FALL OUTCOME RULE ' +
    '(user-directed 2026-08-04): a REAL, REVIEWED RULE CHANGE. Combat now ends at ' +
    'the exact APPLICATION that wipes a side, so nothing later in the same step ' +
    'runs — no DoT/attrition/fatigue tick after the killing blow, no bleed tick on ' +
    'a performer whose cast just won, and no lifesteal-back off a killing blow. ' +
    'Mutual wipes therefore cannot occur and the 2026-07-30/31 tempo tiebreak is ' +
    'unreachable (kept in decideOutcome as a documented defensive fallback). ' +
    'Blast radius verified BEFORE regenerating, by diffing this engine against a ' +
    'byte copy of the pre-change simulate.ts + interpreter.ts over all 740 fights ' +
    'the engine suite sweeps: attritionOff 2/200 and attritionOn 3/200 logs moved ' +
    '(#10 and #83 in both, plus #15 with attrition on). For EVERY moved log the ' +
    'diff proved: (a) the events up to AND INCLUDING the death that wiped a side ' +
    'are byte-identical, (b) the new log is a strict SUBSEQUENCE of the old one — ' +
    'nothing was invented, (c) every removed event is a post-wipe application ' +
    '(#10: one lifesteal heal on a killing blow; #83: one bleed tick after a ' +
    'killing cast; #15: two attrition ticks after a side was already wiped), and ' +
    '(d) `turns` did not move. ZERO winner flips in either sweep, and 0 of the 740 ' +
    'fights was a former mutual wipe in the baseline families (1 was in the ' +
    'wider 0x5117e5 sweep, and it kept its result). See ' +
    'src/engine/combat/simulate.ts (`sweep`, `decideOutcome`), ' +
    'src/engine/combat/interpreter.ts (`applyCast`) and ' +
    'tests/engine/outcomeRule.test.ts. It supersedes the prior regen: ' +
    'Regression lock recaptured (2026-08-03) for the ANTI-HEAL WORLD RULE ' +
    '(game-director approved 2026-08-01, built 2026-08-03): a REAL, REVIEWED RULE ' +
    'CHANGE. Regular heals and lifesteal are taxed -20% per affliction category ' +
    'active on the RECEIVER (DoT family / stat debuff / expose, cap -60%); TRUE ' +
    'heals are immune. Blast radius verified BEFORE regenerating: exactly 75/200 ' +
    'logs moved in each sweep, and those 75 are EXACTLY the logs that contain a ' +
    'heal event carrying the new `antiHeal` annotation (0 logs moved without one, ' +
    '0 annotated logs left unmoved). 7 of them end on a different turn and 1 ' +
    '(attritionOn #172) flips its winner — the expected consequence of less ' +
    'healing, not a scope leak. See src/engine/combat/interpreter.ts ' +
    '(applyAntiHeal / antiHealCategories) and tests/engine/antiHeal.test.ts. ' +
    'It supersedes the prior regen (2026-08-01) for the TRUE-heal re-price ' +
    '(PRICE.flatTrueHealPerPoint 2 -> 4, balance-designer pass): a REAL BEHAVIOR ' +
    'CHANGE, unlike the prior representation-only regens noted below. ' +
    'second_wind/renewing_wave/purify heal for smaller flat amounts at every ' +
    'tier (e.g. second_wind Bronze 50 -> 25), which changes sim outcomes for any ' +
    'sweep config that casts one of those three cards. Both supersede two earlier ' +
    'non-rule regenerations that the presentation-field ' +
    'normalizer (see `normalization` above) made unnecessary: (a) the card-text ' +
    'canonical-token sweep (ATK/MATK/DEF/MDEF/SPD), which moved every hash without ' +
    'touching a single mechanic — exactly the churn `text` stripping kills, and ' +
    '(b) the additive shield event metadata (shieldGain.calculation, ' +
    'shieldGain.poolsAfter, damage.shieldDrain), which re-hashed the 140/200 logs ' +
    'containing a shield event and left every other byte identical. ' +
    'Guards the ATTRITION THRESHOLD BOUNDARY in outcomeRule.test.ts: fights ' +
    'decided before ATTRITION_START_TURN must stay byte-identical across RULE changes. Regenerate ' +
    'with tests/engine/fixtures/captureOutcomeBaseline.ts, and only for a deliberate, reviewed change.',
  attritionOff: capture({ attritionTurn: OFF }),
  attritionOn: capture({}),
};

const prev = JSON.parse(readFileSync(OUT, 'utf8')) as { attritionOff: Entry[]; attritionOn: Entry[] };
for (const key of ['attritionOff', 'attritionOn'] as const) {
  let changed = 0;
  let changedBeforeThreshold = 0;
  next[key].forEach((entry, i) => {
    const before = prev[key][i]!;
    if (before.hash === entry.hash) return;
    changed += 1;
    if (before.turns < ATTRITION_START_TURN) changedBeforeThreshold += 1;
  });
  console.log(`${key}: ${changed}/${next[key].length} logs changed (${changedBeforeThreshold} of them decided before turn ${ATTRITION_START_TURN})`);
}

writeFileSync(OUT, `${JSON.stringify(next, null, 1)}\n`);
console.log(`wrote ${OUT.pathname}`);
