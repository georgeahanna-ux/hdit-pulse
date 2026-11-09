// Projects (D21): resource planner (like MS Project's Resource Usage) and project lead time
// with what-if modelling for Sales.
import { api } from "../api.js";
import { esc, icon, toast } from "../ui.js";
import { dialog, empty, tabs } from "../components.js";
import { fmtD, denied } from "./projects.js";

const H = 7.6;
const r1 = x => Math.round(x * 10) / 10;
const n0 = x => Math.round(x).toLocaleString("en-AU");
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

export function projectTabs(me, on) {
  const list = [];
  if (me.access.viewProjects) list.push({ href: "#/projects", label: "Programme", on: on === "programme" }, { href: "#/projects/resources", label: "Resource planner", on: on === "resources" });
  if (me.access.viewLeadTime) list.push({ href: "#/projects/lead-time", label: "Lead time", on: on === "lead" });
  return list.length > 1 ? tabs(list) : "";
}

/** Utilisation band for a cell. */
const band = (a, c) => (!c ? (a ? "over" : "none") : a / c > 1.0001 ? "over" : a / c >= 0.85 ? "full" : a / c >= 0.6 ? "good" : a > 0 ? "low" : "idle");

/* =============================== RESOURCE PLANNER =============================== */
export async function resourcesPage(me, q = {}) {
  if (!me.access.viewProjects) return denied("Resource planner");
  const weeksN = [8, 12, 26].includes(Number(q.weeks)) ? Number(q.weeks) : 12;
  const data = await api(`/projects/resources?weeks=${weeksN}`);
  const state = { mode: "hours", open: new Set() };
  const next4 = data.weeks.slice(0, 4);
  const cap4 = next4.reduce((s, w) => s + w.capacity, 0), alloc4 = next4.reduce((s, w) => s + w.allocated, 0);
  const over = data.people.filter(p => p.weeks.slice(0, 4).some(w => w.capacity && w.allocated > w.capacity + 0.05));
  const under = data.people.filter(p => { const c = p.weeks.slice(0, 4).reduce((s, w) => s + w.capacity, 0), a = p.weeks.slice(0, 4).reduce((s, w) => s + w.allocated, 0); return c && a / c < 0.6; });
  const unassigned = data.unassigned.reduce((s, w) => s + w.allocated, 0);

  const cellText = (w, cap) => state.mode === "pct" && cap ? `${Math.round((100 * w.allocated) / cap)}%` : `${r1(w.allocated)}<small>/${r1(cap || 0)}</small>`;
  const table = () => {
    const head = data.weeks.map(w => `<th class="wk">${esc(fmtD(w.week))}${data.holidays.some(h => h >= w.week && h <= addDays(w.week, 4)) ? `<span class="wk-tag">Holiday</span>` : ""}</th>`).join("");
    const teamRow = `<tr class="team"><th scope="row"><b>Whole team</b><small>${data.people.length} people · ${Math.round(data.share * 100)}% kept for other work</small></th>
      ${data.weeks.map(w => `<td class="rp ${band(w.allocated, w.capacity)}"><span>${state.mode === "pct" && w.capacity ? `${Math.round((100 * w.allocated) / w.capacity)}%` : `${n0(w.allocated)}<small>/${n0(w.capacity)}</small>`}</span></td>`).join("")}</tr>`;
    const personRows = data.people.map(p => {
      const c = p.weeks.reduce((s, w) => s + w.capacity, 0), a = p.weeks.reduce((s, w) => s + w.allocated, 0);
      const open = state.open.has(p.id);
      const taskIds = [...new Set(p.weeks.flatMap(w => w.tasks.map(t => t.taskId)))];
      return `<tr class="person"><th scope="row"><button type="button" class="link-btn rp-tog" data-p="${p.id}" aria-expanded="${open}">${open ? "▾" : "▸"} ${esc(p.name)}</button>
          <small>${esc(p.department || "No department")} · ${c ? Math.round((100 * a) / c) : 0}% over ${data.weeks.length} weeks</small></th>
        ${p.weeks.map(w => `<td class="rp ${band(w.allocated, w.capacity)} ${w.leave ? "leave" : ""}" title="${esc(`${r1(w.allocated)} h allocated of ${r1(w.capacity)} h available${w.leave ? `; ${r1(w.leave)} h leave` : ""}${w.overdue ? "; includes overdue work" : ""}`)}">
          <span>${cellText(w, w.capacity)}</span>${w.overdue ? `<i class="od" title="Includes overdue work"></i>` : ""}</td>`).join("")}</tr>
        ${open ? taskIds.map(id => { const t = data.tasks[id] || { title: `Task ${id}` }; const pr = data.projects[t.projectId] || {};
          return `<tr class="sub"><th scope="row"><a href="#/projects/${t.projectId}">${esc(t.title)}</a><small>${esc([pr.company, pr.name].filter(Boolean).join(" · "))}</small></th>
            ${p.weeks.map(w => { const x = w.tasks.find(k => k.taskId === id); return `<td class="rp-sub">${x ? r1(x.hours) : ""}</td>`; }).join("")}</tr>`; }).join("") : ""}`;
    }).join("");
    const unRow = unassigned ? `<tr class="unassigned"><th scope="row"><b>Unassigned</b><small>Open tasks with nobody assigned in Autotask</small></th>
      ${data.unassigned.map(w => `<td class="rp ${w.allocated ? "un" : "none"}"><span>${w.allocated ? r1(w.allocated) : ""}</span></td>`).join("")}</tr>` : "";
    return `<div class="sc-wrap rp-wrap"><table class="rp-tbl"><thead><tr><th class="who">Person</th>${head}</tr></thead><tbody>${teamRow}${personRows}${unRow}</tbody></table></div>`;
  };

  const html = `<div class="ph"><span class="hd-eyebrow">Managed Services</span><h1>Resource planner</h1>
      <p>Project hours each person is allocated against what they have available, week by week. Allocation is each open task's remaining hours spread over its remaining working days.</p></div>
    ${projectTabs(me, "resources")}
    <div class="tiles">
      <div class="tile"><span>Next 4 weeks</span><b>${cap4 ? Math.round((100 * alloc4) / cap4) : 0}%</b><small>${n0(alloc4)} of ${n0(cap4)} project hours allocated</small></div>
      <div class="tile ${over.length ? "bad" : ""}"><span>Over-allocated</span><b>${over.length}</b><small>${over.length ? esc(over.map(p => p.name).join(", ")) : "nobody in the next 4 weeks"}</small></div>
      <div class="tile"><span>Under 60%</span><b>${under.length}</b><small>${under.length ? esc(under.map(p => p.name).join(", ")) : "everyone's well used"}</small></div>
      <div class="tile ${unassigned ? "warn" : ""}"><span>Unassigned work</span><b>${n0(unassigned)} h</b><small>open tasks with nobody on them</small></div>
    </div>
    <div class="pj-bar">
      <div class="seg" role="group" aria-label="Show">${[["hours", "Hours"], ["pct", "Percent"]].map(([k, l]) => `<button type="button" data-mode="${k}" class="${k === "hours" ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Weeks">${[8, 12, 26].map(n => `<a class="seg-a ${n === weeksN ? "on" : ""}" href="#/projects/resources?weeks=${n}">${n} weeks</a>`).join("")}</div>
      <span class="grow"></span>
      ${data.can.settings ? `<button type="button" class="btn outline sm" id="rp-settings">${icon("streamline", "i-sm")}Capacity settings</button>` : ""}
    </div>
    <div id="rp-table">${data.people.length || unassigned ? table() : empty("No open project work yet. Once projects are read from Autotask, everyone with tasks appears here.")}</div>
    <div class="pj-foot"><div class="legend small">
      <span><i class="sw rp-idle"></i>Under 60%</span><span><i class="sw rp-good"></i>60–85%</span><span><i class="sw rp-full"></i>85–100%</span><span><i class="sw rp-over"></i>Over-allocated</span>
      <span><i class="sw rp-leave"></i>Leave that week</span><span><i class="sw rp-od"></i>Includes overdue work</span></div>
      <span class="grow"></span><span class="dim small">Capacity: 7.6 h a day, less public holidays and leave in Autotask, less ${Math.round(data.share * 100)}% for service desk and other work.${data.beyond ? ` ${n0(data.beyond)} h is scheduled beyond these weeks.` : ""}</span></div>`;

  return {
    title: "Resource planner", html,
    mount: (root, refresh) => {
      const wire = () => root.querySelectorAll(".rp-tog").forEach(b => b.onclick = () => { const id = Number(b.dataset.p); state.open.has(id) ? state.open.delete(id) : state.open.add(id); root.querySelector("#rp-table").innerHTML = table(); wire(); });
      wire();
      root.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
        state.mode = b.dataset.mode; root.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("on", x === b));
        root.querySelector("#rp-table").innerHTML = table(); wire();
      });
      const s = root.querySelector("#rp-settings");
      if (s) s.onclick = () => dialog({
        title: "Capacity settings",
        intro: "How much of each person's week Pulse counts as available for projects, and who appears in the planner.",
        extra: `<fieldset class="fld"><span>Also show everyone in these departments <em class="dim">optional</em></span>
          <div class="dept-checks">${data.allDepartments.map(d => `<label class="check small"><input type="checkbox" name="dept" value="${esc(d)}" ${data.departments.includes(d) ? "checked" : ""}> ${esc(d)}</label>`).join("")}</div>
          <small class="dim">People with project tasks always appear.</small></fieldset>`,
        fields: [{ name: "share", label: "Kept for service desk and other work (%)", type: "number", value: Math.round(data.share * 100), required: true, hint: "e.g. 20 means 6.1 of each 7.6-hour day counts for projects." }],
        submit: "Save",
        onSubmit: async f => {
          const departments = [...document.querySelectorAll("dialog input[name=dept]:checked")].map(x => x.value);
          await api("/projects/settings", { method: "PUT", body: { nonProjectShare: Number(String(f.share).replace("%", "")) / 100, departments } });
          toast("Settings saved"); refresh();
        },
      });
    },
  };
}

/* =============================== LEAD TIME =============================== */
/** Same maths as the server (projects/logic.js leadTime), so what-if answers are instant. */
function leadTime(backlog, weekly, extra = []) {
  let left = backlog, i = 0;
  const burn = [];
  const cap = j => { const w = weekly[Math.min(j, weekly.length - 1)]; return w.capacity + extra.reduce((s, e) => s + (j >= weekly.length || !e.from || w.week >= e.from ? (e.count || 0) * (e.hoursPerWeek || 0) : 0), 0); };
  while (left > 0.01 && i < 260) { const c = cap(i); if (c <= 0 && i >= weekly.length) break; left = Math.max(0, left - c); burn.push(Math.round(left)); i++; }
  const partial = i ? (burn.length > 1 ? burn[burn.length - 2] : backlog) / (cap(Math.max(0, i - 1)) || 1) : 0;
  const weeks = left > 0.01 ? null : Math.max(0, r1((i - 1) + Math.min(1, partial)));
  return { weeks, clearsWeek: weeks === null ? null : addDays(weekly[0].week, 7 * Math.ceil(weeks || 0)), burn };
}

function burnChart(backlog, base, scen) {
  const W = 640, Hh = 200, pad = 36;
  const n = Math.max(base.burn.length, scen ? scen.burn.length : 0, 4);
  const x = i => pad + (i * (W - pad - 10)) / n, y = v => 10 + (Hh - 40) * (1 - v / Math.max(1, backlog));
  const line = (b, cls) => `<polyline class="${cls}" points="${[backlog, ...b.burn].map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>`;
  const ticks = Array.from({ length: n + 1 }, (_, i) => i).filter(i => i % Math.ceil(n / 8) === 0);
  return `<svg viewBox="0 0 ${W} ${Hh}" class="burn" role="img" aria-label="Project hours left week by week">
    <line x1="${pad}" y1="${y(0)}" x2="${W - 10}" y2="${y(0)}" class="axis"/>
    ${ticks.map(i => `<text x="${x(i)}" y="${Hh - 8}" text-anchor="middle">${i ? `wk ${i}` : "now"}</text>`).join("")}
    <text x="${pad - 6}" y="${y(backlog) + 4}" text-anchor="end">${n0(backlog)}</text><text x="${pad - 6}" y="${y(0) + 4}" text-anchor="end">0</text>
    ${line(base, "base")}${scen ? line(scen, "scen") : ""}</svg>`;
}

export async function leadTimePage(me) {
  if (!me.access.viewLeadTime) return denied("Project lead time");
  const d = await api("/projects/lead-time");
  const state = { size: 80, people: 1, extra: [] };
  const wkLabel = w => (w === null ? "more than 5 years" : w < 1 ? "less than a week" : `${w} week${w === 1 ? "" : "s"}`);

  const answer = () => {
    const base = d.base, scen = state.extra.length ? leadTime(d.backlog.hours, d.weekly, state.extra) : null;
    const use = scen || base;
    const start = use.clearsWeek;
    const perWeek = Math.max(1, state.people) * H * 5 * (1 - d.share);
    const durWeeks = state.size / perWeek;
    const finish = start ? addDays(start, Math.ceil(durWeeks * 7)) : null;
    return `<div class="lt-answer">
        <span class="hd-eyebrow">${scen ? "With the extra people" : "With today's team and workload"}</span>
        <h2>A new project could start from the week of <b>${esc(fmtD(start))}</b></h2>
        <p>That's about ${esc(wkLabel(use.weeks))} from now${scen && base.weeks !== null && scen.weeks !== null ? (base.weeks - scen.weeks >= 0.1 ? `, <b>${r1(base.weeks - scen.weeks)} weeks sooner</b> than with today's team` : ", the same as with today's team: the extra people start after the queue clears") : ""}.
          A ${n0(state.size)}-hour project with ${state.people} ${state.people === 1 ? "engineer" : "engineers"} on it would take about ${r1(durWeeks)} weeks, finishing around <b>${esc(fmtD(finish))}</b>.</p>
      </div>
      <div class="panel lt-chart"><div class="sec-h"><div><span class="hd-eyebrow">Burn-down</span><h2 class="small-h">Project hours left, week by week</h2></div>
        <div class="legend small"><span><i class="sw base"></i>Today's team</span>${scen ? `<span><i class="sw scen"></i>With extra people</span>` : ""}</div></div>
        ${burnChart(d.backlog.hours, base, scen)}</div>`;
  };
  const extraRows = () => state.extra.map((e, i) => `<div class="lt-row" data-i="${i}">
      <label class="fld"><span>People</span><input type="number" min="1" max="20" value="${e.count}" data-k="count"></label>
      <label class="fld"><span>Project hours a week each</span><input type="number" min="1" max="45" step="0.5" value="${e.hoursPerWeek}" data-k="hoursPerWeek"></label>
      <label class="fld"><span>From</span><input type="date" value="${e.from}" data-k="from"></label>
      <button type="button" class="link-btn small" data-remove="${i}">Remove</button></div>`).join("");

  const html = `<div class="ph"><span class="hd-eyebrow">Managed Services · for Sales</span><h1>Project lead time</h1>
      <p>How soon the project team could start something new, from the work already booked in Autotask and the team's project capacity. Use it to set realistic start dates with clients.</p></div>
    ${projectTabs(me, "lead")}
    <div class="tiles">
      <div class="tile"><span>Work in the queue</span><b>${n0(d.backlog.manDays)} days</b><small>${n0(d.backlog.hours)} hours · ${d.backlog.manWeeks} person-weeks · ${d.backlog.projects} projects</small></div>
      <div class="tile"><span>Team capacity</span><b>${n0(d.team.weeklyCapacity)} h/wk</b><small>${d.team.people} people, after ${Math.round(d.share * 100)}% for other work</small></div>
      <div class="tile"><span>Lead time</span><b>${d.base.weeks === null ? "—" : `${d.base.weeks} wks`}</b><small>to clear the queue at that rate</small></div>
      <div class="tile ${d.backlog.overdue ? "warn" : ""}"><span>Autotask schedule</span><b class="sm">${esc(fmtD(d.scheduleEnds))}</b><small>last open task ends${d.backlog.overdue ? ` · ${n0(d.backlog.overdue)} h overdue` : ""}</small></div>
    </div>
    <div class="lt-grid">
      <section class="panel"><span class="hd-eyebrow">New project</span><h2 class="small-h">How big is it?</h2>
        <div class="lt-row"><label class="fld"><span>Size in hours</span><input type="number" id="lt-size" min="1" value="${state.size}"></label>
          <label class="fld"><span>Engineers on it</span><input type="number" id="lt-people" min="1" max="20" value="${state.people}"></label></div>
        <p class="small dim">${n0(state.size)} hours is ${r1(state.size / H)} person-days. Pulse assumes the new work starts once today's queue is clear.</p>
        <span class="hd-eyebrow" style="margin-top:18px;display:block">What if</span><h2 class="small-h">Add people to the project team</h2>
        <div id="lt-extra">${extraRows()}</div>
        <button type="button" class="btn outline sm" id="lt-add">${icon("establish", "i-sm")}Add people</button>
        <p class="small dim">Modelling only: nothing is saved or changed in Autotask.</p>
      </section>
      <div id="lt-answer">${d.backlog.hours || d.team.people ? answer() : empty("No project work or project team yet. Once projects are read from Autotask, this fills in.")}</div>
    </div>
    <p class="small dim">Queue = remaining hours on every open task (estimate less time worked where Autotask has no remaining hours), including unassigned (${n0(d.backlog.unassigned)} h) and overdue work. Capacity = the project team's working days × 7.6 h less public holidays and leave, less ${Math.round(d.share * 100)}% for other work. Team: ${esc(d.team.names.join(", ") || "nobody yet")}.</p>`;

  return {
    title: "Project lead time", html,
    mount: root => {
      const redraw = () => { const a = root.querySelector("#lt-answer"); if (d.backlog.hours || d.team.people) a.innerHTML = answer(); };
      const wire = () => {
        root.querySelectorAll("#lt-extra input").forEach(inp => inp.oninput = () => {
          const i = Number(inp.closest(".lt-row").dataset.i), k = inp.dataset.k;
          state.extra[i][k] = k === "from" ? inp.value : Number(inp.value) || 0; redraw();
        });
        root.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => { state.extra.splice(Number(b.dataset.remove), 1); root.querySelector("#lt-extra").innerHTML = extraRows(); wire(); redraw(); });
      };
      root.querySelector("#lt-add").onclick = () => { state.extra.push({ count: 1, hoursPerWeek: r1(H * 5 * (1 - d.share)), from: addDays(d.weekly[0].week, 14) }); root.querySelector("#lt-extra").innerHTML = extraRows(); wire(); redraw(); };
      root.querySelector("#lt-size").oninput = e => { state.size = Math.max(1, Number(e.target.value) || 1); redraw(); };
      root.querySelector("#lt-people").oninput = e => { state.people = Math.max(1, Number(e.target.value) || 1); redraw(); };
      wire();
    },
  };
}
