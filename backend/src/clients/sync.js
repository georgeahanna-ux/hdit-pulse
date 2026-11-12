"use strict";
/**
 * Client health job (0.10.0, D23): nightly at 5:40am Sydney, and on request ("clients").
 *
 *  1. Clients = companies with a recurring contract in force today (Autotask), with their
 *     Account Manager (the company's owner resource), MRR, seats and soonest contract end.
 *  2. SimpleSAT responses for the last 400 days → one row per CSAT or NPS rating, matched to a
 *     client by its Autotask ticket, then the contact, then the company name. Kept 400 days.
 *  3. Autotask tickets for those clients: created in the last 90 days, or still open.
 *  4. The Early Warning score and happiness for each client; a weekly snapshot for the trend.
 *  5. A Teams Activity feed alert to the Account Manager when a client moves into At risk
 *     (not on the first run, so the first day doesn't alert on every client at once).
 *
 * Autotask is read through the "clients" module (read-only); contracts through the scorecard's
 * read-only contract reader. Nothing is written to Autotask or SimpleSAT.
 */
const at = require("../lib/autotask");
const db = require("../lib/sql");
const time = require("../lib/time");
const simplesat = require("../lib/simplesat");
const contracts = require("../collect/contracts");
const M = require("./model");

const MOD = "clients";
const DAY = 86400e3;
const KEEP_DAYS = 400;

async function setting(key) {
  const [r] = await db.query("SELECT [value] FROM pulse.app_setting WHERE [key] = @key", { key });
  return r ? r.value : null;
}

/** Ticket numbers are strings, so "in" by hand (Autotask allows 500 values; 200 keeps the URL small). */
async function ticketsByNumber(numbers) {
  const out = [];
  const list = [...new Set(numbers)];
  for (let i = 0; i < list.length; i += 200) out.push(...await at.query(MOD, "Tickets", [{ op: "in", field: "ticketNumber", value: list.slice(i, i + 200) }], ["id", "ticketNumber", "companyID"]));
  return out;
}

async function loadClients(today) {
  const data = await contracts.load({}, today, today);
  const per = contracts.byCompany(today, data);
  const internal = Number(await setting("autotask.internal_company_id") || 0);
  if (internal) per.delete(internal);
  const ids = [...per.keys()];
  const companies = await at.queryIn(MOD, "Companies", "id", ids, ["id", "companyName", "ownerResourceID", "isActive"]);
  const owners = await at.queryIn(MOD, "Resources", "id", companies.map(c => c.ownerResourceID).filter(Boolean), ["id", "firstName", "lastName", "email"]);
  const ownerOf = new Map(owners.map(r => [Number(r.id), { id: Number(r.id), name: `${r.firstName || ""} ${r.lastName || ""}`.trim(), email: r.email ? String(r.email).toLowerCase() : null }]));
  return companies.filter(c => c.isActive !== false).map(c => ({
    id: Number(c.id), name: c.companyName || `Company ${c.id}`, owner: ownerOf.get(Number(c.ownerResourceID)) || null, ...per.get(Number(c.id)),
  }));
}

async function loadFeedback(clients, now) {
  const start = new Date(now.getTime() - KEEP_DAYS * DAY).toISOString();
  const responses = await simplesat.responses(start, now.toISOString(), { max: 300 });
  const rows = responses.flatMap(M.rowsFromResponse);
  // Which Autotask tickets and contacts SimpleSAT points at.
  const numbers = rows.map(r => r.ticket && r.ticket.number).filter(Boolean);
  const tIds = rows.map(r => r.ticket && r.ticket.id).filter(Boolean);
  const cIds = rows.map(r => r.contactRef).filter(Boolean);
  const [byNum, byId, contacts] = await Promise.all([
    numbers.length ? ticketsByNumber(numbers) : [],
    tIds.length ? at.queryIn(MOD, "Tickets", "id", tIds, ["id", "ticketNumber", "companyID"]) : [],
    cIds.length ? at.queryIn(MOD, "Contacts", "id", cIds, ["id", "companyID"]) : [],
  ]);
  const ticketCompany = new Map();
  for (const t of byNum) ticketCompany.set(String(t.ticketNumber).toUpperCase(), Number(t.companyID));
  for (const t of byId) ticketCompany.set(`id:${t.id}`, Number(t.companyID));
  const contactCompany = new Map(contacts.map(c => [Number(c.id), Number(c.companyID)]));
  const byName = new Map();
  for (const c of clients) { const n = M.normName(c.name); if (n && !byName.has(n)) byName.set(n, c.id); }
  let matched = 0;
  for (const r of rows) {
    const m = M.matchCompany(r, { ticketCompany, contactCompany, byName });
    r.companyId = m ? m.companyId : null; r.matchedBy = m ? m.by : null;
    if (m) matched++;
    r.ticketNumber = r.ticket ? (r.ticket.number || null) : null;
    if (!r.ticketNumber && r.ticket && r.ticket.id) { const t = byId.find(x => Number(x.id) === r.ticket.id); r.ticketNumber = t ? t.ticketNumber : null; }
  }
  return { rows, responses: responses.length, matched };
}

async function loadTickets(clientIds, now) {
  const since = new Date(now.getTime() - 90 * DAY).toISOString();
  const [priorities, statuses] = await Promise.all([at.picklist(MOD, "Tickets", "priority"), at.picklist(MOD, "Tickets", "status")]);
  const critical = new Set(priorities.filter(p => /critical|urgent|p1\b/i.test(p.label)).map(p => Number(p.value)));
  const complete = (statuses.find(s => /^complete/i.test(s.label)) || { value: 5 }).value;
  const fields = await at.known(MOD, "Tickets", ["id", "companyID", "createDate", "completedDate", "priority", "status", "serviceLevelAgreementHasBeenMet"]);
  const ids = new Set(clientIds);
  const [recent, open] = await Promise.all([
    at.query(MOD, "Tickets", [{ op: "gte", field: "createDate", value: since }], fields),
    at.query(MOD, "Tickets", [{ op: "noteq", field: "status", value: complete }, { op: "lt", field: "createDate", value: since }], fields),
  ]);
  const by = new Map();
  for (const t of [...recent, ...open]) {
    const cid = Number(t.companyID);
    if (!ids.has(cid)) continue;
    if (!by.has(cid)) by.set(cid, []);
    by.get(cid).push({
      createDate: t.createDate, completedDate: t.completedDate || null, critical: critical.has(Number(t.priority)),
      slaMet: t.serviceLevelAgreementHasBeenMet === false ? false : t.serviceLevelAgreementHasBeenMet === true ? true : null,
      open: Number(t.status) !== Number(complete),
    });
  }
  return { by, count: recent.length + open.length };
}

async function saveFeedback(rows) {
  await db.query("DELETE FROM pulse.client_feedback WHERE answered_at < DATEADD(day, -@keep, SYSUTCDATETIME())", { keep: KEEP_DAYS });
  for (const r of rows) {
    await db.query(`MERGE pulse.client_feedback AS t USING (SELECT @key AS feedback_key) AS s ON t.feedback_key = s.feedback_key
      WHEN MATCHED THEN UPDATE SET company_id = @companyId, matched_by = @matchedBy, rating = @rating, sentiment = @sentiment, comment = @comment,
        topics = @topics, contact_name = @contactName, team_member = @teamMember, ticket_number = @ticketNumber, ticket_subject = @ticketSubject, company_text = @companyText
      WHEN NOT MATCHED THEN INSERT (feedback_key, response_id, company_id, matched_by, metric, rating, sentiment, comment, topics, contact_name, team_member, ticket_number, ticket_subject, company_text, answered_at)
        VALUES (@key, @responseId, @companyId, @matchedBy, @metric, @rating, @sentiment, @comment, @topics, @contactName, @teamMember, @ticketNumber, @ticketSubject, @companyText, @answeredAt);`,
    { key: r.key, responseId: r.responseId, companyId: r.companyId, matchedBy: r.matchedBy, metric: r.metric, rating: r.rating, sentiment: r.sentiment,
      comment: r.comment, topics: r.topics, contactName: r.contactName, teamMember: r.teamMember, ticketNumber: r.ticketNumber, ticketSubject: r.ticketSubject,
      companyText: r.companyText, answeredAt: r.answeredAt });
  }
}

/** Works out every client's health and saves it. Returns the clients that newly moved into At risk. */
async function score(clients, feedbackRows, tickets, now) {
  const prior = new Map((await db.query("SELECT company_id, risk_level FROM pulse.client")).map(r => [Number(r.company_id), r.risk_level]));
  const fb = new Map();
  for (const r of feedbackRows) if (r.companyId) { if (!fb.has(r.companyId)) fb.set(r.companyId, []); fb.get(r.companyId).push(r); }
  const week = time.weekOf(now);
  const newlyAtRisk = [];
  for (const c of clients) {
    const feedback = fb.get(c.id) || [];
    const t = M.ticketFigures(tickets.by.get(c.id) || [], now);
    const f = M.feedbackFigures(feedback, now);
    const w = M.earlyWarning({ feedback, tickets: t, contractEnd: c.contractEnd }, now);
    if (w.level === "risk" && prior.has(c.id) && prior.get(c.id) !== "risk") newlyAtRisk.push({ ...c, ...w });
    const row = {
      id: c.id, name: c.name, ownerId: c.owner ? c.owner.id : null, ownerName: c.owner ? c.owner.name : null, ownerEmail: c.owner ? c.owner.email : null,
      mrr: c.mrr, seats: c.seats, contracts: c.contracts, contractEnd: c.contractEnd,
      score: w.score, level: w.level, reasons: JSON.stringify(w.reasons),
      happiness: f.happiness, ratings: f.ratings, ranked: f.ranked, csatPct: f.csatPct, csatN: f.csatN, nps: f.nps, npsN: f.npsN, lastFeedbackAt: f.lastFeedbackAt ? new Date(f.lastFeedbackAt) : null,
      tickets30: t.tickets30, ticketsBase: t.ticketsBase, slaMissed30: t.slaMissed30, critical30: t.critical30, agedOpen: t.agedOpen,
    };
    await db.query(`MERGE pulse.client AS t USING (SELECT @id AS company_id) AS s ON t.company_id = s.company_id
      WHEN MATCHED THEN UPDATE SET name = @name, owner_resource_id = @ownerId, owner_name = @ownerName, owner_email = @ownerEmail, mrr = @mrr, seats = @seats,
        contracts = @contracts, contract_end = @contractEnd, risk_score = @score, risk_level = @level, reasons_json = @reasons, happiness = @happiness, ratings = @ratings,
        ranked = @ranked, csat_pct = @csatPct, csat_n = @csatN, nps = @nps, nps_n = @npsN, last_feedback_at = @lastFeedbackAt, tickets_30 = @tickets30,
        tickets_base = @ticketsBase, sla_missed_30 = @slaMissed30, critical_30 = @critical30, aged_open = @agedOpen, is_current = 1, computed_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (company_id, name, owner_resource_id, owner_name, owner_email, mrr, seats, contracts, contract_end, risk_score, risk_level, reasons_json,
        happiness, ratings, ranked, csat_pct, csat_n, nps, nps_n, last_feedback_at, tickets_30, tickets_base, sla_missed_30, critical_30, aged_open, is_current, computed_at)
        VALUES (@id, @name, @ownerId, @ownerName, @ownerEmail, @mrr, @seats, @contracts, @contractEnd, @score, @level, @reasons, @happiness, @ratings, @ranked, @csatPct, @csatN,
        @nps, @npsN, @lastFeedbackAt, @tickets30, @ticketsBase, @slaMissed30, @critical30, @agedOpen, 1, SYSUTCDATETIME());`, row);
    await db.query(`MERGE pulse.client_week AS t USING (SELECT @id AS company_id, @week AS week) AS s ON t.company_id = s.company_id AND t.week = s.week
      WHEN MATCHED THEN UPDATE SET risk_score = @score, happiness = @happiness
      WHEN NOT MATCHED THEN INSERT (company_id, week, risk_score, happiness) VALUES (@id, @week, @score, @happiness);`, { id: c.id, week, score: w.score, happiness: f.happiness });
  }
  // Clients no longer under a recurring contract stay for their history but leave the lists.
  const ids = clients.map(c => c.id);
  if (ids.length) await db.query(`UPDATE pulse.client SET is_current = 0 WHERE company_id NOT IN (${ids.map(Number).join(",")})`);
  return newlyAtRisk;
}

async function syncClients({ now = new Date(), alert = require("../notify").clientAlerts } = {}) {
  const today = time.sydneyDate(now);
  const clients = await loadClients(today);
  let fb = { rows: [], responses: 0, matched: 0 }, fbNote = "";
  try { fb = await loadFeedback(clients, now); }
  catch (e) { if (e.code !== "not-connected") throw e; fbNote = "SimpleSAT not connected; "; }
  const tickets = await loadTickets(clients.map(c => c.id), now);
  if (fb.rows.length) await saveFeedback(fb.rows);
  const stored = fb.rows.length ? fb.rows : (await db.query("SELECT * FROM pulse.client_feedback WHERE company_id IS NOT NULL")).map(fromDb);
  const newlyAtRisk = await score(clients, stored, tickets, now);
  let alerts = "";
  if (newlyAtRisk.length && alert) alerts = `; alerts: ${await alert(newlyAtRisk).catch(e => `failed (${e.message})`)}`;
  const counts = { risk: 0, watch: 0 };
  for (const c of await db.query("SELECT risk_level, COUNT(*) AS n FROM pulse.client WHERE is_current = 1 GROUP BY risk_level")) counts[c.risk_level] = c.n;
  const unmatched = fb.rows.filter(r => !r.companyId).length;
  return `${clients.length} clients; ${fbNote}${fb.responses} SimpleSAT responses, ${fb.rows.length} ratings, ${fb.matched} matched to a client` +
    `${unmatched ? ` (${unmatched} not matched)` : ""}; ${tickets.count} tickets read; ${counts.risk || 0} at risk, ${counts.watch || 0} to watch${alerts}`;
}

/** A stored feedback row in the model's shape. */
const fromDb = r => ({ key: r.feedback_key, responseId: r.response_id, companyId: r.company_id, metric: r.metric, rating: r.rating, sentiment: r.sentiment,
  comment: r.comment, topics: r.topics, contactName: r.contact_name, teamMember: r.team_member, ticketNumber: r.ticket_number, ticketSubject: r.ticket_subject,
  answeredAt: r.answered_at, matchedBy: r.matched_by });

module.exports = { syncClients, fromDb, _test: { loadTickets } };
