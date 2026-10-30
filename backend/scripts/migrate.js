#!/usr/bin/env node
"use strict";
/**
 * Applies db/migrations/*.sql to the Pulse database, in order, once each.
 * Run by GitHub Actions after `az login` as the deploy identity (a member of the
 * "Pulse - SQL Admins" group, the server's Entra administrator).
 *
 *   SQL_SERVER=sql-hdit-pulse-test-aue.database.windows.net SQL_DATABASE=sqldb-hdit-pulse-test-aue \
 *   PULSE_API_IDENTITY=id-hdit-pulse-api-test-aue PULSE_API_CLIENT_ID=<guid> \
 *   PULSE_SYNC_IDENTITY=id-hdit-pulse-sync-test-aue PULSE_SYNC_CLIENT_ID=<guid> \
 *   node scripts/migrate.js [--dry-run]
 *
 * - Each file runs in one transaction; batches are split on lines containing only GO.
 * - dbo.schema_migration records each file and its SHA-256. A file that changed after it ran
 *   stops the deploy: add a new migration instead of editing an old one.
 * - Afterwards the two Function identities are made database users (from their client ids,
 *   so no directory lookup is needed) and added to the pulse_api / pulse_sync roles.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.resolve(__dirname, "../../db/migrations");

function splitBatches(text) {
  const onlyComments = b => b.split("\n").every(l => { const t = l.trim(); return !t || t.startsWith("--"); });
  return text.split(/^[ \t]*GO[ \t]*;?[ \t]*$/gim).map(b => b.trim()).filter(b => b && !onlyComments(b));
}

function loadMigrations(dir = DIR) {
  return fs.readdirSync(dir).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().map(f => {
    const text = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
    return { id: f.replace(/\.sql$/, ""), file: f, sha: crypto.createHash("sha256").update(text).digest("hex"), batches: splitBatches(text) };
  });
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z0-9-]{3,64}$/;

/** T-SQL that makes a managed identity a database user (by client id) and adds it to a role. */
function identityUserSql(name, clientId, role) {
  if (!NAME.test(name)) throw new Error(`Bad identity name: ${name}`);
  if (!GUID.test(clientId)) throw new Error(`Bad client id for ${name}`);
  if (!/^pulse_(api|sync)$/.test(role)) throw new Error(`Bad role: ${role}`);
  return `
IF DATABASE_PRINCIPAL_ID(N'${name}') IS NULL
  CREATE USER [${name}] WITH SID = ${sidFromClientId(clientId)}, TYPE = E;
IF IS_ROLEMEMBER(N'${role}', N'${name}') = 0
  ALTER ROLE ${role} ADD MEMBER [${name}];`;
}

/** Entra service principals are identified in SQL by their client (application) id as a 16-byte SID. */
function sidFromClientId(clientId) {
  const hex = clientId.replace(/-/g, "");
  // uniqueidentifier byte order: first three groups little-endian
  const b = Buffer.from(hex, "hex");
  const le = Buffer.concat([Buffer.from(b.subarray(0, 4)).reverse(), Buffer.from(b.subarray(4, 6)).reverse(), Buffer.from(b.subarray(6, 8)).reverse(), b.subarray(8)]);
  return "0x" + le.toString("hex").toUpperCase();
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const migrations = loadMigrations();
  if (dry) {
    for (const m of migrations) console.log(`${m.id}  ${m.batches.length} batches  sha256 ${m.sha.slice(0, 12)}`);
    return;
  }
  const sql = require("mssql");
  const server = process.env.SQL_SERVER, database = process.env.SQL_DATABASE;
  if (!server || !database) throw new Error("Set SQL_SERVER and SQL_DATABASE.");
  const pool = await new sql.ConnectionPool({
    server, database,
    options: { encrypt: true, trustServerCertificate: false, connectTimeout: 60000, requestTimeout: 120000 },
    authentication: { type: "azure-active-directory-default", options: {} },
  }).connect();
  try {
    const who = (await pool.request().query("SELECT SUSER_SNAME() AS who")).recordset[0].who;
    console.log(`Connected to ${database} as ${who}`);
    await pool.request().batch(`
IF OBJECT_ID(N'dbo.schema_migration') IS NULL
CREATE TABLE dbo.schema_migration (
  id NVARCHAR(200) NOT NULL CONSTRAINT pk_schema_migration PRIMARY KEY,
  sha256 CHAR(64) NOT NULL,
  applied_at DATETIME2(3) NOT NULL CONSTRAINT df_schema_migration_at DEFAULT (SYSUTCDATETIME()),
  applied_by NVARCHAR(200) NOT NULL CONSTRAINT df_schema_migration_by DEFAULT (SUSER_SNAME())
);`);
    const done = new Map((await pool.request().query("SELECT id, sha256 FROM dbo.schema_migration")).recordset.map(r => [r.id, r.sha256]));
    let applied = 0;
    for (const m of migrations) {
      if (done.has(m.id)) {
        if (done.get(m.id) !== m.sha) throw new Error(`${m.file} has changed since it was applied. Don't edit applied migrations; add a new one.`);
        continue;
      }
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        for (const [i, b] of m.batches.entries()) {
          try { await new sql.Request(tx).batch(b); }
          catch (e) { e.message = `${m.file} batch ${i + 1}: ${e.message}`; throw e; }
        }
        await new sql.Request(tx).input("id", m.id).input("sha", m.sha).query("INSERT INTO dbo.schema_migration (id, sha256) VALUES (@id, @sha)");
        await tx.commit();
        console.log(`Applied ${m.file}`);
        applied++;
      } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } throw e; }
    }
    if (!applied) console.log("Database is up to date.");

    for (const [nameVar, idVar, role] of [["PULSE_API_IDENTITY", "PULSE_API_CLIENT_ID", "pulse_api"], ["PULSE_SYNC_IDENTITY", "PULSE_SYNC_CLIENT_ID", "pulse_sync"]]) {
      const name = process.env[nameVar], cid = process.env[idVar];
      if (!name || !cid) { console.log(`Skipping ${role} user (${nameVar}/${idVar} not set).`); continue; }
      await pool.request().batch(identityUserSql(name, cid, role));
      console.log(`Database user ${name} → ${role}`);
    }
  } finally { await pool.close(); }
}

if (require.main === module) {
  main().catch(e => { console.error(`::error title=Database migration failed::${String(e.message).replace(/\n/g, " ")}`); process.exit(1); });
}
module.exports = { splitBatches, loadMigrations, identityUserSql, sidFromClientId };
