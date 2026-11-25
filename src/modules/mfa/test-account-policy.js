/** Explicit operator opt-in for reserved, visibly fictional testing accounts.
 * Production MFA configuration and role policy remain unchanged for everyone else.
 */
export function isMfaExemptTestAccount(config, user, now=Date.now()) {
  if(!user||!/^TEST_/.test(user.name||'')||user.status!=='ACTIVE'||typeof user.email!=='string'||!/^[^@\s]+@test\.local$/.test(user.email))return false;
  const timed=(Array.isArray(config.mfaTestExemptAccounts)?config.mfaTestExemptAccounts:[]).some(entry=>
    Number.isSafeInteger(entry?.userId)&&entry.userId>0&&Number(user.id)===entry.userId&&
    entry.email===user.email&&typeof entry.expiresAt==='string'&&Number.isFinite(Date.parse(entry.expiresAt))&&Date.parse(entry.expiresAt)>now);
  if(Array.isArray(config.mfaTestExemptAccounts)&&config.mfaTestExemptAccounts.length)return timed;
  return Number.isSafeInteger(config.mfaTestExemptUserId)
    && config.mfaTestExemptUserId > 0
    && Number(user?.id) === config.mfaTestExemptUserId
    && typeof config.mfaTestExemptEmail === 'string'
    && /^[^@\s]+@test\.local$/.test(config.mfaTestExemptEmail)
    && user?.email === config.mfaTestExemptEmail
    && /^TEST_/.test(user?.name || '')
    && user?.status === 'ACTIVE';
}
