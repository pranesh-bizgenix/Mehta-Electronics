import {NextResponse} from 'next/server';
import {emailAutomationEnabled} from './features/email-automation/config';

// Only this new module is matched. Return before streaming the shared app shell.
export function proxy() {
  if(!emailAutomationEnabled()) {
    return new NextResponse('Not found.',{status:404,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
  }
  return NextResponse.next();
}
export const config={matcher:'/email-automation/:path*'};
