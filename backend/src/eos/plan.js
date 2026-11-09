"use strict";
/**
 * Annual plan (D19): FY progress bars with quarter sub-bars for the leadership home page.
 *   GET /plan?fy=2027                                  progress for each metric
 *   PUT /plan/metrics/:id            { annualTarget, openingValue }          (leadership)
 *   PUT /plan/metrics/:id/quarters/:q { target }                             (leadership, Finance)
 *   PUT /plan/metrics/:id/months/:month { value, reason }                     (leadership, Finance)
 *       month = YYYY-MM. Changing a figure that's already there needs a reason.
 *   POST /plan/metrics/:id/automatic { enabled, reason }                     (leadership, Finance) trial → automatic
 * Who sees it: Leadership, Finance & Accounts, and Finance detail.
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const L = require("./logic");
const C = require("./common");

const canSee = a => a.leadership || a.financeDetail || a.ownDivisions.includes("Finance");
const canEnter = a => a.leadership || a.ownDivisions.includes("Finance");

async function get(ctx) {
  const fy = Number(ctx.query.fy) || time.fyOf().fy;
  const metrics = await db.query("SELECT * FROM pulse.plan_metric WHERE fy = @fy ORDER BY sort, id", { fy });
  const visible = metrics.filter(m => !m.restricted || ctx.access.financeDetail);
  if (!visible.length) return { fy, label: time.fyLabel(fy), metrics: [], canEditTargets: ctx.access.leadership, canEnter: canEnter(ctx.access) };
  const ids = Object.fromEntries(visible.map((m, i) => ["m" + i, m.id]));
  const inList = visible.map((_, i) => "@m" + i).join(",");
  const [quarters, months] = await Promise.all([
    db.query(`SELECT metric_id, quarter, target FROM pulse.plan_quarter_target WHERE metric_id IN (${inList})`, ids),
    db.query(`SELECT metric_id, month, auto_value, auto_detail, entered_value, entered_by, entered_at FROM pulse.plan_month_actual WHERE metric_id IN (${inList})`, ids),
  ]);
  return {
    fy, label: time.fyLabel(fy), range: time.fyRange(fy), current: time.fyOf(),
    canEditTargets: ctx.access.leadership, canEnter: canEnter(ctx.access),
    metrics: visible.map(m => ({
      ...L.planProgress(m, quarters.filter(q => q.metric_id === m.id), months.filter(x => x.metric_id === m.id)),
      source: m.source, collector: m.collector || null, automatic: !!m.auto_enabled, trial: !!m.collector && !m.auto_enabled,
      autoChanged: m.auto_changed_at ? { by: m.auto_changed_by, at: m.auto_changed_at } : null,
    })),
  };
}

async function loadMetric(ctx) {
  const id = C.int(ctx.params.id, "Metric");
  const [m] = await db.query("SELECT * FROM pulse.plan_metric WHERE id = @id", { id });
  if (!m || (m.restricted && !ctx.access.financeDetail)) throw C.fail(404, "That plan metric doesn't exist.");
  return m;
}

function amount(v, label) {
  if (v === null || v === "" || v === undefined) return null;
  const n = L.parseNumber(v);
  if (n === null || n < 0) throw C.fail(400, `${label} must be a number of zero or more.`);
  return n;
}

async function putMetric(ctx) {
  const m = await loadMetric(ctx);
  const f = {};
  if ("annualTarget" in ctx.body) f.annual_target = amount(ctx.body.annualTarget, "The annual target");
  if ("openingValue" in ctx.body) f.opening_value = amount(ctx.body.openingValue, "The opening value");
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true };
  await db.query(`UPDATE pulse.plan_metric SET ${keys.map(k => `${k} = @${k}`).join(", ")} WHERE id = @id`, { id: m.id, ...f });
  await C.record(ctx, "plan.target", { type: "plan", id: `${m.code}@FY${m.fy}` }, Object.fromEntries(keys.map(k => [k, m[k]])), f);
  return { ok: true };
}

async function putQuarter(ctx) {
  const m = await loadMetric(ctx);
  const q = Number(ctx.params.q);
  if (![1, 2, 3, 4].includes(q)) throw C.fail(400, "Quarter is 1 to 4.");
  const target = amount(ctx.body.target, "The quarter target");
  const [before] = await db.query("SELECT target FROM pulse.plan_quarter_target WHERE metric_id = @id AND quarter = @q", { id: m.id, q });
  await db.query(
    `MERGE pulse.plan_quarter_target AS t USING (SELECT @id AS metric_id, @q AS quarter) AS s
       ON t.metric_id = s.metric_id AND t.quarter = s.quarter
     WHEN MATCHED THEN UPDATE SET target = @target, updated_by = @by
     WHEN NOT MATCHED THEN INSERT (metric_id, quarter, target, updated_by) VALUES (@id, @q, @target, @by);`,
    { id: m.id, q, target, by: ctx.person.name });
  await C.record(ctx, "plan.quarter", { type: "plan", id: `${m.code}@${time.fyLabel(m.fy, q)}` }, { target: before ? before.target : null }, { target });
  return { ok: true };
}

async function putMonth(ctx) {
  const m = await loadMetric(ctx);
  const ym = String(ctx.params.month);
  if (!/^\d{4}-\d{2}$/.test(ym)) throw C.fail(400, "Month is YYYY-MM.");
  const month = `${ym}-01`;
  if (!time.fyMonths(m.fy).includes(month)) throw C.fail(400, `That month isn't in ${time.fyLabel(m.fy)}.`);
  if (month > time.sydneyDate()) throw C.fail(400, "That month hasn't started yet.");
  const value = amount(ctx.body.value, "The figure");
  const [before] = await db.query("SELECT entered_value, auto_value FROM pulse.plan_month_actual WHERE metric_id = @id AND month = @month", { id: m.id, month });
  const had = before && (before.entered_value !== null || before.auto_value !== null);
  const why = had ? C.reason(ctx.body.reason) : (ctx.body.reason ? String(ctx.body.reason).slice(0, 1000) : null);
  await db.query(
    `MERGE pulse.plan_month_actual AS t USING (SELECT @id AS metric_id, @month AS month) AS s
       ON t.metric_id = s.metric_id AND t.month = s.month
     WHEN MATCHED THEN UPDATE SET entered_value = @value, entered_by = @by, entered_at = SYSUTCDATETIME(), reason = @why
     WHEN NOT MATCHED THEN INSERT (metric_id, month, entered_value, entered_by, entered_at, reason) VALUES (@id, @month, @value, @by, SYSUTCDATETIME(), @why);`,
    { id: m.id, month, value, by: ctx.person.name, why });
  await C.record(ctx, "plan.month", { type: "plan", id: `${m.code}@${ym}` },
    before ? { entered: before.entered_value, auto: before.auto_value } : null, { entered: value }, why);
  return { ok: true };
}

/** Leadership or Finance switch a plan metric from trial to automatic (or back), with a reason. */
async function setAutomatic(ctx) {
  const m = await loadMetric(ctx);
  if (!m.collector) throw C.fail(409, "This figure has no automatic source yet, so Finance enters it.");
  const enabled = ctx.body.enabled === true;
  const why = C.reason(ctx.body.reason);
  if (!!m.auto_enabled === enabled) return { ok: true, automatic: enabled };
  await db.query("UPDATE pulse.plan_metric SET auto_enabled = @enabled, auto_changed_by = @name, auto_changed_at = SYSUTCDATETIME() WHERE id = @id",
    { id: m.id, enabled, name: ctx.person.name });
  await C.record(ctx, "plan.automatic", { type: "plan_metric", id: `${m.code}@FY${m.fy}` }, { automatic: !!m.auto_enabled }, { automatic: enabled }, why);
  return { ok: true, automatic: enabled };
}

const routes = [
  { method: "GET", path: "/plan", auth: "person", allow: canSee, fn: get },
  { method: "PUT", path: "/plan/metrics/:id", auth: "person", allow: a => a.leadership, fn: putMetric },
  { method: "PUT", path: "/plan/metrics/:id/quarters/:q", auth: "person", allow: canEnter, fn: putQuarter },
  { method: "PUT", path: "/plan/metrics/:id/months/:month", auth: "person", allow: canEnter, fn: putMonth },
  { method: "POST", path: "/plan/metrics/:id/automatic", auth: "person", allow: canEnter, fn: setAutomatic },
];
module.exports = { routes, _test: { canSee, canEnter } };
