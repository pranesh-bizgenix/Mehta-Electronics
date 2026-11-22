import {IncomingRequestsView} from '@/features/incoming-requests/incoming-requests';

// Read at runtime so the displayed mailbox follows deployment configuration.
// This setting contains an address only, never a password or provider token.
export const dynamic='force-dynamic';
export default function IncomingRequestsPage(){
 const value=process.env.BUSINESS_INBOX_EMAIL?.trim()??'';
 const businessEmail=value.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)?value:null;
 return <IncomingRequestsView businessEmail={businessEmail}/>;
}
