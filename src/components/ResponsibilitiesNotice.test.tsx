import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { ToastProvider } from './ToastProvider';
import { NOTICE_VERSION } from './ResponsibilitiesNotice';
import { resetDesktopTransportForTests, setDesktopTransportForTests } from '../lib/desktop';
import type { NoticeAcknowledgement } from '../lib/types';

// The startup splash shows for at least 650 ms before anything else renders.
const AFTER_SPLASH = { timeout: 3_000 };

function renderApp(initial: NoticeAcknowledgement | null) {
  let acknowledgement = initial;
  const acknowledged: unknown[] = [];
  setDesktopTransportForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
    if (command === 'get_business_profile') return null as T;
    if (command === 'get_notice_acknowledgement') return acknowledgement as T;
    if (command === 'acknowledge_notice') {
      acknowledged.push(args);
      acknowledgement = { version: args?.version as number, acknowledgedAt: '2026-10-04T00:00:00Z' };
      return acknowledgement as T;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><App /></ToastProvider>
    </QueryClientProvider>,
  );
  return acknowledged;
}

describe('responsibilities notice', () => {
  afterEach(resetDesktopTransportForTests);

  it('comes before setup, names CC0 up front, and records the version acknowledged', async () => {
    const acknowledged = renderApp(null);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Before you start' }, AFTER_SPLASH)).toBeVisible();
    expect(screen.getByText(/released under Creative Commons Zero \(CC0 1\.0\)/)).toBeVisible();
    expect(screen.getByText('You are responsible for your returns.')).toBeVisible();
    expect(screen.getByText('It is not an official product.')).toBeVisible();
    expect(screen.queryByText('Set up myLFR Desktop')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I understand' }));
    expect(await screen.findByText('Set up myLFR Desktop')).toBeVisible();
    expect(acknowledged).toEqual([{ version: NOTICE_VERSION }]);
  });

  it('is skipped once the current version has been acknowledged', async () => {
    renderApp({ version: NOTICE_VERSION, acknowledgedAt: '2026-10-04T00:00:00Z' });
    expect(await screen.findByText('Set up myLFR Desktop', undefined, AFTER_SPLASH)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).not.toBeInTheDocument();
  });

  it('returns when the notice version has risen since it was acknowledged', async () => {
    renderApp({ version: NOTICE_VERSION - 1, acknowledgedAt: '2026-01-01T00:00:00Z' });
    expect(await screen.findByRole('heading', { name: 'Before you start' }, AFTER_SPLASH)).toBeVisible();
  });
});
