"use strict";
/**
 * People and departments (D10, D16).
 *   GET  /people                         directory: people, their Autotask link and department; Needs review; last syncs
 *   GET  /people/departments             Autotask departments with their people (default department), and roles
 *   POST /people/:id/link                { resourceId | none: true | automatic: true, reason }  (Platform Admins)
 *   POST /people/departments/change      { resourceIds: [], departmentId, roleId?, reason }      (Leadership, Platform Admins)
 *   POST /people/sync                    { job: "departments" | "directory" }                    refresh now
 */
const db = require("../lib/sql");
const audit = require("../lib/audit");
const { fail } = require("../lib/errors");
const { requireReason } = require("../eos/logic");
const directory = require("../people/directory");
const departments = require("../people/departments");

const canView = a => a.leadership || a.manageDirectory;
const actor = ctx => ({ oid: ctx.person.oid, name: ctx.person.name });
const reasonOf = ctx => {
  const r = requireReason(ctx.body.reason);
  if (!r) throw fail(400, "Please give a reason (at least a few words). It's kept in the audit log.");
  return r;
};

async function lastRuns() {
  const rows = await db.query(`SELECT job, MAX(finished_at) AS at FROM pulse.sync_run WHERE ok = 1 AND job IN (N'directory', N'departments') GROUP BY job`);
  return Object.fromEntries(rows.map(r => [r.job, r.at]));
}

async function list() {
  const [people, review, runs] = await Promise.all([
    db.query(`SELECT p.id, p.display_name, p.email, p.job_title, p.entra_department, p.is_active, p.source,
                     l.external_id AS resource_id, l.source AS link_source, l.matched_email, l.linked_by,
                     r.first_name, r.last_name, r.email AS at_email, r.is_active AS at_active,
                     d.name AS department, ro.name AS role, n.reason AS none_reason,
                     a.last_sign_in_at
                FROM pulse.person p
                LEFT JOIN pulse.person_link l ON l.person_id = p.id AND l.system = N'autotask'
                LEFT JOIN pulse.at_resource r ON r.id = TRY_CAST(l.external_id AS INT)
                LEFT JOIN pulse.at_department d ON d.id = r.default_department_id
                LEFT JOIN pulse.at_role ro ON ro.id = r.default_role_id
                LEFT JOIN pulse.person_link_none n ON n.person_id = p.id AND n.system = N'autotask'
                LEFT JOIN pulse.person_activity a ON a.person_id = p.id
               WHERE p.is_active = 1
               ORDER BY p.display_name`),
    db.query(`SELECT v.id, v.kind, v.person_id, v.external_ids, v.detail, p.display_name
                FROM pulse.directory_review v LEFT JOIN pulse.person p ON p.id = v.person_id
               WHERE v.system = N'autotask' ORDER BY v.kind, p.display_name`),
    lastRuns(),
  ]);
  return {
    lastSync: runs,
    people: people.map(p => ({
      id: p.id, name: p.display_name, email: p.email, jobTitle: p.job_title, entraDepartment: p.entra_department,
      lastSignIn: p.last_sign_in_at, fromEntra: p.source === "entra",
      autotask: p.resource_id ? { resourceId: Number(p.resource_id), name: `${p.first_name || ""} ${p.last_name || ""}`.trim(), email: p.at_email,
        active: !!p.at_active, department: p.department, role: p.role, linkedBy: p.link_source === "admin" ? (p.linked_by || "Platform Admin") : "email",
        matchedEmail: p.matched_email } : null,
      noAutotask: p.none_reason ? { reason: p.none_reason } : null,
    })),
    review: review.map(r => ({ id: r.id, kind: r.kind, personId: r.person_id, personName: r.display_name,
      resourceIds: r.external_ids ? r.external_ids.split(",").filter(Boolean).map(Number) : [], detail: r.detail })),
  };
}

async function departmentList() {
  const [depts, roles, resources, people, runs] = await Promise.all([
    db.query("SELECT id, name, is_active FROM pulse.at_department ORDER BY name"),
    db.query("SELECT id, name FROM pulse.at_role WHERE is_active = 1 ORDER BY name"),
    db.query(`SELECT r.id, r.first_name, r.last_name, r.email, r.title, r.default_department_id, r.default_role_id, ro.name AS role
                FROM pulse.at_resource r LEFT JOIN pulse.at_role ro ON ro.id = r.default_role_id
               WHERE r.is_active = 1 AND r.first_name IS NOT NULL AND r.last_name IS NOT NULL ORDER BY r.first_name, r.last_name`),
    db.query(`SELECT l.external_id, p.display_name FROM pulse.person_link l JOIN pulse.person p ON p.id = l.person_id WHERE l.system = N'autotask'`),
    lastRuns(),
  ]);
  const inPulse = new Map(people.map(p => [Number(p.external_id), p.display_name]));
  const shape = r => ({ resourceId: r.id, name: `${r.first_name} ${r.last_name}`.trim(), email: r.email, title: r.title, role: r.role, inPulse: inPulse.get(r.id) || null });
  return {
    lastSync: runs,
    roles: roles.map(r => ({ id: r.id, name: r.name })),
    departments: depts.map(d => ({ id: d.id, name: d.name, active: !!d.is_active,
      isServiceDesk: /^service desk$/i.test(d.name.trim()),
      people: resources.filter(r => r.default_department_id === d.id).map(shape) })),
    noDepartment: resources.filter(r => !r.default_department_id).map(shape),
  };
}

async function setLink(ctx) {
  const personId = Number(ctx.params.id);
  if (!Number.isInteger(personId)) throw fail(400, "Person isn't valid.");
  const [p] = await db.query("SELECT id, display_name FROM pulse.person WHERE id = @personId", { personId });
  if (!p) throw fail(404, "That person isn't in Pulse.");
  const reason = reasonOf(ctx);
  const [before] = await db.query("SELECT external_id, source FROM pulse.person_link WHERE person_id = @personId AND system = N'autotask'", { personId });
  let after;
  if (ctx.body.automatic) {
    await db.tx(async q => {
      await q("DELETE FROM pulse.person_link WHERE person_id = @personId AND system = N'autotask'", { personId });
      await q("DELETE FROM pulse.person_link_none WHERE person_id = @personId AND system = N'autotask'", { personId });
    });
    after = { automatic: true };
  } else if (ctx.body.none) {
    await db.tx(async q => {
      await q("DELETE FROM pulse.person_link WHERE person_id = @personId AND system = N'autotask'", { personId });
      await q(`MERGE pulse.person_link_none AS t USING (SELECT @personId AS person_id) AS s ON t.person_id = s.person_id AND t.system = N'autotask'
               WHEN MATCHED THEN UPDATE SET set_by = @by, reason = @reason, set_at = SYSUTCDATETIME()
               WHEN NOT MATCHED THEN INSERT (person_id, system, set_by, reason) VALUES (@personId, N'autotask', @by, @reason);`, { personId, by: ctx.person.name, reason });
    });
    after = { noAutotask: true };
  } else {
    const resourceId = Number(ctx.body.resourceId);
    const [r] = await db.query("SELECT id, first_name, last_name, is_active FROM pulse.at_resource WHERE id = @resourceId", { resourceId });
    if (!r) throw fail(400, "That Autotask resource isn't in Pulse yet. Refresh from Autotask first.");
    const [taken] = await db.query(`SELECT p.display_name FROM pulse.person_link l JOIN pulse.person p ON p.id = l.person_id
                                     WHERE l.system = N'autotask' AND l.external_id = @rid AND l.person_id <> @personId`, { rid: String(resourceId), personId });
    if (taken) throw fail(409, `${r.first_name} ${r.last_name} is already linked to ${taken.display_name}. Unlink them first.`);
    await db.tx(async q => {
      await q("DELETE FROM pulse.person_link WHERE person_id = @personId AND system = N'autotask'", { personId });
      await q("DELETE FROM pulse.person_link_none WHERE person_id = @personId AND system = N'autotask'", { personId });
      await q(`INSERT INTO pulse.person_link (person_id, system, external_id, source, linked_by, reason)
               VALUES (@personId, N'autotask', @rid, N'admin', @by, @reason)`, { personId, rid: String(resourceId), by: ctx.person.name, reason });
    });
    after = { resourceId, name: `${r.first_name || ""} ${r.last_name || ""}`.trim() };
  }
  await directory.runMatching();
  await audit.record({ actor: actor(ctx), action: "directory.link", entity: { type: "person", id: personId },
    before: before ? { resourceId: before.external_id, source: before.source } : null, after, reason, request: ctx.request }, ctx.context);
  return { ok: true };
}

async function changeDepartments(ctx) {
  const ids = Array.isArray(ctx.body.resourceIds) ? [...new Set(ctx.body.resourceIds.map(Number))] : [];
  if (!ids.length || ids.some(n => !Number.isInteger(n) || n <= 0)) throw fail(400, "Choose at least one person.");
  if (ids.length > 50) throw fail(400, "Change up to 50 people at a time.");
  const departmentId = Number(ctx.body.departmentId);
  const [dept] = await db.query("SELECT id, name, is_active FROM pulse.at_department WHERE id = @departmentId", { departmentId });
  if (!dept || !dept.is_active) throw fail(400, "Choose an active department.");
  const roleId = ctx.body.roleId ? Number(ctx.body.roleId) : null;
  if (roleId) { const [r] = await db.query("SELECT id FROM pulse.at_role WHERE id = @roleId AND is_active = 1", { roleId }); if (!r) throw fail(400, "Choose an active role."); }
  const reason = reasonOf(ctx);
  const names = new Map((await db.query("SELECT id, name FROM pulse.at_department")).map(d => [d.id, d.name]));
  const results = [];
  for (const rid of ids) {
    try {
      const r = await departments.changeDefault(rid, departmentId, roleId);
      results.push({ resourceId: rid, ok: true, action: r.action });
      if (r.action !== "none") {
        await audit.record({ actor: actor(ctx), action: "department.change", entity: { type: "autotask-resource", id: rid },
          before: r.from ? { department: names.get(r.from.departmentId) || r.from.departmentId, roleId: r.from.roleId } : null,
          after: { department: dept.name, roleId: r.to && r.to.roleId }, reason, request: ctx.request }, ctx.context);
      }
    } catch (e) {
      results.push({ resourceId: rid, ok: false, error: e.expose ? e.message : "Autotask didn't accept the change." });
      if (ctx.context && ctx.context.warn) ctx.context.warn(`department change for ${rid} failed: ${e.message}`);
    }
  }
  return { department: dept.name, results, changed: results.filter(r => r.ok && r.action !== "none").length, failed: results.filter(r => !r.ok).length };
}

async function sync(ctx) {
  const job = ctx.body.job;
  if (job === "departments") {
    if (!(ctx.access.changeDepartments || ctx.access.manageDirectory)) throw fail(403, "You can't refresh departments.");
    const started = new Date();
    const [{ id }] = await db.query("INSERT INTO pulse.sync_run (job, started_at) OUTPUT inserted.id VALUES (N'departments', @started)", { started });
    try {
      const a = await directory.syncAutotask();
      const m = await directory.runMatching();
      const detail = `On demand by ${ctx.person.name}: ${a.resources} resources, ${a.departments} departments; ${m.linked} linked, ${m.review} to review`;
      await db.query("UPDATE pulse.sync_run SET finished_at = SYSUTCDATETIME(), ok = 1, detail = @detail WHERE id = @id", { id, detail });
      return { ok: true, detail };
    } catch (e) {
      await db.query("UPDATE pulse.sync_run SET finished_at = SYSUTCDATETIME(), ok = 0, detail = @detail WHERE id = @id", { id, detail: String(e.message).slice(0, 2000) });
      throw e.expose ? e : fail(502, "Couldn't read Autotask. Try again in a minute.");
    }
  }
  if (job === "directory") {
    if (!ctx.access.manageDirectory) throw fail(403, "Only Platform Admins can refresh the directory.");
    await db.query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (N'directory', @by)", { by: ctx.person.name });
    return { ok: true, queued: true, detail: "Asked the sync service to refresh from Entra and Autotask. It starts within two minutes." };
  }
  throw fail(400, "Unknown job.");
}

const routes = [
  { method: "GET", path: "/people", auth: "person", allow: canView, fn: list },
  { method: "GET", path: "/people/departments", auth: "person", allow: canView, fn: departmentList },
  { method: "POST", path: "/people/departments/change", auth: "person", allow: a => a.changeDepartments, fn: changeDepartments },
  { method: "POST", path: "/people/sync", auth: "person", fn: sync },
  { method: "POST", path: "/people/:id/link", auth: "person", allow: a => a.manageDirectory, fn: setLink },
];
module.exports = { routes };
