import { useState } from 'react';
import myLfrLogo from '../../app-icon.png';
import { Button, Card, Status } from './ui';
import { desktop } from '../lib/desktop';
import { errorMessage } from '../lib/format';

/**
 * Raise this whenever the notice changes materially. A user who acknowledged
 * an earlier version is shown the notice again. The same text appears in
 * README.md under "What you need to know before using myLFR Desktop"; keep
 * them in step.
 */
export const NOTICE_VERSION = 1;

/** The plain-English notice. CC0 already disclaims warranty and liability; this
 * tells the person using an installed copy what that means for them. */
export function NoticeContent({ firstRun = false }: { firstRun?: boolean }) {
  return <div className="notice-content">
    <p><strong>myLFR Desktop is free, open-source software released under Creative Commons Zero (CC0 1.0).</strong> It has been placed in the public domain: nobody owns it, and anyone may use, copy, change or share it.{firstRun ? ' Please read these five points before you use it.' : ''}</p>
    <ol>
      <li><strong>You are responsible for your returns.</strong> myLFR helps you record landings and prepare figures, but it never files or submits anything. Check its figures against your own records before you use them in a return. You remain responsible for your returns being accurate and filed on time.</li>
      <li><strong>There is no warranty.</strong> Because myLFR is free and in the public domain, it is provided as it is, with no promise that it is free of mistakes or right for your business. As far as the law allows, nobody involved in making it is responsible for any loss that comes from using it.</li>
      <li><strong>It is not an official product.</strong> myLFR is not made by, connected with, or endorsed by Fisheries New Zealand, the Ministry for Primary Industries, or FishServe.</li>
      <li><strong>Your records stay on this computer.</strong> myLFR never sends your records anywhere. Keeping backups is up to you: choose a backup folder in Settings, ideally on a USB drive, OneDrive or other cloud storage.</li>
      <li><strong>Support is not guaranteed.</strong> You can report problems on GitHub, and the maintainer will look at them when they can.</li>
    </ol>
  </div>;
}

/** Shown once before first use, and again whenever the notice version rises. */
export function NoticeScreen({ onAcknowledged }: { onAcknowledged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function acknowledge() {
    setSaving(true);
    setError('');
    try {
      await desktop.acknowledgeNotice(NOTICE_VERSION);
      onAcknowledged();
    } catch (caught) {
      setError(errorMessage(caught));
      setSaving(false);
    }
  }

  return <div className="setup-shell">
    <Card className="setup-card">
      <div className="setup-brand"><img className="brand-mark" style={{ margin: 'auto' }} src={myLfrLogo} alt="myLFR logo" /><h1>Before you start</h1></div>
      {error ? <Status tone="error">{error}</Status> : null}
      <NoticeContent firstRun />
      <p className="muted">You can read this again at any time in Settings, under About.</p>
      <div className="form-actions"><Button onClick={acknowledge} disabled={saving}>{saving ? 'Saving…' : 'I understand'}</Button></div>
    </Card>
  </div>;
}
