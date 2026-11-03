"use strict";
/**
 * Scorecard calendar (D5). All Pulse dates are Australia/Sydney.
 *
 *   Week   Monday to Sunday, Sydney time. A week is named by its Monday, "YYYY-MM-DD".
 *   Lock   5pm Sydney on the Tuesday after the week ends (8 days after its Monday).
 *          Until then the week keeps filling in automatically; after it, changes are
 *          overrides with a reason. The lock is worked out from the clock, not a timer.
 *
 * Daylight saving is handled by asking Intl what the Sydney wall clock is, never by
 * assuming a fixed offset.
 */
const TZ = "Australia/Sydney";
const LOCK_HOUR = 17;          // 5pm
const LOCK_DAYS_AFTER_MONDAY = 8;

const fmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
});

/** Sydney wall-clock parts for an instant. */
function sydneyParts(date = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday), // 0 = Monday
  };
}

const pad = n => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Adds days to a "YYYY-MM-DD" calendar date (no time zone involved). */
function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Sydney calendar date of an instant, "YYYY-MM-DD". */
function sydneyDate(date = new Date()) {
  const p = sydneyParts(date);
  return ymd(p.year, p.month, p.day);
}

/** The Monday (Sydney) of the week containing this instant. */
function weekOf(date = new Date()) {
  const p = sydneyParts(date);
  return addDays(ymd(p.year, p.month, p.day), -p.weekday);
}

/** Validates and normalises a week id; must be a Monday. */
function parseWeek(id) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(id || ""))) return null;
  const [y, m, d] = id.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.getUTCDay() === 1 ? id : null;
}

/** The UTC instant of a Sydney wall-clock time (handles daylight saving). */
function sydneyToUtc(isoDate, hour = 0, minute = 0) {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Start from the same wall time read as UTC, then correct by Sydney's offset at that moment (twice, for DST edges).
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const p = sydneyParts(new Date(guess));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(y, m - 1, d, hour, minute) - shown;
  }
  return new Date(guess);
}

/** When a week locks: 5pm Sydney on the Tuesday after it ends. */
function lockAt(weekId) {
  return sydneyToUtc(addDays(weekId, LOCK_DAYS_AFTER_MONDAY), LOCK_HOUR, 0);
}

const isLocked = (weekId, now = new Date()) => now.getTime() >= lockAt(weekId).getTime();

/** Summary used by the API and the Scorecard. */
function weekInfo(weekId, now = new Date()) {
  return {
    week: weekId,
    start: weekId,
    end: addDays(weekId, 6),
    lockAt: lockAt(weekId).toISOString(),
    locked: isLocked(weekId, now),
    current: weekOf(now) === weekId,
  };
}

/** The week the Tuesday L10 reviews: the one that ended most recently. */
const reviewWeek = (now = new Date()) => addDays(weekOf(now), -7);

module.exports = { TZ, sydneyParts, sydneyDate, addDays, weekOf, parseWeek, sydneyToUtc, lockAt, isLocked, weekInfo, reviewWeek };

/* ---------------- Australian financial year (D19) ----------------
   FY27 = 1 July 2026 to 30 June 2027. Q1 Jul–Sep, Q2 Oct–Dec, Q3 Jan–Mar, Q4 Apr–Jun. */

/** Financial year (e.g. 2027) and quarter (1–4) of a Sydney calendar date "YYYY-MM-DD" or an instant. */
function fyOf(dateOrIso = new Date()) {
  const iso = typeof dateOrIso === "string" ? dateOrIso : sydneyDate(dateOrIso);
  const [y, m] = iso.split("-").map(Number);
  return { fy: m >= 7 ? y + 1 : y, quarter: Math.floor(((m + 5) % 12) / 3) + 1 };
}

/** First and last calendar day of a financial year, or of one quarter of it. */
function fyRange(fy, quarter) {
  if (!quarter) return { start: `${fy - 1}-07-01`, end: `${fy}-06-30` };
  const startMonth = [7, 10, 1, 4][quarter - 1];
  const year = quarter <= 2 ? fy - 1 : fy;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonthFirst = addMonths(start, 3);
  return { start, end: addDays(endMonthFirst, -1) };
}

/** Adds whole months to the first of a month, "YYYY-MM-01". */
function addMonths(isoFirst, n) {
  const [y, m] = isoFirst.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The 12 months of a financial year, as "YYYY-MM-01". */
const fyMonths = fy => Array.from({ length: 12 }, (_, i) => addMonths(`${fy - 1}-07-01`, i));

/** How far through a date range we are (0–1), by Sydney calendar days. */
function elapsed(range, now = new Date()) {
  const today = sydneyDate(now);
  if (today < range.start) return 0;
  if (today > range.end) return 1;
  const day = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  return (day(today) - day(range.start) + 1) / (day(range.end) - day(range.start) + 1);
}

/** "FY27 Q2" */
const fyLabel = (fy, quarter) => `FY${String(fy).slice(-2)}${quarter ? ` Q${quarter}` : ""}`;

Object.assign(module.exports, { fyOf, fyRange, fyMonths, addMonths, elapsed, fyLabel });
