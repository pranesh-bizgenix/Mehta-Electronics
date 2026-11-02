import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const web=path.join(root,'apps/web');
const env={...process.env,NEXT_DIST_DIR:'.next',NEXT_TELEMETRY_DISABLED:'1'};
delete env.MEHTA_API_URL;
for(const args of [[path.join(web,'scripts/check-tokens.mjs')],[path.join(web,'node_modules/next/dist/bin/next'),'build']]){
 const result=spawnSync(process.execPath,args,{cwd:web,env,stdio:'inherit',windowsHide:true});
 if(result.status!==0)process.exit(result.status||1);
}
const destination = path.join(root,'dist');
if(path.dirname(destination)!==root||path.basename(destination)!=='dist')throw new Error('Invalid build destination.');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const entry of ['src', 'public', 'scripts', 'database', 'package.json', 'package-lock.json', 'README.md', '.env.example']) {
  fs.cpSync(path.join(root,entry), path.join(destination, entry), { recursive: true });
}
fs.cpSync(web,path.join(destination,'apps/web'),{recursive:true,filter:source=>{
 const parts=path.relative(web,source).split(path.sep);
 return !parts.some(part=>part==='node_modules'||part==='cache'||part==='test'||part.endsWith('.tsbuildinfo')||part==='.env'||part==='.env.local'||part.startsWith('.next')&&part!=='.next');
}});
console.log(`Production artifact created at ${destination}`);
