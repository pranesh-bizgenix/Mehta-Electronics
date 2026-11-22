/** Explicit operator opt-in for one reserved, visibly fictional testing account.
 * Production MFA configuration and role policy remain unchanged for everyone else.
 */
export function isMfaExemptTestAccount(config, user) {
  return Number.isSafeInteger(config.mfaTestExemptUserId)
    && config.mfaTestExemptUserId > 0
    && Number(user?.id) === config.mfaTestExemptUserId
    && typeof config.mfaTestExemptEmail === 'string'
    && /^[^@\s]+@test\.local$/.test(config.mfaTestExemptEmail)
    && user?.email === config.mfaTestExemptEmail
    && /^TEST_/.test(user?.name || '')
    && user?.status === 'ACTIVE';
}
