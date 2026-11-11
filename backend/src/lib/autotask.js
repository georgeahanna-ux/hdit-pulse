"use strict";
/**
 * Autotask REST client for Pulse.
 *
 * One Autotask API user for all of Pulse (decided 9 Nov 2026, replacing the three per-area users
 * of D7). Its credential is the Key Vault secret "autotask-service" (name kept so no Key Vault
 * change is needed), readable only by the API and sync apps. Least privilege moves into Pulse:
 * every caller names its module, and each module may only read and write the entities listed
 * in POLICY below. Anything else is refused before a request leaves Pulse, and every write is
 * audited by the calling route.
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
  if (!s || !s.value) throw fail(503, "The Autotask connection hasn't been entered yet. A Platform Admin can add it under Connections.", "not-connected");
  let c;
  try { c = JSON.parse(s.value); } catch { throw fail(503, "The Autotask connection is in an old format. Replace it under Connections."); }
  if (!c.username || !c.secret || !c.integrationCode || !c.baseUrl) throw fail(503, "The Autotask connection is incomplete. Replace it under Connections.");
  cache.set(name, { creds: c, at: Date.now() });
  return c;
}

const SECRET = "autotask-service";

/** What each Pulse module may do in Autotask. read: entities it may query; write: entity → operations. */
const POLICY = {
  people: {   // People directory and departments (D10, D16)
    read: ["Departments", "Roles", "Resources", "ResourceRoleDepartments"],
    write: { ResourceRoleDepartments: ["create", "update"] },
  },
  scorecard: {   // Scorecard collectors and FY plan actuals (read-only)
    read: ["Tickets", "TimeEntries", "HolidaySets", "Holidays", "Contracts", "ContractServices", "ContractServiceUnits",
      "ContractServiceBundles", "ContractServiceBundleUnits", "Services", "Opportunities", "Quotes", "QuoteItems"],
    write: {},
  },
  projects: {   // Projects module: Gantt, time entry, completing and rescheduling tasks
    read: ["Projects", "Phases", "Tasks", "TaskPredecessors", "TaskSecondaryResources", "Companies", "Resources", "Roles",
      "ResourceRoleDepartments", "TimeEntries", "HolidaySets", "Holidays", "TimeOffRequests"],
    write: { Tasks: ["update"], TimeEntries: ["create"], TaskPredecessors: ["create", "delete"] },   // a dependency is a link; removing one deletes no work
  },
  issues: {   // Issue -> Autotask ticket or project task (D11, 0.8.0), and their status read back
    read: ["Tickets", "Tasks", "Projects", "Phases", "Resources"],
    write: { Tickets: ["create"], Tasks: ["create"] },
  },
};

function allowed(module, op, entity) {
  const p = POLICY[module];
  if (!p) throw new Error(`Unknown Pulse module "${module}" for Autotask.`);
  const ok = op === "read" ? p.read.includes(entity) : (p.write[entity] || []).includes(op);
  if (!ok) { const e = new Error(`Pulse's ${module} module isn't allowed to ${op} Autotask ${entity}.`); e.status = 500; e.code = "not-allowed"; throw e; }
}

let fetchImpl = (...a) => fetch(...a);

async function call(cred, method, path, body) {
  const c = await credsFor(cred);
  const url = /^https:/.test(path) ? path : c.baseUrl.replace(/\/+$/, "") + path;
  if (!url.startsWith(c.baseUrl.replace(/\/+$/, ""))) throw new Error("Refusing to send Autotask credentials to another address.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetchImpl(url, {
      method,
      headers: { ApiIntegrationCode: c.integrationCode, UserName: c.username, Secret: c.secret, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    if (res.status === 429 || res.status === 503) { await new Promise(r => setTimeout(r, Math.min(30000, 2500 * 2 ** attempt))); continue; }   // waits 2.5, 5, 10, 20, 30 s
    if (res.status === 401 || res.status === 403) {
      if (res.status === 403 && method !== "GET" && !/\/query/.test(path)) throw fail(502, "Autotask's API user doesn't have permission for this. Check its security level in Autotask.", "forbidden");
      cache.delete(cred); throw fail(502, "Autotask refused Pulse's API credentials. Check them under Connections.", "rejected");
    }
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
async function query(module, entity, filter, fields) {
  allowed(module, "read", entity);
  const body = { filter: filter && filter.length ? filter : [{ op: "gte", field: "id", value: 0 }], MaxRecords: 500 };
  if (fields) body.IncludeFields = fields;
  let res = await call(SECRET, "POST", `/V1.0/${entity}/query`, body);
  const items = [...(res.items || [])];
  let next = res.pageDetails && res.pageDetails.nextPageUrl;
  let pages = 1;
  // Autotask's next-page address for a POST query must be POSTed again with the same body
  // (GET there answers 405); a GET-style query (?search=) is followed with GET.
  while (next && pages < 200) {
    res = /[?&]search=/i.test(next) ? await call(SECRET, "GET", next) : await call(SECRET, "POST", next, body);
    items.push(...(res.items || []));
    next = res.pageDetails && res.pageDetails.nextPageUrl;
    pages++;
  }
  return items;
}

/** "in" queries, 500 ids at a time. */
async function queryIn(module, entity, field, ids, fields, extra = []) {
  const list = [...new Set(ids.map(Number))].filter(Boolean);
  const out = [];
  for (let i = 0; i < list.length; i += 500) out.push(...await query(module, entity, [{ op: "in", field, value: list.slice(i, i + 500) }, ...extra], fields));
  return out;
}

/** parent: [ParentEntity, id] for child collections, e.g. Tasks are updated under ["Projects", projectId]. */
const at = parent => (parent ? `/V1.0/${parent[0]}/${Number(parent[1])}/` : "/V1.0/");
// Child collections whose URL name differs from the entity name (Autotask: /Tasks/{id}/Predecessors).
const CHILD = { TaskPredecessors: "Predecessors" };
const path = (entity, parent) => at(parent) + (parent && CHILD[entity] ? CHILD[entity] : entity);
const create = async (module, entity, body, parent) => { allowed(module, "create", entity); return call(SECRET, "POST", path(entity, parent), body); };
const update = async (module, entity, body, parent) => { allowed(module, "update", entity); return call(SECRET, "PATCH", path(entity, parent), body); };
const remove = async (module, entity, id, parent) => { allowed(module, "delete", entity); return call(SECRET, "DELETE", `${path(entity, parent)}/${Number(id)}`); };
const fieldInfo = async (module, entity) => { allowed(module, "read", entity); return call(SECRET, "GET", `/V1.0/${entity}/entityInformation/fields`); };

/** Field information for an entity, cached for an hour (names, picklists). */
const infoCache = new Map();
async function fields(module, entity) {
  const hit = infoCache.get(entity);
  if (hit && Date.now() - hit.at < 3600e3) return hit.fields;
  const f = ((await fieldInfo(module, entity)) || {}).fields || [];
  infoCache.set(entity, { fields: f, at: Date.now() });
  return f;
}
/** Only the wanted fields this Autotask instance has (an unknown name fails the whole query). */
async function known(module, entity, wanted) {
  const have = new Set((await fields(module, entity)).map(f => f.name));
  return have.size ? wanted.filter(f => have.has(f)) : wanted;
}
/** Picklist values of a field: [{ value, label, isActive }]. */
async function picklist(module, entity, field) {
  const f = (await fields(module, entity)).find(x => x.name === field);
  return f && f.isPickList ? (f.picklistValues || []).map(v => ({ value: Number(v.value), label: v.label, isActive: v.isActive !== false })) : [];
}

module.exports = { query, queryIn, create, update, remove, fieldInfo, fields, known, picklist, credsFor, SECRET, POLICY,
  _test: { setFetch(f) { fetchImpl = f; cache.clear(); infoCache.clear(); }, clear() { cache.clear(); infoCache.clear(); } } };
