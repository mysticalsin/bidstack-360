/* Mock data for Mantu Bid & Presales CRM */

window.STAGES = [
  { id: "qualifying",  name: "Qualifying",       color: "#8A93A6" },
  { id: "discovery",   name: "Discovery",        color: "#6E59FF" },
  { id: "proposal",    name: "Proposal",         color: "#2C4BFF" },
  { id: "negotiation", name: "Negotiation",      color: "#D08A00" },
  { id: "won",         name: "Closed won",       color: "#1F8A5B" },
  { id: "lost",        name: "Closed lost",      color: "#D93849" },
];

window.OPPS = [
  {
    id: "OP-2041", code: "OP-2041",
    name: "CI Financial — IT Modernization & MSP",
    customer: "CI Financial", customerInitials: "CI",
    industry: "Financial Services", size: "Enterprise · 2,500+", location: "Toronto, Canada",
    website: "ci.com",
    type: "RFP",
    stage: "proposal",
    value: 1_240_000, currency: "USD",
    probability: 65,
    closeDate: "2026-07-22", deadline: "2026-05-28",
    health: 72,
    owner: "Jane Smith", ownerInitials: "JS",
    team: ["JS","MT","SB","DL"],
    tags: ["IT Infrastructure","Cloud","Security"],
    summary: "Five-year managed services bid covering 1,842 endpoints across 12 sites. Primary scope: Microsoft 365 modernization, Zero Trust rollout, and 24/7 SOC.",
    nextStep: "Submit revised pricing & SoW v2 by Fri",
    nextStepDue: "2026-05-15",
    competitors: ["Accenture","DXC","Local incumbent"],
    activeSince: "2026-01-12",
    employees: "2,500+",
    revenue: "$1.2B CAD",
    devices: 1842,
    projects: 5,
    deals: 2,
  },
  {
    id: "OP-2042", code: "OP-2042",
    name: "Logistec Corporation — SOC 2 Readiness",
    customer: "Logistec Corporation", customerInitials: "LG",
    industry: "Transportation", size: "Mid-market · 800", location: "Montréal, Canada",
    website: "logistec.com",
    type: "Direct deal",
    stage: "discovery",
    value: 320_000, currency: "USD", probability: 35,
    closeDate: "2026-08-15", deadline: "2026-06-12",
    health: 58,
    owner: "Mark Thompson", ownerInitials: "MT",
    team: ["MT","SB"],
    tags: ["Compliance","Security"],
    summary: "Compliance acceleration package. Customer needs SOC 2 Type II in 9 months ahead of an enterprise contract win.",
    nextStep: "Workshop with their CISO",
    nextStepDue: "2026-05-20",
    competitors: ["Big-4 Advisory"],
  },
  {
    id: "OP-2043", code: "OP-2043",
    name: "Rush University — EHR Cloud Migration",
    customer: "Rush University System for Health", customerInitials: "RU",
    industry: "Healthcare", size: "Enterprise · 6,200", location: "Chicago, IL",
    website: "rush.edu",
    type: "RFP",
    stage: "negotiation",
    value: 4_800_000, currency: "USD", probability: 78,
    closeDate: "2026-06-30", deadline: "2026-05-12",
    health: 81,
    owner: "Jane Smith", ownerInitials: "JS",
    team: ["JS","DL","SB","MJ","RH"],
    tags: ["Cloud","Healthcare","Migration"],
    summary: "Lift-and-shift Epic environment from on-prem to Azure with disaster recovery in a second region.",
    nextStep: "Final commercial review",
    nextStepDue: "2026-05-12",
    competitors: ["Deloitte","HCL"],
  },
  {
    id: "OP-2044", code: "OP-2044",
    name: "MAPFRE — Identity & Access Overhaul",
    customer: "MAPFRE", customerInitials: "MP",
    industry: "Insurance", size: "Enterprise · 4,000", location: "Madrid, Spain",
    website: "mapfre.com",
    type: "RFI",
    stage: "qualifying",
    value: 680_000, currency: "EUR", probability: 20,
    closeDate: "2026-09-30", deadline: "2026-07-08",
    health: 45,
    owner: "Sarah Bennett", ownerInitials: "SB",
    team: ["SB","DL"],
    tags: ["IAM","Security"],
    summary: "RFI for full IAM modernization — replace homegrown SSO, integrate with Okta or Entra ID, MFA across all apps.",
    nextStep: "Confirm budget owner",
    nextStepDue: "2026-05-23",
    competitors: ["PwC"],
  },
  {
    id: "OP-2045", code: "OP-2045",
    name: "MAHLE — OT/IT Convergence",
    customer: "MAHLE", customerInitials: "MH",
    industry: "Manufacturing", size: "Enterprise · 12,000", location: "Stuttgart, Germany",
    website: "mahle.com",
    type: "RFP",
    stage: "proposal",
    value: 2_150_000, currency: "EUR", probability: 55,
    closeDate: "2026-08-01", deadline: "2026-05-30",
    health: 68,
    owner: "David Lee", ownerInitials: "DL",
    team: ["DL","JS","MT"],
    tags: ["OT Security","Network","Industrial"],
    summary: "OT/IT convergence across 22 plants, network segmentation, and central monitoring.",
    nextStep: "On-site assessment Plant 4",
    nextStepDue: "2026-05-21",
    competitors: ["Capgemini","Atos"],
  },
  {
    id: "OP-2046", code: "OP-2046",
    name: "Aritzia — Endpoint Refresh",
    customer: "Aritzia", customerInitials: "AZ",
    industry: "Retail", size: "Mid-market · 1,200", location: "Vancouver, Canada",
    website: "aritzia.com",
    type: "Direct deal",
    stage: "won",
    value: 410_000, currency: "USD", probability: 100,
    closeDate: "2026-04-28", deadline: "2026-04-28",
    health: 90,
    owner: "Mark Thompson", ownerInitials: "MT",
    team: ["MT","DL"],
    tags: ["Endpoints"],
    summary: "1,200-device Windows 11 + Intune rollout, three-year ESS.",
    nextStep: "Schedule kickoff",
    nextStepDue: "2026-05-12",
    competitors: [],
  },
  {
    id: "OP-2047", code: "OP-2047",
    name: "NOS — SOC build-out",
    customer: "NOS", customerInitials: "NS",
    industry: "Telecom", size: "Enterprise · 9,000", location: "Lisbon, Portugal",
    website: "nos.pt",
    type: "RFP",
    stage: "lost",
    value: 1_900_000, currency: "EUR", probability: 0,
    closeDate: "2026-04-12", deadline: "2026-03-30",
    health: 30,
    owner: "Sarah Bennett", ownerInitials: "SB",
    team: ["SB","JS"],
    tags: ["SOC","Security"],
    summary: "24/7 SOC and managed XDR. Lost on price.",
    nextStep: "—",
    nextStepDue: null,
    competitors: ["NTT DATA"],
  },
  {
    id: "OP-2048", code: "OP-2048",
    name: "DNB Bank — Cloud landing zone",
    customer: "DNB Bank", customerInitials: "DN",
    industry: "Financial Services", size: "Enterprise · 3,400", location: "Oslo, Norway",
    website: "dnb.no",
    type: "RFP",
    stage: "discovery",
    value: 2_700_000, currency: "EUR", probability: 40,
    closeDate: "2026-09-15", deadline: "2026-06-30",
    health: 62,
    owner: "Jane Smith", ownerInitials: "JS",
    team: ["JS","DL","SB"],
    tags: ["Cloud","Banking","Migration"],
    summary: "Greenfield Azure landing zone for retail banking apps. Regulatory scope: NIS2, DORA.",
    nextStep: "Architecture workshop",
    nextStepDue: "2026-05-19",
    competitors: ["EY","KPMG"],
  },
];

window.CONTACTS = [
  { id:"c1", name:"Michael Johnson",  initials:"MJ", role:"Chief Information Officer",     customer:"CI Financial",      email:"mjohnson@ci.com",      phone:"+1 416 555 0142", linkedin:"#", influence:"Decision maker", lastTouch:"3 days ago" },
  { id:"c2", name:"Sarah Patel",      initials:"SP", role:"IT Security Manager",           customer:"CI Financial",      email:"spatel@ci.com",        phone:"+1 416 555 0119", linkedin:"#", influence:"Champion",      lastTouch:"1 day ago" },
  { id:"c3", name:"David Liang",      initials:"DL", role:"Infrastructure Director",       customer:"CI Financial",      email:"dliang@ci.com",        phone:"+1 416 555 0173", linkedin:"#", influence:"Influencer",    lastTouch:"6 days ago" },
  { id:"c4", name:"Helena Voss",      initials:"HV", role:"CISO",                          customer:"Logistec Corporation",       email:"h.voss@logistec.com",      phone:"+1 514 555 0167", linkedin:"#", influence:"Decision maker", lastTouch:"2 days ago" },
  { id:"c5", name:"Anil Rajan",       initials:"AR", role:"VP Technology",                 customer:"Rush University System for Health", email:"arajan@rush.edu", phone:"+1 312 555 0190", linkedin:"#", influence:"Decision maker", lastTouch:"Today" },
  { id:"c6", name:"Carmen López",     initials:"CL", role:"Identity Architect",            customer:"MAPFRE",       email:"c.lopez@mapfre.com",     phone:"+34 91 555 0123", linkedin:"#", influence:"Champion",      lastTouch:"5 days ago" },
  { id:"c7", name:"Heinrich Müller",  initials:"HM", role:"Head of Plant IT",              customer:"MAHLE",      email:"h.mueller@mahle.com",      phone:"+49 711 555 0145", linkedin:"#", influence:"Champion",      lastTouch:"1 day ago" },
  { id:"c8", name:"Olivia Reyes",     initials:"OR", role:"VP Operations",                 customer:"Aritzia",           email:"o.reyes@aritzia.com",    phone:"+1 604 555 0188", linkedin:"#", influence:"Decision maker", lastTouch:"4 days ago" },
];

window.TASKS = [
  { id:"t1", title:"Submit revised pricing & SoW v2",       opp:"OP-2041", due:"2026-05-15", priority:"High",   status:"In progress", owner:"JS" },
  { id:"t2", title:"Workshop with Logistec CISO",          opp:"OP-2042", due:"2026-05-20", priority:"High",   status:"Scheduled",   owner:"MT" },
  { id:"t3", title:"Final commercial review — Rush University",  opp:"OP-2043", due:"2026-05-12", priority:"Critical",status:"In progress", owner:"JS" },
  { id:"t4", title:"On-site assessment MAHLE Plant 4",     opp:"OP-2045", due:"2026-05-21", priority:"Medium", status:"Scheduled",   owner:"DL" },
  { id:"t5", title:"Confirm MAPFRE budget owner",        opp:"OP-2044", due:"2026-05-23", priority:"Medium", status:"Open",        owner:"SB" },
  { id:"t6", title:"Schedule Aritzia kickoff",             opp:"OP-2046", due:"2026-05-12", priority:"Low",    status:"Open",        owner:"MT" },
  { id:"t7", title:"Architecture workshop — DNB",       opp:"OP-2048", due:"2026-05-19", priority:"High",   status:"Scheduled",   owner:"JS" },
  { id:"t8", title:"Prepare RFI response MAPFRE",        opp:"OP-2044", due:"2026-05-26", priority:"Medium", status:"Open",        owner:"SB" },
];

window.ACTIVITY = [
  { kind:"sparkle", tone:"info",    text:"Dust agent drafted **executive summary** for Acme Financial proposal", meta:"2 hours ago by Dust agent" },
  { kind:"files",   tone:"orange",  text:"New SoW **\"CI Financial MSP — v2\"** uploaded",                              meta:"4 hours ago by Jane Smith" },
  { kind:"shield",  tone:"success", text:"Rush University security questionnaire approved",                          meta:"1 day ago by Sarah Bennett" },
  { kind:"link",    tone:"info",    text:"Salesforce account **DNB Bank** linked to OP-2048",              meta:"1 day ago via Dust webhook" },
  { kind:"sparkle", tone:"info",    text:"Dust agent flagged **pricing risk** on MAHLE bid",                    meta:"2 days ago by Dust agent" },
  { kind:"warning", tone:"orange",  text:"MAPFRE RFI deadline moved to **Jul 8**",                            meta:"3 days ago by Mark Thompson" },
];

window.WEBHOOK_EVENTS = [
  { id:"e1", at:"14:32", type:"opportunity.updated", source:"Dust", oppId:"OP-2041", payload:{ field:"value", from:1180000, to:1240000 }, status:"ok" },
  { id:"e2", at:"14:28", type:"agent.completion",    source:"Dust", oppId:"OP-2041", payload:{ artifact:"executive_summary", tokens: 1843 }, status:"ok" },
  { id:"e3", at:"13:55", type:"contact.created",     source:"Dust", oppId:"OP-2048", payload:{ name:"Erika Solberg" }, status:"ok" },
  { id:"e4", at:"13:14", type:"opportunity.note",    source:"Dust", oppId:"OP-2045", payload:{ note:"Pricing risk flagged" }, status:"ok" },
  { id:"e5", at:"12:01", type:"document.indexed",    source:"Dust", oppId:"OP-2043", payload:{ docs: 14 }, status:"ok" },
  { id:"e6", at:"10:42", type:"opportunity.stage",   source:"Dust", oppId:"OP-2046", payload:{ from:"negotiation", to:"won" }, status:"ok" },
  { id:"e7", at:"09:15", type:"sync.error",          source:"Dust", oppId:null,      payload:{ message:"401 token expired" }, status:"err" },
  { id:"e8", at:"08:50", type:"sync.completed",      source:"Dust", oppId:null,      payload:{ records: 412 }, status:"ok" },
];

window.SYNC_LOG = [
  { at:"Just now",   ok:true,  text:"Pulled 412 records from Dust workspace mantu-presales" },
  { at:"15 min ago", ok:true,  text:"Pushed 6 opportunity updates to Dust" },
  { id:"3", at:"1 hr ago",  ok:true,  text:"Webhook delivered: opportunity.updated × 4" },
  { id:"4", at:"2 hr ago",  ok:false, text:"Auth refresh failed — token rotated automatically" },
  { id:"5", at:"4 hr ago",  ok:true,  text:"Pulled 38 records from Dust" },
  { id:"6", at:"Yesterday", ok:true,  text:"Daily delta sync completed: 218 records" },
];

window.TEAM = [
  { id:"u1", name:"Jane Smith",     initials:"JS", role:"Admin",          email:"jane.smith@mantu.com",   department:"Presales",      lastSeen:"online", oppCount: 4 },
  { id:"u2", name:"Mark Thompson",  initials:"MT", role:"Bid manager",    email:"mark.t@mantu.com",       department:"Presales",      lastSeen:"online", oppCount: 3 },
  { id:"u3", name:"Sarah Bennett",  initials:"SB", role:"Solution arch.", email:"sarah.b@mantu.com",      department:"Pre-sales eng.", lastSeen:"2h ago", oppCount: 2 },
  { id:"u4", name:"David Lee",      initials:"DL", role:"Solution arch.", email:"david.l@mantu.com",      department:"Pre-sales eng.", lastSeen:"online", oppCount: 3 },
  { id:"u5", name:"Mike Johnson",   initials:"MJ", role:"Account exec.",  email:"mike.j@mantu.com",       department:"Sales",         lastSeen:"1d ago", oppCount: 1 },
  { id:"u6", name:"Riya Hassan",    initials:"RH", role:"Account exec.",  email:"riya.h@mantu.com",       department:"Sales",         lastSeen:"online", oppCount: 0 },
  { id:"u7", name:"Léon Bertrand",  initials:"LB", role:"Viewer",         email:"leon.b@mantu.com",       department:"Finance",       lastSeen:"3d ago", oppCount: 0 },
];

window.MCP_TOOLS = [
  { name:"opportunities.list",   desc:"List opportunities with optional filters" },
  { name:"opportunities.get",    desc:"Read a single opportunity by id" },
  { name:"opportunities.update", desc:"Patch fields on an opportunity (stage, value, …)" },
  { name:"opportunities.note",   desc:"Append a note or activity entry" },
  { name:"contacts.upsert",      desc:"Create or update a contact" },
  { name:"tasks.create",         desc:"Create a follow-up task" },
  { name:"documents.search",     desc:"RAG search across SoW / RFP attachments" },
];

window.formatMoney = (v, c="USD") => {
  const sym = { USD:"$", EUR:"€", CAD:"C$", GBP:"£" }[c] || "";
  if (v >= 1_000_000) return `${sym}${(v/1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${sym}${(v/1_000).toFixed(0)}K`;
  return `${sym}${v}`;
};
window.formatDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("en-US",{ month:"short", day:"numeric", year:"numeric" });
};
window.daysUntil = (s) => {
  if (!s) return null;
  const d = new Date(s); const now = new Date();
  return Math.round((d - now) / (1000*60*60*24));
};
