// Minimal dependency-free schema validation for request bodies and queries.
// Each validator returns a parsed value or records an issue at its path.
// validate() throws a 422 AppError listing every failing field.

import { validationFailed } from './errors.js';

const DECIMAL = /^-?\d{1,14}(\.\d{1,6})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class Schema {
  constructor(check) { this.check = check; this.isOptional = false; this.isNullable = false; this.defaultValue = undefined; }
  optional() { const s = this.clone(); s.isOptional = true; return s; }
  nullable() { const s = this.clone(); s.isNullable = true; return s; }
  default(value) { const s = this.clone(); s.isOptional = true; s.defaultValue = value; return s; }
  clone() { const s = Object.create(Object.getPrototypeOf(this)); Object.assign(s, this); return s; }
  run(value, path, issues) {
    if (value === undefined || value === '') {
      if (this.defaultValue !== undefined) return typeof this.defaultValue === 'function' ? this.defaultValue() : this.defaultValue;
      if (this.isOptional) return undefined;
      if (value === '' && this.isNullable) return null;
      issues.push({ path, message: 'is required' });
      return undefined;
    }
    if (value === null) {
      if (this.isNullable) return null;
      if (this.isOptional) return undefined;
      issues.push({ path, message: 'is required' });
      return undefined;
    }
    return this.check(value, path, issues);
  }
}

const fail = (issues, path, message) => { issues.push({ path, message }); return undefined; };

export const s = {
  string({ min = 0, max = 2000, pattern, trim = true, lower = false, upper = false } = {}) {
    return new Schema((value, path, issues) => {
      if (typeof value !== 'string') return fail(issues, path, 'must be text');
      let v = trim ? value.trim().replace(/\s+/g, ' ') : value;
      if (lower) v = v.toLowerCase();
      if (upper) v = v.toUpperCase();
      if (v.length < min) return fail(issues, path, min === 1 ? 'is required' : `must be at least ${min} characters`);
      if (v.length > max) return fail(issues, path, `must be at most ${max} characters`);
      if (pattern && !pattern.test(v)) return fail(issues, path, 'has an invalid format');
      return v;
    });
  },
  text({ max = 20000 } = {}) {
    return new Schema((value, path, issues) => {
      if (typeof value !== 'string') return fail(issues, path, 'must be text');
      if (value.length > max) return fail(issues, path, `must be at most ${max} characters`);
      return value.trim();
    });
  },
  reason() { return s.string({ min: 3, max: 1000 }); },
  email() {
    return new Schema((value, path, issues) => {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
      return v.length <= 254 && EMAIL.test(v) ? v : fail(issues, path, 'must be a valid email address');
    });
  },
  int({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    return new Schema((value, path, issues) => {
      const n = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
      if (!Number.isSafeInteger(n)) return fail(issues, path, 'must be a whole number');
      if (n < min || n > max) return fail(issues, path, `must be between ${min} and ${max}`);
      return n;
    });
  },
  id() { return s.int({ min: 1 }); },
  uuid() {
    return new Schema((value, path, issues) => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail(issues, path, 'must be a valid identifier'));
  },
  /** Exact decimal kept as a string (never a float). */
  decimal({ min, max, allowNegative = false } = {}) {
    return new Schema((value, path, issues) => {
      const v = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : null;
      if (v === null || !DECIMAL.test(v)) return fail(issues, path, 'must be a decimal number with at most 6 decimal places');
      if (!allowNegative && v.startsWith('-')) return fail(issues, path, 'must not be negative');
      if (min !== undefined && compareDecimal(v, String(min)) < 0) return fail(issues, path, `must be at least ${min}`);
      if (max !== undefined && compareDecimal(v, String(max)) > 0) return fail(issues, path, `must be at most ${max}`);
      return normalizeDecimal(v);
    });
  },
  bool() {
    return new Schema((value, path, issues) => {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fail(issues, path, 'must be true or false');
    });
  },
  enum(values) {
    return new Schema((value, path, issues) => values.includes(value) ? value : fail(issues, path, `must be one of ${values.join(', ')}`));
  },
  date() {
    return new Schema((value, path, issues) => {
      if (typeof value !== 'string' || !DATE.test(value)) return fail(issues, path, 'must be a date (YYYY-MM-DD)');
      const d = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : fail(issues, path, 'must be a real calendar date');
    });
  },
  datetime() {
    return new Schema((value, path, issues) => {
      if (typeof value !== 'string' || value.length > 40) return fail(issues, path, 'must be an ISO date-time');
      const d = new Date(value);
      return Number.isNaN(d.getTime()) || !/\d{4}-\d{2}-\d{2}T/.test(value) ? fail(issues, path, 'must be an ISO date-time') : d.toISOString();
    });
  },
  array(item, { min = 0, max = 500 } = {}) {
    return new Schema((value, path, issues) => {
      if (!Array.isArray(value)) return fail(issues, path, 'must be a list');
      if (value.length < min) return fail(issues, path, `must contain at least ${min} item(s)`);
      if (value.length > max) return fail(issues, path, `must contain at most ${max} items`);
      return value.map((entry, index) => item.run(entry, `${path}[${index}]`, issues));
    });
  },
  object(shape, { strict = true } = {}) {
    return new Schema((value, path, issues) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(issues, path, 'must be an object');
      if (strict) for (const key of Object.keys(value)) if (!(key in shape)) issues.push({ path: join(path, key), message: 'is not a recognised field' });
      const out = {};
      if (!strict) for (const [key, entry] of Object.entries(value)) if (!(key in shape)) out[key] = entry;
      for (const [key, schema] of Object.entries(shape)) {
        const parsed = schema.run(value[key], join(path, key), issues);
        if (parsed !== undefined) out[key] = parsed;
      }
      return out;
    });
  },
  /** Any JSON value; the caller validates its structure. */
  json({ maxBytes = 20000 } = {}) {
    return new Schema((value, path, issues) => JSON.stringify(value).length > maxBytes ? fail(issues, path, 'is too large') : value);
  }
};

const join = (path, key) => path ? `${path}.${key}` : key;

export function validate(schema, value, label = 'Request') {
  const issues = [];
  const parsed = schema.run(value, '', issues);
  if (issues.length) {
    const first = issues[0];
    throw validationFailed(`${label} is invalid: ${first.path || 'value'} ${first.message}.`, { fields: issues.slice(0, 50) });
  }
  return parsed;
}

/** Parses URLSearchParams into a plain object then validates it. */
export function validateQuery(schema, searchParams) {
  return validate(schema, Object.fromEntries(searchParams.entries()), 'Query');
}

export function normalizeDecimal(value) {
  const negative = value.startsWith('-');
  let [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  whole = whole.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');
  const out = fraction ? `${whole}.${fraction}` : whole;
  return negative && out !== '0' ? `-${out}` : out;
}

/** Exact comparison of two decimal strings. */
export function compareDecimal(a, b) {
  const scale = (v) => { const neg = v.startsWith('-'); const [w, f = ''] = (neg ? v.slice(1) : v).split('.'); const n = BigInt(w + f.padEnd(6, '0').slice(0, 6)); return neg ? -n : n; };
  const x = scale(a), y = scale(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
