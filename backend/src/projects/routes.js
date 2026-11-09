"use strict";
/**
 * Projects API (D21).
 *   GET  /projects                 programme: open projects grouped by client, with phases
 *   GET  /projects/:id             one project: phases, tasks, dependencies, people, baseline, critical path
 *   POST /projects/refresh { id? } re-read one project now, or ask the sync service for a full refresh
 * Who: Leadership, Project Managers and Managed Services (viewProjects).
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const C = require("../eos/common");
const L = require("./logic");
const sync = require("./sync");

const view = a => a.viewProjects;

async function holidays() {
  const rows = await db.query("SELECT day FROM pulse.holiday");
  return new Set(rows.map(r => new Date(r.day).toISOString().slice(0, 10)));
}

async function people() {
  const rows = await db.query(`SELECT r.id, r.first_name, r.last_name, r.email, d.name AS department
                                 FROM pulse.at_resource r LEFT JOIN pulse.at_department d ON d.id = r.default_department_id`);
  return new Map(rows.map(r => [r.id, { id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || `Resource ${r.id}`, email: r.email, department: r.department }]));
}

/** The Autotask resource linked to the signed-in person (People directory, D10), or null. */
async function myResource(ctx) {
  const [r] = await db.query(`SELECT l.external_id FROM pulse.person_link l JOIN pulse.person p ON p.id = l.person_id
                               WHERE p.entra_oid = @oid AND l.system = N'autotask'`, { oid: ctx.person.oid });
  return r ? Number(r.external_id) : null;
}

const taskShape = t => ({
  id: t.id, projectId: t.project_id, phaseId: t.phase_id, title: t.title, number: t.task_number, complete: !!t.is_complete,
  start: L.toDay(t.start_at), end: L.toDay(t.end_at), estimated: t.estimated_hours === null ? null : Number(t.estimated_hours),
  remaining: t.remaining_hours === null ? null : Number(t.remaining_hours), worked: Number(t.worked_hours || 0),
  resource: t.assigned_resource_id, role: t.assigned_role_id, completedAt: t.completed_at,
});

async function lastSync() {
  const [r] = await db.query("SELECT MAX(finished_at) AS at FROM pulse.sync_run WHERE job = N'projects' AND ok = 1");
  return r ? r.at : null;
}

/** Programme view. */
async function programme(ctx) {
  const today = time.sydneyDate();
  const [projects, tasks, phases, companies, who, last] = await Promise.all([
    db.query("SELECT * FROM pulse.at_project WHERE is_open = 1"),
    db.query("SELECT t.* FROM pulse.at_task t JOIN pulse.at_project p ON p.id = t.project_id AND p.is_open = 1"),
    db.query("SELECT ph.* FROM pulse.at_phase ph JOIN pulse.at_project p ON p.id = ph.project_id AND p.is_open = 1"),
    db.query("SELECT id, name FROM pulse.at_company"),
    people(), lastSync(),
  ]);
  const company = new Map(companies.map(c => [c.id, c.name]));
  const byProject = new Map();
  for (const t of tasks.map(taskShape)) (byProject.get(t.projectId) || byProject.set(t.projectId, []).get(t.projectId)).push(t);
  const summaries = projects.map(p => {
    const ts = byProject.get(p.id) || [];
    const days = ts.flatMap(t => [t.start, t.end]).filter(Boolean).sort();
    const start = days[0] || L.toDay(p.start_at), end = days[days.length - 1] || L.toDay(p.end_at);
    const pct = L.percentComplete(ts);
    const ph = phases.filter(x => x.project_id === p.id).map(x => {
      const pts = ts.filter(t => t.phaseId === x.id);
      const pd = pts.flatMap(t => [t.start, t.end]).filter(Boolean).sort();
      const s = pd[0] || L.toDay(x.start_at), e = pd[pd.length - 1] || L.toDay(x.due_at);
      const ppct = L.percentComplete(pts);
      return { id: x.id, title: x.title, start: s, end: e, pct: ppct, health: L.health({ start: s, end: e, pct: ppct, tasks: pts }, today), sort: x.sort };
    }).sort((a, b) => (a.start || "9").localeCompare(b.start || "9") || (a.sort || 0) - (b.sort || 0));
    const open = ts.filter(t => !t.complete);
    const next = open.filter(t => t.end && t.end >= today).sort((a, b) => a.end.localeCompare(b.end))[0];
    return {
      id: p.id, name: p.name, number: p.number, companyId: p.company_id, company: company.get(p.company_id) || "No client",
      status: p.status_label, type: p.type_label, start, end, pct,
      health: L.health({ start, end, pct, tasks: ts }, today),
      lead: p.lead_resource_id ? (who.get(p.lead_resource_id) || { name: `Resource ${p.lead_resource_id}` }).name : null,
      tasks: ts.length, done: ts.length - open.length, overdue: open.filter(t => t.end && t.end < today).length,
      remainingHours: Math.round(open.reduce((s, t) => s + Math.max(0, t.remaining ?? t.estimated ?? 0), 0) * 10) / 10,
      next: next ? { title: next.title, end: next.end } : null,
      phases: ph,
    };
  });
  const clients = new Map();
  for (const s of summaries) (clients.get(s.companyId) || clients.set(s.companyId, { id: s.companyId, name: s.company, projects: [] }).get(s.companyId)).projects.push(s);
  const list = [...clients.values()].map(c => ({ ...c, projects: c.projects.sort((a, b) => (a.start || "9").localeCompare(b.start || "9")) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const all = summaries.flatMap(s => [s.start, s.end]).filter(Boolean).sort();
  return {
    today, lastSync: last, clients: list,
    range: { start: all[0] || today, end: all[all.length - 1] || today },
    totals: { projects: summaries.length, late: summaries.filter(s => s.health === "late").length, atRisk: summaries.filter(s => s.health === "at-risk").length,
      remainingHours: Math.round(summaries.reduce((s, p) => s + p.remainingHours, 0)) },
    can: { reschedule: !!ctx.access.editSchedules },
  };
}

/** One project. */
async function project(ctx) {
  const id = C.int(ctx.params.id, "Project");
  const [p] = await db.query("SELECT * FROM pulse.at_project WHERE id = @id", { id });
  if (!p) throw C.fail(404, "That project isn't in Pulse. It may be complete, a template, or not synced yet.");
  const today = time.sydneyDate();
  const [rows, phases, preds, secondary, baseline, [company], who, roles, hol, me, last] = await Promise.all([
    db.query("SELECT * FROM pulse.at_task WHERE project_id = @id", { id }),
    db.query("SELECT * FROM pulse.at_phase WHERE project_id = @id", { id }),
    db.query(`SELECT pr.* FROM pulse.at_task_predecessor pr JOIN pulse.at_task t ON t.id = pr.successor_task_id WHERE t.project_id = @id`, { id }),
    db.query(`SELECT s.* FROM pulse.at_task_secondary s JOIN pulse.at_task t ON t.id = s.task_id WHERE t.project_id = @id`, { id }),
    db.query("SELECT task_id, start_at, end_at, saved_at, saved_by FROM pulse.project_baseline WHERE project_id = @id", { id }),
    db.query("SELECT name FROM pulse.at_company WHERE id = @c", { c: p.company_id || 0 }),
    people(), db.query("SELECT id, name FROM pulse.at_role"), holidays(), myResource(ctx), lastSync(),
  ]);
  const tasks = rows.map(taskShape);
  const links = preds.map(x => ({ id: x.id, pred: x.predecessor_task_id, succ: x.successor_task_id, lag: x.lag_days }));
  const fc = L.floatAndCritical(tasks, links, hol);
  const base = new Map(baseline.map(b => [b.task_id, { start: L.toDay(b.start_at), end: L.toDay(b.end_at) }]));
  const role = new Map(roles.map(r => [r.id, r.name]));
  const sec = new Map();
  for (const s of secondary) (sec.get(s.task_id) || sec.set(s.task_id, []).get(s.task_id)).push(s.resource_id);
  const days = tasks.flatMap(t => [t.start, t.end]).filter(Boolean).sort();
  const start = days[0] || L.toDay(p.start_at), end = days[days.length - 1] || L.toDay(p.end_at);
  const pct = L.percentComplete(tasks);
  const resIds = new Set([...tasks.map(t => t.resource), ...secondary.map(s => s.resource_id)].filter(Boolean));
  return {
    today, lastSync: last,
    project: { id: p.id, name: p.name, number: p.number, company: company ? company.name : "No client", status: p.status_label, type: p.type_label,
      start, end, pct, health: L.health({ start, end, pct, tasks }, today),
      lead: p.lead_resource_id ? (who.get(p.lead_resource_id) || {}).name || null : null,
      baseline: baseline.length ? { savedAt: baseline[0].saved_at, savedBy: baseline[0].saved_by } : null },
    phases: phases.map(x => ({ id: x.id, parentId: x.parent_phase_id, title: x.title, start: L.toDay(x.start_at), end: L.toDay(x.due_at), sort: x.sort }))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.start || "").localeCompare(b.start || "")),
    tasks: tasks.map(t => ({ ...t, ...fc.get(t.id), roleName: role.get(t.role) || null, secondary: sec.get(t.id) || [],
      baseline: base.get(t.id) || null, mine: !!me && (t.resource === me || (sec.get(t.id) || []).includes(me)),
      milestone: !!t.start && t.start === t.end && !(t.estimated > 0) }))
      .sort((a, b) => (a.start || "9").localeCompare(b.start || "9") || a.id - b.id),
    links,
    people: [...resIds].map(r => who.get(r) || { id: r, name: `Resource ${r}` }),
    holidays: [...hol].filter(Boolean).sort(),
    me,
    can: { reschedule: !!ctx.access.editSchedules, logAnyTask: !!ctx.access.editSchedules },
  };
}

async function refresh(ctx) {
  const id = ctx.body && ctx.body.id ? C.int(ctx.body.id, "Project") : null;
  if (id) {
    await sync.syncProjects([id]);
    return { ok: true, detail: "Re-read from Autotask." };
  }
  const [pending] = await db.query("SELECT TOP 1 id FROM pulse.sync_request WHERE job = N'projects' AND picked_at IS NULL AND requested_at > DATEADD(hour, -1, SYSUTCDATETIME())");
  if (!pending) await db.query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (N'projects', @by)", { by: ctx.person.name });
  return { ok: true, detail: "Pulse will re-read every project from Autotask within a few minutes." };
}

const routes = [
  { method: "GET", path: "/projects", auth: "person", allow: view, fn: programme },
  { method: "POST", path: "/projects/refresh", auth: "person", allow: view, fn: refresh },
  { method: "GET", path: "/projects/:id", auth: "person", allow: view, fn: project },
];

module.exports = { routes, _test: { taskShape } };
