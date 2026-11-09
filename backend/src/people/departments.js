"use strict";
/**
 * Changing someone's default Autotask department (D16), through the people module of the Autotask connection.
 *
 * Autotask keeps a person's departments as ResourceRoleDepartments (resource, department, role).
 * Exactly one is the default. Setting another one to default makes Autotask clear the old one.
 *   1. If the person already has an active pairing with the new department, make it the default
 *      (preferring the role they have now, or the role asked for).
 *   2. Otherwise create a pairing with the new department, using the role asked for or the role
 *      of their current default, and make it the default.
 * Then re-read that person's pairings so Pulse shows the change straight away.
 */
const at = require("../lib/autotask");
const { fail } = require("../lib/errors");
const { saveAutotask, PEOPLE_CRED } = require("./directory");

const FIELDS = ["id", "resourceID", "departmentID", "roleID", "isDefault", "isActive", "isDepartmentLead"];

/** Works out what to do, without calling Autotask (tested on its own). */
function plan(pairings, departmentId, roleId) {
  const current = pairings.find(p => p.isDefault && p.isActive !== false) || null;
  if (current && Number(current.departmentID) === Number(departmentId) && (!roleId || Number(current.roleID) === Number(roleId))) {
    return { action: "none", current };
  }
  const inDept = pairings.filter(p => Number(p.departmentID) === Number(departmentId) && p.isActive !== false);
  const preferRole = roleId || (current && current.roleID);
  const existing = inDept.find(p => Number(p.roleID) === Number(preferRole)) || (!roleId && inDept[0]) || null;
  if (existing) return { action: "set-default", current, id: existing.id, roleId: existing.roleID };
  const role = roleId || (current && current.roleID);
  if (!role) return { action: "need-role", current };
  return { action: "create", current, roleId: role };
}

async function changeDefault(resourceId, departmentId, roleId = null) {
  const before = await at.query("people", "ResourceRoleDepartments", [{ op: "eq", field: "resourceID", value: Number(resourceId) }], FIELDS);
  const p = plan(before, departmentId, roleId);
  if (p.action === "need-role") throw fail(400, "This person has no default role to carry over. Choose a role for the new department.");
  if (p.action === "set-default") await at.update("people", "ResourceRoleDepartments", { id: p.id, isDefault: true });
  if (p.action === "create") {
    await at.create("people", "ResourceRoleDepartments", {
      resourceID: Number(resourceId), departmentID: Number(departmentId), roleID: Number(p.roleId), isDefault: true, isActive: true,
    });
  }
  const after = p.action === "none" ? before
    : await at.query("people", "ResourceRoleDepartments", [{ op: "eq", field: "resourceID", value: Number(resourceId) }], FIELDS);
  const now = after.find(x => x.isDefault && x.isActive !== false);
  if (p.action !== "none" && (!now || Number(now.departmentID) !== Number(departmentId))) {
    throw fail(502, "Autotask didn't apply the change. Check the person's departments in Autotask.");
  }
  const [res] = await at.query("people", "Resources", [{ op: "eq", field: "id", value: Number(resourceId) }],
    ["id", "firstName", "lastName", "email", "email2", "email3", "userName", "title", "licenseType", "isActive"]);
  await saveAutotask({ resources: res ? [res] : [], rrds: after, onlyResourceIds: [Number(resourceId)] });
  return {
    action: p.action,
    from: p.current ? { departmentId: p.current.departmentID, roleId: p.current.roleID } : null,
    to: now ? { departmentId: now.departmentID, roleId: now.roleID } : null,
  };
}

module.exports = { plan, changeDefault };
