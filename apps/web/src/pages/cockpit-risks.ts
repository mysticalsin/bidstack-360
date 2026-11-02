import { COCKPIT_RISK_LIMIT } from '@bidstack/shared';

import { notePageWording } from './contact-notes';

/**
 * Risk-register caption. Same rule as `keyContactCaption`: a continuing page
 * is the latest risks, not every row on the register. A page that matches
 * the loaded set keeps the old wording. No register total is invented.
 */
export function riskRegisterCaption(count: number, pageContinues: boolean, complete = ''): string {
  return notePageWording(
    pageContinues,
    complete,
    `${count} in the latest ${COCKPIT_RISK_LIMIT}, not every risk`,
  );
}
