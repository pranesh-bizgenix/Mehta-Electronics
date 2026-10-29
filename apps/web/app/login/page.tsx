'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { Button, Icon, Notice, TextField } from '@/components/ds';

type Step = 'password' | 'enrol' | 'verify' | 'codes';

const POINTS = ['Every enquiry captured, owned and tracked to an SLA', 'Quotations priced from rate contracts and protected by margin rules', 'Tally stays the source of truth — read-only, always reconciled'];

/** S-01 Login: brand panel + password; two-factor enrolment/verification when enabled. */
function LoginInner() {
  const api = useApi();
  const { state, refresh, signIn } = useSession();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (state.kind !== 'ready' || step !== 'password') return;
    if (!state.mfa.required || state.mfa.verified) router.replace(destination);
    else setStep(state.mfa.enrolled ? 'verify' : 'enrol');
  }, [state, step, router, destination]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(undefined);
    try { await fn(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) setError('That email and password don’t match an active account. Check them and try again.');
      else if (e instanceof ApiError && e.status === 429) setError('Too many attempts. Wait a few minutes before trying again.');
      else setError(e instanceof Error ? e.message : 'Sign-in failed. Try again.');
    } finally { setBusy(false); }
  };

  const submitPassword = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const mfa = await signIn(email.trim(), password);
    if (!mfa.required) { router.replace(destination); return; }
    setStep(mfa.enrolled ? 'verify' : 'enrol');
  }); };
  const startEnrolment = () => void run(async () => { setSecret((await api.data<{ secret: string }>('POST', '/api/v1/auth/mfa/enroll', {})).secret); });
  const confirm = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    setCodes((await api.data<{ recoveryCodes: string[] }>('POST', '/api/v1/auth/mfa/confirm', { code })).recoveryCodes); setStep('codes');
  }); };
  const verify = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    await api.data('POST', '/api/v1/auth/verify-otp', useRecovery ? { recoveryCode: code } : { code }); await refresh(); router.replace(destination);
  }); };

  return (
    <main className="ds-auth" id="main">
      <section className="ds-auth-brand" aria-label="About ControlDesk">
        <div className="ds-brand" style={{ color: 'inherit' }}><span className="ds-brand-mark" aria-hidden="true">M</span><span className="ds-brand-text"><small style={{ color: 'inherit', opacity: 0.8 }}>Mehta Siemens</small><strong>ControlDesk</strong></span></div>
        <div className="stack-lg">
          <h1>Every order, priced right and on time.</h1>
          <p>The control room for Mehta Electric Corporation’s sales, purchasing and dispatch — built on top of Tally.</p>
          <ul className="ds-auth-points">{POINTS.map((p) => <li key={p}><Icon name="check" />{p}</li>)}</ul>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', opacity: 0.75 }}>Tally connection is read-only. Your data stays in your database.</p>
      </section>

      <section className="ds-auth-form">
        <div className="ds-auth-card">
          {step === 'password' && (
            <form className="stack" method="post" action="/login" onSubmit={submitPassword} noValidate>
              <div className="stack-sm"><h2>Sign in</h2><p className="muted">Use your ControlDesk email and password.</p></div>
              <TextField label="Email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <TextField label="Password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <Notice tone="danger">{error}</Notice>}
              <Button type="submit" size="lg" block busy={busy} disabled={!email || !password}>Sign in</Button>
            </form>
          )}
          {step === 'enrol' && (
            <div className="stack">
              <div className="stack-sm"><h2>Set up two-factor sign-in</h2><p className="muted">Your role needs a 6-digit code from an authenticator app (Google or Microsoft Authenticator) each time you sign in. No email or phone account is needed in the app.</p></div>
              {!secret ? <Button size="lg" block busy={busy} onClick={startEnrolment}>Show my setup key</Button> : (
                <form className="stack" onSubmit={confirm}>
                  <p>In the app tap <strong>+</strong> → <strong>Enter a setup key</strong>, then type:</p>
                  <p className="ds-secret" aria-label="Authenticator setup key">{secret.replace(/(.{4})/g, '$1 ').trim()}</p>
                  <TextField label="6-digit code from the app" className="ds-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  {error && <Notice tone="danger">{error}</Notice>}
                  <Button type="submit" size="lg" block busy={busy} disabled={code.length !== 6}>Turn on two-factor</Button>
                </form>
              )}
            </div>
          )}
          {step === 'codes' && (
            <div className="stack">
              <div className="stack-sm"><h2>Save your recovery codes</h2><p className="muted">Each code works once if you lose your phone. They won’t be shown again.</p></div>
              <ul className="ds-codes" aria-label="Recovery codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
              <Button size="lg" block onClick={() => void refresh().then(() => router.replace(destination))}>I’ve saved them — continue</Button>
            </div>
          )}
          {step === 'verify' && (
            <form className="stack" onSubmit={verify}>
              <div className="stack-sm"><h2>Enter your code</h2><p className="muted">{useRecovery ? 'Use one of the recovery codes you saved.' : 'Open your authenticator app and enter the 6-digit code.'}</p></div>
              <TextField label={useRecovery ? 'Recovery code' : '6-digit code'} className={useRecovery ? undefined : 'ds-otp'} inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" required
                maxLength={useRecovery ? 20 : 6} value={code} onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))} />
              {error && <Notice tone="danger">{error}</Notice>}
              <Button type="submit" size="lg" block busy={busy} disabled={useRecovery ? code.length < 10 : code.length !== 6}>Verify</Button>
              <Button variant="link" onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>{useRecovery ? 'Use the authenticator code instead' : 'Lost your phone? Use a recovery code'}</Button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
