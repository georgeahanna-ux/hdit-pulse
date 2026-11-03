"use strict";
/**
 * Scorecard (D1, D4, D5).
 *   GET  /scorecard?weeks=13&end=YYYY-MM-DD&division=Code   measurables and weekly values
 *   POST /scorecard/enter     { measurableId, week, value }            manual value, unlocked week
 *   POST /scorecard/override  { measurableId, week, value, reason }    override with a reason
 *   POST /scorecard/revert    { measurableId, week, reason }           remove an override
 *   POST /measurables         (leadership) new measurable
 *   PATCH /measurables/:id    goal, owner, name, definition (leadership or the owner)
 *   POST /measurables/:id/automatic { enabled, reason }   (leadership) switch from trial to automatic, or back
 *   POST /scorecard/refresh   (leadership) work out automatic values now
 */
const db = require("../lib/sql");
const time = require("../lib/time");
const access = require("../lib/access");
const L = require("./logic");
const C = require("./common");

const COLS = `m.id, m.code, m.name, m.scope, m.division_code, m.seat_id, m.owner_name, m.owner_email, m.unit, m.direction,
  m.goal_value, m.goal_text, m.frequency, m.source, m.auto_enabled, m.collector, m.auto_changed_by, m.auto_changed_at,
  m.definition, m.definition_version, m.restricted, m.sort`;

async function loadMeasurable(id) {
  const [m] = await db.query(`SELECT ${COLS} FROM pulse.measurable m WHERE m.id = @id AND m.is_active = 1`, { id });
  if (!m) throw C.fail(404, "That measurable doesn't exist.");
  return m;
}

/** Visible to this person? Company measurables: everyone. Division ones: that division and leadership. */
const visible = (ctx, m) => (!m.restricted || ctx.access.financeDetail) && (m.scope === "company" || C.seesDivision(ctx, m.division_code));

/** The override rule with the measurable's owner shape for access.canOverride. */
const allowed = (ctx, m) => access.canOverride(ctx.access, { division: m.division_code });

function describe(ctx, m) {
  return {
    id: m.id, code: m.code, name: m.name, scope: m.scope, division: m.division_code, seatId: m.seat_id,
    owner: { name: m.owner_name, email: m.owner_email, isMe: C.isMeHolder(ctx, { name: m.owner_name, email: m.owner_email }) },
    unit: m.unit, direction: m.direction, goal: m.goal_value === null ? null : Number(m.goal_value), goalText: m.goal_text,
    frequency: m.frequency, source: m.source, automatic: !!m.auto_enabled,
    collector: m.collector || null, trial: !!m.collector && !m.auto_enabled,
    autoChanged: m.auto_changed_at ? { by: m.auto_changed_by, at: m.auto_changed_at } : null, definition: m.definition, definitionVersion: m.definition_version,
    canOverride: allowed(ctx, m),
    canEdit: ctx.access.leadership || C.isMeHolder(ctx, { name: m.owner_name, email: m.owner_email }),
  };
}

async function getScorecard(ctx) {
  const q = ctx.query;
  const weeks = Math.max(1, Math.min(26, Number(q.weeks) || 13));
  const end = q.end ? time.parseWeek(q.end) : time.weekOf();
  if (!end) throw C.fail(400, "A week is named by its Monday, e.g. 2026-11-02.");
  const divisionFilter = q.division ? C.division(q.division) : null;
  if (divisionFilter && !C.seesDivision(ctx, divisionFilter)) throw C.fail(403, "You don't have access to that division's Scorecard.");

  const weekIds = Array.from({ length: weeks }, (_, i) => time.addDays(end, -7 * (weeks - 1 - i)));
  const all = await db.query(`SELECT ${COLS} FROM pulse.measurable m WHERE m.is_active = 1 ORDER BY m.scope, m.sort, m.id`);
  const list = all.filter(m => visible(ctx, m) && (divisionFilter ? m.division_code === divisionFilter : m.scope === "company"));
  const rows = list.length ? await db.query(
    `SELECT measurable_id, week, auto_value, auto_at, auto_detail, provisional, entered_value, entered_by_name, entered_at,
            override_value, is_overridden, override_reason, override_by_name, override_at, note
       FROM pulse.scorecard_value
      WHERE week BETWEEN @from AND @to AND measurable_id IN (${list.map((_, i) => "@m" + i).join(",")})`,
    { from: weekIds[0], to: end, ...Object.fromEntries(list.map((m, i) => ["m" + i, m.id])) }) : [];
  const byKey = new Map(rows.map(r => [`${r.measurable_id}|${L.isoDay(r.week)}`, r]));
  const info = Object.fromEntries(weekIds.map(w => [w, time.weekInfo(w)]));

  const [last] = await db.query("SELECT MAX(finished_at) AS at FROM pulse.sync_run WHERE job = N'scorecard' AND ok = 1");
  return {
    weeks: weekIds.map(w => info[w]),
    collectedAt: last ? last.at : null,
    canRefresh: !!ctx.access.leadership,
    scope: divisionFilter ? { division: divisionFilter } : { company: true },
    measurables: list.map(m => {
      const d = describe(ctx, m);
      const cells = weekIds.map(w => {
        const r = byKey.get(`${m.id}|${w}`);
        const shown = L.shownValue(r, !!m.auto_enabled);
        const acts = L.cellActions({ allowed: d.canOverride, measurable: m, locked: info[w].locked, row: r });
        return {
          week: w, value: shown.value, source: shown.source, onTarget: L.onTarget(m, shown.value),
          auto: r && r.auto_value !== null ? Number(r.auto_value) : null, provisional: !!(r && r.provisional),
          autoDetail: r && r.auto_at ? { at: r.auto_at, text: detailText(r.auto_detail) } : null,
          entered: r && r.entered_value !== null ? { value: Number(r.entered_value), by: r.entered_by_name, at: r.entered_at } : null,
          override: r && r.is_overridden ? { value: Number(r.override_value), reason: r.override_reason, by: r.override_by_name, at: r.override_at } : null,
          actions: acts,
        };
      });
      return { ...d, cells };
    }),
  };
}

function detailText(json) {
  try { return JSON.parse(json || "{}").text || null; } catch { return null; }
}

async function loadCell(measurableId, week) {
  const [r] = await db.query("SELECT * FROM pulse.scorecard_value WHERE measurable_id = @id AND week = @week", { id: measurableId, week });
  return r || null;
}

async function prepare(ctx) {
  const id = C.int(ctx.body.measurableId, "Measurable");
  const week = time.parseWeek(ctx.body.week);
  if (!week) throw C.fail(400, "A week is named by its Monday, e.g. 2026-11-02.");
  if (week > time.weekOf()) throw C.fail(400, "That week hasn't started yet.");
  const m = await loadMeasurable(id);
  if (!visible(ctx, m)) throw C.fail(404, "That measurable doesn't exist.");
  if (!allowed(ctx, m)) throw C.fail(403, "Only Leadership and this measurable's division can change it.");
  const row = await loadCell(id, week);
  const acts = L.cellActions({ allowed: true, measurable: m, locked: time.isLocked(week), row });
  return { id, week, m, row, acts };
}

const snapshot = (r, m) => (r ? { shown: L.shownValue(r, !m || !!m.auto_enabled).value, auto: r.auto_value, entered: r.entered_value, override: r.is_overridden ? r.override_value : null } : null);

async function enter(ctx) {
  const { id, week, m, row, acts } = await prepare(ctx);
  if (!acts.enter) throw C.fail(409, time.isLocked(week)
    ? "This week has locked (5pm Tuesday after it ended). Use Override and give a reason."
    : "This measurable fills in automatically or has an override. Use Override and give a reason.");
  const clear = ctx.body.value === null || ctx.body.value === "";
  const value = clear ? null : L.parseNumber(ctx.body.value);
  if (!clear && value === null) throw C.fail(400, "Enter a number.");
  await db.query(
    `MERGE pulse.scorecard_value AS t USING (SELECT @id AS measurable_id, @week AS week) AS s
       ON t.measurable_id = s.measurable_id AND t.week = s.week
     WHEN MATCHED THEN UPDATE SET entered_value = @value, entered_by_oid = @oid, entered_by_name = @name, entered_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (measurable_id, week, entered_value, entered_by_oid, entered_by_name, entered_at)
          VALUES (@id, @week, @value, @oid, @name, SYSUTCDATETIME());`,
    { id, week, value, oid: ctx.person.oid, name: ctx.person.name });
  await C.record(ctx, "scorecard.enter", { type: "measurable", id: `${m.code}@${week}` }, snapshot(row, m), { entered: value });
  return { ok: true };
}

async function override(ctx) {
  const { id, week, m, row, acts } = await prepare(ctx);
  if (!acts.override) throw C.fail(409, "This week is still open: type the value in directly.");
  const value = L.parseNumber(ctx.body.value);
  if (value === null) throw C.fail(400, "Enter a number.");
  const why = C.reason(ctx.body.reason);
  await db.query(
    `MERGE pulse.scorecard_value AS t USING (SELECT @id AS measurable_id, @week AS week) AS s
       ON t.measurable_id = s.measurable_id AND t.week = s.week
     WHEN MATCHED THEN UPDATE SET override_value = @value, is_overridden = 1, override_reason = @why,
          override_by_oid = @oid, override_by_name = @name, override_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (measurable_id, week, override_value, is_overridden, override_reason, override_by_oid, override_by_name, override_at)
          VALUES (@id, @week, @value, 1, @why, @oid, @name, SYSUTCDATETIME());`,
    { id, week, value, why, oid: ctx.person.oid, name: ctx.person.name });
  await C.record(ctx, "scorecard.override", { type: "measurable", id: `${m.code}@${week}` }, snapshot(row, m), { override: value }, why);
  return { ok: true };
}

async function revert(ctx) {
  const { week, m, row, acts } = await prepare(ctx);
  if (!acts.revert) throw C.fail(409, "That week has no override to remove.");
  const why = C.reason(ctx.body.reason);
  await db.query(
    `UPDATE pulse.scorecard_value SET is_overridden = 0, override_value = NULL, override_reason = @why,
            override_by_oid = @oid, override_by_name = @name, override_at = SYSUTCDATETIME()
      WHERE measurable_id = @id AND week = @week`,
    { id: m.id, week, why, oid: ctx.person.oid, name: ctx.person.name });
  await C.record(ctx, "scorecard.revert", { type: "measurable", id: `${m.code}@${week}` }, snapshot(row, m), { override: null }, why);
  return { ok: true };
}

function fields(body, { creating }) {
  const out = {};
  if (creating || "name" in body) out.name = C.text(body.name, 150, { required: true, label: "Name" });
  if (creating || "division" in body) out.division_code = C.division(body.division);
  if (creating || "scope" in body) {
    if (!["company", "division"].includes(body.scope)) throw C.fail(400, "Scope is company or division.");
    out.scope = body.scope;
  }
  if (creating || "unit" in body) {
    if (!["count", "currency", "percent", "days", "ratio", "score"].includes(body.unit)) throw C.fail(400, "Choose a unit.");
    out.unit = body.unit;
  }
  if (creating || "direction" in body) {
    if (!["higher", "lower"].includes(body.direction)) throw C.fail(400, "Choose whether higher or lower is better.");
    out.direction = body.direction;
  }
  if ("goal" in body) {
    out.goal_value = body.goal === null || body.goal === "" ? null : L.parseNumber(body.goal);
    if (body.goal !== null && body.goal !== "" && out.goal_value === null) throw C.fail(400, "The goal must be a number.");
  }
  if ("goalText" in body) out.goal_text = C.text(body.goalText, 200);
  if ("ownerName" in body) out.owner_name = C.text(body.ownerName, 200);
  if ("ownerEmail" in body) out.owner_email = C.email(body.ownerEmail);
  if ("definition" in body) out.definition = C.text(body.definition, 4000);
  if ("frequency" in body) {
    if (!["weekly", "monthly"].includes(body.frequency)) throw C.fail(400, "Frequency is weekly or monthly.");
    out.frequency = body.frequency;
  }
  return out;
}

async function createMeasurable(ctx) {
  const f = fields(ctx.body, { creating: true });
  const code = String(ctx.body.code || f.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
  if (!code) throw C.fail(400, "Give the measurable a name.");
  const [exists] = await db.query("SELECT id FROM pulse.measurable WHERE code = @code", { code });
  if (exists) throw C.fail(409, "A measurable with that name already exists.");
  const [{ id }] = await db.query(
    `INSERT INTO pulse.measurable (code, name, scope, division_code, owner_name, owner_email, unit, direction, goal_value, goal_text, frequency, definition, sort)
     OUTPUT inserted.id
     VALUES (@code, @name, @scope, @division_code, @owner_name, @owner_email, @unit, @direction, @goal_value, @goal_text, @frequency, @definition,
             (SELECT ISNULL(MAX(sort), 0) + 1 FROM pulse.measurable))`,
    { code, owner_name: null, owner_email: null, goal_value: null, goal_text: null, frequency: "weekly", definition: null, ...f });
  await C.record(ctx, "measurable.create", { type: "measurable", id: code }, null, { ...f, code });
  return { id, code };
}

async function updateMeasurable(ctx) {
  const id = C.int(ctx.params.id);
  const m = await loadMeasurable(id);
  if (!visible(ctx, m)) throw C.fail(404, "That measurable doesn't exist.");
  if (!(ctx.access.leadership || C.isMeHolder(ctx, { name: m.owner_name, email: m.owner_email }))) throw C.fail(403, "Only Leadership or this measurable's owner can change it.");
  const f = fields(ctx.body, { creating: false });
  if (!ctx.access.leadership) { delete f.division_code; delete f.scope; delete f.owner_name; delete f.owner_email; }
  const keys = Object.keys(f);
  if (!keys.length) return { ok: true };
  const definitionChanged = "definition" in f && f.definition !== m.definition;
  await db.query(`UPDATE pulse.measurable SET ${keys.map(k => `${k} = @${k}`).join(", ")}${definitionChanged ? ", definition_version = definition_version + 1" : ""} WHERE id = @id`, { id, ...f });
  const before = Object.fromEntries(keys.map(k => [k, m[k]]));
  await C.record(ctx, "measurable.update", { type: "measurable", id: m.code }, before, f);
  return { ok: true };
}

/** Leadership switches a measurable from trial to automatic (or back), with a reason. */
async function setAutomatic(ctx) {
  const id = C.int(ctx.params.id);
  const m = await loadMeasurable(id);
  if (!m.collector) throw C.fail(409, "This measurable has no automatic source yet, so it can only be typed in.");
  const enabled = ctx.body.enabled === true;
  const why = C.reason(ctx.body.reason);
  if (!!m.auto_enabled === enabled) return { ok: true, automatic: enabled };
  await db.query("UPDATE pulse.measurable SET auto_enabled = @enabled, auto_changed_by = @name, auto_changed_at = SYSUTCDATETIME() WHERE id = @id",
    { id, enabled, name: ctx.person.name });
  await C.record(ctx, "measurable.automatic", { type: "measurable", id: m.code }, { automatic: !!m.auto_enabled }, { automatic: enabled }, why);
  return { ok: true, automatic: enabled };
}

/** "Work out now": asks the sync service to run the collectors at its next check (within two minutes). */
async function refreshScorecard(ctx) {
  const [pending] = await db.query("SELECT TOP 1 id FROM pulse.sync_request WHERE job = N'scorecard' AND picked_at IS NULL AND requested_at > DATEADD(hour, -1, SYSUTCDATETIME())");
  if (!pending) await db.query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (N'scorecard', @by)", { by: ctx.person.name });
  return { ok: true, detail: "Pulse will work out the automatic values within the next few minutes." };
}

const routes = [
  { method: "GET", path: "/scorecard", auth: "person", fn: getScorecard },
  { method: "POST", path: "/scorecard/enter", auth: "person", fn: enter },
  { method: "POST", path: "/scorecard/override", auth: "person", fn: override },
  { method: "POST", path: "/scorecard/revert", auth: "person", fn: revert },
  { method: "POST", path: "/measurables", auth: "person", allow: a => a.leadership, fn: createMeasurable },
  { method: "PATCH", path: "/measurables/:id", auth: "person", fn: updateMeasurable },
  { method: "POST", path: "/measurables/:id/automatic", auth: "person", allow: a => a.leadership, fn: setAutomatic },
  { method: "POST", path: "/scorecard/refresh", auth: "person", allow: a => a.leadership, fn: refreshScorecard },
];

module.exports = { routes };
