import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART_MANIFEST_PATH, GAME_ROOT, MANIFEST_PATH, safeFile, validateContentSnapshot } from './contentSnapshot';

export const TRUSTED_WORKFLOW=`name: Trusted content validation
on:
  pull_request_target:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      TRUSTED_GAME_REVISION: \${{ vars.TRUSTED_GAME_REVISION }}
    steps:
      - name: Require immutable trusted game revision
        shell: bash
        run: '[[ "$TRUSTED_GAME_REVISION" =~ ^[a-f0-9]{40}$ ]]'
      - name: Checkout trusted game tooling
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          repository: wwang109/World1
          ref: \${{ env.TRUSTED_GAME_REVISION }}
          path: trusted
          persist-credentials: false
      - name: Checkout candidate as data
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.event.pull_request.head.sha || github.sha }}
          path: candidate
          persist-credentials: false
          submodules: false
          lfs: false
      - name: Install trusted dependencies only
        working-directory: trusted
        run: npm ci --no-audit --no-fund
      - name: Validate isolated candidate
        working-directory: trusted
        env:
          CANDIDATE_SHA: \${{ github.event.pull_request.head.sha || github.sha }}
          BASE_SHA: \${{ github.event.pull_request.base.sha || github.sha }}
          REPOSITORY_ID: \${{ github.repository_id }}
          PR_NUMBER: \${{ github.event.pull_request.number || 0 }}
        run: node node_modules/tsx/dist/cli.mjs scripts/validate-community-candidate.ts --root ../candidate --sha "$CANDIDATE_SHA" --base-sha "$BASE_SHA" --repository-id "$REPOSITORY_ID" --pr-number "$PR_NUMBER" --game-revision "$TRUSTED_GAME_REVISION"
      - name: Upload immutable candidate report
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: content-validation-report
          path: trusted/tmp/content-validation-report.json
          if-no-files-found: error
          retention-days: 30
`;
export const TRUSTED_GITATTRIBUTES='src/data/content/** -text\nart-manifest.v1.json -text\ncontent-manifest.v1.json -text\npublic/game-art/** -text\nart-src/** -text\n*.md text eol=lf\n.github/workflows/*.yml text eol=lf\n';
export const TRUSTED_PROPOSAL_SCHEMA=JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false,required:['version','title','category','description','attribution','contentPaths','previewPaths'],properties:{version:{const:1},title:{type:'string',minLength:1,maxLength:100},category:{enum:['card','gem','equipment','event','art']},description:{type:'string',minLength:1,maxLength:12000},attribution:{type:'string',minLength:1,maxLength:2000},contentPaths:{type:'array',maxItems:32,items:{type:'string'}},previewPaths:{type:'array',maxItems:4,items:{type:'string'}}}},null,2)+'\n';
export const EXPORTED_SHARED_MASTERS=['art-src/card-template-parts.png','art-src/ui/route-icons/day-chapters-symbols.png','art-src/ui/route-icons/equipment.png','art-src/ui/event-icons/illustrated-event-icons.png','art-src/ui/card-badges/illustrated-badges.png','art-src/ui/shop-borders/jointed-shop-frame-v3.png','art-src/ui/painted-fantasy-frame.png','art-src/ui/painted-fantasy-border-transparent.png'] as const;
export const TRUSTED_REPOSITORY_CONTROLS={'.github/workflows/validate-content.yml':TRUSTED_WORKFLOW,'.gitattributes':TRUSTED_GITATTRIBUTES,'community/proposal.schema.json':TRUSTED_PROPOSAL_SCHEMA} as const;
export async function exportCommunityRepository(destination:string):Promise<{files:number;runtimeBytes:number}>{
  const root=GAME_ROOT;destination=resolve(destination);
  if(destination===root||!destination.startsWith(`${join(root,'tmp')}\\`)&&!destination.startsWith(`${join(root,'tmp')}/`))throw new Error('Export destination must be a new directory inside game tmp/');
  if(existsSync(destination)&&readdirSync(destination).length)throw new Error('Export destination is not empty');
  const {manifest,art}=await validateContentSnapshot(root);mkdirSync(destination,{recursive:true});
  const copy=(path:string):void=>{const target=join(destination,path);mkdirSync(dirname(target),{recursive:true});cpSync(safeFile(root,path),target);};
  for(const file of manifest.files)copy(file.path);copy(MANIFEST_PATH);
  const masters=new Set(art.assets.flatMap(asset=>asset.master?[asset.master]:[]));
  // Atlas inputs and shared production chrome are not one-to-one derivatives.
  for(const path of EXPORTED_SHARED_MASTERS)if(existsSync(join(root,path)))masters.add(path);
  for(const path of [...masters].sort())copy(path);
  const write=(path:string,text:string):void=>{const target=join(destination,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);};
  write('README.md',`# Wandering Hand community content\n\nPublic contribution snapshot for Wandering Hand. The game code repository remains wwang109/World1. Runtime definitions and served artwork are pinned together by content-manifest.v1.json. Merging changes does not alter a running game; the next separately authorized game deployment refreshes main once to an immutable commit.\n\nRead [CONTRIBUTING.md](CONTRIBUTING.md). Contributions enter through pull requests. Gameplay earning/support requires a game account; submitting a pull request requires a GitHub account.\n\nNo general reuse license is granted for existing code or art. Publication here does not establish third-party reuse rights. Contributors must identify sources and rights and submit only material they own or have permission to publish. Broader licensing requires a separate owner decision.\n\nThe trusted validation workflow requires the repository variable TRUSTED_GAME_REVISION to name a published game commit containing the community validator. It intentionally fails closed until that pin is configured. Configure protected automation-only merging before opening contributions.\n`);
  write('CONTRIBUTING.md',`# Contributing\n\nFork this repository and open a pull request against main. Add one community/proposals/<submission-id>/proposal.json using community/proposal.schema.json. Include a title, category, description and rights/source attribution; contentPaths and previewPaths are bounded relative paths (at most 32 and 4). Text-only ideas may leave both arrays empty. Drafts belong under the proposal folder and do not enter runtime manifests.\n\nEdit authored JSON under src/data/content; event packs generate events.v3.json. Preserve every shipped ID/version and frozen events.v1.json/events.v2.json. Add versions rather than rewriting history. enemies.v1.json owns equipment drops; editing it does not change the TypeScript combat roster. Unsupported actions or event operations require a game code change.\n\nArt mappings belong in art-manifest.v1.json. Keep production PNG masters in art-src and generated WebP under public/game-art. Keep stable texture keys; provide required desktop/mobile variants and source/rights attribution. Existing explicit fallback entries are game policy, not permission to add missing art. Staging/reference images and scripts are excluded.\n\nUse the maintainer-selected compatible game revision's tooling in an isolated checkout: overlay candidate content, run npm run content:events, npm run content:wiki, npm run content:equipment-template, and npm run content:snapshot -- --write. Copy only generated events.v3.json, manifests and authored/art files back here. Never run content:export during sync. CI runs trusted game tooling, never candidate scripts. Trusted validation rejects duplicate raw keys, missing references/images, altered shipped history, invalid dimensions/alpha, stale generated aggregates, hashes and paths.\n\nA reviewed proposal becomes eligible for in-game support at an exact PR head SHA. Changing the PR suspends spending until review. Seven-day UTC rounds select the highest positively supported technically eligible PR; protected automation merges the winner. There is no automatic deployment.\n`);
  for(const [path,text]of Object.entries(TRUSTED_REPOSITORY_CONTROLS))write(path,text);
  return {files:manifest.files.length+masters.size+6,runtimeBytes:manifest.files.reduce((total,file)=>total+file.bytes,0)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await exportCommunityRepository(process.argv[2]??join(GAME_ROOT,'tmp/wandering-hand-content')));
