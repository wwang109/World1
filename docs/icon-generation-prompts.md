# Icon Generation Prompts — copy one block per generation

## GEM RARITY JEWELS (2026-09-13)

One isolated faceted elongated jewel per transparent square image, matching the
selected compact GEM DETAILS reference: icy white/cyan Common, blue Rare,
violet Epic, amber/gold Legendary. No text, frames, checkerboard or UI chrome.
The four families are visual rarity identities, not a gem upgrade ladder.

Masters: `art-src/ui/gems/{common,rare,epic,legendary}.png`.
Derivatives: `public/game-art/ui/gems/{common,rare,epic,legendary}.webp`.
Encode only `npm run art:encode -- --group gems` (max height 256, quality 0.84).
Preload keys: `gem-rarity-{rarity}`. `GemToken` contain-fits the asset for
Shop shelves, owned inventory and the shared Shop/Deck gem inspector.

## WEAPONS

```
A set of five fantasy game icons arranged in a grid. Each icon is a single emblem centered on a dark navy HEXAGONAL badge plate with a thin beveled metallic rim. The hexagon is POINTY-TOP: one corner at the top, one corner at the bottom, flat vertical left and right sides. Lightweight cute glossy game icon style, like Ragnarok Online and MapleStory inventory icons: clean bold outlines, soft glossy shading with bright highlights, warm cheerful saturated colors, rounded charming shapes, gentle glow, polished and adorable, no gritty textures, no photorealism. Lay out EXACTLY a 3-column by 2-row grid of equal square cells on a plain very dark background (#14181f). One badge per cell, centered, the hexagon filling 60% of its cell, generous empty padding inside every cell edge, no badge touching or crossing a cell boundary, no grid lines, no labels, no text, no watermark. Top row, left to right: a knight's longsword pointing upward; a heavy bearded battle axe; a long knight's cavalry lance with a conical tip, pointing upward. Bottom row, left to right: a recurve bow with a nocked arrow; a pair of curved beast fangs; leave the last cell completely empty. Emblems are oversized and extend about 10-15% past their hexagon's edges, in front of the rim, while the hexagon stays fully visible behind them.
```

## ELEMENTS

```
A set of six fantasy game icons arranged in a grid. Each icon is a single emblem centered on a dark navy HEXAGONAL badge plate with a thin beveled metallic rim. The hexagon is POINTY-TOP: one corner at the top, one corner at the bottom, flat vertical left and right sides. Lightweight cute glossy game icon style, like Ragnarok Online and MapleStory inventory icons: clean bold outlines, soft glossy shading with bright highlights, warm cheerful saturated colors, rounded charming shapes, gentle glow, polished and adorable, no gritty textures, no photorealism. Lay out EXACTLY a 3-column by 2-row grid of equal square cells on a plain very dark background (#14181f). One badge per cell, centered, the hexagon filling 60% of its cell, generous empty padding inside every cell edge, no badge touching or crossing a cell boundary, no grid lines, no labels, no text, no watermark. Top row, left to right: a stylized flame in orange-red; a six-pointed snowflake in ice blue; a jagged lightning bolt in electric yellow. Bottom row, left to right: a curled living leaf in vivid green; a radiant sun with eight rays in gold; a crescent moon with a shadowed halo in deep violet. Emblems are oversized and extend about 10-15% past their hexagon's edges, in front of the rim, while the hexagon stays fully visible behind them.
```

## ARCHETYPES

```
A set of five fantasy game icons arranged in a grid. Each icon is a single emblem centered on a dark navy HEXAGONAL badge plate with a thin beveled metallic rim. The hexagon is POINTY-TOP: one corner at the top, one corner at the bottom, flat vertical left and right sides. Lightweight cute glossy game icon style, like Ragnarok Online and MapleStory inventory icons: clean bold outlines, soft glossy shading with bright highlights, warm cheerful saturated colors, rounded charming shapes, gentle glow, polished and adorable, no gritty textures, no photorealism. Lay out EXACTLY a 3-column by 2-row grid of equal square cells on a plain very dark background (#14181f). One badge per cell, centered, the hexagon filling 60% of its cell, generous empty padding inside every cell edge, no badge touching or crossing a cell boundary, no grid lines, no labels, no text, no watermark. Top row, left to right: two crossed swords in crimson; a kite shield in steel blue; a glowing healing cross in green. Bottom row, left to right: an eight-pointed guiding star in gold; a cursed skull in violet; leave the last cell completely empty. Emblems are oversized and extend about 10-15% past their hexagon's edges, in front of the rim, while the hexagon stays fully visible behind them.
```

## CARD ART (one card per generation, portrait 1024×1536)

```
Full-card vertical skill illustration, 1024x1536 portrait: {SPELL / WEAPON / RELIC SUBJECT}. Bright manga/anime adventure painting with crisp matte cel-painted shapes, restrained ink accents, broad azure/cyan sky or atmosphere, fresh green landscape planes and warm cream/coral/gold light. Keep the skill's recognizable weapon, element or relic as the clear focal subject; do not replace its identity with a generic landscape. Luminous readable cool shadows, controlled effects and simple silhouettes, no gritty photorealism, glossy 3D finish or black vignette. Main focal detail centered inside x80-340/y130-420 of the 420x690 full-card template; lower third calm muted blue-green with no critical detail beneath the existing UI scrim. Dark and night subjects retain their identity through luminous blue/violet and warm local light. Opaque edge-to-edge artwork, no characters, hands, text, border, frame, logo or watermark. The UI owns the thin tier trim; do not paint card chrome into the image.
```
