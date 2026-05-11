/* Portfolio dashboard (home) + Opportunity detail (the reference layout, ported) */

/* ───────── Portfolio dashboard ───────── */

const PortfolioDashboard = ({ navigate }) => {
  const opps = window.OPPS;
  const open = opps.filter(o => o.stage !== "won" && o.stage !== "lost");
  const won = opps.filter(o => o.stage === "won");
  const totalPipeline = open.reduce((s,o)=>s+o.value,0);
  const weighted = open.reduce((s,o)=>s+o.value*(o.probability/100),0);
  const avgHealth = Math.round(open.reduce((s,o)=>s+o.health,0)/open.length);
  const winRate = Math.round((won.length / opps.filter(o=>o.stage==="won"||o.stage==="lost").length) * 100);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Bid &amp; presales portfolio</h1>
          <div className="page-sub">Welcome back, Jane. {open.length} open bids · {window.formatMoney(totalPipeline,"USD")} in pipeline · 6 due this month.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="download" size={14} />Export</button>
          <button className="btn btn-primary"><Icon name="plus" size={14} />New opportunity</button>
        </div>
      </div>

      <div className="kpi-grid cols-6">
        <KpiTile icon="briefcase" tone="blue"   label="Open bids"          value={open.length}                                 trend="+2" />
        <KpiTile icon="dollar"    tone="jade"   label="Pipeline value"     value={window.formatMoney(totalPipeline,"USD")}      trend="+12%" />
        <KpiTile icon="target"    tone="purple" label="Weighted forecast"  value={window.formatMoney(weighted,"USD")}           trend="+8%" />
        <KpiTile icon="trophy"    tone="amber"  label="Win rate (90d)"     value={winRate + "%"}                                trend="+4%" />
        <KpiTile icon="growth"    tone="teal"   label="Avg. health"        value={avgHealth + "/100"}                           trend="+3" />
        <KpiTile icon="warning"   tone="rose"   label="At risk"            value={open.filter(o=>o.health<60).length}           trend="-1" />
      </div>

      <div className="dash-grid">
        <Card title="Active opportunities" action={<button className="btn btn-secondary btn-sm" onClick={()=>navigate({screen:"opps"})}>View all</button>} noPad>
          <table className="dt">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>Close</th>
                <th className="num">Value</th>
                <th>Win prob.</th>
              </tr>
            </thead>
            <tbody>
              {open.slice(0,6).map(o => (
                <tr key={o.id} className="row-clickable" onClick={()=>navigate({screen:"opp", id:o.id})}>
                  <td>
                    <div style={{display:"flex", alignItems:"center", gap:10}}>
                      <CompanyMark customer={o.customer} size={28} />
                      <div style={{minWidth:0}}>
                        <div style={{fontWeight:600, fontSize:13}} className="truncate">{o.customer}</div>
                        <div className="t-xs text-tertiary truncate" style={{maxWidth:240}}>{o.name}</div>
                      </div>
                    </div>
                  </td>
                  <td><StatusPill tone={stageTone(o.stage)} label={stageName(o.stage)} /></td>
                  <td><Avatar initials={o.ownerInitials} size={26} /></td>
                  <td className="t-num">{window.formatDate(o.closeDate)}</td>
                  <td className="num">{window.formatMoney(o.value, o.currency)}</td>
                  <td>
                    <div style={{display:"flex", alignItems:"center", gap:8}}>
                      <Pbar value={o.probability} />
                      <span style={{fontSize:12, fontWeight:600, minWidth:30}}>{o.probability}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="flex-col gap-4">
          <Card title="Pipeline by stage">
            <PipelineByStage opps={opps} />
          </Card>
          <Card title="Upcoming deadlines" action={<a className="link-arrow" onClick={()=>navigate({screen:"tasks"})}>All tasks <Icon name="arrow" size={11} /></a>}>
            <ul className="risklist">
              {window.TASKS.slice(0,5).map(t => {
                const days = window.daysUntil(t.due);
                const tone = days < 0 ? "danger" : days < 5 ? "warn" : "neutral";
                return (
                  <li key={t.id}>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:13, fontWeight:500}} className="truncate">{t.title}</div>
                      <div className="t-xs text-tertiary">{t.opp} · due {window.formatDate(t.due)}</div>
                    </div>
                    <StatusPill tone={tone} label={days < 0 ? `${-days}d late` : days === 0 ? "Today" : `in ${days}d`} />
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <div className="dash-row-3">
        <Card title="Win rate by industry">
          <BarsList items={[
            { label:"Financial services",  value: 72, max: 100 },
            { label:"Healthcare",          value: 65, max: 100 },
            { label:"Manufacturing",       value: 58, max: 100 },
            { label:"Insurance",           value: 41, max: 100 },
            { label:"Retail",              value: 80, max: 100 },
          ]} />
        </Card>
        <Card title="Recent activity" action={<a className="link-arrow">View all <Icon name="arrow" size={11} /></a>}>
          <ul className="activity">
            {window.ACTIVITY.slice(0,6).map((it, i) => <ActivityRow key={i} item={it} />)}
          </ul>
        </Card>
        <Card title="Team load">
          <ul className="contacts">
            {window.TEAM.filter(u=>u.oppCount>0).slice(0,5).map(u => (
              <li key={u.id}>
                <span className="cav">{u.initials}</span>
                <div className="cmeta">
                  <div className="cname">{u.name}</div>
                  <div className="crole">{u.role}</div>
                </div>
                <span className="t-eyebrow" style={{color:"var(--brand-primary)"}}>{u.oppCount} bids</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
};

const ActivityRow = ({ item }) => {
  const tones = {
    info:    { bg:"var(--brand-primary-tint)", fg:"var(--brand-primary)" },
    success: { bg:"var(--success-tint)",       fg:"var(--success)" },
    orange:  { bg:"#FCEAD6",                   fg:"#B25400" },
    warn:    { bg:"var(--warning-tint)",       fg:"var(--warning)" },
  };
  const t = tones[item.tone] || tones.info;
  // simple **bold** parse
  const parts = item.text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2,-2)}</b> : <React.Fragment key={i}>{p}</React.Fragment>
  );
  return (
    <li>
      <span className="aic" style={{ background: t.bg, color: t.fg }}>
        <Icon name={item.kind} size={14} />
      </span>
      <div className="atxt">
        <div>{parts}</div>
        <div className="ameta">{item.meta}</div>
      </div>
    </li>
  );
};

const BarsList = ({ items }) => (
  <div className="flex-col gap-3">
    {items.map(it => (
      <div key={it.label}>
        <div style={{display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:12}}>
          <span style={{color:"var(--fg-secondary)"}}>{it.label}</span>
          <span style={{fontWeight:600, fontFeatureSettings:'"tnum"'}}>{it.value}%</span>
        </div>
        <div className="pbar" style={{maxWidth:"100%"}}>
          <div style={{ width: (it.value/it.max*100) + "%", background: "var(--brand-primary)" }} />
        </div>
      </div>
    ))}
  </div>
);

const PipelineByStage = ({ opps }) => {
  const open = opps.filter(o => o.stage !== "won" && o.stage !== "lost");
  const stages = window.STAGES.filter(s => s.id !== "won" && s.id !== "lost");
  const segments = stages.map(s => ({
    color: s.color, label: s.name, v: open.filter(o=>o.stage===s.id).reduce((sum,o)=>sum+o.value,0)
  })).filter(s => s.v > 0);
  const total = segments.reduce((s,x)=>s+x.v,0);
  return (
    <div className="health">
      <Donut segments={segments} total={total || 1} label={window.formatMoney(total,"USD")} sub="open" size={150} />
      <ul className="health-legend">
        {segments.map(s => (
          <li key={s.label}>
            <span className="d" style={{ background: s.color }} />
            <span className="lbl">{s.label}</span>
            <span className="n">{window.formatMoney(s.v,"USD")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ───────── Opportunity detail (matches reference dashboard) ───────── */

const OpportunityDetail = ({ opp, navigate, openDust }) => {
  const [actionsOpen, setActionsOpen] = React.useState(false);
  return (
    <>
      <section className="cust-card">
        <div className="cust-avatar">
          <CompanyLogo customer={opp.customer} size={68} square />
        </div>
        <div className="cust-meta">
          <div className="cust-top">
            <h1 className="cust-name">{opp.customer}</h1>
            <StatusPill tone={stageTone(opp.stage)} label={stageName(opp.stage)} />
            <span className="pill" style={{background:"var(--surface-sunken)", color:"var(--fg-secondary)"}}>{opp.type}</span>
          </div>
          <div className="cust-row">
            <span>{opp.industry}</span><span className="bullet" />
            <span>{opp.size || opp.employees}</span><span className="bullet" />
            <span>{opp.location}</span><span className="bullet" />
            <span className="cust-web">{opp.website} <Icon name="external" size={12} /></span>
          </div>
        </div>
        <div className="cust-actions" style={{position:"relative"}}>
          <button className="btn btn-secondary" onClick={()=>setActionsOpen(v=>!v)}>Actions <Icon name="caret" size={12} /></button>
          {actionsOpen && (
            <div className="menu-pop" style={{top:"100%", marginTop:4}}>
              <div className="mi"><Icon name="edit" size={14} />Edit opportunity</div>
              <div className="mi"><Icon name="copy" size={14} />Duplicate</div>
              <div className="mi"><Icon name="download" size={14} />Export proposal</div>
              <div className="mi"><Icon name="sparkle" size={14} />Ask Dust to summarize</div>
              <div className="sep" />
              <div className="mi danger"><Icon name="close" size={14} />Mark as lost</div>
            </div>
          )}
          <button className="btn btn-primary"><Icon name="plus" size={14} />Add widget</button>
        </div>
      </section>

      <div className="kpi-grid cols-6">
        <KpiTile icon="building" tone="blue"   label="Industry"        value={opp.industry} />
        <KpiTile icon="contacts" tone="jade"   label="Employees"       value={opp.size?.split(" ").pop() || opp.employees || "—"} />
        <KpiTile icon="growth"   tone="purple" label="Annual revenue"  value={opp.revenue || window.formatMoney(opp.value*4,"USD")} />
        <KpiTile icon="files"    tone="orange" label="Bid value"       value={window.formatMoney(opp.value, opp.currency)} sub={`${opp.probability}% probability`} />
        <KpiTile icon="target"   tone="amber"  label="Close date"      value={window.formatDate(opp.closeDate)} sub={`Deadline ${window.formatDate(opp.deadline)}`} />
        <KpiTile icon="endpoint" tone="teal"   label="Total devices"   value={(opp.devices || 1842).toLocaleString()} />
      </div>

      <div className="dash-grid">
        <Card title="Technical scope" action={<button className="btn btn-secondary btn-sm">View all</button>} noPad>
          <div style={{padding:"4px 18px 16px"}}>
            <ScopeRow label="IT Infrastructure" vendors={[
              { slug:"microsoft-365", label:"Microsoft 365" },
              { slug:"azure", label:"Azure" },
              { slug:"aws", label:"AWS" },
              { slug:"google-cloud", label:"Google Cloud" },
              { slug:"vmware", label:"VMware" },
            ]} more={3} />
            <ScopeRow label="Identity &amp; Access" vendors={[
              { slug:"microsoft-entra", label:"Microsoft Entra ID" },
              { slug:"okta", label:"Okta" },
              { slug:"duo", label:"Duo" },
              { slug:"active-directory", label:"Active Directory" },
            ]} more={1} />
            <ScopeRow label="Security" vendors={[
              { slug:"crowdstrike", label:"CrowdStrike" },
              { slug:"microsoft-defender", label:"Microsoft Defender" },
              { slug:"proofpoint", label:"Proofpoint" },
              { slug:"sentinelone", label:"SentinelOne" },
            ]} more={4} />
            <ScopeRow label="Endpoints" vendors={[
              { slug:"intune", label:"Microsoft Intune" },
              { slug:"jamf", label:"Jamf Pro" },
              { slug:"windows", label:"Windows" },
              { slug:"macos", label:"macOS" },
              { slug:"ios", label:"iOS" },
            ]} more={2} />
            <ScopeRow label="Network" vendors={[
              { slug:"cisco-meraki", label:"Cisco Meraki" },
              { slug:"palo-alto", label:"Palo Alto Networks" },
              { slug:"cloudflare", label:"Cloudflare" },
              { slug:"zscaler", label:"Zscaler" },
            ]} more={2} />
            <ScopeRow label="Applications" vendors={[
              { slug:"salesforce", label:"Salesforce" },
              { slug:"servicenow", label:"ServiceNow" },
              { slug:"workday", label:"Workday" },
              { slug:"slack", label:"Slack" },
              { slug:"jira", label:"Jira" },
            ]} more={6} />
          </div>
        </Card>

        <div className="flex-col gap-4">
          <Card title="Win health">
            <HealthDonut value={opp.health} />
          </Card>
          <Card title="Key contacts" action={<a className="link-arrow" onClick={()=>navigate({screen:"contacts"})}>View all <Icon name="arrow" size={11} /></a>}>
            <ul className="contacts">
              {window.CONTACTS.filter(c => c.customer === opp.customer).slice(0,3).map(c => (
                <li key={c.id}>
                  <span className="cav">{c.initials}</span>
                  <div className="cmeta">
                    <div className="cname">{c.name}</div>
                    <div className="crole">{c.role}</div>
                  </div>
                  <button className="iconbtn" title="Email"><Icon name="mail" size={15} /></button>
                  <button className="iconbtn" title="Call"><Icon name="phone" size={15} /></button>
                </li>
              ))}
              {window.CONTACTS.filter(c => c.customer === opp.customer).length === 0 && (
                <li><span className="text-tertiary t-xs">No contacts yet — Dust will sync them automatically.</span></li>
              )}
            </ul>
          </Card>
        </div>
      </div>

      <window.IntelligenceSection opp={opp} openDust={openDust} />

      <div className="dash-row-3">
        <Card title="Bid snapshot">
          <dl className="kvlist">
            {[
              ["Bid ID",          opp.code],
              ["Stage",           stageName(opp.stage)],
              ["Owner",           opp.owner],
              ["Active since",    window.formatDate(opp.activeSince || "2026-01-12")],
              ["Submission due",  window.formatDate(opp.deadline)],
              ["Decision date",   window.formatDate(opp.closeDate)],
              ["Competitors",     opp.competitors.length ? opp.competitors.slice(0,2).join(", ") + (opp.competitors.length>2?` +${opp.competitors.length-2}`:"") : "—"],
            ].map(([k,v]) => (
              <div key={k} className="kv">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Risk &amp; compliance" action={<button className="btn btn-secondary btn-sm">View all</button>}>
          <ul className="risklist">
            {[
              { name:"ISO 27001",      tone:"success", label:"Compliant" },
              { name:"SOC 2 Type II",  tone:"success", label:"Compliant" },
              { name:"PCI DSS",        tone:"warn",    label:"In progress" },
              { name:"Privacy Policy", tone:"success", label:"Compliant" },
            ].map(r => (
              <li key={r.name}>
                <span className="rname">{r.name}</span>
                <StatusPill tone={r.tone} label={r.label} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Open issues" action={<button className="btn btn-secondary btn-sm">View all</button>}>
          <ul className="issues">
            {[
              { sev:"Critical", n:3, tone:"danger" },
              { sev:"High",     n:7, tone:"warn" },
              { sev:"Medium",   n:4, tone:"info" },
              { sev:"Low",      n:6, tone:"neutral" },
            ].map(r => (
              <li key={r.sev}>
                <Icon name="warning" size={14} style={{
                  color: r.tone==="danger"?"var(--danger)":r.tone==="warn"?"var(--warning)":r.tone==="info"?"var(--info)":"var(--fg-tertiary)"
                }} />
                <span className="n">{r.n}</span>
                <StatusPill tone={r.tone} label={r.sev} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="dash-grid">
        <Card title="Engagement roadmap" action={<button className="btn btn-secondary btn-sm">View roadmap</button>}>
          <div className="roadmap">
            <div className="rline"></div>
            <div className="rstops">
              {[
                { q:"Q1 2026", name:"Discovery & qualification",    status:"Strong",        tone:"success",  done:true },
                { q:"Q2 2026", name:"Proposal & SoW v2",            status:"In progress",   tone:"info",     done:true },
                { q:"Q3 2026", name:"Negotiation & legal",          status:"Planned",       tone:"neutral",  done:false },
                { q:"Q4 2026", name:"Kickoff & transition",         status:"Planned",       tone:"neutral",  done:false },
              ].map((s, i) => (
                <div className="rstop" key={i}>
                  <div className={"rmark" + (s.done ? " done" : " future")}></div>
                  <div className="rqtr">{s.q}</div>
                  <div className="r-name">{s.name}</div>
                  <StatusPill tone={s.tone} label={s.status} />
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card title="Recent activity" action={<a className="link-arrow">View all <Icon name="arrow" size={11} /></a>}>
          <ul className="activity">
            {window.ACTIVITY.slice(0,4).map((it, i) => <ActivityRow key={i} item={it} />)}
          </ul>
        </Card>
      </div>
    </>
  );
};

const ScopeRow = ({ label, vendors, more }) => (
  <div className="stack-row">
    <div className="stack-label">{label}</div>
    <div className="stack-chips">
      {vendors.map(v => <VendorChip key={v.slug} slug={v.slug} label={v.label} />)}
      {more > 0 && <span className="chip-more">+{more}</span>}
    </div>
  </div>
);

const HealthDonut = ({ value }) => {
  const segments = [
    { v: 30, color: "var(--sev-strong)",    label: "Strong",          n: 12 },
    { v: 40, color: "var(--sev-good)",      label: "Good",            n: 18 },
    { v: 20, color: "var(--sev-attention)", label: "Needs attention", n: 7 },
    { v: 10, color: "var(--sev-critical)",  label: "Critical",        n: 3 },
  ];
  return (
    <div className="health">
      <Donut segments={segments} total={100} label={String(value)} sub="/100" />
      <ul className="health-legend">
        {segments.map(s => (
          <li key={s.label}>
            <span className="d" style={{ background: s.color }} />
            <span className="lbl">{s.label}</span>
            <span className="n">{s.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

Object.assign(window, { PortfolioDashboard, OpportunityDetail });
