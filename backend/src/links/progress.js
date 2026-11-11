"use strict";
/**
 * Progress read back for linked items (D11, 0.8.0), every 5 minutes in the sync service:
 *   - Rocks linked to an Autotask project: the project's % complete as the Projects module works
 *     it out (hours worked ÷ worked + remaining, from the 15-minute projects sync);
 *   - Rocks linked to a Planner plan: tasks complete ÷ all tasks;
 *   - Issues with an Autotask ticket or project task: its status, and whether it's complete.
 */
const db = require("../lib/sql");
const PL = require("../projects/logic");

/** % complete and a sentence, from a Planner plan's tasks. In-progress tasks count as half done. */
function planProgress(tasks) {
  if (!tasks.length) return { pct: 0, detail: "No tasks in the plan yet." };
  const done = tasks.filter(t => Number(t.percentComplete) === 100).length;
  const going = tasks.filter(t => Number(t.percentComplete) > 0 && Number(t.percentComplete) < 100).length;
  const pct = Math.round(((done + going * 0.5) / tasks.length) * 100);
  return { pct, detail: `${done} of ${tasks.length} tasks complete${going ? `, ${going} in progress` : ""}.` };
}

/** % complete of an Autotask project from Pulse's copy of its tasks. */
async function projectProgress(projectId) {
  const [p] = await db.query("SELECT id, name, number, is_open FROM pulse.at_project WHERE id = @id", { id: projectId });
  if (!p) return { pct: null, detail: "Pulse doesn't have this project (it may be closed or a template).", name: null };
  const rows = await db.query("SELECT is_complete, remaining_hours, worked_hours FROM pulse.at_task WHERE project_id = @id", { id: projectId });
  const tasks = rows.map(t => ({ complete: !!t.is_complete, remaining: t.remaining_hours === null ? null : Number(t.remaining_hours), worked: Number(t.worked_hours || 0) }));
  const pct = PL.percentComplete(tasks);
  const done = tasks.filter(t => t.complete).length;
  return { pct, name: `${p.number ? p.number + " " : ""}${p.name}`, detail: `${done} of ${tasks.length} tasks complete${p.is_open ? "" : "; the project is no longer active in Autotask"}.` };
}

async function rocks(graph) {
  const links = await db.query("SELECT rock_id, kind, ref FROM pulse.rock_link");
  let n = 0;
  for (const l of links) {
    try {
      let r;
      if (l.kind === "autotask_project") r = await projectProgress(Number(l.ref));
      else {
        const [plan, tasks] = await Promise.all([graph.get(`/planner/plans/${encodeURIComponent(l.ref)}`), graph.all(`/planner/plans/${encodeURIComponent(l.ref)}/tasks`)]);
        r = { ...planProgress(tasks), name: plan.title };
      }
      await db.query(`UPDATE pulse.rock_link SET pct = @pct, detail = @detail, name = ISNULL(@name, name), checked_at = SYSUTCDATETIME(), last_error = NULL WHERE rock_id = @id`,
        { id: l.rock_id, pct: r.pct, detail: r.detail, name: r.name || null });
      n++;
    } catch (e) {
      await db.query("UPDATE pulse.rock_link SET last_error = @e, checked_at = SYSUTCDATETIME() WHERE rock_id = @id", { id: l.rock_id, e: String(e.message).slice(0, 400) }).catch(() => {});
    }
  }
  return `${n} of ${links.length} Rocks`;
}

/** Status of Issues' Autotask tickets and tasks. */
async function issues(at = require("../lib/autotask")) {
  const links = await db.query("SELECT issue_id, kind, at_id FROM pulse.issue_link");
  if (!links.length) return "no linked Issues";
  const tickets = links.filter(l => l.kind === "ticket").map(l => l.at_id), tasks = links.filter(l => l.kind === "task").map(l => l.at_id);
  const [tkt, tsk, tktStatus, tskStatus] = await Promise.all([
    tickets.length ? at.queryIn("issues", "Tickets", "id", tickets, ["id", "ticketNumber", "title", "status"]) : [],
    tasks.length ? at.queryIn("issues", "Tasks", "id", tasks, ["id", "taskNumber", "title", "status", "projectID"]) : [],
    tickets.length ? at.picklist("issues", "Tickets", "status") : [],
    tasks.length ? at.picklist("issues", "Tasks", "status") : [],
  ]);
  const label = (list, v) => (list.find(s => s.value === Number(v)) || {}).label || null;
  const found = new Map([...tkt.map(t => [`ticket|${t.id}`, { number: t.ticketNumber, title: t.title, status: label(tktStatus, t.status) }]),
    ...tsk.map(t => [`task|${t.id}`, { number: t.taskNumber, title: t.title, status: label(tskStatus, t.status) }])]);
  for (const l of links) {
    const f = found.get(`${l.kind}|${l.at_id}`);
    if (!f) { await db.query("UPDATE pulse.issue_link SET last_error = N'Not found in Autotask (deleted?)', checked_at = SYSUTCDATETIME() WHERE issue_id = @id", { id: l.issue_id }); continue; }
    await db.query(`UPDATE pulse.issue_link SET number = @number, title = @title, status_label = @status, is_complete = @done, checked_at = SYSUTCDATETIME(), last_error = NULL WHERE issue_id = @id`,
      { id: l.issue_id, number: f.number || null, title: f.title || null, status: f.status, done: /complete/i.test(f.status || "") ? 1 : 0 });
  }
  return `${found.size} of ${links.length} linked Issues`;
}

module.exports = { rocks, issues, projectProgress, _test: { planProgress } };
