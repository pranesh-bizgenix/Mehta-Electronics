/** One build flag for navigation, the page guard and the path-limited proxy. */
export function emailAutomationEnabled() {
  return process.env.NEXT_PUBLIC_EMAIL_AUTOMATION_ENABLED === 'true';
}
