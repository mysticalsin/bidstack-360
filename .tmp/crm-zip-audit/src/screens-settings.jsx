/* Settings → Integrations (Dust) + Settings → Team */

const SettingsTeam = () => {
  const [users, setUsers] = React.useState(window.TEAM);
  const [showInvite, setShowInvite] = React.useState(false);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Team &amp; permissions</h1>
          <div className="page-sub">{users.length} members across {[...new Set(users.map(u=>u.role))].length} roles · {users.filter(u=>u.lastSeen==="online").length} online</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="download" size={14} />Audit log</button>
          <button className="btn btn-primary" onClick={()=>setShowInvite(true)}><Icon name="plus" size={14} />Invite member</button>
        </div>
      </div>

      <Card title="Roles">
        <div className="role-grid">
          {[
            { name:"Admin",         desc:"Full access incl. billing, integrations, team",  count: users.filter(u=>u.role==="Admin").length, perms:["Manage team","Manage Dust","Edit any bid","View financials"] },
            { name:"Bid manager",   desc:"Create &amp; edit any opportunity, see pipeline", count: users.filter(u=>u.role==="Bid manager").length, perms:["Create / edit bids","View team pipeline","Trigger Dust runs","Export reports"] },
            { name:"Solution architect", desc:"Read all bids, edit assigned technical scope", count: users.filter(u=>u.role==="Solution architect").length, perms:["Edit assigned scope","Read all bids","Comment everywhere"] },
            { name:"Read-only",     desc:"View dashboards &amp; reports, no edits",         count: users.filter(u=>u.role==="Read-only").length, perms:["View dashboards","Export own reports"] },
          ].map(r => (
            <div key={r.name} className="role-card">
              <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6}}>
                <div style={{fontWeight:600, fontSize:14}}>{r.name}</div>
                <span className="t-eyebrow">{r.count} members</span>
              </div>
              <div className="t-xs text-secondary" style={{marginBottom:12}} dangerouslySetInnerHTML={{__html: r.desc}} />
              <ul style={{margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:5}}>
                {r.perms.map(p => (
                  <li key={p} style={{display:"flex", gap:6, alignItems:"center", fontSize:12, color:"var(--fg-secondary)"}}>
                    <Icon name="check" size={12} style={{color:"var(--success)"}} sw={2.5} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Members" noPad>
        <table className="dt">
          <thead><tr>
            <th>Name</th><th>Role</th><th>Status</th><th>Open bids</th><th>Last active</th><th></th>
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{display:"flex", alignItems:"center", gap:10}}>
                    <Avatar initials={u.initials} size={32} />
                    <div>
                      <div style={{fontWeight:600, fontSize:13}}>{u.name}</div>
                      <div className="t-xs text-tertiary">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="t-xs">{u.role}</td>
                <td>
                  <StatusPill tone={u.lastSeen==="online"?"success":"neutral"} label={u.lastSeen==="online"?"Online":"Away"} />
                </td>
                <td className="num">{u.oppCount}</td>
                <td className="t-xs text-secondary">{u.lastSeen==="online"?"Now":u.lastSeen}</td>
                <td><button className="iconbtn"><Icon name="more" size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showInvite && (
        <Modal onClose={()=>setShowInvite(false)} title="Invite team member">
          <div className="form-group">
            <label>Email address</label>
            <input type="email" placeholder="name@mantu.com" />
          </div>
          <div className="form-group">
            <label>Role</label>
            <select defaultValue="Bid manager">
              <option>Admin</option>
              <option>Bid manager</option>
              <option>Solution architect</option>
              <option>Read-only</option>
            </select>
          </div>
          <div className="form-group">
            <label>Send a welcome message (optional)</label>
            <textarea rows="3" placeholder="Welcome to BidStack 360°! Here's how to get started…" />
          </div>
          <div style={{display:"flex", gap:8, justifyContent:"flex-end"}}>
            <button className="btn btn-secondary" onClick={()=>setShowInvite(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={()=>setShowInvite(false)}>Send invite</button>
          </div>
        </Modal>
      )}
    </>
  );
};

/* ───────── Settings → Integrations (Dust) ───────── */
const SettingsIntegrations = () => {
  const [tab, setTab] = React.useState("sync");
  const tabs = [
    { id:"sync",     label:"Sync status",   icon:"refresh" },
    { id:"mcp",      label:"MCP server",    icon:"sparkle" },
    { id:"api",      label:"REST API",      icon:"key" },
    { id:"webhooks", label:"Webhooks",      icon:"link" },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Integrations</h1>
          <div className="page-sub">Connect BidStack 360° to Dust agents, MCP clients, and external systems.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="help" size={14} />Docs</button>
        </div>
      </div>

      <Card noPad>
        <div className="connection-strip">
          <div className="cs-logos">
            <div className="cs-logo bidstack">B</div>
            <div className="cs-link">
              <div className="cs-pulse"></div>
              <Icon name="link" size={14} style={{color:"var(--brand-primary)"}}/>
              <div className="cs-pulse"></div>
            </div>
            <div className="cs-logo dust">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15.5L5 12l1.5-1.5L10 14l7.5-7.5L19 8l-9 9.5z"/></svg>
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={{display:"flex", alignItems:"center", gap:8}}>
              <div style={{fontSize:15, fontWeight:600}}>Dust workspace · Mantu Group</div>
              <StatusPill tone="success" label="Connected" />
            </div>
            <div className="t-xs text-secondary" style={{marginTop:4}}>Workspace ID <code className="t-mono">ws_4Pq9vL2nE</code> · Connected by Mark Thompson on Jan 12, 2026 · 3 agents active</div>
          </div>
          <div style={{display:"flex", gap:8}}>
            <button className="btn btn-secondary"><Icon name="refresh" size={13} />Sync now</button>
            <button className="btn btn-secondary danger"><Icon name="close" size={13} />Disconnect</button>
          </div>
        </div>

        <div className="tabbar">
          {tabs.map(t => (
            <div key={t.id} className={"tab" + (tab===t.id?" active":"")} onClick={()=>setTab(t.id)}>
              <Icon name={t.icon} size={14} />
              {t.label}
            </div>
          ))}
        </div>

        <div className="tab-body">
          {tab==="sync" && <SyncStatus />}
          {tab==="mcp" && <McpConfig />}
          {tab==="api" && <ApiPanel />}
          {tab==="webhooks" && <WebhooksPanel />}
        </div>
      </Card>
    </>
  );
};

const SyncStatus = () => {
  const events = [
    { t:"now",          dir:"in",  obj:"Opportunity",  n:1, status:"ok",   note:"BID-2026-0114 · Mercier Industries · stage updated" },
    { t:"3m ago",       dir:"out", obj:"Contact",      n:4, status:"ok",   note:"Synced 4 contacts to Dust knowledge base" },
    { t:"12m ago",      dir:"in",  obj:"Activity",     n:18, status:"ok",  note:"Imported emails &amp; meeting notes from Dust agent" },
    { t:"1h ago",       dir:"out", obj:"Bid summary",  n:2, status:"ok",   note:"Pushed bid summaries for weekly digest" },
    { t:"3h ago",       dir:"in",  obj:"Opportunity",  n:1, status:"warn", note:"BID-2026-0098 · validation warning · missing closeDate" },
    { t:"yesterday",    dir:"out", obj:"Webhook",      n:42, status:"ok",  note:"42 events delivered to https://hooks.mantu.com/dust" },
    { t:"2 days ago",   dir:"in",  obj:"Contact",      n:6, status:"err",  note:"Auth refresh failed · re-authenticated automatically" },
  ];
  return (
    <div className="flex-col gap-4">
      <div className="kpi-grid cols-4">
        <KpiTile icon="refresh" tone="jade"   label="Last successful sync"   value="2 minutes ago" sub="incremental · 1 obj" />
        <KpiTile icon="clock"   tone="blue"   label="Next sync"              value="in 12 minutes" sub="every 15 min" />
        <KpiTile icon="growth"  tone="purple" label="Synced last 24h"        value="284 objects"   sub="↗ 18% vs yesterday" />
        <KpiTile icon="warning" tone="amber"  label="Errors (7d)"            value="2"             sub="1 auth · 1 validation" />
      </div>
      <div className="card" style={{padding:0}}>
        <div className="card-head"><h3 className="card-title">Sync timeline</h3>
          <div style={{display:"flex", gap:8}}>
            <button className="btn btn-secondary btn-sm"><Icon name="filter" size={12} />Filter</button>
            <button className="btn btn-secondary btn-sm"><Icon name="download" size={12} />Export</button>
          </div>
        </div>
        <ul className="sync-timeline">
          {events.map((e, i) => (
            <li key={i} className={"sync-event " + e.status}>
              <span className={"se-dot " + e.status}></span>
              <span className="se-time">{e.t}</span>
              <span className={"se-dir " + e.dir}>{e.dir==="in"?"↓ in":"↑ out"}</span>
              <span className="se-obj">{e.n}× {e.obj}</span>
              <span className="se-note">{e.note}</span>
              <StatusPill tone={e.status==="ok"?"success":e.status==="warn"?"warn":"danger"} label={e.status==="ok"?"OK":e.status==="warn"?"Warn":"Error"} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const McpConfig = () => {
  const [showToken, setShowToken] = React.useState(false);
  const tools = [
    { name:"list_opportunities",     desc:"Return open bids matching filters",                ro:true },
    { name:"get_opportunity",        desc:"Fetch full opportunity by id",                     ro:true },
    { name:"create_opportunity",     desc:"Create a new bid from RFP excerpt",                ro:false },
    { name:"update_opportunity",     desc:"Patch fields including stage, value, owner",       ro:false },
    { name:"add_activity",           desc:"Append email, call, or meeting note to a bid",     ro:false },
    { name:"summarize_bid",          desc:"Generate a one-pager summary",                     ro:true },
    { name:"draft_proposal_section", desc:"Draft a proposal section using prior bids",        ro:true },
    { name:"list_contacts",          desc:"Search contacts by customer or role",              ro:true },
  ];
  return (
    <div className="flex-col gap-4">
      <Banner icon="sparkle" tone="info" title="MCP server enabled" body="Any MCP-compatible client (Claude Desktop, Cursor, custom agents) can connect to BidStack 360° using the URL and token below. Tools are exposed exactly as listed." />
      <div className="kv-stack">
        <KvField label="Server URL" mono value="https://mcp.bidstack360.mantu.com/v1/sse" copy />
        <KvField label="Workspace" mono value="mantu-group" copy />
        <KvField label="Auth token" mono value={showToken ? "mcp_live_8c2f4e7a9b1d6f3e5a8c4d2b9f7e1c6a" : "•••••••••••••••••••••••••••••••••"} copy
          actions={
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowToken(v=>!v)}>
              <Icon name={showToken?"eye-off":"eye"} size={12} />{showToken?"Hide":"Reveal"}
            </button>
          } />
        <KvField label="Allowed scopes" value="opportunities:read,opportunities:write,contacts:read,activities:write" />
      </div>

      <div className="card" style={{padding:0}}>
        <div className="card-head">
          <h3 className="card-title">Exposed tools</h3>
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            <span className="t-xs text-tertiary">{tools.length} tools</span>
            <button className="btn btn-secondary btn-sm"><Icon name="plus" size={12} />Add custom tool</button>
          </div>
        </div>
        <table className="dt mcp-tools">
          <thead><tr><th>Name</th><th>Description</th><th>Access</th><th>Enabled</th></tr></thead>
          <tbody>
            {tools.map(t => (
              <tr key={t.name}>
                <td className="t-mono" style={{fontSize:12.5, fontWeight:600}}>{t.name}</td>
                <td className="t-xs text-secondary">{t.desc}</td>
                <td><StatusPill tone={t.ro?"neutral":"brand"} label={t.ro?"Read":"Read / write"} dot={false} /></td>
                <td><Toggle defaultChecked /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card title="Example client config">
        <pre className="codeblock">{`{
  "mcpServers": {
    "bidstack360": {
      "url": "https://mcp.bidstack360.mantu.com/v1/sse",
      "headers": {
        "Authorization": "Bearer mcp_live_••••••••",
        "X-Workspace": "mantu-group"
      }
    }
  }
}`}</pre>
      </Card>
    </div>
  );
};

const ApiPanel = () => {
  const keys = [
    { name:"Production · Dust agent",   prefix:"sk_live_8c2f4e", scopes:"read,write", created:"Jan 12, 2026", lastUsed:"2 min ago" },
    { name:"Staging · CI",              prefix:"sk_live_4a9d1e", scopes:"read",        created:"Dec 04, 2025", lastUsed:"3 days ago" },
    { name:"Internal · Reporting",      prefix:"sk_live_77f3b1", scopes:"read",        created:"Nov 18, 2025", lastUsed:"yesterday" },
  ];
  const endpoints = [
    { m:"GET",    p:"/v1/opportunities",            d:"List bids with filters & pagination" },
    { m:"GET",    p:"/v1/opportunities/{id}",       d:"Full bid incl. scope, contacts, activity" },
    { m:"POST",   p:"/v1/opportunities",            d:"Create a new bid" },
    { m:"PATCH",  p:"/v1/opportunities/{id}",       d:"Update fields (stage, value, owner…)" },
    { m:"POST",   p:"/v1/opportunities/{id}/activities", d:"Append an activity entry" },
    { m:"GET",    p:"/v1/contacts",                 d:"Search & list contacts" },
    { m:"GET",    p:"/v1/reports/pipeline",         d:"Aggregated pipeline by stage / owner" },
  ];
  return (
    <div className="flex-col gap-4">
      <div className="kpi-grid cols-3">
        <KpiTile icon="key"   tone="blue"   label="Active API keys"  value="3" />
        <KpiTile icon="growth" tone="jade"  label="Calls last 24h"   value="12,847" sub="↗ 8%" />
        <KpiTile icon="clock" tone="amber"  label="P95 latency"      value="148 ms" sub="us-east-1 · ok" />
      </div>

      <div className="card" style={{padding:0}}>
        <div className="card-head">
          <h3 className="card-title">API keys</h3>
          <button className="btn btn-primary btn-sm"><Icon name="plus" size={12} />Generate key</button>
        </div>
        <table className="dt">
          <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.prefix}>
                <td style={{fontWeight:600, fontSize:13}}>{k.name}</td>
                <td className="t-mono t-xs">{k.prefix}…</td>
                <td><StatusPill tone={k.scopes.includes("write")?"brand":"neutral"} label={k.scopes} dot={false} /></td>
                <td className="t-xs text-secondary">{k.created}</td>
                <td className="t-xs text-secondary">{k.lastUsed}</td>
                <td><button className="iconbtn"><Icon name="more" size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{padding:0}}>
        <div className="card-head">
          <h3 className="card-title">Endpoint reference</h3>
          <a className="link-arrow">Full docs <Icon name="external" size={11} /></a>
        </div>
        <table className="dt">
          <thead><tr><th style={{width:80}}>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            {endpoints.map(e => (
              <tr key={e.p+e.m}>
                <td><span className={"http-method m-" + e.m.toLowerCase()}>{e.m}</span></td>
                <td className="t-mono" style={{fontSize:12.5}}>{e.p}</td>
                <td className="t-xs text-secondary">{e.d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const WebhooksPanel = () => {
  const subs = [
    { url:"https://hooks.mantu.com/dust/bidstack",  events:"opportunity.*, contact.*", status:"ok",   last:"2m ago" },
    { url:"https://api.mantu.com/v1/digest",        events:"opportunity.won, opportunity.lost", status:"ok", last:"1h ago" },
    { url:"https://staging.example.com/cb",         events:"opportunity.created", status:"warn", last:"6h ago" },
  ];
  const inbox = [
    { id:"evt_3K9mP",  t:"2 min ago",  type:"opportunity.stage_changed",  src:"BidStack → Dust",      status:"ok"  },
    { id:"evt_3K9lY",  t:"4 min ago",  type:"contact.created",            src:"Dust → BidStack",      status:"ok"  },
    { id:"evt_3K9kB",  t:"7 min ago",  type:"activity.email_received",    src:"Dust → BidStack",      status:"ok"  },
    { id:"evt_3K8zT",  t:"12 min ago", type:"opportunity.updated",        src:"BidStack → Dust",      status:"ok"  },
    { id:"evt_3K8mE",  t:"22 min ago", type:"opportunity.created",        src:"Dust → BidStack",      status:"warn", note:"Retried 1× · validation warning" },
    { id:"evt_3K8aS",  t:"34 min ago", type:"activity.meeting_note",      src:"Dust → BidStack",      status:"ok"  },
  ];
  return (
    <div className="flex-col gap-4">
      <div className="card" style={{padding:0}}>
        <div className="card-head">
          <h3 className="card-title">Outgoing webhook subscriptions</h3>
          <button className="btn btn-primary btn-sm"><Icon name="plus" size={12} />Add endpoint</button>
        </div>
        <table className="dt">
          <thead><tr><th>URL</th><th>Events</th><th>Status</th><th>Last delivery</th><th></th></tr></thead>
          <tbody>
            {subs.map(s => (
              <tr key={s.url}>
                <td className="t-mono t-xs">{s.url}</td>
                <td className="t-xs text-secondary">{s.events}</td>
                <td><StatusPill tone={s.status==="ok"?"success":"warn"} label={s.status==="ok"?"Healthy":"Retrying"} /></td>
                <td className="t-xs text-secondary">{s.last}</td>
                <td>
                  <div style={{display:"flex", gap:4, justifyContent:"flex-end"}}>
                    <button className="iconbtn" title="Replay"><Icon name="refresh" size={14} /></button>
                    <button className="iconbtn"><Icon name="more" size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{padding:0}}>
        <div className="card-head">
          <h3 className="card-title">Webhook inbox</h3>
          <span className="t-xs text-tertiary">Last 200 events</span>
        </div>
        <ul className="event-feed">
          {inbox.map(e => (
            <li key={e.id} className={"event " + e.status}>
              <span className={"ev-dot " + e.status}></span>
              <span className="ev-id t-mono">{e.id}</span>
              <span className="ev-type t-mono">{e.type}</span>
              <span className="ev-src t-xs">{e.src}</span>
              {e.note && <span className="ev-note t-xs">{e.note}</span>}
              <span className="ev-time t-xs">{e.t}</span>
              <button className="iconbtn"><Icon name="external" size={13} /></button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/* ───────── Bits used by Settings ───────── */

const KvField = ({ label, value, mono, copy, actions }) => {
  const [copied, setCopied] = React.useState(false);
  const onCopy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(value).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false), 1100);
  };
  return (
    <div className="kv-row">
      <div className="kv-label">{label}</div>
      <div className={"kv-value" + (mono?" t-mono":"")}>{value}</div>
      <div style={{display:"flex", gap:6}}>
        {actions}
        {copy && (
          <button className="btn btn-secondary btn-sm" onClick={onCopy}>
            <Icon name={copied?"check":"copy"} size={12} />{copied?"Copied":"Copy"}
          </button>
        )}
      </div>
    </div>
  );
};

const Toggle = ({ defaultChecked = false, checked, onChange }) => {
  const [internal, setInternal] = React.useState(defaultChecked);
  const isControlled = checked !== undefined;
  const v = isControlled ? checked : internal;
  return (
    <button
      className={"toggle" + (v?" on":"")}
      role="switch"
      aria-checked={v}
      onClick={() => {
        if (!isControlled) setInternal(!v);
        onChange && onChange(!v);
      }}
    >
      <span className="thumb" />
    </button>
  );
};

const Banner = ({ icon, tone="info", title, body }) => {
  const tones = {
    info:    { bg:"var(--brand-primary-tint)", fg:"var(--brand-primary)", border:"var(--brand-primary)" },
    success: { bg:"var(--success-tint)",       fg:"var(--success)",       border:"var(--success)" },
    warn:    { bg:"var(--warning-tint)",       fg:"var(--warning)",       border:"var(--warning)" },
  };
  const t = tones[tone] || tones.info;
  return (
    <div className="banner" style={{background:t.bg, borderLeft:`3px solid ${t.border}`}}>
      <div className="banner-icon" style={{color:t.fg}}><Icon name={icon} size={18}/></div>
      <div>
        <div className="banner-title" style={{color:t.fg}}>{title}</div>
        <div className="banner-body">{body}</div>
      </div>
    </div>
  );
};

const Modal = ({ title, children, onClose }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="modal-head">
        <h3>{title}</h3>
        <button className="iconbtn" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="modal-body">{children}</div>
    </div>
  </div>
);

Object.assign(window, { SettingsTeam, SettingsIntegrations, KvField, Toggle, Banner, Modal });
