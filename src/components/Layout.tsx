import {
  BookOpen,
  CalendarRange,
  CircleHelp,
  ClipboardPen,
  Download,
  FileOutput,
  Fish,
  Home,
  PanelLeftClose,
  Settings,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import myLfrLogo from '../../app-icon.png';
import { useAppUpdates } from './AppUpdates';

const links = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/fishers', label: 'Permit holders', icon: Users },
  { to: '/landings', label: 'Landings', icon: ClipboardPen },
  { to: '/species', label: 'Species', icon: Fish },
  { to: '/summaries', label: 'Monthly summaries', icon: CalendarRange },
  { to: '/export', label: 'Export data', icon: FileOutput },
  { to: '/resources', label: 'Resources', icon: BookOpen },
  { to: '/faq', label: 'FAQ', icon: CircleHelp },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const SIDEBAR_STORAGE_KEY = 'mylfr.sidebar-collapsed';

export function Layout() {
  const updates = useAppUpdates();
  const navigate = useNavigate();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => (
    window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
  ));

  function toggleSidebar() {
    setIsSidebarCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextCollapsed));
      return nextCollapsed;
    });
  }

  return (
    <div className={`app-shell${isSidebarCollapsed ? ' app-shell-collapsed' : ''}`}>
      <aside className={`sidebar no-print${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <div className="brand">
          {isSidebarCollapsed ? (
            <button
              className="sidebar-logo-toggle"
              type="button"
              aria-expanded="false"
              aria-label="Open sidebar"
              onClick={toggleSidebar}
            >
              <img className="brand-mark" src={myLfrLogo} alt="" />
              <span className="sidebar-tooltip" role="tooltip">Open sidebar</span>
            </button>
          ) : <img className="brand-mark" src={myLfrLogo} alt="myLFR logo" />}
          <div><strong>myLFR</strong><small>Desktop</small></div>
          {!isSidebarCollapsed && (
            <button
              className="sidebar-toggle"
              type="button"
              aria-expanded="true"
              aria-label="Collapse navigation"
              title="Collapse navigation"
              onClick={toggleSidebar}
            >
              <PanelLeftClose size={17} aria-hidden="true" />
            </button>
          )}
        </div>
        <nav>
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Icon size={19} /> <span aria-hidden={isSidebarCollapsed}>{label}</span>
            </NavLink>
          ))}
        </nav>
        {updates?.needsAttention ? (
          // A found update opens the install review straight away; a due
          // reminder leads to the update section in Settings to check.
          <button
            className="sidebar-update"
            type="button"
            aria-label={updates.available ? `Install myLFR Desktop ${updates.available.version}` : 'Check for a myLFR Desktop update'}
            title={updates.available ? `myLFR Desktop ${updates.available.version} is available` : "It's time to check for an update"}
            onClick={() => updates.available ? updates.openInstall() : navigate('/settings', { state: { focus: 'updates' } })}
          >
            <Download size={20} aria-hidden="true" />
          </button>
        ) : null}
      </aside>
      <main className="main-content"><Outlet /></main>
    </div>
  );
}
