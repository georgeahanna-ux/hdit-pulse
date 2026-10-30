"use strict";
/**
 * Azure SQL connection. Entra ID only: the Function App signs in as its managed identity
 * (AZURE_CLIENT_ID), so there is no SQL password anywhere.
 *
 * Settings: SQL_SERVER (e.g. sql-hdit-pulse-test-aue.database.windows.net), SQL_DATABASE, AZURE_CLIENT_ID.
 *
 * Everything else talks to the database through query()/tx() so tests can swap in a fake.
 */
const sql = require("mssql");

let pool = null, connecting = null;

function config() {
  const server = String(process.env.SQL_SERVER || "").trim();
  const database = String(process.env.SQL_DATABASE || "").trim();
  if (!server || !database) {
    const e = new Error("The Pulse database isn't configured (SQL_SERVER / SQL_DATABASE).");
    e.status = 503; e.expose = true; throw e;
  }
  return {
    server, database,
    options: { encrypt: true, trustServerCertificate: false, connectTimeout: 30000, requestTimeout: 30000 },
    pool: { max: 10, min: 0, idleTimeoutMillis: 60000 },
    authentication: {
      type: "azure-active-directory-default",
      options: { clientId: process.env.AZURE_CLIENT_ID || undefined },
    },
  };
}

async function getPool() {
  if (pool && pool.connected) return pool;
  if (!connecting) {
    connecting = new sql.ConnectionPool(config()).connect()
      .then(p => { pool = p; p.on("error", () => { pool = null; }); return p; })
      .finally(() => { connecting = null; });
  }
  return connecting;
}

/** Adds named parameters to a request. Values may be { type, value } to force a SQL type. */
function bind(req, params = {}) {
  for (const [k, v] of Object.entries(params)) {
    if (v && typeof v === "object" && "type" in v && "value" in v) req.input(k, v.type, v.value);
    else req.input(k, v === undefined ? null : v);
  }
  return req;
}

let impl = {
  async query(text, params) {
    const p = await getPool();
    const r = await bind(p.request(), params).query(text);
    return r.recordset || [];
  },
  async tx(fn) {
    const p = await getPool();
    const t = new sql.Transaction(p);
    await t.begin();
    const q = async (text, params) => (await bind(new sql.Request(t), params).query(text)).recordset || [];
    try { const out = await fn(q); await t.commit(); return out; }
    catch (e) { try { await t.rollback(); } catch { /* already rolled back */ } throw e; }
  },
  async ping() { const r = await this.query("SELECT 1 AS ok"); return r[0] && r[0].ok === 1; },
};

module.exports = {
  types: sql,
  query: (text, params) => impl.query(text, params),
  tx: fn => impl.tx(fn),
  ping: () => impl.ping(),
  configured: () => !!(process.env.SQL_SERVER && process.env.SQL_DATABASE),
  _test: { use(fake) { impl = fake; } },
};
