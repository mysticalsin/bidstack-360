import { CONNECTION_STANDINGS, type ConnectionStanding } from '@bidstack/shared';

export const STANDING_LABEL: Record<ConnectionStanding, string> = {
  unknown: 'Unknown',
  evidenced: 'Evidenced',
  stale: 'Stale',
  conflicted: 'Conflicted',
  needs_review: 'Needs review',
};

export interface BuyingGroupNode {
  name: string;
}

export interface BuyingGroupLink {
  source: number;
  target: number;
  value: 1;
}

/**
 * Opportunity, then standing, then person. Every link is one person.
 * Standing is a label, not a score, and a title is not a node.
 */
export function shapeBuyingGroup(
  people: readonly { id: string; name: string; standing: ConnectionStanding }[],
): { nodes: BuyingGroupNode[]; links: BuyingGroupLink[] } | null {
  if (people.length === 0) return null;

  const present = CONNECTION_STANDINGS.filter((standing) =>
    people.some((person) => person.standing === standing),
  );
  const standingIndex = new Map(present.map((standing, index) => [standing, index + 1]));
  const nodes: BuyingGroupNode[] = [
    { name: 'This opportunity' },
    ...present.map((standing) => ({ name: STANDING_LABEL[standing] })),
  ];
  const links: BuyingGroupLink[] = [];
  const seenNames = new Map<string, number>();

  for (const person of people) {
    const standingAt = standingIndex.get(person.standing);
    if (standingAt === undefined) continue;
    const count = (seenNames.get(person.name) ?? 0) + 1;
    seenNames.set(person.name, count);
    const name = count === 1 ? person.name : `${person.name} (${count})`;
    const personAt = nodes.length;
    nodes.push({ name });
    links.push({ source: 0, target: standingAt, value: 1 });
    links.push({ source: standingAt, target: personAt, value: 1 });
  }

  return { nodes, links };
}
