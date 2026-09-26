/**
 * Card-face truncation audit — guards a single invariant: `CardToken`'s
 * `segmentedLine` may cut a whole segment off a too-narrow effects line, but
 * it must NEVER do so silently. Regression this exists to catch (2026-09-06):
 * `skillPresentation.ts` added an `Nt` duration suffix to every
 * `guard`/`expose`/`buffStat`/`debuffStat` segment, which tipped 143
 * tier-resolved variants that pair a duration effect with another segment
 * into overflowing their real card-face width on five real surfaces. The
 * renderer's drop-whole-trailing-segments algorithm quietly removed the
 * excess segment with NO "…" marker — `frostbind_litany[gold]` read as
 * `-25% MATK 2t · -25% MDEF 2t`, its CLEANSE gone with nothing telling the
 * player anything was cut. `segmentedLine` was rewritten to ellipsise the
 * TAIL segment in place, dropping one whole ONLY when even a single
 * character plus "…" still can't fit, and to always mark a drop that
 * happens anyway — this script is the standing proof that stays true.
 *
 * Same mold as `scripts/shop-smoke.ts`/`scripts/run-hud-audit.ts`: the same
 * Chromium resolver (`scripts/chromiumPath.ts`), the same
 * `pinPageAgainstHmr` (`scripts/pageHarness.ts` — this repo's tree is LIVE,
 * more than one agent edits `src/` at once), and the same named-step
 * hard-failure discipline — a violated invariant fails LOUDLY by the
 * surface's own name, never a silent pass. UNLIKE those two, this script
 * does not click through a playthrough: `CardToken.ts` (Phaser-backed) can't
 * be imported into a vitest test at all (this repo's vitest is
 * `environment: 'node'`, no canvas/jsdom — confirmed by direct import:
 * `ReferenceError: window is not defined`), so instead this dynamically
 * `import()`s the REAL, unmodified `CardToken`/`skillBook`/`applyTier`
 * straight off the live Vite dev server (the exact module the game boots),
 * builds a real token off-canvas for every duration+multi-effect tier
 * variant in the book on every surface that ships one, and reads the ACTUAL
 * rendered `Text` children — nothing here reimplements `segmentedLine`'s
 * width arithmetic (that duplicate, `segmentedLineSurvivors`, is exactly
 * what an earlier audit caught disagreeing with the real proportional-font
 * renderer, and was deleted from `tests/game/cardTokenSpec.test.ts`).
 *
 * POPULATION. A tier-resolved variant counts if `summarizeEffectSegments`
 * returns >=2 segments and at least one is `guard`/`expose` (both carry a
 * `keyword`) or `buffStat`/`debuffStat` (no `keyword` field at all — see
 * `skillPresentation.ts`'s `extras.push` call sites — detected as a
 * keyword-less segment whose text ends `\d+t`). `curse` is EXCLUDED even
 * though its text also ends `\d+t`: it carries `keyword: 'curse'` and
 * already had its `Nt` suffix before the regression this guards. Walked via
 * the REAL `applyTier` at all four tiers; a tier `applyTier` throws for is
 * skipped, not counted. 143 variants as of 2026-09-06 — if this count ever
 * reads 0, the audit is vacuous and hard-fails by name rather than passing
 * green having checked nothing.
 *
 * TWO GATES, because there are two different surfaces a card's words can be
 * lost on and the first version of this script only covered one of them:
 *
 *   GATE 1 — `CardToken`'s COMPACT EFFECT BADGES (`summarizeEffectSegments`),
 *            at the five real widths below. This is what the file was built for.
 *   GATE 2 — `FantasyCardTemplateV2`'s GENERATED BODY (`renderSkillText`), at
 *            the five real card widths. ADDED 2026-09-06, and it was needed:
 *            `silentDrop=0` from gate 1 said nothing about the body, which is
 *            the surface the card-text migration actually changed, and
 *            `makeBody` was `destroy()`ing overflow words with no cue at all.
 *            At the 140px card the box is 113x25 and the 8px font floor pins it
 *            to TWO lines, so roughly half the catalog overflows — the gate is
 *            therefore "every overflow is CUED", not "nothing overflows", plus a
 *            per-width high-water mark so the count cannot creep up unnoticed.
 *            Measured against the REAL renderer (the Text objects it actually
 *            leaves in the container), never a replica of its arithmetic.
 *
 *            `CARD_WIDTHS` BELOW IS THE ONLY RECORD OF THE COUNTS. They move
 *            legitimately whenever a face gets longer — already re-recorded
 *            once, hours after first being set, for three wording changes — so
 *            no comment and no doc restates them. This header said "412 of
 *            732" and was false within the day; `docs/feature-inventory.md`,
 *            `docs/card-template-spec.md` and `FantasyCardTemplateV2.ts` each
 *            carried the same number and now cite this table instead.
 *
 * SURFACES. Five — `effects` at the four real widths this defect was found
 * on, plus `compactLine` (mobile battle only: `BoardColumn` drops to
 * compact whenever a row's height is below `TOKEN_COMPACT_HEIGHT`, which
 * `MobileBattleScene.ts` does by stacking two foe boards in the right
 * column — a normal shipped state, not a synthetic one):
 *   - mobile-battle-effects:   184w, h=90,  side left, no inspect
 *   - mobile-battle-compact:   184w, h=40,  side left, no inspect
 *   - desktop-battle-effects:  380w, h=90,  side left, no inspect
 *   - shop-owned-effects:      220w, h=90,  side left, WITH inspect (the
 *     shop owned board/bag's `onInspectSlot` reserves a strip — see
 *     `BoardColumn.ts` -> `CardToken`'s `onInspect`)
 *   - mobile-prep-effects:     192w, h=90,  side left, no inspect
 *
 * THE INVARIANT. For each (variant, surface): `originalCount` = the real
 * RENDER-UNIT count — every segment counts as one, EXCEPT a
 * `joinWithPrevious` segment (an affinity badge's payload half, glued to its
 * `TYPE:` label by a plain space rather than the clause separator — see
 * `EffectSegment.joinWithPrevious`, skillPresentation.ts), which continues
 * the unit before it rather than starting a new one (2026-09-06: a raw
 * segment count here misreported a "silent drop" on every gated card that
 * also carries a duration suffix, e.g. `judgment_light[diamond]`, even when
 * nothing was cut — the render is intentionally one `' · '` narrower than a
 * naive segment count). `renderedChunks` = the rendered line's `' · '`-split
 * length; `wholeDropped` = `renderedChunks < originalCount` (informational —
 * a real width shortfall genuinely cuts content sometimes, and that alone is
 * not a defect); `silentDrop` = `wholeDropped` AND the rendered line does
 * NOT end in "…" — THIS is the invariant. `silentDrop` must be exactly 0 on
 * every surface; any surface where it is not is a named hard failure.
 *
 * Usage: `npx tsx scripts/card-face-truncation-audit.ts [outDir]`
 * npm alias: `npm run audit:cardface`
 * Requires the Vite dev server (`npm run dev`) at :5173. Does NOT need the
 * battle API — `CardToken` is built directly, no fight is simulated.
 */
import { chromium } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';
import { pinPageAgainstHmr } from './pageHarness';
import { writeFileSync } from 'node:fs';

const BASE = process.env.WORLD1_DEV_URL ?? 'http://localhost:5173';
/**
 * DEFAULTS UNDER `tmp/` (gitignored). It used to default to `.`, so every run
 * left `card-face-truncation-report.json` and
 * `card-body-truncation-report.json` untracked in the repo ROOT — which the
 * handoff skill forbids, and which is how two of them came to be sitting there.
 */
const OUT_DIR = process.argv[2] ?? 'tmp';

interface Surface {
  name: string;
  width: number;
  height: number;
  side: 'left' | 'right';
  inspect: boolean;
  faceMode: 'summed' | 'composition';
}

const SURFACES: Surface[] = [
  { name: 'mobile-battle-effects (184w)', width: 184, height: 90, side: 'left', inspect: false, faceMode: 'summed' },
  { name: 'mobile-battle-compact (184w, stacked)', width: 184, height: 40, side: 'left', inspect: false, faceMode: 'summed' },
  { name: 'desktop-battle-effects (380w)', width: 380, height: 90, side: 'left', inspect: false, faceMode: 'composition' },
  { name: 'shop-owned-effects (220w + inspect)', width: 220, height: 90, side: 'left', inspect: true, faceMode: 'composition' },
  { name: 'mobile-prep-effects (192w)', width: 192, height: 90, side: 'left', inspect: false, faceMode: 'summed' },
];

/**
 * Every real `FantasyCardTemplateV2` width in `src/game`, with the recorded
 * number of card/tier bodies that OVERFLOW there.
 *
 * A RATCHET, not a target — the same discipline `textRoleAudit.test.ts` uses.
 * The 140/150px cards are THUMBNAILS: the body box is 113x25 at that scale and
 * the 8px font floor (4px is what the proportional ladder asks for, and 4px is
 * not text) allows two lines, so roughly half the catalog cannot fit and every
 * surface that draws one also prints the whole body beside it. What must never
 * regress is (a) that every overflow is CUED with an ellipsis, and (b) that the
 * count does not creep up.
 *
 * A "for scale" comparison against the AUTHORED corpus used to sit here as a
 * bare number (621 of 732 at 140px). DROPPED 2026-09-07 for two reasons that
 * are really one: it broke this header's own rule two paragraphs up
 * (`CARD_WIDTHS` is the ONLY record of a count; no comment restates one), and
 * it was not reproducible — undated, from a run nobody can name, sitting
 * beside counts that have since been re-recorded twice. The
 * authored-vs-generated comparison that IS reproducible lives in
 * `.superpowers/sdd/2026-09-06-card-text-migration/comparison.md`, which
 * states its methodology and was re-derived on 2026-09-07 against HEAD's own
 * `applyTier`/`retextScaledNumbers` rather than a reproduction of them.
 */
// RE-RECORDED 2026-09-07 (gem-text migration, fix round): 412 -> 417, 362 -> 365,
// 20 -> 27. Three WORDING changes made 109 faces two to fifteen characters
// longer, each one user-locked or review-required, none of them a regression:
//   • a gated clause that REPEATS the headline now says "Hit again for 8 (+ATK)"
//     instead of "Deal 8 (+ATK)" (+9 chars, 57 faces) — the authored corpus's
//     own words, restored because the short form read as an unrelated 2nd hit;
//   • the same shape on a heal says "12 (+MDEF) more HP" (+5, 4 faces);
//   • an aura's mods now print the REGISTRY's words, shared with the gem chip
//     and the compact badge: "cards get +6 damage" for what this function used
//     to spell "cards deal +6" (+6, 60 faces — 52 with a damage/heal mod plus
//     8 weight-only auras, which the first count's +-only grep missed).
// The 36 cards whose `shield` word gained `{{...}}` markup also render it BOLD,
// which is a few pixels wider at the same character count.
// The SAFETY property is unchanged and is what this gate is really for:
// silent=0 on all five widths, i.e. every one of these overflows is still cued
// with an ellipsis. 420w stays at 0 — nothing is lost at full size.
const CARD_WIDTHS: { name: string; width: number; maxOverflowing: number; maxTitleOverflowing: number }[] = [
  // EVERY WIDTH IS CITED TO THE CALL SITE THAT SETS IT. Two earlier passes got
  // this wrong in opposite directions and both were caught: the first labelled
  // `200w` "DesktopWiki gallery" (that cell is 187.2px) and called `220w`
  // "shop detail" (no shop card is 220 — 220 is GATE 1's BADGE width above);
  // the second then DELETED the 220w row on the strength of that, and 220 is
  // a real shipped surface — `DesktopWikiScene.ts:546`, the desktop Wiki
  // DETAIL pane. Cite the site or do not claim the surface.
  { name: 'card-body 140w (cardDetailOverlay.ts:48; MobileDeckBuildScene:829; MobileDraftScene:225)', width: 140, maxOverflowing: 417, maxTitleOverflowing: 108 },
  { name: 'card-body 150w (MobileWikiScene:659; MobileShopScene:923 + :997)', width: 150, maxOverflowing: 367, maxTitleOverflowing: 72 },
  { name: 'card-body 187w (DesktopWikiScene:299 gallery cell — (1000-4*16)/5)', width: 187, maxOverflowing: 205, maxTitleOverflowing: 0 },
  { name: 'card-body 200w (DesktopShopScene:1077 + :1141, both docks)', width: 200, maxOverflowing: 28, maxTitleOverflowing: 0 },
  { name: 'card-body 220w (DesktopWikiScene:546, detail pane)', width: 220, maxOverflowing: 27, maxTitleOverflowing: 0 },
  // 260 IS DEV-ONLY, and the row says so. The previous label claimed
  // `DesktopShopScene:611`'s `Math.min(260, ...)` shelf cap as a shipped
  // player surface — it is not one for THIS gate: that cell builds a
  // `CardToken` (:638, 260x130), a different renderer whose one-line `effects`
  // strip GATE 1 above already measures. No shipped `FantasyCardTemplateV2` is
  // 260 wide; the ladder's real player widths are 140/150/187/200/220 and the
  // reward slots' 307/336.
  //
  // The row is KEPT anyway, on the opposite justification to the old one: the
  // dev harness is still a real V2 render, and GATE 2's `missingBody` check
  // only proves the body selector works on the faces it actually visits. It is
  // also a useful sampling point between 220 and 307. What it must NOT be read
  // as is evidence about a screen a player can open.
  { name: 'card-body 260w (UiKitScene:249 dev harness ONLY — no player surface at this width)', width: 260, maxOverflowing: 11, maxTitleOverflowing: 0 },
  { name: 'card-body 307w (RunRewardPanel:241 scale, mobile reward slot 360x504)', width: 307, maxOverflowing: 0, maxTitleOverflowing: 0 },
  { name: 'card-body 336w (RunRewardPanel:241 scale, desktop reward slot 493x552)', width: 336, maxOverflowing: 0, maxTitleOverflowing: 0 },
  // No shipped surface draws at base size; this row is the CONTROL — it proves
  // the ladder itself fits every face when nothing shrinks it, so a non-zero
  // count here means a face outgrew the design rather than the thumbnail.
  { name: 'card-body 420w (base size — synthetic control, no call site)', width: 420, maxOverflowing: 0, maxTitleOverflowing: 0 },
];

/** Every named-step failure — the ONLY thing that flips the exit code, same
 * discipline as `shop-smoke.ts`: names exactly which surface failed and why,
 * never a silent pass. */
const hardFailures: string[] = [];
const passed: string[] = [];

function fail(step: string, why: string): void {
  hardFailures.push(`step "${step}": ${why}`);
}
function pass(step: string): void {
  passed.push(step);
  console.log(`  OK — ${step}`);
}

async function main(): Promise<void> {
  const chromiumPath = resolveChromiumPath('card-face-truncation-audit');
  console.log(`Using Chromium: ${chromiumPath}`);
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
  });
  // A static card CATALOGUE host — not `mbattle`/the real shop/battle scenes:
  // those auto-rerender on their own timers and fight whatever this script
  // injects for the same frame (observed directly — an injected token was
  // silently wiped moments after being added). This host never does that,
  // and CardToken's own render doesn't depend on which scene hosts it.
  const page = await browser.newPage({ viewport: { width: 412, height: 892 } });
  await pinPageAgainstHmr(page);
  page.on('pageerror', (err) => fail('page error', String(err)));

  await page.goto(`${BASE}/?scene=mwiki&layoutAudit=1`, { waitUntil: 'networkidle', timeout: 30000 });
  const booted = await page.waitForFunction(() => {
    const g = (window as any).__game;
    return !!g && g.scene.scenes.some((s: any) => s.sys.isActive());
  }, { timeout: 15000 }).then(() => true).catch(() => false);
  if (!booted) {
    fail('boot', 'window.__game never had an active scene within 15s — dev server up but the game did not boot');
  } else {
    const report = await page.evaluate(async (surfaces: Surface[]) => {
      // These four resolve at RUNTIME, in the browser, off the live Vite dev
      // server ('/src/...' is a real served path there) — tsc has no way to
      // know that and reports TS2307 on all four; `@ts-expect-error` names
      // that mismatch rather than hiding it (and would itself start failing,
      // loudly, if tsc's opinion ever changed).
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { CardToken } = (await import('/src/game/ui/CardToken.ts')) as any;
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { skillBook } = (await import('/src/data/skills.ts')) as any;
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { applyTier } = (await import('/src/engine/cards.ts')) as any;
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { cardTokenSpec } = (await import('/src/game/ui/cardTokenSpec.ts')) as any;
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { summarizeEffectSegments } = (await import('/src/game/ui/skillPresentation.ts')) as any;

      const game = (window as any).__game;
      const scene = game.scene.scenes.find((s: any) => s.sys.isActive());

      const TIERS = ['bronze', 'silver', 'gold', 'diamond'];
      // NOTE: no named `const foo = (x) => ...` bindings in this callback —
      // tsx/esbuild wraps those in a `__name(...)` helper call at THIS
      // file's own (Node-side) transform step, and `page.evaluate` ships
      // the function to the browser by serialized SOURCE TEXT, where
      // `__name` does not exist — the same `ReferenceError: __name is not
      // defined` trap `pageHarness.ts`'s doc comment names. Every predicate
      // below is written inline instead.

      // Population: computed ONCE against 'summed' (keyword presence never
      // depends on faceMode — only the numeric composition does).
      const variants: { skillId: string; tier: string }[] = [];
      for (const skill of Object.values(skillBook) as any[]) {
        for (const tier of TIERS) {
          let card;
          try { card = applyTier(skill, tier); } catch { continue; }
          const rich = summarizeEffectSegments(card, undefined, 'summed');
          let hasDuration = false;
          for (const s of rich) {
            if (s.keyword === 'guard' || s.keyword === 'expose' || (!s.keyword && /\d+t$/.test(s.text))) { hasDuration = true; break; }
          }
          if (rich.length >= 2 && hasDuration) variants.push({ skillId: skill.id, tier });
        }
      }

      const out: Record<string, { wholeDropped: number; silentDrop: number; examples: string[] }> = {};
      for (const surf of surfaces) {
        const spec = cardTokenSpec(surf.width, surf.height, surf.side, 0, surf.inspect);
        const dy = spec.compact ? spec.compactLine.dy : spec.effects.dy;
        let wholeDropped = 0;
        let silentDrop = 0;
        const examples: string[] = [];
        for (const v of variants) {
          const base = skillBook[v.skillId];
          const card = applyTier(base, v.tier);
          const richSegments = summarizeEffectSegments(card, undefined, surf.faceMode);
          // A `joinWithPrevious` segment (an affinity badge's payload half —
          // see `EffectSegment.joinWithPrevious`, skillPresentation.ts) is
          // rendered glued to its predecessor by a plain space, not the ' · '
          // clause separator this count is a proxy for. Counting it as a
          // SEPARATE render unit made every such card misreport a "silent
          // drop" that never happened (`judgment_light[diamond]` at 380w:
          // "DMG 26 +MATK · -20% MDEF 2t · HOLY: 32 DMG" is the whole line,
          // nothing cut, yet 4 raw segments vs 3 real `' · '`-joined chunks
          // read as a drop) — the render is intentionally one unit narrower
          // than a naive segment count, not truncated.
          const originalCount = richSegments.reduce((count: number, seg: { joinWithPrevious?: boolean }) => (seg.joinWithPrevious ? count : count + 1), 0);
          const token = new CardToken(scene, -9999, -9999, card, {
            width: surf.width, height: surf.height, side: surf.side, faceMode: surf.faceMode,
            onInspect: surf.inspect ? () => {} : undefined,
          });
          const texts: { x: number; text: string }[] = [];
          for (const child of token.list) {
            if (child.type === 'Text' && Math.abs(child.y - dy) < 0.5) texts.push({ x: child.x, text: child.text });
          }
          texts.sort((a, b) => a.x - b.x);
          const rendered = texts.map((t) => t.text).join('');
          token.destroy();
          const renderedChunks = rendered.split(' · ').length;
          const dropped = renderedChunks < originalCount;
          if (dropped) {
            wholeDropped += 1;
            if (!rendered.endsWith('…')) {
              silentDrop += 1;
              if (examples.length < 8) examples.push(`${v.skillId}[${v.tier}]: "${rendered}"`);
            }
          }
        }
        out[surf.name] = { wholeDropped, silentDrop, examples };
      }
      return { populationCount: variants.length, bySurface: out };
    }, SURFACES);

    console.log(`Population (duration+multi-effect tier variants): ${report.populationCount}`);
    if (report.populationCount === 0) {
      fail('population', 'zero duration+multi-effect tier variants found in the book — this audit would be checking nothing');
    } else {
      pass(`population: ${report.populationCount} variants`);
    }
    for (const surf of SURFACES) {
      const r = report.bySurface[surf.name];
      if (!r) { fail(surf.name, 'no result returned for this surface'); continue; }
      console.log(`  ${surf.name}: wholeDropped=${r.wholeDropped} silentDrop=${r.silentDrop}`);
      if (r.silentDrop > 0) {
        fail(surf.name, `${r.silentDrop} of ${r.wholeDropped} whole-segment drop(s) render with NO "…" cue — ${r.examples.join(' | ')}`);
      } else {
        pass(`${surf.name}: silentDrop=0 (${r.wholeDropped} whole-segment drops, all cued)`);
      }
    }
    writeFileSync(`${OUT_DIR}/card-face-truncation-report.json`, JSON.stringify(report, null, 2));

    // ---- GATE 2: the GENERATED BODY on the real card template -------------
    const bodyReport = await page.evaluate(async (widths: { name: string; width: number; maxOverflowing: number; maxTitleOverflowing: number }[]) => {
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { skillBook } = (await import('/src/data/skills.ts')) as any;
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { applyTier } = (await import('/src/engine/cards.ts')) as any;
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { FantasyCardTemplateV2, FANTASY_CARD_BODY_NAME, FANTASY_CARD_TITLE_NAME } = (await import('/src/game/ui/FantasyCardTemplateV2.ts')) as any;
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { renderSkillText } = (await import('/src/engine/keywords/compose.ts')) as any;
      // @ts-expect-error resolved by the browser's Vite dev server at runtime, not by tsc
      const { parseCardTextMarkup } = (await import('/src/game/ui/cardTextMarkup.ts')) as any;

      const game = (window as any).__game;
      const scene = game.scene.scenes.find((s: any) => s.sys.isActive());
      const TIERS = ['bronze', 'silver', 'gold', 'diamond'];
      // Read from the renderer, not re-typed here.
      const bodyName = FANTASY_CARD_BODY_NAME;
      const titleName = FANTASY_CARD_TITLE_NAME;
      const out: Record<string, {
        overflowing: number; silent: number; examples: string[];
        titleOverflowing: number; titleSilent: number; titleExamples: string[];
        missingBody: number; missingTitle: number;
      }> = {};

      for (const surf of widths) {
        const height = surf.width * (690 / 420);
        let overflowing = 0;
        let silent = 0;
        const examples: string[] = [];
        let titleOverflowing = 0;
        let titleSilent = 0;
        const titleExamples: string[] = [];
        // A card the renderer gave no NAMED body container. Zero today; if it
        // is ever non-zero the gate has stopped measuring and must say so
        // rather than passing green on nothing (the failure mode the first
        // version of this split actually shipped).
        let missingBody = 0;
        // ...and the same for the TITLE. Without this, a bogus `titleName`
        // made the title half report `cut=0` at every width and PASS — a gate
        // measuring nothing while claiming a clean bill. `missingBody` already
        // had this guard; the title half shipped without it, which is exactly
        // the asymmetry an audit should find.
        let missingTitle = 0;
        for (const skill of Object.values(skillBook) as any[]) {
          for (const tier of TIERS) {
            if (TIERS.indexOf(tier) < TIERS.indexOf(skill.tier)) continue;
            const shown = applyTier(skill, tier);
            const card = new FantasyCardTemplateV2(scene, -4000, -4000, shown, {
              width: surf.width, height, tier, glossary: false,
            });
            // THE BODY CONTAINER ONLY (fixed 2026-09-07). `makeBody` returns
            // the one child Container whose children are ALL `Text`; the
            // title, weight plate and slot glyphs are its siblings.
            //
            // This used to flatten the WHOLE card into one string, which was
            // wrong twice over. A dropped TITLE word was invisible to a gate
            // added precisely because "there are two different surfaces a
            // card's words can be lost on" — and worse, title text could
            // SATISFY a body word's presence check, so a genuinely clipped
            // body could read as neither overflowing nor silent. The title
            // gained its own ellipsis in the same pass, which made the second
            // hazard live: an ellipsis on the title would have answered the
            // body's cue check.
            // BY NAME, never by shape. The renderer names both text surfaces
            // (`FANTASY_CARD_BODY_NAME` / `FANTASY_CARD_TITLE_NAME`,
            // FantasyCardTemplateV2.ts) precisely so this lookup cannot guess
            // wrong — and it did, twice, before the names existed: "the first
            // child Container whose children are all Text" is the WEIGHT PLATE
            // (2 Texts), not the body (up to 11), and "the Text whose
            // fontFamily contains Cinzel" matched nothing because
            // `FONT.display` is a Georgia stack. Together those reported all
            // 732 bodies as fully overflowing and every title as intact.
            let bodyNode: any;
            let titleNode: any;
            for (const child of (card.list ?? [])) {
              if (child?.name === bodyName) bodyNode = child;
              else if (child?.name === titleName) titleNode = child;
            }
            if (bodyNode === undefined) { missingBody += 1; card.destroy(); continue; }
            if (titleNode === undefined) missingTitle += 1;
            const words: string[] = [];
            for (const g of (bodyNode.list ?? [])) {
              if (typeof g.text === 'string' && g.text.length > 0) words.push(g.text);
            }
            // THE TITLE, checked separately against the card's own name.
            // Phaser's `maxLines` truncates with no marker of its own, so at
            // the 140px card "Bramble Covenant" rendered as "Bramble" — a card
            // silently showing a different card's plausible name.
            const titleText: string | undefined = typeof titleNode?.text === 'string' ? titleNode.text : undefined;
            const titleCut = titleText !== undefined && titleText.replace(/\s+/g, ' ') !== shown.name;
            const titleCued = titleText !== undefined && titleText.includes('…');
            if (titleCut) {
              titleOverflowing += 1;
              if (!titleCued) {
                titleSilent += 1;
                if (titleExamples.length < 4) titleExamples.push(`${skill.id}@${tier} title "${String(titleText)}" for "${shown.name}"`);
              }
            }
            card.destroy();
            const visible = words.join(' ');
            // EXPECTED WORDS ARE SPLIT THE WAY `makeBody` SPLITS THEM: per
            // markup SEGMENT first, then on whitespace. A `{{shield}}.` clause
            // becomes TWO Text objects (`shield` and `.`), never the single
            // `shield.` token a stripped string yields — comparing against the
            // stripped form reported every marked-up trailing clause as lost,
            // including at full size where nothing overflows at all.
            const expected: string[] = [];
            for (const seg of parseCardTextMarkup(renderSkillText(shown))) {
              for (const w of seg.text.split(/\s+/)) if (w.length > 0) expected.push(w);
            }
            // Which body words never made it onto the card at all?
            const lost: string[] = [];
            for (const w of expected) {
              if (w === '·') continue;
              if (!visible.includes(w)) lost.push(w);
            }
            if (lost.length === 0) continue;
            overflowing += 1;
            // A CUED overflow leaves an ellipsis somewhere in the card's text.
            if (!visible.includes('\u2026')) {
              silent += 1;
              if (examples.length < 4) examples.push(skill.id + '@' + tier + ' lost "' + lost.join(' ') + '"');
            }
          }
        }
        out[surf.name] = { overflowing, silent, examples, titleOverflowing, titleSilent, titleExamples, missingBody, missingTitle };
      }
      return out;
    }, CARD_WIDTHS);

    for (const surf of CARD_WIDTHS) {
      const r = bodyReport[surf.name];
      if (!r) { fail(surf.name, 'no result returned for this card width'); continue; }
      console.log(`  ${surf.name}: body overflowing=${r.overflowing} silent=${r.silent} (mark ${surf.maxOverflowing}) · title cut=${r.titleOverflowing} silent=${r.titleSilent} (mark ${surf.maxTitleOverflowing})`);
      if (r.missingBody > 0) {
        fail(surf.name, `${r.missingBody} card(s) rendered with NO named body container — the gate measured nothing for them`);
      }
      const titleStep = `${surf.name.replace('card-body', 'card-title')}`;
      if (r.missingTitle > 0) {
        fail(titleStep, `${r.missingTitle} card(s) rendered with NO named title Text — the title half measured nothing for them`);
      }
      if (r.titleSilent > 0) {
        fail(titleStep, `${r.titleSilent} of ${r.titleOverflowing} truncated title(s) render with NO "…" cue — ${r.titleExamples.join(' | ')}`);
      } else if (r.titleOverflowing > surf.maxTitleOverflowing) {
        fail(titleStep, `${r.titleOverflowing} titles are cut, above the recorded mark of ${surf.maxTitleOverflowing} — a name got longer or the title box got smaller`);
      } else {
        pass(`${titleStep}: silent=0, cut=${r.titleOverflowing} <= ${surf.maxTitleOverflowing}`);
      }
      if (r.silent > 0) {
        fail(surf.name, `${r.silent} of ${r.overflowing} overflowing body/bodies render with NO "…" cue — ${r.examples.join(' | ')}`);
      } else if (r.overflowing > surf.maxOverflowing) {
        fail(surf.name, `${r.overflowing} bodies overflow, above the recorded mark of ${surf.maxOverflowing} — a face got longer or the box got smaller`);
      } else {
        pass(`${surf.name}: silent=0, overflowing=${r.overflowing} <= ${surf.maxOverflowing}`);
      }
    }
    writeFileSync(`${OUT_DIR}/card-body-truncation-report.json`, JSON.stringify(bodyReport, null, 2));
  }

  await page.close();
  await browser.close();

  console.log('\n=== PASSED ===');
  for (const p of passed) console.log(`  ${p}`);
  if (hardFailures.length > 0) {
    console.log(`\n=== HARD FAILURES (${hardFailures.length}) ===`);
    for (const f of hardFailures) console.log(`  ${f}`);
  }
  console.log(`\nTotals: passed=${passed.length} hardFailures=${hardFailures.length}`);
  process.exit(hardFailures.length > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error('card-face-truncation-audit could not run:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
