"use strict";
/**
 * Connections page (D7): Platform Admins only.
 *   GET    /connections               every credential: what it's for, status, owner, rotation due (never values)
 *   PUT    /connections/:name         { ...fields, owner, rotationDue, reason }  enter or replace (tested first where possible)
 *   PATCH  /connections/:name         { owner, rotationDue }                     details only
 *   DELETE /connections/:name         { reason }                                 remove: puts the placeholder back
 */
const db = require("../lib/sql");
const vault = require("../lib/vault");
const creds = require("../lib/credentials");
const audit = require("../lib/audit");
const { fail } = require("../lib/errors");
const { requireReason } = require("../eos/logic");

const admin = a => a.manageConnections;
const actor = ctx => ({ oid: ctx.person.oid, name: ctx.person.name });

function day(v) {
  if (v === undefined) return undefined;
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw fail(400, "Rotation due must be a date.");
  return s;
}

async function list() {
  const rows = await db.query(`SELECT name, configured, secret_updated_at, owner, rotation_due, last_checked_at, last_success_at, last_error, updated_by
                                 FROM pulse.connection_status`);
  const byName = new Map(rows.map(r => [r.name, r]));
  return {
    connections: Object.keys(creds.TYPES).map(name => {
      const r = byName.get(name) || {};
      return {
        ...creds.describe(name),
        configured: !!r.configured, secretUpdatedAt: r.secret_updated_at || null, updatedBy: r.updated_by || null,
        owner: r.owner || null, rotationDue: r.rotation_due || null,
        lastCheckedAt: r.last_checked_at || null, lastSuccessAt: r.last_success_at || null, lastError: r.last_error || null,
      };
    }),
  };
}

async function upsertStatus(name, fields) {
  const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
  const params = { name, description: creds.TYPES[name].label, ...Object.fromEntries(keys.map(k => [k, fields[k]])) };
  await db.query(
    `MERGE pulse.connection_status AS t USING (SELECT @name AS name) AS s ON t.name = s.name
     WHEN MATCHED THEN UPDATE SET ${keys.map(k => `${k} = @${k}`).join(", ") || "name = name"}
     WHEN NOT MATCHED THEN INSERT (name, description${keys.map(k => ", " + k).join("")}) VALUES (@name, @description${keys.map(k => ", @" + k).join("")});`,
    params);
}

async function put(ctx) {
  const name = String(ctx.params.name);
  const fields = creds.validate(name, ctx.body);
  const [current] = await db.query("SELECT configured FROM pulse.connection_status WHERE name = @name", { name });
  const replacing = !!(current && current.configured);
  const reason = requireReason(ctx.body.reason);
  if (replacing && !reason) throw fail(400, "Please give a reason for replacing this credential (for example, scheduled rotation). It's kept in the audit log.");
  const owner = ctx.body.owner === undefined ? undefined : (String(ctx.body.owner || "").trim().slice(0, 200) || null);
  const rotationDue = day(ctx.body.rotationDue);

  const { value, tested, note } = await creds.prepare(name, fields);
  try {
    await vault.setSecret(name, JSON.stringify(value), { updatedBy: ctx.person.name.slice(0, 200) });
  } catch (e) {
    throw fail(502, e.status === 403 ? "Pulse isn't allowed to save credentials (Key Vault access). Ask a Platform Admin to re-run pulse-setup.sh release1." : "Couldn't save to Key Vault. Try again in a minute.");
  }
  await upsertStatus(name, {
    configured: 1, secret_updated_at: new Date(), updated_by: ctx.person.name, last_error: null,
    ...(tested ? { last_success_at: new Date(), last_checked_at: new Date() } : {}),
    owner, rotation_due: rotationDue,
  });
  await audit.record({ actor: actor(ctx), action: replacing ? "connection.replace" : "connection.set", entity: { type: "connection", id: name },
    after: { fields: Object.keys(fields), tested, owner, rotationDue }, reason, request: ctx.request }, ctx.context);
  return { ok: true, tested, note };
}

async function patch(ctx) {
  const name = String(ctx.params.name);
  if (!creds.TYPES[name]) throw fail(404, "That connection doesn't exist.");
  const owner = ctx.body.owner === undefined ? undefined : (String(ctx.body.owner || "").trim().slice(0, 200) || null);
  const rotationDue = day(ctx.body.rotationDue);
  await upsertStatus(name, { owner, rotation_due: rotationDue });
  await audit.record({ actor: actor(ctx), action: "connection.details", entity: { type: "connection", id: name }, after: { owner, rotationDue }, request: ctx.request }, ctx.context);
  return { ok: true };
}

async function remove(ctx) {
  const name = String(ctx.params.name);
  if (!creds.TYPES[name]) throw fail(404, "That connection doesn't exist.");
  const reason = requireReason(ctx.body.reason);
  if (!reason) throw fail(400, "Please give a reason for removing this credential.");
  try { await vault.setSecret(name, vault.PLACEHOLDER, { updatedBy: ctx.person.name.slice(0, 200) }); }
  catch { throw fail(502, "Couldn't update Key Vault. Try again in a minute."); }
  await upsertStatus(name, { configured: 0, secret_updated_at: new Date(), updated_by: ctx.person.name, last_success_at: null });
  await audit.record({ actor: actor(ctx), action: "connection.remove", entity: { type: "connection", id: name }, reason, request: ctx.request }, ctx.context);
  return { ok: true };
}

const routes = [
  { method: "GET", path: "/connections", auth: "person", allow: admin, fn: list },
  { method: "PUT", path: "/connections/:name", auth: "person", allow: admin, fn: put },
  { method: "PATCH", path: "/connections/:name", auth: "person", allow: admin, fn: patch },
  { method: "DELETE", path: "/connections/:name", auth: "person", allow: admin, fn: remove },
];
module.exports = { routes };
