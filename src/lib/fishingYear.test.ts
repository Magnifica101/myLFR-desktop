import { currentFishingYearRange } from './fishingYear';

describe('currentFishingYearRange', () => {
  it('uses October to September by default', () => {
    expect(currentFishingYearRange(9, new Date(2026, 7, 13))).toEqual({
      from: '2025-10-01',
      to: '2026-09-30',
      label: '1 Oct 2025 – 30 Sept 2026',
    });
  });

  it('supports the February and April fishing years', () => {
    expect(currentFishingYearRange(1, new Date(2026, 0, 15)).from).toBe('2025-02-01');
    expect(currentFishingYearRange(3, new Date(2026, 3, 1)).to).toBe('2027-03-31');
  });
});
