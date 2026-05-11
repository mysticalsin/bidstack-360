/* Integrations Pro — REST API explorer + Webhooks stream */

const API_ENDPOINTS = [
  { m:"GET",   p:"/v1/opportunities",                       d:"List bids with filters & pagination" },
  { m:"GET",   p:"/v1/opportunities/{id}",                  d:"Full bid incl. scope, contacts, activity" },
  { m:"POST",  p:"/v1/opportunities",                       d:"Create a new bid" },
  { m:"PATCH", p:"/v1/opportunities/{id}",                  d:"Update fields (stage, value, owner…)" },
  { m:"POST",  p:"/v1/opportunities/{id}/activities",       d:"Append an activity entry" },
  { m:"GET",   p:"/v1/contacts",                            d:"Search & list contacts" },
  { m:"POST",  p:"/v1/contacts",                            d:"Upsert a contact" },
  { m:"GET",   p:"/v1/tasks",                               d:"List tasks across all bids" },
  { m:"GET",   p:"/v1/reports/pipeline",                    d:"Aggregated pipeline by stage / owner" },
  { m:"GET",   p:"/v1/reports/forecast",                    d:"Weighted forecast by quarter" },
  { m:"POST",  p:"/v1/documents/search",                    d:"RAG search across attachments" },
  { m:"GET",   p:"/v1/events",                              d:"Server-sent event stream" },
];

const API_SAMPLES = {
  curl: `curl https://api.bidstack360.mantu.com/v1/opportunities \\
  -H "Authorization: Bearer sk_live_••••" \\
  -H "X-Workspace: mantu-group" \\
  -G --data-urlencode "stage=proposal" \\
       --data-urlencode "limit=10"`,
  js: `import { BidStack } from "@bidstack/sdk";

const bs = new BidStack({ apiKey: process.env.BIDSTACK_KEY });

const { data } = await bs.opportunities.list({
  stage: "proposal",
  owner: "JS",
  limit: 10,
});

console.log(\`\${data.length} bids · \${formatMoney(data.reduce((s,o)=>s+o.value,0))} pipeline\`);`,
  py: `from bidstack import BidStack

bs = BidStack(api_key=os.environ["BIDSTACK_KEY"])

opps = bs.opportunities.list(
  stage="proposal",
  owner="JS",
  limit=10,
)

print(f"{len(opps)} bids in proposal stage")`,
  go: `package main

import "github.com/bidstack/bidstack-go"

func main() {
    bs := bidstack.NewClient(os.Getenv("BIDSTACK_KEY"))
    opps, _ := bs.Opportunities.List(&bidstack.OpportunityListParams{
        Stage: "proposal",
        Owner: "JS",
        Limit: 10,
    })
    fmt.Printf("%d bids\\n", len(opps))
}`,
};

const ApiTab = () => {
  const [tab, setTab] = React.useState("curl");
  const [keys] = React.useState([
    { name:"Production · Dust agent", prefix:"sk_live_8c2f4e", scopes:"read,write", created:"Jan 12, 2026", lastUsed:"2 min ago",  reqs:"8,412" },
    { name:"Staging · CI",            prefix:"sk_live_4a9d1e", scopes:"read",        created:"Dec 04, 2025", lastUsed:"3 days ago", reqs:"412" },
    { name:"Internal · Reporting",    prefix:"sk_live_77f3b1", scopes:"read",        created:"Nov 18, 2025", lastUsed:"yesterday",  reqs:"1,205" },
  ]);
  return (
    <div className="flex-col gap-4">
      <div className="kpi-grid cols-4">
        <KpiTile icon="key"    tone="blue"   label="Active API keys" value={keys.length} />
        <KpiTile icon="growth" tone="jade"   label="Requests / 24h"  value="12,847" sub="↗ 8% vs yesterday" />
        <KpiTile icon="clock"  tone="amber"  label="p95 latency"     value="148 ms" />
        <KpiTile icon="warning" tone="rose"  label="4xx / 5xx rate"  value="0.21%" sub="last 24h" />
      </div>

      <div className="api-explorer">
        <div className="api-explorer-l">
          <div className="t-eyebrow">REQUEST</div>
          <div className="api-req-line">
            <span className="http-method m-get">GET</span>
            <code className="t-mono">/v1/opportunities</code>
          </div>
          <div className="api-tabs">
            {Object.keys(API_SAMPLES).map(k => (
              <button key={k} className={"api-tab" + (tab===k?" on":"")} onClick={()=>setTab(k)}>{k==="js"?"node":k==="py"?"python":k==="go"?"go":"cURL"}</button>
            ))}
          </div>
          <pre className="codeblock api-code">{API_SAMPLES[tab]}</pre>
        </div>
        <div className="api-explorer-r">
          <div className="t-eyebrow">RESPONSE · <span style={{color:"var(--success)"}}>200 OK</span> · 148 ms</div>
          <pre className="codeblock api-code">{`{
  "data": [
    {
      "id": "OP-2041",
      "code": "OP-2041",
      "customer": "CI Financial",
      "name": "IT Modernization & MSP",
      "stage": "proposal",
      "value": 1240000,
      "currency": "USD",
      "probability": 65,
      "owner": "jane.smith@mantu.com",
      "deadline": "2026-05-28",
      "updated_at": "2026-05-10T14:32:08Z"
    },
    { "id": "OP-2043", "customer": "Rush University…", … },
    …
  ],
  "meta": {
    "total": 6,
    "next_cursor": null,
    "workspace": "mantu-group"
  }
}`}</pre>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <h3 className="card-title">API keys</h3>
          <button className="btn btn-primary btn-sm"><Icon name="plus" size={12}/>Generate key</button>
        </div>
        <table className="dt">
          <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th><th className="num">Requests (24h)</th><th></th></tr></thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.prefix}>
                <td style={{fontWeight:600, fontSize:13}}>{k.name}</td>
                <td className="t-mono t-xs">{k.prefix}…</td>
                <td><StatusPill tone={k.scopes.includes("write")?"brand":"neutral"} label={k.scopes} dot={false}/></td>
                <td className="t-xs text-secondary">{k.created}</td>
                <td className="t-xs text-secondary">{k.lastUsed}</td>
                <td className="num">{k.reqs}</td>
                <td><button className="iconbtn"><Icon name="more" size={15}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card flush">
        <div className="card-head">
          <h3 className="card-title">Endpoint reference</h3>
          <a className="link-arrow">Full docs <Icon name="external" size={11}/></a>
        </div>
        <table className="dt">
          <thead><tr><th style={{width:80}}>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            {API_ENDPOINTS.map(e => (
              <tr key={e.p+e.m}>
                <td><span className={"http-method m-"+e.m.toLowerCase()}>{e.m}</span></td>
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

/* ───────── Webhooks ───────── */

const WEBHOOK_TYPES = [
  "opportunity.created", "opportunity.updated", "opportunity.stage_changed", "opportunity.won", "opportunity.lost",
  "contact.created", "contact.updated", "activity.email_received", "activity.meeting_note", "task.completed",
];

const WebhooksTab = () => {
  const [events, setEvents] = React.useState(() => seedEvents(8));
  React.useEffect(() => {
    const id = setInterval(() => {
      setEvents(prev => [makeEvent(), ...prev].slice(0, 24));
    }, 2400);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex-col gap-4">
      <div className="kpi-grid cols-4">
        <KpiTile icon="link"    tone="blue"   label="Outgoing subscriptions" value="6" sub="all healthy" />
        <KpiTile icon="growth"  tone="jade"   label="Delivered (24h)"        value="3,841" sub="99.8% on first try" />
        <KpiTile icon="refresh" tone="amber"  label="Retried"                value="7" sub="2.6h avg backoff" />
        <KpiTile icon="warning" tone="rose"   label="Failed"                 value="1" sub="dead-letter queue" />
      </div>

      <div className="card flush">
        <div className="card-head">
          <h3 className="card-title">Outgoing subscriptions</h3>
          <button className="btn btn-primary btn-sm"><Icon name="plus" size={12}/>Add endpoint</button>
        </div>
        <table className="dt">
          <thead><tr><th>URL</th><th>Events</th><th>Status</th><th>Throughput</th><th>Last delivery</th><th></th></tr></thead>
          <tbody>
            {[
              { url:"https://hooks.mantu.com/dust/bidstack",   events:"opportunity.*, contact.*",            status:"ok",   tp:"412/hr", last:"2m ago" },
              { url:"https://api.mantu.com/v1/digest",         events:"opportunity.won, opportunity.lost",   status:"ok",   tp:"8/day",  last:"1h ago" },
              { url:"https://hooks.slack.com/services/T0••••", events:"opportunity.stage_changed",           status:"ok",   tp:"24/day", last:"8m ago" },
              { url:"https://hubspot.com/oauth/callback/••",   events:"contact.*",                           status:"ok",   tp:"38/day", last:"30s ago" },
              { url:"https://salesforce.com/services/apex/••", events:"opportunity.created, opportunity.won",status:"ok",   tp:"6/day",  last:"3m ago" },
              { url:"https://staging.example.com/cb",          events:"opportunity.created",                 status:"warn", tp:"—",      last:"6h ago" },
            ].map(s => (
              <tr key={s.url}>
                <td className="t-mono t-xs">{s.url}</td>
                <td className="t-xs text-secondary">{s.events}</td>
                <td><StatusPill tone={s.status==="ok"?"success":"warn"} label={s.status==="ok"?"Healthy":"Retrying"}/></td>
                <td className="t-xs text-secondary">{s.tp}</td>
                <td className="t-xs text-secondary">{s.last}</td>
                <td>
                  <div style={{display:"flex", gap:4, justifyContent:"flex-end"}}>
                    <button className="iconbtn" title="Replay last"><Icon name="refresh" size={14}/></button>
                    <button className="iconbtn"><Icon name="more" size={15}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card flush">
        <div className="card-head">
          <h3 className="card-title">Live event stream</h3>
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            <span className="topo-stat-l" style={{display:"flex", gap:6, alignItems:"center"}}><span className="mcp-led"></span>tailing</span>
            <button className="btn btn-secondary btn-sm"><Icon name="filter" size={12}/>Filter</button>
          </div>
        </div>
        <ul className="event-stream">
          {events.map((e, i) => (
            <li key={e.id} className={"event-row " + e.status} style={{animationDelay:(i*0.02)+"s"}}>
              <span className="ev-time t-mono">{e.t}</span>
              <span className="ev-arrow t-mono">{e.dir==="out"?"↑":"↓"}</span>
              <span className="ev-id t-mono">{e.id}</span>
              <span className="ev-type t-mono">{e.type}</span>
              <span className="ev-target t-xs">→ {e.target}</span>
              <span className="ev-size t-mono">{e.bytes}b</span>
              <span className={"ev-status " + e.status}>{e.status==="ok"?"200":e.status==="warn"?"retry":"503"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

function makeEvent() {
  const type = WEBHOOK_TYPES[Math.floor(Math.random()*WEBHOOK_TYPES.length)];
  const targets = ["dust.mantu.com","slack.com","hubspot.com","salesforce.com","api.mantu.com"];
  const target = targets[Math.floor(Math.random()*targets.length)];
  const id = "evt_" + Math.random().toString(36).slice(2,8);
  const status = Math.random() < 0.03 ? "warn" : "ok";
  return { id, type, target, t:new Date().toTimeString().slice(0,8), dir: Math.random()<0.6?"out":"in", bytes: 200+Math.floor(Math.random()*900), status };
}
function seedEvents(n) { return Array.from({length:n}, makeEvent); }

window.ApiTab = ApiTab;
window.WebhooksTab = WebhooksTab;

/* ───────── Replacement SettingsIntegrations ───────── */

const SettingsIntegrations = () => {
  const [tab, setTab] = React.useState("apps");
  const tabs = [
    { id:"apps",     label:"Connected apps", icon:"link",    count: window.APPS.filter(a=>a.status==="connected").length },
    { id:"mcp",      label:"MCP server",     icon:"sparkle", count: 3 },
    { id:"api",      label:"REST API",       icon:"key",     count: 3 },
    { id:"webhooks", label:"Webhooks",       icon:"refresh", count: 6 },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Integrations</h1>
          <div className="page-sub">Real-time topology · MCP, REST, webhooks · 12 apps connected · all systems nominal.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><Icon name="help" size={14}/>Docs</button>
          <button className="btn btn-primary"><Icon name="plus" size={14}/>Browse marketplace</button>
        </div>
      </div>

      <window.Topology />

      <div className="card flush" style={{marginTop:16}}>
        <div className="tabbar tabbar-pro">
          {tabs.map(tx => (
            <div key={tx.id} className={"tab" + (tab===tx.id?" active":"")} onClick={()=>setTab(tx.id)}>
              <Icon name={tx.icon} size={14}/>
              {tx.label}
              <span className="tab-badge">{tx.count}</span>
            </div>
          ))}
        </div>
        <div className="tab-body">
          {tab==="apps"     && <window.AppsTab />}
          {tab==="mcp"      && <window.McpTab />}
          {tab==="api"      && <ApiTab />}
          {tab==="webhooks" && <WebhooksTab />}
        </div>
      </div>
    </>
  );
};

window.SettingsIntegrations = SettingsIntegrations;
