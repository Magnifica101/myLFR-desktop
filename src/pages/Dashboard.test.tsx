import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderWithoutRouter, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ToastProvider';
import { resetDesktopTransportForTests, setDesktopTransportForTests } from '../lib/desktop';
import { currentFishingYearRange } from '../lib/fishingYear';
import { formatDateTime } from '../lib/format';
import type { BackupStatus, DashboardMetrics } from '../lib/types';
import Dashboard from './Dashboard';

// Pages render a Help button that navigates, so they need a router.
const render = (ui: Parameters<typeof renderWithoutRouter>[0], options?: Parameters<typeof renderWithoutRouter>[1]) => renderWithoutRouter(ui, { wrapper: MemoryRouter, ...options });

/**
 * Relative to now, not a fixed date. `backupHealth` compares the last backup
 * against `Date.now()` and calls anything a week old seriously overdue, so a
 * hard-coded timestamp passes until real time drifts past the threshold and
 * then fails for good. This test asserts the healthy state, so the fixture has
 * to stay healthy.
 */
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

const backup: BackupStatus = {
  backupDirectory: 'C:\\Backups',
  lastBackupAt: TWO_DAYS_AGO,
  lastBackupPath: 'C:\\Backups\\myLFR-backup.mylfr-backup',
  destinationAvailable: true,
  sameDeviceWarning: false,
  isStale: false,
};

const metrics: DashboardMetrics = {
  activeFishers: 2,
  activeVessels: 3,
  landingCount: 4,
  fishstockCount: 5,
  unitTotals: [{ reportingUnit: 'greenweightKg', quantity: 12345 }],
};

describe('Dashboard information layout', () => {
  afterEach(resetDesktopTransportForTests);

  it('puts the fishing year above KPIs and keeps Data recovery compact', async () => {
    setDesktopTransportForTests(async <T,>(command: string) => {
      if (command === 'get_fishing_year_start_month') return 9 as T;
      if (command === 'dashboard_metrics') return metrics as T;
      if (command === 'get_backup_status') return backup as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><Dashboard /></ToastProvider>
      </QueryClientProvider>,
    );

    const fishingYear = await screen.findByRole('heading', { name: currentFishingYearRange(9).label });
    expect(fishingYear.closest('.metric-period-row')?.nextElementSibling).toBe(
      container.querySelector('.metrics'),
    );
    expect(
      screen
        .queryAllByText(/1 October – 30 September/)
        .filter((node) => node.tagName !== 'OPTION'),
    ).toHaveLength(0);
    expect(screen.getByText('Landings')).toBeVisible();
    expect(screen.getByText('Fishstocks')).toBeVisible();
    expect(screen.getByText('Greenweight')).toBeVisible();
    expect(screen.queryByText('Meatweight')).not.toBeInTheDocument();
    expect(screen.queryByText('OYU count')).not.toBeInTheDocument();
    expect(screen.getByText('123')).toBeVisible();
    expect(screen.queryByText('123 kg')).not.toBeInTheDocument();
    expect(screen.queryByText('123.45 kg')).not.toBeInTheDocument();
    expect(screen.queryByText(/Change this in Business settings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Backups are current/i)).not.toBeInTheDocument();

    const recovery = screen.getByRole('heading', { name: 'Data recovery' }).closest('section');
    expect(recovery).not.toBeNull();
    expect(within(recovery!).getByLabelText('Up to date')).toBeVisible();
    expect(within(recovery!).getByText(/Last successful backup:/)).toBeVisible();
    expect(within(recovery!).getByText(/^(?:Just now|\d+ (?:minute|hour|day)s? ago)$/)).toBeVisible();
    expect(within(recovery!).getByText(formatDateTime(backup.lastBackupAt))).toBeVisible();
    expect(within(recovery!).getByRole('button', { name: 'Back up now' })).toHaveClass('button-secondary');

    await userEvent.setup().click(within(recovery!).getByRole('button', { name: 'How myLFR stores your records' }));
    expect(screen.getByRole('dialog', { name: 'How myLFR stores your records' })).toBeVisible();
    expect(screen.getByText(/automatically creates a backup after the first change/i)).toBeVisible();
    expect(screen.getByText(/newest backup from each of the most recent 12 months/i)).toBeVisible();
    expect(screen.getByText(/replaces your current records and settings/i)).toBeVisible();
    expect(screen.getByText(/moving to a replacement computer/i)).toBeVisible();
    expect(screen.getByText(/changes made after that backup was created will be lost/i)).toBeVisible();
  });

  it('switches the fishing year from Home and saves the preference', async () => {
    let startMonth = 9;
    const requests: Array<Record<string, unknown> | undefined> = [];
    setDesktopTransportForTests(async <T,>(command: string, payload?: Record<string, unknown>) => {
      if (command === 'get_fishing_year_start_month') return startMonth as T;
      if (command === 'set_fishing_year_start_month') {
        startMonth = payload?.startMonth as number;
        return startMonth as T;
      }
      if (command === 'dashboard_metrics') {
        requests.push(payload);
        return metrics as T;
      }
      if (command === 'get_backup_status') return backup as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><Dashboard /></ToastProvider>
      </QueryClientProvider>,
    );

    const select = await screen.findByLabelText('Fishing year');
    expect(select).toHaveValue('9');
    // Each option explains which stocks the year covers, not just its dates.
    expect(
      screen.getByRole('option', { name: '1 February – 31 January — Lake Ellesmere eels' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '1 April – 31 March — Rock lobster, scallops, shellfish' }),
    ).toBeInTheDocument();

    await userEvent.setup().selectOptions(select, '3');

    expect(
      await screen.findByRole('heading', { name: currentFishingYearRange(3).label }),
    ).toBeVisible();
    expect(requests.at(-1)).toEqual({
      fromDate: currentFishingYearRange(3).from,
      toDate: currentFishingYearRange(3).to,
      fishingYearStartMonth: 3,
    });
  });

  it('offers to choose a backup folder on Home when none is set', async () => {
    let status: BackupStatus = { ...backup, backupDirectory: null, lastBackupAt: null, lastBackupPath: null, destinationAvailable: false };
    const calls: string[] = [];
    setDesktopTransportForTests(async <T,>(command: string) => {
      calls.push(command);
      if (command === 'get_fishing_year_start_month') return 9 as T;
      if (command === 'dashboard_metrics') return metrics as T;
      if (command === 'get_backup_status') return status as T;
      if (command === 'choose_backup_directory') {
        status = { ...backup, lastBackupAt: null, lastBackupPath: null };
        return status as T;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><Dashboard /></ToastProvider>
      </QueryClientProvider>,
    );

    const choose = await screen.findByRole('button', { name: 'Choose backup folder now' });
    expect(choose).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Back up now' })).not.toBeInTheDocument();

    await userEvent.setup().click(choose);
    expect(await screen.findByRole('button', { name: 'Back up now' })).toBeEnabled();
    expect(calls).toContain('choose_backup_directory');
    expect(calls).not.toContain('backup_now');
  });
});
