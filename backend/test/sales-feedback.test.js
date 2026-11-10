"use strict";
// 0.6.5: MQLs (Marketing ROI), new MRR and weighted pipeline (Autotask), CSAT and NPS (SimpleSAT).
const test = require("node:test");
const assert = require("node:assert/strict");

const contracts = require("../src/collect/contracts");
const ss = require("../src/collect/simplesat");
const mroi = require("../src/collect/mroi");
const apps = require("../src/lib/apps");
const vault = require("../src/lib/vault");
const ssLib = require("../src/lib/simplesat");

/* ---------- new MRR and weighted pipeline ---------- */
test("new MRR: monthly revenue on opportunities won in the week, by close date", () => {
  const r = contracts.newMrrBetween("2026-11-02", "2026-11-08", { opps: [
    { title: "Acme", date: "2026-11-03", mrr: 3200 }, { title: "Beta", date: "2026-11-08", mrr: 1450 },
    { title: "Later", date: "2026-11-09", mrr: 999 }, { title: "Project only", date: "2026-11-04", mrr: 0 },
  ] });
  assert.equal(r.value, 4650);
  assert.equal(r.detail.opportunities, 3);
  assert.match(r.detail.text, /^\$4,650 a month on 3 opportunities won: Acme \(\$3,200\), Beta \(\$1,450\)\.$/);
});

test("weighted pipeline: one-off revenue × probability at stages 6 and 7 (amount when one-off is empty)", () => {
  const stages = [{ value: 6, label: "Stage 6: Proposal" }, { value: 7, label: "Stage 7: Negotiation" }];
  const r = contracts.weighFrom([
    { title: "A", stage: 6, probability: 60, onetimeRevenue: 40000 },
    { title: "B", stage: 7, probability: 90, onetimeRevenue: null, amount: 25000 },
    { title: "C", stage: 6, probability: null, onetimeRevenue: 5000 },
  ], stages);
  assert.equal(r.value, 46500);
  assert.match(r.detail.text, /Stage 6: 2 worth \$24,000; Stage 7: 1 worth \$22,500/);
});

test("weighted pipeline is only read for the current week, and never makes a past week look unfinished", async () => {
  const { SNAPSHOT } = require("../src/collect");
  assert.ok(SNAPSHOT.has("autotask.weighted_pipeline"));
  const db = require("../src/lib/sql");
  let asked = null;
  db._test.use({ async query(text, p) { asked = { text, p }; return []; } });
  const { weeksToRun } = require("../src/collect");
  await weeksToRun([{ id: 1, collector: "autotask.new_mrr" }, { id: 2, collector: "autotask.weighted_pipeline" }], new Date("2026-11-10T03:00:00Z"));
  assert.deepEqual(Object.keys(asked.p).filter(k => /^m\d/.test(k)), ["m0"], "only the non-snapshot measurable decides whether a week is full");
});

/* ---------- SimpleSAT ---------- */
const A = (o) => ({ id: Math.random(), created: "2026-11-03T01:00:00Z", is_primary: true, ...o });

test("SimpleSAT: CSAT is positive ÷ all primary CSAT ratings (neutral pulls it down); follow-ups and other metrics don't count", () => {
  const list = [
    A({ question: { metric: "csat" }, sentiment: "positive", rating: 5, response_id: 1 }),
    A({ question: { metric: "csat" }, sentiment: "positive", rating: 4, response_id: 2 }),
    A({ question: { metric: "csat" }, sentiment: "neutral", rating: 3, response_id: 3 }),
    A({ question: { metric: "csat" }, sentiment: "negative", rating: 1, response_id: 4 }),
    A({ question: { metric: "csat" }, is_primary: false, sentiment: "positive", response_id: 4 }),   // follow-up
    A({ question: { metric: "nps" }, rating: 10, response_id: 5 }),
  ];
  const r = ss._test.csat(ss._test.ratings(list, "csat"));
  assert.equal(r.value, 50);
  assert.match(r.detail.text, /^2 positive of 4 CSAT ratings \(1 neutral\) = 50%\.$/);
  assert.equal(ss._test.csat([]).value, null);
});

test("SimpleSAT: NPS from 0–10 ratings, or from the Promoter/Detractor label when there is no number", () => {
  const list = [
    A({ question_metric: "NPS", rating: 10 }), A({ question_metric: "NPS", rating: 9 }), A({ question_metric: "NPS", rating: 8 }),
    A({ question_metric: "NPS", rating: 3 }), A({ question_metric: "NPS", answer_label: "Promoter", rating: null }),
  ];
  const r = ss._test.nps(ss._test.ratings(list, "nps"));
  assert.equal(r.value, 40);   // 3 promoters, 1 detractor of 5
  assert.deepEqual([r.detail.promoters, r.detail.detractors, r.detail.ratings], [3, 1, 5]);
});

test("SimpleSAT collectWeek: one read for the run, CSAT in the week, NPS over the 90 days; the key goes only in the header", async () => {
  vault.getSecret = async name => (name === "simplesat" ? { value: JSON.stringify({ apiKey: "k-123" }) } : null);
  const calls = [];
  ssLib._test.setFetch(async (url, opt) => {
    calls.push({ url, opt });
    const page2 = /page=2/.test(url);
    return { ok: true, status: 200, json: async () => page2
      ? { answers: [A({ question: { metric: "nps" }, rating: 2, created: "2026-09-01T00:00:00Z" })], next: null }
      : { answers: [A({ question: { metric: "csat" }, sentiment: "positive", created: "2026-11-03T00:00:00Z" }), A({ question: { metric: "nps" }, rating: 10, created: "2026-11-04T00:00:00Z" })], next: "https://api.simplesat.io/api/v1/answers/search?page=2&page_size=100" } };
  });
  const cache = {};
  const out = await ss.collectWeek("2026-11-02", cache, new Date("2026-11-10T00:00:00Z"));
  await ss.collectWeek("2026-10-26", cache, new Date("2026-11-10T00:00:00Z"));
  assert.equal(calls.length, 2, "two pages, read once for both weeks");
  assert.equal(calls[0].opt.method, "POST");
  assert.equal(calls[0].opt.headers["x-simplesat-token"], "k-123");
  assert.ok(!calls[0].url.includes("k-123") && !calls[0].opt.body.includes("k-123"));
  assert.deepEqual(Object.keys(JSON.parse(calls[1].opt.body)), ["start_date", "end_date"], "the next page is POSTed with the same body");
  assert.equal(out["simplesat.csat"].value, 100);
  assert.equal(out["simplesat.nps"].value, 0);   // 1 promoter, 1 detractor
});

test("SimpleSAT: a refused key says where to fix it", async () => {
  vault.getSecret = async () => ({ value: JSON.stringify({ apiKey: "bad" }) });
  ssLib._test.setFetch(async () => ({ ok: false, status: 401, headers: new Map(), json: async () => ({}) }));
  await assert.rejects(ssLib.answers("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"), /Connections → SimpleSAT/);
});

/* ---------- MQLs from Marketing ROI ---------- */
test("MQLs: counted by Sydney week, estimated ones called out", () => {
  const items = [
    { week: "2026-11-02", estimated: false }, { week: "2026-11-02", estimated: true }, { week: "2026-10-26", estimated: false },
  ];
  const r = mroi.mqlsIn("2026-11-02", items);
  assert.equal(r.value, 2);
  assert.match(r.detail.text, /^2 opportunities reached MQL this week in Marketing ROI \(1 dated by when the opportunity was created/);
  assert.equal(mroi.mqlsIn("2026-10-19", items).value, 0);
});

test("Marketing ROI is called with Pulse's app-only token, and a Sunday-evening MQL lands in Sydney's week", async () => {
  process.env.APP_MROI_API = "https://func-hdit-mroi-test-aue.azurewebsites.net/api";
  process.env.ENTRA_CLIENT_ID = "1b247714-1319-4edf-9115-de80b3360561";
  let seen = null;
  apps._test.setToken(async () => "tok");
  apps._test.setFetch(async (url, opt) => { seen = { url, auth: opt.headers.authorization };
    return { ok: true, status: 200, json: async () => ({ version: "0.7.0", measures: { mqls: { items: [{ id: "1", at: "2026-11-08T12:00:00Z", estimated: false }] } } }) }; });
  const cache = {};
  assert.equal((await mroi.collectWeek("2026-11-02", cache))["mroi.mqls"].value, 1, "12:00 UTC on 8 Nov is 11pm Sunday in Sydney");
  assert.equal((await mroi.collectWeek("2026-11-09", cache))["mroi.mqls"].value, 0);
  assert.equal(seen.url, "https://func-hdit-mroi-test-aue.azurewebsites.net/api/pulse/measures");
  assert.equal(seen.auth, "Bearer tok");

  apps._test.setFetch(async () => ({ ok: false, status: 403, json: async () => ({ message: "This service doesn't have the Pulse.Collector role." }) }));
  await assert.rejects(apps.measures("mroi"), /refused Pulse's sign-in .*Pulse\.Collector/);
});
