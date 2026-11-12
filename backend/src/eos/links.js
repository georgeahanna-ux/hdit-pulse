"use strict";
/**
 * Two-way links (D11, 0.8.0), the API side.
 *   GET    /links/options?for=issue|rock      what an Issue or Rock can link to
 *   POST   /issues/:id/autotask  { kind: ticket|task, title, description, queueId, priority, dueDate, projectId, phaseId, estimatedHours }
 *   PUT    /rocks/:id/link       { kind: autotask_project|planner_plan, ref }
 *   DELETE /rocks/:id/link
 *   PUT    /planner/plan         { link }   (Platform Admins) the "Pulse – L10" plan To-dos sync with
 * Autotask writes use Pulse's single API user through the "issues" module, which may only create
 * tickets and project tasks (lib/autotask.js POLICY). Every link is audited.
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const at = require("../lib/autotask");
const C = require("./common");

const MOD = "issues";

/* ------------------------------ helpers ------------------------------ */
async function settings(keys) {
  const rows = await db.query(`SELECT [key], [value] FROM pulse.app_setting WHERE [key] IN (${keys.map((_, i) => "@k" + i).join(",")})`,
    Object.fromEntries(keys.map((k, i) => ["k" + i, k])));
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
async function webUrl() { return String((await settings(["autotask.web_url"]))["autotask.web_url"] || "https://ww29.autotask.net").replace(/\/+$/, ""); }

/** A link to open an Autotask ticket, task or project in Autotask's web app. */
function autotaskUrl(base, kind, id) {
  const code = { ticket: ["OpenTicketDetail", "TicketID"], task: ["OpenTaskDetail", "TaskID"], project: ["OpenProject", "ProjectID"], company: ["OpenAccount", "AccountID"] }[kind];
  return `${base}/Autotask/AutotaskExtend/ExecuteCommand.aspx?Code=${code[0]}&${code[1]}=${Number(id)}`;
}

/** A Planner plan's id from a link copied from Planner (any of its address styles) or the id itself. */
function planIdFrom(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  for (const re of [/[?&#]planId=([A-Za-z0-9_-]{10,})/i, /\/plan\/([A-Za-z0-9_-]{10,})/i, /PlanViews\/([A-Za-z0-9_-]{10,})/i, /\/plans\/([A-Za-z0-9_-]{10,})/i]) {
    const m = re.exec(s); if (m) return m[1];
  }
  return /^[A-Za-z0-9_-]{15,60}$/.test(s) ? s : null;
}

/** Fills required picklist fields Pulse wasn't given with Autotask's default (or first active) value. */
function fillRequired(fields, body) {
  const out = { ...body };
  for (const f of fields) {
    if (!f.isRequired || f.isReadOnly || out[f.name] !== undefined || !f.isPickList) continue;
    const values = (f.picklistValues || []).filter(v => v.isActive !== false);
    const pick = values.find(v => v.isDefaultValue) || values[0];
    if (pick) out[f.name] = Number(pick.value);
  }
  return out;
}
const pickValues = f => (f && f.isPickList ? (f.picklistValues || []).filter(v => v.isActive !== false).map(v => ({ v: Number(v.value), t: v.label, d: !!v.isDefaultValue })) : []);
const newStatus = f => { const vs = pickValues(f); return (vs.find(v => /^new$/i.test(v.t)) || vs.find(v => v.d) || vs[0] || {}).v; };

/** Open Autotask projects Pulse knows about (from the projects sync). */
async function openProjects() {
  const rows = await db.query(`SELECT p.id, p.name, p.number, c.name AS client FROM pulse.at_project p LEFT JOIN pulse.at_company c ON c.id = p.company_id
      WHERE p.is_open = 1 ORDER BY c.name, p.name`);
  return rows.map(p => ({ id: p.id, name: p.name, number: p.number, client: p.client }));
}

/* ------------------------------ routes ------------------------------ */
async function options(ctx) {
  const kind = ctx.query.for;
  if (kind === "rock") {
    const plans = await db.query("SELECT id, title, group_name FROM pulse.planner_plan ORDER BY title");
    return { projects: await openProjects(), plans: plans.map(p => ({ id: p.id, title: p.title, group: p.group_name })) };
  }
  if (kind !== "issue") throw C.fail(400, "Options are for an issue or a rock.");
  const [tickets, phases] = await Promise.all([at.fields(MOD, "Tickets"), db.query("SELECT id, project_id, title FROM pulse.at_phase ORDER BY project_id, sort, id")]);
  const f = n => tickets.find(x => x.name === n);
  const priorities = pickValues(f("priority"));
  return {
    queues: pickValues(f("queueID")).map(({ v, t }) => ({ v, t })),
    priorities: priorities.map(({ v, t }) => ({ v, t })), defaultPriority: (priorities.find(p => p.d) || priorities.find(p => /medium|normal/i.test(p.t)) || priorities[0] || {}).v ?? null,
    projects: await openProjects(),
    phases: phases.map(p => ({ id: p.id, projectId: p.project_id, title: p.title })),
    dueDate: time.addDays(time.sydneyDate(), 7),
  };
}

async function issueToAutotask(ctx) {
  const id = C.int(ctx.params.id);
  const [i] = await db.query("SELECT * FROM pulse.issue WHERE id = @id", { id });
  if (!i || !require("./issues")._test.canSee(ctx, i)) throw C.fail(404, "That Issue doesn't exist.");
  const [existing] = await db.query("SELECT kind, at_id FROM pulse.issue_link WHERE issue_id = @id", { id });
  if (existing) throw C.fail(409, `This Issue already has an Autotask ${existing.kind}.`);
  const b = ctx.body;
  if (!["ticket", "task"].includes(b.kind)) throw C.fail(400, "Choose a ticket or a project task.");
  const title = C.text(b.title || i.title, 255, { required: true, label: "Title" });
  const note = `From HD IT Pulse: Issue #${i.id} on the ${i.level === "company" ? "leadership team's" : i.division_code} Issues List, raised by ${i.raised_by_name}. Created in Autotask by ${ctx.person.name}.`;
  const description = [C.text(b.description, 6000) || i.description, note].filter(Boolean).join("\n\n");
  let created, projectId = null;
  if (b.kind === "ticket") {
    const fields = await at.fields(MOD, "Tickets");
    const f = n => fields.find(x => x.name === n);
    const due = C.date(b.dueDate) || time.addDays(time.sydneyDate(), 7);
    const company = Number((await settings(["autotask.internal_company_id"]))["autotask.internal_company_id"] || 0);
    const body = fillRequired(fields, {
      companyID: company, title, description, status: newStatus(f("status")),
      priority: b.priority !== undefined && b.priority !== "" ? Number(b.priority) : undefined,
      queueID: b.queueId !== undefined && b.queueId !== "" ? Number(b.queueId) : undefined,
      dueDateTime: time.sydneyToUtc(due, 17, 0).toISOString(),
    });
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    created = await at.create(MOD, "Tickets", body);
  } else {
    projectId = C.int(b.projectId, "Project");
    const [p] = await db.query("SELECT id FROM pulse.at_project WHERE id = @id AND is_open = 1", { id: projectId });
    if (!p) throw C.fail(400, "Choose an open Autotask project.");
    const fields = await at.fields(MOD, "Tasks");
    const f = n => fields.find(x => x.name === n);
    const start = time.sydneyDate(), end = C.date(b.dueDate) || time.addDays(start, 7);
    const hours = b.estimatedHours === undefined || b.estimatedHours === "" ? null : Number(b.estimatedHours);
    if (hours !== null && !(hours >= 0 && hours <= 1000)) throw C.fail(400, "Estimated hours must be between 0 and 1,000.");
    const body = fillRequired(fields, {
      title, description, status: newStatus(f("status")), projectID: projectId,
      startDateTime: time.sydneyToUtc(start, 9, 0).toISOString(), endDateTime: time.sydneyToUtc(end, 17, 0).toISOString(),
      ...(hours !== null ? { estimatedHours: hours } : {}), ...(b.phaseId ? { phaseID: C.int(b.phaseId, "Phase") } : {}),
    });
    created = await at.create(MOD, "Tasks", body, ["Projects", projectId]);
  }
  const atId = Number(created && (created.itemId ?? created.id));
  if (!atId) throw C.fail(502, "Autotask didn't say what it created. Check Autotask before trying again.");
  let number = null, status = null;
  try {
    const entity = b.kind === "ticket" ? "Tickets" : "Tasks";
    const [row] = await at.query(MOD, entity, [{ op: "eq", field: "id", value: atId }], ["id", b.kind === "ticket" ? "ticketNumber" : "taskNumber", "status"]);
    const statuses = await at.picklist(MOD, entity, "status");
    number = row ? row.ticketNumber || row.taskNumber || null : null;
    status = row ? (statuses.find(s => s.value === Number(row.status)) || {}).label || null : null;
  } catch { /* the 5-minute job fills these in */ }
  await db.query(`INSERT INTO pulse.issue_link (issue_id, kind, at_id, project_id, number, title, status_label, created_by, checked_at)
      VALUES (@id, @kind, @atId, @projectId, @number, @title, @status, @by, SYSUTCDATETIME())`,
    { id, kind: b.kind, atId, projectId, number, title, status, by: ctx.person.name });
  await C.record(ctx, `issue.autotask.${b.kind}`, { type: "issue", id }, null, { autotaskId: atId, number, projectId, title });
  return { kind: b.kind, id: atId, number, status, url: autotaskUrl(await webUrl(), b.kind, atId) };
}

async function loadRock(ctx) {
  const id = C.int(ctx.params.id);
  const [r] = await db.query("SELECT * FROM pulse.rock WHERE id = @id", { id });
  const R = require("./rocks")._test;
  if (!r || !R.canSee(ctx, r)) throw C.fail(404, "That Rock doesn't exist.");
  if (!R.canEdit(ctx, r)) throw C.fail(403, "Only the Rock's owner or Leadership links it.");
  return r;
}

async function linkRock(ctx) {
  const r = await loadRock(ctx);
  const b = ctx.body;
  let ref, name = null, pct = null, detail = null;
  if (b.kind === "autotask_project") {
    ref = String(C.int(b.ref, "Project"));
    const p = await require("../links/progress").projectProgress(Number(ref));
    if (p.pct === null) throw C.fail(400, "Pulse doesn't have that Autotask project. Choose an open project.");
    ({ pct, name, detail } = p);
  } else if (b.kind === "planner_plan") {
    ref = planIdFrom(b.ref);
    if (!ref) throw C.fail(400, "That doesn't look like a Planner plan. Choose one, or paste the plan's link from Planner.");
    const [plan] = await db.query("SELECT title FROM pulse.planner_plan WHERE id = @id", { id: ref });
    name = plan ? plan.title : null;
    detail = "Progress fills in within 5 minutes.";
  } else throw C.fail(400, "Link a Rock to an Autotask project or a Planner plan.");
  await db.query(`MERGE pulse.rock_link AS t USING (SELECT @id AS rock_id) AS s ON t.rock_id = s.rock_id
      WHEN MATCHED THEN UPDATE SET kind = @kind, ref = @ref, name = @name, pct = @pct, detail = @detail, linked_by = @by, linked_at = SYSUTCDATETIME(), checked_at = NULL, last_error = NULL
      WHEN NOT MATCHED THEN INSERT (rock_id, kind, ref, name, pct, detail, linked_by) VALUES (@id, @kind, @ref, @name, @pct, @detail, @by);`,
    { id: r.id, kind: b.kind, ref, name, pct, detail, by: ctx.person.name });
  if (b.kind === "planner_plan") await db.query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (N'links', @by)", { by: ctx.person.name });
  await C.record(ctx, "rock.link", { type: "rock", id: r.id }, null, { kind: b.kind, ref, name });
  return { ok: true };
}

async function unlinkRock(ctx) {
  const r = await loadRock(ctx);
  const [l] = await db.query("SELECT kind, ref, name FROM pulse.rock_link WHERE rock_id = @id", { id: r.id });
  if (!l) return { ok: true };
  await db.query("DELETE FROM pulse.rock_link WHERE rock_id = @id", { id: r.id });
  await C.record(ctx, "rock.unlink", { type: "rock", id: r.id }, { kind: l.kind, ref: l.ref, name: l.name }, null);
  return { ok: true };
}

async function setPlan(ctx) {
  if (!ctx.access.manageConnections) throw C.fail(403, "Only Platform Admins change connections.");
  const raw = String(ctx.body.link || "").trim();
  const id = raw ? planIdFrom(raw) : null;
  if (raw && !id) throw C.fail(400, "That doesn't look like a Planner plan link. In Planner, open the plan, select … next to its name, then Copy link to plan.");
  const [before] = await db.query("SELECT [value] FROM pulse.app_setting WHERE [key] = N'planner.l10_plan_id'");
  await db.query(`MERGE pulse.app_setting AS t USING (SELECT N'planner.l10_plan_id' AS [key]) AS s ON t.[key] = s.[key]
      WHEN MATCHED THEN UPDATE SET [value] = @v, updated_by = @by WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (N'planner.l10_plan_id', @v, @by);`, { v: id, by: ctx.person.name });
  if (id) await db.query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (N'links', @by)", { by: ctx.person.name });
  await C.record(ctx, "connection.planner.plan", { type: "connection", id: "planner" }, { planId: before ? before.value : null }, { planId: id }, C.text(ctx.body.reason, 500) || undefined);
  return { planId: id };
}

/** For the Connections page. */
async function plannerStatus() {
  const s = await settings(["planner.l10_plan_id"]);
  const planId = s["planner.l10_plan_id"] || null;
  const [plan] = planId ? await db.query("SELECT title, group_name, checked_at FROM pulse.planner_plan WHERE id = @id", { id: planId }) : [];
  const [counts] = await db.query("SELECT COUNT(*) AS linked, SUM(CASE WHEN last_error IS NULL THEN 0 ELSE 1 END) AS errors FROM pulse.todo_planner");
  const [run] = await db.query("SELECT TOP 1 finished_at, ok, detail FROM pulse.sync_run WHERE job = N'links' AND finished_at IS NOT NULL ORDER BY id DESC");
  return { planId, title: plan ? plan.title : null, group: plan ? plan.group_name : null, checkedAt: plan ? plan.checked_at : null,
    linkedTodos: counts ? counts.linked : 0, errors: counts ? counts.errors || 0 : 0,
    lastRun: run ? { at: run.finished_at, ok: !!run.ok, detail: run.detail } : null };
}

const routes = [
  { method: "GET", path: "/links/options", auth: "person", fn: options },
  { method: "POST", path: "/issues/:id/autotask", auth: "person", fn: issueToAutotask },
  { method: "PUT", path: "/rocks/:id/link", auth: "person", fn: linkRock },
  { method: "DELETE", path: "/rocks/:id/link", auth: "person", fn: unlinkRock },
  { method: "PUT", path: "/planner/plan", auth: "person", fn: setPlan },
];

module.exports = { routes, plannerStatus, autotaskUrl, webUrl, _test: { planIdFrom, fillRequired, autotaskUrl, newStatus } };
