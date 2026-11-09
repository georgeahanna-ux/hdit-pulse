// Preview stand-in for the Projects API (D21): sample clients, projects, phases, tasks and
// dependencies laid out around today, so the Gantt charts can be tried without Autotask.
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return iso(new Date(Date.UTC(y, m - 1, d + n))); };
const dow = s => new Date(s + "T00:00:00Z").getUTCDay();
const work = s => dow(s) !== 0 && dow(s) !== 6;
const nextWork = s => { let c = s; while (!work(c)) c = addDays(c, 1); return c; };
const addWork = (s, n) => { let c = s, k = Math.abs(n), st = n < 0 ? -1 : 1; while (k > 0) { c = addDays(c, st); if (work(c)) k--; } return c; };
const workdays = (a, b) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (work(d)) n++; return n; };
const sydToday = () => { const s = new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" })); return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`; };

export const PEOPLE = [
  { id: 101, name: "Daniel Tousi", email: "daniel@hdit.com.au", department: "Projects" },
  { id: 102, name: "Jacob McCredie", email: "jacob@hdit.com.au", department: "Projects" },
  { id: 103, name: "Riley Tech", email: "riley.tech@hdit.com.au", department: "Service Desk" },
  { id: 105, name: "Abiy Amdemariam", email: "abiy@hdit.com.au", department: "Field Services" },
  { id: 106, name: "Michael Baltagi", email: "michael@hdit.com.au", department: "Field Services" },
  { id: 107, name: "Rinus Besselaar", email: "rinus@hdit.com.au", department: "NOC" },
  { id: 120, name: "Priya Projects", email: "priya.projects@hdit.com.au", department: "Projects" },
];

// [phase, [title, working days, hours, resource, parallel?]]
const TEMPLATES = {
  m365: [["Discovery", [["Kick-off meeting", 1, 2, 120], ["Tenant and mailbox audit", 3, 12, 101]]],
    ["Build", [["Configure tenant and security baseline", 4, 20, 101], ["Intune enrolment profiles", 3, 12, 102, true], ["Pilot group migration", 2, 8, 101]]],
    ["Migrate", [["Mailbox migration waves", 5, 24, 102], ["OneDrive and SharePoint migration", 4, 18, 101], ["Cutover weekend", 1, 10, 102]]],
    ["Close", [["Hypercare", 5, 10, 103], ["Handover to Service Desk", 1, 3, 120], ["Project complete", 0, 0, 120]]]],
  server: [["Plan", [["Site survey", 1, 4, 105], ["Design and order hardware", 2, 6, 101]]],
    ["Build", [["Rack and cable new host", 2, 10, 105], ["Install hypervisor and backup", 3, 14, 101], ["Migrate virtual machines", 3, 16, 101]]],
    ["Close", [["Decommission old server", 1, 5, 106], ["Documentation in IT Glue", 1, 4, 101, true], ["Sign-off", 0, 0, 120]]]],
  network: [["Plan", [["Wi-Fi heat map", 2, 8, 106], ["Network design", 2, 10, 102]]],
    ["Deploy", [["Install switches", 2, 12, 106], ["Install access points", 3, 14, 105, true], ["Firewall cutover", 1, 6, 102]]],
    ["Close", [["Monitoring in Datto RMM", 1, 3, 107], ["Network go-live", 0, 0, 120]]]],
  move: [["Prepare", [["Office move plan", 2, 6, 120], ["NBN and phones ordered", 1, 2, 120, true]]],
    ["Move", [["Pack and label equipment", 1, 8, 105], ["Move weekend: rebuild desks", 2, 24, 106], ["Test every desk", 1, 8, 105]]],
    ["Close", [["Move complete", 0, 0, 120]]]],
};

// [id, client id, client, name, template, start offset (working days from this Monday), number, lead, slip]
const PROJECTS = [
  [501, 11, "Acme Dental", "Microsoft 365 migration", "m365", -18, "P20261003", 120, 0],
  [502, 11, "Acme Dental", "Office move to Parramatta", "move", 22, "P20261021", 120, 0],
  [503, 12, "Bellview Legal", "Server replacement", "server", -12, "P20261007", 120, 3],
  [504, 12, "Bellview Legal", "Network refresh", "network", 6, "P20261015", 120, 0],
  [505, 13, "Coastline Accounting", "Microsoft 365 migration", "m365", 4, "P20261018", 120, 0],
  [506, 14, "Dural Physio", "Network refresh", "network", -9, "P20261009", 120, 1],
  [507, 15, "Eastwood Engineering", "Server replacement", "server", 12, "P20261024", 120, 0],
  [508, 16, "Fairfield Community Health", "Microsoft 365 migration", "m365", -30, "P20260911", 120, 0],
  [509, 16, "Fairfield Community Health", "Office move", "move", -4, "P20261012", 120, 0],
];

let built = null;
function build() {
  const today = sydToday();
  const mon = addDays(today, -((dow(today) + 6) % 7));
  const projects = [], tasks = [], phases = [], links = [];
  let tid = 9000, phid = 700, lid = 1;
  for (const [id, cid, client, name, tpl, off, number, lead, slip] of PROJECTS) {
    let cursor = off >= 0 ? addWork(mon, off) : addWork(mon, off);
    let prev = null;
    TEMPLATES[tpl].forEach(([title, list], pi) => {
      const ph = { id: ++phid, projectId: id, title, sort: pi + 1 };
      phases.push(ph);
      let chainEnd = null, parallelFrom = null;
      for (const [t, days, hours, res, parallel] of list) {
        const start = nextWork(parallel && parallelFrom ? parallelFrom : cursor);
        const end = days ? addWork(start, days - 1) : start;
        const task = { id: ++tid, projectId: id, phaseId: ph.id, title: t, number: `T${tid}`, start, end, estimated: hours || 0, resource: res, role: null, secondary: [] };
        // progress relative to today, with "slip" days of lateness on some projects
        const late = slip && end < today && end >= addWork(today, -slip - 3);
        task.complete = end < today && !late;
        const span = Math.max(1, workdays(start, end));
        const done = task.complete ? 1 : start > today ? 0 : Math.min(0.9, workdays(start, today) / span * (slip ? 0.6 : 1));
        task.worked = Math.round(hours * done * 10) / 10;
        task.remaining = task.complete ? 0 : Math.round((hours - task.worked) * 10) / 10;
        if (prev && !parallel) links.push({ id: lid++, pred: prev.id, succ: task.id, lag: 0 });
        if (parallel && parallelFrom && prev) links.push({ id: lid++, pred: prev.id, succ: task.id, lag: 0 });
        task.critical = !parallel;
        tasks.push(task);
        if (!parallel) { parallelFrom = start; cursor = addWork(end, 1); prev = task; chainEnd = end; }
        if (days === 0) cursor = addWork(start, 0);
      }
    });
    // A parallel task feeds the next main task too.
    projects.push({ id, companyId: cid, company: client, name, number, lead, type: "Client", status: "In progress" });
  }
  for (const t of tasks.filter(x => !x.critical)) {
    const after = links.find(l => l.pred === t.id);
    if (!after) { const nxt = tasks.find(x => x.projectId === t.projectId && x.critical && x.start > t.end); if (nxt) links.push({ id: lid++, pred: t.id, succ: nxt.id, lag: 0 }); }
  }
  built = { today, projects, tasks, phases, links, baselines: new Map() };
  // Baselines: a couple of projects saved earlier, before their slip.
  for (const t of tasks.filter(x => [503, 506].includes(x.projectId))) built.baselines.set(t.id, { start: addWork(t.start, -2), end: addWork(t.end, -2) });
  return built;
}

const pct = ts => { const w = ts.reduce((s, t) => s + t.worked, 0), r = ts.reduce((s, t) => s + (t.complete ? 0 : t.remaining), 0); return w + r ? Math.round(100 * w / (w + r)) : 0; };
function health(start, end, p, ts, today) {
  if (ts.length && ts.every(t => t.complete)) return "done";
  if (end < today) return "late";
  if (start > today) return "not-started";
  const el = Math.round(100 * workdays(start, today) / Math.max(1, workdays(start, end)));
  return ts.some(t => !t.complete && t.end < today) || p + 15 < el ? "at-risk" : "on-track";
}
const span = ts => { const d = ts.flatMap(t => [t.start, t.end]).sort(); return [d[0], d[d.length - 1]]; };
const name = id => (PEOPLE.find(p => p.id === id) || { name: `Resource ${id}` }).name;

export function projectsApi(p, method, body, a, me) {
  if (!p.startsWith("/projects")) return null;
  if (!a.viewProjects) { const e = new Error("You don't have access to that."); e.status = 403; throw e; }
  const d = built || build();
  const today = d.today;
  if (p === "/projects/refresh") return { ok: true, detail: "Preview: re-read (simulated)." };
  if (p === "/projects" && method === "GET") {
    const clients = new Map();
    const all = [];
    for (const pr of d.projects) {
      const ts = d.tasks.filter(t => t.projectId === pr.id);
      const [s, e] = span(ts), pc = pct(ts);
      const open = ts.filter(t => !t.complete);
      const summary = { id: pr.id, name: pr.name, number: pr.number, companyId: pr.companyId, company: pr.company, status: pr.status, type: pr.type, start: s, end: e, pct: pc,
        health: health(s, e, pc, ts, today), lead: name(pr.lead), tasks: ts.length, done: ts.length - open.length, overdue: open.filter(t => t.end < today).length,
        remainingHours: Math.round(open.reduce((x, t) => x + t.remaining, 0) * 10) / 10,
        next: (open.filter(t => t.end >= today).sort((x, y) => x.end.localeCompare(y.end))[0] || null),
        phases: d.phases.filter(ph => ph.projectId === pr.id).map(ph => { const pts = ts.filter(t => t.phaseId === ph.id); const [ps, pe] = span(pts); const pp = pct(pts);
          return { id: ph.id, title: ph.title, start: ps, end: pe, pct: pp, health: health(ps, pe, pp, pts, today), sort: ph.sort }; }) };
      all.push(summary);
      (clients.get(pr.companyId) || clients.set(pr.companyId, { id: pr.companyId, name: pr.company, projects: [] }).get(pr.companyId)).projects.push(summary);
    }
    const days = all.flatMap(x => [x.start, x.end]).sort();
    return { today, lastSync: new Date(Date.now() - 6 * 60e3).toISOString(), clients: [...clients.values()].sort((x, y) => x.name.localeCompare(y.name)),
      range: { start: days[0], end: days[days.length - 1] },
      totals: { projects: all.length, late: all.filter(x => x.health === "late").length, atRisk: all.filter(x => x.health === "at-risk").length, remainingHours: Math.round(all.reduce((s, x) => s + x.remainingHours, 0)) },
      can: { reschedule: !!a.editSchedules } };
  }
  const m = /^\/projects\/(\d+)$/.exec(p);
  if (m && method === "GET") {
    const pr = d.projects.find(x => x.id === Number(m[1]));
    if (!pr) { const e = new Error("That project isn't in Pulse."); e.status = 404; throw e; }
    const ts = d.tasks.filter(t => t.projectId === pr.id);
    const [s, e] = span(ts), pc = pct(ts);
    const mine = PEOPLE.find(x => x.email === (me.email || "").toLowerCase());
    return { today, lastSync: new Date(Date.now() - 6 * 60e3).toISOString(),
      project: { id: pr.id, name: pr.name, number: pr.number, company: pr.company, status: pr.status, type: pr.type, start: s, end: e, pct: pc, health: health(s, e, pc, ts, today), lead: name(pr.lead),
        baseline: [503, 506].includes(pr.id) ? { savedAt: new Date(Date.now() - 20 * 864e5).toISOString(), savedBy: "Priya Projects" } : null },
      phases: d.phases.filter(ph => ph.projectId === pr.id).map(ph => ({ id: ph.id, parentId: null, title: ph.title, start: null, end: null, sort: ph.sort })),
      tasks: ts.map(t => ({ ...t, float: t.critical ? 0 : 2, critical: t.critical && !t.complete, roleName: "Engineer", baseline: d.baselines.get(t.id) || null,
        mine: !!mine && t.resource === mine.id, milestone: t.estimated === 0 })),
      links: d.links.filter(l => ts.some(t => t.id === l.succ)),
      people: PEOPLE, holidays: [], me: mine ? mine.id : null,
      can: { reschedule: !!a.editSchedules, logAnyTask: !!a.editSchedules } };
  }
  return null;
}
