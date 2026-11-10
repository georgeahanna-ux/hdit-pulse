"use strict";
/**
 * Customer feedback measurables from SimpleSAT (D4 items 10–11), read-only.
 *
 *   CSAT  share of this week's CSAT ratings that were positive (SimpleSAT's own sentiment, so it
 *         matches SimpleSAT's reports: neutral ratings count in the total and pull it down)
 *   NPS   over the 90 days to the end of the week (or now): % promoters (9–10) less
 *         % detractors (0–6), passives counted in the total
 *
 * Only each response's rating answer counts (SimpleSAT's "primary" answer); follow-up questions
 * don't. Answers are read once per run for the whole window and every week is worked out in memory.
 * Nothing about the customer (name, email, comment) is kept: only the counts.
 */
const time = require("../lib/time");
const simplesat = require("../lib/simplesat");

const CRED = "simplesat";
const NPS_DAYS = 90;
const r1 = x => Math.round(x * 10) / 10;
const lc = v => String(v ?? "").trim().toLowerCase();
const num = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** The parts of an answer Pulse uses, from whichever field names this API version has. */
function shape(a) {
  const q = a.question || {};
  const metric = lc(q.metric ?? a.question_metric ?? a.metric ?? (a.survey || {}).metric);
  const primary = a.is_primary ?? a.primary ?? q.is_primary ?? null;
  const when = a.created ?? a.created_at ?? a.survey_date ?? a.date ?? a.modified ?? null;
  const rating = num(a.rating ?? a.value ?? (typeof a.choice === "number" || /^\d+$/.test(String(a.choice ?? "")) ? a.choice : null));
  const label = lc(a.answer_label ?? a.choice_label ?? a.label ?? (typeof a.choice === "string" ? a.choice : ""));
  return { id: a.id ?? null, response: a.response_id ?? (a.response || {}).id ?? null, metric, primary, when: when ? new Date(when) : null, rating, label, sentiment: lc(a.sentiment) };
}

/** Rating answers of one metric (csat or nps), one per response. */
function ratings(list, metric) {
  const rows = list.map(shape).filter(a => a.metric === metric && a.when && !Number.isNaN(a.when.getTime()));
  const anyPrimary = rows.some(a => a.primary !== null);
  const kept = rows.filter(a => (anyPrimary ? a.primary === true : a.rating !== null || a.sentiment));
  const seen = new Set();
  return kept.filter(a => { const k = a.response ?? a.id; if (k === null) return true; if (seen.has(k)) return false; seen.add(k); return true; });
}

const between = (rows, from, to) => rows.filter(a => a.when >= from && a.when < to);

function csat(rows) {
  if (!rows.length) return { value: null, detail: { text: "No CSAT ratings this week." } };
  const positive = rows.filter(a => a.sentiment ? a.sentiment === "positive" : a.rating !== null && a.rating >= 4).length;
  const neutral = rows.filter(a => a.sentiment === "neutral").length;
  const value = r1(positive / rows.length * 100);
  return { value, detail: { text: `${positive} positive of ${rows.length} CSAT ratings${neutral ? ` (${neutral} neutral)` : ""} = ${value}%.`, ratings: rows.length, positive } };
}

function nps(rows) {
  if (!rows.length) return { value: null, detail: { text: `No NPS ratings in the last ${NPS_DAYS} days.` } };
  const kind = a => a.rating !== null ? (a.rating >= 9 ? "p" : a.rating <= 6 ? "d" : "n")
    : /promoter/.test(a.label) ? "p" : /detractor/.test(a.label) ? "d" : "n";
  const p = rows.filter(a => kind(a) === "p").length, d = rows.filter(a => kind(a) === "d").length;
  const value = Math.round((p - d) / rows.length * 100);
  return { value, detail: { text: `${p} promoters and ${d} detractors of ${rows.length} NPS ratings in the ${NPS_DAYS} days = ${value > 0 ? "+" : ""}${value}.`, ratings: rows.length, promoters: p, detractors: d } };
}

/** Reads the window once per run: from 90 days before the earliest week to now. */
async function load(cache, week, now) {
  if (cache.simplesat) return cache.simplesat;
  const first = cache.from && cache.from < week ? cache.from : week;
  const start = time.sydneyToUtc(time.addDays(first, -NPS_DAYS)).toISOString();
  const list = await simplesat.answers(start, now.toISOString());
  cache.simplesat = { csat: ratings(list, "csat"), nps: ratings(list, "nps"), total: list.length };
  return cache.simplesat;
}

async function collectWeek(week, cache = {}, now = new Date()) {
  const data = await load(cache, week, now);
  const start = time.sydneyToUtc(week);
  const end = new Date(Math.min(time.sydneyToUtc(time.addDays(week, 7)).getTime(), now.getTime()));
  const npsFrom = new Date(end.getTime() - NPS_DAYS * 86400e3);
  return {
    "simplesat.csat": csat(between(data.csat, start, end)),
    "simplesat.nps": nps(between(data.nps, npsFrom, end)),
  };
}

/** Field names and the values Pulse reads from the first few answers (no customer details), for Diagnose. */
async function inspect(now = new Date()) {
  const list = await simplesat.answers(new Date(now.getTime() - 30 * 86400e3).toISOString(), now.toISOString(), { max: 2, partial: true });
  const keys = [...new Set(list.flatMap(a => Object.keys(a)))].sort();
  const sample = list.slice(0, 12).map(a => { const s = shape(a); return { metric: s.metric, primary: s.primary, rating: s.rating, label: s.label, sentiment: s.sentiment, when: s.when && s.when.toISOString(), questionKeys: Object.keys(a.question || {}) }; });
  return JSON.stringify({ answersRead: list.length, keys, sample, csat: ratings(list, "csat").length, nps: ratings(list, "nps").length });
}

module.exports = { CRED, collectWeek, inspect, _test: { shape, ratings, csat, nps } };
