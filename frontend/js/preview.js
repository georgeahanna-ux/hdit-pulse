// Preview mode only: a small in-memory stand-in for the Pulse API, so every page can be tried
// without a server. Nothing here is real HD IT data; the page says so in a banner.
import * as Auth from "./auth.js";
import { accessFor, DIVISIONS } from "./access.js";
import { weekInfo } from "./api.js";
import { projectsApi } from "./preview-projects.js";
import { l10Api } from "./preview-l10.js";

const today = () => new Date();
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return iso(new Date(Date.UTC(y, m - 1, d + n))); };
function weekOf(now = today()) {
  const syd = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
  const wd = (syd.getDay() + 6) % 7;
  return addDays(`${syd.getFullYear()}-${String(syd.getMonth() + 1).padStart(2, "0")}-${String(syd.getDate()).padStart(2, "0")}`, -wd);
}
const me = () => Auth.currentUser();
const access = () => accessFor(Auth.currentRoles());
const isMe = e => !!e && e.toLowerCase() === (me().email || "").toLowerCase();
const sees = d => access().leadership || access().ownDivisions.includes(d);
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };

/* ---------------- sample data ---------------- */
const M = (id, code, name, division, owner, unit, direction, goal, goalText, base, spread) =>
  ({ id, code, name, scope: "company", division, owner: { name: owner, email: owner.toLowerCase().replace(" ", ".") + "@hdit.com.au" }, unit, direction, goal, goalText, base, spread });
const measurables = [
  M(1, "mqls", "MQLs", "SalesMarketing", "Faben Miglani", "count", "higher", 7, "7 or more a week", 7, 4),
  M(2, "new_mrr", "New MRR signed", "SalesMarketing", "Faben Miglani", "currency", "higher", null, "Pace to $560K MRR", 6000, 5000),
  M(3, "weighted_pipeline", "Weighted pipeline (Stages 6–7)", "SalesMarketing", "Faben Miglani", "currency", "higher", null, "Set with owner", 180000, 40000),
  M(4, "new_seats", "New seats signed", "SalesMarketing", "Faben Miglani", "count", "higher", 12.5, "12.5 or more a week", 12, 9),
  M(5, "seats_serviced", "Seats serviced", "ManagedServices", "Tony Parzakonis", "count", "higher", 2350, "2,350 or more", 2210, 30),
  M(6, "sla_first_response", "SLA first response met", "ManagedServices", "Tony Parzakonis", "percent", "higher", 95, "95% or more", 94, 4),
  M(7, "tickets_per_tech", "Tickets closed per tech per day", "ManagedServices", "Tony Parzakonis", "ratio", "higher", null, "Set with owner (benchmark 10)", 7.5, 2),
  M(8, "fcr", "First-contact resolution", "ManagedServices", "Tony Parzakonis", "percent", "higher", null, "Set with owner", 62, 8),
  M(9, "utilisation", "Billable utilisation", "ManagedServices", "Tony Parzakonis", "percent", "higher", null, "Set with owner", 68, 8),
  M(10, "csat", "CSAT", "ManagedServices", "Tony Parzakonis", "percent", "higher", null, "Set with owner", 97, 3),
  M(11, "nps", "NPS (last 90 days)", "ManagedServices", "Tony Parzakonis", "score", "higher", 65, "+65 or more", 68, 10),
  M(12, "cash", "Cash on hand", "Finance", "Mandy Moujalli", "currency", "higher", null, "Set with owner", 850000, 120000),
  M(13, "dso", "Debtor days (DSO)", "Finance", "Mandy Moujalli", "days", "lower", 28, "28 or fewer", 18, 6),
  M(14, "sgm", "Services gross margin (SGM)", "Finance", "Mandy Moujalli", "percent", "higher", 45, "45% or more", 41, 5),
  M(15, "ebitda_pct", "EBITDA % (Profit)", "Finance", "Mandy Moujalli", "percent", "higher", 11, "11% or more", 10.5, 3),
];
const cells = new Map();
const rand = (a, b) => { const x = Math.sin(a * 9301 + b * 49297) * 233280; return x - Math.floor(x); };
for (const m of measurables) for (let i = 1; i <= 13; i++) {
  const w = addDays(weekOf(), -7 * i);
  const v = m.base + (rand(m.id, i) - 0.5) * m.spread;
  cells.set(`${m.id}|${w}`, { value: m.unit === "count" || m.unit === "currency" ? Math.round(v) : Math.round(v * 10) / 10, source: "entered" });
}

// Trial collectors (0.5.3, 0.6.5): worked out every hour; switched on per measurable by Leadership.
const COLLECTORS = { 1: "mroi.mqls", 2: "autotask.new_mrr", 3: "autotask.weighted_pipeline", 10: "simplesat.csat", 11: "simplesat.nps", 4: "autotask.new_seats", 5: "autotask.seats_serviced", 6: "autotask.sla_first_response", 7: "autotask.tickets_per_tech", 8: "autotask.fcr", 9: "autotask.utilisation" };
const autoOn = new Set();
const autoValue = (m, i) => { const v = m.base + (rand(m.id, i) - 0.5) * m.spread + (rand(m.id + 50, i) - 0.5) * m.spread * 0.3; return m.unit === "count" ? Math.round(v) : Math.round(v * 10) / 10; };
const autoText = (m, v) => ({
  1: n => `${Math.round(n)} opportunities reached MQL this week in Marketing ROI.`,
  2: n => `$${Math.round(n).toLocaleString("en-AU")} a month on 2 opportunities won: Acme Dental ($${Math.round(n * 0.6).toLocaleString("en-AU")}), Parra Legal ($${(Math.round(n) - Math.round(n * 0.6)).toLocaleString("en-AU")}).`,
  3: n => `$${Math.round(n).toLocaleString("en-AU")} weighted across 9 active opportunities (Stage 6: 6; Stage 7: 3). One-off revenue × probability.`,
  10: n => `${Math.round(n * 0.48)} positive of 48 CSAT ratings = ${n}%.`,
  11: n => `${Math.round(n * 0.4 + 32)} promoters and 4 detractors of 60 NPS ratings in the 90 days = +${Math.round(n)}.`,
  4: n => `${Math.round(n)} seats on 2 of 3 opportunities won: Acme Dental (${Math.round(n * 0.6)}), Parra Legal (${Math.round(n) - Math.round(n * 0.6)}).`,
  5: n => `${Math.round(n).toLocaleString("en-AU")} seats on 118 recurring contracts in force.`,
  6: n => `${Math.round(n * 1.8)} of 180 tickets had a first response in time. ${180 - Math.round(n * 1.8)} missed.`,
  7: n => `${Math.round(n * 6 * 5)} tickets completed by 6 techs over 5 working days.`,
  8: n => `${Math.round(n * 1.6)} of 160 tickets were resolved with a single time entry. 12 with no time left out.`,
  9: n => `${Math.round(n * 2.28)} billable hours of 228 available (6 techs × 5 days × 7.6 hours). 31 other hours logged.`,
})[m.id](v);
let pvCollectedAt = new Date(Date.now() - 23 * 60e3).toISOString();

// Mirrors db/migrations/0003_accountability_chart.sql (roles shortened), plus the preview people.
const H = (name, title, team) => ({ name, title, team, email: null });
const SEAT = (id, division, title, parentId, keyResult, roles, holders, apps = []) => ({ id, division, functionId: null, parentId, title, keyResult, roles, holders, apps });
const SAMPLE_SEATS = [
  SEAT(1, "Leadership", "Board of Directors", null, null, [], [H("George Hanna", "Managing Director"), H("Bernadette Hanna", "Director")]),
  SEAT(2, "Leadership", "Visionary", null, "A clear vision, with strategic direction that leads to long-term viability of the organisation.", ["New ideas and vision", "Big relationships", "Culture", "Research and development"], [H("George Hanna", "Managing Director")]),
  SEAT(3, "Leadership", "Integrator", 2, "A viable and expanding organisation.", ["Lead, manage and hold accountable (LMA)", "Special projects", "Profit and loss", "Business plan", "Harmonious integration"], [H("George Hanna", "Managing Director")]),
  SEAT(4, "Finance", "Head of Finance & Accounts", 3, "Preserved and valuable assets and resources.", ["LMA", "Financial reporting", "Asset management", "Accounts receivable", "Accounts payable", "Payroll"], [H("Mandy Moujalli", "Head of Finance & Accounts")]),
  SEAT(5, "Finance", "Office Management", 4, "An organised, clean and fully stocked office facilitating production.", ["Clean office", "Office supplies", "Events", "Reception", "Logistics"], []),
  SEAT(6, "Finance", "Accounts Administration", 4, "Accurately organised and recorded financial transactions.", ["Accounts receivable", "Accounts payable", "Invoicing", "Reconciling", "Data entry"], [H("Jordan Ledger", "Accounts Admin", "Accounts Administration")]),
  SEAT(7, "People", "Head of Human Resources", 3, "Established, productive and ethical staff.", ["LMA", "Recruitment", "Employment documents", "Policies", "Onboarding and training", "Performance management"], [H("Bernadette Hanna", "Head of Human Resources")]),
  SEAT(8, "SalesMarketing", "Head of Sales & Marketing", 3, "New client acquisitions, retention and profitable growth.", ["LMA", "Marketing plan", "Sales strategy", "Sales process", "Pre-sales", "Contract creation"], [H("Faben Miglani", "Head of Sales & Marketing")], ["pipeline", "mroi", "wspace"]),
  SEAT(9, "SalesMarketing", "Marketing", 8, "Constant and steady lead generation and brand awareness.", ["Lead generation", "Brand", "Social content", "Website", "Campaigns"], [H("Vacant", "Marketing Administrator", "Marketing")], ["mroi"]),
  SEAT(10, "SalesMarketing", "Business Development", 8, "Profitable new client sales.", ["New client sales", "Lead generation", "Campaign execution", "Opportunity management"], [H("Vacant", "BDM", "Business Development"), H("Taylor Reid", "Sales Development Rep", "Business Development")], ["pipeline", "mroi", "wspace"]),
  SEAT(11, "SalesMarketing", "Sales Administration", 8, "A supported sales team.", ["Quoting", "Process documentation", "Procurement", "Sales tools"], [H("Nour Chalouhi", "IT Sales Admin", "Sales Administration")], ["pipeline"]),
  SEAT(12, "SalesMarketing", "Account Management", 8, "Profitable client retention and growth.", ["Strategic business reviews", "Opportunity management", "Retention and renewal"], [H("Omotayo Aweda", "Account Manager", "Account Management")], ["pipeline", "wspace"]),
  SEAT(13, "InnovationCompliance", "Head of Innovation & Compliance", 3, "Software systems that support the efficient delivery of services.", ["LMA", "Process improvement", "Automation and integration"], [H("Bernadette Hanna", "Head of Innovation & Compliance")]),
  SEAT(14, "InnovationCompliance", "DevOps", 13, "Effective optimisations that streamline processes and enhance productivity.", ["Strategic delivery of optimisations", "Support internal systems"], [H("Hayden Hartley", "DevOps Engineer", "DevOps")]),
  SEAT(15, "InnovationCompliance", "Compliance", 13, "Sustained ISO compliance and risk control.", ["ISO framework ownership", "Risk management", "Internal audit", "Corrective actions"], [H("ISO365", "Virtual Compliance Officers", "Compliance")]),
  SEAT(16, "ManagedServices", "Head of Managed Services", 3, "Effective and efficient delivery of services resulting in satisfied clients.", ["LMA", "Delivery of service", "Delivery of projects", "Change management", "Customer satisfaction"], [H("Tony Parzakonis", "Head of Managed Services")]),
  SEAT(17, "ManagedServices", "Service Team Leadership", 16, "A productive and efficient service team.", ["Team leadership", "Dispatching and scheduling", "SLA adherence", "Queue management", "Escalations"], [H("Ragavendran Kannan", "Service Team Lead", "Service Desk"), H("Tony Parzakonis", "Field Services Team Lead", "Field Services"), H("Tony Parzakonis", "NOC Team Lead", "NOC")]),
  SEAT(18, "ManagedServices", "Projects Team Leadership", 16, "Projects delivered within budget, schedule and scope.", ["Project delivery oversight", "Co-ordination", "Reporting"], []),
  SEAT(19, "ManagedServices", "Client Success", 16, "Extremely satisfied clients with high client retention.", ["Client communication", "Client education", "Client reviews", "Retention"], []),
  SEAT(20, "ManagedServices", "Service Admin", 16, "An administratively supported and efficient service delivery team.", ["On-site scheduling", "On-call roster", "Internal assets"], [H("Nathan Tang", "IT Administrator", "Service Admin")]),
  SEAT(21, "ManagedServices", "NOC", 16, "Client systems and networks proactively maintained.", ["Change requests", "Backup and alert monitoring", "Patching", "Networking"], [H("Rinus Besselaar", "NOC Engineer", "NOC (South Africa)"), H("Alex Abbas", "NOC Engineer", "NOC (India)")]),
  SEAT(22, "ManagedServices", "Service Teams", 17, "Requests resolved in an effective and efficient manner.", ["Level 1/2/3 support", "Server support", "Change requests", "Customer service", "SLA adherence"],
    [H("Daniel Tousi", "Senior Solutions Engineer", "Service Desk"), H("Jacob McCredie", "Senior Solutions Engineer", "Service Desk"), H("Riley Tech", "Service Desk Engineer", "Service Desk"),
     H("Abiy Amdemariam", "Senior Service Desk Engineer", "Field Services"), H("Michael Baltagi", "Service Desk Engineer", "Field Services")]),
  SEAT(23, "ManagedServices", "Projects Teams", 18, "Projects executed to meet quality, budget, schedule and scope targets.", ["Project scoping", "Project execution and delivery"], []),
];
const SUMMARY = { Leadership: "A clear vision and a viable, expanding organisation.", Finance: "Preserved and valuable assets and resources.", People: "Established, productive and ethical staff.",
  SalesMarketing: "New client acquisitions, retention and profitable growth.", InnovationCompliance: "Software systems that support the efficient delivery of services.", ManagedServices: "Effective and efficient delivery of services resulting in satisfied clients." };
const nameIsMe = n => !!n && n.toLowerCase() === (me().name || "").toLowerCase();
const FUNCTIONS = {};
let fid = 0;
const functions = Object.fromEntries(DIVISIONS.map(d => [d.code, (FUNCTIONS[d.code] || []).map(name => ({ id: ++fid, name }))]));

let nextId = 100;
const rocks = [
  { id: 1, level: "company", division: null, title: "Reach 2,300 seats serviced", owner: { name: "Tony Parzakonis", email: "tony.parzakonis@hdit.com.au" }, status: "on_track", milestones: [{ id: 1, title: "Onboard three new clients", done: true }, { id: 2, title: "Close two renewals with seat growth", done: false }] },
  { id: 2, level: "company", division: null, title: "Pulse release 1 live for the leadership team", owner: { name: "George Hanna", email: "george.hanna@hdit.com.au" }, status: "on_track", milestones: [] },
  { id: 3, level: "company", division: null, title: "Debtor days under 20 every week", owner: { name: "Mandy Moujalli", email: "mandy.moujalli@hdit.com.au" }, status: "off_track", milestones: [] },
  { id: 4, level: "division", division: "ManagedServices", title: "First-contact resolution to 70%", owner: { name: "Ragav Kannan", email: "ragav.kannan@hdit.com.au" }, status: "on_track", milestones: [] },
];
const issues = [
  { id: 1, level: "company", division: null, title: "Technician utilisation below 70% three weeks running", owner: { name: "Tony Parzakonis" }, raisedBy: "Sam Leader", priority: 1, status: "open" },
  { id: 2, level: "company", division: null, title: "Quarter targets for FY27 not yet set", owner: { name: "Mandy Moujalli" }, raisedBy: "George Hanna", priority: 2, status: "open" },
  { id: 3, level: "division", division: "ManagedServices", title: "After-hours escalations not reaching the on-call engineer", owner: null, raisedBy: "Riley Tech", priority: null, status: "open" },
];
const todos = [
  { id: 1, level: "company", title: "Send the FY27 quarter targets to Finance", owner: { name: "George Hanna", email: "george.hanna@hdit.com.au" }, dueDate: addDays(iso(today()), 3), done: false },
  { id: 2, level: "company", title: "Review SLA breaches with the service team", owner: { name: "Tony Parzakonis", email: "tony.parzakonis@hdit.com.au" }, dueDate: addDays(iso(today()), -1), done: false },
  { id: 3, level: "individual", title: "Book quarterly conversations", owner: { name: "Riley Tech", email: "riley.tech@hdit.com.au" }, dueDate: addDays(iso(today()), 5), done: false },
];
const vto = [["core_values", "Core values"], ["core_focus", "Core focus"], ["ten_year_target", "10-year target"], ["marketing_strategy", "Marketing strategy"],
  ["three_year_picture", "3-year picture"], ["one_year_plan", "1-year plan"], ["quarterly_rocks", "Quarterly Rocks"], ["issues_list", "Long-term issues"]]
  .map(([key, title]) => ({ key, title, content: key === "one_year_plan" ? "Revenue $9.2M\nProfit 11%\nMRR $560K\nSeats 2,350\nNew seats 650\nNPS +65" : key === "core_values" ? "(Preview: enter the V/TO here)" : "" }));
const plan = [
  { id: 1, code: "revenue", name: "Revenue", unit: "currency", kind: "cumulative", target: 9200000, opening: null, months: { "2026-07-01": 690000, "2026-08-01": 735000, "2026-09-01": 760000, "2026-10-01": 772000 }, quarters: { 1: 2200000, 2: 2300000, 3: 2300000, 4: 2400000 } },
  { id: 2, code: "mrr", name: "MRR", unit: "currency", kind: "level", target: 560000, opening: 482000, months: { "2026-07-01": 488000, "2026-08-01": 494000, "2026-09-01": 503000, "2026-10-01": 511000 }, quarters: { 1: 500000, 2: 520000, 3: 540000, 4: 560000 } },
  { id: 3, code: "seats", name: "Seats", unit: "count", kind: "level", target: 2350, opening: 2140, months: { "2026-07-01": 2152, "2026-08-01": 2170, "2026-09-01": 2196, "2026-10-01": 2214 }, quarters: { 1: 2200, 2: 2250, 3: 2300, 4: 2350 } },
  { id: 4, code: "new_seats", name: "New seats", unit: "count", kind: "cumulative", target: 650, opening: null, months: { "2026-07-01": 41, "2026-08-01": 58, "2026-09-01": 49, "2026-10-01": 52 }, quarters: { 1: 150, 2: 160, 3: 170, 4: 170 } },
];

const AT = [{ key: "username", label: "API username", secret: false, required: true }, { key: "secret", label: "API secret", secret: true, required: true }, { key: "integrationCode", label: "Tracking identifier (integration code)", secret: true, required: true }];
const C = (name, system, label, kind, fields, purpose, permissions, configured = false) => ({ name, system, label, kind, fields, purpose, permissions, configured, secretUpdatedAt: configured ? new Date(Date.now() - 6 * 864e5).toISOString() : null, updatedBy: configured ? "George Hanna" : null, owner: null, rotationDue: null, lastSuccessAt: null, lastError: null });
const previewConnections = [
  C("autotask-service", "Autotask", "Autotask", "autotask", AT, "Everything Pulse reads from or writes to Autotask: the Scorecard, the FY plan, People and departments, and Projects. Pulse limits each part to the records it needs.", "Read: tickets, time entries, contracts, opportunities, projects, tasks, resources and more. Write: resource role departments, project tasks, time entries.", true),
  C("simplesat", "SimpleSAT", "SimpleSAT", "fields", [{ key: "apiKey", label: "API key", secret: true, required: true }], "CSAT and NPS.", "Read-only API key."),
  C("xero-app", "Xero", "Xero app", "fields", [{ key: "clientId", label: "Client id", secret: false, required: true }, { key: "clientSecret", label: "Client secret", secret: true, required: true }], "Cash, debtor days, SGM, EBITDA % and revenue.", "A Xero web app with read-only scopes.", true),
  C("xero-token", "Xero", "Xero connection", "oauth", [], "Xero's refresh token, renewed automatically.", "Not entered by hand."),
  C("datto-rmm", "Datto RMM", "Datto RMM", "fields", [{ key: "apiUrl", label: "API address", secret: false, required: true }, { key: "apiKey", label: "API key", secret: false, required: true }, { key: "apiSecret", label: "API secret key", secret: true, required: true }], "Device and patch data (release 2).", "A read-only API user."),
  C("itglue", "IT Glue", "IT Glue", "fields", [{ key: "apiUrl", label: "API address", secret: false, required: true }, { key: "apiKey", label: "API key", secret: true, required: true }], "Documentation coverage (release 2).", "A read-only API key."),
];

const pvDepts = [{ id: 10, name: "Service Desk" }, { id: 11, name: "Field Services" }, { id: 12, name: "NOC" }, { id: 13, name: "Sales" }, { id: 14, name: "Administration" }, { id: 15, name: "Projects" }];
const RES = (resourceId, name, email, dept, role, title) => ({ resourceId, name, email, dept, role, title });
const pvResources = [
  RES(101, "Daniel Tousi", "daniel@hdit.com.au", 10, "Senior Engineer", "Senior Solutions Engineer"), RES(102, "Jacob McCredie", "jacob@hdit.com.au", 10, "Senior Engineer", "Senior Solutions Engineer"),
  RES(103, "Riley Tech", "riley.tech@hdit.com.au", 10, "Engineer", "Service Desk Engineer"), RES(104, "Bovorn Saysouthinh", "bovorn@hdit.com.au", 10, "Engineer", "Service Desk Engineer"),
  RES(105, "Abiy Amdemariam", "abiy@hdit.com.au", 11, "Senior Engineer", "Senior Service Desk Engineer"), RES(106, "Michael Baltagi", "michael@hdit.com.au", 11, "Engineer", "Service Desk Engineer"),
  RES(107, "Rinus Besselaar", "rinus@hdit.com.au", 12, "Engineer", "NOC Engineer"), RES(108, "Alex Abbas", "alex@hdit.com.au", 12, "Engineer", "NOC Engineer"),
  RES(109, "Taylor Reid", "taylor.reid@hdit.com.au", 13, "Sales", "Sales Development Rep"), RES(110, "Nathan Tang", "nathan@hdit.com.au", 14, "Administration", "IT Administrator"),
  RES(111, "Tony Parzakonis", "tony@hdit.com.au", 10, "Administration", "Head of Managed Services"), RES(112, "Neelima Thota", "neelima@hdit.com.au", null, null, "Service Desk Engineer"),
];
const pvPeople = [
  { id: 1, name: "George Hanna", email: "george.hanna@hdit.com.au", title: "Managing Director", link: null, none: true, signin: new Date().toISOString() },
  { id: 2, name: "Riley Tech", email: "riley.tech@hdit.com.au", title: "Service Desk Engineer", link: 103 },
  { id: 3, name: "Tony Parzakonis", email: "tony.parzakonis@hdit.com.au", title: "Head of Managed Services", link: 111, admin: true },
  { id: 4, name: "Taylor Reid", email: "taylor.reid@hdit.com.au", title: "Sales Development Rep", link: 109 },
  { id: 9, name: "Sam Leader", email: "sam.leader@hdit.com.au", title: "Director", link: null },
];

/* ---------------- progress maths (same rules as the server's logic.js) ---------------- */
const FY = 2027;
const fyMonths = () => Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2026, 6 + i, 1)); return iso(d); });
const qRange = q => { const s = [["2026-07-01", "2026-09-30"], ["2026-10-01", "2026-12-31"], ["2027-01-01", "2027-03-31"], ["2027-04-01", "2027-06-30"]][q - 1]; return { start: s[0], end: s[1] }; };
const elapsed = r => { const t = iso(today()); if (t < r.start) return 0; if (t > r.end) return 1; const d = s => Date.parse(s) / 864e5; return (d(t) - d(r.start) + 1) / (d(r.end) - d(r.start) + 1); };
const planAutoOn = new Set();
const planAuto = (m, mo) => {
  if (!["mrr", "seats", "new_seats"].includes(m.code) || mo > weekOf().slice(0, 7) + "-01") return null;
  const base = m.months[mo] ?? (m.kind === "level" ? m.months["2026-10-01"] : 50);
  return m.code === "new_seats" ? base + 2 : Math.round(base * 1.004);
};
const planAutoText = (m, v) => m.code === "mrr" ? `$${Math.round(v).toLocaleString("en-AU")} a month from 212 recurring contracts in force.` : m.code === "seats" ? `${v.toLocaleString("en-AU")} seats on 118 recurring contracts in force.` : `${v} seats on 3 of 4 opportunities won.`;
function progressOf(m) {
  const on = planAutoOn.has(m.id), col = ["mrr", "seats", "new_seats"].includes(m.code);
  const months = fyMonths().map(mo => { const auto = col ? planAuto(m, mo) : null;
    return { month: mo, value: m.months[mo] ?? (on ? auto : null), entered: m.months[mo] != null, auto, autoText: auto !== null ? planAutoText(m, auto) : null }; });
  const rep = months.filter(x => x.value !== null);
  const actual = m.kind === "cumulative" ? (rep.length ? rep.reduce((s, x) => s + x.value, 0) : null) : (rep.length ? rep[rep.length - 1].value : null);
  const progress = actual === null ? null : m.kind === "cumulative" ? actual / m.target : m.opening !== null ? (actual - m.opening) / (m.target - m.opening) : actual / m.target;
  const quarters = [1, 2, 3, 4].map(q => {
    const r = qRange(q), qm = rep.filter(x => x.month >= r.start && x.month <= r.end);
    const a = qm.length ? (m.kind === "cumulative" ? qm.reduce((s, x) => s + x.value, 0) : qm[qm.length - 1].value) : null;
    const t = m.quarters[q] ?? null;
    return { quarter: q, label: `FY27 Q${q}`, ...r, target: t, actual: a, progress: a === null || !t ? null : a / t, elapsed: elapsed(r), monthsReported: qm.length };
  });
  const total = quarters.every(q => q.target !== null) ? quarters.reduce((s, q) => s + q.target, 0) : null;
  return { id: m.id, code: m.code, name: m.name, unit: m.unit, kind: m.kind, fy: FY, label: "FY27", target: m.target, opening: m.opening, actual, progress,
    elapsed: elapsed({ start: "2026-07-01", end: "2027-06-30" }), lastMonth: rep.length ? rep[rep.length - 1].month : null, quarters, months,
    quarterTargetsTotal: total, quarterTargetsMismatch: m.kind === "cumulative" && total !== null && Math.abs(total - m.target) > 0.5, source: col ? "autotask" : "xero",
    collector: col ? "autotask." + m.code : null, automatic: col && on, trial: col && !on };
}

/* ---------------- the stand-in API ---------------- */
export function previewApi(path, method, body = {}) {
  const [p, qs] = path.split("?");
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  const a = access();

  if (p === "/structure") {
    const seats = SAMPLE_SEATS.map(s => ({ ...s, holders: s.holders.map(h => ({ ...h, isMe: nameIsMe(h.name) })), isMine: s.holders.some(h => nameIsMe(h.name)) }));
    return { divisions: DIVISIONS.map(d => ({ ...d, summary: SUMMARY[d.code], canSee: sees(d.code), isMine: a.ownDivisions.includes(d.code) || seats.some(s => s.division === d.code && s.isMine),
      functions: functions[d.code] || [], seats: seats.filter(s => s.division === d.code) })), mySeats: seats.filter(s => s.isMine).map(s => s.id), canEdit: a.leadership };
  }
  if (p === "/me/summary") {
    return {
      quarter: "FY27 Q2",
      seats: SAMPLE_SEATS.filter(s => s.holders.some(h => nameIsMe(h.name))),
      rocks: rocks.filter(r => isMe(r.owner.email)).map(r => ({ id: r.id, title: r.title, status: r.status, level: r.level })),
      todos: todos.filter(t => isMe(t.owner.email) && !t.done).map(t => ({ ...t, overdue: t.dueDate < iso(today()) })),
      measurables: measurables.filter(m => isMe(m.owner.email)).map(m => ({ id: m.id, code: m.code, name: m.name, unit: m.unit, goalText: m.goalText })),
      issues: [],
    };
  }
  if (p === "/scorecard" && method === "GET") {
    const end = weekOf(), weeks = Array.from({ length: 13 }, (_, i) => addDays(end, -7 * (12 - i)));
    const division = q.division || null;
    const list = measurables.filter(m => (division ? m.division === division : true));
    return { weeks: weeks.map(w => weekInfo(w)), scope: division ? { division } : { company: true }, collectedAt: pvCollectedAt, canRefresh: !!a.leadership,
      measurables: list.map(m => {
        const can = a.leadership || a.ownDivisions.includes(m.division);
        return { ...m, seatId: { SalesMarketing: 8, ManagedServices: 16, Finance: 4 }[m.division] || null, owner: { ...m.owner, isMe: isMe(m.owner.email) }, source: COLLECTORS[m.id] ? COLLECTORS[m.id].split(".")[0] : m.division === "Finance" ? "xero" : "autotask", automatic: autoOn.has(m.id), collector: COLLECTORS[m.id] || null, trial: !!COLLECTORS[m.id] && !autoOn.has(m.id), canOverride: can, canEdit: a.leadership || isMe(m.owner.email),
          definition: "Preview: the plain-English definition, calculation and worked example appear here.",
          cells: weeks.map(w => {
            const c = cells.get(`${m.id}|${w}`), info = weekInfo(w);
            const i = Math.round((Date.parse(end) - Date.parse(w)) / 6048e5);
            const auto = COLLECTORS[m.id] ? autoValue(m, i) : null;
            const on = autoOn.has(m.id);
            const v = c && (c.source === "override" || !on || c.source === "entered") ? c.value : on ? auto : null;
            const onTarget = v === null || m.goal === null ? null : m.direction === "lower" ? v <= m.goal : v >= m.goal;
            const overridden = c && c.source === "override";
            return { week: w, value: v, source: c && v === c.value ? c.source : v !== null ? "auto" : null, onTarget, auto, provisional: false,
              autoDetail: auto !== null ? { at: pvCollectedAt, text: autoText(m, auto) } : null,
              entered: c && c.source === "entered" ? { value: v, by: "Preview" } : null,
              override: overridden ? { value: v, reason: c.reason, by: c.by } : null,
              actions: { enter: can && !on && !info.locked && !overridden, override: can && (on || info.locked || overridden), revert: can && overridden } };
          }) };
      }) };
  }
  if (p === "/scorecard/refresh") { pvCollectedAt = new Date().toISOString(); return { ok: true, detail: "Preview: worked out again (simulated)." }; }
  const autoM = /^\/measurables\/(\d+)\/automatic$/.exec(p);
  if (autoM) {
    if (!a.leadership) fail(403, "You don't have access to that.");
    if (String(body.reason || "").trim().length < 5) fail(400, "Please give a reason (at least a few words).");
    if (body.enabled) autoOn.add(Number(autoM[1])); else autoOn.delete(Number(autoM[1]));
    return { ok: true, automatic: !!body.enabled };
  }
  if (p.startsWith("/scorecard/")) {
    const key = `${body.measurableId}|${body.week}`;
    if (p.endsWith("/enter")) cells.set(key, { value: body.value === "" ? null : Number(String(body.value).replace(/[$,%]/g, "")), source: "entered" });
    if (p.endsWith("/override")) { if (String(body.reason || "").trim().length < 5) fail(400, "Please give a reason (at least a few words)."); cells.set(key, { value: Number(String(body.value).replace(/[$,%]/g, "")), source: "override", reason: body.reason, by: me().name }); }
    if (p.endsWith("/revert")) { if (String(body.reason || "").trim().length < 5) fail(400, "Please give a reason (at least a few words)."); cells.delete(key); }
    return { ok: true };
  }
  if (p === "/rocks" && method === "GET") {
    const list = rocks.filter(r => (r.level !== "division" || sees(r.division)) && (!q.level || r.level === q.level) && (!q.division || r.division === q.division));
    return { fy: FY, quarter: 2, label: "FY27 Q2", range: qRange(2), rocks: list.map(r => ({ ...r, label: "FY27 Q2", owner: { ...r.owner, isMe: isMe(r.owner.email) }, dueDate: "2026-12-31",
      milestonesDone: r.milestones.filter(x => x.done).length, canEdit: a.leadership || isMe(r.owner.email) || (r.level === "division" && a.ownDivisions.includes(r.division)) })) };
  }
  if (p === "/rocks" && method === "POST") {
    if (body.level === "company" && !a.leadership) fail(403, "Only Leadership sets company Rocks.");
    rocks.push({ id: ++nextId, level: body.level, division: body.division || null, title: body.title, owner: { name: body.ownerName || me().name, email: body.ownerEmail || me().email }, status: "on_track", milestones: [] });
    return { id: nextId };
  }
  let mm;
  if ((mm = /^\/rocks\/(\d+)\/milestones(?:\/(\d+))?$/.exec(p))) {
    const r = rocks.find(x => x.id === Number(mm[1]));
    if (!mm[2]) r.milestones.push({ id: ++nextId, title: body.title, done: false });
    else { const m = r.milestones.find(x => x.id === Number(mm[2])); if (body.deleted) r.milestones.splice(r.milestones.indexOf(m), 1); else Object.assign(m, "done" in body ? { done: !!body.done } : {}, body.title ? { title: body.title } : {}); }
    return { ok: true };
  }
  if ((mm = /^\/rocks\/(\d+)$/.exec(p))) { const r = rocks.find(x => x.id === Number(mm[1])); if (body.status) r.status = body.status; if (body.title) r.title = body.title; if (body.archived) rocks.splice(rocks.indexOf(r), 1); return { ok: true }; }

  if (p === "/issues" && method === "GET") {
    const level = q.level || "company";
    if (level === "company" && !a.leadership) fail(403, "The company Issues List is for the leadership team.");
    return { level, issues: issues.filter(i => i.level === level && (!q.division || i.division === q.division) && (q.status === "all" || i.status === (q.status || "open"))) };
  }
  if (p === "/issues" && method === "POST") { issues.push({ id: ++nextId, level: body.level, division: body.division || null, title: body.title, owner: body.ownerName ? { name: body.ownerName } : null, raisedBy: me().name, priority: null, status: "open" }); return { id: nextId }; }
  if ((mm = /^\/issues\/(\d+)$/.exec(p))) { const i = issues.find(x => x.id === Number(mm[1])); Object.assign(i, body); if (body.status && body.status !== "open") { i.priority = null; i.closedAt = new Date().toISOString(); } return { ok: true }; }

  if (p === "/todos" && method === "GET") {
    const view = q.view || "mine";
    if (view === "company" && !a.leadership) fail(403, "Company To-dos are for the leadership team.");
    const list = todos.filter(t => (view === "mine" ? isMe(t.owner.email) : view === "company" ? t.level === "company" : t.level === "division" && t.division === q.division));
    return { view, todos: list.map(t => ({ ...t, owner: { ...t.owner, isMe: isMe(t.owner.email) }, overdue: !t.done && t.dueDate < iso(today()) })) };
  }
  if (p === "/todos" && method === "POST") { todos.push({ id: ++nextId, level: body.level || "individual", division: body.division || null, title: body.title, owner: { name: body.ownerName || me().name, email: body.ownerEmail || me().email }, dueDate: body.dueDate || addDays(iso(today()), 7), done: false, issueId: body.issueId || null, createdAt: new Date().toISOString() }); return { id: nextId }; }
  if ((mm = /^\/todos\/(\d+)$/.exec(p))) { const t = todos.find(x => x.id === Number(mm[1])); if ("done" in body) t.done = !!body.done; if (body.deleted) todos.splice(todos.indexOf(t), 1); return { ok: true }; }

  const l10 = l10Api(p, method, body, a, me(), { issues, todos, reviewWeek: addDays(weekOf(), -7), fail });
  if (l10) return l10;
  const pj = projectsApi(p, method, body, a, me());
  if (pj) return pj;
  if (p === "/people" && method === "GET") {
    if (!(a.leadership || a.manageDirectory)) fail(403, "You don't have access to that.");
    return { lastSync: { departments: new Date(Date.now() - 9 * 60e3).toISOString(), directory: new Date(Date.now() - 10 * 3600e3).toISOString() },
      people: pvPeople.map(p => { const r = pvResources.find(x => x.resourceId === p.link); const d = r && pvDepts.find(x => x.id === r.dept);
        return { id: p.id, name: p.name, email: p.email, jobTitle: p.title, lastSignIn: p.signin, autotask: r ? { resourceId: r.resourceId, name: r.name, email: r.email, active: true, department: d ? d.name : null, role: r.role, linkedBy: p.admin ? "George Hanna" : "email", matchedEmail: r.email } : null, noAutotask: p.none ? { reason: "External provider" } : null }; }),
      review: [
        { id: 1, kind: "no_match", personId: 9, personName: "Sam Leader", resourceIds: [], detail: "No active Autotask resource has sam.leader@hdit.com.au." },
        { id: 2, kind: "unlinked_account", personId: null, personName: null, resourceIds: [130], detail: "API User - Pipeline (pipeline-api@hdit.com.au) isn't linked to anyone in Pulse." },
      ] };
  }
  if (p === "/people/departments" && method === "GET") {
    if (!(a.leadership || a.manageDirectory)) fail(403, "You don't have access to that.");
    const inPulse = rid => (pvPeople.find(p => p.link === rid) || {}).name || null;
    const shape = r => ({ resourceId: r.resourceId, name: r.name, email: r.email, title: r.title, role: r.role, inPulse: inPulse(r.resourceId) });
    return { lastSync: { departments: new Date(Date.now() - 9 * 60e3).toISOString() }, roles: [{ id: 1, name: "Engineer" }, { id: 2, name: "Senior Engineer" }, { id: 3, name: "Administration" }, { id: 4, name: "Sales" }],
      departments: pvDepts.map(d => ({ ...d, active: true, isServiceDesk: d.name === "Service Desk", people: pvResources.filter(r => r.dept === d.id).map(shape) })),
      noDepartment: pvResources.filter(r => !r.dept).map(shape) };
  }
  if (p === "/people/departments/change") {
    if (!a.changeDepartments) fail(403, "You don't have access to that.");
    if (String(body.reason || "").trim().length < 5) fail(400, "Please give a reason (at least a few words).");
    for (const id of body.resourceIds) pvResources.find(r => r.resourceId === id).dept = body.departmentId;
    return { department: pvDepts.find(d => d.id === body.departmentId).name, changed: body.resourceIds.length, failed: 0, results: [] };
  }
  if (p === "/people/sync") return { ok: true, detail: "Preview: refreshed (simulated)." };
  if ((mm = /^\/people\/(\d+)\/link$/.exec(p))) {
    const person = pvPeople.find(x => x.id === Number(mm[1]));
    if (String(body.reason || "").trim().length < 5) fail(400, "Please give a reason (at least a few words).");
    Object.assign(person, body.none ? { link: null, none: true } : body.automatic ? { admin: false } : { link: body.resourceId, admin: true, none: false });
    return { ok: true };
  }
  if (p === "/connections" && method === "GET") return { connections: previewConnections, xero: { organisation: null, redirectUri: "https://func-hdit-pulse-sync-test-aue.azurewebsites.net/api/xero/callback" } };
  if (p === "/xero/start") return { url: "#/connections?xero=connected" };
  if ((mm = /^\/connections\/([a-z-]+)$/.exec(p))) {
    const c = previewConnections.find(x => x.name === mm[1]);
    if (method === "DELETE") { c.configured = false; return { ok: true }; }
    if (method === "PATCH") { c.owner = body.owner || null; c.rotationDue = body.rotationDue || null; return { ok: true }; }
    if (c.configured && String(body.reason || "").trim().length < 5) fail(400, "Please give a reason for replacing this credential.");
    Object.assign(c, { configured: true, secretUpdatedAt: new Date().toISOString(), updatedBy: me().name, owner: body.owner || c.owner, rotationDue: body.rotationDue || c.rotationDue });
    return { ok: true, tested: c.kind === "autotask", note: c.kind === "autotask" ? "Preview: signed in to Autotask (simulated)." : "Saved (preview)." };
  }
  if (p === "/vto" && method === "GET") return { sections: vto };
  if ((mm = /^\/vto\/([a-z_]+)$/.exec(p))) { if (!a.leadership) fail(403, "Only Leadership edits the V/TO."); vto.find(s => s.key === mm[1]).content = body.content; return { ok: true }; }

  if (p === "/plan" && method === "GET") {
    if (!(a.leadership || a.financeDetail || a.ownDivisions.includes("Finance"))) fail(403, "You don't have access to that.");
    return { fy: FY, label: "FY27", range: { start: "2026-07-01", end: "2027-06-30" }, current: { fy: 2027, quarter: 2 }, canEditTargets: a.leadership, canEnter: a.leadership || a.ownDivisions.includes("Finance"), metrics: plan.map(progressOf) };
  }
  if ((mm = /^\/plan\/metrics\/(\d+)\/automatic$/.exec(p))) {
    if (String(body.reason || "").trim().length < 5) fail(400, "Please give a reason (at least a few words).");
    if (body.enabled) planAutoOn.add(Number(mm[1])); else planAutoOn.delete(Number(mm[1]));
    return { ok: true };
  }
  if ((mm = /^\/plan\/metrics\/(\d+)(?:\/(quarters|months)\/([\d-]+))?$/.exec(p))) {
    const m = plan.find(x => x.id === Number(mm[1]));
    const n = v => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(/[$,]/g, "")));
    if (!mm[2]) { if ("annualTarget" in body) m.target = n(body.annualTarget); if ("openingValue" in body) m.opening = n(body.openingValue); }
    else if (mm[2] === "quarters") m.quarters[mm[3]] = n(body.target);
    else { const k = `${mm[3]}-01`; if (m.months[k] != null && String(body.reason || "").trim().length < 5) fail(400, "Please give a reason (at least a few words). It's kept in the audit log."); m.months[k] = n(body.value); }
    return { ok: true };
  }
  return null;
}
