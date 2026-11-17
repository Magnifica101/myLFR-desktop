import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ToastProvider';
import {
  resetDesktopTransportForTests,
  setDesktopTransportForTests,
  type DesktopTransport,
} from '../lib/desktop';
import Setup from './Setup';

describe('Setup', () => {
  afterEach(() => {
    resetDesktopTransportForTests();
    vi.restoreAllMocks();
  });

  it('explains local storage and collects required business identity', () => {
    render(<QueryClientProvider client={new QueryClient()}><ToastProvider><Setup /></ToastProvider></QueryClientProvider>);
    expect(screen.getByRole('heading', { name: 'Set up myLFR Desktop' })).toBeInTheDocument();
    expect(screen.getByLabelText('LFR name')).toBeRequired();
    expect(screen.getByLabelText('Fishserve Client Number')).toBeRequired();
    expect(screen.getByLabelText('Fishserve Client Number')).toHaveAccessibleDescription('The client number FishServe gave your business.');
    expect(screen.getByLabelText('Street type')).toHaveAttribute('placeholder', 'e.g. Road, Street, Avenue');
    expect(screen.getByText(/stored only on this computer/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Keep your records safe' })).toBeInTheDocument();
    expect(screen.getByText(/You can do this later in Settings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore from backup' })).toBeInTheDocument();
  });

  it('validates and restores a backup without creating a temporary profile', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const transportCall = vi.fn();
    const transport: DesktopTransport = async <T,>(command: string, args?: Record<string, unknown>) => {
      transportCall(command, args);
      if (command === 'select_backup_for_restore') {
        return { token: 'single-use-token', schemaVersion: 1, catalogueVersion: 20260801 } as T;
      }
      if (command === 'restore_backup') return undefined as T;
      throw new Error(`Unexpected command: ${command}`);
    };
    setDesktopTransportForTests(transport);
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient()}><ToastProvider><Setup /></ToastProvider></QueryClientProvider>);

    await user.click(screen.getByRole('button', { name: 'Restore from backup' }));

    await waitFor(() => expect(transportCall).toHaveBeenCalledWith('restore_backup', {
      token: 'single-use-token',
    }));
    expect(transportCall).not.toHaveBeenCalledWith('save_business_profile', expect.anything());
  });
});
