import { centiKgToInput, formatKg, formatQuantity, formatWholeKgValue, kgInputToCentiKg, quantityInputToScaledQuantity } from './format';

describe('greenweight conversion', () => {
  it('converts two-decimal kg input to an exact scaled integer', () => {
    expect(kgInputToCentiKg('123.45')).toBe(12_345);
    expect(centiKgToInput(12_345)).toBe('123.45');
  });

  it('rejects invalid, non-positive, and over-precise values', () => {
    expect(kgInputToCentiKg('0')).toBeNull();
    expect(kgInputToCentiKg('-1')).toBeNull();
    expect(kgInputToCentiKg('1.234')).toBeNull();
    expect(kgInputToCentiKg('fish')).toBeNull();
  });

  it('formats exact centi-kilograms for New Zealand users', () => {
    expect(formatKg(12_345)).toContain('123.45');
  });

  it('rounds dashboard greenweight to the nearest whole kilogram', () => {
    expect(formatWholeKgValue(12_345)).toBe('123');
    expect(formatWholeKgValue(12_350)).toBe('124');
    expect(formatWholeKgValue(162_000)).toBe('1,620');
  });

  it('validates meatweight as kilograms and OYU5 as whole counts', () => {
    expect(quantityInputToScaledQuantity('12.34', 'meatweightKg')).toBe(1234);
    expect(quantityInputToScaledQuantity('12.3', 'count')).toBeNull();
    expect(quantityInputToScaledQuantity('12', 'count')).toBe(12);
    expect(formatQuantity(12, 'count')).toBe('12 count');
  });
});
