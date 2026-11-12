// Preview stand-in for the Client health API (0.10.0). Sample clients (made up), scored the way
// the server scores them, so the page can be tried without Autotask or SimpleSAT.
const DAY = 86400e3;
const ago = n => new Date(Date.now() - n * DAY).toISOString();
const ahead = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const weekOf = () => { const d = new Date(); const s = new Date(d.toLocaleString("en-US", { timeZone: "Australia/Sydney" })); const k = (s.getDay() + 6) % 7; s.setDate(s.getDate() - k); return s.toLocaleDateString("en-CA"); };
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

const AM = {
  taylor: { name: "Taylor Reid", email: "taylor.reid@hdit.com.au" },
  faben: { name: "Faben Miglani", email: "faben.miglani@hdit.com.au" },
  mandy: { name: "Mandy Moujalli", email: "mandy.moujalli@hdit.com.au" },
};
const r = (key, points, text, kind) => ({ key, points, text, kind });

// [id, name, owner, score, reasons, happiness, ratings, csat%, csatN, nps, npsN, tickets30, base, sla, critical, aged, mrr, seats, contractEnd, change]
const ROWS = [
  [7101, "Harbourside Accounting", "taylor", 100, [r("nps-detractor", 30, "NPS of 3 from Priya Shah on 2 Nov (a detractor)", "feedback"), r("churn-talk", 30, "Ticket T20261109.0018 on 9 Nov talks about leaving or changing provider", "sentiment"), r("frustrated", 12, "2 tickets in 30 days where the client sounded frustrated", "sentiment"), r("csat-negative", 24, "2 unhappy CSAT ratings in 90 days", "feedback"), r("ticket-spike", 15, "14 tickets in 30 days, against about 5 a month before", "tickets"), r("sla-missed", 5, "1 SLA missed in 30 days", "tickets")], 38, 9, 56, 7, -50, 2, 14, 5, 1, 0, 1, 6840, 38, ahead(240), 31],
  [7102, "Granville Engineering", "faben", 62, [r("contract-ending", 20, "Recurring contract ends 8 Dec (26 days)", "contract"), r("nps-detractor", 30, "NPS of 5 from Mark Lee on 19 Oct (a detractor)", "feedback"), r("csat-neutral", 12, "3 neutral CSAT ratings in 90 days", "feedback")], 52, 7, 50, 6, -100, 1, 6, 6, 0, 0, 2, 4120, 22, ahead(26), 20],
  [7103, "Blacktown Logistics", "taylor", 51, [r("sla-missed", 15, "3 SLAs missed in 30 days", "tickets"), r("ticket-spike", 15, "11 tickets in 30 days, against about 4 a month before", "tickets"), r("csat-negative", 12, "1 unhappy CSAT rating in 90 days", "feedback"), r("critical", 5, "1 Critical ticket in 30 days", "tickets"), r("aged-open", 5, "3 tickets open more than 14 days", "tickets")], 66, 6, 67, 6, null, 0, 11, 4, 3, 1, 3, 9350, 61, ahead(410), 18],
  [7104, "Penrith Medical Centre", "mandy", 42, [r("csat-negative", 24, "2 unhappy CSAT ratings in 90 days", "feedback"), r("csat-falling", 10, "CSAT down to 60% in 90 days, from 92% the year before", "feedback"), r("csat-neutral", 4, "1 neutral CSAT rating in 90 days", "feedback"), r("aged-open", 5, "4 tickets open more than 14 days", "tickets")], 71, 18, 72, 16, 0, 2, 9, 8, 0, 0, 4, 7210, 44, ahead(300), 12],
  [7105, "Hills Family Law", "taylor", 35, [r("contract-ending", 15, "Recurring contract ends 28 Jan (77 days)", "contract"), r("nps-passive", 10, "NPS of 7 from Dana Wu on 30 Oct (passive)", "feedback"), r("gone-quiet", 5, "No survey answers in 120 days, but still raising tickets", "feedback"), r("sla-missed", 5, "1 SLA missed in 30 days", "tickets")], 79, 5, 80, 4, 0, 1, 4, 5, 1, 0, 0, 2980, 15, ahead(77), -4],
  [7106, "Ryde Architects", "faben", 28, [r("ticket-spike", 15, "9 tickets in 30 days, against about 3 a month before", "tickets"), r("csat-neutral", 8, "2 neutral CSAT ratings in 90 days", "feedback"), r("critical", 5, "1 Critical ticket in 30 days", "tickets")], 83, 11, 82, 11, null, 0, 9, 3, 0, 1, 1, 3460, 19, ahead(520), 9],
  [7107, "Castle Hill Pharmacy", "mandy", 25, [r("nps-passive", 10, "NPS of 8 from Sam Ortiz on 4 Nov (passive)", "feedback"), r("aged-open", 5, "3 tickets open more than 14 days", "tickets"), r("sla-missed", 10, "2 SLAs missed in 30 days", "tickets")], 81, 8, 86, 7, 0, 1, 5, 4, 2, 0, 3, 1890, 9, ahead(180), 0],
  [7108, "Parra Legal", "taylor", 12, [r("csat-negative", 12, "1 unhappy CSAT rating in 90 days", "feedback")], 91, 21, 90, 19, 100, 2, 7, 7, 0, 0, 0, 11200, 70, ahead(1090), -18],
  [7109, "Westmead Dental Group", "faben", 4, [r("csat-neutral", 4, "1 neutral CSAT rating in 90 days", "feedback")], 93, 14, 93, 14, null, 0, 5, 6, 0, 0, 0, 5320, 33, ahead(400), 0],
  [7110, "Norwest Physio", "mandy", 0, [], 98, 12, 100, 10, 100, 2, 3, 3, 0, 0, 0, 2240, 12, ahead(600), -5],
  [7111, "Epping Wealth Partners", "taylor", 0, [], 96, 9, 100, 8, 100, 1, 2, 3, 0, 0, 0, 3780, 18, ahead(330), 0],
  [7112, "Strathfield Education Trust", "faben", 5, [r("sla-missed", 5, "1 SLA missed in 30 days", "tickets")], 89, 26, 88, 24, 50, 2, 12, 11, 1, 0, 1, 8650, 95, ahead(700), 0],
  [7113, "Merrylands Motors", "mandy", 0, [], 100, 4, 100, 4, null, 0, 1, 2, 0, 0, 0, 1320, 7, ahead(260), 0],
  [7114, "Auburn Food Co", "taylor", 15, [r("contract-ending", 15, "Recurring contract ends 2 Feb (82 days)", "contract")], null, 0, null, 0, null, 0, 2, 2, 0, 0, 0, 2050, 11, ahead(82), 15],
  [7115, "Baulkham Hills Vets", "faben", 0, [], 95, 6, 100, 5, 100, 1, 2, 2, 0, 0, 0, 1460, 8, ahead(150), 0],
  [7116, "Rouse Hill Childcare", "mandy", 9, [r("nps-passive", 10, "NPS of 8 from Lee Tran on 25 Oct (passive)", "feedback")], 86, 5, 100, 3, 0, 2, 3, 3, 0, 0, 0, 980, 6, ahead(310), 0],
  [7117, "Seven Hills Plumbing", "taylor", 0, [], 88, 3, 100, 2, 100, 1, 1, 1, 0, 0, 0, 640, 4, ahead(220), 0],
  [7118, "Carlingford Insurance Brokers", null, 30, [r("critical", 10, "2 Critical tickets in 30 days", "tickets"), r("ticket-spike", 15, "8 tickets in 30 days, against about 2 a month before", "tickets"), r("aged-open", 5, "3 tickets open more than 14 days", "tickets")], 74, 4, 75, 4, null, 0, 8, 2, 0, 2, 3, 2730, 14, ahead(460), 30],
];
const level = s => (s >= 50 ? "risk" : s >= 25 ? "watch" : "healthy");
const CLIENTS = ROWS.map(([id, name, owner, score, reasons, happiness, ratings, csatPct, csatN, nps, npsN, t30, base, sla, crit, aged, mrr, seats, contractEnd, change]) => ({
  id, name, owner: owner ? AM[owner] : null, score: Math.min(100, score), level: level(score), reasons, happiness, ratings, ranked: ratings >= 3, csatPct, csatN, nps, npsN,
  lastFeedbackAt: ratings ? ago(3 + (id % 20)) : null, tickets: { last30: t30, monthBefore: base, slaMissed30: sla, critical30: crit, agedOpen: aged }, mrr, seats, contractEnd, change,
}));
let sentimentOn = true;
const MOODS = {
  7101: [
    { ticketNumber: "T20261109.0018", title: "Email not syncing on phones", at: ago(3), sentiment: "negative", frustration: 3, churn: true, reason: "Client says they are reviewing their IT provider after repeated slow fixes." },
    { ticketNumber: "T20261102.0031", title: "New starter laptop", at: ago(10), sentiment: "negative", frustration: 2, churn: false, reason: "Client chased three times for an overdue laptop." },
  ],
  7103: [{ ticketNumber: "T20261106.0044", title: "Warehouse Wi-Fi drops", at: ago(6), sentiment: "negative", frustration: 2, churn: false, reason: "Repeat outage; client unhappy it keeps coming back." }],
};
const notes = new Map([[7101, [{ id: 1, note: "Called Priya. The new starter's laptop took a week; we've put a loaner in place and booked a review with their office manager for Friday.", by: "Taylor Reid", at: ago(1) }]]]);
const issues = new Map();
let nid = 900;

const FEEDBACK = {
  7101: [
    { at: ago(10), metric: "nps", rating: 3, sentiment: "negative", comment: "Lately it takes days to get anything done. We used to love the service.", contactName: "Priya Shah", teamMember: null, ticketNumber: "T20261102.0031", ticketSubject: "New starter laptop", topics: "Response time" },
    { at: ago(12), metric: "csat", rating: 1, sentiment: "negative", comment: "Still waiting on the new starter's laptop after a week.", contactName: "Priya Shah", teamMember: "Riley Tech", ticketNumber: "T20261102.0031", ticketSubject: "New starter laptop", topics: "Response time, Onboarding" },
    { at: ago(26), metric: "csat", rating: 2, sentiment: "negative", comment: "Fixed in the end, but I had to chase three times.", contactName: "Owen Burke", teamMember: "Abiy Amdemariam", ticketNumber: "T20261019.0112", ticketSubject: "Printer offline", topics: "Communication" },
    { at: ago(70), metric: "csat", rating: 5, sentiment: "positive", comment: "Quick and friendly as always.", contactName: "Owen Burke", teamMember: "Riley Tech", ticketNumber: "T20260904.0007", ticketSubject: "Password reset", topics: null },
  ],
};
function feedbackFor(c) {
  if (FEEDBACK[c.id]) return FEEDBACK[c.id];
  if (!c.ratings) return [];
  const out = [];
  for (let i = 0; i < Math.min(c.ratings, 5); i++) {
    const happy = c.happiness >= 80 || i % 3;
    out.push({ at: ago(5 + i * 23), metric: i === 1 && c.npsN ? "nps" : "csat", rating: i === 1 && c.npsN ? (c.nps < 0 ? 5 : c.nps === 0 ? 8 : 10) : happy ? 5 : 3,
      sentiment: i === 1 && c.npsN ? (c.nps < 0 ? "negative" : c.nps === 0 ? "neutral" : "positive") : happy ? "positive" : "neutral",
      comment: happy ? ["Sorted within the hour, thank you.", "Great communication the whole way.", "Always helpful."][i % 3] : "Took a couple of goes but got there.",
      contactName: ["Alex Chen", "Jordan Patel", "Casey Nguyen"][i % 3], teamMember: ["Riley Tech", "Michael Baltagi", "Rinus Besselaar"][i % 3],
      ticketNumber: `T2026${String(10 + (i % 2)).padStart(2, "0")}${String(10 + i).padStart(2, "0")}.00${40 + i}`, ticketSubject: ["Outlook not syncing", "VPN drops", "New user"][i % 3], topics: null });
  }
  return out;
}
function history(c) {
  const w = weekOf();
  return Array.from({ length: 13 }, (_, i) => {
    const k = 12 - i, wobble = ((c.id * (i + 3)) % 7) - 3;
    const v = Math.max(0, Math.min(100, Math.round(c.score - (c.change || 0) * (k / 4) + wobble)));
    return { week: addDays(w, -7 * k), score: k === 0 ? c.score : k >= 4 && c.change !== null ? Math.max(0, v) : v, happiness: c.happiness };
  });
}

export function clientsApi(p, method, body, a, me, fail, q = {}) {
  if (!p.startsWith("/clients")) return null;
  if (!a.viewClients) fail(403, "Client health is for Leadership, Sales & Marketing and Managed Services.");
  const strip = c => ({ ...c, owner: c.owner ? { ...c.owner, isMe: c.owner.email === me.email } : null, mrr: a.clientMrr ? c.mrr : undefined, issue: issues.get(c.id) || null });
  if (p === "/clients/refresh") return { ok: true };
  if (p === "/clients/sentiment") { if (!a.platform) fail(403, "Only Platform Admins switch ticket sentiment on or off."); sentimentOn = !!body.enabled; return { enabled: sentimentOn }; }
  let m;
  if ((m = /^\/clients\/(\d+)\/notes$/.exec(p))) {
    const list = notes.get(Number(m[1])) || []; list.unshift({ id: ++nid, note: body.note, by: me.name, at: new Date().toISOString() }); notes.set(Number(m[1]), list); return { id: nid };
  }
  if ((m = /^\/clients\/(\d+)\/issue$/.exec(p))) {
    if (issues.has(Number(m[1]))) fail(409, "An Issue is already open for this client.");
    issues.set(Number(m[1]), { id: ++nid, title: body.title }); return { id: nid };
  }
  if ((m = /^\/clients\/(\d+)$/.exec(p))) {
    const c = CLIENTS.find(x => x.id === Number(m[1]));
    if (!c) fail(404, "That client isn't in Pulse.");
    const is = issues.get(c.id);
    return { ...strip(c), autotaskUrl: "https://ww29.autotask.net/", computedAt: new Date(Date.now() - 5 * 3600e3).toISOString(), history: history(c),
      feedback: feedbackFor(c), notes: notes.get(c.id) || [],
      ticketMoods: { analysed: c.tickets.last30 + 2, negative: (MOODS[c.id] || []).length, positive: Math.max(0, c.tickets.last30 - 3),
        list: (MOODS[c.id] || []).map(x => ({ ...x, url: "https://ww29.autotask.net/" })) }, issues: is ? [{ ...is, status: "open", level: "division", division: "SalesMarketing" }] : [] };
  }
  // The list
  const mine = CLIENTS.some(c => c.owner && c.owner.email === me.email);
  const want = (q.owner || (mine ? "me" : "all")).toLowerCase();
  const picked = CLIENTS.filter(c => want === "all" || (want === "me" ? c.owner && c.owner.email === me.email : c.owner && c.owner.email === want)).map(strip)
    .sort((x, y) => y.score - x.score || (y.mrr || 0) - (x.mrr || 0));
  const owners = Object.values(AM).map(o => ({ ...o, clients: CLIENTS.filter(c => c.owner === o).length, isMe: o.email === me.email }));
  const ranked = picked.filter(c => c.ranked);
  const by = l => picked.filter(c => c.level === l);
  const allCsat = picked.reduce((s, c) => s + (c.csatN || 0), 0);
  return {
    owner: want, owners, canSeeMrr: !!a.clientMrr, lastRun: { at: new Date(Date.now() - 5 * 3600e3).toISOString(), ok: true },
    sentiment: { enabled: sentimentOn, analysed30: sentimentOn ? 412 : 0, model: "gpt-4.1-mini", canSwitch: !!a.platform },
    summary: { clients: picked.length, risk: by("risk").length, watch: by("watch").length, healthy: by("healthy").length,
      mrrAtRisk: a.clientMrr ? by("risk").reduce((s, c) => s + c.mrr, 0) : undefined,
      happiness: ranked.length ? Math.round(ranked.reduce((s, c) => s + c.happiness, 0) / ranked.length) : null,
      csat: allCsat ? { pct: Math.round(picked.reduce((s, c) => s + (c.csatPct || 0) * (c.csatN || 0), 0) / allCsat * 10) / 10, n: Math.round(allCsat / 3) } : null,
      nps: { score: 62, n: picked.reduce((s, c) => s + (c.npsN || 0), 0) }, withFeedback: picked.filter(c => c.ratings).length },
    clients: picked,
    leaderboards: (() => {
      const all = ranked.slice().sort((x, y) => y.happiness - x.happiness || y.ratings - x.ratings);
      const each = Math.min(10, Math.ceil(all.length / 2));
      return { happiest: all.slice(0, each), unhappiest: all.slice(each).sort((x, y) => x.happiness - y.happiness || y.ratings - x.ratings).slice(0, 10), ranked: all.length, minRatings: 3 };
    })(),
  };
}
