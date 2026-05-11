/* App shell: Sidebar + Topbar — aligned with app.jsx routes */

const SidebarItem = ({ iconName, label, active, badge, onClick }) => (
  <div className={"sb-item" + (active ? " active" : "")} onClick={onClick} title={label}>
    <Icon name={iconName} size={16} />
    <span>{label}</span>
    {badge != null && badge > 0 && <span className="sb-badge">{badge}</span>}
  </div>
);

const SidebarGroup = ({ title, children }) => (
  <div className="sb-group">
    <div className="sb-group-title">{title}</div>
    {children}
  </div>
);

const Sidebar = ({ activeKey, onNavigate }) => {
  const overdue = window.TASKS.filter(t => window.daysUntil(t.due) < 7).length;
  const openBids = window.OPPS.filter(o => o.stage !== "won" && o.stage !== "lost").length;
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-mark">B</div>
        <div>
          <div className="sb-name">BidStack<span className="deg">°</span></div>
          <div className="sb-tag">Mantu · Bid &amp; presales</div>
        </div>
      </div>
      <SidebarGroup title="Workspace">
        <SidebarItem iconName="dashboard"  label="Portfolio"     active={activeKey==="home"}     onClick={()=>onNavigate("home")} />
        <SidebarItem iconName="briefcase"  label="Opportunities" active={activeKey==="opps"}     onClick={()=>onNavigate("opps")}     badge={openBids} />
        <SidebarItem iconName="pipeline"   label="Pipeline"      active={activeKey==="pipeline"} onClick={()=>onNavigate("pipeline")} />
        <SidebarItem iconName="contacts"   label="Contacts"      active={activeKey==="contacts"} onClick={()=>onNavigate("contacts")} />
        <SidebarItem iconName="tasks"      label="Tasks"         active={activeKey==="tasks"}    onClick={()=>onNavigate("tasks")}    badge={overdue} />
        <SidebarItem iconName="reports"    label="Reports"       active={activeKey==="reports"}  onClick={()=>onNavigate("reports")} />
      </SidebarGroup>
      <SidebarGroup title="Settings">
        <SidebarItem iconName="link"       label="Integrations"  active={activeKey==="integrations"} onClick={()=>onNavigate("integrations")} />
        <SidebarItem iconName="contacts"   label="Team"          active={activeKey==="team"}         onClick={()=>onNavigate("team")} />
      </SidebarGroup>
      <div style={{flex:1}} />
      <div className="sb-foot">
        <div className="sb-sync">
          <span className="cs-pulse"></span>
          <span>Dust connected · synced 2m ago</span>
        </div>
      </div>
    </aside>
  );
};

const Topbar = ({ crumbs, dustOpen, onToggleDust, showDustBtn }) => (
  <header className="topbar">
    <div className="crumbs">
      {(crumbs || []).map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="sep">/</span>}
          <span className={i === crumbs.length - 1 ? "here" : ""}>{c}</span>
        </React.Fragment>
      ))}
    </div>
    <div className="spacer"></div>
    <div className="tb-search">
      <Icon name="search" size={14} />
      <span>Search bids, contacts, files…</span>
      <kbd>⌘K</kbd>
    </div>
    {showDustBtn && (
      <button className={"dust-toggle-btn" + (dustOpen ? " on" : "")} onClick={onToggleDust}>
        <Icon name="sparkle" size={13} />
        Dust
      </button>
    )}
    <button className="iconbtn"><Icon name="bell" /><span className="badge"></span></button>
    <button className="iconbtn"><Icon name="help" /></button>
    <div className="tb-user">
      <span className="av">JS</span>
      <div className="who">
        <div className="name">Jane Smith</div>
        <div className="role">Bid manager</div>
      </div>
      <Icon name="caret" size={12} />
    </div>
  </header>
);

Object.assign(window, { Sidebar, SidebarItem, SidebarGroup, Topbar });
