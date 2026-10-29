// Display formatting. Money and quantities arrive from the API as exact decimal
// strings (NUMERIC); they are formatted as strings, never through floats.

type Decimalish = string | number | null | undefined;

function splitDecimal(value: Decimalish): { negative: boolean; whole: string; fraction: string } | null {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(6) : '') : String(value).trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  return { negative: Boolean(match[1]), whole: match[2].replace(/^0+(?=\d)/, ''), fraction: match[3] ?? '' };
}

/** Indian digit grouping: 12,34,567 */
export function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/** Rounds a decimal string half-up to `places` digits without floating point. */
function roundDecimal(whole: string, fraction: string, places: number): { whole: string; fraction: string } {
  if (fraction.length <= places) return { whole, fraction: fraction.padEnd(places, '0') };
  const digits = (whole + fraction.slice(0, places)).split('').map(Number);
  if (Number(fraction[places]) >= 5) {
    let i = digits.length - 1;
    while (i >= 0) { if (digits[i] === 9) { digits[i] = 0; i--; } else { digits[i] += 1; break; } }
    if (i < 0) digits.unshift(1);
  }
  const joined = digits.join('');
  const cut = joined.length - places;
  return { whole: joined.slice(0, cut) || '0', fraction: places ? joined.slice(cut) : '' };
}

/** ₹12,34,567.00 — exact, Indian grouping, 2 decimals by default. */
export function formatMoney(value: Decimalish, { places = 2, symbol = true }: { places?: number; symbol?: boolean } = {}): string {
  const parts = splitDecimal(value);
  if (!parts) return '—';
  const r = roundDecimal(parts.whole, parts.fraction, places);
  const isZero = /^0*$/.test(r.whole + r.fraction);
  const body = `${symbol ? '₹' : ''}${groupIndian(r.whole)}${places ? `.${r.fraction}` : ''}`;
  return parts.negative && !isZero ? `−${body}` : body;
}

/** Compact money for cards: ₹12.3 L, ₹4.5 Cr (exact value belongs in a tooltip). */
export function formatMoneyCompact(value: Decimalish): string {
  const parts = splitDecimal(value);
  if (!parts) return '—';
  const n = Number(`${parts.whole}.${parts.fraction || '0'}`);
  const sign = parts.negative ? '−' : '';
  if (n >= 1e7) return `${sign}₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${sign}₹${(n / 1e5).toFixed(2)} L`;
  return formatMoney(value, { places: 0 });
}

/** Quantity: grouping, trailing zeros trimmed, optional unit. */
export function formatQty(value: Decimalish, unit?: string | null): string {
  const parts = splitDecimal(value);
  if (!parts) return '—';
  const fraction = parts.fraction.replace(/0+$/, '');
  const body = `${parts.negative ? '−' : ''}${groupIndian(parts.whole)}${fraction ? `.${fraction}` : ''}`;
  return unit ? `${body} ${unit}` : body;
}

export function formatPercent(value: Decimalish, places = 1): string {
  const parts = splitDecimal(value);
  if (!parts) return '—';
  const r = roundDecimal(parts.whole, parts.fraction, places);
  return `${parts.negative ? '−' : ''}${r.whole}${places ? `.${r.fraction}` : ''}%`;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+05:30` : value);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

/** "5 min ago", "in 2 h", "3 days ago". */
export function formatRelative(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const minutes = Math.round((d.getTime() - now.getTime()) / 60000);
  const abs = Math.abs(minutes);
  const text = abs < 1 ? 'now' : abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} day${Math.round(abs / 1440) === 1 ? '' : 's'}`;
  if (text === 'now') return 'just now';
  return minutes < 0 ? `${text} ago` : `in ${text}`;
}

export function initials(name: string | null | undefined): string {
  return (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

const ACRONYMS = new Set(['mfa', 'sla', 'gst', 'gstin', 'po', 'rfq', 'grn', 'lr', 'crm', 'hsn', 'uom', 'pdf', 'ip', 'id', 'otp']);
export function titleCase(code: string | null | undefined): string {
  if (!code) return '—';
  const text = code.replace(/_/g, ' ').toLowerCase().split(' ').map((w) => ACRONYMS.has(w) ? w.toUpperCase() : w).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
