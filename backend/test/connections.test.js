"use strict";
// Connections page: write-only credential entry. Values must reach Key Vault and nowhere else.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const TENANT = "0b1e12e5-f6cd-4ae7-a9ff-4562637a0c44";
const CLIENT = "11111111-2222-3333-4444-555555555555";
process.env.ENTRA_TENANT_ID = TENANT;
process.env.ENTRA_CLIENT_ID = CLIENT;

const entra = require("../src/lib/entra");
const { router } = require("../src/lib/http");
const db = require("../src/lib/sql");
const vault = require("../src/lib/vault");
const creds = require("../src/lib/credentials");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
entra._test.setKeys(new Map([["k1", publicKey]]));
const token = roles => jwt.sign({ aud: CLIENT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, oid: "oid-g",
  scp: "access_as_user", name: "George Hanna", preferred_username: "george@hdit.com.au", roles }, privateKey, { algorithm: "RS256", keyid: "k1", expiresIn: "1h" });
const ADMIN = ["Pulse.Admin"], LEADER = ["Pulse.User", "Pulse.Leadership"];

let sql = [], saved = [], status = new Map();
function reset() { sql = []; saved = []; status = new Map(); }
db._test.use({
  async query(text, p = {}) {
    sql.push({ text, p });
    if (/FROM pulse\.connection_status WHERE name/.test(text)) return status.has(p.name) ? [status.get(p.name)] : [];
    if (/FROM pulse\.connection_status/.test(text)) return [...status.entries()].map(([name, v]) => ({ name, ...v }));
    return [];
  },
  async tx(fn) { return fn(this.query); }, async ping() { return true; },
});
vault.setSecret = async (name, value, tags) => { saved.push({ name, value, tags }); };

const autotaskOk = async url => {
  if (url.includes("zoneInformation")) return { ok: true, status: 200, json: async () => ({ url: "https://webservices29.autotask.net/ATServicesRest/", zoneName: "Australia / New Zealand" }) };
  return { ok: true, status: 200, json: async () => ({}) };
};
const autotaskBad = async url => (url.includes("zoneInformation")
  ? { ok: true, status: 200, json: async () => ({ url: "https://webservices29.autotask.net/ATServicesRest/" }) }
  : { ok: false, status: 401, json: async () => ({}) });

const { routes } = require("../src/api/routes");
const handle = router(routes);
const ctx = { log() {}, warn() {}, error() {} };
function call(method, path, roles, body) {
  const h = new Map([["authorization", `Bearer ${token(roles)}`]]);
  return handle({ method, url: `https://f.example/api/${path}`, params: { path }, headers: { get: k => h.get(k.toLowerCase()) || null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)) }, ctx);
}
const SECRET = "s3cr3t-VALUE-never-logged", CODE = "INTEGRATION-CODE-XYZ";

test("only Platform Admins can see or change connections", async () => {
  reset();
  assert.equal((await call("GET", "connections", LEADER)).status, 403);
  assert.equal((await call("PUT", "connections/simplesat", LEADER, { apiKey: "x" })).status, 403);
  const r = await call("GET", "connections", ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.connections.length, Object.keys(creds.TYPES).length);
  assert.ok(r.jsonBody.connections.every(c => !("value" in c)));
});

test("Autotask credentials are tested, then written to Key Vault only", async () => {
  reset(); creds._test.setFetch(autotaskOk);
  const r = await call("PUT", "connections/autotask-service", ADMIN, { username: "pulse-svc@HDIT.com", secret: SECRET, integrationCode: CODE, owner: "Tony Parzakonis", rotationDue: "2027-05-01" });
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  assert.equal(r.jsonBody.tested, true);
  assert.equal(saved.length, 1);
  const stored = JSON.parse(saved[0].value);
  assert.equal(stored.secret, SECRET);
  assert.equal(stored.baseUrl, "https://webservices29.autotask.net/ATServicesRest/");
  // nothing secret anywhere in SQL (including the audit event)
  const everything = JSON.stringify(sql);
  assert.ok(!everything.includes(SECRET) && !everything.includes(CODE), "a credential value reached SQL");
  const auditRow = sql.find(s => /pulse\.audit_event/.test(s.text));
  assert.equal(auditRow.p.action, "connection.set");
  assert.match(auditRow.p.afterJson, /"fields":\["username","secret","integrationCode"\]/);
  // and nothing secret in the response
  assert.ok(!JSON.stringify(r.jsonBody).includes(SECRET));
});

test("rejected Autotask credentials are not saved", async () => {
  reset(); creds._test.setFetch(autotaskBad);
  const r = await call("PUT", "connections/autotask-service", ADMIN, { username: "u@HDIT.com", secret: "wrong", integrationCode: "x" });
  assert.equal(r.status, 400);
  assert.match(r.jsonBody.error, /rejected/);
  assert.equal(saved.length, 0);
});

test("replacing a credential needs a reason; removing one too", async () => {
  reset(); creds._test.setFetch(autotaskOk);
  status.set("simplesat", { configured: true });
  assert.equal((await call("PUT", "connections/simplesat", ADMIN, { apiKey: "k1" })).status, 400);
  assert.equal((await call("PUT", "connections/simplesat", ADMIN, { apiKey: "k1", reason: "Scheduled rotation" })).status, 200);
  assert.equal((await call("DELETE", "connections/simplesat", ADMIN, {})).status, 400);
  const del = await call("DELETE", "connections/simplesat", ADMIN, { reason: "SimpleSAT account closed" });
  assert.equal(del.status, 200);
  assert.equal(saved[saved.length - 1].value, vault.PLACEHOLDER);
});

test("fields are checked; OAuth connections can't be typed in", async () => {
  reset();
  assert.equal((await call("PUT", "connections/simplesat", ADMIN, {})).status, 400);
  assert.equal((await call("PUT", "connections/itglue", ADMIN, { apiUrl: "http://insecure.example", apiKey: "k" })).status, 400);
  assert.equal((await call("PUT", "connections/itglue", ADMIN, { apiUrl: "https://api.au.itglue.com/", apiKey: "k" })).status, 200);
  assert.equal(JSON.parse(saved[0].value).apiUrl, "https://api.au.itglue.com");
  assert.equal((await call("PUT", "connections/xero-token", ADMIN, { anything: 1 })).status, 400);
  assert.equal((await call("PUT", "connections/nonsense", ADMIN, {})).status, 404);
});
