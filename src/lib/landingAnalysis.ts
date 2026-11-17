import type { Landing, ReportingUnit } from './types';

export const QUANTITY_TYPES: ReportingUnit[] = ['greenweightKg', 'meatweightKg', 'count'];
export type PeriodGrouping = 'month' | 'week' | 'day';
export interface QuantityTotal { unit: ReportingUnit; quantity: number }
export interface FishstockTotal extends QuantityTotal { code: string; description: string }
export interface VesselQuantity { vesselId: string | null; name: string; number: string | null; quantity: number }
export interface FishTypeQuantity { fishType: string; description: string; quantity: number }
export interface PermitHolderQuantity { fisherId: string; name: string; number: string; quantity: number }
export interface ShareEntry { key: string; name: string; detail: string | null; quantity: number }
export interface ShareSlice extends ShareEntry { share: number; isOther: boolean; otherCount: number }

/** Filter individual lines, not whole landings, so charts and the workbook agree. */
export function selectLandingLines(landings: Landing[], codes: string[], unit: ReportingUnit | 'all', shoreOnly = false): Landing[] {
  const selected = new Set(codes);
  return landings.filter((landing) => !shoreOnly || !landing.vesselId).map((landing) => ({
    ...landing,
    items: landing.items.filter((item) => (!selected.size || selected.has(item.fishstockCode)) && (unit === 'all' || item.reportingUnit === unit)),
  })).filter((landing) => landing.items.length > 0);
}

export function summariseLandings(landings: Landing[]) {
  const quantities = new Map<ReportingUnit, number>();
  const stocks = new Map<string, FishstockTotal>();
  const codes = new Set<string>();
  const vessels = new Set<string>();
  const permitHolders = new Set<string>();
  let rowCount = 0;
  let shoreCount = 0;
  for (const landing of landings) {
    permitHolders.add(landing.fisherId);
    if (landing.vesselId) vessels.add(landing.vesselId); else shoreCount++;
    for (const item of landing.items) {
      rowCount++;
      codes.add(item.fishstockCode);
      quantities.set(item.reportingUnit, (quantities.get(item.reportingUnit) ?? 0) + item.quantity);
      const key = `${item.reportingUnit}/${item.fishstockCode}`;
      const stock = stocks.get(key) ?? { code: item.fishstockCode, description: item.description, unit: item.reportingUnit, quantity: 0 };
      stock.quantity += item.quantity;
      stocks.set(key, stock);
    }
  }
  return {
    landingCount: landings.length, permitHolderCount: permitHolders.size, rowCount, fishstockCount: codes.size, vesselCount: vessels.size, shoreCount,
    totals: QUANTITY_TYPES.filter((unit) => quantities.has(unit)).map((unit) => ({ unit, quantity: quantities.get(unit)! })),
    fishstocks: [...stocks.values()].sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code)),
  };
}

/** A shared vessel stays one group across permit holders; names never define identity. */
export function quantitiesByVessel(landings: Landing[], unit: ReportingUnit): VesselQuantity[] {
  const vessels = new Map<string | null, VesselQuantity>();
  for (const landing of landings) {
    const items = landing.items.filter((item) => item.reportingUnit === unit);
    if (!items.length) continue;
    const vessel = vessels.get(landing.vesselId) ?? {
      vesselId: landing.vesselId,
      name: landing.vesselId ? landing.vesselName ?? 'Unnamed vessel' : 'Shore-based',
      number: landing.vesselId ? landing.vesselNumber : null,
      quantity: 0,
    };
    vessel.quantity += items.reduce((sum, item) => sum + item.quantity, 0);
    vessels.set(landing.vesselId, vessel);
  }
  return [...vessels.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name) || (a.vesselId ?? '').localeCompare(b.vesselId ?? ''));
}

export function quantitiesByPermitHolder(landings: Landing[], unit: ReportingUnit): PermitHolderQuantity[] {
  const holders = new Map<string, PermitHolderQuantity>();
  for (const landing of landings) {
    const items = landing.items.filter((item) => item.reportingUnit === unit);
    if (!items.length) continue;
    const holder = holders.get(landing.fisherId) ?? { fisherId: landing.fisherId, name: landing.fisherName, number: landing.fisherNumber, quantity: 0 };
    holder.quantity += items.reduce((sum, item) => sum + item.quantity, 0);
    holders.set(landing.fisherId, holder);
  }
  return [...holders.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name) || a.fisherId.localeCompare(b.fisherId));
}

/** Fish type is the three-letter prefix of the fishstock code, as in monthly summaries. Its name is that of its largest stock. */
export function quantitiesByFishType(landings: Landing[], unit: ReportingUnit): FishTypeQuantity[] {
  const types = new Map<string, { quantity: number; stocks: Map<string, { description: string; quantity: number }> }>();
  for (const landing of landings) {
    for (const item of landing.items) {
      if (item.reportingUnit !== unit) continue;
      const fishType = item.fishstockCode.slice(0, 3);
      const type = types.get(fishType) ?? { quantity: 0, stocks: new Map() };
      type.quantity += item.quantity;
      const stock = type.stocks.get(item.fishstockCode) ?? { description: item.description, quantity: 0 };
      stock.quantity += item.quantity;
      type.stocks.set(item.fishstockCode, stock);
      types.set(fishType, type);
    }
  }
  return [...types.entries()].map(([fishType, type]) => ({
    fishType,
    description: [...type.stocks.entries()].sort(([codeA, a], [codeB, b]) => b.quantity - a.quantity || codeA.localeCompare(codeB))[0][1].description,
    quantity: type.quantity,
  })).sort((a, b) => b.quantity - a.quantity || a.fishType.localeCompare(b.fishType));
}

/** Largest entries keep their own slice; the rest fold into one "Other" slice. Entries must already be sorted largest first. */
export function shareSlices(entries: ShareEntry[], limit = 10): ShareSlice[] {
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  if (!total) return [];
  const own = entries.length > limit ? entries.slice(0, limit) : entries;
  const rest = entries.slice(own.length);
  const slices: ShareSlice[] = own.map((entry) => ({ ...entry, share: entry.quantity / total, isOther: false, otherCount: 0 }));
  if (rest.length) {
    const quantity = rest.reduce((sum, entry) => sum + entry.quantity, 0);
    slices.push({ key: 'other', name: 'Other', detail: null, quantity, share: quantity / total, isOther: true, otherCount: rest.length });
  }
  return slices;
}

function periodStart(value: string, grouping: PeriodGrouping) {
  const date = new Date(`${value}T00:00:00Z`);
  if (grouping === 'month') date.setUTCDate(1);
  if (grouping === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date;
}

/** UTC calendar arithmetic avoids local daylight-saving shifts. Weeks start on Monday. */
export function receivedOverTime(landings: Landing[], unit: ReportingUnit, grouping: PeriodGrouping, fromDate?: string, toDate?: string) {
  const quantities = new Map<string, number>();
  const dates = landings.map((landing) => landing.landingDate).sort();
  if (!dates.length) return { points: [], tooManyPeriods: false };
  for (const landing of landings) {
    const key = periodStart(landing.landingDate, grouping).toISOString().slice(0, 10);
    const quantity = landing.items.filter((item) => item.reportingUnit === unit).reduce((sum, item) => sum + item.quantity, 0);
    quantities.set(key, (quantities.get(key) ?? 0) + quantity);
  }
  const cursor = periodStart(fromDate || dates[0], grouping);
  const last = periodStart(toDate || dates[dates.length - 1], grouping);
  const points: Array<{ date: string; quantity: number }> = [];
  while (cursor <= last) {
    // Ask for a shorter range rather than truncate or draw thousands of unreadable points.
    if (points.length === 1000) return { points: [], tooManyPeriods: true };
    const date = cursor.toISOString().slice(0, 10);
    points.push({ date, quantity: quantities.get(date) ?? 0 });
    if (grouping === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + (grouping === 'week' ? 7 : 1));
  }
  return { points, tooManyPeriods: false };
}
