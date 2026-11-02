import { ACCOUNT_PEOPLE_DRAWN } from '@bidstack/shared';

/**
 * People one account map draws. A fixed take of that many dropped a later
 * person, so those names read as everyone on the account. One row past
 * the drawn page is the probe. It is not shown, and it is not a total.
 */
export { ACCOUNT_PEOPLE_DRAWN };

export function accountPeopleTake(): number {
  return ACCOUNT_PEOPLE_DRAWN + 1;
}
