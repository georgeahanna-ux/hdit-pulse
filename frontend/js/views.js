// Platform pages: an app in a frame, Your access, Audit log, Connections. EOS pages live in js/pages/.
import { CONFIG } from "./config.js";
import * as Auth from "./auth.js";
import { api, serverReady } from "./api.js";
import { APPS, canOpen, appRole } from "./apps.js";
import { ROLES, roleInfo, DIVISIONS } from "./access.js";
import { esc, icon, eyebrow, fmtDate, fmtDateTime } from "./ui.js";

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
