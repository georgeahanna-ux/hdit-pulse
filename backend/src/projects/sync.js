"use strict";
/**
 * Copies active Autotask projects into Pulse (D21) through the "projects" module of the Autotask
 * connection. Runs every 15 minutes in the sync service, and for single projects straight after
 * Pulse changes them (API).
 *
 * Active = a project status that isn't complete, inactive or cancelled, and a project type that
 * isn't a template or baseline. Everything else in pulse.at_project is marked closed and its
 * phases and tasks are removed from Pulse's copy.
 */
const at = require("../lib/autotask");
const db = require("../lib/sql");
const calc = require("../collect/calc");

const MOD = "projects";
const CLOSED = /complete|inactive|cancel|closed/i;
const NOT_REAL = /template|baseline|archiv/i;

const F = {
  project: ["id", "projectName", "projectNumber", "companyID", "status", "projectType", "startDateTime", "endDateTime", "estimatedTime", "projectLeadResourceID", "completedPercentage"],
  phase: ["id", "projectID", "parentPhaseID", "title", "startDate", "dueDate", "estimatedHours", "phaseNumber"],
  task: ["id", "projectID", "phaseID", "title", "taskNumber", "status", "startDateTime", "endDateTime", "estimatedHours", "remainingHours",
    "assignedResourceID", "assignedResourceRoleID", "completedDateTime"],
};

async function statuses() {
  const [projectStatus, projectType, taskStatus] = await Promise.all([
    at.picklist(MOD, "Projects", "status"), at.picklist(MOD, "Projects", "projectType"), at.picklist(MOD, "Tasks", "status")]);
  return {
    open: projectStatus.filter(s => !CLOSED.test(s.label)),
    label: new Map(projectStatus.map(s => [s.value, s.label])),
    realTypes: projectType.filter(t => !NOT_REAL.test(t.label)),
    typeLabel: new Map(projectType.map(t => [t.value, t.label])),
    taskComplete: (taskStatus.find(s => /complete/i.test(s.label)) || { value: 5 }).value,
  };
}

const n = v => (v === null || v === undefined || v === "" ? null : Number(v));

/** Reads projects (all active, or the ids given) and everything under them from Autotask. */
async function read(onlyIds = null) {
  const st = await statuses();
  const filter = onlyIds ? [{ op: "in", field: "id", value: onlyIds }]
    : [...(st.open.length ? [{ op: "in", field: "status", value: st.open.map(s => s.value) }] : [{ op: "noteq", field: "status", value: 5 }]),
       ...(st.realTypes.length ? [{ op: "in", field: "projectType", value: st.realTypes.map(t => t.value) }] : [])];
  const projects = await at.query(MOD, "Projects", filter, await at.known(MOD, "Projects", F.project));
  const isOpen = p => !CLOSED.test(st.label.get(Number(p.status)) || "") && !NOT_REAL.test(st.typeLabel.get(Number(p.projectType)) || "");
  const open = projects.filter(isOpen);
  const ids = open.map(p => p.id);
  const notes = [];
  const soft = (what, promise) => promise.catch(e => { notes.push(`${what}: ${e.message}`.slice(0, 200)); return []; });

  const [companies, phases, tasks] = await Promise.all([
    at.queryIn(MOD, "Companies", "id", open.map(p => p.companyID), ["id", "companyName"]),
    at.queryIn(MOD, "Phases", "projectID", ids, await at.known(MOD, "Phases", F.phase)),
    at.queryIn(MOD, "Tasks", "projectID", ids, await at.known(MOD, "Tasks", F.task)),
  ]);
  const taskIds = tasks.map(t => t.id);
  const [preds, secondary, entries] = await Promise.all([
    soft("Task predecessors", at.queryIn(MOD, "TaskPredecessors", "successorTaskID", taskIds, ["id", "predecessorTaskID", "successorTaskID", "lagDays"])),
    soft("Secondary resources", at.queryIn(MOD, "TaskSecondaryResources", "taskID", taskIds, ["id", "taskID", "resourceID", "roleID"])),
    soft("Time entries", at.queryIn(MOD, "TimeEntries", "taskID", taskIds, ["id", "taskID", "hoursWorked"])),
  ]);
  const worked = new Map();
  for (const e of entries) worked.set(Number(e.taskID), (worked.get(Number(e.taskID)) || 0) + (Number(e.hoursWorked) || 0));

  return {
    st, notes, closedIds: projects.filter(p => !isOpen(p)).map(p => p.id),
    companies: companies.map(c => ({ id: c.id, name: c.companyName || `Company ${c.id}` })),
    projects: open.map(p => ({
      id: p.id, name: p.projectName || `Project ${p.id}`, number: p.projectNumber || null, companyId: n(p.companyID),
      status: n(p.status), statusLabel: st.label.get(Number(p.status)) || null, typeLabel: st.typeLabel.get(Number(p.projectType)) || null,
      start: p.startDateTime || null, end: p.endDateTime || null, estimated: n(p.estimatedTime), lead: n(p.projectLeadResourceID), pct: n(p.completedPercentage),
    })),
    phases: phases.map(p => ({ id: p.id, projectId: p.projectID, parentId: n(p.parentPhaseID), title: p.title || "Phase", start: p.startDate || null, due: p.dueDate || null,
      estimated: n(p.estimatedHours), sort: n(p.phaseNumber) })),
    tasks: tasks.map(t => ({ id: t.id, projectId: t.projectID, phaseId: n(t.phaseID), title: t.title || "Task", number: t.taskNumber || null, status: n(t.status),
      complete: Number(t.status) === Number(st.taskComplete), start: t.startDateTime || null, end: t.endDateTime || null,
      estimated: n(t.estimatedHours), remaining: n(t.remainingHours), worked: Math.round((worked.get(Number(t.id)) || 0) * 100) / 100,
      resource: n(t.assignedResourceID), role: n(t.assignedResourceRoleID), completedAt: t.completedDateTime || null })),
    preds: preds.map(p => ({ id: p.id, pred: p.predecessorTaskID, succ: p.successorTaskID, lag: n(p.lagDays) || 0 })),
    secondary: secondary.map(s => ({ id: s.id, taskId: s.taskID, resource: s.resourceID, role: n(s.roleID) })),
  };
}

const J = v => JSON.stringify(v);

/** Saves what read() returned. Full runs also close projects that are no longer active. */
async function save(data, { full }) {
  const projectIds = data.projects.map(p => p.id);
  await db.query(`
    MERGE pulse.at_company AS t USING (SELECT * FROM OPENJSON(@json) WITH (id INT, name NVARCHAR(200))) AS s ON t.id = s.id
    WHEN MATCHED AND t.name <> s.name THEN UPDATE SET name = s.name
    WHEN NOT MATCHED THEN INSERT (id, name) VALUES (s.id, s.name);`, { json: J(data.companies) });
  await db.tx(async q => {
    await q(`
      MERGE pulse.at_project AS t
      USING (SELECT * FROM OPENJSON(@json) WITH (id INT, name NVARCHAR(300), number NVARCHAR(50), companyId INT, status INT, statusLabel NVARCHAR(100),
             typeLabel NVARCHAR(100), start DATETIME2(0), [end] DATETIME2(0), estimated DECIMAL(10,2), lead INT, pct DECIMAL(5,2))) AS s ON t.id = s.id
      WHEN MATCHED THEN UPDATE SET name = s.name, number = s.number, company_id = s.companyId, status = s.status, status_label = s.statusLabel, type_label = s.typeLabel,
           start_at = s.start, end_at = s.[end], estimated_hours = s.estimated, lead_resource_id = s.lead, completed_pct = s.pct, is_open = 1, synced_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (id, name, number, company_id, status, status_label, type_label, start_at, end_at, estimated_hours, lead_resource_id, completed_pct)
           VALUES (s.id, s.name, s.number, s.companyId, s.status, s.statusLabel, s.typeLabel, s.start, s.[end], s.estimated, s.lead, s.pct);`, { json: J(data.projects) });
    // Projects no longer active: closed in a full run (or named in a partial one).
    const gone = full ? null : J(data.closedIds);
    await q(full
      ? `UPDATE pulse.at_project SET is_open = 0 WHERE is_open = 1 AND id NOT IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids))`
      : `UPDATE pulse.at_project SET is_open = 0 WHERE id IN (SELECT CAST(value AS INT) FROM OPENJSON(@gone))`, { ids: J(projectIds), gone });
    const scope = full ? "project_id NOT IN (SELECT id FROM pulse.at_project WHERE is_open = 1) OR project_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids))"
      : "project_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids)) OR project_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@gone))";
    const params = { ids: J(projectIds), gone: J(data.closedIds) };
    await q(`DELETE FROM pulse.at_task_predecessor WHERE successor_task_id IN (SELECT id FROM pulse.at_task WHERE ${scope})`, params);
    await q(`DELETE FROM pulse.at_task_secondary WHERE task_id IN (SELECT id FROM pulse.at_task WHERE ${scope})`, params);
    await q(`DELETE FROM pulse.at_phase WHERE ${scope}`, params);
    // Tasks: update in place (keeps their date history), insert new, delete removed.
    await q(`
      MERGE pulse.at_task AS t
      USING (SELECT * FROM OPENJSON(@json) WITH (id INT, projectId INT, phaseId INT, title NVARCHAR(300), number NVARCHAR(50), status INT, complete BIT,
             start DATETIME2(0), [end] DATETIME2(0), estimated DECIMAL(10,2), remaining DECIMAL(10,2), worked DECIMAL(10,2), resource INT, role INT,
             completedAt DATETIME2(0))) AS s ON t.id = s.id
      WHEN MATCHED AND EXISTS (SELECT s.projectId, s.phaseId, s.title, s.number, s.status, s.complete, s.start, s.[end], s.estimated, s.remaining, s.worked, s.resource, s.role, s.completedAt
                               EXCEPT SELECT t.project_id, t.phase_id, t.title, t.task_number, t.status, t.is_complete, t.start_at, t.end_at, t.estimated_hours,
                                             t.remaining_hours, t.worked_hours, t.assigned_resource_id, t.assigned_role_id, t.completed_at)
        THEN UPDATE SET project_id = s.projectId, phase_id = s.phaseId, title = s.title, task_number = s.number, status = s.status, is_complete = s.complete,
             start_at = s.start, end_at = s.[end], estimated_hours = s.estimated, remaining_hours = s.remaining, worked_hours = s.worked,
             assigned_resource_id = s.resource, assigned_role_id = s.role, completed_at = s.completedAt
      WHEN NOT MATCHED BY TARGET THEN INSERT (id, project_id, phase_id, title, task_number, status, is_complete, start_at, end_at, estimated_hours, remaining_hours,
             worked_hours, assigned_resource_id, assigned_role_id, completed_at)
           VALUES (s.id, s.projectId, s.phaseId, s.title, s.number, s.status, s.complete, s.start, s.[end], s.estimated, s.remaining, s.worked, s.resource, s.role, s.completedAt);`,
      { json: J(data.tasks) });
    await q(`DELETE FROM pulse.at_task WHERE (${scope}) AND id NOT IN (SELECT CAST(value AS INT) FROM OPENJSON(@taskIds))`, { ...params, taskIds: J(data.tasks.map(t => t.id)) });
    await q(`INSERT INTO pulse.at_phase (id, project_id, parent_phase_id, title, start_at, due_at, estimated_hours, sort)
             SELECT id, projectId, parentId, title, start, due, estimated, sort FROM OPENJSON(@json)
               WITH (id INT, projectId INT, parentId INT, title NVARCHAR(300), start DATETIME2(0), due DATETIME2(0), estimated DECIMAL(10,2), sort INT)`, { json: J(data.phases) });
    await q(`INSERT INTO pulse.at_task_predecessor (id, predecessor_task_id, successor_task_id, lag_days)
             SELECT id, pred, succ, ISNULL(lag, 0) FROM OPENJSON(@json) WITH (id INT, pred INT, succ INT, lag INT)`, { json: J(data.preds) });
    await q(`INSERT INTO pulse.at_task_secondary (id, task_id, resource_id, role_id)
             SELECT id, taskId, resource, role FROM OPENJSON(@json) WITH (id INT, taskId INT, resource INT, role INT)`, { json: J(data.secondary) });
  });
}

/** Leave and public holidays, for resource capacity. Both optional: the planner works without them. */
async function syncCapacity(notes) {
  try {
    const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const statuses = await at.picklist(MOD, "TimeOffRequests", "status").catch(() => []);
    const bad = statuses.filter(s => /reject|cancel|denied/i.test(s.label)).map(s => s.value);
    const rows = (await at.query(MOD, "TimeOffRequests", [{ op: "gte", field: "timeOffDate", value: from }],
      await at.known(MOD, "TimeOffRequests", ["id", "resourceID", "timeOffDate", "timeOffHours", "status"])))
      .filter(r => !bad.includes(Number(r.status)));
    await db.tx(async q => {
      await q("DELETE FROM pulse.at_time_off WHERE day >= @from", { from });
      await q(`INSERT INTO pulse.at_time_off (id, resource_id, day, hours) SELECT id, resourceID, CAST(LEFT(timeOffDate, 10) AS DATE), ISNULL(timeOffHours, 7.6)
               FROM OPENJSON(@json) WITH (id INT, resourceID INT, timeOffDate NVARCHAR(40), timeOffHours DECIMAL(6,2))`, { json: J(rows) });
    });
  } catch (e) { notes.push(`Leave: ${e.message}`.slice(0, 200)); }
  try {
    const sets = await at.query(MOD, "HolidaySets", null, ["id", "holidaySetName"]);
    const [row] = await db.query("SELECT [value] FROM pulse.app_setting WHERE [key] = N'collect.holiday_set'");
    const set = calc.pickHolidaySet(sets, row && row.value);
    if (set) {
      const days = await at.query(MOD, "Holidays", [{ op: "eq", field: "holidaySetID", value: set.id }], ["id", "holidayDate", "holidayName"]);
      await db.tx(async q => {
        await q("DELETE FROM pulse.holiday");
        await q(`INSERT INTO pulse.holiday (day, name) SELECT DISTINCT CAST(LEFT(d, 10) AS DATE), MAX(nm) FROM OPENJSON(@json) WITH (d NVARCHAR(40) '$.holidayDate', nm NVARCHAR(200) '$.holidayName') GROUP BY CAST(LEFT(d, 10) AS DATE)`,
          { json: J(days) });
      });
    }
  } catch (e) { notes.push(`Holidays: ${e.message}`.slice(0, 200)); }
}

/** Full refresh (sync service). */
async function syncAll() {
  const data = await read();
  await save(data, { full: true });
  await syncCapacity(data.notes);
  return `${data.projects.length} active projects, ${data.tasks.length} tasks, ${data.preds.length} dependencies${data.notes.length ? "; " + data.notes.join("; ") : ""}`;
}

/** One or a few projects, straight after Pulse changed them (API). */
async function syncProjects(ids) {
  const data = await read(ids.map(Number));
  await save(data, { full: false });
  return data;
}

module.exports = { read, save, syncAll, syncProjects, statuses, CLOSED, NOT_REAL };
