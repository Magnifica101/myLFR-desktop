import type { BackupStatus } from './types';

export type BackupLevel = 'good' | 'warning' | 'danger';

export type BackupReason =
  | 'not-configured'
  | 'unavailable'
  | 'never'
  | 'seriously-overdue'
  | 'overdue'
  | 'current';

export interface BackupHealth {
  level: BackupLevel;
  reason: BackupReason;
}

/** The one name for each state, shared by Home and Settings. */
export const BACKUP_STATUS_LABELS: Record<BackupReason, string> = {
  'not-configured': 'Not set up',
  unavailable: 'Backup folder not found',
  never: 'No backup yet',
  'seriously-overdue': 'Backup overdue',
  overdue: 'Backup due',
  current: 'Up to date',
};

const SERIOUSLY_OVERDUE_MS = 7 * 24 * 60 * 60 * 1000; // one week

/**
 * Single source of truth for how healthy the configured backup is. Both the
 * Home dashboard and Settings derive their icon/tone/message from this so the
 * same state can never surface as two different severities.
 */
export function backupHealth(status: BackupStatus | null | undefined): BackupHealth {
  if (!status?.backupDirectory) return { level: 'danger', reason: 'not-configured' };
  if (!status.destinationAvailable) return { level: 'danger', reason: 'unavailable' };
  if (!status.lastBackupAt) return { level: 'danger', reason: 'never' };
  const lastBackupTime = new Date(status.lastBackupAt).getTime();
  if (!Number.isFinite(lastBackupTime) || Date.now() - lastBackupTime >= SERIOUSLY_OVERDUE_MS) {
    return { level: 'danger', reason: 'seriously-overdue' };
  }
  if (status.isStale) return { level: 'warning', reason: 'overdue' };
  return { level: 'good', reason: 'current' };
}
