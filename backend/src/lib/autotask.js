"use strict";
/**
 * Autotask REST client for Pulse. Each call names the credential it uses (autotask-service,
 * autotask-people, autotask-finance), so every request runs as the least-privileged API user
 * for the job (D7). Credentials come from Key Vault, which only lets each Pulse component
 * read the ones it was granted.
 *
 * Query: POST /V1.0/<Entity>/query { filter, MaxRecords, IncludeFields }, following
 * pageDetails.nextPageUrl. Update: PATCH /V1.0/<Entity> { id, ... }. Create: POST /V1.0/<Entity>.
 */
const vault = require("./vault");
const { fail } = require("./errors");

const cache = new Map();   // credential name → { creds, at }
const TTL = 10 * 60e3;

async function credsFor(name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL) return hit.creds;
  const s = await vault.getSecret(name);
  if (!s || !s.value) throw fail(503, `The ${name} connection hasn't been entered yet. A Platform Admin can add it under Connections.`, "not-connected");
  let c;
  try { c = JSON.parse(s.value); } catch { throw fail(503, `The ${name} connection is in an old format. Replace it under Connections.`); }
  if (!c.username || !c.secret || !c.integrationCode || !c.baseUrl) throw fail(503, `The ${name} connection is incomplete. Replace it under Connections.`);
  cache.set(name, { creds: c, at: Date.now() });
  return c;
}

let fetchImpl = (...a) => fetch(...a);

async function call(cred, method, path, body) {
  const c = await credsFor(cred);
  const url = /^https:/.test(path) ? path : c.baseUrl.replace(/\/+$/, "") + path;
  if (!url.startsWith(c.baseUrl.replace(/\/+$/, ""))) throw new Error("Refusing to send Autotask credentials to another address.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(url, {
      method,
      headers: { ApiIntegrationCode: c.integrationCode, UserName: c.username, Secret: c.secret, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    if (res.status === 429 || res.status === 503) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (res.status === 401 || res.status === 403) { cache.delete(cred); throw fail(502, `Autotask refused the ${cred} credentials. Check them under Connections.`, "rejected"); }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const e = new Error(`Autotask ${method} ${path.split("?")[0]} answered ${res.status}: ${text.slice(0, 300)}`);
      e.status = 502; e.autotaskStatus = res.status;
      throw e;
    }
    return res.status === 204 ? null : res.json();
  }
  throw fail(503, "Autotask is busy (rate limit). Try again in a minute.");
}

/** All matching records, following Autotask's paging. */
async function query(cred, entity, filter, fields) {
  const body = { filter: filter && filter.length ? filter : [{ op: "gte", field: "id", value: 0 }], MaxRecords: 500 };
  if (fields) body.IncludeFields = fields;
  let res = await call(cred, "POST", `/V1.0/${entity}/query`, body);
  const items = [...(res.items || [])];
  let next = res.pageDetails && res.pageDetails.nextPageUrl;
  let pages = 1;
  while (next && pages < 200) {
    res = await call(cred, "GET", next);
    items.push(...(res.items || []));
    next = res.pageDetails && res.pageDetails.nextPageUrl;
    pages++;
  }
  return items;
}

const create = (cred, entity, body) => call(cred, "POST", `/V1.0/${entity}`, body);
const update = (cred, entity, body) => call(cred, "PATCH", `/V1.0/${entity}`, body);
const fieldInfo = (cred, entity) => call(cred, "GET", `/V1.0/${entity}/entityInformation/fields`);

module.exports = { query, create, update, fieldInfo, credsFor, _test: { setFetch(f) { fetchImpl = f; cache.clear(); }, clear() { cache.clear(); } } };
