import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXPORTED_SHARED_MASTERS, TRUSTED_REPOSITORY_CONTROLS } from './export-community-repository';
import { MANIFEST_PATH, parseContentManifest, readStrictJson } from './contentSnapshot';

const masterPath=/^art-src\/(?:cards|equipment|enemies|placeholders|templates|ui)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.png$/;
const proposalPath=/^community\/proposals\/[A-Za-z0-9_-]{1,100}\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:json|png|webp)$/;
export function assertCandidateInventory(candidateRoot:string):{files:number;bytes:number} {
  const root=resolve(candidateRoot);if(lstatSync(root).isSymbolicLink()||!lstatSync(root).isDirectory())throw new Error('Candidate inventory: root must be a real directory');
  const manifest=parseContentManifest(readStrictJson(root,MANIFEST_PATH));
  const exactFiles=new Set<string>([MANIFEST_PATH,...manifest.files.map(file=>file.path),'README.md','CONTRIBUTING.md',...EXPORTED_SHARED_MASTERS,...Object.keys(TRUSTED_REPOSITORY_CONTROLS)]);
  const allowedFile=(path:string):boolean=>exactFiles.has(path)||masterPath.test(path)||proposalPath.test(path);
  const directoryPrefixes=new Set<string>();for(const path of exactFiles){const parts=path.split('/');for(let index=1;index<parts.length;index++)directoryPrefixes.add(parts.slice(0,index).join('/'));}
  const seen=new Set<string>();let files=0,bytes=0,entries=0;
  const walk=(relative:string):void=>{
    for(const entry of readdirSync(join(root,relative),{withFileTypes:true})){
      if(++entries>12000)throw new Error('Candidate inventory: too many entries');
      const path=relative?`${relative}/${entry.name}`:entry.name;const stat=lstatSync(join(root,path));
      if(stat.isSymbolicLink())throw new Error(`Candidate inventory: symlink forbidden: ${path}`);
      if(path==='.git'){if(!stat.isDirectory()&&!stat.isFile())throw new Error('Candidate inventory: invalid checkout metadata');continue;}
      if(path.length>240||!/^[A-Za-z0-9_./-]+$/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(path.toLowerCase()))throw new Error(`Candidate inventory: unsafe/duplicate path: ${path}`);
      seen.add(path.toLowerCase());
      if(stat.isDirectory()){
        if(!directoryPrefixes.has(path)&&!/^art-src\/(?:cards|equipment|enemies|placeholders|templates|ui)(?:\/[A-Za-z0-9_-]+)*$/.test(path)&&!/^community\/proposals(?:\/[A-Za-z0-9_-]+)*$/.test(path))throw new Error(`Candidate inventory: directory not allowed: ${path}`);
        walk(path);continue;
      }
      if(!stat.isFile()||!allowedFile(path))throw new Error(`Candidate inventory: file not allowed: ${path}`);
      if(process.platform!=='win32'&&(stat.mode&0o111)!==0)throw new Error(`Candidate inventory: executable mode forbidden: ${path}`);
      const bound=path.endsWith('.png')?32*1024*1024:path.endsWith('.webp')?16*1024*1024:path.endsWith('.md')?128*1024:8*1024*1024;
      if(stat.size>bound||++files>8192||(bytes+=stat.size)>1024*1024*1024)throw new Error(`Candidate inventory: byte/file bounds exceeded: ${path}`);
      if(path.endsWith('.json'))readStrictJson(root,path);
      if(path.endsWith('.md')){const text=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(join(root,path)));if(text.includes('\0'))throw new Error(`Candidate inventory: invalid documentation text: ${path}`);}
    }
  };
  walk('');
  for(const [path,text]of Object.entries(TRUSTED_REPOSITORY_CONTROLS))if(!existsSync(join(root,path))||!readFileSync(join(root,path)).equals(Buffer.from(text)))throw new Error(`Candidate inventory: immutable repository control changed/missing: ${path}`);
  if(existsSync(join(root,'.git'))){
    const index=execFileSync('git',['--literal-pathspecs','--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',root,'ls-files','--stage','-z'],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000});
    const tracked=new Set<string>();
    for(const entry of index.split('\0').filter(Boolean)){
      const separator=entry.indexOf('\t'),path=separator<0?undefined:entry.slice(separator+1);
      if(!/^100644 [a-f0-9]{40,64} 0\t/.test(entry))throw new Error(`Candidate inventory: Git tree requires regular nonexecutable files: ${path??'invalid index'}`);
      if(!path||!allowedFile(path)||!seen.has(path.toLowerCase())||tracked.has(path.toLowerCase()))throw new Error(`Candidate inventory: unallowlisted/missing/duplicate Git tree path: ${path??'invalid index'}`);
      tracked.add(path.toLowerCase());
    }
  }
  return {files,bytes};
}
