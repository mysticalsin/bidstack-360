// Pure layout for the relationship map (people-map #49 reporting lines).
export interface MapPerson { id: string; name: string; title: string | null; standing: string; reportsToContactId: string | null }

/** Lay people out by reporting depth under the account root. Pure. */
export function layoutOrg(people: MapPerson[]) {
  const ids = new Set(people.map((p) => p.id));
  const parent = (p: MapPerson) => (p.reportsToContactId && ids.has(p.reportsToContactId) ? p.reportsToContactId : null);
  const depth = new Map<string, number>();
  const depthOf = (p: MapPerson, seen = new Set<string>()): number => {
    if (depth.has(p.id)) return depth.get(p.id)!;
    const up = parent(p);
    if (!up || seen.has(p.id)) { depth.set(p.id, 1); return 1; }
    seen.add(p.id);
    const d = depthOf(people.find((q) => q.id === up)!, seen) + 1;
    depth.set(p.id, d);
    return d;
  };
  people.forEach((p) => depthOf(p));
  const levels: MapPerson[][] = [];
  for (const p of people) (levels[depth.get(p.id)! - 1] ??= []).push(p);
  return { levels, parent, edges: people.filter((p) => parent(p)).length };
}

