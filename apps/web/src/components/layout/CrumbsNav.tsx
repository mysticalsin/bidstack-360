import { Link } from 'react-router-dom';

import type { Crumb } from './crumbs';

/** Renders the trail. Only a crumb with a path we built is a link. */
export function CrumbsNav({ crumbs, label }: { crumbs: Crumb[]; label: string }) {
  const last = crumbs.length - 1;
  return (
    <nav aria-label={label} className="crumbs">
      {crumbs.map((crumb, index) => {
        const current = index === last;
        return (
          <span key={`${crumb.to ?? 'here'}-${index}`} className="crumbs-seg">
            {index > 0 ? (
              <span className="sep" aria-hidden>
                /
              </span>
            ) : null}
            {crumb.to && !current ? (
              <Link to={crumb.to} title={crumb.label}>
                {crumb.label}
              </Link>
            ) : (
              <span
                className={current ? 'here' : undefined}
                aria-current={current ? 'page' : undefined}
                title={crumb.label}
              >
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
