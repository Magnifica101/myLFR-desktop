import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button, Card, Status } from './ui';
import { useToast } from './ToastProvider';
import { desktop, type UpdateMode, type UpdateProgress, type UpdateStatus } from '../lib/desktop';
import { errorMessage } from '../lib/format';

interface AvailableUpdate { version: string; notes: string | null }
type CheckSource = 'user' | 'automatic';

interface AppUpdatesValue {
  status: UpdateStatus | undefined;
  available: AvailableUpdate | null;
  checking: boolean;
  /** Show the Settings marker: a pending reminder or a found update. Updates
   * and reminders appear only there and in Settings, never across every page. */
  needsAttention: boolean;
  checkNow: (source: CheckSource) => Promise<void>;
  setMode: (mode: UpdateMode) => Promise<void>;
  openInstall: () => void;
}

const AppUpdatesContext = createContext<AppUpdatesValue | null>(null);

/** The shared update state, or `null` outside the main application shell. */
export function useAppUpdates() {
  return useContext(AppUpdatesContext);
}

/** How often to re-evaluate whether an automatic check is due while the app stays open. */
const AUTOMATIC_RECHECK_MS = 60 * 60 * 1000;

export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ['update-status'], queryFn: desktop.getUpdateStatus, refetchInterval: AUTOMATIC_RECHECK_MS });
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const lastAutomaticAttempt = useRef(0);

  const refreshStatus = useCallback(() => queryClient.invalidateQueries({ queryKey: ['update-status'] }), [queryClient]);

  const checkNow = useCallback(async (source: CheckSource) => {
    setChecking(true);
    try {
      const result = await desktop.checkAppUpdate(source === 'user');
      if (result.status === 'available' && result.version) {
        setAvailable({ version: result.version, notes: result.notes });
      } else if (result.status === 'current') {
        setAvailable(null);
        if (source !== 'automatic') toast.show('myLFR Desktop is up to date.', 'success');
      }
      // A "throttled" result only comes from automatic checks, which stay quiet.
    } catch (caught) {
      // A failed check is not recorded, so the reminder stays. Automatic
      // checks fail quietly and are retried later.
      if (source === 'user') toast.show(errorMessage(caught), 'error');
    } finally {
      setChecking(false);
      await refreshStatus();
    }
  }, [refreshStatus, toast]);

  useEffect(() => {
    if (!status.data?.automaticCheckDue || checking) return;
    if (Date.now() - lastAutomaticAttempt.current < AUTOMATIC_RECHECK_MS) return;
    lastAutomaticAttempt.current = Date.now();
    void checkNow('automatic');
  }, [status.data?.automaticCheckDue, checking, checkNow]);

  const setMode = useCallback(async (mode: UpdateMode) => {
    try {
      queryClient.setQueryData(['update-status'], await desktop.setAppUpdateMode(mode));
      if (mode === 'automatic') {
        // Choosing automatic checks straight away and reports the result.
        lastAutomaticAttempt.current = Date.now();
        await checkNow('user');
      }
    } catch (caught) { toast.show(errorMessage(caught), 'error'); }
  }, [checkNow, queryClient, toast]);

  const value: AppUpdatesValue = {
    status: status.data,
    available,
    checking,
    needsAttention: !!available || !!status.data?.reminderPending,
    checkNow,
    setMode,
    openInstall: () => setInstalling(true),
  };

  return <AppUpdatesContext.Provider value={value}>
    {children}
    {installing && available ? <UpdateInstallDialog update={available} onClose={() => setInstalling(false)} /> : null}
  </AppUpdatesContext.Provider>;
}

/** The bar across the top of every page: a found update, or the monthly reminder. */
function describeProgress(progress: UpdateProgress | null): string {
  if (!progress) return '';
  if (progress.stage === 'backingUp') return 'Backing up your records…';
  if (progress.stage === 'installing') return 'Installing. myLFR will close and the installer will finish the update.';
  const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
  return progress.total
    ? `Downloading… ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}% (${megabytes(progress.downloaded)} of ${megabytes(progress.total)})`
    : `Downloading… ${megabytes(progress.downloaded)}`;
}

/** The confirmation before installing: what is being installed, a backup first, and progress. */
function UpdateInstallDialog({ update, onClose }: { update: AvailableUpdate; onClose: () => void }) {
  const backup = useQuery({ queryKey: ['backup-status'], queryFn: desktop.getBackupStatus });
  const canBackUp = !!backup.data?.backupDirectory && backup.data.destinationAvailable;
  const [backupFirst, setBackupFirst] = useState(true);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState('');
  const working = !!progress && !error;

  async function install() {
    setError('');
    setProgress(canBackUp && backupFirst ? { stage: 'backingUp' } : { stage: 'downloading', downloaded: 0, total: null });
    try {
      await desktop.installAppUpdate(update.version, canBackUp && backupFirst, setProgress);
    } catch (caught) { setError(errorMessage(caught)); }
  }

  return <div className="modal-backdrop modal-backdrop-raised"><Card className="modal"><div className="split"><div><h2>Install myLFR Desktop {update.version}?</h2><p className="muted">Nothing changes until you choose <strong>Install</strong>.</p></div><Button variant="ghost" aria-label="Close" onClick={onClose} disabled={working}><X size={17} /></Button></div>
    <div className="stack">
      <div><h3>What's new</h3>{update.notes ? <pre className="release-notes">{update.notes}</pre> : <p className="muted">No release notes were published with this version.</p>}</div>
      <p className="muted">myLFR will close while the update installs. The first time it opens afterwards, it updates your records to work with the new version.</p>
      {canBackUp
        ? <label className="inline"><input style={{ width: 'auto' }} type="checkbox" checked={backupFirst} disabled={working} onChange={(event) => setBackupFirst(event.target.checked)} /> Back up my records before installing (recommended)</label>
        : <Status tone="warning">myLFR can't back up first, because no backup folder is available. You can choose one in Settings, under Data safety, before installing.</Status>}
      {progress && !error ? <Status tone="info">{describeProgress(progress)}</Status> : null}
      {error ? <Status tone="error">{error}</Status> : null}
      <div className="form-actions"><Button onClick={install} disabled={working}>{working ? 'Installing…' : 'Install'}</Button><Button variant="ghost" onClick={onClose} disabled={working}>Not now</Button></div>
    </div>
  </Card></div>;
}
