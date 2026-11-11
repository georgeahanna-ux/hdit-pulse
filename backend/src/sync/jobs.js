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

// To-dos <-> Planner, Rock progress and Issue links (D11, 0.8.0).
const syncLinks = () => require("../links").runLinks({ autotaskReady: () => isConnected("autotask-service").catch(() => false) });
// Teams reminders and the weekly email (D12, 0.9.0).
const syncNudges = () => require("../notify").runNudges();
const REQUESTABLE = { nudges: syncNudges, connections: checkConnections, directory: syncDirectory, departments: syncDepartments, scorecard: syncScorecard, projects: syncProjects, links: syncLinks };

/**
 * Read-only look at one Autotask opportunity and its quotes (job "inspect:opportunity:<id>",
 * asked for by the Diagnose workflow), to see how a sale records seats. Uses the scorecard
 * module's read-only access. Written to pulse.sync_run in 1,900-character parts.
 */
async function inspectOpportunity(id) {
  const at = require("../lib/autotask");
  const M = "scorecard";
  const compact = o => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== null && v !== "" && v !== 0 && k !== "userDefinedFields" || (k === "userDefinedFields" && v && v.some(u => u.value))).map(([k, v]) => [k, k === "userDefinedFields" ? v.filter(u => u.value) : v]));
  const [opp] = await at.query(M, "Opportunities", [{ op: "eq", field: "id", value: id }]);
  if (!opp) return [`Opportunity ${id} not found.`];
  const [stages, statuses] = await Promise.all([at.picklist(M, "Opportunities", "stage"), at.picklist(M, "Opportunities", "status")]);
  const quotes = await at.query(M, "Quotes", [{ op: "eq", field: "opportunityID", value: id }]);
  const items = quotes.length ? await at.queryIn(M, "QuoteItems", "quoteID", quotes.map(q => q.id)) : [];
  const svcIds = [...new Set(items.map(i => i.serviceID).filter(Boolean))];
  const services = svcIds.length ? await at.queryIn(M, "Services", "id", svcIds, ["id", "name"]) : [];
  const out = JSON.stringify({
    opportunity: { ...compact(opp), stageLabel: (stages.find(s => s.value === Number(opp.stage)) || {}).label, statusLabel: (statuses.find(s => s.value === Number(opp.status)) || {}).label },
    stages: stages.map(s => `${s.value}=${s.label}`),
    quotes: quotes.map(compact),
    items: items.map(i => ({ ...compact(i), serviceName: (services.find(s => s.id === i.serviceID) || {}).name })),
  });
  const parts = [];
  for (let i = 0; i < out.length; i += 1900) parts.push(out.slice(i, i + 1900));
  return parts.slice(0, 20);
}

/** Picks up "Refresh now" requests made in Pulse (oldest first, one of each job at a time). */
async function runRequests(context) {
  const picked = await db.query(`
    UPDATE pulse.sync_request SET picked_at = SYSUTCDATETIME()
    OUTPUT inserted.id, inserted.job, inserted.requested_by
     WHERE picked_at IS NULL AND requested_at > DATEADD(hour, -1, SYSUTCDATETIME())`);
  for (const job of [...new Set(picked.map(p => p.job))]) {
    const insp = /^inspect:opportunity:(\d+)$/.exec(job);
    if (insp) {
      try {
        const parts = await inspectOpportunity(Number(insp[1]));
        for (const [i, part] of parts.entries()) await db.query("INSERT INTO pulse.sync_run (job, started_at, finished_at, ok, detail) VALUES (@job, SYSUTCDATETIME(), SYSUTCDATETIME(), 1, @detail)", { job: `inspect ${i + 1}/${parts.length}`, detail: part });
      } catch (e) { await db.query("INSERT INTO pulse.sync_run (job, started_at, finished_at, ok, detail) VALUES (N'inspect', SYSUTCDATETIME(), SYSUTCDATETIME(), 0, @detail)", { detail: String(e.message).slice(0, 2000) }); }
      continue;
    }
    const test = /^notify-test:([0-9a-f-]{36})$/i.exec(job);
    if (test) {
      await run("notify-test", context, () => require("../notify").sendTest(test[1])).catch(() => {});
      continue;
    }
    if (job === "inspect:simplesat") {
      try { const out = await require("../collect/simplesat").inspect();
        for (let i = 0, n = Math.ceil(out.length / 1900); i < Math.min(n, 10); i++) await db.query("INSERT INTO pulse.sync_run (job, started_at, finished_at, ok, detail) VALUES (@job, SYSUTCDATETIME(), SYSUTCDATETIME(), 1, @detail)", { job: `inspect ${i + 1}/${n}`, detail: out.slice(i * 1900, (i + 1) * 1900) });
      } catch (e) { await db.query("INSERT INTO pulse.sync_run (job, started_at, finished_at, ok, detail) VALUES (N'inspect', SYSUTCDATETIME(), SYSUTCDATETIME(), 0, @detail)", { detail: String(e.message).slice(0, 2000) }); }
      continue;
    }
    if (!REQUESTABLE[job]) continue;
    const by = picked.filter(p => p.job === job).map(p => p.requested_by)[0];
    await run(job, context, async () => `Requested by ${by}. ` + await REQUESTABLE[job]()).catch(() => {});
  }
}

module.exports = { run, runIfConnected, checkConnections, syncDepartments, syncDirectory, syncScorecard, syncProjects, syncLinks, syncNudges, runRequests, CONNECTIONS };
