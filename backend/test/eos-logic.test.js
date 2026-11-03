"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/eos/logic");
const time = require("../src/lib/time");

test("shown value: override beats entered beats automatic", () => {
  assert.deepEqual(L.shownValue({ auto_value: 90, entered_value: null, is_overridden: false }), { value: 90, source: "auto" });
  assert.deepEqual(L.shownValue({ auto_value: 90, entered_value: 92, is_overridden: false }), { value: 92, source: "entered" });
  assert.deepEqual(L.shownValue({ auto_value: 90, entered_value: 92, is_overridden: true, override_value: 95 }), { value: 95, source: "override" });
  assert.deepEqual(L.shownValue(null), { value: null, source: null });
});

test("on target respects direction", () => {
  assert.equal(L.onTarget({ goal_value: 95, direction: "higher" }, 96), true);
  assert.equal(L.onTarget({ goal_value: 95, direction: "higher" }, 94.9), false);
  assert.equal(L.onTarget({ goal_value: 28, direction: "lower" }, 28), true);
  assert.equal(L.onTarget({ goal_value: 28, direction: "lower" }, 29), false);
  assert.equal(L.onTarget({ goal_value: null, direction: "higher" }, 5), null);
});

test("cell actions: enter while open, override when locked or automatic, revert when overridden", () => {
  const manual = { auto_enabled: false }, auto = { auto_enabled: true };
  assert.deepEqual(L.cellActions({ allowed: true, measurable: manual, locked: false, row: null }), { enter: true, override: false, revert: false });
  assert.deepEqual(L.cellActions({ allowed: true, measurable: manual, locked: true, row: null }), { enter: false, override: true, revert: false });
  assert.deepEqual(L.cellActions({ allowed: true, measurable: auto, locked: false, row: null }), { enter: false, override: true, revert: false });
  assert.deepEqual(L.cellActions({ allowed: true, measurable: manual, locked: false, row: { is_overridden: true } }), { enter: false, override: true, revert: true });
  assert.deepEqual(L.cellActions({ allowed: false, measurable: manual, locked: false, row: null }), { enter: false, override: false, revert: false });
});

test("numbers typed by people", () => {
  assert.equal(L.parseNumber("1,234.5"), 1234.5);
  assert.equal(L.parseNumber("$9.2"), 9.2);
  assert.equal(L.parseNumber("45%"), 45);
  assert.equal(L.parseNumber("-3"), -3);
  assert.equal(L.parseNumber("abc"), null);
  assert.equal(L.parseNumber(""), null);
  assert.equal(L.parseNumber("1e20"), null);
});

test("reasons need a few words", () => {
  assert.equal(L.requireReason("ok"), null);
  assert.equal(L.requireReason("  Autotask double-counted a merged ticket  "), "Autotask double-counted a merged ticket");
});

const NOW = new Date("2026-11-03T00:00:00Z");   // Tue 3 Nov 2026, Sydney: FY27 Q2, 126 days in

test("cumulative plan metric (revenue): year to date and quarter sums", () => {
  const metric = { id: 1, fy: 2027, code: "revenue", name: "Revenue", unit: "currency", kind: "cumulative", annual_target: 9200000, opening_value: null };
  const quarters = [{ quarter: 1, target: 2200000 }, { quarter: 2, target: 2300000 }, { quarter: 3, target: 2300000 }, { quarter: 4, target: 2400000 }];
  const months = [
    { month: "2026-07-01", entered_value: 700000 }, { month: "2026-08-01", entered_value: 720000 },
    { month: "2026-09-01", entered_value: 760000 }, { month: "2026-10-01", entered_value: 780000 },
  ];
  const p = L.planProgress(metric, quarters, months, NOW);
  assert.equal(p.actual, 2960000);
  assert.equal(p.progress, Math.round(2960000 / 9200000 * 1e4) / 1e4);
  assert.equal(p.quarters[0].actual, 2180000);
  assert.equal(p.quarters[0].progress, Math.round(2180000 / 2200000 * 1e4) / 1e4);
  assert.equal(p.quarters[1].actual, 780000);
  assert.equal(p.quarters[1].monthsReported, 1);
  assert.equal(p.quarters[2].actual, null);
  assert.equal(p.quarters[0].elapsed, 1);
  assert.equal(p.quarters[2].elapsed, 0);
  assert.equal(p.elapsed, Math.round(126 / 365 * 1e4) / 1e4);
  assert.equal(p.lastMonth, "2026-10-01");
  assert.equal(p.quarterTargetsMismatch, false);
});

test("quarter targets that don't add up to the year are flagged", () => {
  const metric = { id: 1, fy: 2027, kind: "cumulative", annual_target: 9200000 };
  const p = L.planProgress(metric, [1, 2, 3, 4].map(q => ({ quarter: q, target: 2000000 })), [], NOW);
  assert.equal(p.quarterTargetsMismatch, true);
  assert.equal(p.quarterTargetsTotal, 8000000);
  assert.equal(L.planProgress(metric, [{ quarter: 1, target: 1 }], [], NOW).quarterTargetsMismatch, false); // not all set yet
});

test("level plan metric (MRR): latest month, measured from the opening level", () => {
  const metric = { id: 2, fy: 2027, kind: "level", annual_target: 560000, opening_value: 480000 };
  const months = [{ month: "2026-07-01", entered_value: 485000 }, { month: "2026-09-01", entered_value: 500000 }, { month: "2026-10-01", auto_value: 520000 }];
  const p = L.planProgress(metric, [{ quarter: 1, target: 500000 }, { quarter: 2, target: 520000 }], months, NOW);
  assert.equal(p.actual, 520000);
  assert.equal(p.progress, 0.5);                 // (520 − 480) ÷ (560 − 480)
  assert.equal(p.quarters[0].actual, 500000);    // Q1's last reported month (September)
  assert.equal(p.quarters[0].progress, 1);
  assert.equal(p.quarters[1].actual, 520000);
  assert.equal(p.months.find(m => m.month === "2026-10-01").entered, false);
  // without an opening level: plain share of target
  assert.equal(L.planProgress({ ...metric, opening_value: null }, [], months, NOW).progress, Math.round(520000 / 560000 * 1e4) / 1e4);
});

test("financial year helpers", () => {
  assert.deepEqual(time.fyOf("2026-06-30"), { fy: 2026, quarter: 4 });
  assert.deepEqual(time.fyOf("2026-07-01"), { fy: 2027, quarter: 1 });
  assert.deepEqual(time.fyRange(2027, 3), { start: "2027-01-01", end: "2027-03-31" });
  assert.equal(time.fyLabel(2027, 2), "FY27 Q2");
  assert.equal(time.fyMonths(2027).length, 12);
});
