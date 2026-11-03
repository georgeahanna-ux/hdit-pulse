"use strict";
/**
 * Managed Services measurables from Autotask (D4 items 6–9), read with the "Autotask: Service"
 * API user (read-only use). Runs in the sync app every hour.
 *
 *   sla_first_response  tickets created in the week
 *   tickets_per_tech    tickets completed in the week by techs
 *   fcr                 the same tickets and their time entries
 *   utilisation         time entries worked in the week by techs
 *
 * Techs are resources whose default department was Service Desk at the end of the week
 * (pulse.at_resource history, kept by the departments sync, D16).
 */
const at = require("../lib/autotask");
const db = require("../lib/sql");
const time = require("../lib/time");
const calc = require("./calc");

const CRED = "autotask-service";
const TICKET_FIELDS = ["id", "createDate", "completedDate", "status", "assignedResourceID", "completedByResourceID",
  "firstResponseDateTime", "firstResponseDueDateTime"];
const ENTRY_FIELDS = ["id", "resourceID", "ticketID", "taskID", "dateWorked", "hoursWorked", "isNonBillable"];

/** Autotask "in" filters, 500 ids at a time. */
async function queryIn(entity, field, ids, fields, extra = []) {
  const out = [];
  const list = [...new Set(ids.map(Number))];
  for (let i = 0; i < list.length; i += 500) {
    out.push(...await at.query(CRED, entity, [{ op: "in", field, value: list.slice(i, i + 500) }, ...extra], fields));
  }
  return out;
}

/** Keeps only fields this Autotask instance has (e.g. completedByResourceID), so one missing field can't fail the query. */
let known = null;
async function ticketFields() {
  if (known) return known;
  try {
    const info = await at.fieldInfo(CRED, "Tickets");
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
    const sets = await at.query(CRED, "HolidaySets", null, ["id", "holidaySetName"]);
    const set = calc.pickHolidaySet(sets, wanted);
    const days = set ? await at.query(CRED, "Holidays", [{ op: "eq", field: "holidaySetID", value: set.id }], ["id", "holidayDate", "holidayName"]) : [];
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
    at.query(CRED, "Tickets", [{ op: "gte", field: "createDate", value: start }, { op: "lt", field: "createDate", value: end }], fields),
    at.query(CRED, "Tickets", [{ op: "gte", field: "completedDate", value: start }, { op: "lt", field: "completedDate", value: end }], fields),
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
  return out;
}

module.exports = { CRED, collectWeek, _test: { reset() { known = null; } } };
