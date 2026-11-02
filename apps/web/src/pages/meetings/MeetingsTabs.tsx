import { NavLink } from 'react-router-dom';

import { useMeetingFlags } from '@/hooks/useMeetingIntel';

import { meetingFlagTabLabel, shownMeetingFlags } from './meeting-flag-caption';

export function MeetingsTabs() {
  const flags = useMeetingFlags('open');
  const page = shownMeetingFlags(flags.data?.items ?? [], flags.data?.flagsContinue);
  return (
    <nav aria-label="Meeting intel" className="drill-seg" style={{ width: 'fit-content' }}>
      <NavLink end to="/meetings" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 16px', fontSize: 13 }}
        className={({ isActive }) => (isActive ? 'mi-tab-on' : '')}>Meetings</NavLink>
      <NavLink to="/meetings/flags" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 16px', fontSize: 13 }}
        className={({ isActive }) => (isActive ? 'mi-tab-on' : '')}>{meetingFlagTabLabel(page.items.length, page.pageContinues)}</NavLink>
    </nav>
  );
}
