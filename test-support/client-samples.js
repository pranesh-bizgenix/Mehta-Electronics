import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const clientSamplesRoot=fileURLToPath(new URL('../tests/fixtures/client-samples/',import.meta.url));
export const clientSampleFolders=Object.freeze([
  '01-customer-pos','02-customer-emails','03-customer-open-orders','04-price-lists',
  '05-part-mappings','06-supplier-documents','07-supplier-dispatch','08-principal-sheets',
  '09-payments-and-statements','99-unsorted'
]);

/** Optional private sample. Callers must return immediately when this returns null.
 * root is injectable for filesystem-only unit tests; no database is accessed.
 */
export function samplePath(folder,filename,{root=clientSamplesRoot,testContext,onMissing}={}){
  if(!clientSampleFolders.includes(folder))throw new Error('Choose a documented client sample folder.');
  if(typeof filename!=='string'||!filename.trim()||['.','..'].includes(filename)||/[\\/]/.test(filename)||path.isAbsolute(filename))
    throw new Error('Client sample name must be a filename, without a path.');
  const candidate=path.resolve(root,folder,filename);
  try{
    const realRoot=fs.realpathSync(root),realFile=fs.realpathSync(candidate);
    const relative=path.relative(realRoot,realFile);
    if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Client sample must stay inside its private folder.');
    if(!fs.statSync(realFile).isFile())throw new Error('Client sample must be a regular file.');
    return realFile;
  }catch(error){
    if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;
    const message=`Optional client sample absent: ${folder}/${filename}. Paste it into tests/fixtures/client-samples/${folder}/ to run this check.`;
    if(testContext)testContext.skip(message);
    else (onMissing||((text)=>console.warn(`SKIP: ${text}`)))(message);
    return null;
  }
}
