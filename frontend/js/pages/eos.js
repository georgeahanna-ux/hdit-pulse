// Rocks, Issues, To-dos and the V/TO. Each list renders as a block that division pages reuse.
import { api } from "../api.js";
import { esc, icon, fmtShort, toast } from "../ui.js";
import { rockChip, ROCK_STATUSES, dialog, empty, dueText, prioButtons } from "../components.js";
import { DIVISIONS } from "../access.js";

export const divisionName = c => (DIVISIONS.find(d => d.code === c) || { name: c || "" }).name;
const ownerOpts = me => [{ name: "ownerName", label: "Owner", value: me.person.name, required: true }, { name: "ownerEmail", label: "Owner's email", type: "email", value: me.person.email, hint: "Links it to the person's Pulse home." }];

/* =============================== ROCKS =============================== */
export async function rocksBlock(me, { level = null, division = null, title = true } = {}) {
  const qs = new URLSearchParams(Object.entries({ level, division }).filter(([, v]) => v));
  const data = await api("/rocks" + (qs.toString() ? "?" + qs : ""));
  const groups = level ? [[level, data.rocks]] : ["company", "division", "individual"].map(l => [l, data.rocks.filter(r => r.level === l)]);
  const canAdd = level === "company" ? me.access.leadership : division ? (me.access.leadership || me.access.ownDivisions.includes(division)) : true;
  const html = `
    ${title ? `<div class="sec-h"><div><span class="hd-eyebrow">${esc(data.label)}</span><h2>Rocks</h2></div><span class="aside">${data.rocks.filter(r => r.status === "on_track" || r.status === "done").length} of ${data.rocks.length} on track or done</span></div>` : ""}
    ${groups.map(([l, list]) => `
      ${!level ? `<h3 class="grp">${l === "company" ? "Company" : l === "division" ? "Division" : "Individual"}</h3>` : ""}
      ${list.length ? `<div class="rock-list">${list.map(rockRow).join("")}</div>` : empty(l === "company" ? "No company Rocks set for this quarter yet." : "None yet.")}`).join("")}
    ${canAdd ? `<button class="btn outline" type="button" data-add-rock>${icon("strategise", "i-sm")}Add a Rock</button>` : ""}`;
  return { html, data, mount: (root, refresh) => mountRocks(root, data, me, { level, division }, refresh) };
}

function rockRow(r) {
  return `<article class="rock">
    <div class="rock-main">
      <div class="rock-title"><b>${esc(r.title)}</b>${r.level === "division" ? ` <span class="chip quiet">${esc(divisionName(r.division))}</span>` : ""}</div>
      <div class="dim small">${esc(r.owner.name)}${r.dueDate ? ` · ${esc(dueText(r.dueDate))}` : ""}${r.milestones.length ? ` · ${r.milestonesDone} of ${r.milestones.length} milestones` : ""}</div>
      ${r.milestones.length ? `<ul class="ms">${r.milestones.map(m => `<li><label><input type="checkbox" data-ms="${r.id}:${m.id}" ${m.done ? "checked" : ""} ${r.canEdit ? "" : "disabled"}> ${esc(m.title)}</label></li>`).join("")}</ul>` : ""}
    </div>
    <div class="rock-side">
      ${r.canEdit ? `<select class="status-sel" data-rock-status="${r.id}" aria-label="Status of ${esc(r.title)}">${ROCK_STATUSES.map(s => `<option value="${s.v}" ${s.v === r.status ? "selected" : ""}>${s.t}</option>`).join("")}</select>` : rockChip(r.status)}
      ${r.canEdit ? `<button class="link-btn small" type="button" data-rock-ms="${r.id}">Add milestone</button>` : ""}
    </div>
  </article>`;
}

function mountRocks(root, data, me, { level, division }, refresh) {
  root.querySelectorAll("[data-rock-status]").forEach(s => { s.onchange = async () => { await api(`/rocks/${s.dataset.rockStatus}`, { method: "PATCH", body: { status: s.value } }); toast("Status updated"); refresh(); }; });
  root.querySelectorAll("[data-ms]").forEach(c => { c.onchange = async () => { const [r, m] = c.dataset.ms.split(":"); await api(`/rocks/${r}/milestones/${m}`, { method: "PATCH", body: { done: c.checked } }); refresh(); }; });
  root.querySelectorAll("[data-rock-ms]").forEach(b => { b.onclick = () => dialog({ title: "Add a milestone", fields: [{ name: "title", label: "Milestone", required: true }, { name: "dueDate", label: "Due", type: "date" }],
    onSubmit: async f => { await api(`/rocks/${b.dataset.rockMs}/milestones`, { method: "POST", body: f }); refresh(); } }); });
  const add = root.querySelector("[data-add-rock]");
  if (add) add.onclick = () => {
    const levels = [
      ...(me.access.leadership ? [{ v: "company", t: "Company Rock" }] : []),
      ...((me.access.leadership || me.access.ownDivisions.length) ? [{ v: "division", t: "Division Rock" }] : []),
      { v: "individual", t: "My own Rock" },
    ].filter(o => !level || o.v === level);
    const divs = (me.access.leadership ? DIVISIONS : DIVISIONS.filter(d => me.access.ownDivisions.includes(d.code))).map(d => ({ v: d.code, t: d.name }));
    dialog({
      title: `Add a Rock for ${data.label}`, intro: "A Rock is a priority for this quarter: specific, measurable and owned by one person.",
      fields: [
        { name: "level", label: "Type", type: "select", options: levels, value: level || levels[0].v, required: true },
        ...(divs.length ? [{ name: "division", label: "Division (for a division Rock)", type: "select", options: divs, value: division || divs[0].v }] : []),
        { name: "title", label: "Rock", required: true, placeholder: "e.g. Reach 2,300 seats serviced" },
        ...(me.access.leadership || division ? ownerOpts(me) : []),
        { name: "dueDate", label: "Due", type: "date", value: data.range.end },
      ],
      onSubmit: async f => { await api("/rocks", { method: "POST", body: f }); toast("Rock added"); refresh(); },
    });
  };
}

export async function rocksPage(me) {
  const b = await rocksBlock(me, { title: false });
  return { title: "Rocks", html: `<div class="ph"><span class="hd-eyebrow">Company · ${esc(b.data.label)}</span><h1>Rocks</h1>
    <p>This quarter's priorities. Company Rocks are set by Leadership; divisions and individuals add their own.</p></div>${b.html}`, mount: b.mount };
}

/* =============================== ISSUES =============================== */
export async function issuesBlock(me, { level = "company", division = null } = {}) {
  const qs = new URLSearchParams({ level, ...(division ? { division } : {}) });
  const data = await api("/issues?" + qs);
  const html = `
    ${data.issues.length ? `<div class="issue-list">${data.issues.map(i => `<article class="issue">
      <div class="prio">${prioButtons(i, data.issues)}</div>
      <div class="issue-main"><b>${esc(i.title)}</b><div class="dim small">${i.owner ? `Owner ${esc(i.owner.name)} · ` : ""}raised by ${esc(i.raisedBy || "")}</div></div>
      <div class="issue-act"><button class="btn outline sm" type="button" data-solve="${i.id}">Solve</button><button class="link-btn small" type="button" data-drop="${i.id}">Drop</button></div>
    </article>`).join("")}</div>` : empty("No open Issues. Add one when something needs to be identified, discussed and solved.")}
    <button class="btn outline" type="button" data-add-issue>${icon("discover", "i-sm")}Add an Issue</button>`;
  return {
    html, data,
    mount: (root, refresh) => {
      root.querySelectorAll("[data-prio]").forEach(b => { b.onclick = async () => { const [id, n] = b.dataset.prio.split(":"); const i = data.issues.find(x => x.id === Number(id)); try { await api(`/issues/${id}`, { method: "PATCH", body: { priority: i.priority === Number(n) ? null : Number(n) } }); } catch (e) { toast(e.message); } refresh(); }; });
      root.querySelectorAll("[data-solve]").forEach(b => { b.onclick = () => dialog({ title: "Solve this Issue", intro: esc(data.issues.find(i => i.id === Number(b.dataset.solve)).title),
        fields: [{ name: "solution", label: "Solution", type: "textarea", rows: 3, required: true, hint: "What was decided. Add To-dos for the actions." }],
        submit: "Mark solved", onSubmit: async f => { await api(`/issues/${b.dataset.solve}`, { method: "PATCH", body: { status: "solved", solution: f.solution } }); toast("Solved"); refresh(); } }); });
      root.querySelectorAll("[data-drop]").forEach(b => { b.onclick = () => dialog({ title: "Drop this Issue?", intro: "It moves off the list. It stays in the record.", submit: "Drop", danger: true,
        onSubmit: async () => { await api(`/issues/${b.dataset.drop}`, { method: "PATCH", body: { status: "dropped" } }); refresh(); } }); });
      root.querySelector("[data-add-issue]").onclick = () => dialog({
        title: "Add an Issue", fields: [{ name: "title", label: "Issue", required: true }, { name: "description", label: "Detail", type: "textarea", rows: 3 }, { name: "ownerName", label: "Owner" }, { name: "ownerEmail", label: "Owner's email", type: "email" }],
        onSubmit: async f => { await api("/issues", { method: "POST", body: { ...f, level, division } }); toast("Issue added"); refresh(); },
      });
    },
  };
}

export async function issuesPage(me) {
  if (!me.access.leadership) return { title: "Issues", html: `<div class="ph"><span class="hd-eyebrow">Company</span><h1>Issues</h1></div><div class="note info">${icon("compliance")}<span>The company Issues List belongs to the leadership team. Your division's Issues are on its page.</span></div>` };
  const b = await issuesBlock(me);
  return { title: "Issues", html: `<div class="ph"><span class="hd-eyebrow">Company</span><h1>Issues</h1><p>The leadership team's Issues List. Number your top three for this week's IDS.</p></div>${b.html}`, mount: b.mount };
}

/* =============================== TO-DOS =============================== */
export async function todosBlock(me, { view = "mine", division = null } = {}) {
  const qs = new URLSearchParams({ view, ...(division ? { division } : {}) });
  const data = await api("/todos?" + qs);
  const open = data.todos.filter(t => !t.done), done = data.todos.filter(t => t.done);
  const row = t => `<li class="todo ${t.done ? "done" : ""}"><label><input type="checkbox" data-todo="${t.id}" ${t.done ? "checked" : ""}> <span>${esc(t.title)}</span></label>
    <span class="dim small">${view !== "mine" ? esc(t.owner.name) + " · " : ""}${t.overdue ? `<span class="chip alert">Overdue</span> ` : ""}${esc(dueText(t.dueDate))}</span></li>`;
  const html = `${open.length ? `<ul class="todos">${open.map(row).join("")}</ul>` : empty(view === "mine" ? "Nothing on your list." : "No open To-dos.")}
    ${done.length ? `<details class="done-list"><summary>${done.length} done in the last two weeks</summary><ul class="todos">${done.map(row).join("")}</ul></details>` : ""}
    <button class="btn outline" type="button" data-add-todo>${icon("check", "i-sm")}Add a To-do</button>`;
  return {
    html, data,
    mount: (root, refresh) => {
      root.querySelectorAll("[data-todo]").forEach(c => { c.onchange = async () => { await api(`/todos/${c.dataset.todo}`, { method: "PATCH", body: { done: c.checked } }); refresh(); }; });
      root.querySelector("[data-add-todo]").onclick = () => dialog({
        title: "Add a To-do", intro: "A seven-day commitment: due in a week unless you choose otherwise.",
        fields: [{ name: "title", label: "To-do", required: true }, ...(view !== "mine" ? ownerOpts(me) : []), { name: "dueDate", label: "Due", type: "date" }],
        onSubmit: async f => { await api("/todos", { method: "POST", body: { ...f, level: view === "mine" ? "individual" : view, division } }); toast("To-do added"); refresh(); },
      });
    },
  };
}

export async function todosPage(me) {
  const mine = await todosBlock(me, { view: "mine" });
  const company = me.access.leadership ? await todosBlock(me, { view: "company" }) : null;
  return {
    title: "To-dos",
    html: `<div class="ph"><span class="hd-eyebrow">Company</span><h1>To-dos</h1><p>Seven-day commitments. From 0.8.0 they also appear in the "Pulse – L10" plan in Planner.</p></div>
      <section class="sec" data-block="mine"><div class="sec-h"><h2>Yours</h2></div>${mine.html}</section>
      ${company ? `<section class="sec" data-block="company"><div class="sec-h"><h2>Leadership team</h2></div>${company.html}</section>` : ""}`,
    mount: (root, refresh) => { mine.mount(root.querySelector('[data-block="mine"]'), refresh); if (company) company.mount(root.querySelector('[data-block="company"]'), refresh); },
  };
}

/* =============================== V/TO =============================== */
export async function vtoPage(me) {
  const { sections } = await api("/vto");
  return {
    title: "V/TO",
    html: `<div class="ph"><span class="hd-eyebrow">Company</span><h1>Vision/Traction Organizer</h1>
      <p>Where HD IT is going and how it gets there. ${me.access.leadership ? "Leadership can edit each section; every version is kept." : "Leadership keeps this up to date."}</p></div>
      <div class="vto">${sections.map(s => `<section class="vto-sec">
        <div class="vto-h"><h2>${esc(s.title)}</h2>${me.access.leadership ? `<button class="link-btn small" type="button" data-vto="${s.key}">Edit</button>` : ""}</div>
        ${s.content ? `<ul class="vto-lines">${s.content.split(/\n+/).filter(Boolean).map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : `<p class="dim">Not filled in yet.</p>`}
        ${s.updatedBy ? `<div class="dim small">Last changed by ${esc(s.updatedBy)}</div>` : ""}
      </section>`).join("")}</div>`,
    mount: (root, refresh) => root.querySelectorAll("[data-vto]").forEach(b => {
      const s = sections.find(x => x.key === b.dataset.vto);
      b.onclick = () => dialog({ title: `Edit: ${s.title}`, fields: [{ name: "content", label: "One item per line", type: "textarea", rows: 10, value: s.content }],
        onSubmit: async f => { await api(`/vto/${s.key}`, { method: "PUT", body: { content: f.content } }); toast("V/TO updated"); refresh(); } });
    }),
  };
}

