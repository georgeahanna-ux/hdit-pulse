"use strict";
/**
 * Client health (0.10.0, D23): the Early Warning score and the happiness score. Pure functions.
 *
 * Early Warning: points for each warning sign, capped at 100. Every point has a reason the
 * Account Manager can read, so the score is never a black box:
 *
 *   Feedback (SimpleSAT, on their tickets)
 *     Latest NPS in 180 days is a detractor (0–6)            +30   passive (7–8) +10
 *     Each negative CSAT rating in 90 days                   +12   (up to 36)
 *     Each neutral CSAT rating in 90 days                     +4   (up to 12)
 *     CSAT in 90 days at least 15 points below the year before +10 (3+ ratings in each)
 *     Gone quiet: 3+ responses in the year, none in 120 days, still raising tickets  +5
 *   Tickets (Autotask)
 *     Ticket spike: 5+ in 30 days and at least double the 60 days before   +15
 *     Each SLA missed in 30 days                              +5   (up to 15)
 *     Each Critical ticket in 30 days                         +5   (up to 10)
 *     Tickets open more than 14 days: 3–5 +5, 6+ +10
 *   Contract
 *     Recurring contract ends within 30 days +20, within 90 days +15
 *
 *   0–24 Healthy · 25–49 Watch · 50+ At risk
 *
 * Happiness (leaderboards): every CSAT and NPS rating in the last year turned into 0–100
 * (CSAT positive 100, neutral 50, negative 0; NPS rating × 10), weighted so a rating 120 days
 * old counts half as much as today's. Ranked only with 3 or more ratings.
 */
const DAY = 86400e3;
const WATCH = 25, RISK = 50;
const MIN_RATINGS = 3;
const HALF_LIFE = 120;

const levelOf = score => (score >= RISK ? "risk" : score >= WATCH ? "watch" : "healthy");
const ago = (now, d) => (now.getTime() - new Date(d).getTime()) / DAY;
const r1 = x => Math.round(x * 10) / 10;
const shortDate = d => new Date(d).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });

/** CSAT kind of one rating: SimpleSAT's own sentiment, or the 1–5 rating when it has none. */
function csatKind(f) {
  const s = String(f.sentiment || "").toLowerCase();
  if (s === "positive" || s === "negative" || s === "neutral") return s;
  if (f.rating === null || f.rating === undefined) return null;
  return f.rating >= 4 ? "positive" : f.rating <= 2 ? "negative" : "neutral";
}
const npsKind = r => (r === null || r === undefined ? null : r >= 9 ? "promoter" : r <= 6 ? "detractor" : "passive");
const csatPct = list => (list.length ? r1(list.filter(f => csatKind(f) === "positive").length / list.length * 100) : null);
function npsOf(list) {
  const rated = list.filter(f => f.rating !== null && f.rating !== undefined);
  if (!rated.length) return null;
  const p = rated.filter(f => npsKind(f.rating) === "promoter").length, d = rated.filter(f => npsKind(f.rating) === "detractor").length;
  return Math.round((p - d) / rated.length * 100);
}

/** Feedback figures for one client: CSAT % and NPS over the year, and the happiness score. */
function feedbackFigures(feedback, now = new Date()) {
  const year = feedback.filter(f => ago(now, f.answeredAt) <= 365);
  const csat = year.filter(f => f.metric === "csat" && csatKind(f));
  const nps = year.filter(f => f.metric === "nps" && f.rating !== null && f.rating !== undefined);
  let w = 0, total = 0;
  for (const f of [...csat, ...nps]) {
    const v = f.metric === "nps" ? Math.max(0, Math.min(10, f.rating)) * 10 : { positive: 100, neutral: 50, negative: 0 }[csatKind(f)];
    const weight = Math.pow(0.5, Math.max(0, ago(now, f.answeredAt)) / HALF_LIFE);
    w += weight; total += v * weight;
  }
  const ratings = csat.length + nps.length;
  const last = year.reduce((m, f) => (!m || new Date(f.answeredAt) > new Date(m) ? f.answeredAt : m), null);
  return {
    ratings, csatN: csat.length, csatPct: csatPct(csat), npsN: nps.length, nps: npsOf(nps),
    happiness: ratings && w ? r1(total / w) : null, ranked: ratings >= MIN_RATINGS, lastFeedbackAt: last,
  };
}

/**
 * Ticket figures for one client. tickets: [{ createDate, completedDate, critical, slaMet, open }]
 * slaMet is false only when Autotask says the SLA was missed; null when no SLA applies.
 */
function ticketFigures(tickets, now = new Date()) {
  const in30 = tickets.filter(t => ago(now, t.createDate) <= 30);
  const prior60 = tickets.filter(t => { const a = ago(now, t.createDate); return a > 30 && a <= 90; });
  const closed30 = tickets.filter(t => t.completedDate && ago(now, t.completedDate) <= 30);
  return {
    tickets30: in30.length,
    ticketsBase: r1(prior60.length / 2),          // a month's worth, from the 60 days before
    slaMissed30: closed30.filter(t => t.slaMet === false).length,
    critical30: in30.filter(t => t.critical).length,
    agedOpen: tickets.filter(t => t.open && ago(now, t.createDate) > 14).length,
  };
}

/** The Early Warning score and its reasons. c: { feedback, tickets (figures), contractEnd } */
function earlyWarning({ feedback = [], tickets = {}, contractEnd = null }, now = new Date()) {
  const reasons = [];
  const add = (key, points, text, kind) => { if (points > 0) reasons.push({ key, points, text, kind }); };

  // Feedback
  const nps = feedback.filter(f => f.metric === "nps" && f.rating !== null && f.rating !== undefined && ago(now, f.answeredAt) <= 180)
    .sort((a, b) => new Date(b.answeredAt) - new Date(a.answeredAt));
  if (nps.length) {
    const k = npsKind(nps[0].rating), who = nps[0].contactName ? ` from ${nps[0].contactName}` : "";
    if (k === "detractor") add("nps-detractor", 30, `NPS of ${nps[0].rating}${who} on ${shortDate(nps[0].answeredAt)} (a detractor)`, "feedback");
    if (k === "passive") add("nps-passive", 10, `NPS of ${nps[0].rating}${who} on ${shortDate(nps[0].answeredAt)} (passive)`, "feedback");
  }
  const csat90 = feedback.filter(f => f.metric === "csat" && csatKind(f) && ago(now, f.answeredAt) <= 90);
  const neg = csat90.filter(f => csatKind(f) === "negative"), neu = csat90.filter(f => csatKind(f) === "neutral");
  if (neg.length) add("csat-negative", Math.min(36, neg.length * 12), `${neg.length} unhappy CSAT rating${neg.length === 1 ? "" : "s"} in 90 days`, "feedback");
  if (neu.length) add("csat-neutral", Math.min(12, neu.length * 4), `${neu.length} neutral CSAT rating${neu.length === 1 ? "" : "s"} in 90 days`, "feedback");
  const csatBefore = feedback.filter(f => f.metric === "csat" && csatKind(f) && ago(now, f.answeredAt) > 90 && ago(now, f.answeredAt) <= 365);
  if (csat90.length >= 3 && csatBefore.length >= 3) {
    const nowPct = csatPct(csat90), beforePct = csatPct(csatBefore);
    if (beforePct - nowPct >= 15) add("csat-falling", 10, `CSAT down to ${Math.round(nowPct)}% in 90 days, from ${Math.round(beforePct)}% the year before`, "feedback");
  }
  const year = feedback.filter(f => ago(now, f.answeredAt) <= 365);
  const recent = feedback.filter(f => ago(now, f.answeredAt) <= 120);
  if (new Set(year.map(f => f.responseId)).size >= 3 && !recent.length && (tickets.tickets30 || 0) > 0)
    add("gone-quiet", 5, "No survey answers in 120 days, but still raising tickets", "feedback");

  // Tickets
  if ((tickets.tickets30 || 0) >= 5 && tickets.tickets30 >= 2 * Math.max(1, tickets.ticketsBase || 0))
    add("ticket-spike", 15, `${tickets.tickets30} tickets in 30 days, against about ${Math.round(tickets.ticketsBase || 0)} a month before`, "tickets");
  if (tickets.slaMissed30) add("sla-missed", Math.min(15, tickets.slaMissed30 * 5), `${tickets.slaMissed30} SLA${tickets.slaMissed30 === 1 ? "" : "s"} missed in 30 days`, "tickets");
  if (tickets.critical30) add("critical", Math.min(10, tickets.critical30 * 5), `${tickets.critical30} Critical ticket${tickets.critical30 === 1 ? "" : "s"} in 30 days`, "tickets");
  if ((tickets.agedOpen || 0) >= 3) add("aged-open", tickets.agedOpen >= 6 ? 10 : 5, `${tickets.agedOpen} tickets open more than 14 days`, "tickets");

  // Contract
  if (contractEnd) {
    const days = Math.ceil((new Date(contractEnd + "T23:59:59+11:00").getTime() - now.getTime()) / DAY);
    if (days >= 0 && days <= 30) add("contract-ending", 20, `Recurring contract ends ${shortDate(contractEnd + "T12:00:00+11:00")} (${days} day${days === 1 ? "" : "s"})`, "contract");
    else if (days > 30 && days <= 90) add("contract-ending", 15, `Recurring contract ends ${shortDate(contractEnd + "T12:00:00+11:00")} (${days} days)`, "contract");
  }

  reasons.sort((a, b) => b.points - a.points);
  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  return { score, level: levelOf(score), reasons };
}

/* ---------------- matching a SimpleSAT response to an Autotask client ---------------- */
const normName = s => String(s || "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
  .replace(/\b(pty|ltd|limited|proprietary|inc|incorporated|the|co|company|group|australia|aust|au)\b/g, " ")
  .replace(/\s+/g, " ").trim();

/** Autotask ticket number (T20261103.0042) or id from a SimpleSAT ticket's external id. */
function ticketRef(external) {
  const s = String(external ?? "").trim();
  if (/^T\d{8}\.\d{3,5}$/i.test(s)) return { number: s.toUpperCase() };
  if (/^\d{3,12}$/.test(s)) return { id: Number(s) };
  return null;
}

/**
 * The parts of a SimpleSAT response Pulse keeps: one row per rating (CSAT or NPS). Only the
 * contact's name (not their email), the technician's name, the ticket number and the comment.
 */
function rowsFromResponse(r) {
  const out = [];
  const customer = r.customer || {}, ticket = r.ticket || {};
  const tech = (r.team_members || []).find(m => m.is_primary) || (r.team_members || [])[0] || null;
  for (const a of r.answers || []) {
    const q = a.question || {};
    const metric = String(q.metric || "").toLowerCase();
    if (!["csat", "nps"].includes(metric)) continue;
    const raw = a.choice;
    const rating = typeof raw === "number" ? raw : /^\d+$/.test(String(raw ?? "")) ? Number(raw) : null;
    const topics = (Array.isArray(a.topics) ? a.topics : []).map(t => (typeof t === "string" ? t : t && (t.name || t.label))).filter(Boolean);
    out.push({
      key: `${r.id}:${metric}`, responseId: String(r.id), metric, rating,
      sentiment: String(a.sentiment || "").toLowerCase() || null,
      comment: String(a.comment || "").trim().slice(0, 1000) || null,
      topics: topics.join(", ").slice(0, 400) || null,
      contactName: String(customer.name || "").trim().slice(0, 200) || null,
      teamMember: tech ? String(tech.name || "").trim().slice(0, 200) || null : null,
      ticket: ticketRef(ticket.external_id),
      ticketSubject: String(ticket.subject || "").trim().slice(0, 300) || null,
      companyText: String(customer.company || "").trim().slice(0, 200) || null,
      contactRef: /^\d{3,12}$/.test(String(customer.external_id ?? "")) ? Number(customer.external_id) : null,
      answeredAt: new Date(r.created || a.created || r.modified),
    });
  }
  return out.filter(x => !Number.isNaN(x.answeredAt.getTime()));
}

/**
 * Which client a feedback row belongs to: its Autotask ticket's company first, then the
 * contact's company, then the company name SimpleSAT holds. Returns { companyId, by } or null.
 */
function matchCompany(row, { ticketCompany, contactCompany, byName }) {
  if (row.ticket) {
    const id = row.ticket.number ? ticketCompany.get(row.ticket.number) : ticketCompany.get(`id:${row.ticket.id}`);
    if (id) return { companyId: id, by: "ticket" };
  }
  if (row.contactRef && contactCompany.has(row.contactRef)) return { companyId: contactCompany.get(row.contactRef), by: "contact" };
  const n = normName(row.companyText);
  if (n && byName.has(n)) return { companyId: byName.get(n), by: "name" };
  return null;
}

/**
 * Happiest and least happy clients (3+ ratings). A client is on one board only: with fewer than
 * 2 × n ranked clients, the top half are the happiest and the bottom half the least happy.
 */
function leaderboards(clients, n = 10) {
  const ranked = clients.filter(c => c.ranked && c.happiness !== null)
    .sort((a, b) => b.happiness - a.happiness || b.ratings - a.ratings || a.name.localeCompare(b.name));
  const each = Math.min(n, Math.ceil(ranked.length / 2));
  const happiest = ranked.slice(0, each);
  const rest = ranked.slice(each);
  const unhappiest = rest.slice().sort((a, b) => a.happiness - b.happiness || b.ratings - a.ratings || a.name.localeCompare(b.name)).slice(0, Math.min(n, rest.length));
  return { happiest, unhappiest, ranked: ranked.length };
}

module.exports = {
  WATCH, RISK, MIN_RATINGS, levelOf, csatKind, npsKind, feedbackFigures, ticketFigures, earlyWarning,
  normName, ticketRef, rowsFromResponse, matchCompany, leaderboards,
};
