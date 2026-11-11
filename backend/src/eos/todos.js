"use strict";
/**
 * To-dos: seven-day commitments. Planner sync arrives in M4.
 *   GET   /todos?view=mine|company|division&division=Code&done=0|1|all
 *   POST  /todos      { level, division, title, ownerName, ownerEmail, dueDate, issueId }
 *   PATCH /todos/:id  any of title, ownerName, ownerEmail, dueDate, done, deleted
 * Your own To-dos are always yours to see and tick. Company To-dos: leadership team.
 * Division To-dos: that division and Leadership.
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const C = require("./common");

const canSee = (ctx, t) => C.isMe(ctx, t.owner_email) ||
  (t.level === "company" ? ctx.access.leadership : t.level === "division" ? C.seesDivision(ctx, t.division_code) : ctx.access.leadership);
const canEdit = canSee;

function shape(ctx, t) {
  const today = time.sydneyDate();
  const due = C.day(t.due_date);
  return {
    id: t.id, level: t.level, division: t.division_code, title: t.title,
    owner: { name: t.owner_name, email: t.owner_email, isMe: C.isMe(ctx, t.owner_email) },
    dueDate: due, overdue: !t.is_done && due < today, done: !!t.is_done, doneAt: t.done_at,
    issueId: t.issue_id, createdBy: t.created_by_name, createdAt: t.created_at,
    planner: t.task_id ? { linked: true, error: t.planner_error || null } : null,
  };
}

async function list(ctx) {
  const view = ctx.query.view || "mine";
  const where = ["is_deleted = 0"], p = {};
  if (view === "mine") {
    if (!ctx.person.emails.length) return { view, todos: [] };
    where.push("owner_email IN (" + ctx.person.emails.map((_, i) => "@e" + i).join(",") + ")");
    ctx.person.emails.forEach((e, i) => { p["e" + i] = e; });
  } else if (view === "company") {
    if (!ctx.access.leadership) throw C.fail(403, "Company To-dos are for the leadership team.");
    where.push("level = N'company'");
  } else if (view === "division") {
    const d = C.division(ctx.query.division);
    if (!C.seesDivision(ctx, d)) throw C.fail(403, "You don't have access to that division's To-dos.");
    where.push("level = N'division' AND division_code = @d"); p.d = d;
  } else throw C.fail(400, "Unknown view.");
  const done = ctx.query.done === undefined ? "recent" : ctx.query.done;
  if (done === "0") where.push("is_done = 0");
  else if (done === "1") where.push("is_done = 1");
  else if (done === "recent") where.push("(is_done = 0 OR done_at >= DATEADD(day, -14, SYSUTCDATETIME()))");
  const rows = await db.query(`SELECT TOP (500) t.*, l.task_id, l.last_error AS planner_error FROM pulse.todo t LEFT JOIN pulse.todo_planner l ON l.todo_id = t.id
      WHERE ${where.map(w => w.replace(/\b(is_deleted|level|division_code|is_done|done_at|owner_email)\b/g, "t.$1")).join(" AND ")} ORDER BY t.is_done, t.due_date, t.id`, p);
  return { view, todos: rows.filter(t => canSee(ctx, t)).map(t => shape(ctx, t)) };
}

async function create(ctx) {
  const b = ctx.body;
  const level = b.level || "individual";
  if (!["company", "division", "individual"].includes(level)) throw C.fail(400, "Level is company, division or individual.");
  const division = level === "division" ? C.division(b.division) : null;
  if (level === "company" && !ctx.access.leadership) throw C.fail(403, "Only the leadership team adds company To-dos.");
  if (level === "division" && !C.seesDivision(ctx, division)) throw C.fail(403, "You can only add To-dos for your own division.");
  let ownerName = C.text(b.ownerName, 200), ownerEmail = C.email(b.ownerEmail);
  if (level === "individual" && !ctx.access.leadership) { ownerName = ctx.person.name; ownerEmail = ctx.person.email; }
  if (!ownerName) { ownerName = ctx.person.name; ownerEmail = ctx.person.email; }
  const row = {
    level, division, title: C.text(b.title, 300, { required: true, label: "To-do" }), ownerName, ownerEmail,
    // EOS default: due in seven days
    dueDate: C.date(b.dueDate) || time.addDays(time.sydneyDate(), 7),
    issueId: b.issueId ? C.int(b.issueId, "Issue") : null, by: ctx.person.name,
  };
  const [{ id }] = await db.query(
    `INSERT INTO pulse.todo (level, division_code, title, owner_name, owner_email, due_date, issue_id, created_by_name)
     OUTPUT inserted.id VALUES (@level, @division, @title, @ownerName, @ownerEmail, @dueDate, @issueId, @by)`, row);
  await C.record(ctx, "todo.create", { type: "todo", id }, null, row);
  return { id };
}

async function update(ctx) {
  const id = C.int(ctx.params.id);
  const [t] = await db.query("SELECT * FROM pulse.todo WHERE id = @id AND is_deleted = 0", { id });
  if (!t || !canSee(ctx, t)) throw C.fail(404, "That To-do doesn't exist.");
  if (!canEdit(ctx, t)) throw C.fail(403, "You can't change that To-do.");
  const b = ctx.body, f = {};
  if ("title" in b) f.title = C.text(b.title, 300, { required: true, label: "To-do" });
  if ("dueDate" in b) f.due_date = C.date(b.dueDate, { required: true, label: "Due date" });
  if ("ownerName" in b) f.owner_name = C.text(b.ownerName, 200, { required: true, label: "Owner" });
  if ("ownerEmail" in b) f.owner_email = C.email(b.ownerEmail);
  if ("done" in b) { f.is_done = b.done ? 1 : 0; f.done_at = b.done ? new Date() : null; }
  if (b.deleted) f.is_deleted = 1;
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true };
  await db.query(`UPDATE pulse.todo SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @id`, { id, ...f });
  const action = f.is_deleted ? "todo.delete" : "is_done" in f && keys.length <= 2 ? (f.is_done ? "todo.done" : "todo.reopen") : "todo.update";
  await C.record(ctx, action, { type: "todo", id }, Object.fromEntries(keys.map(k => [k, t[k]])), f);
  return { ok: true };
}

const routes = [
  { method: "GET", path: "/todos", auth: "person", fn: list },
  { method: "POST", path: "/todos", auth: "person", fn: create },
  { method: "PATCH", path: "/todos/:id", auth: "person", fn: update },
];
module.exports = { routes, _test: { canSee } };
