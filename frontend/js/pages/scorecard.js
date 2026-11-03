// Scorecard grid (D1, D4, D5): 13 weeks, one row per measurable. Click a cell to enter,
// override (with a reason) or revert. Used for the company Scorecard and each division's.
import { api } from "../api.js";
import { esc, icon, fmtShort, fmtWhen, fmtDateTime, toast } from "../ui.js";
import { fmtValue, dialog, empty } from "../components.js";
import { DIVISIONS } from "../access.js";
const DIV = Object.fromEntries(DIVISIONS.map(d => [d.code, d.name]));
const SRC = { autotask: "Autotask", simplesat: "SimpleSAT", xero: "Xero", pipeline: "Pipeline", mroi: "Marketing ROI", manual: "typed in" };
const srcName = s => SRC[s] || s;

// Whether to show trial (automatic) values under the entered ones. Remembered per browser.
const SHOW_KEY = "hdit-pulse:show-trial";
const showTrial = () => { try { return localStorage.getItem(SHOW_KEY) !== "0"; } catch { return true; } };
const setShowTrial = on => { try { localStorage.setItem(SHOW_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ } };

export async function scorecardBlock({ division = null } = {}) {
  const data = await api("/scorecard" + (division ? `?division=${encodeURIComponent(division)}` : ""));
  if (!data.measurables.length) return { html: empty(division ? "This division has no measurables of its own yet. Its numbers on the company Scorecard are shown there." : "No measurables yet."), data };
  const weeks = data.weeks;
  const head = weeks.map(w => `<th class="wk ${w.current ? "cur" : ""} ${!w.locked ? "open" : ""}" title="${w.locked ? "Locked" : `Open until ${esc(fmtWhen(w.lockAt))}`}">
      ${esc(fmtShort(w.start))}${!w.locked ? `<span class="wk-tag">${w.current ? "This week" : "Open"}</span>` : ""}</th>`).join("");
  const rows = data.measurables.map(m => `<tr>
      <th class="mname" scope="row"><button class="link-btn" data-def="${m.id}" title="What this is and how it's worked out">${esc(m.name)}</button>
        <div class="dim small">${esc(m.owner.name || "No owner")}${m.automatic ? ` · automatic from ${esc(srcName(m.source))}` : ""}${m.trial ? ` <span class="chip quiet trial-chip" title="Pulse works this out from ${esc(srcName(m.source))} every hour. Until Leadership switches it on, the typed-in value is what counts.">Automatic on trial</span>` : ""}</div></th>
      <td class="goal">${esc(m.goalText || (m.goal !== null ? fmtValue(m.goal, m.unit) : "—"))}</td>
      ${m.cells.map(c => cellHtml(m, c)).join("")}
    </tr>`).join("");
  const trials = data.measurables.filter(m => m.trial).length;
  const bar = trials || data.canRefresh ? `<div class="sc-bar small">
      ${trials ? `<label class="check"><input type="checkbox" id="show-trial" ${showTrial() ? "checked" : ""}> Show automatic values on trial (${trials})</label>` : ""}
      <span class="dim">${data.collectedAt ? `Automatic values last worked out ${esc(fmtDateTime(data.collectedAt))}` : "Automatic values haven't been worked out yet"}</span>
      ${data.canRefresh ? `<button class="link-btn small" type="button" id="sc-refresh">Work out now</button>` : ""}
    </div>` : "";
  return { data, html: bar + `
    <div class="sc-wrap ${showTrial() ? "show-trial" : ""}"><table class="sc">
      <thead><tr><th class="mname">Measurable</th><th class="goal">Goal</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="legend small"><span><i class="sw on"></i>On target</span><span><i class="sw off"></i>Off target</span><span><i class="sw ov"></i>Overridden</span>
      ${trials ? `<span><i class="sw trial"></i>Automatic value (trial)</span>` : ""}
      <span>Weeks run Monday to Sunday (Sydney) and lock at 5pm on the Tuesday after. Select a measurable's name for its definition.</span></div>` };
}

function cellHtml(m, c) {
  const cls = ["cell", c.onTarget === true ? "on" : c.onTarget === false ? "off" : "", c.override ? "ov" : "", c.value === null ? "blank" : ""].join(" ");
  const can = c.actions.enter || c.actions.override || c.actions.revert;
  const label = `${m.name}, week of ${fmtShort(c.week)}: ${c.value === null ? "no value" : fmtValue(c.value, m.unit)}${c.override ? ", overridden" : ""}`;
  const trial = m.trial && c.auto !== null ? `<span class="trial-v" title="Automatic value on trial">${esc(fmtValue(c.auto, m.unit))}</span>` : "";
  return `<td class="${cls}"><button type="button" class="cell-btn" data-m="${m.id}" data-w="${c.week}" aria-label="${esc(label)}${trial ? `, automatic ${esc(fmtValue(c.auto, m.unit))}` : ""}" ${can || c.value !== null || trial ? "" : "disabled"}>
    ${c.value === null ? (can && c.actions.enter ? `<span class="add">Add</span>` : "") : esc(fmtValue(c.value, m.unit))}${trial}</button></td>`;
}

export function mountScorecard(root, data, refresh) {
  if (!data) return;
  // Show the latest weeks first: the grid scrolls back in time to the left.
  const wrap = root.querySelector(".sc-wrap");
  if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  root.querySelectorAll("[data-def]").forEach(b => { b.onclick = () => showDefinition(data.measurables.find(m => m.id === Number(b.dataset.def)), data, refresh); });
  const toggle = root.querySelector("#show-trial");
  if (toggle) toggle.onchange = () => { setShowTrial(toggle.checked); wrap.classList.toggle("show-trial", toggle.checked); };
  const again = root.querySelector("#sc-refresh");
  if (again) again.onclick = async () => {
    again.disabled = true;
    try { const r = await api("/scorecard/refresh", { method: "POST" }); toast(r.detail || "Asked for a refresh"); } catch (e) { toast(e.message); again.disabled = false; }
  };
  root.querySelectorAll(".cell-btn").forEach(b => {
    b.onclick = () => {
      const m = data.measurables.find(x => x.id === Number(b.dataset.m));
      const c = m.cells.find(x => x.week === b.dataset.w);
      openCell(m, c, data.weeks.find(w => w.week === c.week), refresh);
    };
  });
}

/** The trial comparison: weeks with both an entered and an automatic value. */
function comparison(m) {
  const both = m.cells.filter(c => c.auto !== null && c.entered);
  if (!both.length) return `<p class="dim small">No weeks with both a typed-in and an automatic value yet.</p>`;
  const rows = both.slice(-8).map(c => `<tr><td>${esc(fmtShort(c.week))}</td><td class="num">${esc(fmtValue(c.entered.value, m.unit))}</td><td class="num">${esc(fmtValue(c.auto, m.unit))}</td>
    <td class="num dim">${esc(fmtValue(Math.round((c.auto - c.entered.value) * 10) / 10, m.unit === "currency" ? "currency" : m.unit === "percent" ? "percent" : "ratio"))}</td></tr>`).join("");
  return `<div class="tbl-wrap"><table class="compact"><thead><tr><th>Week of</th><th class="num">Typed in</th><th class="num">Automatic</th><th class="num">Difference</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function showDefinition(m, data, refresh) {
  const source = m.automatic
    ? `Filled in automatically from ${esc(srcName(m.source))} every hour${m.autoChanged ? ` (switched on by ${esc(m.autoChanged.by)}, ${esc(fmtDateTime(m.autoChanged.at))})` : ""}.`
    : m.trial
      ? `<b>Automatic on trial.</b> Pulse works it out from ${esc(srcName(m.source))} every hour and shows it beside the typed-in value. The typed-in value counts until Leadership switches it on.`
      : `Typed in for now; automatic from ${esc(srcName(m.source))} in a later release.`;
  const canSwitch = data && data.canRefresh && m.collector;
  dialog({
    title: m.name,
    ...(canSwitch ? {
      fields: [{ name: "reason", label: m.automatic ? "Reason for switching back to typed in" : "Reason for switching to automatic", type: "textarea", rows: 2, required: true, hint: "Kept in the audit log." }],
      submit: m.automatic ? "Switch back to typed in" : "Switch to automatic",
      onSubmit: async f => {
        await api(`/measurables/${m.id}/automatic`, { method: "POST", body: { enabled: !m.automatic, reason: f.reason } });
        toast(m.automatic ? `${m.name} is typed in again` : `${m.name} now fills in automatically`); refresh();
      },
    } : {}),
    extra: `<dl class="def">
      <dt>What it is</dt><dd>${esc(m.definition || "Not written yet.")}</dd>
      <dt>Goal</dt><dd>${esc(m.goalText || (m.goal !== null ? fmtValue(m.goal, m.unit) : "Not set"))} (${m.direction === "lower" ? "lower is better" : "higher is better"})</dd>
      <dt>Owner</dt><dd>${esc(m.owner.name || "Not set")}</dd>
      <dt>Source</dt><dd>${source}</dd>
      <dt>How often</dt><dd>${m.frequency === "monthly" ? "Monthly, shown each week (provisional until Finance closes the month)" : "Weekly"}</dd>
    </dl>${m.trial || (m.automatic && m.collector) ? `<h3 class="small-h">Typed in and automatic, side by side</h3>${comparison(m)}` : ""}
    ${canSwitch ? `<p class="small">${m.automatic ? "Switching back means people type this in again from the current week. Past automatic values stay as they are." : "Once switched on, open weeks fill in automatically and can't be typed in; locked weeks can still be overridden with a reason. Values already typed in are kept."}</p>` : ""}`,
  });
}

function openCell(m, c, week, refresh) {
  const v = c.value === null ? "" : c.value;
  const history = `<dl class="def">
    <dt>Week</dt><dd>${esc(fmtShort(week.start))} – ${esc(fmtShort(week.end))} · ${week.locked ? "Locked" : `open until ${esc(fmtWhen(week.lockAt))}`}</dd>
    <dt>Shown</dt><dd>${c.value === null ? "No value" : esc(fmtValue(c.value, m.unit))}${c.source ? ` <span class="dim">(${c.source === "override" ? "override" : c.source === "entered" ? "entered" : "automatic"})</span>` : ""}</dd>
    ${c.auto !== null ? `<dt>Automatic${m.trial ? " (trial)" : ""}</dt><dd>${esc(fmtValue(c.auto, m.unit))}${c.provisional ? " (provisional)" : ""}${c.autoDetail && c.autoDetail.text ? `<div class="dim small">${esc(c.autoDetail.text)}${c.autoDetail.at ? ` Worked out ${esc(fmtDateTime(c.autoDetail.at))}.` : ""}</div>` : ""}${m.trial ? `<div class="dim small">On trial: not counted until Leadership switches this measurable to automatic.</div>` : ""}</dd>` : ""}
    ${c.entered ? `<dt>Entered</dt><dd>${esc(fmtValue(c.entered.value, m.unit))} by ${esc(c.entered.by || "")}${c.entered.at ? `, ${esc(fmtDateTime(c.entered.at))}` : ""}</dd>` : ""}
    ${c.override ? `<dt>Override</dt><dd>${esc(fmtValue(c.override.value, m.unit))} by ${esc(c.override.by || "")}: “${esc(c.override.reason || "")}”</dd>` : ""}
  </dl>`;
  const unitHint = { percent: "A percentage, e.g. 95.5", currency: "Dollars, e.g. 12500", days: "Days, e.g. 21", score: "A score, e.g. 65" }[m.unit] || "A number";
  const send = (path, body) => api(path, { method: "POST", body: { measurableId: m.id, week: c.week, ...body } });

  if (c.actions.enter) {
    return dialog({
      title: `${m.name}: week of ${fmtShort(c.week)}`, extra: history, submit: "Save",
      fields: [{ name: "value", label: "Value", type: "number", value: v, hint: `${unitHint}. Leave empty to clear it.` }],
      onSubmit: async f => { await send("/scorecard/enter", { value: f.value }); toast("Saved"); refresh(); },
    });
  }
  if (c.actions.revert) {
    return dialog({
      title: `${m.name}: week of ${fmtShort(c.week)}`, extra: history + `<p>Change the override, or remove it to go back to the ${c.auto !== null ? "automatic" : "entered"} value.</p>`,
      fields: [
        { name: "action", label: "What to do", type: "select", value: "override", options: [{ v: "override", t: "Change the override" }, { v: "revert", t: "Remove the override" }] },
        { name: "value", label: "New value (for a change)", type: "number", value: v, hint: unitHint },
        { name: "reason", label: "Reason", type: "textarea", rows: 2, required: true, hint: "Kept in the audit log." },
      ],
      submit: "Save",
      onSubmit: async f => {
        if (f.action === "revert") await send("/scorecard/revert", { reason: f.reason });
        else await send("/scorecard/override", { value: f.value, reason: f.reason });
        toast(f.action === "revert" ? "Override removed" : "Override saved"); refresh();
      },
    });
  }
  if (c.actions.override) {
    return dialog({
      title: `Override ${m.name}: week of ${fmtShort(c.week)}`,
      intro: week.locked ? "This week has locked. An override applies to this week only and keeps the original value beside it." : "This measurable fills in automatically. An override applies to this week only.",
      extra: history,
      fields: [
        { name: "value", label: "Value", type: "number", value: v, required: true, hint: unitHint },
        { name: "reason", label: "Reason", type: "textarea", rows: 2, required: true, hint: "Required. Kept in the audit log with your name." },
      ],
      submit: "Save override",
      onSubmit: async f => { await send("/scorecard/override", { value: f.value, reason: f.reason }); toast("Override saved"); refresh(); },
    });
  }
  return dialog({ title: `${m.name}: week of ${fmtShort(c.week)}`, extra: history + `<p class="dim">Only Leadership and ${esc(DIV[m.division] || m.division)} can change this measurable.</p>` });
}

export async function scorecardPage(ctx) {
  const { html, data } = await scorecardBlock();
  return {
    title: "Scorecard",
    html: `<div class="ph"><span class="hd-eyebrow">Company</span><h1>Scorecard</h1>
      <p>The company's weekly measurables, last 13 weeks. Leadership can change any of them; everyone else can change their own division's.</p></div>${html}`,
    mount: (root, refresh) => mountScorecard(root, data, refresh),
  };
}

