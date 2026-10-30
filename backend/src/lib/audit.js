"use strict";
/**
 * Audit trail (D8, ISO 27001). Every sign-in, change, override and view of a sensitive page
 * is written to pulse.audit_event (append-only: the app's database roles can insert and read,
 * never update or delete) and copied to Application Insights as a "PULSE_AUDIT" trace, which
 * lands in Log Analytics with the 12-month retention set there.
 *
 * Never put secrets or credential values in an audit event.
 */
const db = require("./sql");

const MAX_JSON = 8000;
const toJson = v => {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(v);
  return s.length > MAX_JSON ? s.slice(0, MAX_JSON - 20) + '…"truncated"' : s;
};

/**
 * @param {object} e
 *   actor   { oid, name } of the person, or { oid: "service:<name>", name } for a Pulse service
 *   action  dotted verb, e.g. "session.start", "scorecard.override", "department.change"
 *   entity  { type, id } of what was acted on (optional)
 *   before / after  values (optional, JSON-serialisable)
 *   reason  the person's reason (required by callers for overrides and admin changes)
 *   request the HTTP request (for client address and browser), optional
 * @param {object} [log] Functions context (for the trace copy)
 */
async function record(e, log) {
  const row = {
    actorOid: String(e.actor && e.actor.oid || "unknown").slice(0, 64),
    actorName: String(e.actor && e.actor.name || "").slice(0, 200),
    action: String(e.action).slice(0, 100),
    entityType: e.entity ? String(e.entity.type).slice(0, 50) : null,
    entityId: e.entity && e.entity.id != null ? String(e.entity.id).slice(0, 100) : null,
    beforeJson: toJson(e.before),
    afterJson: toJson(e.after),
    reason: e.reason ? String(e.reason).slice(0, 1000) : null,
    clientIp: clientIp(e.request),
    userAgent: e.request ? String(e.request.headers.get("user-agent") || "").slice(0, 300) : null,
    component: String(process.env.PULSE_COMPONENT || "api"),
  };
  if (log && typeof log.log === "function") log.log("PULSE_AUDIT " + JSON.stringify({ ...row, beforeJson: undefined, afterJson: undefined }));
  await db.query(
    `INSERT INTO pulse.audit_event (actor_oid, actor_name, action, entity_type, entity_id, before_json, after_json, reason, client_ip, user_agent, component)
     VALUES (@actorOid, @actorName, @action, @entityType, @entityId, @beforeJson, @afterJson, @reason, @clientIp, @userAgent, @component)`,
    row);
}

function clientIp(request) {
  if (!request) return null;
  const xf = request.headers.get("x-forwarded-for") || request.headers.get("client-ip") || "";
  const first = xf.split(",")[0].trim();
  return first ? first.replace(/:\d+$/, "").slice(0, 64) : null;
}

/** Reads audit events, newest first. Filters are optional. */
async function list({ from, to, actor, action, entityType, entityId, limit = 200 } = {}) {
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  const where = [], p = { n };
  if (from) { where.push("occurred_at >= @from"); p.from = new Date(from); }
  if (to) { where.push("occurred_at < @to"); p.to = new Date(to); }
  if (actor) { where.push("(actor_oid = @actor OR actor_name LIKE @actorLike)"); p.actor = actor; p.actorLike = `%${actor}%`; }
  if (action) { where.push("action LIKE @action"); p.action = `${action}%`; }
  if (entityType) { where.push("entity_type = @entityType"); p.entityType = entityType; }
  if (entityId) { where.push("entity_id = @entityId"); p.entityId = String(entityId); }
  const rows = await db.query(
    `SELECT TOP (@n) id, occurred_at, actor_oid, actor_name, action, entity_type, entity_id, before_json, after_json, reason, client_ip, component
       FROM pulse.audit_event ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY id DESC`, p);
  return rows.map(r => ({
    id: Number(r.id), at: r.occurred_at, actor: { oid: r.actor_oid, name: r.actor_name }, action: r.action,
    entity: r.entity_type ? { type: r.entity_type, id: r.entity_id } : null,
    before: r.before_json ? safeParse(r.before_json) : null, after: r.after_json ? safeParse(r.after_json) : null,
    reason: r.reason, clientIp: r.client_ip, component: r.component,
  }));
}
const safeParse = s => { try { return JSON.parse(s); } catch { return s; } };

module.exports = { record, list };
