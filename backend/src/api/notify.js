"use strict";
/**
 * Reminders and the weekly email (D12, 0.9.0), the API side.
 *   GET  /me/preferences                       your reminder choices, and what Pulse sent you lately
 *   PUT  /me/preferences { teamsReminders, weeklyEmail }
 *   POST /notify/test                           send yourself a test (Teams and email), within 2 minutes
 *   PUT  /notify/settings { sender, enabled }   (Platform Admins) the mailbox, and pausing all reminders
 */
const db = require("../lib/sql");
const audit = require("../lib/audit");
const { fail } = require("../lib/errors");
const { requireReason } = require("../eos/logic");

const actor = ctx => ({ oid: ctx.person.oid, name: ctx.person.name });

async function getPrefs(ctx) {
  const [p] = await db.query("SELECT teams_reminders, weekly_email FROM pulse.person_pref WHERE person_oid = @oid", { oid: ctx.person.oid });
  const recent = await db.query(`SELECT TOP 10 kind, channel, text, sent_at, error FROM pulse.nudge_log
      WHERE person_key = @oid OR person_key IN (${ctx.person.emails.length ? ctx.person.emails.map((_, i) => "@e" + i).join(",") : "N''"}) ORDER BY id DESC`,
    { oid: ctx.person.oid, ...Object.fromEntries(ctx.person.emails.map((e, i) => ["e" + i, e])) });
  return {
    teamsReminders: p ? !!p.teams_reminders : true, weeklyEmail: p ? !!p.weekly_email : true,
    recent: recent.map(r => ({ kind: r.kind, channel: r.channel, text: r.text, at: r.sent_at, error: r.error })),
  };
}

async function putPrefs(ctx) {
  const b = ctx.body || {};
  const cur = await getPrefs(ctx);
  const next = { teams: "teamsReminders" in b ? (b.teamsReminders ? 1 : 0) : (cur.teamsReminders ? 1 : 0), email: "weeklyEmail" in b ? (b.weeklyEmail ? 1 : 0) : (cur.weeklyEmail ? 1 : 0) };
  await db.query(`MERGE pulse.person_pref AS t USING (SELECT @oid AS person_oid) AS s ON t.person_oid = s.person_oid
      WHEN MATCHED THEN UPDATE SET teams_reminders = @teams, weekly_email = @email, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (person_oid, teams_reminders, weekly_email) VALUES (@oid, @teams, @email);`, { oid: ctx.person.oid, ...next });
  await audit.record({ actor: actor(ctx), action: "notify.preferences", entity: { type: "person", id: ctx.person.oid },
    before: { teamsReminders: cur.teamsReminders, weeklyEmail: cur.weeklyEmail }, after: { teamsReminders: !!next.teams, weeklyEmail: !!next.email }, request: ctx.request }, ctx.context);
  return { teamsReminders: !!next.teams, weeklyEmail: !!next.email };
}

async function test(ctx) {
  const job = `notify-test:${ctx.person.oid}`;
  const [recent] = await db.query("SELECT TOP 1 id FROM pulse.sync_request WHERE job = @job AND requested_at > DATEADD(minute, -5, SYSUTCDATETIME())", { job });
  if (recent) throw fail(429, "A test is already on its way. Give it a couple of minutes.");
  await db.query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (@job, @by)", { job, by: ctx.person.name });
  return { ok: true };
}

async function putSettings(ctx) {
  const b = ctx.body || {};
  const set = async (key, v) => db.query(`MERGE pulse.app_setting AS t USING (SELECT @key AS [key]) AS s ON t.[key] = s.[key]
      WHEN MATCHED THEN UPDATE SET [value] = @v, updated_by = @by WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (@key, @v, @by);`, { key, v, by: ctx.person.name });
  const changes = {};
  if ("sender" in b) {
    const s = String(b.sender || "").trim().toLowerCase();
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw fail(400, "The sender must be an email address, e.g. pulse@hdit.com.au.");
    await set("mail.sender", s || null); changes.sender = s || null;
  }
  if ("enabled" in b) { await set("notify.enabled", b.enabled ? "1" : "0"); changes.enabled = !!b.enabled; }
  await audit.record({ actor: actor(ctx), action: "notify.settings", entity: { type: "connection", id: "notify" }, after: changes,
    reason: requireReason(b.reason) || undefined, request: ctx.request }, ctx.context);
  return changes;
}

/** For the Connections page. */
async function status() {
  const rows = await db.query("SELECT [key], [value] FROM pulse.app_setting WHERE [key] IN (N'teams.app_id', N'mail.sender', N'notify.enabled')");
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const [run] = await db.query("SELECT TOP 1 finished_at, ok, detail FROM pulse.sync_run WHERE job = N'nudges' AND finished_at IS NOT NULL ORDER BY id DESC");
  const [week] = await db.query("SELECT COUNT(*) AS sent, SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS failed FROM pulse.nudge_log WHERE sent_at >= DATEADD(day, -7, SYSUTCDATETIME())");
  return { appId: s["teams.app_id"] || null, sender: s["mail.sender"] || null, enabled: s["notify.enabled"] !== "0",
    package: "teams/hdit-pulse-teams.zip", lastRun: run ? { at: run.finished_at, ok: !!run.ok, detail: run.detail } : null,
    lastWeek: { sent: week ? week.sent : 0, failed: week ? week.failed || 0 : 0 } };
}

const admin = a => a.manageConnections;
const routes = [
  { method: "GET", path: "/me/preferences", auth: "person", fn: getPrefs },
  { method: "PUT", path: "/me/preferences", auth: "person", fn: putPrefs },
  { method: "POST", path: "/notify/test", auth: "person", fn: test },
  { method: "PUT", path: "/notify/settings", auth: "person", allow: admin, fn: putSettings },
];
module.exports = { routes, status };
