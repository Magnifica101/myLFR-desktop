import { useState } from 'react';
import { Button, Card, Empty } from './ui';
import { useToast } from './ToastProvider';
import { errorMessage, formatQuantity, formatQuantityValue, reportingUnitShortLabel } from '../lib/format';
import {
  saveReportPdf,
  saveReportWorkbook,
  sortFishTypeRows,
  sortReportRows,
  type ReportDetails,
} from '../lib/exports';
import type { BusinessProfile, ReportResult } from '../lib/types';

export function ReportResults({
  report,
  profile,
  details,
  filename,
}: {
  report: ReportResult;
  profile: BusinessProfile | null;
  details: ReportDetails;
  filename: string;
}) {
  const toast = useToast();
  const [exporting, setExporting] = useState<'excel' | 'pdf' | ''>('');

  async function runExport(kind: 'excel' | 'pdf') {
    setExporting(kind);
    try {
      const saved = kind === 'excel'
        ? await saveReportWorkbook(report, profile, details, filename)
        : await saveReportPdf(report, profile, details, filename);
      // Nothing is said when the receiver cancels the save dialog.
      if (saved) toast.show(kind === 'excel' ? 'Excel file saved.' : 'PDF saved.', 'success');
    } catch (caught) {
      toast.show(errorMessage(caught), 'error');
    } finally {
      setExporting('');
    }
  }

  const isFishTypeSummary = Boolean(details.groupByFishType);
  if (!(isFishTypeSummary ? report.fishTypeRows : report.rows).length) return <Empty>No landing data matches these filters.</Empty>;
  return <Card className="report-card">
    <div className="split"><div><h2>{isFishTypeSummary ? 'Monthly totals' : 'Fishstock totals'}</h2><p className="muted">{report.landingCount} landings • {report.itemCount} items</p><p className="muted">{report.unitTotals.map((total) => `${formatQuantityValue(total.quantity, total.reportingUnit)} ${reportingUnitShortLabel(total.reportingUnit)}`).join(' • ')}</p></div><div className="inline"><Button variant="secondary" disabled={Boolean(exporting)} onClick={() => void runExport('excel')}>{exporting === 'excel' ? 'Preparing Excel…' : 'Excel'}</Button><Button variant="secondary" disabled={Boolean(exporting)} onClick={() => void runExport('pdf')}>{exporting === 'pdf' ? 'Preparing PDF…' : 'PDF'}</Button></div></div>
    <div className="table-wrap">{isFishTypeSummary ? <table><thead><tr><th>Fish type</th><th>Description</th><th>Fishstocks</th><th className="numeric">Landings</th><th className="numeric">Total</th><th>Unit</th></tr></thead><tbody>{sortFishTypeRows(report.fishTypeRows).map((row) => <tr key={`${row.fishType}-${row.reportingUnit}`}><td><strong>{row.fishType}</strong></td><td>{row.description}</td><td>{row.fishstocks.join(', ')}</td><td className="numeric">{row.landingCount}</td><td className="numeric">{formatQuantityValue(row.quantity, row.reportingUnit)}</td><td>{reportingUnitShortLabel(row.reportingUnit)}</td></tr>)}</tbody></table> : <table><thead><tr><th>Fishstock</th><th>Description</th><th className="numeric">Landings</th><th className="numeric">Total</th><th>Unit</th></tr></thead><tbody>{sortReportRows(report.rows).map((row) => <tr key={`${row.fishstockCode}-${row.reportingUnit}`}><td><strong>{row.fishstockCode}</strong></td><td>{row.description}</td><td className="numeric">{row.landingCount}</td><td className="numeric">{formatQuantityValue(row.quantity, row.reportingUnit)}</td><td>{reportingUnitShortLabel(row.reportingUnit)}</td></tr>)}</tbody></table>}</div>
  </Card>;
}
