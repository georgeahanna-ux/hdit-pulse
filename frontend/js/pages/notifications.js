// Your reminders (0.9.0): Teams Activity feed reminders and the Monday email, each on or off.
import { api } from "../api.js";
import { esc, icon, toast, fmtDateTime } from "../ui.js";
import { empty } from "../components.js";

const KIND = { numbers: "Numbers to enter", rock: "Rock off track", l10: "L10 reminder", "l10-todos": "To-dos from the L10", overdue: "Overdue To-do", email: "Weekly summary", test: "Test" };

export async function notificationsPage(me) {
  const p = await api("/me/preferences");
  const toggle = (name, on, title, text) => `<label class="pref"><input type="checkbox" name="${name}" ${on ? "checked" : ""}>
      <span><b>${esc(title)}</b><span class="dim">${esc(text)}</span></span></label>`;
  return {
    title: "Notifications",
    html: `<div class="ph"><span class="hd-eyebrow">Your account</span><h1>Notifications</h1>
        <p>Pulse only tells you about things that are yours, and each reminder comes once.</p></div>
      <section class="sec"><form class="prefs" id="prefs">
        ${toggle("teamsReminders", p.teamsReminders, "Reminders in Microsoft Teams", "In your Teams Activity feed: Monday, numbers you still need to enter and Rocks that are off track; Tuesday before the L10 (leadership team); your new To-dos after each L10; and each To-do once it's overdue. Selecting one opens that page of Pulse in Teams.")}
        ${toggle("weeklyEmail", p.weeklyEmail, "Monday summary by email", "One page at 7am Monday: your To-dos, your Rocks, numbers to enter, and how the company Scorecard went last week.")}
      </form>
      <div class="note info">${icon("calendar")}<span>Teams reminders need Pulse installed in your Teams. If it isn't there yet, ask a Platform Admin. Times are Sydney time.</span></div>
      <button class="btn outline" type="button" id="notify-test">${icon("email", "i-sm")}Send me a test</button></section>
      <section class="sec"><div class="sec-h"><h2>Sent to you lately</h2></div>
        ${p.recent.length ? `<ul class="plain">${p.recent.map(r => `<li><span class="chip quiet">${esc(KIND[r.kind] || r.kind)}</span> <span class="dim small">${r.channel === "teams" ? "Teams" : "Email"} · ${esc(fmtDateTime(r.at))}</span>
          <div>${esc(r.text || "")}</div>${r.error ? `<div class="err small">Not delivered: ${esc(r.error)}</div>` : ""}</li>`).join("")}</ul>` : empty("Nothing yet.")}</section>`,
    mount: (root, refresh) => {
      const f = root.querySelector("#prefs");
      f.onchange = async () => {
        try { await api("/me/preferences", { method: "PUT", body: { teamsReminders: f.teamsReminders.checked, weeklyEmail: f.weeklyEmail.checked } }); toast("Saved"); }
        catch (e) { toast(e.message); refresh(); }
      };
      root.querySelector("#notify-test").onclick = async () => {
        try { await api("/notify/test", { method: "POST", body: {} }); toast("On its way: check Teams and your email within a few minutes"); } catch (e) { toast(e.message); }
      };
    },
  };
}
