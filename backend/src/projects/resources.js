"use strict";
/**
 * Resource planning and lead time (D21).
 *   GET /projects/resources?weeks=12   each person's project hours allocated vs available, week by week
 *   GET /projects/lead-time            backlog, team capacity and how long until new work can start
 *   PUT /projects/settings { nonProjectShare, departments }   Project Managers and Leadership
 *
 * Allocation: each open task's remaining hours spread evenly over its remaining working days.
 * Capacity: working days × 7.6 h, less public holidays and leave booked in Autotask, less the
 * share of each day kept for non-project work (setting, 20% to start).
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const C = require("../eos/common");
const L = require("./logic");

async function settings() {
  const rows = await db.query("SELECT [key], [value] FROM pulse.app_setting WHERE [key] LIKE N'projects.%'");
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  let departments = [];
  try { departments = JSON.parse(s["projects.people_department"] || "[]") || []; } catch { departments = []; }
  const share = Number(s["projects.non_project_share"]);
  return { share: Number.isFinite(share) && share >= 0 && share < 1 ? share : 0.2, departments };
}

async function load(weeksAhead) {
  const today = time.sydneyDate();
  const [s, rows, hol, leave, res, projects, companies] = await Promise.all([
    settings(),
    db.query("SELECT t.* FROM pulse.at_task t JOIN pulse.at_project p ON p.id = t.project_id AND p.is_open = 1 WHERE t.is_complete = 0"),
    db.query("SELECT day FROM pulse.holiday"),
    db.query("SELECT resource_id, day, hours FROM pulse.at_time_off WHERE day >= @from", { from: time.addDays(today, -7) }),
    db.query(`SELECT r.id, r.first_name, r.last_name, r.is_active, d.name AS department FROM pulse.at_resource r
               LEFT JOIN pulse.at_department d ON d.id = r.default_department_id`),
    db.query("SELECT id, name, company_id FROM pulse.at_project WHERE is_open = 1"),
    db.query("SELECT id, name FROM pulse.at_company"),
  ]);
  const allDepartments = [...new Set(res.filter(r => r.is_active && r.department).map(r => r.department))].sort();
  const holidays = new Set(hol.map(h => new Date(h.day).toISOString().slice(0, 10)));
  const tasks = rows.map(r => ({ id: r.id, projectId: r.project_id, title: r.title, resource: r.assigned_resource_id, complete: false,
    start: L.toDay(r.start_at), end: L.toDay(r.end_at), estimated: r.estimated_hours === null ? null : Number(r.estimated_hours),
    remaining: r.remaining_hours === null ? null : Number(r.remaining_hours), worked: Number(r.worked_hours || 0) }));
  const weeks = L.weeksFrom(today, weeksAhead);
  const pieces = L.spread(tasks, today, holidays);
  const leaveBy = new Map();
  for (const l of leave) {
    const k = `${l.resource_id}|${L.weekOfDay(new Date(l.day).toISOString().slice(0, 10))}`;
    leaveBy.set(k, (leaveBy.get(k) || 0) + Number(l.hours || 0));
  }
  const company = new Map(companies.map(c => [c.id, c.name]));
  const project = new Map(projects.map(p => [p.id, { id: p.id, name: p.name, company: company.get(p.company_id) || "" }]));
  const person = new Map(res.map(r => [r.id, { id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || `Resource ${r.id}`, department: r.department, active: !!r.is_active }]));
  // People in the plan: anyone with project work, plus the departments chosen in settings.
  const ids = new Set(pieces.map(p => p.resource).filter(Boolean));
  if (s.departments.length) for (const r of res) if (r.is_active && s.departments.includes(r.department)) ids.add(r.id);
  return { today, s, tasks, weeks, pieces, holidays, leaveBy, project, person, ids, allDepartments };
}

async function resources(ctx) {
  const n = Math.max(4, Math.min(26, Number(ctx.query.weeks) || 12));
  const d = await load(n);
  const last = d.weeks[d.weeks.length - 1];
  const inRange = p => L.weekOfDay(p.day) <= last;
  const cell = (rid, week) => {
    const mine = d.pieces.filter(p => p.resource === rid && L.weekOfDay(p.day) === week);
    const byTask = new Map();
    for (const p of mine) byTask.set(p.taskId, (byTask.get(p.taskId) || 0) + p.hours);
    const leave = rid ? d.leaveBy.get(`${rid}|${week}`) || 0 : 0;
    return {
      week, leave: Math.round(leave * 10) / 10,
      capacity: rid ? Math.round(L.capacity(week, leave, d.holidays, d.s.share) * 10) / 10 : null,
      allocated: Math.round(mine.reduce((s, p) => s + p.hours, 0) * 10) / 10,
      overdue: mine.some(p => p.overdue),
      tasks: [...byTask.entries()].map(([taskId, hours]) => ({ taskId, hours: Math.round(hours * 10) / 10 })).sort((a, b) => b.hours - a.hours),
    };
  };
  const people = [...d.ids].map(id => d.person.get(id) || { id, name: `Resource ${id}`, department: null })
    .map(p => ({ ...p, weeks: d.weeks.map(w => cell(p.id, w)) }))
    .sort((a, b) => (a.department || "").localeCompare(b.department || "") || a.name.localeCompare(b.name));
  const unassigned = d.weeks.map(w => cell(null, w));
  const taskInfo = Object.fromEntries(d.tasks.map(t => [t.id, { title: t.title, projectId: t.projectId, start: t.start, end: t.end }]));
  return {
    today: d.today, share: d.s.share, departments: d.s.departments, allDepartments: d.allDepartments, holidays: [...d.holidays].filter(x => x >= d.weeks[0]).sort(),
    weeks: d.weeks.map((w, i) => ({ week: w, capacity: Math.round(people.reduce((s, p) => s + p.weeks[i].capacity, 0)),
      allocated: Math.round(people.reduce((s, p) => s + p.weeks[i].allocated, 0) + unassigned[i].allocated) })),
    people, unassigned, tasks: taskInfo, projects: Object.fromEntries(d.project),
    beyond: Math.round(d.pieces.filter(p => !inRange(p)).reduce((s, p) => s + p.hours, 0)),
    can: { settings: !!ctx.access.editSchedules },
  };
}

async function leadTimeView(ctx) {
  const d = await load(26);
  const backlog = d.pieces.reduce((s, p) => s + p.hours, 0);
  const people = [...d.ids];
  const weekly = d.weeks.map(w => ({ week: w, capacity: Math.round(people.reduce((s, id) => s + L.capacity(w, d.leaveBy.get(`${id}|${w}`) || 0, d.holidays, d.s.share), 0) * 10) / 10 }));
  const base = L.leadTime(backlog, weekly);
  const ends = d.tasks.map(t => t.end).filter(Boolean).sort();
  const next8 = weekly.slice(0, 8);
  return {
    today: d.today, share: d.s.share,
    backlog: {
      hours: Math.round(backlog), manDays: Math.round((backlog / L.HOURS_PER_DAY) * 10) / 10, manWeeks: Math.round((backlog / (L.HOURS_PER_DAY * 5)) * 10) / 10,
      unassigned: Math.round(d.pieces.filter(p => !p.resource).reduce((s, p) => s + p.hours, 0)),
      overdue: Math.round(d.pieces.filter(p => p.overdue).reduce((s, p) => s + p.hours, 0)),
      projects: new Set(d.tasks.map(t => t.projectId)).size,
    },
    team: { people: people.length, names: people.map(id => (d.person.get(id) || { name: `Resource ${id}` }).name).sort(),
      weeklyCapacity: Math.round(next8.reduce((s, w) => s + w.capacity, 0) / Math.max(1, next8.length)) },
    weekly, base,
    scheduleEnds: ends[ends.length - 1] || null,
    can: { model: !!ctx.access.viewLeadTime, settings: !!ctx.access.editSchedules },
  };
}

async function putSettings(ctx) {
  const b = ctx.body || {};
  const before = await settings();
  const out = {};
  if ("nonProjectShare" in b) {
    const v = Number(b.nonProjectShare);
    if (!(v >= 0 && v <= 0.9)) throw C.fail(400, "The non-project share is a percentage between 0 and 90.");
    out["projects.non_project_share"] = String(Math.round(v * 100) / 100);
  }
  if ("departments" in b) {
    if (!Array.isArray(b.departments) || b.departments.some(x => typeof x !== "string" || x.length > 200)) throw C.fail(400, "Choose departments from the list.");
    out["projects.people_department"] = JSON.stringify(b.departments);
  }
  for (const [key, value] of Object.entries(out)) await db.query(
    `MERGE pulse.app_setting AS t USING (SELECT @key AS [key]) AS s ON t.[key] = s.[key]
     WHEN MATCHED THEN UPDATE SET [value] = @value, updated_by = @by
     WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (@key, @value, @by);`, { key, value, by: ctx.person.name });
  await C.record(ctx, "projects.settings", { type: "setting", id: "projects" }, { nonProjectShare: before.share, departments: before.departments }, out);
  return { ok: true };
}

const routes = [
  { method: "GET", path: "/projects/resources", auth: "person", allow: a => a.viewProjects, fn: resources },
  { method: "GET", path: "/projects/lead-time", auth: "person", allow: a => a.viewLeadTime, fn: leadTimeView },
  { method: "PUT", path: "/projects/settings", auth: "person", allow: a => a.editSchedules, fn: putSettings },
];

module.exports = { routes };
