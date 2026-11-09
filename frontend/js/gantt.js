// Gantt chart for the Projects module (D21). Plain HTML and SVG, no library.
//   ganttHtml(opts) → markup; mountGantt(root, opts) wires clicks, zoom, collapse and dragging.
// A row: { id, kind: "client"|"project"|"phase"|"task", depth, label, sub, meta, start, end, pct, health,
//          milestone, critical, baseline: {start,end}, complete, href, collapsible, parent, drag }
import { esc } from "./ui.js";

export const SCALES = {
  day: { px: 34, label: "Days" },
  week: { px: 16, label: "Weeks" },
  month: { px: 5, label: "Months" },
  quarter: { px: 2, label: "Quarters" },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 864e5;
const ms = d => Date.parse(d + "T00:00:00Z");
export const addDays = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
const dow = d => new Date(ms(d)).getUTCDay();
const monday = d => addDays(d, -((dow(d) + 6) % 7));
const firstOfMonth = d => d.slice(0, 8) + "01";
const fmtDay = d => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** Chart range: a little before the first date and after the last, on whole weeks/months. */
export function chartRange(start, end, scale) {
  const s = scale === "month" || scale === "quarter" ? firstOfMonth(addDays(start, -14)) : monday(addDays(start, -7));
  let e = addDays(end, scale === "day" ? 10 : scale === "week" ? 21 : 45);
  if (scale === "month" || scale === "quarter") e = addDays(firstOfMonth(addDays(e, 31)), -1);
  return { start: s, end: e, days: daysBetween(s, e) + 1 };
}

function scaleHeader(range, scale, px, hol) {
  const top = [], bottom = [], shade = [];
  const push = (arr, from, to, text, cls = "") => {
    const a = Math.max(0, daysBetween(range.start, from)), b = Math.min(range.days, daysBetween(range.start, to) + 1);
    if (b > a) arr.push(`<div class="g-cell ${cls}" style="left:${a * px}px;width:${(b - a) * px}px"><span>${text}</span></div>`);
  };
  for (let d = firstOfMonth(range.start); d <= range.end; d = addDays(firstOfMonth(addDays(d, 32)), 0)) {
    const last = addDays(firstOfMonth(addDays(d, 32)), -1);
    const y = d.slice(0, 4), m = Number(d.slice(5, 7));
    if (scale === "quarter") {
      if ([1, 4, 7, 10].includes(m)) { const fy = m >= 7 ? Number(y) + 1 : Number(y); const q = { 7: 1, 10: 2, 1: 3, 4: 4 }[m];
        push(bottom, d, addDays(firstOfMonth(addDays(d, 95)), -1), `Q${q} FY${String(fy).slice(2)}`); }
      if (m === 7) push(top, d, addDays(`${Number(y) + 1}-07-01`, -1), `FY${String(Number(y) + 1).slice(2)}`);
    } else if (scale === "month") {
      push(bottom, d, last, MONTHS[m - 1]);
      if (m === 1 || d === firstOfMonth(range.start)) push(top, d, `${y}-12-31`, y);
    } else push(top, d, last, `${MONTHS[m - 1]} ${y}`);
  }
  if (scale === "week") for (let d = monday(range.start); d <= range.end; d = addDays(d, 7)) push(bottom, d, addDays(d, 6), String(Number(d.slice(8))), "wk");
  if (scale === "day") for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    const off = dow(d) === 0 || dow(d) === 6 || (hol && hol.has(d));
    push(bottom, d, d, `${"SMTWTFS"[dow(d)]}<b>${Number(d.slice(8))}</b>`, off ? "off" : "");
  }
  if (scale === "day" || scale === "week") for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    if (dow(d) === 6) shade.push(`<i style="left:${daysBetween(range.start, d) * px}px;width:${2 * px}px"></i>`);
    else if (hol && hol.has(d) && dow(d) !== 0) shade.push(`<i class="hol" style="left:${daysBetween(range.start, d) * px}px;width:${px}px"></i>`);
  }
  return { top: top.join(""), bottom: bottom.join(""), shade: shade.join("") };
}

function bar(r, range, px) {
  if (!r.start || !r.end) return `<span class="g-nodate">No dates in Autotask</span>`;
  const x = daysBetween(range.start, r.start) * px, w = Math.max(px * 0.6, (daysBetween(r.start, r.end) + 1) * px);
  const base = r.baseline && r.baseline.start && r.baseline.end
    ? `<i class="g-base" style="left:${daysBetween(range.start, r.baseline.start) * px}px;width:${Math.max(3, (daysBetween(r.baseline.start, r.baseline.end) + 1) * px)}px" title="Baseline ${fmtDay(r.baseline.start)} – ${fmtDay(r.baseline.end)}"></i>` : "";
  const tip = `${r.label}: ${fmtDay(r.start)} – ${fmtDay(r.end)}${r.pct !== null && r.pct !== undefined ? ` · ${r.pct}% done` : ""}`;
  if (r.milestone) return `${base}<button type="button" class="g-ms ${r.complete ? "done" : ""} ${r.critical ? "crit" : ""}" data-bar="${r.id}" style="left:${x + px / 2 - 9}px" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
  const handles = r.drag ? `<span class="g-h l" data-handle="start"></span><span class="g-h r" data-handle="end"></span>` : "";
  const label = w > 70 ? `<span class="g-bl">${esc(r.barLabel || (r.pct !== null && r.pct !== undefined ? r.pct + "%" : ""))}</span>` : "";
  return `${base}<button type="button" class="g-bar k-${r.kind} h-${r.health || "none"} ${r.critical ? "crit" : ""} ${r.complete ? "done" : ""} ${r.drag ? "drag" : ""}"
    data-bar="${r.id}" style="left:${x}px;width:${w}px" title="${esc(tip)}" aria-label="${esc(tip)}">
    <i class="g-pct" style="width:${Math.max(0, Math.min(100, r.pct || 0))}%"></i>${label}${handles}</button>
    ${w <= 70 && r.outsideLabel ? `<span class="g-out" style="left:${x + w + 6}px">${esc(r.outsideLabel)}</span>` : ""}`;
}

/** Elbow arrows from each predecessor's end to its successor's start. */
function linksSvg(rows, links, range, px, rowH, width) {
  const idx = new Map(rows.map((r, i) => [r.id, i]));
  const paths = [];
  for (const l of links || []) {
    const a = rows[idx.get(`t${l.pred}`)], b = rows[idx.get(`t${l.succ}`)];
    if (!a || !b || !a.end || !b.start) continue;
    const x1 = (daysBetween(range.start, a.end) + 1) * px, y1 = idx.get(a.id) * rowH + rowH / 2;
    const x2 = daysBetween(range.start, b.start) * px, y2 = idx.get(b.id) * rowH + rowH / 2;
    const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12));
    const d = x2 - 8 >= x1 + 4
      ? `M${x1},${y1} H${mid} V${y2} H${x2 - 2}`
      : `M${x1},${y1} h8 V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2 - 2}`;
    paths.push(`<path d="${d}" class="${a.critical && b.critical ? "crit" : ""}" data-link="${l.pred}-${l.succ}"/>`);
  }
  return `<svg class="g-links" width="${width}" height="${rows.length * rowH}" aria-hidden="true">
    <defs><marker id="g-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker>
    <marker id="g-arrow-c" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="crit"/></marker></defs>${paths.join("")}</svg>`;
}

/**
 * opts: { rows, range: {start,end}, today, scale, links, holidays: Set, labelHead, columns: [{key,label,width}],
 *         rowH, labelWidth }
 */
export function ganttHtml(opts) {
  const scale = opts.scale || "week";
  const px = SCALES[scale].px;
  const range = chartRange(opts.range.start, opts.range.end, scale);
  const rowH = opts.rowH || 40;
  const width = range.days * px;
  const rows = opts.rows.filter(r => !r.hidden);
  const head = scaleHeader(range, scale, px, opts.holidays);
  const cols = opts.columns || [];
  const todayX = opts.today >= range.start && opts.today <= range.end ? daysBetween(range.start, opts.today) * px + px / 2 : null;
  const body = rows.map(r => `<div class="g-row k-${r.kind} ${r.mine ? "mine" : ""} ${r.complete ? "done" : ""}" data-row="${r.id}" style="height:${rowH}px">
      <div class="g-lab" style="padding-left:${12 + (r.depth || 0) * 18}px">
        ${r.collapsible ? `<button type="button" class="g-tog" data-tog="${r.id}" aria-expanded="${!r.collapsed}" aria-label="${r.collapsed ? "Expand" : "Collapse"} ${esc(r.label)}">${r.collapsed ? "▸" : "▾"}</button>` : `<span class="g-tog-sp"></span>`}
        <span class="g-name">${r.href ? `<a href="${r.href}" data-open="${r.id}">${esc(r.label)}</a>` : `<button type="button" class="g-lbl" data-open="${r.id}">${esc(r.label)}</button>`}
          ${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span>
        ${cols.map(c => `<span class="g-col" style="width:${c.width}px">${r.cols && r.cols[c.key] !== undefined ? r.cols[c.key] : ""}</span>`).join("")}
      </div>
      <div class="g-track" style="width:${width}px">${bar(r, range, px)}</div>
    </div>`).join("");
  return `<div class="gantt s-${scale}" style="--px:${px}px;--rowh:${rowH}px;--labw:${opts.labelWidth || 340}px">
    <div class="g-scroll" tabindex="0" aria-label="Gantt chart, scroll sideways for other dates">
      <div class="g-inner" style="width:calc(var(--labw) + ${width}px)">
        <div class="g-head">
          <div class="g-lab g-lab-h"><span class="g-tog-sp"></span><span class="g-name">${esc(opts.labelHead || "")}</span>${cols.map(c => `<span class="g-col" style="width:${c.width}px">${esc(c.label)}</span>`).join("")}</div>
          <div class="g-scale" style="width:${width}px"><div class="g-top">${head.top}</div><div class="g-bottom">${head.bottom}</div></div>
        </div>
        <div class="g-body">
          <div class="g-shade" style="width:${width}px">${head.shade}</div>
          ${body}
          ${opts.links ? `<div class="g-links-wrap">${linksSvg(rows, opts.links, range, px, rowH, width)}</div>` : ""}
          ${todayX !== null ? `<div class="g-today" style="left:calc(var(--labw) + ${todayX}px)"><span>Today</span></div>` : ""}
        </div>
      </div>
    </div>
  </div>`;
}

/** Scrolls so the given day sits a little in from the left edge of the timeline. */
export function scrollToDay(root, opts, day) {
  const sc = root.querySelector(".g-scroll");
  if (!sc) return;
  const range = chartRange(opts.range.start, opts.range.end, opts.scale || "week");
  const px = SCALES[opts.scale || "week"].px;
  sc.scrollLeft = Math.max(0, daysBetween(range.start, day) * px - 7 * px * (opts.scale === "day" ? 1 : opts.scale === "week" ? 2 : 6));
}

/**
 * Dragging (Project Managers): drag the middle of a bar to move it, an end to change its length.
 * Snaps to whole days. onDrop({ id, start, end }) returns a promise; the bar snaps back if it rejects.
 */
export function enableDrag(root, opts, onDrop) {
  const scale = opts.scale || "week", px = SCALES[scale].px;
  root.querySelectorAll(".g-bar.drag").forEach(el => {
    const row = opts.rows.find(r => String(r.id) === el.dataset.bar);
    if (!row || !row.start || !row.end) return;
    el.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const mode = e.target.dataset.handle || "move";
      const x0 = e.clientX, left0 = el.offsetLeft, w0 = el.offsetWidth;
      let moved = false, dd = 0;
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
      const tipEl = document.createElement("div");
      tipEl.className = "g-dragtip"; el.parentElement.appendChild(tipEl);
      const onMove = ev => {
        dd = Math.round((ev.clientX - x0) / px);
        if (Math.abs(ev.clientX - x0) > 3) moved = true;
        const s = mode === "end" ? row.start : addDays(row.start, dd);
        let en = mode === "start" ? row.end : addDays(row.end, dd);
        if (mode === "start" && s > row.end) dd = daysBetween(row.start, row.end);
        if (mode === "end" && en < row.start) { dd = daysBetween(row.end, row.start); en = row.start; }
        if (mode === "move") el.style.left = left0 + dd * px + "px";
        if (mode === "start") { el.style.left = left0 + dd * px + "px"; el.style.width = Math.max(px, w0 - dd * px) + "px"; }
        if (mode === "end") el.style.width = Math.max(px, w0 + dd * px) + "px";
        tipEl.textContent = `${fmtDay(mode === "end" ? row.start : addDays(row.start, dd))} – ${fmtDay(mode === "start" ? row.end : addDays(row.end, dd))}`;
        tipEl.style.left = el.offsetLeft + "px";
      };
      const reset = () => { el.style.left = left0 + "px"; el.style.width = w0 + "px"; };
      const onUp = async () => {
        el.removeEventListener("pointermove", onMove);
        el.classList.remove("dragging"); tipEl.remove();
        if (!moved || !dd) { reset(); if (!moved) el.dataset.clicked = "1"; return; }
        el.dataset.justDragged = "1";
        const next = { id: row.taskId, start: mode === "end" ? row.start : addDays(row.start, dd), end: mode === "start" ? row.end : addDays(row.end, dd), mode };
        try { await onDrop(next); } catch { reset(); }
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp, { once: true });
      el.addEventListener("pointercancel", () => { el.removeEventListener("pointermove", onMove); tipEl.remove(); reset(); }, { once: true });
    });
  });
}
