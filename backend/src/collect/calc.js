"use strict";
/**
 * Scorecard calculations from Autotask data (pure functions, tested in collect.test.js).
 * Each returns { value, detail } where detail.text is the plain-English working shown in Pulse.
 * value is null when there's nothing to measure yet (detail.text says why).
 */
const time = require("../lib/time");

const round = (x, dp = 1) => Math.round(x * 10 ** dp) / 10 ** dp;
const pct = (n, d) => (d ? round((100 * n) / d, 1) : null);
const ms = v => (v ? new Date(v).getTime() : null);
const n0 = x => Number(x || 0);
const fmt = x => x.toLocaleString("en-AU", { maximumFractionDigits: 1 });
const plural = (n, one, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;

/** Working days in a week (Mon–Fri) less weekday holidays. holidays: ["YYYY-MM-DD", …]. */
function workingDays(weekId, holidays = []) {
  const off = new Set(holidays.map(h => String(h).slice(0, 10)));
  const days = [0, 1, 2, 3, 4].map(i => time.addDays(weekId, i));
  const lost = days.filter(d => off.has(d));
  return { days: days.length - lost.length, holidays: lost };
}

/** SLA first response: tickets created in the week that have a first-response due time. */
function slaFirstResponse(tickets, now = new Date()) {
  let met = 0, missed = 0, waiting = 0, noSla = 0;
  for (const t of tickets) {
    const due = ms(t.firstResponseDueDateTime);
    if (!due) { noSla++; continue; }
    const first = ms(t.firstResponseDateTime);
    if (first !== null) (first <= due ? met++ : missed++);
    else if (due < now.getTime()) missed++;
    else waiting++;
  }
  const counted = met + missed;
  if (!counted) return { value: null, detail: { text: `No tickets with a first-response SLA to measure yet (${plural(tickets.length, "ticket")} created, ${fmt(waiting)} still within time).`, met, missed, waiting, noSla } };
  return {
    value: pct(met, counted),
    detail: { text: `${fmt(met)} of ${plural(counted, "ticket")} had a first response in time.${missed ? ` ${fmt(missed)} missed.` : ""}${waiting ? ` ${fmt(waiting)} still within time aren't counted yet.` : ""}${noSla ? ` ${fmt(noSla)} without an SLA left out.` : ""}`, met, missed, waiting, noSla },
  };
}

/** Who completed a ticket: completedByResourceID, else the assigned resource. */
const closer = t => Number(t.completedByResourceID || t.assignedResourceID || 0) || null;

/** Tickets completed by techs ÷ (techs × working days). */
function ticketsPerTech(completed, techIds, days) {
  const techs = new Set(techIds.map(Number));
  if (!techs.size) return { value: null, detail: { text: "No techs found: nobody has Service Desk as their default department in Autotask (check People and departments)." } };
  if (!days.days) return { value: null, detail: { text: "No working days this week." } };
  const byTechs = completed.filter(t => techs.has(closer(t)));
  return {
    value: round(byTechs.length / (techs.size * days.days), 1),
    detail: {
      text: `${plural(byTechs.length, "ticket")} completed by ${plural(techs.size, "tech")} over ${plural(days.days, "working day")}${days.holidays.length ? ` (${plural(days.holidays.length, "public holiday")})` : ""}.`,
      tickets: byTechs.length, techs: techs.size, days: days.days, holidays: days.holidays,
    },
  };
}

/** First-contact resolution: completed-by-tech tickets with exactly one time entry. */
function firstContact(completed, entries, techIds) {
  const techs = new Set(techIds.map(Number));
  const mine = completed.filter(t => techs.has(closer(t)));
  const count = new Map();
  for (const e of entries) if (e.ticketID) count.set(Number(e.ticketID), (count.get(Number(e.ticketID)) || 0) + 1);
  const withTime = mine.filter(t => count.get(Number(t.id)));
  const one = withTime.filter(t => count.get(Number(t.id)) === 1).length;
  if (!withTime.length) return { value: null, detail: { text: techs.size ? "No completed tickets with time entries this week yet." : "No techs found (check People and departments)." } };
  return {
    value: pct(one, withTime.length),
    detail: { text: `${fmt(one)} of ${plural(withTime.length, "ticket")} were resolved with a single time entry.${mine.length - withTime.length ? ` ${fmt(mine.length - withTime.length)} with no time left out.` : ""}`, single: one, tickets: withTime.length, noTime: mine.length - withTime.length },
  };
}

/** Billable utilisation: billable hours ÷ (techs × working days × hours a day). */
function utilisation(entries, techIds, days, hoursPerDay = 7.6) {
  const techs = new Set(techIds.map(Number));
  if (!techs.size) return { value: null, detail: { text: "No techs found (check People and departments)." } };
  const available = techs.size * days.days * hoursPerDay;
  if (!available) return { value: null, detail: { text: "No working days this week." } };
  let billable = 0, other = 0;
  for (const e of entries) {
    if (!techs.has(Number(e.resourceID))) continue;
    const h = n0(e.hoursWorked);
    if ((e.ticketID || e.taskID) && !e.isNonBillable) billable += h; else other += h;
  }
  return {
    value: pct(billable, available),
    detail: {
      text: `${fmt(round(billable))} billable hours of ${fmt(round(available))} available (${plural(techs.size, "tech")} × ${plural(days.days, "day")} × ${hoursPerDay} hours). ${fmt(round(other))} other hours logged.`,
      billable: round(billable, 2), available: round(available, 2), other: round(other, 2),
    },
  };
}

/** Picks the holiday set: the one named in settings, else the only one, else one that looks Australian. */
function pickHolidaySet(sets, wanted) {
  if (!sets.length) return null;
  if (wanted) return sets.find(s => String(s.holidaySetName || "").toLowerCase() === String(wanted).toLowerCase()) || null;
  if (sets.length === 1) return sets[0];
  return sets.find(s => /nsw|sydney|australia/i.test(s.holidaySetName || "")) || sets[0];
}

module.exports = { workingDays, slaFirstResponse, ticketsPerTech, firstContact, utilisation, pickHolidaySet, closer, round };
