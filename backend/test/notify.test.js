"use strict";
// Teams reminders and the weekly email (0.9.0).
const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/lib/sql");
const N = require("../src/notify");
const T = N._test;

// Sydney is UTC+11 in November.
const at = (iso) => new Date(iso);
const kinds = now => T.due(at(now)).map(d => d.kind).sort();

test("schedule: Monday email 7am, numbers 8am, Rocks 9am; Tuesday L10 9–10am; overdue in working hours; L10 To-dos always", () => {
  assert.deepEqual(kinds("2026-11-15T19:30:00Z"), ["l10-todos"], "Monday 6:30am: nothing yet");
  assert.deepEqual(kinds("2026-11-15T20:05:00Z"), ["email", "l10-todos"], "Monday 7:05am");
  assert.deepEqual(kinds("2026-11-15T22:10:00Z"), ["email", "l10-todos", "numbers", "overdue", "rock"], "Monday 9:10am");
  assert.deepEqual(kinds("2026-11-16T22:15:00Z"), ["l10", "l10-todos", "overdue"], "Tuesday 9:15am");
  assert.deepEqual(kinds("2026-11-16T23:15:00Z"), ["l10-todos", "overdue"], "Tuesday 10:15am: the L10 reminder has gone");
  assert.deepEqual(kinds("2026-11-21T00:00:00Z"), ["l10-todos"], "Saturday");
  const numbers = T.due(at("2026-11-15T22:10:00Z")).find(d => d.kind === "numbers");
  assert.equal(numbers.ref, "2026-11-09", "Monday's numbers reminder is about the week just ended");
});

test("messages are short, specific and in plain English", () => {
  assert.equal(T.TEXT.numbers("2026-11-09", ["Cash on hand", "Debtor days (DSO)"]),
    "Your numbers for the week of 9 Nov: 2 still to enter (Cash on hand, Debtor days (DSO)). The week locks at 5pm Tuesday.");
  assert.equal(T.TEXT.l10(4, ["SLA first response met"], 3),
    "L10 at 9:30am. 4 numbers were off target last week, one of them yours (SLA first response met). 3 Issues are numbered for IDS.");
  assert.equal(T.TEXT.l10(0, [], 0), "L10 at 9:30am. Every number with a goal was on target last week. No Issues numbered for IDS yet.");
  assert.match(T.TEXT.overdue({ title: "Send targets", due_date: "2026-11-09" }), /^Overdue To-do: "Send targets" was due 9 Nov\./);
});

test("deep link opens Pulse's personal tab at the page", () => {
  const u = T.deepLink("d46a6617-9686-4ea3-9801-785e42e3a1db", "l10");
  assert.match(u, /^https:\/\/teams\.microsoft\.com\/l\/entity\/d46a6617-9686-4ea3-9801-785e42e3a1db\/home\?context=/);
  assert.deepEqual(JSON.parse(decodeURIComponent(u.split("context=")[1])), { subEntityId: "l10" });
});

test("weekly email: escapes what people typed and shows their own items", () => {
  const html = T.emailHtml({ name: "George Hanna", week: "2026-11-16", pulseUrl: "https://pulse.example/",
    todos: [{ title: "Fix <script>", due: "2026-11-10", overdue: true }], rocks: [{ title: "Reach 2,300 seats", status: "off_track" }],
    numbers: ["Cash on hand"], company: { total: 10, on: 7, off: ["MQLs"] }, l10: "Next L10: Tuesday." });
  assert.ok(html.includes("Fix &lt;script&gt;") && !html.includes("<script>"));
  assert.match(html, /Good morning George/);
  assert.match(html, /overdue, was due 10 Nov/);
  assert.match(html, /<b>7<\/b> of 10 numbers with a goal on target\. Off target: MQLs\./);
});

test("a run: one Teams reminder per person per thing, only to people who haven't switched them off; failures are kept, not retried", async () => {
  const log = [], sent = [];
  db._test.use({ async query(text, p = {}) {
    if (/FROM pulse\.app_setting/.test(text)) return [{ key: "teams.app_id", value: "app-1" }, { key: "mail.sender", value: null }, { key: "notify.enabled", value: "1" }];
    if (/FROM pulse\.person p/.test(text)) return [
      { entra_oid: "oid-tony", display_name: "Tony Parzakonis", email: "tony@hdit.com.au", teams_reminders: 1, weekly_email: 1 },
      { entra_oid: "oid-mandy", display_name: "Mandy Moujalli", email: "mandy@hdit.com.au", teams_reminders: 0, weekly_email: 1 },
    ];
    if (/FROM pulse\.measurable m LEFT JOIN pulse\.scorecard_value/.test(text)) return [
      { id: 6, name: "SLA first response met", owner_email: "tony@hdit.com.au", auto_enabled: false, goal_value: 95, direction: "higher", auto_value: 94, entered_value: null, is_overridden: false },
      { id: 12, name: "Cash on hand", owner_email: "mandy@hdit.com.au", auto_enabled: false, auto_value: null, entered_value: null, is_overridden: false },
    ];
    if (/FROM pulse\.rock/.test(text)) return [];
    if (/FROM pulse\.todo WHERE is_deleted = 0 AND is_done = 0 AND owner_email IS NOT NULL/.test(text)) return [{ id: 31, title: "Review SLA breaches", owner_email: "TONY@hdit.com.au", due_date: "2026-11-09" }];
    if (/FROM pulse\.meeting/.test(text)) return [];
    if (/INSERT INTO pulse\.nudge_log/.test(text)) {
      const k = [p.kind, p.ref, p.key, p.channel].join("|");
      if (log.includes(k)) throw new Error("duplicate");
      log.push(k); return [];
    }
    return [];
  } });
  const graph = { async send(method, path, body) { sent.push({ path, body }); if (/oid-fail/.test(path)) throw new Error("not installed"); return { status: 204 }; } };
  const monday = at("2026-11-15T22:10:00Z");   // Monday 9:10am Sydney
  const out = await N.runNudges({ graph, now: monday });
  assert.match(out, /^2 sent, 0 failed/);
  assert.deepEqual(sent.map(s => s.path), ["/users/oid-tony/teamwork/sendActivityNotification", "/users/oid-tony/teamwork/sendActivityNotification"]);
  assert.match(sent[0].body.templateParameters[0].value, /^Your numbers for the week of 9 Nov: 1 still to enter \(SLA first response met\)/, "a trial value doesn't count until it's switched on");
  assert.equal(sent[0].body.activityType, "pulseReminder");
  assert.ok(!sent.some(s => /oid-mandy/.test(s.path)), "Mandy switched Teams reminders off");
  assert.match(out, /no sender mailbox set/);
  sent.length = 0;
  assert.match(await N.runNudges({ graph, now: monday }), /^0 sent/, "the next run sends nothing again");
  assert.equal(sent.length, 0);
});
