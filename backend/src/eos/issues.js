"use strict";
/**
 * Issues (IDS). The company Issues List belongs to the leadership team; division lists to each division.
 *   GET   /issues?level=company|division&division=Code&status=open|solved|dropped|all
 *   POST  /issues      { level, division, title, description, ownerName, ownerEmail, measurableId }
 *   PATCH /issues/:id  any of title, description, ownerName, ownerEmail, priority (1–3 or null; each number once per list), status, solution
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
    source: i.source_kind ? { kind: i.source_kind, id: i.source_id } : null,
    autotask: i._link || null,
  };
}

/** Each Issue's Autotask ticket or project task, if it has one (D11, 0.8.0). */
async function attachLinks(rows) {
  if (!rows.length) return;
  const links = await db.query(`SELECT * FROM pulse.issue_link WHERE issue_id IN (${rows.map((_, n) => "@i" + n).join(",")})`,
    Object.fromEntries(rows.map((r, n) => ["i" + n, r.id])));
  if (!links.length) return;
  const L = require("./links");
  const base = await L.webUrl();
  const by = new Map(links.map(l => [l.issue_id, l]));
  for (const r of rows) {
    const l = by.get(r.id);
    if (l) r._link = { kind: l.kind, id: l.at_id, number: l.number, title: l.title, status: l.status_label, complete: !!l.is_complete,
      url: L.autotaskUrl(base, l.kind, l.at_id), error: l.last_error, createdBy: l.created_by };
  }
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
  await attachLinks(rows);
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
    // Each of 1, 2 and 3 goes to one open Issue at a time on a list (11 Nov 2026).
    if (f.priority !== null && i.status === "open") {
      const [taken] = await db.query(
        `SELECT TOP 1 id, title FROM pulse.issue WHERE status = N'open' AND priority = @p AND id <> @id AND level = @level
            AND ${i.division_code ? "division_code = @d" : "division_code IS NULL"}`, { p: f.priority, id, level: i.level, d: i.division_code });
      if (taken) throw C.fail(409, `"${taken.title}" is already number ${f.priority}. Clear it there first.`);
    }
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
