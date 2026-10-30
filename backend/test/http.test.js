"use strict";
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

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
entra._test.setKeys(new Map([["k1", publicKey]]));

function token(claims = {}, { key = privateKey, kid = "k1", expiresIn = "1h" } = {}) {
  return jwt.sign({
    aud: CLIENT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT,
    oid: "oid-george", scp: "access_as_user", name: "George Hanna",
    preferred_username: "George.Hanna@hdit.com.au", roles: ["Pulse.User"], ...claims,
  }, key, { algorithm: "RS256", keyid: kid, expiresIn });
}

function req(method, path, { auth, body, headers = {} } = {}) {
  const h = new Map(Object.entries({ ...headers, ...(auth ? { authorization: `Bearer ${auth}` } : {}) }).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method, url: `https://func.example/api/${path}`, params: { path },
    headers: { get: k => h.get(k.toLowerCase()) || null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}
const ctx = { log() {}, warn() {}, error() {} };

// fake database: records audit inserts and person touches
const writes = [];
db._test.use({
  async query(text, params) {
    writes.push({ text, params });
    if (/MERGE pulse\.person /.test(text)) return [{ id: 7, action: "INSERT" }];
    if (/FROM pulse\.audit_event/.test(text)) return [];
    return [];
  },
  async tx(fn) { return fn(this.query); },
  async ping() { return true; },
});

const { routes } = require("../src/api/routes");
const handle = router(routes);

test("health is public", async () => {
  const r = await handle(req("GET", "health"), ctx);
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.component, "api");
  assert.equal(r.headers["Cache-Control"], "no-store");
});

test("me needs a sign-in", async () => {
  const r = await handle(req("GET", "me"), ctx);
  assert.equal(r.status, 401);
});

test("me with a valid token records the person and the sign-in", async () => {
  writes.length = 0;
  const r = await handle(req("GET", "me", { auth: token({ roles: ["Pulse.User", "Division.ManagedServices"] }) }), ctx);
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.person.name, "George Hanna");
  assert.equal(r.jsonBody.person.email, "george.hanna@hdit.com.au");
  assert.equal(r.jsonBody.person.firstSignIn, true);
  assert.deepEqual(r.jsonBody.access.ownDivisions, ["ManagedServices"]);
  assert.equal(r.jsonBody.access.leadership, false);
  assert.ok(writes.some(w => /INSERT INTO pulse\.audit_event/.test(w.text) && w.params.action === "session.start"));
});

test("token signed by someone else is refused", async () => {
  const r = await handle(req("GET", "me", { auth: token({}, { key: other.privateKey }) }), ctx);
  assert.equal(r.status, 401);
});

test("expired token is refused with a clear message", async () => {
  const r = await handle(req("GET", "me", { auth: token({}, { expiresIn: -3600 }) }), ctx);
  assert.equal(r.status, 401);
  assert.match(r.jsonBody.error, /expired/);
});

test("wrong tenant or audience is refused", async () => {
  assert.equal((await handle(req("GET", "me", { auth: token({ tid: "00000000-0000-0000-0000-000000000000" }) }), ctx)).status, 401);
  assert.equal((await handle(req("GET", "me", { auth: token({ aud: "someone-else" }) }), ctx)).status, 401);
});

test("app-only token can't act as a person", async () => {
  const r = await handle(req("GET", "me", { auth: token({ scp: undefined, roles: ["Pulse.Collector"] }) }), ctx);
  assert.equal(r.status, 401);
});

test("someone with no Pulse role is turned away", async () => {
  const r = await handle(req("GET", "me", { auth: token({ roles: ["Pipeline.User"] }) }), ctx);
  assert.equal(r.status, 403);
  assert.equal(r.jsonBody.code, "no-access");
});

test("audit log is for Platform Admins and Compliance only", async () => {
  assert.equal((await handle(req("GET", "audit", { auth: token({ roles: ["Pulse.User", "Pulse.Leadership"] }) }), ctx)).status, 403);
  assert.equal((await handle(req("GET", "audit", { auth: token({ roles: ["Pulse.Compliance"] }) }), ctx)).status, 200);
  assert.equal((await handle(req("GET", "audit", { auth: token({ roles: ["Pulse.Admin"] }) }), ctx)).status, 200);
});

test("sensitive page views are recorded; unknown pages refused", async () => {
  writes.length = 0;
  const ok = await handle(req("POST", "audit/view", { auth: token(), body: { page: "finance-detail" } }), ctx);
  assert.equal(ok.status, 200);
  assert.ok(writes.some(w => w.params && w.params.action === "view.finance-detail"));
  const bad = await handle(req("POST", "audit/view", { auth: token(), body: { page: "anything" } }), ctx);
  assert.equal(bad.status, 400);
});

test("unknown route 404, wrong method 405, bad JSON 400", async () => {
  assert.equal((await handle(req("GET", "nope", { auth: token() }), ctx)).status, 404);
  assert.equal((await handle(req("DELETE", "me", { auth: token() }), ctx)).status, 405);
  const bad = req("POST", "audit/view", { auth: token() }); bad.text = async () => "{not json";
  assert.equal((await handle(bad, ctx)).status, 400);
});

test("calendar week validates its input", async () => {
  const ok = await handle(req("GET", "calendar/week", { auth: token() }), ctx);
  assert.equal(ok.status, 200);
  assert.ok(ok.jsonBody.week);
  const bad = await handle({ ...req("GET", "calendar/week", { auth: token() }), url: "https://func.example/api/calendar/week?week=2026-11-03" }, ctx);
  assert.equal(bad.status, 400);
});

test("server errors don't leak details", async () => {
  const h = router([{ method: "GET", path: "/boom", auth: "public", fn: async () => { throw new Error("SQL password is hunter2"); } }]);
  const r = await h(req("GET", "boom"), ctx);
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.jsonBody.error, /hunter2/);
});

test("service routes need the right app role", async () => {
  const h = router([{ method: "GET", path: "/svc", auth: "service", role: "Pulse.Collector", fn: async c => ({ who: c.service.roles }) }]);
  assert.equal((await h(req("GET", "svc", { auth: token({ scp: undefined, roles: ["Pulse.Collector"] }) }), ctx)).status, 200);
  assert.equal((await h(req("GET", "svc", { auth: token({ scp: undefined, roles: [] }) }), ctx)).status, 403);
  assert.equal((await h(req("GET", "svc", { auth: token() }), ctx)).status, 403);  // a person, not a service
});
