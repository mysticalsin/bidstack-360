/* High-impact modules used inside opportunity detail + dashboard:
   - TodayPanel:        smart attention feed for the dashboard
   - MeddpiccScorecard: B2B qualification framework (industry standard)
   - DocumentsHub:      RFP / SoW / Contract docs with version history + AI summaries
   - CommsTimeline:     emails + meetings + calls feed
   - WinRoom:           daily standup + assignments for late-stage bids
*/

/* ========== Today panel (dashboard) ========== */
const TodayPanel = ({ navigate }) => {
  const opps = window.OPPS;
  const now = new Date();

  // Critical: deadline within 7 days, not won/lost
  const critical = opps
    .filter(o => o.stage !== "won" && o.stage !== "lost" && window.daysUntil(o.deadline) <= 7)
    .sort((a, b) => window.daysUntil(a.deadline) - window.daysUntil(b.deadline));

  // Hot: top 3 by value × probability among open
  const hot = [...opps.filter(o => o.stage !== "won" && o.stage !== "lost")]
    .sort((a, b) => (b.value * b.probability) - (a.value * a.probability))
    .slice(0, 3);

  // At risk: health < 60
  const risk = opps.filter(o => o.stage !== "won" && o.stage !== "lost" && o.health < 60);

  // Quick stats
  const overdueTasks = window.TASKS.filter(t => window.daysUntil(t.due) < 0).length;
  const dueToday = window.TASKS.filter(t => window.daysUntil(t.due) === 0).length;

  return (
    <section className="today-panel">
      <div className="today-head">
        <div>
          <div className="t-eyebrow" style={{color:"var(--brand-primary)"}}>Today · {now.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
          <h2 className="today-title">Your focus</h2>
        </div>
        <div className="today-stats">
          <div className="today-stat">
            <div className="ts-num">{critical.length}</div>
            <div className="ts-label">deadlines this week</div>
          </div>
          <div className="today-stat">
            <div className="ts-num" style={{color: overdueTasks ? "var(--danger)" : undefined}}>{overdueTasks}</div>
            <div className="ts-label">overdue tasks</div>
          </div>
          <div className="today-stat">
            <div className="ts-num">{dueToday}</div>
            <div className="ts-label">due today</div>
          </div>
        </div>
      </div>

      <div className="today-grid">
        <div className="today-col">
          <div className="today-col-head">
            <Icon name="warning" size={14} style={{color:"var(--danger)"}} />
            <span>Critical deadlines</span>
            <span className="today-count">{critical.length}</span>
          </div>
          {critical.slice(0,4).map(o => (
            <div key={o.id} className="today-row" onClick={()=>navigate({screen:"opp", id:o.id})}>
              <CompanyMark customer={o.customer} size={28} />
              <div className="tr-meta">
                <div className="tr-name">{o.customer}</div>
                <div className="tr-sub">{o.nextStep || o.name}</div>
              </div>
              <div className="tr-due">
                <span className="tr-days" style={{color: window.daysUntil(o.deadline) <= 2 ? "var(--danger)" : "var(--warning)"}}>
                  {window.daysUntil(o.deadline) <= 0 ? "Today" : window.daysUntil(o.deadline) + "d"}
                </span>
              </div>
            </div>
          ))}
          {!critical.length && <div className="today-empty">No deadlines in the next 7 days. Breathe.</div>}
        </div>

        <div className="today-col">
          <div className="today-col-head">
            <Icon name="trophy" size={14} style={{color:"var(--success)"}} />
            <span>Hottest deals</span>
            <span className="today-count">{hot.length}</span>
          </div>
          {hot.map(o => (
            <div key={o.id} className="today-row" onClick={()=>navigate({screen:"opp", id:o.id})}>
              <CompanyMark customer={o.customer} size={28} />
              <div className="tr-meta">
                <div className="tr-name">{o.customer}</div>
                <div className="tr-sub">{window.formatMoney(o.value, o.currency)} · {o.probability}% win prob</div>
              </div>
              <Pbar value={o.probability} />
            </div>
          ))}
        </div>

        <div className="today-col">
          <div className="today-col-head">
            <Icon name="shield" size={14} style={{color:"var(--warning)"}} />
            <span>Needs attention</span>
            <span className="today-count">{risk.length}</span>
          </div>
          {risk.slice(0,3).map(o => (
            <div key={o.id} className="today-row" onClick={()=>navigate({screen:"opp", id:o.id})}>
              <CompanyMark customer={o.customer} size={28} />
              <div className="tr-meta">
                <div className="tr-name">{o.customer}</div>
                <div className="tr-sub">Health {o.health}/100 · {stageName(o.stage)}</div>
              </div>
              <div className="tr-health" style={{color:"var(--danger)"}}>↓</div>
            </div>
          ))}
          {!risk.length && <div className="today-empty">All open bids are healthy.</div>}
        </div>
      </div>
    </section>
  );
};

/* ========== MEDDPICC scorecard ========== */
const MEDDPICC_DEFS = [
  { k: "Metrics",            desc: "Quantified business value & KPIs" },
  { k: "Economic buyer",     desc: "Identified & engaged decision authority" },
  { k: "Decision criteria",  desc: "Formal selection criteria documented" },
  { k: "Decision process",   desc: "Procurement steps & timeline mapped" },
  { k: "Paper process",      desc: "Legal, security, vendor onboarding clear" },
  { k: "Identify pain",      desc: "Compelling event & cost of inaction" },
  { k: "Champion",           desc: "Internal advocate selling on our behalf" },
  { k: "Competition",        desc: "Competitive landscape understood" },
];

const MeddpiccScorecard = ({ opp }) => {
  // Deterministic seeded scores per opp (stable between renders)
  const scores = React.useMemo(() => {
    const seed = opp.id.charCodeAt(opp.id.length - 1);
    return MEDDPICC_DEFS.map((d, i) => {
      const v = ((seed * (i + 7)) % 5) + 1; // 1..5
      // bend toward opp.health
      const h = opp.health / 100;
      return { ...d, score: Math.max(1, Math.min(5, Math.round(v * 0.4 + h * 5 * 0.6))) };
    });
  }, [opp.id, opp.health]);

  const total = scores.reduce((s, x) => s + x.score, 0);
  const max = scores.length * 5;
  const pct = Math.round((total / max) * 100);
  const tier = pct >= 70 ? { label: "Strong", tone: "success" } : pct >= 50 ? { label: "Forming", tone: "info" } : { label: "Weak", tone: "danger" };

  const cellColor = (n) => n >= 4 ? "var(--success)" : n >= 3 ? "var(--info)" : n >= 2 ? "var(--warning)" : "var(--danger)";

  return (
    <Card title="MEDDPICC qualification" action={
      <div style={{display:"flex", alignItems:"center", gap:8}}>
        <span className="t-xs text-tertiary">Updated 2d ago</span>
        <button className="btn btn-secondary btn-sm"><Icon name="edit" size={12}/>Score</button>
      </div>
    }>
      <div className="meddpicc">
        <div className="md-head">
          <div className="md-score">
            <div className="md-score-num">{total}<span className="md-score-max">/{max}</span></div>
            <StatusPill tone={tier.tone} label={tier.label} />
          </div>
          <div className="md-bar">
            <div className="md-bar-fill" style={{width: pct + "%", background: cellColor(Math.round(total/scores.length))}}></div>
          </div>
          <div className="md-pct">{pct}%</div>
        </div>
        <div className="md-grid">
          {scores.map(s => (
            <div key={s.k} className="md-row" title={s.desc}>
              <div className="md-row-key">{s.k}</div>
              <div className="md-cells">
                {[1,2,3,4,5].map(n => (
                  <span
                    key={n}
                    className={"md-cell" + (n <= s.score ? " filled" : "")}
                    style={{background: n <= s.score ? cellColor(s.score) : undefined}}
                  />
                ))}
              </div>
              <div className="md-row-num">{s.score}/5</div>
            </div>
          ))}
        </div>
        <div className="md-ai">
          <Icon name="sparkle" size={13} style={{color:"var(--brand-primary)"}} />
          <span>Weakest area: <b>{scores.slice().sort((a,b)=>a.score-b.score)[0].k}</b> — Dust suggests scheduling a procurement workshop with the customer this week.</span>
        </div>
      </div>
    </Card>
  );
};

/* ========== Documents hub ========== */
const DOCS_FOR = (oppId) => {
  // generate a stable doc list per opp
  const seed = oppId.charCodeAt(oppId.length - 1);
  const base = [
    { kind:"RFP",      name:"RFP — Master statement of work",      ext:"pdf",   size:"2.4 MB",  v:"v1.0", days: 64, pages: 42 },
    { kind:"Proposal", name:"Technical proposal",                  ext:"pdf",   size:"5.1 MB",  v:"v2.3", days: 12, pages: 86 },
    { kind:"Pricing",  name:"Commercial annex — 5-year TCO",       ext:"xlsx",  size:"320 KB",  v:"v1.4", days: 6,  pages: null },
    { kind:"SoW",      name:"Statement of Work — Phase 1",         ext:"docx",  size:"180 KB",  v:"v0.9", days: 3,  pages: 24 },
    { kind:"NDA",      name:"Mutual NDA — countersigned",          ext:"pdf",   size:"110 KB",  v:"signed", days: 92, pages: 4 },
    { kind:"Diagram",  name:"Target architecture diagram",         ext:"pdf",   size:"1.8 MB",  v:"v1.2", days: 9,  pages: 12 },
  ];
  return base.map((d, i) => ({ ...d, id: oppId + "-doc-" + i, owner: ["JS","MT","SB","DL"][i % 4] }));
};

const DocumentsHub = ({ opp }) => {
  const docs = React.useMemo(() => DOCS_FOR(opp.id), [opp.id]);
  const [active, setActive] = React.useState(docs[0].id);
  const doc = docs.find(d => d.id === active) || docs[0];

  const kindColor = (k) => ({
    RFP:"#2C4BFF", Proposal:"#1F8A5B", Pricing:"#B25400",
    SoW:"#6E59FF", NDA:"#8A93A6", Diagram:"#137B6E",
  }[k] || "var(--fg-tertiary)");

  return (
    <Card title="Documents" action={
      <div style={{display:"flex", gap:6}}>
        <button className="btn btn-secondary btn-sm"><Icon name="sparkle" size={12}/>Summarize</button>
        <button className="btn btn-primary btn-sm"><Icon name="upload" size={12}/>Upload</button>
      </div>
    } noPad>
      <div className="docs-hub">
        <div className="docs-list">
          {docs.map(d => (
            <div key={d.id} className={"docs-item" + (d.id===active?" active":"")} onClick={()=>setActive(d.id)}>
              <div className="docs-icon" style={{background: kindColor(d.kind) + "22", color: kindColor(d.kind)}}>
                <Icon name="files" size={14} />
              </div>
              <div style={{minWidth:0, flex:1}}>
                <div className="docs-name">{d.name}</div>
                <div className="docs-meta">
                  <span className="docs-tag" style={{background: kindColor(d.kind) + "22", color: kindColor(d.kind)}}>{d.kind}</span>
                  <span>{d.v}</span><span className="bullet"/><span>{d.size}</span>
                </div>
              </div>
              <div className="docs-when">{d.days===0?"today":d.days+"d ago"}</div>
            </div>
          ))}
        </div>
        <div className="docs-preview">
          <div className="docs-preview-head">
            <div>
              <div className="docs-preview-name">{doc.name}</div>
              <div className="t-xs text-tertiary">{doc.kind} · {doc.v} · {doc.size}{doc.pages?` · ${doc.pages} pages`:""} · uploaded {doc.days}d ago by <Avatar initials={doc.owner} size={16} style={{display:"inline-flex", verticalAlign:"middle"}}/></div>
            </div>
            <div style={{display:"flex", gap:4}}>
              <button className="iconbtn" title="Open"><Icon name="external" size={15}/></button>
              <button className="iconbtn" title="Download"><Icon name="download" size={15}/></button>
              <button className="iconbtn" title="More"><Icon name="more" size={15}/></button>
            </div>
          </div>
          <div className="docs-summary">
            <div className="ds-head"><Icon name="sparkle" size={13} style={{color:"var(--brand-primary)"}}/>AI summary</div>
            <p>{
              doc.kind === "RFP" ? `Issued ${doc.days} days ago by ${opp.customer}. Scope covers ${opp.tags?.join(", ")||"managed services"} across the customer estate. Primary evaluation criteria: technical fit (40%), pricing (30%), references (20%), security posture (10%).`
              : doc.kind === "Proposal" ? `Mantu's response addresses 100% of mandatory requirements and 14 of 16 optional asks. Differentiators: 24/7 SOC, pre-built migration runbooks, and fixed-fee phase 1.`
              : doc.kind === "SoW" ? `Phase 1 covers discovery + assessment over 8 weeks with a target go-live for the new tenant. Two named architects assigned with ${opp.team?.length||4} delivery resources ramping in week 3.`
              : doc.kind === "Pricing" ? `Five-year TCO of ${window.formatMoney(opp.value, opp.currency)} with optional run-rate of ~22% per year. Includes 10% volume discount on endpoint licenses if signed before close date.`
              : doc.kind === "NDA" ? `Mutual NDA executed ${doc.days} days ago. 3-year confidentiality term with a carve-out for residual knowledge.`
              : `Architecture diagram showing target hub-and-spoke landing zone in Azure with regional DR and SD-WAN backhaul to ${opp.location||"primary site"}.`
            }</p>
          </div>
          <div className="docs-versions">
            <div className="t-eyebrow" style={{marginBottom:8}}>Version history</div>
            <ul className="docs-vlist">
              <li><span className="dv-tag">{doc.v}</span><span className="dv-name">Current — minor pricing adjustments</span><span className="dv-when">{doc.days}d ago</span></li>
              <li><span className="dv-tag">v{(parseFloat(doc.v.replace("v",""))-0.1).toFixed(1)}</span><span className="dv-name">Customer feedback round 2</span><span className="dv-when">{doc.days+5}d ago</span></li>
              <li><span className="dv-tag">v1.0</span><span className="dv-name">Initial draft</span><span className="dv-when">{doc.days+14}d ago</span></li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
};

/* ========== Comms timeline ========== */
const COMMS_FOR = (opp) => {
  const items = [
    { kind:"meeting", who: opp.owner, with: opp.customer + " — CIO + CTO", title:"Architecture deep-dive", when:"Tomorrow · 10:00", duration:"60 min", status:"upcoming" },
    { kind:"email",   who:"You",     with: opp.customer + " buying committee", title: opp.nextStep || "Submit revised pricing & SoW v2", when:"2d ago", direction:"sent" },
    { kind:"email",   who:"Procurement", with: opp.owner, title:"Re: Clarifications on Section 4 — security controls", when:"3d ago", direction:"received" },
    { kind:"call",    who: opp.owner, with: opp.customer + " sponsor", title:"Pricing alignment call", when:"4d ago", duration:"35 min" },
    { kind:"meeting", who: opp.owner, with: opp.customer + " technical eval", title:"Demo: Zero Trust rollout plan", when:"1w ago", duration:"45 min" },
    { kind:"email",   who: opp.owner, with: opp.customer, title:"Intro of solution architect & delivery lead", when:"2w ago", direction:"sent" },
  ];
  return items;
};

const CommsTimeline = ({ opp }) => {
  const items = COMMS_FOR(opp);
  const iconFor = (k) => k==="meeting" ? "calendar" : k==="call" ? "phone" : "mail";
  const colorFor = (k) => k==="meeting" ? "var(--brand-primary)" : k==="call" ? "var(--success)" : "var(--info)";
  return (
    <Card title="Communication timeline" action={
      <div style={{display:"flex", gap:6}}>
        <button className="btn btn-secondary btn-sm"><Icon name="calendar" size={12}/>Schedule</button>
        <button className="btn btn-primary btn-sm"><Icon name="mail" size={12}/>Compose</button>
      </div>
    }>
      <ul className="comms">
        {items.map((c, i) => (
          <li key={i} className={c.status === "upcoming" ? "upcoming" : ""}>
            <span className="c-dot" style={{background: colorFor(c.kind) + "22", color: colorFor(c.kind)}}>
              <Icon name={iconFor(c.kind)} size={14} />
            </span>
            <div className="c-body">
              <div className="c-title">
                {c.title}
                {c.status === "upcoming" && <span className="pill" style={{marginLeft:8, background:"var(--brand-primary-tint)", color:"var(--brand-primary)"}}>Upcoming</span>}
                {c.direction === "sent" && <span className="t-xs text-tertiary" style={{marginLeft:8}}>↗ sent</span>}
                {c.direction === "received" && <span className="t-xs text-tertiary" style={{marginLeft:8}}>↙ received</span>}
              </div>
              <div className="c-meta">
                {c.who} · {c.with}{c.duration ? " · " + c.duration : ""}
              </div>
            </div>
            <div className="c-when">{c.when}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
};

Object.assign(window, { TodayPanel, MeddpiccScorecard, DocumentsHub, CommsTimeline });
