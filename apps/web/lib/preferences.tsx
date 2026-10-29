'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApi } from './api/provider';
import { useSession } from './session';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
export interface Preferences { theme: ThemeChoice; density: Density; sidebarCollapsed: boolean; savedFilters: Record<string, SavedFilter[]> }
export interface SavedFilter { name: string; query: Record<string, string> }

const STORAGE_KEY = 'controldesk.preferences';
const DEFAULTS: Preferences = { theme: 'system', density: 'comfortable', sidebarCollapsed: false, savedFilters: {} };

/**
 * Runs before React hydrates (inline in <head>) so the first paint already has
 * the right theme. Kept tiny and dependency-free.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'{}');var t=p.theme||'system';if(t==='system'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light'}})();`;

function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readLocal(): Preferences {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Preferences>) }; } catch { return DEFAULTS; }
}

interface PreferencesValue {
  preferences: Preferences;
  resolvedTheme: 'light' | 'dark';
  update: (patch: Partial<Preferences>) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

/** Theme, density, sidebar and saved filters: local for instant feedback, saved per user on the server. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { state } = useSession();
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [resolvedTheme, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => { setPreferences(readLocal()); }, []);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    let live = true;
    api.data<Preferences>('GET', '/api/v1/me/preferences').then((server) => {
      if (!live) return;
      const merged = { ...DEFAULTS, ...server };
      setPreferences(merged);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }).catch(() => { /* offline or older server: keep local preferences */ });
    return () => { live = false; };
  }, [api, state.kind]);

  useEffect(() => {
    const apply = () => { const t = resolveTheme(preferences.theme); setResolved(t); document.documentElement.dataset.theme = t; };
    apply();
    if (preferences.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme]);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (state.kind === 'ready') void api.data('PUT', '/api/v1/me/preferences', patch).catch(() => undefined);
      return next;
    });
  }, [api, state.kind]);

  const value = useMemo(() => ({ preferences, resolvedTheme, update }), [preferences, resolvedTheme, update]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider.');
  return ctx;
}
