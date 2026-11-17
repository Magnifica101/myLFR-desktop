import { useState } from 'react';
import { formatDashboardQuantity, reportingUnitLabel } from '../lib/format';
import { shareSlices, type ShareEntry, type ShareSlice } from '../lib/landingAnalysis';
import type { ReportingUnit } from '../lib/types';
import { Empty } from './ui';

/**
 * Slice colours in fixed order, largest slice first. Validated for the dark card
 * surface: every pair of neighbouring slices (including the last slice and
 * "Other" back to the first) clears the colour-vision and normal-vision checks.
 * Names are always shown in the legend and table, so colour never carries
 * identity on its own.
 */
const SLICE_COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#1fa5bd', '#8f9a2f'];
const OTHER_COLOUR = '#5b6b6d';
const SIZE = 220, CENTRE = SIZE / 2, OUTER = 104, INNER = 72, GAP = 2;

export function sliceColour(slice: ShareSlice, index: number) {
  return slice.isOther ? OTHER_COLOUR : SLICE_COLOURS[index % SLICE_COLOURS.length];
}

export function formatShare(share: number) {
  const percent = share * 100;
  if (percent > 0 && percent < 0.1) return '<0.1%';
  return `${percent.toLocaleString('en-NZ', { maximumFractionDigits: 1 })}%`;
}

function point(radius: number, angle: number) {
  return `${CENTRE + radius * Math.sin(angle)} ${CENTRE - radius * Math.cos(angle)}`;
}

/** One ring segment, inset by half the gap on each side so neighbours stay apart. */
function segmentPath(start: number, end: number) {
  const outerInset = GAP / 2 / OUTER, innerInset = GAP / 2 / INNER;
  const largeArc = end - start > Math.PI ? 1 : 0;
  const outerStart = start + outerInset, outerEnd = Math.max(outerStart, end - outerInset);
  const innerStart = start + innerInset, innerEnd = Math.max(innerStart, end - innerInset);
  return `M ${point(OUTER, outerStart)} A ${OUTER} ${OUTER} 0 ${largeArc} 1 ${point(OUTER, outerEnd)} L ${point(INNER, innerEnd)} A ${INNER} ${INNER} 0 ${largeArc} 0 ${point(INNER, innerStart)} Z`;
}

function shortName(name: string) {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

interface ShareDoughnutProps {
  id: string;
  title: string;
  entries: ShareEntry[];
  unit: ReportingUnit;
  emptyText: string;
  /** Shown in the list when an entry has no detail line, so every row is the same height. */
  missingDetail?: string;
  /** Show each entry's detail beside its name in the legend, e.g. a fishstock's description. */
  legendShowsDetail?: boolean;
}

export default function ShareDoughnut({ id, title, entries, unit, emptyText, missingDetail, legendShowsDetail = false }: ShareDoughnutProps) {
  const detailOf = new Map(entries.map((entry) => [entry.key, entry.detail]));
  const [active, setActive] = useState<string | null>(null);
  const slices = shareSlices(entries);
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const unitLabel = reportingUnitLabel(unit);
  const colourByKey = new Map(slices.map((slice, index) => [slice.key, sliceColour(slice, index)]));
  const focused = slices.find((slice) => slice.key === active);
  let angle = 0;

  return <section className="export-share" aria-labelledby={`${id}-title`}>
    <h4 id={`${id}-title`}>{title}</h4>
    {!slices.length ? <Empty>{emptyText}</Empty> : <>
      <div className="export-share-figure">
        <svg className="export-share-ring" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
          aria-label={`${title}, ${unitLabel}: ${slices.map((slice) => `${slice.isOther ? `Other (${slice.otherCount})` : slice.name} ${formatShare(slice.share)}`).join(', ')}`}
          onMouseLeave={() => setActive(null)}>
          {slices.length === 1
            ? <circle cx={CENTRE} cy={CENTRE} r={(OUTER + INNER) / 2} fill="none" stroke={colourByKey.get(slices[0].key)} strokeWidth={OUTER - INNER} onMouseEnter={() => setActive(slices[0].key)} />
            : slices.map((slice) => {
              const start = angle;
              angle += slice.share * Math.PI * 2;
              return <path key={slice.key} d={segmentPath(start, angle)} fill={colourByKey.get(slice.key)}
                className={active && active !== slice.key ? 'export-share-dimmed' : undefined}
                onMouseEnter={() => setActive(slice.key)}>
                <title>{slice.isOther ? `Other (${slice.otherCount})` : slice.name}: {formatDashboardQuantity(slice.quantity, unit)} {unitLabel} ({formatShare(slice.share)})</title>
              </path>;
            })}
          <text x={CENTRE} y={CENTRE - 16} textAnchor="middle" className="export-share-centre-label">{focused ? shortName(focused.isOther ? `Other (${focused.otherCount})` : focused.name) : 'Total'}</text>
          <text x={CENTRE} y={CENTRE + 10} textAnchor="middle" className="export-share-centre-value">{formatDashboardQuantity(focused?.quantity ?? total, unit)}</text>
          <text x={CENTRE} y={CENTRE + 30} textAnchor="middle" className="export-share-centre-label">{focused ? formatShare(focused.share) : unitLabel}</text>
        </svg>
        <ul className="export-share-legend" aria-label={`${title} legend`}>
          {slices.map((slice) => <li key={slice.key} className={active && active !== slice.key ? 'export-share-dimmed' : undefined}
            onMouseEnter={() => setActive(slice.key)} onMouseLeave={() => setActive(null)}>
            <span className="export-swatch" style={{ background: colourByKey.get(slice.key) }} aria-hidden="true" />
            <span>{slice.isOther ? `Other (${slice.otherCount} more)` : slice.name}{legendShowsDetail && !slice.isOther && detailOf.get(slice.key) ? <span className="muted"> {detailOf.get(slice.key)}</span> : null}</span>
          </li>)}
        </ul>
      </div>
      <div className="table-wrap">
        <table className="export-share-table" aria-label={`${title} list`}>
          <thead><tr><th>Name</th><th className="numeric">{unitLabel}</th><th className="numeric">Share</th></tr></thead>
          <tbody>{entries.map((entry, index) => {
            const own = index < slices.length && !slices[index].isOther;
            return <tr key={entry.key} onMouseEnter={() => setActive(own ? entry.key : 'other')} onMouseLeave={() => setActive(null)}>
              <td><span className="export-share-name"><span className="export-swatch" style={{ background: own ? colourByKey.get(entry.key) : OTHER_COLOUR }} aria-hidden="true" /><span>{entry.name}{entry.detail || missingDetail ? <><br /><span className="muted">{entry.detail ?? missingDetail}</span></> : null}</span></span></td>
              <td className="numeric">{formatDashboardQuantity(entry.quantity, unit)}</td>
              <td className="numeric">{formatShare(entry.quantity / total)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
