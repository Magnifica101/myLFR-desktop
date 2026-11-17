import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderWithoutRouter, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ToastProvider';
import { resetDesktopTransportForTests, setDesktopTransportForTests } from '../lib/desktop';
import type { Fisher, Landing } from '../lib/types';
import DataExport from './DataExport';

// Pages render a Help button that navigates, so they need a router.
const render = (ui: Parameters<typeof renderWithoutRouter>[0], options?: Parameters<typeof renderWithoutRouter>[1]) => renderWithoutRouter(ui, { wrapper: MemoryRouter, ...options });

const fisher: Fisher = {
  id: 'f1', name: 'Synthetic Fisher', permitNumber: 'PERMIT-1', isArchived: false, archivedAt: null,
  createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
  vessels: [{ id: 'v1', fisherId: 'f1', name: 'Southern Star', vesselNumber: 'MNZ1234', isArchived: false, hasLandingHistory: true, createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z' }],
};

const landing: Landing = {
  id: 'l1', fisherId: 'f1', fisherName: fisher.name, fisherNumber: fisher.permitNumber, vesselId: 'v1', vesselName: 'Southern Star',
  vesselNumber: 'MNZ1234', landingDate: '2026-08-10', invoiceNumber: 'INV-1', createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z',
  items: [
    { id: 'i1', displayOrder: 1, fishstockCode: 'SNA1', description: 'Snapper', reportingUnit: 'greenweightKg', quantity: 1000 },
    { id: 'i2', displayOrder: 2, fishstockCode: 'HOK1', description: 'Hoki', reportingUnit: 'greenweightKg', quantity: 500 },
  ],
};

function renderPage(landings: Landing[], calls: Array<Record<string, unknown> | undefined> = [], saved: string[] = [], workbooks: string[] = []) {
  setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
    if (command === 'list_fishers') return [fisher] as T;
    if (command === 'save_export_file') { saved.push(String(args?.defaultName)); workbooks.push(String(args?.dataBase64)); return true as T; }
    if (command === 'list_landings') { calls.push(args); return landings as T; }
    throw new Error(`Unexpected command: ${command}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><DataExport /></ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Export data', () => {
  afterEach(resetDesktopTransportForTests);

  it('counts a row for each fishstock on each landing and includes everything to begin with', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    renderPage([landing], calls);

    expect(await screen.findByText('2 rows from 1 landing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as Excel' })).toBeEnabled();
    expect(calls[0]).toEqual({ filters: { fromDate: null, toDate: null, fisherId: null, vesselId: null, limit: 2_000_000 } });
    expect(screen.getByRole('region', { name: 'Greenweight (kg)' })).toHaveTextContent('Greenweight (kg)15');
    expect(screen.getByRole('region', { name: 'Count' })).toHaveTextContent('Count0');
    expect(screen.getByRole('region', { name: 'Selected landings at a glance' }).querySelectorAll('.metric')).toHaveLength(6);
  });

  it('narrows the export by the chosen dates, permit holder and vessel', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const saved: string[] = [];
    const user = userEvent.setup();
    renderPage([landing], calls, saved);

    await screen.findByText('2 rows from 1 landing.');
    expect(screen.getByLabelText('Vessel')).toBeEnabled();
    await user.type(screen.getByLabelText('From'), '2026-08-01');
    await user.selectOptions(screen.getByLabelText('Permit holder'), 'f1');
    await user.selectOptions(screen.getByLabelText('Vessel'), 'v1');

    await screen.findByText('2 rows from 1 landing.');
    expect(calls.at(-1)).toEqual({ filters: { fromDate: '2026-08-01', toDate: null, fisherId: 'f1', vesselId: 'v1', limit: 2_000_000 } });
    await user.click(screen.getByRole('button', { name: 'Save as Excel' }));
    await vi.waitFor(() => expect(saved).toEqual(['myLFR-landing-data-Synthetic-Fisher-2026-08-01-to-2026-08-10.xlsx']));
  });

  it('says so, and offers no download, when nothing matches', async () => {
    renderPage([]);

    expect(await screen.findByText('No landings match these choices.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save as Excel' })).not.toBeInTheDocument();
  });

  it('keeps the KPIs, charts and exported rows on the same fishstock and quantity filters', async () => {
    const workbooks: string[] = [];
    const calls: Array<Record<string, unknown> | undefined> = [];
    const user = userEvent.setup();
    renderPage([
      { ...landing, items: [...landing.items,
        { id: 'i3', displayOrder: 3, fishstockCode: 'OYU5', description: 'Oyster', reportingUnit: 'count', quantity: 4 },
        { id: 'i4', displayOrder: 4, fishstockCode: 'SCA1', description: 'Scallop', reportingUnit: 'meatweightKg', quantity: 200 },
      ] },
      { ...landing, id: 'l2', fisherId: 'f2', landingDate: '2026-07-02', items: [{ ...landing.items[0], quantity: 250 }] },
      { ...landing, id: 'l3', landingDate: '2026-08-11', vesselId: null, vesselName: null, vesselNumber: null, items: [
        { ...landing.items[1], quantity: 100 },
        { id: 'i5', displayOrder: 2, fishstockCode: 'OYU5', description: 'Oyster', reportingUnit: 'count', quantity: 3 },
      ] },
    ], calls, [], workbooks);

    await screen.findByText('7 rows from 3 landings.');
    const analysis = screen.getByRole('region', { name: 'Selected landings at a glance' });
    expect(within(analysis).getByText('Permit holders').parentElement).toHaveTextContent('Permit holders2');
    expect(within(analysis).getByText('Vessels').parentElement).toHaveTextContent('Vessels11 shore-based landing');
    expect(within(analysis).getByRole('region', { name: 'Greenweight (kg)' })).toHaveTextContent('Greenweight (kg)19');
    expect(within(analysis).getByRole('region', { name: 'Meatweight (kg)' })).toHaveTextContent('Meatweight (kg)2');
    expect(within(analysis).getByRole('region', { name: 'Count' })).toHaveTextContent('Count7');
    const stockSection = screen.getByRole('region', { name: 'Quantity by fishstock and fish type' });
    const stocks = within(stockSection).getByRole('region', { name: 'Quantity by fishstock' });
    const fishTypes = within(stockSection).getByRole('region', { name: 'Quantity by fish type' });
    expect(within(within(fishTypes).getByRole('table')).getByText('SNA').closest('tr')).toHaveTextContent(/^SNASnapper/);
    expect(within(within(stocks).getByRole('table')).getByText('SNA1').closest('tr')).toHaveTextContent('SNA1Snapper13');
    expect(within(stocks).queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('7 rows from 3 landings.')).toBeInTheDocument();

    const time = screen.getByRole('region', { name: 'Received over time' });
    const shares = screen.getByRole('region', { name: 'Quantity by permit holder and vessel' });
    const vessels = within(shares).getByRole('region', { name: 'Quantity by vessel' });
    const holders = within(shares).getByRole('region', { name: 'Quantity by permit holder' });
    const row = (region: HTMLElement, name: string) => within(within(region).getByRole('table')).getByText(name).closest('tr')!;
    const initialCalls = calls.length;
    expect(within(time).getAllByRole('group', { name: /^Received over time,/ })).toHaveLength(1);
    expect(row(vessels, 'Southern Star')).toHaveTextContent('Southern StarMNZ12341894.6%');
    expect(row(vessels, 'Shore-based')).toHaveTextContent('Shore-basedNo vessel number15.4%');
    expect(within(vessels).getByRole('img', { name: 'Quantity by vessel, Greenweight (kg): Southern Star 94.6%, Shore-based 5.4%' })).toBeInTheDocument();
    expect(within(holders).getAllByRole('row')).toHaveLength(3);
    await user.click(within(time).getByRole('button', { name: 'Count' }));
    expect(within(time).getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(within(time).getAllByRole('group', { name: /^Received over time,/ })).toHaveLength(1);
    expect(within(time).getByRole('group', { name: /^Received over time, Count/ })).toBeInTheDocument();
    await user.tab();
    await user.keyboard('{End}');
    expect(within(time).getByText('7 Count', { selector: 'strong' })).toBeInTheDocument();
    // Unit choices are independent for each chart and do not alter the export.
    expect(within(shares).getByRole('button', { name: 'Greenweight (kg)' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(shares).getByRole('button', { name: 'Count' }));
    expect(row(vessels, 'Southern Star')).toHaveTextContent('Southern StarMNZ1234457.1%');
    expect(row(vessels, 'Shore-based')).toHaveTextContent('Shore-basedNo vessel number342.9%');
    await user.click(within(time).getByRole('button', { name: 'Meatweight (kg)' }));
    await user.click(within(shares).getByRole('button', { name: 'Meatweight (kg)' }));
    expect(within(time).getByRole('group', { name: /^Received over time, Meatweight/ })).toBeInTheDocument();
    expect(within(within(vessels).getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(row(vessels, 'Southern Star')).toHaveTextContent('Southern StarMNZ12342100%');
    expect(screen.getByText('7 rows from 3 landings.')).toBeInTheDocument();
    expect(calls).toHaveLength(initialCalls);

    await user.click(screen.getByText('All fishstocks', { selector: 'span' }));
    await user.type(screen.getByLabelText('Search fishstocks'), 'snap');
    await user.click(screen.getByRole('checkbox', { name: 'SNA1 — Snapper' }));
    await user.clear(screen.getByLabelText('Search fishstocks'));
    await user.click(screen.getByRole('checkbox', { name: 'OYU5 — Oyster' }));
    await screen.findByText('4 rows from 3 landings.');
    await user.selectOptions(screen.getByLabelText('Quantity type'), 'count');
    await screen.findByText('2 rows from 2 landings.');
    expect(within(time).getByRole('button', { name: 'Count' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(time).getByRole('button', { name: 'Greenweight (kg)' })).toBeDisabled();
    expect(within(shares).getByRole('button', { name: 'Count' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(analysis).getByRole('region', { name: 'Greenweight (kg)' })).toHaveTextContent('Greenweight (kg)0');
    expect(within(within(stocks).getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(within(stockSection).getByRole('button', { name: 'Count' })).toHaveAttribute('aria-pressed', 'true');
    await user.selectOptions(screen.getByLabelText('Group by'), 'week');
    expect(screen.getByText('2 rows from 2 landings.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save as Excel' }));
    await screen.findByText('Excel file saved.');
    expect(workbooks).toHaveLength(1);
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(workbooks[0], 'base64') as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Landing data')!;
    expect(sheet.rowCount).toBe(3);
    expect([sheet.getCell('I2').value, sheet.getCell('L2').value, sheet.getCell('M2').value]).toEqual(['OYU5', 'Count', 4]);
    expect([sheet.getCell('I3').value, sheet.getCell('L3').value, sheet.getCell('M3').value]).toEqual(['OYU5', 'Count', 3]);

    await user.selectOptions(screen.getByLabelText('Vessel'), 'shore-based');
    await screen.findByText('1 row from 1 landing.');
    expect(screen.getByLabelText('Vessel')).toHaveValue('shore-based');
    expect(screen.getByLabelText('Group by')).toHaveValue('week');
    expect(within(screen.getByRole('region', { name: 'Selected landings at a glance' })).getByText('Vessels').parentElement).toHaveTextContent('Vessels01 shore-based landing');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findByText('7 rows from 3 landings.');
    expect(screen.getByLabelText('Vessel')).toHaveValue('');
    expect(screen.getByLabelText('Quantity type')).toHaveValue('all');
  }, 20_000); // The longest test here; a busy machine can push it past the 5-second default.

  it('filters by vessel without choosing a permit holder and blocks reversed dates', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const user = userEvent.setup();
    renderPage([landing], calls);
    await screen.findByText('2 rows from 1 landing.');
    await user.selectOptions(screen.getByLabelText('Vessel'), 'v1');
    await vi.waitFor(() => expect(calls.at(-1)).toEqual({ filters: { fromDate: null, toDate: null, fisherId: null, vesselId: 'v1', limit: 2_000_000 } }));
    await user.type(screen.getByLabelText('From'), '2026-09-01');
    await user.type(screen.getByLabelText('To'), '2026-08-01');
    expect(await screen.findByText('The From date must be on or before the To date.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save as Excel' })).not.toBeInTheDocument();
  });

  it('names the file after the dates, using the first and last landing when none are chosen', async () => {
    const saved: string[] = [];
    const user = userEvent.setup();
    renderPage([landing, { ...landing, id: 'l2', landingDate: '2026-07-02' }], [], saved);

    await screen.findByText('4 rows from 2 landings.');
    await user.click(screen.getByRole('button', { name: 'Save as Excel' }));
    await vi.waitFor(() => expect(saved).toEqual(['myLFR-landing-data-All-permit-holders-2026-07-02-to-2026-08-10.xlsx']));

    await user.type(screen.getByLabelText('From'), '2026-01-01');
    await user.type(screen.getByLabelText('To'), '2026-12-31');
    await screen.findByText('4 rows from 2 landings.');
    await user.click(screen.getByRole('button', { name: 'Save as Excel' }));
    await vi.waitFor(() => expect(saved.at(-1)).toBe('myLFR-landing-data-All-permit-holders-2026-01-01-to-2026-12-31.xlsx'));
  });
});
