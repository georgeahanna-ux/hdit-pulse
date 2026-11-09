// Projects (D21): programme Gantt of every open Autotask project, grouped by client, and a
// Gantt for each project with phases, tasks, dependencies, critical path and baseline.
import { api } from "../api.js";
import { esc, icon, toast, fmtDateTime } from "../ui.js";
import { dialog, empty } from "../components.js";
import { ganttHtml, scrollToDay, SCALES, enableDrag } from "../gantt.js";

const HEALTH = {
  "late": { label: "Late", cls: "alert" },
  "at-risk": { label: "At risk", cls: "warn" },
  "on-track": { label: "On track", cls: "ok" },
  "not-started": { label: "Not started", cls: "quiet" },
  "done": { label: "Done", cls: "quiet" },
};
const chip = h => `<span class="chip h-${h}">${esc((HEALTH[h] || { label: h }).label)}</span>`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtD = d => (d ? `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) !== new Date().toISOString().slice(0, 4) ? " " + d.slice(0, 4) : ""}` : "—");
const hrs = h => (h === null || h === undefined ? "—" : `${Math.round(h * 10) / 10} h`);
const RESCHEDULE = false;   // dragging bars arrives in 0.6.1
const initials = n => String(n || "?").split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase();

// Remembered per browser: zoom, collapsed rows and toggles. Storage can be unavailable.
const store = {
  get(k, d) { try { const v = localStorage.getItem("hdit-pulse:pj:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("hdit-pulse:pj:" + k, JSON.stringify(v)); } catch { /* not available */ } },
};

function zoomBar(current, allowed) {
  return `<div class="seg" role="group" aria-label="Zoom">${allowed.map(s => `<button type="button" class="${s === current ? "on" : ""}" data-zoom="${s}" aria-pressed="${s === current}">${SCALES[s].label}</button>`).join("")}</div>`;
}

function syncLine(at) {
  return `<span class="dim small">${at ? `From Autotask, ${esc(fmtDateTime(at))}` : "Not read from Autotask yet"}</span>`;
}

export function denied(title) {
  return { title, html: `<div class="denied"><span class="ic">${icon("compliance", "i-lg")}</span><h2>Projects are for Managed Services, Project Managers and Leadership</h2>
    <p>Ask a Platform Admin if you should be in <b>Pulse - Project Managers</b> or <b>Pulse - Division Managed Services</b>.</p><a href="#/">Back to Home</a></div>` };
}

/* =============================== PROGRAMME =============================== */
export async function programmePage(me) {
  if (!me.access.viewProjects) return denied("Projects");
  const data = await api("/projects");
  const state = { scale: store.get("scale", "week"), q: "", health: "all", collapsed: new Set(store.get("collapsed", [])), openProjects: new Set() };
  const t = data.totals;
  const tiles = `<div class="tiles">
    <div class="tile"><span>Open projects</span><b>${t.projects}</b><small>${data.clients.length} clients</small></div>
    <div class="tile ${t.late ? "bad" : ""}"><span>Late</span><b>${t.late}</b><small>past their end date</small></div>
    <div class="tile ${t.atRisk ? "warn" : ""}"><span>At risk</span><b>${t.atRisk}</b><small>overdue tasks or behind time</small></div>
    <div class="tile"><span>Work remaining</span><b>${Math.round(t.remainingHours / 7.6).toLocaleString("en-AU")} days</b><small>${t.remainingHours.toLocaleString("en-AU")} hours · ${(t.remainingHours / 38).toFixed(1)} person-weeks</small></div>
  </div>`;

  const rowsFor = () => {
    const q = state.q.trim().toLowerCase();
    const rows = [];
    for (const c of data.clients) {
      const ps = c.projects.filter(p => (state.health === "all" || p.health === state.health) && (!q || (c.name + " " + p.name + " " + (p.number || "") + " " + (p.lead || "")).toLowerCase().includes(q)));
      if (!ps.length) continue;
      const days = ps.flatMap(p => [p.start, p.end]).filter(Boolean).sort();
      const worst = ["late", "at-risk", "on-track", "not-started", "done"].find(h => ps.some(p => p.health === h));
      const cid = `c${c.id}`;
      const collapsed = state.collapsed.has(cid);
      rows.push({ id: cid, kind: "client", depth: 0, label: c.name, sub: `${ps.length} project${ps.length === 1 ? "" : "s"}`, start: days[0], end: days[days.length - 1],
        health: worst, collapsible: true, collapsed, barLabel: "", cols: { pct: "", lead: "" } });
      if (collapsed) continue;
      for (const p of ps) {
        const pid = `p${p.id}`;
        const open = state.openProjects.has(pid);
        rows.push({ id: pid, kind: "project", depth: 1, label: p.name, href: `#/projects/${p.id}`,
          sub: [p.number, p.lead ? `Lead: ${p.lead}` : null, `${p.done}/${p.tasks} tasks`, p.overdue ? `${p.overdue} overdue` : null].filter(Boolean).join(" · "),
          start: p.start, end: p.end, pct: p.pct, health: p.health, collapsible: p.phases.length > 0, collapsed: !open, outsideLabel: `${p.pct}%`,
          cols: { pct: `${p.pct}%`, lead: p.lead ? `<span class="av" title="${esc(p.lead)}">${esc(initials(p.lead))}</span>` : "" } });
        if (open) for (const ph of p.phases) rows.push({ id: `ph${ph.id}`, kind: "phase", depth: 2, label: ph.title, href: `#/projects/${p.id}`,
          start: ph.start, end: ph.end, pct: ph.pct, health: ph.health, cols: { pct: `${ph.pct}%`, lead: "" } });
      }
    }
    return rows;
  };
  const opts = () => ({ rows: rowsFor(), range: data.range, today: data.today, scale: state.scale, labelHead: "Client and project", rowH: 44, labelWidth: 380,
    columns: [{ key: "pct", label: "Done", width: 52 }, { key: "lead", label: "Lead", width: 40 }] });

  const html = `<div class="ph"><span class="hd-eyebrow">Managed Services</span><h1>Projects</h1>
      <p>Every open project in Autotask, grouped by client. Select a project to see its tasks.</p></div>
    ${data.clients.length ? tiles : ""}
    <div class="pj-bar">
      <label class="fld inline"><span class="sr">Find</span><input type="search" id="pj-q" placeholder="Find a client, project or lead"></label>
      <div class="seg" role="group" aria-label="Show">${[["all", "All"], ["late", "Late"], ["at-risk", "At risk"], ["on-track", "On track"], ["not-started", "Not started"]]
        .map(([k, l]) => `<button type="button" data-health="${k}" class="${k === "all" ? "on" : ""}" aria-pressed="${k === "all"}">${l}</button>`).join("")}</div>
      <span class="grow"></span>
      <button type="button" class="btn outline sm" id="pj-today">Today</button>
      <span id="pj-zoom">${zoomBar(state.scale, ["week", "month", "quarter"])}</span>
    </div>
    <div id="pj-chart">${data.clients.length ? ganttHtml(opts()) : empty("No open projects in Pulse yet. Once the Autotask connection is entered, projects appear within 15 minutes.")}</div>
    <div class="pj-foot"><div class="legend small">
      <span><i class="sw h-on-track"></i>On track</span><span><i class="sw h-at-risk"></i>At risk</span><span><i class="sw h-late"></i>Late</span>
      <span><i class="sw h-not-started"></i>Not started</span><span><i class="sw h-done"></i>Done</span><span><i class="sw today"></i>Today</span></div>
      <span class="grow"></span>${syncLine(data.lastSync)} <button class="link-btn small" type="button" id="pj-refresh">Refresh from Autotask</button></div>`;

  return {
    title: "Projects", html,
    mount: (root, refresh) => {
      const chart = root.querySelector("#pj-chart");
      const draw = (keepScroll = true) => {
        if (!data.clients.length) return;
        const sc = chart.querySelector(".g-scroll");
        const pos = sc && keepScroll ? [sc.scrollLeft, sc.scrollTop] : null;
        const o = opts();
        chart.innerHTML = o.rows.length ? ganttHtml(o) : empty("No projects match.");
        const s2 = chart.querySelector(".g-scroll");
        if (s2 && pos) [s2.scrollLeft, s2.scrollTop] = pos; else if (s2) scrollToDay(chart, o, data.today);
        wire();
      };
      const wire = () => {
        chart.querySelectorAll("[data-tog]").forEach(b => b.onclick = () => {
          const id = b.dataset.tog;
          if (id.startsWith("c")) { state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id); store.set("collapsed", [...state.collapsed]); }
          else state.openProjects.has(id) ? state.openProjects.delete(id) : state.openProjects.add(id);
          draw();
        });
        chart.querySelectorAll(".g-bar, .g-ms").forEach(b => b.onclick = () => {
          const id = b.dataset.bar;
          if (id.startsWith("p")) location.hash = `#/projects/${id.slice(1)}`;
          if (id.startsWith("ph")) { const row = opts().rows.find(r => r.id === id); if (row) location.hash = row.href; }
          if (id.startsWith("c")) { state.collapsed.delete(id); draw(); }
        });
      };
      draw(false);
      root.querySelector("#pj-q").oninput = e => { state.q = e.target.value; draw(); };
      root.querySelectorAll("[data-health]").forEach(b => b.onclick = () => {
        state.health = b.dataset.health;
        root.querySelectorAll("[data-health]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
        draw();
      });
      const zoom = () => root.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => {
        state.scale = b.dataset.zoom; store.set("scale", state.scale);
        root.querySelector("#pj-zoom").innerHTML = zoomBar(state.scale, ["week", "month", "quarter"]); zoom(); draw(false);
      });
      zoom();
      root.querySelector("#pj-today").onclick = () => scrollToDay(chart, opts(), data.today);
      root.querySelector("#pj-refresh").onclick = async e => { e.target.disabled = true; try { toast((await api("/projects/refresh", { method: "POST", body: {} })).detail); } catch (x) { toast(x.message); e.target.disabled = false; } };
    },
  };
}

/* =============================== ONE PROJECT =============================== */
export async function projectPage(me, id) {
  if (!me.access.viewProjects) return denied("Project");
  const data = await api(`/projects/${encodeURIComponent(id)}`);
  const p = data.project;
  const who = new Map(data.people.map(x => [x.id, x]));
  const hol = new Set(data.holidays);
  const state = {
    scale: store.get("pscale", "day"), links: store.get("links", true), critical: store.get("critical", false), baseline: store.get("baseline", true),
    mine: false, collapsed: new Set(),
  };
  const byPhase = new Map();
  for (const t of data.tasks) (byPhase.get(t.phaseId || 0) || byPhase.set(t.phaseId || 0, []).get(t.phaseId || 0)).push(t);
  const crit = data.tasks.filter(t => t.critical).length;
  const overdue = data.tasks.filter(t => !t.complete && t.end && t.end < data.today).length;
  const remaining = data.tasks.filter(t => !t.complete).reduce((s, t) => s + Math.max(0, t.remaining ?? t.estimated ?? 0), 0);

  const taskRow = (t, depth) => {
    const person = t.resource ? who.get(t.resource) : null;
    return {
      id: `t${t.id}`, taskId: t.id, kind: "task", depth, label: t.title, sub: [t.number, person ? person.name : "Unassigned", t.roleName].filter(Boolean).join(" · "),
      start: t.start, end: t.end, pct: t.complete ? 100 : t.estimated ? Math.min(99, Math.round((100 * t.worked) / Math.max(t.estimated, t.worked + (t.remaining || 0)))) : 0,
      health: t.complete ? "done" : t.end && t.end < data.today ? "late" : t.start && t.start > data.today ? "not-started" : "on-track",
      complete: t.complete, milestone: t.milestone, critical: state.critical && t.critical, mine: t.mine,
      baseline: state.baseline ? t.baseline : null, drag: RESCHEDULE && data.can.reschedule && !t.complete,
      cols: { who: person ? `<span class="av ${t.mine ? "me" : ""}" title="${esc(person.name)}">${esc(initials(person.name))}</span>` : `<span class="dim">—</span>`,
        hours: `${Math.round(t.worked * 10) / 10}/${t.estimated === null ? "—" : Math.round(t.estimated * 10) / 10}` },
    };
  };
  const rowsFor = () => {
    const rows = [];
    const keep = t => !state.mine || t.mine;
    for (const ph of data.phases) {
      const ts = (byPhase.get(ph.id) || []).filter(keep);
      if (!ts.length && state.mine) continue;
      const days = ts.flatMap(t => [t.start, t.end]).filter(Boolean).sort();
      const pid = `ph${ph.id}`;
      const done = ts.filter(t => t.complete).length;
      rows.push({ id: pid, kind: "phase", depth: 0, label: ph.title, sub: `${done}/${ts.length} tasks`, start: days[0] || ph.start, end: days[days.length - 1] || ph.end,
        pct: ts.length ? Math.round((100 * done) / ts.length) : 0, health: ts.length && done === ts.length ? "done" : "phase", collapsible: true, collapsed: state.collapsed.has(pid), barLabel: "",
        cols: { who: "", hours: "" } });
      if (!state.collapsed.has(pid)) rows.push(...ts.map(t => taskRow(t, 1)));
    }
    rows.push(...(byPhase.get(0) || []).filter(keep).map(t => taskRow(t, 0)));
    return rows;
  };
  const opts = () => ({ rows: rowsFor(), range: { start: p.start || data.today, end: p.end || data.today }, today: data.today, scale: state.scale,
    links: state.links ? data.links : null, holidays: hol, labelHead: "Phase and task", rowH: 40, labelWidth: 400,
    columns: [{ key: "who", label: "Who", width: 40 }, { key: "hours", label: "Hours", width: 64 }] });

  const toggle = (k, label) => `<label class="check small"><input type="checkbox" data-opt="${k}" ${state[k] ? "checked" : ""}> ${label}</label>`;
  const html = `<div class="ph"><a class="back small" href="#/projects">${icon("arrow-right", "i-sm flip")}All projects</a>
      <span class="hd-eyebrow">${esc(p.company)}${p.number ? ` · ${esc(p.number)}` : ""}</span><h1>${esc(p.name)}</h1>
      <p class="chips">${chip(p.health)}${p.status ? `<span class="chip quiet">${esc(p.status)}</span>` : ""}${p.lead ? `<span class="chip quiet">Lead: ${esc(p.lead)}</span>` : ""}</p></div>
    <div class="tiles">
      <div class="tile"><span>Done</span><b>${p.pct}%</b><div class="mini-bar"><i style="width:${p.pct}%"></i></div></div>
      <div class="tile"><span>Dates</span><b class="sm">${esc(fmtD(p.start))} – ${esc(fmtD(p.end))}</b><small>${data.tasks.length} tasks</small></div>
      <div class="tile"><span>Work remaining</span><b>${(remaining / 7.6).toFixed(1)} days</b><small>${Math.round(remaining)} hours</small></div>
      <div class="tile ${overdue ? "bad" : ""}"><span>Overdue tasks</span><b>${overdue}</b><small>${crit} on the critical path</small></div>
    </div>
    <div class="pj-bar">
      ${toggle("links", "Dependencies")}${toggle("critical", "Critical path")}${toggle("baseline", "Baseline")}
      ${data.me ? `<label class="check small"><input type="checkbox" data-opt="mine"> My tasks only</label>` : ""}
      <span class="grow"></span>
      <button type="button" class="btn outline sm" id="pj-today">Today</button>
      <span id="pj-zoom">${zoomBar(state.scale, ["day", "week", "month"])}</span>
    </div>
    ${RESCHEDULE && data.can.reschedule ? `<p class="small dim pj-hint">${icon("strategise", "i-sm")} Drag a bar to move a task, or drag its ends to change its dates. Dependent tasks move with it; you'll see every change before anything is saved to Autotask.</p>` : ""}
    <div id="pj-chart">${data.tasks.length ? ganttHtml(opts()) : empty("This project has no tasks in Autotask yet.")}</div>
    <div class="pj-foot"><div class="legend small">
      <span><i class="sw h-on-track"></i>In progress</span><span><i class="sw h-not-started"></i>Not started</span><span><i class="sw h-late"></i>Overdue</span><span><i class="sw h-done"></i>Complete</span>
      <span><i class="sw crit"></i>Critical path</span><span><i class="sw base"></i>Baseline</span><span><i class="sw ms"></i>Milestone</span></div>
      <span class="grow"></span>${syncLine(data.lastSync)} <button class="link-btn small" type="button" id="pj-refresh">Refresh from Autotask</button></div>`;

  return {
    title: p.name, html,
    mount: (root, refresh) => {
      const chart = root.querySelector("#pj-chart");
      const draw = (keepScroll = true) => {
        if (!data.tasks.length) return;
        const sc = chart.querySelector(".g-scroll");
        const pos = sc && keepScroll ? [sc.scrollLeft, sc.scrollTop] : null;
        const o = opts();
        chart.innerHTML = ganttHtml(o);
        const s2 = chart.querySelector(".g-scroll");
        if (pos) [s2.scrollLeft, s2.scrollTop] = pos; else scrollToDay(chart, o, data.today >= (p.start || "") && data.today <= (p.end || "") ? data.today : p.start || data.today);
        wire(o);
      };
      const wire = o => {
        chart.querySelectorAll("[data-tog]").forEach(b => b.onclick = () => { const k = b.dataset.tog; state.collapsed.has(k) ? state.collapsed.delete(k) : state.collapsed.add(k); draw(); });
        chart.querySelectorAll("[data-bar], [data-open]").forEach(b => b.addEventListener("click", e => {
          if (b.dataset.justDragged) { delete b.dataset.justDragged; return; }
          const rid = b.dataset.bar || b.dataset.open;
          if (rid && rid.startsWith("t")) { e.preventDefault(); openTask(data.tasks.find(t => `t${t.id}` === rid), data, who, refresh); }
        }));
        if (RESCHEDULE && data.can.reschedule) enableDrag(chart, o, change => planMove(data, change, refresh));
      };
      draw(false);
      root.querySelectorAll("[data-opt]").forEach(c => c.onchange = () => { state[c.dataset.opt] = c.checked; if (c.dataset.opt !== "mine") store.set(c.dataset.opt, c.checked); draw(); });
      const zoom = () => root.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => {
        state.scale = b.dataset.zoom; store.set("pscale", state.scale);
        root.querySelector("#pj-zoom").innerHTML = zoomBar(state.scale, ["day", "week", "month"]); zoom(); draw(false);
      });
      zoom();
      root.querySelector("#pj-today").onclick = () => scrollToDay(chart, opts(), data.today);
      root.querySelector("#pj-refresh").onclick = async e => { e.target.disabled = true; try { await api("/projects/refresh", { method: "POST", body: { id: p.id } }); toast("Re-read from Autotask"); refresh(); } catch (x) { toast(x.message); e.target.disabled = false; } };
    },
  };
}

/* ---------- a task: details (0.6.0); time entry and complete arrive in 0.6.1 ---------- */
function openTask(t, data, who, refresh) {
  if (!t) return;
  const name = id => (who.get(id) || { name: `Resource ${id}` }).name;
  const title = id => (data.tasks.find(x => x.id === id) || { title: `Task ${id}` }).title;
  const before = data.links.filter(l => l.succ === t.id).map(l => title(l.pred) + (l.lag ? ` (+${l.lag} days)` : ""));
  const after = data.links.filter(l => l.pred === t.id).map(l => title(l.succ));
  dialog({
    title: t.title,
    extra: `<dl class="def">
      <dt>Status</dt><dd>${t.complete ? "Complete" : t.end && t.end < data.today ? `<b class="alert-t">Overdue</b>` : "Open"}${t.critical ? ` · <span class="chip h-late">Critical path</span>` : t.float !== null && t.float !== undefined && !t.complete ? ` · ${t.float} days of float` : ""}</dd>
      <dt>Dates</dt><dd>${esc(fmtD(t.start))} – ${esc(fmtD(t.end))}${t.baseline && (t.baseline.start !== t.start || t.baseline.end !== t.end) ? `<div class="dim small">Baseline ${esc(fmtD(t.baseline.start))} – ${esc(fmtD(t.baseline.end))}</div>` : ""}</dd>
      <dt>Assigned</dt><dd>${t.resource ? esc(name(t.resource)) : "Nobody"}${t.roleName ? ` <span class="dim">(${esc(t.roleName)})</span>` : ""}${t.secondary.length ? `<div class="dim small">Also: ${esc(t.secondary.map(name).join(", "))}</div>` : ""}</dd>
      <dt>Hours</dt><dd>${hrs(t.worked)} worked of ${hrs(t.estimated)} estimated${t.remaining !== null ? ` · ${hrs(t.remaining)} remaining` : ""}</dd>
      ${before.length ? `<dt>Waits for</dt><dd>${esc(before.join(", "))}</dd>` : ""}
      ${after.length ? `<dt>Then</dt><dd>${esc(after.join(", "))}</dd>` : ""}
    </dl>`,
  });
}

/** Dragging a bar (0.6.1 wires the save). */
async function planMove(data, change, refresh) {
  toast("Rescheduling arrives in 0.6.1.");
  throw new Error("not yet");
}
