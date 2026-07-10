// Card Codex generator — builds the shareable HTML catalog from live game
// data (cards + tier variants + enchant marks). Numbers can never drift.
//   npm run codex -- out.html
import { writeFileSync } from 'node:fs';
import { skillBook } from '../src/data/skills';
import { enchantBook } from '../src/data/enchants';
import { enemies } from '../src/data/enemies';
import { elementMatchup, weaponMatchup } from '../src/engine/elements';
import { cardAtTier } from '../src/data/library';
import { powerLevel } from '../src/engine/balance';
import { weightOf, type EnchantDef, type SkillDef, type SkillTier } from '../src/engine/types';

const out = process.argv[2];
if (!out) {
  console.error('usage: npm run codex -- <out.html>');
  process.exit(1);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ARCH_ICON: Record<string, string> = { offense: '⚔', defensive: '🛡', healing: '✚', support: '♦', debuff: '☠' };
const ELEM_ICON: Record<string, string> = { fire: '🔥', frost: '❄', lightning: '⚡', nature: '🌿', holy: '☀', dark: '🌑' };
const WEAP_ICON: Record<string, string> = { sword: '🗡', axe: '🪓', lance: '🔱', bow: '🏹', beast: '🐾' };
const TIERS: SkillTier[] = ['silver', 'gold', 'diamond'];
const TARGET_LABEL: Record<string, string> = { all: 'AOE — every foe', lowAggro: 'lowest aggro', lowestHp: 'lowest HP', aggro: 'default' };

function deltaOf(v: SkillDef): string {
  const i = v.text.lastIndexOf('◆');
  return i >= 0 ? v.text.slice(i + 1).replace(/^\s*\w+:\s*/, '').trim().replace(/\.$/, '') : '';
}

function cardFace(s: SkillDef): string {
  const kind = s.element ? ELEM_ICON[s.element] : s.weapon ? WEAP_ICON[s.weapon] : '';
  const arch = s.archetypes.map((a) => ARCH_ICON[a]).join('');
  return `<div class="face p-${s.property} s-${s.size}">
    <div class="face-name">${esc(s.name)}</div>
    <div class="face-foot"><span>${arch}</span><span class="face-kind">${kind}${s.property.slice(0, 4).toUpperCase()} w${weightOf(s)}</span></div>
  </div>`;
}

function tierTrack(s: SkillDef): string {
  const cells = [`<div class="tier t-bronze on"><span class="t-label">BRONZE</span><span class="t-pl">${powerLevel(s)} PL</span><span class="t-delta">base kit</span></div>`];
  for (const t of TIERS) {
    const v = cardAtTier(s.id, t);
    if (v) {
      cells.push(`<div class="tier t-${t} on"><span class="t-label">${t.toUpperCase()}</span><span class="t-pl">${powerLevel(v)} PL</span><span class="t-delta">${esc(deltaOf(v))}</span></div>`);
    } else {
      cells.push(`<div class="tier t-${t}"><span class="t-label">${t.toUpperCase()}</span><span class="t-delta">no on-budget knob</span></div>`);
    }
  }
  return `<div class="track">${cells.join('')}</div>`;
}

/** Mechanical classification of a mark, derived from its def — not prose. */
function enchantType(e: EnchantDef): { type: string; chips: string[] } {
  const chips: string[] = [];
  let type = 'Targeting';
  if (e.chase) type = 'Tempo';
  else if (e.uses !== undefined) type = 'Exhaust';
  if (e.targeting !== 'aggro') chips.push(`target: ${TARGET_LABEL[e.targeting]}`);
  if (e.aoeDamagePct !== undefined) chips.push(`${e.aoeDamagePct}% per target`);
  if (e.powerPct !== undefined) chips.push(e.powerPct > 100 ? `power ×${e.powerPct / 100}` : `power ${e.powerPct}%`);
  if (e.chase) chips.push('free follow-up cast');
  if (e.uses !== undefined) chips.push(`${e.uses} cast${e.uses > 1 ? 's' : ''}/battle`);
  return { type, chips };
}

const ELEMENTS = ['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'] as const;
const WEAPONS = ['sword', 'axe', 'lance', 'bow', 'beast'] as const;

/** Bestiary rows: natures + COMPUTED weaknesses/resists from the matchup fns. */
const bestiaryRows = Object.values(enemies)
  .map((e) => {
    const natures: string[] = [];
    if (e.elementAffinity) natures.push(`${ELEM_ICON[e.elementAffinity]} ${e.elementAffinity}`);
    if (e.weaponAffinity) natures.push(`${WEAP_ICON[e.weaponAffinity]} ${e.weaponAffinity}`);
    const weak: string[] = [];
    const resist: string[] = [];
    for (const el of ELEMENTS) {
      if (elementMatchup(el, e.elementAffinity) === 'advantage') weak.push(`${ELEM_ICON[el]} ${el}`);
      if (elementMatchup(el, e.elementAffinity) === 'disadvantage') resist.push(`${ELEM_ICON[el]} ${el}`);
    }
    for (const w of WEAPONS) {
      if (weaponMatchup(w, e.weaponAffinity) === 'advantage') weak.push(`${WEAP_ICON[w]} ${w}`);
      if (weaponMatchup(w, e.weaponAffinity) === 'disadvantage') resist.push(`${WEAP_ICON[w]} ${w}`);
    }
    const st = e.stats;
    const badge = e.isBoss ? '<span class="badge boss">BOSS</span>' : e.isElite ? '<span class="badge elite">ELITE</span>' : '';
    const kit = e.pieces.map((pc) => esc(skillBook[pc.skillId]?.name ?? pc.skillId)).join(' · ');
    const statBits = [
      `HP ${st.maxHp}`, `ATK ${st.attack}`, `MPW ${st.magicPower}`, `ARM ${st.armor}`, `RES ${st.magicResist}`, `SPD ${st.speed}`,
      ...(st.resolve ? [`RESOLVE ${st.resolve}`] : []),
    ].join(' · ');
    return `<article class="beast">
      <div class="beast-head"><span class="beast-name">${esc(e.name)}</span>${badge}</div>
      <div class="beast-grid">
        <div><div class="blabel">nature</div>${natures.length ? natures.map((n) => `<span class="chip">${n}</span>`).join(' ') : '<span class="chip">none — takes everything neutral</span>'}</div>
        <div><div class="blabel">weak to (+50%)</div>${weak.length ? weak.map((n) => `<span class="chip weakchip">${n}</span>`).join(' ') : '<span class="chip">nothing</span>'}</div>
        <div><div class="blabel">resists (−25%)</div>${resist.length ? resist.map((n) => `<span class="chip">${n}</span>`).join(' ') : '<span class="chip">nothing</span>'}</div>
      </div>
      <div class="beast-stats">${statBits}</div>
      <div class="beast-kit">casts: ${kit}</div>
    </article>`;
  })
  .join('\n');

const groups: [string, string, (s: SkillDef) => boolean][] = [
  ['Offense', 'damage first — swords, spells, executions', (s) => s.archetypes[0] === 'offense'],
  ['Defense', 'typed shields and thorns', (s) => s.archetypes[0] === 'defensive'],
  ['Healing', 'restore, regenerate, cleanse', (s) => s.archetypes[0] === 'healing'],
  ['Support', 'auras and self-buffs', (s) => s.archetypes[0] === 'support'],
  ['Debuff', 'hexes, jams, traps, exposure', (s) => s.archetypes[0] === 'debuff'],
];

const all = Object.values(skillBook);
let sections = '';
for (const [title, sub, pred] of groups) {
  const cards = all.filter(pred);
  const rows = cards
    .map(
      (s) => `<article class="row">
    ${cardFace(s)}
    <div class="kit"><div class="kit-meta">${esc(s.rarity)} · size ${s.size}${s.uses ? ` · ${s.uses} use${s.uses > 1 ? 's' : ''}/battle` : ''}</div><p>${esc(s.text)}</p></div>
    ${tierTrack(s)}
  </article>`,
    )
    .join('\n');
  sections += `<section><div class="eyebrow">${title} <span class="count">${cards.length}</span></div><p class="section-sub">${sub}</p>${rows}</section>\n`;
}

const enchantRows = Object.values(enchantBook)
  .map((e) => {
    const { type, chips } = enchantType(e);
    return `<div class="mark"><div class="mark-icon">${e.icon}</div><div class="mark-body">
      <div class="mark-head"><span class="mark-name">${esc(e.name)}</span><span class="mark-type mt-${type.toLowerCase()}">${type}</span></div>
      <div class="mark-chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <p>${esc(e.text)}</p></div></div>`;
  })
  .join('\n');

const html = `<title>World1 Card Codex</title>
<style>
:root{
  --bg:#eeeef2; --panel:#ffffff; --panel2:#e4e4ea; --line:#c9c9d4;
  --ink:#1a1a22; --dim:#5c5c6e;
  --phys:#a5661f; --mag:#3a66c9; --true:#8a6d1d;
  --bronze:#9a6a38; --silver:#5f6d7e; --gold:#a07d1a; --diamond:#2a7fa5;
  --card-bg:#14141c; --card-ink:#e8e8f0;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#0e0e12; --panel:#14141c; --panel2:#1c1c26; --line:#2a2a36;
  --ink:#e8e8f0; --dim:#8a8a9a;
  --phys:#d98a3d; --mag:#5a8dee; --true:#e8d5a0;
  --bronze:#c08850; --silver:#b8c4d4; --gold:#ffd76a; --diamond:#8ee0ff;
}}
:root[data-theme="dark"]{
  --bg:#0e0e12; --panel:#14141c; --panel2:#1c1c26; --line:#2a2a36;
  --ink:#e8e8f0; --dim:#8a8a9a;
  --phys:#d98a3d; --mag:#5a8dee; --true:#e8d5a0;
  --bronze:#c08850; --silver:#b8c4d4; --gold:#ffd76a; --diamond:#8ee0ff;
}
:root[data-theme="light"]{
  --bg:#eeeef2; --panel:#ffffff; --panel2:#e4e4ea; --line:#c9c9d4;
  --ink:#1a1a22; --dim:#5c5c6e;
  --phys:#a5661f; --mag:#3a66c9; --true:#8a6d1d;
  --bronze:#9a6a38; --silver:#5f6d7e; --gold:#a07d1a; --diamond:#2a7fa5;
}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
  margin:0;padding:48px 24px 96px;line-height:1.55;font-size:14px}
.wrap{max-width:980px;margin:0 auto}
header h1{font-size:34px;letter-spacing:-.02em;margin:0 0 6px;text-wrap:balance}
header .sub{color:var(--dim);max-width:64ch}
.eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);margin:56px 0 4px;font-weight:700}
.eyebrow .count{color:var(--ink);background:var(--panel2);border-radius:2px;padding:1px 7px;margin-left:6px}
.section-sub{color:var(--dim);margin:0 0 18px;font-size:13px}
.legend{display:flex;gap:18px;flex-wrap:wrap;margin-top:22px;font-size:12px;color:var(--dim)}
.legend b{font-weight:700}
.lg-bronze b{color:var(--bronze)}.lg-silver b{color:var(--silver)}.lg-gold b{color:var(--gold)}.lg-diamond b{color:var(--diamond)}
.row{display:grid;grid-template-columns:150px minmax(200px,1fr) 340px;gap:16px;align-items:start;
  background:var(--panel);border:1px solid var(--line);padding:14px;margin-bottom:10px}
.face{background:var(--card-bg);color:var(--card-ink);border:2px solid;height:96px;padding:8px 7px 6px;
  display:flex;flex-direction:column;justify-content:space-between;width:104px}
.face.s-2{width:126px}.face.s-3{width:148px}
.face.p-physical{border-color:#d98a3d}.face.p-magical{border-color:#5a8dee}.face.p-true{border-color:#e8d5a0}
.face-name{font-size:12px;font-weight:700;line-height:1.25}
.face-foot{display:flex;justify-content:space-between;align-items:baseline;font-size:10px;gap:4px}
.face.p-physical .face-kind{color:#d98a3d}.face.p-magical .face-kind{color:#5a8dee}.face.p-true .face-kind{color:#e8d5a0}
.kit p{margin:4px 0 0;color:var(--ink)}
.kit-meta{font-size:11px;color:var(--dim);letter-spacing:.06em;text-transform:uppercase}
.track{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.tier{border:1px solid var(--line);padding:7px 8px;min-height:86px;display:flex;flex-direction:column;gap:3px;opacity:.45}
.tier.on{opacity:1}
.t-label{font-size:10px;letter-spacing:.14em;font-weight:700}
.t-bronze .t-label{color:var(--bronze)}.t-silver .t-label{color:var(--silver)}
.t-gold .t-label{color:var(--gold)}.t-diamond .t-label{color:var(--diamond)}
.t-pl{font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}
.t-delta{font-size:11px;line-height:1.4}
.marks{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.mark{display:flex;gap:12px;background:var(--panel);border:1px solid var(--line);padding:14px}
.mark-icon{font-size:22px;line-height:1}
.mark-body{flex:1}
.mark-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.mark-name{font-weight:700}
.mark-type{font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:2px 7px;border:1px solid var(--line)}
.mt-targeting{color:var(--mag);border-color:var(--mag)}
.mt-tempo{color:var(--phys);border-color:var(--phys)}
.mt-exhaust{color:var(--true);border-color:var(--true)}
.mark-chips{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0 5px}
.chip{font-size:11px;background:var(--panel2);padding:2px 7px;color:var(--ink)}
.mark p{margin:0;color:var(--dim);font-size:13px}
.beast{background:var(--panel);border:1px solid var(--line);padding:14px;margin-bottom:10px}
.beast-head{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
.beast-name{font-weight:700;font-size:15px}
.badge{font-size:10px;letter-spacing:.14em;padding:2px 7px;border:1px solid}
.badge.elite{color:var(--gold);border-color:var(--gold)}
.badge.boss{color:var(--phys);border-color:var(--phys)}
.beast-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:8px}
.blabel{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-bottom:4px}
.weakchip{outline:1px solid var(--gold)}
.beast-stats{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.beast-kit{font-size:12px;color:var(--dim);margin-top:3px}
@media (max-width:820px){.beast-grid{grid-template-columns:1fr}}
.note{background:var(--panel);border:1px solid var(--line);padding:18px 20px;margin-top:14px}
.note h3{margin:0 0 8px;font-size:15px}
.note p{margin:8px 0;max-width:70ch}
.ledger{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
.ledger th,.ledger td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
.ledger th{background:var(--panel2);font-size:11px;letter-spacing:.1em;text-transform:uppercase}
.ledger .pl{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tablewrap{overflow-x:auto}
.tag{font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:2px 6px;border:1px solid var(--line);color:var(--dim)}
footer{margin-top:64px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:16px;max-width:70ch}
@media (max-width:820px){.row{grid-template-columns:1fr}.track{grid-template-columns:repeat(2,1fr)}}
</style>
<div class="wrap">
<header>
  <h1>World1 · Card Codex</h1>
  <p class="sub">Every playable card and its tier progression, generated from the live game data.
  Each tier is a fixed Power-Level budget the whole kit must sum to — upgrades never break math, they spend it.</p>
  <div class="legend">
    <span class="lg-bronze"><b>Bronze</b> 10 PL</span>
    <span class="lg-silver"><b>Silver</b> 15 PL</span>
    <span class="lg-gold"><b>Gold</b> 20 PL</span>
    <span class="lg-diamond"><b>Diamond</b> 25 PL</span>
    <span>${all.length} cards · ${Object.keys(enemies).length} creatures · ${Object.keys(enchantBook).length} enchant marks · deterministic combat, no dice</span>
  </div>
</header>

${sections}

<section>
  <div class="eyebrow">Bestiary — the nature chart <span class="count">${Object.keys(enemies).length}</span></div>
  <p class="section-sub">plan your deck against the creature's nature: weaknesses computed from the live matchup rules. Nature never limits what a creature casts — it is what YOUR card types exploit.</p>
  ${bestiaryRows}
</section>

<section>
  <div class="eyebrow">Enchant marks <span class="count">${Object.keys(enchantBook).length}</span></div>
  <p class="section-sub">free-flow modifiers — attach to any placed card, swap between fights; typed by what they change: <b>Targeting</b> (who gets hit) · <b>Tempo</b> (when you act) · <b>Exhaust</b> (how often it casts). Every mark is a trade, never raw power.</p>
  <div class="marks">${enchantRows}</div>
</section>

<section>
  <div class="eyebrow">Proposal · Bazaar-style upgrades</div>
  <p class="section-sub">special effects on tier-up instead of stat boosts</p>
  <div class="note">
    <h3>The current tracks above are generated stat knobs — placeholders, not the destination.</h3>
    <p>Today's Silver/Gold/Diamond variants raise one magnitude until the kit fills the tier budget
    (damage 200% → 300% → …). It's balanced and automatic, but upgrades read as bigger numbers, not new decisions.</p>
    <p>The Bazaar model, on a two-tier cadence: <b>a new ability every SECOND tier — Silver and
    Diamond — with Gold as the pure numbers step.</b> Each card gains exactly two abilities across
    its whole track (not three), so Diamond kits stay readable: base identity + two learned tricks.
    The balance table already prices every action and every tier grants exactly +5 PL, so each step
    below spends precisely that. Authored variants replace generated ones id-for-id; the audit keeps
    them honest either way:</p>

    <div class="tablewrap"><table class="ledger">
      <tr><th>Sword Slash</th><th>Step</th><th>Kit</th><th class="pl">PL</th></tr>
      <tr><td><span class="tag">Bronze</span></td><td>base</td><td>Deal 200% Attack damage.</td><td class="pl">10.0</td></tr>
      <tr><td><span class="tag">Silver</span></td><td><b>ability</b></td><td>+ <b>Combo</b>: +75% if your previous cast was Offense <i>(learns to chain)</i></td><td class="pl">15.0</td></tr>
      <tr><td><span class="tag">Gold</span></td><td>numbers</td><td>damage 200% → 300%</td><td class="pl">20.0</td></tr>
      <tr><td><span class="tag">Diamond</span></td><td><b>ability</b></td><td>+ <b>Execute</b>: +75% while the enemy is below half HP <i>(the finisher)</i></td><td class="pl">25.0</td></tr>
    </table></div>

    <div class="tablewrap"><table class="ledger">
      <tr><th>Fireball</th><th>Step</th><th>Kit</th><th class="pl">PL</th></tr>
      <tr><td><span class="tag">Bronze</span></td><td>base</td><td>220% damage + burn 5 for 3 turns.</td><td class="pl">10.0</td></tr>
      <tr><td><span class="tag">Silver</span></td><td><b>ability</b></td><td>+ <b>Jam 40%</b>: the scorch weakens their next cast + damage 240%</td><td class="pl">15.0</td></tr>
      <tr><td><span class="tag">Gold</span></td><td>numbers</td><td>damage 240% → 340%</td><td class="pl">20.0</td></tr>
      <tr><td><span class="tag">Diamond</span></td><td><b>ability</b></td><td>+ <b>Fire Rune</b>: curse their queued card for a 125% detonation</td><td class="pl">25.0</td></tr>
    </table></div>

    <div class="tablewrap"><table class="ledger">
      <tr><th>Venom Fang</th><th>Step</th><th>Kit</th><th class="pl">PL</th></tr>
      <tr><td><span class="tag">Bronze</span></td><td>base</td><td>140% damage + poison 5 for 3 turns.</td><td class="pl">10.0</td></tr>
      <tr><td><span class="tag">Silver</span></td><td><b>ability</b></td><td>+ <b>Feed</b>: lifesteal 75% of damage dealt <i>(the venom feeds you)</i></td><td class="pl">15.0</td></tr>
      <tr><td><span class="tag">Gold</span></td><td>numbers</td><td>damage 140% → 240%</td><td class="pl">20.0</td></tr>
      <tr><td><span class="tag">Diamond</span></td><td><b>ability</b></td><td>+ <b>Expose</b>: −20 Resolve for 2 turns <i>(their body rejects cures)</i></td><td class="pl">25.0</td></tr>
    </table></div>

    <p>Design rules that fall out: two abilities per track keeps Diamond kits readable (base + two
    learned tricks, never a five-effect wall of text); the Gold numbers step makes mid-run tiering
    feel like growth without new rules to learn; every added effect must already exist in the priced
    DSL (programmable, auditable by the same balance test); and cards with no cheap knob (Purify,
    Time Crystal) stop being bronze-locked the moment their Silver buys an ability instead.</p>
  </div>
</section>

<footer>Generated from <b>src/data/skills.ts</b>, <b>src/data/library.ts</b> and <b>src/engine/balance.ts</b> —
run <b>npm run codex</b> after balance changes and republish; the numbers can never drift from the game.
Tier tracks marked "no on-budget knob" show where only an authored (Bazaar-style) path can exist.</footer>
</div>
`;

writeFileSync(out, html);
console.log(`codex written: ${all.length} cards, ${Object.keys(enchantBook).length} enchants -> ${out}`);
