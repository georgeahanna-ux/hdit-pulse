"use strict";
// Permission and validation tests for the M1 routes, through the real router and token checks,
// against a fake database that answers by query shape and records every write.
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
const time = require("../src/lib/time");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
entra._test.setKeys(new Map([["k1", publicKey]]));

const people = {
  leader: { name: "Sam Leader", preferred_username: "sam@hdit.com.au", roles: ["Pulse.User", "Pulse.Leadership"] },
  tech: { name: "Riley Tech", preferred_username: "riley@hdit.com.au", roles: ["Pulse.User", "Division.ManagedServices"] },
  finance: { name: "Jordan Ledger", preferred_username: "jordan@hdit.com.au", roles: ["Pulse.User", "Division.Finance"] },
  staff: { name: "Morgan Ellis", preferred_username: "morgan@hdit.com.au", roles: ["Pulse.User"] },
};
const token = who => jwt.sign({
  aud: CLIENT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, oid: "oid-" + who, scp: "access_as_user", ...people[who],
}, privateKey, { algorithm: "RS256", keyid: "k1", expiresIn: "1h" });

function req(method, path, who, body) {
  const [p, qs] = path.split("?");
  const h = new Map([["authorization", `Bearer ${token(who)}`]]);
  return { method, url: `https://func.example/api/${path}`, params: { path: p }, headers: { get: k => h.get(k.toLowerCase()) || null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)), _qs: qs };
}
const ctx = { log() {}, warn() {}, error() {} };

/* ---------------- fake database ---------------- */
const sla = { id: 6, code: "sla_first_response", name: "SLA first response met", scope: "company", division_code: "ManagedServices", seat_id: null,
  owner_name: "Tony Parzakonis", owner_email: "tony@hdit.com.au", unit: "percent", direction: "higher", goal_value: 95, goal_text: "95%",
  frequency: "weekly", source: "autotask", auto_enabled: false, definition: "x", definition_version: 1, restricted: false, sort: 6 };
let cells = new Map(), writes = [], planMonths = new Map();
function reset() { cells = new Map(); writes = []; planMonths = new Map(); }

db._test.use({
  async query(text, p = {}) {
    if (/^\s*(INSERT|UPDATE|MERGE|DELETE)/i.test(text) || /INSERT INTO pulse\.audit_event/.test(text)) {
      writes.push({ text, p });
      if (/OUTPUT inserted\.id/.test(text)) return [{ id: 99 }];
      if (/MERGE pulse\.scorecard_value/.test(text)) cells.set(`${p.id}|${p.week}`, { measurable_id: p.id, week: p.week, entered_value: p.value ?? null, is_overridden: /override_value = @value/.test(text) });
      return [];
    }
    if (/FROM pulse\.measurable m WHERE m\.id = @id/.test(text)) return p.id === 6 ? [sla] : [];
    if (/FROM pulse\.measurable m WHERE m\.is_active = 1/.test(text)) return [sla];
    if (/FROM pulse\.scorecard_value WHERE measurable_id = @id AND week = @week/.test(text)) return cells.has(`${p.id}|${p.week}`) ? [cells.get(`${p.id}|${p.week}`)] : [];
    if (/FROM pulse\.scorecard_value/.test(text)) return [...cells.values()];
    if (/FROM pulse\.plan_metric WHERE fy/.test(text)) return [{ id: 1, fy: 2027, code: "revenue", name: "Revenue", unit: "currency", kind: "cumulative", annual_target: 9200000, restricted: false, source: "xero" }];
    if (/FROM pulse\.plan_metric WHERE id/.test(text)) return [{ id: 1, fy: 2027, code: "revenue", kind: "cumulative", restricted: false }];
    if (/FROM pulse\.plan_month_actual WHERE metric_id = @id AND month/.test(text)) return planMonths.has(p.month) ? [planMonths.get(p.month)] : [];
    if (/FROM pulse\.plan_(quarter_target|month_actual)/.test(text)) return [];
    if (/FROM pulse\.issue/.test(text)) return [];
    if (/FROM pulse\.todo/.test(text)) return [];
    return [];
  },
  async tx(fn) { return fn(this.query.bind(this)); },
  async ping() { return true; },
});

const { routes } = require("../src/api/routes");
const handle = router(routes);
const call = async (method, path, who, body) => {
  const r = req(method, path, who, body);
  if (r._qs) r.url = `https://func.example/api/${path}`;
  return handle(r, ctx);
};
const thisWeek = time.weekOf();
const lockedWeek = time.addDays(thisWeek, -14);
const audits = () => writes.filter(w => /pulse\.audit_event/.test(w.text)).map(w => w.p);

test("Managed Services staff can enter their division's measurable for an open week", async () => {
  reset();
  const r = await call("POST", "scorecard/enter", "tech", { measurableId: 6, week: thisWeek, value: "96.5" });
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  assert.ok(writes.some(w => /MERGE pulse\.scorecard_value/.test(w.text) && w.p.value === 96.5));
  assert.equal(audits()[0].action, "scorecard.enter");
});

test("staff can't change another division's measurable", async () => {
  reset();
  const r = await call("POST", "scorecard/enter", "finance", { measurableId: 6, week: thisWeek, value: 90 });
  assert.equal(r.status, 403);
  assert.equal(writes.length, 0);
});

test("someone with no division can't change any measurable; leadership can change any", async () => {
  reset();
  assert.equal((await call("POST", "scorecard/enter", "staff", { measurableId: 6, week: thisWeek, value: 90 })).status, 403);
  assert.equal((await call("POST", "scorecard/enter", "leader", { measurableId: 6, week: thisWeek, value: 90 })).status, 200);
});

test("a locked week needs an override with a reason", async () => {
  reset();
  const direct = await call("POST", "scorecard/enter", "tech", { measurableId: 6, week: lockedWeek, value: 90 });
  assert.equal(direct.status, 409);
  assert.match(direct.jsonBody.error, /locked/);
  const noReason = await call("POST", "scorecard/override", "tech", { measurableId: 6, week: lockedWeek, value: 90, reason: "" });
  assert.equal(noReason.status, 400);
  const ok = await call("POST", "scorecard/override", "tech", { measurableId: 6, week: lockedWeek, value: 90, reason: "Merged tickets counted twice" });
  assert.equal(ok.status, 200);
  const a = audits().find(x => x.action === "scorecard.override");
  assert.equal(a.reason, "Merged tickets counted twice");
});

test("an open week can't be overridden (type it in instead), and future weeks are refused", async () => {
  reset();
  assert.equal((await call("POST", "scorecard/override", "tech", { measurableId: 6, week: thisWeek, value: 90, reason: "because reasons" })).status, 409);
  assert.equal((await call("POST", "scorecard/enter", "tech", { measurableId: 6, week: time.addDays(thisWeek, 7), value: 90 })).status, 400);
  assert.equal((await call("POST", "scorecard/enter", "tech", { measurableId: 6, week: time.addDays(thisWeek, 1), value: 90 })).status, 400); // not a Monday
});

test("revert needs an override to remove and a reason", async () => {
  reset();
  assert.equal((await call("POST", "scorecard/revert", "tech", { measurableId: 6, week: lockedWeek, reason: "back to automatic" })).status, 409);
  cells.set(`6|${lockedWeek}`, { measurable_id: 6, week: lockedWeek, is_overridden: true, override_value: 90 });
  assert.equal((await call("POST", "scorecard/revert", "tech", { measurableId: 6, week: lockedWeek, reason: "x" })).status, 400);
  assert.equal((await call("POST", "scorecard/revert", "tech", { measurableId: 6, week: lockedWeek, reason: "Autotask figure was right" })).status, 200);
});

test("the Scorecard tells each person what they can do per cell", async () => {
  reset();
  const r = await call("GET", "scorecard", "finance");
  assert.equal(r.status, 200);
  const m = r.jsonBody.measurables[0];
  assert.equal(m.canOverride, false);
  assert.ok(m.cells.every(c => !c.actions.enter && !c.actions.override));
  const t = (await call("GET", "scorecard", "tech")).jsonBody.measurables[0];
  assert.equal(t.cells[t.cells.length - 1].actions.enter, true);    // this week: open
  assert.equal(t.cells[0].actions.override, true);                  // 13 weeks ago: locked
});

test("company Issues List is for the leadership team", async () => {
  assert.equal((await call("GET", "issues", "tech")).status, 403);
  assert.equal((await call("GET", "issues", "leader")).status, 200);
  assert.equal((await call("POST", "issues", "tech", { level: "company", title: "x" })).status, 403);
  assert.equal((await call("POST", "issues", "tech", { level: "division", division: "ManagedServices", title: "Backlog growing" })).status, 200);
  assert.equal((await call("POST", "issues", "tech", { level: "division", division: "Finance", title: "x" })).status, 403);
});

test("Rocks: only leadership sets company Rocks; individual Rocks belong to their creator", async () => {
  reset();
  assert.equal((await call("POST", "rocks", "tech", { level: "company", title: "x", ownerName: "Riley Tech" })).status, 403);
  const r = await call("POST", "rocks", "tech", { level: "individual", title: "Finish ITIL v4", ownerName: "Someone Else", ownerEmail: "else@hdit.com.au" });
  assert.equal(r.status, 200);
  const ins = writes.find(w => /INSERT INTO pulse\.rock /.test(w.text));
  assert.equal(ins.p.ownerEmail, "riley@hdit.com.au");
  assert.equal((await call("POST", "rocks", "leader", { level: "company", title: "Hit 2,350 seats", ownerName: "Tony Parzakonis" })).status, 200);
});

test("annual plan: leadership and Finance see it; staff don't; changing a month needs a reason", async () => {
  reset();
  assert.equal((await call("GET", "plan", "tech")).status, 403);
  assert.equal((await call("GET", "plan", "finance")).status, 200);
  const lead = await call("GET", "plan", "leader");
  assert.equal(lead.jsonBody.metrics[0].code, "revenue");
  assert.equal((await call("PUT", "plan/metrics/1/months/2026-10", "tech", { value: 1 })).status, 403);
  assert.equal((await call("PUT", "plan/metrics/1/months/2026-10", "finance", { value: "780,000" })).status, 200);
  planMonths.set("2026-10-01", { entered_value: 780000, auto_value: null });
  assert.equal((await call("PUT", "plan/metrics/1/months/2026-10", "finance", { value: 781000 })).status, 400);
  assert.equal((await call("PUT", "plan/metrics/1/months/2026-10", "finance", { value: 781000, reason: "Late invoice added" })).status, 200);
  assert.equal((await call("PUT", "plan/metrics/1/months/2026-05", "finance", { value: 1 })).status, 400);   // not in FY27
  assert.equal((await call("PUT", "plan/metrics/1", "finance", { annualTarget: 1 })).status, 403);           // targets: leadership
  assert.equal((await call("PUT", "plan/metrics/1/quarters/2", "finance", { target: 2300000 })).status, 200);
});

test("To-dos: company list is leadership only; your own are always visible", async () => {
  assert.equal((await call("GET", "todos?view=company", "tech")).status, 403);
  assert.equal((await call("GET", "todos", "tech")).status, 200);
});

test("V/TO: everyone reads, leadership edits", async () => {
  assert.equal((await call("GET", "vto", "staff")).status, 200);
  assert.equal((await call("PUT", "vto/core_values", "staff", { content: "x" })).status, 403);
});

test("switching a measurable to automatic: leadership only, needs a collector and a reason", async () => {
  reset();
  sla.collector = null;
  let r = await call("POST", "measurables/6/automatic", "leader", { enabled: true, reason: "Matches the entered numbers" });
  assert.equal(r.status, 409);
  sla.collector = "autotask.sla_first_response";
  r = await call("POST", "measurables/6/automatic", "tech", { enabled: true, reason: "Matches the entered numbers" });
  assert.equal(r.status, 403);
  r = await call("POST", "measurables/6/automatic", "leader", { enabled: true });
  assert.equal(r.status, 400);
  r = await call("POST", "measurables/6/automatic", "leader", { enabled: true, reason: "Matches the entered numbers" });
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  assert.ok(writes.some(w => /UPDATE pulse\.measurable SET auto_enabled/.test(w.text) && w.p.enabled === true));
  assert.equal(audits()[0].action, "measurable.automatic");
  sla.collector = null;
});

test("trial measurables show the automatic value beside the entered one, not instead of it", async () => {
  reset();
  sla.collector = "autotask.sla_first_response";
  cells.set(`6|${lockedWeek}`, { measurable_id: 6, week: lockedWeek, auto_value: 93.5, auto_at: new Date(), auto_detail: JSON.stringify({ text: "187 of 200 tickets" }), entered_value: null, is_overridden: false });
  const r = await call("GET", `scorecard?end=${thisWeek}`, "leader");
  assert.equal(r.status, 200);
  const m = r.jsonBody.measurables[0];
  const c = m.cells.find(x => x.week === lockedWeek);
  assert.equal(m.trial, true);
  assert.equal(c.value, null);
  assert.equal(c.auto, 93.5);
  assert.equal(c.autoDetail.text, "187 of 200 tickets");
  assert.equal(r.jsonBody.canRefresh, true);
  sla.collector = null;
});
