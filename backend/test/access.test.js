"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { accessFor, canOverride, canEditMeasurable, canSeeDivision } = require("../src/lib/access");

const sla = { code: "sla-first-response", division: "ManagedServices", ownerOid: "tony" };
const dso = { code: "dso", division: "Finance", ownerOid: "mandy" };

test("leadership can override any measurable", () => {
  const a = accessFor(["Pulse.User", "Pulse.Leadership"]);
  assert.equal(canOverride(a, sla), true);
  assert.equal(canOverride(a, dso), true);
  assert.equal(a.changeDepartments, true);
});

test("staff can override only their own division's measurables", () => {
  const a = accessFor(["Pulse.User", "Division.ManagedServices"]);
  assert.equal(canOverride(a, sla), true);
  assert.equal(canOverride(a, dso), false);
  assert.equal(a.changeDepartments, false);
  assert.equal(canSeeDivision(a, "ManagedServices"), true);
  assert.equal(canSeeDivision(a, "Finance"), false);
});

test("staff with no division can't override anything", () => {
  const a = accessFor(["Pulse.User"]);
  assert.equal(a.signIn, true);
  assert.equal(canOverride(a, sla), false);
  assert.deepEqual(a.divisions, []);
});

test("Platform Admin is leadership and admin everywhere", () => {
  const a = accessFor(["Pulse.Admin"]);
  assert.equal(a.leadership, true);
  assert.equal(a.viewAudit, true);
  assert.equal(a.manageConnections, true);
  assert.equal(a.financeDetail, true);
  assert.equal(canOverride(a, dso), true);
  assert.equal(a.divisions.length, 6);
});

test("finance detail and compliance are separate grants", () => {
  const a = accessFor(["Pulse.User", "Pulse.FinanceDetail"]);
  assert.equal(a.financeDetail, true);
  assert.equal(a.viewAudit, false);
  const c = accessFor(["Pulse.User", "Pulse.Compliance"]);
  assert.equal(c.viewAudit, true);
  assert.equal(c.financeDetail, false);
});

test("only app roles from other apps: no Pulse sign-in", () => {
  const a = accessFor(["Pipeline.User"]);
  assert.equal(a.signIn, false);
  assert.equal(canOverride(a, sla), false);
});

test("measurable owner can edit its definition; others can't unless leadership", () => {
  const staff = accessFor(["Pulse.User", "Division.ManagedServices"]);
  assert.equal(canEditMeasurable(staff, sla, "tony"), true);
  assert.equal(canEditMeasurable(staff, sla, "someone-else"), false);
  assert.equal(canEditMeasurable(accessFor(["Pulse.Leadership"]), sla, "x"), true);
});

test("/api/me tells the page every access rule (Client health was missing in 0.10.0)", () => {
  const access = require("../src/lib/access");
  const a = access.accessFor(["Pulse.Admin"]);
  const d = access.describe(a);
  for (const k of Object.keys(a).filter(k => k !== "roles" && k !== "signIn")) assert.ok(k in d, `${k} is sent to the page`);
  assert.equal(d.viewClients, true); assert.equal(d.clientMrr, true);
  assert.equal("roles" in d, false);
  assert.equal(access.describe(access.accessFor(["Pulse.User", "Division.ManagedServices"])).clientMrr, false);
});
