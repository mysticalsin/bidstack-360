# Optimistic stage move that doesn't flash stale data on the detail page

**Problem:** dragging an opportunity card to a new column on the kanban
correctly updated the list cache instantly, but if the user had the detail
page open in another tab (or navigated to it before the mutation resolved),
the detail view briefly showed the **old** stage before TanStack Query
revalidated. Felt buggy.

**Diagnosis:** the optimistic update only patched
`['opps', filters]` (the list query). The detail query
`['opp', id]` had its own cached snapshot, untouched. On the detail page,
React Query served the stale cache first and only revalidated on focus.

**Fix:** snapshot AND patch BOTH caches in the same `onMutate`, then roll
both back in `onError`. From `apps/web/src/hooks/useStageMutation.ts`:

```ts
return useMutation({
  mutationFn: ({ id, stage }) =>
    api(`/api/opportunities/${id}/stage`, {
      method: 'POST',
      body: JSON.stringify({ stage }),
    }),
  onMutate: async ({ id, stage }) => {
    await Promise.all([
      qc.cancelQueries({ queryKey: ['opps'] }),
      qc.cancelQueries({ queryKey: ['opp', id] }),
    ]);
    const prevList = qc.getQueriesData<{ items: Opp[] }>({ queryKey: ['opps'] });
    const prevDetail = qc.getQueryData<Opp>(['opp', id]);

    qc.setQueriesData<{ items: Opp[] }>({ queryKey: ['opps'] }, (cur) =>
      cur ? { ...cur, items: cur.items.map((o) => (o.id === id ? { ...o, stage } : o)) } : cur,
    );
    qc.setQueryData<Opp>(['opp', id], (cur) => (cur ? { ...cur, stage } : cur));

    return { prevList, prevDetail };
  },
  onError: (_err, { id }, ctx) => {
    if (!ctx) return;
    for (const [key, data] of ctx.prevList) qc.setQueryData(key, data);
    if (ctx.prevDetail) qc.setQueryData(['opp', id], ctx.prevDetail);
  },
  onSettled: (_d, _e, { id }) => {
    qc.invalidateQueries({ queryKey: ['opps'] });
    qc.invalidateQueries({ queryKey: ['opp', id] });
  },
});
```

**Why it works:** `getQueriesData` matches every list query regardless of
filter args, so we don't need to know which filters the user has applied.
`onMutate` returns the snapshot via `ctx`, which `onError` receives — no
external refs, no stale closures.

**Prevention:** any future mutation that affects a record visible on **both**
a list view and a detail view should follow this pattern. Helper candidate
when we have a third example.

**Where else this pattern applies:** task `done` toggle (list + detail),
contact `sentiment` change (list + opp detail's Decision Unit panel),
opportunity `value` patch (list + dashboard KPIs).
