import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './ToastProvider';
import { AppUpdatesProvider, useAppUpdates } from './AppUpdates';
import { Layout } from './Layout';
import {
  resetDesktopTransportForTests,
  setDesktopTransportForTests,
  type UpdateProgress,
  type UpdateStatus,
} from '../lib/desktop';
import type { BackupStatus } from '../lib/types';

const manualDue: UpdateStatus = { mode: 'manual', reminderDue: true, reminderPending: true, automaticCheckDue: false, lastSuccessfulCheck: null };
const automaticDue: UpdateStatus = { mode: 'automatic', reminderDue: false, reminderPending: false, automaticCheckDue: true, lastSuccessfulCheck: null };
const backupReady: BackupStatus = { backupDirectory: 'D:\\Backups', lastBackupAt: null, lastBackupPath: null, destinationAvailable: true, sameDeviceWarning: false, isStale: false };
const noBackup: BackupStatus = { ...backupReady, backupDirectory: null, destinationAvailable: false };

type Calls = Array<{ command: string; args?: Record<string, unknown> }>;

function renderApp(handle: (command: string, args?: Record<string, unknown>) => unknown) {
  const calls: Calls = [];
  setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    const result = handle(command, args);
    if (result instanceof Error || (result && typeof result === 'object' && 'code' in result)) throw result;
    if (result === undefined) throw new Error(`Unexpected command: ${command}`);
    return result as T;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <Routes>
            <Route element={<AppUpdatesProvider><Layout /></AppUpdatesProvider>}>
              <Route path="*" element={<div>Page content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return calls;
}

describe('application updates', () => {
  afterEach(resetDesktopTransportForTests);

  it('shows a due monthly reminder only as the sidebar update button, not a bar across the page', async () => {
    renderApp((command) => {
      if (command === 'get_update_status') return manualDue;
      return undefined;
    });

    expect(await screen.findByRole('button', { name: 'Check for a myLFR Desktop update' })).toBeVisible();
    expect(screen.queryByText("It's time to check for a myLFR Desktop update.")).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('shows a found update only as the sidebar update button, not a bar across the page', async () => {
    renderApp((command) => {
      if (command === 'get_update_status') return automaticDue;
      if (command === 'check_app_update') return { status: 'available', version: '0.9.0', notes: null };
      return undefined;
    });

    expect(await screen.findByRole('button', { name: 'Install myLFR Desktop 0.9.0' })).toBeVisible();
    expect(screen.queryByText('myLFR Desktop 0.9.0 is available.')).not.toBeInTheDocument();
  });

  it('checks by itself in automatic mode, then confirms the install with notes, a backup, and progress', async () => {
    const calls = renderApp((command) => {
      if (command === 'get_update_status') return automaticDue;
      if (command === 'check_app_update') return { status: 'available', version: '0.9.0', notes: 'Adds receiver-maintained fishstocks.' };
      if (command === 'get_backup_status') return backupReady;
      if (command === 'install_app_update') return new Promise(() => {});
      return undefined;
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Install myLFR Desktop 0.9.0' }));
    expect(await screen.findByText('Adds receiver-maintained fishstocks.')).toBeVisible();
    const backupFirst = await screen.findByRole('checkbox', { name: /Back up my records before installing/ });
    expect(backupFirst).toBeChecked();

    expect(calls.find((call) => call.command === 'check_app_update')?.args).toEqual({ manual: false });
    await user.click(screen.getByRole('button', { name: 'Install' }));
    const install = calls.find((call) => call.command === 'install_app_update');
    expect(install?.args).toMatchObject({ version: '0.9.0', backupFirst: true });
    const channel = install?.args?.onProgress as { onmessage: (progress: UpdateProgress) => void };
    act(() => channel.onmessage({ stage: 'downloading', downloaded: 524_288, total: 1_048_576 }));
    expect(screen.getByText('Downloading… 50% (0.5 MB of 1.0 MB)')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Installing…' })).toBeDisabled();
  });

  it('always runs a check the receiver asks for, even within 24 hours of the last one', async () => {
    const calls: Calls = [];
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === 'get_update_status') return { ...manualDue, reminderDue: false, reminderPending: false, lastSuccessfulCheck: '2026-11-17T06:36:43Z' } as T;
      if (command === 'check_app_update') return { status: 'current', version: null, notes: null } as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    function CheckNow() {
      const updates = useAppUpdates();
      return <button type="button" onClick={() => void updates?.checkNow('user')}>Check now</button>;
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter><AppUpdatesProvider><CheckNow /></AppUpdatesProvider></MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('myLFR Desktop is up to date.')).toBeVisible();
    expect(calls.filter((call) => call.command === 'check_app_update').map((call) => call.args)).toEqual([{ manual: true }]);
  });

  it('installs without a backup when no backup folder is available, and says so', async () => {
    const calls = renderApp((command) => {
      if (command === 'get_update_status') return automaticDue;
      if (command === 'check_app_update') return { status: 'available', version: '0.9.0', notes: null };
      if (command === 'get_backup_status') return noBackup;
      if (command === 'install_app_update') return new Promise(() => {});
      return undefined;
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Install myLFR Desktop 0.9.0' }));
    expect(await screen.findByText(/myLFR can't back up first/)).toBeVisible();
    expect(screen.getByText('No release notes were published with this version.')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(calls.find((call) => call.command === 'install_app_update')?.args).toMatchObject({ backupFirst: false });
  });

  it('shows no update button when nothing needs attention', async () => {
    renderApp((command) => {
      if (command === 'get_update_status') return { ...automaticDue, automaticCheckDue: false };
      return undefined;
    });

    expect(await screen.findByText('Page content')).toBeVisible();
    expect(screen.queryByRole('button', { name: /myLFR Desktop/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Local data • Offline ready')).not.toBeInTheDocument();
  });
});
