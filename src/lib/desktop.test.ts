import { desktop, resetDesktopTransportForTests, setDesktopTransportForTests } from './desktop';

describe('typed desktop bridge', () => {
  afterEach(resetDesktopTransportForTests);

  it('uses narrow command names and camel-case arguments', async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    setDesktopTransportForTests(async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      return [] as T;
    });
    await desktop.listFishers(true);
    await desktop.listLandingYears();
    await desktop.dashboardMetrics('2025-10-01', '2026-09-30', 9);
    await desktop.listPreviousLandingFishstocks('fisher-1', 'vessel-1', 'landing-1');
    expect(calls).toEqual([
      ['list_fishers', { includeArchived: true }],
      ['list_landing_years', undefined],
      ['dashboard_metrics', { fromDate: '2025-10-01', toDate: '2026-09-30', fishingYearStartMonth: 9 }],
      ['list_previous_landing_fishstocks', { fisherId: 'fisher-1', vesselId: 'vessel-1', excludeLandingId: 'landing-1' }],
    ]);
  });

  it('does not expose a generic SQL command', () => {
    expect(Object.keys(desktop)).not.toContain('executeSql');
  });
});
