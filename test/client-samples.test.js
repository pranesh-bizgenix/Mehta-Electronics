import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {samplePath} from '../test-support/client-samples.js';

test('private sample helper resolves a temp file, skips missing input and refuses path traversal without database access',()=>{
  const temporaryParent=fs.realpathSync(os.tmpdir());
  const root=fs.mkdtempSync(path.join(temporaryParent,'VERIFY-client_samples_'));
  try{
    const folder='01-customer-pos',file='synthetic-reference.txt';
    fs.mkdirSync(path.join(root,folder));
    const expected=path.join(root,folder,file);
    fs.writeFileSync(expected,'Synthetic filesystem fixture; no client contents.');
    assert.equal(samplePath(folder,file,{root}),fs.realpathSync(expected));
    const messages=[];
    assert.equal(samplePath(folder,'missing.pdf',{root,onMissing:message=>messages.push(message)}),null);
    assert.match(messages[0],/Optional client sample absent: 01-customer-pos\/missing\.pdf/);
    assert.match(messages[0],/Paste it into/);
    const skipped=[];
    assert.equal(samplePath(folder,'missing.xlsx',{root,testContext:{skip:message=>skipped.push(message)}}),null);
    assert.equal(skipped.length,1);
    assert.throws(()=>samplePath('../outside',file,{root}),/documented client sample folder/);
    for(const filename of ['../outside.txt','..\\outside.txt','..','/absolute.txt'])
      assert.throws(()=>samplePath(folder,filename,{root}),/without a path/);
  }finally{
    // Verify the exact recursive target is the directory this test created.
    const resolved=fs.realpathSync(root);
    assert.equal(path.dirname(resolved),temporaryParent);
    assert.ok(path.basename(resolved).startsWith('VERIFY-client_samples_'));
    fs.rmSync(resolved,{recursive:true,force:true});
    assert.equal(fs.existsSync(root),false);
  }
});
