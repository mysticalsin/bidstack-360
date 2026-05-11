/* Integrations Pro — MCP server playground with live tool-call stream */

const MCP_TOOLS = [
  { name:"opportunities.list",      desc:"List bids with filters (stage, owner, value range)",   access:"read",  schema:`{"stage":"proposal","owner":"JS","limit":10}` },
  { name:"opportunities.get",       desc:"Fetch full bid including scope, contacts, activity",   access:"read",  schema:`{"id":"OP-2041"}` },
  { name:"opportunities.update",    desc:"Patch stage, value, owner, probability, close date",   access:"write", schema:`{"id":"OP-2041","probability":75}` },
  { name:"opportunities.note",      desc:"Append a note or activity entry to a bid",             access:"write", schema:`{"id":"OP-2041","note":"Client confirmed BANT."}` },
  { name:"contacts.search",         desc:"Search contacts by customer, role, or email",          access:"read",  schema:`{"customer":"CI Financial"}` },
  { name:"contacts.upsert",         desc:"Create or update a contact",                           access:"write", schema:`{"email":"x@ci.com","name":"…"}` },
  { name:"tasks.create",            desc:"Create a follow-up task on a bid",                     access:"write", schema:`{"opp":"OP-2041","title":"Send SoW"}` },
  { name:"documents.search",        desc:"RAG search across SoW / RFP attachments",              access:"read",  schema:`{"query":"penalty clauses"}` },
  { name:"pipeline.forecast",       desc:"Weighted forecast aggregated by stage/quarter",        access:"read",  schema:`{"horizon":"Q3-2026"}` },
];

const MCP_CLIENTS = [
  { slug:"claude",    user:"jane.smith@mantu.com",  host:"MBP-Smith",      since:"3h 12m",  calls:184, online:true },
  { slug:"cursor",    user:"mark.t@mantu.com",      host:"WS-Thompson",    since:"42m",     calls:67,  online:true },
  { slug:"zed",       user:"david.l@mantu.com",     host:"MBA-Lee",        since:"14m",     calls:11,  online:false },
];

const SAMPLE_LOGS = [
  { t:"opportunities.list",  client:"claude",  ms:184, status:"ok",  payload:{stage:"proposal", limit:5}, ret:"5 rows" },
  { t:"opportunities.get",   client:"cursor",  ms:62,  status:"ok",  payload:{id:"OP-2041"}, ret:"OP-2041 (CI Financial)" },
  { t:"documents.search",    client:"claude",  ms:412, status:"ok",  payload:{query:"penalty clauses"}, ret:"7 chunks · 0.83 top" },
  { t:"opportunities.update",client:"cursor",  ms:91,  status:"ok",  payload:{id:"OP-2041",probability:75}, ret:"updated" },
  { t:"pipeline.forecast",   client:"claude",  ms:243, status:"ok",  payload:{horizon:"Q3-2026"}, ret:"$4.2M weighted" },
  { t:"contacts.search",     client:"zed",     ms:78,  status:"ok",  payload:{customer:"DNB Bank"}, ret:"3 rows" },
  { t:"opportunities.note",  client:"claude",  ms:55,  status:"ok",  payload:{id:"OP-2045",note:"…"}, ret:"appended" },
  { t:"documents.search",    client:"cursor",  ms:201, status:"warn",payload:{query:"sla"}, ret:"0 chunks · low confidence" },
];

const McpTab = () => {
  const [tool, setTool] = React.useState(MCP_TOOLS[0]);
  const [payload, setPayload] = React.useState(MCP_TOOLS[0].schema);
  const [logs, setLogs] = React.useState(SAMPLE_LOGS.slice(0,4));
  const [running, setRunning] = React.useState(false);
  const [response, setResponse] = React.useState(null);
  const [showToken, setShowToken] = React.useState(false);
  const logRef = React.useRef(null);

  // live ticker — push synthetic events every few seconds
  React.useEffect(() => {
    const id = setInterval(() => {
      const pick = SAMPLE_LOGS[Math.floor(Math.random()*SAMPLE_LOGS.length)];
      const now = new Date();
      const stamp = now.toTimeString().slice(0,8);
      setLogs(prev => [{ ...pick, at: stamp, id: Math.random() }, ...prev].slice(0, 14));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const run = async () => {
    setRunning(true);
    setResponse(null);
    const prompt = `You are simulating a BidStack 360° MCP server responding to a JSON-RPC tool call.
The tool invoked is "${tool.name}" — ${tool.desc}.
The client sent this payload: ${payload}

Return ONLY a compact JSON-RPC 2.0 response — no prose. Shape:
{"jsonrpc":"2.0","id":42,"result":{"data":<realistic data>,"meta":{"latency_ms":<60-300>,"workspace":"mantu-group"}}}

The "data" should be realistic Mantu CRM data — IT-services bid opportunities (RFPs, MSP, security, cloud migrations) for European/North-American enterprise customers, with fields like id, customer, stage, value, currency, owner.`;

    try {
      const r = await window.claude.complete({ messages: [{ role:"user", content: prompt }] });
      let parsed = r;
      try { parsed = JSON.stringify(JSON.parse(r.match(/\{[\s\S]*\}/)?.[0] || r), null, 2); } catch(e) {}
      setResponse(parsed);
      const stamp = new Date().toTimeString().slice(0,8);
      setLogs(prev => [{ at:stamp, t:tool.name, client:"playground", ms: 120 + Math.floor(Math.random()*180), status:"ok", payload: JSON.parse(payload || "{}"), ret:"live call", id: Math.random() }, ...prev].slice(0,14));
    } catch (e) {
      setResponse("// transport error — token refreshed automatically");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-col gap-4">
      <div className="kpi-grid cols-4">
        <KpiTile icon="sparkle"  tone="purple" label="Connected MCP clients" value={MCP_CLIENTS.filter(c=>c.online).length} sub={`${MCP_CLIENTS.length} authorized`} />
        <KpiTile icon="growth"   tone="jade"   label="Tool calls / hr"       value="1,842" sub="↗ 18% vs last hr" />
        <KpiTile icon="clock"    tone="blue"   label="p95 latency"           value="184 ms" sub="us-east-1" />
        <KpiTile icon="check"    tone="teal"   label="Success rate"          value="99.7%" sub="last 24h" />
      </div>

      <div className="mcp-server-card">
        <div className="mcp-server-row">
          <div>
            <div className="mcp-eyebrow">MCP SERVER · STREAMABLE HTTP</div>
            <div className="mcp-server-url t-mono">https://mcp.bidstack360.mantu.com/v1/sse</div>
            <div className="mcp-server-sub">Protocol <code>2024-11-05</code> · workspace <code>mantu-group</code> · <span className="mcp-led"></span> serving</div>
          </div>
          <div style={{display:"flex", gap:8}}>
            <button className="btn btn-secondary btn-sm" onClick={()=>navigator.clipboard?.writeText("https://mcp.bidstack360.mantu.com/v1/sse")}><Icon name="copy" size={12}/>Copy URL</button>
            <button className="btn btn-secondary btn-sm"><Icon name="refresh" size={12}/>Rotate token</button>
          </div>
        </div>
        <div className="mcp-token-row">
          <span className="mcp-token-label">Bearer token</span>
          <code className="mcp-token t-mono">{showToken ? "mcp_live_8c2f4e7a9b1d6f3e5a8c4d2b9f7e1c6a" : "mcp_live_••••••••••••••••••••••••••••••••"}</code>
          <button className="btn btn-secondary btn-sm" onClick={()=>setShowToken(v=>!v)}><Icon name={showToken?"eye-off":"eye"} size={12}/>{showToken?"Hide":"Reveal"}</button>
        </div>
      </div>

      <div className="mcp-split">
        <div className="card flush">
          <div className="card-head">
            <h3 className="card-title">Connected clients</h3>
            <span className="t-xs text-tertiary">SSE streams</span>
          </div>
          <ul className="mcp-client-list">
            {MCP_CLIENTS.map(c => {
              const b = window.BRANDS[c.slug];
              return (
                <li key={c.slug}>
                  <img src={b.asset} alt="" className="mcp-client-logo" />
                  <div style={{flex:1, minWidth:0}}>
                    <div className="mcp-client-name">{b.name} <span className="t-mono mcp-client-host">· {c.host}</span></div>
                    <div className="mcp-client-meta">{c.user} · session {c.since} · {c.calls} calls</div>
                  </div>
                  {c.online
                    ? <span className="mcp-client-on"><span className="mcp-led"></span>Streaming</span>
                    : <span className="mcp-client-off">Idle</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card flush">
          <div className="card-head">
            <h3 className="card-title">Tool playground</h3>
            <span className="t-xs text-tertiary">Calls real Claude via MCP simulation</span>
          </div>
          <div className="mcp-play">
            <div className="mcp-play-row">
              <label className="mcp-play-l">tool</label>
              <select value={tool.name} onChange={e=>{
                const t = MCP_TOOLS.find(x=>x.name===e.target.value);
                setTool(t); setPayload(t.schema);
              }} className="mcp-play-select">
                {MCP_TOOLS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              <span className={"mcp-access " + tool.access}>{tool.access}</span>
            </div>
            <div className="mcp-play-desc">{tool.desc}</div>
            <label className="mcp-play-l">arguments</label>
            <textarea className="mcp-play-input t-mono" rows="3" value={payload} onChange={e=>setPayload(e.target.value)} />
            <div style={{display:"flex", gap:8, alignItems:"center"}}>
              <button className="btn btn-primary btn-sm" onClick={run} disabled={running}>
                {running ? <><span className="mcp-spin"></span>Calling…</> : <><Icon name="sparkle" size={12}/>Run tool call</>}
              </button>
              <span className="t-xs text-tertiary">↩ to send</span>
            </div>
            {response && (
              <pre className="codeblock mcp-response">{response}</pre>
            )}
          </div>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <h3 className="card-title">Live tool-call stream</h3>
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            <span className="topo-stat-l" style={{display:"flex", gap:6, alignItems:"center"}}><span className="mcp-led"></span>live</span>
            <button className="btn btn-secondary btn-sm"><Icon name="download" size={12}/>Export</button>
          </div>
        </div>
        <ul className="tool-stream" ref={logRef}>
          {logs.map((l, i) => {
            const b = window.BRANDS[l.client] || window.BRANDS.bidstack;
            return (
              <li key={l.id || i} className={"tool-row tool-" + l.status} style={{ animationDelay: (i*0.03)+"s" }}>
                <span className="tool-time t-mono">{l.at || new Date().toTimeString().slice(0,8)}</span>
                <img src={b.asset} className="tool-client" alt="" />
                <span className="tool-name t-mono">{l.t}</span>
                <code className="tool-payload t-mono">{JSON.stringify(l.payload).slice(0,72)}</code>
                <span className="tool-arrow">→</span>
                <span className="tool-ret t-mono">{l.ret}</span>
                <span className={"tool-ms " + (l.ms>200?"slow":"")}>{l.ms} ms</span>
                <span className={"tool-status " + l.status}>{l.status === "ok" ? "200" : "warn"}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <Card title="Client configuration">
        <div className="config-split">
          <div>
            <div className="t-eyebrow">claude_desktop_config.json</div>
            <pre className="codeblock">{`{
  "mcpServers": {
    "bidstack360": {
      "command": "npx",
      "args": ["-y","@bidstack/mcp"],
      "env": {
        "BIDSTACK_TOKEN": "mcp_live_••••",
        "BIDSTACK_WORKSPACE": "mantu-group"
      }
    }
  }
}`}</pre>
          </div>
          <div>
            <div className="t-eyebrow">~/.cursor/mcp.json</div>
            <pre className="codeblock">{`{
  "mcpServers": {
    "bidstack360": {
      "url": "https://mcp.bidstack360.mantu.com/v1/sse",
      "headers": {
        "Authorization": "Bearer mcp_live_••••",
        "X-Workspace": "mantu-group"
      }
    }
  }
}`}</pre>
          </div>
        </div>
      </Card>
    </div>
  );
};

window.McpTab = McpTab;
