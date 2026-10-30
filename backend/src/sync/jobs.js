"use strict";
/**
 * Sync app jobs (func-hdit-pulse-sync). Timers run in UTC; Sydney times are worked out in code.
 *
 * M0: "connections" — hourly check of which integration credentials have been entered
 *     (never reads them into SQL; only whether each is set and when it last changed).
 * Later milestones add: scorecard (hourly), directory (nightly), departments (15 min),
 * planner (5 min) and Teams nudges.
 */
const db = require("../lib/sql");
const vault = require("../lib/vault");

/** Credentials the sync app can read, with what each is for. Matches setup/pulse-setup.sh. */
const CONNECTIONS = [
  ["autotask-service", "Autotask API user: Service (tickets, projects, time entries)"],
  ["autotask-people", "Autotask API user: People administration (resources, default departments)"],
  ["autotask-finance", "Autotask API user: Finance (contracts, billing), read-only"],
  ["simplesat", "SimpleSAT API key, read-only"],
  ["xero-app", "Xero app (standard OAuth), read-only scopes"],
  ["xero-token", "Xero refresh token"],
  ["datto-rmm", "Datto RMM API, read-only"],
  ["itglue", "IT Glue API, read-only"],
];

/** Runs a job and records it in pulse.sync_run. */
async function run(job, context, fn) {
  const started = new Date();
  const [{ id }] = await db.query(
    "INSERT INTO pulse.sync_run (job, started_at) OUTPUT inserted.id VALUES (@job, @started)", { job, started });
  try {
    const detail = await fn();
    await db.query("UPDATE pulse.sync_run SET finished_at = SYSUTCDATETIME(), ok = 1, detail = @detail WHERE id = @id",
      { id, detail: detail ? String(detail).slice(0, 2000) : null });
    context.log(`${job}: ok ${detail || ""}`);
  } catch (e) {
    await db.query("UPDATE pulse.sync_run SET finished_at = SYSUTCDATETIME(), ok = 0, detail = @detail WHERE id = @id",
      { id, detail: String(e.message || e).slice(0, 2000) }).catch(() => {});
    context.error(`${job}: failed`, e);
    throw e;
  }
}

async function checkConnections() {
  let set = 0;
  for (const [name, description] of CONNECTIONS) {
    let configured = false, updatedAt = null, error = null;
    try {
      const s = await vault.getSecret(name);
      configured = !!(s && s.value);
      updatedAt = s ? s.updatedAt : null;
    } catch (e) { error = e.status === 403 ? "Pulse can't read this credential (check Key Vault access)." : e.message; }
    if (configured) set++;
    await db.query(
      `MERGE pulse.connection_status AS t USING (SELECT @name AS name) AS s ON t.name = s.name
       WHEN MATCHED THEN UPDATE SET description = @description, configured = @configured, secret_updated_at = @updatedAt,
            last_checked_at = SYSUTCDATETIME(), last_error = @error
       WHEN NOT MATCHED THEN INSERT (name, description, configured, secret_updated_at, last_checked_at, last_error)
            VALUES (@name, @description, @configured, @updatedAt, SYSUTCDATETIME(), @error);`,
      { name, description, configured, updatedAt: updatedAt ? new Date(updatedAt) : null, error });
  }
  return `${set} of ${CONNECTIONS.length} credentials entered`;
}

module.exports = { run, checkConnections, CONNECTIONS };
