/* Twenty-CRM-style enhancements: command palette, toasts, keyboard shortcuts,
   live activity stream. Adds a global UX layer over the existing app. */

/* ───────────────────────── Toast system ───────────────────────── */
const ToastContext = React.createContext({ push: () => {} });

const ToastHost = ({ children }) => {
  const [toasts, setToasts] = React.useState([]);
  const push = React.useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    const toast = { id, ...t };
    setToasts(s => [...s, toast]);
    setTimeout(() => setToasts(s => s.filter(x => x.id !== id)), t.duration || 4200);
  }, []);
  React.useEffect(() => { window.toast = push; }, [push]);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-host">
        {toasts.map(t => (
          <div key={t.id} className={"toast toast-" + (t.tone || "info")}>
            <span className="toast-icon"><Icon name={t.icon || (t.tone==="success"?"check":t.tone==="danger"?"warning":"sparkle")} size={14} /></span>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.message && <div className="toast-msg">{t.message}</div>}
            </div>
            {t.action && <button className="toast-action" onClick={t.action.onClick}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

/* ───────────────────────── Command palette (⌘K) ───────────────────────── */

const CommandPalette = ({ open, onClose, navigate }) => {
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(()=>inputRef.current?.focus(), 30); } }, [open]);

  const commands = React.useMemo(() => {
    const base = [
      { group:"Navigate", icon:"dashboard", label:"Go to Portfolio dashboard", action:()=>navigate({screen:"home"}) },
      { group:"Navigate", icon:"briefcase", label:"Go to Opportunities",       action:()=>navigate({screen:"opps"}) },
      { group:"Navigate", icon:"pipeline",  label:"Go to Pipeline kanban",     action:()=>navigate({screen:"pipeline"}) },
      { group:"Navigate", icon:"contacts",  label:"Go to Contacts",            action:()=>navigate({screen:"contacts"}) },
      { group:"Navigate", icon:"tasks",     label:"Go to Tasks",               action:()=>navigate({screen:"tasks"}) },
      { group:"Navigate", icon:"reports",   label:"Go to Reports",             action:()=>navigate({screen:"reports"}) },
      { group:"Navigate", icon:"link",      label:"Settings → Dust integration", action:()=>navigate({screen:"integrations"}) },
      { group:"Navigate", icon:"team",      label:"Settings → Team",           action:()=>navigate({screen:"team"}) },
      { group:"Action",   icon:"plus",      label:"New opportunity",           shortcut:"N", action:()=>{ window.toast?.({tone:"info", icon:"plus", title:"New opportunity", message:"Wired in handoff package."}); } },
      { group:"Action",   icon:"sparkle",   label:"Ask Dust to summarize today's pipeline",  action:()=>{ window.toast?.({tone:"info", icon:"sparkle", title:"Dust briefing requested"}); window.dispatchEvent(new CustomEvent("dust:open")); } },
      { group:"Action",   icon:"refresh",   label:"Force resync with Dust workspace",        action:()=>{ window.toast?.({tone:"success", icon:"refresh", title:"Resync started", message:"Pulling latest from mantu-presales"}); } },
      { group:"Action",   icon:"download",  label:"Export proposal package (PDF)",           action:()=>{ window.toast?.({tone:"info", icon:"download", title:"Proposal export queued"}); } },
      { group:"Action",   icon:"webhook",   label:"Open webhook inbox",                       action:()=>navigate({screen:"integrations"}) },
      { group:"Action",   icon:"key",       label:"Rotate API keys",                          action:()=>navigate({screen:"integrations"}) },
    ];
    (window.OPPS||[]).forEach(o => base.push({
      group:"Opportunities", icon:"target", label:`${o.code} · ${o.customer}`, sub:o.name,
      action:()=>navigate({screen:"opp", oppId:o.id})
    }));
    (window.CONTACTS||[]).forEach(c => base.push({
      group:"Contacts", icon:"user", label:c.name, sub:`${c.role} · ${c.customer}`,
      action:()=>navigate({screen:"contacts"})
    }));
    return base;
  }, [navigate]);

  const norm = (s) => (s||"").toLowerCase();
  const results = q.trim() ? commands.filter(c => norm(c.label+" "+(c.sub||"")+" "+c.group).includes(norm(q))).slice(0, 30) : commands.slice(0, 16);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(results.length-1, s+1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s-1)); }
    else if (e.key === "Enter") {
      const c = results[sel]; if (c) { c.action(); onClose(); }
    } else if (e.key === "Escape") onClose();
  };

  React.useEffect(() => { setSel(0); }, [q]);

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={e=>e.stopPropagation()}>
        <div className="cmdk-input-wrap">
          <Icon name="search" size={16} style={{color:"var(--fg-tertiary)"}} />
          <input ref={inputRef} className="cmdk-input" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search or run a command…" />
          <kbd className="cmdk-kbd">esc</kbd>
        </div>
        <div className="cmdk-list">
          {results.map((c, i) => {
            const showGroup = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <React.Fragment key={i}>
                {showGroup && <div className="cmdk-group">{c.group}</div>}
                <div className={"cmdk-item" + (i===sel?" sel":"")} onMouseEnter={()=>setSel(i)}
                  onClick={() => { c.action(); onClose(); }}>
                  <Icon name={c.icon} size={15} />
                  <div className="cmdk-text">
                    <div>{c.label}</div>
                    {c.sub && <div className="cmdk-sub">{c.sub}</div>}
                  </div>
                  {c.shortcut && <kbd className="cmdk-kbd">{c.shortcut}</kbd>}
                  <Icon name="arrow" size={12} style={{color:"var(--fg-tertiary)"}}/>
                </div>
              </React.Fragment>
            );
          })}
          {results.length === 0 && (
            <div className="cmdk-empty">No matches. Try "opportunity", "Acme", or "sync".</div>
          )}
        </div>
        <div className="cmdk-foot">
          <span><kbd className="cmdk-kbd">↑↓</kbd> navigate</span>
          <span><kbd className="cmdk-kbd">↵</kbd> select</span>
          <span><kbd className="cmdk-kbd">⌘K</kbd> toggle</span>
          <span style={{flex:1}}/>
          <span className="cmdk-pulse"><span className="cmdk-pulse-dot"/>Powered by Dust MCP</span>
        </div>
      </div>
    </div>
  );
};

/* ───────────────────────── Live activity stream (bottom-right) ───────────────────────── */

const LIVE_EVENTS = [
  { tone:"info",    icon:"link",     title:"Dust webhook",   msg:"opportunity.updated · OP-2041" },
  { tone:"success", icon:"check",    title:"Synced",         msg:"Pulled 14 records from Dust workspace" },
  { tone:"info",    icon:"sparkle",  title:"Dust agent",     msg:"Drafted exec summary for Northbrook" },
  { tone:"warn",    icon:"warning",  title:"Pricing risk",   msg:"Loomis bid 13% over benchmark" },
  { tone:"info",    icon:"webhook",  title:"MCP call",       msg:"opportunities.list ← claude-code-handoff" },
  { tone:"success", icon:"check",    title:"Document indexed", msg:"Acme MSP SoW v2 — 14 chunks" },
];

const LiveStream = () => {
  const [enabled, setEnabled] = React.useState(true);
  React.useEffect(() => {
    if (!enabled) return;
    let i = 0;
    const tick = () => {
      const evt = LIVE_EVENTS[i % LIVE_EVENTS.length];
      window.toast?.(evt);
      i++;
    };
    const t = setTimeout(tick, 2500);
    const t2 = setInterval(tick, 14000);
    return () => { clearTimeout(t); clearInterval(t2); };
  }, [enabled]);
  return null;
};

Object.assign(window, { ToastHost, CommandPalette, LiveStream });
