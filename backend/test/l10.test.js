"use strict";
// The L10 meeting (0.7.0): agenda logic, and the routes through the real router and token checks
// against a small in-memory database.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const TENANT = "0b1e12e5-f6cd-4ae7-a9ff-4562637a0c44";
const CLIENT = "11111111-2222-3333-4444-555555555555";
process.env.ENTRA_TENANT_ID = TENANT;
process.env.ENTRA_CLIENT_ID = CLIENT;

const entra = require("../src/lib/entra");
const { router } = require("../src/lib/http");
const db = require("../src/lib/sql");
const L10 = require("../src/eos/l10")._test;

/* ------------------------------ logic ------------------------------ */
test("next meeting: Tuesday 9:30am Sydney, still 'next' until its 90 minutes are over", () => {
  // Tuesday 10 Nov 2026, 9am Sydney (AEDT, UTC+11) = Monday 22:00 UTC
  assert.equal(L10.nextMeeting(new Date("2026-11-09T22:00:00Z")).toISOString(), "2026-11-09T22:30:00.000Z");
  // 10:30am, in the meeting: still this one
  assert.equal(L10.nextMeeting(new Date("2026-11-09T23:30:00Z")).toISOString(), "2026-11-09T22:30:00.000Z");
  // 2pm: next week's
  assert.equal(L10.nextMeeting(new Date("2026-11-10T03:00:00Z")).toISOString(), "2026-11-16T22:30:00.000Z");
});

test("To-do review: open when the last meeting ended or done since; completion counts those due by today", () => {
  const T = (id, o) => ({ id, is_deleted: false, created_at: "2026-11-03T00:00:00Z", due_date: "2026-11-10", is_done: false, done_at: null, ...o });
  const r = L10.todoReview([
    T(1, { is_done: true, done_at: "2026-11-05T00:00:00Z" }),     // done this week: counts
    T(2, {}),                                                     // not done: counts
    T(3, { is_done: true, done_at: "2026-10-28T00:00:00Z" }),     // done before last meeting: not reviewed
    T(4, { created_at: "2026-11-09T22:40:00Z" }),                 // made in this meeting: not reviewed
    T(5, { due_date: "2026-11-14" }),                             // not due yet: shown, not counted
    T(6, { is_deleted: true }),
  ], { startedAt: "2026-11-09T22:30:00Z", prevEndedAt: "2026-11-02T23:55:00Z", today: "2026-11-10" });
  assert.deepEqual(r.ids, [1, 2, 5]);
  assert.deepEqual([r.done, r.due, r.rate, r.notDue], [1, 2, 50, 1]);
});

test("suggested Issues: off target two weeks running, unless an open Issue already covers it", () => {
  const M = (id, a, b) => ({ id, name: "M" + id, owner: { name: "Tony" }, goalText: "95%", cells: [{ week: "2026-10-26", value: a.v, onTarget: a.on }, { week: "2026-11-02", value: b.v, onTarget: b.on }] });
  const out = L10.suggestions([
    M(1, { v: 90, on: false }, { v: 91, on: false }),    // suggested
    M(2, { v: 90, on: false }, { v: 96, on: true }),     // back on target
    M(3, { v: null, on: null }, { v: 91, on: false }),   // only one week known
    M(4, { v: 90, on: false }, { v: 91, on: false }),    // already an Issue
  ], new Set([4]));
  assert.deepEqual(out.map(s => s.measurableId), [1]);
  assert.deepEqual(out[0].values, [90, 91]);
});

test("section minutes from the log; average rating ignores people who didn't rate", () => {
  const m = L10.sectionMinutes([{ s: "segue", at: "2026-11-09T22:30:00Z" }, { s: "scorecard", at: "2026-11-09T22:36:00Z" }, { s: "ids", at: "2026-11-09T22:50:00Z" }, { s: "scorecard", at: "2026-11-09T23:40:00Z" }], "2026-11-09T23:42:30Z");
  assert.deepEqual(m, { segue: 6, scorecard: 16.5, ids: 50 });
  assert.equal(L10.average([9, 8, null, 10]), 9);
  assert.equal(L10.average([]), null);
});

/* ------------------------------ routes ------------------------------ */
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
entra._test.setKeys(new Map([["k1", publicKey]]));
const people = {
  leader: { name: "Sam Leader", preferred_username: "sam@hdit.com.au", roles: ["Pulse.User", "Pulse.Leadership"] },
  other: { name: "Faben Miglani", preferred_username: "faben@hdit.com.au", roles: ["Pulse.User", "Pulse.Leadership"] },
  tech: { name: "Riley Tech", preferred_username: "riley@hdit.com.au", roles: ["Pulse.User", "Division.ManagedServices"] },
};
const token = who => jwt.sign({ aud: CLIENT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, oid: "oid-" + who, scp: "access_as_user", ...people[who] },
  privateKey, { algorithm: "RS256", keyid: "k1", expiresIn: "1h" });
function req(method, path, who, body) {
  const h = new Map([["authorization", `Bearer ${token(who)}`]]);
  return { method, url: `https://func.example/api/${path}`, params: { path: path.split("?")[0] }, headers: { get: k => h.get(k.toLowerCase()) || null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)) };
}

// In-memory meeting tables; everything else answers empty.
let meetings, attendees, writes, nextId;
function reset() { meetings = []; attendees = []; writes = []; nextId = 1; }
db._test.use({
  async query(text, p = {}) {
    if (/INSERT INTO pulse\.audit_event/.test(text)) { writes.push({ text, p }); return []; }
    if (/INSERT INTO pulse\.meeting \(/.test(text)) {
      const m = { id: nextId++, level: p.level, division_code: p.d || null, review_week: p.week, status: "live", section: "segue", section_started_at: p.now, section_log: p.log,
        started_at: p.now, started_by_name: p.name, facilitator_name: p.name, facilitator_oid: p.oid, notes: null, cascading: null, ended_at: null, summary_json: null, version: 1 };
      meetings.push(m); return [{ id: m.id }];
    }
    if (/INSERT INTO pulse\.meeting_attendee/.test(text)) {
      if (attendees.some(a => a.meeting_id === p.id && a.name === p.name)) throw new Error("duplicate");
      attendees.push({ id: nextId++, meeting_id: p.id, name: p.name, email: p.email || null, person_oid: p.oid || null, expected: /expected/.test(text), present: /present/.test(text), joined_at: null, last_seen_at: /last_seen_at/.test(text) ? new Date() : null, rating: null, rating_note: null });
      return [];
    }
    if (/^\s*UPDATE pulse\.meeting SET/.test(text)) {
      writes.push({ text, p });
      const m = meetings.find(x => x.id === (p.id ?? p.mid));
      if (m) {
        for (const [, k] of text.matchAll(/(\w+) = @(\w+)/g)) if (k in p && k !== "id" && k !== "mid") m[k] = p[k];
        if (/status = N'ended'/.test(text)) { m.status = "ended"; m.ended_at = p.now; m.summary_json = p.j; }
        m.version++;
      }
      return [];
    }
    if (/^\s*UPDATE pulse\.meeting_attendee/.test(text)) {
      const a = attendees.find(x => x.id === p.aid);
      for (const [, k] of text.matchAll(/(\w+) = @(\w+)/g)) if (k in p && k !== "aid") a[k] = p[k];
      if (/last_seen_at = SYSUTCDATETIME\(\)/.test(text)) { a.last_seen_at = new Date(); a.present = 1; }
      return [];
    }
    if (/^\s*(INSERT|UPDATE)/.test(text)) { writes.push({ text, p }); return /OUTPUT inserted\.id/.test(text) ? [{ id: 500 }] : []; }
    if (/FROM pulse\.meeting WHERE id = @id/.test(text)) return meetings.filter(m => m.id === p.id);
    if (/FROM pulse\.meeting WHERE .*status = N'live'/.test(text)) return meetings.filter(m => m.status === "live" && m.level === p.level);
    if (/FROM pulse\.meeting WHERE .*status = N'ended'/.test(text)) return meetings.filter(m => m.status === "ended");
    if (/FROM pulse\.meeting_attendee/.test(text)) return attendees.filter(a => a.meeting_id === p.id && (p.aid === undefined || a.id === p.aid));
    if (/FROM pulse\.seat s JOIN pulse\.seat_holder/.test(text)) return [{ name: "George Hanna", email: "george@hdit.com.au" }, { name: "Faben Miglani", email: "faben@hdit.com.au" }, { name: "Vacant" }, { name: "george hanna" }];
    return [];
  },
  async tx(fn) { return fn(this.query.bind(this)); },
  async ping() { return true; },
});
const handle = router(require("../src/api/routes").routes);
const call = (method, path, who, body) => handle(req(method, path, who, body), { log() {}, warn() {}, error() {} });

test("only the leadership team runs the company L10", async () => {
  reset();
  assert.equal((await call("GET", "l10", "tech")).status, 403);
  assert.equal((await call("POST", "l10", "tech", { team: "company" })).status, 403);
  assert.equal(meetings.length, 0);
});

test("starting the L10: the team from the Accountability Chart is expected; a second start joins the same meeting", async () => {
  reset();
  const r = await call("POST", "l10", "leader", { team: "company" });
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  assert.equal(r.jsonBody.joined, false);
  assert.deepEqual(attendees.filter(a => a.expected).map(a => a.name), ["George Hanna", "Faben Miglani"], "no vacancies, no duplicates");
  const again = await call("POST", "l10", "other", { team: "company" });
  assert.deepEqual(again.jsonBody, { id: r.jsonBody.id, joined: true });
  assert.ok(writes.some(w => /audit_event/.test(w.text) && w.p.action === "meeting.start"));
});

test("opening the meeting marks you there; the facilitator moves the agenda and the log keeps each section's start", async () => {
  reset();
  const { jsonBody: { id } } = await call("POST", "l10", "leader", { team: "company" });
  const s = await call("GET", `l10/${id}`, "other");
  assert.equal(s.status, 200, JSON.stringify(s.jsonBody));
  const faben = s.jsonBody.attendees.find(a => a.name === "Faben Miglani");
  assert.ok(faben.present && faben.isMe && !s.jsonBody.facilitator.isMe);
  assert.equal(s.jsonBody.sections.length, 7);
  assert.equal((await call("PATCH", `l10/${id}`, "leader", { section: "scorecard" })).status, 200);
  assert.equal((await call("PATCH", `l10/${id}`, "leader", { section: "nonsense" })).status, 400);
  assert.equal(meetings[0].section, "scorecard");
  assert.deepEqual(JSON.parse(meetings[0].section_log).map(e => e.s), ["segue", "scorecard"]);
});

test("ratings: your own, or anyone's if you facilitate; whole numbers 1 to 10", async () => {
  reset();
  const { jsonBody: { id } } = await call("POST", "l10", "leader", { team: "company" });
  await call("GET", `l10/${id}`, "other");
  const faben = attendees.find(a => a.name === "Faben Miglani"), george = attendees.find(a => a.name === "George Hanna");
  assert.equal((await call("PATCH", `l10/${id}/attendees/${faben.id}`, "other", { rating: 9 })).status, 200);
  assert.equal(faben.rating, 9);
  assert.equal((await call("PATCH", `l10/${id}/attendees/${george.id}`, "other", { rating: 8 })).status, 403, "not the facilitator");
  assert.equal((await call("PATCH", `l10/${id}/attendees/${george.id}`, "leader", { rating: 8 })).status, 200, "the facilitator can");
  assert.equal((await call("PATCH", `l10/${id}/attendees/${faben.id}`, "other", { rating: 11 })).status, 400);
  assert.equal((await call("PATCH", `l10/${id}/attendees/${faben.id}`, "other", { rating: 7.5 })).status, 400);
});

test("ending the meeting takes a summary with the average rating of those present, and is audited", async () => {
  reset();
  const { jsonBody: { id } } = await call("POST", "l10", "leader", { team: "company" });
  await call("GET", `l10/${id}`, "other");
  const faben = attendees.find(a => a.name === "Faben Miglani");
  await call("PATCH", `l10/${id}/attendees/${faben.id}`, "other", { rating: 9 });
  await call("PATCH", `l10/${id}`, "leader", { cascading: "New SLA targets from Monday" });
  const r = await call("POST", `l10/${id}/end`, "leader");
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  assert.equal(meetings[0].status, "ended");
  const s = JSON.parse(meetings[0].summary_json);
  assert.equal(s.averageRating, 9);
  assert.equal(s.cascading, "New SLA targets from Monday");
  assert.ok(s.attendees.some(a => a.name === "Sam Leader" && a.present), "the person who started it is there");
  assert.ok(writes.some(w => /audit_event/.test(w.text) && w.p.action === "meeting.end"));
  assert.equal((await call("PATCH", `l10/${id}`, "leader", { section: "ids" })).status, 409);
  assert.equal((await call("POST", `l10/${id}/end`, "leader")).status, 409);
});

test("dropping to the Issues List keeps where it came from", async () => {
  reset();
  const { jsonBody: { id } } = await call("POST", "l10", "leader", { team: "company" });
  const r = await call("POST", `l10/${id}/drop`, "leader", { kind: "measurable", id: 6, title: "SLA first response off track" });
  assert.equal(r.status, 200, JSON.stringify(r.jsonBody));
  const ins = writes.find(w => /INSERT INTO pulse\.issue/.test(w.text));
  assert.deepEqual([ins.p.kind, ins.p.sourceId, ins.p.measurableId], ["measurable", 6, 6]);
  assert.equal((await call("POST", `l10/${id}/drop`, "leader", { kind: "spaceship", id: 1, title: "x" })).status, 400);
});
