"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const t = require("../src/lib/time");

test("week is Monday to Sunday in Sydney, named by its Monday", () => {
  // Saturday 31 Oct 2026, 10:00 Sydney (AEDT, UTC+11) = 23:00 UTC Friday
  assert.equal(t.weekOf(new Date("2026-10-30T23:00:00Z")), "2026-10-26");
  // Sunday 1 Nov 2026 23:59 Sydney is still that week
  assert.equal(t.weekOf(new Date("2026-11-01T12:59:00Z")), "2026-10-26");
  // Monday 2 Nov 2026 00:00 Sydney = Sunday 13:00 UTC: new week, even though UTC says Sunday
  assert.equal(t.weekOf(new Date("2026-11-01T13:00:00Z")), "2026-11-02");
});

test("lock is 5pm Sydney on the Tuesday after the week", () => {
  // Week of Mon 26 Oct 2026 locks Tue 3 Nov 2026 17:00 AEDT = 06:00 UTC
  assert.equal(t.lockAt("2026-10-26").toISOString(), "2026-11-03T06:00:00.000Z");
  assert.equal(t.isLocked("2026-10-26", new Date("2026-11-03T05:59:59Z")), false);
  assert.equal(t.isLocked("2026-10-26", new Date("2026-11-03T06:00:00Z")), true);
});

test("lock follows daylight saving (AEST in winter)", () => {
  // Week of Mon 1 Jun 2026 locks Tue 9 Jun 17:00 AEST (UTC+10) = 07:00 UTC
  assert.equal(t.lockAt("2026-06-01").toISOString(), "2026-06-09T07:00:00.000Z");
});

test("lock across the daylight saving change", () => {
  // DST starts Sun 4 Oct 2026 in Sydney. Week of Mon 28 Sep locks Tue 6 Oct 17:00 AEDT = 06:00 UTC
  assert.equal(t.lockAt("2026-09-28").toISOString(), "2026-10-06T06:00:00.000Z");
  // DST ends Sun 5 Apr 2026. Week of Mon 30 Mar locks Tue 7 Apr 17:00 AEST = 07:00 UTC
  assert.equal(t.lockAt("2026-03-30").toISOString(), "2026-04-07T07:00:00.000Z");
});

test("the Tuesday L10 reviews the week just ended", () => {
  // Tue 3 Nov 2026 09:30 Sydney
  const l10 = new Date("2026-11-02T22:30:00Z");
  assert.equal(t.weekOf(l10), "2026-11-02");
  assert.equal(t.reviewWeek(l10), "2026-10-26");
  assert.equal(t.weekInfo("2026-10-26", l10).locked, false);
});

test("parseWeek accepts Mondays only", () => {
  assert.equal(t.parseWeek("2026-11-02"), "2026-11-02");
  assert.equal(t.parseWeek("2026-11-03"), null);
  assert.equal(t.parseWeek("2026-02-30"), null);
  assert.equal(t.parseWeek("x"), null);
});

test("weekInfo", () => {
  const w = t.weekInfo("2026-10-26", new Date("2026-10-30T23:00:00Z"));
  assert.deepEqual(w, { week: "2026-10-26", start: "2026-10-26", end: "2026-11-01", lockAt: "2026-11-03T06:00:00.000Z", locked: false, current: true });
});
