import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import myLfrLogo from '../app-icon.png';
import { AppUpdatesProvider } from './components/AppUpdates';
import { NOTICE_VERSION, NoticeScreen } from './components/ResponsibilitiesNotice';
import { Layout } from './components/Layout';
import { Status } from './components/ui';
import { desktop } from './lib/desktop';
import Dashboard from './pages/Dashboard';
import DataExport from './pages/DataExport';
import Faq from './pages/Faq';
import Fishers from './pages/Fishers';
import Landings from './pages/Landings';
import Resources from './pages/Resources';
import Settings from './pages/Settings';
import Setup from './pages/Setup';
import Species from './pages/Species';
import Summaries from './pages/Summaries';

const MINIMUM_SPLASH_MS = 650;
const SPLASH_EXIT_MS = 240;

function StartupSplash({ exiting }: { exiting: boolean }) {
  return (
    <div className={`startup-splash${exiting ? ' startup-splash-exiting' : ''}`} role="status" aria-label="Opening myLFR Desktop">
      <div className="startup-splash-content">
        <img src={myLfrLogo} alt="myLFR logo" />
        <strong>myLFR</strong>
        <span>Desktop</span>
      </div>
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['business-profile'], queryFn: desktop.getBusinessProfile, retry: false });
  const notice = useQuery({ queryKey: ['notice-acknowledgement'], queryFn: desktop.getNoticeAcknowledgement, retry: false });
  const startedAt = useRef(Date.now());
  const [splashPhase, setSplashPhase] = useState<'visible' | 'exiting' | 'done'>('visible');

  useEffect(() => {
    if (profile.isPending || notice.isPending) return;
    const showFor = Math.max(0, MINIMUM_SPLASH_MS - (Date.now() - startedAt.current));
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const showTimer = setTimeout(() => {
      setSplashPhase('exiting');
      exitTimer = setTimeout(() => setSplashPhase('done'), SPLASH_EXIT_MS);
    }, showFor);
    return () => {
      clearTimeout(showTimer);
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, [profile.isPending, notice.isPending]);

  if (splashPhase !== 'done') return <StartupSplash exiting={splashPhase === 'exiting'} />;
  if (profile.isError) return <div className="startup-error"><Status tone="error">Unable to open myLFR Desktop. {String(profile.error)}</Status></div>;
  // The responsibilities notice comes before everything else, setup included,
  // and returns whenever its version rises.
  if (!notice.data || notice.data.version < NOTICE_VERSION) {
    return <NoticeScreen onAcknowledged={() => queryClient.invalidateQueries({ queryKey: ['notice-acknowledgement'] })} />;
  }

  return (
    <HashRouter>
      {profile.data ? (
        <Routes>
          <Route element={<AppUpdatesProvider><Layout /></AppUpdatesProvider>}>
            <Route index element={<Dashboard />} />
            <Route path="fishers" element={<Fishers />} />
            <Route path="landings" element={<Landings />} />
            <Route path="species" element={<Species />} />
            <Route path="summaries" element={<Summaries />} />
            <Route path="export" element={<DataExport />} />
            <Route path="resources" element={<Resources />} />
            <Route path="faq" element={<Faq />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="*" element={<Setup />} />
        </Routes>
      )}
    </HashRouter>
  );
}
