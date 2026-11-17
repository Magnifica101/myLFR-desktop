import type { Column, Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { addressLines } from './address';
import { desktop } from './desktop';
import { formatDate, formatDateTime, formatQuantityValue, reportingUnitLabel, reportingUnitShortLabel, toBase64 } from './format';
import { fishingYearLabel } from './fishingYear';
import type {
  BusinessProfile,
  FishTypeReportRow,
  FullExport,
  Landing,
  ReportResult,
  ReportRow,
  VesselFishTypeReportRow,
  VesselReportRow,
} from './types';

export interface ReportDetails {
  title: string;
  period: string;
  permitHolderName: string;
  permitNumber?: string | null;
  vesselName?: string | null;
  vesselNumber?: string | null;
  groupByFishType?: boolean;
  /** The landings behind the report. When given, each vessel sheet ends with every fishstock line on them. */
  landings?: Landing[];
}

/** A file name part made safe for Windows: no reserved characters, and hyphens for spaces. */
export function fileNamePart(text: string) {
  return text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().replace(/\s+/g, '-');
}

const LANDING_LINE_HEADERS = ['Date', 'Invoice number', 'Fishstock code', 'Fishstock name', 'Fish type', 'Quantity', 'Unit'];

type SectionCell = string | number | Date;

/**
 * Writes a headed section as an Excel table, with its own filter buttons and
 * striped rows, starting on the next free row. Returns the table's header row.
 * `tableName` must be unique in the workbook.
 */
function addSectionTable(sheet: import('exceljs').Worksheet, heading: string, tableName: string, headers: string[], rows: SectionCell[][]) {
  sheet.addRow([heading]).font = { bold: true, size: 13 };
  const headerRow = sheet.rowCount + 1;
  if (!rows.length) {
    // Excel cannot open a table with no rows, so an empty section is a plain header.
    sheet.addRow(headers).font = { bold: true };
    return headerRow;
  }
  sheet.addTable({
    name: tableName,
    ref: `A${headerRow}`,
    headerRow: true,
    style: { theme: 'TableStyleLight1', showRowStripes: true },
    columns: headers.map((name) => ({ name, filterButton: true })),
    rows,
  });
  return headerRow;
}

/** One row for each fishstock on each landing, earliest landing first and codes in order within it. */
function landingLines(landings: Landing[]) {
  return [...landings]
    .sort((left, right) => left.landingDate.localeCompare(right.landingDate) || left.createdAt.localeCompare(right.createdAt))
    .flatMap((landing) => [...landing.items]
      .sort((left, right) => compareText(left.fishstockCode, right.fishstockCode))
      .map((item) => {
        const [year, month, day] = landing.landingDate.split('-').map(Number);
        return { reportingUnit: item.reportingUnit, cells: [
          new Date(Date.UTC(year, month - 1, day)),
          landing.invoiceNumber ?? '',
          item.fishstockCode,
          item.description,
          item.fishstockCode.slice(0, 3),
          quantityNumber(item.quantity, item.reportingUnit),
          reportingUnitShortLabel(item.reportingUnit),
        ] as SectionCell[] };
      }));
}

function vesselLandings(details: ReportDetails, fisherId: string, vesselId: string | null) {
  return details.landings?.filter((landing) => landing.fisherId === fisherId && (landing.vesselId ?? null) === vesselId);
}

const compareText = (left: string, right: string) => left.localeCompare(right, 'en-NZ', { sensitivity: 'base' });

function quantityNumber(quantity: number, unit: ReportRow['reportingUnit']) {
  return unit === 'count' ? quantity : quantity / 100;
}

function unitTotalsText(report: ReportResult) {
  return report.unitTotals.map((total) => `${formatQuantityValue(total.quantity, total.reportingUnit)} ${reportingUnitShortLabel(total.reportingUnit)}`).join(' • ');
}

function rowTotalsText(rows: Array<{ quantity: number; reportingUnit: ReportRow['reportingUnit'] }>) {
  const totals = new Map<ReportRow['reportingUnit'], number>();
  for (const row of rows) totals.set(row.reportingUnit, (totals.get(row.reportingUnit) ?? 0) + row.quantity);
  return [...totals.entries()].map(([unit, quantity]) => `${formatQuantityValue(quantity, unit)} ${reportingUnitShortLabel(unit)}`).join(' • ');
}

export function sortReportRows(rows: ReportRow[]) {
  return [...rows].sort((left, right) => compareText(left.fishstockCode, right.fishstockCode));
}

export function sortVesselRows(rows: VesselReportRow[]) {
  return [...rows].sort((left, right) =>
    compareText(left.fisherName, right.fisherName)
    || compareText(left.vesselName ?? 'Shore-based', right.vesselName ?? 'Shore-based')
    || compareText(left.fishstockCode, right.fishstockCode));
}

export function sortFishTypeRows(rows: FishTypeReportRow[]) {
  return [...rows].sort((left, right) => compareText(left.fishType, right.fishType));
}

export function sortVesselFishTypeRows(rows: VesselFishTypeReportRow[]) {
  return [...rows].sort((left, right) =>
    compareText(left.fisherName, right.fisherName)
    || compareText(left.vesselName ?? 'Shore-based', right.vesselName ?? 'Shore-based')
    || compareText(left.fishType, right.fishType));
}

function reportMetadata(profile: BusinessProfile | null, details: ReportDetails) {
  const lines = [
    profile?.lfrName ?? 'LFR',
    profile?.clientNumber ? `Client number: ${profile.clientNumber}` : '',
    ...(profile ? addressLines(profile) : []),
    `Period: ${details.period}`,
    `Permit holder: ${details.permitHolderName}`,
    details.permitNumber ? `Permit number: ${details.permitNumber}` : '',
    details.vesselName ? `Vessel: ${details.vesselName}${details.vesselNumber ? ` — ${details.vesselNumber}` : ''}` : '',
  ];
  return lines.filter(Boolean);
}

function monthlySummaryPdfMetadata(profile: BusinessProfile | null, details: ReportDetails): Content[] {
  const businessName = profile?.lfrName || 'LFR';
  const businessNumber = profile?.clientNumber ? ` - ${profile.clientNumber}` : '';
  const address = profile ? addressLines(profile) : [];
  const streetAndSuburb = address.slice(0, 2).filter(Boolean).join(', ');
  const businessLines = [
    `${businessName}${businessNumber}`,
    streetAndSuburb,
    address[2],
  ].filter(Boolean);
  const permitHolder = `${details.permitHolderName}${details.permitNumber ? ` - ${details.permitNumber}` : ''}`;
  const lines: Content[] = [
    ...businessLines.map((text): Content => ({ text, bold: true, margin: [0, 1, 0, 1] })),
    { text: permitHolder, bold: true, margin: [0, 8, 0, 1] },
  ];
  if (details.vesselName) {
    lines.push({ text: `Vessel: ${details.vesselName}${details.vesselNumber ? ` - ${details.vesselNumber}` : ''}`, margin: [0, 1, 0, 1] });
  }
  return lines;
}

function monthlySummaryPdfTable(report: ReportResult): TableCell[][] {
  const body: TableCell[][] = [
    ['Fishstock', 'Description', { text: 'Landings', alignment: 'right' }, { text: 'Total', alignment: 'right' }, 'Unit'],
  ];
  for (const group of sortFishTypeRows(report.fishTypeRows)) {
    const stockRows = sortReportRows(report.rows.filter((row) => (
      group.fishstocks.includes(row.fishstockCode) && row.reportingUnit === group.reportingUnit
    )));
    for (const row of stockRows) {
      body.push([
        row.fishstockCode,
        row.description,
        { text: String(row.landingCount), alignment: 'right' },
        { text: formatQuantityValue(row.quantity, row.reportingUnit), alignment: 'right' },
        reportingUnitShortLabel(row.reportingUnit),
      ]);
    }
    body.push([
      { text: `${group.fishType} total`, bold: true, fillColor: '#e8e8e8' },
      { text: group.description, bold: true, fillColor: '#e8e8e8' },
      { text: String(group.landingCount), alignment: 'right', bold: true, fillColor: '#e8e8e8' },
      { text: formatQuantityValue(group.quantity, group.reportingUnit), alignment: 'right', bold: true, fillColor: '#e8e8e8' },
      { text: reportingUnitShortLabel(group.reportingUnit), bold: true, fillColor: '#e8e8e8' },
    ]);
  }
  return body;
}

function worksheetName(label: string, usedNames: Set<string>) {
  const cleaned = label.replace(/[\\/*?:\[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Vessel';
  let suffix = '';
  let counter = 1;
  while (true) {
    const candidate = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    if (!usedNames.has(candidate.toLocaleLowerCase('en-NZ'))) {
      usedNames.add(candidate.toLocaleLowerCase('en-NZ'));
      return candidate;
    }
    counter += 1;
    suffix = ` (${counter})`;
  }
}

export async function saveReportWorkbook(
  report: ReportResult,
  profile: BusinessProfile | null,
  details: ReportDetails,
  defaultName: string,
) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'myLFR Desktop';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Summary');
  summary.addRow([details.title]);
  for (const line of reportMetadata(profile, details)) summary.addRow([line]);
  summary.addRow([`Totals: ${unitTotalsText(report)}`]);
  summary.addRow([`${report.landingCount} landings; ${report.itemCount} fishstock entries`]);
  summary.addRow([]);
  const summaryHeader = details.groupByFishType
    ? summary.addRow(['Fish type', 'Description', 'Fishstocks', 'Landing count', 'Total', 'Unit'])
    : summary.addRow(['Fishstock code', 'Description', 'Landing count', 'Total', 'Unit']);
  if (details.groupByFishType) {
    for (const row of sortFishTypeRows(report.fishTypeRows)) {
      summary.addRow([
        row.fishType,
        row.description,
        row.fishstocks.join(', '),
        row.landingCount,
        quantityNumber(row.quantity, row.reportingUnit),
        reportingUnitShortLabel(row.reportingUnit),
      ]);
    }
  } else {
    for (const row of sortReportRows(report.rows)) {
      summary.addRow([
        row.fishstockCode,
        row.description,
        row.landingCount,
        quantityNumber(row.quantity, row.reportingUnit),
        reportingUnitShortLabel(row.reportingUnit),
      ]);
    }
  }
  summary.getRow(1).font = { bold: true, size: 16 };
  summaryHeader.font = { bold: true };
  summary.views = [{ state: 'frozen', ySplit: summaryHeader.number }];
  summary.autoFilter = { from: { row: summaryHeader.number, column: 1 }, to: { row: summaryHeader.number, column: details.groupByFishType ? 6 : 5 } };
  summary.columns = details.groupByFishType
    ? [{ width: 14 }, { width: 36 }, { width: 32 }, { width: 16 }, { width: 16 }, { width: 12 }]
    : [{ width: 18 }, { width: 52 }, { width: 16 }, { width: 16 }, { width: 12 }];

  const usedNames = new Set(['summary']);
  if (details.groupByFishType) {
    const groups = new Map<string, VesselFishTypeReportRow[]>();
    for (const row of sortVesselFishTypeRows(report.vesselFishTypeRows)) {
      const key = `${row.fisherId}\0${row.vesselId ?? 'shore-based'}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    let vesselIndex = 0;
    for (const rows of groups.values()) {
      vesselIndex += 1;
      const vessel = rows[0];
      const vesselName = vessel.vesselName ?? 'Shore-based';
      const sheet = workbook.addWorksheet(worksheetName(vesselName, usedNames));
      sheet.addRow([details.title]);
      sheet.addRow([`Permit holder: ${vessel.fisherName}`]);
      sheet.addRow([`Permit number: ${vessel.fisherNumber}`]);
      sheet.addRow([`Vessel: ${vesselName}`]);
      if (vessel.vesselNumber) sheet.addRow([`Vessel number: ${vessel.vesselNumber}`]);
      sheet.addRow([`Period: ${details.period}`]);
      sheet.addRow([`Totals: ${rowTotalsText(rows)}`]);
      sheet.addRow([]);
      sheet.getRow(1).font = { bold: true, size: 16 };
      // (a) The vessel's totals by fish type.
      const summaryHeader = addSectionTable(sheet, 'Summary', `Vessel${vesselIndex}Summary`,
        ['Fish type', 'Description', 'Fishstocks', 'Landing count', 'Total', 'Unit'],
        rows.map((row) => [row.fishType, row.description, row.fishstocks.join(', '), row.landingCount, quantityNumber(row.quantity, row.reportingUnit), reportingUnitShortLabel(row.reportingUnit)]));
      sheet.views = [{ state: 'frozen', ySplit: summaryHeader }];
      // (b) Every fishstock line on the vessel's landings.
      const landings = vesselLandings(details, vessel.fisherId, vessel.vesselId);
      if (landings) {
        const lines = landingLines(landings);
        sheet.addRow([]);
        const linesHeader = addSectionTable(sheet, 'Landings', `Vessel${vesselIndex}Landings`, LANDING_LINE_HEADERS, lines.map((line) => line.cells));
        lines.forEach((line, index) => {
          const row = sheet.getRow(linesHeader + 1 + index);
          row.getCell(1).numFmt = 'dd-mm-yyyy';
          row.getCell(6).numFmt = line.reportingUnit === 'count' ? '0' : '0.00';
        });
      }
      sheet.columns = [{ width: 14 }, { width: 36 }, { width: 32 }, { width: landings ? 40 : 16 }, { width: 16 }, { width: 16 }, { width: 12 }];
    }
  } else {
    const groups = new Map<string, VesselReportRow[]>();
    for (const row of sortVesselRows(report.vesselRows)) {
      const key = `${row.fisherId}\0${row.vesselId ?? 'shore-based'}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const rows of groups.values()) {
      const vessel = rows[0];
      const vesselName = vessel.vesselName ?? 'Shore-based';
      const sheet = workbook.addWorksheet(worksheetName(vesselName, usedNames));
      sheet.addRow([details.title]);
      sheet.addRow([`Permit holder: ${vessel.fisherName}`]);
      sheet.addRow([`Permit number: ${vessel.fisherNumber}`]);
      sheet.addRow([`Vessel: ${vesselName}`]);
      if (vessel.vesselNumber) sheet.addRow([`Vessel number: ${vessel.vesselNumber}`]);
      sheet.addRow([`Period: ${details.period}`]);
      sheet.addRow([`Totals: ${rowTotalsText(rows)}`]);
      sheet.addRow([]);
      const header = sheet.addRow(['Fishstock code', 'Description', 'Landing count', 'Total', 'Unit']);
      for (const row of rows) {
        sheet.addRow([row.fishstockCode, row.description, row.landingCount, quantityNumber(row.quantity, row.reportingUnit), reportingUnitShortLabel(row.reportingUnit)]);
      }
      sheet.getRow(1).font = { bold: true, size: 16 };
      header.font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: header.number }];
      sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: 5 } };
      sheet.columns = [{ width: 18 }, { width: 52 }, { width: 16 }, { width: 16 }, { width: 12 }];
    }
  }

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return desktop.saveExportFile(`${defaultName}.xlsx`, 'xlsx', toBase64(bytes));
}

/**
 * Read the branding logo for the report header. A missing or failed logo must
 * never block an export, so any error falls back to the text-only header.
 */
async function loadReportLogo() {
  try {
    return await desktop.getBusinessLogo();
  } catch {
    return null;
  }
}

export async function saveReportPdf(
  report: ReportResult,
  profile: BusinessProfile | null,
  details: ReportDetails,
  defaultName: string,
) {
  const [pdfMake, virtualFonts] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const pdfRuntime = pdfMake as unknown as {
    addVirtualFileSystem: (files: Record<string, string>) => void;
  };
  pdfRuntime.addVirtualFileSystem((virtualFonts.default ?? virtualFonts) as unknown as Record<string, string>);

  const metadata: Content[] = (details.groupByFishType
    ? monthlySummaryPdfMetadata(profile, details)
    : reportMetadata(profile, details).map((line) => ({ text: line, margin: [0, 1, 0, 1] })));
  const logo = await loadReportLogo();
  const titleBlock: Content[] = [{ text: details.title, style: 'title' }, ...metadata];
  // With a logo the header becomes two columns so the image sits beside the
  // title instead of pushing the table down the page.
  const headerColumns: Column[] = logo
    ? [
      { width: '*', stack: titleBlock },
      // No explicit width: pdfmake types reserve `width` on an image for the
      // drawn size, and `fit` already caps the box. Columns default to 'auto'.
      { image: `data:image/png;base64,${logo.dataBase64}`, fit: [110, 70], alignment: 'right' },
    ]
    : [];
  const header: Content = logo ? { columns: headerColumns } : { stack: titleBlock };
  const continuationHeader = (currentPage: number): Content => currentPage === 1
    ? { text: '', margin: [36, 18, 36, 0] }
    : {
      text: `${details.permitHolderName}${details.permitNumber ? ` - ${details.permitNumber}` : ''} • ${details.period}`,
      alignment: 'right',
      fontSize: 8,
      color: '#53636b',
      margin: [36, 18, 36, 0],
    };
  const pageFooter = (currentPage: number, pageCount: number): Content => ({
    text: `Page ${currentPage} of ${pageCount}`,
    alignment: 'right',
    fontSize: 8,
    color: '#53636b',
    margin: [0, 0, 36, 18],
  });
  const tableBody: TableCell[][] = details.groupByFishType
    ? monthlySummaryPdfTable(report)
    : [
      ['Fishstock', 'Description', { text: 'Landings', alignment: 'right' }, { text: 'Total', alignment: 'right' }, 'Unit'],
      ...sortReportRows(report.rows).map((row): TableCell[] => [
        row.fishstockCode,
        row.description,
        { text: String(row.landingCount), alignment: 'right' },
        { text: formatQuantityValue(row.quantity, row.reportingUnit), alignment: 'right' },
        reportingUnitShortLabel(row.reportingUnit),
      ]),
    ];
  const document: TDocumentDefinitions = {
    info: { title: details.title, creator: 'myLFR Desktop' },
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: details.groupByFishType ? [36, 54, 36, 48] : [36, 36, 36, 36],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    ...(details.groupByFishType ? { header: continuationHeader, footer: pageFooter } : {}),
    content: [
      header,
      {
        text: `${details.groupByFishType ? `${details.period} • ` : ''}${report.landingCount} landings • ${report.itemCount} fishstock entries • ${unitTotalsText(report)}`,
        margin: [0, 8, 0, 10],
        bold: true,
      },
      {
        table: {
          headerRows: 1,
          widths: details.groupByFishType ? [58, '*', 48, 65, 48] : [55, '*', 42, 65, 48],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
      },
    ],
    styles: {
      title: { fontSize: 18, bold: true, color: '#0b4f54', margin: [0, 0, 0, 10] },
    },
  };

  const buffer = await new Promise<Buffer>((resolve) => pdfMake.createPdf(document).getBuffer(resolve));
  const bytes = new Uint8Array(buffer);
  return desktop.saveExportFile(`${defaultName}.pdf`, 'pdf', toBase64(bytes));
}

interface DataColumn {
  header: string;
  width: number;
  numFmt?: string;
}

type CellValue = string | number | null;

function addDataSheet(
  workbook: import('exceljs').Workbook,
  name: string,
  usedNames: Set<string>,
  columns: DataColumn[],
  rows: CellValue[][],
) {
  const sheet = workbook.addWorksheet(worksheetName(name, usedNames));
  const header = sheet.addRow(columns.map((column) => column.header));
  header.font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  sheet.columns = columns.map((column) => ({ width: column.width }));
  columns.forEach((column, index) => {
    if (column.numFmt) sheet.getColumn(index + 1).numFmt = column.numFmt;
  });
  return sheet;
}

const REPORTING_UNIT = { header: 'Unit', width: 12 } as const;
const QUANTITY = { header: 'Total', width: 16 } as const;

export async function saveFullDataWorkbook(data: FullExport, defaultName: string) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'myLFR Desktop';
  workbook.created = new Date();
  const usedNames = new Set<string>();

  const profile = data.businessProfile;
  const vesselCount = data.fishers.reduce((sum, fisher) => sum + fisher.vessels.length, 0);

  addDataSheet(workbook, 'Overview', usedNames, [
    { header: 'Item', width: 30 },
    { header: 'Value', width: 40 },
  ], [
    ['Export created', formatDateTime(data.exportedAt)],
    ['Business', profile?.lfrName ?? '—'],
    ['Client number', profile?.clientNumber ?? '—'],
    ['Permit holders', data.fishers.length],
    ['Vessels', vesselCount],
    ['Favourite fishstocks', data.favoriteFishstocks.length],
    ['Fishstocks you added', data.userFishstocks.length],
    ['Landings', data.landings.length],
    ['Landing history entries', data.landingRevisions.length],
    ['Database schema version', data.schemaVersion],
    ['Fishstock catalogue version', data.catalogueVersion],
  ]);

  addDataSheet(workbook, 'Business details', usedNames, [
    { header: 'Field', width: 24 },
    { header: 'Value', width: 52 },
  ], profile ? [
    ['LFR name', profile.lfrName],
    ['Client number', profile.clientNumber],
    ['Street number', profile.streetNumber],
    ['Street name', profile.streetName],
    ['Street type', profile.streetType],
    ['Suburb', profile.suburb],
    ['City', profile.city],
    ['Postcode', profile.postcode],
    ['First recorded', formatDateTime(profile.createdAt)],
    ['Last updated', formatDateTime(profile.updatedAt)],
  ] : [['Business details', 'Not recorded yet']]);

  addDataSheet(workbook, 'Permit holders', usedNames, [
    { header: 'Name', width: 28 },
    { header: 'Permit number', width: 18 },
    { header: 'Status', width: 12 },
    { header: 'Archived on', width: 20 },
    { header: 'First recorded', width: 20 },
  ], data.fishers.map((fisher) => [
    fisher.name,
    fisher.permitNumber,
    fisher.isArchived ? 'Archived' : 'Active',
    fisher.archivedAt ? formatDateTime(fisher.archivedAt) : '',
    formatDateTime(fisher.createdAt),
  ]));

  addDataSheet(workbook, 'Vessels', usedNames, [
    { header: 'Permit holder', width: 28 },
    { header: 'Permit number', width: 18 },
    { header: 'Vessel name', width: 24 },
    { header: 'Vessel number', width: 18 },
    { header: 'Status', width: 12 },
    { header: 'First recorded', width: 20 },
  ], data.fishers.flatMap((fisher) => fisher.vessels.map((vessel) => [
    fisher.name,
    fisher.permitNumber,
    vessel.name,
    vessel.vesselNumber ?? '',
    vessel.isArchived ? 'Archived' : 'Active',
    formatDateTime(vessel.createdAt),
  ])));

  addDataSheet(workbook, 'Favourite fishstocks', usedNames, [
    { header: 'Code', width: 14 },
    { header: 'Description', width: 48 },
    { header: 'Currently active', width: 16 },
  ], data.favoriteFishstocks.map((stock) => [
    stock.code,
    stock.description,
    stock.isActive ? 'Yes' : 'No',
  ]));

  addDataSheet(workbook, 'Fishstocks you added', usedNames, [
    { header: 'Code', width: 14 },
    { header: 'Name', width: 40 },
    { header: 'Measured in', width: 18 },
    { header: 'Fishing year', width: 26 },
    { header: 'Landings', width: 12 },
  ], data.userFishstocks.map((stock) => [
    stock.code,
    stock.description,
    reportingUnitLabel(stock.reportingUnit),
    fishingYearLabel(stock.fishingYearStartMonth),
    stock.landingCount,
  ]));

  addDataSheet(workbook, 'Landings', usedNames, [
    { header: 'Landing date', width: 16 },
    { header: 'Permit holder', width: 24 },
    { header: 'Permit number', width: 16 },
    { header: 'Vessel', width: 20 },
    { header: 'Vessel number', width: 16 },
    { header: 'Invoice number', width: 18 },
    { header: 'Fishstock', width: 12 },
    { header: 'Description', width: 40 },
    QUANTITY,
    REPORTING_UNIT,
    { header: 'Recorded', width: 20 },
  ], data.landings.flatMap((landing) => {
    const items = landing.items.length ? landing.items : [null];
    return items.map((item) => [
      formatDate(landing.landingDate),
      landing.fisherName,
      landing.fisherNumber,
      landing.vesselName ?? 'Shore-based',
      landing.vesselNumber ?? '',
      landing.invoiceNumber ?? '',
      item?.fishstockCode ?? '',
      item?.description ?? '',
      item ? quantityNumber(item.quantity, item.reportingUnit) : null,
      item ? reportingUnitShortLabel(item.reportingUnit) : '',
      formatDateTime(landing.createdAt),
    ]);
  }));

  addDataSheet(workbook, 'Landing history', usedNames, [
    { header: 'Recorded', width: 20 },
    { header: 'Change', width: 12 },
    { header: 'Version', width: 10 },
    { header: 'Landing date', width: 16 },
    { header: 'Permit holder', width: 24 },
    { header: 'Vessel', width: 20 },
    { header: 'Invoice number', width: 18 },
    { header: 'Fishstock', width: 12 },
    { header: 'Description', width: 40 },
    QUANTITY,
    REPORTING_UNIT,
  ], data.landingRevisions.flatMap((revision) => {
    const items = revision.items.length ? revision.items : [null];
    return items.map((item) => [
      formatDateTime(revision.createdAt),
      revision.operation === 'delete' ? 'Deleted' : 'Saved',
      revision.versionNumber,
      formatDate(revision.landingDate),
      revision.fisherName,
      revision.vesselName ?? 'Shore-based',
      revision.invoiceNumber ?? '',
      item?.fishstockCode ?? '',
      item?.description ?? '',
      item ? quantityNumber(item.quantity, item.reportingUnit) : null,
      item ? reportingUnitShortLabel(item.reportingUnit) : '',
    ]);
  }));

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return desktop.saveExportFile(`${defaultName}.xlsx`, 'xlsx', toBase64(bytes));
}

/** The columns of the landing data export, in order. */
export const LANDING_DATA_COLUMNS: ReadonlyArray<{ header: string; description: string }> = [
  { header: 'Date', description: 'The received date.' },
  { header: 'Year', description: 'The year of the received date.' },
  { header: 'Month', description: 'The month of the received date, 1 to 12.' },
  { header: 'Permit holder', description: 'The permit holder\'s name.' },
  { header: 'Permit number', description: 'The permit holder\'s permit number.' },
  { header: 'Vessel', description: 'The vessel name, or Shore-based.' },
  { header: 'Vessel number', description: 'The vessel number, empty for shore-based.' },
  { header: 'Invoice number', description: 'The invoice number, empty if none was entered.' },
  { header: 'Fishstock code', description: 'For example SNA1.' },
  { header: 'Fishstock name', description: 'The fishstock\'s name, such as Snapper Auckland (East).' },
  { header: 'Fish type', description: 'The first three letters of the code, such as SNA.' },
  { header: 'Unit', description: 'Greenweight (kg), Meatweight (kg) or Count.' },
  { header: 'Quantity', description: 'Number of units.' },
];

/**
 * One row per fishstock on each landing, with every field in its own column,
 * for pivot tables. Landings are put in date order. Units stay in a column of
 * their own because kilograms and counts must never be added together.
 */
export async function saveLandingDataWorkbook(landings: Landing[], defaultName: string) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'myLFR Desktop';
  workbook.created = new Date();

  const ordered = [...landings].sort((left, right) => left.landingDate.localeCompare(right.landingDate)
    || compareText(left.fisherName, right.fisherName)
    || left.createdAt.localeCompare(right.createdAt));
  const widths = [13, 8, 8, 26, 16, 22, 16, 18, 16, 40, 11, 18, 14];
  const rows = ordered.flatMap((landing) => {
    const [year, month, day] = landing.landingDate.split('-').map(Number);
    return [...landing.items].sort((left, right) => compareText(left.fishstockCode, right.fishstockCode)).map((item) => [
      new Date(Date.UTC(year, month - 1, day)),
      year,
      month,
      landing.fisherName,
      landing.fisherNumber,
      landing.vesselName ?? 'Shore-based',
      landing.vesselNumber ?? '',
      landing.invoiceNumber ?? '',
      item.fishstockCode,
      item.description,
      item.fishstockCode.slice(0, 3),
      reportingUnitLabel(item.reportingUnit),
      quantityNumber(item.quantity, item.reportingUnit),
    ] as Array<string | number | Date>);
  });

  const sheet = workbook.addWorksheet('Landing data');
  const header = sheet.addRow(LANDING_DATA_COLUMNS.map((column) => column.header));
  header.font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: LANDING_DATA_COLUMNS.length } };
  sheet.columns = widths.map((width) => ({ width }));
  sheet.getColumn(1).numFmt = 'dd-mm-yyyy';
  // Kilograms show two decimal places; whole counts show none.
  rows.forEach((row, index) => {
    sheet.getCell(index + 2, 13).numFmt = row[11] === reportingUnitLabel('count') ? '0' : '0.00';
  });

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return desktop.saveExportFile(`${defaultName}.xlsx`, 'xlsx', toBase64(bytes));
}
