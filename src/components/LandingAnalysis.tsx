import { useMemo, useState } from 'react';
import { Button, Card, Empty } from './ui';
import { formatDate, formatDashboardQuantity, reportingUnitLabel } from '../lib/format';
import { QUANTITY_TYPES, quantitiesByFishType, quantitiesByPermitHolder, quantitiesByVessel, receivedOverTime, summariseLandings, type PeriodGrouping } from '../lib/landingAnalysis';
import ShareDoughnut from './ShareDoughnut';
import type { Landing, ReportingUnit } from '../lib/types';

const count = (value: number) => value.toLocaleString('en-NZ');

function QuantityToggle({ label, value, available, onChange }: { label: string; value: ReportingUnit; available: ReportingUnit[]; onChange: (unit: ReportingUnit) => void }) {
  return <div className="export-unit-toggle" role="group" aria-label={label}>
    {QUANTITY_TYPES.map((unit) => <Button key={unit} type="button" variant={value === unit ? 'primary' : 'ghost'} aria-pressed={value === unit} disabled={!available.includes(unit)} title={available.includes(unit) ? undefined : 'No matching quantities in the selected landings.'} onClick={() => onChange(unit)}>{reportingUnitLabel(unit)}</Button>)}
  </div>;
}

function periodLabel(date: string, grouping: PeriodGrouping) {
  if (grouping === 'month') return new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  return `${grouping === 'week' ? 'Week of ' : ''}${formatDate(date)}`;
}

function ReceivedLine({ landings, unit, grouping, fromDate, toDate }: { landings: Landing[]; unit: ReportingUnit; grouping: PeriodGrouping; fromDate: string; toDate: string }) {
  const { points, tooManyPeriods } = useMemo(() => receivedOverTime(landings, unit, grouping, fromDate, toDate), [landings, unit, grouping, fromDate, toDate]);
  const [active, setActive] = useState<number | null>(null);
  const width = 900, height = 280, left = 90, right = 24, top = 20, bottom = 52;
  const max = Math.max(1, ...points.map((point) => point.quantity));
  const x = (index: number) => points.length === 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (points.length - 1);
  const y = (quantity: number) => top + (height - top - bottom) * (1 - quantity / max);
  const focused = active === null ? undefined : points[Math.min(active, points.length - 1)];
  const ticks = [...new Set(Array.from({ length: Math.min(points.length, 6) }, (_, index) => Math.round(index * (points.length - 1) / Math.max(1, Math.min(points.length, 6) - 1))))];

  return <div className="export-chart-series">
    <h4>{reportingUnitLabel(unit)}</h4>
    {tooManyPeriods ? <Empty>Too many {grouping === 'day' ? 'days' : grouping === 'week' ? 'weeks' : 'months'} to display. Choose a shorter date range or a longer grouping.</Empty> : <>
      <div className="export-line-scroll">
        <svg className="export-line" viewBox={`0 0 ${width} ${height}`} role="group" tabIndex={0}
          aria-label={`Received over time, ${reportingUnitLabel(unit)}. Use the left and right arrow keys to explore quantities.`}
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const position = (event.clientX - bounds.left) / bounds.width * width;
            setActive(points.length === 1 ? 0 : Math.max(0, Math.min(points.length - 1, Math.round((position - left) / (width - left - right) * (points.length - 1)))));
          }}
          onMouseLeave={(event) => { if (document.activeElement !== event.currentTarget) setActive(null); }}
          onFocus={() => setActive(0)} onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              setActive((index) => event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (index ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))));
            }
          }}>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <g key={fraction}>
            <line x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} className="export-gridline" />
            <text x={left - 12} y={y(max * fraction) + 4} textAnchor="end">{count(Math.round(max * fraction / (unit === 'count' ? 1 : 100)))}</text>
          </g>)}
          <polyline points={points.map((point, index) => `${x(index)},${y(point.quantity)}`).join(' ')} className="export-trend" />
          {points.length <= 80 && points.map((point, index) => <circle key={point.date} cx={x(index)} cy={y(point.quantity)} r="3.5" className="export-point"><title>{periodLabel(point.date, grouping)}: {formatDashboardQuantity(point.quantity, unit)} {reportingUnitLabel(unit)}</title></circle>)}
          {focused && active !== null ? <g>
            <line x1={x(Math.min(active, points.length - 1))} x2={x(Math.min(active, points.length - 1))} y1={top} y2={height - bottom} className="export-crosshair" />
            <circle cx={x(Math.min(active, points.length - 1))} cy={y(focused.quantity)} r="6" className="export-point" />
          </g> : null}
          {ticks.map((index) => <text key={index} x={x(index)} y={height - 22} textAnchor={index === 0 && points.length > 1 ? 'start' : index === points.length - 1 && points.length > 1 ? 'end' : 'middle'}>{grouping === 'month' ? periodLabel(points[index].date, grouping) : formatDate(points[index].date)}</text>)}
        </svg>
      </div>
      <p className="export-chart-readout muted" aria-live="polite">{focused ? <>{periodLabel(focused.date, grouping)}: <strong>{formatDashboardQuantity(focused.quantity, unit)} {reportingUnitLabel(unit)}</strong></> : 'Hover over the line or use the arrow keys to see quantities.'}</p>
    </>}
  </div>;
}

interface LandingAnalysisProps {
  landings: Landing[];
  fromDate: string;
  toDate: string;
  grouping: PeriodGrouping;
  onGroupingChange: (value: PeriodGrouping) => void;
  stockUnit: ReportingUnit;
  onStockUnitChange: (value: ReportingUnit) => void;
  timeUnit: ReportingUnit;
  onTimeUnitChange: (value: ReportingUnit) => void;
  vesselUnit: ReportingUnit;
  onVesselUnitChange: (value: ReportingUnit) => void;
}

export default function LandingAnalysis({ landings, fromDate, toDate, grouping, onGroupingChange, stockUnit, onStockUnitChange, timeUnit, onTimeUnitChange, vesselUnit, onVesselUnitChange }: LandingAnalysisProps) {
  const summary = useMemo(() => summariseLandings(landings), [landings]);
  const kpiUnits: ReportingUnit[] = ['greenweightKg', ...(summary.totals.some((total) => total.unit === 'meatweightKg') ? ['meatweightKg' as const] : []), 'count'];
  const availableUnits = summary.totals.map((total) => total.unit);
  const activeTimeUnit = availableUnits.includes(timeUnit) ? timeUnit : availableUnits[0] ?? 'greenweightKg';
  const activeVesselUnit = availableUnits.includes(vesselUnit) ? vesselUnit : availableUnits[0] ?? 'greenweightKg';
  const activeStockUnit = availableUnits.includes(stockUnit) ? stockUnit : availableUnits[0] ?? 'greenweightKg';
  const stockShares = useMemo(() => summary.fishstocks.filter((stock) => stock.unit === activeStockUnit).map((stock) => ({ key: stock.code, name: stock.code, detail: stock.description, quantity: stock.quantity })), [summary.fishstocks, activeStockUnit]);
  const fishTypeShares = useMemo(() => quantitiesByFishType(landings, activeStockUnit).map((type) => ({ key: type.fishType, name: type.fishType, detail: type.description, quantity: type.quantity })), [landings, activeStockUnit]);
  const vesselShares = useMemo(() => quantitiesByVessel(landings, activeVesselUnit).map((vessel) => ({ key: vessel.vesselId ?? 'shore-based', name: vessel.name, detail: vessel.number, quantity: vessel.quantity })), [landings, activeVesselUnit]);
  const holderShares = useMemo(() => quantitiesByPermitHolder(landings, activeVesselUnit).map((holder) => ({ key: holder.fisherId, name: holder.name, detail: holder.number, quantity: holder.quantity })), [landings, activeVesselUnit]);

  return <section className="export-analysis" aria-labelledby="export-analysis-title">
    <div><h2 id="export-analysis-title">Selected landings at a glance</h2><p className="muted">These figures use the same filters as your Excel file. Kilograms are shown to the nearest kg.</p></div>
    <div className={`metrics metrics-count-${4 + kpiUnits.length}`}>
      <Card className="metric"><span>Permit holders</span><strong>{count(summary.permitHolderCount)}</strong></Card>
      <Card className="metric"><span>Landings</span><strong>{count(summary.landingCount)}</strong></Card>
      {kpiUnits.map((unit) => <Card className="metric" key={unit} aria-label={reportingUnitLabel(unit)}><span>{reportingUnitLabel(unit)}</span><strong>{formatDashboardQuantity(summary.totals.find((total) => total.unit === unit)?.quantity ?? 0, unit)}</strong></Card>)}
      <Card className="metric"><span>Fishstocks</span><strong>{count(summary.fishstockCount)}</strong><span>Different codes</span></Card>
      <Card className="metric"><span>Vessels</span><strong>{count(summary.vesselCount)}</strong><span>{count(summary.shoreCount)} shore-based {summary.shoreCount === 1 ? 'landing' : 'landings'}</span></Card>
    </div>
    <Card className="export-charts">
    <section className="export-chart-section" aria-labelledby="export-time-title">
      <div className="split"><div><h3 id="export-time-title">Received over time</h3><p className="muted">{grouping === 'week' ? 'Weeks start on Monday. ' : ''}Periods with no receipts show zero.</p></div><div className="field"><label htmlFor="export-grouping">Group by</label><select id="export-grouping" value={grouping} onChange={(event) => onGroupingChange(event.target.value as PeriodGrouping)}><option value="month">Month</option><option value="week">Week</option><option value="day">Day</option></select></div></div>
      <QuantityToggle label="Received over time quantity type" value={activeTimeUnit} available={availableUnits} onChange={onTimeUnitChange} />
      <ReceivedLine key={activeTimeUnit} landings={landings} unit={activeTimeUnit} grouping={grouping} fromDate={fromDate} toDate={toDate} />
    </section>
    <section className="export-chart-section" aria-labelledby="export-stocks-title">
      <div><h3 id="export-stocks-title">Quantity by fishstock and fish type</h3><p className="muted">Largest first. The top 10 each have their own colour; the rest are grouped as Other. Fish type groups stocks by their first three letters, as in monthly summaries.</p></div>
      <QuantityToggle label="Quantity by fishstock and fish type quantity type" value={activeStockUnit} available={availableUnits} onChange={onStockUnitChange} />
      <div className="export-share-grid">
        <ShareDoughnut id="export-stock-share" title="Quantity by fishstock" entries={stockShares} unit={activeStockUnit} emptyText="No fishstocks have this quantity type." legendShowsDetail />
        <ShareDoughnut id="export-fish-type-share" title="Quantity by fish type" entries={fishTypeShares} unit={activeStockUnit} emptyText="No fish types have this quantity type." legendShowsDetail />
      </div>
    </section>
    <section className="export-chart-section" aria-labelledby="export-shares-title">
      <div><h3 id="export-shares-title">Quantity by permit holder and vessel</h3><p className="muted">Largest first. The top 10 each have their own colour; the rest are grouped as Other. Shore-based receipts appear separately.</p></div>
      <QuantityToggle label="Quantity by permit holder and vessel quantity type" value={activeVesselUnit} available={availableUnits} onChange={onVesselUnitChange} />
      <div className="export-share-grid">
        <ShareDoughnut id="export-holder-share" title="Quantity by permit holder" entries={holderShares} unit={activeVesselUnit} emptyText="No permit holders have this quantity type." />
        <ShareDoughnut id="export-vessel-share" title="Quantity by vessel" entries={vesselShares} unit={activeVesselUnit} emptyText="No vessels have this quantity type." missingDetail="No vessel number" />
      </div>
    </section>
    </Card>
  </section>;
}
