/* Intelligence widgets — company logos, live signals, financial health,
   decision unit, competitor radar, win prediction, hiring signals, triggers,
   data freshness ribbon. Drops into OpportunityDetail. */

/* ───────────────────────── Company logo marks ───────────────────────── */

const LOGO_PAINTERS = {
  shield:  (fg) => <path d="M16 4l10 4v8c0 7-5 11-10 12-5-1-10-5-10-12V8l10-4z" fill={fg} opacity=".95"/>,
  wave:    (fg) => <path d="M4 18c4-4 8-4 12 0s8 4 12 0v6c-4 4-8 4-12 0s-8-4-12 0v-6z" fill={fg}/>,
  cross:   (fg) => <g fill={fg}><rect x="13" y="6" width="6" height="20" rx="1.5"/><rect x="6" y="13" width="20" height="6" rx="1.5"/></g>,
  diamond: (fg) => <path d="M16 4l11 12-11 12L5 16 16 4z" fill={fg}/>,
  gear:    (fg) => <g fill={fg}><circle cx="16" cy="16" r="6"/><g><rect x="14.5" y="2" width="3" height="5" rx="1"/><rect x="14.5" y="25" width="3" height="5" rx="1"/><rect x="2" y="14.5" width="5" height="3" rx="1"/><rect x="25" y="14.5" width="5" height="3" rx="1"/><rect x="5.5" y="5.5" width="5" height="3" rx="1" transform="rotate(45 8 7)"/><rect x="21.5" y="21.5" width="5" height="3" rx="1" transform="rotate(45 24 23)"/><rect x="5.5" y="23.5" width="5" height="3" rx="1" transform="rotate(-45 8 25)"/><rect x="21.5" y="5.5" width="5" height="3" rx="1" transform="rotate(-45 24 7)"/></g></g>,
  sun:     (fg) => <g fill={fg}><circle cx="16" cy="16" r="6"/>{Array.from({length:8}).map((_,i)=>{const a=i*Math.PI/4;const x=16+Math.cos(a)*11,y=16+Math.sin(a)*11;return <circle key={i} cx={x} cy={y} r="1.6"/>})}</g>,
  signal:  (fg) => <g fill="none" stroke={fg} strokeWidth="2.2" strokeLinecap="round"><path d="M8 22a10 10 0 0116 0"/><path d="M11 19a6 6 0 0110 0"/><path d="M14 16a2 2 0 014 0"/><circle cx="16" cy="22" r="1.6" fill={fg}/></g>,
  star:    (fg) => <path d="M16 4l3.5 8L28 13l-6.5 5.5L23 27l-7-4-7 4 1.5-8.5L4 13l8.5-1L16 4z" fill={fg}/>,
};

const CompanyLogo = ({ customer, size = 48, square = false }) => {
  const meta = (window.LOGOS || {})[customer] || { kind:"diamond", bg:"#1F2937", fg:"#F3F4F6", mark: customer.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase() };
  const r = square ? size * 0.18 : size * 0.5;
  const paint = LOGO_PAINTERS[meta.kind] || LOGO_PAINTERS.diamond;
  return (
    <span className="company-logo" style={{ width:size, height:size, borderRadius:r, background:meta.bg, display:"inline-flex", alignItems:"center", justifyContent:"center", flex:"0 0 auto", boxShadow:"inset 0 0 0 1px rgba(255,255,255,0.06)" }}>
      <svg viewBox="0 0 32 32" width={size*0.62} height={size*0.62}>{paint(meta.fg)}</svg>
    </span>
  );
};

const CompanyMark = ({ customer, size = 22 }) => {
  const meta = (window.LOGOS || {})[customer] || { kind:"diamond", bg:"#1F2937", fg:"#F3F4F6" };
  const paint = LOGO_PAINTERS[meta.kind] || LOGO_PAINTERS.diamond;
  return (
    <span style={{ width:size, height:size, borderRadius:size*0.28, background:meta.bg, display:"inline-flex", alignItems:"center", justifyContent:"center", flex:"0 0 auto" }}>
      <svg viewBox="0 0 32 32" width={size*0.66} height={size*0.66}>{paint(meta.fg)}</svg>
    </span>
  );
};

/* ───────────────────────── Sparkline + bar primitives ───────────────────────── */

const Sparkline = ({ data, w = 220, h = 56, stroke = "var(--brand-primary)", fill = true }) => {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v,i) => [i*step, h - 6 - ((v - min)/span)*(h - 12)]);
  const d = pts.map((p,i) => (i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  const area = d + ` L ${w},${h} L 0,${h} Z`;
  const last = pts[pts.length-1];
  return (
    <svg width={w} height={h} className="spark">
      {fill && <path d={area} fill="url(#spark-grad)" opacity="0.18" />}
      <defs>
        <linearGradient id="spark-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.9"/>
          <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={stroke} />
      <circle cx={last[0]} cy={last[1]} r="6" fill={stroke} opacity="0.18" />
    </svg>
  );
};

/* ───────────────────────── Live data ribbon ───────────────────────── */

const DataFreshnessRibbon = () => {
  const sources = window.LIVE_SOURCES || [];
  const [now, setNow] = React.useState(0);
  React.useEffect(() => { const t = setInterval(()=>setNow(n=>n+1), 4000); return ()=>clearInterval(t); }, []);
  return (
    <div className="data-ribbon">
      <span className="dr-pulse"><span className="dr-pulse-dot"/>Live</span>
      <span className="dr-label">Synced from</span>
      <div className="dr-sources">
        {sources.map((s,i) => (
          <span key={s.name} className="dr-src" style={{ animationDelay:`${i*0.2}s` }}>
            <span className={"dr-dot " + (s.status==="ok"?"ok":"err")} />
            {s.name}
            <span className="dr-pull">{s.pull}</span>
          </span>
        ))}
      </div>
      <span className="dr-meta">Updated {new Date(Date.now() - now*1000).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" })}</span>
    </div>
  );
};

/* ───────────────────────── Financial health ───────────────────────── */

const tickerColor = (chg) => chg >= 0 ? "var(--success)" : "var(--danger)";

const FinancialHealth = ({ intel }) => {
  const up = (intel.change ?? 0) >= 0;
  return (
    <Card title="Financial health" action={
      <span className="card-action-meta"><span className="dot live" />Live · {intel.exchange}</span>
    }>
      <div className="fin-top">
        <div>
          <div className="fin-ticker">{intel.ticker}</div>
          <div className="fin-price">
            {intel.price ? <>{intel.price.toFixed(2)}<span className="fin-cur">{intel.exchange==="TSX"?"CAD":intel.exchange==="NYSE"?"USD":intel.exchange==="BME"||intel.exchange==="XETRA"||intel.exchange==="Euronext"?"EUR":intel.exchange==="Oslo Børs"?"NOK":""}</span></> : <span className="text-tertiary">—</span>}
          </div>
          {intel.price !== null && (
            <div className="fin-change" style={{ color: tickerColor(intel.change) }}>
              <Icon name={up?"caretup":"caret"} size={11} />{up?"+":""}{intel.change?.toFixed(2)} ({(intel.change/intel.price*100).toFixed(2)}%) today
            </div>
          )}
        </div>
        <Sparkline data={intel.series} w={220} h={64} stroke={up?"var(--success)":"var(--danger)"} />
      </div>

      <div className="fin-grid">
        <FinKv label="Market cap"     value={intel.marketCap} />
        <FinKv label="Annual revenue" value={intel.revenue} delta={intel.revenueGrowth} />
        <FinKv label="EBITDA"         value={intel.ebitda} delta={intel.ebitdaMargin + " margin"} />
        <FinKv label="Cash"           value={intel.cash} />
        <FinKv label="Debt"           value={intel.debt} />
        <FinKv label="Credit rating"  value={
          <span><b>{intel.creditRating}</b> <span className="text-tertiary t-xs">({intel.ratingAgency})</span></span>
        } delta={intel.ratingTrend} deltaTone={intel.ratingTrend==="positive"?"pos":intel.ratingTrend==="negative"?"neg":"neu"} />
      </div>

      <div className="fin-headcount">
        <div>
          <div className="fin-h-label">Headcount · {intel.employees.toLocaleString()}</div>
          <div className="fin-h-sub" style={{ color: intel.employeeGrowth.startsWith("-")?"var(--danger)":"var(--success)" }}>
            {intel.employeeGrowth} YoY · {intel.fundingStatus}
          </div>
        </div>
        <Sparkline data={intel.headcountSeries} w={140} h={32} stroke="var(--brand-primary)" />
      </div>
    </Card>
  );
};

const FinKv = ({ label, value, delta, deltaTone="pos" }) => (
  <div className="fin-kv">
    <div className="fin-kv-label">{label}</div>
    <div className="fin-kv-value">{value}</div>
    {delta && <div className={"fin-kv-delta " + deltaTone}>{delta}</div>}
  </div>
);

/* ───────────────────────── Buying triggers ───────────────────────── */

const BuyingTriggers = ({ intel }) => {
  const ICON_FOR = { funding:"dollar", reg:"shield", executive:"user", tech:"zap", deal:"trophy" };
  const TONE_FOR = { funding:"jade", reg:"orange", executive:"purple", tech:"blue", deal:"amber" };
  return (
    <Card title="Buying triggers" action={<span className="card-action-meta"><Icon name="sparkle" size={12} /> Detected by Dust</span>}>
      <ul className="triggers">
        {intel.triggers.map((t,i) => {
          const tones = { jade:{bg:"#DEF2E5",fg:"#1A7A4D"}, orange:{bg:"#FCEAD6",fg:"#B25400"}, purple:{bg:"#ECE0FB",fg:"#6232C2"}, blue:{bg:"var(--brand-primary-tint)",fg:"var(--brand-primary)"}, amber:{bg:"#FBF1DC",fg:"#9A6500"} };
          const c = tones[TONE_FOR[t.kind]];
          return (
            <li key={i} className="trigger">
              <span className="trigger-icon" style={{ background:c.bg, color:c.fg }}>
                <Icon name={ICON_FOR[t.kind]} size={14} />
              </span>
              <div className="trigger-text">{t.text}</div>
              <div className="trigger-weight">
                <div className="tw-bar"><div className="tw-fill" style={{ width: (t.weight*10)+"%" }} /></div>
                <span className="tw-num">{t.weight}/10</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

/* ───────────────────────── News & social ───────────────────────── */

const NewsFeed = ({ intel, onAskDust }) => {
  const sentColor = (s) => s==="pos"?"var(--success)":s==="neg"?"var(--danger)":"var(--fg-tertiary)";
  const sentLabel = (s) => s==="pos"?"Positive":s==="neg"?"Negative":"Neutral";
  return (
    <Card title="News & signals" action={
      <button className="btn btn-secondary btn-sm" onClick={onAskDust}><Icon name="sparkle" size={12} /> Brief me</button>
    }>
      <ul className="newsfeed">
        {(intel.news || []).map((n,i) => (
          <li key={i}>
            <div className="news-src"><span className="news-src-dot" style={{background:sentColor(n.sent)}}/>{n.src}</div>
            <div className="news-headline">{n.t}</div>
            <div className="news-meta">
              <span>{n.at} ago</span>
              <span className="bullet"/>
              <span style={{ color:sentColor(n.sent) }}>{sentLabel(n.sent)}</span>
            </div>
          </li>
        ))}
        {(!intel.news || intel.news.length===0) && <li><span className="text-tertiary t-xs">No recent news.</span></li>}
      </ul>
    </Card>
  );
};

/* ───────────────────────── Hiring intel ───────────────────────── */

const HiringIntel = ({ intel }) => (
  <Card title="Hiring signals" action={<span className="card-action-meta">LinkedIn · 30d</span>}>
    {(intel.hiring && intel.hiring.length) ? (
      <ul className="hiring">
        {intel.hiring.map((h,i) => (
          <li key={i}>
            <span className="h-count">{h.n}</span>
            <div className="h-meta">
              <div className="h-role">{h.role}{h.urgent && <span className="h-urgent">URGENT</span>}</div>
              <div className="h-team">{h.team} · open {h.since}</div>
            </div>
          </li>
        ))}
      </ul>
    ) : <div className="text-tertiary t-xs" style={{padding:"4px 0"}}>No relevant openings right now.</div>}
  </Card>
);

/* ───────────────────────── Decision unit map ───────────────────────── */

const DecisionUnit = ({ intel, onAskDust }) => {
  const sentColors = { hot:"#D93849", warm:"#F59E0B", neutral:"#8A93A6", cold:"#3A6FF7", unknown:"#C2C8D6" };
  return (
    <Card title="Decision unit" action={
      <button className="btn btn-secondary btn-sm" onClick={onAskDust}><Icon name="sparkle" size={12} /> Map gaps</button>
    }>
      <div className="du-legend">
        <span><span className="dot" style={{background:sentColors.hot}}/>Hot</span>
        <span><span className="dot" style={{background:sentColors.warm}}/>Warm</span>
        <span><span className="dot" style={{background:sentColors.neutral}}/>Neutral</span>
        <span><span className="dot" style={{background:sentColors.cold}}/>Cold</span>
      </div>
      <ul className="du-list">
        {(intel.decisionUnit || []).map((p,i) => (
          <li key={i} className="du-row">
            <span className="du-av" style={{boxShadow:`0 0 0 2px ${sentColors[p.sent]}`}}>{p.init}</span>
            <div className="du-meta">
              <div className="du-name">{p.name}</div>
              <div className="du-role">{p.role}</div>
            </div>
            <span className="du-power" data-tone={p.power}>{p.power}</span>
            <div className="du-influence" title="Influence weight">
              <div className="du-bar"><div className="du-fill" style={{ width: (p.weight*100)+"%", background: sentColors[p.sent] }} /></div>
            </div>
          </li>
        ))}
        {(!intel.decisionUnit || intel.decisionUnit.length===0) && <li><span className="text-tertiary t-xs">No decision unit mapped.</span></li>}
      </ul>
    </Card>
  );
};

/* ───────────────────────── Competitor radar ───────────────────────── */

const CompetitorRadar = ({ intel }) => {
  const axes = intel.radarAxes || [];
  const cx = 130, cy = 130, R = 100, n = axes.length;
  const ringSteps = [0.25, 0.5, 0.75, 1];
  const angle = (i) => -Math.PI/2 + (i / n) * Math.PI*2;
  const point = (i, r) => [cx + Math.cos(angle(i))*R*r, cy + Math.sin(angle(i))*R*r];
  const polyFor = (scores) => scores.map((s,i)=>{const [x,y]=point(i, s/100); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
  const [active, setActive] = React.useState(0);
  return (
    <Card title="Competitor radar" action={<span className="card-action-meta">{(intel.competitors||[]).length} bidders</span>}>
      <div className="comp-wrap">
        <svg viewBox="0 0 260 260" width="260" height="260" className="radar">
          {ringSteps.map((r,i) => (
            <polygon key={i} points={axes.map((_,j)=>{const [x,y]=point(j,r); return `${x},${y}`;}).join(" ")}
              fill="none" stroke="var(--border-subtle)" strokeWidth="1" />
          ))}
          {axes.map((_,i) => {
            const [x,y] = point(i, 1);
            return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border-subtle)" strokeWidth="1"/>;
          })}
          {(intel.competitors||[]).map((c,i) => (
            <polygon key={i} points={polyFor(c.score)}
              fill={c.color} fillOpacity={i===active?0.28:0.10}
              stroke={c.color} strokeWidth={i===active?2.4:1.4}
              strokeLinejoin="round" />
          ))}
          {axes.map((a,i) => {
            const [x,y] = point(i, 1.16);
            return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
              fontSize="11" fontWeight="600" fill="var(--fg-secondary)">{a}</text>;
          })}
        </svg>
        <div className="comp-list">
          {(intel.competitors||[]).map((c,i) => (
            <div key={c.name} className={"comp-row " + (i===active?"active":"")} onMouseEnter={()=>setActive(i)}>
              <span className="comp-swatch" style={{ background:c.color }} />
              <div className="comp-meta">
                <div className="comp-name">{c.name} {c.us && <span className="comp-us">YOU</span>}</div>
                <div className="comp-strength">{c.strength}</div>
              </div>
              <div className="comp-price">{c.price}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

/* ───────────────────────── Win prediction ───────────────────────── */

const WinPrediction = ({ intel, opp, onAskDust }) => {
  const p = intel.win?.probability ?? opp.probability ?? 0;
  const r = 56, C = 2*Math.PI*r;
  const dash = (p/100)*C;
  const tone = p>=70?"var(--success)":p>=40?"var(--warning)":"var(--danger)";
  return (
    <Card title="Win prediction" action={
      <button className="btn btn-secondary btn-sm" onClick={onAskDust}><Icon name="sparkle" size={12} /> Re-score</button>
    }>
      <div className="win-wrap">
        <div className="win-gauge">
          <svg viewBox="0 0 140 140" width="140" height="140">
            <circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="10"/>
            <circle cx="70" cy="70" r={r} fill="none" stroke={tone} strokeWidth="10"
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={C*0.25}
              strokeLinecap="round" transform="rotate(-90 70 70)" />
            <text x="70" y="68" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontWeight="700" fontSize="30" fill="var(--fg-primary)">{p}%</text>
            <text x="70" y="90" textAnchor="middle" fontFamily="Inter" fontWeight="500" fontSize="10" fill="var(--fg-tertiary)">model v3.2</text>
          </svg>
        </div>
        <div className="win-feat">
          <div className="win-feat-title">What's driving it</div>
          {(intel.win?.breakdown || []).map((b,i) => {
            const positive = b.w >= 0;
            const mag = Math.min(Math.abs(b.w), 25);
            return (
              <div key={i} className="win-row">
                <div className="win-bar-wrap">
                  <div className="win-axis" />
                  <div className={"win-bar " + (positive?"pos":"neg")} style={{ width: (mag*4)+"%", marginLeft: positive?"50%":(50 - mag*4)+"%" }} />
                </div>
                <div className="win-feat-text">{b.f}</div>
                <div className={"win-w " + (positive?"pos":"neg")}>{positive?"+":""}{b.w}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

/* ───────────────────────── Account brief (Dust) ───────────────────────── */

const AccountBrief = ({ opp, intel }) => {
  const [text, setText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const generate = async () => {
    setLoading(true); setError(null); setText("");
    try {
      const prompt = `You are a presales analyst at Mantu writing a 5-bullet executive brief for an account exec preparing a meeting. Use only the facts I give you. Be concrete, no fluff, no generic advice.

ACCOUNT: ${opp.customer} (${opp.industry}, ${opp.size})
OPPORTUNITY: ${opp.name} — ${window.formatMoney(opp.value, opp.currency)} — ${opp.probability}% probability, ${opp.stage} stage, deadline ${window.formatDate(opp.deadline)}.
FINANCIALS: revenue ${intel.revenue} (${intel.revenueGrowth} YoY), credit rating ${intel.creditRating}, cash ${intel.cash}.
TRIGGERS: ${(intel.triggers||[]).map(t=>t.text).join(" | ")}
RECENT NEWS: ${(intel.news||[]).slice(0,3).map(n=>n.t).join(" | ")}
DECISION UNIT: ${(intel.decisionUnit||[]).map(p=>`${p.name} (${p.role}, ${p.power}, ${p.sent})`).join("; ")}
COMPETITORS: ${(intel.competitors||[]).filter(c=>!c.us).map(c=>`${c.name} at ${c.price} — ${c.strength}`).join("; ")}

OUTPUT FORMAT — exactly 5 lines, each starting with "• ":
1. The angle: why we win or lose this deal in one sentence.
2. The pivotal stakeholder + what they care about.
3. Key competitive threat + counter-move.
4. The strongest buying trigger to anchor on.
5. The single next action that moves probability up.`;
      const out = await window.claude.complete(prompt);
      setText(out);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Executive brief" action={
      <button className="btn btn-primary btn-sm" onClick={generate} disabled={loading}>
        <Icon name={loading?"refresh":"sparkle"} size={12} style={loading?{animation:"spin 1s linear infinite"}:undefined} />
        {loading?"Drafting…":text?"Regenerate":"Generate brief"}
      </button>
    }>
      {!text && !loading && !error && (
        <div className="brief-empty">
          <Icon name="sparkle" size={28} />
          <div className="brief-empty-title">Dust will draft a 5-bullet exec brief</div>
          <div className="brief-empty-sub">Pulled from financials · news · decision unit · competitors</div>
        </div>
      )}
      {loading && (
        <div className="brief-loading">
          <div className="brief-skel" />
          <div className="brief-skel" />
          <div className="brief-skel" />
          <div className="brief-skel" />
          <div className="brief-skel short" />
        </div>
      )}
      {error && <div className="brief-error">Couldn't reach Dust: {error}</div>}
      {text && (
        <div className="brief-text">
          {text.split(/\n+/).filter(Boolean).map((line, i) => (
            <div className="brief-line" key={i}>
              <span className="brief-bullet">{line.replace(/^[•\-\*\d\.\s]+/, "").length ? "" : ""}</span>
              <span>{line.replace(/^[•\-\*]\s*/, "")}</span>
            </div>
          ))}
          <div className="brief-foot">
            <span className="brief-source"><Icon name="sparkle" size={11}/> Generated by Dust · claude-haiku-4-5</span>
            <button className="btn btn-secondary btn-xs"><Icon name="copy" size={11} />Copy</button>
            <button className="btn btn-secondary btn-xs"><Icon name="send" size={11} />Send to inbox</button>
          </div>
        </div>
      )}
    </Card>
  );
};

/* ───────────────────────── Intelligence section assembled ───────────────────────── */

const IntelligenceSection = ({ opp, openDust }) => {
  const intel = (window.INTEL || {})[opp.customer];
  if (!intel) return null;
  const ask = (q) => openDust && openDust({ prompt: q, opp });
  return (
    <>
      <DataFreshnessRibbon />
      <div className="intel-section-head">
        <h2 className="intel-h">360° Account intelligence</h2>
        <span className="intel-sub">Real-time signals from market, news, hiring, financials, and people graph</span>
      </div>

      <div className="intel-grid-a">
        <FinancialHealth intel={intel} />
        <BuyingTriggers intel={intel} />
      </div>

      <AccountBrief opp={opp} intel={intel} />

      <div className="intel-grid-b">
        <CompetitorRadar intel={intel} />
        <WinPrediction intel={intel} opp={opp} onAskDust={()=>ask(`Re-score win probability for ${opp.customer} and explain the top 3 levers we still control.`)} />
      </div>

      <div className="intel-grid-c">
        <DecisionUnit intel={intel} onAskDust={()=>ask(`We have ${(intel.decisionUnit||[]).length} mapped stakeholders at ${opp.customer}. Who is missing for a deal of this size, and what should we do this week?`)} />
        <NewsFeed intel={intel} onAskDust={()=>ask(`Summarize the last week of news on ${opp.customer} and tell me which headline is most material to the bid.`)} />
        <HiringIntel intel={intel} />
      </div>
    </>
  );
};

Object.assign(window, {
  CompanyLogo, CompanyMark, Sparkline,
  DataFreshnessRibbon, FinancialHealth, BuyingTriggers, NewsFeed, HiringIntel,
  DecisionUnit, CompetitorRadar, WinPrediction, AccountBrief,
  IntelligenceSection,
});
