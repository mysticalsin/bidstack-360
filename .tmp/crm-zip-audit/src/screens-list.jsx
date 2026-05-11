/* Opportunities list, Pipeline kanban, Contacts, Tasks, Reports */

/* ───────── Opportunities list ───────── */
const OpportunitiesList = ({ navigate }) => {
  const [search, setSearch] = React.useState("");
  const [stageF, setStageF] = React.useState("all");
  const [ownerF, setOwnerF] = React.useState("all");
  const [sort, setSort] = React.useState({ key:"value", dir:"desc" });
  const [stageOpen, setStageOpen] = React.useState(false);
  const [ownerOpen, setOwnerOpen] = React.useState(false);

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
          <div className="page-sub">{rows.length} of {window.OPPS.length} bids · sorted by {sort.key}</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="download" size={14} />Export CSV</button>
          <button className="btn btn-primary"><Icon name="plus" size={14} />New opportunity</button>
        </div>
      </div>

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
              <tr><td colSpan="9">
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

/* ───────── Pipeline kanban ───────── */
const PipelineKanban = ({ navigate }) => {
  const [opps, setOpps] = React.useState(() => window.OPPS.map(o => ({ ...o })));
  const [draggingId, setDraggingId] = React.useState(null);
  const [dragOver, setDragOver] = React.useState(null);

  const stages = window.STAGES;

  const onDragStart = (e, id) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e, stageId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOver !== stageId) setDragOver(stageId);
  };
  const onDrop = (e, stageId) => {
    e.preventDefault();
    if (!draggingId) return;
    setOpps(prev => prev.map(o => o.id === draggingId ? { ...o, stage: stageId } : o));
    setDraggingId(null); setDragOver(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Pipeline</h1>
          <div className="page-sub">Drag bids between stages — changes are auto-pushed to Dust via webhook.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="filter" size={14} />Filter</button>
          <button className="btn btn-primary"><Icon name="plus" size={14} />New opportunity</button>
        </div>
      </div>

      <div className="kb-board">
        {stages.map(s => {
          const cards = opps.filter(o => o.stage === s.id);
          const sum = cards.reduce((acc, o) => acc + o.value, 0);
          return (
            <div
              key={s.id}
              className={"kb-col" + (dragOver===s.id?" dragover":"")}
              onDragOver={e => onDragOver(e, s.id)}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => onDrop(e, s.id)}
            >
              <div className="kb-col-head">
                <div className="kb-col-name">
                  <span className="dot" style={{display:"inline-block", width:8, height:8, borderRadius:"50%", background:s.color, marginRight:8, verticalAlign:"middle"}} />
                  {s.name}
                </div>
                <span className="kb-col-count">{cards.length}</span>
              </div>
              <div className="kb-col-sum">{window.formatMoney(sum,"USD")} · {cards.length} bids</div>
              <div className="kb-list">
                {cards.map(o => (
                  <div
                    key={o.id}
                    className={"kb-card" + (draggingId===o.id?" dragging":"")}
                    draggable
                    onDragStart={e => onDragStart(e, o.id)}
                    onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
                    onClick={() => navigate({screen:"opp", id:o.id})}
                  >
                    <div className="kbc-customer">{o.id} · {o.type}</div>
                    <div className="kbc-name" style={{display:"flex", alignItems:"center", gap:8}}><CompanyMark customer={o.customer} size={20} />{o.customer}</div>
                    <div className="t-xs text-tertiary truncate">{o.name}</div>
                    <div className="kbc-foot">
                      <Avatar initials={o.ownerInitials} size={22} />
                      <div className="kbc-val">{window.formatMoney(o.value, o.currency)}</div>
                    </div>
                    <div style={{display:"flex", gap:6, alignItems:"center"}}>
                      <Pbar value={o.probability} />
                      <span style={{fontSize:11, color:"var(--fg-tertiary)", fontFeatureSettings:'"tnum"'}}>{o.probability}%</span>
                    </div>
                  </div>
                ))}
                {cards.length === 0 && (
                  <div style={{padding:"16px 8px", textAlign:"center", color:"var(--fg-tertiary)", fontSize:12}}>
                    No bids in this stage
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

/* ───────── Contacts ───────── */
const ContactsScreen = ({ navigate }) => {
  const [q, setQ] = React.useState("");
  const rows = window.CONTACTS.filter(c => !q || (c.name + " " + c.role + " " + c.customer).toLowerCase().includes(q.toLowerCase()));
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
      <div className="card" style={{padding:0}}>
        <table className="dt">
          <thead><tr>
            <th>Name</th><th>Role</th><th>Customer</th><th>Influence</th><th>Last touch</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className="row-clickable">
                <td>
                  <div style={{display:"flex", alignItems:"center", gap:10}}>
                    <span className="cav" style={{width:32, height:32}}>{c.initials}</span>
                    <div>
                      <div style={{fontWeight:600, fontSize:13}}>{c.name}</div>
                      <div className="t-xs text-tertiary">{c.email}</div>
                    </div>
                  </div>
                </td>
                <td className="t-xs">{c.role}</td>
                <td className="t-xs">{c.customer}</td>
                <td>
                  <StatusPill tone={c.influence==="Decision maker"?"brand":c.influence==="Champion"?"success":"neutral"} label={c.influence} />
                </td>
                <td className="t-xs text-secondary">{c.lastTouch}</td>
                <td>
                  <div style={{display:"flex", gap:4, justifyContent:"flex-end"}}>
                    <button className="iconbtn" title="Email"><Icon name="mail" size={15} /></button>
                    <button className="iconbtn" title="Call"><Icon name="phone" size={15} /></button>
                    <button className="iconbtn" title="More"><Icon name="more" size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* ───────── Tasks ───────── */
const TasksScreen = ({ navigate }) => {
  const [tasks, setTasks] = React.useState(() => window.TASKS.map(t => ({ ...t, done: false })));
  const toggle = (id) => setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Tasks</h1>
          <div className="page-sub">{tasks.filter(t=>!t.done).length} open · {tasks.filter(t=>!t.done && window.daysUntil(t.due)<7).length} due this week</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="filter" size={14} />Filter</button>
          <button className="btn btn-primary"><Icon name="plus" size={14} />New task</button>
        </div>
      </div>
      <div className="card" style={{padding:0}}>
        <table className="dt">
          <thead><tr>
            <th style={{width:30}}></th>
            <th>Task</th>
            <th>Opportunity</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Owner</th>
            <th>Due</th>
          </tr></thead>
          <tbody>
            {tasks.map(t => {
              const days = window.daysUntil(t.due);
              const dueT = days < 0 ? "danger" : days < 5 ? "warn" : "neutral";
              return (
                <tr key={t.id}>
                  <td onClick={()=>toggle(t.id)} style={{cursor:"pointer"}}>
                    <span style={{
                      display:"inline-flex", width:18, height:18, border:"1.5px solid var(--border-default)",
                      borderRadius:5, alignItems:"center", justifyContent:"center",
                      background: t.done ? "var(--brand-primary)" : "transparent",
                      borderColor: t.done ? "var(--brand-primary)" : "var(--border-default)",
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
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* ───────── Reports ───────── */
const ReportsScreen = () => {
  const opps = window.OPPS;
  const open = opps.filter(o => o.stage !== "won" && o.stage !== "lost");
  const won = opps.filter(o => o.stage === "won");
  const lost = opps.filter(o => o.stage === "lost");

  // Pipeline by industry
  const industries = [...new Set(open.map(o => o.industry))];
  const byIndustry = industries.map(ind => ({
    label: ind,
    value: open.filter(o => o.industry === ind).reduce((s,o)=>s+o.value, 0),
  }));
  const maxIndustry = Math.max(...byIndustry.map(b => b.value), 1);

  // Win/loss
  const wlSegments = [
    { v: won.length,  color: "var(--success)", label:"Won" },
    { v: lost.length, color: "var(--danger)",  label:"Lost" },
  ];
  const wlTotal = won.length + lost.length;

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
        <KpiTile icon="target"   tone="blue"   label="Win rate"        value={Math.round(won.length/wlTotal*100) + "%"} trend="+4%" />
        <KpiTile icon="dollar"   tone="purple" label="Avg deal size"   value={window.formatMoney(open.reduce((s,o)=>s+o.value,0)/open.length,"USD")} />
        <KpiTile icon="clock"    tone="amber"  label="Avg cycle"       value="124d" trend="-8d" />
      </div>

      <div className="dash-row-2">
        <Card title="Pipeline by industry">
          <div className="flex-col gap-3">
            {byIndustry.map(b => (
              <div key={b.label}>
                <div style={{display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:12}}>
                  <span style={{color:"var(--fg-secondary)"}}>{b.label}</span>
                  <span style={{fontWeight:600}}>{window.formatMoney(b.value,"USD")}</span>
                </div>
                <div className="pbar" style={{maxWidth:"100%"}}>
                  <div style={{ width: (b.value/maxIndustry*100) + "%" }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Win / loss (last 90d)">
          <div className="health">
            <Donut segments={wlSegments} total={wlTotal} label={`${won.length}/${wlTotal}`} sub="bids" size={150} />
            <ul className="health-legend">
              {wlSegments.map(s => (
                <li key={s.label}>
                  <span className="d" style={{ background: s.color }} />
                  <span className="lbl">{s.label}</span>
                  <span className="n">{s.v}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card title="Forecast — next 4 quarters">
        <ForecastChart />
      </Card>

      <Card title="Bids by owner">
        <table className="dt">
          <thead><tr>
            <th>Owner</th><th>Open bids</th><th>Pipeline</th><th>Won (90d)</th><th>Win rate</th>
          </tr></thead>
          <tbody>
            {window.TEAM.filter(u=>u.oppCount>0).map(u => {
              const userOpen = opps.filter(o => o.ownerInitials === u.initials && o.stage !== "won" && o.stage !== "lost");
              const userWon = opps.filter(o => o.ownerInitials === u.initials && o.stage === "won");
              const userTotal = opps.filter(o => o.ownerInitials === u.initials && (o.stage === "won" || o.stage === "lost"));
              return (
                <tr key={u.id}>
                  <td>
                    <div style={{display:"flex", gap:10, alignItems:"center"}}>
                      <Avatar initials={u.initials} size={28} />
                      <div>
                        <div style={{fontWeight:600, fontSize:13}}>{u.name}</div>
                        <div className="t-xs text-tertiary">{u.role}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{userOpen.length}</td>
                  <td className="num" style={{fontWeight:600}}>{window.formatMoney(userOpen.reduce((s,o)=>s+o.value,0),"USD")}</td>
                  <td className="num">{userWon.length}</td>
                  <td>
                    <div style={{display:"flex", gap:8, alignItems:"center"}}>
                      <Pbar value={userTotal.length ? Math.round(userWon.length/userTotal.length*100) : 0} />
                      <span style={{fontSize:12, fontWeight:600}}>{userTotal.length ? Math.round(userWon.length/userTotal.length*100) : 0}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
};

const ForecastChart = () => {
  const data = [
    { q:"Q3 2025", actual: 1.2, forecast: 1.2 },
    { q:"Q4 2025", actual: 1.8, forecast: 1.8 },
    { q:"Q1 2026", actual: 2.4, forecast: 2.4 },
    { q:"Q2 2026", actual: 3.1, forecast: 3.1 },
    { q:"Q3 2026", actual: null, forecast: 4.2 },
    { q:"Q4 2026", actual: null, forecast: 5.0 },
    { q:"Q1 2027", actual: null, forecast: 5.6 },
    { q:"Q2 2027", actual: null, forecast: 6.1 },
  ];
  const max = 6.5;
  const W = 760, H = 220, P = 30;
  const x = (i) => P + i * ((W - 2*P) / (data.length - 1));
  const y = (v) => H - P - (v / max) * (H - 2*P);
  const actualPath = data.filter(d=>d.actual!=null).map((d,i) => `${i===0?"M":"L"}${x(i)},${y(d.actual)}`).join(" ");
  const forecastPath = data.map((d,i) => `${i===0?"M":"L"}${x(i)},${y(d.forecast)}`).join(" ");
  return (
    <div style={{overflow:"auto"}}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{maxWidth: W, display:"block"}}>
        {[0,1,2,3,4,5,6].map(g => (
          <line key={g} x1={P} y1={y(g)} x2={W-P} y2={y(g)} stroke="var(--border-subtle)" strokeWidth="1" />
        ))}
        {[0,2,4,6].map(g => (
          <text key={g} x={P-6} y={y(g)+3} textAnchor="end" fontSize="10" fill="var(--fg-tertiary)">${g}M</text>
        ))}
        <path d={forecastPath} stroke="var(--brand-primary)" strokeWidth="2" fill="none" strokeDasharray="4 4" opacity=".6" />
        <path d={actualPath}   stroke="var(--brand-primary)" strokeWidth="2.5" fill="none" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.forecast)} r={d.actual!=null?4:3} fill={d.actual!=null?"var(--brand-primary)":"var(--surface-card)"} stroke="var(--brand-primary)" strokeWidth="2" />
            <text x={x(i)} y={H-10} textAnchor="middle" fontSize="10" fill="var(--fg-tertiary)">{d.q}</text>
          </g>
        ))}
        <g transform={`translate(${W-200}, 16)`}>
          <line x1="0" y1="0" x2="20" y2="0" stroke="var(--brand-primary)" strokeWidth="2.5" />
          <text x="26" y="3" fontSize="11" fill="var(--fg-secondary)">Closed</text>
          <line x1="80" y1="0" x2="100" y2="0" stroke="var(--brand-primary)" strokeWidth="2" strokeDasharray="4 4" />
          <text x="106" y="3" fontSize="11" fill="var(--fg-secondary)">Forecast</text>
        </g>
      </svg>
    </div>
  );
};

Object.assign(window, { OpportunitiesList, PipelineKanban, ContactsScreen, TasksScreen, ReportsScreen, ForecastChart });
