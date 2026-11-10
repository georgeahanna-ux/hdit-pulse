// Shared UI pieces for the EOS pages: value formatting, chips, progress bars, dialogs, forms.
import { esc, icon, fmtShort } from "./ui.js";

/* ---------------- numbers ---------------- */
const nf0 = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });

/** Short money: $9.2M, $560K, $1,240 */
export function money(v, { exact = false } = {}) {
  if (v === null || v === undefined) return "—";
  const n = Number(v), a = Math.abs(n), s = n < 0 ? "−" : "";
  if (exact || a < 10000) return `${s}$${nf0.format(a)}`;
  if (a < 1e6) return `${s}$${nf0.format(Math.round(a / 1000))}K`;
  return `${s}$${(a / 1e6).toFixed(a < 1e7 ? 2 : 1).replace(/\.?0+$/, "")}M`;
}

/** A measurable value in its unit. */
export function fmtValue(v, unit) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  switch (unit) {
    case "currency": return money(n);
    case "percent": return `${nf1.format(n)}%`;
    case "days": return `${nf1.format(n)} days`;
    case "score": return `${n > 0 ? "+" : ""}${nf0.format(n)}`;
    case "ratio": return nf1.format(n);
    default: return nf1.format(n);
  }
}

export const pct = x => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);

/* ---------------- chips ---------------- */
const ROCK = { on_track: ["progress", "On track"], off_track: ["alert", "Off track"], done: ["ok", "Done"], not_done: ["quiet", "Not done"] };
export const rockChip = s => { const [c, t] = ROCK[s] || ["quiet", s]; return `<span class="chip ${c}">${t}</span>`; };
export const ROCK_STATUSES = Object.entries(ROCK).map(([v, [, t]]) => ({ v, t }));

/* ---------------- progress bars (annual plan, D19) ---------------- */
/** One bar: fill = progress, a tick at time elapsed, and an on-pace chip. */
export function bar({ progress, elapsed, size = "lg", label = "" }) {
  const p = progress === null || progress === undefined ? null : Math.max(0, progress);
  const w = p === null ? 0 : Math.min(100, p * 100);
  const e = Math.max(0, Math.min(100, (elapsed || 0) * 100));
  return `<div class="bar ${size}" role="img" aria-label="${esc(label)} ${p === null ? "no figures yet" : pct(p) + " of target"}, ${pct(elapsed)} of the time gone">
    <div class="bar-fill ${p !== null && p >= 1 ? "met" : ""}" style="width:${w}%"></div>
    ${elapsed > 0 && elapsed < 1 ? `<div class="bar-tick" style="left:${e}%" title="Time gone: ${pct(elapsed)}"></div>` : ""}
  </div>`;
}

export function paceChip(progress, elapsed) {
  if (progress === null || progress === undefined) return `<span class="chip quiet">No figures yet</span>`;
  if (progress >= 1) return `<span class="chip ok">Target met</span>`;
  if (elapsed <= 0) return `<span class="chip scheduled">Not started</span>`;
  return progress >= elapsed ? `<span class="chip ok">On pace</span>` : `<span class="chip alert">Behind pace</span>`;
}

/** A plan metric card: the year bar with quarter sub-bars underneath. */
/** While a plan figure is on trial, the bars count only what Finance enters; show the automatic figure beside them. */
function trialLine(m, fmt) {
  const autos = (m.months || []).filter(x => x.auto !== null && x.auto !== undefined);
  if (!m.trial || !autos.length) return "";
  const value = m.kind === "cumulative" ? autos.reduce((s, x) => s + x.auto, 0) : autos[autos.length - 1].auto;
  const src = { xero: "Xero", simplesat: "SimpleSAT", mroi: "Marketing ROI" }[m.source] || "Autotask";
  return `<div class="trial-line small"><span class="chip quiet">On trial</span> ${src} says <b>${fmt(value)}</b>${m.kind === "level" ? ` at ${esc(fmtMonth(autos[autos.length - 1].month))}` : " so far"}.
    <a href="#/plan">Check it and switch it on</a> to fill this bar.</div>`;
}

export function planCard(m, current) {
  const fmt = v => (m.unit === "currency" ? money(v) : fmtValue(v, "count"));
  const kindNote = m.kind === "cumulative" ? "Year to date" : m.lastMonth ? `At end of ${fmtMonth(m.lastMonth)}` : "Latest month-end";
  return `<article class="plan-card">
    <div class="plan-head">
      <div><span class="hd-eyebrow">${esc(m.label)} ${esc(m.name)}</span>
        <div class="plan-num"><b>${fmt(m.actual)}</b> <span>of ${fmt(m.target)}</span></div>
        <div class="dim small">${esc(kindNote)}${m.kind === "level" && m.opening !== null ? ` · started the year at ${fmt(m.opening)}` : ""}</div></div>
      <div class="plan-pct"><b>${pct(m.progress)}</b>${paceChip(m.progress, m.elapsed)}</div>
    </div>
    ${trialLine(m, fmt)}
    ${bar({ progress: m.progress, elapsed: m.elapsed, label: `${m.name} ${m.label}` })}
    <div class="plan-quarters">
      ${m.quarters.map(q => `<div class="pq ${current && current.fy === m.fy && current.quarter === q.quarter ? "now" : ""}">
        <div class="pq-h"><b>Q${q.quarter}</b><span>${q.target === null ? "No target" : `${fmt(q.actual)} / ${fmt(q.target)}`}</span></div>
        ${bar({ progress: q.target === null ? null : q.progress, elapsed: q.elapsed, size: "sm", label: `${m.name} Q${q.quarter}` })}
      </div>`).join("")}
    </div>
    ${m.quarterTargetsMismatch ? `<div class="note alert small">${icon("vulnerability", "i-sm")}<span>Quarter targets add up to ${fmt(m.quarterTargetsTotal)}, not the year's ${fmt(m.target)}.</span></div>` : ""}
  </article>`;
}

export const fmtMonth = iso => new Date(iso.slice(0, 7) + "-15T00:00:00Z").toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
export const fmtMonthShort = iso => new Date(iso.slice(0, 7) + "-15T00:00:00Z").toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" });

/* ---------------- dialogs ---------------- */
/**
 * Opens a modal form. fields: [{ name, label, type: text|textarea|number|date|select|email, value, options:[{v,t}], required, hint }]
 * onSubmit(values) may throw an Error to show its message; resolve to close.
 */
export function dialog({ title, intro = "", fields = [], submit = "Save", danger = false, onSubmit, extra = "" }) {
  const d = document.createElement("dialog");
  d.className = "dlg";
  d.innerHTML = `<form method="dialog" novalidate>
    <h2>${esc(title)}</h2>${intro ? `<p class="dim">${intro}</p>` : ""}${extra}
    ${fields.map(f => field(f)).join("")}
    <div class="err" role="alert" hidden></div>
    <div class="dlg-actions"><button type="button" class="btn outline" value="cancel">${onSubmit ? "Cancel" : "Close"}</button>
      ${onSubmit ? `<button type="submit" class="btn ${danger ? "danger" : ""}">${esc(submit)}</button>` : ""}</div>
  </form>`;
  document.body.appendChild(d);
  const form = d.querySelector("form"), err = d.querySelector(".err");
  d.querySelector('[value="cancel"]').onclick = () => d.close();
  d.addEventListener("close", () => d.remove());
  form.onsubmit = async e => {
    e.preventDefault();
    if (!onSubmit) return d.close();
    const values = Object.fromEntries(new FormData(form));
    for (const f of fields) if (f.type === "checkbox") values[f.name] = form.elements[f.name].checked;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; err.hidden = true;
    try { await onSubmit(values); d.close(); }
    catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
  };
  d.showModal();
  const first = d.querySelector("input:not([type=hidden]), textarea, select");
  if (first) first.focus();
  return d;
}

function field(f) {
  const id = "f-" + f.name;
  const req = f.required ? "required" : "";
  const val = f.value === null || f.value === undefined ? "" : f.value;
  let input;
  if (f.type === "textarea") input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" ${req}>${esc(val)}</textarea>`;
  else if (f.type === "select") input = `<select id="${id}" name="${f.name}" ${req}>${f.options.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select>`;
  else if (f.type === "checkbox") return `<label class="check"><input type="checkbox" name="${f.name}" ${val ? "checked" : ""}> ${esc(f.label)}</label>`;
  else if (f.type === "hidden") return `<input type="hidden" name="${f.name}" value="${esc(val)}">`;
  else input = `<input id="${id}" name="${f.name}" type="${f.type === "number" ? "text" : f.type || "text"}" ${f.type === "number" ? 'inputmode="decimal"' : ""} value="${esc(val)}" ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}>`;
  return `<label class="fld" for="${id}"><span>${esc(f.label)}${f.required ? "" : ' <em class="dim">optional</em>'}</span>${input}${f.hint ? `<small class="dim">${f.hint}</small>` : ""}</label>`;
}

/** Tabs for a page: [{ href, label, on }] */
export const tabs = list => `<nav class="tabs" aria-label="Sections">${list.map(t => `<a href="${t.href}" class="${t.on ? "on" : ""}" ${t.on ? 'aria-current="page"' : ""}>${esc(t.label)}</a>`).join("")}</nav>`;

/** Empty-state block. */
export const empty = (text, action = "") => `<div class="empty">${esc(text)}${action ? `<div style="margin-top:12px">${action}</div>` : ""}</div>`;

export const dueText = d => (d ? `Due ${fmtShort(d)}` : "");
