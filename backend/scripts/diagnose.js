#!/usr/bin/env node
"use strict";
/**
 * Read-only health report on the Pulse database, for the "Diagnose test" workflow:
 * recent sync runs, which credentials are entered (never their values), and how much
 * Autotask data Pulse holds. Signs in like migrate.js (the deploy identity, via az login).
 */
const sql = require("mssql");

(async () => {
  const pool = await new sql.ConnectionPool({
    server: process.env.SQL_SERVER, database: process.env.SQL_DATABASE,
    authentication: { type: "azure-active-directory-default", options: {} },
    options: { encrypt: true },
  }).connect();
  // Optional: ask the sync service for a read-only look at one opportunity (INSPECT_OPPORTUNITY=<id>).
  if (process.env.INSPECT_OPPORTUNITY && /^\d+$/.test(process.env.INSPECT_OPPORTUNITY)) {
    await pool.request().input("job", sql.NVarChar, `inspect:opportunity:${process.env.INSPECT_OPPORTUNITY}`)
      .query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (@job, N'Diagnose workflow')");
    console.log(`Asked the sync service to inspect opportunity ${process.env.INSPECT_OPPORTUNITY}; run Diagnose again in 3 minutes.`);
  }
  // Optional: ask the sync service to run a job now (REFRESH_JOB=scorecard|projects|departments|directory|connections|links|nudges),
  // or inspect:simplesat for a look at SimpleSAT answers (field names and ratings only).
  if (/^(scorecard|projects|departments|directory|connections|links|nudges|clients|inspect:simplesat(-responses)?)$/.test(process.env.REFRESH_JOB || "")) {
    await pool.request().input("job", sql.NVarChar, process.env.REFRESH_JOB).query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (@job, N'Diagnose workflow')");
    console.log(`Asked the sync service to run ${process.env.REFRESH_JOB} now (within two minutes).`);
  }
  const insp = await pool.request().query("SELECT job, detail FROM pulse.sync_run WHERE job LIKE N'inspect%' AND started_at > DATEADD(hour, -2, SYSUTCDATETIME()) ORDER BY id");
  if (insp.recordset.length) { console.log("\n=== Inspection ==="); console.log(insp.recordset.map(r => r.detail).join("")); }
  const q = async (title, text) => {
    const r = await pool.request().query(text);
    console.log(`\n=== ${title} ===`);
    console.table(r.recordset);
  };
  await q("Last 20 sync runs", "SELECT TOP 20 id, job, started_at, finished_at, ok, LEFT(detail, 1500) AS detail FROM pulse.sync_run ORDER BY id DESC");
  const last = await pool.request().query("SELECT TOP 8 job, started_at, detail FROM pulse.sync_run ORDER BY id DESC");
  console.log("\n=== Latest run details (full) ===");
  for (const r of last.recordset) console.log(`${r.job} ${new Date(r.started_at).toISOString().slice(11, 16)}: ${r.detail}`);
  await q("Last failure of each job", `SELECT s.job, s.started_at, LEFT(s.detail, 600) AS detail FROM pulse.sync_run s
    WHERE s.id IN (SELECT MAX(id) FROM pulse.sync_run WHERE ok = 0 GROUP BY job)`);
  await q("Credentials entered", "SELECT name, configured, secret_updated_at, last_checked_at, last_error FROM pulse.connection_status ORDER BY name");
  await q("Refresh requests", "SELECT TOP 10 id, job, requested_by, requested_at, picked_at FROM pulse.sync_request ORDER BY id DESC");
  await q("Autotask data in Pulse", `SELECT
    (SELECT COUNT(*) FROM pulse.at_resource) AS resources, (SELECT COUNT(*) FROM pulse.at_department) AS departments,
    (SELECT COUNT(*) FROM pulse.at_project WHERE is_open = 1) AS open_projects, (SELECT COUNT(*) FROM pulse.at_task) AS tasks,
    (SELECT COUNT(*) FROM pulse.at_task_predecessor) AS dependencies, (SELECT COUNT(*) FROM pulse.holiday) AS holidays,
    (SELECT COUNT(*) FROM pulse.person_link) AS people_linked, (SELECT COUNT(*) FROM pulse.scorecard_value WHERE auto_value IS NOT NULL) AS auto_values`);
  await q("Latest automatic values", `SELECT m.code, v.week, v.auto_value, LEFT(JSON_VALUE(v.auto_detail, '$.text'), 160) AS working
    FROM pulse.scorecard_value v JOIN pulse.measurable m ON m.id = v.measurable_id
    WHERE v.auto_value IS NOT NULL AND v.week = (SELECT MAX(week) FROM pulse.scorecard_value w WHERE w.measurable_id = v.measurable_id AND w.week < CAST(SYSUTCDATETIME() AS DATE) AND w.auto_value IS NOT NULL AND w.week <= DATEADD(day, -7, CAST(SYSUTCDATETIME() AS DATE)))`);
  await q("FY plan automatic months", `SELECT p.code, a.month, a.auto_value, LEFT(JSON_VALUE(a.auto_detail, '$.text'), 120) AS working
    FROM pulse.plan_month_actual a JOIN pulse.plan_metric p ON p.id = a.metric_id WHERE a.auto_value IS NOT NULL ORDER BY p.code, a.month`);
  // Two-way links (0.8.0); the tables arrive with migration 0015.
  await q("Links", `SELECT (SELECT [value] FROM pulse.app_setting WHERE [key] = N'planner.l10_plan_id') AS l10_plan,
    (SELECT COUNT(*) FROM pulse.planner_plan) AS plans_known, (SELECT COUNT(*) FROM pulse.todo_planner) AS todos_in_planner,
    (SELECT COUNT(*) FROM pulse.todo_planner WHERE last_error IS NOT NULL) AS todo_errors,
    (SELECT COUNT(*) FROM pulse.issue_link) AS issues_in_autotask, (SELECT COUNT(*) FROM pulse.rock_link) AS rocks_linked`).catch(() => {});
  await q("Link errors", `SELECT TOP 10 N'todo' AS kind, todo_id AS id, last_error FROM pulse.todo_planner WHERE last_error IS NOT NULL
    UNION ALL SELECT TOP 10 N'issue', issue_id, last_error FROM pulse.issue_link WHERE last_error IS NOT NULL
    UNION ALL SELECT TOP 10 N'rock', rock_id, last_error FROM pulse.rock_link WHERE last_error IS NOT NULL`).catch(() => {});
  await q("Reminders sent (last 20)", "SELECT TOP 20 kind, ref, channel, LEFT(text, 100) AS text, sent_at, LEFT(error, 160) AS error FROM pulse.nudge_log ORDER BY id DESC").catch(() => {});
  await pool.close();
})().catch(e => { console.error("Diagnose failed:", e.message); process.exit(1); });
