"use strict";
// Two-way links (0.8.0): To-dos <-> Planner, Issue -> Autotask, Rock progress.
const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/lib/sql");
const P = require("../src/links/planner");
const M = P._test;
const L = require("../src/eos/links")._test;
const progress = require("../src/links/progress")._test;

/* ------------------------------ merge ------------------------------ */
const snap = { title: "Send targets", due: "2026-11-17", done: false, owner: "oid-g" };

test("merge: a field changed on one side goes to the other", () => {
  const r = M.merge(snap, { ...snap, title: "Send FY27 targets" }, { ...snap, done: true });
  assert.deepEqual(r.toPlanner, { title: "Send FY27 targets" });
  assert.deepEqual(r.toPulse, { done: true });
  assert.deepEqual(r.agreed, { title: "Send FY27 targets", due: "2026-11-17", done: true, owner: "oid-g" });
});

test("merge: changed on both sides, Pulse wins; nothing changed, nothing to do", () => {
  const r = M.merge(snap, { ...snap, due: "2026-11-20" }, { ...snap, due: "2026-11-19" });
  assert.deepEqual(r.toPlanner, { due: "2026-11-20" });
  assert.deepEqual(r.toPulse, {});
  const same = M.merge(snap, { ...snap }, { ...snap });
  assert.deepEqual([same.toPlanner, same.toPulse], [{}, {}]);
});

test("merge: someone Pulse can't match assigned in Planner leaves the Pulse owner alone", () => {
  const r = M.merge(snap, { ...snap }, { ...snap, owner: null });
  assert.equal(r.toPulse.owner, undefined);
  assert.equal(r.toPlanner.owner, "oid-g", "and Planner is put back to the owner Pulse knows");
});

test("Planner dates: Pulse writes midnight UTC; any time in Planner reads as the Sydney day", () => {
  assert.equal(M.plannerDue("2026-11-17"), "2026-11-17T00:00:00Z");
  assert.equal(M.plannerDay("2026-11-17T00:00:00Z"), "2026-11-17");
  assert.equal(M.plannerDay("2026-11-16T13:00:00Z"), "2026-11-17", "midnight in Sydney is 1pm the day before in UTC");
  assert.equal(M.plannerDay(null), null);
});

test("task body: only the changed fields, and changing the owner unassigns the others", () => {
  assert.deepEqual(M.taskBody({ done: true }), { percentComplete: 100 });
  const b = M.taskBody({ owner: "oid-m" }, { assignments: { "oid-g": {} } });
  assert.deepEqual(Object.keys(b.assignments).sort(), ["oid-g", "oid-m"]);
  assert.equal(b.assignments["oid-g"], null);
});

/* ------------------------------ a whole run ------------------------------ */
test("sync run: sends a new To-do, brings in a Planner task, copies a completion back, mirrors deletions", async () => {
  const writes = [];
  const todos = [
    { id: 1, title: "New in Pulse", due_date: "2026-11-17", is_done: false, is_deleted: false, owner_email: "george@hdit.com.au", task_id: null },
    { id: 2, title: "Done in Planner", due_date: "2026-11-14", is_done: false, is_deleted: false, owner_email: "george@hdit.com.au", task_id: "t2", etag: "W/1",
      snapshot: JSON.stringify({ title: "Done in Planner", due: "2026-11-14", done: false, owner: "oid-g" }) },
    { id: 3, title: "Deleted in Pulse", due_date: "2026-11-14", is_done: false, is_deleted: true, owner_email: null, task_id: "t3", etag: "W/3", snapshot: "{}" },
    { id: 4, title: "Deleted in Planner", due_date: "2026-11-14", is_done: false, is_deleted: false, owner_email: null, task_id: "t4", etag: "W/4", snapshot: "{}" },
  ];
  db._test.use({ async query(text, p = {}) {
    if (/FROM pulse\.app_setting/.test(text)) return [{ value: "PLAN1" }];
    if (/FROM pulse\.todo t LEFT JOIN pulse\.todo_planner/.test(text)) return todos;
    if (/FROM pulse\.person/.test(text)) return [{ entra_oid: "oid-g", display_name: "George Hanna", email: "george@hdit.com.au" }];
    writes.push({ text, p });
    return /OUTPUT inserted\.id/.test(text) ? [{ id: 50 }] : [];
  } });
  const sent = [];
  const graph = {
    async all(path) { assert.equal(path, "/planner/plans/PLAN1/tasks"); return [
      { id: "t2", title: "Done in Planner", dueDateTime: "2026-11-14T00:00:00Z", percentComplete: 100, completedDateTime: "2026-11-11T01:00:00Z", assignments: { "oid-g": {} }, "@odata.etag": "W/2" },
      { id: "t3", title: "Deleted in Pulse", percentComplete: 0, assignments: {}, "@odata.etag": "W/3" },
      { id: "t9", title: "Added in Planner", dueDateTime: "2026-11-20T00:00:00Z", percentComplete: 0, assignments: { "oid-g": {} }, "@odata.etag": "W/9" },
    ]; },
    async send(method, path, body, opt) { sent.push({ method, path, body, opt }); return { status: 201, body: { id: "t-new" }, etag: "W/new" }; },
  };
  const out = await P.syncTodos(graph, new Date("2026-11-11T02:00:00Z"));
  assert.match(out, /1 sent, 1 brought in, 0 updated in Planner, 1 updated in Pulse, 2 deleted/);
  const post = sent.find(s => s.method === "POST");
  assert.deepEqual([post.body.planId, post.body.title, post.body.dueDateTime, Object.keys(post.body.assignments)], ["PLAN1", "New in Pulse", "2026-11-17T00:00:00Z", ["oid-g"]]);
  assert.deepEqual(sent.find(s => s.method === "DELETE"), { method: "DELETE", path: "/planner/tasks/t3", body: undefined, opt: { etag: "W/3" } }, "deleted in Pulse: deleted in Planner, with its ETag");
  assert.ok(writes.some(w => /UPDATE pulse\.todo SET is_done = @is_done/.test(w.text) && w.p.id === 2 && w.p.is_done === 1), "completed in Planner: done in Pulse");
  assert.ok(writes.some(w => /UPDATE pulse\.todo SET is_deleted = 1/.test(w.text) && w.p.id === 4), "deleted in Planner: deleted in Pulse");
  const imported = writes.find(w => /INSERT INTO pulse\.todo \(/.test(w.text));
  assert.deepEqual([imported.p.title, imported.p.ownerName, imported.p.due], ["Added in Planner", "George Hanna", "2026-11-20"]);
  assert.ok(writes.some(w => /audit_event/.test(w.text)), "changes made by the sync are audited");
});

test("sync run: no plan set yet is a note, not a failure", async () => {
  db._test.use({ async query() { return []; } });
  assert.match(await P.syncTodos({}), /no L10 plan set/);
});

/* ------------------------------ helpers ------------------------------ */
test("Planner plan link: every address style Planner uses, or the bare id", () => {
  const id = "xqQg5FS2LkCp935s-FIFm2QAFkHM";
  for (const s of [
    `https://planner.cloud.microsoft/webui/plan/${id}/view/board?tid=0b1e12e5`,
    `https://tasks.office.com/hditest.onmicrosoft.com/Home/PlanViews/${id}?Type=PlanLink&Channel=Link`,
    `https://tasks.office.com/x/Home/Planner/#/plantaskboard?groupId=abc&planId=${id}`,
    id,
  ]) assert.equal(L.planIdFrom(s), id, s);
  assert.equal(L.planIdFrom("https://example.com/nothing-here"), null);
  assert.equal(L.planIdFrom(""), null);
});

test("Autotask create: required picklists get Autotask's default, values given are kept", () => {
  const fields = [
    { name: "status", isRequired: true, isPickList: true, picklistValues: [{ value: "1", label: "New", isDefaultValue: false }, { value: "8", label: "In Progress", isDefaultValue: true }] },
    { name: "priority", isRequired: true, isPickList: true, picklistValues: [{ value: "2", label: "Medium", isDefaultValue: true }] },
    { name: "ticketType", isRequired: true, isReadOnly: true, isPickList: true, picklistValues: [{ value: "1", label: "Service Request" }] },
    { name: "title", isRequired: true },
  ];
  assert.deepEqual(L.fillRequired(fields, { status: 1, title: "x" }), { status: 1, title: "x", priority: 2 });
  assert.equal(L.newStatus(fields[0]), 1, "New, not the default, for something just raised");
  assert.match(L.autotaskUrl("https://ww29.autotask.net", "ticket", 123), /ExecuteCommand\.aspx\?Code=OpenTicketDetail&TicketID=123$/);
});

test("Planner plan progress: done tasks, in-progress ones count half", () => {
  assert.deepEqual(progress.planProgress([{ percentComplete: 100 }, { percentComplete: 50 }, { percentComplete: 0 }, { percentComplete: 100 }]),
    { pct: 63, detail: "2 of 4 tasks complete, 1 in progress." });
  assert.equal(progress.planProgress([]).pct, 0);
});

/* ------------------------------ Issue -> Autotask, through the router ------------------------------ */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const TENANT = "0b1e12e5-f6cd-4ae7-a9ff-4562637a0c44", CLIENT = "11111111-2222-3333-4444-555555555555";
process.env.ENTRA_TENANT_ID = TENANT; process.env.ENTRA_CLIENT_ID = CLIENT;
const entra = require("../src/lib/entra");
const { router } = require("../src/lib/http");
const atLib = require("../src/lib/autotask");
const vault = require("../src/lib/vault");
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
entra._test.setKeys(new Map([["k1", keys.publicKey]]));
const who = { leader: ["Sam Leader", "sam@hdit.com.au", ["Pulse.User", "Pulse.Leadership"]], tech: ["Riley Tech", "riley@hdit.com.au", ["Pulse.User", "Division.ManagedServices"]] };
const tok = w => jwt.sign({ aud: CLIENT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, oid: "oid-" + w, scp: "access_as_user", name: who[w][0], preferred_username: who[w][1], roles: who[w][2] }, keys.privateKey, { algorithm: "RS256", keyid: "k1", expiresIn: "1h" });
const call = (method, path, w, body) => router(require("../src/api/routes").routes)({ method, url: `https://f.example/api/${path}`, params: { path: path.split("?")[0] },
  headers: { get: k => (k.toLowerCase() === "authorization" ? `Bearer ${tok(w)}` : null) }, text: async () => (body === undefined ? "" : JSON.stringify(body)) }, { log() {}, warn() {}, error() {} });

test("Issue -> Autotask ticket: only people who can see the Issue; New status, chosen queue, defaults for the rest; linked and audited", async () => {
  const writes = [];
  db._test.use({ async query(text, p = {}) {
    if (/FROM pulse\.issue WHERE id = @id/.test(text)) return [{ id: p.id, level: "company", division_code: null, title: "Utilisation below 70%", description: "Three weeks running", raised_by_name: "Sam Leader" }];
    if (/FROM pulse\.issue_link WHERE issue_id = @id/.test(text)) return [];
    if (/FROM pulse\.app_setting/.test(text)) return [{ key: "autotask.internal_company_id", value: "0" }, { key: "autotask.web_url", value: "https://ww29.autotask.net" }];
    writes.push({ text, p }); return [];
  } });
  vault.getSecret = async () => ({ value: JSON.stringify({ username: "u", secret: "s", integrationCode: "ic", baseUrl: "https://ws.example/ATServicesRest/" }) });
  const asked = [];
  atLib._test.setFetch(async (url, opt) => {
    asked.push({ url, method: opt.method, body: opt.body ? JSON.parse(opt.body) : null });
    const ok = j => ({ ok: true, status: 200, json: async () => j });
    if (url.endsWith("/Tickets/entityInformation/fields")) return ok({ fields: [
      { name: "status", isRequired: true, isPickList: true, picklistValues: [{ value: "1", label: "New" }, { value: "5", label: "Complete" }] },
      { name: "priority", isRequired: true, isPickList: true, picklistValues: [{ value: "2", label: "Medium", isDefaultValue: true }] },
      { name: "queueID", isPickList: true, picklistValues: [{ value: "29682833", label: "Internal" }] },
      { name: "issueType", isRequired: true, isPickList: true, picklistValues: [{ value: "7", label: "Internal" }] } ] });
    if (opt.method === "POST" && /\/Tickets$/.test(url)) return ok({ itemId: 812 });
    if (/Tickets\/query/.test(url)) return ok({ items: [{ id: 812, ticketNumber: "T20261111.0042", status: 1 }], pageDetails: {} });
    return ok({ items: [] });
  });
  assert.equal((await call("POST", "issues/5/autotask", "tech", { kind: "ticket" })).status, 404, "a company Issue is the leadership team's");
  assert.equal(asked.length, 0);
  const r = await call("POST", "issues/5/autotask", "leader", { kind: "ticket", queueId: "29682833", dueDate: "2026-11-18" });
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  const post = asked.find(a => a.method === "POST").body;
  assert.deepEqual([post.companyID, post.status, post.priority, post.queueID, post.issueType, post.title], [0, 1, 2, 29682833, 7, "Utilisation below 70%"]);
  assert.equal(post.dueDateTime, "2026-11-18T06:00:00.000Z", "5pm Sydney on the due date");
  assert.match(post.description, /Three weeks running\n\nFrom HD IT Pulse: Issue #5 .*Created in Autotask by Sam Leader\./);
  assert.equal(r.jsonBody.number, "T20261111.0042");
  assert.ok(writes.some(w => /INSERT INTO pulse\.issue_link/.test(w.text) && w.p.atId === 812));
  assert.ok(writes.some(w => /audit_event/.test(w.text)));
  assert.equal((await call("POST", "issues/5/autotask", "leader", { kind: "spaceship" })).status, 400);
});
