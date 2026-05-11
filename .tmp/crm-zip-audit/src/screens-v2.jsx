/* v2 upgraded screens — replaces window.OpportunitiesList, TasksScreen, ContactsScreen, ReportsScreen,
   PortfolioDashboard (wraps it with a TodayPanel), and patches OpportunityDetail to inject new modules. */

/* ========== Opportunities list with bulk select ========== */
const OpportunitiesListV2 = ({ navigate }) => {
  const [search, setSearch] = React.useState("");
  const [stageF, setStageF] = React.useState("all");
  const [ownerF, setOwnerF] = React.useState("all");
  const [sort, setSort] = React.useState({ key:"value", dir:"desc" });
  const [stageOpen, setStageOpen] = React.useState(false);
  const [ownerOpen, setOwnerOpen] = React.useState(false);
  const [selected, setSelected] = React.useState(new Set());

  let rows = window.OPPS.filter(o => {
    if (search && !(o.name + " " + o.customer + " " + o.id).toLowerCase().includes(search.toLowerCase())) return false;
    if (stageF !== "all" && o.stage !== stageF) return false;
    if (ownerF !== "all" && o.owner !== ownerF) return false;
    return true;
  });
  rows.sort((a,b) => {
    const va = a[sort.key], vb = b[sort.key];
    const r = (va > vb) - (va < vb);
    return sort.dir === "desc" ? -r : r;
  });

  const owners = [...new Set(window.OPPS.map(o => o.owner))];
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const someSelected = selected.size > 0;

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)));
  };
  const selectedValue = rows.filter(r => selected.has(r.id)).reduce((s,o) => s + o.value, 0);

  const Sortable = ({ k, label, num }) => (
    <th className={num?"num":""} onClick={()=>setSort(s => ({ key:k, dir: s.key===k && s.dir==="desc" ? "asc" : "desc" }))}>
      {label}
      <span className="sort-ind">{sort.key===k ? (sort.dir==="desc"?"▼":"▲") : "↕"}</span>
    </th>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Opportunities</h1>
          <div className="page-sub">{rows.length} of {window.OPPS.length} bids · {window.formatMoney(rows.reduce((s,o)=>s+o.value,0),"USD")} total · sorted by {sort.key}</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="download" size={14} />Export CSV</button>
          <button className="btn btn-primary"><Icon name="plus" size={14} />New opportunity</button>
        </div>
      </div>

      {someSelected && (
        <div className="bulkbar">
          <span className="bulkbar-count">{selected.size} selected</span>
          <span className="t-xs" style={{color:"rgba(255,255,255,.7)"}}>· {window.formatMoney(selectedValue,"USD")} pipeline</span>
          <div className="bulkbar-actions">
            <button className="bulkbar-btn"><Icon name="user" size={12}/>Reassign</button>
            <button className="bulkbar-btn"><Icon name="pipeline" size={12}/>Move stage</button>
            <button className="bulkbar-btn"><Icon name="flag" size={12}/>Tag</button>
            <button className="bulkbar-btn"><Icon name="sparkle" size={12}/>Ask Dust</button>
            <button className="bulkbar-btn"><Icon name="download" size={12}/>Export</button>
          </div>
          <button className="bulkbar-close" onClick={()=>setSelected(new Set())}><Icon name="close" size={14}/></button>
        </div>
      )}

      <div className="filterbar">
        <Icon name="search" size={14} style={{color:"var(--fg-tertiary)"}} />
        <input type="text" placeholder="Search bids, customers, IDs…" value={search} onChange={e=>setSearch(e.target.value)} />
        <div className="dropdown">
          <button className={"dropdown-btn" + (stageF!=="all"?" active-filter":"")} onClick={()=>{setStageOpen(v=>!v); setOwnerOpen(false);}}>
            <Icon name="filter" size={12} />
            Stage: {stageF==="all"?"All":stageName(stageF)}
            <Icon name="caret" size={11} />
          </button>
          {stageOpen && (
            <div className="dropdown-menu">
              <div className={"dropdown-item" + (stageF==="all"?" checked":"")} onClick={()=>{setStageF("all"); setStageOpen(false);}}>All stages</div>
              {window.STAGES.map(s => (
                <div key={s.id} className={"dropdown-item" + (stageF===s.id?" checked":"")} onClick={()=>{setStageF(s.id); setStageOpen(false);}}>
                  <span className="dot" style={{width:8, height:8, borderRadius:"50%", background:s.color}}></span>
                  {s.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="dropdown">
          <button className={"dropdown-btn" + (ownerF!=="all"?" active-filter":"")} onClick={()=>{setOwnerOpen(v=>!v); setStageOpen(false);}}>
            <Icon name="user" size={12} />
            Owner: {ownerF==="all"?"All":ownerF}
            <Icon name="caret" size={11} />
          </button>
          {ownerOpen && (
            <div className="dropdown-menu">
              <div className={"dropdown-item" + (ownerF==="all"?" checked":"")} onClick={()=>{setOwnerF("all"); setOwnerOpen(false);}}>All owners</div>
              {owners.map(o => (
                <div key={o} className={"dropdown-item" + (ownerF===o?" checked":"")} onClick={()=>{setOwnerF(o); setOwnerOpen(false);}}>{o}</div>
              ))}
            </div>
          )}
        </div>
        <div style={{flex:1}} />
        <button className="btn btn-secondary btn-sm" onClick={()=>{setSearch(""); setStageF("all"); setOwnerF("all");}}>Reset</button>
      </div>

      <div className="card" style={{padding:0}}>
        <table className="dt">
          <thead>
            <tr>
              <th className="row-checkbox" onClick={toggleAll}>
                <span className={"cbx" + (allSelected?" checked":"")}>{allSelected && <Icon name="check" size={11} sw={3}/>}</span>
              </th>
              <Sortable k="id" label="ID" />
              <Sortable k="customer" label="Customer / opportunity" />
              <Sortable k="stage" label="Stage" />
              <Sortable k="type" label="Type" />
              <Sortable k="owner" label="Owner" />
              <Sortable k="value" label="Value" num />
              <Sortable k="probability" label="Win %" />
              <Sortable k="closeDate" label="Close" />
              <Sortable k="health" label="Health" />
            </tr>
          </thead>
          <tbody>
            {rows.map(o => (
              <tr key={o.id} className="row-clickable" onClick={()=>navigate({screen:"opp", id:o.id})}>
                <td className="row-checkbox" onClick={e => { e.stopPropagation(); toggle(o.id); }}>
                  <span className={"cbx" + (selected.has(o.id)?" checked":"")}>
                    {selected.has(o.id) && <Icon name="check" size={11} sw={3}/>}
                  </span>
                </td>
                <td className="t-mono t-xs text-secondary">{o.id}</td>
                <td>
                  <div style={{display:"flex", alignItems:"center", gap:10}}>
                    <CompanyMark customer={o.customer} size={28} />
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:600, fontSize:13}}>{o.customer}</div>
                      <div className="t-xs text-tertiary truncate" style={{maxWidth:300}}>{o.name}</div>
                    </div>
                  </div>
                </td>
                <td><StatusPill tone={stageTone(o.stage)} label={stageName(o.stage)} /></td>
                <td className="t-xs text-secondary">{o.type}</td>
                <td><Avatar initials={o.ownerInitials} size={26} /></td>
                <td className="num" style={{fontWeight:600}}>{window.formatMoney(o.value, o.currency)}</td>
                <td>
                  <div style={{display:"flex", alignItems:"center", gap:8}}>
                    <Pbar value={o.probability} />
                    <span style={{fontSize:12, fontWeight:600, minWidth:28}}>{o.probability}%</span>
                  </div>
                </td>
                <td className="t-num t-xs">{window.formatDate(o.closeDate)}</td>
                <td>
                  <StatusPill tone={o.health>=70?"success":o.health>=50?"warn":"danger"} label={String(o.health)} dot={false} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan="10">
                <div className="empty">
                  <Icon name="search" size={32} className="icon" />
                  <div className="t">No opportunities match</div>
                  <div className="t-xs">Try adjusting your filters.</div>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* ========== Tasks v2 — grouped by overdue/today/this week/upcoming ========== */
const TasksScreenV2 = () => {
  const [tasks, setTasks] = React.useState(() => window.TASKS.map(t => ({ ...t, done: false })));
  const [tab, setTab] = React.useState("list");
  const toggle = (id) => setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));

  const groups = [
    { key:"overdue", label:"Overdue",     filter: t => !t.done && window.daysUntil(t.due) < 0,                              cls:"overdue" },
    { key:"today",   label:"Due today",   filter: t => !t.done && window.daysUntil(t.due) === 0,                            cls:"today" },
    { key:"week",    label:"This week",   filter: t => !t.done && window.daysUntil(t.due) > 0 && window.daysUntil(t.due) <= 7, cls:"" },
    { key:"later",   label:"Later",       filter: t => !t.done && window.daysUntil(t.due) > 7,                              cls:"" },
    { key:"done",    label:"Completed",   filter: t => t.done,                                                              cls:"" },
  ];

  const renderRow = (t) => {
    const days = window.daysUntil(t.due);
    const dueT = t.done ? "neutral" : days < 0 ? "danger" : days < 5 ? "warn" : "neutral";
    return (
      <tr key={t.id}>
        <td onClick={()=>toggle(t.id)} style={{cursor:"pointer", width:30}}>
          <span style={{
            display:"inline-flex", width:18, height:18, border:"1.5px solid var(--border-strong)",
            borderRadius:5, alignItems:"center", justifyContent:"center",
            background: t.done ? "var(--brand-primary)" : "transparent",
            borderColor: t.done ? "var(--brand-primary)" : "var(--border-strong)",
            color:"#fff"
          }}>
            {t.done && <Icon name="check" size={12} sw={3} />}
          </span>
        </td>
        <td style={{textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--fg-tertiary)" : "var(--fg-primary)", fontWeight: 500}}>{t.title}</td>
        <td className="t-mono t-xs text-secondary">{t.opp}</td>
        <td>
          <StatusPill tone={t.priority==="Critical"?"danger":t.priority==="High"?"warn":t.priority==="Medium"?"info":"neutral"} label={t.priority} />
        </td>
        <td className="t-xs">{t.status}</td>
        <td><Avatar initials={t.owner} size={26} /></td>
        <td><StatusPill tone={dueT} label={days<0?`${-days}d late`:days===0?"Today":window.formatDate(t.due)} dot={false} /></td>
      </tr>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Tasks</h1>
          <div className="page-sub">{tasks.filter(t=>!t.done).length} open · {tasks.filter(t=>!t.done && window.daysUntil(t.due)<0).length} overdue · {tasks.filter(t=>!t.done && window.daysUntil(t.due)<7).length} due this week</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="filter" size={14} />Filter</button>
          <button className="btn btn-primary"><Icon name="plus" size={14} />New task</button>
        </div>
      </div>

      <div className="task-tabs">
        <button className={"task-tab" + (tab==="list"?" active":"")} onClick={()=>setTab("list")}><Icon name="tasks" size={13}/> Grouped</button>
        <button className={"task-tab" + (tab==="all"?" active":"")} onClick={()=>setTab("all")}><Icon name="files" size={13}/> All tasks</button>
      </div>

      <div className="card" style={{padding:0}}>
        {tab === "list" ? (
          groups.map(g => {
            const items = tasks.filter(g.filter);
            if (!items.length && g.key === "done") return null;
            return (
              <div key={g.key}>
                <div className={"task-section-head " + g.cls}>
                  <span>{g.label}</span>
                  <span className="task-section-count">{items.length}</span>
                </div>
                {items.length > 0 ? (
                  <table className="dt">
                    <tbody>
                      {items.map(renderRow)}
                    </tbody>
                  </table>
                ) : (
                  <div style={{padding:"4px 18px 14px", fontSize:12, color:"var(--fg-tertiary)", fontStyle:"italic"}}>Nothing here.</div>
                )}
              </div>
            );
          })
        ) : (
          <table className="dt">
            <thead><tr>
              <th style={{width:30}}></th>
              <th>Task</th><th>Opportunity</th><th>Priority</th><th>Status</th><th>Owner</th><th>Due</th>
            </tr></thead>
            <tbody>{tasks.map(renderRow)}</tbody>
          </table>
        )}
      </div>
    </>
  );
};

/* ========== Contacts v2 — grouped by account ========== */
const ContactsScreenV2 = () => {
  const [q, setQ] = React.useState("");
  const filtered = window.CONTACTS.filter(c => !q || (c.name + " " + c.role + " " + c.customer).toLowerCase().includes(q.toLowerCase()));
  const accounts = [...new Set(filtered.map(c => c.customer))];

  const strengthFor = (c) => {
    if (c.influence === "Decision maker") return 4;
    if (c.influence === "Champion") return 3;
    if (c.influence === "Influencer") return 2;
    return 1;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Contacts</h1>
          <div className="page-sub">{window.CONTACTS.length} contacts across {new Set(window.CONTACTS.map(c=>c.customer)).size} accounts</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="upload" size={14} />Import</button>
          <button className="btn btn-primary"><Icon name="plus" size={14} />New contact</button>
        </div>
      </div>
      <div className="filterbar">
        <Icon name="search" size={14} style={{color:"var(--fg-tertiary)"}} />
        <input type="text" placeholder="Search contacts" value={q} onChange={e=>setQ(e.target.value)} />
      </div>

      {accounts.map(acc => {
        const ppl = filtered.filter(c => c.customer === acc);
        const opp = window.OPPS.find(o => o.customer === acc);
        return (
          <div key={acc} className="contact-account">
            <div className="ca-head">
              <CompanyMark customer={acc} size={32} />
              <div style={{flex:1, minWidth:0}}>
                <div className="ca-name">{acc}</div>
                <div className="ca-sub">{ppl.length} contact{ppl.length===1?"":"s"}{opp ? " · " + stageName(opp.stage) + " · " + window.formatMoney(opp.value, opp.currency) : ""}</div>
              </div>
              <button className="btn btn-secondary btn-sm"><Icon name="plus" size={12}/>Add contact</button>
            </div>
            <div className="ca-grid">
              {ppl.map(c => (
                <div key={c.id} className="ca-card">
                  <span className="cav" style={{width:36, height:36, fontSize:12}}>{c.initials}</span>
                  <div className="ca-card-meta">
                    <div className="ca-card-name">{c.name}</div>
                    <div className="ca-card-role">{c.role}</div>
                  </div>
                  <div className="ca-strength" title={c.influence}>
                    {[1,2,3,4].map(n => <span key={n} className={n <= strengthFor(c) ? "on" : ""}/>)}
                  </div>
                  <div style={{display:"flex", gap:2}}>
                    <button className="iconbtn" title={"Email " + c.email}><Icon name="mail" size={14}/></button>
                    <button className="iconbtn" title="Call"><Icon name="phone" size={14}/></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
};

/* ========== Reports v2 — funnel + win/loss reasons + leaderboard ========== */
const ReportsScreenV2 = () => {
  const opps = window.OPPS;
  const open = opps.filter(o => o.stage !== "won" && o.stage !== "lost");
  const won = opps.filter(o => o.stage === "won");
  const lost = opps.filter(o => o.stage === "lost");
  const wlTotal = won.length + lost.length;

  // Funnel — count by stage in order
  const funnelStages = window.STAGES.filter(s => s.id !== "lost");
  const funnel = funnelStages.map(s => ({
    label: s.name, color: s.color,
    count: opps.filter(o => o.stage === s.id).length + (s.id === "qualifying" ? 0 : 0),
    cum: opps.filter(o => {
      const order = window.STAGES.findIndex(x => x.id === o.stage);
      const sOrder = window.STAGES.findIndex(x => x.id === s.id);
      return order >= sOrder && o.stage !== "lost";
    }).length,
    value: opps.filter(o => o.stage === s.id).reduce((sum,o)=>sum+o.value,0),
  }));
  const maxFunnel = Math.max(...funnel.map(f => f.cum), 1);

  // Win/loss reasons (synthesized)
  const winReasons = [
    { label:"Better technical fit",   pct: 38, color:"var(--success)" },
    { label:"Pricing & TCO",          pct: 24, color:"var(--success)" },
    { label:"Reference customers",    pct: 18, color:"var(--success)" },
    { label:"Speed of response",      pct: 12, color:"var(--success)" },
    { label:"Existing relationship",  pct:  8, color:"var(--success)" },
  ];
  const lossReasons = [
    { label:"Lost on price",          pct: 42, color:"var(--danger)" },
    { label:"Incumbent kept it",      pct: 22, color:"var(--danger)" },
    { label:"Scope didn't match",     pct: 16, color:"var(--danger)" },
    { label:"Lost executive sponsor", pct: 12, color:"var(--danger)" },
    { label:"Project cancelled",      pct:  8, color:"var(--danger)" },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports &amp; analytics</h1>
          <div className="page-sub">Last 90 days · auto-refreshed every 15 min from Dust workspace.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="download" size={14} />Export</button>
          <button className="btn btn-secondary"><Icon name="calendar" size={14} />90 days <Icon name="caret" size={11} /></button>
        </div>
      </div>

      <div className="kpi-grid cols-4">
        <KpiTile icon="trophy"   tone="jade"   label="Bids won"        value={won.length} sub={window.formatMoney(won.reduce((s,o)=>s+o.value,0),"USD")} />
        <KpiTile icon="target"   tone="blue"   label="Win rate"        value={(wlTotal ? Math.round(won.length/wlTotal*100) : 0) + "%"} trend="+4%" />
        <KpiTile icon="dollar"   tone="purple" label="Avg deal size"   value={window.formatMoney(open.reduce((s,o)=>s+o.value,0)/Math.max(open.length,1),"USD")} />
        <KpiTile icon="clock"    tone="amber"  label="Avg cycle"       value="124d" trend="-8d" />
      </div>

      <Card title="Pipeline funnel" action={<span className="t-xs text-tertiary">{opps.length} opportunities · 90d window</span>}>
        <div className="funnel">
          {funnel.map((f, i) => {
            const pct = (f.cum / maxFunnel) * 100;
            const conv = i === 0 ? 100 : Math.round((f.cum / funnel[0].cum) * 100);
            return (
              <div key={f.label} className="fn-row">
                <div className="fn-label">{f.label}</div>
                <div>
                  <div className="fn-bar" style={{width: pct + "%", background: f.color}}>
                    {f.cum} bids
                  </div>
                </div>
                <div className="fn-value">{window.formatMoney(f.value || 0,"USD")}</div>
                <div className="fn-pct">{conv}%</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="dash-row-2">
        <Card title="Why we win" action={<span className="t-xs" style={{color:"var(--success)", fontWeight:600}}>{won.length} wins</span>}>
          <div className="wlreasons">
            {winReasons.map(r => (
              <div key={r.label} className="wlr">
                <div className="wlr-label">{r.label}</div>
                <div className="wlr-bar"><div className="wlr-fill" style={{width: r.pct + "%", background: r.color}}/></div>
                <div className="fn-pct" style={{minWidth:32}}>{r.pct}%</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Why we lose" action={<span className="t-xs" style={{color:"var(--danger)", fontWeight:600}}>{lost.length} losses</span>}>
          <div className="wlreasons">
            {lossReasons.map(r => (
              <div key={r.label} className="wlr">
                <div className="wlr-label">{r.label}</div>
                <div className="wlr-bar"><div className="wlr-fill" style={{width: r.pct + "%", background: r.color}}/></div>
                <div className="fn-pct" style={{minWidth:32}}>{r.pct}%</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Forecast — next 4 quarters">
        <window.ForecastChart />
      </Card>

      <Card title="Bids by owner — leaderboard" noPad>
        <table className="dt">
          <thead><tr>
            <th style={{width:40}}>#</th>
            <th>Owner</th><th>Open bids</th><th>Pipeline</th><th>Won (90d)</th><th>Win rate</th>
          </tr></thead>
          <tbody>
            {window.TEAM.filter(u=>u.oppCount>0)
              .map(u => {
                const userOpen = opps.filter(o => o.ownerInitials === u.initials && o.stage !== "won" && o.stage !== "lost");
                const userWon = opps.filter(o => o.ownerInitials === u.initials && o.stage === "won");
                const userTotal = opps.filter(o => o.ownerInitials === u.initials && (o.stage === "won" || o.stage === "lost"));
                const wr = userTotal.length ? Math.round(userWon.length/userTotal.length*100) : 0;
                const pipe = userOpen.reduce((s,o)=>s+o.value,0);
                return { u, userOpen, userWon, wr, pipe };
              })
              .sort((a,b) => b.pipe - a.pipe)
              .map((r, i) => (
                <tr key={r.u.id}>
                  <td className="t-num" style={{fontWeight:700, color: i<3?"var(--brand-primary)":"var(--fg-tertiary)"}}>{i+1}</td>
                  <td>
                    <div style={{display:"flex", gap:10, alignItems:"center"}}>
                      <Avatar initials={r.u.initials} size={28} />
                      <div>
                        <div style={{fontWeight:600, fontSize:13}}>{r.u.name}</div>
                        <div className="t-xs text-tertiary">{r.u.role}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{r.userOpen.length}</td>
                  <td className="num" style={{fontWeight:600}}>{window.formatMoney(r.pipe,"USD")}</td>
                  <td className="num">{r.userWon.length}</td>
                  <td>
                    <div style={{display:"flex", gap:8, alignItems:"center"}}>
                      <Pbar value={r.wr} />
                      <span style={{fontSize:12, fontWeight:600}}>{r.wr}%</span>
                    </div>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
};

/* ========== Wrappers: Dashboard with Today panel + Opp detail with new modules ========== */
const PortfolioDashboardV2 = ({ navigate }) => (
  <>
    <TodayPanel navigate={navigate} />
    <window._PortfolioDashboardV1 navigate={navigate} />
  </>
);

const OpportunityDetailV2 = ({ opp, navigate, openDust }) => (
  <>
    <window._OpportunityDetailV1 opp={opp} navigate={navigate} openDust={openDust} />
    <div className="dash-grid">
      <MeddpiccScorecard opp={opp} />
      <CommsTimeline opp={opp} />
    </div>
    <DocumentsHub opp={opp} />
  </>
);

/* Stash originals, then overwrite */
window._PortfolioDashboardV1 = window.PortfolioDashboard;
window._OpportunityDetailV1  = window.OpportunityDetail;

Object.assign(window, {
  PortfolioDashboard: PortfolioDashboardV2,
  OpportunityDetail:  OpportunityDetailV2,
  OpportunitiesList:  OpportunitiesListV2,
  TasksScreen:        TasksScreenV2,
  ContactsScreen:     ContactsScreenV2,
  ReportsScreen:      ReportsScreenV2,
});
