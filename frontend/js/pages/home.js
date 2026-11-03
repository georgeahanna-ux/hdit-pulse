// Home ("My Pulse"): the person's own seat, Rocks, To-dos and measurables, and their apps.
// Leadership and Finance also get the FY progress bars at the top (D19).
import { CONFIG } from "../config.js";
import { api, serverReady } from "../api.js";
import { APPS, canOpen, appRole } from "../apps.js";
import { esc, icon, eyebrow, fmtShort, fmtWhen } from "../ui.js";
import { rockChip, dueText, empty } from "../components.js";
import { planBlock, canSeePlan, divisionName } from "./org.js";

export async function homePage(me, structure) {
  const first = (me.person.name || "").split(/\s+/)[0] || "there";
  const h = Number(new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hour12: false }));
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const ready = serverReady() || CONFIG.PREVIEW;
  const [summary, plan] = ready ? await Promise.all([
    api("/me/summary").catch(() => null),
    canSeePlan(me) ? planBlock().catch(e => ({ html: `<div class="note alert">${esc(e.message)}</div>` })) : null,
  ]) : [null, null];
  const myDivisions = structure ? structure.divisions.filter(d => d.isMine) : [];
  const rw = me.reviewWeek;
  const mine = APPS.filter(canOpen);

  return {
    title: "Home",
    html: `
    ${notices(me)}
    <section class="hero">
      ${eyebrow(me.access.leadership ? "Leadership" : "My Pulse")}
      <h1>${esc(hello)}, ${esc(first)}</h1>
      <div class="hero-stats">
        <div><div class="k">This week</div><div class="v">${esc(fmtShort(me.week.start))} – ${esc(fmtShort(me.week.end))}</div><div class="s">Fills in until it locks</div></div>
        <div><div class="k">L10 reviews</div><div class="v">${esc(fmtShort(rw.start))} – ${esc(fmtShort(rw.end))}</div><div class="s">${rw.locked ? "Locked" : `Locks ${esc(fmtWhen(rw.lockAt))}`}</div></div>
        ${summary ? `<div><div class="k">Your To-dos</div><div class="v">${summary.todos.length}</div><div class="s">${summary.todos.filter(t => t.overdue).length ? `${summary.todos.filter(t => t.overdue).length} overdue` : "None overdue"}</div></div>
        <div><div class="k">Your Rocks</div><div class="v">${summary.rocks.length}</div><div class="s">${esc(summary.quarter)}</div></div>` : ""}
      </div>
    </section>

    ${plan ? `<section class="sec"><div class="sec-h"><div>${eyebrow(plan.data ? `${plan.data.label} 1-year plan` : "1-year plan")}<h2>Progress to the plan</h2></div>
      <a class="aside" href="#/plan">FY plan</a></div>${plan.html}</section>` : ""}

    ${summary ? `
    <section class="sec"><div class="sec-h"><div>${eyebrow("Your seat")}<h2>${summary.seats.length ? summary.seats.map(s => esc(s.title)).join(", ") : "Your work"}</h2></div>
      ${myDivisions.length ? `<span class="aside">${myDivisions.map(d => `<a href="#/division/${d.code}">${esc(d.name)}</a>`).join(" · ")}</span>` : ""}</div>
      ${!summary.seats.length ? `<p class="dim">You're not in a seat on the Accountability Chart yet, so this shows only work that's assigned to you.</p>` : ""}
      <div class="mine-grid">
        <div class="panel tight"><h3>To-dos</h3>${summary.todos.length ? `<ul class="plain">${summary.todos.slice(0, 7).map(t => `<li>${t.overdue ? `<span class="chip alert">Overdue</span> ` : ""}${esc(t.title)} <span class="dim small">${esc(dueText(t.dueDate))}</span></li>`).join("")}</ul>` : `<p class="dim">Nothing on your list.</p>`}
          <a class="small" href="#/todos">All To-dos</a></div>
        <div class="panel tight"><h3>Rocks · ${esc(summary.quarter)}</h3>${summary.rocks.length ? `<ul class="plain">${summary.rocks.map(r => `<li>${rockChip(r.status)} ${esc(r.title)}</li>`).join("")}</ul>` : `<p class="dim">No Rocks of yours this quarter.</p>`}
          <a class="small" href="#/rocks">All Rocks</a></div>
        <div class="panel tight"><h3>Measurables you own</h3>${summary.measurables.length ? `<ul class="plain">${summary.measurables.map(m => `<li>${esc(m.name)} <span class="dim small">${esc(m.goalText || "")}</span></li>`).join("")}</ul>` : `<p class="dim">None.</p>`}
          <a class="small" href="#/scorecard">Scorecard</a></div>
      </div>
    </section>` : ""}

    ${structure && myDivisions.length ? `<section class="sec"><div class="sec-h"><div>${eyebrow("Your divisions")}<h2>Where your team works</h2></div></div>
      <div class="cards">${myDivisions.map(d => `<a class="card" href="#/division/${d.code}"><span class="ic">${icon(DIVISION_ICONS[d.code] || "co-managed")}</span><h3>${esc(d.name)}</h3>
        <p>${d.functions.length ? esc(d.functions.map(f => f.name).join(", ")) : `${d.seats.length} seats`}</p><div class="foot"><span class="go">Open ${icon("arrow-right", "i-sm")}</span></div></a>`).join("")}</div></section>` : ""}

    <section class="sec"><div class="sec-h"><div>${eyebrow("Apps")}<h2>Your apps</h2></div><span class="aside">${mine.length} of ${APPS.length} available to you</span></div>
      ${mine.length ? `<div class="cards">${mine.map(a => a.url ? `<a class="card" href="#/app/${a.k}"><span class="ic">${icon(a.icon)}</span><h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p>
        <div class="foot"><span>${appRole(a)}</span><span class="go">Open ${icon("arrow-right", "i-sm")}</span></div></a>`
        : `<div class="card off"><span class="ic">${icon(a.icon)}</span><h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p><div class="foot"><span class="chip quiet">Not set up here yet</span></div></div>`).join("")}</div>`
        : empty("You don't have any apps yet. Ask a Platform Admin to add you to the right group, then sign out and back in.")}
    </section>`,
  };
}

export const DIVISION_ICONS = { Leadership: "strategy", Finance: "finance", People: "it-support", SalesMarketing: "trend-up", InnovationCompliance: "compliance", ManagedServices: "managed-it" };

function notices(me) {
  const out = [];
  if (CONFIG.PREVIEW) out.push(`<div class="note">${icon("discover")}<span><b>Preview.</b> Sign-in is simulated and every figure here is made up. Use <b>Preview as</b> in your account menu to see what different people get.</span></div>`);
  else if (!serverReady()) out.push(`<div class="note info">${icon("infrastructure")}<span><b>Pulse's server isn't set up in this environment yet.</b></span></div>`);
  else if (me.database && me.database !== "ok") out.push(`<div class="note alert">${icon("infrastructure")}<span><b>Pulse's database didn't answer.</b> You're signed in, but changes can't be saved right now. Try again in a few minutes.</span></div>`);
  if (me.person.firstSignIn) out.push(`<div class="note info">${icon("check")}<span><b>Welcome to Pulse.</b> The <a href="user-guide.html?v=${CONFIG.APP_VERSION}" target="_blank" rel="noopener">user guide</a> explains what's here.</span></div>`);
  return out.join("");
}

export { divisionName };
