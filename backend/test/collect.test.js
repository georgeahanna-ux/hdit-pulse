"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const calc = require("../src/collect/calc");
const L = require("../src/eos/logic");

const T = (id, o = {}) => ({ id, ...o });
const at = (iso) => new Date(iso).toISOString();

test("working days: Monday to Friday less weekday public holidays", () => {
  assert.deepEqual(calc.workingDays("2026-12-21", ["2026-12-25", "2026-12-26", "2026-12-28"]), { days: 4, holidays: ["2026-12-25"] });
  assert.equal(calc.workingDays("2026-11-02").days, 5);
});

test("SLA first response: met, missed, overdue without a response, still within time, no SLA", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const r = calc.slaFirstResponse([
    T(1, { firstResponseDueDateTime: at("2026-11-03T02:00:00Z"), firstResponseDateTime: at("2026-11-03T01:00:00Z") }),  // met
    T(2, { firstResponseDueDateTime: at("2026-11-03T02:00:00Z"), firstResponseDateTime: at("2026-11-03T02:00:00Z") }),  // met (on time)
    T(3, { firstResponseDueDateTime: at("2026-11-03T02:00:00Z"), firstResponseDateTime: at("2026-11-03T03:00:00Z") }),  // missed
    T(4, { firstResponseDueDateTime: at("2026-11-04T02:00:00Z") }),                                                    // overdue, missed
    T(5, { firstResponseDueDateTime: at("2026-11-06T02:00:00Z") }),                                                    // within time
    T(6, {}),                                                                                                          // no SLA
  ], now);
  assert.equal(r.value, 50);
  assert.deepEqual([r.detail.met, r.detail.missed, r.detail.waiting, r.detail.noSla], [2, 2, 1, 1]);
  assert.match(r.detail.text, /^2 of 4 tickets had a first response in time\. 2 missed\./);
  assert.equal(calc.slaFirstResponse([T(1, {})], now).value, null);
});

test("tickets per tech per day counts tickets completed by techs (or assigned when completer is unknown)", () => {
  const days = calc.workingDays("2026-11-02");
  const done = [T(1, { completedByResourceID: 10 }), T(2, { completedByResourceID: 11, assignedResourceID: 10 }), T(3, { assignedResourceID: 10 }), T(4, { completedByResourceID: 99 })];
  const r = calc.ticketsPerTech(done, [10, 11], days);
  assert.equal(r.value, 0.3);   // 3 tickets ÷ (2 techs × 5 days)
  assert.equal(r.detail.tickets, 3);
  assert.equal(calc.ticketsPerTech(done, [], days).value, null);
  assert.match(calc.ticketsPerTech(done, [], days).detail.text, /Service Desk/);
});

test("first-contact resolution: one time entry; tickets without time are left out", () => {
  const done = [T(1, { completedByResourceID: 10 }), T(2, { completedByResourceID: 10 }), T(3, { completedByResourceID: 10 }), T(4, { completedByResourceID: 99 })];
  const entries = [{ ticketID: 1 }, { ticketID: 2 }, { ticketID: 2 }, { ticketID: 4 }];
  const r = calc.firstContact(done, entries, [10]);
  assert.equal(r.value, 50);   // ticket 1 single, ticket 2 two entries, ticket 3 no time; ticket 4 not a tech's
  assert.equal(r.detail.noTime, 1);
});

test("utilisation: billable ticket and task time ÷ techs × days × hours a day", () => {
  const days = calc.workingDays("2026-11-02");
  const r = calc.utilisation([
    { resourceID: 10, ticketID: 1, hoursWorked: 20 },
    { resourceID: 10, taskID: 5, hoursWorked: 6 },
    { resourceID: 10, ticketID: 2, hoursWorked: 2, isNonBillable: true },
    { resourceID: 10, hoursWorked: 7.6 },               // internal time
    { resourceID: 99, ticketID: 3, hoursWorked: 30 },   // not a tech
  ], [10], days, 7.6);
  assert.equal(r.value, 68.4);   // 26 ÷ 38
  assert.deepEqual([r.detail.billable, r.detail.available, r.detail.other], [26, 38, 9.6]);
});

test("holiday set: named in settings, else the only one, else an Australian-looking one", () => {
  const sets = [{ id: 1, holidaySetName: "US" }, { id: 2, holidaySetName: "NSW Public Holidays" }];
  assert.equal(calc.pickHolidaySet(sets, null).id, 2);
  assert.equal(calc.pickHolidaySet(sets, "us").id, 1);
  assert.equal(calc.pickHolidaySet(sets, "Nope"), null);
  assert.equal(calc.pickHolidaySet([{ id: 7, holidaySetName: "Default" }], null).id, 7);
});

test("trial (shadow) mode: the automatic value is never the shown value until switched on", () => {
  const row = { auto_value: 93, entered_value: null, is_overridden: false };
  assert.deepEqual(L.shownValue(row, false), { value: null, source: null });
  assert.deepEqual(L.shownValue(row, true), { value: 93, source: "auto" });
  assert.deepEqual(L.shownValue({ ...row, entered_value: 90 }, false), { value: 90, source: "entered" });
});

/* ---------- collectWeek against a fake Autotask and database ---------- */
test("collectWeek reads Autotask with the Service credential and works out all four measurables", async () => {
  const vault = require("../src/lib/vault");
  const atLib = require("../src/lib/autotask");
  const db = require("../src/lib/sql");
  const collector = require("../src/collect/autotask");
  vault.getSecret = async name => ({ value: JSON.stringify({ username: "u-" + name, secret: "s", integrationCode: "ic", baseUrl: "https://ws.example/ATServicesRest/" }) });
  const asked = [];
  atLib._test.setFetch(async (url, opt) => {
    const body = opt.body ? JSON.parse(opt.body) : null;
    asked.push({ url, user: opt.headers.UserName, body });
    const entity = /V1\.0\/(\w+)/.exec(url)[1];
    const page = items => ({ ok: true, status: 200, json: async () => ({ items, pageDetails: { nextPageUrl: null } }) });
    if (url.endsWith("entityInformation/fields")) return { ok: true, status: 200, json: async () => ({ fields: ["id", "createDate", "completedDate", "status", "assignedResourceID", "firstResponseDateTime", "firstResponseDueDateTime"].map(name => ({ name })) }) };
    if (entity === "HolidaySets") return page([{ id: 3, holidaySetName: "NSW" }]);
    if (entity === "Holidays") return page([{ id: 1, holidayDate: "2026-11-04T00:00:00", holidayName: "Test day" }]);
    if (entity === "Tickets" && body.filter[0].field === "createDate") return page([T(1, { firstResponseDueDateTime: at("2026-11-03T00:00:00Z"), firstResponseDateTime: at("2026-11-02T23:00:00Z") })]);
    if (entity === "Tickets") return page([T(1, { assignedResourceID: 10 }), T(2, { assignedResourceID: 11 })]);
    if (entity === "TimeEntries" && body.filter[0].field === "ticketID") return page([{ ticketID: 1, resourceID: 10, hoursWorked: 1 }]);
    if (entity === "TimeEntries") return page([{ ticketID: 1, resourceID: 10, hoursWorked: 1 }, { resourceID: 10, hoursWorked: 7 }]);
    return page([]);
  });
  db._test.use({
    async query(text) {
      if (/app_setting/.test(text)) return [{ key: "collect.hours_per_day", value: "8" }];
      if (/FROM pulse\.at_resource/.test(text)) return [{ id: 10 }, { id: 11 }];
      return [];
    },
  });
  collector._test.reset();
  const out = await collector.collectWeek("2026-11-02", {}, new Date("2026-11-09T00:00:00Z"));
  assert.ok(asked.every(a => a.user === "u-autotask-service"), "uses only the Service API user");
  const ticketQuery = asked.find(a => /Tickets\/query/.test(a.url));
  assert.ok(!ticketQuery.body.IncludeFields.includes("completedByResourceID"), "drops fields this Autotask doesn't have");
  assert.equal(out["autotask.sla_first_response"].value, 100);
  assert.equal(out["autotask.tickets_per_tech"].value, 0.3);   // 2 tickets ÷ (2 techs × 4 days)
  assert.deepEqual(out["autotask.tickets_per_tech"].detail.holidays, ["2026-11-04"]);
  assert.equal(out["autotask.fcr"].value, 100);
  assert.equal(out["autotask.utilisation"].value, 1.6);        // 1 ÷ (2 × 4 × 8)
});
