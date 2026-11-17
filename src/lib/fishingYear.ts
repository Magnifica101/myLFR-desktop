export type FishingYearStartMonth = 1 | 3 | 9;

export const FISHING_YEAR_OPTIONS: ReadonlyArray<{
  value: FishingYearStartMonth;
  label: string;
  /** Short species hint for compact pickers, such as the Home page selector. */
  summary: string;
  /** Full explanation for roomier surfaces, such as Business settings. */
  description: string;
}> = [
  {
    value: 9,
    label: '1 October – 30 September',
    summary: 'Most fishstocks',
    description: 'Most fishstocks',
  },
  {
    value: 3,
    label: '1 April – 31 March',
    summary: 'Rock lobster, scallops, shellfish',
    description: 'Rock lobster, southern blue whiting, scallops, and specified shellfish stocks',
  },
  {
    value: 1,
    label: '1 February – 31 January',
    summary: 'Lake Ellesmere eels',
    description: 'Shortfin and longfin eels at Lake Ellesmere (Te Waihora)',
  },
];

export function fishingYearLabel(startMonth: FishingYearStartMonth): string {
  return FISHING_YEAR_OPTIONS.find((option) => option.value === startMonth)?.label ?? '';
}

function inputDate(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function displayDate(date: Date) {
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function currentFishingYearRange(startMonth: FishingYearStartMonth, now = new Date()) {
  const startYear = now.getMonth() >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
  const endYear = startYear + 1;
  const start = new Date(startYear, startMonth, 1);
  const end = new Date(endYear, startMonth, 0);
  return {
    from: inputDate(startYear, startMonth, 1),
    to: inputDate(end.getFullYear(), end.getMonth(), end.getDate()),
    label: `${displayDate(start)} – ${displayDate(end)}`,
  };
}
