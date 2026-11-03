"use strict";
/**
 * Issues (IDS). The company Issues List belongs to the leadership team; division lists to each division.
 *   GET   /issues?level=company|division&division=Code&status=open|solved|dropped|all
 *   POST  /issues      { level, division, title, description, ownerName, ownerEmail, measurableId }
 *   PATCH /issues/:id  any of title, description, ownerName, ownerEmail, priority (1–3 or null), status, solution
 */
const db = require("../lib/sql");
const C = require("./common");

const STATUSES = ["open", "solved", "dropped"];
const canSee = (ctx, i) => (i.level === "company" ? ctx.access.leadership : C.seesDivision(ctx, i.division_code));

function shape(ctx, i) {
  return {
    id: i.id, level: i.level, division: i.division_code, title: i.title, description: i.description,
    owner: i.owner_name ? { name: i.owner_name, email: i.owner_email, isMe: C.isMe(ctx, i.owner_email) } : null,
    raisedBy: i.raised_by_name, priority: i.priority, status: i.status, solution: i.solution,
    closedAt: i.closed_at, createdAt: i.created_at, measurableId: i.measurable_id,
  };
}

async function list(ctx) {
  const level = ctx.query.level || "company";
  if (!["company", "division"].includes(level)) throw C.fail(400, "Level is company or division.");
  const division = level === "division" ? C.division(ctx.query.division) : null;
  const probe = { level, division_code: division };
  if (!canSee(ctx, probe)) throw C.fail(403, level === "company" ? "The company Issues List is for the leadership team." : "You don't have access to that division's Issues.");
  const status = ctx.query.status || "open";
  const where = ["level = @level"], p = { level };
  if (division) { where.push("division_code = @division"); p.division = division; }
  if (status !== "all") { if (!STATUSES.includes(status)) throw C.fail(400, "Unknown status."); where.push("status = @status"); p.status = status; }
  const rows = await db.query(
    `SELECT TOP (500) * FROM pulse.issue WHERE ${where.join(" AND ")}
      ORDER BY CASE WHEN priority IS NULL THEN 9 ELSE priority END, created_at`, p);
  return { level, division, status, issues: rows.map(i => shape(ctx, i)) };
}

async function create(ctx) {
  const b = ctx.body;
  const level = b.level || "company";
  if (!["company", "division"].includes(level)) throw C.fail(400, "Level is company or division.");
  const division = level === "division" ? C.division(b.division) : null;
  if (!canSee(ctx, { level, division_code: division })) throw C.fail(403, "You can't add Issues to that list.");
  const row = {
    level, division, title: C.text(b.title, 300, { required: true, label: "Issue" }), description: C.text(b.description, 4000),
    ownerName: C.text(b.ownerName, 200), ownerEmail: C.email(b.ownerEmail),
    by: ctx.person.name, oid: ctx.person.oid, measurableId: b.measurableId ? C.int(b.measurableId, "Measurable") : null,
  };
  const [{ id }] = await db.query(
    `INSERT INTO pulse.issue (level, division_code, title, description, owner_name, owner_email, raised_by_name, raised_by_oid, measurable_id)
     OUTPUT inserted.id VALUES (@level, @division, @title, @description, @ownerName, @ownerEmail, @by, @oid, @measurableId)`, row);
  await C.record(ctx, "issue.create", { type: "issue", id }, null, row);
  return { id };
}

async function update(ctx) {
  const id = C.int(ctx.params.id);
  const [i] = await db.query("SELECT * FROM pulse.issue WHERE id = @id", { id });
  if (!i || !canSee(ctx, i)) throw C.fail(404, "That Issue doesn't exist.");
  const b = ctx.body, f = {};
  if ("title" in b) f.title = C.text(b.title, 300, { required: true, label: "Issue" });
  if ("description" in b) f.description = C.text(b.description, 4000);
  if ("ownerName" in b) f.owner_name = C.text(b.ownerName, 200);
  if ("ownerEmail" in b) f.owner_email = C.email(b.ownerEmail);
  if ("priority" in b) {
    if (b.priority !== null && ![1, 2, 3].includes(Number(b.priority))) throw C.fail(400, "Priority is 1, 2, 3 or none.");
    f.priority = b.priority === null ? null : Number(b.priority);
  }
  if ("solution" in b) f.solution = C.text(b.solution, 4000);
  if ("status" in b) {
    if (!STATUSES.includes(b.status)) throw C.fail(400, "Unknown status.");
    f.status = b.status;
    f.closed_at = b.status === "open" ? null : new Date();
    if (b.status !== "open") f.priority = null;
  }
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true };
  await db.query(`UPDATE pulse.issue SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @id`, { id, ...f });
  await C.record(ctx, f.status && f.status !== i.status ? `issue.${f.status}` : "issue.update", { type: "issue", id },
    Object.fromEntries(keys.map(k => [k, i[k]])), f);
  return { ok: true };
}

const routes = [
  { method: "GET", path: "/issues", auth: "person", fn: list },
  { method: "POST", path: "/issues", auth: "person", fn: create },
  { method: "PATCH", path: "/issues/:id", auth: "person", fn: update },
];
module.exports = { routes, _test: { canSee } };
