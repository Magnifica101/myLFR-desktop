import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Empty, Loading, PageHeader, Status } from '../components/ui';
import { PageHelp } from '../components/PageHelp';
import { ReportResults } from '../components/ReportResults';
import { desktop } from '../lib/desktop';
import { errorMessage } from '../lib/format';
import { fileNamePart } from '../lib/exports';

function monthRange(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return null;
  const end = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { fromDate: `${year}-${String(monthNumber).padStart(2, '0')}-01`, toDate: `${year}-${String(monthNumber).padStart(2, '0')}-${end}` };
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat('en-NZ', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function previousMonth(date = new Date()) {
  const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return { month: String(previous.getMonth() + 1).padStart(2, '0'), year: String(previous.getFullYear()) };
}

export function availableSummaryYears(recordYears: number[], selectedYear: string, thisYear = new Date().getFullYear()) {
  return [...new Set([thisYear, Number(selectedYear), ...recordYears])]
    .filter(Number.isInteger)
    .sort((left, right) => right - left)
    .map(String);
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, '0'),
  label: new Intl.DateTimeFormat('en-NZ', { month: 'long' }).format(new Date(2000, index, 1)),
}));

export default function Summaries() {
  const [initialMonth] = useState(previousMonth);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth.month);
  const [selectedYear, setSelectedYear] = useState(initialMonth.year);
  const [fisherId, setFisherId] = useState('');
  const month = `${selectedYear}-${selectedMonth}`;
  const range = useMemo(() => monthRange(month), [month]);
  const profile = useQuery({ queryKey: ['business-profile'], queryFn: desktop.getBusinessProfile });
  const fishers = useQuery({ queryKey: ['fishers', true], queryFn: () => desktop.listFishers(true) });
  const landingYears = useQuery({ queryKey: ['landing-years'], queryFn: desktop.listLandingYears });
  const yearOptions = useMemo(() => availableSummaryYears(landingYears.data ?? [], selectedYear), [landingYears.data, selectedYear]);
  const selectedFisher = fishers.data?.find((fisher) => fisher.id === fisherId);
  const report = useQuery({ queryKey: ['monthly-summary', month, fisherId], queryFn: () => desktop.landingReport({ ...range!, fisherId }), enabled: Boolean(range && fisherId) });
  // The landings behind the summary, for the line-by-line table on each vessel sheet.
  const landings = useQuery({ queryKey: ['monthly-summary-landings', month, fisherId], queryFn: () => desktop.listLandings({ ...range!, fisherId, limit: 2_000_000 }), enabled: Boolean(range && fisherId) });
  return <div className="page">
    <PageHeader title="Monthly summaries" description="Review monthly landing totals by permit holder." actions={<PageHelp page="summaries" />} />
    <Card><div className="form-grid summary-filters"><div className="field"><label htmlFor="summary-month">Month</label><select id="summary-month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>{MONTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div className="field"><label htmlFor="summary-year">Year</label><select id="summary-year" value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>{yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}</select></div><div className="field"><label htmlFor="summary-fisher">Permit holder</label><select id="summary-fisher" value={fisherId} onChange={(event) => setFisherId(event.target.value)}><option value="" disabled>Choose a permit holder</option>{fishers.data?.map((fisher) => <option key={fisher.id} value={fisher.id}>{fisher.name} — {fisher.permitNumber}{fisher.isArchived ? ' (archived)' : ''}</option>)}</select></div></div></Card>
    {!selectedFisher ? <Empty>Choose a permit holder to see their monthly summary.</Empty> : report.isPending || landings.isPending ? <Loading /> : report.isError || landings.isError ? <Status tone="error">{errorMessage(report.error ?? landings.error)}</Status> : <ReportResults report={report.data} profile={profile.data ?? null} details={{ title: 'LFR monthly summary', period: monthLabel(month), permitHolderName: selectedFisher.name, permitNumber: selectedFisher.permitNumber, groupByFishType: true, landings: landings.data }} filename={`myLFR-monthly-summary-${month}-${fileNamePart(selectedFisher.name)}-${fileNamePart(selectedFisher.permitNumber)}`} />}
  </div>;
}
