"use strict";
/**
 * Divisions, functions and seats (the Accountability Chart), and "my seats".
 *   GET   /structure                         divisions → functions → seats (with holders), for the menu
 *   POST  /seats                             (leadership) { division, functionId, parentSeatId, title, roles[], keyResult }
 *   PATCH /seats/:id                         (leadership) any of the above, active
 *   PUT   /seats/:id/holders                 (leadership) { holders: [{ name, email, title, team }] }
 *   GET   /me/summary                        my seats, my Rocks this quarter, my open To-dos, my measurables, my Issues
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const C = require("./common");

function parseRoles(json) { try { const r = JSON.parse(json || "[]"); return Array.isArray(r) ? r.map(String) : []; } catch { return []; } }

async function structure(ctx) {
  const [divisions, functions, seats, holders] = await Promise.all([
    db.query("SELECT code, name, summary, sort FROM pulse.division ORDER BY sort"),
    db.query("SELECT id, division_code, name, sort FROM pulse.division_function ORDER BY division_code, sort"),
    db.query("SELECT id, division_code, function_id, parent_seat_id, title, roles_json, key_result, apps_json, sort FROM pulse.seat WHERE is_active = 1 ORDER BY sort, id"),
    db.query("SELECT id, seat_id, holder_name, holder_email, holder_title, team FROM pulse.seat_holder ORDER BY id"),
  ]);
  const seatOut = s => {
    const hs = holders.filter(h => h.seat_id === s.id).map(h => {
      const out = { name: h.holder_name, email: h.holder_email, title: h.holder_title, team: h.team };
      return { ...out, isMe: C.isMeHolder(ctx, out) };
    });
    return { id: s.id, division: s.division_code, functionId: s.function_id, parentId: s.parent_seat_id, title: s.title,
      roles: parseRoles(s.roles_json), keyResult: s.key_result, apps: parseRoles(s.apps_json), holders: hs, isMine: hs.some(h => h.isMe) };
  };
  const allSeats = seats.map(seatOut);
  return {
    divisions: divisions.map(d => ({
      code: d.code, name: d.name, summary: d.summary,
      canSee: C.seesDivision(ctx, d.code), isMine: ctx.access.ownDivisions.includes(d.code) || allSeats.some(s => s.division === d.code && s.isMine),
      functions: functions.filter(f => f.division_code === d.code).map(f => ({ id: f.id, name: f.name })),
      seats: allSeats.filter(s => s.division === d.code),
    })),
    mySeats: allSeats.filter(s => s.isMine).map(s => s.id),
    canEdit: ctx.access.leadership,
  };
}

function seatFields(b, creating) {
  const f = {};
  if (creating || "division" in b) f.division_code = C.division(b.division);
  if ("functionId" in b) f.function_id = b.functionId ? C.int(b.functionId, "Function") : null;
  if ("parentSeatId" in b) f.parent_seat_id = b.parentSeatId ? C.int(b.parentSeatId, "Parent seat") : null;
  if (creating || "title" in b) f.title = C.text(b.title, 150, { required: true, label: "Seat" });
  if ("roles" in b) {
    if (!Array.isArray(b.roles) || b.roles.length > 12) throw C.fail(400, "Roles is a list of up to 12 lines.");
    f.roles_json = JSON.stringify(b.roles.map(r => C.text(r, 300)).filter(Boolean));
  }
  if ("keyResult" in b) f.key_result = C.text(b.keyResult, 500);
  if ("apps" in b) {
    if (!Array.isArray(b.apps) || b.apps.some(a => !["pipeline", "mroi", "wspace"].includes(a))) throw C.fail(400, "Unknown app.");
    f.apps_json = JSON.stringify([...new Set(b.apps)]);
  }
  if ("sort" in b) f.sort = Number(b.sort) || 0;
  if ("active" in b) f.is_active = b.active ? 1 : 0;
  return f;
}

async function createSeat(ctx) {
  const f = seatFields(ctx.body, true);
  const cols = Object.keys(f);
  const [{ id }] = await db.query(`INSERT INTO pulse.seat (${cols.join(", ")}) OUTPUT inserted.id VALUES (${cols.map(k => "@" + k).join(", ")})`, f);
  await C.record(ctx, "seat.create", { type: "seat", id }, null, f);
  return { id };
}

async function updateSeat(ctx) {
  const id = C.int(ctx.params.id, "Seat");
  const [s] = await db.query("SELECT * FROM pulse.seat WHERE id = @id", { id });
  if (!s) throw C.fail(404, "That seat doesn't exist.");
  const f = seatFields(ctx.body, false);
  if (f.parent_seat_id === id) throw C.fail(400, "A seat can't report to itself.");
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true };
  await db.query(`UPDATE pulse.seat SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @id`, { id, ...f });
  await C.record(ctx, "seat.update", { type: "seat", id }, Object.fromEntries(keys.map(k => [k, s[k]])), f);
  return { ok: true };
}

async function putHolders(ctx) {
  const id = C.int(ctx.params.id, "Seat");
  const [s] = await db.query("SELECT id, title FROM pulse.seat WHERE id = @id", { id });
  if (!s) throw C.fail(404, "That seat doesn't exist.");
  const list = Array.isArray(ctx.body.holders) ? ctx.body.holders : [];
  if (list.length > 20) throw C.fail(400, "Up to 20 people per seat.");
  const holders = list.map(h => ({ name: C.text(h.name, 200, { required: true, label: "Name" }), email: C.email(h.email), title: C.text(h.title, 200), team: C.text(h.team, 100) }));
  const before = await db.query("SELECT holder_name, holder_email, holder_title, team FROM pulse.seat_holder WHERE seat_id = @id", { id });
  await db.tx(async q => {
    await q("DELETE FROM pulse.seat_holder WHERE seat_id = @id", { id });
    for (const h of holders) {
      await q(`INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_email, holder_title, team, person_id)
               VALUES (@id, @name, @email, @title, @team, (SELECT TOP 1 id FROM pulse.person WHERE email = @email))`, { id, ...h });
    }
  });
  await C.record(ctx, "seat.holders", { type: "seat", id }, before.map(b => ({ name: b.holder_name, email: b.holder_email, title: b.holder_title, team: b.team })), holders);
  return { ok: true };
}

/** The signed-in person's own work: what the role-level home page shows. */
async function mySummary(ctx) {
  const emails = ctx.person.emails.length ? ctx.person.emails : ["-"];
  const p = { ...Object.fromEntries(emails.map((e, i) => ["e" + i, e])), myName: C.norm(ctx.person.name) };
  const inList = emails.map((_, i) => "@e" + i).join(",");
  const now = time.fyOf();
  const [seats, rocks, todos, measurables, issues] = await Promise.all([
    db.query(`SELECT DISTINCT s.id, s.title, s.division_code, s.key_result, s.roles_json, s.apps_json, s.sort FROM pulse.seat s
              JOIN pulse.seat_holder h ON h.seat_id = s.id
             WHERE s.is_active = 1 AND (h.holder_email IN (${inList}) OR (h.holder_email IS NULL AND LOWER(LTRIM(RTRIM(h.holder_name))) = @myName))
             ORDER BY s.sort`, p),
    db.query(`SELECT id, title, status, level, division_code, due_date FROM pulse.rock
              WHERE fy = @fy AND quarter = @q AND is_archived = 0 AND owner_email IN (${inList}) ORDER BY sort`, { ...p, fy: now.fy, q: now.quarter }),
    db.query(`SELECT id, title, due_date FROM pulse.todo WHERE is_deleted = 0 AND is_done = 0 AND owner_email IN (${inList}) ORDER BY due_date`, p),
    db.query(`SELECT m.id, m.code, m.name, m.unit, m.goal_value, m.goal_text, m.direction FROM pulse.measurable m
             WHERE m.is_active = 1 AND (m.owner_email IN (${inList}) OR (m.owner_email IS NULL AND LOWER(LTRIM(RTRIM(m.owner_name))) = @myName))
             ORDER BY m.sort`, p),
    db.query(`SELECT id, title, level, division_code, priority FROM pulse.issue WHERE status = N'open' AND owner_email IN (${inList})`, p),
  ]);
  const today = time.sydneyDate();
  return {
    quarter: time.fyLabel(now.fy, now.quarter),
    seats: seats.map(s => ({ id: s.id, title: s.title, division: s.division_code, keyResult: s.key_result, roles: parseRoles(s.roles_json), apps: parseRoles(s.apps_json) })),
    rocks: rocks.map(r => ({ id: r.id, title: r.title, status: r.status, level: r.level, division: r.division_code, dueDate: r.due_date ? C.day(r.due_date) : null })),
    todos: todos.map(t => ({ id: t.id, title: t.title, dueDate: C.day(t.due_date), overdue: C.day(t.due_date) < today })),
    measurables: measurables.map(m => ({ id: m.id, code: m.code, name: m.name, unit: m.unit, goalText: m.goal_text })),
    issues: issues.filter(i => i.level !== "company" || ctx.access.leadership).map(i => ({ id: i.id, title: i.title, level: i.level, division: i.division_code, priority: i.priority })),
  };
}

const routes = [
  { method: "GET", path: "/structure", auth: "person", fn: structure },
  { method: "POST", path: "/seats", auth: "person", allow: a => a.leadership, fn: createSeat },
  { method: "PATCH", path: "/seats/:id", auth: "person", allow: a => a.leadership, fn: updateSeat },
  { method: "PUT", path: "/seats/:id/holders", auth: "person", allow: a => a.leadership, fn: putHolders },
  { method: "GET", path: "/me/summary", auth: "person", fn: mySummary },
];
module.exports = { routes };
