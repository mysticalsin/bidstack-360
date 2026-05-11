/* Shared atoms — Icon (Lucide-style inline SVG), Pill, Chip, Card, KpiTile, Avatar, Modal */

const Icon = ({ name, size = 18, sw = 1.75, style, color }) => {
  const d = ICONS[name] || ICONS.help;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color || "currentColor"} strokeWidth={sw}
         strokeLinecap="round" strokeLinejoin="round" style={style}>
      {d}
    </svg>
  );
};

const ICONS = {
  // additions for command palette & toasts
  refresh:   <><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/></>,
  download:  <><path d="M12 3v13M6 11l6 6 6-6M5 21h14"/></>,
  webhook:   <><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><circle cx="12" cy="6" r="2.5"/><path d="M9.7 7.5L7 14M14.3 7.5L17 14M8.5 18h7"/></>,
  target:    <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></>,
  user:      <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></>,
  pipeline:  <><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="13" rx="1"/><rect x="17" y="3" width="4" height="9" rx="1"/></>,
  reports:   <><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></>,
  team:      <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0112 0M14 20a5 5 0 017-4.6"/></>,
  // nav
  dashboard: <><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/></>,
  pipeline:  <><rect x="3" y="4" width="6" height="16" rx="1"/><rect x="11" y="4" width="6" height="16" rx="1"/><rect x="19" y="4" width="2" height="16" rx="1"/></>,
  contacts:  <><circle cx="9" cy="8" r="3.5"/><path d="M3 21a6 6 0 0112 0M16 4a4 4 0 010 8M19 21v-1a4 4 0 00-3-3.87"/></>,
  tasks:     <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/></>,
  reports:   <><path d="M3 17l6-6 4 4 8-8M21 7v6h-6"/></>,
  link:      <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></>,
  team:      <><circle cx="9" cy="8" r="3.5"/><path d="M3 21a6 6 0 0112 0M16 4a4 4 0 010 8M19 21v-1a4 4 0 00-3-3.87"/></>,
  settings:  <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.8.4l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.4-1.8l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></>,
  // common
  search:    <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></>,
  bell:      <><path d="M6 8a6 6 0 1112 0c0 7 3 7 3 9H3c0-2 3-2 3-9zM10 21a2 2 0 004 0"/></>,
  help:      <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01"/></>,
  mail:      <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
  phone:     <><path d="M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></>,
  plus:      <><path d="M12 5v14M5 12h14"/></>,
  caret:     <><path d="M6 9l6 6 6-6"/></>,
  caretup:   <><path d="M6 15l6-6 6 6"/></>,
  arrow:     <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  external:  <><path d="M14 4h6v6M20 4l-9 9M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1v-4"/></>,
  sparkle:   <><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/></>,
  growth:    <><path d="M3 17l6-6 4 4 8-8M21 7v6h-6"/></>,
  warning:   <><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/></>,
  shield:    <><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z"/></>,
  files:     <><path d="M14 3H6v18h12V7zM14 3v4h4"/></>,
  filter:    <><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/></>,
  download:  <><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></>,
  upload:    <><path d="M12 21V9M7 14l5-5 5 5M5 3h14"/></>,
  trash:     <><path d="M3 6h18M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></>,
  edit:      <><path d="M12 20h9M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/></>,
  more:      <><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>,
  more_h:    <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  close:     <><path d="M18 6L6 18M6 6l12 12"/></>,
  send:      <><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></>,
  refresh:   <><path d="M21 12a9 9 0 11-2.6-6.4M21 4v5h-5"/></>,
  copy:      <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H3a2 2 0 01-2-2V3a2 2 0 012-2h10a2 2 0 012 2v2"/></>,
  check:     <><path d="M5 12l5 5L20 7"/></>,
  zap:       <><path d="M13 2L3 14h7l-1 8 11-12h-7l0-8z"/></>,
  globe:     <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></>,
  database:  <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
  layers:    <><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></>,
  webhook:   <><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="6" cy="18" r="3"/><path d="M9 6h7a4 4 0 010 8M9 18h6"/></>,
  key:       <><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9 2 2-2 2 2 2-2 2-2-2-2 2"/></>,
  flag:      <><path d="M4 22V4M4 4h13l-2 5 2 5H4"/></>,
  user:      <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></>,
  calendar:  <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
  clock:     <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  dollar:    <><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,
  endpoint:  <><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  building:  <><path d="M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 8h0M9 12h0M9 16h0M15 8h0M15 12h0M15 16h0"/></>,
  trophy:    <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3"/></>,
  target:    <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  drag:      <><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></>,
  moon:      <><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></>,
  sun:       <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  rocket:    <><path d="M5 13a8 8 0 0114-7l2 2-7 14a8 8 0 01-9-9zM12 12l3-3M5 13l-2 6 6-2"/></>,
};

/* ───────── Atoms ───────── */

const StatusPill = ({ tone = "success", label, dot = true }) => {
  const tones = {
    success: { bg:"var(--success-tint)",  fg:"var(--success)",  dot:"var(--success)" },
    warn:    { bg:"var(--warning-tint)",  fg:"var(--warning)",  dot:"var(--warning)" },
    danger:  { bg:"var(--danger-tint)",   fg:"var(--danger)",   dot:"var(--danger)" },
    info:    { bg:"var(--info-tint)",     fg:"var(--info)",     dot:"var(--info)" },
    neutral: { bg:"var(--surface-sunken)",fg:"var(--fg-secondary)", dot:"var(--fg-tertiary)" },
    brand:   { bg:"var(--brand-primary-tint)", fg:"var(--brand-primary)", dot:"var(--brand-primary)" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span className="pill" style={{ background:t.bg, color:t.fg }}>
      {dot && <span className="dot" style={{ background:t.dot }} />}
      {label}
    </span>
  );
};

const stageTone = (stage) => ({
  qualifying: "neutral", discovery: "info", proposal: "brand",
  negotiation: "warn", won: "success", lost: "danger"
}[stage] || "neutral");

const stageName = (stage) => (window.STAGES.find(s => s.id===stage)||{}).name || stage;

const VendorChip = ({ slug, label, more }) => {
  if (more) return <span className="chip-more">+{more}</span>;
  return (
    <span className="chip">
      <img src={`assets/vendors/${slug}.svg`} alt="" onError={(e)=>{e.target.style.visibility='hidden';}} />
      {label}
    </span>
  );
};

const Avatar = ({ initials, size = 28, brand = false, style }) => (
  <span
    className="av-circle"
    style={{
      width: size, height: size, fontSize: Math.round(size * 0.36),
      background: brand ? "var(--brand-gradient)" : "var(--brand-primary-tint)",
      color: brand ? "#fff" : "var(--brand-primary)",
      ...style
    }}>
    {initials}
  </span>
);

const AvatarStack = ({ inits = [], max = 4 }) => {
  const visible = inits.slice(0, max);
  const rest = inits.length - visible.length;
  return (
    <span className="av-stack">
      {visible.map((i, idx) => <Avatar key={idx} initials={i} />)}
      {rest > 0 && <span className="av-more">+{rest}</span>}
    </span>
  );
};

const Card = ({ title, action, children, className = "", noPad = false }) => (
  <section className={"card " + className}>
    {(title || action) && (
      <header className="card-head">
        <h3 className="card-title">{title}</h3>
        {action}
      </header>
    )}
    <div className={"card-body" + (noPad ? " flush" : "")}>{children}</div>
  </section>
);

const KpiTile = ({ icon, tone = "blue", label, value, trend, onClick, sub }) => {
  const tones = {
    teal:    { bg:"#DDF2EF", fg:"#137B6E" },
    jade:    { bg:"#DEF2E5", fg:"#1A7A4D" },
    blue:    { bg:"var(--brand-primary-tint)", fg:"var(--brand-primary)" },
    orange:  { bg:"#FCEAD6", fg:"#B25400" },
    amber:   { bg:"#FBF1DC", fg:"#9A6500" },
    purple:  { bg:"#ECE0FB", fg:"#6232C2" },
    plum:    { bg:"#F2DCEC", fg:"#8E2A82" },
    rose:    { bg:"#FBDDE5", fg:"#B61F44" },
  };
  const t = tones[tone] || tones.blue;
  return (
    <div className={"kpi" + (onClick ? " kpi-clickable" : "")} onClick={onClick}>
      <div className="kpi-icon" style={{ background:t.bg, color:t.fg }}>
        <Icon name={icon} size={20} />
      </div>
      <div className="kpi-text">
        <div className="kpi-label">{label}</div>
        <div className="flex items-center">
          <div className="kpi-value">{value}</div>
          {trend && (
            <span className={"kpi-trend " + (trend.startsWith("-") ? "down" : "up")}>
              <Icon name={trend.startsWith("-") ? "caret" : "caretup"} size={11} />
              {trend.replace("-","")}
            </span>
          )}
        </div>
        {sub && <div className="t-xs text-tertiary">{sub}</div>}
      </div>
    </div>
  );
};

/* progress bar */
const Pbar = ({ value, tone }) => {
  const t = value >= 70 ? "green" : value >= 40 ? "amber" : "red";
  return (
    <span className="pbar" style={{ display:"inline-block", verticalAlign:"middle" }}>
      <div className={"pbar-fill"} style={{ width: value + "%", background: t === "green" ? "var(--success)" : t === "amber" ? "var(--warning)" : "var(--danger)" }} />
    </span>
  );
};

/* Donut chart — used for health score and stage distribution */
const Donut = ({ segments, total, label, sub, size = 160 }) => {
  const r = 15.9, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox="0 0 42 42" width={size} height={size}>
      <circle cx="21" cy="21" r={r} fill="var(--surface-card)" stroke="var(--surface-sunken)" strokeWidth="3.4" />
      {segments.map((s, i) => {
        const dash = (s.v / total) * C;
        const offset = -((acc / total) * C);
        acc += s.v;
        return (
          <circle key={i} cx="21" cy="21" r={r} fill="transparent"
            stroke={s.color} strokeWidth="3.4"
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 21 21)" />
        );
      })}
      {label && <text x="21" y="21.5" textAnchor="middle" fontFamily="Plus Jakarta Sans, Inter" fontWeight="700" fontSize="9" fill="var(--fg-primary)">{label}</text>}
      {sub && <text x="21" y="26" textAnchor="middle" fontFamily="Inter" fontWeight="500" fontSize="3" fill="var(--fg-tertiary)">{sub}</text>}
    </svg>
  );
};

Object.assign(window, {
  Icon, ICONS, StatusPill, stageTone, stageName, VendorChip, Avatar, AvatarStack,
  Card, KpiTile, Pbar, Donut
});
