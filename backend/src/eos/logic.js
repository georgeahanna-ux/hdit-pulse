"use strict";
/**
 * Pure EOS rules (no database), so they can be tested on their own.
 *   - which Scorecard value is shown, and whether it's on target
 *   - when a value can be entered and when it must be an override with a reason
 *   - annual plan progress for the leadership progress bars (D19)
 */
const time = require("../lib/time");

const MIN_REASON = 5;

/** The value shown for a Scorecard cell, and where it came from. */
/** autoOn: the measurable is switched to automatic. While it isn't (trial), the automatic value is never shown. */
function shownValue(row, autoOn = true) {
  if (!row) return { value: null, source: null };
  if (row.is_overridden) return { value: num(row.override_value), source: "override" };
  if (row.entered_value !== null && row.entered_value !== undefined) return { value: num(row.entered_value), source: "entered" };
  if (autoOn && row.auto_value !== null && row.auto_value !== undefined) return { value: num(row.auto_value), source: "auto" };
  return { value: null, source: null };
}

/** true / false against the goal, or null when there's no number or no numeric goal. */
function onTarget(measurable, value) {
  if (value === null || value === undefined || measurable.goal_value === null || measurable.goal_value === undefined) return null;
  const goal = Number(measurable.goal_value);
  return measurable.direction === "lower" ? Number(value) <= goal : Number(value) >= goal;
}

/**
 * What a person may do to one Scorecard cell.
 *   enter    type a value with no reason: manual measurable, week not yet locked
 *   override replace the shown value with a reason: automatic measurable, or a locked week
 *   revert   remove an override, with a reason
 * `allowed` is the override rule from access.canOverride (leadership any; staff own division).
 */
function cellActions({ allowed, measurable, locked, row }) {
  if (!allowed) return { enter: false, override: false, revert: false };
  const manual = !measurable.auto_enabled;
  const overridden = !!(row && row.is_overridden);
  return {
    enter: manual && !locked && !overridden,
    override: !manual || locked || overridden,
    revert: overridden,
  };
}

function requireReason(reason) {
  const r = String(reason || "").trim();
  return r.length >= MIN_REASON ? r : null;
}

const num = v => (v === null || v === undefined || v === "" ? null : Number(v));

/** Parses a number typed by a person ("1,234.5", "$9.2", "45%"). Returns null if it isn't one. */
function parseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[$,%\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 1e14 ? n : null;
}

/* ---------------------------------------------------------------------------
   Annual plan progress (D19)
     cumulative (revenue, new seats): year to date = sum of month-end actuals
       year bar     = YTD ÷ annual target
       quarter bar  = that quarter's sum ÷ that quarter's target
     level (MRR, seats): current = latest month-end figure
       year bar     = (current − opening) ÷ (target − opening) when the opening level is known,
                      otherwise current ÷ target
       quarter bar  = level at the quarter's last reported month ÷ that quarter's target
   Each bar also carries "time elapsed" so the page can show whether we're on pace.
   --------------------------------------------------------------------------- */
function monthValue(m) {
  if (!m) return null;
  if (m.entered_value !== null && m.entered_value !== undefined) return Number(m.entered_value);
  if (m.auto_value !== null && m.auto_value !== undefined) return Number(m.auto_value);
  return null;
}

const ratio = (a, b) => (a === null || b === null || b === undefined || Number(b) === 0 ? null : a / Number(b));

function planProgress(metric, quarterTargets, monthRows, now = new Date()) {
  const fy = Number(metric.fy);
  const months = time.fyMonths(fy);
  const byMonth = new Map(monthRows.map(r => [isoDay(r.month), r]));
  const monthly = months.map(m => ({ month: m, value: monthValue(byMonth.get(m)), entered: !!(byMonth.get(m) && byMonth.get(m).entered_value != null) }));
  const target = metric.annual_target === null || metric.annual_target === undefined ? null : Number(metric.annual_target);
  const opening = metric.opening_value === null || metric.opening_value === undefined ? null : Number(metric.opening_value);
  const reported = monthly.filter(m => m.value !== null);
  const last = reported.length ? reported[reported.length - 1] : null;

  let actual = null, progress = null;
  if (metric.kind === "cumulative") {
    actual = reported.length ? reported.reduce((s, m) => s + m.value, 0) : null;
    progress = ratio(actual, target);
  } else {
    actual = last ? last.value : null;
    if (actual !== null && target !== null) {
      progress = opening !== null && target !== opening ? (actual - opening) / (target - opening) : actual / target;
    }
  }

  const quarters = [1, 2, 3, 4].map(q => {
    const range = time.fyRange(fy, q);
    const qMonths = monthly.filter(m => m.month >= range.start && m.month <= range.end);
    const qReported = qMonths.filter(m => m.value !== null);
    const qt = quarterTargets.find(t => Number(t.quarter) === q);
    const qTarget = qt && qt.target !== null && qt.target !== undefined ? Number(qt.target) : null;
    let qActual = null;
    if (metric.kind === "cumulative") qActual = qReported.length ? qReported.reduce((s, m) => s + m.value, 0) : null;
    else qActual = qReported.length ? qReported[qReported.length - 1].value : null;
    return {
      quarter: q, label: time.fyLabel(fy, q), start: range.start, end: range.end,
      target: qTarget, actual: qActual, progress: ratio(qActual, qTarget),
      elapsed: round(time.elapsed(range, now)), monthsReported: qReported.length,
    };
  });

  const quarterSum = quarters.every(q => q.target !== null) ? quarters.reduce((s, q) => s + q.target, 0) : null;
  return {
    id: metric.id, code: metric.code, name: metric.name, unit: metric.unit, kind: metric.kind, fy, label: time.fyLabel(fy),
    target, opening, actual, progress: progress === null ? null : round(progress),
    elapsed: round(time.elapsed(time.fyRange(fy), now)),
    lastMonth: last ? last.month : null,
    quarters: quarters.map(q => ({ ...q, progress: q.progress === null ? null : round(q.progress) })),
    months: monthly,
    // For cumulative metrics, quarter targets should add up to the year. Flag it when they don't.
    quarterTargetsTotal: quarterSum,
    quarterTargetsMismatch: metric.kind === "cumulative" && quarterSum !== null && target !== null && Math.abs(quarterSum - target) > 0.5,
  };
}

const round = x => Math.round(x * 10000) / 10000;
const isoDay = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

module.exports = { shownValue, onTarget, cellActions, requireReason, parseNumber, planProgress, MIN_REASON, isoDay };
