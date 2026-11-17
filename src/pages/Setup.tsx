import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Status } from '../components/ui';
import { desktop } from '../lib/desktop';
import { errorMessage } from '../lib/format';
import type { BusinessProfileInput } from '../lib/types';
import myLfrLogo from '../../app-icon.png';

const empty: BusinessProfileInput = {
  lfrName: '', clientNumber: '', streetNumber: '', streetName: '', streetType: '',
  suburb: '', city: '', postcode: '',
};

export default function Setup() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(empty);
  const [backupDirectory, setBackupDirectory] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const change = (field: keyof BusinessProfileInput) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function chooseBackup() {
    setError('');
    try {
      const selected = await desktop.chooseBackupDirectory();
      if (selected?.backupDirectory) setBackupDirectory(selected.backupDirectory);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function restoreBackup() {
    setError('');
    setRestoring(true);
    try {
      const valid = await desktop.selectBackupForRestore();
      if (!valid) return;
      const confirmed = confirm(
        `Restore this verified myLFR backup?\n\nDatabase schema: ${valid.schemaVersion}\nRecorded fishstock catalogue: ${valid.catalogueVersion}\n\nThe backup will become the data for this installation. myLFR will use its trusted bundled catalogue, and you will choose a backup folder for this computer afterward.`,
      );
      if (!confirmed) return;
      await desktop.restoreBackup(valid.token);
      await queryClient.invalidateQueries({ queryKey: ['business-profile'] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRestoring(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setSaving(true);
    try {
      await desktop.saveBusinessProfile(form);
      await queryClient.invalidateQueries({ queryKey: ['business-profile'] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally { setSaving(false); }
  }

  return (
    <div className="setup-shell">
      <Card className="setup-card">
        <div className="setup-brand"><img className="brand-mark" style={{ margin: 'auto' }} src={myLfrLogo} alt="myLFR logo" /><h1>Set up myLFR Desktop</h1><p>Your records are stored only on this computer.</p></div>
        {error ? <Status tone="error">{error}</Status> : null}
        <Card className="setup-restore">
          <h2>Already have a backup?</h2>
          <p className="muted">Restore a <strong>.mylfr-backup</strong> file to bring your business details and records across from another computer.</p>
          <Button type="button" variant="secondary" onClick={restoreBackup} disabled={restoring || saving}>
            {restoring ? 'Checking or restoring…' : 'Restore from backup'}
          </Button>
        </Card>
        <p className="setup-divider"><span>or create a new installation</span></p>
        <form onSubmit={submit} className="stack" style={{ marginTop: 18 }}>
          <div className="form-grid">
            <div className="field"><label htmlFor="lfrName">LFR name</label><input id="lfrName" aria-describedby="lfrName-hint" value={form.lfrName} onChange={change('lfrName')} maxLength={120} required /><small id="lfrName-hint" className="muted">Your business name as a Licensed Fish Receiver. It appears on your reports.</small></div>
            <div className="field"><label htmlFor="clientNumber">Fishserve Client Number</label><input id="clientNumber" aria-describedby="clientNumber-hint" value={form.clientNumber} onChange={change('clientNumber')} maxLength={60} required /><small id="clientNumber-hint" className="muted">The client number FishServe gave your business.</small></div>
            <div className="field"><label htmlFor="streetNumber">Street number</label><input id="streetNumber" value={form.streetNumber} onChange={change('streetNumber')} maxLength={32} /></div>
            <div className="field"><label htmlFor="streetName">Street name</label><input id="streetName" value={form.streetName} onChange={change('streetName')} maxLength={120} /></div>
            <div className="field"><label htmlFor="streetType">Street type</label><input id="streetType" placeholder="e.g. Road, Street, Avenue" value={form.streetType} onChange={change('streetType')} maxLength={40} /></div>
            <div className="field"><label htmlFor="suburb">Suburb</label><input id="suburb" value={form.suburb} onChange={change('suburb')} maxLength={120} /></div>
            <div className="field"><label htmlFor="city">City</label><input id="city" value={form.city} onChange={change('city')} maxLength={120} /></div>
            <div className="field"><label htmlFor="postcode">Postcode</label><input id="postcode" value={form.postcode} onChange={change('postcode')} maxLength={20} /></div>
          </div>
          <Card>
            <h3>Keep your records safe</h3>
            <p className="muted">Choose a backup folder that is not on this computer: a USB drive, OneDrive, Google Drive, or a network drive. Then your records survive if this computer is lost or stops working.</p>
            <p className="muted">You can do this later in Settings. Until you do, myLFR will keep reminding you.</p>
            <div className="inline"><Button type="button" variant="secondary" onClick={chooseBackup} disabled={restoring}>Choose backup folder</Button><span className="muted">{backupDirectory || 'No folder selected'}</span></div>
          </Card>
          <Button type="submit" disabled={saving || restoring}>{saving ? 'Saving…' : 'Finish setup'}</Button>
        </form>
      </Card>
    </div>
  );
}
