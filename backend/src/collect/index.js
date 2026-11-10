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
const contracts = require("./contracts");

const xero = require("./xero");
const simplesat = require("./simplesat");
const mroi = require("./mroi");
const SOURCES = {
  // Apps inside Pulse (D9): no credential, Pulse signs in with its managed identity (Pulse.Collector).
  mroi: { collectWeek: mroi.collectWeek, cred: null },
  simplesat: { collectWeek: simplesat.collectWeek, cred: simplesat.CRED },
  autotask: { collectWeek: autotask.collectWeek, cred: autotask.CRED },
  // Xero: one session per run (renews the token once and saves the new refresh token).
  xero: { collectWeek: xero.collectWeek, cred: "xero-token", open: async cache => { cache.xero = await require("../lib/xero").session(); } },
};
const BACKFILL_WEEKS = 12;
// Readings of "now" that can't be worked out for past weeks: they never count towards a week being full.
const SNAPSHOT = new Set(["autotask.weighted_pipeline"]);

async function collectors() {
  return db.query("SELECT id, code, collector, auto_enabled FROM pulse.measurable WHERE is_active = 1 AND collector IS NOT NULL");
}

/** Which weeks to work out for these measurables. */
async function weeksToRun(all, now = new Date()) {
  const ms = all.filter(m => !SNAPSHOT.has(m.collector));
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
       THEN UPDATE SET auto_value = @value, auto_detail = @detail, auto_at = SYSUTCDATETIME(), provisional = @provisional
     WHEN NOT MATCHED THEN INSERT (measurable_id, week, auto_value, auto_detail, auto_at, provisional)
          VALUES (@id, @week, @value, @detail, SYSUTCDATETIME(), @provisional);`,
    { id: measurableId, week, value: result.value, detail, locked: locked ? 1 : 0, provisional: result.provisional ? 1 : 0 });
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
  const failed = [];
  for (const [source, list] of Object.entries(bySource)) {
    const src = SOURCES[source];
    if (!src) { notes.push(`${source}: no collector yet`); continue; }
    if (src.cred && isConnected && !(await isConnected(src.cred))) { notes.push(`${source}: ${src.cred} not entered yet`); continue; }
    try {
    const weeks = await weeksToRun(list, now);
    const fyStart = time.fyRange(time.fyOf(now).fy).start;
    const cache = { from: [weeks[0], time.addDays(fyStart, -1)].sort()[0], today: time.sydneyDate(now) };
    if (src.open) await src.open(cache);
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
    if (source === "autotask") notes.push(await runPlan(cache, now));
    if (source === "xero") notes.push(await runPlanXero(cache, now));
    if (cache.notes) notes.push(...cache.notes);
    } catch (e) {
      // One source failing doesn't stop the others; the run is still marked failed so it shows.
      failed.push(`${source}: ${e.message}`);
      if (source === "xero") await db.query("UPDATE pulse.connection_status SET last_error = @e, last_checked_at = SYSUTCDATETIME() WHERE name = N'xero-token'", { e: String(e.message).slice(0, 500) }).catch(() => {});
    }
  }
  if (failed.length) throw new Error([...failed, ...notes].join("; "));
  return notes.join("; ");
}

/**
 * FY plan month-end actuals (D19) for plan metrics with a collector: every month of the current
 * FY up to this one. The current and previous month are always refreshed; earlier months only
 * fill in once. Shown only once the metric is switched to automatic (trial first, as for measurables).
 */
async function runPlan(cache, now = new Date()) {
  const { fy } = time.fyOf(now);
  const metrics = await db.query("SELECT id, code, collector FROM pulse.plan_metric WHERE fy = @fy AND collector LIKE N'autotask.%'", { fy });
  if (!metrics.length || cache.contractsFailed) return "plan: nothing to do";
  const today = cache.today;
  const thisMonth = today.slice(0, 7) + "-01";
  const months = time.fyMonths(fy).filter(m => m <= thisMonth);
  const have = await db.query(`SELECT metric_id, month FROM pulse.plan_month_actual WHERE auto_value IS NOT NULL AND metric_id IN (${metrics.map((_, i) => "@m" + i).join(",")})`,
    Object.fromEntries(metrics.map((m, i) => ["m" + i, m.id])));
  const filled = new Set(have.map(h => `${h.metric_id}|${new Date(h.month).toISOString().slice(0, 10)}`));
  const data = await contracts.load(cache, cache.from, today);
  const wins = metrics.some(m => m.collector === "autotask.new_seats") ? await contracts.loadWins(cache, cache.from, today) : null;
  let saved = 0;
  for (const month of months) {
    const last = [time.addDays(time.addMonths(month, 1), -1), today].sort()[0];
    const recent = month >= time.addMonths(thisMonth, -1);
    const levels = levelsCache(cache, last, data);
    for (const m of metrics) {
      if (!recent && filled.has(`${m.id}|${month}`)) continue;
      const r = m.collector === "autotask.mrr" ? levels.mrr : m.collector === "autotask.seats" ? levels.seats
        : m.collector === "autotask.new_seats" && wins ? contracts.newSeatsBetween(month, last, wins) : null;
      if (!r) continue;
      await db.query(
        `MERGE pulse.plan_month_actual AS t USING (SELECT @id AS metric_id, @month AS month) AS s
           ON t.metric_id = s.metric_id AND t.month = s.month
         WHEN MATCHED AND (ISNULL(t.auto_value, -999999) <> ISNULL(@value, -999999) OR ISNULL(t.auto_detail, N'') <> @detail)
           THEN UPDATE SET auto_value = @value, auto_detail = @detail, auto_at = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (metric_id, month, auto_value, auto_detail, auto_at) VALUES (@id, @month, @value, @detail, SYSUTCDATETIME());`,
        { id: m.id, month, value: r.value, detail: JSON.stringify(r.detail).slice(0, 2000) });
      saved++;
    }
  }
  return `plan: ${metrics.length} metrics × ${months.length} months, ${saved} values`;
}

/** FY plan revenue from Xero: each month of the FY so far (current and previous always; earlier once). */
async function runPlanXero(cache, now = new Date()) {
  const { fy } = time.fyOf(now);
  const metrics = await db.query("SELECT id, code, collector FROM pulse.plan_metric WHERE fy = @fy AND collector LIKE N'xero.%'", { fy });
  if (!metrics.length) return "xero plan: nothing to do";
  const today = cache.today, thisMonth = today.slice(0, 7) + "-01";
  const months = time.fyMonths(fy).filter(m => m <= thisMonth);
  const have = await db.query(`SELECT metric_id, month FROM pulse.plan_month_actual WHERE auto_value IS NOT NULL AND metric_id IN (${metrics.map((_, i) => "@m" + i).join(",")})`,
    Object.fromEntries(metrics.map((m, i) => ["m" + i, m.id])));
  const filled = new Set(have.map(h => `${h.metric_id}|${new Date(h.month).toISOString().slice(0, 10)}`));
  let saved = 0;
  for (const month of months) {
    const last = [time.addDays(time.addMonths(month, 1), -1), today].sort()[0];
    const recent = month >= time.addMonths(thisMonth, -1);
    for (const m of metrics) {
      if (m.collector !== "xero.revenue" || (!recent && filled.has(`${m.id}|${month}`))) continue;
      const r = await xero.revenueFor(month, last, cache);
      await db.query(
        `MERGE pulse.plan_month_actual AS t USING (SELECT @id AS metric_id, @month AS month) AS s ON t.metric_id = s.metric_id AND t.month = s.month
         WHEN MATCHED AND (ISNULL(t.auto_value, -999999) <> ISNULL(@value, -999999) OR ISNULL(t.auto_detail, N'') <> @detail)
           THEN UPDATE SET auto_value = @value, auto_detail = @detail, auto_at = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (metric_id, month, auto_value, auto_detail, auto_at) VALUES (@id, @month, @value, @detail, SYSUTCDATETIME());`,
        { id: m.id, month, value: r.value, detail: JSON.stringify(r.detail).slice(0, 2000) });
      saved++;
    }
  }
  return `xero plan: ${saved} months`;
}

function levelsCache(cache, d, data) {
  cache.levels ||= new Map();
  if (!cache.levels.has(d)) cache.levels.set(d, contracts.levelsOn(d, data));
  return cache.levels.get(d);
}

module.exports = { runScorecard, runPlan, weeksToRun, BACKFILL_WEEKS, SNAPSHOT };
