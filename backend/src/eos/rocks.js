"use strict";
/**
 * Rocks: 90-day priorities, with milestones.
 *   GET   /rocks?fy=2027&quarter=2&level=company|division|individual&division=Code
 *   POST  /rocks                     { fy, quarter, level, division, title, description, ownerName, ownerEmail, dueDate }
 *   PATCH /rocks/:id                 any of title, description, ownerName, ownerEmail, status, dueDate, archived
 *   POST  /rocks/:id/milestones      { title, dueDate }
 *   PATCH /rocks/:id/milestones/:mid { title, dueDate, done, deleted }
 *
 * Who: company Rocks are seen by everyone and set by Leadership. Division Rocks are seen and set by
 * that division and Leadership. Individual Rocks are seen by everyone; set by their owner or Leadership.
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const C = require("./common");

const STATUSES = ["on_track", "off_track", "done", "not_done"];

const canSee = (ctx, r) => r.level !== "division" || C.seesDivision(ctx, r.division_code);
const canEdit = (ctx, r) => ctx.access.leadership || C.isMe(ctx, r.owner_email) ||
  (r.level === "division" && ctx.access.ownDivisions.includes(r.division_code));
function canCreate(ctx, level, division) {
  if (ctx.access.leadership) return true;
  if (level === "division") return ctx.access.ownDivisions.includes(division);
  return level === "individual";
}

function shape(ctx, r, milestones) {
  const ms = milestones.filter(m => m.rock_id === r.id).map(m => ({
    id: m.id, title: m.title, dueDate: m.due_date ? C.day(m.due_date) : null, done: !!m.is_done,
  }));
  return {
    id: r.id, fy: r.fy, quarter: r.quarter, label: time.fyLabel(r.fy, r.quarter), level: r.level, division: r.division_code,
    title: r.title, description: r.description, owner: { name: r.owner_name, email: r.owner_email, isMe: C.isMe(ctx, r.owner_email) },
    status: r.status, dueDate: r.due_date ? C.day(r.due_date) : null, archived: !!r.is_archived,
    milestones: ms, milestonesDone: ms.filter(m => m.done).length, canEdit: canEdit(ctx, r),
    link: r._link || null,
  };
}

async function list(ctx) {
  const now = time.fyOf();
  const fy = Number(ctx.query.fy) || now.fy;
  const quarter = Number(ctx.query.quarter) || now.quarter;
  const where = ["fy = @fy", "quarter = @quarter", "is_archived = 0"], p = { fy, quarter };
  if (ctx.query.level) { where.push("level = @level"); p.level = ctx.query.level; }
  if (ctx.query.division) { where.push("division_code = @division"); p.division = C.division(ctx.query.division); }
  if (ctx.query.mine) { where.push("owner_email IN (" + ctx.person.emails.map((_, i) => "@e" + i).join(",") + ")"); ctx.person.emails.forEach((e, i) => { p["e" + i] = e; }); }
  const rows = (await db.query(`SELECT * FROM pulse.rock WHERE ${where.join(" AND ")} ORDER BY level, sort, id`, p)).filter(r => canSee(ctx, r));
  const ms = rows.length ? await db.query(
    `SELECT id, rock_id, title, due_date, is_done FROM pulse.rock_milestone
      WHERE is_deleted = 0 AND rock_id IN (${rows.map((_, i) => "@r" + i).join(",")}) ORDER BY sort, id`,
    Object.fromEntries(rows.map((r, i) => ["r" + i, r.id]))) : [];
  if (rows.length) {
    // Progress from a linked Autotask project or Planner plan (D11, 0.8.0).
    const links = await db.query(`SELECT * FROM pulse.rock_link WHERE rock_id IN (${rows.map((_, i) => "@r" + i).join(",")})`, Object.fromEntries(rows.map((r, i) => ["r" + i, r.id])));
    if (links.length) {
      const L = require("./links");
      const base = await L.webUrl();
      const by = new Map(links.map(l => [l.rock_id, l]));
      for (const r of rows) {
        const l = by.get(r.id);
        if (l) r._link = { kind: l.kind, ref: l.ref, name: l.name, pct: l.pct === null ? null : Number(l.pct), detail: l.detail, checkedAt: l.checked_at, error: l.last_error,
          url: l.kind === "autotask_project" ? L.autotaskUrl(base, "project", l.ref) : `https://planner.cloud.microsoft/webui/plan/${encodeURIComponent(l.ref)}/view/board` };
      }
    }
  }
  return { fy, quarter, label: time.fyLabel(fy, quarter), range: time.fyRange(fy, quarter), rocks: rows.map(r => shape(ctx, r, ms)) };
}

async function load(ctx, id) {
  const [r] = await db.query("SELECT * FROM pulse.rock WHERE id = @id", { id });
  if (!r || !canSee(ctx, r)) throw C.fail(404, "That Rock doesn't exist.");
  return r;
}

async function create(ctx) {
  const b = ctx.body;
  const level = b.level;
  if (!["company", "division", "individual"].includes(level)) throw C.fail(400, "Choose company, division or individual.");
  const division = level === "division" ? C.division(b.division) : C.division(b.division, { optional: true });
  if (!canCreate(ctx, level, division)) throw C.fail(403, level === "company" ? "Only Leadership sets company Rocks." : "You can only add Rocks for your own division.");
  const now = time.fyOf();
  const fy = Number(b.fy) || now.fy, quarter = Number(b.quarter) || now.quarter;
  if (quarter < 1 || quarter > 4 || fy < 2020 || fy > 2100) throw C.fail(400, "Choose a valid quarter.");
  let ownerName = C.text(b.ownerName, 200), ownerEmail = C.email(b.ownerEmail);
  if (level === "individual" && !ctx.access.leadership) { ownerName = ctx.person.name; ownerEmail = ctx.person.email; }
  if (!ownerName) throw C.fail(400, "Every Rock needs an owner.");
  const row = {
    fy, quarter, level, division, title: C.text(b.title, 300, { required: true, label: "Title" }),
    description: C.text(b.description, 2000), ownerName, ownerEmail,
    dueDate: C.date(b.dueDate) || time.fyRange(fy, quarter).end, by: ctx.person.name,
  };
  const [{ id }] = await db.query(
    `INSERT INTO pulse.rock (fy, quarter, level, division_code, title, description, owner_name, owner_email, due_date, created_by, sort)
     OUTPUT inserted.id
     VALUES (@fy, @quarter, @level, @division, @title, @description, @ownerName, @ownerEmail, @dueDate, @by,
             (SELECT ISNULL(MAX(sort), 0) + 1 FROM pulse.rock WHERE fy = @fy AND quarter = @quarter))`, row);
  await C.record(ctx, "rock.create", { type: "rock", id }, null, row);
  return { id };
}

async function update(ctx) {
  const id = C.int(ctx.params.id);
  const r = await load(ctx, id);
  if (!canEdit(ctx, r)) throw C.fail(403, "Only the Rock's owner, its division or Leadership can change it.");
  const b = ctx.body, f = {};
  if ("title" in b) f.title = C.text(b.title, 300, { required: true, label: "Title" });
  if ("description" in b) f.description = C.text(b.description, 2000);
  if ("status" in b) { if (!STATUSES.includes(b.status)) throw C.fail(400, "Unknown status."); f.status = b.status; }
  if ("dueDate" in b) f.due_date = C.date(b.dueDate);
  if ("archived" in b) f.is_archived = b.archived ? 1 : 0;
  if (ctx.access.leadership || r.level === "division") {
    if ("ownerName" in b) f.owner_name = C.text(b.ownerName, 200, { required: true, label: "Owner" });
    if ("ownerEmail" in b) f.owner_email = C.email(b.ownerEmail);
  }
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true };
  await db.query(`UPDATE pulse.rock SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @id`, { id, ...f });
  await C.record(ctx, f.status && f.status !== r.status ? "rock.status" : "rock.update", { type: "rock", id },
    Object.fromEntries(keys.map(k => [k, r[k]])), f);
  return { ok: true };
}

async function addMilestone(ctx) {
  const id = C.int(ctx.params.id);
  const r = await load(ctx, id);
  if (!canEdit(ctx, r)) throw C.fail(403, "Only the Rock's owner, its division or Leadership can change it.");
  const row = { id, title: C.text(ctx.body.title, 300, { required: true, label: "Milestone" }), dueDate: C.date(ctx.body.dueDate) };
  const [{ id: mid }] = await db.query(
    `INSERT INTO pulse.rock_milestone (rock_id, title, due_date, sort) OUTPUT inserted.id
     VALUES (@id, @title, @dueDate, (SELECT ISNULL(MAX(sort), 0) + 1 FROM pulse.rock_milestone WHERE rock_id = @id))`, row);
  await C.record(ctx, "rock.milestone.add", { type: "rock", id }, null, { milestone: mid, title: row.title, dueDate: row.dueDate });
  return { id: mid };
}

async function updateMilestone(ctx) {
  const id = C.int(ctx.params.id), mid = C.int(ctx.params.mid, "Milestone");
  const r = await load(ctx, id);
  if (!canEdit(ctx, r)) throw C.fail(403, "Only the Rock's owner, its division or Leadership can change it.");
  const [m] = await db.query("SELECT * FROM pulse.rock_milestone WHERE id = @mid AND rock_id = @id AND is_deleted = 0", { id, mid });
  if (!m) throw C.fail(404, "That milestone doesn't exist.");
  const b = ctx.body, f = {};
  if ("title" in b) f.title = C.text(b.title, 300, { required: true, label: "Milestone" });
  if ("dueDate" in b) f.due_date = C.date(b.dueDate);
  if ("done" in b) f.is_done = b.done ? 1 : 0;
  if ("deleted" in b && b.deleted) f.is_deleted = 1;
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true };
  await db.query(`UPDATE pulse.rock_milestone SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @mid`, { mid, ...f });
  await C.record(ctx, "rock.milestone.update", { type: "rock", id }, { milestone: mid, ...Object.fromEntries(keys.map(k => [k, m[k]])) }, { milestone: mid, ...f });
  return { ok: true };
}

const routes = [
  { method: "GET", path: "/rocks", auth: "person", fn: list },
  { method: "POST", path: "/rocks", auth: "person", fn: create },
  { method: "PATCH", path: "/rocks/:id", auth: "person", fn: update },
  { method: "POST", path: "/rocks/:id/milestones", auth: "person", fn: addMilestone },
  { method: "PATCH", path: "/rocks/:id/milestones/:mid", auth: "person", fn: updateMilestone },
];

module.exports = { routes, _test: { canSee, canEdit, canCreate } };
