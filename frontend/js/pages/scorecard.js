// Scorecard grid (D1, D4, D5): 13 weeks, one row per measurable. Click a cell to enter,
// override (with a reason) or revert. Used for the company Scorecard and each division's.
import { api } from "../api.js";
import { esc, icon, fmtShort, fmtWhen, fmtDateTime, toast } from "../ui.js";
import { fmtValue, dialog, empty } from "../components.js";
import { DIVISIONS } from "../access.js";
const DIV = Object.fromEntries(DIVISIONS.map(d => [d.code, d.name]));

export async function scorecardBlock({ division = null } = {}) {
  const data = await api("/scorecard" + (division ? `?division=${encodeURIComponent(division)}` : ""));
  if (!data.measurables.length) return { html: empty(division ? "This division has no measurables of its own yet. Its numbers on the company Scorecard are shown there." : "No measurables yet."), data };
  const weeks = data.weeks;
  const head = weeks.map(w => `<th class="wk ${w.current ? "cur" : ""} ${!w.locked ? "open" : ""}" title="${w.locked ? "Locked" : `Open until ${esc(fmtWhen(w.lockAt))}`}">
      ${esc(fmtShort(w.start))}${!w.locked ? `<span class="wk-tag">${w.current ? "This week" : "Open"}</span>` : ""}</th>`).join("");
  const rows = data.measurables.map(m => `<tr>
      <th class="mname" scope="row"><button class="link-btn" data-def="${m.id}" title="What this is and how it's worked out">${esc(m.name)}</button>
        <div class="dim small">${esc(m.owner.name || "No owner")}${m.automatic ? " · automatic" : ""}</div></th>
      <td class="goal">${esc(m.goalText || (m.goal !== null ? fmtValue(m.goal, m.unit) : "—"))}</td>
      ${m.cells.map(c => cellHtml(m, c)).join("")}
    </tr>`).join("");
  return { data, html: `
    <div class="sc-wrap"><table class="sc">
      <thead><tr><th class="mname">Measurable</th><th class="goal">Goal</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="legend small"><span><i class="sw on"></i>On target</span><span><i class="sw off"></i>Off target</span><span><i class="sw ov"></i>Overridden</span>
      <span>Weeks run Monday to Sunday (Sydney) and lock at 5pm on the Tuesday after. Select a measurable's name for its definition.</span></div>` };
}

function cellHtml(m, c) {
  const cls = ["cell", c.onTarget === true ? "on" : c.onTarget === false ? "off" : "", c.override ? "ov" : "", c.value === null ? "blank" : ""].join(" ");
  const can = c.actions.enter || c.actions.override || c.actions.revert;
  const label = `${m.name}, week of ${fmtShort(c.week)}: ${c.value === null ? "no value" : fmtValue(c.value, m.unit)}${c.override ? ", overridden" : ""}`;
  return `<td class="${cls}"><button type="button" class="cell-btn" data-m="${m.id}" data-w="${c.week}" aria-label="${esc(label)}" ${can || c.value !== null ? "" : "disabled"}>
    ${c.value === null ? (can && c.actions.enter ? `<span class="add">Add</span>` : "") : esc(fmtValue(c.value, m.unit))}</button></td>`;
}

export function mountScorecard(root, data, refresh) {
  if (!data) return;
  // Show the latest weeks first: the grid scrolls back in time to the left.
  const wrap = root.querySelector(".sc-wrap");
  if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  root.querySelectorAll("[data-def]").forEach(b => { b.onclick = () => showDefinition(data.measurables.find(m => m.id === Number(b.dataset.def))); });
  root.querySelectorAll(".cell-btn").forEach(b => {
    b.onclick = () => {
      const m = data.measurables.find(x => x.id === Number(b.dataset.m));
      const c = m.cells.find(x => x.week === b.dataset.w);
      openCell(m, c, data.weeks.find(w => w.week === c.week), refresh);
    };
  });
}

function showDefinition(m) {
  dialog({
    title: m.name,
    extra: `<dl class="def">
      <dt>What it is</dt><dd>${esc(m.definition || "Not written yet.")}</dd>
      <dt>Goal</dt><dd>${esc(m.goalText || (m.goal !== null ? fmtValue(m.goal, m.unit) : "Not set"))} (${m.direction === "lower" ? "lower is better" : "higher is better"})</dd>
      <dt>Owner</dt><dd>${esc(m.owner.name || "Not set")}</dd>
      <dt>Source</dt><dd>${m.automatic ? `Filled in automatically from ${esc(m.source)} every hour` : `Entered by hand for now; automatic from ${esc(m.source)} in a later release`}</dd>
      <dt>How often</dt><dd>${m.frequency === "monthly" ? "Monthly, shown each week (provisional until Finance closes the month)" : "Weekly"}</dd>
    </dl>`,
  });
}

function openCell(m, c, week, refresh) {
  const v = c.value === null ? "" : c.value;
  const history = `<dl class="def">
    <dt>Week</dt><dd>${esc(fmtShort(week.start))} – ${esc(fmtShort(week.end))} · ${week.locked ? "Locked" : `open until ${esc(fmtWhen(week.lockAt))}`}</dd>
    <dt>Shown</dt><dd>${c.value === null ? "No value" : esc(fmtValue(c.value, m.unit))}${c.source ? ` <span class="dim">(${c.source === "override" ? "override" : c.source === "entered" ? "entered" : "automatic"})</span>` : ""}</dd>
    ${c.auto !== null ? `<dt>Automatic</dt><dd>${esc(fmtValue(c.auto, m.unit))}${c.provisional ? " (provisional)" : ""}</dd>` : ""}
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

