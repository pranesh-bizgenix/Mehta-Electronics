'use client';
import {useEffect,useRef,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {Button,ErrorState,Modal,TextAreaField} from '@/components/ds';
import {validatedPdfBlob} from '../../../../public/pdf-validation.js';
export function PdfActions({path,body,filename}:{path:string;body:Record<string,unknown>;filename:string}){
 const api=useApi(),url=useRef('');const [preview,setPreview]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current);},[]);
 const run=async(inline:boolean)=>{setBusy(true);setError(undefined);try{const blob=await validatedPdfBlob(await api.file(path,{...body,reason,preview:inline}));if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);if(inline)setPreview(url.current);else{const a=document.createElement('a');a.href=url.current;a.download=filename;a.click();}}catch(e){setError(e);}finally{setBusy(false);}};
 return <section className="stack"><TextAreaField label="PDF access reason" required value={reason} onChange={e=>setReason(e.target.value)}/><div className="row"><Button disabled={busy||reason.trim().length<3} onClick={()=>void run(true)}>Preview PDF</Button><Button disabled={busy||reason.trim().length<3} onClick={()=>void run(false)}>Download PDF</Button></div>{Boolean(error)&&<ErrorState error={error}/>}<Modal size="lg" open={Boolean(preview)} title="PDF preview" onClose={()=>setPreview('')}><p><a href={preview} target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a></p><iframe src={preview} title="Document PDF preview" referrerPolicy="no-referrer" width="100%" height="650"/></Modal></section>;
}
