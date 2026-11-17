import type { ReportingUnit } from './types';

export function formatKg(centiKg: number): string {
  return `${(centiKg / 100).toLocaleString('en-NZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kg`;
}

export function reportingUnitLabel(unit: ReportingUnit): string {
  if (unit === 'meatweightKg') return 'Meatweight (kg)';
  if (unit === 'count') return 'Count';
  return 'Greenweight (kg)';
}

export function reportingUnitShortLabel(unit: ReportingUnit): string {
  if (unit === 'meatweightKg') return 'MW (kg)';
  if (unit === 'count') return 'Count';
  return 'GW (kg)';
}

export function formatQuantityValue(quantity: number, unit: ReportingUnit): string {
  if (unit === 'count') return quantity.toLocaleString('en-NZ');
  return (quantity / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatQuantity(quantity: number, unit: ReportingUnit): string {
  return `${formatQuantityValue(quantity, unit)} ${unit === 'count' ? 'count' : unit === 'meatweightKg' ? 'kg meatweight' : 'kg greenweight'}`;
}

export function formatDashboardQuantity(quantity: number, unit: ReportingUnit): string {
  return unit === 'count' ? quantity.toLocaleString('en-NZ') : Math.round(quantity / 100).toLocaleString('en-NZ');
}

export function quantityInputToScaledQuantity(value: string, unit: ReportingUnit): number | null {
  const trimmed = value.trim();
  if (unit === 'count') {
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return kgInputToCentiKg(trimmed);
}

export function quantityToInput(value: number, unit: ReportingUnit): string {
  return unit === 'count' ? String(value) : centiKgToInput(value);
}

export function formatWholeKgValue(centiKg: number): string {
  return Math.round(centiKg / 100).toLocaleString('en-NZ');
}

export function kgInputToCentiKg(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const centiKg = Math.round(parsed * 100);
  return Number.isSafeInteger(centiKg) ? centiKg : null;
}

export function centiKgToInput(value: number): string {
  return (value / 100).toFixed(2);
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error || 'Something went wrong.');
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
