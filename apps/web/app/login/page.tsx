'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, apiData, setCsrfToken } from '@/lib/api';
import { useSession, type MfaState } from '@/lib/session';
import { Button, TextInput } from '@/components/ui';

interface LoginResponse { csrfToken: string; mfa: MfaState }

type Step = 'password' | 'enrol' | 'verify' | 'codes';

/** S-01 Login: password, then TOTP enrolment or verification (mandatory for the owner). */
export default function LoginPage() {
  const { state, refresh } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [enrolment, setEnrolment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (state.kind !== 'ready' || step !== 'password') return;
    if (!state.mfa.required || state.mfa.verified) router.replace('/work');
    else setStep(state.mfa.enrolled ? 'verify' : 'enrol');
  }, [state, step, router]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(undefined);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); } finally { setBusy(false); }
  };

  const submitPassword = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const res = await api<LoginResponse>('/api/auth/login', { method: 'POST', body: { email, password } });
    setCsrfToken(res.csrfToken);
    if (!res.mfa.required) { await refresh(); router.replace('/work'); return; }
    setStep(res.mfa.enrolled ? 'verify' : 'enrol');
  }); };

  const startEnrolment = () => void run(async () => { setEnrolment(await apiData('/api/v1/auth/mfa/enroll', { method: 'POST', body: {} })); });

  const confirmEnrolment = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const res = await apiData<{ recoveryCodes: string[] }>('/api/v1/auth/mfa/confirm', { method: 'POST', body: { code } });
    setRecoveryCodes(res.recoveryCodes); setStep('codes');
  }); };

  const verify = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    await apiData('/api/v1/auth/verify-otp', { method: 'POST', body: useRecovery ? { recoveryCode: code } : { code } });
    await refresh(); router.replace('/work');
  }); };

  return (
    <main className="auth" id="main">
      <section className="card" aria-labelledby="login-title">
        <div className="brand"><div className="brand-mark" aria-hidden="true">M</div><div><small>MEHTA SIEMENS</small><strong>ControlDesk</strong></div></div>
        {step === 'password' && (
          <form className="stack" onSubmit={submitPassword} noValidate>
            <h1 id="login-title">Sign in</h1>
            <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p className="notice notice-bad" role="alert">{error}</p>}
            <Button type="submit" busy={busy} disabled={!email || !password}>Sign in</Button>
          </form>
        )}
        {step === 'enrol' && (
          <div className="stack">
            <h1 id="login-title">Set up two-factor authentication</h1>
            <p className="muted">Your role requires a code from an authenticator app (Google Authenticator, Microsoft Authenticator or similar) every time you sign in.</p>
            {!enrolment ? <Button busy={busy} onClick={startEnrolment}>Generate my key</Button> : (
              <form className="stack" onSubmit={confirmEnrolment}>
                <p>Add an account in your authenticator app using this key:</p>
                <p className="secret" aria-label="Authenticator key">{enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
                <details><summary>Setup link</summary><p className="secret">{enrolment.otpauthUri}</p></details>
                <TextInput label="6-digit code from the app" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                {error && <p className="notice notice-bad" role="alert">{error}</p>}
                <Button type="submit" busy={busy} disabled={code.length !== 6}>Turn on two-factor</Button>
              </form>
            )}
          </div>
        )}
        {step === 'codes' && (
          <div className="stack">
            <h1 id="login-title">Save your recovery codes</h1>
            <p className="muted">Each code works once if you lose your phone. They will not be shown again.</p>
            <ul className="codes" aria-label="Recovery codes">{recoveryCodes.map((c) => <li key={c}>{c}</li>)}</ul>
            <Button onClick={() => void refresh().then(() => router.replace('/work'))}>I have saved them</Button>
          </div>
        )}
        {step === 'verify' && (
          <form className="stack" onSubmit={verify}>
            <h1 id="login-title">Enter your code</h1>
            <TextInput label={useRecovery ? 'Recovery code' : '6-digit code'} inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" required value={code}
              onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))} maxLength={useRecovery ? 20 : 6} />
            {error && <p className="notice notice-bad" role="alert">{error}</p>}
            <Button type="submit" busy={busy} disabled={useRecovery ? code.length < 10 : code.length !== 6}>Verify</Button>
            <Button variant="ghost" onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</Button>
          </form>
        )}
      </section>
    </main>
  );
}
