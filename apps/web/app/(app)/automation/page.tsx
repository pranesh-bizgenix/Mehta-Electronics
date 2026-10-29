import { redirect } from 'next/navigation';

/** Automation switches now live on the Rules & switches screen. */
export default function AutomationRedirect() {
  redirect('/rules?tab=switches');
}
