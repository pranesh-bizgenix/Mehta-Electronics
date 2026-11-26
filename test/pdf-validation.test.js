import test from 'node:test';
import assert from 'node:assert/strict';
import {validatedPdfBlob} from '../public/pdf-validation.js';
test('PDF response keeps its bytes and receives a canonical document MIME type',async()=>{
 const input=new Blob(['%PDF-1.7\nTest fixture'],{type:'application/pdf; charset=binary'}),result=await validatedPdfBlob(input);
 assert.equal(result.type,'application/pdf');assert.equal(await result.text(),await input.text());
});
test('An HTML response cannot become an embedded document',async()=>{
 await assert.rejects(validatedPdfBlob(new Blob(['<html><script>bad()</script></html>'],{type:'text/html'})),/valid PDF/);
 await assert.rejects(validatedPdfBlob(new Blob(['%PDF-1.7\n<html>'],{type:'text/html'})),/valid PDF/);
});
test('A PDF MIME label without the document signature is rejected',async()=>{
 await assert.rejects(validatedPdfBlob(new Blob(['<html>Unexpected upstream response</html>'],{type:'application/pdf'})),/valid PDF/);
});
test('Empty, truncated and non-Blob responses fail with a usable error',async()=>{
 for(const input of [new Blob([],{type:'application/pdf'}),new Blob(['%PDF'],{type:'application/pdf'}),{}])await assert.rejects(validatedPdfBlob(input),/valid PDF/);
});
