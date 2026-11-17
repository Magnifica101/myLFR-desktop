import { quantitiesByFishType, quantitiesByPermitHolder, quantitiesByVessel, receivedOverTime, selectLandingLines, shareSlices, summariseLandings } from './landingAnalysis';
import type { Landing } from './types';

const landing: Landing = {
  id: 'l1', fisherId: 'f1', fisherName: 'Test fisher', fisherNumber: '123', vesselId: 'v1', vesselName: 'Test vessel', vesselNumber: '123',
  landingDate: '2026-12-31', invoiceNumber: null, createdAt: '', updatedAt: '',
  items: [
    { id: 'i1', fishstockCode: 'SNA1', description: 'Snapper', reportingUnit: 'greenweightKg', quantity: 101, displayOrder: 1 },
    { id: 'i2', fishstockCode: 'OYU5', description: 'Oyster', reportingUnit: 'count', quantity: 7, displayOrder: 2 },
    { id: 'i3', fishstockCode: 'SCA1', description: 'Scallop', reportingUnit: 'meatweightKg', quantity: 250, displayOrder: 3 },
  ],
};

it('keeps scaled totals by quantity type and counts shared vessels once, excluding shore-based landings', () => {
  const summary = summariseLandings([landing, { ...landing, id: 'l2', fisherId: 'f2' }, { ...landing, id: 'l3', vesselId: null }]);
  expect(summary).toMatchObject({ landingCount: 3, permitHolderCount: 2, rowCount: 9, fishstockCount: 3, vesselCount: 1, shoreCount: 1 });
  expect(summary.totals).toEqual([{ unit: 'greenweightKg', quantity: 303 }, { unit: 'meatweightKg', quantity: 750 }, { unit: 'count', quantity: 21 }]);
  const selected = selectLandingLines([landing], ['SNA1', 'OYU5'], 'count');
  expect(selected[0].items).toEqual([landing.items[1]]);
  expect(landing.items).toHaveLength(3);
  expect(selectLandingLines([landing], ['HOK1'], 'all')).toEqual([]);
});

it('fills empty months, including selected boundaries, without mixing quantities', () => {
  const result = receivedOverTime([landing, { ...landing, landingDate: '2027-02-01' }], 'greenweightKg', 'month', '2026-11-01', '2027-03-31');
  expect(result.points).toEqual([
    { date: '2026-11-01', quantity: 0 }, { date: '2026-12-01', quantity: 101 },
    { date: '2027-01-01', quantity: 0 }, { date: '2027-02-01', quantity: 101 }, { date: '2027-03-01', quantity: 0 },
  ]);
});

it('totals each quantity type by vessel identity across holders, keeping identical names and shore-based receipts separate', () => {
  const landings = [landing,
    { ...landing, id: 'l2', fisherId: 'f2' },
    { ...landing, id: 'l3', vesselId: 'v2', vesselNumber: '456' },
    { ...landing, id: 'l4', vesselId: null },
  ];
  for (const [unit, quantity] of [['greenweightKg', 101], ['meatweightKg', 250], ['count', 7]] as const) {
    const groups = quantitiesByVessel(landings, unit);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({ vesselId: 'v1', name: 'Test vessel', number: '123', quantity: quantity * 2 });
    expect(groups.find((vessel) => vessel.vesselId === 'v2')).toEqual({ vesselId: 'v2', name: 'Test vessel', number: '456', quantity });
    expect(groups.find((vessel) => vessel.vesselId === null)).toEqual({ vesselId: null, name: 'Shore-based', number: null, quantity });
  }
  expect(quantitiesByVessel(selectLandingLines(landings, ['SNA1'], 'all'), 'count')).toEqual([]);
  expect(quantitiesByVessel(selectLandingLines(landings, ['SNA1'], 'all'), 'greenweightKg')[0].quantity).toBe(202);
});

it('groups weeks on Monday across a year boundary and keeps leap days and daylight-saving dates', () => {
  const weeks = receivedOverTime([landing, { ...landing, landingDate: '2027-01-03' }, { ...landing, landingDate: '2027-01-04' }], 'count', 'week');
  expect(weeks.points).toEqual([{ date: '2026-12-28', quantity: 14 }, { date: '2027-01-04', quantity: 7 }]);
  expect(receivedOverTime([{ ...landing, landingDate: '2028-02-28' }], 'count', 'day', '2028-02-28', '2028-03-01').points.map((point) => point.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  expect(receivedOverTime([{ ...landing, landingDate: '2026-09-26' }], 'count', 'day', '2026-09-26', '2026-09-28').points.map((point) => point.date)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
});

it('requests a shorter period instead of silently truncating a long daily series', () => {
  expect(receivedOverTime([landing], 'count', 'day', '2020-01-01', '2026-12-31')).toEqual({ points: [], tooManyPeriods: true });
});

it('totals each permit holder once for the chosen quantity type, largest first', () => {
  const landings: Landing[] = [
    landing,
    { ...landing, id: 'l2', fisherId: 'f2', fisherName: 'Second fisher', fisherNumber: '456' },
    { ...landing, id: 'l3', fisherId: 'f2', fisherName: 'Second fisher', fisherNumber: '456', vesselId: null },
  ];
  expect(quantitiesByPermitHolder(landings, 'greenweightKg')).toEqual([
    { fisherId: 'f2', name: 'Second fisher', number: '456', quantity: 202 },
    { fisherId: 'f1', name: 'Test fisher', number: '123', quantity: 101 },
  ]);
  expect(quantitiesByPermitHolder(selectLandingLines(landings, ['SNA1'], 'all'), 'count')).toEqual([]);
});

it('keeps the ten largest shares and folds the rest into Other', () => {
  const entries = Array.from({ length: 13 }, (_, index) => ({ key: `k${index}`, name: `Name ${index}`, detail: null, quantity: 130 - index * 10 }));
  const slices = shareSlices(entries);
  expect(slices).toHaveLength(11);
  expect(slices.slice(0, 10).every((slice) => !slice.isOther)).toBe(true);
  expect(slices[10]).toMatchObject({ key: 'other', name: 'Other', isOther: true, otherCount: 3, quantity: 30 + 20 + 10 });
  expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1);
  expect(shareSlices(entries.slice(0, 10)).some((slice) => slice.isOther)).toBe(false);
  expect(shareSlices([])).toEqual([]);
});

it('groups fishstocks into three-letter fish types named after their largest stock', () => {
  const landings: Landing[] = [{ ...landing, items: [
    { id: 'a', fishstockCode: 'SNA1', description: 'Snapper', reportingUnit: 'greenweightKg', quantity: 100, displayOrder: 1 },
    { id: 'b', fishstockCode: 'SNA8', description: 'Snapper (west)', reportingUnit: 'greenweightKg', quantity: 300, displayOrder: 2 },
    { id: 'c', fishstockCode: 'GUR1', description: 'Gurnard', reportingUnit: 'greenweightKg', quantity: 50, displayOrder: 3 },
    { id: 'd', fishstockCode: 'OYU5', description: 'Oyster', reportingUnit: 'count', quantity: 7, displayOrder: 4 },
  ] }];
  expect(quantitiesByFishType(landings, 'greenweightKg')).toEqual([
    { fishType: 'SNA', description: 'Snapper (west)', quantity: 400 },
    { fishType: 'GUR', description: 'Gurnard', quantity: 50 },
  ]);
  expect(quantitiesByFishType(landings, 'count')).toEqual([{ fishType: 'OYU', description: 'Oyster', quantity: 7 }]);
});
