'use client';
import {useEffect,useRef,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {Button,ErrorState,TextAreaField} from '@/components/ds';
export function ExcelActions({path,body,filename}:{path:string;body:Record<string,unknown>;filename:string}){
 const api=useApi(),url=useRef(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current);},[]);
 const download=async()=>{setBusy(true);setError(undefined);try{const blob=await api.file(path,{...body,reason}),header=new Uint8Array(await blob.slice(0,4).arrayBuffer());if(header[0]!==0x50||header[1]!==0x4b||header[2]!==0x03||header[3]!==0x04)throw new Error('The server did not return an Excel workbook.');if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url.current;a.download=filename;a.click();}catch(e){setError(e);}finally{setBusy(false);}};
 return <section className="stack"><TextAreaField label="Excel export reason" required value={reason} onChange={e=>setReason(e.target.value)}/><div><Button variant="secondary" icon="download" busy={busy} disabled={reason.trim().length<3} onClick={()=>void download()}>Download Excel</Button></div>{error!==undefined&&<ErrorState error={error}/>}</section>;
}
