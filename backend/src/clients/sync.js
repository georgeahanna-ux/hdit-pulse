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

/**
 * The first run reads 400 days of responses; later runs read from 14 days before the newest
 * rating Pulse already has (late comments and edits land inside that overlap).
 */
async function loadFeedback(clients, now) {
  // Incremental only once a full read has been saved (a run cut short must not leave a gap).
  const done = await setting("clients.feedback_full_at");
  const [last] = done ? await db.query("SELECT MAX(answered_at) AS at FROM pulse.client_feedback") : [null];
  const full = new Date(now.getTime() - KEEP_DAYS * DAY);
  const from = last && last.at ? new Date(Math.max(full.getTime(), new Date(last.at).getTime() - 14 * DAY)) : full;
  const responses = await simplesat.responses(from.toISOString(), now.toISOString(), { max: 1000 });
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
  return { rows, responses: responses.length, matched, byName, from, full: from.getTime() === full.getTime() };
}

/**
 * Tickets the client raised: Autotask alerts and monitoring tickets (RMM, backup and the like)
 * are left out, because a burst of alerts says nothing about how the client feels.
 */
async function loadTickets(clientIds, now) {
  const since = new Date(now.getTime() - 90 * DAY).toISOString();
  const [priorities, statuses, types, sources] = await Promise.all([at.picklist(MOD, "Tickets", "priority"), at.picklist(MOD, "Tickets", "status"),
    at.picklist(MOD, "Tickets", "ticketType").catch(() => []), at.picklist(MOD, "Tickets", "source").catch(() => [])]);
  const critical = new Set(priorities.filter(p => /critical|urgent|p1\b/i.test(p.label)).map(p => Number(p.value)));
  const complete = (statuses.find(s => /^complete/i.test(s.label)) || { value: 5 }).value;
  const alertTypes = new Set(types.filter(t => /alert/i.test(t.label)).map(t => Number(t.value)));
  const alertSources = new Set(sources.filter(t => /monitor|alert|rmm|backup|insight|datto|automat|system/i.test(t.label)).map(t => Number(t.value)));
  const fields = await at.known(MOD, "Tickets", ["id", "companyID", "createDate", "completedDate", "priority", "status", "serviceLevelAgreementHasBeenMet", "ticketType", "source"]);
  const ids = new Set(clientIds);
  const [recent, open] = await Promise.all([
    at.query(MOD, "Tickets", [{ op: "gte", field: "createDate", value: since }], fields),
    at.query(MOD, "Tickets", [{ op: "noteq", field: "status", value: complete }, { op: "lt", field: "createDate", value: since }], fields),
  ]);
  const by = new Map();
  let alerts = 0;
  for (const t of [...recent, ...open]) {
    const cid = Number(t.companyID);
    if (!ids.has(cid)) continue;
    if (alertTypes.has(Number(t.ticketType)) || alertSources.has(Number(t.source))) { alerts++; continue; }
    if (!by.has(cid)) by.set(cid, []);
    by.get(cid).push({
      createDate: t.createDate, completedDate: t.completedDate || null, critical: critical.has(Number(t.priority)),
      slaMet: t.serviceLevelAgreementHasBeenMet === false ? false : t.serviceLevelAgreementHasBeenMet === true ? true : null,
      open: Number(t.status) !== Number(complete),
    });
  }
  const kept = [...by.values()].reduce((n, l) => n + l.length, 0);
  return { by, count: recent.length + open.length, kept, alerts,
    alertLabels: [...types.filter(t => alertTypes.has(Number(t.value))), ...sources.filter(t => alertSources.has(Number(t.value)))].map(t => t.label) };
}

/** Saves ratings 500 at a time (one MERGE per batch, from JSON), and drops those older than 400 days. */
async function saveFeedback(rows) {
  await db.query("DELETE FROM pulse.client_feedback WHERE answered_at < DATEADD(day, -@keep, SYSUTCDATETIME())", { keep: KEEP_DAYS });
  await db.query("UPDATE pulse.client_feedback SET company_id = NULL, matched_by = NULL WHERE company_id = 0");   // HD IT's own company (from 0.10.0's first run)
  for (let i = 0; i < rows.length; i += 500) {
    const json = JSON.stringify(rows.slice(i, i + 500).map(r => ({
      k: r.key, rid: r.responseId, cid: r.companyId, by: r.matchedBy, m: r.metric, rt: r.rating, s: r.sentiment, c: r.comment, tp: r.topics,
      cn: r.contactName, tm: r.teamMember, tn: r.ticketNumber, ts: r.ticketSubject, ct: r.companyText, at: r.answeredAt.toISOString(),
    })));
    await db.query(`MERGE pulse.client_feedback AS t
      USING (SELECT * FROM OPENJSON(@json) WITH (k NVARCHAR(60), rid NVARCHAR(40), cid INT, [by] NVARCHAR(10), m NVARCHAR(10), rt INT, s NVARCHAR(10),
        c NVARCHAR(1000), tp NVARCHAR(400), cn NVARCHAR(200), tm NVARCHAR(200), tn NVARCHAR(30), ts NVARCHAR(300), ct NVARCHAR(200), [at] DATETIME2(0))) AS s
      ON t.feedback_key = s.k
      WHEN MATCHED THEN UPDATE SET company_id = s.cid, matched_by = s.[by], rating = s.rt, sentiment = s.s, comment = s.c, topics = s.tp,
        contact_name = s.cn, team_member = s.tm, ticket_number = s.tn, ticket_subject = s.ts, company_text = s.ct
      WHEN NOT MATCHED THEN INSERT (feedback_key, response_id, company_id, matched_by, metric, rating, sentiment, comment, topics, contact_name, team_member, ticket_number, ticket_subject, company_text, answered_at)
        VALUES (s.k, s.rid, s.cid, s.[by], s.m, s.rt, s.s, s.c, s.tp, s.cn, s.tm, s.tn, s.ts, s.ct, s.[at]);`, { json });
  }
}

/** Ratings saved before that matched no client: try the company name again (a client may be new). */
async function rematchByName(byName) {
  const rows = await db.query("SELECT feedback_key, company_text FROM pulse.client_feedback WHERE company_id IS NULL AND company_text IS NOT NULL");
  const hits = rows.map(r => ({ k: r.feedback_key, cid: byName.get(M.normName(r.company_text)) })).filter(h => h.cid);
  for (let i = 0; i < hits.length; i += 500)
    await db.query(`UPDATE f SET company_id = s.cid, matched_by = N'name' FROM pulse.client_feedback f
      JOIN OPENJSON(@json) WITH (k NVARCHAR(60), cid INT) s ON f.feedback_key = s.k`, { json: JSON.stringify(hits.slice(i, i + 500)) });
  return hits.length;
}

/** Works out every client's health and saves it. Returns the clients that newly moved into At risk. */
async function score(clients, feedbackRows, tickets, now) {
  const prior = new Map((await db.query("SELECT company_id, risk_level FROM pulse.client")).map(r => [Number(r.company_id), r.risk_level]));
  const fb = new Map();
  for (const r of feedbackRows) if (r.companyId) { if (!fb.has(r.companyId)) fb.set(r.companyId, []); fb.get(r.companyId).push(r); }
  const week = time.weekOf(now);
  const newlyAtRisk = [], out = [];
  for (const c of clients) {
    const feedback = fb.get(c.id) || [];
    const t = M.ticketFigures(tickets.by.get(c.id) || [], now);
    const f = M.feedbackFigures(feedback, now);
    const w = M.earlyWarning({ feedback, tickets: t, contractEnd: c.contractEnd }, now);
    if (w.level === "risk" && prior.has(c.id) && prior.get(c.id) !== "risk") newlyAtRisk.push({ ...c, ...w });
    out.push({
      id: c.id, name: c.name, ownerId: c.owner ? c.owner.id : null, ownerName: c.owner ? c.owner.name : null, ownerEmail: c.owner ? c.owner.email : null,
      mrr: c.mrr, seats: c.seats, contracts: c.contracts, contractEnd: c.contractEnd,
      score: w.score, level: w.level, reasons: JSON.stringify(w.reasons),
      happiness: f.happiness, ratings: f.ratings, ranked: f.ranked ? 1 : 0, csatPct: f.csatPct, csatN: f.csatN, nps: f.nps, npsN: f.npsN,
      lastFeedbackAt: f.lastFeedbackAt ? new Date(f.lastFeedbackAt).toISOString() : null,
      tickets30: t.tickets30, ticketsBase: t.ticketsBase, slaMissed30: t.slaMissed30, critical30: t.critical30, agedOpen: t.agedOpen,
    });
  }
  const W = `id INT, name NVARCHAR(200), ownerId INT, ownerName NVARCHAR(200), ownerEmail NVARCHAR(320), mrr DECIMAL(12,2), seats INT, contracts INT,
    contractEnd DATE, score INT, level NVARCHAR(10), reasons NVARCHAR(MAX), happiness DECIMAL(5,1), ratings INT, ranked BIT, csatPct DECIMAL(5,1), csatN INT,
    nps INT, npsN INT, lastFeedbackAt DATETIME2(0), tickets30 INT, ticketsBase DECIMAL(6,1), slaMissed30 INT, critical30 INT, agedOpen INT`;
  for (let i = 0; i < out.length; i += 200) {
    const json = JSON.stringify(out.slice(i, i + 200));
    await db.query(`MERGE pulse.client AS t USING (SELECT * FROM OPENJSON(@json) WITH (${W})) AS s ON t.company_id = s.id
      WHEN MATCHED THEN UPDATE SET name = s.name, owner_resource_id = s.ownerId, owner_name = s.ownerName, owner_email = s.ownerEmail, mrr = s.mrr, seats = s.seats,
        contracts = s.contracts, contract_end = s.contractEnd, risk_score = s.score, risk_level = s.level, reasons_json = s.reasons, happiness = s.happiness, ratings = s.ratings,
        ranked = s.ranked, csat_pct = s.csatPct, csat_n = s.csatN, nps = s.nps, nps_n = s.npsN, last_feedback_at = s.lastFeedbackAt, tickets_30 = s.tickets30,
        tickets_base = s.ticketsBase, sla_missed_30 = s.slaMissed30, critical_30 = s.critical30, aged_open = s.agedOpen, is_current = 1, computed_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (company_id, name, owner_resource_id, owner_name, owner_email, mrr, seats, contracts, contract_end, risk_score, risk_level, reasons_json,
        happiness, ratings, ranked, csat_pct, csat_n, nps, nps_n, last_feedback_at, tickets_30, tickets_base, sla_missed_30, critical_30, aged_open, is_current, computed_at)
        VALUES (s.id, s.name, s.ownerId, s.ownerName, s.ownerEmail, s.mrr, s.seats, s.contracts, s.contractEnd, s.score, s.level, s.reasons, s.happiness, s.ratings, s.ranked,
        s.csatPct, s.csatN, s.nps, s.npsN, s.lastFeedbackAt, s.tickets30, s.ticketsBase, s.slaMissed30, s.critical30, s.agedOpen, 1, SYSUTCDATETIME());`, { json });
    await db.query(`MERGE pulse.client_week AS t USING (SELECT id, score, happiness FROM OPENJSON(@json) WITH (id INT, score INT, happiness DECIMAL(5,1))) AS s
      ON t.company_id = s.id AND t.week = @week
      WHEN MATCHED THEN UPDATE SET risk_score = s.score, happiness = s.happiness
      WHEN NOT MATCHED THEN INSERT (company_id, week, risk_score, happiness) VALUES (s.id, @week, s.score, s.happiness);`, { json, week });
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
  if (fb.full && fb.responses) await db.query(`MERGE pulse.app_setting AS t USING (SELECT N'clients.feedback_full_at' AS [key]) AS s ON t.[key] = s.[key]
    WHEN MATCHED THEN UPDATE SET [value] = @v, updated_by = N'clients job' WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], @v, N'clients job');`, { v: now.toISOString() });
  const rematched = fb.byName ? await rematchByName(fb.byName) : 0;
  const stored = (await db.query("SELECT * FROM pulse.client_feedback WHERE company_id IS NOT NULL")).map(fromDb);
  const newlyAtRisk = await score(clients, stored, tickets, now);
  let alerts = "";
  if (newlyAtRisk.length && alert) alerts = `; alerts: ${await alert(newlyAtRisk).catch(e => `failed (${e.message})`)}`;
  const counts = { risk: 0, watch: 0 };
  for (const c of await db.query("SELECT risk_level, COUNT(*) AS n FROM pulse.client WHERE is_current = 1 GROUP BY risk_level")) counts[c.risk_level] = c.n;
  const unmatched = fb.rows.filter(r => !r.companyId).length;
  return `${clients.length} clients; ${fbNote}${fb.responses} SimpleSAT responses${fb.from ? ` since ${fb.from.toISOString().slice(0, 10)}` : ""}, ${fb.rows.length} ratings, ${fb.matched} matched to a client` +
    `${unmatched ? ` (${unmatched} not matched)` : ""}${rematched ? `, ${rematched} earlier ones matched by name` : ""}; ${stored.length} ratings kept; ${tickets.count} tickets read, ${tickets.kept} raised by clients (${tickets.alerts} alerts left out${tickets.alertLabels.length ? `: ${tickets.alertLabels.slice(0, 6).join(", ")}` : ""}); ${counts.risk || 0} at risk, ${counts.watch || 0} to watch${alerts}`;
}

/** A stored feedback row in the model's shape. */
const fromDb = r => ({ key: r.feedback_key, responseId: r.response_id, companyId: r.company_id, metric: r.metric, rating: r.rating, sentiment: r.sentiment,
  comment: r.comment, topics: r.topics, contactName: r.contact_name, teamMember: r.team_member, ticketNumber: r.ticket_number, ticketSubject: r.ticket_subject,
  answeredAt: r.answered_at, matchedBy: r.matched_by });

module.exports = { syncClients, fromDb, _test: { loadTickets } };
