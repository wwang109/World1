import Phaser from 'phaser';
import { weightOf, type SkillDef, type SkillTier } from '../../engine/types';
import { ELEMENT_COLOR, FONT, PROPERTY_COLOR, TIER_COLOR, UI, WEAPON_COLOR } from '../theme';
import { cardType, IDENTITY_THRESHOLD } from '../../engine/combat/typeIdentity';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { roundRect } from './roundedRect';
import { buildCardArtPlaceholder } from './cardArtPlaceholder';
import { whenCardArtReady } from './cardArtLoader';
import { effectSegmentJoiner, summarizeEffectSegments, type EffectSegment, type ScalingStats, type SkillFaceMode } from './skillPresentation';
import { keywordTextColor } from './cardTextMarkup';
import { cardTokenSpec, chipBox, type CardTokenSpec, type TokenBox, type TokenTextLine } from './cardTokenSpec';
import { syncCardArtMask } from './cardTokenArtMask';

/** A small badge rendered into the token's reserved accessory rail
 *  (gem socket, tier plate, …). Purely visual — the caller owns meaning. */
export interface TokenAccessory {
  /** 1–2 chars, e.g. '◆' for a gem socket. */
  label: string;
  /** Box fill; defaults to the muted panel tone. */
  color?: number;
  /** Label color; defaults to bronze accent. */
  textColor?: string;
}

export interface CardTokenOptions {
  width: number;
  height: number;
  /** Left column (your deck) or right column (opponent). Mirrors number + text. */
  side?: 'left' | 'right';
  /** Displayed slot number, e.g. "1" or "5-6". Empty tokens still show it. */
  slotLabel?: string;
  /** Deck the card belongs to — used for the affinity "n/3" identity progress. */
  deck?: readonly SkillDef[];
  /** Cursor / drag emphasis. */
  state?: 'none' | 'cursor' | 'drag';
  /** The current combatant's live Attack/Magic Power — renders `base+stat` on damage/heal/shield lines. */
  stats?: ScalingStats;
  /**
   * Card-face number treatment for damage/heal/shield lines — see
   * `SkillFaceMode`. Defaults to the ACTIVE PLATFORM's convention (mobile:
   * summed number; desktop: base+stat composition) via `ACTIVE_PROFILE`, so
   * callers building a shared board (BoardColumn, prep/deck/shop/draft
   * scenes) never have to thread it through by hand — pass it explicitly
   * only to override that default for a specific card face.
   */
  faceMode?: SkillFaceMode;
  /** Badges for the accessory rail (rendered bottom-up on the inward edge). */
  accessories?: TokenAccessory[];
  /**
   * This card INSTANCE's tier (bronze/silver/gold/diamond) — when supplied,
   * the token's outer frame is stroked in `TIER_COLOR[tier]` instead of the
   * generic outline, so tier reads at a glance without opening the inspect
   * dock. Optional and additive: omitted by any caller with no per-instance
   * tier handy (a bare unowned `SkillDef`, e.g. deck build's "available
   * skills" list) — those keep today's generic-colored frame, just at the
   * same slightly thicker weight every token now draws (see the stroke width
   * below). Callers that DO track an instance tier (shop shelf offers, owned
   * board/bag pieces) should pass it.
   */
  tier?: SkillTier;
  /**
   * Opt-in "ⓘ" inspect button, OUTWARD top corner — the shop's owned board/
   * bag columns pass this so the whole card body stays a pure drag surface
   * (no tap-to-inspect racing the drag gesture); every other CardToken caller
   * (battle, prep, deck build, draft, shelf offers) omits it and renders
   * exactly as before. See `cardTokenSpec.ts`'s `inspectButton`/`withInspect`
   * for the reserved-strip geometry this relies on.
   */
  onInspect?: () => void;
  /**
   * Battle-playback-only live state for this token's COMBO segment (the
   * `comboBonus` face token, `case 'comboBonus'` in `skillPresentation.ts`) —
   * user-ruled 2026-08-20: the token may say COMBO only paired with this
   * indicator. `false` greys the segment (`UI.textDisabled`, the same tone
   * `textDisabled` already names for a disabled control) because the owner's
   * most recent resolved cast does NOT share an archetype with this card (or
   * nothing has been cast yet this fight — the engine's own initial
   * `lastCastArchetypes: []`, combat/state.ts). `true` or omitted renders the
   * segment in its normal `KEYWORD_TEXT_COLOR.combo` color — omitted is the
   * ONLY value every non-battle caller (draft/shop/deck build/wiki/prep)
   * ever passes, because outside a fight there is no "previous cast" to be
   * live or not live against. Battle boards derive `true`/`false` from
   * `battleTimeline.ts`'s `isComboLive` + `comboArchetypesByTurn`; a token
   * with no `comboBonus` action simply ignores this (no 'combo' segment to
   * tint).
   */
  comboLive?: boolean;
  /**
   * Battle-playback-only STANDING CARD MODIFIERS on this piece, derived per
   * turn from the event log (`slotModsByTurn`, game/battleTimeline.ts) — the
   * same additive idiom as `comboLive` above: omitted by every non-battle
   * caller and by every unmodified battle piece, and an omitted value renders
   * byte-identically to before this field existed.
   *
   * - `burden` (engine `PieceState.nextWeightPenalty`): the weight badge
   *   shows the EFFECTIVE weight (`weightOf(skill) + burden`) tinted in the
   *   burden keyword's own color — the number the engine will actually charge
   *   on this piece's next play (castSelect.ts folds the tax in), where the
   *   printed base would be a lie. Cleared when the piece plays.
   * - `curse` (engine `PieceState.curse.amount`): the face's effects line is
   *   led by a `−N DMG` segment in the curse keyword's color — the flat
   *   damage this card is losing per hit while the window stands. LEADS the
   *   line (rather than trailing it) because `segmentedLine` truncates from
   *   the TAIL on narrow faces, and the live combat modifier must survive
   *   truncation ahead of static card text a player can read on any other
   *   screen.
   */
  slotMods?: { burden?: number; curse?: number };
  /**
   * Battle-playback-only affinity-gate state for THIS card, computed once per
   * combatant against the REAL fight (`battleTimeline.ts`'s
   * `cardAffinityOpen`, reading the combatant's resolved
   * `elementAffinity`/`weaponAffinity` — the same fields the engine's own
   * cast-time gate check reads, NOT a recount of on-type board cards, which
   * would disagree with an authored enemy affinity like `cinder_sprite`'s).
   * Same additive idiom as `comboLive` above, and drives TWO things at once so
   * they cannot disagree with each other:
   *   - the card's `affinity: true` clause (`EffectSegment.gateClosed`, see
   *     `skillPresentation.ts`) dims its payload — `FIRE:` stays normal-
   *     colored, `NEXT FIRE +16` greys — when this is exactly `false`;
   *   - the identity chip (`affinityLine` below) stops showing a deck-count
   *     progress fraction (meaningless once a real gate state is known) and
   *     instead colors the bare type name the same open/closed way.
   * `true` or omitted (every non-battle caller — prep/shop/deck build/draft/
   * wiki, where there is no caster to check a gate against) both render
   * normally: "unknown" is not "closed".
   */
  affinityOpen?: boolean;
}

/** The active platform's default card-face number treatment — mobile keeps
 * the compact summed number (space-constrained); desktop shows the
 * base+stat composition (room for it, and it makes flat-vs-scaling
 * legible without a tooltip). See `CardTokenOptions.faceMode`. */
function defaultFaceMode(): SkillFaceMode {
  return ACTIVE_PROFILE.id === 'desktop' ? 'composition' : 'summed';
}

/** A rendered effect segment: the token's text plus its RESOLVED color —
 * `KEYWORD_TEXT_COLOR[keyword]` (cardTextMarkup.ts) when the token has one,
 * else `UI.textCalculated` when the segment's own number folded in a live
 * stat (`EffectSegment.calculated` — see that field's doc comment for the
 * exact rule), else `fallbackColor` (AOE and any other flat, un-keyworded,
 * uncalculated token). This is what makes the card face's compact effects
 * line match the flavor-text markup renderer's keyword palette
 * (FantasyCardTemplateV2) AND tells a "MY number" apart from a "the card's
 * number" — previously neither distinction existed and everything un-
 * keyworded rendered in the one flat fallback color.
 *
 * KEYWORD ALWAYS WINS OVER `calculated` when a segment carries both (SHLD /
 * ATTUNED SHLD scale off Armor/Magic Resist just like DMG/HEAL do, so they
 * can be `calculated` too) — the shield-blue/attuned-blue identity is
 * established elsewhere (flavor text, the battle log's pool tokens) and must
 * not flicker to a different colour just because this particular caster's
 * defense stat happens to be nonzero. The calculated colour only ever wins on
 * a segment with NO keyword of its own — which today means DMG/HEAL, the
 * exact gap the feature was written to close.
 *
 * `EffectSegment.gateClosed` (2026-09-06 — see `CardTokenOptions.affinityOpen`)
 * WINS OVER EVERYTHING ELSE, same precedence as the COMBO override right
 * below it: a shut affinity gate's payload must read as "not live" no matter
 * which keyword it carries. */
function effectFaceSegments(
  skill: SkillDef, stats: ScalingStats | undefined, mode: SkillFaceMode, fallbackColor = '#e8d8b0', comboLive?: boolean, affinityOpen?: boolean,
): { text: string; color: string; joinWithPrevious?: boolean }[] {
  return summarizeEffectSegments(skill, stats, mode, affinityOpen).map((segment: EffectSegment) => ({
    text: segment.text,
    ...(segment.joinWithPrevious ? { joinWithPrevious: true } : {}),
    // A shut affinity gate's payload dims regardless of keyword (checked
    // first — see the doc comment above). The COMBO segment overrides its
    // keyword color to the disabled tone when battle playback says it isn't
    // live right now (see `CardTokenOptions.comboLive`'s doc comment for the
    // full rule) — every other segment, and COMBO itself when `comboLive` is
    // `true`/omitted, keeps the ordinary keyword-color lookup.
    color: segment.gateClosed
      ? UI.textDisabled
      : segment.keyword === 'combo' && comboLive === false
        ? UI.textDisabled
        : segment.keyword
          ? keywordTextColor(segment.keyword) ?? fallbackColor
          : segment.calculated
            ? UI.textCalculated
            : fallbackColor,
  }));
}

const GRADIENT_KEY = 'cardtoken-gradient';

/**
 * THE shared card token strip. One component for battle boards, deck build,
 * bag, and prep skill columns. Everything is derived from the real SkillDef +
 * theme maps + card-art catalog — no per-screen copies, no hand-typed values.
 *
 * ALL region geometry comes from `cardTokenSpec.ts` (accent stripe, text
 * lines, corner badges, accessory rail). To move/resize an area or add a new
 * attachment point, change the spec — not this renderer and never a scene.
 */
export class CardToken extends Phaser.GameObjects.Container {
  /** Construction args, kept so `spawnGhost()` can clone this token. */
  readonly sourceSkill: SkillDef;
  readonly sourceOpts: CardTokenOptions;

  /** Art clip mask — drawn in WORLD coords, so it must be redrawn when the token moves. */
  private artMask?: Phaser.GameObjects.Graphics;
  private maskW = 0;
  private maskH = 0;
  private cornerRadius = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, skill: SkillDef, opts: CardTokenOptions) {
    super(scene, x, y);
    this.sourceSkill = skill;
    this.sourceOpts = opts;
    const { width: w, height: h } = opts;
    this.cornerRadius = ACTIVE_PROFILE.id === 'mobile' ? Math.min(12, h / 4) : 0;
    const side = opts.side ?? 'left';
    const spec = cardTokenSpec(w, h, side, opts.accessories?.length ?? 0, Boolean(opts.onInspect));

    // background panel. Frame stroke is TIER-colored whenever an instance
    // tier is known (see `CardTokenOptions.tier`); a bump from 1px to 2px
    // ("slight", not a slab — see that field's doc comment) applies either
    // way, so every token reads a touch crisper even where tier isn't wired
    // up yet. `cursor`/`drag` state below still overrides this outright.
    const frameColor = opts.tier ? TIER_COLOR[opts.tier] : (UI.battleOutline ?? 0x24344a);
    const bg = scene.add.rectangle(0, 0, w, h, 0x121e30).setOrigin(0.5).setStrokeStyle(2, frameColor, opts.tier ? 0.95 : 0.9);
    if (this.cornerRadius) roundRect(bg, this.cornerRadius);
    this.add(bg);

    // Card art, cover-fit and masked to the token rect. Children are LOCAL
    // (0,0 = token center); the geometry mask uses WORLD coords (this.x/y).
    //
    // The art region is ALWAYS filled now. `buildCardArtPlaceholder` paints
    // the card's own identity (element/weapon/property wash + ghosted type
    // badge) straight away, and `whenCardArtReady` drops the real texture on
    // top of it if and when the catalogue has one — the same code path for a
    // skill with no art at all and one whose art is still streaming.
    // `artHost` exists so that late-arriving art lands UNDER the legibility
    // gradient and the text: a bare `this.add()` from an async callback would
    // append it over the whole token.
    const maskShape = scene.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    if (this.cornerRadius) maskShape.fillRoundedRect(x - w / 2, y - h / 2, w, h, this.cornerRadius);
    else maskShape.fillRect(x - w / 2, y - h / 2, w, h);
    const artMask = maskShape.createGeometryMask();
    this.artMask = maskShape;
    this.maskW = w;
    this.maskH = h;
    this.once(Phaser.GameObjects.Events.DESTROY, () => maskShape.destroy());

    const artHost = scene.add.container(0, 0);
    this.add(artHost);
    const placeholder = buildCardArtPlaceholder(scene, skill, -w / 2, -h / 2, w, h);
    if (this.cornerRadius) placeholder.setMask(artMask);
    artHost.add(placeholder);
    whenCardArtReady(scene, skill.id, (artKey) => {
      // The token may have been destroyed while its art was in flight.
      if (!this.scene || !artHost.scene) return;
      const img = scene.add.image(0, 0, artKey);
      const scale = Math.max(w / img.width, h / img.height);
      img.setScale(scale);
      img.setMask(artMask);
      artHost.add(img);
    });

    // legibility gradient (dark on the text side, fading toward the art) —
    // OUTSIDE `artHost`, so it stays above anything that lands inside it.
    const grad = scene.add.image(0, 0, this.ensureGradient(scene)).setDisplaySize(w, h);
    if (this.cornerRadius) grad.setMask(artMask);
    if (side === 'right') grad.setFlipX(true);
    this.add(grad);

    // accent stripe — color straight from the theme maps (element > weapon > property)
    const type = cardType(skill);
    const accentColor = skill.element
      ? (ELEMENT_COLOR[skill.element] ?? PROPERTY_COLOR[skill.property])
      : skill.weapon
        ? (WEAPON_COLOR[skill.weapon] ?? PROPERTY_COLOR[skill.property])
        : PROPERTY_COLOR[skill.property];
    const accent = scene.add.rectangle(spec.accent.x, 0, spec.accent.width, h, accentColor).setOrigin(0.5);
    if (this.cornerRadius) accent.setMask(artMask);
    this.add(accent);

    // text block: NAME · effects summary · affinity(n/3) — all from data,
    // positioned/clamped by the spec's line entries.
    const line = (entry: { dy: number; fontSize: number; maxWidth: number }, text: string, color: string, serif = false): void => {
      const t = scene.add.text(spec.textX, entry.dy, text, {
        fontSize: `${entry.fontSize}px`, color, fontFamily: serif ? FONT.display : FONT.body, fontStyle: 'bold', align: spec.textAlign,
      }).setOrigin(spec.textOriginX, 0.5);
      let s = text;
      while (s.length > 1 && t.width > entry.maxWidth) { s = s.slice(0, -1); t.setText(`${s}…`); }
      this.add(t);
    };
    const faceMode = opts.faceMode ?? defaultFaceMode();
    // Standing CURSE marker (battle playback only — see `slotMods`): the flat
    // damage this piece is losing per hit while the window stands, as a
    // LEADING effects-line segment in the curse keyword's own color (the hue
    // the card text and the DEBUFF log row already teach). Leading, not
    // trailing, so `segmentedLine`'s tail-first truncation can never hide the
    // live modifier on a narrow face. Non-null asserted rather than
    // `?? '#hex'`-defaulted: a pasted fallback would be a drifting copy of
    // the keyword palette's value.
    const curse = opts.slotMods?.curse ?? 0;
    const curseSegments = curse > 0 ? [{ text: `−${curse} DMG`, color: keywordTextColor('curse')! }] : [];
    if (!spec.compact) {
      // Name/affinity inks are the THEME TOKENS, not pasted copies of their
      // values — a copy strands the face on the old palette at the next ground
      // lift (the fate of the scenes' `#8a94a6` on 2026-09-02).
      line(spec.name, skill.name, UI.textBright, true);
      // DMG 16 +ATK / DMG 16 · PSN 5 — each token tinted to match its
      // KEYWORD_TEXT_COLOR (cardTextMarkup.ts) when it has one, so a keyword's
      // color reads the same here as it does in flavor text / the glossary.
      // A keyword-less token whose OWN number folded in this caster's live
      // stat (mobile's 'summed' mode — `EffectSegment.calculated`) instead
      // tints `UI.textCalculated`, so `DMG 37` (this hero's number) reads as
      // visibly different from `AOE` (printed on the card, never computed) —
      // see `effectFaceSegments`'s doc comment for the exact precedence.
      this.segmentedLine(scene, spec, spec.effects, [
        ...curseSegments,
        ...effectFaceSegments(skill, opts.stats, faceMode, '#e8d8b0', opts.comboLive, opts.affinityOpen),
      ], '#e8d8b0');
      line(
        spec.affinity,
        this.affinityLine(skill, type, opts.deck, opts.affinityOpen),
        opts.affinityOpen === false ? UI.textDisabled : UI.textFootnote,
      );
    } else {
      // COMPACT (slim strips like TEMP HOLDING): one centered line, clamped to
      // the token width so long names never overflow the strip. The name
      // token stays cream; effect tokens tint the same as the regular variant.
      // The curse marker rides right after the name (identity first, live
      // modifier second, static effects last — same truncation reasoning).
      this.segmentedLine(scene, spec, spec.compactLine, [
        { text: skill.name, color: UI.textBright },
        ...curseSegments,
        ...effectFaceSegments(skill, opts.stats, faceMode, UI.textBright, opts.comboLive, opts.affinityOpen),
      ], UI.textBright);
    }

    // small dark scrim so a corner label stays readable over bright art.
    // Centered on the text's true glyph bounds (see `chipBox`) rather than
    // reusing the text's own corner origin, so the pad reads as a pill
    // around the label instead of growing lopsided off one edge.
    const scrimLabel = (t: Phaser.GameObjects.Text): void => {
      const box = chipBox(t);
      const scrim = scene.add.rectangle(box.x, box.y, box.width, box.height, 0x0b1420, 0.55).setOrigin(0.5);
      this.add(scrim);
      this.add(t);
    };

    // slot number — inward TOP corner. When there's no slot yet (an OFFER —
    // draft/shop/event card, not yet placed on a board), the same corner
    // instead advertises a multi-slot card's span so a player can never pick
    // a size-N card without knowing it eats N board slots.
    if (opts.slotLabel && spec.showSlotLabel) {
      scrimLabel(scene.add.text(spec.slotLabel.x, spec.slotLabel.y, opts.slotLabel, {
        fontSize: '10px', color: '#e6ecf5', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(spec.cornerOriginX, 0));
    } else if (!opts.slotLabel && skill.size > 1 && spec.showSlotLabel) {
      scrimLabel(scene.add.text(spec.slotLabel.x, spec.slotLabel.y, `×${skill.size} SLOTS`, {
        fontSize: '9px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(spec.cornerOriginX, 0));
    }

    // weight — inward BOTTOM corner badge. A standing BURDEN (battle playback
    // only — see `slotMods`) folds into the number itself: the badge shows the
    // EFFECTIVE weight the engine will actually charge on this piece's next
    // play (castSelect.ts adds `nextWeightPenalty` before the `play` event is
    // ever emitted), tinted in the burden keyword's color so the inflated
    // number is readable as taxed at a glance rather than as a misprint. Same
    // no-pasted-hex rule as the curse marker above (`keywordTextColor` + `!`).
    // Works at EVERY board width on both platforms because the weight badge
    // always renders — unlike the accessory rail, which computes zero slots at
    // mobile card widths and so cannot carry a battle overlay at all.
    const burden = opts.slotMods?.burden ?? 0;
    scrimLabel(scene.add.text(spec.weight.x, spec.weight.y, `W${weightOf(skill) + burden}`, {
      fontSize: '9px', color: burden > 0 ? keywordTextColor('burden')! : '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(spec.cornerOriginX, 1));

    // accessory rail — gem sockets / tier plates / future attachments.
    this.renderAccessories(scene, spec, opts.accessories ?? []);

    // opt-in "ⓘ" inspect button — OUTWARD top corner (see `onInspect`'s doc).
    if (opts.onInspect && spec.inspectButton) {
      this.renderInspectButton(scene, spec.inspectButton, opts.onInspect);
    }

    if (opts.state === 'cursor' || opts.state === 'drag') {
      bg.setStrokeStyle(3, 0xe8b446, 1);
    }
    // Playback cursor badge: gold "▶ NEXT" chip, bottom-outward corner,
    // mirrored per side so it points into the gutter.
    if (opts.state === 'cursor') {
      const badgeText = side === 'left' ? '▶ NEXT' : 'NEXT ◀';
      const t = scene.add.text(spec.cursorBadge.x, spec.cursorBadge.y, badgeText, {
        fontSize: '9px', color: UI.textOnChip, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(side === 'left' ? 1 : 0, 1);
      // Same fix as `scrimLabel`: center the pill on the text's true bounds
      // instead of reusing its corner origin.
      const box = chipBox(t);
      const chip = scene.add.rectangle(box.x, box.y, box.width, box.height, 0xe8b446).setOrigin(0.5);
      this.add(chip);
      this.add(t);
    }
    this.setSize(w, h);
    scene.add.existing(this);
  }

  /**
   * The segmented counterpart of the inline `line()` closure in the
   * constructor — used for the effects/compactLine rows so each keyword
   * token (PSN, SPLASH, …) can carry its own `KEYWORD_TEXT_COLOR` while plain
   * separators and un-keyworded tokens (DMG, HEAL, AOE, …) stay in the line's
   * neutral `fallbackColor` — matching the flavor-text markup renderer's
   * keyword palette (`cardTextMarkup.ts`) instead of flattening it away like
   * the old single flat-cream string did.
   *
   * Phaser has no multi-color rich text in one Text object, so this lays out
   * a small row of Text objects with measured x-offsets — the single-line
   * sibling of `FantasyCardTemplateV2.makeBody`'s word-by-word wrap.
   *
   * Truncation preserves `line()`'s guarantee that a too-wide line never
   * overflows `entry.maxWidth`, but an overflowing TAIL segment is ELLIPSISED
   * IN PLACE rather than dropped whole — `SHLD 8 (T) · T.GUARD 30%…` beats
   * `SHLD 8 (T)…`, because the player can still see the guard exists and its
   * magnitude even though its duration suffix got clipped. Every segment
   * before the tail is left untouched. Only when even a single character plus
   * "…" for the tail still doesn't fit alongside the untouched earlier
   * segments do we drop that whole segment and retry the same ellipsis
   * treatment on the new tail (the previous segment) — cascading toward the
   * front until something fits. A single remaining segment is never dropped
   * (there must always be a defined terminal state): it is clamped down to as
   * little as one character plus "…", however far over width that still
   * leaves it, exactly as `line()`'s own per-character clamp already accepts.
   *
   * A WHOLE-SEGMENT DROP MUST NEVER BE SILENT (2026-09-06 fix). Dropping a
   * segment removes it AND its leading separator, so the remaining line
   * usually fits on its own with no further clipping needed — which means
   * nothing naturally puts a "…" anywhere. Left alone that reads as "this
   * card has no CLEANSE/BURDEN/SPLASH" rather than "one more thing got cut",
   * strictly worse than the pre-ellipsis-in-place renderer this replaced. So
   * after the shrink loop settles, if ANY segment was dropped along the way
   * and the surviving tail doesn't already carry its own "…" (from being
   * ellipsised in place), one is appended here — re-clamping that tail if the
   * marker itself pushes back over budget.
   *
   * PERFORMANCE. The shrink loop above used to destroy and rebuild the ENTIRE
   * row (2n-1 `Text` objects, each a fresh canvas + measurement) for every
   * single character removed while probing a fit. This version uses ONE
   * reusable, un-added-to-the-container `probe` Text purely to MEASURE
   * candidates (`setText` + read `.width`, no new object), and only builds
   * the row's real `Text` objects once, after every segment's final text is
   * already decided.
   */
  private segmentedLine(
    scene: Phaser.Scene,
    spec: CardTokenSpec,
    entry: TokenTextLine,
    segments: { text: string; color: string; joinWithPrevious?: boolean }[],
    fallbackColor: string,
  ): void {
    const makeText = (text: string, color: string): Phaser.GameObjects.Text =>
      scene.add.text(0, entry.dy, text, {
        fontSize: `${entry.fontSize}px`, color, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0, 0.5);

    // Measurement-only scratch node — destroyed before any real row node is
    // created, so it never leaks onto the token or the scene.
    const probe = makeText('', fallbackColor);
    const widthOf = (text: string): number => { probe.setText(text); return probe.width; };
    const joinerBefore = (seg: { joinWithPrevious?: boolean }, index: number): string =>
      effectSegmentJoiner(seg, index);
    const lineWidth = (arr: readonly { text: string; joinWithPrevious?: boolean }[]): number =>
      arr.reduce((sum, seg, i) => sum + widthOf(joinerBefore(seg, i)) + widthOf(seg.text), 0);
    // A mid-word character clip can leave a trailing space before the marker
    // ("T.GUARD 30% …") — trim it so the marker sits flush ("T.GUARD 30%…").
    const ellipsisOf = (text: string): string => `${text.trimEnd()}…`;

    let working = segments.length > 0 ? segments.slice() : [{ text: '', color: fallbackColor }];
    let droppedWhole = false;

    while (lineWidth(working) > entry.maxWidth) {
      const tailIndex = working.length - 1;
      const original = working[tailIndex]!;
      // Everything before the tail is untouched for this pass, so its width
      // is fixed for the whole inner loop — measured once, not per candidate.
      const headWidth = lineWidth(working.slice(0, tailIndex)) + widthOf(joinerBefore(original, tailIndex));
      // The full, unclipped tail is already known not to fit (that's why the
      // outer loop is here), so start shrinking immediately rather than
      // re-probing the exact line that just failed.
      let clipped = original.text.slice(0, -1);
      let fitted = false;
      while (clipped.length > 0) {
        const candidateText = ellipsisOf(clipped);
        if (headWidth + widthOf(candidateText) <= entry.maxWidth) {
          working = [...working.slice(0, tailIndex), { ...original, text: candidateText }];
          fitted = true;
          break;
        }
        clipped = clipped.slice(0, -1);
      }
      if (fitted) break;
      if (working.length === 1) {
        // Terminal state: clamp to as little as one character plus the
        // marker even if that alone still overflows — there must always be
        // something on the face, and this is as small as it gets.
        working = [{ ...original, text: ellipsisOf(original.text.slice(0, 1)) }];
        break;
      }
      // Even a single character plus the marker didn't fit alongside the
      // untouched segments ahead of it — that whole segment is cut. Retry
      // the same ellipsis treatment on the new tail (the previous segment,
      // still whole up to this point).
      working = working.slice(0, tailIndex);
      droppedWhole = true;
    }

    if (droppedWhole) {
      const tailIndex = working.length - 1;
      const original = working[tailIndex]!;
      if (!original.text.endsWith('…')) {
        // The surviving tail fit on its own with no clipping of its own, so
        // nothing above marked the cut. Add it here, re-clamping in case the
        // marker itself pushes the line back over budget.
        const headWidth = lineWidth(working.slice(0, tailIndex)) + widthOf(joinerBefore(original, tailIndex));
        let s = original.text;
        while (s.length > 1 && headWidth + widthOf(ellipsisOf(s)) > entry.maxWidth) s = s.slice(0, -1);
        working = [...working.slice(0, tailIndex), { ...original, text: ellipsisOf(s) }];
      }
    }

    probe.destroy();

    const nodes: Phaser.GameObjects.Text[] = [];
    working.forEach((seg, i) => {
      const joiner = joinerBefore(seg, i);
      if (joiner) nodes.push(makeText(joiner, fallbackColor));
      nodes.push(makeText(seg.text, seg.color));
    });

    const width = nodes.reduce((sum, n) => sum + n.width, 0);
    let cursor = spec.textOriginX === 0 ? spec.textX : spec.textX - width;
    for (const node of nodes) {
      node.setPosition(cursor, entry.dy);
      cursor += node.width;
      this.add(node);
    }
  }

  private renderAccessories(scene: Phaser.Scene, spec: CardTokenSpec, accessories: TokenAccessory[]): void {
    accessories.slice(0, spec.accessoryMax).forEach((acc, index) => {
      const box = spec.accessorySlot(index);
      const r = scene.add.rectangle(box.x, box.y, box.width, box.height, acc.color ?? UI.panelMuted, 0.92)
        .setOrigin(0.5).setStrokeStyle(1, UI.border, 0.9);
      if (this.cornerRadius) roundRect(r, 4);
      const t = scene.add.text(box.x, box.y, acc.label, {
        fontSize: '10px', color: acc.textColor ?? UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0.5);
      this.add(r);
      this.add(t);
    });
  }

  /**
   * The "ⓘ" inspect button — a small dedicated hit target so the REST of the
   * card body is free to be a pure drag surface (the shop's owned board/bag
   * columns need this: dragging the whole card must never race a tap-to-
   * inspect). Its own object-level `pointerdown` fires BEFORE the scene's
   * generic drag listener for the same physical event (Phaser's two-phase
   * dispatch — see `sceneRebuild.ts`'s `wasPointerConsumedByRebuild` doc
   * comment), so a caller whose `onInspect` calls `rerender()` gets that
   * guard automatically; no `stopPropagation()`/consume-flag needed here.
   *
   * The VISUAL footprint is `spec.inspectButton`'s small square (matches the
   * accessory rail's scale), but the INTERACTIVE hit area is widened to
   * `ACTIVE_PROFILE.minTap` on its own (a real, if imperfect, touch target —
   * see the doc note below on the one case this can't fully satisfy).
   */
  private renderInspectButton(scene: Phaser.Scene, box: TokenBox, onInspect: () => void): void {
    const btn = scene.add.rectangle(box.x, box.y, box.width, box.height, 0x0b1420, 0.85)
      .setOrigin(0.5).setStrokeStyle(1, 0xe8b446, 0.9);
    if (this.cornerRadius) roundRect(btn, 4);
    const label = scene.add.text(box.x, box.y, 'i', {
      fontSize: '10px', color: '#e8b446', fontFamily: FONT.display, fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add(btn);
    this.add(label);
    // Hit area centered on the button, independent of its drawn size — see
    // the doc comment above. On the tightest shipped row (mobile's compact
    // board/bag, ~33px tall) a full `minTap` square unavoidably extends a
    // few px past this token's own top edge into the row gap/neighbor; that
    // is a deliberate, minor trade-off for a comfortable tap target rather
    // than a token-bounds violation elsewhere in this component.
    const hit = Math.max(box.width, ACTIVE_PROFILE.minTap);
    btn.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-hit / 2, -hit / 2, hit, hit),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    btn.on('pointerdown', () => onInspect());
  }

  /**
   * A dimmed clone of this token left in the source slot while the real one
   * is dragged — plus a dashed outline so the origin reads as "will vacate".
   * Caller destroys it on drop (scene restarts usually handle it anyway).
   */
  spawnGhost(): Phaser.GameObjects.Container {
    const scene = this.scene;
    // Decorative only — no inspect button on a dimmed, non-interactive ghost.
    const ghost = new CardToken(scene, this.x, this.y, this.sourceSkill, { ...this.sourceOpts, state: 'none', onInspect: undefined });
    ghost.setAlpha(0.35);
    const { width: w, height: h } = this.sourceOpts;
    const outline = scene.add.graphics();
    outline.lineStyle(2, 0xe8b446, 0.75);
    const dash = 8; const gapLen = 6;
    const seg = (x1: number, y1: number, x2: number, y2: number): void => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len; const uy = (y2 - y1) / len;
      for (let s0 = 0; s0 < len; s0 += dash + gapLen) {
        const e = Math.min(s0 + dash, len);
        outline.moveTo(x1 + ux * s0, y1 + uy * s0);
        outline.lineTo(x1 + ux * e, y1 + uy * e);
      }
    };
    seg(-w / 2, -h / 2, w / 2, -h / 2); seg(w / 2, -h / 2, w / 2, h / 2);
    seg(w / 2, h / 2, -w / 2, h / 2); seg(-w / 2, h / 2, -w / 2, -h / 2);
    outline.strokePath();
    ghost.add(outline);
    ghost.setDepth(500); // above the board, below the dragged token (1000)
    return ghost;
  }

  /**
   * Keep the world-space art mask aligned with the token as it moves (drag).
   * A geometry mask is not a child, so it does NOT follow the container on its
   * own — we redraw its rect at the new center here.
   */
  override setPosition(x?: number, y?: number, z?: number, w?: number): this {
    super.setPosition(x, y, z, w);
    this.syncWorldArtMask();
    return this;
  }

  /** Re-align after a parent container moves without calling this token's setPosition. */
  syncWorldArtMask(): void {
    if (this.artMask) {
      syncCardArtMask(this.artMask, this.getWorldTransformMatrix(), this.maskW, this.maskH, this.cornerRadius);
    }
  }

  /**
   * "SWORD 2/3" — affinity name + deck progress toward its identity. The
   * progress FRACTION only means anything when the gate is being derived
   * from a raw board recount, which is exactly what `affinityOpen` (2026-09-06
   * — see `CardTokenOptions.affinityOpen`) replaces once it is known. THE
   * BOARD IS THE ONLY SOURCE (`docs/board-type-identity.md`): element and
   * weapon are tallied SEPARATELY, so a board can earn neither, either, or
   * both axes, and nothing outside the board's own cards — no authored
   * override — can open a gate a recount says is shut. A stale "FIRE 2/3"
   * count would disagree with the SAME clause this exact chip sits beside on
   * the face the moment the true state is known. So: whenever the caller
   * KNOWS the true state (`affinityOpen !== undefined` — a real battle), this
   * chip stops counting and instead reads the bare type name, colored by the
   * call site the same open/closed way as the gated clause (see the `line()`
   * call above) — the two can no longer disagree because both read the
   * identical boolean. Only with NO known state (deck build / shop / wiki —
   * `affinityOpen` omitted) does the deck-count progress fraction print,
   * unchanged from before.
   */
  private affinityLine(skill: SkillDef, type: ReturnType<typeof cardType>, deck?: readonly SkillDef[], affinityOpen?: boolean): string {
    const label = skill.element
      ? skill.element.toUpperCase()
      : skill.weapon
        ? (skill.weapon === 'beast' ? 'BEAST' : skill.weapon.toUpperCase())
        : 'TRUE';
    if (affinityOpen !== undefined) return label;
    if (!deck || !type) return label;
    const count = deck.filter((d) => {
      const t = cardType(d);
      return t !== undefined && t.kind === type.kind && t.type === type.type;
    }).length;
    return `${label} ${Math.min(count, IDENTITY_THRESHOLD)}/${IDENTITY_THRESHOLD}`;
  }

  /** A reusable 1px-tall horizontal gradient texture: opaque dark → transparent. */
  private ensureGradient(scene: Phaser.Scene): string {
    if (scene.textures.exists(GRADIENT_KEY)) return GRADIENT_KEY;
    const tex = scene.textures.createCanvas(GRADIENT_KEY, 64, 1);
    if (!tex) return GRADIENT_KEY;
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(11,20,32,0.93)');
    g.addColorStop(0.46, 'rgba(11,20,32,0.80)');
    g.addColorStop(1, 'rgba(11,20,32,0.20)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 1);
    tex.refresh();
    return GRADIENT_KEY;
  }
}
