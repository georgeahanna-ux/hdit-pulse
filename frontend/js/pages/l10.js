// The L10 meeting (0.7.0): start or join Tuesday's meeting, run the EOS agenda together, and keep
// a summary of each one. Everyone with the meeting open follows the facilitator: the page asks the
// server for the meeting's state every few seconds.
import { api } from "../api.js";
import { esc, icon, toast, fmtShort, fmtDate, fmtDateTime } from "../ui.js";
import { dialog, empty, dueText, fmtValue, prioButtons } from "../components.js";
import { scorecardBlock, mountScorecard } from "./scorecard.js";
import { rocksBlock } from "./eos.js";

const POLL_MS = 4000;
const KIND = { customer: "Customer", employee: "Employee", other: "Other" };
const timers = new Set();
function stopTimers() { for (const t of timers) clearInterval(t); timers.clear(); }
window.addEventListener("hashchange", () => { if (!/^#\/l10\/\d+/.test(location.hash)) stopTimers(); });

const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const weekRange = w => `${fmtShort(w.start)} – ${fmtShort(w.end)}`;
const plus7 = () => { const d = new Date(Date.now() + 7 * 86400e3); return d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }); };

/* ================================ entry ================================ */
export async function l10Page(me, id) {
  stopTimers();
  if (!me.access.leadership) {
    return { title: "L10 meeting", html: `<div class="ph"><span class="hd-eyebrow">Company</span><h1>L10 meeting</h1></div>
      <div class="note info">${icon("compliance")}<span>The weekly L10 is the leadership team's meeting. Your division's Rocks, Issues and To-dos are on its page.</span></div>` };
  }
  return id ? meetingPage(me, id) : overviewPage(me);
}

/* =============================== overview =============================== */
async function overviewPage(me) {
  const [o, h] = await Promise.all([api("/l10?team=company"), api("/headlines?team=company")]);
  const next = o.schedule && o.schedule.next ? new Date(o.schedule.next) : null;
  const hero = o.live
    ? `<div class="l10-hero live">
        <div><span class="chip ok">On now</span><h2>The L10 is under way</h2>
          <p>Started ${esc(fmtDateTime(o.live.startedAt))}. ${esc(o.live.facilitator)} is facilitating; the meeting is on ${esc(sectionLabel(o.sections, o.live.section))}.</p></div>
        <a class="btn signal" href="#/l10/${o.live.id}">${icon("arrow-right", "i-sm")}Join the meeting</a></div>`
    : `<div class="l10-hero">
        <div><span class="hd-eyebrow">Next L10</span><h2>${next ? esc(next.toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true })) : esc(o.schedule ? o.schedule.label : "")}</h2>
          <p>Reviews the week of ${esc(weekRange(o.reviewWeek))}. ${o.reviewWeek.locked ? "That week's Scorecard is locked." : `That week's Scorecard locks ${esc(fmtDateTime(o.reviewWeek.lockAt))}.`}</p></div>
        <button class="btn signal" type="button" id="l10-start">${icon("calendar", "i-sm")}Start the L10</button></div>`;
  const agenda = `<ol class="l10-agenda">${o.sections.map(s => `<li><b>${esc(s.label)}</b><span class="dim">${s.minutes} min</span><small class="dim">${esc(s.hint)}</small></li>`).join("")}</ol>`;
  const past = o.past.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Meeting</th><th>Week reviewed</th><th class="num">Length</th><th class="num">Rating</th><th class="num">To-dos done</th><th class="num">Issues solved</th><th></th></tr></thead>
      <tbody>${o.past.map(m => `<tr>
        <td>${esc(fmtDate(m.startedAt))}</td><td>${esc(fmtShort(m.reviewWeek))}</td>
        <td class="num">${m.minutes !== null ? `${m.minutes} min` : "—"}</td>
        <td class="num">${m.rating !== null ? `<b>${m.rating}</b>/10` : "—"}</td>
        <td class="num">${m.todoRate !== null ? `${m.todoRate}%` : "—"}</td>
        <td class="num">${m.solved}</td>
        <td><a href="#/l10/${m.id}">Summary</a></td></tr>`).join("")}</tbody></table></div>`
    : empty("No meetings yet. The first one you run here appears in this list with its summary.");
  return {
    title: "L10 meeting",
    html: `<div class="ph"><span class="hd-eyebrow">Company · ${esc(o.label)}</span><h1>L10 meeting</h1>
        <p>${esc(o.schedule ? o.schedule.label : "Weekly")}, 90 minutes, the same agenda every week. Start it here and everyone who opens it follows along.</p></div>
      ${hero}
      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Before the meeting</span><h2>Headlines</h2></div><span class="aside">Shared in the next L10</span></div>
        <p class="dim">Customer and employee news in a sentence: a client win or complaint, a new starter, a milestone. Add yours any time before Tuesday.</p>
        <div data-headlines>${headlineList(h.headlines, { canDrop: false })}</div>${headlineForm()}</section>
      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">EOS</span><h2>The agenda</h2></div></div>${agenda}</section>
      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Record</span><h2>Past meetings</h2></div></div>${past}</section>`,
    mount: (root, refresh) => {
      const s = root.querySelector("#l10-start");
      if (s) s.onclick = async () => { s.disabled = true; try { const r = await api("/l10", { method: "POST", body: { team: "company" } }); location.hash = `#/l10/${r.id}`; } catch (e) { toast(e.message); s.disabled = false; } };
      mountHeadlines(root, refresh, null);
    },
  };
}

const sectionLabel = (sections, key) => (sections.find(s => s.key === key) || { label: key }).label;

/* =============================== headlines =============================== */
function headlineList(list, { canDrop, meetingId = null } = {}) {
  if (!list.length) return empty("No headlines yet.");
  return `<ul class="headlines">${list.map(h => `<li>
      <span class="chip ${h.kind === "customer" ? "progress" : h.kind === "employee" ? "ok" : "quiet"}">${esc(KIND[h.kind] || h.kind)}</span>
      <span class="hl-text">${esc(h.text)}<span class="dim small"> · ${esc(h.by)}</span></span>
      <span class="hl-act">
        ${h.issueId ? `<span class="chip quiet">On the Issues List</span>` : canDrop ? `<button class="link-btn small" type="button" data-hl-drop="${h.id}">Drop to Issues</button>` : ""}
        ${h.mine && !h.issueId ? `<button class="link-btn small" type="button" data-hl-del="${h.id}" aria-label="Remove headline">Remove</button>` : ""}
      </span></li>`).join("")}</ul>`;
}
function headlineForm() {
  return `<form class="hl-form" data-hl-form>
      <select name="kind" aria-label="Kind of headline"><option value="customer">Customer</option><option value="employee">Employee</option><option value="other">Other</option></select>
      <input name="text" maxlength="500" placeholder="e.g. Parra Legal renewed for three years" aria-label="Headline" required>
      <button class="btn outline sm" type="submit">Add</button></form>`;
}
function mountHeadlines(root, refresh, meetingId, list = []) {
  const f = root.querySelector("[data-hl-form]");
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    if (!v.text.trim()) return;
    try { await api("/headlines", { method: "POST", body: { team: "company", ...v } }); f.reset(); toast("Headline added"); refresh(); } catch (x) { toast(x.message); }
  };
  root.querySelectorAll("[data-hl-del]").forEach(b => { b.onclick = async () => { await api(`/headlines/${b.dataset.hlDel}`, { method: "PATCH", body: { deleted: true } }); refresh(); }; });
  root.querySelectorAll("[data-hl-drop]").forEach(b => { b.onclick = () => {
    const h = list.find(x => x.id === Number(b.dataset.hlDrop));
    dropDialog(meetingId, { kind: "headline", id: h.id, title: h.text }, refresh);
  }; });
}

function dropDialog(meetingId, { kind, id, title, description = "" }, refresh) {
  dialog({
    title: "Drop to the Issues List", intro: "It goes on the leadership team's Issues List for IDS, linked to where it came from.",
    fields: [{ name: "title", label: "Issue", value: title, required: true }, { name: "description", label: "Detail", type: "textarea", rows: 3, value: description }],
    submit: "Add to Issues",
    onSubmit: async f => {
      const r = await api(`/l10/${meetingId}/drop`, { method: "POST", body: { kind, id, ...f } });
      toast(r.existing ? "Already on the Issues List" : "Added to the Issues List");
      refresh();
    },
  });
}

/* ================================ meeting ================================ */
async function meetingPage(me, id) {
  const first = await api(`/l10/${id}`);
  if (first.status === "ended") return summaryPage(me, first);
  return {
    title: "L10 meeting",
    html: `<div class="l10" data-l10>
      <header class="l10-top">
        <div class="l10-title"><span class="hd-eyebrow">L10 · reviewing ${esc(weekRange(first.reviewWeek))}</span><h1>Leadership team L10</h1></div>
        <div class="l10-clock" aria-live="off">
          <div><span class="k">This section</span><b id="t-sec">0:00</b><span class="dim small" id="t-sec-of"></span></div>
          <div><span class="k">Meeting</span><b id="t-all">0:00</b><span class="dim small">of 90:00</span></div>
        </div>
        <div class="l10-who" id="l10-who"></div>
      </header>
      <ol class="l10-steps" id="l10-steps"></ol>
      <div class="l10-banner" id="l10-banner" hidden></div>
      <div class="l10-layout">
        <section class="l10-main" id="l10-panel" aria-live="polite"></section>
        <aside class="l10-side">
          <div class="side-card"><h3>Who's here</h3><ul class="att" id="l10-att"></ul>
            <button class="link-btn small" type="button" id="l10-guest">Add someone</button></div>
          <div class="side-card"><h3>Notes</h3><textarea id="l10-notes" rows="12" placeholder="The scribe's notes. Everyone sees them; they're kept with the meeting."></textarea>
            <small class="dim" id="l10-notes-state">Saved with the meeting</small></div>
        </aside>
      </div>
      <footer class="l10-nav" id="l10-nav"></footer>
    </div>`,
    mount: root => mountMeeting(root, me, first),
  };
}

function mountMeeting(root, me, first) {
  let st = first;
  let view = st.section;                       // the section this person is looking at
  let skew = Date.parse(st.serverNow) - Date.now();
  let renderedFor = null;                      // { view, version } of the panel on screen
  let pendingPanel = false;
  const $ = s => root.querySelector(s);
  const panel = $("#l10-panel");
  const idx = k => st.sections.findIndex(s => s.key === k);

  const busy = () => document.querySelector("dialog[open]") || (panel.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));

  function drawChrome() {
    const cur = idx(st.section);
    $("#l10-steps").innerHTML = st.sections.map((s, i) => `<li class="${i < cur ? "done" : ""} ${s.key === st.section ? "now" : ""} ${s.key === view ? "view" : ""}">
        <button type="button" data-step="${s.key}" ${s.key === view ? 'aria-current="step"' : ""}><span class="n">${i + 1}</span><span class="l">${esc(s.label)}</span><span class="m">${s.minutes}′</span></button></li>`).join("");
    root.querySelectorAll("[data-step]").forEach(b => { b.onclick = () => go(b.dataset.step); });
    $("#l10-who").innerHTML = `<span class="dim small">Facilitating</span> <b>${esc(st.facilitator.name)}${st.facilitator.isMe ? " (you)" : ""}</b>
      ${st.facilitator.isMe ? "" : `<button class="link-btn small" type="button" id="l10-take">Take over</button>`}`;
    const take = $("#l10-take");
    if (take) take.onclick = async () => { await api(`/l10/${st.id}`, { method: "PATCH", body: { facilitate: true } }); await poll(true); toast("You're facilitating"); };
    const banner = $("#l10-banner");
    banner.hidden = view === st.section;
    banner.innerHTML = view === st.section ? "" : `${icon("arrow-right", "i-sm")}<span>The meeting is on <b>${esc(sectionLabel(st.sections, st.section))}</b>.</span> <button class="link-btn" type="button" id="l10-follow">Go there</button>`;
    const follow = $("#l10-follow");
    if (follow) follow.onclick = () => { view = st.section; drawChrome(); drawPanel(); };
    $("#l10-att").innerHTML = st.attendees.map(a => `<li class="${a.present ? "here" : ""}">
        <span class="dot ${a.online ? "on" : a.present ? "in" : ""}" title="${a.online ? "Has the meeting open" : a.present ? "Here" : "Not here"}"></span>
        <span class="nm">${esc(a.name)}${a.isMe ? " (you)" : ""}</span>
        ${a.rating ? `<span class="rt" title="Rating">${a.rating}</span>` : ""}
        ${st.facilitator.isMe && !a.isMe ? `<button class="link-btn small" type="button" data-present="${a.id}:${a.present ? 0 : 1}" title="${a.present ? "Mark as not at the meeting" : "Mark as at the meeting"}">${a.present ? "Mark away" : "Mark here"}</button>` : ""}</li>`).join("");
    root.querySelectorAll("[data-present]").forEach(b => { b.onclick = async () => { const [aid, v] = b.dataset.present.split(":"); await api(`/l10/${st.id}/attendees/${aid}`, { method: "PATCH", body: { present: v === "1" } }); poll(true); }; });
    const i = idx(view), isFac = st.facilitator.isMe;
    const prev = st.sections[i - 1], next = st.sections[i + 1];
    $("#l10-nav").innerHTML = isFac
      ? `${prev ? `<button class="btn outline" type="button" data-go="${prev.key}">Back: ${esc(prev.label)}</button>` : "<span></span>"}
         ${view !== st.section ? `<button class="btn" type="button" data-move="${view}">Move the meeting to ${esc(sectionLabel(st.sections, view))}</button>` : next ? `<button class="btn" type="button" data-go="${next.key}">Next: ${esc(next.label)} ${icon("arrow-right", "i-sm")}</button>` : `<button class="btn signal" type="button" id="l10-end">End the meeting</button>`}`
      : `<span class="dim small">${esc(st.facilitator.name)} moves the meeting along; your screen follows. You can look at another section any time.</span>`;
    root.querySelectorAll("[data-go]").forEach(b => { b.onclick = () => go(b.dataset.go); });
    root.querySelectorAll("[data-move]").forEach(b => { b.onclick = () => go(b.dataset.move); });
    const end = $("#l10-end");
    if (end) end.onclick = () => endDialog();
  }

  async function go(key) {
    view = key;
    if (st.facilitator.isMe && key !== st.section) {
      try { await api(`/l10/${st.id}`, { method: "PATCH", body: { section: key } }); st.section = key; st.sectionStartedAt = new Date(Date.now() + skew).toISOString(); }
      catch (e) { toast(e.message); }
    }
    drawChrome(); drawPanel();
  }

  async function drawPanel() {
    pendingPanel = false;
    const key = view;
    renderedFor = { view: key, version: st.version };
    const sec = st.sections.find(s => s.key === key);
    const head = `<div class="l10-sec-h"><h2>${esc(sec.label)}</h2><span class="dim">${sec.minutes} minutes</span></div><p class="l10-hint">${esc(sec.hint)}</p>`;
    let out;
    try { out = await SECTION[key](me, st, () => poll(true)); }
    catch (e) { out = { html: `<div class="note alert">${icon("vulnerability")}<span>${esc(e.message)}</span></div>` }; }
    if (view !== key) return;   // moved on while loading
    panel.innerHTML = head + out.html;
    if (out.mount) out.mount(panel);
  }

  function clock() {
    const now = Date.now() + skew;
    const sec = st.sections.find(s => s.key === st.section);
    const inSec = now - Date.parse(st.sectionStartedAt), all = now - Date.parse(st.startedAt);
    const a = $("#t-sec"), b = $("#t-all");
    if (!a) return stopTimers();
    a.textContent = mmss(inSec); a.classList.toggle("over", inSec > sec.minutes * 60e3);
    $("#t-sec-of").textContent = `of ${sec.minutes}:00 · ${sec.label}`;
    b.textContent = mmss(all); b.classList.toggle("over", all > 90 * 60e3);
  }

  async function poll(force = false) {
    let next;
    try { next = await api(`/l10/${st.id}`); } catch { return; }
    if (!document.body.contains(root)) return stopTimers();
    if (next.status === "ended") { stopTimers(); location.hash = `#/l10/${st.id}?ended=1`; return; }
    const moved = next.section !== st.section;
    const wasFollowing = view === st.section;
    skew = Date.parse(next.serverNow) - Date.now();
    const notes = $("#l10-notes");
    if (notes && document.activeElement !== notes && !notes.dataset.dirty) notes.value = next.notes;
    const changed = next.version !== st.version;
    st = next;
    if (moved && wasFollowing) view = st.section;
    drawChrome();
    if (moved && wasFollowing) return drawPanel();
    if (force || (changed && LIVE.has(view))) { if (busy() && !force) pendingPanel = true; else drawPanel(); }
    else if (pendingPanel && !busy()) drawPanel();
  }

  function endDialog() {
    const unrated = st.attendees.filter(a => a.present && !a.rating).map(a => a.name);
    dialog({
      title: "End the meeting?", submit: "End the meeting",
      intro: `Pulse keeps a summary: who came, ratings, To-dos, solved Issues, headlines and cascading messages.${unrated.length ? ` <b>Not rated yet:</b> ${esc(unrated.join(", "))}. They can still rate it for 12 hours afterwards.` : ""}`,
      onSubmit: async () => { await api(`/l10/${st.id}/end`, { method: "POST" }); stopTimers(); toast("Meeting ended"); location.hash = `#/l10/${st.id}?ended=1`; },
    });
  }

  // Notes: saved as you type (one second after you stop).
  const notes = $("#l10-notes");
  notes.value = st.notes;
  let t = null;
  notes.oninput = () => {
    notes.dataset.dirty = "1"; $("#l10-notes-state").textContent = "Saving…";
    clearTimeout(t);
    t = setTimeout(async () => {
      try { await api(`/l10/${st.id}`, { method: "PATCH", body: { notes: notes.value } }); delete notes.dataset.dirty; $("#l10-notes-state").textContent = "Saved with the meeting"; }
      catch (e) { $("#l10-notes-state").textContent = "Not saved: " + e.message; }
    }, 1000);
  };
  $("#l10-guest").onclick = () => dialog({ title: "Add someone to this meeting", fields: [{ name: "name", label: "Name", required: true }, { name: "email", label: "Email", type: "email" }],
    onSubmit: async f => { await api(`/l10/${st.id}/attendees`, { method: "POST", body: f }); poll(true); } });

  stopTimers();
  drawChrome(); drawPanel(); clock();
  timers.add(setInterval(clock, 1000));
  timers.add(setInterval(() => poll(false), POLL_MS));
}

/* ============================ the sections ============================ */
// Sections whose content comes from the meeting's own state redraw when anyone changes it.
const LIVE = new Set(["segue", "headlines", "todos", "ids", "conclude"]);

const SECTION = {
  async segue(me, st) {
    const here = st.attendees.filter(a => a.present);
    return { html: `<div class="segue">
        <p>Go around the room: <b>one personal and one professional</b> piece of good news from the last week.</p>
        <ul class="go-round">${here.map(a => `<li><label><input type="checkbox"> ${esc(a.name)}</label></li>`).join("")}</ul>
        <p class="dim small">The ticks are just for the room; they aren't saved.</p></div>` };
  },

  async scorecard(me, st, refresh) {
    const b = await scorecardBlock({});
    const week = st.reviewWeek.week;
    const sugg = new Set(st.suggestions.map(s => s.measurableId));
    const off = (b.data ? b.data.measurables : []).map(m => ({ m, c: m.cells.find(c => c.week === week) })).filter(x => x.c && x.c.onTarget === false);
    const missing = (b.data ? b.data.measurables : []).filter(m => { const c = m.cells.find(x => x.week === week); return c && c.value === null; });
    const list = off.length ? `<ul class="off-list">${off.map(({ m, c }) => `<li>
        <span><b>${esc(m.name)}</b> <span class="dim">${esc(fmtValue(c.value, m.unit))} against ${esc(m.goalText || fmtValue(m.goal, m.unit))} · ${esc(m.owner.name || "")}</span>
          ${sugg.has(m.id) ? `<span class="chip alert">Off two weeks running</span>` : ""}</span>
        <button class="btn outline sm" type="button" data-drop-m="${m.id}">Drop to Issues</button></li>`).join("")}</ul>`
      : `<p class="ok-line">${icon("check", "i-sm")} Everything with a goal was on target in the week of ${esc(fmtShort(week))}.</p>`;
    return {
      html: `<div class="l10-callout"><h3>Off target, week of ${esc(fmtShort(week))}</h3>${list}
          ${missing.length ? `<p class="dim small">No figure yet for ${esc(missing.map(m => m.name).join(", "))}. Owners can add them in the grid below.</p>` : ""}</div>${b.html}`,
      mount: root => {
        mountScorecard(root, b.data, refresh);
        root.querySelectorAll("[data-drop-m]").forEach(btn => { btn.onclick = () => {
          const { m, c } = off.find(x => x.m.id === Number(btn.dataset.dropM));
          dropDialog(st.id, { kind: "measurable", id: m.id, title: `${m.name} off track: ${fmtValue(c.value, m.unit)} against ${m.goalText || fmtValue(m.goal, m.unit)}` }, refresh);
        }; });
      },
    };
  },

  async rocks(me, st, refresh) {
    const b = await rocksBlock(me, { level: "company", title: false });
    const off = b.data.rocks.filter(r => r.status === "off_track");
    return {
      html: `<div class="l10-callout"><h3>${b.data.rocks.filter(r => r.status === "on_track" || r.status === "done").length} of ${b.data.rocks.length} company Rocks on track or done · ${esc(b.data.label)}</h3>
          ${off.length ? `<ul class="off-list">${off.map(r => `<li><span><b>${esc(r.title)}</b> <span class="dim">${esc(r.owner.name)}</span> <span class="chip alert">Off track</span></span>
            <button class="btn outline sm" type="button" data-drop-r="${r.id}">Drop to Issues</button></li>`).join("")}</ul>` : `<p class="dim">Each owner says "on track" or "off track". Change the status below as they go.</p>`}</div>${b.html}`,
      mount: root => {
        b.mount(root, refresh);
        root.querySelectorAll("[data-drop-r]").forEach(btn => { btn.onclick = () => {
          const r = off.find(x => x.id === Number(btn.dataset.dropR));
          dropDialog(st.id, { kind: "rock", id: r.id, title: `Rock off track: ${r.title}` }, refresh);
        }; });
      },
    };
  },

  async headlines(me, st, refresh) {
    return { html: headlineList(st.headlines, { canDrop: true, meetingId: st.id }) + headlineForm(), mount: root => mountHeadlines(root, refresh, st.id, st.headlines) };
  },

  async todos(me, st, refresh) {
    const { todos } = await api("/todos?view=company&done=all");
    const ids = new Set(st.todoReview.ids);
    const list = todos.filter(t => ids.has(t.id));
    const r = st.todoReview;
    const row = t => `<li class="todo ${t.done ? "done" : ""}"><label><input type="checkbox" data-td="${t.id}" ${t.done ? "checked" : ""}> <span>${esc(t.title)}</span></label>
        <span class="dim small">${esc(t.owner.name)} · ${t.overdue ? `<span class="chip alert">Overdue</span> ` : ""}${esc(dueText(t.dueDate))}</span>
        ${!t.done ? `<button class="link-btn small" type="button" data-drop-t="${t.id}">Drop to Issues</button>` : ""}</li>`;
    return {
      html: `<div class="l10-callout rate"><div><span class="big">${r.rate === null ? "—" : r.rate + "%"}</span><span class="dim">done</span></div>
          <p>${r.done} of ${r.due} To-dos due by today are done${r.notDue ? `; ${r.notDue} more ${r.notDue === 1 ? "isn't" : "aren't"} due yet` : ""}. EOS aims for 90% or more.</p></div>
        ${list.length ? `<ul class="todos">${list.map(row).join("")}</ul>` : empty("No To-dos to review from last week.")}`,
      mount: root => {
        root.querySelectorAll("[data-td]").forEach(c => { c.onchange = async () => { await api(`/todos/${c.dataset.td}`, { method: "PATCH", body: { done: c.checked } }); refresh(); }; });
        root.querySelectorAll("[data-drop-t]").forEach(btn => { btn.onclick = () => {
          const t = list.find(x => x.id === Number(btn.dataset.dropT));
          dropDialog(st.id, { kind: "todo", id: t.id, title: `Not done: ${t.title} (${t.owner.name})` }, refresh);
        }; });
      },
    };
  },

  async ids(me, st, refresh) {
    const { issues } = await api("/issues?level=company");
    const sorted = issues.slice().sort((a, b) => (a.priority || 9) - (b.priority || 9));
    let pick = Number(sessionStorage.getItem(`l10:${st.id}:issue`)) || (sorted[0] && sorted[0].id);
    if (!sorted.some(i => i.id === pick)) pick = sorted[0] && sorted[0].id;
    const sel = sorted.find(i => i.id === pick);
    const todosFor = sel ? st.newTodos.filter(t => t.issueId === sel.id) : [];
    const people = st.attendees.filter(a => a.present || a.expected);
    const listHtml = sorted.length ? `<ol class="ids-list">${sorted.map(i => `<li class="${i.id === pick ? "sel" : ""}">
        <span class="prio">${prioButtons(i, issues)}</span>
        <button type="button" class="ids-pick" data-pick="${i.id}">${esc(i.title)}${i.source ? ` <span class="chip quiet">${esc({ measurable: "Scorecard", rock: "Rock", headline: "Headline", todo: "To-do" }[i.source.kind] || "")}</span>` : ""}</button></li>`).join("")}</ol>`
      : empty("The Issues List is clear.");
    const detail = sel ? `<div class="ids-card">
        <span class="hd-eyebrow">${sel.priority ? `Top ${sel.priority}` : "Not numbered"}</span><h3>${esc(sel.title)}</h3>
        ${sel.description ? `<p>${esc(sel.description)}</p>` : ""}
        <p class="dim small">Raised by ${esc(sel.raisedBy || "")}${sel.owner ? ` · owner ${esc(sel.owner.name)}` : ""}</p>
        <ol class="ids-steps"><li><b>Identify</b> the real issue: say it in one sentence.</li><li><b>Discuss</b> once: everyone says their piece, no repeating.</li><li><b>Solve</b>: decide, then turn it into To-dos.</li></ol>
        ${todosFor.length ? `<h4>To-dos from this Issue</h4><ul class="todos">${todosFor.map(t => `<li class="todo"><span>${esc(t.title)}</span><span class="dim small">${esc(t.owner)} · ${esc(dueText(t.dueDate))}</span></li>`).join("")}</ul>` : ""}
        <div class="ids-act"><button class="btn outline sm" type="button" data-ids-todo>${icon("check", "i-sm")}Add a To-do</button>
          <button class="btn sm" type="button" data-ids-solve>Solved</button>
          <button class="link-btn small" type="button" data-ids-drop>Drop it</button></div></div>` : "";
    return {
      html: `<div class="ids">${listHtml}${detail}</div><button class="btn outline" type="button" data-ids-add>${icon("discover", "i-sm")}Add an Issue</button>`,
      mount: root => {
        root.querySelectorAll("[data-pick]").forEach(b => { b.onclick = () => { sessionStorage.setItem(`l10:${st.id}:issue`, b.dataset.pick); refresh(); }; });
        root.querySelectorAll("[data-prio]").forEach(b => { b.onclick = async () => {
          const [id, n] = b.dataset.prio.split(":"); const i = issues.find(x => x.id === Number(id));
          try { await api(`/issues/${id}`, { method: "PATCH", body: { priority: i.priority === Number(n) ? null : Number(n) } }); } catch (e) { toast(e.message); }
          refresh();
        }; });
        const add = root.querySelector("[data-ids-add]");
        add.onclick = () => dialog({ title: "Add an Issue", fields: [{ name: "title", label: "Issue", required: true }, { name: "description", label: "Detail", type: "textarea", rows: 3 }],
          onSubmit: async f => { await api(`/l10/${st.id}/drop`, { method: "POST", body: { kind: "other", ...f } }); refresh(); } });
        if (!sel) return;
        root.querySelector("[data-ids-todo]").onclick = () => dialog({
          title: "Add a To-do", intro: `For: ${esc(sel.title)}`,
          fields: [{ name: "title", label: "To-do", required: true },
            { name: "owner", label: "Who", type: "select", options: people.map(a => ({ v: a.name, t: a.name })), value: (people.find(a => a.isMe) || people[0] || {}).name, required: true },
            { name: "dueDate", label: "Due", type: "date", value: plus7() }],
          onSubmit: async f => {
            const who = people.find(a => a.name === f.owner) || {};
            await api("/todos", { method: "POST", body: { level: "company", title: f.title, ownerName: f.owner, ownerEmail: who.email || "", dueDate: f.dueDate, issueId: sel.id } });
            toast("To-do added"); refresh();
          },
        });
        root.querySelector("[data-ids-solve]").onclick = () => dialog({ title: "Solved", intro: esc(sel.title),
          fields: [{ name: "solution", label: "What was decided", type: "textarea", rows: 3, required: true, hint: "The To-dos carry out the decision." }], submit: "Mark solved",
          onSubmit: async f => { await api(`/issues/${sel.id}`, { method: "PATCH", body: { status: "solved", solution: f.solution } }); sessionStorage.removeItem(`l10:${st.id}:issue`); toast("Solved"); refresh(); } });
        root.querySelector("[data-ids-drop]").onclick = () => dialog({ title: "Drop this Issue?", intro: "It comes off the list (it's no longer an issue, or not one for this team). It stays in the record.", submit: "Drop", danger: true,
          onSubmit: async () => { await api(`/issues/${sel.id}`, { method: "PATCH", body: { status: "dropped" } }); sessionStorage.removeItem(`l10:${st.id}:issue`); refresh(); } });
      },
    };
  },

  async conclude(me, st, refresh) {
    const present = st.attendees.filter(a => a.present);
    const rated = present.filter(a => a.rating);
    const avg = rated.length ? Math.round(rated.reduce((s, a) => s + a.rating, 0) / rated.length * 10) / 10 : null;
    return {
      html: `<div class="conclude">
        <div class="conc-col"><h3>New To-dos (${st.newTodos.length})</h3>
          ${st.newTodos.length ? `<ul class="todos">${st.newTodos.map(t => `<li class="todo"><span>${esc(t.title)}</span><span class="dim small">${esc(t.owner)} · ${esc(dueText(t.dueDate))}</span></li>`).join("")}</ul>` : `<p class="dim">None made in this meeting.</p>`}
          <h3>Solved (${st.solved.length})</h3>
          ${st.solved.length ? `<ul class="plain">${st.solved.map(i => `<li><b>${esc(i.title)}</b>${i.solution ? `<div class="dim small">${esc(i.solution)}</div>` : ""}</li>`).join("")}</ul>` : `<p class="dim">No Issues solved yet.</p>`}
          <h3>Cascading messages</h3>
          <p class="dim small">What does the rest of HD IT need to hear from this meeting, and who tells them?</p>
          <textarea id="l10-cascade" rows="4" placeholder="e.g. New SLA targets from Monday: Tony tells the service team">${esc(st.cascading)}</textarea></div>
        <div class="conc-col"><h3>Rate the meeting</h3>
          <p class="dim small">1 to 10. Anything under 8: say what would make it a 10.</p>
          <div class="ratings">${present.map(a => `<div class="rate-row">
              <span class="nm">${esc(a.name)}${a.isMe ? " (you)" : ""}</span>
              <span class="scale" role="group" aria-label="Rating for ${esc(a.name)}">${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<button type="button" class="${a.rating === n ? "on" : ""}" data-rate="${a.id}:${n}" ${a.canRate ? "" : "disabled"}>${n}</button>`).join("")}</span>
              ${a.rating && a.rating < 8 ? `<input class="rate-note" data-note="${a.id}" value="${esc(a.ratingNote || "")}" placeholder="What would make it a 10?" ${a.canRate ? "" : "disabled"}>` : ""}
            </div>`).join("") || `<p class="dim">Nobody is marked as here.</p>`}</div>
          <div class="avg"><span class="big">${avg ?? "—"}</span><span class="dim">average of ${rated.length} of ${present.length}</span></div></div></div>`,
      mount: root => {
        const c = root.querySelector("#l10-cascade");
        c.onchange = async () => { await api(`/l10/${st.id}`, { method: "PATCH", body: { cascading: c.value } }); toast("Cascading messages saved"); };
        root.querySelectorAll("[data-rate]").forEach(b => { b.onclick = async () => { const [aid, n] = b.dataset.rate.split(":"); await api(`/l10/${st.id}/attendees/${aid}`, { method: "PATCH", body: { rating: Number(n) } }); refresh(); }; });
        root.querySelectorAll("[data-note]").forEach(i => { i.onchange = async () => { await api(`/l10/${st.id}/attendees/${i.dataset.note}`, { method: "PATCH", body: { ratingNote: i.value } }); }; });
      },
    };
  },
};

/* ================================ summary ================================ */
function summaryPage(me, st) {
  const s = st.summary || {};
  const started = new Date(st.startedAt);
  const canStillRate = st.attendees.filter(a => a.canRate && !a.rating && a.present);
  const sectionRows = st.sections.map(x => ({ ...x, actual: (s.sections || {})[x.key] ?? 0 }));
  const kpi = (k, v, sub) => `<div class="kpi"><span class="k">${esc(k)}</span><b>${v}</b><span class="dim small">${esc(sub)}</span></div>`;
  const list = (items, fn, none) => (items && items.length ? `<ul class="plain">${items.map(fn).join("")}</ul>` : `<p class="dim">${esc(none)}</p>`);
  return {
    title: "L10 summary",
    html: `<div class="ph"><span class="hd-eyebrow">L10 · ${esc(fmtDate(st.startedAt))}</span><h1>Leadership team L10</h1>
        <p>Reviewed the week of ${esc(weekRange(st.reviewWeek))}. Facilitated by ${esc(s.facilitator || st.facilitator.name)}; ${started.toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hour12: true })} for ${s.minutes ?? "—"} minute${s.minutes === 1 ? "" : "s"}.</p>
        <div class="ph-act"><a class="btn outline sm" href="#/l10">All meetings</a><button class="btn outline sm" type="button" onclick="window.print()">Print or save as PDF</button></div></div>
      <div class="kpis">
        ${kpi("Meeting rating", s.averageRating !== null && s.averageRating !== undefined ? `${s.averageRating}<small>/10</small>` : "—", `${(s.attendees || []).filter(a => a.rating).length} ratings`)}
        ${kpi("Length", `${s.minutes ?? "—"}<small> min</small>`, "Planned 90")}
        ${kpi("To-dos done", s.todos && s.todos.rate !== null ? `${s.todos.rate}%` : "—", s.todos ? `${s.todos.done} of ${s.todos.due} due` : "")}
        ${kpi("Issues solved", String((s.solved || []).length), `${(s.newIssues || []).length} added`)}
      </div>
      <div class="sum-grid">
        <section class="sec"><div class="sec-h"><h2>Who came</h2></div>
          <table class="tbl"><thead><tr><th>Name</th><th>Here</th><th class="num">Rating</th><th>Comment</th></tr></thead>
          <tbody>${(st.attendees || []).map(a => `<tr><td>${esc(a.name)}</td><td>${a.present ? "Yes" : "No"}</td>
            <td class="num">${a.rating ? `<b>${a.rating}</b>` : a.canRate && a.present ? `<span class="scale sm">${Array.from({ length: 10 }, (_, i) => `<button type="button" data-rate="${a.id}:${i + 1}">${i + 1}</button>`).join("")}</span>` : "—"}</td>
            <td>${esc(a.ratingNote || "")}</td></tr>`).join("")}</tbody></table>
          ${canStillRate.length ? `<p class="dim small">You can still rate this meeting for 12 hours after it ended.</p>` : ""}</section>
        <section class="sec"><div class="sec-h"><h2>New To-dos</h2></div>${list(s.newTodos, t => `<li><b>${esc(t.title)}</b> <span class="dim small">${esc(t.owner)} · ${esc(dueText(t.dueDate))}</span></li>`, "None.")}</section>
        <section class="sec"><div class="sec-h"><h2>Issues solved</h2></div>${list(s.solved, i => `<li><b>${esc(i.title)}</b>${i.solution ? `<div class="dim small">${esc(i.solution)}</div>` : ""}</li>`, "None.")}</section>
        <section class="sec"><div class="sec-h"><h2>Added to the Issues List</h2></div>${list(s.newIssues, i => `<li>${esc(i)}</li>`, "None.")}</section>
        <section class="sec"><div class="sec-h"><h2>Headlines</h2></div>${list(s.headlines, h => `<li><span class="chip quiet">${esc(KIND[h.kind] || h.kind)}</span> ${esc(h.text)} <span class="dim small">${esc(h.by)}</span></li>`, "None.")}</section>
        <section class="sec"><div class="sec-h"><h2>Rocks</h2></div><p>${s.rocks ? `${s.rocks.onTrack} of ${s.rocks.total} on track or done.` : ""}</p>
          ${list(s.rocks && s.rocks.offTrack, r => `<li><span class="chip alert">Off track</span> ${esc(r.title)} <span class="dim small">${esc(r.owner)}</span></li>`, "None off track.")}</section>
        <section class="sec"><div class="sec-h"><h2>Cascading messages</h2></div>${s.cascading ? `<p class="pre">${esc(s.cascading)}</p>` : `<p class="dim">None recorded.</p>`}</section>
        <section class="sec"><div class="sec-h"><h2>Time per section</h2></div>
          <table class="tbl"><thead><tr><th>Section</th><th class="num">Planned</th><th class="num">Actual</th></tr></thead>
          <tbody>${sectionRows.map(x => `<tr><td>${esc(x.label)}</td><td class="num">${x.minutes} min</td><td class="num ${x.actual > x.minutes * 1.2 ? "over" : ""}">${x.actual} min</td></tr>`).join("")}</tbody></table></section>
      </div>
      ${s.notes ? `<section class="sec"><div class="sec-h"><h2>Notes</h2></div><div class="notes-box pre">${esc(s.notes)}</div></section>` : ""}`,
    mount: (root, refresh) => {
      root.querySelectorAll("[data-rate]").forEach(b => { b.onclick = async () => { const [aid, n] = b.dataset.rate.split(":"); try { await api(`/l10/${st.id}/attendees/${aid}`, { method: "PATCH", body: { rating: Number(n) } }); toast("Thanks for rating"); refresh(); } catch (e) { toast(e.message); } }; });
    },
  };
}
