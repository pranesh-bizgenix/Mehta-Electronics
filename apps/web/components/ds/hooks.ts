'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> = { status: 'loading'; data?: T } | { status: 'error'; error: unknown; data?: T } | { status: 'ready'; data: T };

/**
 * Loads data for a view. Keeps the previous data while reloading (no flash),
 * cancels stale responses, and exposes reload().
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): [AsyncState<T>, () => void] {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ status: 'loading', data: s.data }));
    loader.current(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ status: 'ready', data }); },
      (error: unknown) => { if (!controller.signal.aborted) setState((s) => ({ status: 'error', error, data: s.data })); }
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [state, useCallback(() => setTick((t) => t + 1), [])];
}

/** Runs one submission at a time; repeated clicks while busy are ignored. */
export function useSubmit<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (running.current) return undefined;
    running.current = true; setBusy(true); setError(null);
    try { return await fn(...args); }
    catch (e) { setError(e); throw e; }
    finally { running.current = false; setBusy(false); }
  }, [fn]);
  return { run, busy, error, setError };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}

/** Ctrl/Cmd + key shortcut. */
export function useHotkey(key: string, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === key) { e.preventDefault(); ref.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key]);
}
