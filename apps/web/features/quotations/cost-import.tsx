'use client';
import {useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {Button,DataTable,Notice,TextAreaField,useToast} from '@/components/ds';
import type {CostImportPlan} from './api';

export function CostImport({onSaved}:{onSaved:()=>void}) {
 const client=useApi(),toast=useToast();
 const [file,setFile]=useState<File|null>(null),[reason,setReason]=useState(''),[plan,setPlan]=useState<CostImportPlan|null>(null),[upload,setUpload]=useState<{filename:string;base64:string;reason:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const invalidate=()=>{setPlan(null);setUpload(null);setError('');};
 const preview=async()=>{
  if(!file||file.size===0||file.size>512*1024){setError('Choose a non-empty CSV or XLSX file of at most 512 KB.');return;}
  if(reason.trim().length<3){setError('Enter a reason of at least three characters.');return;}
  setBusy(true);setError('');setPlan(null);
  try{const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read the selected file.'));reader.readAsDataURL(file);});const body={filename:file.name,base64,reason};const data=await client.data<CostImportPlan>('POST','/api/crm/quotation-cost-import/preview',body);setUpload(body);setPlan(data);}
  catch(e){setError(e instanceof Error?e.message:'Could not preview import.');}finally{setBusy(false);}
 };
 const save=async()=>{if(!plan?.canSave||!upload)return;setBusy(true);setError('');try{const result=await client.data<{saved:number}>('POST','/api/crm/quotation-cost-import/commit',{...upload,fingerprint:plan.fingerprint});setPlan(null);setUpload(null);toast('success',`${result.saved} item costs saved. Refresh quotation drafts to capture the new costs.`);onSaved();}catch(e){setError(e instanceof Error?e.message:'Could not save import.');setPlan(null);setUpload(null);}finally{setBusy(false);}};
 return <section className="stack"><h3>Import costs from Excel or CSV</h3><p>Use exactly two columns: <code>part_code,unit_cost</code>. Maximum 1,000 rows, 512 KB. Excel must contain one worksheet. Use literal costs before GST with up to six decimal places; no formulas, currency signs or thousands separators.</p><label>Cost file<input type="file" accept=".csv,.xlsx" disabled={busy} onChange={e=>{invalidate();setFile(e.target.files?.[0]??null);}} /></label><TextAreaField label="Import reason" required disabled={busy} value={reason} onChange={e=>{invalidate();setReason(e.target.value);}} /><Button disabled={!file||busy} busy={busy} onClick={()=>void preview()}>Review import</Button>{error&&<Notice tone="danger">{error}</Notice>}{plan&&<><Notice tone={plan.canSave?'info':'warning'}>{plan.canSave?'Review every old and new cost before confirming. No costs have been saved.':'Import blocked. Fix the listed issues in the file and review it again. No costs have been saved.'}</Notice><DataTable id="quotation-cost-preview" caption="Cost import review" rows={plan.rows} rowKey={r=>r.row} columns={[{key:'row',header:'Row',render:r=>r.row},{key:'part',header:'CRM part code',render:r=><span>{r.partCode}<br />{r.description}</span>},{key:'old',header:'Current cost',render:r=>r.currentCost??'Not set'},{key:'new',header:'New cost',render:r=>r.unitCost},{key:'issues',header:'Review',render:r=>r.issues.join(' ')||'Ready'}]} /><Button disabled={!plan.canSave||busy} busy={busy} onClick={()=>void save()}>Confirm and save {plan.rows.length} costs</Button></>}</section>;
}
