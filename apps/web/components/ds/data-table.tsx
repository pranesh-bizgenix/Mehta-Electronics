'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Pagination } from '@/lib/api/client';
import { usePreferences, type SavedFilter } from '@/lib/preferences';
import { Icon } from './icons';
import { Button, IconButton } from './primitives';
import { Checkbox, TextField } from './fields';
import { Menu, Modal } from './overlay';
import { EmptyState, ErrorState, TableSkeleton } from './feedback';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Right-aligned numeric/money column with tabular numerals. */
  numeric?: boolean;
  sortable?: boolean;
  /** Hidden by default; the user can show it from the column chooser. */
  optional?: boolean;
  width?: string;
}

export interface BulkAction<T> { label: string; onRun: (rows: T[]) => void; danger?: boolean }

interface DataTableProps<T> {
  id: string;                       // stable key for saved filters and column choices
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  pagination?: Pagination;
  onPage?: (page: number) => void;
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  filters?: ReactNode;              // extra filter controls rendered in the toolbar
  currentQuery?: Record<string, string>;
  onApplySaved?: (query: Record<string, string>) => void;
  sort?: { key: string; direction: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  bulkActions?: BulkAction<T>[];
  empty?: ReactNode;
  selectedKey?: string | number | null;
  /** Embedded use (inside a card): no toolbar, border or shadow. */
  bare?: boolean;
}

const VIRTUAL_THRESHOLD = 120;
const ROW_ESTIMATE = 52;

export function DataTable<T>(props: DataTableProps<T>) {
  const { id, caption, columns, rows, rowKey, loading, error, onRetry, pagination, onPage, search, filters, sort, onSort, onRowClick, rowActions, bulkActions, empty, selectedKey, bare } = props;
  const { preferences, update } = usePreferences();
  const [visible, setVisible] = useState<Set<string>>(() => new Set(columns.filter((c) => !c.optional).map((c) => c.key)));
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [term, setTerm] = useState(search?.value ?? '');
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Debounced server search.
  useEffect(() => { setTerm(search?.value ?? ''); }, [search?.value]);
  useEffect(() => {
    if (!search || term === search.value) return;
    const t = setTimeout(() => search.onChange(term), 300);
    return () => clearTimeout(t);
  }, [term, search]);
  useEffect(() => { setSelected(new Set()); }, [rows]);

  const shown = columns.filter((c) => visible.has(c.key));
  const list = useMemo(() => rows ?? [], [rows]);
  const virtual = list.length > VIRTUAL_THRESHOLD;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_ESTIMATE) - 10) : 0;
  const end = virtual ? Math.min(list.length, start + 60) : list.length;
  const windowRows = list.slice(start, end);
  const saved: SavedFilter[] = preferences.savedFilters[id] ?? [];
  const selectedRows = list.filter((r) => selected.has(rowKey(r)));
  const allSelected = list.length > 0 && selected.size === list.length;

  const [naming, setNaming] = useState<string | null>(null);
  const saveCurrent = () => {
    const name = naming?.trim();
    if (!name || !props.currentQuery) return;
    update({ savedFilters: { ...preferences.savedFilters, [id]: [...saved.filter((s) => s.name !== name), { name, query: props.currentQuery }].slice(-10) } });
    setNaming(null);
  };

  return (
    <div className="ds-table-shell" data-bare={bare || undefined}>
      {!bare && <div className="ds-table-toolbar" role="search">
        {search && <TextField label={search.placeholder ?? 'Search'} type="search" value={term} onChange={(e) => setTerm(e.target.value)} />}
        {filters}
        <div className="ds-table-toolbar-end">
          {props.onApplySaved && (
            <Menu label="Saved views" trigger={(t) => <Button variant="ghost" size="sm" icon="filter" {...t}>Views</Button>}>
              <p className="ds-menu-label">Saved views</p>
              {saved.length === 0 && <p className="ds-menu-item muted">No saved views yet</p>}
              {saved.map((s) => <button key={s.name} type="button" className="ds-menu-item" role="menuitem" onClick={() => props.onApplySaved?.(s.query)}>{s.name}</button>)}
              <div className="ds-menu-sep" />
              <button type="button" className="ds-menu-item" role="menuitem" onClick={() => setNaming('')}><Icon name="plus" />Save current view</button>
            </Menu>
          )}
          <Menu label="Columns" trigger={(t) => <IconButton icon="columns" label="Choose columns" {...t} />}>
            <p className="ds-menu-label">Columns</p>
            {columns.map((c) => (
              <div key={c.key} className="ds-menu-item" onClick={(e) => e.stopPropagation()}>
                <Checkbox label={c.header} checked={visible.has(c.key)} onChange={() => setVisible((v) => { const n = new Set(v); if (n.has(c.key) && n.size > 1) n.delete(c.key); else n.add(c.key); return n; })} />
              </div>
            ))}
          </Menu>
          <IconButton icon="sliders" label={preferences.density === 'compact' ? 'Comfortable rows' : 'Compact rows'} onClick={() => update({ density: preferences.density === 'compact' ? 'comfortable' : 'compact' })} />
        </div>
      </div>}

      <Modal open={naming !== null} title="Save this view" onClose={() => setNaming(null)} footer={<><Button variant="ghost" onClick={() => setNaming(null)}>Cancel</Button><Button disabled={!naming?.trim()} onClick={saveCurrent}>Save view</Button></>}>
        <TextField label="View name" autoFocus maxLength={40} value={naming ?? ''} onChange={(e) => setNaming(e.target.value)} hint="Saved to your account with the current search and filters." />
      </Modal>
      {bulkActions && selected.size > 0 && (
        <div className="ds-bulkbar" role="region" aria-label="Bulk actions">
          <span>{selected.size} selected</span>
          {bulkActions.map((a) => <Button key={a.label} size="sm" variant={a.danger ? 'danger' : 'secondary'} onClick={() => a.onRun(selectedRows)}>{a.label}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {error ? <ErrorState error={error} onRetry={onRetry} /> : loading && !rows ? <TableSkeleton columns={Math.min(shown.length, 6)} /> : list.length === 0 ? (empty ?? <EmptyState title="Nothing here yet" illustration={search?.value ? 'search' : 'empty'}>{search?.value ? 'No records match your search. Try fewer words.' : undefined}</EmptyState>) : (
        <div className="ds-table-scroll" ref={scroller} onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
          style={virtual ? { ['--table-max-height' as string]: '70vh' } : undefined} aria-busy={loading || undefined}>
          <table className="ds-table" data-density={preferences.density}>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {bulkActions && <th className="ds-col-check" scope="col"><Checkbox label={<span className="sr-only">Select all</span>} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(list.map(rowKey)))} /></th>}
                {shown.map((c) => (
                  <th key={c.key} scope="col" className={c.numeric ? 'ds-col-end' : undefined} style={c.width ? { width: c.width } : undefined}
                    aria-sort={sort?.key === c.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortable && onSort ? <button type="button" className="ds-sort" onClick={() => onSort(c.key)}>{c.header}<Icon name={sort?.key === c.key ? (sort.direction === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort'} /></button> : c.header}
                  </th>
                ))}
                {rowActions && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {virtual && start > 0 && <tr aria-hidden="true"><td colSpan={99} style={{ height: `calc(${start} * var(--control-lg))`, padding: 0 }} /></tr>}
              {windowRows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr key={key} data-clickable={Boolean(onRowClick) || undefined} aria-selected={selected.has(key) || key === selectedKey || undefined}
                    onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest('button,a,input,label')) onRowClick(row); } : undefined}
                    tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}>
                    {bulkActions && <td className="ds-col-check" data-label=""><Checkbox label={<span className="sr-only">Select row</span>} checked={selected.has(key)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })} /></td>}
                    {shown.map((c) => <td key={c.key} data-label={c.header} className={c.numeric ? 'ds-col-end num' : undefined}>{c.render(row)}</td>)}
                    {rowActions && <td data-label=""><div className="ds-row-actions">{rowActions(row)}</div></td>}
                  </tr>
                );
              })}
              {virtual && end < list.length && <tr aria-hidden="true"><td colSpan={99} style={{ height: `calc(${list.length - end} * var(--control-lg))`, padding: 0 }} /></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pagination && list.length > 0 && (
        <div className="ds-table-footer">
          <span>{pagination.total.toLocaleString('en-IN')} record{pagination.total === 1 ? '' : 's'}{pagination.pages > 1 ? ` · page ${pagination.page} of ${pagination.pages}` : ''}</span>
          {pagination.pages > 1 && onPage && (
            <nav className="ds-pager" aria-label="Pagination">
              <IconButton icon="chevronLeft" label="Previous page" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} />
              <IconButton icon="chevronRight" label="Next page" disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)} />
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
