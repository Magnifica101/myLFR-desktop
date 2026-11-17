import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderWithoutRouter, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ToastProvider';
import { resetDesktopTransportForTests, setDesktopTransportForTests } from '../lib/desktop';
import type { Fisher, ReportResult } from '../lib/types';
import Summaries from './Summaries';

// Pages render a Help button that navigates, so they need a router.
const render = (ui: Parameters<typeof renderWithoutRouter>[0], options?: Parameters<typeof renderWithoutRouter>[1]) => renderWithoutRouter(ui, { wrapper: MemoryRouter, ...options });

const fisher: Fisher = {
  id: 'f1', name: 'Smith & Sons', permitNumber: 'PERMIT 1', isArchived: false, archivedAt: null,
  createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z', vessels: [],
};

const report: ReportResult = {
  rows: [],
  fishTypeRows: [{ fishType: 'SNA', description: 'Snapper', fishstocks: ['SNA1'], reportingUnit: 'greenweightKg', quantity: 1000, landingCount: 1 }],
  vesselRows: [],
  vesselFishTypeRows: [],
  landingCount: 1,
  itemCount: 1,
  unitTotals: [{ reportingUnit: 'greenweightKg', quantity: 1000 }],
};

describe('Monthly summaries page', () => {
  afterEach(resetDesktopTransportForTests);

  it('shows a summary only for one chosen permit holder, and names the file after them', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      commands.push({ command, args });
      if (command === 'get_business_profile') return null as T;
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landing_years') return [] as T;
      if (command === 'landing_report') return report as T;
      if (command === 'list_landings') return [] as T;
      if (command === 'get_business_logo') return null as T;
      if (command === 'save_export_file') return true as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><Summaries /></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Choose a permit holder to see their monthly summary.')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'All permit holders' })).not.toBeInTheDocument();
    expect(commands.some(({ command }) => command === 'landing_report')).toBe(false);

    await user.selectOptions(await screen.findByLabelText('Permit holder'), 'f1');
    expect(await screen.findByText('Monthly totals')).toBeInTheDocument();
    expect(commands.find(({ command }) => command === 'landing_report')?.args?.filters).toMatchObject({ fisherId: 'f1' });

    await user.click(screen.getByRole('button', { name: 'Excel' }));
    await vi.waitFor(() => expect(commands.find(({ command }) => command === 'save_export_file')?.args?.defaultName)
      .toMatch(/^myLFR-monthly-summary-\d{4}-\d{2}-Smith-&-Sons-PERMIT-1\.xlsx$/));
    expect(await screen.findByText('Excel file saved.')).toBeInTheDocument();
  });
});
