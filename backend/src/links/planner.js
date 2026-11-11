"use strict";
/**
 * Company To-dos <-> the "Pulse – L10" plan in Microsoft Planner (D11, 0.8.0). Runs in the sync
 * service every 5 minutes, signed in as its managed identity (Graph Tasks.ReadWrite.All).
 *
 * Each linked pair keeps a snapshot of the values both sides last agreed on (title, due date,
 * done, owner). A field changed on one side since then is copied to the other; changed on both
 * sides, Pulse wins. So completing a To-do in Planner completes it in Pulse, and the other way.
 *   - a company To-do with no task gets one (open To-dos, and ones done in the last two weeks are left alone);
 *   - a task with no To-do (added in Planner) becomes a company To-do;
 *   - deleting either side deletes the other (the To-do is kept, marked deleted, as always).
 * Owners are matched through the People directory (Entra object id <-> email).
 * Every change made by the sync is in the audit log as "Planner sync".
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const audit = require("../lib/audit");

const ACTOR = { oid: "planner-sync", name: "Planner sync" };
const FIELDS = ["title", "due", "done", "owner"];

/* ------------------------------ pure logic ------------------------------ */

/** Planner's due date as a Sydney day. Pulse writes midnight UTC of the day (late morning in Sydney). */
const plannerDay = iso => (iso ? time.sydneyDate(new Date(iso)) : null);
const plannerDue = day => (day ? `${day}T00:00:00Z` : null);

/** A Planner task in the shape the merge compares. owner = the first assignee's Entra object id. */
function fromTask(t) {
  return { title: t.title || "", due: plannerDay(t.dueDateTime), done: Number(t.percentComplete) === 100, owner: Object.keys(t.assignments || {})[0] || null };
}
function fromTodo(t, oidOf) {
  return { title: t.title, due: t.due_date ? String(t.due_date instanceof Date ? t.due_date.toISOString() : t.due_date).slice(0, 10) : null, done: !!t.is_done, owner: oidOf(t.owner_email) };
}

/**
 * Three-way merge of one pair. Returns the agreed values and what each side needs changing.
 * A field only one side changed comes from that side; both changed: Pulse wins.
 */
function merge(snapshot, pulse, planner) {
  const agreed = {}, toPulse = {}, toPlanner = {};
  for (const f of FIELDS) {
    const p = pulse[f] !== snapshot[f], q = planner[f] !== snapshot[f];
    let v = snapshot[f];
    if (p) v = pulse[f]; else if (q) v = planner[f];
    // An owner Planner names but Pulse can't match stays as it is in Pulse.
    if (f === "owner" && !p && q && planner.owner === null) v = pulse.owner;
    agreed[f] = v;
    if (v !== pulse[f] && !(f === "owner" && v === null)) toPulse[f] = v;
    if (v !== planner[f]) toPlanner[f] = v;
  }
  return { agreed, toPulse, toPlanner };
}

/** The Graph body for a task's changed fields. */
function taskBody(changes, current = {}) {
  const b = {};
  if ("title" in changes) b.title = changes.title.slice(0, 255);
  if ("due" in changes) b.dueDateTime = plannerDue(changes.due);
  if ("done" in changes) b.percentComplete = changes.done ? 100 : 0;
  if ("owner" in changes) {
    const a = {};
    for (const id of Object.keys(current.assignments || {})) if (id !== changes.owner) a[id] = null;   // unassign the others
    if (changes.owner) a[changes.owner] = { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" };
    b.assignments = a;
  }
  return b;
}

/* ------------------------------ the sync ------------------------------ */

async function setting(key) {
  const [r] = await db.query("SELECT [value] FROM pulse.app_setting WHERE [key] = @key", { key });
  return r ? r.value : null;
}

/** People for owner matching: email <-> Entra object id. */
async function peopleIndex() {
  const rows = await db.query("SELECT entra_oid, display_name, email FROM pulse.person WHERE is_active = 1");
  const byEmail = new Map(), byOid = new Map();
  for (const r of rows) { if (r.email) byEmail.set(String(r.email).toLowerCase(), r); byOid.set(r.entra_oid, r); }
  return { oidOf: e => (e && byEmail.has(String(e).toLowerCase()) ? byEmail.get(String(e).toLowerCase()).entra_oid : null), byOid };
}

const record = (action, id, before, after) =>
  audit.record({ actor: ACTOR, action, entity: { type: "todo", id }, before, after }).catch(() => {});

/**
 * One run. graph = { get, all, send } (lib/graph). Returns a one-line summary.
 */
async function syncTodos(graph = require("../lib/graph"), now = new Date()) {
  const planId = await setting("planner.l10_plan_id");
  if (!planId) return "Planner: no L10 plan set (Connections → Microsoft Planner).";
  const tasks = await graph.all(`/planner/plans/${encodeURIComponent(planId)}/tasks`);
  const byTask = new Map(tasks.map(t => [t.id, t]));
  const todos = await db.query(`SELECT t.*, l.task_id, l.etag, l.snapshot FROM pulse.todo t LEFT JOIN pulse.todo_planner l ON l.todo_id = t.id
      WHERE t.level = N'company' AND (l.todo_id IS NOT NULL OR (t.is_deleted = 0 AND (t.is_done = 0 OR t.done_at >= DATEADD(day, -14, SYSUTCDATETIME()))))`);
  const linkedTasks = new Set(todos.filter(t => t.task_id).map(t => t.task_id));
  const people = await peopleIndex();
  const n = { created: 0, imported: 0, toPulse: 0, toPlanner: 0, deleted: 0, errors: 0 };
  const errors = [];

  for (const t of todos) {
    try {
      if (!t.task_id) {
        if (t.is_deleted || t.is_done) continue;   // only open To-dos go across the first time
        const owner = people.oidOf(t.owner_email);
        const body = { planId, title: t.title.slice(0, 255), dueDateTime: plannerDue(fromTodo(t, people.oidOf).due),
          ...(owner ? { assignments: { [owner]: { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" } } } : {}) };
        let r;
        try { r = await graph.send("POST", "/planner/tasks", body); }
        catch (e) { if (owner && (e.status === 400 || e.status === 403)) { delete body.assignments; r = await graph.send("POST", "/planner/tasks", body); } else throw e; }
        const snap = { ...fromTodo(t, people.oidOf), owner: owner && body.assignments ? owner : null };
        await db.query("INSERT INTO pulse.todo_planner (todo_id, task_id, etag, snapshot) VALUES (@id, @task, @etag, @snap)", { id: t.id, task: r.body.id, etag: r.etag, snap: JSON.stringify(snap) });
        n.created++;
        continue;
      }
      const task = byTask.get(t.task_id);
      if (t.is_deleted) {
        if (task) await graph.send("DELETE", `/planner/tasks/${encodeURIComponent(task.id)}`, undefined, { etag: task["@odata.etag"] }).catch(e => { if (e.status !== 404) throw e; });
        await db.query("DELETE FROM pulse.todo_planner WHERE todo_id = @id", { id: t.id });
        n.deleted++;
        continue;
      }
      if (!task) {
        // Deleted in Planner: delete it in Pulse too.
        await db.query("UPDATE pulse.todo SET is_deleted = 1 WHERE id = @id", { id: t.id });
        await db.query("DELETE FROM pulse.todo_planner WHERE todo_id = @id", { id: t.id });
        await record("todo.delete", t.id, { title: t.title }, { deletedIn: "Planner" });
        n.deleted++;
        continue;
      }
      let snapshot; try { snapshot = JSON.parse(t.snapshot); } catch { snapshot = fromTodo(t, people.oidOf); }
      const pulseNow = fromTodo(t, people.oidOf), plannerNow = fromTask(task);
      const { agreed, toPulse, toPlanner } = merge(snapshot, pulseNow, plannerNow);
      let etag = task["@odata.etag"];
      if (Object.keys(toPlanner).length) {
        const r = await graph.send("PATCH", `/planner/tasks/${encodeURIComponent(task.id)}`, taskBody(toPlanner, task), { etag });
        etag = r.etag || etag;
        n.toPlanner++;
      }
      if (Object.keys(toPulse).length) {
        const f = {};
        if ("title" in toPulse) f.title = String(toPulse.title).slice(0, 300) || t.title;
        if ("due" in toPulse && toPulse.due) f.due_date = toPulse.due;
        if ("done" in toPulse) { f.is_done = toPulse.done ? 1 : 0; f.done_at = toPulse.done ? (task.completedDateTime ? new Date(task.completedDateTime) : now) : null; }
        if ("owner" in toPulse && people.byOid.has(toPulse.owner)) { const p = people.byOid.get(toPulse.owner); f.owner_name = p.display_name; f.owner_email = p.email; }
        const keys = Object.keys(f);
        if (keys.length) {
          await db.query(`UPDATE pulse.todo SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @id`, { id: t.id, ...f });
          await record("is_done" in f && keys.length <= 2 ? (f.is_done ? "todo.done" : "todo.reopen") : "todo.update", t.id,
            Object.fromEntries(keys.map(k => [k, t[k]])), { ...f, changedIn: "Planner" });
          n.toPulse++;
        }
      }
      if (JSON.stringify(agreed) !== t.snapshot || etag !== t.etag) {
        await db.query("UPDATE pulse.todo_planner SET snapshot = @snap, etag = @etag, synced_at = SYSUTCDATETIME(), last_error = NULL WHERE todo_id = @id",
          { id: t.id, snap: JSON.stringify(agreed), etag });
      }
    } catch (e) {
      n.errors++; errors.push(`${t.title}: ${e.message}`.slice(0, 200));
      if (t.task_id) await db.query("UPDATE pulse.todo_planner SET last_error = @e WHERE todo_id = @id", { id: t.id, e: String(e.message).slice(0, 400) }).catch(() => {});
    }
  }

  // Tasks added in Planner become company To-dos.
  for (const task of tasks) {
    if (linkedTasks.has(task.id)) continue;
    if (Number(task.percentComplete) === 100) continue;   // already done before it reached Pulse
    try {
      const v = fromTask(task);
      const p = v.owner && people.byOid.get(v.owner);
      const row = { title: v.title.slice(0, 300) || "(untitled task)", ownerName: p ? p.display_name : "Not assigned", ownerEmail: p ? p.email : null,
        due: v.due || time.addDays(time.sydneyDate(now), 7) };
      const [{ id }] = await db.query(`INSERT INTO pulse.todo (level, division_code, title, owner_name, owner_email, due_date, created_by_name)
          OUTPUT inserted.id VALUES (N'company', NULL, @title, @ownerName, @ownerEmail, @due, N'Planner')`, row);
      await db.query("INSERT INTO pulse.todo_planner (todo_id, task_id, etag, snapshot) VALUES (@id, @task, @etag, @snap)",
        { id, task: task.id, etag: task["@odata.etag"], snap: JSON.stringify({ ...v, due: row.due, owner: p ? v.owner : null }) });
      await record("todo.create", id, null, { ...row, createdIn: "Planner" });
      n.imported++;
    } catch (e) { n.errors++; errors.push(`${task.title}: ${e.message}`.slice(0, 200)); }
  }

  const summary = `Planner: ${tasks.length} tasks; ${n.created} sent, ${n.imported} brought in, ${n.toPlanner} updated in Planner, ${n.toPulse} updated in Pulse, ${n.deleted} deleted${n.errors ? `, ${n.errors} failed (${errors.slice(0, 3).join("; ")})` : ""}`;
  if (n.errors && n.errors === todos.length + tasks.length) throw new Error(summary);
  return summary;
}

/** The L10 plan's details, and every plan in its group (to link Rocks to). */
async function refreshPlans(graph = require("../lib/graph")) {
  const planId = await setting("planner.l10_plan_id");
  if (!planId) return "no plan";
  const plan = await graph.get(`/planner/plans/${encodeURIComponent(planId)}`);
  const groupId = (plan.container && plan.container.containerId) || plan.owner || null;
  let groupName = null, plans = [plan];
  if (groupId) {
    try { groupName = (await graph.get(`/groups/${groupId}?$select=displayName`)).displayName; } catch { /* name only */ }
    try { plans = await graph.all(`/groups/${groupId}/planner/plans`); } catch { /* the L10 plan at least */ }
  }
  for (const p of plans) {
    await db.query(`MERGE pulse.planner_plan AS t USING (SELECT @id AS id) AS s ON t.id = s.id
        WHEN MATCHED THEN UPDATE SET title = @title, group_id = @g, group_name = @gn, checked_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (id, title, group_id, group_name) VALUES (@id, @title, @g, @gn);`, { id: p.id, title: p.title || "(untitled plan)", g: groupId, gn: groupName });
  }
  return `${plans.length} plans in ${groupName || "the group"}`;
}

module.exports = { syncTodos, refreshPlans, setting, _test: { merge, fromTask, fromTodo, taskBody, plannerDay, plannerDue } };
