"use strict";
// Projects write-back (0.6.1): who may log time, complete and reschedule, and what reaches Autotask.
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
const at = require("../src/lib/autotask");
const time = require("../src/lib/time");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
entra._test.setKeys(new Map([["k1", publicKey]]));
const who = {
  eng: { name: "Riley Tech", roles: ["Pulse.User", "Division.ManagedServices"] },
  other: { name: "Abiy A", roles: ["Pulse.User", "Division.ManagedServices"] },
  pm: { name: "Priya Projects", roles: ["Pulse.User", "Pulse.ProjectManager"] },
  sales: { name: "Taylor Reid", roles: ["Pulse.User", "Division.SalesMarketing"] },
};
const token = w => jwt.sign({ aud: CLIENT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, oid: "oid-" + w, scp: "access_as_user",
  preferred_username: w + "@hdit.com.au", ...who[w] }, privateKey, { algorithm: "RS256", keyid: "k1", expiresIn: "1h" });
const req = (method, path, w, body) => {
  const h = new Map([["authorization", `Bearer ${token(w)}`]]);
  return { method, url: `https://func.example/api/${path}`, params: { path }, headers: { get: k => h.get(k.toLowerCase()) || null }, text: async () => (body === undefined ? "" : JSON.stringify(body)) };
};

// Tasks 1 → 2 → 3 in project 50; Riley (resource 103) on task 2.
const T = (id, s, e, o = {}) => ({ id, project_id: 50, title: `Task ${id}`, start_at: new Date(time.sydneyToUtc(s, 9)), end_at: new Date(time.sydneyToUtc(e, 17)),
  is_complete: false, assigned_resource_id: null, assigned_role_id: null, ...o });
const tasks = [T(1, "2026-11-02", "2026-11-04"), T(2, "2026-11-05", "2026-11-06", { assigned_resource_id: 103, assigned_role_id: 7 }), T(3, "2026-11-09", "2026-11-10")];
let writes = [], calls = [];
db._test.use({
  async query(text, p = {}) {
    if (/^\s*(INSERT|UPDATE|MERGE|DELETE)/i.test(text)) { writes.push({ text, p }); if (/OUTPUT inserted\.id/.test(text)) return [{ id: 1 }]; return []; }
    if (/FROM pulse\.person_link l/.test(text)) return p.oid === "oid-eng" ? [{ external_id: "103", default_role_id: 7 }] : p.oid === "oid-other" ? [{ external_id: "105", default_role_id: 8 }] : p.oid === "oid-pm" ? [{ external_id: "120", default_role_id: 9 }] : [];
    if (/FROM pulse\.at_task WHERE id = @id/.test(text)) return tasks.filter(t => t.id === p.id);
    if (/FROM pulse\.at_task_secondary WHERE task_id/.test(text)) return [];
    if (/FROM pulse\.at_task WHERE project_id = @id/.test(text)) return tasks;
    if (/at_task_predecessor/.test(text)) return [{ id: 11, pred: 1, succ: 2, lag: 0 }, { id: 12, pred: 2, succ: 3, lag: 0 }];
    return [];
  },
  async tx(fn) { return fn(this.query.bind(this)); },
});
vault.getSecret = async () => ({ value: JSON.stringify({ username: "pulse@HDIT.com", secret: "s", integrationCode: "ic", baseUrl: "https://ws.example/ATServicesRest/" }) });
at._test.setFetch(async (url, opt) => {
  calls.push({ url, method: opt.method, body: opt.body ? JSON.parse(opt.body) : null });
  if (/entityInformation\/fields/.test(url)) return { ok: true, status: 200, json: async () => ({ fields: [{ name: "status", isPickList: true, picklistValues: [{ value: 1, label: "New" }, { value: 5, label: "Complete" }] }] }) };
  if (/\/query/.test(url)) return { ok: true, status: 200, json: async () => ({ items: [], pageDetails: {} }) };
  return { ok: true, status: 200, json: async () => ({ itemId: 777 }) };
});
require("../src/projects/sync").syncProjects = async () => ({});
const handle = router(require("../src/api/routes").routes);
const call = async (m, p, w, b) => handle(req(m, p, w, b), { log() {}, warn() {}, error() {} });
const reset = () => { writes = []; calls = []; };
const yesterday = time.addDays(time.sydneyDate(), -1);

test("an engineer logs time on their own task, as their own Autotask resource and role", async () => {
  reset();
  const r = await call("POST", "projects/tasks/2/time", "eng", { date: yesterday, hours: "2.5", summary: "Installed the hypervisor" });
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  const post = calls.find(c => c.method === "POST" && /\/V1\.0\/TimeEntries$/.test(c.url));
  assert.deepEqual([post.body.taskID, post.body.resourceID, post.body.roleID, post.body.hoursWorked], [2, 103, 7, 2.5]);
  assert.ok(writes.some(w => /audit_event/.test(w.text)));
});

test("someone else on Managed Services can't log time on a task that isn't theirs; a Project Manager can", async () => {
  reset();
  assert.equal((await call("POST", "projects/tasks/2/time", "other", { date: yesterday, hours: 1, summary: "x" })).status, 403);
  assert.equal((await call("POST", "projects/tasks/2/time", "pm", { date: yesterday, hours: 1, summary: "Checked the build" })).status, 200);
  assert.equal((await call("POST", "projects/tasks/2/time", "sales", { date: yesterday, hours: 1, summary: "x" })).status, 403);
});

test("time entries are checked: no future days, sensible hours, a summary", async () => {
  reset();
  assert.equal((await call("POST", "projects/tasks/2/time", "eng", { date: time.addDays(time.sydneyDate(), 2), hours: 1, summary: "x" })).status, 400);
  assert.equal((await call("POST", "projects/tasks/2/time", "eng", { date: yesterday, hours: 30, summary: "x" })).status, 400);
  assert.equal((await call("POST", "projects/tasks/2/time", "eng", { date: yesterday, hours: 1, summary: "" })).status, 400);
});

test("completing a task sets Autotask's Complete status on the project's task", async () => {
  reset();
  const r = await call("POST", "projects/tasks/2/complete", "eng", {});
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  const patch = calls.find(c => c.method === "PATCH");
  assert.match(patch.url, /\/V1\.0\/Projects\/50\/Tasks$/);
  assert.deepEqual(patch.body, { id: 2, status: 5 });
});

test("rescheduling: preview, then save exactly that plan; dependants move and keep their time of day", async () => {
  reset();
  assert.equal((await call("POST", "projects/50/reschedule/preview", "eng", { taskId: 1, start: "2026-11-02", end: "2026-11-05" })).status, 403);
  const pv = await call("POST", "projects/50/reschedule/preview", "pm", { taskId: 1, start: "2026-11-02", end: "2026-11-05" });
  assert.equal(pv.status, 200, JSON.stringify(pv.jsonBody));
  assert.deepEqual(pv.jsonBody.changes.map(c => [c.id, c.start, c.end]), [[1, "2026-11-02", "2026-11-05"], [2, "2026-11-06", "2026-11-09"], [3, "2026-11-10", "2026-11-11"]]);
  const stale = await call("POST", "projects/50/reschedule", "pm", { taskId: 1, start: "2026-11-02", end: "2026-11-05", expect: pv.jsonBody.changes.slice(0, 1) });
  assert.equal(stale.status, 409);
  const ok = await call("POST", "projects/50/reschedule", "pm", { taskId: 1, start: "2026-11-02", end: "2026-11-05", expect: pv.jsonBody.changes, reason: "Hardware delayed" });
  assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
  const patches = calls.filter(c => c.method === "PATCH");
  assert.equal(patches.length, 3);
  const t3 = patches.find(c => c.body.id === 3).body;
  assert.equal(t3.startDateTime, time.sydneyToUtc("2026-11-10", 9).toISOString());
  assert.equal(t3.endDateTime, time.sydneyToUtc("2026-11-11", 17).toISOString());
  assert.equal(writes.filter(w => /audit_event/.test(w.text)).length, 3);
});

test("dependencies: Project Managers link ticked tasks; loops are refused; links go to Autotask under the successor task", async () => {
  reset();
  assert.equal((await call("POST", "projects/50/links/preview", "eng", { taskIds: [1, 3], shape: "chain" })).status, 403);
  const loop = await call("POST", "projects/50/links/preview", "pm", { taskIds: [3, 1], shape: "chain" });
  assert.equal(loop.status, 409);
  assert.match(loop.jsonBody.error, /loop/);
  const pv = await call("POST", "projects/50/links/preview", "pm", { taskIds: [1, 2, 3], shape: "after", lag: 1 });
  assert.equal(pv.status, 200, JSON.stringify(pv.jsonBody));
  assert.deepEqual(pv.jsonBody.add.map(l => [l.pred, l.succ, l.lag]), [[1, 3, 1]]);   // 1 → 2 already exists
  assert.deepEqual(pv.jsonBody.already.map(l => [l.pred, l.succ]), [[1, 2]]);
  const ok = await call("POST", "projects/50/links", "pm", { taskIds: [1, 2, 3], shape: "after", lag: 1, expect: [] });
  assert.equal(ok.status, 200, JSON.stringify(ok.jsonBody));
  const post = calls.find(c => c.method === "POST" && /Predecessors$/.test(c.url));
  assert.match(post.url, /\/V1\.0\/Tasks\/3\/Predecessors$/);
  assert.deepEqual(post.body, { predecessorTaskID: 1, successorTaskID: 3, lagDays: 1 });
});

test("removing a dependency deletes only that link, under its successor task", async () => {
  reset();
  const r = await call("DELETE", "projects/50/links/12", "pm", { reason: "Not needed" });
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  const del = calls.find(c => c.method === "DELETE");
  assert.match(del.url, /\/V1\.0\/Tasks\/3\/Predecessors\/12$/);
  assert.equal((await call("DELETE", "projects/50/links/99", "pm", {})).status, 404);
});
