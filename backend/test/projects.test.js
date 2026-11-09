"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/projects/logic");
const access = require("../src/lib/access");

const hol = new Set(["2026-12-25", "2026-12-28"]);
const T = (id, start, end, o = {}) => ({ id, start, end, complete: false, worked: 0, remaining: null, ...o });

test("working days skip weekends and holidays", () => {
  assert.equal(L.workdays("2026-11-09", "2026-11-13"), 5);
  assert.equal(L.workdays("2026-12-21", "2026-12-31", hol), 7);    // 9 weekdays less 25 and 28 Dec
  assert.equal(L.addWorkdays("2026-11-13", 1), "2026-11-16");      // Friday + 1 → Monday
  assert.equal(L.addWorkdays("2026-11-16", -1), "2026-11-13");
  assert.equal(L.addWorkdays("2026-12-24", 1, hol), "2026-12-29");
  assert.equal(L.workdayDelta("2026-11-13", "2026-11-17"), 2);
  assert.equal(L.workdayDelta("2026-11-17", "2026-11-13"), -2);
});

test("percent complete by hours, else by tasks", () => {
  assert.equal(L.percentComplete([T(1, null, null, { worked: 30, remaining: 10 }), T(2, null, null, { worked: 0, remaining: 20 })]), 50);
  assert.equal(L.percentComplete([T(1, null, null, { complete: true }), T(2, null, null)]), 50);
});

test("health: late, at risk (overdue task or progress behind time), on track, done", () => {
  const today = "2026-11-20";
  assert.equal(L.health({ start: "2026-11-02", end: "2026-11-13", pct: 90, tasks: [T(1, "2026-11-02", "2026-11-13")] }, today), "late");
  assert.equal(L.health({ start: "2026-11-02", end: "2026-11-27", pct: 90, tasks: [T(1, "2026-11-02", "2026-11-10")] }, today), "at-risk");
  assert.equal(L.health({ start: "2026-11-02", end: "2026-11-27", pct: 30, tasks: [T(1, "2026-11-02", "2026-11-27")] }, today), "at-risk");
  assert.equal(L.health({ start: "2026-11-02", end: "2026-11-27", pct: 70, tasks: [T(1, "2026-11-02", "2026-11-27")] }, today), "on-track");
  assert.equal(L.health({ start: "2026-11-02", end: "2026-11-13", pct: 100, tasks: [T(1, "2026-11-02", "2026-11-13", { complete: true })] }, today), "done");
});

test("critical path: the chain that sets the finish has no float", () => {
  const tasks = [T(1, "2026-11-02", "2026-11-04"), T(2, "2026-11-05", "2026-11-11"), T(3, "2026-11-05", "2026-11-06"), T(4, "2026-11-12", "2026-11-13")];
  const preds = [{ pred: 1, succ: 2, lag: 0 }, { pred: 1, succ: 3, lag: 0 }, { pred: 2, succ: 4, lag: 0 }, { pred: 3, succ: 4, lag: 0 }];
  const fc = L.floatAndCritical(tasks, preds);
  assert.deepEqual([1, 2, 3, 4].map(i => fc.get(i).critical), [true, true, false, true]);
  assert.equal(fc.get(3).float, 3);   // 3 can finish as late as 11 Nov
});

test("rescheduling keeps the gaps: a later end moves successors, an earlier start moves predecessors", () => {
  const tasks = [T(1, "2026-11-02", "2026-11-04"), T(2, "2026-11-05", "2026-11-06"), T(3, "2026-11-09", "2026-11-10"), T(9, "2026-11-02", "2026-11-03", { complete: true })];
  const preds = [{ pred: 1, succ: 2 }, { pred: 2, succ: 3 }, { pred: 9, succ: 1 }];
  // Extend task 1 by two working days: 2 and 3 move two days later.
  let ch = L.reschedule(tasks, preds, { id: 1, start: "2026-11-02", end: "2026-11-06" });
  assert.deepEqual(ch.map(c => [c.id, c.start, c.end]), [[1, "2026-11-02", "2026-11-06"], [2, "2026-11-09", "2026-11-10"], [3, "2026-11-11", "2026-11-12"]]);
  assert.equal(ch.find(c => c.id === 3).because, 2);
  // Start task 2 a day earlier (same end): task 1 moves a day earlier; complete task 9 never moves.
  ch = L.reschedule(tasks, preds, { id: 2, start: "2026-11-04", end: "2026-11-06" });
  assert.deepEqual(ch.map(c => [c.id, c.start, c.end]), [[2, "2026-11-04", "2026-11-06"], [1, "2026-10-30", "2026-11-03"]]);
  // Move the whole of task 2 a week later: successors and predecessors both move.
  ch = L.reschedule(tasks, preds, { id: 2, start: "2026-11-12", end: "2026-11-13" });
  assert.deepEqual(ch.map(c => c.id).sort(), [1, 2, 3]);
  assert.throws(() => L.reschedule(tasks, preds, { id: 2, start: "2026-11-10", end: "2026-11-09" }), /can't end before/);
});

test("projects access: Managed Services view, Project Managers and Leadership reschedule, Sales sees lead time", () => {
  const ms = access.accessFor(["Pulse.User", "Division.ManagedServices"]);
  const pm = access.accessFor(["Pulse.User", "Pulse.ProjectManager"]);
  const sales = access.accessFor(["Pulse.User", "Division.SalesMarketing"]);
  const lead = access.accessFor(["Pulse.Leadership"]);
  assert.deepEqual([ms.viewProjects, ms.editSchedules, ms.viewLeadTime], [true, false, true]);
  assert.deepEqual([pm.viewProjects, pm.editSchedules, pm.signIn], [true, true, true]);
  assert.deepEqual([sales.viewProjects, sales.editSchedules, sales.viewLeadTime], [false, false, true]);
  assert.deepEqual([lead.viewProjects, lead.editSchedules], [true, true]);
});

test("allocation: remaining hours spread over remaining working days; overdue work lands today", () => {
  const today = "2026-11-11";   // Wednesday
  const pieces = L.spread([
    { id: 1, projectId: 9, resource: 5, start: "2026-11-09", end: "2026-11-13", remaining: 9, complete: false },   // Wed–Fri: 3 h a day
    { id: 2, projectId: 9, resource: 5, start: "2026-11-02", end: "2026-11-06", remaining: 4, complete: false },   // overdue
    { id: 3, projectId: 9, resource: 5, start: "2026-11-16", end: "2026-11-17", estimated: 10, worked: 2, remaining: null, complete: false },
    { id: 4, projectId: 9, resource: 5, start: "2026-11-16", end: "2026-11-17", remaining: 5, complete: true },
  ], today);
  const sum = (f) => pieces.filter(f).reduce((s, p) => s + p.hours, 0);
  assert.equal(sum(p => p.taskId === 1 && p.day === "2026-11-12"), 3);
  assert.equal(sum(p => p.taskId === 2 && p.day === today && p.overdue), 4);
  assert.equal(sum(p => p.taskId === 3), 8);
  assert.equal(sum(p => p.taskId === 4), 0);
});

test("capacity and lead time: 7.6 h days less holidays, leave and the non-project share; extra people shorten it", () => {
  assert.equal(L.capacity("2026-11-09", 0, null, 0), 38);
  assert.equal(Math.round(L.capacity("2026-12-21", 7.6, hol, 0.2) * 10) / 10, Math.round((4 * 7.6 - 7.6) * 0.8 * 10) / 10);   // 25 Dec off; 28 Dec is next week
  const weekly = L.weeksFrom("2026-11-11", 6).map(week => ({ week, capacity: 100 }));
  const base = L.leadTime(250, weekly);
  assert.equal(base.weeks, 2.5);
  assert.equal(base.clearsWeek, "2026-11-30");
  const more = L.leadTime(250, weekly, [{ count: 2, hoursPerWeek: 30, from: "2026-11-09" }]);
  assert.ok(more.weeks < base.weeks);
  assert.equal(L.leadTime(0, weekly).weeks, 0);
});
