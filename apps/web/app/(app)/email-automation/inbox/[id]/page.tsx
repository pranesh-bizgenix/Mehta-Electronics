import {EmailDetails} from '@/features/email-automation/screens';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <EmailDetails id={id}/>;}
