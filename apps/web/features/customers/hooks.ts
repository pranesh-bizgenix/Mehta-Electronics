'use client';

import { useMemo, useState } from 'react';
import { useApi } from '@/lib/api/provider';
import { useAsync } from '@/components/ds';
import { customersApi } from './api';

export function useCustomersApi() {
  const client = useApi();
  return useMemo(() => customersApi(client), [client]);
}

/** List view model: server search, status filter, pagination. */
export function useCustomerList() {
  const api = useCustomersApi();
  const [query, setQuery] = useState({ page: 1, search: '', status: '' });
  const [state, reload] = useAsync((signal) => api.list(query, signal), [api, query.page, query.search, query.status]);
  const data = state.status === 'ready' ? state.data : state.data;
  return { state, data, query, setQuery: (patch: Partial<typeof query>) => setQuery((q) => ({ ...q, page: 1, ...patch })), setPage: (page: number) => setQuery((q) => ({ ...q, page })), reload };
}

/** 360 view model. */
export function useCustomer(id: string) {
  const api = useCustomersApi();
  const [state, reload] = useAsync((signal) => api.get(id, signal), [api, id]);
  return { state, customer: state.status === 'ready' ? state.data : state.data, reload, api };
}
