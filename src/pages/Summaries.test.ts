import { availableSummaryYears, previousMonth } from './Summaries';

describe('Monthly summary defaults', () => {
  it('selects the previous month in the same year', () => {
    expect(previousMonth(new Date(2026, 7, 18))).toEqual({ month: '07', year: '2026' });
  });

  it('rolls January back to December of the previous year', () => {
    expect(previousMonth(new Date(2026, 0, 10))).toEqual({ month: '12', year: '2025' });
  });

  it('offers only years with records plus the current and selected years', () => {
    expect(availableSummaryYears([2024, 2022, 2024], '2025', 2026)).toEqual(['2026', '2025', '2024', '2022']);
  });
});
