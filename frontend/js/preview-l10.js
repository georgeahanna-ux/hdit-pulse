// Preview stand-in for the L10 meeting API (0.7.0). One in-memory meeting at a time, with the
// sample leadership team; Issues and To-dos are the preview's own lists, passed in.
const SECTIONS = [
  { key: "segue", label: "Segue", minutes: 5, hint: "Good news: one personal and one professional from everyone." },
  { key: "scorecard", label: "Scorecard", minutes: 5, hint: "On track or off track for each number. Off track drops to the Issues List; no discussion here." },
  { key: "rocks", label: "Rock review", minutes: 5, hint: "Each owner: on track or off track. Off track drops to the Issues List." },
  { key: "headlines", label: "Headlines", minutes: 5, hint: "Customer and employee news in a sentence. Anything that needs discussing drops to the Issues List." },
  { key: "todos", label: "To-do list", minutes: 5, hint: "Done or not done. Not done twice drops to the Issues List." },
  { key: "ids", label: "IDS", minutes: 60, hint: "Number the top three Issues, then Identify, Discuss and Solve them in order. Solutions become To-dos." },
  { key: "conclude", label: "Conclude", minutes: 5, hint: "Recap the new To-dos, agree cascading messages, and everyone rates the meeting 1 to 10." },
];
const TEAM = [["George Hanna", "george.hanna@hdit.com.au"], ["Mandy Moujalli", "mandy.moujalli@hdit.com.au"], ["Bernadette Hanna", "bernadette.hanna@hdit.com.au"],
  ["Faben Miglani", "faben.miglani@hdit.com.au"], ["Tony Parzakonis", "tony.parzakonis@hdit.com.au"]];

const meetings = [];
let headlines = [
  { id: 1, kind: "customer", text: "Parra Legal renewed for three years and added 12 seats", by: "Faben Miglani", byEmail: "faben.miglani@hdit.com.au", issueId: null, shared: null },
  { id: 2, kind: "employee", text: "Riley passed the Azure Administrator exam", by: "Tony Parzakonis", byEmail: "tony.parzakonis@hdit.com.au", issueId: null, shared: null },
];
let nid = 500;

function weekInfo(week) {
  const d = new Date(week + "T00:00:00Z"); const end = new Date(d.getTime() + 6 * 86400e3).toISOString().slice(0, 10);
  return { week, start: week, end, lockAt: new Date(d.getTime() + 8 * 86400e3 + 6 * 3600e3).toISOString(), locked: Date.now() > d.getTime() + 8 * 86400e3 + 6 * 3600e3, current: false };
}
function nextTuesday() {
  const now = new Date(); const syd = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
  let add = (2 - syd.getDay() + 7) % 7; if (add === 0 && syd.getHours() * 60 + syd.getMinutes() > 11 * 60) add = 7;
  const d = new Date(now.getTime() + add * 86400e3); const ymd = d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  return new Date(ymd + "T09:30:00+11:00").toISOString();
}
const avg = l => { const r = l.filter(Boolean); return r.length ? Math.round(r.reduce((s, x) => s + x, 0) / r.length * 10) / 10 : null; };

export function l10Api(p, method, body, a, me, { issues, todos, reviewWeek, fail }) {
  let mm;
  const isMe = at => at.email && me.email && at.email.toLowerCase() === me.email.toLowerCase() || at.name === me.name;
  const shape = m => {
    const fac = m.facilitatorEmail === me.email;
    const base = { id: m.id, team: "company", status: m.status, section: m.section, sectionStartedAt: m.sectionStartedAt, startedAt: m.startedAt, endedAt: m.endedAt,
      reviewWeek: weekInfo(m.reviewWeek), facilitator: { name: m.facilitator, isMe: fac }, notes: m.notes, cascading: m.cascading, version: m.version, serverNow: new Date().toISOString(),
      sections: SECTIONS, attendees: m.attendees.map(x => ({ ...x, online: x.present && (isMe(x) || x.name === "Faben Miglani"), isMe: isMe(x), canRate: fac || isMe(x) })), canEnd: m.status === "live" };
    if (m.status === "ended") return { ...base, summary: m.summary };
    const start = Date.parse(m.startedAt);
    const review = todos.filter(t => t.level === "company" && (t.createdAt ? Date.parse(t.createdAt) < start : true));
    const due = review.filter(t => t.dueDate <= new Date().toISOString().slice(0, 10));
    return { ...base, headlines: headlines.filter(h => !h.shared || h.shared === m.id).map(h => ({ ...h, mine: h.byEmail === me.email })),
      todoReview: { ids: review.map(t => t.id), due: due.length, done: due.filter(t => t.done).length, rate: due.length ? Math.round(due.filter(t => t.done).length / due.length * 100) : null, notDue: review.length - due.length },
      newTodos: todos.filter(t => t.level === "company" && t.createdAt && Date.parse(t.createdAt) >= start).map(t => ({ id: t.id, title: t.title, owner: t.owner.name, dueDate: t.dueDate, issueId: t.issueId || null })),
      solved: issues.filter(i => i.status === "solved" && i.closedAt && Date.parse(i.closedAt) >= start).map(i => ({ id: i.id, title: i.title, solution: i.solution })),
      suggestions: [{ measurableId: 6, name: "SLA first response met", owner: "Tony Parzakonis", weeks: [], values: [93.2, 94.7], goal: "95% or more" }] };
  };
  const needLeader = () => { if (!a.leadership) fail(403, "The L10 meeting is for the leadership team."); };

  if (p === "/l10" && method === "GET") {
    needLeader();
    const live = meetings.find(m => m.status === "live");
    return { team: "company", label: "Leadership team", schedule: { label: "Tuesday 9:30am", next: nextTuesday() }, reviewWeek: weekInfo(reviewWeek), sections: SECTIONS,
      live: live ? { id: live.id, startedAt: live.startedAt, facilitator: live.facilitator, section: live.section } : null,
      past: meetings.filter(m => m.status === "ended").reverse().map(m => ({ id: m.id, startedAt: m.startedAt, endedAt: m.endedAt, reviewWeek: m.reviewWeek, rating: m.summary.averageRating, minutes: m.summary.minutes, todoRate: m.summary.todos.rate, solved: m.summary.solved.length, newTodos: m.summary.newTodos.length })) };
  }
  if (p === "/l10" && method === "POST") {
    needLeader();
    const live = meetings.find(m => m.status === "live");
    if (live) return { id: live.id, joined: true };
    const now = new Date().toISOString();
    const m = { id: ++nid, status: "live", section: "segue", sectionStartedAt: now, startedAt: now, endedAt: null, reviewWeek, facilitator: me.name, facilitatorEmail: me.email,
      notes: "", cascading: "", version: 1, log: [{ s: "segue", at: now }],
      attendees: TEAM.map(([name, email], i) => ({ id: i + 1, name, email, expected: true, present: name === "Faben Miglani", rating: null, ratingNote: null })) };
    if (!m.attendees.some(isMe)) m.attendees.push({ id: 99, name: me.name, email: me.email, expected: false, present: true, rating: null, ratingNote: null });
    else m.attendees.find(isMe).present = true;
    meetings.push(m);
    return { id: m.id, joined: false };
  }
  if ((mm = /^\/l10\/(\d+)$/.exec(p))) {
    needLeader();
    const m = meetings.find(x => x.id === Number(mm[1])) || fail(404, "That meeting doesn't exist.");
    if (method === "GET") { const at = m.attendees.find(isMe); if (at && m.status === "live") at.present = true; return shape(m); }
    if (m.status !== "live") fail(409, "This meeting has ended.");
    if (body.section && body.section !== m.section) { m.section = body.section; m.sectionStartedAt = new Date().toISOString(); m.log.push({ s: body.section, at: m.sectionStartedAt }); }
    if ("notes" in body) m.notes = body.notes;
    if ("cascading" in body) m.cascading = body.cascading;
    if (body.facilitate) { m.facilitator = me.name; m.facilitatorEmail = me.email; }
    if (Object.keys(body).some(k => k !== "notes")) m.version++;
    return { ok: true, version: m.version };
  }
  if ((mm = /^\/l10\/(\d+)\/attendees(?:\/(\d+))?$/.exec(p))) {
    const m = meetings.find(x => x.id === Number(mm[1]));
    if (!mm[2]) { m.attendees.push({ id: ++nid, name: body.name, email: body.email || null, expected: false, present: true, rating: null }); m.version++; return { ok: true }; }
    const at = m.attendees.find(x => x.id === Number(mm[2]));
    if (m.facilitatorEmail !== me.email && !isMe(at)) fail(403, "Only the facilitator changes other people's attendance and ratings.");
    if ("present" in body) at.present = !!body.present;
    if ("rating" in body) { at.rating = body.rating; at.present = true; }
    if ("ratingNote" in body) at.ratingNote = body.ratingNote;
    m.version++;
    if (m.summary) { m.summary.attendees = m.attendees.map(x => ({ name: x.name, present: x.present, rating: x.rating, note: x.ratingNote })); m.summary.averageRating = avg(m.attendees.filter(x => x.present).map(x => x.rating)); }
    return { ok: true };
  }
  if ((mm = /^\/l10\/(\d+)\/drop$/.exec(p))) {
    const m = meetings.find(x => x.id === Number(mm[1]));
    const id = ++nid;
    issues.push({ id, level: "company", division: null, title: body.title, description: body.description, owner: null, raisedBy: me.name, priority: null, status: "open", source: body.kind === "other" ? null : { kind: body.kind, id: body.id }, createdAt: new Date().toISOString() });
    if (body.kind === "headline") headlines.find(h => h.id === Number(body.id)).issueId = id;
    m.version++;
    return { id, existing: false };
  }
  if ((mm = /^\/l10\/(\d+)\/end$/.exec(p))) {
    const m = meetings.find(x => x.id === Number(mm[1]));
    const s = shape(m); const now = new Date();
    const mins = {}; m.log.forEach((e, i) => { const nx = i + 1 < m.log.length ? Date.parse(m.log[i + 1].at) : now.getTime(); mins[e.s] = Math.round(((mins[e.s] || 0) + (nx - Date.parse(e.at)) / 60e3) * 10) / 10; });
    m.summary = { startedAt: m.startedAt, endedAt: now.toISOString(), minutes: Math.max(1, Math.round((now - Date.parse(m.startedAt)) / 60e3)), reviewWeek: m.reviewWeek, facilitator: m.facilitator,
      attendees: m.attendees.map(x => ({ name: x.name, present: x.present, rating: x.rating, note: x.ratingNote })), averageRating: avg(m.attendees.filter(x => x.present).map(x => x.rating)),
      sections: mins, todos: { due: s.todoReview.due, done: s.todoReview.done, rate: s.todoReview.rate }, newTodos: s.newTodos, solved: s.solved,
      newIssues: issues.filter(i => i.createdAt && Date.parse(i.createdAt) >= Date.parse(m.startedAt)).map(i => i.title), headlines: s.headlines.map(h => ({ kind: h.kind, text: h.text, by: h.by })),
      rocks: { total: 3, onTrack: 2, offTrack: [{ title: "Debtor days under 20 every week", owner: "Mandy Moujalli" }] }, cascading: m.cascading, notes: m.notes };
    headlines.forEach(h => { if (!h.shared) h.shared = m.id; });
    m.status = "ended"; m.endedAt = now.toISOString(); m.version++;
    return { ok: true, summary: m.summary };
  }
  if (p === "/headlines" && method === "GET") { needLeader(); return { headlines: headlines.filter(h => !h.shared).map(h => ({ ...h, mine: h.byEmail === me.email })) }; }
  if (p === "/headlines" && method === "POST") { headlines.push({ id: ++nid, kind: body.kind, text: body.text, by: me.name, byEmail: me.email, issueId: null, shared: null }); meetings.forEach(m => m.version++); return { id: nid }; }
  if ((mm = /^\/headlines\/(\d+)$/.exec(p))) { if (body.deleted) headlines = headlines.filter(h => h.id !== Number(mm[1])); meetings.forEach(m => m.version++); return { ok: true }; }
  return null;
}
