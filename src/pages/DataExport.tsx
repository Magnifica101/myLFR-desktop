import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, Loading, PageHeader, Status } from '../components/ui';
import { PageHelp } from '../components/PageHelp';
import LandingAnalysis from '../components/LandingAnalysis';
import ExportVesselFilter from '../components/ExportVesselFilter';
import { useToast } from '../components/ToastProvider';
import { desktop } from '../lib/desktop';
import { fileNamePart, saveLandingDataWorkbook } from '../lib/exports';
import { errorMessage, reportingUnitLabel } from '../lib/format';
import { QUANTITY_TYPES, selectLandingLines, type PeriodGrouping } from '../lib/landingAnalysis';
import type { ReportingUnit } from '../lib/types';

/** More landings than any receiver will ever record, so nothing is cut off. */
const ALL_LANDINGS = 2_000_000;

export default function DataExport() {
  const toast = useToast();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [fisherId, setFisherId] = useState('');
  const [vesselId, setVesselId] = useState('');
  const [fishstockCodes, setFishstockCodes] = useState<string[]>([]);
  const [fishstockSearch, setFishstockSearch] = useState('');
  const [quantityType, setQuantityType] = useState<ReportingUnit | 'all'>('all');
  const [grouping, setGrouping] = useState<PeriodGrouping>('month');
  const [stockUnit, setStockUnit] = useState<ReportingUnit>('greenweightKg');
  const [timeUnit, setTimeUnit] = useState<ReportingUnit>('greenweightKg');
  const [vesselUnit, setVesselUnit] = useState<ReportingUnit>('greenweightKg');
  const [saving, setSaving] = useState(false);
  const fishers = useQuery({ queryKey: ['fishers', true], queryFn: () => desktop.listFishers(true) });
  const fisher = fishers.data?.find((entry) => entry.id === fisherId);
  const invalidDates = Boolean(fromDate && toDate && fromDate > toDate);
  const vessels = useMemo(() => [...new Map((fisher ? [fisher] : fishers.data ?? []).flatMap((entry) => entry.vessels.map((vessel) => [vessel.id, vessel] as const))).values()].sort((a, b) => a.name.localeCompare(b.name) || (a.vesselNumber ?? '').localeCompare(b.vesselNumber ?? '')), [fisher, fishers.data]);
  const landings = useQuery({
    queryKey: ['landing-data', fromDate, toDate, fisherId, vesselId],
    queryFn: () => desktop.listLandings({ fromDate: fromDate || null, toDate: toDate || null, fisherId: fisherId || null, vesselId: vesselId && vesselId !== 'shore-based' ? vesselId : null, limit: ALL_LANDINGS }),
    enabled: !invalidDates,
  });
  const selectedLandings = useMemo(() => selectLandingLines(landings.data ?? [], fishstockCodes, quantityType, vesselId === 'shore-based'), [landings.data, fishstockCodes, quantityType, vesselId]);
  const rowCount = useMemo(() => selectedLandings.reduce((total, landing) => total + landing.items.length, 0), [selectedLandings]);
  const fishstocks = useMemo(() => [...new Map(landings.data?.flatMap((landing) => landing.items.map((item) => [item.fishstockCode, item.description] as const)) ?? []).entries()].sort(([a], [b]) => a.localeCompare(b)), [landings.data]);
  const matchingStocks = fishstocks.filter(([code, description]) => `${code} ${description}`.toLocaleLowerCase().includes(fishstockSearch.trim().toLocaleLowerCase()));

  function clearFilters() {
    setFromDate(''); setToDate(''); setFisherId(''); setVesselId('');
    setFishstockCodes([]); setFishstockSearch(''); setQuantityType('all');
  }

  async function download() {
    if (!selectedLandings.length || invalidDates) return;
    setSaving(true);
    try {
      // With no dates chosen, the name uses the first and last landing dates.
      const dates = selectedLandings.map((landing) => landing.landingDate).sort();
      // Leave room for the prefix, dates and extension within the native filename limit.
      const permitHolderName = fileNamePart(fisher?.name ?? 'All permit holders').slice(0, 100);
      const saved = await saveLandingDataWorkbook(selectedLandings, `myLFR-landing-data-${permitHolderName}-${fromDate || dates[0]}-to-${toDate || dates[dates.length - 1]}`);
      if (saved) toast.show('Excel file saved.', 'success');
    } catch (caught) { toast.show(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  return <div className="page">
    <PageHeader title="Export data" description="Explore your landings and save the selected data as an Excel table." actions={<PageHelp page="export" />} />
    <Card>
      <h2>Choose what to include</h2>
      <p className="muted">Filters apply to the figures, charts and Excel file. Leave the dates empty to include all dates.</p>
      <div className="form-grid">
        <div className="field"><label htmlFor="export-from">From</label><input id="export-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
        <div className="field"><label htmlFor="export-to">To</label><input id="export-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
        <div className="field"><label htmlFor="export-fisher">Permit holder</label><select id="export-fisher" value={fisherId} onChange={(event) => { setFisherId(event.target.value); setVesselId(''); }}><option value="">All permit holders</option>{fishers.data?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} — {entry.permitNumber}{entry.isArchived ? ' (archived)' : ''}</option>)}</select></div>
        <ExportVesselFilter id="export-vessel" label="Vessel" value={vesselId} vessels={vessels} onChange={setVesselId} />
        <div className="field"><label htmlFor="export-quantity-type">Quantity type</label><select id="export-quantity-type" value={quantityType} onChange={(event) => setQuantityType(event.target.value as ReportingUnit | 'all')}><option value="all">All quantity types (shown separately)</option>{QUANTITY_TYPES.map((unit) => <option key={unit} value={unit}>{reportingUnitLabel(unit)}</option>)}</select></div>
        <div className="field"><span className="export-field-label" id="export-stocks-label">Fishstocks</span><details className="export-stock-picker"><summary aria-labelledby="export-stocks-label export-stocks-selection"><span id="export-stocks-selection">{fishstockCodes.length ? `${fishstockCodes.length} selected` : 'All fishstocks'}</span></summary><div className="export-stock-options"><label htmlFor="export-stock-search">Search fishstocks</label><input id="export-stock-search" placeholder="Code or description" value={fishstockSearch} onChange={(event) => setFishstockSearch(event.target.value)} /><div className="export-stock-checks">{matchingStocks.length ? matchingStocks.map(([code, description]) => <label key={code}><input type="checkbox" checked={fishstockCodes.includes(code)} onChange={(event) => setFishstockCodes(event.target.checked ? [...fishstockCodes, code] : fishstockCodes.filter((selected) => selected !== code))} /><span><strong>{code}</strong> — {description}</span></label>) : <p className="muted">No fishstocks match.</p>}</div><Button type="button" variant="ghost" onClick={() => setFishstockCodes([])}>All fishstocks</Button></div></details></div>
      </div>
      <div className="form-actions"><Button type="button" variant="ghost" onClick={clearFilters}>Clear filters</Button></div>
    </Card>
    {fishers.isError ? <Status tone="error">{errorMessage(fishers.error)}</Status> : null}
    {invalidDates ? <Status tone="warning">The From date must be on or before the To date.</Status> : landings.isPending ? <Loading /> : landings.isError ? <Status tone="error">{errorMessage(landings.error)}</Status> : !rowCount ? <Empty>No landings match these choices.</Empty> : <><Card className="split">
      <div><h2>Ready to save</h2><p className="muted">{rowCount.toLocaleString('en-NZ')} {rowCount === 1 ? 'row' : 'rows'} from {selectedLandings.length.toLocaleString('en-NZ')} {selectedLandings.length === 1 ? 'landing' : 'landings'}.</p></div>
      <Button onClick={() => void download()} disabled={saving}>{saving ? 'Preparing Excel…' : 'Save as Excel'}</Button>
    </Card><LandingAnalysis landings={selectedLandings} fromDate={fromDate} toDate={toDate} grouping={grouping} onGroupingChange={setGrouping} stockUnit={stockUnit} onStockUnitChange={setStockUnit} timeUnit={timeUnit} onTimeUnitChange={setTimeUnit} vesselUnit={vesselUnit} onVesselUnitChange={setVesselUnit} /></>}
  </div>;
}
