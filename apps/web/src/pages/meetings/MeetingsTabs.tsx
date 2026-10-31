import { NavLink } from 'react-router-dom';

import { useMeetingFlags } from '@/hooks/useMeetingIntel';

export function MeetingsTabs() {
  const flags = useMeetingFlags('open');
  const open = flags.data?.items.length ?? 0;
  return (
    <nav aria-label="Meeting intel" className="drill-seg" style={{ width: 'fit-content' }}>
      <NavLink end to="/meetings" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 16px', fontSize: 13 }}
        className={({ isActive }) => (isActive ? 'mi-tab-on' : '')}>Meetings</NavLink>
      <NavLink to="/meetings/flags" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 16px', fontSize: 13 }}
        className={({ isActive }) => (isActive ? 'mi-tab-on' : '')}>Cross-region flags{open ? ` (${open})` : ''}</NavLink>
    </nav>
  );
}
