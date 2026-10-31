// Email, LinkedIn and phone for one person. Compact: small icon links on the
// chart node. Full: labelled rows in the side panel. Only safe schemes are
// rendered (mailto:, https://*.linkedin.com, tel:); LinkedIn opens in a new tab.
import type { OrgNode } from '@/lib/orgchart/types';

const LINKEDIN = /^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const PHONE = /^\+?[0-9]{7,15}$/;

export function contactHrefs(n: Pick<OrgNode, 'email' | 'phone' | 'linkedinUrl'>) {
  return {
    email: n.email && EMAIL.test(n.email) ? `mailto:${n.email}` : null,
    linkedin: n.linkedinUrl && LINKEDIN.test(n.linkedinUrl) ? n.linkedinUrl : null,
    phone: n.phone && PHONE.test(n.phone) ? `tel:${n.phone}` : null,
  };
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function MailIcon() {
  return <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 4h12v8H2z M2 4l6 5 6-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}
function InIcon() {
  return <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 6h2v7H3zM4 2.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM7 6h2v1c.4-.7 1.2-1.2 2.3-1.2C13 5.8 13.5 7 13.5 8.6V13h-2V9c0-.9-.3-1.5-1.1-1.5-.9 0-1.4.6-1.4 1.6V13H7z" fill="currentColor" /></svg>;
}
function PhoneIcon() {
  return <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 2.5l2 2.5-1.2 1.4a8 8 0 0 0 4.3 4.3L11 9.5l2.5 2-1 2c-5.3 0-9.5-4.2-9.5-9.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

export function ContactLinks({ node, compact = false }: { node: Pick<OrgNode, 'name' | 'email' | 'phone' | 'linkedinUrl'>; compact?: boolean }) {
  const h = contactHrefs(node);
  if (!h.email && !h.linkedin && !h.phone) return null;
  if (compact) {
    return (
      <span className="oc-links nodrag nopan" data-testid="orgchart-node-links">
        {h.email ? <a href={h.email} onClick={stop} aria-label={`Email ${node.name}`} title={node.email!} tabIndex={-1}><MailIcon /></a> : null}
        {h.linkedin ? <a href={h.linkedin} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`${node.name} on LinkedIn`} title="LinkedIn profile" tabIndex={-1}><InIcon /></a> : null}
        {h.phone ? <a href={h.phone} onClick={stop} aria-label={`Call ${node.name}`} title={node.phone!} tabIndex={-1}><PhoneIcon /></a> : null}
      </span>
    );
  }
  return (
    <ul className="oc-contact" data-testid="orgchart-contact">
      {h.email ? <li><MailIcon /><a href={h.email}>{node.email}</a></li> : null}
      {h.phone ? <li><PhoneIcon /><a href={h.phone}>{node.phone}</a></li> : null}
      {h.linkedin ? <li><InIcon /><a href={h.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn profile</a></li> : null}
    </ul>
  );
}
