// Annual plan (D19), the Accountability Chart, division pages and seat (role) pages.
import { api } from "../api.js";
import { esc, icon, toast, fmtShort } from "../ui.js";
import { planCard, dialog, empty, tabs, money, fmtValue, fmtMonthShort, fmtMonth } from "../components.js";
import { APPS, canOpen, appRole } from "../apps.js";
import { scorecardBlock, mountScorecard } from "./scorecard.js";
import { rocksBlock, issuesBlock, todosBlock, divisionName } from "./eos.js";

export const canSeePlan = me => me.access.leadership || me.access.financeDetail || me.access.ownDivisions.includes("Finance");

/* =============================== ANNUAL PLAN =============================== */
export async function planBlock() {
  const data = await api("/plan");
  return {
    data,
    html: data.metrics.length ? `<div class="plan-grid">${data.metrics.map(m => planCard(m, data.current)).join("")}</div>
      <p class="dim small">Bars fill with month-end figures; the tick shows how much of the year (or quarter) has gone. ${data.canEnter ? `<a href="#/plan">Update targets and month-end figures</a>.` : ""}</p>`
      : empty("No plan for this financial year yet."),
  };
}

export async function planPage(me) {
  if (!canSeePlan(me)) return { title: "FY plan", html: `<div class="ph"><h1>FY plan</h1></div><div class="note info">${icon("compliance")}<span>The annual plan is for Leadership and Finance.</span></div>` };
  const { data, html } = await planBlock();
  const fmt = (m, v) => (v === null || v === undefined ? "" : m.unit === "currency" ? money(v, { exact: true }) : fmtValue(v, "count"));
  const tables = data.metrics.map(m => `<section class="panel" data-metric="${m.id}">
    <div class="sec-h"><div><span class="hd-eyebrow">${esc(m.label)}</span><h2>${esc(m.name)}</h2></div>
      <span class="aside">${m.kind === "cumulative" ? "Adds up month by month" : "Month-end level"}</span></div>
    ${m.collector ? `<p class="small auto-line">${m.automatic
      ? `${icon("check", "i-sm")} Month-end figures fill in automatically from Autotask${m.autoChanged ? ` (switched on by ${esc(m.autoChanged.by)})` : ""}. A figure Finance enters still takes priority.`
      : `<span class="chip quiet">Automatic on trial</span> Pulse works this out from Autotask every hour and shows it under each month. Finance's figures count until it's switched on.`}
      ${data.canEnter ? `<button class="link-btn small" type="button" data-auto="${m.id}">${m.automatic ? "Switch back to entered" : "Switch to automatic"}</button>` : ""}</p>` : ""}
    <div class="tbl-wrap"><table class="plan-tbl"><thead><tr><th></th><th>Target</th>${m.kind === "level" ? "<th>Opening (30 June)</th>" : ""}</tr></thead>
      <tbody><tr><th scope="row">${esc(m.label)}</th><td>${fmt(m, m.target)} ${data.canEditTargets ? `<button class="link-btn small" data-edit-year="${m.id}">Edit</button>` : ""}</td>
        ${m.kind === "level" ? `<td>${fmt(m, m.opening) || "—"} ${data.canEditTargets ? `<button class="link-btn small" data-edit-open="${m.id}">Edit</button>` : ""}</td>` : ""}</tr></tbody></table></div>
    <div class="tbl-wrap" style="margin-top:12px"><table class="plan-tbl"><thead><tr><th>Quarter</th><th>Target</th><th>Actual</th><th></th></tr></thead><tbody>
      ${m.quarters.map(q => `<tr><th scope="row">Q${q.quarter} <span class="dim small">${esc(fmtMonthShort(q.start))}–${esc(fmtMonthShort(q.end))}</span></th>
        <td>${fmt(m, q.target) || `<span class="dim">Not set</span>`}</td><td>${fmt(m, q.actual) || "—"}</td>
        <td>${data.canEnter ? `<button class="link-btn small" data-edit-q="${m.id}:${q.quarter}">Set target</button>` : ""}</td></tr>`).join("")}
      ${m.kind === "cumulative" ? `<tr><th scope="row">Quarters total</th><td>${fmt(m, m.quarterTargetsTotal) || "—"}${m.quarterTargetsMismatch ? ` <span class="chip alert">Differs from the year</span>` : ""}</td><td></td><td></td></tr>` : ""}
    </tbody></table></div>
    <div class="months">${m.months.map(x => `<button type="button" class="month ${x.value === null ? "empty" : ""}" data-month="${m.id}:${x.month.slice(0, 7)}" ${data.canEnter ? "" : "disabled"}>
      <span>${esc(fmtMonthShort(x.month))}</span><b>${x.value === null ? "—" : esc(m.unit === "currency" ? money(x.value) : fmtValue(x.value, "count"))}</b>
      ${m.trial && x.auto !== null ? `<i class="trial-v show" title="Automatic value on trial">${esc(m.unit === "currency" ? money(x.auto) : fmtValue(x.auto, "count"))}</i>` : ""}</button>`).join("")}</div>
  </section>`).join("");
  return {
    title: "FY plan",
    html: `<div class="ph"><span class="hd-eyebrow">Company · ${esc(data.label)}</span><h1>FY plan</h1>
      <p>The V/TO 1-year plan, tracked month by month. Leadership sets the year and quarter targets; Finance enters month-end figures; MRR, Seats and New seats come from Autotask (on trial first) and Revenue from Xero later.</p></div>
      ${html}${tables}`,
    mount: (root, refresh) => {
      const metric = id => data.metrics.find(m => m.id === Number(id));
      const put = (path, body) => api(path, { method: "PUT", body });
      root.querySelectorAll("[data-edit-year]").forEach(b => { const m = metric(b.dataset.editYear); b.onclick = () => dialog({ title: `${m.name}: ${m.label} target`, fields: [{ name: "v", label: "Target", type: "number", value: m.target, required: true }],
        onSubmit: async f => { await put(`/plan/metrics/${m.id}`, { annualTarget: f.v }); toast("Target saved"); refresh(); } }); });
      root.querySelectorAll("[data-edit-open]").forEach(b => { const m = metric(b.dataset.editOpen); b.onclick = () => dialog({ title: `${m.name}: opening level`, intro: "Where the year started (30 June). Progress is measured from here to the target.", fields: [{ name: "v", label: "Opening level", type: "number", value: m.opening }],
        onSubmit: async f => { await put(`/plan/metrics/${m.id}`, { openingValue: f.v }); toast("Saved"); refresh(); } }); });
      root.querySelectorAll("[data-edit-q]").forEach(b => { const [id, q] = b.dataset.editQ.split(":"); const m = metric(id); const cur = m.quarters[q - 1];
        b.onclick = () => dialog({ title: `${m.name}: ${cur.label} target`, intro: m.kind === "cumulative" ? "The amount for this quarter alone." : "The level to reach by the end of this quarter.",
          fields: [{ name: "v", label: "Quarter target", type: "number", value: cur.target }],
          onSubmit: async f => { await put(`/plan/metrics/${m.id}/quarters/${q}`, { target: f.v }); toast("Quarter target saved"); refresh(); } }); });
      root.querySelectorAll("[data-auto]").forEach(b => { const m = metric(b.dataset.auto); b.onclick = () => dialog({
        title: m.automatic ? `${m.name}: switch back to entered figures` : `${m.name}: switch to automatic`,
        intro: m.automatic ? "Finance enters month-end figures again. Automatic values already worked out stay beside them." : "Months without a figure from Finance will use the automatic value. Figures Finance has entered still take priority.",
        fields: [{ name: "reason", label: "Reason", type: "textarea", rows: 2, required: true, hint: "Kept in the audit log." }],
        submit: m.automatic ? "Switch back" : "Switch to automatic",
        onSubmit: async f => { await api(`/plan/metrics/${m.id}/automatic`, { method: "POST", body: { enabled: !m.automatic, reason: f.reason } }); toast("Saved"); refresh(); } }); });
      root.querySelectorAll("[data-month]").forEach(b => { const [id, ym] = b.dataset.month.split(":"); const m = metric(id); const cur = m.months.find(x => x.month.startsWith(ym));
        const autoInfo = cur.auto !== null ? `<dl class="def"><dt>Automatic${m.trial ? " (trial)" : ""}</dt><dd>${esc(m.unit === "currency" ? money(cur.auto, { exact: true }) : fmtValue(cur.auto, "count"))}${cur.autoText ? `<div class="dim small">${esc(cur.autoText)}</div>` : ""}</dd></dl>` : "";
        b.onclick = () => dialog({ title: `${m.name}: ${fmtMonth(ym + "-01")}`, intro: m.kind === "cumulative" ? "The month's total." : "The level at the end of the month.", extra: autoInfo,
          fields: [{ name: "value", label: "Month-end figure", type: "number", value: cur.value, required: true },
            ...(cur.value !== null ? [{ name: "reason", label: "Reason for the change", type: "textarea", rows: 2, required: true, hint: "Kept in the audit log." }] : [])],
          onSubmit: async f => { await put(`/plan/metrics/${m.id}/months/${ym}`, f); toast("Saved"); refresh(); } }); });
    },
  };
}

/* =============================== ACCOUNTABILITY CHART =============================== */
export async function chartPage(me, structure) {
  const divs = structure.divisions;
  const seatCard = s => `<article class="seat ${s.isMine ? "mine" : ""}">
    <div class="seat-h"><a href="#/seat/${s.id}"><b>${esc(s.title)}</b></a>${structure.canEdit ? `<button class="link-btn small" data-seat="${s.id}">Edit</button>` : ""}</div>
    ${s.parentId ? `<div class="dim small">Reports to ${esc((divs.flatMap(x => x.seats).find(x => x.id === s.parentId) || {}).title || "")}</div>` : ""}
    <div class="holders">${s.holders.length ? s.holders.map(holderLine).join("") : `<span class="dim small">Seat empty</span>`}</div>
    ${s.roles.length ? `<ul class="roles">${s.roles.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${s.keyResult ? `<div class="kr"><span class="hd-eyebrow">Key result</span>${esc(s.keyResult)}</div>` : ""}
  </article>`;
  return {
    title: "Accountability Chart",
    html: `<div class="ph"><span class="hd-eyebrow">Company</span><h1>Accountability Chart</h1>
      <p>Every seat, its roles and who sits in it. Seats decide whose page shows which numbers. ${structure.canEdit ? "Leadership can add and edit seats." : ""}</p></div>
      ${divs.every(d => !d.seats.length) ? `<div class="note info">${icon("co-managed")}<span>Seats haven't been entered yet. They'll be loaded from the August 2026 Accountability Chart.</span></div>` : ""}
      ${divs.map(d => `<section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Division</span><h2>${esc(d.name)}</h2></div>
        ${d.functions.length ? `<span class="aside">${d.functions.map(f => esc(f.name)).join(" · ")}</span>` : ""}</div>
        ${d.seats.length ? `<div class="seat-grid">${d.seats.map(seatCard).join("")}</div>` : `<p class="dim">No seats yet.</p>`}
        ${structure.canEdit ? `<button class="btn outline sm" data-add-seat="${d.code}">${icon("co-managed", "i-sm")}Add a seat</button>` : ""}
      </section>`).join("")}`,
    mount: (root, refresh) => {
      const seats = divs.flatMap(d => d.seats);
      const form = (s, division) => {
        const d = divs.find(x => x.code === (s ? s.division : division));
        dialog({
          title: s ? `Edit seat: ${s.title}` : `Add a seat to ${d.name}`,
          fields: [
            { name: "title", label: "Seat", value: s ? s.title : "", required: true },
            { name: "functionId", label: "Function", type: "select", value: s ? s.functionId || "" : "", options: [{ v: "", t: "None" }, ...d.functions.map(f => ({ v: f.id, t: f.name }))] },
            { name: "parentSeatId", label: "Reports to", type: "select", value: s ? s.parentId || "" : "", options: [{ v: "", t: "None" }, ...seats.filter(x => !s || x.id !== s.id).map(x => ({ v: x.id, t: x.title }))] },
            { name: "roles", label: "Roles (one per line, about five)", type: "textarea", rows: 5, value: s ? s.roles.join("\n") : "" },
            { name: "keyResult", label: "Key result", value: s ? s.keyResult || "" : "" },
            { name: "holders", label: "Who sits in it", type: "textarea", rows: 5, hint: "One person per line: Name | job title | team | email. Only the name is required.",
              value: s ? s.holders.map(h => [h.name, h.title || "", h.team || "", h.email || ""].join(" | ").replace(/( \| )+$/, "")).join("\n") : "" },
            { name: "app_pipeline", label: "Pipeline", type: "checkbox", value: s && (s.apps || []).includes("pipeline") },
            { name: "app_mroi", label: "Marketing ROI", type: "checkbox", value: s && (s.apps || []).includes("mroi") },
            { name: "app_wspace", label: "Whitespace Matrix", type: "checkbox", value: s && (s.apps || []).includes("wspace") },
          ],
          onSubmit: async f => {
            const apps = ["pipeline", "mroi", "wspace"].filter(k => f["app_" + k]);
            const body = { title: f.title, functionId: f.functionId || null, parentSeatId: f.parentSeatId || null, roles: f.roles.split("\n").map(x => x.trim()).filter(Boolean), keyResult: f.keyResult, apps };
            const id = s ? s.id : (await api("/seats", { method: "POST", body: { ...body, division } })).id;
            if (s) await api(`/seats/${id}`, { method: "PATCH", body });
            const holders = f.holders.split("\n").map(l => l.trim()).filter(Boolean).map(l => { const [name, title, team, email] = l.split("|").map(x => (x || "").trim()); return { name, title: title || null, team: team || null, email: email || null }; });
            await api(`/seats/${id}/holders`, { method: "PUT", body: { holders } });
            toast("Seat saved"); refresh();
          },
        });
      };
      root.querySelectorAll("[data-seat]").forEach(b => { b.onclick = () => form(seats.find(s => s.id === Number(b.dataset.seat))); });
      root.querySelectorAll("[data-add-seat]").forEach(b => { b.onclick = () => form(null, b.dataset.addSeat); });
    },
  };
}

/** One entry per person (someone can hold a seat for two teams, e.g. Field Services and NOC team lead). */
const uniqueHolders = s => s.holders.filter((h, i, a) => a.findIndex(x => x.name === h.name) === i);
const goalText = m => (m.goal !== null && m.goal !== undefined ? `Goal ${m.goalText || ""}` : m.goalText ? `Goal: ${m.goalText.charAt(0).toLowerCase()}${m.goalText.slice(1)}` : "No goal yet");

/* =============================== DIVISION PAGES =============================== */
/** Apps that belong to each division (D9). Shown on the division page for people who can open them. */
export const DIVISION_APPS = { SalesMarketing: ["pipeline", "mroi", "wspace"] };

/** A measurable's value for a week; while it's on trial and nobody has typed one in, the automatic figure, marked. */
function kpiValue(m, c) {
  if (c && c.value != null) return `<b>${esc(fmtValue(c.value, m.unit))}</b>`;
  if (c && m.trial && c.auto != null) return `<b class="trial-kpi">${esc(fmtValue(c.auto, m.unit))}</b><a class="chip quiet" href="#/scorecard" title="Automatic on trial: check it on the Scorecard and switch it on">On trial</a>`;
  return `<b>${esc(fmtValue(null, m.unit))}</b>`;
}

export async function divisionPage(me, structure, code, tab = "overview") {
  const d = structure.divisions.find(x => x.code === code);
  if (!d) return null;
  if (!d.canSee) return { title: d.name, html: `<div class="denied"><span class="ic">${icon("compliance", "i-lg")}</span><h2>${esc(d.name)} isn't one of your divisions</h2>
    <p>Each division's page is open to its own people and to Leadership. Ask a Platform Admin if you should be in <b>Pulse - Division ${esc(d.name)}</b>.</p><a href="#/">Back to Home</a></div>` };
  const base = `#/division/${code}`;
  const nav = tabs([["overview", "Overview"], ["scorecard", "Scorecard"], ["rocks", "Rocks"], ["issues", "Issues"], ["todos", "To-dos"]]
    .map(([k, l]) => ({ href: k === "overview" ? base : `${base}/${k}`, label: l, on: tab === k })));
  const head = `<div class="ph"><span class="hd-eyebrow">Division</span><h1>${esc(d.name)}</h1>
    ${d.summary ? `<p><b>Key result:</b> ${esc(d.summary)}</p>` : ""}</div>${nav}`;

  if (tab === "scorecard") { const b = await scorecardBlock({ division: code }); return { title: d.name, html: head + b.html, mount: (r, f) => mountScorecard(r, b.data, f) }; }
  if (tab === "rocks") { const b = await rocksBlock(me, { level: "division", division: code, title: false }); return { title: d.name, html: head + b.html, mount: b.mount }; }
  if (tab === "issues") { const b = await issuesBlock(me, { level: "division", division: code }); return { title: d.name, html: head + b.html, mount: b.mount }; }
  if (tab === "todos") { const b = await todosBlock(me, { view: "division", division: code }); return { title: d.name, html: head + b.html, mount: b.mount }; }

  // Overview: the division's seats, its apps, and its numbers on the company Scorecard.
  const appKeys = [...new Set([...(DIVISION_APPS[code] || []), ...d.seats.flatMap(x => x.apps || [])])];
  const apps = appKeys.map(k => APPS.find(a => a.k === k)).filter(a => a && canOpen(a));
  const sc = await api("/scorecard");
  const mine = sc.measurables.filter(m => m.division === code);
  const latestLocked = sc.weeks.filter(w => w.locked).slice(-1)[0];
  return {
    title: d.name,
    html: head + `
      ${apps.length ? `<section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Apps</span><h2>Tools for ${esc(d.name)}</h2></div></div>
        <div class="cards">${apps.map(a => `<a class="card" href="#/app/${a.k}"><span class="ic">${icon(a.icon)}</span><h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p>
          <div class="foot"><span>${appRole(a)}</span><span class="go">Open ${icon("arrow-right", "i-sm")}</span></div></a>`).join("")}</div></section>` : ""}
      ${mine.length && latestLocked ? `<section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Company Scorecard</span><h2>This division's numbers</h2></div><span class="aside">Week of ${esc(fmtShort(latestLocked.start))}</span></div>
        <div class="kpis">${mine.map(m => { const c = m.cells.find(x => x.week === latestLocked.week); return `<div class="kpi ${c && c.onTarget === false ? "off" : ""}">
          <span class="k">${esc(m.name)}</span>${kpiValue(m, c)}<span class="dim small">${esc(goalText(m))}</span></div>`; }).join("")}</div></section>` : ""}
      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Accountability Chart</span><h2>Seats</h2></div></div>
        ${d.seats.length ? `<div class="seat-grid">${d.seats.map(s => `<a class="seat link ${s.isMine ? "mine" : ""}" href="#/seat/${s.id}"><b>${esc(s.title)}</b>
          <div class="holders">${uniqueHolders(s).length > 4 ? `<span class="holder">${uniqueHolders(s).length} people</span>${s.holders.some(h => h.isMe) ? `<span class="holder me">including you</span>` : ""}` : uniqueHolders(s).map(h => `<span class="holder ${h.isMe ? "me" : ""}">${esc(h.name)}</span>`).join("") || `<span class="dim small">Seat empty</span>`}</div>
          ${s.keyResult ? `<div class="kr small">${esc(s.keyResult)}</div>` : ""}</a>`).join("")}</div>` : `<p class="dim">Seats will appear here once the Accountability Chart is loaded.</p>`}
      </section>`,
  };
}

/* =============================== SEAT (ROLE) PAGES =============================== */
/** Proposed role scorecards (Evergreen Golden Scorecard, SLI): shown on seat pages until each
 *  seat's own measurables are agreed with its owner and switched on (release 2). */
export const ROLE_FOCUS = {
  "Visionary": ["Company Scorecard", "FY plan progress", "V/TO 3-year picture"],
  "Integrator": ["Company Scorecard", "FY plan progress", "Rocks on track", "EBITDA %"],
  "Head of Finance & Accounts": ["Cash on hand", "Debtor days (DSO)", "Services gross margin", "EBITDA %"],
  "Accounts Administration": ["Invoices overdue", "Unreconciled transactions", "Debtor days (DSO)"],
  "Head of Human Resources": ["ESAT", "Open roles and time to hire", "Onboarding completed on time"],
  "Head of Sales & Marketing": ["New MRR signed", "Weighted pipeline", "MQLs", "New seats signed"],
  "Marketing": ["MQLs", "Cost per MQL", "Return on each event"],
  "Business Development": ["New MRR signed", "Weighted pipeline", "MQL to SQL conversion"],
  "Sales Administration": ["Quotes turned around within a day", "Opportunities with a next step"],
  "Account Management": ["Net MRR retention", "Renewals in the next 90 days", "Whitespace dollars"],
  "Head of Innovation & Compliance": ["Open ISO corrective actions", "Automations delivered", "Hours saved"],
  "DevOps": ["Automations delivered", "Hours saved", "Internal system uptime"],
  "Compliance": ["Open ISO corrective actions", "Audit findings closed on time", "Training completion"],
  "Head of Managed Services": ["SLA first response met", "Tickets closed per tech per day", "Billable utilisation", "CSAT and NPS"],
  "Service Team Leadership": ["SLA first response met", "Queue size and age", "Tickets closed per tech per day", "First-contact resolution"],
  "Projects Team Leadership": ["Projects on budget", "Projects on schedule", "Project margin"],
  "Client Success": ["CSAT and NPS", "Client retention", "Clients reviewed this quarter"],
  "Service Admin": ["On-site visits scheduled on time", "On-call roster filled"],
  "NOC": ["Patch compliance", "Backup success", "Open alerts"],
  "Service Teams": ["Tickets closed per day", "Time to resolution", "First-contact resolution", "SLA met"],
  "Projects Teams": ["Tasks completed on time", "Hours against budget"],
};

const holderLine = h => `<span class="holder ${h.isMe ? "me" : ""}">${esc(h.name)}${h.title ? ` <span class="ht">${esc(h.title)}</span>` : ""}</span>`;

export async function seatPage(me, structure, id) {
  const all = structure.divisions.flatMap(d => d.seats);
  const s = all.find(x => x.id === Number(id));
  if (!s) return null;
  const d = structure.divisions.find(x => x.code === s.division);
  const parent = all.find(x => x.id === s.parentId);
  const children = all.filter(x => x.parentId === s.id);
  const [sc, rocks] = await Promise.all([api("/scorecard"), api("/rocks")]);
  const owned = sc.measurables.filter(m => m.seatId === s.id);
  const names = new Set(s.holders.map(h => h.name.toLowerCase()));
  const emails = new Set(s.holders.map(h => (h.email || "").toLowerCase()).filter(Boolean));
  const seatRocks = rocks.rocks.filter(r => emails.has((r.owner.email || "").toLowerCase()) || names.has((r.owner.name || "").toLowerCase()));
  const apps = (s.apps || []).map(k => APPS.find(a => a.k === k)).filter(Boolean);
  const teams = [...new Set(s.holders.map(h => h.team || ""))];
  const focus = ROLE_FOCUS[s.title] || [];
  const latest = sc.weeks.filter(w => w.locked).slice(-1)[0];
  return {
    title: s.title,
    html: `<div class="ph"><span class="hd-eyebrow"><a href="#/division/${d.code}">${esc(d.name)}</a> · Seat</span><h1>${esc(s.title)}</h1>
        ${s.keyResult ? `<p><b>Key result:</b> ${esc(s.keyResult)}</p>` : ""}
        <p class="small">${parent ? `Reports to <a href="#/seat/${parent.id}">${esc(parent.title)}</a>` : ""}${children.length ? `${parent ? " · " : ""}Leads ${children.map(c => `<a href="#/seat/${c.id}">${esc(c.title)}</a>`).join(", ")}` : ""}</p></div>
      ${s.isMine ? `<div class="note info">${icon("check")}<span>This is your seat.</span></div>` : ""}
      <div class="two-col">
        <section class="panel"><h2>Roles</h2>${s.roles.length ? `<ul class="roles">${s.roles.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p class="dim">No roles listed.</p>`}</section>
        <section class="panel"><h2>Who sits here</h2>${s.holders.length ? teams.map(t => `${teams.length > 1 || t ? `<h3 class="grp">${esc(t || "Seat")}</h3>` : ""}
          <div class="holders col">${s.holders.filter(h => (h.team || "") === t).map(holderLine).join("")}</div>`).join("") : `<p class="dim">This seat is empty.</p>`}</section>
      </div>
      ${owned.length ? `<section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Company Scorecard</span><h2>Measurables this seat owns</h2></div>${latest ? `<span class="aside">Week of ${esc(fmtShort(latest.start))}</span>` : ""}</div>
        <div class="kpis">${owned.map(m => { const c = latest && m.cells.find(x => x.week === latest.week); return `<div class="kpi ${c && c.onTarget === false ? "off" : ""}">
          <span class="k">${esc(m.name)}</span>${kpiValue(m, c)}<span class="dim small">${esc(goalText(m))}</span></div>`; }).join("")}</div></section>` : ""}
      ${focus.length ? `<section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Proposed</span><h2>Role scorecard</h2></div><span class="aside">To agree with the seat's owner · release 2</span></div>
        <p class="dim">The few numbers this seat would track week to week, from the Evergreen Golden Scorecard and SLI benchmarks. Once agreed, they fill in automatically here.</p>
        <div class="focus">${focus.map(f => `<span class="chip scheduled">${esc(f)}</span>`).join("")}</div></section>` : ""}
      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">${esc(rocks.label)}</span><h2>Rocks</h2></div></div>
        ${seatRocks.length ? `<div class="rock-list">${seatRocks.map(r => `<article class="rock"><div class="rock-main"><b>${esc(r.title)}</b><div class="dim small">${esc(r.owner.name)}</div></div><div class="rock-side">${rockChipLite(r.status)}</div></article>`).join("")}</div>` : `<p class="dim">No Rocks owned by this seat this quarter.</p>`}</section>
      ${apps.length ? `<section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Apps</span><h2>Tools for this seat</h2></div></div>
        <div class="cards">${apps.map(a => canOpen(a) ? `<a class="card" href="#/app/${a.k}"><span class="ic">${icon(a.icon)}</span><h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p><div class="foot"><span>${appRole(a)}</span><span class="go">Open ${icon("arrow-right", "i-sm")}</span></div></a>`
          : `<div class="card off"><span class="ic">${icon(a.icon)}</span><h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p><div class="foot"><span class="chip quiet">You don't have access</span></div></div>`).join("")}</div></section>` : ""}`,
  };
}

const rockChipLite = st => `<span class="chip ${st === "off_track" ? "alert" : st === "done" ? "ok" : st === "not_done" ? "quiet" : "progress"}">${esc({ on_track: "On track", off_track: "Off track", done: "Done", not_done: "Not done" }[st] || st)}</span>`;

export { divisionName };
