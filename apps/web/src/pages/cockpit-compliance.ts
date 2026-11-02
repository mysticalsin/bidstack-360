import { COCKPIT_COMPLIANCE_LIMIT } from '@bidstack/shared';

import { notePageWording } from './contact-notes';

/**
 * Compliance caption. Same rule as `riskRegisterCaption`: a continuing page
 * is the latest checks, not every check. A page that matches the loaded set
 * keeps the old wording. No compliance total is invented.
 */
export function complianceCheckCaption(
  count: number,
  pageContinues: boolean,
  complete = '',
): string {
  return notePageWording(
    pageContinues,
    complete,
    `${count} in the latest ${COCKPIT_COMPLIANCE_LIMIT}, not every check`,
  );
}
