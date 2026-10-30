// Pulse pages for 0.4.0 (M0 foundations). EOS pages arrive with their milestones (docs/ARCHITECTURE.md §4).
import { CONFIG } from "./config.js";
import * as Auth from "./auth.js";
import { api, serverReady } from "./api.js";
import { APPS, canOpen, appRole } from "./apps.js";
import { ROLES, roleInfo, DIVISIONS } from "./access.js";
import { esc, icon, eyebrow, fmtDate, fmtShort, fmtWhen, fmtDateTime } from "./ui.js";

/** The release 1 sections, in the order they arrive. Shown in the menu and on Home. */
export const SECTIONS = [
  { k: "scorecard", name: "Scorecard", icon: "gauge", version: "0.5.0", auto: "0.6.0",
    desc: "The company's 15 weekly measurables. Filled in automatically from Autotask, Xero and SimpleSAT, with owner overrides and a reason." },
  { k: "rocks", name: "Rocks", icon: "strategise", version: "0.5.0",
    desc: "This quarter's priorities, with owners, milestones and on-track status." },
  { k: "issues", name: "Issues", icon: "discover", version: "0.5.0",
    desc: "The Issues List for IDS. Raise an Autotask ticket or task from an Issue in one click (0.8.0)." },
  { k: "todos", name: "To-dos", icon: "check", version: "0.5.0",
    desc: "Seven-day commitments from the L10. Kept in step with the \"Pulse – L10\" plan in Planner (0.8.0)." },
  { k: "l10", name: "L10 meeting", icon: "calendar", version: "0.7.0",
    desc: "Run Tuesday's Level 10 meeting in Pulse: segue, Scorecard, Rock review, headlines, To-dos, IDS and conclude." },
  { k: "vto", name: "V/TO", icon: "strategy", version: "0.5.0",
    desc: "The Vision/Traction Organizer: core values, focus, 10-year target, marketing strategy, 3-year picture and 1-year plan." },
  { k: "chart", name: "Accountability Chart", icon: "co-managed", version: "0.5.0",
    desc: "Seats, roles and who sits in them. Seats decide which division each measurable belongs to." },
  { k: "people", name: "People and departments", icon: "it-support", version: "0.6.0",
    desc: "Everyone in Pulse, matched to their Autotask resource. See who's in each Autotask department and change default departments." },
];

/* ---------------- Home ---------------- */
export function home(me) {
  const first = (me.person.name || "").split(/\s+/)[0] || "there";
  const h = Number(new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hour12: false }));
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const w = me.week, rw = me.reviewWeek;
  const mine = APPS.filter(canOpen);
  const divs = me.access.divisions.map(c => (DIVISIONS.find(d => d.code === c) || { name: c }).name);

  return `
    ${notices(me)}
    <section class="hero">
      ${eyebrow("HD IT Pulse")}
      <h1>${esc(hello)}, ${esc(first)}</h1>
      <p>Your Scorecard, Rocks, Issues and To-dos in one place, with Pipeline, Marketing ROI and Whitespace Matrix alongside. Release 1 is arriving in stages; this is the foundation.</p>
      <div class="hero-stats">
        <div><div class="k">This week</div><div class="v">${esc(fmtShort(w.start))} – ${esc(fmtShort(w.end))}</div><div class="s">Fills in automatically until it locks</div></div>
        <div><div class="k">L10 reviews</div><div class="v">${esc(fmtShort(rw.start))} – ${esc(fmtShort(rw.end))}</div><div class="s">${rw.locked ? "Locked" : `Locks ${esc(fmtWhen(rw.lockAt))}`}</div></div>
        <div><div class="k">Your divisions</div><div class="v">${me.access.leadership ? "All" : divs.length ? esc(String(divs.length)) : "None yet"}</div><div class="s">${me.access.leadership ? "Leadership sees every division" : divs.length ? esc(divs.join(", ")) : "Company-wide items only"}</div></div>
      </div>
    </section>

    <section class="sec">
      <div class="sec-h"><div>${eyebrow("Apps")}<h2>Your apps</h2></div><span class="aside">${mine.length} of ${APPS.length} available to you</span></div>
      ${mine.length ? `<div class="cards">${mine.map(appCard).join("")}</div>`
        : `<div class="note info">${icon("compliance")}<span>You don't have any apps yet. Ask a Platform Admin to add you to the right group, for example <b>Pulse - Pipeline Users</b>, then sign out and back in.</span></div>`}
    </section>

    <section class="sec">
      <div class="sec-h"><div>${eyebrow("Release 1")}<h2>What's arriving in Pulse</h2></div><span class="aside">Each one switches on in the test environment first</span></div>
      <div class="roadmap">${SECTIONS.map(s => `
        <a class="row" href="#/${s.k}" style="text-decoration:none;color:inherit">
          <span class="ic">${icon(s.icon)}</span>
          <span><h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p></span>
          <span class="chip scheduled">v${esc(s.version)}</span>
        </a>`).join("")}
      </div>
    </section>`;
}

function notices(me) {
  const out = [];
  if (CONFIG.PREVIEW) out.push(`<div class="note">${icon("discover")}<span><b>Preview.</b> This copy of Pulse isn't connected to Entra ID, so sign-in is simulated and nothing here is real data. Use <b>Preview as</b> in your account menu to see what different people get.</span></div>`);
  else if (!serverReady()) out.push(`<div class="note info">${icon("infrastructure")}<span><b>Pulse's server isn't set up in this environment yet.</b> Sign-in and the apps work; Scorecard and the other EOS pages need the database, which arrives when the release 1 setup has been run.</span></div>`);
  else if (me.database && me.database !== "ok") out.push(`<div class="note alert">${icon("infrastructure")}<span><b>Pulse's database didn't answer.</b> You're signed in, but changes can't be saved right now. Try again in a few minutes.</span></div>`);
  if (me.person.firstSignIn) out.push(`<div class="note info">${icon("check")}<span><b>Welcome to Pulse.</b> The <a href="user-guide.html?v=${CONFIG.APP_VERSION}" target="_blank" rel="noopener">user guide</a> explains what's here and what's coming.</span></div>`);
  return out.join("");
}

function appCard(a) {
  if (!a.url) return `<div class="card off"><span class="ic">${icon(a.icon)}</span><h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p>
    <div class="foot"><span class="chip quiet">Not set up here yet</span></div></div>`;
  return `<a class="card" href="#/app/${a.k}"><span class="ic">${icon(a.icon)}</span><h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p>
    <div class="foot"><span class="chip ok">Live</span><span>${appRole(a)}</span><span class="go">Open ${icon("arrow-right", "i-sm")}</span></div></a>`;
}

/* ---------------- EOS sections not yet switched on ---------------- */
export function section(k) {
  const s = SECTIONS.find(x => x.k === k);
  if (!s) return null;
  return `<div class="ph">${eyebrow("EOS")}<h1>${esc(s.name)}</h1><p>${esc(s.desc)}</p></div>
    <div class="note info">${icon("calendar")}<span><b>Arriving in Pulse ${esc(s.version)}.</b> ${s.auto ? `Automatic values from the source systems follow in ${esc(s.auto)}. ` : ""}It switches on in the test environment first, and the change log will say when it's ready.</span></div>
    ${k === "scorecard" ? scorecardRules() : ""}`;
}

function scorecardRules() {
  return `<section class="panel"><h2>How the Scorecard will work</h2>
    <p>The Scorecard week runs Monday to Sunday, Sydney time. Tuesday's L10 at 9:30am reviews the week just ended.</p>
    <p>Each week fills in automatically every hour and locks at 5pm on the Tuesday after it ends. After that, a change is an override with a reason.</p>
    <p>Leadership can override any measurable. Everyone else can override their own division's measurables. An override applies to that week only, keeps the automatic value beside it, and can be reverted. Every override is recorded in the audit log.</p>
  </section>`;
}

/* ---------------- an app in a frame ---------------- */
export function app(k) {
  const a = APPS.find(x => x.k === k);
  if (!a) return null;
  if (!canOpen(a)) return { full: true, html: `<div class="denied"><span class="ic">${icon("compliance", "i-lg")}</span><h2>You don't have access to ${esc(a.name)}</h2>
    <p>Access comes from your groups in Entra ID. Ask a Platform Admin to add you to <b>${esc(roleInfo(a.prefix + ".User").group)}</b>, then sign out and back in.</p><a href="#/">Back to Home</a></div>` };
  if (!a.url) return { full: true, html: `<div class="denied"><span class="ic">${icon(a.icon, "i-lg")}</span><h2>${esc(a.name)} isn't set up here yet</h2><p>It will open here once it's been deployed to this environment.</p><a href="#/">Back to Home</a></div>` };
  if (CONFIG.PREVIEW) return { full: true, html: `<div class="denied"><span class="ic">${icon(a.icon, "i-lg")}</span><h2>${esc(a.name)} opens here</h2>
    <p>In the deployed Pulse, ${esc(a.name)} loads in this space and signs you in with your Microsoft 365 account, as ${appRole(a).toLowerCase()}.</p><a href="#/">Back to Home</a></div>` };
  return { full: true, html: `
    <div class="frame-bar">${icon(a.icon)}<b>${esc(a.name)}</b><span class="dim">${appRole(a)}</span>
      <a href="${esc(a.url)}/" target="_blank" rel="noopener">Open on its own ${icon("external", "i-sm")}</a></div>
    <div class="frame-loading" id="frame-loading">Opening ${esc(a.name)}…</div>
    <iframe class="app-frame" data-app="${a.k}" title="${esc(a.name)}" src="${esc(a.url)}/?embed=pulse"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
      referrerpolicy="strict-origin-when-cross-origin" allow="clipboard-write"></iframe>` };
}

/* ---------------- Your access ---------------- */
export function access(me) {
  const mine = me.roles;
  const a = me.access;
  const can = (yes, text) => `<tr><td>${esc(text)}</td><td>${yes ? `<span class="yes">${icon("check", "i-sm")} Yes</span>` : `<span class="dim">No</span>`}</td></tr>`;
  const divName = c => (DIVISIONS.find(d => d.code === c) || { name: c }).name;
  let h = `<div class="ph">${eyebrow("Platform")}<h1>Your access</h1>
      <p>What you can see and do in Pulse, and why. Access comes from your groups in Microsoft Entra ID; changes apply the next time you sign in.</p></div>
    <section class="panel"><h2>Signed in as</h2><p><b>${esc(me.person.name)}</b> · ${esc(me.person.email)}</p></section>
    <section class="panel"><h2>What you can do</h2><div class="tbl-wrap"><table><thead><tr><th>Permission</th><th>You</th></tr></thead><tbody>
      ${can(true, "See the V/TO, company Rocks and the company Scorecard")}
      ${can(a.divisions.length > 0, a.leadership ? "See every division in full" : `See your division in full${a.divisions.length ? ": " + a.divisions.map(divName).join(", ") : ""}`)}
      ${can(a.leadership || a.ownDivisions.length > 0, a.leadership ? "Override any measurable (with a reason)" : "Override your division's measurables (with a reason)")}
      ${can(a.financeDetail, "See full P&L detail, wages and per-client profitability")}
      ${can(a.changeDepartments, "Change Autotask default departments")}
      ${can(a.viewAudit, "See the audit log and access review")}
      ${can(a.manageConnections, "Manage integration connections")}
    </tbody></table></div></section>
    <section class="panel"><h2>Your roles</h2><div class="tbl-wrap"><table><thead><tr><th>Role</th><th>What it gives you</th><th>Usually from group</th></tr></thead><tbody>
      ${mine.length ? mine.map(v => { const r = roleInfo(v); return `<tr><td><b>${esc(r.label)}</b><div class="dim"><code>${esc(r.v)}</code></div></td><td>${esc(r.grants)}</td><td>${esc(r.group)}</td></tr>`; }).join("")
        : `<tr><td colspan="3" class="dim">No roles yet.</td></tr>`}
    </tbody></table></div></section>
    <section class="panel"><h2>Apps</h2><div class="tbl-wrap"><table><thead><tr><th>App</th><th>Your access</th><th>Status</th></tr></thead><tbody>
      ${APPS.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${canOpen(x) ? `<span class="yes">${icon("check", "i-sm")} ${appRole(x)}</span>` : `<span class="dim">No access</span>`}</td><td>${x.url ? `<span class="chip ok">Live</span>` : `<span class="chip quiet">Not set up here yet</span>`}</td></tr>`).join("")}
    </tbody></table></div></section>`;
  if (a.platform) h += `<section class="panel"><h2>How access is set up</h2>
      <p>Each role is an app role on the <b>HD IT Pulse</b> enterprise application, assigned to the matching security group. To give someone access, add them to the group in the Entra admin centre (Groups, then the group, then Members).</p>
      <div class="tbl-wrap"><table><thead><tr><th>Group</th><th>Role</th><th>Gives</th></tr></thead><tbody>
      ${ROLES.map(r => `<tr><td>${esc(r.group)}</td><td><code>${esc(r.v)}</code></td><td>${esc(r.grants)}</td></tr>`).join("")}
      </tbody></table></div><p style="margin-top:16px"><a href="https://entra.microsoft.com/" target="_blank" rel="noopener">Open the Entra admin centre</a></p></section>`;
  return h;
}

/* ---------------- Audit log (Platform Admins, Compliance) ---------------- */
export async function audit(me, q = {}) {
  if (!me.access.viewAudit) return denied("the audit log", "Pulse - Compliance");
  if (!serverReady() && !CONFIG.PREVIEW) return needsServer("Audit log");
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
  const { events } = await api("/audit" + (params.toString() ? "?" + params : ""));
  return `<div class="ph">${eyebrow("Platform")}<h1>Audit log</h1>
      <p>Every sign-in, change, override and view of a sensitive page. Kept in the Pulse database and in Azure Log Analytics. Viewing this page is itself recorded.</p></div>
    <form class="filters" id="audit-filters">
      <label>Person<input name="actor" value="${esc(q.actor || "")}" placeholder="Name or object id"></label>
      <label>Action starts with<input name="action" value="${esc(q.action || "")}" placeholder="e.g. scorecard."></label>
      <label>From<input type="date" name="from" value="${esc(q.from || "")}"></label>
      <label>To<input type="date" name="to" value="${esc(q.to || "")}"></label>
      <button class="btn" type="submit">Show</button>
    </form>
    <div class="tbl-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Reason</th></tr></thead><tbody>
      ${events.length ? events.map(e => `<tr><td>${esc(fmtDateTime(e.at))}</td><td>${esc(e.actor.name || e.actor.oid)}</td><td><code>${esc(e.action)}</code></td>
        <td>${e.entity ? `${esc(e.entity.type)} <span class="dim">${esc(e.entity.id || "")}</span>` : `<span class="dim">—</span>`}</td><td>${esc(e.reason || "")}</td></tr>`).join("")
        : `<tr><td colspan="5" class="dim">Nothing matches those filters.</td></tr>`}
    </tbody></table></div>`;
}

/* ---------------- Connections (Platform Admins) ---------------- */
export async function connections(me) {
  if (!me.access.manageConnections) return denied("Connections", "Pulse - Platform Admins");
  if (!serverReady() && !CONFIG.PREVIEW) return needsServer("Connections");
  api("/audit/view", { method: "POST", body: { page: "connections" } }).catch(() => {});
  const { connections: list } = await api("/connections");
  return `<div class="ph">${eyebrow("Platform")}<h1>Connections</h1>
      <p>The credentials Pulse uses to read HD IT's systems. They live in Key Vault, each readable only by the part of Pulse that needs it. Pulse never shows a credential; entering and rotating them arrives in 1.0.</p></div>
    <div class="tbl-wrap"><table><thead><tr><th>Connection</th><th>Status</th><th>Last changed</th><th>Last checked</th></tr></thead><tbody>
      ${list.length ? list.map(c => `<tr><td><b>${esc(c.name)}</b><div class="dim">${esc(c.description || "")}</div></td>
        <td>${c.lastError ? `<span class="chip alert">Needs attention</span><div class="dim">${esc(c.lastError)}</div>` : c.configured ? `<span class="chip ok">Entered</span>` : `<span class="chip scheduled">Not entered yet</span>`}</td>
        <td>${c.secretUpdatedAt ? esc(fmtDate(c.secretUpdatedAt)) : `<span class="dim">—</span>`}</td>
        <td>${c.lastCheckedAt ? esc(fmtDateTime(c.lastCheckedAt)) : `<span class="dim">Not yet</span>`}</td></tr>`).join("")
        : `<tr><td colspan="4" class="dim">The sync service hasn't checked the credentials yet. It runs every hour.</td></tr>`}
    </tbody></table></div>`;
}

const denied = (what, group) => `<div class="denied"><span class="ic">${icon("compliance", "i-lg")}</span><h2>You don't have access to ${esc(what)}</h2>
  <p>Ask a Platform Admin to add you to <b>${esc(group)}</b>, then sign out and back in.</p><a href="#/">Back to Home</a></div>`;
const needsServer = what => `<div class="ph">${eyebrow("Platform")}<h1>${esc(what)}</h1></div>
  <div class="note info">${icon("infrastructure")}<span>This needs Pulse's server, which isn't set up in this environment yet.</span></div>`;
