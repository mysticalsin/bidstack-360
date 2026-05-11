/* Integrations Pro — Part 2
   The new SettingsIntegrations screen (overrides the export in screens-settings).
   Tabs: Apps · MCP server · REST API · Webhooks · Event stream
*/

const APPS = [
  { slug:"claude",     cat:"AI · MCP",       status:"connected", scope:"opps:rw · contacts:rw",  users:"3 seats",     last:"streaming",      desc:"Claude Desktop MCP client" },
  { slug:"cursor",     cat:"AI · MCP",       status:"connected", scope:"opps:rw · documents:r",  users:"7 seats",     last:"2 min ago",      desc:"Cursor IDE MCP client" },
  { slug:"zed",        cat:"AI · MCP",       status:"connected", scope:"opps:r",                  users:"1 seat",      last:"14 min ago",     desc:"Zed editor MCP client" },
  { slug:"continue",   cat:"AI · MCP",       status:"available", scope:"—",                       users:"—",           last:"—",              desc:"Continue.dev MCP client" },
  { slug:"anthropic",  cat:"AI · API",       status:"connected", scope:"messages.create",         users:"system",      last:"42s ago",        desc:"Claude API · drafting & summarization" },
  { slug:"dust",       cat:"AI · Agents",    status:"connected", scope:"agents.rw · kb.rw · webhooks.rw", users:"3 agents · 1 workspace", last:"streaming", desc:"Dust workspace · agents, KB sync, two-way webhooks" },
  { slug:"salesforce", cat:"CRM",            status:"connected", scope:"accounts.rw · oppts.rw",  users:"5 mapped",    last:"3 min ago",      desc:"Two-way account & opportunity sync" },
  { slug:"hubspot",    cat:"CRM",            status:"available", scope:"—",                       users:"—",           last:"—",              desc:"Marketing & deal sync" },
  { slug:"servicenow", cat:"ITSM",           status:"connected", scope:"incidents.r · cmdb.r",    users:"system",      last:"1 hr ago",       desc:"Pull customer ITSM context into bids" },
  { slug:"slack",      cat:"Messaging",      status:"connected", scope:"channels.write · users.r",users:"#bid-room",   last:"8 min ago",      desc:"Bid-room alerts & approvals" },
  { slug:"teams",      cat:"Messaging",      status:"available", scope:"—",                       users:"—",           last:"—",              desc:"Channel posts & adaptive cards" },
  { slug:"gmail",      cat:"Mail",           status:"connected", scope:"mail.r · contacts.r",     users:"6 mailboxes", last:"30s ago",        desc:"Auto-log emails to bids" },
  { slug:"outlook",    cat:"Mail",           status:"connected", scope:"mail.r · calendar.r",     users:"4 mailboxes", last:"4 min ago",      desc:"Auto-log emails & meetings" },
  { slug:"docusign",   cat:"Contracts",      status:"connected", scope:"envelopes.rw",            users:"system",      last:"yesterday",      desc:"Send SoW for signature" },
  { slug:"github",     cat:"Docs",           status:"connected", scope:"repos.r · files.r",       users:"1 org",       last:"6 hr ago",       desc:"Pull architecture diagrams into proposals" },
  { slug:"notion",     cat:"Docs",           status:"available", scope:"—",                       users:"—",           last:"—",              desc:"Sync bid wiki & playbooks" },
  { slug:"linear",     cat:"Project",        status:"available", scope:"—",                       users:"—",           last:"—",              desc:"Track post-sale delivery" },
  { slug:"stripe",     cat:"Billing",        status:"available", scope:"—",                       users:"—",           last:"—",              desc:"Convert won bids to invoices" },
  { slug:"zapier",     cat:"Automation",     status:"available", scope:"—",                       users:"—",           last:"—",              desc:"5000+ apps via Zapier zaps" },
  { slug:"zoom",       cat:"Meetings",       status:"available", scope:"—",                       users:"—",           last:"—",              desc:"Recordings & transcripts" },
];

const AppsTab = () => {
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const cats = ["all", ...Array.from(new Set(APPS.map(a => a.cat)))];
  const filtered = APPS.filter(a =>
    (filter === "all" || a.cat === filter) &&
    a.slug !== "dust" &&  // dust shown as featured spotlight above
    (!q || a.slug.includes(q.toLowerCase()) || window.BRANDS[a.slug]?.name.toLowerCase().includes(q.toLowerCase()))
  );
  return (
    <div className="flex-col gap-4">
      <DustSpotlight />

      <div className="apps-toolbar">
        <div className="apps-search">
          <Icon name="search" size={14}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search 80+ integrations…" />
        </div>
        <div className="apps-cats">
          {cats.map(c => (
            <button key={c} className={"apps-cat" + (filter===c?" on":"")} onClick={()=>setFilter(c)}>{c==="all"?"All":c}</button>
          ))}
        </div>
      </div>

      <div className="apps-grid">
        {filtered.map(a => {
          const b = window.BRANDS[a.slug];
          return (
            <div key={a.slug} className={"app-card" + (a.status==="connected"?" on":"")}>
              <div className="app-card-head">
                <img src={b.asset} alt="" className="app-logo" />
                <div className="app-meta">
                  <div className="app-name">{b.name}</div>
                  <div className="app-cat">{a.cat}</div>
                </div>
                {a.status === "connected" && (
                  <span className="app-status">
                    <span className="app-led"></span>Connected
                  </span>
                )}
              </div>
              <div className="app-desc">{a.desc}</div>
              <div className="app-foot">
                <div className="app-foot-row">
                  <span className="app-foot-label">Scopes</span>
                  <span className="app-foot-val t-mono">{a.scope}</span>
                </div>
                <div className="app-foot-row">
                  <span className="app-foot-label">{a.status==="connected"?"Last sync":"Status"}</span>
                  <span className="app-foot-val">
                    {a.status==="connected" ? a.last : <span style={{color:"var(--fg-tertiary)"}}>Available</span>}
                  </span>
                </div>
              </div>
              <div className="app-actions">
                {a.status==="connected"
                  ? <><button className="btn btn-secondary btn-sm">Configure</button><button className="btn btn-secondary btn-sm danger">Disconnect</button></>
                  : <button className="btn btn-primary btn-sm" style={{width:"100%"}}>Connect →</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

window.AppsTab = AppsTab;
window.APPS = APPS;

/* ───────── Dust.tt featured spotlight ───────── */

const DUST_AGENTS = [
  { name:"@bid-summarizer",   role:"Drafts one-pager exec summaries from RFP packets",  runs:"184/wk",  model:"claude-sonnet-4.5", status:"on" },
  { name:"@risk-radar",       role:"Flags pricing/scope/competitor risks across open bids", runs:"42/wk",  model:"claude-sonnet-4.5", status:"on" },
  { name:"@sow-writer",       role:"Drafts SoW sections from prior won bids",          runs:"67/wk",  model:"claude-opus-4",   status:"on" },
  { name:"@email-followup",   role:"Suggests follow-up emails per stakeholder",        runs:"312/wk", model:"claude-haiku-4.5",status:"on" },
  { name:"@compliance-sweep", role:"Audits proposals for SOC2/ISO/PCI gaps",           runs:"18/wk",  model:"claude-sonnet-4.5", status:"off" },
];

const DustSpotlight = () => {
  const [tab, setTab] = React.useState("agents");
  return (
    <div className="dust-spotlight">
      <div className="dust-spot-glow" />
      <div className="dust-spot-head">
        <img src="assets/integrations/dust.svg" alt="" className="dust-spot-logo" />
        <div style={{flex:1, minWidth:0}}>
          <div className="dust-spot-eyebrow">FEATURED · AI AGENTS PARTNER</div>
          <div className="dust-spot-title">Dust.tt workspace · <span className="dust-spot-ws">mantu-presales</span></div>
          <div className="dust-spot-sub">
            <span className="mcp-led" /> Live · 4 of 5 agents running · last event 8 seconds ago · connected by Mark Thompson on Jan 12, 2026
          </div>
        </div>
        <div style={{display:"flex", gap:8}}>
          <button className="btn btn-secondary btn-sm"><Icon name="refresh" size={12}/>Sync now</button>
          <button className="btn btn-secondary btn-sm"><Icon name="external" size={12}/>Open in Dust</button>
        </div>
      </div>

      <div className="dust-spot-kpis">
        <div><div className="dsk-v">623</div><div className="dsk-l">Agent runs · 7d</div></div>
        <div><div className="dsk-v">14,208</div><div className="dsk-l">KB documents indexed</div></div>
        <div><div className="dsk-v">2.4s</div><div className="dsk-l">Avg agent latency</div></div>
        <div><div className="dsk-v">99.4%</div><div className="dsk-l">Webhook delivery</div></div>
      </div>

      <div className="dust-spot-tabs">
        {[
          { id:"agents",   label:"Agents",         icon:"sparkle" },
          { id:"kb",       label:"Knowledge base", icon:"files" },
          { id:"hooks",    label:"Webhooks",       icon:"link" },
          { id:"oauth",    label:"OAuth",          icon:"key" },
        ].map(t => (
          <button key={t.id} className={"dust-spot-tab" + (tab===t.id?" on":"")} onClick={()=>setTab(t.id)}>
            <Icon name={t.icon} size={12}/>{t.label}
          </button>
        ))}
      </div>

      {tab==="agents" && (
        <div className="dust-agents">
          {DUST_AGENTS.map(a => (
            <div key={a.name} className={"dust-agent" + (a.status==="on"?" on":"")}>
              <div className="da-head">
                <span className="da-dot" />
                <span className="da-name t-mono">{a.name}</span>
                <span className="da-model t-mono">{a.model}</span>
              </div>
              <div className="da-role">{a.role}</div>
              <div className="da-foot">
                <span className="da-runs">{a.runs}</span>
                <span className={"da-status " + a.status}>{a.status==="on"?"Running":"Paused"}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==="kb" && (
        <div className="dust-kb">
          {[
            { src:"BidStack · Opportunities",    docs:8412, last:"30s ago",  status:"ok" },
            { src:"BidStack · Contacts",         docs:2104, last:"2 min ago", status:"ok" },
            { src:"BidStack · Activity & emails",docs:3210, last:"streaming", status:"ok" },
            { src:"Notion · Bid playbook",       docs:286,  last:"6h ago",    status:"ok" },
            { src:"GitHub · Architecture diagrams", docs:184, last:"1d ago",  status:"ok" },
            { src:"Won bids archive (S3)",       docs:12,   last:"yesterday", status:"warn", note:"3 PDFs unreadable" },
          ].map(s => (
            <div key={s.src} className="dust-kb-row">
              <Icon name="files" size={14} style={{color:"var(--brand-primary)"}}/>
              <div style={{flex:1, minWidth:0}}>
                <div className="dkb-src">{s.src}</div>
                <div className="dkb-meta">{s.docs.toLocaleString()} docs · synced {s.last}{s.note?` · ${s.note}`:""}</div>
              </div>
              <StatusPill tone={s.status==="ok"?"success":"warn"} label={s.status==="ok"?"Synced":"Warning"}/>
            </div>
          ))}
        </div>
      )}

      {tab==="hooks" && (
        <div className="dust-hooks">
          <div className="dust-hook-row">
            <span className="dh-dir t-mono out">→ OUT</span>
            <code className="t-mono">https://dust.tt/w/mantu-presales/webhooks/bidstack</code>
            <span className="dh-events">opportunity.* · contact.* · activity.*</span>
            <StatusPill tone="success" label="412/hr"/>
          </div>
          <div className="dust-hook-row">
            <span className="dh-dir t-mono in">← IN</span>
            <code className="t-mono">https://api.bidstack360.mantu.com/v1/webhooks/dust</code>
            <span className="dh-events">agent.completion · agent.action · workspace.event</span>
            <StatusPill tone="success" label="184/hr"/>
          </div>
          <pre className="codeblock" style={{marginTop:10}}>{`POST https://api.bidstack360.mantu.com/v1/webhooks/dust
X-Dust-Signature: t=1747844282,v1=8c2f4e7a9b1d6f3e…
Content-Type: application/json

{
  "type": "agent.completion",
  "workspace": "mantu-presales",
  "agent": "@bid-summarizer",
  "conversation_id": "conv_3K9mP",
  "ran_actions": [
    { "tool": "opportunities.get",    "args": { "id": "OP-2041" } },
    { "tool": "opportunities.note",   "args": { "id": "OP-2041", "note": "…" } }
  ],
  "tokens_used": 1843,
  "latency_ms": 2412
}`}</pre>
        </div>
      )}

      {tab==="oauth" && (
        <div className="dust-oauth">
          <div className="dust-oa-row">
            <span className="doa-l">Workspace ID</span>
            <code className="t-mono doa-v">ws_4Pq9vL2nE8KrM</code>
            <span className="doa-status"><span className="mcp-led"/>active</span>
          </div>
          <div className="dust-oa-row">
            <span className="doa-l">Client ID</span>
            <code className="t-mono doa-v">dust_client_8c2f4e7a9b1d</code>
            <button className="btn btn-secondary btn-sm"><Icon name="copy" size={11}/>Copy</button>
          </div>
          <div className="dust-oa-row">
            <span className="doa-l">Granted scopes</span>
            <div className="doa-scopes">
              {["agents:read","agents:run","kb:read","kb:write","webhooks:write","oppts:read","oppts:write","contacts:read","contacts:write"].map(s =>
                <code key={s} className="t-mono doa-scope">{s}</code>
              )}
            </div>
          </div>
          <div className="dust-oa-row">
            <span className="doa-l">Token rotates</span>
            <span className="doa-v">every 30d · next on Jun 11, 2026</span>
            <button className="btn btn-secondary btn-sm"><Icon name="refresh" size={11}/>Rotate now</button>
          </div>
        </div>
      )}
    </div>
  );
};

window.DustSpotlight = DustSpotlight;
