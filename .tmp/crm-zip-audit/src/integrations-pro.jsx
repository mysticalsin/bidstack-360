/* ────────────────────────────────────────────────────────────────────────
   Integrations Pro — live-feeling integrations console with real logos,
   animated topology, MCP playground, REST API explorer, webhook stream.
   Overrides window.SettingsIntegrations exported by screens-settings.jsx.
   ─────────────────────────────────────────────────────────────────────── */

/* ───────── Brand registry ───────── */

const BRANDS = {
  bidstack:   { name:"BidStack 360°",  asset:"assets/integrations/bidstack.svg",  brand:"#4F46E5" },
  anthropic:  { name:"Anthropic API",  asset:"assets/integrations/anthropic.svg", brand:"#D97757" },
  dust:       { name:"Dust.tt",        asset:"assets/integrations/dust.svg",      brand:"#1F1F1F" },
  claude:     { name:"Claude Desktop", asset:"assets/integrations/claude.svg",    brand:"#D97757" },
  cursor:     { name:"Cursor IDE",     asset:"assets/integrations/cursor.svg",    brand:"#111" },
  zed:        { name:"Zed Editor",     asset:"assets/integrations/zed.svg",       brand:"#D9C8A8" },
  continue:   { name:"Continue.dev",   asset:"assets/integrations/continue.svg",  brand:"#000" },
  slack:      { name:"Slack",          asset:"assets/integrations/slack.svg",     brand:"#4A154B" },
  teams:      { name:"Microsoft Teams",asset:"assets/integrations/teams.svg",     brand:"#4B53BC" },
  hubspot:    { name:"HubSpot CRM",    asset:"assets/integrations/hubspot.svg",   brand:"#FF7A59" },
  salesforce: { name:"Salesforce",     asset:"assets/vendors/salesforce.svg",     brand:"#00A1E0" },
  servicenow: { name:"ServiceNow",     asset:"assets/vendors/servicenow.svg",     brand:"#62D84E" },
  notion:     { name:"Notion",         asset:"assets/integrations/notion.svg",    brand:"#000" },
  linear:     { name:"Linear",         asset:"assets/integrations/linear.svg",    brand:"#5E6AD2" },
  github:     { name:"GitHub",         asset:"assets/integrations/github.svg",    brand:"#0D1117" },
  stripe:     { name:"Stripe",         asset:"assets/integrations/stripe.svg",    brand:"#635BFF" },
  zapier:     { name:"Zapier",         asset:"assets/integrations/zapier.svg",    brand:"#FF4F00" },
  docusign:   { name:"DocuSign",       asset:"assets/integrations/docusign.svg",  brand:"#FFCC22" },
  gmail:      { name:"Gmail",          asset:"assets/integrations/gmail.svg",     brand:"#EA4335" },
  outlook:    { name:"Outlook",        asset:"assets/integrations/outlook.svg",   brand:"#0078D4" },
  zoom:       { name:"Zoom",           asset:"assets/integrations/zoom.svg",      brand:"#2D8CFF" },
};

const BrandIcon = ({ slug, size=22 }) => {
  const b = BRANDS[slug];
  if (!b) return null;
  return <img src={b.asset} alt="" width={size} height={size} className="brand-icon" />;
};

/* ───────── Animated topology hero ─────────
   Shows BidStack at the center, with MCP clients & external SaaS orbiting,
   with packets flowing along each connection in real time.
*/

const Topology = ({ pulseKey }) => {
  // node positions in SVG coords (1000x340 viewbox)
  const center = { x: 500, y: 170 };
  const left = [
    { slug:"dust",       y: 40,  label:"Dust.tt · Agents" },
    { slug:"claude",     y: 130, label:"Claude Desktop · MCP" },
    { slug:"cursor",     y: 210, label:"Cursor · MCP" },
    { slug:"zed",        y: 290, label:"Zed · MCP" },
  ];
  const right = [
    { slug:"salesforce", y: 60,  label:"Salesforce · OAuth" },
    { slug:"slack",      y: 130, label:"Slack · Bot" },
    { slug:"hubspot",    y: 200, label:"HubSpot · REST" },
    { slug:"servicenow", y: 270, label:"ServiceNow · Webhook" },
  ];

  // x-positions for orbit
  const lx = 140, rx = 860;

  return (
    <div className="topology">
      <div className="topo-head">
        <div>
          <div className="topo-eyebrow">LIVE</div>
          <h2 className="topo-title">Integration topology</h2>
          <div className="topo-sub">2 MCP clients online · 3 SaaS connectors active · 412 events / hr</div>
        </div>
        <div className="topo-stat-row">
          <Stat label="Tool calls" valueKey="tools" />
          <Stat label="API requests" valueKey="api" />
          <Stat label="Webhooks" valueKey="hooks" />
          <Stat label="Latency p95" suffix=" ms" valueKey="lat" />
        </div>
      </div>

      <svg viewBox="0 0 1000 340" className="topo-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="topo-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity=".35"/>
            <stop offset="60%" stopColor="var(--brand-primary)" stopOpacity=".06"/>
            <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0"/>
          </radialGradient>
          <linearGradient id="topo-line-l" x1="0" x2="1">
            <stop offset="0" stopColor="var(--brand-primary)" stopOpacity=".25"/>
            <stop offset="1" stopColor="var(--brand-primary)" stopOpacity=".85"/>
          </linearGradient>
          <linearGradient id="topo-line-r" x1="0" x2="1">
            <stop offset="0" stopColor="var(--brand-primary)" stopOpacity=".85"/>
            <stop offset="1" stopColor="var(--brand-primary)" stopOpacity=".25"/>
          </linearGradient>
        </defs>

        {/* center glow */}
        <circle cx={center.x} cy={center.y} r="120" fill="url(#topo-glow)" />

        {/* grid */}
        {[0,1,2,3,4].map(i => (
          <line key={"h"+i} x1="0" y1={68*i + 4} x2="1000" y2={68*i + 4} stroke="var(--border-subtle)" strokeWidth=".5" opacity=".4"/>
        ))}

        {/* left links (clients → bidstack) */}
        {left.map((n, i) => (
          <g key={"l"+i}>
            <path d={`M${lx+22} ${n.y} C ${(lx+center.x)/2} ${n.y}, ${(lx+center.x)/2} ${center.y}, ${center.x-44} ${center.y}`}
              fill="none" stroke="url(#topo-line-l)" strokeWidth="1.2" strokeDasharray="3 4" className="topo-link" />
            <circle r="3.5" fill="var(--brand-primary)" className="topo-packet">
              <animateMotion dur={(3 + i*0.6)+"s"} repeatCount="indefinite" rotate="auto" begin={(i*0.4)+"s"}
                path={`M${lx+22} ${n.y} C ${(lx+center.x)/2} ${n.y}, ${(lx+center.x)/2} ${center.y}, ${center.x-44} ${center.y}`} />
            </circle>
          </g>
        ))}

        {/* right links (bidstack → saas) */}
        {right.map((n, i) => (
          <g key={"r"+i}>
            <path d={`M${center.x+44} ${center.y} C ${(center.x+rx)/2} ${center.y}, ${(center.x+rx)/2} ${n.y}, ${rx-22} ${n.y}`}
              fill="none" stroke="url(#topo-line-r)" strokeWidth="1.2" strokeDasharray="3 4" className="topo-link" />
            <circle r="3.2" fill="#0EA5E9" className="topo-packet">
              <animateMotion dur={(3.5 + i*0.5)+"s"} repeatCount="indefinite" rotate="auto" begin={(0.2 + i*0.5)+"s"}
                path={`M${center.x+44} ${center.y} C ${(center.x+rx)/2} ${center.y}, ${(center.x+rx)/2} ${n.y}, ${rx-22} ${n.y}`} />
            </circle>
          </g>
        ))}

        {/* center node */}
        <g transform={`translate(${center.x-44} ${center.y-44})`}>
          <rect width="88" height="88" rx="20" fill="var(--surface-card)" stroke="var(--brand-primary)" strokeWidth="1.5"/>
          <foreignObject x="14" y="14" width="60" height="60">
            <div xmlns="http://www.w3.org/1999/xhtml" className="topo-center-mark">B</div>
          </foreignObject>
          <circle cx="44" cy="44" r="50" fill="none" stroke="var(--brand-primary)" strokeOpacity=".25" className="topo-pulse"/>
          <circle cx="44" cy="44" r="50" fill="none" stroke="var(--brand-primary)" strokeOpacity=".15" className="topo-pulse-2"/>
        </g>
        <text x={center.x} y={center.y+74} textAnchor="middle" fontFamily="Plus Jakarta Sans" fontWeight="700" fontSize="13" fill="var(--fg-primary)">BidStack 360°</text>
        <text x={center.x} y={center.y+90} textAnchor="middle" fontFamily="Inter" fontSize="10.5" fill="var(--fg-tertiary)">api.bidstack360.mantu.com</text>

        {/* left nodes */}
        {left.map((n, i) => (
          <g key={"ln"+i} transform={`translate(${lx-22} ${n.y-22})`}>
            <rect width="44" height="44" rx="11" fill="var(--surface-card)" stroke="var(--border-subtle)" />
            <foreignObject x="9" y="9" width="26" height="26">
              <div xmlns="http://www.w3.org/1999/xhtml" className="topo-icon-wrap"><img src={BRANDS[n.slug].asset} alt=""/></div>
            </foreignObject>
            <text x="55" y="14" fontFamily="Plus Jakarta Sans" fontWeight="600" fontSize="11.5" fill="var(--fg-primary)">{BRANDS[n.slug].name}</text>
            <text x="55" y="29" fontFamily="JetBrains Mono" fontSize="10" fill="var(--fg-tertiary)">{n.label.split("·")[1]?.trim()}</text>
            <circle cx="50" cy="40" r="2.5" fill="var(--success)" className="topo-ledpulse"/>
          </g>
        ))}

        {/* right nodes */}
        {right.map((n, i) => (
          <g key={"rn"+i} transform={`translate(${rx-22} ${n.y-18})`}>
            <rect width="44" height="36" rx="10" fill="var(--surface-card)" stroke="var(--border-subtle)"/>
            <foreignObject x="9" y="6" width="26" height="26">
              <div xmlns="http://www.w3.org/1999/xhtml" className="topo-icon-wrap"><img src={BRANDS[n.slug].asset} alt=""/></div>
            </foreignObject>
            <text x="-7" y="14" textAnchor="end" fontFamily="Plus Jakarta Sans" fontWeight="600" fontSize="11.5" fill="var(--fg-primary)">{BRANDS[n.slug].name}</text>
            <text x="-7" y="29" textAnchor="end" fontFamily="JetBrains Mono" fontSize="10" fill="var(--fg-tertiary)">{n.label.split("·")[1]?.trim()}</text>
            <circle cx="2" cy="32" r="2.5" fill="var(--success)" className="topo-ledpulse"/>
          </g>
        ))}
      </svg>
    </div>
  );
};

const Stat = ({ label, valueKey, suffix="" }) => {
  const seeds = { tools: 1842, api: 12847, hooks: 412, lat: 148 };
  const [v, setV] = React.useState(seeds[valueKey]);
  React.useEffect(() => {
    const id = setInterval(() => {
      setV(curr => {
        if (valueKey === "lat") return 130 + Math.floor(Math.random()*40);
        return curr + Math.floor(Math.random()*4 + 1);
      });
    }, valueKey === "lat" ? 1800 : 2200);
    return () => clearInterval(id);
  }, [valueKey]);
  return (
    <div className="topo-stat">
      <div className="topo-stat-v">{v.toLocaleString()}<span className="topo-stat-suf">{suffix}</span></div>
      <div className="topo-stat-l">{label}</div>
    </div>
  );
};

window.Topology = Topology;
window.BRANDS = BRANDS;
window.BrandIcon = BrandIcon;
