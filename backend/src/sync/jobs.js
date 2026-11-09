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

/** Entered? A Key Vault refusal is an error to fix (setup), not "not entered yet". */
const isConnected = async cred => {
  let s;
  try { s = await vault.getSecret(cred); }
  catch (e) {
    if (/HTTP 403/.test(e.message)) throw new Error(`The sync service isn't allowed to read ${cred} in Key Vault. Run "bash pulse-setup.sh release1" again (Azure account) to restore its access.`);
    throw e;
  }
  return !!(s && s.value);
};

/** Credentials the sync app can read, with what each is for. Matches setup/pulse-setup.sh. */
const CONNECTIONS = [
  ["autotask-service", "Autotask API user (one for all of Pulse; Pulse limits what each module can do)"],
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

/* ---------------- People directory and departments (D10, D16) ---------------- */
const directory = require("../people/directory");

/** Runs a job that needs a credential; quietly skips (no run recorded) while it hasn't been entered. */
async function runIfConnected(job, context, fn, cred = directory.PEOPLE_CRED) {
  let entered;
  try { entered = await isConnected(cred); }
  catch (e) { await run(job, context, async () => { throw e; }).catch(() => {}); return; }
  if (!entered) { context.log(`${job}: skipped, ${cred} not entered yet`); return; }
  await run(job, context, fn);
}

async function syncDepartments() {
  const a = await directory.syncAutotask();
  const m = await directory.runMatching();
  return `${a.resources} resources, ${a.departments} departments, ${a.pairings} pairings; ${m.linked} linked (+${m.added} −${m.removed}), ${m.review} to review`;
}

async function syncDirectory() {
  const e = await directory.syncEntra();
  let a = null;
  try { a = await directory.syncAutotask(); } catch (err) { if (err.code !== "not-connected") throw err; }
  const m = await directory.runMatching();
  return `Entra: ${e.people} people, ${e.leavers} left; ${a ? `Autotask: ${a.resources} resources` : "Autotask not connected yet"}; ${m.linked} linked, ${m.review} to review`;
}

/* ---------------- Scorecard collectors (M2) ---------------- */
const collect = require("../collect");


const syncScorecard = () => collect.runScorecard({ isConnected });

/* ---------------- Projects (D21) ---------------- */
const syncProjects = () => require("../projects/sync").syncAll();

const REQUESTABLE = { connections: checkConnections, directory: syncDirectory, departments: syncDepartments, scorecard: syncScorecard, projects: syncProjects };

/** Picks up "Refresh now" requests made in Pulse (oldest first, one of each job at a time). */
async function runRequests(context) {
  const picked = await db.query(`
    UPDATE pulse.sync_request SET picked_at = SYSUTCDATETIME()
    OUTPUT inserted.id, inserted.job, inserted.requested_by
     WHERE picked_at IS NULL AND requested_at > DATEADD(hour, -1, SYSUTCDATETIME())`);
  for (const job of [...new Set(picked.map(p => p.job))]) {
    if (!REQUESTABLE[job]) continue;
    const by = picked.filter(p => p.job === job).map(p => p.requested_by)[0];
    await run(job, context, async () => `Requested by ${by}. ` + await REQUESTABLE[job]()).catch(() => {});
  }
}

module.exports = { run, runIfConnected, checkConnections, syncDepartments, syncDirectory, syncScorecard, syncProjects, runRequests, CONNECTIONS };
