'use client';

// One chart style for the whole product: SVG, theme colours from tokens
// (--chart-1..5), light gridlines, no 3D or decoration, accessible labels and
// a data table fallback for screen readers.

import { useId, useState } from 'react';

const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export interface Series { name: string; values: number[] }

function ScreenReaderTable({ caption, labels, series, format }: { caption: string; labels: string[]; series: Series[]; format: (n: number) => string }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Period</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
      <tbody>{labels.map((l, i) => <tr key={l}><th scope="row">{l}</th>{series.map((s) => <td key={s.name}>{format(s.values[i] ?? 0)}</td>)}</tr>)}</tbody>
    </table>
  );
}

/** Axis maximum with distinct, round tick labels (counts stay whole numbers). */
function niceMax(n: number, ticks = 4) {
  if (n <= 0) return ticks;
  if (n <= 20) return Math.max(ticks, Math.ceil(n / ticks) * ticks);
  const p = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / p) * p;
}

/** Grouped bar chart with hover tooltip. */
export function BarChart({ title, labels, series, format = (n) => String(n) }: { title: string; labels: string[]; series: Series[]; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const W = 600, H = 220, padL = 44, padB = 24, plotW = W - padL, plotH = H - padB - 8;
  const group = plotW / Math.max(1, labels.length), bar = Math.min(28, (group * 0.7) / series.length);
  return (
    <figure className="ds-chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line className="grid" x1={padL} x2={W} y1={8 + plotH * (1 - t)} y2={8 + plotH * (1 - t)} /><text x={padL - 6} y={12 + plotH * (1 - t)} textAnchor="end">{format(max * t)}</text></g>)}
        {labels.map((l, i) => (
          <g key={l} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={padL + group * i} y={8} width={group} height={plotH} fill="transparent" />
            {series.map((s, si) => {
              const h = (s.values[i] ?? 0) / max * plotH;
              return <rect key={s.name} x={padL + group * i + (group - bar * series.length) / 2 + si * bar} y={8 + plotH - h} width={bar - 2} height={Math.max(h, 0)} rx="3" fill={SERIES[si % SERIES.length]} opacity={hover === null || hover === i ? 1 : 0.45} />;
            })}
            <text x={padL + group * i + group / 2} y={H - 6} textAnchor="middle">{l}</text>
          </g>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <rect x={Math.min(padL + group * hover + group / 2 - 70, W - 140)} y={0} width={140} height={14 + series.length * 16} rx="6" fill="var(--color-text)" />
            {series.map((s, si) => <text key={s.name} x={Math.min(padL + group * hover + group / 2 - 62, W - 132)} y={16 + si * 16} style={{ fill: 'var(--color-canvas)' }}>{`${s.name}: ${format(s.values[hover] ?? 0)}`}</text>)}
          </g>
        )}
      </svg>
      {series.length > 1 && <figcaption className="ds-legend">{series.map((s, i) => <span key={s.name}><i style={{ background: SERIES[i % SERIES.length] }} />{s.name}</span>)}</figcaption>}
      <ScreenReaderTable caption={title} labels={labels} series={series} format={format} />
    </figure>
  );
}

/** Line/area chart for trends (SLA, conversion). */
export function LineChart({ title, labels, series, format = (n) => String(n) }: { title: string; labels: string[]; series: Series[]; format?: (n: number) => string }) {
  const gradient = useId();
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const W = 600, H = 220, padL = 44, padB = 24, plotW = W - padL - 8, plotH = H - padB - 8;
  const x = (i: number) => padL + (labels.length < 2 ? plotW / 2 : (plotW * i) / (labels.length - 1));
  const y = (v: number) => 8 + plotH - (v / max) * plotH;
  return (
    <figure className="ds-chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} preserveAspectRatio="none">
        <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient></defs>
        {[0, 0.5, 1].map((t) => <g key={t}><line className="grid" x1={padL} x2={W} y1={y(max * t)} y2={y(max * t)} /><text x={padL - 6} y={y(max * t) + 4} textAnchor="end">{format(max * t)}</text></g>)}
        {series.map((s, si) => {
          const path = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.name}>
              {si === 0 && <path d={`${path} L${x(s.values.length - 1)},${8 + plotH} L${x(0)},${8 + plotH} Z`} fill={`url(#${gradient})`} />}
              <path d={path} fill="none" stroke={SERIES[si % SERIES.length]} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="var(--color-surface)" stroke={SERIES[si % SERIES.length]} strokeWidth="2"><title>{`${labels[i]} · ${s.name}: ${format(v)}`}</title></circle>)}
            </g>
          );
        })}
        {labels.map((l, i) => <text key={l} x={x(i)} y={H - 6} textAnchor="middle">{l}</text>)}
      </svg>
      {series.length > 1 && <figcaption className="ds-legend">{series.map((s, i) => <span key={s.name}><i style={{ background: SERIES[i % SERIES.length] }} />{s.name}</span>)}</figcaption>}
      <ScreenReaderTable caption={title} labels={labels} series={series} format={format} />
    </figure>
  );
}

/** Horizontal funnel (enquiry → quote → approved → won). */
export function Funnel({ stages, format = (n) => String(n) }: { stages: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="ds-funnel" role="list" aria-label="Pipeline funnel">
      {stages.map((s, i) => (
        <div className="ds-funnel-row" role="listitem" key={s.label}>
          <span className="truncate">{s.label}</span>
          <span><span className="ds-funnel-bar" style={{ display: 'block', width: `${(s.value / max) * 100}%`, background: SERIES[i % 2 === 0 ? 0 : 3] }} /></span>
          <span className="num">{format(s.value)}{i > 0 && stages[i - 1].value > 0 && s.value <= stages[i - 1].value && <span className="subtle"> · {Math.round((s.value / stages[i - 1].value) * 100)}%</span>}</span>
        </div>
      ))}
    </div>
  );
}

/** Progress meter with label (e.g. % of quotes protected by margin floor). */
export function Meter({ value, max = 100, label, tone = 'var(--chart-1)' }: { value: number; max?: number; label: string; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="stack-sm">
      <div className="cluster-between"><span className="muted">{label}</span><span className="num">{Math.round(pct)}%</span></div>
      <div className="ds-meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}><span style={{ width: `${pct}%`, background: tone }} /></div>
    </div>
  );
}
