import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {backupsDirectory} from '../src/migration-backup.js';
import {directoryArchiveManifest} from '../scripts/lib/backup-archive.mjs';

function fixture(t,files){
 fs.mkdirSync(backupsDirectory,{recursive:true});
 const directory=fs.mkdtempSync(path.join(backupsDirectory,'VERIFY-archive-'));
 t.after(()=>{if(path.dirname(path.resolve(directory))!==path.resolve(backupsDirectory))throw new Error('Unsafe test cleanup target.');fs.rmSync(directory,{recursive:true,force:true});});
 for(const [name,contents] of Object.entries(files))fs.writeFileSync(path.join(directory,name),contents);
 return directory;
}
test('Parallel archive retains every file and follows TOC data order, not filename order',t=>{
 const directory=fixture(t,{'toc.dat':'SAMPLE TOC','2.dat':'second','10.dat':'first','99.dat':'auxiliary'});
 const result=directoryArchiveManifest(directory,'; SAMPLE catalog\n10; table data\n2; table data\n');
 assert.deepEqual(result,['toc.dat','10.dat','2.dat','99.dat']);assert.equal(new Set(result).size,4);
});
test('Large-object contents stay with their catalog group and are never dropped',t=>{
 const directory=fixture(t,{'toc.dat':'SAMPLE','2.dat':'data','blobs_9.toc':'7 blob_7.dat\n8 blob_8.dat\n','blob_7.dat':'a','blob_8.dat':'b'});
 assert.deepEqual(directoryArchiveManifest(directory,'9; BLOBS\n2; TABLE DATA'),['toc.dat','blobs_9.toc','blob_7.dat','blob_8.dat','2.dat']);
});
test('Missing large objects, missing TOC and unexpected files refuse packaging',t=>{
 const missingBlob=fixture(t,{'toc.dat':'SAMPLE','blobs_9.toc':'7 blob_7.dat\n'});assert.throws(()=>directoryArchiveManifest(missingBlob,'9; BLOBS'),/Incomplete large-object/);
 const missingToc=fixture(t,{'2.dat':'SAMPLE'});assert.throws(()=>directoryArchiveManifest(missingToc,'2; TABLE DATA'),/incomplete/);
 const unwanted=fixture(t,{'toc.dat':'SAMPLE','credentials.json':'SAMPLE forbidden extra file'});assert.throws(()=>directoryArchiveManifest(unwanted,''),/Unexpected/);
});
