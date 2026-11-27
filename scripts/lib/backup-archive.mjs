import fs from 'node:fs';
import path from 'node:path';

// pg_dump's uncompressed directory files use PostgreSQL's TAR TOC format.
// Keep every member and the catalog's data order; never rewrite binary headers.
export function directoryArchiveManifest(directory,catalog){
 const members=fs.readdirSync(directory,{withFileTypes:true});
 if(members.some(entry=>!entry.isFile()||!/^(?:toc\.dat|\d+\.dat|blobs(?:_\d+)?\.toc|blob_\d+\.dat)$/.test(entry.name)))throw new Error('Unexpected parallel backup member. No archive receipt was created.');
 const names=new Set(members.map(entry=>entry.name)),ordered=[],added=new Set();
 const add=name=>{if(names.has(name)&&!added.has(name)){ordered.push(name);added.add(name);}};
 add('toc.dat');
 for(const entry of catalog.split(/\r?\n/)){
  const id=/^(\d+);/.exec(entry)?.[1];if(!id)continue;add(id+'.dat');
  const lob='blobs_'+id+'.toc';
  if(names.has(lob)){
   add(lob);
   for(const line of fs.readFileSync(path.join(directory,lob),'utf8').split(/\r?\n/)){
    if(!line)continue;const match=/^\d+\s+(blob_\d+\.dat)$/.exec(line);
    if(!match||!names.has(match[1]))throw new Error('Incomplete large-object archive.');
    add(match[1]);
   }
  }
 }
 for(const name of [...names].sort())add(name);
 if(ordered.length!==members.length||ordered[0]!=='toc.dat')throw new Error('Parallel archive manifest is incomplete.');
 return ordered;
}
