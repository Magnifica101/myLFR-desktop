import ExcelJS from 'exceljs';
import { resetDesktopTransportForTests, setDesktopTransportForTests } from './desktop';
import { fileNamePart, saveFullDataWorkbook, saveLandingDataWorkbook, saveReportPdf, saveReportWorkbook, type ReportDetails } from './exports';
import type { BusinessProfile, FullExport, Landing, ReportResult } from './types';

const report: ReportResult = {
  rows: [
    { fishstockCode: 'SNA1', description: 'Snapper Auckland (East)', reportingUnit: 'greenweightKg',
 quantity: 12_345, landingCount: 2 },
    { fishstockCode: '001A', description: 'Paua Kaikōura', reportingUnit: 'greenweightKg',
 quantity: 6, landingCount: 1 },
  ],
  fishTypeRows: [
    { fishType: 'SNA', description: 'Snapper', fishstocks: ['SNA1', 'SNA2'], reportingUnit: 'greenweightKg',
 quantity: 12_345, landingCount: 2 },
    { fishType: 'PAU', description: 'Paua', fishstocks: ['PAU3'], reportingUnit: 'greenweightKg',
 quantity: 6, landingCount: 1 },
  ],
  vesselRows: [
    { fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1', vesselId: 'v1', vesselName: 'Southern Star', vesselNumber: 'MNZ1234', fishstockCode: 'SNA1', description: 'Snapper Auckland (East)', reportingUnit: 'greenweightKg',
 quantity: 12_345, landingCount: 2 },
    { fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1', vesselId: 'v1', vesselName: 'Southern Star', vesselNumber: 'MNZ1234', fishstockCode: '001A', description: 'Paua Kaikōura', reportingUnit: 'greenweightKg',
 quantity: 6, landingCount: 1 },
    { fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1', vesselId: 'v2', vesselName: 'Ocean Bird', vesselNumber: 'MNZ5678', fishstockCode: 'HOK1', description: 'Hoki', reportingUnit: 'greenweightKg',
 quantity: 100, landingCount: 1 },
  ],
  vesselFishTypeRows: [
    { fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1', vesselId: 'v1', vesselName: 'Southern Star', vesselNumber: 'MNZ1234', fishType: 'SNA', description: 'Snapper', fishstocks: ['SNA1', 'SNA2'], reportingUnit: 'greenweightKg',
 quantity: 12_345, landingCount: 2 },
    { fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1', vesselId: 'v1', vesselName: 'Southern Star', vesselNumber: 'MNZ1234', fishType: 'PAU', description: 'Paua', fishstocks: ['PAU3'], reportingUnit: 'greenweightKg',
 quantity: 6, landingCount: 1 },
    { fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1', vesselId: 'v2', vesselName: 'Ocean Bird', vesselNumber: 'MNZ5678', fishType: 'HOK', description: 'Hoki', fishstocks: ['HOK1'], reportingUnit: 'greenweightKg',
 quantity: 100, landingCount: 1 },
  ],
  landingCount: 3,
  itemCount: 3,
  unitTotals: [{ reportingUnit: 'greenweightKg', quantity: 12_351 }],
};

const profile: BusinessProfile = {
  lfrName: 'Synthetic LFR',
  clientNumber: 'CLIENT-001',
  streetNumber: '1',
  streetName: 'Harbour',
  streetType: 'Road',
  suburb: 'Port',
  city: 'Nelson',
  postcode: '7010',
  createdAt: '2026-08-09T00:00:00Z',
  updatedAt: '2026-08-09T00:00:00Z',
};

const details: ReportDetails = {
  title: 'LFR monthly summary',
  period: 'August 2026',
  permitHolderName: 'Synthetic Fisher',
  permitNumber: 'PERMIT-1',
  groupByFishType: true,
};

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** 4x2 red PNG, small enough to inline as a report logo fixture. */
const LOGO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGP4z8AARwzIHABvqgf5gNwAKAAAAABJRU5ErkJggg==';

describe('report exports', () => {
  let written: { defaultName: string; fileType: string; bytes: Uint8Array } | null;
  let logo: { dataBase64: string; width: number; height: number } | null;

  beforeEach(() => {
    written = null;
    logo = null;
    setDesktopTransportForTests(async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === 'get_business_logo') return logo as T;
      expect(command).toBe('save_export_file');
      written = {
        defaultName: String(args?.defaultName),
        fileType: String(args?.fileType),
        bytes: decodeBase64(String(args?.dataBase64)),
      };
      return true as T;
    });
  });

  afterEach(() => {
    resetDesktopTransportForTests();
  });

  it('writes an A-to-Z Excel summary and a separate sheet for each vessel', async () => {
    await saveReportWorkbook(report, profile, details, 'summary');

    expect(written?.defaultName).toBe('summary.xlsx');
    expect(written?.fileType).toBe('xlsx');
    const workbook = new ExcelJS.Workbook();
    const workbookBytes = Buffer.from(written!.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookBytes);
    const summary = workbook.getWorksheet('Summary');
    expect(summary?.getCell('A1').value).toBe('LFR monthly summary');
    expect(summary?.getCell('A2').value).toBe('Synthetic LFR');
    expect(summary?.getCell('A3').value).toBe('Client number: CLIENT-001');
    expect(summary?.getCell('A4').value).toBe('1 Harbour Road');
    expect(summary?.getCell('A5').value).toBe('Port');
    expect(summary?.getCell('A6').value).toBe('Nelson 7010');
    const summaryHeaderNumber = summary!.getColumn(1).values.findIndex((value) => value === 'Fish type');
    expect(summary?.getCell(summaryHeaderNumber + 1, 1).value).toBe('PAU');
    expect(summary?.getCell(summaryHeaderNumber + 2, 1).value).toBe('SNA');
    expect(summary?.getCell(summaryHeaderNumber + 2, 3).value).toBe('SNA1, SNA2');
    expect(summary?.getCell(summaryHeaderNumber + 1, 4).value).toBe(1);
    expect(summary?.getCell(summaryHeaderNumber + 1, 5).value).toBe(0.06);
    expect(summary?.getCell(summaryHeaderNumber + 1, 6).value).toBe('GW (kg)');

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Ocean Bird', 'Southern Star']);
    expect(workbook.getWorksheet('Vessel breakdown')).toBeUndefined();

    const oceanBird = workbook.getWorksheet('Ocean Bird');
    expect(oceanBird?.getCell('A2').value).toBe('Permit holder: Synthetic Fisher');
    expect(oceanBird?.getCell('A4').value).toBe('Vessel: Ocean Bird');
    expect(oceanBird?.getCell('A9').value).toBe('Summary');
    expect(oceanBird?.getCell('A11').value).toBe('HOK');
    expect(oceanBird?.getCell('C11').value).toBe('HOK1');

    const southernStar = workbook.getWorksheet('Southern Star');
    expect(southernStar?.getCell('A4').value).toBe('Vessel: Southern Star');
    expect(southernStar?.getCell('A11').value).toBe('PAU');
    expect(southernStar?.getCell('A12').value).toBe('SNA');
    expect(southernStar?.getCell('C12').value).toBe('SNA1, SNA2');
    expect(southernStar?.getCell('E11').value).toBe(0.06);
  });

  it('ends each vessel sheet with a line for every fishstock on that vessel\'s landings', async () => {
    const landing = (overrides: Partial<Landing>): Landing => ({
      id: 'l', fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1', vesselId: 'v1', vesselName: 'Southern Star',
      vesselNumber: 'MNZ1234', landingDate: '2026-08-01', invoiceNumber: null, createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z', items: [], ...overrides,
    });
    const landings = [
      landing({ id: 'later', landingDate: '2026-08-20', invoiceNumber: 'INV-20', items: [
        { id: 'i1', displayOrder: 1, fishstockCode: 'SNA2', description: 'Snapper', reportingUnit: 'greenweightKg', quantity: 12_000 },
        { id: 'i2', displayOrder: 2, fishstockCode: 'PAU3', description: 'Paua', reportingUnit: 'greenweightKg', quantity: 6 },
      ] }),
      landing({ id: 'earlier', landingDate: '2026-08-03', items: [
        { id: 'i3', displayOrder: 1, fishstockCode: 'SNA1', description: 'Snapper Auckland (East)', reportingUnit: 'greenweightKg', quantity: 345 },
      ] }),
      landing({ id: 'other-vessel', vesselId: 'v2', vesselName: 'Ocean Bird', vesselNumber: 'MNZ5678', items: [
        { id: 'i4', displayOrder: 1, fishstockCode: 'HOK1', description: 'Hoki', reportingUnit: 'greenweightKg', quantity: 100 },
      ] }),
    ];

    await saveReportWorkbook(report, profile, { ...details, landings }, 'summary');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(written!.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    // The summary sheet is unchanged.
    expect(workbook.getWorksheet('Summary')?.autoFilter).toBeDefined();
    const southernStar = workbook.getWorksheet('Southern Star')!;
    // (a) the summary by fish type, as an Excel table under its own heading.
    expect(southernStar.getCell('A9').value).toBe('Summary');
    expect(southernStar.getRow(10).values).toEqual([undefined, 'Fish type', 'Description', 'Fishstocks', 'Landing count', 'Total', 'Unit']);
    expect(southernStar.getCell('A11').value).toBe('PAU');
    expect(southernStar.getCell('A12').value).toBe('SNA');
    expect(southernStar.views[0]).toMatchObject({ state: 'frozen', ySplit: 10 });
    // (b) every line, earliest landing first and codes in order within a landing.
    expect(southernStar.getCell('A13').value).toBeNull();
    expect(southernStar.getCell('A14').value).toBe('Landings');
    expect(southernStar.getRow(15).values).toEqual([undefined, 'Date', 'Invoice number', 'Fishstock code', 'Fishstock name', 'Fish type', 'Quantity', 'Unit']);
    expect((southernStar.getCell('A16').value as Date).toISOString().slice(0, 10)).toBe('2026-08-03');
    expect(southernStar.getCell('A16').numFmt).toBe('dd-mm-yyyy');
    expect(southernStar.getRow(16).values).toEqual([undefined, southernStar.getCell('A16').value, '', 'SNA1', 'Snapper Auckland (East)', 'SNA', 3.45, 'GW (kg)']);
    expect(southernStar.getRow(17).values).toEqual([undefined, southernStar.getCell('A17').value, 'INV-20', 'PAU3', 'Paua', 'PAU', 0.06, 'GW (kg)']);
    expect(southernStar.getCell('C18').value).toBe('SNA2');
    expect(southernStar.getCell('F18').numFmt).toBe('0.00');
    expect(southernStar.rowCount).toBe(18);
    // Both sections are Excel tables with their own filter buttons and stripes.
    const tables = (southernStar as unknown as { tables: Record<string, { table: { style: { theme: string; showRowStripes: boolean } } }> }).tables;
    expect(Object.values(tables).map(({ table }) => table.style)).toMatchObject([
      { theme: 'TableStyleLight1', showRowStripes: true },
      { theme: 'TableStyleLight1', showRowStripes: true },
    ]);
    expect(southernStar.autoFilter).toBeUndefined();
    // Each vessel gets only its own landings.
    const oceanBird = workbook.getWorksheet('Ocean Bird')!;
    expect(oceanBird.getCell('C15').value).toBe('HOK1');
    expect(oceanBird.rowCount).toBe(15);
  });

  it('makes names safe for a Windows file name', () => {
    expect(fileNamePart('  Smith & Sons: "Ltd" / NZ  ')).toBe('Smith-&-Sons-Ltd-NZ');
    expect(fileNamePart('PERMIT 123')).toBe('PERMIT-123');
  });

  it('writes a full-data workbook with one sheet per table and typed quantities', async () => {
    const fullExport: FullExport = {
      businessProfile: profile,
      fishers: [
        {
          id: 'f1', name: 'Synthetic Fisher', permitNumber: 'PERMIT-1', isArchived: false, archivedAt: null,
          createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
          vessels: [
            { id: 'v1', fisherId: 'f1', name: 'Southern Star', vesselNumber: 'MNZ1234', isArchived: false, hasLandingHistory: true, createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z' },
          ],
        },
      ],
      favoriteFishstocks: [{ code: 'SNA1', description: 'Snapper Auckland (East)', reportingUnit: 'greenweightKg',
 isActive: true, isFavorite: true, isUserAdded: false }],
      userFishstocks: [{ code: 'NEW1', description: 'Receiver stock', reportingUnit: 'count', fishingYearStartMonth: 3, isFavorite: false, landingCount: 2 }],
      landings: [
        {
          id: 'l1', fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1',
          vesselId: 'v1', vesselName: 'Southern Star', vesselNumber: 'MNZ1234',
          landingDate: '2026-08-03', invoiceNumber: 'INV-1', createdAt: '2026-08-03T00:00:00Z', updatedAt: '2026-08-03T00:00:00Z',
          items: [{ id: 'i1', fishstockCode: 'SNA1', description: 'Snapper Auckland (East)', reportingUnit: 'greenweightKg',
 quantity: 4_250, displayOrder: 0 }],
        },
      ],
      landingRevisions: [
        {
          id: 'r1', landingId: 'l1', versionNumber: 1, operation: 'save', fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1',
          vesselId: 'v1', vesselName: 'Southern Star', vesselNumber: 'MNZ1234', landingDate: '2026-08-03', invoiceNumber: 'INV-1', createdAt: '2026-08-03T00:00:00Z',
          items: [{ id: 'i1', fishstockCode: 'SNA1', description: 'Snapper Auckland (East)', reportingUnit: 'greenweightKg',
 quantity: 4_250, displayOrder: 0 }],
        },
      ],
      deletedLandings: [],
      schemaVersion: 4,
      catalogueVersion: 7,
      exportedAt: '2026-08-19T00:00:00Z',
    };

    await saveFullDataWorkbook(fullExport, 'myLFR-my-data-2026-08-19');

    expect(written?.defaultName).toBe('myLFR-my-data-2026-08-19.xlsx');
    expect(written?.fileType).toBe('xlsx');
    const workbook = new ExcelJS.Workbook();
    const workbookBytes = Buffer.from(written!.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookBytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Overview', 'Business details', 'Permit holders', 'Vessels', 'Favourite fishstocks', 'Fishstocks you added', 'Landings', 'Landing history',
    ]);
    const added = workbook.getWorksheet('Fishstocks you added');
    expect(added?.getRow(2).values).toEqual([undefined, 'NEW1', 'Receiver stock', 'Count', '1 April – 31 March', 2]);
    const landings = workbook.getWorksheet('Landings');
    expect(landings?.getCell('A1').value).toBe('Landing date');
    expect(landings?.getCell('G2').value).toBe('SNA1');
    expect(landings?.getCell('I2').value).toBe(42.5);
    expect(landings?.getCell('J2').value).toBe('GW (kg)');
    expect(workbook.getWorksheet('Vessels')?.getCell('C2').value).toBe('Southern Star');
    expect(workbook.getWorksheet('Vessels')?.getCell('E2').value).toBe('Active');
    const overview = workbook.getWorksheet('Overview');
    const schemaRow = overview!.getColumn(1).values.findIndex((value) => value === 'Database schema version');
    expect(overview?.getCell(schemaRow, 2).value).toBe(4);
  });

  it('writes one flat row per fishstock on each landing, in date order, for pivot tables', async () => {
    const landing = (overrides: Partial<Landing>): Landing => ({
      id: 'l', fisherId: 'f1', fisherName: 'Synthetic Fisher', fisherNumber: 'PERMIT-1', vesselId: null, vesselName: null,
      vesselNumber: null, landingDate: '2026-06-01', invoiceNumber: null, createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z', items: [], ...overrides,
    });
    await saveLandingDataWorkbook([
      landing({
        id: 'later', landingDate: '2026-07-09', vesselId: 'v1', vesselName: 'Southern Star', vesselNumber: 'MNZ1234', invoiceNumber: 'INV-7',
        items: [
          { id: 'i1', displayOrder: 1, fishstockCode: 'SNA1', description: 'Snapper Auckland (East)', reportingUnit: 'greenweightKg', quantity: 12_345 },
          { id: 'i2', displayOrder: 2, fishstockCode: 'OYU5', description: 'Foveaux Strait dredge oyster', reportingUnit: 'count', quantity: 7 },
        ],
      }),
      landing({
        id: 'earlier', landingDate: '2026-06-30',
        items: [{ id: 'i3', displayOrder: 3, fishstockCode: 'SCA1', description: 'Scallop', reportingUnit: 'meatweightKg', quantity: 250 }],
      }),
    ], 'myLFR-landing-data-test');

    expect(written?.defaultName).toBe('myLFR-landing-data-test.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(written!.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Landing data']);
    const sheet = workbook.getWorksheet('Landing data')!;
    expect(sheet.getRow(1).values).toEqual([
      undefined, 'Date', 'Year', 'Month', 'Permit holder', 'Permit number', 'Vessel', 'Vessel number', 'Invoice number',
      'Fishstock code', 'Fishstock name', 'Fish type', 'Unit', 'Quantity',
    ]);
    expect(sheet.rowCount).toBe(4);
    // The earlier landing comes first; a missing vessel shows as shore-based.
    expect((sheet.getCell('A2').value as Date).toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(sheet.getRow(2).values).toEqual([
      undefined, sheet.getCell('A2').value, 2026, 6, 'Synthetic Fisher', 'PERMIT-1', 'Shore-based', '', '', 'SCA1', 'Scallop', 'SCA', 'Meatweight (kg)', 2.5,
    ]);
    // Within a landing the fishstocks are in code order, and each keeps its own unit.
    expect(sheet.getRow(3).values).toEqual([
      undefined, sheet.getCell('A3').value, 2026, 7, 'Synthetic Fisher', 'PERMIT-1', 'Southern Star', 'MNZ1234', 'INV-7', 'OYU5', 'Foveaux Strait dredge oyster', 'OYU', 'Count', 7,
    ]);
    expect(sheet.getCell('M4').value).toBe(123.45);
    expect(sheet.getCell('L4').value).toBe('Greenweight (kg)');
    expect(sheet.getCell('A2').numFmt).toBe('dd-mm-yyyy');
    expect(sheet.getCell('M3').numFmt).toBe('0');
    expect(sheet.getCell('M4').numFmt).toBe('0.00');
  });

  it('keeps count quantities as counts in report workbooks', async () => {
    await saveReportWorkbook({
      ...report,
      rows: [{ fishstockCode: 'OYU5', description: 'Foveaux Strait dredge oyster', reportingUnit: 'count', quantity: 7, landingCount: 1 }],
      vesselRows: [],
      unitTotals: [{ reportingUnit: 'count', quantity: 7 }],
    }, profile, { ...details, groupByFishType: false }, 'count-summary');

    const workbook = new ExcelJS.Workbook();
    const workbookBytes = Buffer.from(written!.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookBytes);
    const summary = workbook.getWorksheet('Summary');
    const headerRow = summary!.getColumn(1).values.findIndex((value) => value === 'Fishstock code');
    expect(summary?.getCell(headerRow + 1, 3).value).toBe(1);
    expect(summary?.getCell(headerRow + 1, 4).value).toBe(7);
    expect(summary?.getCell(headerRow + 1, 5).value).toBe('Count');
  });

  it('writes a standalone Unicode PDF without browser URL headers or footers', async () => {
    await saveReportPdf(report, profile, details, 'summary');

    expect(written?.defaultName).toBe('summary.pdf');
    expect(written?.fileType).toBe('pdf');
    expect(new TextDecoder().decode(written!.bytes.slice(0, 5))).toBe('%PDF-');
    expect(written!.bytes.length).toBeGreaterThan(1_000);
  });

  it('embeds the business logo in the PDF header when one is stored', async () => {
    await saveReportPdf(report, profile, details, 'summary');
    const withoutLogo = written!.bytes.length;

    logo = { dataBase64: LOGO_PNG_BASE64, width: 4, height: 2 };
    await saveReportPdf(report, profile, details, 'summary');

    expect(new TextDecoder().decode(written!.bytes.slice(0, 5))).toBe('%PDF-');
    expect(written!.bytes.length).toBeGreaterThan(withoutLogo);
  });

  it('still exports a PDF when the stored logo cannot be read', async () => {
    setDesktopTransportForTests(async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === 'get_business_logo') throw new Error('database is locked');
      written = {
        defaultName: String(args?.defaultName),
        fileType: String(args?.fileType),
        bytes: decodeBase64(String(args?.dataBase64)),
      };
      return true as T;
    });

    await saveReportPdf(report, profile, details, 'summary');

    expect(written?.fileType).toBe('pdf');
    expect(new TextDecoder().decode(written!.bytes.slice(0, 5))).toBe('%PDF-');
  });
});
