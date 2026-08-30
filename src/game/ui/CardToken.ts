import Phaser from 'phaser';
import { weightOf, type SkillDef, type SkillTier } from '../../engine/types';
import { ELEMENT_COLOR, FONT, PROPERTY_COLOR, TIER_COLOR, UI, WEAPON_COLOR } from '../theme';
import { cardType, IDENTITY_THRESHOLD } from '../../engine/combat/typeIdentity';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { buildCardArtPlaceholder } from './cardArtPlaceholder';
import { whenCardArtReady } from './cardArtLoader';
import { summarizeEffectSegments, type EffectSegment, type ScalingStats, type SkillFaceMode } from './skillPresentation';
import { keywordTextColor } from './cardTextMarkup';
import { cardTokenSpec, chipBox, type CardTokenSpec, type TokenBox, type TokenTextLine } from './cardTokenSpec';

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
 * `fallbackColor` otherwise (DMG/HEAL/AOE and any other un-keyworded token).
 * This is what makes the card face's compact effects line match the
 * flavor-text markup renderer's keyword palette (FantasyCardTemplateV2) —
 * previously the two never shared a color at all. */
function effectFaceSegments(
  skill: SkillDef, stats: ScalingStats | undefined, mode: SkillFaceMode, fallbackColor = '#e8d8b0', comboLive?: boolean,
): { text: string; color: string }[] {
  return summarizeEffectSegments(skill, stats, mode).map((segment: EffectSegment) => ({
    text: segment.text,
    // The COMBO segment overrides its keyword color to the disabled tone
    // when battle playback says it isn't live right now (see
    // `CardTokenOptions.comboLive`'s doc comment for the full rule) — every
    // other segment, and COMBO itself when `comboLive` is `true`/omitted,
    // keeps the ordinary keyword-color lookup.
    color: segment.keyword === 'combo' && comboLive === false
      ? UI.textDisabled
      : (segment.keyword && keywordTextColor(segment.keyword)) ?? fallbackColor,
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

  constructor(scene: Phaser.Scene, x: number, y: number, skill: SkillDef, opts: CardTokenOptions) {
    super(scene, x, y);
    this.sourceSkill = skill;
    this.sourceOpts = opts;
    const { width: w, height: h } = opts;
    const side = opts.side ?? 'left';
    const spec = cardTokenSpec(w, h, side, opts.accessories?.length ?? 0, Boolean(opts.onInspect));

    // background panel. Frame stroke is TIER-colored whenever an instance
    // tier is known (see `CardTokenOptions.tier`); a bump from 1px to 2px
    // ("slight", not a slab — see that field's doc comment) applies either
    // way, so every token reads a touch crisper even where tier isn't wired
    // up yet. `cursor`/`drag` state below still overrides this outright.
    const frameColor = opts.tier ? TIER_COLOR[opts.tier] : (UI.battleOutline ?? 0x24344a);
    const bg = scene.add.rectangle(0, 0, w, h, 0x121e30).setOrigin(0.5).setStrokeStyle(2, frameColor, opts.tier ? 0.95 : 0.9);
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
    maskShape.fillRect(x - w / 2, y - h / 2, w, h);
    const artMask = maskShape.createGeometryMask();
    this.artMask = maskShape;
    this.maskW = w;
    this.maskH = h;
    this.once(Phaser.GameObjects.Events.DESTROY, () => maskShape.destroy());

    const artHost = scene.add.container(0, 0);
    this.add(artHost);
    // The placeholder is drawn AT the token rect, so it needs no clip — only
    // the cover-fit art below overflows. Leaving it unmasked keeps the number
    // of stencil-masked objects exactly where it was before the placeholder
    // existed (one per token that actually has art), which matters on the
    // wiki's 166-card grid.
    artHost.add(buildCardArtPlaceholder(scene, skill, -w / 2, -h / 2, w, h));
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
    if (side === 'right') grad.setFlipX(true);
    this.add(grad);

    // accent stripe — color straight from the theme maps (element > weapon > property)
    const type = cardType(skill);
    const accentColor = skill.element
      ? (ELEMENT_COLOR[skill.element] ?? PROPERTY_COLOR[skill.property])
      : skill.weapon
        ? (WEAPON_COLOR[skill.weapon] ?? PROPERTY_COLOR[skill.property])
        : PROPERTY_COLOR[skill.property];
    this.add(scene.add.rectangle(spec.accent.x, 0, spec.accent.width, h, accentColor).setOrigin(0.5));

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
    if (!spec.compact) {
      line(spec.name, skill.name, '#e8e0c8', true);
      // DMG 16 +ATK / DMG 16 · PSN 5 — each token tinted to match its
      // KEYWORD_TEXT_COLOR (cardTextMarkup.ts) when it has one, so a keyword's
      // color reads the same here as it does in flavor text / the glossary.
      this.segmentedLine(scene, spec, spec.effects, effectFaceSegments(skill, opts.stats, faceMode, '#e8d8b0', opts.comboLive), '#e8d8b0');
      line(spec.affinity, this.affinityLine(skill, type, opts.deck), '#9aa4b6');
    } else {
      // COMPACT (slim strips like TEMP HOLDING): one centered line, clamped to
      // the token width so long names never overflow the strip. The name
      // token stays cream; effect tokens tint the same as the regular variant.
      this.segmentedLine(scene, spec, spec.compactLine, [
        { text: skill.name, color: '#e8e0c8' },
        ...effectFaceSegments(skill, opts.stats, faceMode, '#e8e0c8', opts.comboLive),
      ], '#e8e0c8');
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

    // weight — inward BOTTOM corner badge
    scrimLabel(scene.add.text(spec.weight.x, spec.weight.y, `W${weightOf(skill)}`, {
      fontSize: '9px', color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold',
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
        fontSize: '9px', color: '#1a1208', fontFamily: FONT.body, fontStyle: 'bold',
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
   * overflows `entry.maxWidth`: it first drops WHOLE trailing segments (each
   * drop marked with a "…" on the last kept one, so cut content is visible as
   * cut rather than silently missing) and, only if even a single remaining
   * segment alone is wider than the line, falls back to `line()`'s original
   * per-character ellipsis clamp on that segment's own text.
   */
  private segmentedLine(
    scene: Phaser.Scene,
    spec: CardTokenSpec,
    entry: TokenTextLine,
    segments: { text: string; color: string }[],
    fallbackColor: string,
  ): void {
    const SEP = ' · ';
    const makeText = (text: string, color: string): Phaser.GameObjects.Text =>
      scene.add.text(0, entry.dy, text, {
        fontSize: `${entry.fontSize}px`, color, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0, 0.5);
    const totalWidth = (nodes: Phaser.GameObjects.Text[]): number => nodes.reduce((sum, n) => sum + n.width, 0);
    const destroyAll = (nodes: Phaser.GameObjects.Text[]): void => nodes.forEach((n) => n.destroy());
    const build = (working: { text: string; color: string }[]): Phaser.GameObjects.Text[] => {
      const nodes: Phaser.GameObjects.Text[] = [];
      working.forEach((seg, i) => {
        if (i > 0) nodes.push(makeText(SEP, fallbackColor));
        nodes.push(makeText(seg.text, seg.color));
      });
      return nodes;
    };

    let working = segments.length > 0 ? segments : [{ text: '', color: fallbackColor }];
    let nodes = build(working);
    let droppedSegments = false;
    while (totalWidth(nodes) > entry.maxWidth && working.length > 1) {
      destroyAll(nodes);
      working = working.slice(0, -1);
      droppedSegments = true;
      nodes = build(working);
    }
    if (totalWidth(nodes) > entry.maxWidth) {
      // A single remaining segment still doesn't fit — fall back to
      // `line()`'s own character-by-character ellipsis clamp, applied to
      // just that segment's text.
      const only = nodes[nodes.length - 1]!;
      let s = working[working.length - 1]!.text;
      while (s.length > 1 && totalWidth(nodes) > entry.maxWidth) {
        s = s.slice(0, -1);
        only.setText(`${s}…`);
      }
    } else if (droppedSegments) {
      // Fits now, but trailing segments were cut — mark it, re-clamping in
      // case the added "…" itself pushes the line back over width.
      const last = nodes[nodes.length - 1]!;
      let s = working[working.length - 1]!.text;
      last.setText(`${s}…`);
      while (s.length > 1 && totalWidth(nodes) > entry.maxWidth) {
        s = s.slice(0, -1);
        last.setText(`${s}…`);
      }
    }

    const width = totalWidth(nodes);
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
    if (this.artMask) {
      this.artMask.clear();
      this.artMask.fillStyle(0xffffff);
      this.artMask.fillRect(this.x - this.maskW / 2, this.y - this.maskH / 2, this.maskW, this.maskH);
    }
    return this;
  }

  /** "SWORD 2/3" — affinity name + deck progress toward its identity (gold at 3/3). */
  private affinityLine(skill: SkillDef, type: ReturnType<typeof cardType>, deck?: readonly SkillDef[]): string {
    const label = skill.element
      ? skill.element.toUpperCase()
      : skill.weapon
        ? (skill.weapon === 'beast' ? 'BEAST' : skill.weapon.toUpperCase())
        : 'TRUE';
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
