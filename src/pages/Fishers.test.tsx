import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as renderWithoutRouter, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ToastProvider';
import { resetDesktopTransportForTests, setDesktopTransportForTests } from '../lib/desktop';
import type { Fisher } from '../lib/types';
import Fishers from './Fishers';

// Pages render a Help button that navigates, so they need a router.
const render = (ui: Parameters<typeof renderWithoutRouter>[0], options?: Parameters<typeof renderWithoutRouter>[1]) => renderWithoutRouter(ui, { wrapper: MemoryRouter, ...options });

// jsdom does not implement native dialog methods; WebView2 provides focus trapping.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  // jsdom has no scrolling or media-query engine.
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Element.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

const fishers: Fisher[] = [
  {
    id: 'fisher-1',
    name: 'ABC Trawling Ltd',
    permitNumber: '88888888',
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-08-10T00:00:00Z',
    updatedAt: '2026-08-10T00:00:00Z',
    vessels: [{
      id: 'vessel-1',
      fisherId: 'fisher-1',
      name: 'Margarita V',
      vesselNumber: '5555',
      isArchived: false,
      hasLandingHistory: true,
      createdAt: '2026-08-10T00:00:00Z',
      updatedAt: '2026-08-10T00:00:00Z',
    }],
  },
  {
    id: 'fisher-2',
    name: 'Dev Fishing Ltd',
    permitNumber: '9999999',
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-08-10T00:00:00Z',
    updatedAt: '2026-08-10T00:00:00Z',
    vessels: [],
  },
];

describe('Permit holders', () => {
  afterEach(resetDesktopTransportForTests);

  it('starts collapsed, expands details, and searches by permit number', async () => {
    setDesktopTransportForTests(async <T,>(command: string) => {
      if (command === 'list_fishers') return fishers as T;
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><Fishers /></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('ABC Trawling Ltd')).toBeVisible();
    expect(screen.getByText('88888888')).toBeVisible();
    expect(screen.getByText('Margarita V')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' })).not.toBeVisible();

    await user.click(screen.getByLabelText('Show or hide details for ABC Trawling Ltd'));
    expect(screen.getByText('Margarita V')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' })).toBeVisible();

    await user.type(screen.getByRole('textbox', { name: 'Search permit holders' }), '9999999');
    expect(screen.queryByText('ABC Trawling Ltd')).not.toBeInTheDocument();
    expect(screen.getByText('Dev Fishing Ltd')).toBeVisible();
  });
});

afterEach(resetDesktopTransportForTests);

it.each([
  { action: 'Archive', trigger: 'Archive Dev Fishing Ltd', command: 'set_fisher_archived', args: { id: 'fisher-2', archived: true } },
  { action: 'Delete', trigger: 'Permanently remove Dev Fishing Ltd', command: 'remove_fisher', args: { id: 'fisher-2' } },
])('requires confirmation to $action the selected permit holder and supports Cancel and Escape', async ({ action, trigger, command, args }) => {
  const mutations = vi.fn();
  setDesktopTransportForTests(async <T,>(requested: string, input?: Record<string, unknown>) => {
    if (requested === 'list_fishers') return fishers as T;
    mutations(requested, input);
    return undefined as T;
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><Fishers /></ToastProvider></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for Dev Fishing Ltd'));
  for (const dismiss of ['Cancel', 'Escape']) {
    await user.click(screen.getByRole('button', { name: trigger }));
    const dialog = screen.getByRole('dialog', { name: `${action} permit holder?` });
    expect(within(dialog).getByText('Dev Fishing Ltd')).toBeVisible();
    expect(within(dialog).getByText(/Permit 9999999/)).toBeVisible();
    expect(mutations).not.toHaveBeenCalled();
    if (dismiss === 'Cancel') await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    // jsdom does not dispatch the native dialog cancel event for Escape.
    else fireEvent(dialog, new Event('cancel', { bubbles: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mutations).not.toHaveBeenCalled();
  }
  await user.click(screen.getByRole('button', { name: trigger }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: action }));
  await waitFor(() => expect(mutations).toHaveBeenCalledExactlyOnceWith(command, args));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

function renderVesselEditor(data: Fisher[], saved: unknown[], match: import('../lib/types').RegisteredVessel | null = null) {
  setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
    if (command === 'list_fishers') return data.filter((fisher) => args?.includeArchived || !fisher.isArchived) as T;
    if (command === 'find_vessel_by_number') return match as T;
    if (command === 'upsert_fisher') { saved.push(args?.input); return data[0] as T; }
    throw new Error(`Unexpected command: ${command}`);
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><Fishers /></ToastProvider></QueryClientProvider>);
}

it('labels archived permit holders while collapsed and keeps their filter independent of vessels', async () => {
  const data = structuredClone(fishers);
  data[1].isArchived = true;
  renderVesselEditor(data, []);
  const user = userEvent.setup();
  await screen.findByText('ABC Trawling Ltd');
  expect(screen.queryByText('Dev Fishing Ltd')).not.toBeInTheDocument();
  await user.click(screen.getByLabelText('Show archived vessels'));
  expect(screen.queryByText('Dev Fishing Ltd')).not.toBeInTheDocument();
  await user.click(screen.getByLabelText('Show archived permit holders'));
  const summary = await screen.findByLabelText('Show or hide details for Dev Fishing Ltd, archived');
  expect(within(summary).getByText('Archived')).toBeVisible();
  expect(within(screen.getByLabelText('Show or hide details for ABC Trawling Ltd')).queryByText('Archived')).not.toBeInTheDocument();
  await user.click(summary);
  expect(within(summary).getByText('Archived')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Restore Dev Fishing Ltd' })).toBeVisible();
  await user.click(summary);
  expect(within(summary).getByText('Archived')).toBeVisible();
  await user.click(screen.getByLabelText('Show archived permit holders'));
  expect(await screen.findByText('ABC Trawling Ltd')).toBeVisible();
  expect(screen.queryByText('Dev Fishing Ltd')).not.toBeInTheDocument();
});

it('labels only archived vessels in the expanded list and editor, with independent archive filters', async () => {
  const data = structuredClone(fishers);
  data[0].vessels.push({ ...data[0].vessels[0], id: 'archived-vessel', name: 'Archived boat', vesselNumber: '6666', isArchived: true });
  renderVesselEditor(data, []);
  const user = userEvent.setup();
  await screen.findByText('ABC Trawling Ltd');
  expect(screen.queryByText('Archived boat')).not.toBeInTheDocument();
  await user.click(screen.getByLabelText('Show archived permit holders'));
  await user.click(await screen.findByLabelText('Show or hide details for ABC Trawling Ltd'));
  expect(screen.queryByText('Archived boat')).not.toBeInTheDocument();
  await user.click(screen.getByLabelText('Show archived vessels'));
  expect(within(screen.getByText('Archived boat').closest('tr')!).getByText('Archived')).toBeVisible();
  expect(within(screen.getByText('Margarita V').closest('tr')!).queryByText('Archived')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' }));
  const archivedRow = screen.getByDisplayValue('Archived boat').closest('.vessel-editor-row')! as HTMLElement;
  expect(within(archivedRow).getByText('Archived')).toBeVisible();
  expect(within(archivedRow).getByRole('button', { name: 'Restore vessel Archived boat' })).toBeVisible();
  const activeRow = screen.getByDisplayValue('Margarita V').closest('.vessel-editor-row')! as HTMLElement;
  expect(within(activeRow).queryByText('Archived')).not.toBeInTheDocument();
  await user.click(screen.getByLabelText('Include archived vessels'));
  expect(screen.queryByDisplayValue('Archived boat')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('Margarita V')).toBeVisible();
});

it.each([false, true])('reveals and focuses each new vessel (reduced motion: %s) without saving', async (reducedMotion) => {
  const saved: unknown[] = [];
  vi.mocked(window.matchMedia).mockReturnValue({ matches: reducedMotion } as MediaQueryList);
  const scroll = vi.mocked(Element.prototype.scrollIntoView);
  scroll.mockClear();
  renderVesselEditor(fishers, saved);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for ABC Trawling Ltd'));
  await user.click(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' }));
  expect(scroll).not.toHaveBeenCalled();
  for (let count = 1; count <= 2; count++) {
    await user.click(screen.getByRole('button', { name: 'Add vessel' }));
    const registrations = screen.getAllByLabelText('Vessel registration number');
    expect(registrations).toHaveLength(count + 1);
    const newest = registrations.at(-1)!;
    expect(newest).toHaveFocus();
    expect(scroll).toHaveBeenLastCalledWith({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'nearest' });
    expect(scroll.mock.contexts.at(-1)).toBe(newest.closest('.vessel-editor-row'));
    expect(newest.closest('.vessel-editor-row')).toHaveClass('vessel-editor-new');
    expect(registrations[0].closest('.vessel-editor-row')).not.toHaveClass('vessel-editor-new');
    if (count === 2) expect(registrations[1].closest('.vessel-editor-row')).not.toHaveClass('vessel-editor-new');
    await user.type(newest, '123');
    expect(scroll).toHaveBeenCalledTimes(count);
  }
  expect(saved).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' }));
  expect(screen.getAllByLabelText('Vessel registration number')).toHaveLength(1);
  expect(scroll).toHaveBeenCalledTimes(2);
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
});

it('offers archive for history and stages changes with Cancel, Undo and Save', async () => {
  const saved: unknown[] = [];
  renderVesselEditor(fishers, saved);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for ABC Trawling Ltd'));
  await user.click(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' }));
  expect(screen.queryByRole('button', { name: 'Delete vessel Margarita V' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Archive vessel Margarita V' }));
  let dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/cannot be deleted/)).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Will be archived')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Archive vessel Margarita V' }));
  dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Archive vessel' }));
  expect(screen.getByText('Will be archived')).toBeVisible();
  expect(saved).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Undo change to Margarita V' }));
  expect(screen.queryByText('Will be archived')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Archive vessel Margarita V' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive vessel' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(saved).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' }));
  await user.click(screen.getByRole('button', { name: 'Archive vessel Margarita V' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive vessel' }));
  await user.click(screen.getByRole('button', { name: 'Save permit holder' }));
  expect(saved).toEqual([expect.objectContaining({ vessels: [expect.objectContaining({ id: 'vessel-1', isArchived: true })] })]);
});

it('deletes only the unused vessel and keeps the vessel with history', async () => {
  const saved: unknown[] = [];
  const data = structuredClone(fishers);
  data[0].vessels.push({ ...data[0].vessels[0], id: 'unused', name: 'Unused boat', hasLandingHistory: false });
  renderVesselEditor(data, saved);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for ABC Trawling Ltd'));
  await user.click(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' }));
  await user.click(screen.getByRole('button', { name: 'Delete vessel Unused boat' }));
  expect(saved).toHaveLength(0);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Will be deleted')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Delete vessel Unused boat' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('Will be deleted')).not.toBeInTheDocument();
  expect(saved).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Delete vessel Unused boat' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete vessel' }));
  expect(screen.getByText('Will be deleted')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Undo change to Unused boat' }));
  expect(screen.queryByText('Will be deleted')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Delete vessel Unused boat' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete vessel' }));
  await user.click(screen.getByRole('button', { name: 'Save permit holder' }));
  expect(saved).toEqual([expect.objectContaining({ vessels: [expect.objectContaining({ id: 'vessel-1', isArchived: false })] })]);
});

it('shows archived vessels on request and stages restoration', async () => {
  const saved: unknown[] = [];
  const data = structuredClone(fishers);
  data[0].vessels[0].isArchived = true;
  renderVesselEditor(data, saved);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for ABC Trawling Ltd'));
  expect(screen.queryByText('Margarita V')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' }));
  expect(screen.queryByRole('button', { name: 'Restore vessel Margarita V' })).not.toBeInTheDocument();
  await user.click(screen.getByLabelText('Include archived vessels'));
  await user.click(screen.getByRole('button', { name: 'Restore vessel Margarita V' }));
  expect(screen.getByText('Will be restored')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Save permit holder' }));
  expect(saved).toEqual([expect.objectContaining({ vessels: [expect.objectContaining({ id: 'vessel-1', isArchived: false })] })]);
});

it('offers the existing vessel by numeric registration and explicitly links it on Save', async () => {
  const saved: unknown[] = [];
  const match = { id: 'shared-1', name: 'Existing boat', vesselNumber: '77777', linkedPermitHolders: ['Other holder — 123'] };
  renderVesselEditor(fishers, saved, match);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for Dev Fishing Ltd'));
  await user.click(screen.getByRole('button', { name: 'Edit Dev Fishing Ltd' }));
  await user.click(screen.getByRole('button', { name: 'Add vessel' }));
  await user.type(screen.getByLabelText('Vessel registration number'), ' 77777 ');
  await user.tab();
  await user.click(await screen.findByRole('button', { name: 'Use this vessel' }));
  expect(screen.getByLabelText('Vessel name')).toHaveValue('Existing boat');
  expect(screen.getByLabelText('Vessel name')).toBeDisabled();
  expect(screen.getByText('Will link when you save')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Save permit holder' }));
  expect(saved).toEqual([expect.objectContaining({ id: 'fisher-2', vessels: [expect.objectContaining({ name: 'Existing boat', vesselNumber: '77777', linkExisting: true })] })]);
});

it('removes an unsaved new vessel at once, without a confirmation or a pending delete', async () => {
  const saved: unknown[] = [];
  renderVesselEditor(fishers, saved);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for Dev Fishing Ltd'));
  await user.click(screen.getByRole('button', { name: 'Edit Dev Fishing Ltd' }));
  await user.click(screen.getByRole('button', { name: 'Add vessel' }));
  await user.type(screen.getByLabelText('Vessel name'), 'Brand new');
  expect(screen.getByText('New vessel')).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Delete vessel/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Remove new vessel Brand new' }));
  expect(screen.queryByLabelText('Vessel name')).not.toBeInTheDocument();
  expect(screen.queryByText('Will be deleted')).not.toBeInTheDocument();
  expect(document.querySelector('dialog[open]')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save permit holder' }));
  expect(saved).toEqual([expect.objectContaining({ id: 'fisher-2', vessels: [] })]);
});

it('rejects non-numeric and zero-prefixed registration numbers before Save', async () => {
  const saved: unknown[] = [];
  renderVesselEditor(fishers, saved);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for Dev Fishing Ltd'));
  await user.click(screen.getByRole('button', { name: 'Edit Dev Fishing Ltd' }));
  await user.click(screen.getByRole('button', { name: 'Add vessel' }));
  await user.type(screen.getByLabelText('Vessel name'), 'New boat');
  for (const number of ['0123', '123 A', '12 34']) {
    await user.clear(screen.getByLabelText('Vessel registration number'));
    await user.type(screen.getByLabelText('Vessel registration number'), number);
    expect(screen.getByLabelText('Vessel registration number')).toBeInvalid();
    await user.click(screen.getByRole('button', { name: 'Save permit holder' }));
    expect(saved).toHaveLength(0);
  }
});

it('explains that removing a shared unused link retains the other permit holders', async () => {
  const saved: unknown[] = [];
  const data = structuredClone(fishers);
  data[0].vessels[0].hasLandingHistory = false;
  data[0].vessels[0].linkedPermitHolders = ['ABC Trawling Ltd — 88888888', 'Other holder — 123'];
  renderVesselEditor(data, saved);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Show or hide details for ABC Trawling Ltd'));
  await user.click(screen.getByRole('button', { name: 'Edit ABC Trawling Ltd' }));
  await user.click(screen.getByRole('button', { name: 'Remove link to Margarita V' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/other permit holder links are kept/)).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Remove link' }));
  expect(screen.getByText('Link will be removed')).toBeVisible();
  expect(saved).toHaveLength(0);
});
