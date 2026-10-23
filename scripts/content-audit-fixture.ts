import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GAME_ROOT, MANIFEST_PATH, parseContentManifest, readStrictJson, writeContentManifest } from './contentSnapshot';
import { BUILD_METADATA, localBuildMetadata } from './sync-community-content';
import { TRUSTED_REPOSITORY_CONTROLS } from './export-community-repository';
export function snapshotFixture():{root:string;reset:()=>void;dispose:()=>void}{
  mkdirSync(join(GAME_ROOT,'tmp'),{recursive:true});const root=mkdtempSync(join(GAME_ROOT,'tmp/content-audit-'));
  const reset=():void=>{rmSync(root,{recursive:true,force:true});mkdirSync(root,{recursive:true});const manifest=parseContentManifest(readStrictJson(GAME_ROOT,MANIFEST_PATH));for(const path of [MANIFEST_PATH,...manifest.files.map(file=>file.path)]){const target=join(root,path);mkdirSync(dirname(target),{recursive:true});cpSync(join(GAME_ROOT,path),target);}mkdirSync(join(root,'src/data'),{recursive:true});localBuildMetadata(root);};
  reset();return {root,reset,dispose:()=>rmSync(root,{recursive:true,force:true})};
}
export function mutateJson(root:string,path:string,mutate:(value:any)=>void):void{const value=JSON.parse(readFileSync(join(root,path),'utf8'));mutate(value);writeFileSync(join(root,path),JSON.stringify(value,null,2)+'\n');writeContentManifest(root);}
export function candidateFixture():ReturnType<typeof snapshotFixture>{
  const fixture=snapshotFixture();const prepare=():void=>{rmSync(join(fixture.root,BUILD_METADATA),{force:true});for(const [path,text]of Object.entries(TRUSTED_REPOSITORY_CONTROLS)){mkdirSync(dirname(join(fixture.root,path)),{recursive:true});writeFileSync(join(fixture.root,path),text);}};
  prepare();return {...fixture,reset:()=>{fixture.reset();prepare();}};
}
