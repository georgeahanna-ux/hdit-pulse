"use strict";
/**
 * Projects (D21): changes written to Autotask through the "projects" module of the Autotask
 * connection, which may only edit tasks and add time entries. Every change is audited.
 *
 *   POST /projects/tasks/:id/time       { date, hours, summary, notes?, complete? }   the task's people, or Project Managers
 *   POST /projects/tasks/:id/complete   {}                                            the task's people, or Project Managers
 *   POST /projects/:id/reschedule/preview { taskId, start, end }                      Project Managers and Leadership
 *   POST /projects/:id/reschedule       { taskId, start, end, expect, reason? }       saves the previewed plan
 *   POST /projects/:id/reschedule/undo  { changes }                                   puts those tasks back
 *   POST /projects/:id/baseline         {}                                            saves today's plan as the baseline
 */
const at = require("../lib/autotask");
const db = require("../lib/sql");
const time = require("../lib/time");
const C = require("../eos/common");
const L = require("./logic");
const sync = require("./sync");

const MOD = "projects";
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));

async function myResource(ctx) {
  const [r] = await db.query(`SELECT l.external_id, r.default_role_id FROM pulse.person_link l JOIN pulse.person p ON p.id = l.person_id
                                LEFT JOIN pulse.at_resource r ON r.id = TRY_CAST(l.external_id AS INT)
                               WHERE p.entra_oid = @oid AND l.system = N'autotask'`, { oid: ctx.person.oid });
  return r ? { id: Number(r.external_id), role: r.default_role_id } : null;
}

async function loadTask(id) {
  const [t] = await db.query("SELECT * FROM pulse.at_task WHERE id = @id", { id });
  if (!t) throw C.fail(404, "That task isn't in Pulse. Refresh the project from Autotask and try again.");
  const secondary = await db.query("SELECT resource_id, role_id FROM pulse.at_task_secondary WHERE task_id = @id", { id });
  return { ...t, secondary };
}

/** Engineers work on their own tasks; Project Managers and Leadership on any. */
async function forTaskWork(ctx) {
  const t = await loadTask(C.int(ctx.params.id, "Task"));
  const me = await myResource(ctx);
  if (!me) throw C.fail(409, "Your Pulse account isn't linked to an Autotask resource yet, so Pulse can't record time as you. A Platform Admin can link it under People and departments.");
  const onTask = t.assigned_resource_id === me.id || t.secondary.some(s => s.resource_id === me.id);
  if (!onTask && !ctx.access.editSchedules) throw C.fail(403, "You can log time and complete tasks you're assigned to. Project Managers can do it on any task.");
  const role = t.assigned_resource_id === me.id ? t.assigned_role_id : (t.secondary.find(s => s.resource_id === me.id) || {}).role_id || me.role;
  return { t, me, role };
}

async function completeInAutotask(t) {
  const st = await sync.statuses();
  await at.update(MOD, "Tasks", { id: t.id, status: st.taskComplete }, ["Projects", t.project_id]);
}

async function logTime(ctx) {
  const { t, me, role } = await forTaskWork(ctx);
  const b = ctx.body || {};
  const today = time.sydneyDate();
  if (!isDay(b.date)) throw C.fail(400, "Choose the day you worked.");
  if (b.date > today) throw C.fail(400, "Time can't be logged for a day that hasn't happened yet.");
  if (b.date < time.addDays(today, -30)) throw C.fail(400, "Pulse only logs time for the last 30 days. Older entries go straight into Autotask.");
  const hours = Number(String(b.hours || "").replace(",", "."));
  if (!(hours > 0 && hours <= 16)) throw C.fail(400, "Enter the hours worked, between 0.1 and 16.");
  const summary = C.text(b.summary, 8000, { required: true, label: "What you did" });
  if (!role) throw C.fail(409, "Pulse couldn't work out your Autotask role for this task. Ask the Project Manager to assign you in Autotask.");
  const entry = { taskID: t.id, resourceID: me.id, roleID: role, dateWorked: `${b.date}T00:00:00`, hoursWorked: Math.round(hours * 100) / 100, summaryNotes: summary };
  if (b.notes) entry.internalNotes = C.text(b.notes, 8000);
  const res = await at.create(MOD, "TimeEntries", entry);
  await C.record(ctx, "project.time", { type: "task", id: String(t.id) }, null, { taskId: t.id, date: b.date, hours: entry.hoursWorked, timeEntryId: res && res.itemId });
  if (b.complete === true || b.complete === "true" || b.complete === "on") {
    await completeInAutotask(t);
    await C.record(ctx, "project.complete", { type: "task", id: String(t.id) }, { complete: !!t.is_complete }, { complete: true });
  }
  await sync.syncProjects([t.project_id]).catch(() => {});
  return { ok: true, timeEntryId: res && res.itemId };
}

async function complete(ctx) {
  const { t } = await forTaskWork(ctx);
  if (t.is_complete) return { ok: true };
  await completeInAutotask(t);
  await C.record(ctx, "project.complete", { type: "task", id: String(t.id) }, { complete: false }, { complete: true });
  await sync.syncProjects([t.project_id]).catch(() => {});
  return { ok: true };
}

/* ---------------- rescheduling ---------------- */
async function projectPlan(projectId) {
  const [rows, preds, hol] = await Promise.all([
    db.query("SELECT * FROM pulse.at_task WHERE project_id = @id", { id: projectId }),
    db.query(`SELECT pr.predecessor_task_id AS pred, pr.successor_task_id AS succ, pr.lag_days AS lag FROM pulse.at_task_predecessor pr
               JOIN pulse.at_task t ON t.id = pr.successor_task_id WHERE t.project_id = @id`, { id: projectId }),
    db.query("SELECT day FROM pulse.holiday"),
  ]);
  const tasks = rows.map(r => ({ id: r.id, title: r.title, start: L.toDay(r.start_at), end: L.toDay(r.end_at), complete: !!r.is_complete, raw: r }));
  return { tasks, preds, hol: new Set(hol.map(h => new Date(h.day).toISOString().slice(0, 10))) };
}

function planFor(ctx, plan) {
  const b = ctx.body || {};
  const taskId = C.int(b.taskId, "Task");
  if (!isDay(b.start) || !isDay(b.end)) throw C.fail(400, "Give the new start and end days.");
  if (!plan.tasks.some(t => t.id === taskId)) throw C.fail(404, "That task isn't in this project.");
  if (plan.tasks.find(t => t.id === taskId).complete) throw C.fail(409, "That task is complete, so it can't be moved.");
  try { return L.reschedule(plan.tasks, plan.preds, { id: taskId, start: b.start, end: b.end }, plan.hol); }
  catch (e) { throw C.fail(400, e.message); }
}

const describe = (changes, plan) => changes.map(c => ({ ...c, title: (plan.tasks.find(t => t.id === c.id) || {}).title,
  becauseTitle: c.because ? (plan.tasks.find(t => t.id === c.because) || {}).title : null }));

async function preview(ctx) {
  const projectId = C.int(ctx.params.id, "Project");
  const plan = await projectPlan(projectId);
  return { changes: describe(planFor(ctx, plan), plan) };
}

/** Keeps each task's time of day (Sydney) and moves it to the new date. */
function onDay(raw, day, fallbackHour) {
  const p = raw ? time.sydneyParts(new Date(raw)) : { hour: fallbackHour, minute: 0 };
  return time.sydneyToUtc(day, p.hour, p.minute).toISOString();
}

/** Writes a set of task date changes to Autotask, stopping at the first failure. */
async function write(ctx, projectId, plan, changes, action, reason) {
  const done = [];
  try {
    for (const c of changes) {
      const raw = plan.tasks.find(t => t.id === c.id).raw;
      await at.update(MOD, "Tasks", { id: c.id, startDateTime: onDay(raw.start_at, c.start, 9), endDateTime: onDay(raw.end_at, c.end, 17) }, ["Projects", projectId]);
      done.push(c);
      await C.record(ctx, action, { type: "task", id: String(c.id) }, c.from, { start: c.start, end: c.end, ...(c.because ? { movedWith: c.because } : {}) }, reason || null);
    }
  } catch (e) {
    await sync.syncProjects([projectId]).catch(() => {});
    throw C.fail(502, `${done.length} of ${changes.length} tasks were saved before Autotask refused one: ${e.message}`);
  }
  await sync.syncProjects([projectId]).catch(() => {});
  return done;
}

async function reschedule(ctx) {
  const projectId = C.int(ctx.params.id, "Project");
  const plan = await projectPlan(projectId);
  const changes = planFor(ctx, plan);
  const expect = Array.isArray(ctx.body.expect) ? ctx.body.expect : null;
  const key = list => list.map(c => `${c.id}:${c.start}:${c.end}`).sort().join("|");
  if (!expect || key(expect) !== key(changes)) throw C.fail(409, "The project changed since the preview. Look at the changes again before saving.");
  const reason = ctx.body.reason ? C.text(ctx.body.reason, 1000) : null;
  const saved = await write(ctx, projectId, plan, changes, "project.reschedule", reason);
  return { ok: true, saved: describe(saved, plan) };
}

async function undo(ctx) {
  const projectId = C.int(ctx.params.id, "Project");
  const plan = await projectPlan(projectId);
  const list = Array.isArray(ctx.body.changes) ? ctx.body.changes : [];
  const back = [];
  for (const c of list) {
    const t = plan.tasks.find(x => x.id === Number(c.id));
    if (!t || !c.from || !isDay(c.from.start) || !isDay(c.from.end)) continue;
    if (t.start !== c.start || t.end !== c.end) throw C.fail(409, `"${t.title}" has changed since, so Pulse won't undo over it. Refresh and move it by hand.`);
    back.push({ id: t.id, start: c.from.start, end: c.from.end, from: { start: t.start, end: t.end } });
  }
  if (!back.length) throw C.fail(400, "Nothing to undo.");
  await write(ctx, projectId, plan, back, "project.reschedule.undo", "Undo");
  return { ok: true, restored: back.length };
}

async function saveBaseline(ctx) {
  const projectId = C.int(ctx.params.id, "Project");
  const n = await db.tx(async q => {
    await q("DELETE FROM pulse.project_baseline WHERE project_id = @id", { id: projectId });
    const r = await q(`INSERT INTO pulse.project_baseline (project_id, task_id, start_at, end_at, saved_at, saved_by)
                       OUTPUT inserted.task_id
                       SELECT project_id, id, start_at, end_at, SYSUTCDATETIME(), @by FROM pulse.at_task WHERE project_id = @id`, { id: projectId, by: ctx.person.name });
    return r.length;
  });
  await C.record(ctx, "project.baseline", { type: "project", id: String(projectId) }, null, { tasks: n });
  return { ok: true, tasks: n };
}

const pm = a => a.editSchedules;
const routes = [
  { method: "POST", path: "/projects/tasks/:id/time", auth: "person", allow: a => a.viewProjects, fn: logTime },
  { method: "POST", path: "/projects/tasks/:id/complete", auth: "person", allow: a => a.viewProjects, fn: complete },
  { method: "POST", path: "/projects/:id/reschedule/preview", auth: "person", allow: pm, fn: preview },
  { method: "POST", path: "/projects/:id/reschedule/undo", auth: "person", allow: pm, fn: undo },
  { method: "POST", path: "/projects/:id/reschedule", auth: "person", allow: pm, fn: reschedule },
  { method: "POST", path: "/projects/:id/baseline", auth: "person", allow: pm, fn: saveBaseline },
];

module.exports = { routes, _test: { onDay } };
