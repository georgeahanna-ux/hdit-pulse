// HD IT Pulse — shell: sign-in, top bar, menu (Company, Divisions, Apps, Platform), routing.
import { CONFIG } from "./config.js";
import * as Auth from "./auth.js";
import { api, me as loadMe, serverReady } from "./api.js";
import { APPS, canOpen, startTokenBridge } from "./apps.js";
import * as V from "./views.js";
import { $, esc, icon, initials, toast } from "./ui.js";
import { homePage, DIVISION_ICONS } from "./pages/home.js";
import { scorecardPage } from "./pages/scorecard.js";
import { rocksPage, issuesPage, todosPage, vtoPage } from "./pages/eos.js";
import { planPage, chartPage, divisionPage, seatPage, canSeePlan } from "./pages/org.js";

let ME = null, STRUCTURE = null;
let compact = null;
try { compact = JSON.parse(localStorage.getItem("hdit-pulse:compact")); } catch { /* ignore */ }

/* ---------------- sign-in page ---------------- */
function renderSignIn(error) {
  document.title = "Sign in · HD IT Pulse";
  $("#app").innerHTML = `<div class="signin">
    <div class="signin-art">
      <img class="logo" src="brand/hdit-logo-yellow.svg" alt="HD IT">
      <div><span class="hd-eyebrow">HD IT Pulse</span><h1>How HD IT runs, in one place</h1>
        <p>Scorecard, Rocks, Issues and To-dos for the weekly L10, with each division's numbers and tools alongside.</p></div>
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
  const link = (href, ic, text, on, { tag = "", cls = "" } = {}) =>
    `<a href="${href}" class="${on ? "on" : ""} ${cls}" title="${esc(text)}" ${on ? 'aria-current="page"' : ""}>${icon(ic)}<span class="txt">${esc(text)}</span>${tag}</a>`;
  const soon = v => `<span class="soon-tag">${esc(v)}</span>`;
  const mine = APPS.filter(canOpen);
  const divs = STRUCTURE ? STRUCTURE.divisions.filter(d => d.canSee).sort((x, y) => (y.isMine - x.isMine)) : [];
  const currentDivision = route.page === "division" ? route.id : route.page === "seat" && STRUCTURE ? (STRUCTURE.divisions.find(d => d.seats.some(s => s.id === Number(route.id))) || {}).code : null;
  return `<nav class="side" aria-label="Pulse">
    ${link("#/", "momentum", "Home", route.page === "home")}
    <div class="side-label hd-eyebrow">Company</div>
    ${link("#/scorecard", "gauge", "Scorecard", route.page === "scorecard")}
    ${link("#/rocks", "strategise", "Rocks", route.page === "rocks")}
    ${a.leadership ? link("#/issues", "discover", "Issues", route.page === "issues") : ""}
    ${link("#/todos", "check", "To-dos", route.page === "todos")}
    ${a.leadership ? link("#/l10", "calendar", "L10 meeting", route.page === "l10", { tag: soon("0.7.0") }) : ""}
    ${link("#/vto", "strategy", "V/TO", route.page === "vto")}
    ${link("#/chart", "co-managed", "Accountability Chart", route.page === "chart")}
    ${canSeePlan(ME) ? link("#/plan", "clock", "FY plan", route.page === "plan") : ""}
    ${divs.length ? `<div class="side-label hd-eyebrow">${a.leadership ? "Divisions" : "Your division"}</div>
      ${divs.map(d => link(`#/division/${d.code}`, DIVISION_ICONS[d.code] || "co-managed", d.name, route.page === "division" && route.id === d.code)
        + (currentDivision === d.code ? d.seats.map(s => link(`#/seat/${s.id}`, "arrow-right", s.title, route.page === "seat" && Number(route.id) === s.id, { cls: "sub" })).join("") : "")).join("")}` : ""}
    ${mine.length ? `<div class="side-label hd-eyebrow">Apps</div>${mine.map(x => link(`#/app/${x.k}`, x.icon, x.name, route.page === "app" && route.id === x.k)).join("")}` : ""}
    <div class="side-label hd-eyebrow">Platform</div>
    ${link("#/people", "it-support", "People and departments", route.page === "people", { tag: soon("0.6.0") })}
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
  return { page: parts[0] || "home", id: parts[1], sub: parts[2], q };
}

const SOON = {
  l10: ["L10 meeting", "Run Tuesday's Level 10 meeting in Pulse: segue, Scorecard, Rock review, headlines, To-dos, IDS and conclude.", "0.7.0"],
  people: ["People and departments", "Everyone in Pulse matched to their Autotask resource. See who's in each Autotask department and change default departments.", "0.6.0"],
};

async function pageFor(r) {
  const needServer = !serverReady() && !CONFIG.PREVIEW;
  const serverNote = t => ({ title: t, html: `<div class="ph"><h1>${esc(t)}</h1></div><div class="note info">${icon("infrastructure")}<span>This needs Pulse's server, which isn't set up in this environment yet.</span></div>` });
  switch (r.page) {
    case "home": return homePage(ME, STRUCTURE);
    case "access": return { title: "Your access", html: V.access(ME) };
    case "audit": return { title: "Audit log", html: await V.audit(ME, r.q) };
    case "connections": return { title: "Connections", html: await V.connections(ME) };
    case "app": { const out = V.app(r.id); return out ? { title: (APPS.find(x => x.k === r.id) || {}).name, html: out.html, full: true } : null; }
    case "l10": case "people": { const [t, d, v] = SOON[r.page]; return { title: t, html: `<div class="ph"><span class="hd-eyebrow">Coming in ${v}</span><h1>${esc(t)}</h1><p>${esc(d)}</p></div><div class="note info">${icon("calendar")}<span>Arriving in Pulse ${v}. It switches on in the test environment first.</span></div>` }; }
  }
  if (needServer) return serverNote(r.page);
  switch (r.page) {
    case "scorecard": return scorecardPage(ME);
    case "rocks": return rocksPage(ME);
    case "issues": return issuesPage(ME);
    case "todos": return todosPage(ME);
    case "vto": return vtoPage(ME);
    case "plan": return planPage(ME);
    case "chart": return chartPage(ME, STRUCTURE);
    case "division": return divisionPage(ME, STRUCTURE, r.id, r.sub || "overview");
    case "seat": return seatPage(ME, STRUCTURE, r.id);
  }
  return null;
}

async function render() {
  const r = parseRoute();
  let page;
  try {
    page = await pageFor(r);
    if (!page) { location.hash = "#/"; return; }
  } catch (e) {
    page = { title: "Pulse", html: `<div class="note alert">${icon("vulnerability")}<span>${esc(e.message)}</span></div>` };
  }
  document.title = page.title && page.title !== "Home" ? `${page.title} · HD IT Pulse` : "HD IT Pulse";
  const isCompact = compact == null ? r.page === "app" : compact;
  $("#app").innerHTML = topbar() + `<div class="shell ${isCompact ? "compact" : ""}">${sidebar(r)}
    <main id="main" class="${page.full ? "full" : ""}" tabindex="-1">${page.full ? page.html : `<div class="wrap">${page.html}</div>`}</main></div>`;
  wire();
  if (page.mount) {
    try { page.mount($("#main"), refresh); } catch (e) { toast(e.message); }
  }
}

/** Re-reads the current page (after a change), keeping the scroll position. */
async function refresh() {
  const y = window.scrollY;
  if (parseRoute().page === "chart") STRUCTURE = await loadStructure();
  await render();
  window.scrollTo(0, y);
}

function closeMenus() { ["#help-menu", "#user-menu"].forEach(m => { const el = $(m); if (el) el.hidden = true; }); }

function wire() {
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
    Auth.setPreview(pv.value); ME = await loadMe(); STRUCTURE = await loadStructure(); await render();
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

async function loadStructure() {
  if (!serverReady() && !CONFIG.PREVIEW) return null;
  try { return await api("/structure"); } catch { return null; }
}

document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(); });
window.addEventListener("hashchange", () => { closeMenus(); render(); window.scrollTo(0, 0); });

(async function boot() {
  startTokenBridge();
  try {
    if (!(await Auth.init())) return renderSignIn();
    [ME, STRUCTURE] = await Promise.all([loadMe(), loadStructure()]);
    await render();
  } catch (e) {
    renderSignIn(e.message);
  }
})();
