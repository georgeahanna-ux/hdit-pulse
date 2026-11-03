"use strict";
/**
 * Scorecard collectors (M2). Every hour the sync app works out the automatic value of each
 * measurable that has a collector, for:
 *   - the current week and the week under review until it locks (5pm Tuesday);
 *   - up to 12 earlier weeks that have no automatic value yet (a one-off fill, so the trial
 *     has history to compare against).
 * A locked week's automatic value is never changed once it has one.
 *
 * Values are written whether or not the measurable is switched to automatic: while it isn't
 * (trial, "shadow mode") the Scorecard shows the entered value and the automatic one beside it.
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const autotask = require("./autotask");

const SOURCES = { autotask: { collectWeek: autotask.collectWeek, cred: autotask.CRED } };
const BACKFILL_WEEKS = 12;

async function collectors() {
  return db.query("SELECT id, code, collector, auto_enabled FROM pulse.measurable WHERE is_active = 1 AND collector IS NOT NULL");
}

/** Which weeks to work out for these measurables. */
async function weeksToRun(ms, now = new Date()) {
  const current = time.weekOf(now);
  const weeks = new Set([current]);
  const review = time.addDays(current, -7);
  if (!time.isLocked(review, now)) weeks.add(review);
  const from = time.addDays(current, -7 * BACKFILL_WEEKS);
  const have = ms.length ? await db.query(
    `SELECT week, COUNT(*) AS n FROM pulse.scorecard_value
      WHERE week >= @from AND auto_value IS NOT NULL AND measurable_id IN (${ms.map((_, i) => "@m" + i).join(",")})
      GROUP BY week`, { from, ...Object.fromEntries(ms.map((m, i) => ["m" + i, m.id])) }) : [];
  const full = new Set(have.filter(r => r.n >= ms.length).map(r => new Date(r.week).toISOString().slice(0, 10)));
  for (let i = 2; i <= BACKFILL_WEEKS; i++) {
    const w = time.addDays(current, -7 * i);
    if (!full.has(w)) weeks.add(w);
  }
  return [...weeks].sort();
}

/** Saves one automatic value, leaving the row alone if nothing changed or the week is locked and already filled. */
async function save(measurableId, week, result, locked) {
  const detail = JSON.stringify(result.detail || {}).slice(0, 2000);
  await db.query(
    `MERGE pulse.scorecard_value AS t USING (SELECT @id AS measurable_id, @week AS week) AS s
       ON t.measurable_id = s.measurable_id AND t.week = s.week
     WHEN MATCHED AND NOT (@locked = 1 AND t.auto_value IS NOT NULL)
          AND (ISNULL(t.auto_value, -999999) <> ISNULL(@value, -999999) OR ISNULL(t.auto_detail, N'') <> @detail)
       THEN UPDATE SET auto_value = @value, auto_detail = @detail, auto_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (measurable_id, week, auto_value, auto_detail, auto_at)
          VALUES (@id, @week, @value, @detail, SYSUTCDATETIME());`,
    { id: measurableId, week, value: result.value, detail, locked: locked ? 1 : 0 });
}

/**
 * Runs every collector whose credential has been entered. isConnected(cred) → boolean.
 * Returns a one-line summary for the sync log.
 */
async function runScorecard({ isConnected, now = new Date() } = {}) {
  const ms = await collectors();
  if (!ms.length) return "No measurables have collectors.";
  const bySource = {};
  for (const m of ms) (bySource[m.collector.split(".")[0]] ||= []).push(m);

  const notes = [];
  for (const [source, list] of Object.entries(bySource)) {
    const src = SOURCES[source];
    if (!src) { notes.push(`${source}: no collector yet`); continue; }
    if (isConnected && !(await isConnected(src.cred))) { notes.push(`${source}: ${src.cred} not entered yet`); continue; }
    const weeks = await weeksToRun(list, now);
    const cache = {};
    let saved = 0;
    for (const week of weeks) {
      const values = await src.collectWeek(week, cache, now);
      const locked = time.isLocked(week, now);
      for (const m of list) {
        if (!values[m.collector]) continue;
        await save(m.id, week, values[m.collector], locked);
        saved++;
      }
    }
    notes.push(`${source}: ${list.length} measurables × ${weeks.length} weeks (${weeks[0]} to ${weeks[weeks.length - 1]}), ${saved} values`);
  }
  return notes.join("; ");
}

module.exports = { runScorecard, weeksToRun, BACKFILL_WEEKS };
