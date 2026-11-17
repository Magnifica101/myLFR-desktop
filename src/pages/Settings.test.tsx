import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ToastProvider';
import { resetDesktopTransportForTests, setDesktopTransportForTests } from '../lib/desktop';
import type { AppInfo, BackupStatus, BusinessProfile } from '../lib/types';
import Settings from './Settings';

const profile: BusinessProfile = {
  lfrName: 'Test LFR',
  clientNumber: 'C123',
  streetNumber: '',
  streetName: '',
  streetType: '',
  suburb: '',
  city: '',
  postcode: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const appInfo: AppInfo = { version: '0.1.0', databasePath: 'C:\\data\\mylfr.sqlite3', schemaVersion: 8, catalogueVersion: 1 };

function sameDriveBackup(backupDirectory: string): BackupStatus {
  return {
    backupDirectory,
    lastBackupAt: new Date().toISOString(),
    lastBackupPath: `${backupDirectory}\\myLFR-backup.mylfr-backup`,
    destinationAvailable: true,
    sameDeviceWarning: true,
    isStale: false,
  };
}

function renderSettings(backup: BackupStatus, savedProfile: BusinessProfile = profile) {
  setDesktopTransportForTests(async <T,>(command: string) => {
    if (command === 'get_business_profile') return savedProfile as T;
    if (command === 'get_fishing_year_start_month') return 9 as T;
    if (command === 'get_backup_status') return backup as T;
    if (command === 'get_app_info') return appInfo as T;
    if (command === 'get_business_logo') return null as T;
    if (command === 'get_notice_acknowledgement') return null as T;
    throw new Error(`Unexpected command: ${command}`);
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ToastProvider><Settings /></ToastProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings same-drive backup warning', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(resetDesktopTransportForTests);

  it('can be hidden for the chosen folder and returns for a different folder', async () => {
    const view = renderSettings(sameDriveBackup('C:\\Dropbox\\myLFR backups'));
    expect(await screen.findByText(/Your backups are on the same drive as myLFR/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide this warning' }));
    expect(screen.queryByText(/Your backups are on the same drive as myLFR/)).not.toBeInTheDocument();
    view.unmount();

    const reopened = renderSettings(sameDriveBackup('C:\\Dropbox\\myLFR backups'));
    expect(await screen.findByRole('heading', { name: 'Database backups' })).toBeInTheDocument();
    expect(screen.queryByText(/Your backups are on the same drive as myLFR/)).not.toBeInTheDocument();
    reopened.unmount();

    renderSettings(sameDriveBackup('C:\\Other backups'));
    expect(await screen.findByText(/Your backups are on the same drive as myLFR/)).toBeInTheDocument();
  });
});

describe('Settings business details', () => {
  afterEach(resetDesktopTransportForTests);

  function addressValue() {
    return screen.getByText('Address', { selector: 'dt' }).nextElementSibling as HTMLElement;
  }

  it('shows the saved address as street, suburb, then city and postcode', async () => {
    renderSettings(sameDriveBackup('C:\\Backups'), {
      ...profile,
      streetNumber: '12',
      streetName: 'Wharf',
      streetType: 'Road',
      suburb: 'Port Chalmers',
      city: 'Dunedin',
      postcode: '9023',
    });
    expect(await screen.findByText('Address', { selector: 'dt' })).toBeInTheDocument();
    const lines = [...addressValue().querySelectorAll('.address-lines > span')].map((line) => line.textContent);
    expect(lines).toEqual(['12 Wharf Road', 'Port Chalmers', 'Dunedin 9023']);
    expect(screen.queryByText('Street number', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('leaves out empty parts of the address', async () => {
    renderSettings(sameDriveBackup('C:\\Backups'), { ...profile, streetName: 'Wharf', city: 'Dunedin' });
    expect(await screen.findByText('Address', { selector: 'dt' })).toBeInTheDocument();
    const lines = [...addressValue().querySelectorAll('.address-lines > span')].map((line) => line.textContent);
    expect(lines).toEqual(['Wharf', 'Dunedin']);
  });

  it('says the address is not provided when every part is empty', async () => {
    renderSettings(sameDriveBackup('C:\\Backups'));
    expect(await screen.findByText('Address', { selector: 'dt' })).toBeInTheDocument();
    expect(addressValue()).toHaveTextContent('Not provided');
  });
});

describe('Settings about section', () => {
  afterEach(resetDesktopTransportForTests);

  it('starts collapsed and opens to show the notice', async () => {
    renderSettings(sameDriveBackup('C:\\Backups'));
    const summary = await screen.findByText('About myLFR Desktop');
    const section = summary.closest('details') as HTMLDetailsElement;
    expect(section.open).toBe(false);
    await userEvent.click(summary);
    expect(section.open).toBe(true);
    expect(screen.getByText('You are responsible for your returns.')).toBeVisible();
  });
});
