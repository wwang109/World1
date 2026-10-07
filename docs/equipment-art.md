# Equipment artwork

Status: the user rejected this art style. Existing assets are temporary; further generation is paused until a new style direction is supplied. The sizing and crop-safety contract still applies.

The user requested simple, centered, crop-safe equipment icons. Use one individual image per item. Do not extract equipment from multi-item sheets: those crops cut silhouettes and include neighboring fragments.

## Source contract

- One upright item on a transparent square canvas; complete silhouette, including loops, sleeves, shoulders and tassels.
- Clean dark outlines, broad flat colors and limited cel shading. No filigree, textures, glow, scene backgrounds or text.
- Request 20% transparent space around the subject during generation. Inspect the actual master; generated margins can vary. Do not accept an item touching the canvas edge. The encoder enforces the final 8% inset.
- Style reference: `art-src/equipment-style-preview/duelist-coat-simple.png`.
- Masters: `art-src/equipment/<itemId>.png`. Served art: `public/game-art/equipment/<itemId>.webp`.

## Encoding and display

Run `npm run art:encode -- --group equipment --force` after changing the contract. The equipment group measures the visible alpha bounds, fits the whole subject without stretching, centers it in a 512 × 512 canvas and leaves an 8% transparent inset on every side. Changing encoder settings requires `--force`; file timestamps alone do not capture those settings.

Every bag image uses the same square image region on its platform. The image is contained within that region, preserving its aspect ratio. The larger equipped and selected-item views use the same texture and contain sizing.

The equipment screen audit checks every catalog item's loaded image for 512 × 512 dimensions, transparent edge clearance and visible bounds centered within two pixels. Master silhouette inspection and the complete served contact sheet additionally catch source clipping and unwanted fragments, which edge padding alone cannot prove absent. The Huntsman, Tactician and Hexweaver expansion reuses nine existing textures via explicit temporary aliases in `src/game/ui/equipmentArt.ts`; these are placeholders, not newly approved artwork.

Generation used the built-in image tool. Shared prompt: one named item, match the simple coat reference, broad flat shapes, bold outline, limited cel shading, centered complete silhouette, transparent background with 20% margins, no text/frame/neighboring objects. Item colors and silhouettes follow the equipment catalog; gameplay data is unchanged.
