"use strict";
/**
 * Seats, new seats and MRR from Autotask contracts and won opportunities (decided 9 Nov 2026).
 *
 *   Seats   = units of the seat services on recurring-service contracts in force on a date.
 *   MRR     = recurring contract services and bundles in force on a date, each line
 *             price × units ÷ months in the contract's billing period.
 *   New seats = quantity of seat lines (seat services, or products named after them) on the primary
 *               quote of opportunities at "Stage 9: Closed Won", by close date.
 *
 * Seat services are named in the app_setting "collect.seat_services" (a JSON list of service names).
 * Autotask is read once per run for the whole window (FY start to today); every date is then
 * worked out in memory.
 */
const at = require("../lib/autotask");
const db = require("../lib/sql");

const MOD = "scorecard";
const DEFAULT_SEAT_SERVICES = [
  "IT Support & Proactive Maintenance - Business Class Plan",
  "Technical Services and Management",
  "IT Managed Services Support - Business Class - Per User per Month",
];

const day = v => (v ? String(v).slice(0, 10) : null);
const num = v => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const fmt = x => Math.round(x).toLocaleString("en-AU");
const money = x => "$" + Math.round(x).toLocaleString("en-AU");

/** Months in a billing period from its label; null for one-off. */
function monthsFor(label) {
  const l = norm(label);
  if (/one.?time|once|one.?off/.test(l)) return null;
  if (/semi|half|six/.test(l)) return 6;
  if (/quarter/.test(l)) return 3;
  if (/year|annual/.test(l)) return 12;
  return 1;
}

/** Picklist values for a field, from Autotask's field information. */
async function picklist(entity, field, cache) {
  const key = `pl:${entity}`;
  if (!cache[key]) cache[key] = (await at.fieldInfo(MOD, entity)).fields || [];
  const f = cache[key].find(x => x.name === field);
  return f && f.isPickList ? (f.picklistValues || []).map(v => ({ value: Number(v.value), label: v.label })) : [];
}
async function hasFields(entity, wanted, cache) {
  const key = `pl:${entity}`;
  if (!cache[key]) cache[key] = (await at.fieldInfo(MOD, entity)).fields || [];
  const have = new Set(cache[key].map(f => f.name));
  return wanted.filter(f => have.has(f));
}

async function seatServiceNames() {
  const [row] = await db.query("SELECT [value] FROM pulse.app_setting WHERE [key] = N'collect.seat_services'");
  try { const list = JSON.parse(row && row.value); if (Array.isArray(list) && list.length) return list; } catch { /* default */ }
  return DEFAULT_SEAT_SERVICES;
}

/** Everything needed for any date from `from` (YYYY-MM-DD) to today. Cached on the run. */
async function load(cache, from, today) {
  if (cache.contracts && cache.contracts.from <= from) return cache.contracts;
  const names = await seatServiceNames();
  const services = await at.query(MOD, "Services", null, ["id", "name"]);
  const wanted = new Set(names.map(norm));
  const seatIds = new Set(services.filter(s => wanted.has(norm(s.name))).map(s => Number(s.id)));
  const missing = names.filter(n => !services.some(s => norm(s.name) === norm(n)));

  const [types, periods, statuses] = await Promise.all([
    picklist("Contracts", "contractType", cache), picklist("Contracts", "contractPeriodType", cache), picklist("Contracts", "status", cache)]);
  const recurring = types.filter(t => /recurring/i.test(t.label)).map(t => t.value);
  const active = (statuses.find(s => norm(s.label) === "active") || { value: 1 }).value;
  const periodMonths = new Map(periods.map(p => [p.value, monthsFor(p.label)]));

  const contracts = (await at.query(MOD, "Contracts", [
    ...(recurring.length ? [{ op: "in", field: "contractType", value: recurring }] : []),
    { op: "gte", field: "endDate", value: from },
  ], ["id", "companyID", "contractName", "contractType", "contractPeriodType", "status", "startDate", "endDate"]))
    .filter(k => !day(k.startDate) || day(k.startDate) <= today);
  const ids = contracts.map(k => k.id);
  const priceFields = await hasFields("ContractServices", ["adjustedPrice", "unitPrice"], cache);
  const window = [{ op: "gte", field: "endDate", value: from }, { op: "lte", field: "startDate", value: today + "T23:59:59" }];
  const unitFields = ["id", "contractID", "startDate", "endDate", "units"];
  const [lines, bundles, lineUnits, bundleUnits] = await Promise.all([
    at.queryIn(MOD, "ContractServices", "contractID", ids, ["id", "contractID", "serviceID", ...priceFields]),
    at.queryIn(MOD, "ContractServiceBundles", "contractID", ids, ["id", "contractID", "serviceBundleID", ...priceFields]).catch(() => []),
    at.queryIn(MOD, "ContractServiceUnits", "contractID", ids, [...unitFields, "contractServiceID"], window),
    at.queryIn(MOD, "ContractServiceBundleUnits", "contractID", ids, [...unitFields, "contractServiceBundleID"], window).catch(() => []),
  ]);
  cache.contracts = { from, today, seatIds, missing, names, active, periodMonths, contracts, lines, bundles, lineUnits, bundleUnits };
  return cache.contracts;
}

/** Seats and MRR in force on a date (YYYY-MM-DD). Pure, given load()'s data. */
function levelsOn(d, data) {
  const live = new Map(data.contracts
    .filter(k => (!day(k.startDate) || day(k.startDate) <= d) && (!day(k.endDate) || day(k.endDate) >= d))
    .filter(k => d < data.today || Number(k.status) === Number(data.active))
    .map(k => [Number(k.id), k]));
  const unitsOn = (rows, key) => {
    const m = new Map();
    for (const r of rows) if (live.has(Number(r.contractID)) && day(r.startDate) <= d && day(r.endDate) >= d) {
      const cur = m.get(Number(r[key]));
      if (!cur || day(r.startDate) > day(cur.startDate)) m.set(Number(r[key]), r);
    }
    return m;
  };
  const lu = unitsOn(data.lineUnits, "contractServiceID"), bu = unitsOn(data.bundleUnits, "contractServiceBundleID");
  let seats = 0, mrr = 0, seatContracts = new Set(), unpriced = 0;
  const monthly = (line, u) => {
    const k = live.get(Number(line.contractID));
    const months = k ? data.periodMonths.get(Number(k.contractPeriodType)) ?? 1 : 1;
    const price = num(line.adjustedPrice) ?? num(line.unitPrice);
    if (!months) return 0;
    if (price === null) { unpriced++; return 0; }
    return (price * num(u.units)) / months;
  };
  for (const line of data.lines) {
    const u = lu.get(Number(line.id));
    if (!u || !live.has(Number(line.contractID))) continue;
    if (data.seatIds.has(Number(line.serviceID))) { seats += num(u.units) || 0; seatContracts.add(Number(line.contractID)); }
    mrr += monthly(line, u);
  }
  for (const b of data.bundles) {
    const u = bu.get(Number(b.id));
    if (u && live.has(Number(b.contractID))) mrr += monthly(b, u);
  }
  const missingNote = data.missing.length ? ` Not found in Autotask: ${data.missing.map(n => `"${n}"`).join(", ")}.` : "";
  return {
    seats: { value: seats, detail: { text: `${fmt(seats)} seats on ${seatContracts.size} recurring contracts in force on ${d}.${missingNote}`, contracts: seatContracts.size } },
    mrr: { value: Math.round(mrr * 100) / 100, detail: { text: `${money(mrr)} a month from ${live.size} recurring contracts in force on ${d}${unpriced ? ` (${unpriced} lines without a price left out)` : ""}.`, contracts: live.size, unpriced } },
  };
}

/** Won opportunities and their primary quotes' seat quantities, loaded once for the window. */
async function loadWins(cache, from, today) {
  if (cache.wins && cache.wins.from <= from) return cache.wins;
  const data = await load(cache, from, today);
  // Won = the stage "Stage 9: Closed Won" (confirmed 9 Nov 2026); status Closed/Implemented only if no such stage exists.
  const stages = await picklist("Opportunities", "stage", cache);
  const wonStages = stages.filter(s => /closed\s*-?\s*won/i.test(s.label)).map(s => s.value);
  const statuses = await picklist("Opportunities", "status", cache);
  const won = statuses.filter(s => /closed|won|implemented/i.test(s.label) && !/lost/i.test(s.label)).map(s => s.value);
  const [dateField] = await hasFields("Opportunities", ["closedDate", "projectedCloseDate"], cache);
  const wonFilter = wonStages.length ? { op: "in", field: "stage", value: wonStages } : { op: "in", field: "status", value: won };
  const opps = wonFilter.value.length && dateField ? await at.query(MOD, "Opportunities", [
    wonFilter, { op: "gte", field: dateField, value: from },
  ], ["id", "title", "companyID", "status", "stage", dateField]) : [];
  const quotes = await at.queryIn(MOD, "Quotes", "opportunityID", opps.map(o => o.id), ["id", "opportunityID", "primaryQuote"]);
  const primary = new Map();
  for (const q of quotes) {
    const cur = primary.get(Number(q.opportunityID));
    if (!cur || (q.primaryQuote && !cur.primaryQuote) || (!!q.primaryQuote === !!cur.primaryQuote && Number(q.id) > Number(cur.id))) primary.set(Number(q.opportunityID), q);
  }
  const items = await at.queryIn(MOD, "QuoteItems", "quoteID", [...primary.values()].map(q => q.id), ["id", "quoteID", "serviceID", "productID", "name", "quantity"]);
  const seatsByQuote = new Map();
  for (const it of items) if (isSeatItem(it, data)) seatsByQuote.set(Number(it.quoteID), (seatsByQuote.get(Number(it.quoteID)) || 0) + (num(it.quantity) || 0));
  cache.wins = { from, dateField, opps: opps.map(o => ({ id: o.id, title: o.title, date: day(o[dateField]), seats: primary.get(Number(o.id)) ? seatsByQuote.get(Number(primary.get(Number(o.id)).id)) || 0 : 0 })) };
  return cache.wins;
}

/**
 * Is a quote line a seat? Quotes record seats as a product line named after the service
 * (e.g. "HD IT - IT Managed Services Support - Business Class - Per User per Month",
 * opportunity 29725715, checked 9 Nov 2026), so a line counts when it is one of the seat
 * services or its name contains one of their names.
 */
function isSeatItem(it, data) {
  if (data.seatIds.has(Number(it.serviceID))) return true;
  const n = norm(it.name);
  return !!n && (data.names || []).some(s => n.includes(norm(s)));
}

/** New seats won between two dates inclusive (YYYY-MM-DD). */
function newSeatsBetween(first, last, wins) {
  const list = wins.opps.filter(o => o.date && o.date >= first && o.date <= last);
  const seats = list.reduce((s, o) => s + o.seats, 0);
  const withSeats = list.filter(o => o.seats);
  return { value: seats, detail: {
    text: `${fmt(seats)} seats on ${withSeats.length} of ${list.length} opportunities won${wins.dateField === "projectedCloseDate" ? " (by projected close date: Autotask has no closed date)" : ""}${withSeats.length ? `: ${withSeats.slice(0, 5).map(o => `${o.title} (${fmt(o.seats)})`).join(", ")}${withSeats.length > 5 ? ", …" : ""}` : ""}.`,
    opportunities: list.length,
  } };
}

module.exports = { load, loadWins, levelsOn, newSeatsBetween, isSeatItem, monthsFor, DEFAULT_SEAT_SERVICES };
