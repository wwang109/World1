# Keyword registry — pre-gripped lookup

Every row of `KEYWORD_TEXT` in `src/engine/keywords/text.ts`, grouped by
`composeGroup` in the file's own declaration order (`compose.ts`'s
`GROUP_ORDER = ['setup','headline','payload','selfGrant','conditional']`, then
the aura clause outside that order). Verified against the live file and cross-checked
against the `Action` union in `src/engine/types.ts` for full coverage.

`displayToken` is either a literal `KEYWORD_TEXT_COLOR` id, a *function* of the
action for the kinds noted below, or `undefined` — the kind's face clause
names no keyword at all ("exempt"; `MARKUP_EXEMPT_KINDS` derives this list from
the table, it is not hand-kept).

`faceToken` is the compact board/list badge template; `(keyword: …)` names the
colour id the badge tints with when it differs from a fixed id, or when it is
computed. A badge with no `(keyword: …)` note carries no tint.

## setup

| Kind | `displayToken` | `faceToken` badge |
|---|---|---|
| `shieldBreak` | `'shatter'` | `SHATTER {amount}` (keyword: `shatter`) |

## headline

| Kind | `displayToken` | `faceToken` badge |
|---|---|---|
| `damage` | `undefined` (exempt) | `DMG {power}` |
| `heal` | `undefined` (exempt) | `HEAL {power}` |
| `shield` | `'shield'` | `SHLD {power}` (keyword: `shield`) |
| `attunedShield` | `'attuned'` | `SHIELD {power}` or `SHIELD: {TYPE} {power}` (keyword: `attuned`) — label built by `attunedShieldLabel()` |
| `statStrike` | `undefined` (exempt) | `ECHO 1/{shareOf}` or `STRIKE 1/{shareOf}` (+ `(cap {cap})` if set) |

## payload

| Kind | `displayToken` | `faceToken` badge |
|---|---|---|
| `lifesteal` | `'lifesteal'` | `LSTEAL {pct}%` (keyword: `lifesteal`) |
| `poison` | `'poison'` | `POISON {stacks}` (keyword: `poison`) |
| `burn` | `'burn'` | `BURN {stacks}` (keyword: `burn`) |
| `bleed` | `'bleed'` | `BLEED {stacks}` (keyword: `bleed`) |
| `stun` | `'stun'` | `STUN` (keyword: `stun`) |
| `debuffStat` | `undefined` (exempt — judgment call, only hidden mechanism is "global turns") | `-{pct}% {STAT_TOKEN} {turns}t` |
| `expose` | `'expose'` | `EXPOSE {pct}% {turns}t` (keyword: `expose`) |
| `slow` | `'slow'` | `SLOW {weight}` (keyword: `slow`) |
| `burden` | `'burden'` | `BURDEN +{weight} WT` (keyword: `burden`) |
| `curse` | `'curse'` | `CURSE -{amount} DMG {turns}t` (keyword: `curse`) |
| `splash` | `'splash'` | `SPLASH` (keyword: `splash`) |
| `disrupt` | `'disrupt'` | `DISRUPT {amount}` (keyword: `disrupt`) |

## selfGrant

| Kind | `displayToken` | `faceToken` badge |
|---|---|---|
| `thorns` | `'thorns'` | `THORNS {stacks}` (keyword: `thorns`) |
| `guard` | `'guard'` | `{P\|M\|T}.GUARD {pct}% {turns}t` (keyword: `guard`) — letter picked from the action's `property` |
| `negate` | `'negate'` | `{P\|M\|T}.NEGATE {charges}` (keyword: `negate`) |
| `ward` | `'ward'` | `WARD {charges}` (keyword: `ward`) |
| `buffStat` | `undefined` (exempt, same reasoning as `debuffStat`) | `+{pct}% {STAT_TOKEN} {turns}t` |
| `taunt` | `'taunt'` | `TAUNT +{amount}` (keyword: `taunt`) |
| `cleanse` | `'cleanse'` | `CLEANSE {charges}` (keyword: `cleanse`) |

## conditional (the cross-cast rider family)

| Kind | `displayToken` | `faceToken` badge |
|---|---|---|
| `comboBonus` | `'combo'` | `COMBO +{amount}` (keyword: `combo`) |
| `chainBonus` | `'chain'` | `CHAIN +{amount} AFTER {TYPE}` (keyword: `chain`) |
| `empowerNext` | `'charge'` | `NEXT {TYPE }+{amount}` (keyword: `charge`) |
| `exploit` | **function**: `undefined` if `a.status === 'debuff'`, else `a.status` | `+{amount} vs {STATUS_TOKEN[a.status]}` (keyword: same rule as `displayToken` — `undefined` for `debuff`) |
| `stackBonus` | **function**: `a.status` | `BONUS +{per} PER {STATUS_TOKEN[a.status]}` (keyword: `a.status`) — noun in the face clause differs for `burden` ("per Burdened card") vs a stacked pile ("per {Status} debuff") |
| `shieldBurst` | `'shield'` | `SHLD BURST {cap}` (keyword: `shield`) |
| `wardRelease` | `'ward'` | `WARD BURST +{per}/CHG (cap {cap})` (keyword: `ward`) |
| `desperation` | `undefined` (exempt — the gate is the caster's own HP bar, not a keyword) | `+{amount} BELOW HALF HP` (keyword: `bleed` — badge still tints even though the clause is exempt) |
| `overhealShield` | `'shield'` | `OVERHEAL -> SHLD {cap}` (keyword: `shield`) |
| `cleanseConvert` | `'cleanse'` | `+{per} HP/CLEANSED (cap {cap})` (keyword: `cleanse`) |

## Notes verified live, not carried from prose

- `STATUS_TOKEN` (`text.ts`, the badge-word table `stackBonus`/`exploit` read for
  `poison`/`burn`/`bleed`/`stun`/`debuff`/`expose`/`thorns`/`burden`) currently
  spells `thorns` as **`THORNS`** (plural) — the `thorns` row's own badge
  (`THORNS {stacks}`) matches it. If you find prose elsewhere claiming the
  registry says `THORN` (singular), that prose is stale relative to this file;
  re-check `text.ts` directly before trusting it, per `references/surfaces.md`.
- `statStrike` is exempt on the face, but it is **not unused**. No authored
  *skill* carries it; the Legendary gem `resonant_echo`
  (`src/data/content/gems.v1.json`) does, with `echoHostPower` set — so the
  `ECHO 1/{shareOf}` badge renders on every card that gem is socketed into.
  Exempt means "the face clause names no keyword", never "nothing ships it".
- `desperation` is the one row where `displayToken` (exempt) and `faceToken`'s
  `keyword` (`'bleed'`) disagree on whether this kind names a keyword — both are
  read directly from the file, not inferred.
- Coverage cross-check: every `kind` in the `Action` union (`src/engine/types.ts`)
  has exactly one row here (`KeywordTextTable` is `{ [K in Action['kind']]: … }`,
  so a missing or extra row is a `tsc` error) — confirmed by reading both files
  side by side rather than trusting the mapped type alone. Do not add up a row
  count from this document; re-derive it from `text.ts` if you need one, since a
  future keyword changes it.
