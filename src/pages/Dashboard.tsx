import { useMemo } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { BackupInfo } from '../components/BackupInfo';
import { Button, Card, Loading, PageHeader, Status } from '../components/ui';
import { PageHelp } from '../components/PageHelp';
import { useToast } from '../components/ToastProvider';
import { desktop } from '../lib/desktop';
import { errorMessage, formatDashboardQuantity, formatDateTime } from '../lib/format';
import { BACKUP_STATUS_LABELS, backupHealth } from '../lib/backup';
import {
  FISHING_YEAR_OPTIONS,
  currentFishingYearRange,
  type FishingYearStartMonth,
} from '../lib/fishingYear';

function daysUntil15th() {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), 15);
  if (now.getDate() > 15) target.setMonth(target.getMonth() + 1);
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86_400_000));
}

function backupAge(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Completed';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
}

export default function Dashboard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fishingYear = useQuery({ queryKey: ['fishing-year-start-month'], queryFn: desktop.getFishingYearStartMonth });
  const range = useMemo(() => currentFishingYearRange(fishingYear.data ?? 9), [fishingYear.data]);
  const metrics = useQuery({
    queryKey: ['dashboard', range, fishingYear.data],
    queryFn: () => desktop.dashboardMetrics(range.from, range.to, fishingYear.data ?? 9),
    enabled: fishingYear.isSuccess,
    placeholderData: keepPreviousData,
  });
  const backup = useQuery({ queryKey: ['backup-status'], queryFn: desktop.getBackupStatus });
  const changeFishingYear = useMutation({
    mutationFn: desktop.setFishingYearStartMonth,
    onSuccess: async (startMonth) => {
      queryClient.setQueryData(['fishing-year-start-month'], startMonth);
      await queryClient.invalidateQueries({ queryKey: ['fishing-year-start-month'] });
    },
    onError: (error) => toast.show(errorMessage(error), 'error'),
  });
  const runBackup = useMutation({
    mutationFn: desktop.backupNow,
    onSuccess: (path) => { toast.show(`Backup created: ${path}`, 'success'); void queryClient.invalidateQueries({ queryKey: ['backup-status'] }); },
    onError: (error) => toast.show(errorMessage(error), 'error'),
  });
  // With no backup folder there is nothing to back up to, so the action offers
  // to choose one rather than showing a disabled "Back up now".
  const chooseFolder = useMutation({
    mutationFn: desktop.chooseBackupDirectory,
    onSuccess: (selected) => {
      if (!selected) return;
      toast.show('Backup folder chosen. Choose **Back up now** to make your first backup.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['backup-status'] });
    },
    onError: (caught) => toast.show(errorMessage(caught), 'error'),
  });
  if (backup.isPending || fishingYear.isPending || (fishingYear.isSuccess && metrics.isPending)) return <Loading />;
  const recovery = backupHealth(backup.data);
  const recoveryLabel = BACKUP_STATUS_LABELS[recovery.reason];
  const metricCount = 4 + (metrics.data?.unitTotals.length ?? 0);
  return (
    <div className="page">
      <PageHeader title="Home" description="myLFR at a glance" actions={<PageHelp page="home" />} />
      {fishingYear.isError ? <Status tone="error">Unable to load the fishing year preference. {errorMessage(fishingYear.error)}</Status> : null}
      {metrics.isError ? <Status tone="error">{errorMessage(metrics.error)}</Status> : null}
      <div className="metric-period-row">
        <h2 className="metric-period">{range.label}</h2>
        <div className="metric-period-picker">
          <label htmlFor="home-fishing-year">Fishing year</label>
          <select
            id="home-fishing-year"
            value={fishingYear.data ?? 9}
            disabled={changeFishingYear.isPending}
            onChange={(event) =>
              changeFishingYear.mutate(Number(event.target.value) as FishingYearStartMonth)
            }
          >
            {FISHING_YEAR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.description}>
                {option.label} — {option.summary}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={`metrics metrics-count-${metricCount}`}>
        <div className="metric"><strong>{metrics.data?.activeFishers ?? 0}</strong><span>Permit holders</span></div>
        <div className="metric"><strong>{metrics.data?.activeVessels ?? 0}</strong><span>Vessels</span></div>
        <div className="metric"><strong>{metrics.data?.landingCount ?? 0}</strong><span>Landings</span></div>
        <div className="metric"><strong>{metrics.data?.fishstockCount ?? 0}</strong><span>Fishstocks</span></div>
        {metrics.data?.unitTotals.map((total) => <div className="metric" key={total.reportingUnit}><strong>{formatDashboardQuantity(total.quantity, total.reportingUnit)}</strong><span>{total.reportingUnit === 'count' ? 'OYU count' : total.reportingUnit === 'meatweightKg' ? 'Meatweight' : 'Greenweight'}</span></div>)}
      </div>
      <div className="form-grid">
        <Card><h2>Monthly return reminder</h2><p className="muted">Your Licensed Fish Receiver Return is due with FishServe in:</p><p style={{ fontSize: 42, margin: '12px 0', fontWeight: 800 }}>{daysUntil15th()} days</p></Card>
        <Card className="data-recovery-card">
          <div className="backup-heading">
            <h2>Data recovery</h2>
            <span className={`backup-status-icon backup-status-${recovery.level}`} role="img" aria-label={recoveryLabel} title={recoveryLabel}>
              {recovery.level === 'good' ? <CircleCheck aria-hidden="true" /> : recovery.level === 'warning' ? <TriangleAlert aria-hidden="true" /> : <CircleX aria-hidden="true" />}
            </span>
            <BackupInfo />
          </div>
          <p className="muted backup-prompt">Last successful backup: <time dateTime={backup.data?.lastBackupAt ?? undefined}>{formatDateTime(backup.data?.lastBackupAt ?? null)}</time></p>
          <div className="backup-value-row">
            <p className="backup-age">{backupAge(backup.data?.lastBackupAt ?? null)}</p>
            {backup.data?.backupDirectory
              ? <Button variant="secondary" onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>{runBackup.isPending ? 'Backing up…' : 'Back up now'}</Button>
              : <Button onClick={() => chooseFolder.mutate()} disabled={chooseFolder.isPending}>{chooseFolder.isPending ? 'Choosing…' : 'Choose backup folder now'}</Button>}
          </div>
        </Card>
      </div>
    </div>
  );
}
