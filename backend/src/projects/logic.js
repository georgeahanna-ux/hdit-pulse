"use strict";
/**
 * Projects (D21): scheduling maths on plain data, shared by the API and tests.
 * Dates are Sydney calendar days, "YYYY-MM-DD". Working days are Monday to Friday less holidays.
 */
const time = require("../lib/time");

const toDay = v => (v ? time.sydneyDate(new Date(v)) : null);
const dow = d => new Date(d + "T00:00:00Z").getUTCDay();
const isWorkday = (d, hol) => dow(d) !== 0 && dow(d) !== 6 && !(hol && hol.has(d));

/** Working days from a to b inclusive (0 if b < a). */
function workdays(a, b, hol) {
  if (!a || !b || b < a) return 0;
  let n = 0;
  for (let d = a; d <= b; d = time.addDays(d, 1)) if (isWorkday(d, hol)) n++;
  return n;
}

/** Moves a day by n working days (n may be negative); lands on a working day. */
function addWorkdays(d, n, hol) {
  let cur = d;
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) { cur = time.addDays(cur, step); if (isWorkday(cur, hol)) left--; }
  return cur;
}
/** The working day on or after d. */
const nextWorkday = (d, hol) => { let c = d; while (!isWorkday(c, hol)) c = time.addDays(c, 1); return c; };

/** Signed working-day difference from a to b (b later → positive). */
function workdayDelta(a, b, hol) {
  if (a === b) return 0;
  return b > a ? workdays(time.addDays(a, 1), b, hol) : -workdays(time.addDays(b, 1), a, hol);
}

/** How complete: by hours where Autotask has them, else by tasks done. */
function percentComplete(tasks) {
  const withHours = tasks.filter(t => t.remaining !== null || t.worked);
  const worked = withHours.reduce((s, t) => s + (t.worked || 0), 0);
  const remaining = withHours.reduce((s, t) => s + (t.complete ? 0 : Math.max(0, t.remaining ?? 0)), 0);
  if (worked + remaining > 0) return Math.round((100 * worked) / (worked + remaining));
  if (!tasks.length) return 0;
  return Math.round((100 * tasks.filter(t => t.complete).length) / tasks.length);
}

/**
 * Health (RAG) of a project or phase on a day:
 *   done      every task complete
 *   late      past its end date and not done
 *   at-risk   a task is overdue, or progress trails time elapsed by more than 15 points
 *   on-track  otherwise (and "not-started" before its start)
 */
function health({ start, end, pct, tasks }, today) {
  if (tasks.length && tasks.every(t => t.complete)) return "done";
  if (end && end < today) return "late";
  if (start && start > today) return "not-started";
  const overdue = tasks.filter(t => !t.complete && t.end && t.end < today).length;
  const span = start && end ? Math.max(1, workdays(start, end)) : null;
  const elapsed = span ? Math.min(100, Math.round((100 * workdays(start, today)) / span)) : null;
  if (overdue || (elapsed !== null && pct + 15 < elapsed)) return "at-risk";
  return "on-track";
}

/**
 * Float and critical path from dependencies. A task's latest finish is the day before its
 * earliest successor must start (less lag), or the project's finish. Float = working days
 * between its finish and that latest finish. Critical = no float (and not complete).
 */
function floatAndCritical(tasks, preds, hol) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const succOf = new Map();
  for (const p of preds) if (byId.has(p.pred) && byId.has(p.succ)) (succOf.get(p.pred) || succOf.set(p.pred, []).get(p.pred)).push(p);
  const finish = tasks.reduce((m, t) => (t.end && (!m || t.end > m) ? t.end : m), null);
  const lf = new Map();
  const visiting = new Set();
  const latest = id => {
    if (lf.has(id)) return lf.get(id);
    if (visiting.has(id)) return finish;   // a loop in the dependencies: stop here
    visiting.add(id);
    let v = finish;
    for (const p of succOf.get(id) || []) {
      const s = byId.get(p.succ);
      if (!s.start) continue;
      const sLatestStart = addWorkdays(latest(s.id), -(Math.max(0, workdays(s.start, s.end, hol) - 1)), hol);
      const mustEnd = addWorkdays(sLatestStart, -(1 + (p.lag || 0)), hol);
      if (mustEnd < v) v = mustEnd;
    }
    visiting.delete(id);
    lf.set(id, v);
    return v;
  };
  const out = new Map();
  for (const t of tasks) {
    if (!t.end) { out.set(t.id, { float: null, critical: false }); continue; }
    const f = workdayDelta(t.end, latest(t.id), hol);
    out.set(t.id, { float: f, critical: !t.complete && f <= 0 });
  }
  return out;
}

/**
 * Rescheduling with dependencies (D21), "keep the gaps":
 *   - when a task's END moves by n working days, its successors (and theirs) move by n;
 *   - when a task's START moves by n working days, its predecessors (and theirs) move by n.
 * A move of the whole bar changes both, so both chains move. Complete tasks never move.
 * Returns [{ id, start, end, from: {start, end}, because }] for every task that changes.
 */
function reschedule(tasks, preds, { id, start, end }, hol) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const t0 = byId.get(id);
  if (!t0 || !t0.start || !t0.end) throw new Error("That task has no dates to move.");
  if (end < start) throw new Error("A task can't end before it starts.");
  const dEnd = workdayDelta(t0.end, end, hol), dStart = workdayDelta(t0.start, start, hol);
  const changes = new Map([[id, { id, start, end, from: { start: t0.start, end: t0.end }, because: null }]]);
  const succ = new Map(), pred = new Map();
  for (const p of preds) {
    (succ.get(p.pred) || succ.set(p.pred, []).get(p.pred)).push(p.succ);
    (pred.get(p.succ) || pred.set(p.succ, []).get(p.succ)).push(p.pred);
  }
  const shift = (startId, links, delta) => {
    if (!delta) return;
    const queue = [...(links.get(startId) || [])].map(x => [x, startId]);
    const seen = new Set([id]);
    while (queue.length) {
      const [tid, via] = queue.shift();
      if (seen.has(tid)) continue;
      seen.add(tid);
      const t = byId.get(tid);
      if (!t || t.complete || !t.start || !t.end) continue;
      if (!changes.has(tid)) changes.set(tid, {
        id: tid, start: addWorkdays(nextWorkday(t.start, hol), delta, hol), end: addWorkdays(nextWorkday(t.end, hol), delta, hol),
        from: { start: t.start, end: t.end }, because: via,
      });
      for (const nxt of links.get(tid) || []) queue.push([nxt, tid]);
    }
  };
  shift(id, succ, dEnd);
  shift(id, pred, dStart);
  return [...changes.values()];
}

module.exports = { toDay, isWorkday, workdays, addWorkdays, nextWorkday, workdayDelta, percentComplete, health, floatAndCritical, reschedule };
