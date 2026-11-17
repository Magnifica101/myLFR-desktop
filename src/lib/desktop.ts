import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AppInfo,
  BackupStatus,
  BusinessLogo,
  BusinessProfile,
  BusinessProfileInput,
  DashboardMetrics,
  Fisher,
  FisherInput,
  Fishstock,
  FullExport,
  Landing,
  LandingFilters,
  LandingInput,
  LandingRevision,
  NoticeAcknowledgement,
  ReportResult,
  UserFishstock,
  UserFishstockInput,
  Vessel,
  VesselInput,
  RegisteredVessel,
} from './types';

export type DesktopTransport = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type ExportFileType = 'json' | 'xlsx' | 'pdf';
export interface BackupSelection {
  token: string;
  schemaVersion: number;
  catalogueVersion: number;
}
export interface AppUpdateCheck {
  status: 'throttled' | 'current' | 'available';
  version: string | null;
  /** Release notes published with the available version, as plain text. */
  notes: string | null;
}
export type UpdateMode = 'manual' | 'automatic';
export interface UpdateStatus {
  mode: UpdateMode;
  /** Show the monthly reminder bar. */
  reminderDue: boolean;
  /** Keep the Settings marker, even after the reminder was set aside. */
  reminderPending: boolean;
  automaticCheckDue: boolean;
  lastSuccessfulCheck: string | null;
}
export type UpdateProgress =
  | { stage: 'backingUp' }
  | { stage: 'downloading'; downloaded: number; total: number | null }
  | { stage: 'installing' };

type ChannelFactory = <T>(onMessage: (message: T) => void) => unknown;

const nativeChannel: ChannelFactory = <T,>(onMessage: (message: T) => void) => {
  const channel = new Channel<T>();
  channel.onmessage = onMessage;
  return channel;
};

let transport: DesktopTransport = (command, args) => invoke(command, args);
let createChannel: ChannelFactory = nativeChannel;

/** Tests replace the native bridge. A test channel is a plain object whose
 * `onmessage` the test transport can call to simulate progress. */
export function setDesktopTransportForTests(next: DesktopTransport) {
  transport = next;
  createChannel = (onMessage) => ({ onmessage: onMessage });
}

export function resetDesktopTransportForTests() {
  transport = (command, args) => invoke(command, args);
  createChannel = nativeChannel;
}

export const desktop = {
  getBusinessProfile: () => transport<BusinessProfile | null>('get_business_profile'),
  saveBusinessProfile: (input: BusinessProfileInput) =>
    transport<BusinessProfile>('save_business_profile', { input }),
  getBusinessLogo: () => transport<BusinessLogo | null>('get_business_logo'),
  setBusinessLogo: (dataBase64: string, width: number, height: number) =>
    transport<BusinessLogo>('set_business_logo', { dataBase64, width, height }),
  clearBusinessLogo: () => transport<void>('clear_business_logo'),
  getNoticeAcknowledgement: () =>
    transport<NoticeAcknowledgement | null>('get_notice_acknowledgement'),
  acknowledgeNotice: (version: number) =>
    transport<NoticeAcknowledgement>('acknowledge_notice', { version }),
  getFishingYearStartMonth: () =>
    transport<1 | 3 | 9>('get_fishing_year_start_month'),
  setFishingYearStartMonth: (startMonth: 1 | 3 | 9) =>
    transport<1 | 3 | 9>('set_fishing_year_start_month', { startMonth }),
  listFishers: (includeArchived = false) =>
    transport<Fisher[]>('list_fishers', { includeArchived }),
  getFisher: (id: string) => transport<Fisher>('get_fisher', { id }),
  upsertFisher: (input: FisherInput) => transport<Fisher>('upsert_fisher', { input }),
  setFisherArchived: (id: string, archived: boolean) =>
    transport<Fisher>('set_fisher_archived', { id, archived }),
  removeFisher: (id: string) => transport<void>('remove_fisher', { id }),
  listVessels: (fisherId: string) => transport<Vessel[]>('list_vessels', { fisherId }),
  getVessel: (fisherId: string, id: string) => transport<Vessel>('get_vessel', { fisherId, id }),
  findVesselByNumber: (number: string) => transport<RegisteredVessel | null>('find_vessel_by_number', { number }),
  upsertVessel: (fisherId: string, input: VesselInput) =>
    transport<Vessel>('upsert_vessel', { fisherId, input }),
  removeVessel: (fisherId: string, id: string) => transport<void>('remove_vessel', { fisherId, id }),
  searchFishstocks: (query: string, limit = 30) =>
    transport<Fishstock[]>('search_fishstocks', { query, limit }),
  listFavoriteFishstocks: () => transport<Fishstock[]>('list_favorite_fishstocks'),
  setFishstockFavorite: (code: string, favorite: boolean) =>
    transport<void>('set_fishstock_favorite', { code, favorite }),
  listUserFishstocks: () => transport<UserFishstock[]>('list_user_fishstocks'),
  addUserFishstock: (input: UserFishstockInput) =>
    transport<UserFishstock>('add_user_fishstock', { input }),
  updateUserFishstock: (code: string, input: UserFishstockInput) =>
    transport<UserFishstock>('update_user_fishstock', { code, input }),
  removeUserFishstock: (code: string) => transport<void>('remove_user_fishstock', { code }),
  listLandings: (filters: LandingFilters = {}) =>
    transport<Landing[]>('list_landings', { filters }),
  listLandingYears: () => transport<number[]>('list_landing_years'),
  listPreviousLandingFishstocks: (fisherId: string, vesselId: string | null, excludeLandingId?: string | null) =>
    transport<Fishstock[]>('list_previous_landing_fishstocks', { fisherId, vesselId, excludeLandingId: excludeLandingId ?? null }),
  getLanding: (id: string) => transport<Landing>('get_landing', { id }),
  saveLanding: (input: LandingInput) => transport<Landing>('save_landing', { input }),
  deleteLanding: (id: string) => transport<void>('delete_landing', { id }),
  listLandingRevisions: (landingId: string) =>
    transport<LandingRevision[]>('list_landing_revisions', { landingId }),
  listDeletedLandings: (limit = 200) =>
    transport<LandingRevision[]>('list_deleted_landings', { limit }),
  dashboardMetrics: (fromDate: string, toDate: string, fishingYearStartMonth: 1 | 3 | 9) =>
    transport<DashboardMetrics>('dashboard_metrics', { fromDate, toDate, fishingYearStartMonth }),
  landingReport: (filters: LandingFilters) =>
    transport<ReportResult>('landing_report', { filters }),
  fullExport: () => transport<FullExport>('full_export'),
  getBackupStatus: () => transport<BackupStatus>('get_backup_status'),
  chooseBackupDirectory: () =>
    transport<BackupStatus | null>('choose_backup_directory'),
  openBackupFolder: () => transport<void>('open_backup_folder'),
  backupNow: () => transport<string>('backup_now'),
  selectBackupForRestore: () =>
    transport<BackupSelection | null>('select_backup_for_restore'),
  restoreBackup: (token: string) => transport<void>('restore_backup', { token }),
  getAppInfo: () => transport<AppInfo>('get_app_info'),
  openApprovedExternalLink: (url: string) =>
    transport<void>('open_approved_external_link', { url }),
  beginAppUpdateCheck: () => transport<boolean>('begin_app_update_check'),
  /** A manual check always runs; an automatic one is skipped within 24 hours of the last successful check. */
  checkAppUpdate: (manual: boolean) => transport<AppUpdateCheck>('check_app_update', { manual }),
  installAppUpdate: (version: string, backupFirst: boolean, onProgress: (progress: UpdateProgress) => void) =>
    transport<void>('install_app_update', { version, backupFirst, onProgress: createChannel(onProgress) }),
  getUpdateStatus: () => transport<UpdateStatus>('get_update_status'),
  setAppUpdateMode: (mode: UpdateMode) => transport<UpdateStatus>('set_app_update_mode', { mode }),
  dismissUpdateReminder: () => transport<UpdateStatus>('dismiss_update_reminder'),
  saveExportFile: (defaultName: string, fileType: ExportFileType, dataBase64: string) =>
    transport<boolean>('save_export_file', { defaultName, fileType, dataBase64 }),
  exportDiagnostics: () => transport<boolean>('export_diagnostics'),
  diagnosticsReport: () => transport<string>('diagnostics_report'),
  openIssueTracker: () => transport<void>('open_issue_tracker'),
};
