export interface BusinessProfile {
  lfrName: string;
  clientNumber: string;
  streetNumber: string;
  streetName: string;
  streetType: string;
  suburb: string;
  city: string;
  postcode: string;
  createdAt: string;
  updatedAt: string;
}

export type BusinessProfileInput = Omit<BusinessProfile, 'createdAt' | 'updatedAt'>;

export interface BusinessLogo {
  dataBase64: string;
  width: number;
  height: number;
}

export interface Vessel {
  id: string;
  fisherId: string;
  name: string;
  vesselNumber: string | null;
  isArchived: boolean;
  hasLandingHistory: boolean;
  registrationNeedsReview?: boolean;
  linkedPermitHolders?: string[];
  otherRecordedNames?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VesselInput {
  id?: string | null;
  name: string;
  vesselNumber: string;
  isArchived?: boolean;
  linkExisting?: boolean;
}

export interface RegisteredVessel {
  id: string;
  name: string;
  vesselNumber: string;
  linkedPermitHolders: string[];
}

export interface Fisher {
  id: string;
  name: string;
  permitNumber: string;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vessels: Vessel[];
}

export interface FisherInput {
  id?: string | null;
  name: string;
  permitNumber: string;
  vessels: VesselInput[];
}

export interface Fishstock {
  code: string;
  description: string;
  reportingUnit: ReportingUnit;
  isActive: boolean;
  isFavorite: boolean;
  isUserAdded: boolean;
}

/** A fishstock the receiver added. Only these can be edited or removed. */
export interface UserFishstock {
  code: string;
  description: string;
  reportingUnit: ReportingUnit;
  fishingYearStartMonth: 1 | 3 | 9;
  isFavorite: boolean;
  /** Current landings using the stock. Once any do, its code and unit are locked. */
  landingCount: number;
}

export interface NoticeAcknowledgement {
  version: number;
  acknowledgedAt: string;
}

export interface UserFishstockInput {
  code: string;
  description: string;
  reportingUnit: ReportingUnit;
  fishingYearStartMonth: 1 | 3 | 9;
}

export type ReportingUnit = 'greenweightKg' | 'meatweightKg' | 'count';

export interface LandingItem {
  id: string;
  fishstockCode: string;
  description: string;
  quantity: number;
  reportingUnit: ReportingUnit;
  displayOrder: number;
}

export interface LandingItemInput {
  fishstockCode: string;
  quantity: number;
}

export interface Landing {
  id: string;
  fisherId: string;
  fisherName: string;
  fisherNumber: string;
  vesselId: string | null;
  vesselName: string | null;
  vesselNumber: string | null;
  landingDate: string;
  invoiceNumber: string | null;
  createdAt: string;
  updatedAt: string;
  items: LandingItem[];
}

export interface LandingInput {
  id?: string | null;
  fisherId: string;
  vesselId?: string | null;
  landingDate: string;
  invoiceNumber?: string | null;
  items: LandingItemInput[];
}

export interface LandingFilters {
  fisherId?: string | null;
  vesselId?: string | null;
  fishstockCode?: string | null;
  invoiceNumber?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  limit?: number | null;
}

export interface LandingRevision {
  id: string;
  landingId: string;
  versionNumber: number;
  operation: 'save' | 'delete';
  fisherId: string | null;
  fisherName: string;
  fisherNumber: string;
  vesselId: string | null;
  vesselName: string | null;
  vesselNumber: string | null;
  landingDate: string;
  invoiceNumber: string | null;
  createdAt: string;
  items: LandingItem[];
}

export interface DashboardMetrics {
  activeFishers: number;
  activeVessels: number;
  landingCount: number;
  fishstockCount: number;
  unitTotals: UnitTotal[];
}

export interface UnitTotal {
  reportingUnit: ReportingUnit;
  quantity: number;
}

export interface ReportRow {
  fishstockCode: string;
  description: string;
  quantity: number;
  reportingUnit: ReportingUnit;
  landingCount: number;
}

export interface FishTypeReportRow {
  fishType: string;
  description: string;
  fishstocks: string[];
  quantity: number;
  reportingUnit: ReportingUnit;
  landingCount: number;
}

export interface VesselReportRow {
  fisherId: string;
  fisherName: string;
  fisherNumber: string;
  vesselId: string | null;
  vesselName: string | null;
  vesselNumber: string | null;
  fishstockCode: string;
  description: string;
  quantity: number;
  reportingUnit: ReportingUnit;
  landingCount: number;
}

export interface VesselFishTypeReportRow {
  fisherId: string;
  fisherName: string;
  fisherNumber: string;
  vesselId: string | null;
  vesselName: string | null;
  vesselNumber: string | null;
  fishType: string;
  description: string;
  fishstocks: string[];
  quantity: number;
  reportingUnit: ReportingUnit;
  landingCount: number;
}

export interface ReportResult {
  rows: ReportRow[];
  fishTypeRows: FishTypeReportRow[];
  vesselRows: VesselReportRow[];
  vesselFishTypeRows: VesselFishTypeReportRow[];
  landingCount: number;
  itemCount: number;
  unitTotals: UnitTotal[];
}

export interface BackupStatus {
  backupDirectory: string | null;
  lastBackupAt: string | null;
  lastBackupPath: string | null;
  destinationAvailable: boolean;
  sameDeviceWarning: boolean;
  isStale: boolean;
}

export interface AppInfo {
  version: string;
  databasePath: string;
  schemaVersion: number;
  catalogueVersion: number;
}

export interface FullExport {
  businessProfile: BusinessProfile | null;
  fishers: Fisher[];
  favoriteFishstocks: Fishstock[];
  userFishstocks: UserFishstock[];
  landings: Landing[];
  landingRevisions: LandingRevision[];
  deletedLandings: LandingRevision[];
  schemaVersion: number;
  catalogueVersion: number;
  exportedAt: string;
}

export interface CommandError {
  code: string;
  message: string;
}
