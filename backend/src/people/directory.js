"use strict";
/**
 * People directory sync (D10, D16).
 *   syncEntra()      Microsoft Graph users → pulse.person (sync service only: needs Graph)
 *   syncAutotask()   Autotask departments, roles, resources and role-department pairings
 *                    → pulse.at_* (Autotask connection, people module; sync service, or the API on demand)
 *   runMatching()    links people to Autotask resources and rebuilds the Needs review list
 *                    (database only; both components can run it)
 *
 * Rows are only rewritten when something actually changed, so the temporal history shows real
 * changes (for example, the day someone's default department moved).
 */
const db = require("../lib/sql");
const at = require("../lib/autotask");
const M = require("./match");

const PEOPLE_CRED = at.SECRET;   // the single Autotask connection
const MOD = "people";

/* ------------------------------ Entra ------------------------------ */
async function syncEntra() {
  const graph = require("../lib/graph");
  const users = await graph.users();
  const people = users.filter(M.isPerson).map(u => ({
    oid: u.id, name: (u.displayName || `${u.givenName || ""} ${u.surname || ""}`).trim() || u.userPrincipalName,
    email: String(u.mail || u.userPrincipalName || "").toLowerCase(), upn: String(u.userPrincipalName || "").toLowerCase(),
    emails: JSON.stringify(M.userEmails(u)), jobTitle: u.jobTitle || null, department: u.department || null,
  }));
  const json = JSON.stringify(people);
  await db.query(`
    MERGE pulse.person AS t
    USING (SELECT * FROM OPENJSON(@json) WITH (oid NVARCHAR(64), name NVARCHAR(200), email NVARCHAR(320), upn NVARCHAR(320),
           emails NVARCHAR(2000), jobTitle NVARCHAR(200), department NVARCHAR(200))) AS s
       ON t.entra_oid = s.oid
    WHEN MATCHED AND EXISTS (SELECT s.name, s.email, s.upn, s.emails, s.jobTitle, s.department, CAST(1 AS BIT), CAST(1 AS BIT), CAST(1 AS BIT)
                             EXCEPT SELECT t.display_name, t.email, t.upn, t.emails_json, t.job_title, t.entra_department, t.account_enabled, t.is_licensed, t.is_active)
      THEN UPDATE SET display_name = s.name, email = s.email, upn = s.upn, emails_json = s.emails, job_title = s.jobTitle,
                      entra_department = s.department, account_enabled = 1, is_licensed = 1, is_active = 1
    WHEN NOT MATCHED BY TARGET
      THEN INSERT (entra_oid, display_name, email, upn, emails_json, job_title, entra_department, account_enabled, is_licensed, source)
           VALUES (s.oid, s.name, s.email, s.upn, s.emails, s.jobTitle, s.department, 1, 1, N'entra');`, { json });
  // People no longer in Entra as licensed, enabled members: no longer active (D10: leavers lose access in Entra).
  const keep = JSON.stringify(people.map(p => p.oid));
  const gone = await db.query(`
    UPDATE pulse.person SET is_active = 0, account_enabled = 0
    OUTPUT inserted.id, inserted.display_name
     WHERE is_active = 1 AND entra_oid NOT IN (SELECT value FROM OPENJSON(@keep))`, { keep });
  return { people: people.length, leavers: gone.length };
}

/* ------------------------------ Autotask ------------------------------ */
async function syncAutotask() {
  // Only ask for fields this Autotask has (e.g. Departments has no isActive); missing ones read as active.
  const q = async (entity, fields) => at.query(MOD, entity, null, await at.known(MOD, entity, fields));
  const [departments, roles, resources, rrds] = await Promise.all([
    q("Departments", ["id", "name", "isActive"]),
    q("Roles", ["id", "name", "isActive"]),
    q("Resources", ["id", "firstName", "lastName", "email", "email2", "email3", "userName", "title", "licenseType", "isActive"]),
    q("ResourceRoleDepartments", ["id", "resourceID", "departmentID", "roleID", "isDefault", "isActive", "isDepartmentLead"]),
  ]);
  await saveAutotask({ departments, roles, resources, rrds });
  return { departments: departments.length, roles: roles.length, resources: resources.length, pairings: rrds.length };
}

async function saveAutotask({ departments, roles, resources, rrds, onlyResourceIds = null }) {
  if (departments) await db.query(`
    MERGE pulse.at_department AS t
    USING (SELECT * FROM OPENJSON(@json) WITH (id INT, name NVARCHAR(200), isActive BIT)) AS s ON t.id = s.id
    WHEN MATCHED AND EXISTS (SELECT s.name, ISNULL(s.isActive, 1) EXCEPT SELECT t.name, t.is_active) THEN UPDATE SET name = s.name, is_active = ISNULL(s.isActive, 1)
    WHEN NOT MATCHED BY TARGET THEN INSERT (id, name, is_active) VALUES (s.id, s.name, ISNULL(s.isActive, 1));`, { json: JSON.stringify(departments) });
  if (roles) await db.query(`
    MERGE pulse.at_role AS t
    USING (SELECT * FROM OPENJSON(@json) WITH (id INT, name NVARCHAR(200), isActive BIT)) AS s ON t.id = s.id
    WHEN MATCHED AND EXISTS (SELECT s.name, ISNULL(s.isActive, 1) EXCEPT SELECT t.name, t.is_active) THEN UPDATE SET name = s.name, is_active = ISNULL(s.isActive, 1)
    WHEN NOT MATCHED BY TARGET THEN INSERT (id, name, is_active) VALUES (s.id, s.name, ISNULL(s.isActive, 1));`, { json: JSON.stringify(roles) });

  // Pairings: replace (for all resources, or just the ones given).
  const scope = onlyResourceIds ? JSON.stringify(onlyResourceIds) : null;
  await db.tx(async q => {
    await q(`DELETE FROM pulse.at_resource_role_department ${scope ? "WHERE resource_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@scope))" : ""}`, { scope });
    await q(`INSERT INTO pulse.at_resource_role_department (id, resource_id, department_id, role_id, is_default, is_active, is_department_lead)
             SELECT id, resourceID, departmentID, roleID, ISNULL(isDefault, 0), ISNULL(isActive, 1), ISNULL(isDepartmentLead, 0)
               FROM OPENJSON(@json) WITH (id BIGINT, resourceID INT, departmentID INT, roleID INT, isDefault BIT, isActive BIT, isDepartmentLead BIT)`,
      { json: JSON.stringify(rrds) });
  });

  // Resources, with their default department and role worked out from the pairings.
  const def = new Map(rrds.filter(r => r.isDefault && r.isActive !== false).map(r => [Number(r.resourceID), r]));
  const rows = (resources || []).map(r => {
    const d = def.get(Number(r.id));
    const e = v => (v ? String(v).trim().toLowerCase() : null);
    return { id: r.id, firstName: r.firstName || null, lastName: r.lastName || null, email: e(r.email), email2: e(r.email2), email3: e(r.email3),
      userName: r.userName || null, title: r.title || null, licenseType: r.licenseType ?? null, isActive: r.isActive !== false,
      dept: d ? d.departmentID : null, role: d ? d.roleID : null };
  });
  if (rows.length) await db.query(`
    MERGE pulse.at_resource AS t
    USING (SELECT * FROM OPENJSON(@json) WITH (id INT, firstName NVARCHAR(100), lastName NVARCHAR(100), email NVARCHAR(320), email2 NVARCHAR(320),
           email3 NVARCHAR(320), userName NVARCHAR(200), title NVARCHAR(200), licenseType INT, isActive BIT, dept INT, role INT)) AS s ON t.id = s.id
    WHEN MATCHED AND EXISTS (SELECT s.firstName, s.lastName, s.email, s.email2, s.email3, s.userName, s.title, s.licenseType, s.isActive, s.dept, s.role
                             EXCEPT SELECT t.first_name, t.last_name, t.email, t.email2, t.email3, t.user_name, t.title, t.license_type, t.is_active, t.default_department_id, t.default_role_id)
      THEN UPDATE SET first_name = s.firstName, last_name = s.lastName, email = s.email, email2 = s.email2, email3 = s.email3, user_name = s.userName,
                      title = s.title, license_type = s.licenseType, is_active = s.isActive, default_department_id = s.dept, default_role_id = s.role
    WHEN NOT MATCHED BY TARGET
      THEN INSERT (id, first_name, last_name, email, email2, email3, user_name, title, license_type, is_active, default_department_id, default_role_id)
           VALUES (s.id, s.firstName, s.lastName, s.email, s.email2, s.email3, s.userName, s.title, s.licenseType, s.isActive, s.dept, s.role);`,
    { json: JSON.stringify(rows) });
}

/* ------------------------------ matching ------------------------------ */
async function runMatching() {
  const [persons, resources, links, nones] = await Promise.all([
    db.query("SELECT id, display_name, email, emails_json FROM pulse.person WHERE is_active = 1 AND ISNULL(account_enabled, 1) = 1"),
    db.query("SELECT id, first_name, last_name, email, email2, email3, is_active FROM pulse.at_resource"),
    db.query("SELECT person_id, external_id, source FROM pulse.person_link WHERE system = N'autotask'"),
    db.query("SELECT person_id FROM pulse.person_link_none WHERE system = N'autotask'"),
  ]);
  const parse = s => { try { return JSON.parse(s || "[]"); } catch { return []; } };
  const result = M.match({
    persons: persons.map(p => ({ id: p.id, name: p.display_name, emails: [...new Set([...parse(p.emails_json), p.email].map(M.clean).filter(Boolean))] })),
    resources: resources.map(r => ({ id: r.id, name: `${r.first_name || ""} ${r.last_name || ""}`.trim(), emails: M.resourceEmails(r), active: !!r.is_active, person: M.looksLikePerson(r) })),
    adminLinks: new Map(links.filter(l => l.source === "admin").map(l => [l.person_id, Number(l.external_id)])),
    noneSet: new Set(nones.map(n => n.person_id)),
  });
  const want = JSON.stringify(result.links.map(l => ({ p: l.personId, r: String(l.resourceId), e: l.email })));
  const review = JSON.stringify(result.review.map(r => ({ k: r.kind, p: r.personId, x: r.externalIds.join(","), d: r.detail })));
  const changes = await db.tx(async q => {
    // Email links that no longer hold are removed; admin links are never touched here.
    const removed = await q(`DELETE l OUTPUT deleted.person_id FROM pulse.person_link l
      WHERE l.system = N'autotask' AND l.source = N'email'
        AND NOT EXISTS (SELECT 1 FROM OPENJSON(@want) WITH (p INT, r NVARCHAR(100)) w WHERE w.p = l.person_id AND w.r = l.external_id)`, { want });
    const added = await q(`INSERT INTO pulse.person_link (person_id, system, external_id, source, matched_email)
      OUTPUT inserted.person_id
      SELECT w.p, N'autotask', w.r, N'email', w.e FROM OPENJSON(@want) WITH (p INT, r NVARCHAR(100), e NVARCHAR(320)) w
       WHERE NOT EXISTS (SELECT 1 FROM pulse.person_link l WHERE l.system = N'autotask' AND (l.person_id = w.p OR l.external_id = w.r))`, { want });
    await q("DELETE FROM pulse.directory_review WHERE system = N'autotask'");
    await q(`INSERT INTO pulse.directory_review (system, kind, person_id, external_ids, detail)
      SELECT N'autotask', k, p, x, d FROM OPENJSON(@review) WITH (k NVARCHAR(30), p INT, x NVARCHAR(400), d NVARCHAR(500))`, { review });
    return { added: added.length, removed: removed.length };
  });
  return { linked: result.links.length, review: result.review.length, ...changes };
}

module.exports = { syncEntra, syncAutotask, saveAutotask, runMatching, PEOPLE_CRED };
