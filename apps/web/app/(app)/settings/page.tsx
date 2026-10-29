'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { usePreferences, type ThemeChoice } from '@/lib/preferences';
import { Button, Card, Facts, Icon, Notice, PageHeader, Switch, TextField, fieldErrors, useToast } from '@/components/ds';
import { titleCase } from '@/lib/format';

/** Personal settings: appearance, density and password. */
export default function SettingsPage() {
  const api = useApi();
  const { state } = useSession();
  const { preferences, update } = usePreferences();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) { setErrors({ confirm: 'The two new passwords don’t match.' }); return; }
    setBusy(true); setErrors({});
    try { await api.post('/api/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }); setPw({ currentPassword: '', newPassword: '', confirm: '' }); toast('success', 'Password changed. Other sessions were signed out.'); }
    catch (error) { setErrors({ ...fieldErrors(error), form: error instanceof Error ? error.message : 'Could not change the password.' }); }
    finally { setBusy(false); }
  };
  const themes: { id: ThemeChoice; label: string; icon: 'sun' | 'moon' | 'monitor' }[] = [{ id: 'system', label: 'Match system', icon: 'monitor' }, { id: 'light', label: 'Light', icon: 'sun' }, { id: 'dark', label: 'Dark', icon: 'moon' }];

  return (
    <>
      <PageHeader title="Settings" crumbs={[{ label: 'Admin' }, { label: 'Settings' }]} description="Your account and how ControlDesk looks for you. Saved to your account on every device." />
      <div className="grid-2">
        <Card title="Appearance">
          <div className="stack">
            <div role="radiogroup" aria-label="Theme" className="cluster">
              {themes.map((t) => <Button key={t.id} variant={preferences.theme === t.id ? 'primary' : 'secondary'} icon={t.icon} role="radio" aria-checked={preferences.theme === t.id} onClick={() => update({ theme: t.id })}>{t.label}</Button>)}
            </div>
            <Switch label="Compact table rows" checked={preferences.density === 'compact'} onChange={(e) => update({ density: e.target.checked ? 'compact' : 'comfortable' })} />
            <Switch label="Collapse the sidebar" checked={preferences.sidebarCollapsed} onChange={(e) => update({ sidebarCollapsed: e.target.checked })} />
            <p className="ds-cell-secondary">Tip: press <kbd className="ds-kbd">Ctrl</kbd> <kbd className="ds-kbd">K</kbd> anywhere to search or jump to a screen.</p>
          </div>
        </Card>
        <Card title="Account">
          {state.kind === 'ready' && <Facts items={[{ label: 'Name', value: state.user.name }, { label: 'Email', value: state.user.email }, { label: 'Role', value: titleCase(state.user.role) }, { label: 'Two-factor', value: state.mfa.enrolled ? 'On' : 'Off' }]} />}
          <p className="ds-cell-secondary" style={{ marginTop: 'var(--space-2)' }}><Icon name="info" style={{ display: 'inline', width: 'var(--icon-sm)', height: 'var(--icon-sm)', verticalAlign: 'text-bottom' }} /> Role, department and backup are set by the owner in <Link href="/users">Users &amp; roles</Link>.</p>
        </Card>
        <Card title="Change password">
          <form className="stack" onSubmit={(e) => void changePassword(e)} noValidate>
            <TextField label="Current password" type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} error={errors.currentPassword} />
            <TextField label="New password" type="password" autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={errors.newPassword} hint="12 or more characters with upper and lower case letters, a number and a symbol." />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={errors.confirm} />
            {errors.form && <Notice tone="danger">{errors.form}</Notice>}
            <Button type="submit" busy={busy} disabled={!pw.currentPassword || !pw.newPassword}>Change password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
