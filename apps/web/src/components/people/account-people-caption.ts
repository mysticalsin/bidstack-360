import { ACCOUNT_PEOPLE_DRAWN } from '@bidstack/shared';

/**
 * People the account map draws. One loaded row past this is not shown.
 * Same limit as the company people query.
 */
export { ACCOUNT_PEOPLE_DRAWN };

/**
 * One people page. The extra row only says another person exists.
 * It is not shown, and it is not a total.
 */
export function accountPeoplePage<T>(rows: readonly T[]): {
  people: T[];
  pageContinues: boolean;
} {
  const pageContinues = rows.length > ACCOUNT_PEOPLE_DRAWN;
  return {
    people: pageContinues ? rows.slice(0, ACCOUNT_PEOPLE_DRAWN) : [...rows],
    pageContinues,
  };
}

/**
 * People count for the account map. A longer loaded list is the latest
 * names, not every person. A list that fits keeps "N people".
 * No person total is invented.
 */
export function accountPeopleCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${ACCOUNT_PEOPLE_DRAWN} in the latest ${ACCOUNT_PEOPLE_DRAWN}, not every person`;
  }
  return `${count} people`;
}

/**
 * Relationship-map meta. A longer loaded list does not print that length
 * as the people on the account. A list that fits keeps "N people · M reporting lines".
 */
export function accountPeopleMapMeta(count: number, pageContinues: boolean, edges: number): string {
  if (pageContinues) return accountPeopleCaption(count, true);
  const lines = `${edges} reporting line${edges === 1 ? '' : 's'}`;
  return `${accountPeopleCaption(count, false)} · ${lines}`;
}
