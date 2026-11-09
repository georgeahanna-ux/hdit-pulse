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

const delta = (a, b) => (a === b ? 0 : b > a ? workdays(addDays(a, 1), b) : -workdays(addDays(b, 1), a));
function reschedule(tasks, links, { id, start, end }) {
  const byId = new Map(tasks.map(t => [t.id, t])), t0 = byId.get(id);
  if (end < start) { const e = new Error("A task can't end before it starts."); e.status = 400; throw e; }
  const dEnd = delta(t0.end, end), dStart = delta(t0.start, start);
  const out = new Map([[id, { id, start, end, from: { start: t0.start, end: t0.end }, because: null }]]);
  const go = (map, dd) => { if (!dd) return; const q = [...(map.get(id) || [])].map(x => [x, id]); const seen = new Set([id]);
    while (q.length) { const [tid, via] = q.shift(); if (seen.has(tid)) continue; seen.add(tid); const t = byId.get(tid); if (!t || t.complete) continue;
      if (!out.has(tid)) out.set(tid, { id: tid, start: addWork(nextWork(t.start), dd), end: addWork(nextWork(t.end), dd), from: { start: t.start, end: t.end }, because: via });
      for (const n of map.get(tid) || []) q.push([n, tid]); } };
  const succ = new Map(), pred = new Map();
  for (const l of links) { (succ.get(l.pred) || succ.set(l.pred, []).get(l.pred)).push(l.succ); (pred.get(l.succ) || pred.set(l.succ, []).get(l.succ)).push(l.pred); }
  go(succ, dEnd); go(pred, dStart);
  return [...out.values()].map(c => ({ ...c, title: byId.get(c.id).title, becauseTitle: c.because ? byId.get(c.because).title : null }));
}

let pvShare = 0.2, pvDepts = ["Projects"];
const monday = s => addDays(s, -((dow(s) + 6) % 7));
function planning(d, nWeeks) {
  const today = d.today, weeks = Array.from({ length: nWeeks }, (_, i) => addDays(monday(today), 7 * i));
  const pieces = [];
  for (const t of d.tasks) {
    if (t.complete || !t.remaining) continue;
    if (t.end < today) { pieces.push({ taskId: t.id, resource: t.resource, day: nextWork(today), hours: t.remaining, overdue: true }); continue; }
    const from = nextWork(t.start > today ? t.start : today), days = [];
    for (let x = from; x <= t.end; x = addDays(x, 1)) if (work(x)) days.push(x);
    for (const x of days.length ? days : [from]) pieces.push({ taskId: t.id, resource: t.resource, day: x, hours: t.remaining / Math.max(1, days.length) });
  }
  const leave = { "106": { [weeks[1]]: 15.2 }, "101": { [weeks[3]]: 38 } };
  const cap = (rid, w) => Math.max(0, (5 * 7.6 - ((leave[rid] || {})[w] || 0)) * (1 - pvShare));
  return { weeks, pieces, leave, cap };
}

export function projectsApi(p, method, body, a, me) {
  if (!p.startsWith("/projects")) return null;
  const bad0 = s => { const e = new Error("You don't have access to that."); e.status = s; throw e; };
  if (!a.viewProjects && !(p === "/projects/lead-time" && a.viewLeadTime)) bad0(403);
  const d = built || build();
  const today = d.today;
  if (p === "/projects/refresh") return { ok: true, detail: "Preview: re-read (simulated)." };
  if (p === "/projects/settings") { pvShare = body.nonProjectShare; pvDepts = body.departments || pvDepts; return { ok: true }; }
  if (p.startsWith("/projects/resources")) {
    const n = Number((/weeks=(\d+)/.exec(p) || [])[1]) || 12;
    const pl = planning(d, n), last = pl.weeks[pl.weeks.length - 1];
    const ids = [...new Set([...pl.pieces.map(x => x.resource).filter(Boolean), ...PEOPLE.filter(x => pvDepts.includes(x.department)).map(x => x.id)])];
    const cell = (rid, w) => { const mine = pl.pieces.filter(x => x.resource === rid && monday(x.day) === w); const by = new Map(); for (const x of mine) by.set(x.taskId, (by.get(x.taskId) || 0) + x.hours);
      return { week: w, leave: rid ? (pl.leave[rid] || {})[w] || 0 : 0, capacity: rid ? Math.round(pl.cap(String(rid), w) * 10) / 10 : null, allocated: Math.round(mine.reduce((s, x) => s + x.hours, 0) * 10) / 10,
        overdue: mine.some(x => x.overdue), tasks: [...by].map(([taskId, hours]) => ({ taskId, hours: Math.round(hours * 10) / 10 })) }; };
    const people = ids.map(id => ({ ...PEOPLE.find(x => x.id === id), weeks: pl.weeks.map(w => cell(id, w)) })).sort((x, y) => x.department.localeCompare(y.department) || x.name.localeCompare(y.name));
    const unassigned = pl.weeks.map(w => cell(null, w));
    return { today, share: pvShare, departments: pvDepts, allDepartments: [...new Set(PEOPLE.map(x => x.department))].sort(), holidays: [],
      weeks: pl.weeks.map((w, i) => ({ week: w, capacity: Math.round(people.reduce((s, x) => s + x.weeks[i].capacity, 0)), allocated: Math.round(people.reduce((s, x) => s + x.weeks[i].allocated, 0)) })),
      people, unassigned, tasks: Object.fromEntries(d.tasks.map(t => [t.id, { title: t.title, projectId: t.projectId }])),
      projects: Object.fromEntries(d.projects.map(x => [x.id, { id: x.id, name: x.name, company: x.company }])),
      beyond: Math.round(pl.pieces.filter(x => monday(x.day) > last).reduce((s, x) => s + x.hours, 0)), can: { settings: !!a.editSchedules } };
  }
  if (p === "/projects/lead-time") {
    if (!a.viewLeadTime) bad0(403);
    const pl = planning(d, 26);
    const ids = [...new Set([...pl.pieces.map(x => x.resource).filter(Boolean), ...PEOPLE.filter(x => pvDepts.includes(x.department)).map(x => x.id)])];
    const weekly = pl.weeks.map(w => ({ week: w, capacity: Math.round(ids.reduce((s, id) => s + pl.cap(String(id), w), 0) * 10) / 10 }));
    const backlog = pl.pieces.reduce((s, x) => s + x.hours, 0);
    let left = backlog, i = 0; const burn = [];
    while (left > 0.01 && i < 260) { left = Math.max(0, left - weekly[Math.min(i, 25)].capacity); burn.push(Math.round(left)); i++; }
    const partial = i ? (burn.length > 1 ? burn[burn.length - 2] : backlog) / weekly[Math.min(i - 1, 25)].capacity : 0;
    const weeks = Math.round(((i - 1) + Math.min(1, partial)) * 10) / 10;
    const ends = d.tasks.filter(t => !t.complete).map(t => t.end).sort();
    return { today, share: pvShare,
      backlog: { hours: Math.round(backlog), manDays: Math.round(backlog / 7.6 * 10) / 10, manWeeks: Math.round(backlog / 38 * 10) / 10, unassigned: 0,
        overdue: Math.round(pl.pieces.filter(x => x.overdue).reduce((s, x) => s + x.hours, 0)), projects: new Set(d.tasks.filter(t => !t.complete).map(t => t.projectId)).size },
      team: { people: ids.length, names: ids.map(id => PEOPLE.find(x => x.id === id).name).sort(), weeklyCapacity: Math.round(weekly.slice(0, 8).reduce((s, w) => s + w.capacity, 0) / 8) },
      weekly, base: { weeks, clearsWeek: addDays(weekly[0].week, 7 * Math.ceil(weeks)), burn }, scheduleEnds: ends[ends.length - 1], can: { model: true, settings: !!a.editSchedules } };
  }
  const bad = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
  let mm;
  if ((mm = /^\/projects\/tasks\/(\d+)\/(time|complete)$/.exec(p))) {
    const t = d.tasks.find(x => x.id === Number(mm[1]));
    const mine = PEOPLE.find(x => x.email === (me.email || "").toLowerCase());
    if (!mine) bad(409, "Your Pulse account isn't linked to an Autotask resource yet.");
    if (t.resource !== mine.id && !a.editSchedules) bad(403, "You can log time and complete tasks you're assigned to.");
    if (mm[2] === "time") {
      const h = Number(String(body.hours || "").replace(",", "."));
      if (!(h > 0 && h <= 16)) bad(400, "Enter the hours worked, between 0.1 and 16.");
      if (!String(body.summary || "").trim()) bad(400, "Say what you did.");
      if (body.date > today) bad(400, "Time can't be logged for a day that hasn't happened yet.");
      t.worked = Math.round((t.worked + h) * 10) / 10; t.remaining = Math.max(0, Math.round((t.remaining - h) * 10) / 10);
    }
    if (mm[2] === "complete" || body.complete === true || body.complete === "on") { t.complete = true; t.remaining = 0; }
    return { ok: true };
  }
  if ((mm = /^\/projects\/(\d+)\/(reschedule\/preview|reschedule|reschedule\/undo|baseline)$/.exec(p))) {
    if (!a.editSchedules) bad(403, "Only Project Managers and Leadership can reschedule.");
    const pid = Number(mm[1]), ts = d.tasks.filter(t => t.projectId === pid), ls = d.links.filter(l => ts.some(t => t.id === l.succ));
    if (mm[2] === "baseline") { for (const t of ts) d.baselines.set(t.id, { start: t.start, end: t.end }); return { ok: true, tasks: ts.length }; }
    if (mm[2] === "reschedule/undo") { for (const c of body.changes) { const t = d.tasks.find(x => x.id === c.id); t.start = c.from.start; t.end = c.from.end; } return { ok: true, restored: body.changes.length }; }
    const changes = reschedule(ts, ls, { id: body.taskId, start: body.start, end: body.end });
    if (mm[2] === "reschedule/preview") return { changes };
    for (const c of changes) { const t = d.tasks.find(x => x.id === c.id); t.start = c.start; t.end = c.end; }
    return { ok: true, saved: changes };
  }
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
