'use client';

import { useEffect, useState } from 'react';
import { getCurrentUser, type CurrentUserResult } from '@/lib/api-client';

export default function HomePage() {
  const [result, setResult] = useState<CurrentUserResult | null>(null);

  async function checkConnection() {
    setResult(null);
    setResult(await getCurrentUser());
  }

  useEffect(() => { void checkConnection(); }, []);

  return (
    <main className="shell">
      <header className="brand">
        <div className="brand-mark" aria-hidden="true">M</div>
        <div><p className="eyebrow">MEHTA SIEMENS</p><h1>ControlDesk</h1></div>
      </header>
      <section className="panel" aria-labelledby="welcome-title">
        <p className="eyebrow">FOUNDATION PREVIEW</p>
        <h2 id="welcome-title">Your work, in view.</h2>
        <p className="intro">The new interface is connected to the existing ControlDesk business API. Current CRM workflows continue to run in the existing application.</p>
        <div className="connection" aria-live="polite" aria-busy={result === null}>
          <span className={`indicator ${result?.kind ?? 'loading'}`} aria-hidden="true" />
          {result === null && <p>Checking the existing CRM session…</p>}
          {result?.kind === 'authenticated' && <p>Backend connected. Signed in as <strong>{result.user.name}</strong>.</p>}
          {result?.kind === 'unauthenticated' && <p>Backend connected. Sign in through the existing CRM, then check again. ({result.message})</p>}
          {result?.kind === 'error' && <p>Could not verify the backend connection: {result.message}</p>}
        </div>
        <button className="button" type="button" onClick={() => void checkConnection()} disabled={result === null}>Check connection again</button>
        <p className="footnote">This foundation does not display business metrics or replace existing workflows.</p>
      </section>
      <footer>Mehta ControlDesk · Incremental interface migration</footer>
    </main>
  );
}
