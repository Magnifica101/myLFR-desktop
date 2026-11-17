import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, Info } from 'lucide-react';
import { Button, Card, Loading, PageHeader, Status } from '../components/ui';
import { PageHelp } from '../components/PageHelp';
import { BackupInfo } from '../components/BackupInfo';
import { useToast } from '../components/ToastProvider';
import { desktop } from '../lib/desktop';
import { saveFullDataWorkbook } from '../lib/exports';
import { ACCEPTED_LOGO_TYPES, prepareLogo } from '../lib/logo';
import { errorMessage, formatDateTime, toBase64 } from '../lib/format';
import { BACKUP_STATUS_LABELS, backupHealth, type BackupReason } from '../lib/backup';
import { copyText } from '../lib/clipboard';
import { useAppUpdates } from '../components/AppUpdates';
import { NoticeContent } from '../components/ResponsibilitiesNotice';
import type { UpdateMode } from '../lib/desktop';
import { FISHING_YEAR_OPTIONS, type FishingYearStartMonth } from '../lib/fishingYear';
import type { BusinessProfileInput } from '../lib/types';
import { addressLines } from '../lib/address';

const BACKUP_ALERTS: Record<BackupReason, { tone: 'warning' | 'error'; text: string } | null> = {
  'not-configured': { tone: 'warning', text: 'Choose where myLFR should store backup copies of your records.' },
  unavailable: { tone: 'error', text: 'myLFR cannot access your backup location. Reconnect it or choose another location.' },
  never: { tone: 'warning', text: 'No backup has been created yet. Use **Back up now** on Home to create your first copy.' },
  'seriously-overdue': { tone: 'error', text: 'Your latest backup is more than a week old. Use **Back up now** on Home to create a new copy.' },
  overdue: { tone: 'warning', text: 'Your latest backup is more than two days old. Use **Back up now** on Home to create a new copy.' },
  current: null,
};

// Holds the folder the warning was hidden for, so choosing a different folder
// on the same drive shows it again.
const SAME_DRIVE_DISMISSED_KEY = 'mylfr.same-drive-warning-dismissed';

export default function Settings() {
  const toast = useToast();
  const updates = useAppUpdates();
  const notice = useQuery({ queryKey: ['notice-acknowledgement'], queryFn: desktop.getNoticeAcknowledgement });
  const location = useLocation();
  const focusUpdates = (location.state as { focus?: string } | null)?.focus === 'updates';
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['business-profile'], queryFn: desktop.getBusinessProfile });
  const fishingYear = useQuery({ queryKey: ['fishing-year-start-month'], queryFn: desktop.getFishingYearStartMonth });
  const backup = useQuery({ queryKey: ['backup-status'], queryFn: desktop.getBackupStatus });
  const info = useQuery({ queryKey: ['app-info'], queryFn: desktop.getAppInfo });
  const logo = useQuery({ queryKey: ['business-logo'], queryFn: desktop.getBusinessLogo });
  const [form, setForm] = useState<BusinessProfileInput | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [fishingYearStartMonth, setFishingYearStartMonth] = useState<FishingYearStartMonth>(9);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const logoInput = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState('');
  const [sameDriveDismissedFor, setSameDriveDismissedFor] = useState(() => (
    window.localStorage.getItem(SAME_DRIVE_DISMISSED_KEY)
  ));

  useEffect(() => {
    if (!profile.data) return;
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...input } = profile.data;
    setForm(input);
  }, [profile.data]);

  useEffect(() => {
    if (fishingYear.data) setFishingYearStartMonth(fishingYear.data);
  }, [fishingYear.data]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy('profile'); setError('');
    try {
      await desktop.saveBusinessProfile(form);
      await queryClient.invalidateQueries({ queryKey: ['business-profile'] });
      setEditingProfile(false);
      toast.show('Business details saved.', 'success');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  function cancelProfileEdit() {
    if (!profile.data) return;
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...input } = profile.data;
    setForm(input);
    setError('');
    setEditingProfile(false);
  }

  async function chooseLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear the input so choosing the same file twice still fires a change.
    event.target.value = '';
    if (!file) return;
    setBusy('logo'); setLogoError('');
    try {
      const prepared = await prepareLogo(file);
      await desktop.setBusinessLogo(prepared.dataBase64, prepared.width, prepared.height);
      await queryClient.invalidateQueries({ queryKey: ['business-logo'] });
      toast.show('Logo saved.', 'success');
    } catch (caught) { setLogoError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function removeLogo() {
    setBusy('logo'); setLogoError('');
    try {
      await desktop.clearBusinessLogo();
      await queryClient.invalidateQueries({ queryKey: ['business-logo'] });
      toast.show('Logo removed.', 'success');
    } catch (caught) { setLogoError(errorMessage(caught)); }
    finally { setBusy(''); }
  }

  async function chooseBackup() {
    try {
      const selected = await desktop.chooseBackupDirectory();
      if (!selected) return;
      try {
        await desktop.backupNow();
        toast.show('Backup location saved and a new backup was created.', 'success');
      } finally { await queryClient.invalidateQueries({ queryKey: ['backup-status'] }); }
    } catch (caught) { toast.show(errorMessage(caught), 'error'); }
  }

  function hideSameDriveWarning(folder: string) {
    window.localStorage.setItem(SAME_DRIVE_DISMISSED_KEY, folder);
    setSameDriveDismissedFor(folder);
  }

  async function openBackupFolder() {
    try { await desktop.openBackupFolder(); }
    catch (caught) { toast.show(errorMessage(caught), 'error'); }
  }

  async function saveFishingYear() {
    setBusy('fishing-year');
    try {
      await desktop.setFishingYearStartMonth(fishingYearStartMonth);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fishing-year-start-month'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast.show('Fishing year preference saved.', 'success');
    } catch (caught) { toast.show(errorMessage(caught), 'error'); }
    finally { setBusy(''); }
  }

  async function restore() {
    try {
      const valid = await desktop.selectBackupForRestore();
      if (!valid) return;
      if (!confirm(`Restore this verified schema ${valid.schemaVersion} backup? Current data will be replaced after a safety copy is made. You will need to choose this computer's backup folder again.`)) return;
      setBusy('restore');
      await desktop.restoreBackup(valid.token);
      await queryClient.invalidateQueries();
      toast.show('Backup restored.', 'success');
      window.location.reload();
    } catch (caught) { toast.show(errorMessage(caught), 'error'); }
    finally { setBusy(''); }
  }

  async function exportWorkbook() {
    setBusy('export-xlsx');
    try {
      const data = await desktop.fullExport();
      const saved = await saveFullDataWorkbook(data, `myLFR-my-data-${new Date().toISOString().slice(0, 10)}`);
      if (saved) toast.show('Excel file saved.', 'success');
    } catch (caught) { toast.show(errorMessage(caught), 'error'); }
    finally { setBusy(''); }
  }

  async function exportAll() {
    setBusy('export');
    try {
      const data = await desktop.fullExport();
      const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
      const saved = await desktop.saveExportFile(
        `myLFR-full-export-${new Date().toISOString().slice(0, 10)}.json`,
        'json',
        toBase64(bytes),
      );
      if (saved) {
        toast.show('Full data export saved.', 'success');
      }
    } catch (caught) { toast.show(errorMessage(caught), 'error'); }
    finally { setBusy(''); }
  }

  async function copyProblemReport() {
    setBusy('copy-report');
    try {
      const report = await desktop.diagnosticsReport();
      if (await copyText(report)) toast.show('Problem report copied. Paste it into the GitHub report form.', 'success');
      else toast.show('myLFR could not use the clipboard. Please try again.', 'error');
    }
    catch (caught) { toast.show(errorMessage(caught), 'error'); }
    finally { setBusy(''); }
  }

  async function reportOnGitHub() {
    try { await desktop.openIssueTracker(); }
    catch (caught) { toast.show(errorMessage(caught), 'error'); }
  }

  const loaded = !(profile.isPending || fishingYear.isPending || backup.isPending || info.isPending || logo.isPending || !form);
  useEffect(() => {
    // Arriving from the sidebar's update marker goes straight to the update action.
    if (!loaded || !focusUpdates) return;
    const card = document.getElementById('updates');
    card?.scrollIntoView?.({ block: 'center' });
    card?.focus();
  }, [loaded, focusUpdates, location.key]);

  if (!loaded || !form) return <Loading />;
  const change = (field: keyof BusinessProfileInput) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: event.target.value });
  const address = addressLines(form);
  const backupState = backupHealth(backup.data);
  const backupAlert = BACKUP_ALERTS[backupState.reason];
  const sameDriveFolder = backup.data?.sameDeviceWarning ? backup.data.backupDirectory : null;

  return <div className="page">
    <PageHeader title="Settings" description="Manage your business details, data safety, and this myLFR installation." actions={<PageHelp page="settings" />} />
    <section className="settings-section">
      <h2 className="settings-section-title">Your business</h2>
      <div className="settings-grid">
      <Card className="settings-card-wide"><h2>Business details</h2>{error ? <Status tone="error">{error}</Status> : null}{editingProfile ? <form onSubmit={saveProfile} className="stack"><div className="form-grid"><div className="field"><label>LFR name</label><input required maxLength={120} value={form.lfrName} onChange={change('lfrName')} /></div><div className="field"><label>Fishserve Client Number</label><input required maxLength={60} value={form.clientNumber} onChange={change('clientNumber')} /></div><div className="field"><label>Street number</label><input value={form.streetNumber} onChange={change('streetNumber')} /></div><div className="field"><label>Street name</label><input value={form.streetName} onChange={change('streetName')} /></div><div className="field"><label>Street type</label><input value={form.streetType} onChange={change('streetType')} /></div><div className="field"><label>Suburb</label><input value={form.suburb} onChange={change('suburb')} /></div><div className="field"><label>City</label><input value={form.city} onChange={change('city')} /></div><div className="field"><label>Postcode</label><input value={form.postcode} onChange={change('postcode')} /></div></div><div className="form-actions"><Button type="submit" disabled={busy === 'profile'}>{busy === 'profile' ? 'Saving…' : 'Save business details'}</Button><Button type="button" variant="secondary" onClick={cancelProfileEdit} disabled={busy === 'profile'}>Cancel</Button></div></form> : <><dl className="details business-details"><dt>LFR name</dt><dd>{form.lfrName || 'Not provided'}</dd><dt>Fishserve Client Number</dt><dd>{form.clientNumber || 'Not provided'}</dd><dt>Address</dt><dd>{address.length ? <span className="address-lines">{address.map((line, index) => <span key={index}>{line}</span>)}</span> : 'Not provided'}</dd></dl><div className="settings-card-actions"><Button variant="secondary" onClick={() => { setError(''); setEditingProfile(true); }}>Edit details</Button></div></>}</Card>
      <Card className="settings-action-card"><h2>Your logo</h2>{logoError ? <Status tone="error">{logoError}</Status> : null}<p className="muted">Shown beside the title on PDF reports. Large images are resized automatically.</p>{logo.data ? <img className="logo-preview" src={`data:image/png;base64,${logo.data.dataBase64}`} alt="Your logo" /> : null}<input ref={logoInput} type="file" accept={ACCEPTED_LOGO_TYPES.join(',')} hidden onChange={(event) => void chooseLogo(event)} /><div className="settings-card-actions"><Button variant="secondary" disabled={busy === 'logo'} onClick={() => logoInput.current?.click()}>{busy === 'logo' ? 'Working…' : logo.data ? 'Replace logo' : 'Choose logo'}</Button>{logo.data ? <Button variant="secondary" disabled={busy === 'logo'} onClick={() => void removeLogo()}>Remove logo</Button> : null}</div></Card>
      <Card className="settings-action-card"><h2>Fishing year</h2><p className="muted">Choose what “this fishing year” means on the Home page. Most New Zealand fishstocks use the October fishing year.</p><div className="field"><label htmlFor="fishing-year">Fishing year period</label><select id="fishing-year" value={fishingYearStartMonth} onChange={(event) => setFishingYearStartMonth(Number(event.target.value) as FishingYearStartMonth)}>{FISHING_YEAR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.description}</option>)}</select></div><div className="settings-card-actions"><Button variant="secondary" onClick={saveFishingYear} disabled={busy === 'fishing-year'}>{busy === 'fishing-year' ? 'Saving…' : 'Save fishing year'}</Button></div></Card>
      </div>
    </section>
    <section className="settings-section">
      <h2 className="settings-section-title">Data safety</h2>
      <p className="muted settings-section-note">Keep your records safe with a secure Windows account, device encryption, and regular backups.</p>
      <div className="settings-grid">
      <Card className="settings-action-card backup-card"><div className="backup-heading"><h2>Database backups</h2><BackupInfo /></div><p className="muted">myLFR saves a backup copy of your records to the folder you choose. Select <Info className="inline-info-icon" role="img" aria-label="the information button" /> to see where to keep it safe.</p><div className={`backup-status-summary backup-summary-${backupState.level}`}><strong>{BACKUP_STATUS_LABELS[backupState.reason]}</strong><span>{backup.data?.lastBackupAt ? `Last successful backup: ${formatDateTime(backup.data.lastBackupAt)}` : 'No successful backup has been created yet.'}</span></div>{backupAlert ? <Status tone={backupAlert.tone}>{backupAlert.text}</Status> : null}{sameDriveFolder && sameDriveFolder !== sameDriveDismissedFor ? <Status tone="warning"><div className="same-drive-warning"><span>Your backups are on the same drive as myLFR. Choose OneDrive, a network folder, or an encrypted USB drive to protect against computer failure.</span><span>If this folder is copied to Dropbox or another cloud service, your backups are already off this computer and you can choose <strong>Hide this warning</strong>.</span><div><Button variant="secondary" onClick={() => hideSameDriveWarning(sameDriveFolder)}>Hide this warning</Button></div></div></Status> : null}{backup.data?.backupDirectory ? <details className="technical-details"><summary>Show full folder path</summary><code className="path-value">{backup.data.backupDirectory}</code></details> : null}{backup.data?.backupDirectory ? <div className="backup-folder-actions"><Button variant="secondary" onClick={() => void openBackupFolder()} disabled={!backup.data.destinationAvailable}>Open backup folder</Button><Button variant="secondary" onClick={chooseBackup}>Change backup folder</Button></div> : <div className="settings-card-actions"><Button variant="secondary" onClick={chooseBackup}>Choose backup folder</Button></div>}</Card>
      <Card className="settings-action-card"><h2>Export my data</h2><p className="muted">Creates an Excel workbook complete with all your records. Includes your business details, permit holders, vessels, favourites, landings, and landing history — ready to open in Excel or Google Sheets.</p><div className="settings-card-actions"><Button variant="secondary" onClick={exportWorkbook} disabled={busy === 'export-xlsx'}>{busy === 'export-xlsx' ? 'Exporting…' : 'Export my data (Excel)'}</Button></div></Card>
      <Card className="settings-card-wide settings-advanced-card"><details className="advanced-settings"><summary><span className="advanced-summary-copy"><strong>Advanced</strong><small>Restore records or view technical details</small></span><ChevronDown size={18} aria-hidden="true" /></summary><div className="advanced-settings-content advanced-settings-grid"><Card className="settings-action-card"><h2>Restore records</h2><p className="muted">Return your records to an earlier backup.</p><p className="muted settings-warning-note">This replaces your current records and settings. Later changes will be lost.</p><div className="settings-card-actions"><Button variant="danger" onClick={restore} disabled={busy === 'restore'}>{busy === 'restore' ? 'Restoring…' : 'Choose backup to restore'}</Button></div></Card><Card className="settings-action-card"><h2>Complete data (technical)</h2><p className="muted">Creates an unencrypted JSON copy of the same records with full fidelity, for migrating into another system. This file cannot be restored as a backup.</p><div className="settings-card-actions"><Button variant="secondary" onClick={exportAll} disabled={busy === 'export'}>{busy === 'export' ? 'Exporting…' : 'Export complete data (JSON)'}</Button></div></Card></div></details></Card>
      </div>
    </section>
    <section className="settings-section">
      <h2 className="settings-section-title">About</h2>
      <div className="settings-grid">
      <Card className="settings-action-card" id="updates" tabIndex={-1} aria-labelledby="updates-heading"><h2 id="updates-heading">Application updates</h2><p className="muted">Checking for updates is the only time myLFR uses the internet on its own. Nothing is installed without your say-so.</p>{updates?.status ? <><div className="field"><label htmlFor="update-mode">Check for updates</label><select id="update-mode" value={updates.status.mode} onChange={(event) => updates.setMode(event.target.value as UpdateMode)}><option value="manual">Manual: remind me once a month</option><option value="automatic">Automatic: check once a day by itself</option></select></div><dl className="details"><dt>Last successful check</dt><dd>{updates.status.lastSuccessfulCheck ? formatDateTime(updates.status.lastSuccessfulCheck) : 'Never'}</dd></dl></> : null}{updates?.available ? <Status tone="info">myLFR Desktop {updates.available.version} is available.</Status> : updates?.status?.reminderPending ? <Status tone="warning">It's time to check for an update.</Status> : null}<div className="settings-card-actions">{updates?.available ? <Button onClick={updates.openInstall}>Review and install {updates.available.version}</Button> : null}<Button variant="secondary" onClick={() => updates?.checkNow('user')} disabled={!updates || updates.checking}>{updates?.checking ? 'Checking…' : 'Check for updates now'}</Button></div></Card>
      <Card className="settings-action-card"><h2>Versions</h2><p className="muted">The versions of myLFR, its fishstock catalogue, and your records' database.</p><dl className="details"><dt>Application</dt><dd>{info.data?.version}</dd><dt>Fishstock catalogue</dt><dd>{info.data?.catalogueVersion}</dd><dt>Database schema</dt><dd>{info.data?.schemaVersion}</dd></dl><details className="technical-details"><summary>Technical details</summary><dl className="details"><dt>Database file</dt><dd>{info.data?.databasePath}</dd></dl></details></Card>
      <Card className="settings-card-wide settings-advanced-card"><details className="advanced-settings"><summary><span className="advanced-summary-copy"><strong>About myLFR Desktop</strong><small>Free, public-domain software: your responsibilities, privacy, and support</small></span><ChevronDown size={18} aria-hidden="true" /></summary><div className="advanced-settings-content"><NoticeContent />{notice.data ? <p className="muted">You acknowledged this notice on {formatDateTime(notice.data.acknowledgedAt)}.</p> : null}</div></details></Card>
      <Card className="settings-card-wide settings-advanced-card"><details className="advanced-settings"><summary><span className="advanced-summary-copy"><strong>Bug report</strong><small>Something not working? Copy a problem report and send it on GitHub</small></span><ChevronDown size={18} aria-hidden="true" /></summary><div className="advanced-settings-content"><p className="muted">Something not working? Choose <strong>Copy problem report</strong>, then <strong>Report on GitHub</strong>. Paste the problem report into the form. You need a free GitHub account.</p><p className="muted support-privacy">The problem report shares basic app information, such as the app version, along with details about recent errors. It never includes the contents of your records or where your files are kept. Reports on GitHub are public, so do not add business names, permit holders, vessels, or landing details.</p><div className="settings-card-actions"><Button variant="secondary" onClick={copyProblemReport} disabled={busy === 'copy-report'}>{busy === 'copy-report' ? 'Copying…' : 'Copy problem report'}</Button><Button variant="secondary" onClick={reportOnGitHub}>Report on GitHub <ExternalLink size={16} /></Button></div></div></details></Card>
      </div>
    </section>
  </div>;
}
