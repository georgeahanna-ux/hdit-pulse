"use strict";
/**
 * Reminders and the weekly summary (D12, 0.9.0). The sync service runs this every 15 minutes;
 * each reminder is sent once (pulse.nudge_log), only to the person it's about, and only if
 * they haven't switched that kind off (pulse.person_pref).
 *
 * Teams Activity feed (Graph TeamsActivity.Send, the sync service's own identity). Opens the
 * right page of Pulse in Teams. The person needs Pulse installed in Teams (an app setup policy).
 *   Monday from 8am      measurable owners with a figure still to enter for last week
 *   Monday from 9am      owners of company Rocks that are off track
 *   Tuesday 9–10am       the leadership team: the L10 at 9:30, numbers off target, Issues numbered
 *   after each L10       each person's new To-dos from it
 *   weekdays 8am–6pm     each overdue To-do, once
 * Email (Graph Mail.Send, limited in Exchange to one shared mailbox)
 *   Monday from 7am      a one-page summary: your To-dos, Rocks and numbers, the company Scorecard
 * All times are Sydney's.
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const L = require("../eos/logic");

/* ------------------------------ pure logic ------------------------------ */

/** Which scheduled reminders are due at this Sydney moment, and what they're about. */
function due(now = new Date()) {
  const p = time.sydneyParts(now);
  const week = time.weekOf(now), review = time.reviewWeek(now);
  const out = [];
  if (p.weekday === 0 && p.hour >= 7) out.push({ kind: "email", ref: week });
  if (p.weekday === 0 && p.hour >= 8) out.push({ kind: "numbers", ref: review });
  if (p.weekday === 0 && p.hour >= 9) out.push({ kind: "rock", ref: week });
  if (p.weekday === 1 && p.hour === 9) out.push({ kind: "l10", ref: week });
  if (p.weekday <= 4 && p.hour >= 8 && p.hour < 18) out.push({ kind: "overdue", ref: null });
  out.push({ kind: "l10-todos", ref: null });   // whenever a meeting has ended
  return out;
}

/** A Teams deep link that opens Pulse's personal tab at a page. */
function deepLink(appId, page) {
  return `https://teams.microsoft.com/l/entity/${encodeURIComponent(appId)}/home?context=${encodeURIComponent(JSON.stringify({ subEntityId: page }))}`;
}

const day = d => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : "");
const short = d => new Date(day(d) + "T12:00:00+10:00").toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });
const list = (names, n = 3) => names.slice(0, n).join(", ") + (names.length > n ? ` and ${names.length - n} more` : "");
const quote = s => `"${String(s).slice(0, 80)}"`;

const TEXT = {
  numbers: (week, names) => `Your numbers for the week of ${short(week)}: ${names.length} still to enter (${list(names)}). The week locks at 5pm Tuesday.`,
  rock: title => `Your Rock ${quote(title)} is off track. Drop it to the Issues List if you need the team's help.`,
  l10: (off, mine, numbered) => `L10 at 9:30am. ${off ? `${off} number${off === 1 ? " was" : "s were"} off target last week${mine.length ? `, ${mine.length === 1 ? "one" : mine.length} of them yours (${list(mine)})` : ""}.` : "Every number with a goal was on target last week."} ${numbered ? `${numbered} Issue${numbered === 1 ? " is" : "s are"} numbered for IDS.` : "No Issues numbered for IDS yet."}`,
  todos: items => `From today's L10: ${items.length === 1 ? "a To-do" : `${items.length} To-dos`} for you: ${items.slice(0, 3).map(t => `${quote(t.title)} (due ${short(t.due_date)})`).join(", ")}${items.length > 3 ? ", …" : ""}.`,
  overdue: t => `Overdue To-do: ${quote(t.title)} was due ${short(t.due_date)}. Tick it off, change the date, or drop it to the Issues List.`,
};

/* ------------------------------ the weekly email ------------------------------ */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** One page, inline styles only (email clients), HD IT Brand V5 colours. */
function emailHtml({ name, week, pulseUrl, todos, rocks, numbers, company, l10 }) {
  const NAVY = "#101B3C", LEMON = "#F0F0B4", MIST = "#EEF0F5", ALERT = "#C0392B";
  const sec = (title, body) => `<tr><td style="padding:18px 28px 4px"><div style="font:700 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#5A6275">${esc(title)}</div>${body}</td></tr>`;
  const item = (main, side, alert) => `<div style="padding:8px 0;border-bottom:1px solid ${MIST};font:15px/1.4 Arial,sans-serif;color:${NAVY}">${main}${side ? `<span style="color:${alert ? ALERT : "#5A6275"};font-size:13px"> · ${side}</span>` : ""}</div>`;
  const none = t => `<div style="padding:8px 0;font:14px Arial,sans-serif;color:#5A6275">${esc(t)}</div>`;
  return `<!DOCTYPE html><html><body style="margin:0;background:${MIST}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MIST};padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:${NAVY};padding:22px 28px"><div style="font:700 12px Arial,sans-serif;letter-spacing:.14em;color:${LEMON}">[ HD IT PULSE ]</div>
<div style="font:800 24px Arial,sans-serif;color:#fff;margin-top:6px">Your week, ${esc(short(week))}</div>
<div style="font:15px Arial,sans-serif;color:#C9CEDC;margin-top:4px">Good morning ${esc(name.split(" ")[0])}. Here's what's yours in Pulse this week.</div></td></tr>
${sec("Your To-dos", todos.length ? todos.slice(0, 10).map(t => item(esc(t.title), t.overdue ? `overdue, was due ${esc(short(t.due))}` : `due ${esc(short(t.due))}`, t.overdue)).join("") : none("Nothing on your list."))}
${rocks.length ? sec("Your Rocks this quarter", rocks.map(r => item(esc(r.title), r.status === "off_track" ? "off track" : r.status === "done" ? "done" : r.status === "not_done" ? "not done" : "on track", r.status === "off_track")).join("")) : ""}
${numbers.length ? sec("Your numbers to enter for last week", numbers.map(n => item(esc(n), "", false)).join("") + none("The week locks at 5pm Tuesday.")) : ""}
${sec("Company Scorecard, last week", company.total ? `<div style="padding:8px 0;font:15px Arial,sans-serif;color:${NAVY}"><b>${company.on}</b> of ${company.total} numbers with a goal on target.${company.off.length ? ` Off target: ${esc(list(company.off, 6))}.` : ""}</div>` : none("No figures yet."))}
${l10 ? sec("The L10", `<div style="padding:8px 0;font:15px Arial,sans-serif;color:${NAVY}">${esc(l10)}</div>`) : ""}
<tr><td style="padding:22px 28px 26px"><a href="${esc(pulseUrl)}" style="display:inline-block;background:${LEMON};color:${NAVY};font:700 15px Arial,sans-serif;text-decoration:none;padding:12px 18px;border-radius:8px">Open Pulse</a>
<div style="font:12px/1.5 Arial,sans-serif;color:#5A6275;margin-top:18px">Sent every Monday by HD IT Pulse. To stop it, open Pulse, select your initials, then Notifications.</div></td></tr>
</table></td></tr></table></body></html>`;
}

/* ------------------------------ sending ------------------------------ */
async function settings() {
  const rows = await db.query("SELECT [key], [value] FROM pulse.app_setting WHERE [key] IN (N'teams.app_id', N'mail.sender', N'notify.enabled')");
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { appId: s["teams.app_id"] || null, sender: s["mail.sender"] || null, enabled: s["notify.enabled"] !== "0" };
}

async function people() {
  const rows = await db.query(`SELECT p.entra_oid, p.display_name, p.email, a.last_sign_in_at,
      ISNULL(pr.teams_reminders, 1) AS teams_reminders, ISNULL(pr.weekly_email, 1) AS weekly_email
    FROM pulse.person p LEFT JOIN pulse.person_pref pr ON pr.person_oid = p.entra_oid LEFT JOIN pulse.person_activity a ON a.person_id = p.id
    WHERE p.is_active = 1`);
  const byEmail = new Map(rows.filter(r => r.email).map(r => [String(r.email).toLowerCase(), r]));
  return { all: rows, byEmail, of: e => (e ? byEmail.get(String(e).toLowerCase()) || null : null) };
}

/**
 * Sends one reminder once. The log row is written first, so two runs can't both send it;
 * a failed send keeps its row with the error (it isn't retried, so nobody gets duplicates).
 */
async function once(ctx, { kind, ref, person, channel, text, page, send }) {
  const key = channel === "teams" ? person.entra_oid : String(person.email).toLowerCase();
  try {
    await db.query("INSERT INTO pulse.nudge_log (kind, ref, person_key, channel, text) VALUES (@kind, @ref, @key, @channel, @text)",
      { kind, ref: String(ref), key, channel, text: String(text).slice(0, 500) });
  } catch { return "dup"; }
  try { await send(); ctx.sent++; return "sent"; }
  catch (e) {
    ctx.failed++; ctx.errors.push(`${kind} to ${person.display_name}: ${e.message}`.slice(0, 200));
    await db.query("UPDATE pulse.nudge_log SET error = @e WHERE kind = @kind AND ref = @ref AND person_key = @key AND channel = @channel",
      { e: String(e.message).slice(0, 400), kind, ref: String(ref), key, channel }).catch(() => {});
    return "failed";
  }
}

function teamsSender(graph, appId) {
  return (person, text, page) => graph.send("POST", `/users/${encodeURIComponent(person.entra_oid)}/teamwork/sendActivityNotification`, {
    topic: { source: "text", value: "HD IT Pulse", webUrl: deepLink(appId, page) },
    activityType: "pulseReminder",
    previewText: { content: text.slice(0, 150) },
    templateParameters: [{ name: "text", value: text.slice(0, 400) }],
  });
}

async function teamsNudge(ctx, kind, ref, person, text, page) {
  if (!person || !person.teams_reminders || !ctx.appId) return;
  return once(ctx, { kind, ref, person, channel: "teams", text, page, send: () => ctx.teams(person, text, page) });
}

/* ------------------------------ each kind ------------------------------ */
async function weekValues(week) {
  return db.query(`SELECT m.id, m.name, m.owner_email, m.auto_enabled, m.goal_value, m.direction, m.restricted,
      v.auto_value, v.entered_value, v.override_value, v.is_overridden
    FROM pulse.measurable m LEFT JOIN pulse.scorecard_value v ON v.measurable_id = m.id AND v.week = @week
    WHERE m.is_active = 1 AND m.scope = N'company'`, { week });
}
const shown = r => L.shownValue(r, !!r.auto_enabled).value;

async function numbers(ctx, ref) {
  const rows = await weekValues(ref);
  const by = new Map();
  for (const r of rows) if (r.owner_email && shown(r) === null) (by.get(r.owner_email.toLowerCase()) || by.set(r.owner_email.toLowerCase(), []).get(r.owner_email.toLowerCase())).push(r.name);
  for (const [email, names] of by) await teamsNudge(ctx, "numbers", ref, ctx.people.of(email), TEXT.numbers(ref, names), "scorecard");
}

async function rocks(ctx, ref) {
  const { fy, quarter } = time.fyOf(new Date());
  const rows = await db.query(`SELECT id, title, owner_email FROM pulse.rock WHERE is_archived = 0 AND status = N'off_track' AND level = N'company' AND fy = @fy AND quarter = @quarter`, { fy, quarter });
  for (const r of rows) await teamsNudge(ctx, "rock", `${r.id}:${ref}`, ctx.people.of(r.owner_email), TEXT.rock(r.title), "rocks");
}

async function l10(ctx, ref) {
  const team = await require("../eos/l10").expectedPeople({ level: "company", division: null });
  const rows = await weekValues(time.reviewWeek(new Date()));
  const off = rows.filter(r => !r.restricted && L.onTarget(r, shown(r)) === false);
  const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM pulse.issue WHERE status = N'open' AND level = N'company' AND priority IS NOT NULL");
  for (const m of team) {
    const person = ctx.people.of(m.email) || ctx.people.all.find(p => p.display_name && p.display_name.toLowerCase() === m.name.toLowerCase());
    if (!person) continue;
    const mine = off.filter(r => r.owner_email && person.email && r.owner_email.toLowerCase() === person.email.toLowerCase()).map(r => r.name);
    await teamsNudge(ctx, "l10", ref, person, TEXT.l10(off.length, mine, n), "l10");
  }
}

async function l10Todos(ctx) {
  const meetings = await db.query(`SELECT id, started_at, ended_at, level, division_code FROM pulse.meeting
      WHERE status = N'ended' AND ended_at >= DATEADD(day, -2, SYSUTCDATETIME())`);
  for (const m of meetings) {
    const todos = await db.query(`SELECT id, title, owner_email, due_date FROM pulse.todo WHERE is_deleted = 0 AND is_done = 0 AND level = @level
        AND ${m.division_code ? "division_code = @d" : "division_code IS NULL"} AND created_at >= @s AND created_at <= @e`,
      { level: m.level, d: m.division_code, s: m.started_at, e: m.ended_at });
    const by = new Map();
    for (const t of todos) if (t.owner_email) (by.get(t.owner_email.toLowerCase()) || by.set(t.owner_email.toLowerCase(), []).get(t.owner_email.toLowerCase())).push(t);
    for (const [email, items] of by) await teamsNudge(ctx, "l10-todos", m.id, ctx.people.of(email), TEXT.todos(items), "todos");
  }
}

async function overdue(ctx) {
  const today = time.sydneyDate(new Date());
  const rows = await db.query(`SELECT id, title, owner_email, due_date FROM pulse.todo WHERE is_deleted = 0 AND is_done = 0 AND owner_email IS NOT NULL
      AND due_date < @today AND due_date >= DATEADD(day, -60, CAST(@today AS DATE))`, { today });
  for (const t of rows) await teamsNudge(ctx, "overdue", t.id, ctx.people.of(t.owner_email), TEXT.overdue(t), "todos");
}

async function emails(ctx, ref, { only = null } = {}) {
  if (!ctx.sender) { ctx.notes.push("weekly email: no sender mailbox set"); return; }
  const review = time.reviewWeek(new Date());
  const rows = await weekValues(review);
  const goal = rows.filter(r => !r.restricted && L.onTarget(r, shown(r)) !== null);
  const company = { total: goal.length, on: goal.filter(r => L.onTarget(r, shown(r))).length, off: goal.filter(r => L.onTarget(r, shown(r)) === false).map(r => r.name) };
  const today = time.sydneyDate(new Date());
  const { fy, quarter } = time.fyOf(new Date());
  const team = await require("../eos/l10").expectedPeople({ level: "company", division: null });
  const next = require("../eos/l10").nextMeeting(new Date());
  const recipients = ctx.people.all.filter(p => p.email && (only ? p.entra_oid === only : p.weekly_email && p.last_sign_in_at && Date.now() - new Date(p.last_sign_in_at).getTime() < 90 * 86400e3));
  for (const p of recipients) {
    const email = p.email.toLowerCase();
    const [todos, rockRows] = await Promise.all([
      db.query("SELECT title, due_date FROM pulse.todo WHERE is_deleted = 0 AND is_done = 0 AND LOWER(owner_email) = @e ORDER BY due_date", { e: email }),
      db.query("SELECT title, status FROM pulse.rock WHERE is_archived = 0 AND fy = @fy AND quarter = @q AND LOWER(owner_email) = @e ORDER BY level, sort", { fy, q: quarter, e: email }),
    ]);
    const mineToEnter = rows.filter(r => r.owner_email && r.owner_email.toLowerCase() === email && shown(r) === null).map(r => r.name);
    const inTeam = team.some(m => (m.email && m.email === email) || m.name.toLowerCase() === String(p.display_name).toLowerCase());
    const html = emailHtml({
      name: p.display_name, week: ref, pulseUrl: ctx.pulseUrl,
      todos: todos.map(t => ({ title: t.title, due: day(t.due_date), overdue: day(t.due_date) < today })),
      rocks: rockRows, numbers: mineToEnter, company,
      l10: inTeam && next ? `Next L10: ${next.toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true })}.` : null,
    });
    await once(ctx, { kind: only ? "test" : "email", ref: only ? new Date().toISOString().slice(0, 16) : ref, person: p, channel: "email", text: `Weekly summary to ${p.email}`, send: () =>
      ctx.graph.send("POST", `/users/${encodeURIComponent(ctx.sender)}/sendMail`, { message: {
        subject: `Pulse: your week, ${short(ref)}`, body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: p.email, name: p.display_name } }] }, saveToSentItems: false }) });
  }
}

/* ------------------------------ runs ------------------------------ */
async function context(graph) {
  const s = await settings();
  return { ...s, graph, teams: teamsSender(graph, s.appId), people: await people(), sent: 0, failed: 0, errors: [], notes: [],
    pulseUrl: String(process.env.PULSE_ORIGIN || "").replace(/\/+$/, "") + "/" };
}

const KINDS = { numbers, rock: rocks, l10, "l10-todos": l10Todos, overdue, email: emails };

/** The 15-minute run. */
async function runNudges({ graph = require("../lib/graph"), now = new Date() } = {}) {
  const ctx = await context(graph);
  if (!ctx.enabled) return "Reminders are paused (Connections).";
  if (!ctx.appId) ctx.notes.push("Teams: no app id set");
  for (const d of due(now)) {
    try { await KINDS[d.kind](ctx, d.ref); } catch (e) { ctx.failed++; ctx.errors.push(`${d.kind}: ${e.message}`.slice(0, 200)); }
  }
  const out = `${ctx.sent} sent, ${ctx.failed} failed${ctx.errors.length ? ` (${ctx.errors.slice(0, 3).join("; ")})` : ""}${ctx.notes.length ? `; ${ctx.notes.join("; ")}` : ""}`;
  if (ctx.failed && !ctx.sent) throw new Error(out);
  return out;
}

/** "Send me a test": one Teams reminder and the weekly email, to the person who asked. */
async function sendTest(oid, { graph = require("../lib/graph") } = {}) {
  const ctx = await context(graph);
  const person = ctx.people.all.find(p => p.entra_oid === oid);
  if (!person) return "You're not in the People directory yet.";
  const ref = new Date().toISOString().slice(0, 16);
  const results = [];
  if (ctx.appId) results.push(`Teams: ${await once(ctx, { kind: "test", ref, person, channel: "teams", text: "Test from HD IT Pulse: reminders will arrive here.", page: "home",
    send: () => ctx.teams(person, "Test from HD IT Pulse: reminders will arrive here.", "home") })}`);
  if (ctx.sender) { await emails(ctx, time.weekOf(new Date()), { only: oid }); results.push(`email: ${ctx.failed ? "failed" : "sent"}`); }
  else results.push("email: no sender mailbox set");
  return results.join("; ") + (ctx.errors.length ? ` (${ctx.errors.join("; ")})` : "");
}

module.exports = { runNudges, sendTest, _test: { due, deepLink, TEXT, emailHtml } };
