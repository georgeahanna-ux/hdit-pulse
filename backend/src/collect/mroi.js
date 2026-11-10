"use strict";
/**
 * MQLs (D4 item 1) from Marketing ROI (D9). Marketing ROI knows when each opportunity with a
 * marketing event first reached MQL (or beyond: SQL, won); Pulse counts them by Sydney week.
 * Opportunities that were already MQL when Marketing ROI first saw them are dated by their creation
 * date and counted as estimated, so early weeks are marked as such.
 */
const time = require("../lib/time");
const apps = require("../lib/apps");

async function load(cache) {
  if (cache.mroi) return cache.mroi;
  const body = await apps.measures("mroi");
  const items = (((body.measures || {}).mqls || {}).items || [])
    .map(i => ({ week: i.at ? time.weekOf(new Date(i.at)) : null, estimated: !!i.estimated })).filter(i => i.week);
  cache.mroi = { items, version: body.version || null };
  return cache.mroi;
}

function mqlsIn(week, items) {
  const list = items.filter(i => i.week === week);
  const est = list.filter(i => i.estimated).length;
  return { value: list.length, detail: {
    text: `${list.length} ${list.length === 1 ? "opportunity" : "opportunities"} reached MQL this week in Marketing ROI${est ? ` (${est} dated by when the opportunity was created, because Marketing ROI first saw ${est === 1 ? "it" : "them"} already at MQL or beyond)` : ""}.`,
    mqls: list.length, estimated: est,
  } };
}

async function collectWeek(week, cache = {}) {
  const data = await load(cache);
  return { "mroi.mqls": mqlsIn(week, data.items) };
}

module.exports = { collectWeek, mqlsIn };
