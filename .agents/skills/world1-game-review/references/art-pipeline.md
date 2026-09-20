# Art pipeline and placeholder hunting

## The master/derivative pipeline

Verified against `docs/card-template-spec.md` §4.1 and the real checkout
layout (`art-src/` has `cards/`, `placeholders/`, `ui/`, `manga-staging/`;
`public/game-art/` has `cards/`, `placeholders/`, `ui/`, `template/`):

- Masters live in `art-src/` (PNG, never served — `vite build` copies
  `public/` verbatim and `art-src/` is outside it).
- Served derivatives live in `public/game-art/**` (WebP, except the small
  `template/badge-*.png` chrome and `card-template-parts-transparent.png`,
  which ship as PNG on purpose).
- `npm run art:encode` (`scripts/encode-card-art.ts`) generates the WebP from
  the matching master. It does not run as part of `npm run build` — the
  encoder needs a Chromium binary neither `npm test` nor the Cloudflare Pages
  build has. This checkout may have no `node_modules/.bin`, in which case
  `npm run art:encode` fails to resolve; the direct form is `node
  node_modules/tsx/dist/cli.mjs scripts/encode-card-art.ts`, verified against
  this checkout (it needs a local Chromium via `playwright`'s
  `chromium.launch()` at `scripts/encode-card-art.ts:78` — present and
  working here, but confirm on yours before relying on it; if Chromium is
  genuinely absent this step cannot run and the master alone cannot be
  committed as done).
- The WebP is generated but **committed**, not build output. Adding or
  changing card art is a two-step commit: drop the master in `art-src/`, run
  `npm run art:encode`, commit both.
- `scripts/gen-placeholder-art.ts` and `scripts/shrink-placeholder-art.mjs`
  exist for placeholder generation; `src/game/ui/cardArtPlaceholder.ts` is the
  runtime fallback when art is missing or still streaming.

## Find missing images

An image is not "missing" merely because its final art is unattractive.
Classify each candidate by comparing all four sources:

1. runtime catalog or preload reference in `src/game`
2. intended master path in `art-src/`
3. served derivative in `public/game-art/`
4. prompt or asset contract in the relevant art document

Use these categories:

- **broken reference**: runtime expects a derivative that is absent
- **missing master**: derivative exists but the editable PNG master is absent
- **unencoded master**: master exists but its WebP derivative is absent or stale
- **placeholder**: both files exist, but the documented placeholder still needs
  final artwork
- **unwired art**: artwork exists but no current runtime surface uses it
- **optional opportunity**: no contract requires it; propose rather than assume

Inspect the image visually before classifying it. Filename, flat-color size, or
directory alone is not enough proof that an asset is still a placeholder.

Return an inventory with the asset's purpose, current state, source of truth,
master path, derivative path, target dimensions/aspect, transparency, runtime
consumer, and recommended next action.

## Generate and integrate requested art

Use the image-generation skill/tool for raster artwork. Reuse an existing prompt
block from `docs/icon-generation-prompts.md` or `docs/art-prompt-pack.md` when it
owns the asset family. Preserve its shared style lines, composition constraints,
alpha/opaque requirement, crop safety, and exact subject. Do not silently invent
a new visual language.

For a new asset family:

1. derive the visual requirements from its actual display slot and both layouts
2. propose the reusable style and exact path contract
3. add the prompt/placement contract to the appropriate owner document
4. add placeholder generation support when the project expects placeholders
5. generate the final raster only after the user has authorized generation

For each generated or replaced image:

1. inspect the result at full size
2. reject text, watermarks, unintended borders, bad alpha, wrong aspect, unsafe
   crops, illegible small-scale silhouettes, and style drift
3. save the PNG master to the exact `art-src/` path
4. run `npm run art:encode` (direct form if `node_modules/.bin` is missing:
   `node node_modules/tsx/dist/cli.mjs scripts/encode-card-art.ts` — needs a
   working local Chromium; if that is unavailable, say so and stop before
   claiming the derivative exists)
5. confirm the matching committed WebP exists under `public/game-art/`
6. open the live consuming screen at desktop and mobile sizes
7. verify crop, contrast, readability, seams, and loading behavior
8. run the gate chain (`npm test`: boundaries → typecheck → skill parity) and
   reconfirm the live screen at both sizes — there are no test files to run
   (`CLAUDE.md`, "Verification is by evidence — no test files")

Commit or deliver both the PNG master and WebP derivative. `vite build` does not
perform encoding.

Do not replace badge icons or generate duplicate thumbnails when the art owner
document says to reuse or crop an existing asset.

## Completion bar for an art task

An art task is complete only when the master and derivative exist, the live
game uses the derivative correctly on both platforms, and the relevant checks
pass.
