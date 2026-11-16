import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {assertCurrentDatabase} from '../src/database-guard.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
const relative=file=>path.relative(root,file).replaceAll('\\','/');
function sourceTree(file,seen=new Set()){
 if(seen.has(file))return '';seen.add(file);const text=fs.readFileSync(file,'utf8');let result=text;
 for(const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)){
  const spec=match[1];if(!spec.startsWith('.')&&!/^@\/(features|components)\//.test(spec))continue;
  // Shared DS barrels are not proof that a page actually renders their states.
  if(spec.startsWith('@/components/ds'))continue;
  const base=spec.startsWith('@/')?path.join(root,'apps/web',spec.slice(2)):path.resolve(path.dirname(file),spec);
  const child=[base,base+'.tsx',base+'.ts',path.join(base,'index.tsx')].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
  if(child&&/\.(?:tsx?|jsx?)$/.test(child)&&child.startsWith(root+path.sep))result+='\n'+sourceTree(child,seen);
 }
 return result;
}
/** Static source evidence only. It cannot prove runtime rendering or server authorization. */
export function auditPageStates(projectRoot=root){
 const app=path.join(projectRoot,'apps/web/app');
 return files(app).filter(file=>path.basename(file)==='page.tsx').sort().map(file=>{
  const text=sourceTree(file),mutates=/api\.(?:post|put|patch)\b|api\.data(?:<[^;\n]*?>)?\(\s*['"](?:POST|PUT|PATCH)|onSubmit=|type=['"]submit['"]/.test(text);
  const page=relative(file),redirectOnly=/\bredirect\(['"]/.test(text)&&!/<[A-Z]/.test(text),publicAuth=page==='apps/web/app/login/page.tsx',landing=page==='apps/web/app/page.tsx',formOnly=mutates&&!/<DataTable\b/.test(text);
  const checks={
   loading:redirectOnly||/<\w*Skeleton\b|<Spinner\b|loading=|role=['"]status['"]|status===?['"]loading|busy=/.test(text),
   empty:redirectOnly||landing||publicAuth||formOnly||/<EmptyState\b|empty=|[.!]length|No [a-z]+ (?:received|found|available)/.test(text),
   error:redirectOnly||/<ErrorState\b|error=|status===?['"]error|error\s*&&\s*<Notice/.test(text),
   unauthorized:redirectOnly||publicAuth||/<UnauthorizedState\b|<ErrorState\b|error=|!can\(|!permitted|does not have access|restricted|session\.kind/.test(text),
   validation:!mutates||/<ReasonDialog\b|required\b|validate|validation|\.fields\b|trim\(\)\.length/.test(text),
   duplicateSubmit:!mutates||/<ReasonDialog\b|useSubmit\(|disabled=\{[^}]*busy|busy=|if\s*\(busy\)|isSubmitting|saving/.test(text)
  };
  return {page,mutates,checks,scope:redirectOnly?'redirect delegates states to destination':publicAuth?'public authentication; no record-list empty state or permission denial':landing?'navigation landing; no record list':formOnly?'form; empty inputs use validation':'workspace',missing:Object.entries(checks).filter(([,present])=>!present).map(([name])=>name),sharedReview:['Long text: verify wrapping/truncation in rendered layout','Narrow screen: verify layout at 390px and keyboard navigation']};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const sql=connectPostgres(getConfig().databaseUrl);try{await assertCurrentDatabase(sql);}finally{await sql.end({timeout:5});}
 const rows=auditPageStates();
 if(process.argv.includes('--json'))console.log(JSON.stringify({kind:'static-evidence-audit',pages:rows.length,rows},null,2));
 else {console.log('Static evidence audit — manual runtime/long-text/narrow-screen review is still required.');for(const row of rows)console.log(`${row.missing.length?'REVIEW':'EVIDENCE'} ${row.page}${row.missing.length?' — missing: '+row.missing.join(', '):''}`);console.log(`${rows.length} pages; ${rows.filter(row=>row.missing.length).length} need source-state review. Read-only pages do not need submit states.`);}
 if(process.argv.includes('--strict')&&rows.some(row=>row.missing.length))process.exitCode=1;
}
