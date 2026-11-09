"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { plan } = require("../src/people/departments");
const at = require("../src/lib/autotask");
const vault = require("../src/lib/vault");

const P = (id, dept, role, isDefault, isActive = true) => ({ id, resourceID: 7, departmentID: dept, roleID: role, isDefault, isActive });

test("already in that department: nothing to do", () => {
  assert.equal(plan([P(1, 10, 100, true)], 10).action, "none");
});

test("an existing pairing with the new department becomes the default, keeping the current role if possible", () => {
  const p = plan([P(1, 10, 100, true), P(2, 20, 200, false), P(3, 20, 100, false)], 20);
  assert.deepEqual({ action: p.action, id: p.id }, { action: "set-default", id: 3 });
  assert.equal(plan([P(1, 10, 100, true), P(2, 20, 200, false)], 20).id, 2);
});

test("inactive pairings aren't reused; a new pairing carries the current role", () => {
  const p = plan([P(1, 10, 100, true), P(2, 20, 100, false, false)], 20);
  assert.deepEqual({ action: p.action, roleId: p.roleId }, { action: "create", roleId: 100 });
});

test("a chosen role is used; with no current default a role must be chosen", () => {
  assert.equal(plan([P(1, 10, 100, true)], 20, 300).roleId, 300);
  assert.equal(plan([], 20).action, "need-role");
  assert.equal(plan([], 20, 300).action, "create");
  assert.equal(plan([P(1, 10, 100, true)], 10, 300).action, "create");   // same department, different role
});

test("Autotask client: follows paging, sends the right credential, stays on its own address", async () => {
  vault.getSecret = async name => ({ value: JSON.stringify({ username: "u-" + name, secret: "s", integrationCode: "ic", baseUrl: "https://webservices29.autotask.net/ATServicesRest/" }) });
  const seen = [];
  at._test.setFetch(async (url, opt) => {
    seen.push({ url, user: opt.headers.UserName, method: opt.method, body: opt.body });
    if (url.endsWith("/query")) return { ok: true, status: 200, json: async () => ({ items: [{ id: 1 }], pageDetails: { nextPageUrl: "https://webservices29.autotask.net/ATServicesRest/V1.0/Resources/query/next?paging=x" } }) };
    return { ok: true, status: 200, json: async () => ({ items: [{ id: 2 }], pageDetails: { nextPageUrl: null } }) };
  });
  const items = await at.query("people", "Resources", null, ["id"]);
  assert.deepEqual(items.map(i => i.id), [1, 2]);
  assert.ok(seen.every(s => s.user === "u-autotask-service"));
  assert.equal(seen[1].method, "POST", "the next page of a POST query is POSTed again");
  assert.equal(seen[1].body, seen[0].body, "with the same filter");
  at._test.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ items: [], pageDetails: { nextPageUrl: "https://evil.example/steal" } }) }));
  await assert.rejects(at.query("people", "Resources"), /another address/);
});

test("Autotask client: a missing credential says where to enter it", async () => {
  vault.getSecret = async () => ({ value: null });
  at._test.clear();
  await assert.rejects(at.query("scorecard", "Contracts"), e => e.code === "not-connected" && /Connections/.test(e.message));
});

test("one Autotask connection: each Pulse module may only touch its own Autotask records", async () => {
  await assert.rejects(at.query("scorecard", "Resources"), e => e.code === "not-allowed");
  await assert.rejects(at.update("scorecard", "Tickets", { id: 1 }), e => e.code === "not-allowed");
  await assert.rejects(at.update("people", "Resources", { id: 1 }), e => e.code === "not-allowed");
  await assert.rejects(at.create("projects", "Tasks", { id: 1 }), e => e.code === "not-allowed");   // projects may edit tasks, not add them
  await assert.rejects(at.query("billing", "Contracts"), /Unknown Pulse module/);
  for (const [mod, p] of Object.entries(at.POLICY)) for (const [entity, ops] of Object.entries(p.write)) {
    assert.ok(ops.every(op => ["create", "update"].includes(op)), `${mod} ${entity}: no deletes`);
  }
});
