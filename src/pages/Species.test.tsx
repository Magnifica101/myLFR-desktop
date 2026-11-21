import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderWithoutRouter, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ToastProvider';
import {
  resetDesktopTransportForTests,
  setDesktopTransportForTests,
  type DesktopTransport,
} from '../lib/desktop';
import type { Fishstock, UserFishstock } from '../lib/types';
import Species from './Species';

// Pages render a Help button that navigates, so they need a router.
const render = (ui: Parameters<typeof renderWithoutRouter>[0], options?: Parameters<typeof renderWithoutRouter>[1]) => renderWithoutRouter(ui, { wrapper: MemoryRouter, ...options });

const snapper: Fishstock = {
  code: 'SNA1',
  description: 'Snapper Auckland (East)',
  reportingUnit: 'greenweightKg',
  isActive: true,
  isFavorite: false,
  isUserAdded: false,
};

describe('Species', () => {
  afterEach(resetDesktopTransportForTests);

  it('keeps the current results visible while a new search is loading', async () => {
    let resolveSecondSearch: ((value: Fishstock[]) => void) | undefined;
    const transport: DesktopTransport = async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'list_favorite_fishstocks' || command === 'list_user_fishstocks') return [] as T;
      if (command === 'search_fishstocks' && args?.query === 's') return [snapper] as T;
      if (command === 'search_fishstocks' && args?.query === 'sn') {
        return new Promise<Fishstock[]>((resolve) => { resolveSecondSearch = resolve; }) as Promise<T>;
      }
      throw new Error(`Unexpected command: ${command}`);
    };
    setDesktopTransportForTests(transport);

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><Species /></ToastProvider>
      </QueryClientProvider>,
    );

    const input = screen.getByRole('textbox', { name: 'Search fishstocks' });
    await user.type(input, 's');
    expect(await screen.findByText('SNA1')).toBeVisible();

    await user.type(input, 'n');
    expect(screen.getByText('SNA1')).toBeVisible();

    resolveSecondSearch?.([snapper]);
    await waitFor(() => expect(screen.getByText('Snapper Auckland (East)')).toBeVisible());
  });

  function renderSpecies() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><Species /></ToastProvider>
      </QueryClientProvider>,
    );
  }

  it('warns about similar stocks before adding one, and needs a fishing year chosen', async () => {
    const added: unknown[] = [];
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'list_favorite_fishstocks' || command === 'list_user_fishstocks') return [] as T;
      if (command === 'search_fishstocks') return (args?.query === 'SNA' ? [snapper] : []) as T;
      if (command === 'add_user_fishstock') {
        added.push(args?.input);
        return { ...(args?.input as object), isFavorite: false, landingCount: 0 } as T;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    renderSpecies();

    await user.click(await screen.findByRole('button', { name: 'Add a fishstock' }));
    await user.type(screen.getByLabelText('Fishstock code'), 'sna11');
    await user.type(screen.getByLabelText('Name'), 'Snapper');
    expect(screen.getByLabelText('Fishing year')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Add fishstock' }));
    expect(added).toEqual([]);

    await user.selectOptions(screen.getByLabelText('Fishing year'), '9');
    await user.click(screen.getByRole('button', { name: 'Add fishstock' }));
    expect(await screen.findByText(/SNA1 Snapper Auckland \(East\)/)).toBeVisible();
    expect(added).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Add SNA11 anyway' }));
    await waitFor(() => expect(added).toEqual([
      { code: 'SNA11', description: 'Snapper', reportingUnit: 'greenweightKg', fishingYearStartMonth: 9 },
    ]));
  });

  it('says straight away when a typed code is already in the list, and offers to make it a favourite', async () => {
    let favourite = false;
    const favouriteCalls: unknown[] = [];
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'list_favorite_fishstocks' || command === 'list_user_fishstocks') return [] as T;
      if (command === 'search_fishstocks') {
        const stocks = [{ ...snapper, isFavorite: favourite }, { ...snapper, code: 'SNA10', description: 'Snapper Kermadec' }];
        return stocks.filter((stock) => stock.code.startsWith(String(args?.query))) as T;
      }
      if (command === 'set_fishstock_favorite') {
        favouriteCalls.push(args);
        favourite = args?.favorite === true;
        return null as T;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    renderSpecies();

    await user.click(await screen.findByRole('button', { name: 'Add a fishstock' }));
    await user.type(screen.getByLabelText('Fishstock code'), 'sna1');
    const taken = await screen.findByRole('status');
    expect(taken).toHaveTextContent("SNA1 is already in the list: Snapper Auckland (East). You don't need to add it.");
    expect(screen.getByLabelText('Fishstock code')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Add fishstock' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add SNA1 to favourites' }));
    expect(favouriteCalls).toEqual([{ code: 'SNA1', favorite: true }]);
    expect(await screen.findByText("It's already one of your favourites.")).toBeVisible();

    // A code that isn't in the list clears the message and allows saving again.
    await user.type(screen.getByLabelText('Fishstock code'), '1');
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add fishstock' })).toBeEnabled();
  });

  it('names a code the receiver added themselves as their own', async () => {
    const own: Fishstock = { ...snapper, code: 'NEW1', description: 'Receiver stock', isUserAdded: true, isFavorite: true };
    setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'list_favorite_fishstocks' || command === 'list_user_fishstocks') return [] as T;
      if (command === 'search_fishstocks') return (String(args?.query) === 'NEW1' ? [own] : []) as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    renderSpecies();

    await user.click(await screen.findByRole('button', { name: 'Add a fishstock' }));
    await user.type(screen.getByLabelText('Fishstock code'), 'NEW1');
    expect(await screen.findByRole('status')).toHaveTextContent('NEW1 is already in the list (added by you): Receiver stock.');
    expect(screen.getByText("It's already one of your favourites.")).toBeVisible();
    expect(screen.queryByRole('button', { name: /to favourites/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add fishstock' })).toBeDisabled();
  });

  it('locks the code and unit of a stock that landings use, and cannot remove it', async () => {
    const used: UserFishstock = {
      code: 'NEW1', description: 'Receiver stock', reportingUnit: 'greenweightKg',
      fishingYearStartMonth: 3, isFavorite: false, landingCount: 2,
    };
    setDesktopTransportForTests(async <T,>(command: string) => {
      if (command === 'list_favorite_fishstocks') return [] as T;
      if (command === 'list_user_fishstocks') return [used] as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    renderSpecies();

    expect(await screen.findByRole('button', { name: 'Remove NEW1' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Edit NEW1' }));
    expect(screen.getByLabelText('Fishstock code')).toBeDisabled();
    expect(screen.getByLabelText("How it's measured")).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeEnabled();
    expect(screen.getByLabelText('Fishing year')).toHaveValue('3');
  });
});
