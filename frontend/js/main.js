// HD IT Pulse — shell: sign-in, top bar, menu, routing.
import { CONFIG } from "./config.js";
import * as Auth from "./auth.js";
import { me as loadMe } from "./api.js";
import { APPS, canOpen, startTokenBridge } from "./apps.js";
import * as V from "./views.js";
import { $, esc, icon, initials, toast } from "./ui.js";

let ME = null;
let compact = null;
try { compact = JSON.parse(localStorage.getItem("hdit-pulse:compact")); } catch { /* ignore */ }

/* ---------------- sign-in page ---------------- */
function renderSignIn(error) {
  document.title = "Sign in · HD IT Pulse";
  $("#app").innerHTML = `<div class="signin">
    <div class="signin-art">
      <img class="logo" src="brand/hdit-logo-yellow.svg" alt="HD IT">
      <div><span class="hd-eyebrow">HD IT Pulse</span><h1>How HD IT runs, in one place</h1>
        <p>Scorecard, Rocks, Issues and To-dos for the weekly L10, with Pipeline, Marketing ROI and Whitespace Matrix alongside.</p></div>
      <img class="tag" src="brand/hdit-tagline-yellow.svg" alt="Keep IT Moving">
    </div>
    <div class="signin-panel"><div class="signin-card">
      <h2>Sign in</h2>
      <p>Use your HD IT Microsoft 365 account, on your HD IT laptop. You'll see what your groups give you access to.</p>
      ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
      <button class="btn" id="btn-signin" type="button">${icon("arrow-right")}Sign in with Microsoft 365</button>
      <div class="small">${esc(CONFIG.ENVIRONMENT)} · v${CONFIG.APP_VERSION}</div>
    </div></div>
  </div>`;
  $("#btn-signin").onclick = () => Auth.signIn().catch(e => renderSignIn(e.message));
}

/* ---------------- frame ---------------- */
function topbar() {
  const u = ME.person, env = CONFIG.ENVIRONMENT;
  return `<header class="topbar">
    <a class="brand" href="#/" aria-label="HD IT Pulse home"><img src="brand/hdit-logo-navy.svg" alt="HD IT"><span class="brand-name">Pulse</span></a>
    <span class="env-chip ${/^prod/i.test(env) ? "prod" : ""}">${esc(env)}</span><span class="ver">v${CONFIG.APP_VERSION}</span>
    <span class="spacer"></span>
    <div class="menu-wrap"><button class="tb-btn" id="btn-help" aria-haspopup="true" aria-expanded="false">Help ${icon("chevron-down", "i-sm")}</button>
      <div class="menu" id="help-menu" hidden>
        <a href="user-guide.html?v=${CONFIG.APP_VERSION}" target="_blank" rel="noopener">User guide</a>
        <a href="changelog.html?v=${CONFIG.APP_VERSION}" target="_blank" rel="noopener">What's new</a>
      </div></div>
    <div class="menu-wrap"><button class="avatar" id="btn-user" aria-haspopup="true" aria-expanded="false" aria-label="Your account">${esc(initials(u.name || u.email))}</button>
      <div class="menu" id="user-menu" hidden>
        <div class="who"><b>${esc(u.name)}</b><span>${esc(u.email)}</span></div>
        <a href="#/access">${icon("compliance")}Your access</a>
        ${CONFIG.PREVIEW ? `<label for="preview-as">Preview as</label><select id="preview-as">${Auth.PREVIEW_PERSONAS.map(p => `<option value="${p.k}" ${p.name === u.name ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>` : ""}
        <button id="btn-signout" type="button">${icon("arrow-up-right")}Sign out</button>
      </div></div>
  </header>`;
}

function sidebar(route) {
  const a = ME.access;
  const link = (href, ic, text, on, tag = "") =>
    `<a href="${href}" class="${on ? "on" : ""}" title="${esc(text)}" ${on ? 'aria-current="page"' : ""}>${icon(ic)}<span class="txt">${esc(text)}</span>${tag}</a>`;
  const soon = v => `<span class="soon-tag">${esc(v)}</span>`;
  const mine = APPS.filter(canOpen);
  return `<nav class="side" aria-label="Pulse">
    ${link("#/", "momentum", "Home", route.page === "home")}
    <div class="side-label hd-eyebrow">EOS</div>
    ${V.SECTIONS.filter(s => s.k !== "people").map(s => link(`#/${s.k}`, s.icon, s.name, route.page === s.k, soon(s.version))).join("")}
    ${mine.length ? `<div class="side-label hd-eyebrow">Apps</div>${mine.map(x => link(`#/app/${x.k}`, x.icon, x.name, route.page === "app" && route.id === x.k)).join("")}` : ""}
    <div class="side-label hd-eyebrow">People</div>
    ${link("#/people", "it-support", "People and departments", route.page === "people", soon("0.6.0"))}
    <div class="side-label hd-eyebrow">Platform</div>
    ${link("#/access", "compliance", "Your access", route.page === "access")}
    ${a.viewAudit ? link("#/audit", "vulnerability", "Audit log", route.page === "audit") : ""}
    ${a.manageConnections ? link("#/connections", "infrastructure", "Connections", route.page === "connections") : ""}
    <div class="grow"></div>
    <button class="nav-btn" id="btn-collapse" type="button" title="Collapse or expand the menu">${icon("menu")}<span class="txt">Collapse menu</span></button>
    <div class="side-foot"><b>${esc(ME.person.name)}</b>${esc(ME.person.email)}</div>
  </nav>`;
}

/* ---------------- routing ---------------- */
function parseRoute() {
  const [path, qs] = (location.hash || "#/").replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  if (parts[0] === "app" && parts[1]) return { page: "app", id: parts[1], q };
  return { page: parts[0] || "home", q };
}

async function render() {
  const r = parseRoute();
  let body = "", full = false, title = "HD IT Pulse";
  try {
    if (r.page === "home") body = V.home(ME);
    else if (r.page === "app") { const out = V.app(r.id); if (out) ({ html: body, full } = out); title = (APPS.find(x => x.k === r.id) || {}).name || title; }
    else if (r.page === "access") body = V.access(ME);
    else if (r.page === "audit") body = await V.audit(ME, r.q);
    else if (r.page === "connections") body = await V.connections(ME);
    else body = V.section(r.page);
    if (!body) { body = V.home(ME); r.page = "home"; }
    const s = V.SECTIONS.find(x => x.k === r.page);
    if (s) title = s.name;
  } catch (e) {
    body = `<div class="note alert">${icon("vulnerability")}<span>${esc(e.message)}</span></div>`;
  }
  document.title = title === "HD IT Pulse" ? title : `${title} · HD IT Pulse`;
  const isCompact = compact == null ? r.page === "app" : compact;
  $("#app").innerHTML = topbar() + `<div class="shell ${isCompact ? "compact" : ""}">${sidebar(r)}
    <main id="main" class="${full ? "full" : ""}" tabindex="-1">${full ? body : `<div class="wrap">${body}</div>`}</main></div>`;
  wire(r);
}

function closeMenus() { ["#help-menu", "#user-menu"].forEach(m => { const el = $(m); if (el) el.hidden = true; }); }

function wire(r) {
  const tog = (b, m) => { $(b).onclick = e => { e.stopPropagation(); const open = $(m).hidden; closeMenus(); $(m).hidden = !open; $(b).setAttribute("aria-expanded", String(open)); }; };
  tog("#btn-help", "#help-menu"); tog("#btn-user", "#user-menu");
  $("#btn-signout").onclick = () => Auth.signOut();
  $("#btn-collapse").onclick = () => {
    const now = !document.querySelector(".shell").classList.contains("compact");
    compact = now; try { localStorage.setItem("hdit-pulse:compact", JSON.stringify(now)); } catch { /* ignore */ }
    document.querySelector(".shell").classList.toggle("compact", now);
  };
  const pv = $("#preview-as");
  if (pv) pv.onchange = async () => {
    Auth.setPreview(pv.value); ME = await loadMe(); await render();
    toast("Previewing as " + Auth.PREVIEW_PERSONAS.find(p => p.k === pv.value).label);
  };
  const f = document.querySelector("iframe.app-frame");
  if (f) f.addEventListener("load", () => { const l = $("#frame-loading"); if (l) l.remove(); });
  const af = $("#audit-filters");
  if (af) af.onsubmit = e => {
    e.preventDefault();
    const q = new URLSearchParams([...new FormData(af)].filter(([, v]) => v));
    location.hash = "#/audit" + (q.toString() ? "?" + q : "");
  };
}

document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(); });
window.addEventListener("hashchange", () => { closeMenus(); render(); window.scrollTo(0, 0); });

(async function boot() {
  startTokenBridge();
  try {
    if (!(await Auth.init())) return renderSignIn();
    ME = await loadMe();
    await render();
  } catch (e) {
    if (e && e.code === "no-access") return renderSignIn(e.message);
    renderSignIn(e.message);
  }
})();
