import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import type { ContentManifest } from '../src/data/contentManifest';
import type { ArtManifest } from '../src/data/artManifest';
import { findDuplicateKeys } from './jsonDuplicateKeys';

export const GAME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = 'content-manifest.v1.json';
export const ART_MANIFEST_PATH = 'art-manifest.v1.json';
export const REQUIRED_CONTENT = ['skills.v1.json','gems.v1.json','equipment.v1.json','equipment-loot.v1.json','enemies.v1.json','modifiers.v1.json','event-discoveries.v1.json','events.v1.json','events.v2.json','events.v3.json'].map(name => `src/data/content/${name}`);
export class SnapshotError extends Error {
  constructor(readonly problems: readonly string[]) { super(problems.join('\n')); this.name = 'SnapshotError'; }
}
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const decodedImages = new Map<string,Promise<void>>();
export function safeRuntimePath(path: string): boolean {
  return typeof path === 'string' && path.length <= 240 && /^[a-zA-Z0-9_./-]+$/.test(path)
    && !path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))
    && (path === ART_MANIFEST_PATH || REQUIRED_CONTENT.includes(path)
      || /^src\/data\/content\/event-packs\/[a-zA-Z0-9_-]+\.json$/.test(path)
      || /^public\/game-art\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(webp|png)$/.test(path));
}
export function safeFile(root: string, path: string): string {
  if (path.includes('\\') || path.split('/').some(segment => !segment || segment === '.' || segment === '..') || path.startsWith('/') || path.includes(':')) throw new SnapshotError([`unsafe path: ${path}`]);
  let current = resolve(root);
  if (lstatSync(current).isSymbolicLink()) throw new SnapshotError(['snapshot root is a symlink']);
  for (const part of path.split('/')) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new SnapshotError([`symlink forbidden: ${path}`]);
  }
  return current;
}
function exact(value: unknown, keys: readonly string[], at: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new SnapshotError([`${at}: invalid object/unknown fields`]);
}
export function readStrictJson(root: string, path: string, maxBytes = 8 * 1024 * 1024): unknown {
  const file = safeFile(root,path); const bytes = readFileSync(file);
  if (bytes.length > maxBytes) throw new SnapshotError([`${path}: oversized JSON`]);
  const raw = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if (findDuplicateKeys(raw).length) throw new SnapshotError([`${path}: duplicate JSON keys`]);
  return JSON.parse(raw);
}
export function parseContentManifest(value: unknown): ContentManifest {
  exact(value,['schemaVersion','gameContentApiVersion','files'],MANIFEST_PATH);
  if(value.schemaVersion !== 1 || value.gameContentApiVersion !== 1 || !Array.isArray(value.files) || value.files.length > 2000) throw new SnapshotError(['incompatible content schema/API or file count']);
  const seen = new Set<string>(); let total=0;
  for(const entry of value.files) {
    exact(entry,['path','sha256','bytes'],'manifest file');
    if(typeof entry.path !== 'string' || !safeRuntimePath(entry.path) || seen.has(entry.path.toLowerCase())) throw new SnapshotError([`unsafe/duplicate runtime path: ${String(entry.path)}`]);
    seen.add(entry.path.toLowerCase());
    if(typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || (entry.bytes as number)<=0 || (entry.bytes as number)>16*1024*1024) throw new SnapshotError([`${entry.path}: invalid hash/byte bounds`]);
    total += entry.bytes as number;
  }
  if(total > 128*1024*1024) throw new SnapshotError(['runtime snapshot exceeds total byte limit']);
  for(const path of [...REQUIRED_CONTENT,ART_MANIFEST_PATH]) if(!seen.has(path.toLowerCase())) throw new SnapshotError([`missing required manifest file: ${path}`]);
  if(!value.files.some(file => (file as {path:string}).path.startsWith('src/data/content/event-packs/'))) throw new SnapshotError(['missing event packs']);
  return value as unknown as ContentManifest;
}
export function assertRetainedDocumentHistory(path:string,previousValue:unknown,nextValue:unknown,previousBytes:Uint8Array,nextBytes:Uint8Array):void {
    const previous=previousValue as Record<string,unknown>,next=nextValue as Record<string,unknown>;
    const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([left],[right])=>left<right?-1:left>right?1:0).map(([key,entry])=>[key,ordered(entry)])):value;
    if(/events\.v[12]\.json$/.test(path)) {
      if(sha256(nextBytes)!==sha256(previousBytes)) throw new SnapshotError([`${path}: frozen compatibility history changed`]);
      return;
    }
    for(const collection of ['cards','gems','items','sets','enemies','modifiers','events']) {
      const oldEntries=previous[collection],newEntries=next[collection];
      if(!Array.isArray(oldEntries)) continue;
      if(!Array.isArray(newEntries)) throw new SnapshotError([`${path}: missing retained ${collection}`]);
      for(const old of oldEntries) {
        if(!Array.isArray(old.versions)) continue;
        const retained=newEntries.find(value=>value.id===old.id);
        for(const version of old.versions) if(!retained?.versions?.some((v:{version:number})=>v.version===version.version && JSON.stringify(ordered(v))===JSON.stringify(ordered(version)))) throw new SnapshotError([`${path}: shipped ${old.id}@${version.version} changed/deleted`]);
      }
    }
}
function assertHistory(root: string, trustedRoot: string): void {
  for(const path of REQUIRED_CONTENT) {
    if(!existsSync(join(trustedRoot,path))) continue;
    assertRetainedDocumentHistory(path,readStrictJson(trustedRoot,path),readStrictJson(root,path),readFileSync(join(trustedRoot,path)),readFileSync(join(root,path)));
  }
}
export async function validateArtManifest(root: string, value: unknown, manifest: ContentManifest): Promise<ArtManifest> {
  exact(value,['schemaVersion','assets','cards','cardFallbacks','items','gems','events','themes','eager','eagerDesktop','platforms','equipmentAliases','runKeys'],ART_MANIFEST_PATH);
  if(value.schemaVersion!==1 || !Array.isArray(value.assets) || value.assets.length>2000) throw new SnapshotError(['invalid art manifest schema/assets']);
  const files=new Map(manifest.files.map(file=>[file.path,file])); const ids=new Set<string>(); const keys=new Set<string>();
  const imageCache=decodedImages;
  for(const asset of value.assets) {
    exact(asset,['id','key','path','master','category','width','height','alpha'],'art asset');
    if(typeof asset.id!=='string'||!/^[a-zA-Z0-9:_./-]{1,160}$/.test(asset.id)||ids.has(asset.id)||typeof asset.key!=='string'||keys.has(asset.key)) throw new SnapshotError(['invalid/duplicate art id/key']);
    ids.add(asset.id);keys.add(asset.key);
    if(!['card','equipment','gem','run','ui'].includes(String(asset.category)) || typeof asset.path!=='string' || !asset.path.startsWith('public/game-art/') || !files.has(asset.path)) throw new SnapshotError([`${asset.id}: missing/disallowed art path`]);
    if(asset.master!==undefined && (typeof asset.master!=='string'||!/^art-src\/(?:cards|equipment|enemies|placeholders|templates|ui)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.png$/.test(asset.master))) throw new SnapshotError([`${asset.id}: unsafe master path`]);
    if(asset.alpha!==undefined && !['opaque','transparent','any'].includes(String(asset.alpha))) throw new SnapshotError([`${asset.id}: invalid alpha contract`]);
    for(const dimension of ['width','height']) if(asset[dimension]!==undefined && (!Number.isInteger(asset[dimension]) || (asset[dimension] as number)<1 || (asset[dimension] as number)>8192)) throw new SnapshotError([`${asset.id}: invalid dimensions`]);
    // One decode per distinct file, with allocation limits enforced by libvips.
    const bytes=readFileSync(safeFile(root,asset.path as string));
    const cacheKey=JSON.stringify([sha256(bytes),asset.width,asset.height,asset.alpha]);
    if(!imageCache.has(cacheKey)) imageCache.set(cacheKey,(async()=>{
      const image=sharp(bytes,{limitInputPixels:32*1024*1024,failOn:'warning'});
      const metadata=await image.metadata();
      if(!metadata.width||!metadata.height||metadata.width>8192||metadata.height>8192||metadata.pages && metadata.pages!==1 || !['png','webp'].includes(metadata.format??'')) throw new SnapshotError([`${asset.id}: invalid decoded image`]);
      if(asset.width!==undefined && asset.width!==metadata.width || asset.height!==undefined && asset.height!==metadata.height) throw new SnapshotError([`${asset.id}: dimension contract mismatch`]);
      const stats=await image.stats(); const alpha=metadata.hasAlpha?stats.channels[stats.channels.length-1]:undefined;
      if(asset.alpha==='opaque' && alpha && alpha.min<255 || asset.alpha==='transparent' && (!alpha || alpha.min===255)) throw new SnapshotError([`${asset.id}: alpha contract mismatch`]);
    })());
    await imageCache.get(cacheKey);
  }
  const references=(map:unknown,at:string):void=>{exact(map,Object.keys((map??{}) as object),at);for(const [key,id]of Object.entries(map))if(!/^[a-zA-Z0-9:_-]+$/.test(key)||typeof id!=='string'||!ids.has(id))throw new SnapshotError([`${at}.${key}: unknown asset`]);};
  for(const name of ['cards','items','gems','events','themes']) references(value[name],name);
  for(const name of ['eager','eagerDesktop']) if(!Array.isArray(value[name]) || new Set(value[name]).size!==(value[name] as unknown[]).length || (value[name] as unknown[]).some(id=>typeof id!=='string'||!ids.has(id))) throw new SnapshotError([`${name}: invalid eager asset list`]);
  exact(value.platforms,Object.keys((value.platforms??{}) as object),'platforms');
  for(const [id,pair]of Object.entries(value.platforms)){exact(pair,['desktop','mobile'],id);if(typeof pair.desktop!=='string'||typeof pair.mobile!=='string'||!ids.has(pair.desktop)||!ids.has(pair.mobile))throw new SnapshotError([`${id}: required paired variants missing`]);}
  const art=value as unknown as ArtManifest;
  for(const id of ['training','cache','recruit','forge','market','omen'])if(!art.themes[id])throw new SnapshotError([`missing theme: ${id}`]);
  for(const rarity of ['common','rare','epic','legendary'])if(!art.gems[rarity])throw new SnapshotError([`missing gem rarity: ${rarity}`]);
  for(const file of manifest.files)if(file.path.startsWith('public/game-art/')&&!art.assets.some(asset=>asset.path===file.path))throw new SnapshotError([`unregistered art file: ${file.path}`]);
  for(const id of Object.values(art.events))if(!art.eager.includes(id))throw new SnapshotError([`event art must load on both profiles: ${id}`]);
  exact(art.equipmentAliases,Object.keys((art.equipmentAliases??{}) as object),'equipmentAliases');
  for(const [id,target]of Object.entries(art.equipmentAliases))if(!art.items[id]||typeof target!=='string'||!art.items[target])throw new SnapshotError([`invalid equipment alias: ${id}`]);
  const visit=(node:unknown):void=>{if(typeof node==='string'){if(!keys.has(node))throw new SnapshotError([`run key references unknown texture: ${node}`]);}else{exact(node,Object.keys((node??{})as object),'run keys');Object.values(node).forEach(visit);}};visit(art.runKeys);
  const equipment=readStrictJson(root,'src/data/content/equipment.v1.json') as {items:{id:string}[]};
  for(const {id}of equipment.items)if(!art.items[id])throw new SnapshotError([`missing item art: ${id}`]);
  const skills=readStrictJson(root,'src/data/content/skills.v1.json') as {cards:{id:string}[]};
  if(!Array.isArray(art.cardFallbacks)||JSON.stringify([...art.cardFallbacks].sort())!==JSON.stringify(['finishing_blow','lingering_light','quickstep']))throw new SnapshotError(['invalid legacy card fallback allowlist']);
  for(const {id}of skills.cards)if(!art.cards[id]&&!art.cardFallbacks.includes(id))throw new SnapshotError([`missing card art: ${id}`]);
  return art;
}

/** Run the trusted compiler/validators against candidate data, never candidate code. */
export function validateCatalogsIsolated(root: string, trustedRoot=GAME_ROOT, options:{mechanics?:boolean}={}): {wiki:string;equipmentTemplate:string} {
  const tempParent=join(trustedRoot,'tmp');mkdirSync(tempParent,{recursive:true});const workspace=mkdtempSync(join(tempParent,'content-validation-'));
  try {
    for(const path of ['src','scripts'])cpSync(join(trustedRoot,path),join(workspace,path),{recursive:true});
    rmSync(join(workspace,'src/data/content'),{recursive:true,force:true});
    for(const path of ['package.json','tsconfig.json','art-manifest.v1.json'])cpSync(join(trustedRoot,path),join(workspace,path));
    mkdirSync(join(workspace,'docs/generated'),{recursive:true});mkdirSync(join(workspace,'docs/templates'),{recursive:true});
    // Only manifest-approved candidate bytes enter the trusted workspace.
    const manifest=parseContentManifest(readStrictJson(root,MANIFEST_PATH));
    for(const {path}of manifest.files)if(path===ART_MANIFEST_PATH||path.startsWith('src/data/content/')){const target=join(workspace,path);mkdirSync(dirname(target),{recursive:true});cpSync(safeFile(root,path),target);}
    const run=(script:string,args:string[]=[])=>execFileSync(process.execPath,[join(trustedRoot,'node_modules/tsx/dist/cli.mjs'),join(workspace,script),...args],{cwd:workspace,stdio:'pipe',timeout:120000});
    run('scripts/generateEventCatalog.ts');run('scripts/equipment-template.ts');run('scripts/validateContent.ts',['--internal-snapshot']);
    if(options.mechanics)for(const script of ['scripts/check-balance.ts','scripts/equipment-audit.ts','scripts/equipment-battle-audit.ts','scripts/battle-passives-audit.ts'])run(script);
    return {wiki:readFileSync(join(workspace,'docs/generated/event-catalog.md'),'utf8'),equipmentTemplate:readFileSync(join(workspace,'docs/templates/equipment.v1.template.json'),'utf8')};
  } catch(error) { throw new SnapshotError([`trusted catalog validation failed: ${error instanceof Error?error.message:String(error)}`]); }
  finally { rmSync(workspace,{recursive:true,force:true}); }
}
export async function validateContentSnapshot(root: string, options: {trustedRoot?:string;catalogs?:boolean;mechanics?:boolean}={}): Promise<{manifest:ContentManifest;art:ArtManifest}> {
  root=resolve(root);const manifest=parseContentManifest(readStrictJson(root,MANIFEST_PATH));
  for(const file of manifest.files){const bytes=readFileSync(safeFile(root,file.path));if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new SnapshotError([`${file.path}: hash/length mismatch`]);if(file.path.endsWith('.json'))readStrictJson(root,file.path);}
  assertHistory(root,options.trustedRoot??GAME_ROOT);
  const art=await validateArtManifest(root,readStrictJson(root,ART_MANIFEST_PATH),manifest);
  if(options.catalogs!==false)validateCatalogsIsolated(root,options.trustedRoot??GAME_ROOT,{mechanics:options.mechanics});
  return {manifest,art};
}
export function writeContentManifest(root: string): ContentManifest {
  const walk=(dir:string):string[]=>readdirSync(join(root,dir),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${dir}/${entry.name}`):[`${dir}/${entry.name}`]);
  const paths=[ART_MANIFEST_PATH,...walk('src/data/content').filter(safeRuntimePath),...walk('public/game-art').filter(safeRuntimePath)].sort();
  const files=paths.map(path=>{const bytes=readFileSync(safeFile(root,path));return {path,sha256:sha256(bytes),bytes:bytes.length};});
  const manifest:ContentManifest={schemaVersion:1,gameContentApiVersion:1,files};writeFileSync(join(root,MANIFEST_PATH),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.argv.includes('--root')?resolve(process.argv[process.argv.indexOf('--root')+1]!):GAME_ROOT;
  if(process.argv.includes('--write'))writeContentManifest(root);
  const result=await validateContentSnapshot(root);console.log(`snapshot validation OK: ${result.manifest.files.length} files, ${result.art.assets.length} assets`);
}
