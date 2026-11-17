import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderWithoutRouter, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ToastProvider';
import { resetDesktopTransportForTests, setDesktopTransportForTests } from '../lib/desktop';
import type { Fisher, Fishstock, Landing, LandingRevision } from '../lib/types';
import Landings from './Landings';

// Pages render a Help button that navigates, so they need a router.
const render = (ui: Parameters<typeof renderWithoutRouter>[0], options?: Parameters<typeof renderWithoutRouter>[1]) => renderWithoutRouter(ui, { wrapper: MemoryRouter, ...options });

// jsdom lacks the native dialog methods provided by WebView2.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

const fisher: Fisher = {
  id: 'fisher-1',
  name: 'Harbour Fishing Ltd',
  permitNumber: 'PERMIT-1',
  isArchived: false,
  archivedAt: null,
  createdAt: '2026-08-10T00:00:00Z',
  updatedAt: '2026-08-10T00:00:00Z',
  vessels: [],
};

const favorites: Fishstock[] = [
  { code: 'HOK1', description: 'Hoki', reportingUnit: 'greenweightKg',
 isActive: true, isFavorite: true, isUserAdded: false },
  { code: 'SNA1', description: 'Snapper', reportingUnit: 'greenweightKg',
 isActive: true, isFavorite: true, isUserAdded: false },
];

const recentLanding: Landing = {
  id: 'landing-1',
  fisherId: fisher.id,
  fisherName: fisher.name,
  fisherNumber: fisher.permitNumber,
  vesselId: null,
  vesselName: null,
  vesselNumber: null,
  landingDate: '2026-08-10',
  invoiceNumber: 'INV-1',
  createdAt: '2026-08-10T00:00:00Z',
  updatedAt: '2026-08-10T00:00:00Z',
  items: [],
};

describe('landing fishstock entry', () => {
  afterEach(resetDesktopTransportForTests);

  it('toggles favourites on a second click and puts the latest selection first', async () => {
    setDesktopTransportForTests(async <T,>(command: string) => {
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landings' || command === 'list_deleted_landings') return [] as T;
      if (command === 'list_favorite_fishstocks') return favorites as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Landings /></ToastProvider>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Record a landing' }));
    await user.click(screen.getByRole('button', { name: 'Add from favourites' }));
    await screen.findByRole('heading', { name: 'Favourite fishstocks' });

    await user.click(screen.getByRole('button', { name: 'Add HOK1' }));
    expect(screen.getByRole('button', { name: 'Remove HOK1' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Remove HOK1' }));
    expect(screen.getByRole('button', { name: 'Add HOK1' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Add HOK1' }));
    await user.click(screen.getByRole('button', { name: 'Add SNA1' }));
    await user.click(screen.getByRole('button', { name: 'Close favourite fishstocks' }));

    const itemCodes = [...container.querySelectorAll('.item-row strong')].map((element) => element.textContent);
    expect(itemCodes).toEqual(['SNA1', 'HOK1']);
  });

  it('requests and labels the 10 most recent landings by default', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landings') {
        calls.push(args);
        return [recentLanding] as T;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Landings /></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Showing the 10 most recent landings.')).toBeInTheDocument();
    expect(calls).toContainEqual({
      filters: {
        fisherId: null,
        vesselId: null,
        fishstockCode: null,
        invoiceNumber: null,
        fromDate: null,
        toDate: null,
        limit: 10,
      },
    });
  });

  it('adds fishstocks from the previous landing for the selected permit holder and vessel', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landings') return [] as T;
      if (command === 'list_previous_landing_fishstocks') {
        calls.push(args);
        return favorites as T;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Landings /></ToastProvider>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Record a landing' }));
    await user.selectOptions(screen.getAllByRole('combobox')[0], fisher.id);
    await user.click(screen.getByRole('button', { name: 'Add from previous landing' }));

    expect(await screen.findByText('Added 2 fishstocks from the previous matching landing.')).toBeInTheDocument();
    expect(calls).toEqual([{ fisherId: fisher.id, vesselId: null, excludeLandingId: null }]);
    const itemCodes = [...container.querySelectorAll('.item-row strong')].map((element) => element.textContent);
    expect(itemCodes).toEqual(['HOK1', 'SNA1']);
  });

  it('floats the search results over the lines and clears the search with Escape', async () => {
    setDesktopTransportForTests(async <T,>(command: string) => {
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landings' || command === 'list_deleted_landings') return [] as T;
      if (command === 'search_fishstocks') return favorites as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Landings /></ToastProvider>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Record a landing' }));
    const search = screen.getByPlaceholderText('Search code or description');
    expect(container.querySelector('.search-results')).toBeNull();

    await user.type(search, 'ho');
    const results = await screen.findByRole('button', { name: /HOK1/ });
    // Floating, so the dialog's height does not change as the matches change.
    expect(results.closest('.search-results')).toHaveClass('search-results-floating');
    expect(results.closest('.search-anchor')).toContainElement(search);

    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(container.querySelector('.search-results')).toBeNull();
    expect(screen.getByRole('heading', { name: 'New landing' })).toBeInTheDocument();
  });

  it('puts a removed stock back with the weight already typed, until the landing is closed', async () => {
    setDesktopTransportForTests(async <T,>(command: string) => {
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landings' || command === 'list_deleted_landings') return [] as T;
      if (command === 'list_favorite_fishstocks' || command === 'search_fishstocks') return favorites as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Landings /></ToastProvider>
      </QueryClientProvider>,
    );
    const weight = () => screen.getByPlaceholderText('0.00');

    await user.click(await screen.findByRole('button', { name: 'Record a landing' }));
    await user.click(screen.getByRole('button', { name: 'Add from favourites' }));
    await screen.findByRole('heading', { name: 'Favourite fishstocks' });
    await user.click(screen.getByRole('button', { name: 'Add HOK1' }));
    await user.type(weight(), '12.50');

    // Unticking a favourite and ticking it again restores the weight.
    await user.click(screen.getByRole('button', { name: 'Remove HOK1' }));
    expect(screen.queryByPlaceholderText('0.00')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add HOK1' }));
    expect(weight()).toHaveValue('12.50');
    await user.click(screen.getByRole('button', { name: 'Close favourite fishstocks' }));

    // So does removing the line with the bin icon and adding it back by search.
    await user.click(container.querySelector('.item-row button') as HTMLElement);
    expect(screen.queryByPlaceholderText('0.00')).toBeNull();
    await user.type(screen.getByPlaceholderText('Search code or description'), 'ho');
    await user.click(await screen.findByRole('button', { name: /HOK1/ }));
    expect(weight()).toHaveValue('12.50');

    // A weight is remembered only while this landing is open.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Record a landing' }));
    await user.type(screen.getByPlaceholderText('Search code or description'), 'ho');
    await user.click(await screen.findByRole('button', { name: /HOK1/ }));
    expect(weight()).toHaveValue('');
  });

  it('searches by fishstock code and preserves filters and results when search is collapsed', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landings') {
        calls.push(args);
        return [recentLanding] as T;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Landings /></ToastProvider>
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('button', { name: 'Search landings' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Fishstock code')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide search' })).toHaveAttribute('aria-expanded', 'true');
    await user.type(screen.getByLabelText('Fishstock code'), 'sna 11');
    expect(screen.getByLabelText('Fishstock code')).toHaveValue('SNA11');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Showing 1 matching landing.')).toBeInTheDocument();
    expect(calls.at(-1)).toEqual({
      filters: { fisherId: null, vesselId: null, fishstockCode: 'SNA11', invoiceNumber: null, fromDate: null, toDate: null, limit: 500 },
    });

    const requestCount = calls.length;
    await user.click(screen.getByRole('button', { name: 'Hide search' }));
    expect(screen.queryByLabelText('Fishstock code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search landings' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Showing 1 matching landing.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search landings' }));
    expect(screen.getByLabelText('Fishstock code')).toHaveValue('SNA11');
    expect(calls).toHaveLength(requestCount);
  });

  it('searches landings by part of the invoice number, ignoring spaces around it', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landings') {
        calls.push(args);
        return [recentLanding] as T;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Landings /></ToastProvider>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Search landings' }));
    await user.type(screen.getByLabelText('Invoice number'), ' inv-1 ');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Showing 1 matching landing.')).toBeInTheDocument();
    expect(calls.at(-1)).toEqual({
      filters: { fisherId: null, vesselId: null, fishstockCode: null, invoiceNumber: 'inv-1', fromDate: null, toDate: null, limit: 500 },
    });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Invoice number')).toHaveValue('');
  });

  it('lists deleted landings in the same columns as current landings and opens their details', async () => {
    const deletedLanding: LandingRevision = {
      id: 'revision-9',
      landingId: 'landing-9',
      versionNumber: 2,
      operation: 'delete',
      fisherId: fisher.id,
      fisherName: fisher.name,
      fisherNumber: fisher.permitNumber,
      vesselId: 'vessel-1',
      vesselName: 'Sea Spray',
      vesselNumber: '123456',
      landingDate: '2026-08-12',
      invoiceNumber: 'INV-9',
      createdAt: '2026-08-13T01:00:00Z',
      items: [
        { id: 'item-1', fishstockCode: 'HOK1', description: 'Hoki', reportingUnit: 'greenweightKg', quantity: 100_000, displayOrder: 0 },
        { id: 'item-2', fishstockCode: 'SNA1', description: 'Snapper', reportingUnit: 'greenweightKg', quantity: 25_500, displayOrder: 1 },
      ],
    };
    setDesktopTransportForTests(async <T,>(command: string) => {
      if (command === 'list_fishers') return [fisher] as T;
      if (command === 'list_landings') return [recentLanding] as T;
      if (command === 'list_deleted_landings') return [deletedLanding] as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider><Landings /></ToastProvider>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Search landings' }));
    await user.click(screen.getByLabelText('Include archived (deleted) landings'));
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const table = await screen.findByRole('table', { name: 'Deleted landings' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(
      ['Date', 'Permit holder', 'Vessel', 'Invoice', 'Fishstocks', 'Total', 'Unit', 'Actions'],
    );
    expect(screen.getByText('Showing 1 deleted landing.')).toBeInTheDocument();
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('Sea Spray')).toBeInTheDocument();
    expect(within(row).getByText('INV-9')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText(/^Deleted /)).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'View details' }));
    expect(await screen.findByRole('dialog', { name: 'Deleted landing details' })).toBeInTheDocument();
  });
});

it('hides archived vessels on new landings and retains the original vessel when editing history', async () => {
  const active = { id: 'active', fisherId: fisher.id, name: 'Active boat', vesselNumber: '111', isArchived: false, hasLandingHistory: false, createdAt: '', updatedAt: '' };
  const archived = { ...active, id: 'archived', name: 'Retired boat', isArchived: true, hasLandingHistory: true };
  const holder = { ...fisher, vessels: [active, archived] };
  const landing = { ...recentLanding, vesselId: archived.id, vesselName: archived.name, vesselNumber: archived.vesselNumber };
  setDesktopTransportForTests(async <T,>(command: string) => {
    if (command === 'list_fishers') return [holder] as T;
    if (command === 'list_landings') return [landing] as T;
    if (command === 'list_landing_years') return [2026] as T;
    throw new Error(`Unexpected command: ${command}`);
  });
  const user = userEvent.setup();
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><Landings /></ToastProvider></QueryClientProvider>);
  await user.click(await screen.findByRole('button', { name: 'Record a landing' }));
  await user.selectOptions(screen.getByLabelText('Permit holder'), fisher.id);
  expect(screen.getByRole('option', { name: 'Active boat — 111' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Retired boat/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(container.querySelector('button[title="Edit"]')!);
  expect(screen.getByLabelText('Vessel')).toHaveValue('archived');
  expect(screen.getByRole('option', { name: /Retired boat.*archived/ })).toBeInTheDocument();
});
