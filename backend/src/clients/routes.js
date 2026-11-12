"use strict";
/**
 * Client health API (0.10.0, D23). Leadership, Sales & Marketing and Managed Services.
 *
 *   GET  /clients?owner=me|all|<email>    Early Warning list, summary and the happiness leaderboards
 *   GET  /clients/:id                     one client: score breakdown, feedback, tickets, trend, notes
 *   POST /clients/:id/notes  { note }     an Account Manager's follow-up note
 *   POST /clients/:id/issue  { title, description, level }   raise an Issue (Sales & Marketing list by default)
 *   POST /clients/refresh                 ask the sync service to work it out again now
 *
 * MRR is left out unless the person can see it (Leadership, Sales & Marketing).
 */
const db = require("../lib/sql");
const C = require("../eos/common");
const { autotaskUrl, webUrl } = require("../eos/links");

function guard(ctx) {
  if (!ctx.access.viewClients) throw C.fail(403, "Client health is for Leadership, Sales & Marketing and Managed Services.");
}
const parse = s => { try { return JSON.parse(s || "[]"); } catch { return []; } };
const num = v => (v === null || v === undefined ? null : Number(v));
const iso = d => (d ? new Date(d).toISOString() : null);
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : null);

function shape(ctx, r, extra = {}) {
  const mrr = ctx.access.clientMrr;
  return {
    id: r.company_id, name: r.name,
    owner: r.owner_name || r.owner_email ? { name: r.owner_name, email: r.owner_email, isMe: C.isMe(ctx, r.owner_email) } : null,
    level: r.risk_level, score: r.risk_score, reasons: parse(r.reasons_json),
    happiness: num(r.happiness), ratings: r.ratings, ranked: !!r.ranked, csatPct: num(r.csat_pct), csatN: r.csat_n, nps: r.nps, npsN: r.nps_n,
    lastFeedbackAt: iso(r.last_feedback_at),
    tickets: { last30: r.tickets_30, monthBefore: num(r.tickets_base), slaMissed30: r.sla_missed_30, critical30: r.critical_30, agedOpen: r.aged_open },
    mrr: mrr ? num(r.mrr) : undefined, seats: r.seats, contractEnd: day(r.contract_end),
    ...extra,
  };
}

async function lastRun() {
  const [r] = await db.query("SELECT TOP 1 started_at, finished_at, ok, detail FROM pulse.sync_run WHERE job IN (N'clients') ORDER BY id DESC");
  return r ? { at: iso(r.finished_at || r.started_at), ok: r.ok === null ? null : !!r.ok, detail: r.detail } : null;
}

async function list(ctx) {
  guard(ctx);
  const rows = await db.query("SELECT * FROM pulse.client WHERE is_current = 1");
  const owners = new Map();
  for (const r of rows) if (r.owner_email) {
    const o = owners.get(r.owner_email) || { email: r.owner_email, name: r.owner_name || r.owner_email, clients: 0, isMe: C.isMe(ctx, r.owner_email) };
    o.clients++; owners.set(r.owner_email, o);
  }
  const mine = rows.some(r => C.isMe(ctx, r.owner_email));
  const want = String(ctx.query.owner || (mine ? "me" : "all")).toLowerCase();
  const picked = want === "all" ? rows : want === "me" ? rows.filter(r => C.isMe(ctx, r.owner_email)) : rows.filter(r => String(r.owner_email || "").toLowerCase() === want);

  // Four weeks ago, for the trend arrow.
  const weeks = await db.query("SELECT company_id, risk_score FROM pulse.client_week WHERE week = (SELECT MAX(week) FROM pulse.client_week WHERE week <= DATEADD(day, -28, CAST(SYSUTCDATETIME() AS date)))");
  const then = new Map(weeks.map(w => [w.company_id, w.risk_score]));
  const issues = await db.query("SELECT id, source_id, title FROM pulse.issue WHERE source_kind = N'client' AND status = N'open'");
  const issueOf = new Map(issues.map(i => [i.source_id, { id: i.id, title: i.title }]));

  const clients = picked.map(r => shape(ctx, r, { change: then.has(r.company_id) ? r.risk_score - then.get(r.company_id) : null, issue: issueOf.get(r.company_id) || null }))
    .sort((a, b) => b.score - a.score || (b.mrr || 0) - (a.mrr || 0) || a.name.localeCompare(b.name));

  // Company-wide feedback for the chosen clients: CSAT over 90 days, NPS over 180 (as the Scorecard counts them).
  const ids = picked.map(r => Number(r.company_id));
  let csat = null, nps = null;
  if (ids.length) {
    const fb = await db.query(`SELECT metric, rating, sentiment, answered_at FROM pulse.client_feedback
      WHERE company_id IN (${ids.join(",")}) AND answered_at >= DATEADD(day, -180, SYSUTCDATETIME())`);
    const M = require("./model");
    const c90 = fb.filter(f => f.metric === "csat" && M.csatKind(f) && Date.now() - new Date(f.answered_at) <= 90 * 864e5);
    csat = c90.length ? { pct: Math.round(c90.filter(f => M.csatKind(f) === "positive").length / c90.length * 1000) / 10, n: c90.length } : null;
    const n = fb.filter(f => f.metric === "nps" && f.rating !== null);
    nps = n.length ? { score: Math.round((n.filter(f => f.rating >= 9).length - n.filter(f => f.rating <= 6).length) / n.length * 100), n: n.length } : null;
  }
  const at = l => clients.filter(c => c.level === l);
  const ranked = clients.filter(c => c.ranked && c.happiness !== null);
  const boards = require("./model").leaderboards(clients, 10);
  return {
    owner: want, owners: [...owners.values()].sort((a, b) => b.isMe - a.isMe || a.name.localeCompare(b.name)),
    canSeeMrr: !!ctx.access.clientMrr, lastRun: await lastRun(),
    summary: {
      clients: clients.length, risk: at("risk").length, watch: at("watch").length, healthy: at("healthy").length,
      mrrAtRisk: ctx.access.clientMrr ? Math.round(at("risk").reduce((s, c) => s + (c.mrr || 0), 0)) : undefined,
      happiness: ranked.length ? Math.round(ranked.reduce((s, c) => s + c.happiness, 0) / ranked.length) : null,
      csat, nps, withFeedback: clients.filter(c => c.ratings > 0).length,
    },
    clients,
    leaderboards: { ...boards, minRatings: 3 },
  };
}

async function detail(ctx) {
  guard(ctx);
  const id = C.int(ctx.params.id, "Client");
  const [r] = await db.query("SELECT * FROM pulse.client WHERE company_id = @id", { id });
  if (!r) throw C.fail(404, "That client isn't in Pulse (only clients with a recurring contract are).");
  const [feedback, history, notes, issues] = await Promise.all([
    db.query(`SELECT TOP 100 * FROM pulse.client_feedback WHERE company_id = @id AND answered_at >= DATEADD(day, -365, SYSUTCDATETIME()) ORDER BY answered_at DESC`, { id }),
    db.query("SELECT TOP 13 week, risk_score, happiness FROM pulse.client_week WHERE company_id = @id ORDER BY week DESC", { id }),
    db.query("SELECT TOP 50 id, note, author_name, created_at FROM pulse.client_note WHERE company_id = @id ORDER BY created_at DESC", { id }),
    db.query("SELECT id, title, status, level, division_code FROM pulse.issue WHERE source_kind = N'client' AND source_id = @id ORDER BY id DESC", { id }),
  ]);
  // Who looked at a client's feedback (it holds the client contacts' names and comments).
  await C.record(ctx, "client.view", { type: "client", id });
  return {
    ...shape(ctx, r),
    autotaskUrl: autotaskUrl(await webUrl(), "company", id),
    computedAt: iso(r.computed_at),
    history: history.reverse().map(h => ({ week: day(h.week), score: h.risk_score, happiness: num(h.happiness) })),
    feedback: feedback.map(f => ({ at: iso(f.answered_at), metric: f.metric, rating: f.rating, sentiment: f.sentiment, comment: f.comment, topics: f.topics,
      contactName: f.contact_name, teamMember: f.team_member, ticketNumber: f.ticket_number, ticketSubject: f.ticket_subject, matchedBy: f.matched_by })),
    notes: notes.map(n => ({ id: n.id, note: n.note, by: n.author_name, at: iso(n.created_at) })),
    issues: issues.map(i => ({ id: i.id, title: i.title, status: i.status, level: i.level, division: i.division_code })),
  };
}

async function addNote(ctx) {
  guard(ctx);
  const id = C.int(ctx.params.id, "Client");
  const [r] = await db.query("SELECT company_id FROM pulse.client WHERE company_id = @id", { id });
  if (!r) throw C.fail(404, "That client isn't in Pulse.");
  const note = C.text(ctx.body.note, 2000, { required: true, label: "Note" });
  const [{ id: noteId }] = await db.query("INSERT INTO pulse.client_note (company_id, note, author_oid, author_name) OUTPUT inserted.id VALUES (@id, @note, @oid, @name)",
    { id, note, oid: ctx.person.oid, name: ctx.person.name });
  await C.record(ctx, "client.note", { type: "client", id }, null, { noteId });
  return { id: noteId };
}

async function raiseIssue(ctx) {
  guard(ctx);
  const id = C.int(ctx.params.id, "Client");
  const [r] = await db.query("SELECT company_id, name, risk_score, risk_level, reasons_json FROM pulse.client WHERE company_id = @id", { id });
  if (!r) throw C.fail(404, "That client isn't in Pulse.");
  const [open] = await db.query("SELECT TOP 1 id, title FROM pulse.issue WHERE source_kind = N'client' AND source_id = @id AND status = N'open'", { id });
  if (open) throw C.fail(409, `"${open.title}" is already open for this client.`);
  const level = ctx.body.level === "company" ? "company" : "division";
  if (level === "company" && !ctx.access.leadership) throw C.fail(403, "Only Leadership adds Issues to the company list.");
  const division = level === "division" ? C.division(ctx.body.division || "SalesMarketing") : null;
  if (division && !C.seesDivision(ctx, division)) throw C.fail(403, "You can't add Issues to that division's list.");
  const reasons = parse(r.reasons_json).map(x => `• ${x.text}`).join("\n");
  const row = {
    level, division, title: C.text(ctx.body.title || `${r.name}: client at risk`, 300, { required: true, label: "Issue" }),
    description: C.text(ctx.body.description || `Early Warning score ${r.risk_score} (${r.risk_level === "risk" ? "At risk" : r.risk_level === "watch" ? "Watch" : "Healthy"}).\n${reasons}`, 4000),
    by: ctx.person.name, oid: ctx.person.oid, ownerName: ctx.person.name, ownerEmail: ctx.person.email || null, id,
  };
  const [{ id: issueId }] = await db.query(
    `INSERT INTO pulse.issue (level, division_code, title, description, owner_name, owner_email, raised_by_name, raised_by_oid, source_kind, source_id)
     OUTPUT inserted.id VALUES (@level, @division, @title, @description, @ownerName, @ownerEmail, @by, @oid, N'client', @id)`, row);
  await C.record(ctx, "issue.create", { type: "issue", id: issueId }, null, { ...row, from: "client health" });
  return { id: issueId, level, division };
}

async function refresh(ctx) {
  guard(ctx);
  const [pending] = await db.query("SELECT TOP 1 id FROM pulse.sync_request WHERE job = N'clients' AND picked_at IS NULL AND requested_at > DATEADD(hour, -1, SYSUTCDATETIME())");
  if (!pending) await db.query("INSERT INTO pulse.sync_request (job, requested_by) VALUES (N'clients', @by)", { by: ctx.person.name });
  return { ok: true };
}

const routes = [
  { method: "GET", path: "/clients", auth: "person", fn: list },
  { method: "POST", path: "/clients/refresh", auth: "person", fn: refresh },
  { method: "GET", path: "/clients/:id", auth: "person", fn: detail },
  { method: "POST", path: "/clients/:id/notes", auth: "person", fn: addNote },
  { method: "POST", path: "/clients/:id/issue", auth: "person", fn: raiseIssue },
];
module.exports = { routes };
