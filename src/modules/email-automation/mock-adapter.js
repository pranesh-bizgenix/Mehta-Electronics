// Fictional fixtures stay in this adapter. No seed or persistence function exists.
export function createMockAdapter() {
  const emails = [
    {id:'sample-email-1',subject:'Sample: terminal block enquiry',sender:'purchasing@example.invalid',receivedAt:'2026-11-18T09:30:00Z',status:'Processed',body:'Fictional demonstration email. Please provide availability for the attached sample items.',links:[]},
    {id:'sample-email-2',subject:'Sample: purchase order attachment',sender:'orders@example.invalid',receivedAt:'2026-11-18T10:00:00Z',status:'Failed',body:'Fictional demonstration email with an unsupported attachment. No customer order was created.',links:[]},
    {id:'sample-email-3',subject:'Sample: delivery enquiry',sender:'dispatch@example.invalid',receivedAt:'2026-11-18T11:00:00Z',status:'Pending',body:'Fictional demonstration message awaiting a processing service. This module cannot process or send messages.',links:[]}
  ];
  const attachments = [
    {id:'sample-attachment-1',emailId:'sample-email-1',name:'sample-requirements.pdf',mimeType:'application/pdf',bytes:2048,s3Bucket:'fictional-sample-bucket',s3Key:'examples/requirements.pdf',status:'Available'},
    {id:'sample-attachment-2',emailId:'sample-email-2',name:'sample-order.unsupported',mimeType:'application/octet-stream',bytes:512,s3Bucket:null,s3Key:null,status:'Unavailable'}
  ];
  const runs = [
    {id:'sample-run-1',emailId:'sample-email-1',stage:'Attachment metadata',status:'Succeeded',startedAt:'2026-11-18T09:31:00Z',finishedAt:'2026-11-18T09:31:02Z',errorCode:null},
    {id:'sample-run-2',emailId:'sample-email-2',stage:'Attachment validation',status:'Failed',startedAt:'2026-11-18T10:01:00Z',finishedAt:'2026-11-18T10:01:01Z',errorCode:'SAMPLE_UNSUPPORTED_FORMAT'},
    {id:'sample-run-3',emailId:'sample-email-3',stage:'Awaiting processor',status:'Pending',startedAt:null,finishedAt:null,errorCode:null}
  ];
  return {sample:true, async read(){return structuredClone({emails,attachments,runs});}};
}
