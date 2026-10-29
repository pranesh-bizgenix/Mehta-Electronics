'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { FetchApiClient, type ApiClient } from './client';

const ApiContext = createContext<ApiClient | null>(null);

/** Injects the API client. Tests and the design-system page can pass a fake. */
export function ApiProvider({ client, children }: { client?: ApiClient; children: ReactNode }) {
  const value = useMemo(() => client ?? new FetchApiClient(), [client]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside ApiProvider.');
  return client;
}
