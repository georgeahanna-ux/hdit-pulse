"use strict";
/**
 * Managed Services measurables from Autotask (D4 items 6–9), read with the "Autotask: Service"
 * API user (read-only use). Runs in the sync app every hour.
 *
 *   sla_first_response  tickets created in the week
 *   tickets_per_tech    tickets completed in the week by techs
 *   fcr                 the same tickets and their time entries
 *   utilisation         time entries worked in the week by techs
 *   new_mrr             monthly revenue on opportunities won in the week (Stage 9: Closed Won)
 *   weighted_pipeline   stages 6 and 7 today (current week only: Autotask keeps no stage history)
 *
 * Techs are resources whose default department was Service Desk at the end of the week
 * (pulse.at_resource history, kept by the departments sync, D16).
 */
const at = require("../lib/autotask");
const db = require("../lib/sql");
const time = require("../lib/time");
const calc = require("./calc");
const contracts = require("./contracts");

const MOD = "scorecard";
const CRED = at.SECRET;
const TICKET_FIELDS = ["id", "createDate", "completedDate", "status", "assignedResourceID", "completedByResourceID",
  "firstResponseDateTime", "firstResponseDueDateTime"];
const ENTRY_FIELDS = ["id", "resourceID", "ticketID", "taskID", "dateWorked", "hoursWorked", "isNonBillable"];

const queryIn = (entity, field, ids, fields, extra) => at.queryIn(MOD, entity, field, ids, fields, extra);

/** Keeps only fields this Autotask instance has (e.g. completedByResourceID), so one missing field can't fail the query. */
let known = null;
async function ticketFields() {
  if (known) return known;
  try {
    const info = await at.fieldInfo(MOD, "Tickets");
    const have = new Set((info.fields || []).map(f => f.name));
    known = TICKET_FIELDS.filter(f => have.has(f));
  } catch { known = TICKET_FIELDS.filter(f => f !== "completedByResourceID"); }
  return known;
}

async function settings() {
  const rows = await db.query("SELECT [key], [value] FROM pulse.app_setting WHERE [key] LIKE N'collect.%'");
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    hoursPerDay: Number(s["collect.hours_per_day"]) || 7.6,
    techDepartment: s["collect.tech_department"] || "Service Desk",
    holidaySet: s["collect.holiday_set"] || null,
  };
}

/** Techs at a moment: the department history if it reaches back that far, else today's. */
async function techsAt(when, department) {
  const sqlAt = `SELECT r.id FROM pulse.at_resource FOR SYSTEM_TIME AS OF @at r
                   JOIN pulse.at_department d ON d.id = r.default_department_id
                  WHERE r.is_active = 1 AND d.name = @department`;
  let rows = await db.query(sqlAt, { at: when, department });
  if (!rows.length) rows = await db.query(sqlAt.replace("FOR SYSTEM_TIME AS OF @at ", ""), { department });
  return rows.map(r => r.id);
}

/** Weekday public holidays from Autotask's holiday set, cached for the run. */
async function holidaysFor(cache, wanted) {
  if (cache.holidays) return cache.holidays;
  try {
    const sets = await at.query(MOD, "HolidaySets", null, ["id", "holidaySetName"]);
    const set = calc.pickHolidaySet(sets, wanted);
    const days = set ? await at.query(MOD, "Holidays", [{ op: "eq", field: "holidaySetID", value: set.id }], ["id", "holidayDate", "holidayName"]) : [];
    cache.holidays = { set: set ? set.holidaySetName : null, dates: days.map(h => String(h.holidayDate).slice(0, 10)) };
  } catch (e) {
    cache.holidays = { set: null, dates: [], note: "Autotask holidays couldn't be read, so no public holidays were taken off." };
  }
  return cache.holidays;
}

/** Works out all four measurables for one week. */
async function collectWeek(week, cache = {}, now = new Date()) {
  const s = cache.settings || (cache.settings = await settings());
  const start = time.sydneyToUtc(week).toISOString();
  const endDay = time.addDays(week, 7);
  const end = time.sydneyToUtc(endDay).toISOString();
  const asOf = new Date(Math.min(now.getTime(), Date.parse(end)));

  const fields = await ticketFields();
  const [created, completed, techs, hol] = await Promise.all([
    at.query(MOD, "Tickets", [{ op: "gte", field: "createDate", value: start }, { op: "lt", field: "createDate", value: end }], fields),
    at.query(MOD, "Tickets", [{ op: "gte", field: "completedDate", value: start }, { op: "lt", field: "completedDate", value: end }], fields),
    techsAt(asOf, s.techDepartment),
    holidaysFor(cache, s.holidaySet),
  ]);
  const days = calc.workingDays(week, hol.dates);
  const byTechs = techs.length ? completed.filter(t => techs.includes(calc.closer(t))) : [];
  const [ticketEntries, weekEntries] = await Promise.all([
    byTechs.length ? queryIn("TimeEntries", "ticketID", byTechs.map(t => t.id), ENTRY_FIELDS) : [],
    techs.length ? queryIn("TimeEntries", "resourceID", techs, ENTRY_FIELDS,
      [{ op: "gte", field: "dateWorked", value: week }, { op: "lt", field: "dateWorked", value: endDay }]) : [],
  ]);

  const note = d => (hol.note ? { ...d, text: `${d.text} ${hol.note}` } : d);
  const out = {
    "autotask.sla_first_response": calc.slaFirstResponse(created, now),
    "autotask.tickets_per_tech": calc.ticketsPerTech(completed, techs, days),
    "autotask.fcr": calc.firstContact(completed, ticketEntries, techs),
    "autotask.utilisation": calc.utilisation(weekEntries, techs, days, s.hoursPerDay),
  };
  for (const k of ["autotask.tickets_per_tech", "autotask.utilisation"]) out[k].detail = note(out[k].detail);

  // Seats serviced (level at the end of the week, or today) and new seats won in the week.
  const today = time.sydneyDate(now);
  const lastDay = time.addDays(week, 6) < today ? time.addDays(week, 6) : today;
  if (!cache.contractsFailed) try {
    const data = await contracts.load(cache, cache.from || week, today);
    out["autotask.seats_serviced"] = contracts.levelsOn(lastDay, data).seats;
    const wins = await contracts.loadWins(cache, cache.from || week, today);
    out["autotask.new_seats"] = contracts.newSeatsBetween(week, lastDay, wins);
    out["autotask.new_mrr"] = contracts.newMrrBetween(week, lastDay, wins);
  } catch (e) {
    if (e.code === "not-connected") throw e;
    cache.contractsFailed = true;
    cache.notes = [...(cache.notes || []), `contracts: ${e.message}`.slice(0, 300)];
  }
  // Weighted pipeline is a reading of today's opportunities, so only the current week gets one.
  if (week === time.weekOf(now) && !cache.pipelineFailed) try {
    cache.pipeline ||= await contracts.weightedPipeline(cache);
    if (cache.pipeline.value !== null) out["autotask.weighted_pipeline"] = cache.pipeline;
  } catch (e) {
    if (e.code === "not-connected") throw e;
    cache.pipelineFailed = true;
    cache.notes = [...(cache.notes || []), `pipeline: ${e.message}`.slice(0, 300)];
  }
  return out;
}

module.exports = { CRED, collectWeek, _test: { reset() { known = null; } } };
