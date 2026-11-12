"use strict";
// Client health and the Early Warning (0.10.0, D23).
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/clients/model");
const contracts = require("../src/collect/contracts");
const access = require("../src/lib/access");

const NOW = new Date("2026-11-12T03:00:00Z");
const daysAgo = n => new Date(NOW.getTime() - n * 86400e3).toISOString();
const fb = (metric, rating, days, extra = {}) => ({ metric, rating, answeredAt: daysAgo(days), responseId: `r${Math.random()}`, ...extra });

test("a happy client with quiet tickets is Healthy with no reasons", () => {
  const feedback = [fb("csat", 5, 10, { sentiment: "positive" }), fb("csat", 5, 40, { sentiment: "positive" }), fb("nps", 10, 20)];
  const t = M.ticketFigures([{ createDate: daysAgo(5), open: false, completedDate: daysAgo(4), slaMet: true }], NOW);
  const w = M.earlyWarning({ feedback, tickets: t, contractEnd: "2027-06-30" }, NOW);
  assert.equal(w.score, 0); assert.equal(w.level, "healthy"); assert.deepEqual(w.reasons, []);
  const f = M.feedbackFigures(feedback, NOW);
  assert.equal(f.happiness, 100); assert.equal(f.ranked, true); assert.equal(f.csatPct, 100); assert.equal(f.nps, 100);
});

test("a detractor, unhappy CSAT and missed SLAs add up to At risk, biggest reason first", () => {
  const feedback = [fb("nps", 3, 15, { contactName: "Jane Smith" }), fb("csat", 1, 20, { sentiment: "negative" }), fb("csat", 2, 50, { sentiment: "negative" })];
  const tickets = { tickets30: 4, ticketsBase: 3, slaMissed30: 2, critical30: 0, agedOpen: 0 };
  const w = M.earlyWarning({ feedback, tickets }, NOW);
  assert.equal(w.score, 30 + 24 + 10);
  assert.equal(w.level, "risk");
  assert.equal(w.reasons[0].key, "nps-detractor");
  assert.match(w.reasons[0].text, /NPS of 3 from Jane Smith/);
  assert.deepEqual(w.reasons.map(r => r.key), ["nps-detractor", "csat-negative", "sla-missed"]);
});

test("only the latest NPS in 180 days counts: a detractor who later became a promoter isn't a warning", () => {
  const w = M.earlyWarning({ feedback: [fb("nps", 2, 100), fb("nps", 9, 10)] }, NOW);
  assert.equal(w.score, 0);
  assert.equal(M.earlyWarning({ feedback: [fb("nps", 2, 200)] }, NOW).score, 0, "older than 180 days");
  assert.equal(M.earlyWarning({ feedback: [fb("nps", 7, 30)] }, NOW).score, 10, "passive");
});

test("caps: negative CSAT up to 36, SLA up to 15, critical up to 10; the total up to 100", () => {
  const feedback = Array.from({ length: 6 }, (_, i) => fb("csat", 1, i + 1, { sentiment: "negative" })).concat([fb("nps", 0, 3)]);
  const tickets = { tickets30: 40, ticketsBase: 5, slaMissed30: 9, critical30: 7, agedOpen: 12 };   // a spike
  const w = M.earlyWarning({ feedback, tickets, contractEnd: "2026-11-30" }, NOW);
  const pts = Object.fromEntries(w.reasons.map(r => [r.key, r.points]));
  assert.equal(pts["csat-negative"], 36); assert.equal(pts["sla-missed"], 15); assert.equal(pts.critical, 10);
  assert.equal(pts["aged-open"], 10); assert.equal(pts["ticket-spike"], 15); assert.equal(pts["contract-ending"], 20);
  assert.equal(w.score, 100);
});

test("ticket spike needs 8+ tickets, double the month before and 5 more than it", () => {
  const spike = (t, base) => M.earlyWarning({ tickets: { tickets30: t, ticketsBase: base } }, NOW).reasons.some(r => r.key === "ticket-spike");
  assert.equal(spike(7, 2), false, "fewer than 8"); assert.equal(spike(8, 3), true); assert.equal(spike(8, 4.5), false, "not double");
  assert.equal(spike(20, 12), false, "not double"); assert.equal(spike(24, 12), true);
  assert.equal(spike(8, 0), true, "a new flood from nothing");
});

test("contract ending: within 30 days +20, within 90 +15, later or already past nothing", () => {
  const pts = end => (M.earlyWarning({ contractEnd: end }, NOW).reasons[0] || { points: 0 }).points;
  assert.equal(pts("2026-11-30"), 20); assert.equal(pts("2027-01-20"), 15); assert.equal(pts("2027-06-30"), 0); assert.equal(pts("2026-10-01"), 0);
});

test("CSAT falling and gone quiet", () => {
  const before = [1, 2, 3, 4].map(i => fb("csat", 5, 120 + i * 20, { sentiment: "positive" }));
  const recent = [fb("csat", 5, 10, { sentiment: "positive" }), fb("csat", 3, 20, { sentiment: "neutral" }), fb("csat", 3, 30, { sentiment: "neutral" })];
  const keys = M.earlyWarning({ feedback: [...before, ...recent] }, NOW).reasons.map(r => r.key);
  assert.ok(keys.includes("csat-falling")); assert.ok(keys.includes("csat-neutral"));
  const quiet = M.earlyWarning({ feedback: before, tickets: { tickets30: 2 } }, NOW).reasons.map(r => r.key);
  assert.deepEqual(quiet, ["gone-quiet"]);
  assert.deepEqual(M.earlyWarning({ feedback: before, tickets: { tickets30: 0 } }, NOW).reasons, [], "no tickets either: nothing to say");
});

test("happiness weights recent ratings more and needs 3 ratings to be ranked", () => {
  const f = M.feedbackFigures([fb("csat", 1, 1, { sentiment: "negative" }), fb("csat", 5, 240, { sentiment: "positive" })], NOW);
  assert.ok(f.happiness < 30, `recent unhappy rating dominates (${f.happiness})`);
  assert.equal(f.ranked, false);
  const h = M.feedbackFigures([fb("nps", 8, 1), fb("nps", 8, 2), fb("csat", 3, 3)], NOW).happiness;
  assert.ok(Math.abs(h - 70) < 0.5, `NPS 8, 8 and a neutral CSAT ≈ 70 (${h})`);
  assert.equal(M.feedbackFigures([fb("csat", 5, 400)], NOW).ratings, 0, "older than a year");
});

test("ticket figures: 30 days, the month before, SLA misses on closed tickets, critical, open over 14 days", () => {
  const t = M.ticketFigures([
    { createDate: daysAgo(2), critical: true, open: true },
    { createDate: daysAgo(20), completedDate: daysAgo(18), slaMet: false, open: false },
    { createDate: daysAgo(40), completedDate: daysAgo(25), slaMet: false, open: false },
    { createDate: daysAgo(50), open: true },
    { createDate: daysAgo(70), completedDate: daysAgo(60), slaMet: false, open: false },
    { createDate: daysAgo(200), open: true },
  ], NOW);
  assert.deepEqual(t, { tickets30: 2, ticketsBase: 1.5, slaMissed30: 2, critical30: 1, agedOpen: 2 });
});

test("SimpleSAT responses become one row per rating, with no email addresses", () => {
  const rows = M.rowsFromResponse({
    id: 991, created: "2026-11-10T01:00:00Z",
    customer: { name: "Jane Smith", email: "jane@client.com.au", company: "Acme Pty Ltd", external_id: "30123" },
    ticket: { external_id: "T20261103.0042", subject: "Printer offline" },
    team_members: [{ name: "Riley Tech", is_primary: true, email: "riley@hdit.com.au" }],
    answers: [
      { question: { metric: "csat" }, choice: 2, sentiment: "negative", comment: "Took three days", topics: [{ name: "Response time" }] },
      { question: { metric: "" }, choice: "Yes", comment: "follow-up" },
      { question: { metric: "nps" }, choice: "6", sentiment: "negative" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.key), ["991:csat", "991:nps"]);
  assert.equal(rows[0].comment, "Took three days"); assert.equal(rows[0].topics, "Response time");
  assert.deepEqual(rows[0].ticket, { number: "T20261103.0042" }); assert.equal(rows[0].contactRef, 30123);
  assert.equal(rows[1].rating, 6);
  assert.equal(JSON.stringify(rows).includes("@"), false, "no email addresses kept");
});

test("matching a rating to a client: ticket first, then contact, then company name", () => {
  const maps = { ticketCompany: new Map([["T20261103.0042", 7], ["id:555", 8]]), contactCompany: new Map([[30123, 9]]), byName: new Map([[M.normName("Acme Pty Ltd"), 10]]) };
  assert.deepEqual(M.matchCompany({ ticket: { number: "T20261103.0042" }, contactRef: 30123, companyText: "Acme" }, maps), { companyId: 7, by: "ticket" });
  assert.deepEqual(M.matchCompany({ ticket: { id: 555 } }, maps), { companyId: 8, by: "ticket" });
  assert.deepEqual(M.matchCompany({ ticket: { number: "T20260101.0001" }, contactRef: 30123 }, maps), { companyId: 9, by: "contact" });
  assert.deepEqual(M.matchCompany({ companyText: "ACME Pty. Limited" }, maps), { companyId: 10, by: "name" });
  assert.equal(M.matchCompany({ companyText: "Someone Else" }, maps), null);
  assert.equal(M.matchCompany({ ticket: { number: "T20261104.0001" } }, { ...maps, ticketCompany: new Map([["T20261104.0001", 0]]) }), null, "HD IT itself (company 0) is not a client");
  assert.equal(M.ticketRef("1234567.12345678"), null, "not an Autotask ticket number or id");
  assert.deepEqual(M.ticketRef("t20261103.0042"), { number: "T20261103.0042" });
});

test("leaderboards: ranked clients only, each client on one board", () => {
  const cs = [
    { name: "A", ranked: true, happiness: 90, ratings: 5 }, { name: "B", ranked: true, happiness: 40, ratings: 4 },
    { name: "C", ranked: false, happiness: 0, ratings: 1 }, { name: "D", ranked: true, happiness: 90, ratings: 9 },
    { name: "E", ranked: true, happiness: 60, ratings: 3 },
  ];
  const l = M.leaderboards(cs, 10);
  assert.deepEqual(l.happiest.map(c => c.name), ["D", "A"], "a tie goes to the one with more ratings");
  assert.deepEqual(l.unhappiest.map(c => c.name), ["B", "E"]);
  assert.equal(l.ranked, 4);
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `C${i}`, ranked: true, happiness: i * 3, ratings: 3 }));
  const m = M.leaderboards(many, 10);
  assert.equal(m.happiest.length, 10); assert.equal(m.unhappiest.length, 10);
  assert.equal(m.unhappiest[0].name, "C0"); assert.equal(m.happiest[0].name, "C29");
});

test("each client's MRR, seats and soonest contract end", () => {
  const data = {
    today: "2026-11-12", active: 1, seatIds: new Set([100]), periodMonths: new Map([[1, 1], [2, 12]]),
    contracts: [
      { id: 1, companyID: 7, status: 1, contractPeriodType: 1, startDate: "2025-01-01", endDate: "2027-06-30" },
      { id: 2, companyID: 7, status: 1, contractPeriodType: 2, startDate: "2025-01-01", endDate: "2026-12-31" },
      { id: 3, companyID: 8, status: 1, contractPeriodType: 1, startDate: "2025-01-01", endDate: "2026-01-01" },   // ended
    ],
    lines: [{ id: 11, contractID: 1, serviceID: 100, unitPrice: 50 }, { id: 12, contractID: 2, serviceID: 200, unitPrice: 1200 }],
    bundles: [], bundleUnits: [],
    lineUnits: [{ contractServiceID: 11, contractID: 1, startDate: "2026-07-01", endDate: "2027-06-30", units: 20 },
      { contractServiceID: 12, contractID: 2, startDate: "2026-01-01", endDate: "2026-12-31", units: 1 }],
  };
  const m = contracts.byCompany("2026-11-12", data);
  assert.deepEqual(m.get(7), { mrr: 1100, seats: 20, contracts: 2, contractEnd: "2026-12-31" });
  assert.equal(m.has(8), false);
});

test("who sees Client health, and who sees MRR on it", () => {
  const a = roles => access.accessFor(roles);
  assert.equal(a(["Pulse.User", "Division.SalesMarketing"]).viewClients, true);
  assert.equal(a(["Pulse.User", "Division.SalesMarketing"]).clientMrr, true);
  assert.equal(a(["Pulse.User", "Division.ManagedServices"]).viewClients, true);
  assert.equal(a(["Pulse.User", "Division.ManagedServices"]).clientMrr, false);
  assert.equal(a(["Pulse.Leadership"]).clientMrr, true);
  assert.equal(a(["Pulse.User", "Division.Finance"]).viewClients, false);
  assert.equal(a(["Pulse.User"]).viewClients, false);
});

test("the clients job: reads, matches, scores and saves (Autotask, SimpleSAT and SQL stood in)", async () => {
  const at = require("../src/lib/autotask");
  const ss = require("../src/lib/simplesat");
  const db = require("../src/lib/sql");
  const sync = require("../src/clients/sync");
  const saved = { at: { ...at }, load: contracts.load, by: contracts.byCompany, resp: ss.responses };
  const now = new Date("2026-11-12T03:00:00Z");
  const sqls = [];
  let feedbackTable = [];
  try {
    contracts.load = async () => ({});
    contracts.byCompany = () => new Map([[7, { mrr: 1000, seats: 10, contracts: 1, contractEnd: "2026-12-01" }], [8, { mrr: 500, seats: 4, contracts: 1, contractEnd: "2027-08-01" }]]);
    at.queryIn = async (mod, entity, field, ids) => {
      assert.equal(mod, "clients");
      if (entity === "Companies") return [{ id: 7, companyName: "Acme Pty Ltd", ownerResourceID: 30, isActive: true }, { id: 8, companyName: "Beta Co", ownerResourceID: null, isActive: true }];
      if (entity === "Resources") return [{ id: 30, firstName: "Taylor", lastName: "Reid", email: "Taylor.Reid@hdit.com.au" }];
      if (entity === "Contacts") return [{ id: 555, companyID: 8 }];
      return [];
    };
    at.query = async (mod, entity, filter) => {
      assert.equal(mod, "clients");
      if (entity === "Tickets" && filter[0].field === "ticketNumber") return [{ id: 1, ticketNumber: "T20261101.0001", companyID: 7 }];
      if (entity === "Tickets" && filter[0].field === "createDate") return [
        { id: 2, companyID: 7, createDate: "2026-11-05T00:00:00Z", completedDate: "2026-11-06T00:00:00Z", priority: 4, status: 5, serviceLevelAgreementHasBeenMet: false, ticketType: 1, source: 2 },
        { id: 3, companyID: 7, createDate: "2026-11-05T00:00:00Z", priority: 4, status: 1, ticketType: 5, source: 2 },   // an alert: left out
        { id: 4, companyID: 8, createDate: "2026-11-05T00:00:00Z", priority: 4, status: 1, ticketType: 1, source: 8 },   // from monitoring: left out
      ];
      return [];
    };
    at.picklist = async (m, e, f) => ({ priority: [{ value: 4, label: "Critical" }, { value: 2, label: "Medium" }], status: [{ value: 5, label: "Complete" }, { value: 1, label: "New" }],
      ticketType: [{ value: 1, label: "Service Request" }, { value: 5, label: "Alert" }], source: [{ value: 2, label: "Phone" }, { value: 8, label: "Monitoring Alert" }] })[f];
    at.known = async (m, e, w) => w;
    ss.responses = async () => [
      { id: 1, created: "2026-11-02T00:00:00Z", customer: { name: "Jane", company: "Acme" }, ticket: { external_id: "T20261101.0001" }, answers: [{ question: { metric: "nps" }, choice: 2, sentiment: "negative", comment: "Not happy" }] },
      { id: 2, created: "2026-11-03T00:00:00Z", customer: { name: "Bob", external_id: "555" }, ticket: {}, answers: [{ question: { metric: "csat" }, choice: 5, sentiment: "positive" }] },
      { id: 3, created: "2026-11-04T00:00:00Z", customer: { name: "Who", company: "Nobody Ltd" }, ticket: {}, answers: [{ question: { metric: "csat" }, choice: 1, sentiment: "negative" }] },
    ];
    db._test.use({
      async query(text, p = {}) {
        sqls.push(text);
        if (/FROM pulse.app_setting/.test(text)) return [];
        if (/SELECT company_id, risk_level FROM pulse.client/.test(text)) return [];
        if (/MERGE pulse.client_feedback/.test(text)) { feedbackTable.push(...JSON.parse(p.json)); return []; }
        if (/SELECT \* FROM pulse.client_feedback WHERE company_id IS NOT NULL/.test(text))
          return feedbackTable.filter(r => r.cid).map(r => ({ feedback_key: r.k, response_id: r.rid, company_id: r.cid, metric: r.m, rating: r.rt, sentiment: r.s, comment: r.c, contact_name: r.cn, answered_at: new Date(r.at) }));
        if (/MERGE pulse.client AS t/.test(text)) {
          const rows = JSON.parse(p.json);
          const acme = rows.find(r => r.id === 7);
          assert.equal(acme.ownerEmail, "taylor.reid@hdit.com.au");
          assert.equal(acme.level, "risk", `Acme: detractor + SLA + critical + contract ending (${acme.score})`);
          assert.equal(rows.find(r => r.id === 8).score, 0);
          return [];
        }
        if (/GROUP BY risk_level/.test(text)) return [{ risk_level: "risk", n: 1 }];
        return [];
      },
    });
    const out = await sync.syncClients({ now, alert: null });
    assert.match(out, /2 clients; 3 SimpleSAT responses since 2025-10-08, 3 ratings, 2 matched to a client \(1 not matched\)/);
    assert.match(out, /1 at risk/);
    assert.match(out, /3 tickets read, 1 raised by clients \(2 alerts left out: Alert, Monitoring Alert\)/);
    assert.deepEqual(feedbackTable.map(r => [r.k, r.cid, r.by]), [["1:nps", 7, "ticket"], ["2:csat", 8, "contact"], ["3:csat", null, null]]);
    assert.ok(sqls.some(q => /clients.feedback_full_at/.test(q) && /MERGE/.test(q)), "marks the full read as done");
  } finally {
    Object.assign(at, saved.at); contracts.load = saved.load; contracts.byCompany = saved.by; ss.responses = saved.resp;
  }
});
