/* Main app — routing, shell, tweaks wiring */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "brand": "#4F46E5",
  "dark": false,
  "sidebar": "labeled",
  "cardStyle": "soft",
  "density": "comfortable",
  "showDust": true
}/*EDITMODE-END*/;

const BRAND_TINTS = {
  "#4F46E5": { tint:"#EEF0FF", strong:"#3730A3" },
  "#2540E0": { tint:"#E5ECFF", strong:"#1E2FA8" },
  "#7C3AED": { tint:"#F1E8FE", strong:"#5B21B6" },
  "#8B5CF6": { tint:"#F3EBFE", strong:"#6D28D9" },
  "#0D9488": { tint:"#D7F0EC", strong:"#0F766E" },
  "#1F2A44": { tint:"#E5E8F0", strong:"#101828" },
};

const App = () => {
  const [route, setRoute] = React.useState({ screen: "home" });
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const [dustOpen, setDustOpen] = React.useState(false);
  const [cmdk, setCmdk] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk(o => !o); }
      else if (meta && e.key.toLowerCase() === "j") { e.preventDefault(); setDustOpen(o => !o); }
      else if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { e.preventDefault(); setCmdk(true); }
    };
    window.addEventListener("keydown", onKey);
    const onDustOpen = () => setDustOpen(true);
    window.addEventListener("dust:open", onDustOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("dust:open", onDustOpen); };
  }, []);

  // open dust by default if tweak says so, but only once per mount
  React.useEffect(() => {
    if (t.showDust) setDustOpen(true);
    else setDustOpen(false);
  }, [t.showDust]);

  // apply theme tweaks to document root
  React.useEffect(() => {
    const r = document.documentElement;
    const brand = t.brand;
    const meta = BRAND_TINTS[brand] || BRAND_TINTS["#4F46E5"];
    r.style.setProperty("--brand-primary", brand);
    r.style.setProperty("--brand-primary-tint", meta.tint);
    r.style.setProperty("--brand-primary-strong", meta.strong);
    r.dataset.theme    = t.dark ? "dark" : "light";
    r.dataset.sidebar  = t.sidebar;
    r.dataset.card     = t.cardStyle;
    r.dataset.density  = t.density;
  }, [t]);

  const navigate = (next) => {
    setRoute(next);
    if (typeof next === "string") setRoute({ screen: next });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const opp = route.screen === "opp"
    ? window.OPPS.find(o => o.id === route.id) || window.OPPS[0]
    : null;

  const navMap = {
    home:     { key:"home",     crumbs:["BidStack 360°","Portfolio"] },
    opps:     { key:"opps",     crumbs:["BidStack 360°","Opportunities"] },
    pipeline: { key:"pipeline", crumbs:["BidStack 360°","Pipeline"] },
    opp:      { key:"opps",     crumbs:["Opportunities", opp ? opp.customer : ""] },
    contacts: { key:"contacts", crumbs:["BidStack 360°","Contacts"] },
    tasks:    { key:"tasks",    crumbs:["BidStack 360°","Tasks"] },
    reports:  { key:"reports",  crumbs:["BidStack 360°","Reports"] },
    integrations: { key:"integrations", crumbs:["Settings","Integrations · Dust"] },
    team:     { key:"team",     crumbs:["Settings","Team & permissions"] },
  };
  const nav = navMap[route.screen] || navMap.home;

  return (
    <div className={"app" + (dustOpen && t.showDust ? " dust-open" : "")}>
      <Sidebar activeKey={nav.key} onNavigate={(k) => navigate({ screen: k })} />
      <main className="main">
        <Topbar
          crumbs={nav.crumbs}
          onSearch={() => {}}
          dustOpen={dustOpen}
          onToggleDust={() => setDustOpen(o => !o)}
          showDustBtn={t.showDust}
        />
        <div className="page">
          {route.screen === "home"     && <PortfolioDashboard navigate={navigate} />}
          {route.screen === "opps"     && <OpportunitiesList navigate={navigate} />}
          {route.screen === "pipeline" && <PipelineKanban navigate={navigate} />}
          {route.screen === "opp"      && opp && <OpportunityDetail opp={opp} navigate={navigate} openDust={({prompt}) => { setDustOpen(true); window.dispatchEvent(new CustomEvent("dust:ask", { detail:{ prompt }})); }} />}
          {route.screen === "contacts" && <ContactsScreen navigate={navigate} />}
          {route.screen === "tasks"    && <TasksScreen navigate={navigate} />}
          {route.screen === "reports"  && <ReportsScreen />}
          {route.screen === "integrations" && <SettingsIntegrations />}
          {route.screen === "team"     && <SettingsTeam />}
          {!["home","opps","pipeline","opp","contacts","tasks","reports","integrations","team"].includes(route.screen) && <ComingSoon screen={route.screen} />}
        </div>
      </main>
      {t.showDust && <DustAssistant open={dustOpen} onClose={() => setDustOpen(false)} opp={opp} />}

      <window.CommandPalette open={cmdk} onClose={() => setCmdk(false)} navigate={navigate} />
      <window.LiveStream />

      <button className="cmdk-fab" onClick={() => setCmdk(true)} title="Command palette (⌘K)">
        <Icon name="search" size={16}/>
        <span>Search or run…</span>
        <kbd>⌘K</kbd>
      </button>

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection title="Brand">
          <window.TweakColor
            label="Primary color"
            value={t.brand}
            onChange={v => setTweak("brand", v)}
            options={["#4F46E5","#2540E0","#7C3AED","#8B5CF6","#0D9488","#1F2A44"]}
          />
          <window.TweakToggle label="Dark mode" value={t.dark} onChange={v => setTweak("dark", v)} />
        </window.TweakSection>

        <window.TweakSection title="Layout">
          <window.TweakRadio
            label="Sidebar style"
            value={t.sidebar}
            onChange={v => setTweak("sidebar", v)}
            options={[
              { value:"labeled",     label:"Labeled" },
              { value:"icons",       label:"Icons" },
            ]}
          />
          <window.TweakRadio
            label="Card style"
            value={t.cardStyle}
            onChange={v => setTweak("cardStyle", v)}
            options={[
              { value:"flat",     label:"Flat" },
              { value:"soft",     label:"Soft" },
              { value:"bordered", label:"Bordered" },
            ]}
          />
          <window.TweakRadio
            label="Density"
            value={t.density}
            onChange={v => setTweak("density", v)}
            options={[
              { value:"comfortable", label:"Comfortable" },
              { value:"compact",     label:"Compact" },
            ]}
          />
        </window.TweakSection>

        <window.TweakSection title="Dust assistant">
          <window.TweakToggle label="Show in CRM" value={t.showDust} onChange={v => setTweak("showDust", v)} />
        </window.TweakSection>
      </window.TweaksPanel>
    </div>
  );
};

const ComingSoon = ({ screen }) => (
  <div style={{display:"flex", alignItems:"center", justifyContent:"center", minHeight:400}}>
    <div className="empty">
      <Icon name="files" size={36} className="icon" />
      <div className="t">Coming soon</div>
      <div className="t-xs">The "{screen}" screen is in this prototype's backlog.</div>
    </div>
  </div>
);

const Root = () => (
  <window.ToastHost>
    <App />
  </window.ToastHost>
);

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
