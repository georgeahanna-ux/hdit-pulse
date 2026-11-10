"use strict";
/**
 * The Level 10 meeting (0.7.0), run in Pulse. EOS agenda, 90 minutes:
 *   segue 5 · Scorecard 5 · Rock review 5 · headlines 5 · To-do list 5 · IDS 60 · conclude 5
 *
 * A meeting belongs to a team: "company" (the leadership team, Tuesday 9:30am, D5) or a division.
 * Rocks, Issues and To-dos are the ordinary ones (their own routes); the meeting adds who came,
 * where the meeting is up to, the scribe's notes, cascading messages, ratings and a summary taken
 * when it ends. Everyone with the meeting open follows the facilitator (the page polls every few
 * seconds); any member of the team can take over facilitating.
 *
 *   GET   /l10?team=company                 schedule, the live meeting, past meetings
 *   POST  /l10                { team }      start (or join the live one)
 *   GET   /l10/:id                          everything the meeting needs; marks you as there
 *   PATCH /l10/:id            { section, notes, cascading, facilitate }
 *   POST  /l10/:id/attendees  { name, email }
 *   PATCH /l10/:id/attendees/:aid { present, rating, ratingNote }   your own rating, or the facilitator's for anyone
 *   POST  /l10/:id/drop       { kind, id, title }   drop a measurable, Rock, headline or To-do to the Issues List
 *   POST  /l10/:id/end                      conclude: summary taken, headlines marked shared
 *   GET   /headlines?team=company           headlines not yet shared
 *   POST  /headlines          { team, kind, text }
 *   PATCH /headlines/:id      { text, deleted }
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const C = require("./common");
const L = require("./logic");

const SECTIONS = [
  { key: "segue", label: "Segue", minutes: 5, hint: "Good news: one personal and one professional from everyone." },
  { key: "scorecard", label: "Scorecard", minutes: 5, hint: "On track or off track for each number. Off track drops to the Issues List; no discussion here." },
  { key: "rocks", label: "Rock review", minutes: 5, hint: "Each owner: on track or off track. Off track drops to the Issues List." },
  { key: "headlines", label: "Headlines", minutes: 5, hint: "Customer and employee news in a sentence. Anything that needs discussing drops to the Issues List." },
  { key: "todos", label: "To-do list", minutes: 5, hint: "Done or not done. Not done twice drops to the Issues List." },
  { key: "ids", label: "IDS", minutes: 60, hint: "Number the top three Issues, then Identify, Discuss and Solve them in order. Solutions become To-dos." },
  { key: "conclude", label: "Conclude", minutes: 5, hint: "Recap the new To-dos, agree cascading messages, and everyone rates the meeting 1 to 10." },
];
const KEYS = SECTIONS.map(s => s.key);
const SCHEDULE = { company: { weekday: 2, hour: 9, minute: 30, label: "Tuesday 9:30am" } };   // D5
const NOT_PEOPLE = /^(tba|vacant|tbc|n\/a|-)?$/i;

/* ------------------------------ pure logic ------------------------------ */

/** The next scheduled meeting at or after now (Sydney time). */
function nextMeeting(now = new Date(), s = SCHEDULE.company) {
  let day = time.sydneyDate(now);
  for (let i = 0; i < 8; i++) {
    const d = time.addDays(day, i);
    if (new Date(d + "T00:00:00Z").getUTCDay() !== s.weekday) continue;
    const at = time.sydneyToUtc(d, s.hour, s.minute);
    // Still "next" until the meeting's 90 minutes are over.
    if (at.getTime() + 90 * 60e3 > now.getTime()) return at;
  }
  return null;
}

/**
 * The To-dos the meeting reviews: the team's To-dos that existed when the meeting started and were
 * still open when the last meeting ended (or done since). Completion counts those due by today.
 */
function todoReview(todos, { startedAt, prevEndedAt = null, today }) {
  const start = new Date(startedAt).getTime();
  const since = prevEndedAt ? new Date(prevEndedAt).getTime() : start - 7 * 86400e3;
  const list = todos.filter(t => !t.is_deleted && new Date(t.created_at).getTime() < start &&
    (!t.is_done || (t.done_at && new Date(t.done_at).getTime() >= since)));
  const due = list.filter(t => L.isoDay(t.due_date) <= today);
  const done = due.filter(t => t.is_done).length;
  return {
    ids: list.map(t => t.id),
    due: due.length, done,
    rate: due.length ? Math.round(done / due.length * 100) : null,
    notDue: list.length - due.length,
  };
}

/**
 * Suggested Issues (D11): measurables off target in both of the last two weeks shown, that don't
 * already have an open Issue. `measurables` are the Scorecard's, cells oldest first.
 */
function suggestions(measurables, openIssueMeasurables = new Set()) {
  const out = [];
  for (const m of measurables) {
    const cells = (m.cells || []).slice(-2);
    if (cells.length < 2 || openIssueMeasurables.has(m.id)) continue;
    if (cells.every(c => c.value !== null && c.value !== undefined && c.onTarget === false)) {
      out.push({ measurableId: m.id, name: m.name, owner: m.owner ? m.owner.name : null, weeks: cells.map(c => c.week), values: cells.map(c => c.value), goal: m.goalText || null });
    }
  }
  return out;
}

/** Minutes spent in each section, from the log of section starts. */
function sectionMinutes(log, endedAt) {
  const out = {};
  const end = new Date(endedAt).getTime();
  log.forEach((e, i) => {
    const next = i + 1 < log.length ? new Date(log[i + 1].at).getTime() : end;
    out[e.s] = (out[e.s] || 0) + Math.max(0, (next - new Date(e.at).getTime()) / 60e3);
  });
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 10) / 10;
  return out;
}

const average = list => { const r = list.filter(x => x !== null && x !== undefined); return r.length ? Math.round(r.reduce((s, x) => s + x, 0) / r.length * 10) / 10 : null; };

/* ------------------------------ helpers ------------------------------ */

function team(ctx, value) {
  const t = value || "company";
  if (t === "company") {
    if (!ctx.access.leadership) throw C.fail(403, "The L10 meeting is for the leadership team.");
    return { level: "company", division: null, key: "company", label: "Leadership team" };
  }
  const d = C.division(t);
  if (!C.seesDivision(ctx, d)) throw C.fail(403, "You're not in that division's team.");
  return { level: "division", division: d, key: d, label: d };
}
const teamOfRow = r => (r.level === "company" ? "company" : r.division_code);

async function loadMeeting(ctx, id) {
  const [m] = await db.query("SELECT * FROM pulse.meeting WHERE id = @id", { id: C.int(id) });
  if (!m) throw C.fail(404, "That meeting doesn't exist.");
  team(ctx, teamOfRow(m));   // access check
  return m;
}

/** The team's members from the Accountability Chart: Visionary, Integrator and the seats reporting to the Integrator. */
async function expectedPeople(t) {
  const rows = t.level === "company"
    ? await db.query(`SELECT h.holder_name AS name, h.holder_email AS email FROM pulse.seat s JOIN pulse.seat_holder h ON h.seat_id = s.id
         WHERE s.is_active = 1 AND (s.title IN (N'Visionary', N'Integrator')
           OR s.parent_seat_id IN (SELECT id FROM pulse.seat WHERE title = N'Integrator' AND is_active = 1))`)
    : await db.query(`SELECT h.holder_name AS name, h.holder_email AS email FROM pulse.seat s JOIN pulse.seat_holder h ON h.seat_id = s.id
         WHERE s.is_active = 1 AND s.division_code = @d`, { d: t.division });
  const seen = new Map();
  for (const r of rows) {
    const name = String(r.name || "").trim();
    if (NOT_PEOPLE.test(name) || seen.has(name.toLowerCase())) continue;
    seen.set(name.toLowerCase(), { name, email: r.email ? String(r.email).toLowerCase() : null });
  }
  return [...seen.values()];
}

const isAttendeeMe = (ctx, a) => (a.person_oid && a.person_oid === ctx.person.oid) || C.isMe(ctx, a.email) || C.norm(a.name) === C.norm(ctx.person.name);

/** Marks the viewer as at the meeting (they have it open). */
async function heartbeat(ctx, m) {
  const all = await db.query("SELECT * FROM pulse.meeting_attendee WHERE meeting_id = @id", { id: m.id });
  const mine = all.find(a => isAttendeeMe(ctx, a));
  if (mine) {
    await db.query(`UPDATE pulse.meeting_attendee SET last_seen_at = SYSUTCDATETIME(), person_oid = @oid,
        present = 1, joined_at = ISNULL(joined_at, SYSUTCDATETIME()) WHERE id = @aid`, { aid: mine.id, oid: ctx.person.oid });
  } else {
    await db.query(`INSERT INTO pulse.meeting_attendee (meeting_id, name, email, person_oid, present, joined_at, last_seen_at)
        VALUES (@id, @name, @email, @oid, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`, { id: m.id, name: ctx.person.name, email: ctx.person.email || null, oid: ctx.person.oid })
      .catch(() => {});   // two tabs at once: the other one added them
  }
}

async function teamTodos(t) {
  return db.query(`SELECT * FROM pulse.todo WHERE is_deleted = 0 AND level = @level AND ${t.division ? "division_code = @d" : "division_code IS NULL"}
      AND (is_done = 0 OR done_at >= DATEADD(day, -21, SYSUTCDATETIME()))`, { level: t.level, d: t.division });
}

async function previousEnded(t, before) {
  const [p] = await db.query(`SELECT TOP 1 ended_at FROM pulse.meeting WHERE status = N'ended' AND level = @level
      AND ${t.division ? "division_code = @d" : "division_code IS NULL"} AND started_at < @before ORDER BY started_at DESC`, { level: t.level, d: t.division, before });
  return p ? p.ended_at : null;
}

function shapeHeadline(ctx, h) {
  return { id: h.id, kind: h.kind, text: h.text, by: h.by_name, mine: h.by_oid === ctx.person.oid, createdAt: h.created_at, issueId: h.issue_id };
}

async function openHeadlines(ctx, t, meetingId = null) {
  const rows = await db.query(`SELECT * FROM pulse.headline WHERE is_deleted = 0 AND level = @level
      AND ${t.division ? "division_code = @d" : "division_code IS NULL"}
      AND (shared_meeting_id IS NULL${meetingId ? " OR shared_meeting_id = @mid" : ""}) ORDER BY created_at`, { level: t.level, d: t.division, mid: meetingId });
  return rows.map(h => shapeHeadline(ctx, h));
}

function shapeAttendee(ctx, a, canRateAll) {
  return { id: a.id, name: a.name, email: a.email, expected: !!a.expected, present: !!a.present,
    online: !!a.last_seen_at && Date.now() - new Date(a.last_seen_at).getTime() < 30e3,
    rating: a.rating, ratingNote: a.rating_note, isMe: isAttendeeMe(ctx, a), canRate: canRateAll || isAttendeeMe(ctx, a) };
}

/* ------------------------------ routes ------------------------------ */

async function overview(ctx) {
  const t = team(ctx, ctx.query.team);
  const p = { level: t.level, d: t.division };
  const where = `level = @level AND ${t.division ? "division_code = @d" : "division_code IS NULL"}`;
  const [live] = await db.query(`SELECT id, started_at, facilitator_name, section FROM pulse.meeting WHERE ${where} AND status = N'live'`, p);
  const past = await db.query(`SELECT TOP 26 id, started_at, ended_at, review_week, summary_json FROM pulse.meeting WHERE ${where} AND status = N'ended' ORDER BY started_at DESC`, p);
  const next = t.level === "company" ? nextMeeting() : null;
  return {
    team: t.key, label: t.label,
    schedule: t.level === "company" ? { label: SCHEDULE.company.label, next: next && next.toISOString() } : null,
    reviewWeek: time.weekInfo(time.reviewWeek()),
    live: live ? { id: live.id, startedAt: live.started_at, facilitator: live.facilitator_name, section: live.section } : null,
    sections: SECTIONS,
    past: past.map(m => {
      let s = {}; try { s = JSON.parse(m.summary_json || "{}"); } catch { /* ignore */ }
      return { id: m.id, startedAt: m.started_at, endedAt: m.ended_at, reviewWeek: L.isoDay(m.review_week), rating: s.averageRating ?? null,
        minutes: s.minutes ?? null, todoRate: s.todos ? s.todos.rate : null, solved: s.solved ? s.solved.length : 0, newTodos: s.newTodos ? s.newTodos.length : 0 };
    }),
  };
}

async function start(ctx) {
  const t = team(ctx, ctx.body.team);
  const p = { level: t.level, d: t.division };
  const where = `level = @level AND ${t.division ? "division_code = @d" : "division_code IS NULL"}`;
  const [live] = await db.query(`SELECT id FROM pulse.meeting WHERE ${where} AND status = N'live'`, p);
  if (live) return { id: live.id, joined: true };
  const now = new Date();
  let id;
  try {
    [{ id }] = await db.query(`INSERT INTO pulse.meeting (level, division_code, review_week, started_by_name, facilitator_name, facilitator_oid, section_log, section_started_at, started_at)
        OUTPUT inserted.id VALUES (@level, @d, @week, @name, @name, @oid, @log, @now, @now)`,
      { ...p, week: time.reviewWeek(now), name: ctx.person.name, oid: ctx.person.oid, log: JSON.stringify([{ s: "segue", at: now.toISOString() }]), now });
  } catch (e) {
    // Someone else started it at the same moment: join theirs.
    const [again] = await db.query(`SELECT id FROM pulse.meeting WHERE ${where} AND status = N'live'`, p);
    if (again) return { id: again.id, joined: true };
    throw e;
  }
  for (const person of await expectedPeople(t)) {
    await db.query("INSERT INTO pulse.meeting_attendee (meeting_id, name, email, expected) VALUES (@id, @name, @email, 1)", { id, ...person }).catch(() => {});
  }
  await C.record(ctx, "meeting.start", { type: "meeting", id }, null, { team: t.key, reviewWeek: time.reviewWeek(now) });
  return { id, joined: false };
}

async function state(ctx) {
  const m = await loadMeeting(ctx, ctx.params.id);
  const t = team(ctx, teamOfRow(m));
  if (m.status === "live") await heartbeat(ctx, m);
  const facilitating = m.facilitator_oid === ctx.person.oid;
  const attendees = await db.query("SELECT * FROM pulse.meeting_attendee WHERE meeting_id = @id ORDER BY expected DESC, name", { id: m.id });
  let summary = null; try { summary = m.summary_json ? JSON.parse(m.summary_json) : null; } catch { /* ignore */ }
  const base = {
    id: m.id, team: teamOfRow(m), status: m.status, section: m.section, sectionStartedAt: m.section_started_at,
    startedAt: m.started_at, endedAt: m.ended_at, reviewWeek: time.weekInfo(L.isoDay(m.review_week)),
    facilitator: { name: m.facilitator_name, isMe: facilitating }, notes: m.notes || "", cascading: m.cascading || "",
    version: m.version, serverNow: new Date().toISOString(), sections: SECTIONS,
    attendees: attendees.map(a => shapeAttendee(ctx, a, facilitating)),
    canEnd: m.status === "live",
  };
  if (m.status === "ended") return { ...base, summary };

  const [todos, prevEnded, headlines, openIssues] = await Promise.all([
    teamTodos(t), previousEnded(t, m.started_at), openHeadlines(ctx, t, m.id),
    db.query(`SELECT measurable_id FROM pulse.issue WHERE status = N'open' AND measurable_id IS NOT NULL AND level = @level
        AND ${t.division ? "division_code = @d" : "division_code IS NULL"}`, { level: t.level, d: t.division }),
  ]);
  const review = todoReview(todos, { startedAt: m.started_at, prevEndedAt: prevEnded, today: time.sydneyDate() });
  const startMs = new Date(m.started_at).getTime();
  const newTodos = todos.filter(x => new Date(x.created_at).getTime() >= startMs)
    .map(x => ({ id: x.id, title: x.title, owner: x.owner_name, dueDate: L.isoDay(x.due_date), issueId: x.issue_id }));
  const solved = await db.query(`SELECT id, title, solution FROM pulse.issue WHERE status = N'solved' AND closed_at >= @s AND level = @level
      AND ${t.division ? "division_code = @d" : "division_code IS NULL"}`, { s: m.started_at, level: t.level, d: t.division });
  let sugg = [];
  try {
    const sc = await require("./scorecard").getScorecard({ ...ctx, query: { weeks: 2, end: L.isoDay(m.review_week), ...(t.division ? { division: t.division } : {}) } });
    sugg = suggestions(sc.measurables, new Set(openIssues.map(r => r.measurable_id)));
  } catch { /* the Scorecard section shows its own error */ }
  return { ...base, headlines, todoReview: review, newTodos, solved, suggestions: sugg };
}

async function change(ctx) {
  const m = await loadMeeting(ctx, ctx.params.id);
  if (m.status !== "live") throw C.fail(409, "This meeting has ended.");
  const b = ctx.body, f = {};
  let log = null;
  if ("section" in b) {
    if (!KEYS.includes(b.section)) throw C.fail(400, "Unknown section.");
    if (b.section !== m.section) {
      const now = new Date();
      f.section = b.section; f.section_started_at = now;
      try { log = JSON.parse(m.section_log || "[]"); } catch { log = []; }
      log.push({ s: b.section, at: now.toISOString() });
      while (JSON.stringify(log).length > 1900) log.splice(1, 1);
      f.section_log = JSON.stringify(log);
    }
  }
  if ("notes" in b) f.notes = C.text(b.notes, 20000);
  if ("cascading" in b) f.cascading = C.text(b.cascading, 4000);
  if (b.facilitate) { f.facilitator_name = ctx.person.name; f.facilitator_oid = ctx.person.oid; }
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true, version: m.version };
  // Notes are typed continuously and travel with every poll; they don't count as a change to the meeting.
  const bump = keys.some(k => k !== "notes");
  await db.query(`UPDATE pulse.meeting SET ${keys.map(k => `${k} = @${k}`).join(", ")}${bump ? ", version = version + 1" : ""} WHERE id = @id`, { id: m.id, ...f });
  if (b.facilitate && m.facilitator_oid !== ctx.person.oid) await C.record(ctx, "meeting.facilitate", { type: "meeting", id: m.id }, { facilitator: m.facilitator_name }, { facilitator: ctx.person.name });
  return { ok: true, version: bump ? m.version + 1 : m.version };
}

async function addAttendee(ctx) {
  const m = await loadMeeting(ctx, ctx.params.id);
  if (m.status !== "live") throw C.fail(409, "This meeting has ended.");
  const name = C.text(ctx.body.name, 200, { required: true, label: "Name" });
  await db.query(`INSERT INTO pulse.meeting_attendee (meeting_id, name, email, present, joined_at) VALUES (@id, @name, @email, 1, SYSUTCDATETIME())`,
    { id: m.id, name, email: C.email(ctx.body.email) }).catch(() => { throw C.fail(409, `${name} is already on the list.`); });
  await db.query("UPDATE pulse.meeting SET version = version + 1 WHERE id = @id", { id: m.id });
  return { ok: true };
}

async function changeAttendee(ctx) {
  const m = await loadMeeting(ctx, ctx.params.id);
  const [a] = await db.query("SELECT * FROM pulse.meeting_attendee WHERE id = @aid AND meeting_id = @id", { aid: C.int(ctx.params.aid), id: m.id });
  if (!a) throw C.fail(404, "That person isn't on this meeting.");
  const facilitating = m.facilitator_oid === ctx.person.oid;
  if (!facilitating && !isAttendeeMe(ctx, a)) throw C.fail(403, "Only the facilitator changes other people's attendance and ratings.");
  // Ratings can be given until the end of the day the meeting ended, so nobody is rushed.
  if (m.status === "ended" && Date.now() - new Date(m.ended_at).getTime() > 12 * 3600e3) throw C.fail(409, "This meeting ended too long ago to change.");
  const b = ctx.body, f = {};
  if ("present" in b) { f.present = b.present ? 1 : 0; if (b.present && !a.joined_at) f.joined_at = new Date(); }
  if ("rating" in b) {
    const r = b.rating === null ? null : Number(b.rating);
    if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 10)) throw C.fail(400, "A rating is a whole number from 1 to 10.");
    f.rating = r; f.rated_by_name = ctx.person.name;
    if (r !== null) f.present = 1;
  }
  if ("ratingNote" in b) f.rating_note = C.text(b.ratingNote, 500);
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true };
  await db.query(`UPDATE pulse.meeting_attendee SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @aid`, { aid: a.id, ...f });
  await db.query("UPDATE pulse.meeting SET version = version + 1 WHERE id = @id", { id: m.id });
  if (m.status === "ended") await refreshSummaryRatings(m.id);
  return { ok: true };
}

/** A rating given just after the meeting ended updates the summary. */
async function refreshSummaryRatings(id) {
  const [m] = await db.query("SELECT summary_json FROM pulse.meeting WHERE id = @id", { id });
  const all = await db.query("SELECT name, present, rating, rating_note FROM pulse.meeting_attendee WHERE meeting_id = @id ORDER BY name", { id });
  let s = {}; try { s = JSON.parse(m.summary_json || "{}"); } catch { /* ignore */ }
  s.attendees = all.map(a => ({ name: a.name, present: !!a.present, rating: a.rating, note: a.rating_note }));
  s.averageRating = average(all.filter(a => a.present).map(a => a.rating));
  await db.query("UPDATE pulse.meeting SET summary_json = @j WHERE id = @id", { id, j: JSON.stringify(s) });
}

const DROP_KINDS = ["measurable", "rock", "headline", "todo", "other"];
async function drop(ctx) {
  const m = await loadMeeting(ctx, ctx.params.id);
  const t = team(ctx, teamOfRow(m));
  const b = ctx.body;
  if (!DROP_KINDS.includes(b.kind)) throw C.fail(400, "Unknown kind.");
  const sourceId = b.kind === "other" ? null : C.int(b.id);
  const title = C.text(b.title, 300, { required: true, label: "Issue" });
  const [dupe] = sourceId ? await db.query("SELECT id FROM pulse.issue WHERE status = N'open' AND source_kind = @k AND source_id = @s", { k: b.kind, s: sourceId }) : [];
  if (dupe) return { id: dupe.id, existing: true };
  const row = { level: t.level, division: t.division, title, description: C.text(b.description, 4000), by: ctx.person.name, oid: ctx.person.oid,
    measurableId: b.kind === "measurable" ? sourceId : null, kind: b.kind === "other" ? null : b.kind, sourceId };
  const [{ id }] = await db.query(`INSERT INTO pulse.issue (level, division_code, title, description, raised_by_name, raised_by_oid, measurable_id, source_kind, source_id)
      OUTPUT inserted.id VALUES (@level, @division, @title, @description, @by, @oid, @measurableId, @kind, @sourceId)`, row);
  if (b.kind === "headline") await db.query("UPDATE pulse.headline SET issue_id = @id WHERE id = @h", { id, h: sourceId });
  await db.query("UPDATE pulse.meeting SET version = version + 1 WHERE id = @mid", { mid: m.id });
  await C.record(ctx, "issue.create", { type: "issue", id }, null, { ...row, meetingId: m.id });
  return { id, existing: false };
}

async function end(ctx) {
  const m = await loadMeeting(ctx, ctx.params.id);
  if (m.status !== "live") throw C.fail(409, "This meeting has already ended.");
  const s = await state(ctx);   // what the meeting saw, taken now
  const now = new Date();
  const t = team(ctx, teamOfRow(m));
  const rocks = await db.query(`SELECT title, owner_name, status FROM pulse.rock WHERE is_archived = 0 AND level = @level
      AND ${t.division ? "division_code = @d" : "division_code IS NULL"} AND fy = @fy AND quarter = @q`, { level: t.level, d: t.division, ...fyQuarter(now) });
  const issues = await db.query(`SELECT title FROM pulse.issue WHERE created_at >= @s AND level = @level AND ${t.division ? "division_code = @d" : "division_code IS NULL"}`,
    { s: m.started_at, level: t.level, d: t.division });
  let log = []; try { log = JSON.parse(m.section_log || "[]"); } catch { /* ignore */ }
  const present = s.attendees.filter(a => a.present);
  const summary = {
    startedAt: m.started_at, endedAt: now.toISOString(), minutes: Math.round((now - new Date(m.started_at)) / 60e3),
    reviewWeek: L.isoDay(m.review_week), facilitator: m.facilitator_name, endedBy: ctx.person.name,
    attendees: s.attendees.map(a => ({ name: a.name, present: a.present, rating: a.rating, note: a.ratingNote })),
    averageRating: average(present.map(a => a.rating)),
    sections: sectionMinutes(log, now),
    todos: { due: s.todoReview.due, done: s.todoReview.done, rate: s.todoReview.rate },
    newTodos: s.newTodos.map(x => ({ title: x.title, owner: x.owner, dueDate: x.dueDate })),
    solved: s.solved.map(x => ({ title: x.title, solution: x.solution })),
    newIssues: issues.map(x => x.title),
    headlines: s.headlines.map(h => ({ kind: h.kind, text: h.text, by: h.by })),
    rocks: { total: rocks.length, onTrack: rocks.filter(r => r.status === "on_track" || r.status === "done").length,
      offTrack: rocks.filter(r => r.status === "off_track").map(r => ({ title: r.title, owner: r.owner_name })) },
    cascading: m.cascading || "", notes: m.notes || "",
  };
  await db.query(`UPDATE pulse.meeting SET status = N'ended', ended_at = @now, ended_by_name = @by, summary_json = @j, version = version + 1 WHERE id = @id AND status = N'live'`,
    { id: m.id, now, by: ctx.person.name, j: JSON.stringify(summary) });
  await db.query(`UPDATE pulse.headline SET shared_meeting_id = @id WHERE shared_meeting_id IS NULL AND is_deleted = 0 AND level = @level
      AND ${t.division ? "division_code = @d" : "division_code IS NULL"} AND created_at < @now`, { id: m.id, level: t.level, d: t.division, now });
  await C.record(ctx, "meeting.end", { type: "meeting", id: m.id }, null, { minutes: summary.minutes, averageRating: summary.averageRating, todoRate: summary.todos.rate });
  return { ok: true, summary };
}

function fyQuarter(now) {
  const { fy, quarter } = time.fyOf(now);
  return { fy, q: quarter };
}

async function listHeadlines(ctx) {
  const t = team(ctx, ctx.query.team);
  return { headlines: await openHeadlines(ctx, t) };
}

const KINDS = ["customer", "employee", "other"];
async function addHeadline(ctx) {
  const t = team(ctx, ctx.body.team);
  const kind = KINDS.includes(ctx.body.kind) ? ctx.body.kind : "other";
  const text = C.text(ctx.body.text, 500, { required: true, label: "Headline" });
  const [{ id }] = await db.query(`INSERT INTO pulse.headline (level, division_code, kind, text, by_name, by_oid) OUTPUT inserted.id VALUES (@level, @d, @kind, @text, @by, @oid)`,
    { level: t.level, d: t.division, kind, text, by: ctx.person.name, oid: ctx.person.oid });
  await db.query(`UPDATE pulse.meeting SET version = version + 1 WHERE status = N'live' AND level = @level AND ${t.division ? "division_code = @d" : "division_code IS NULL"}`, { level: t.level, d: t.division });
  return { id };
}

async function changeHeadline(ctx) {
  const [h] = await db.query("SELECT * FROM pulse.headline WHERE id = @id AND is_deleted = 0", { id: C.int(ctx.params.id) });
  if (!h) throw C.fail(404, "That headline doesn't exist.");
  const t = team(ctx, h.level === "company" ? "company" : h.division_code);
  if (h.by_oid !== ctx.person.oid && !ctx.access.leadership) throw C.fail(403, "Only the person who added a headline changes it.");
  if (h.shared_meeting_id) throw C.fail(409, "That headline has been shared in a meeting.");
  const f = {};
  if ("text" in ctx.body) f.text = C.text(ctx.body.text, 500, { required: true, label: "Headline" });
  if (ctx.body.deleted) f.is_deleted = 1;
  const keys = Object.keys(f);
  if (keys.length) await db.query(`UPDATE pulse.headline SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @id`, { id: h.id, ...f });
  await db.query(`UPDATE pulse.meeting SET version = version + 1 WHERE status = N'live' AND level = @level AND ${t.division ? "division_code = @d" : "division_code IS NULL"}`, { level: t.level, d: t.division });
  return { ok: true };
}

const routes = [
  { method: "GET", path: "/l10", auth: "person", fn: overview },
  { method: "POST", path: "/l10", auth: "person", fn: start },
  { method: "GET", path: "/l10/:id", auth: "person", fn: state },
  { method: "PATCH", path: "/l10/:id", auth: "person", fn: change },
  { method: "POST", path: "/l10/:id/attendees", auth: "person", fn: addAttendee },
  { method: "PATCH", path: "/l10/:id/attendees/:aid", auth: "person", fn: changeAttendee },
  { method: "POST", path: "/l10/:id/drop", auth: "person", fn: drop },
  { method: "POST", path: "/l10/:id/end", auth: "person", fn: end },
  { method: "GET", path: "/headlines", auth: "person", fn: listHeadlines },
  { method: "POST", path: "/headlines", auth: "person", fn: addHeadline },
  { method: "PATCH", path: "/headlines/:id", auth: "person", fn: changeHeadline },
];

module.exports = { routes, SECTIONS, _test: { nextMeeting, todoReview, suggestions, sectionMinutes, average, fyQuarter } };
