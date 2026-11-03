// Calls to the Pulse API (func-hdit-pulse-api) with the person's Entra token in the header.
// Preview: answers from simulated data. No API address (backend not set up yet): /me is
// worked out in the browser from the token, and other calls report that the server isn't ready.
import { CONFIG } from "./config.js";
import * as Auth from "./auth.js";
import { accessFor, DIVISIONS } from "./access.js";
import { previewApi } from "./preview.js";

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

export const serverReady = () => !!CONFIG.API_BASE && !CONFIG.PREVIEW;

export async function api(path, { method = "GET", body } = {}) {
  if (CONFIG.PREVIEW) return previewAnswer(path, method, body);
  if (!CONFIG.API_BASE) throw new ApiError(503, "Pulse's server isn't set up in this environment yet.", "no-server");
  const send = async force => fetch(CONFIG.API_BASE + path, {
    method,
    headers: { authorization: `Bearer ${await Auth.token(force)}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let res;
  try {
    res = await send(false);
    if (res.status === 401) res = await send(true);   // token may have just expired
  } catch (e) {
    throw new ApiError(0, "Couldn't reach Pulse's server. Check your connection and try again.", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Pulse's server answered ${res.status}.`, data.code);
  return data;
}

/* ---------------- week maths for the browser (same rules as the server) ---------------- */
function sydneyParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) };
}
const iso = t => t.toISOString().slice(0, 10);
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return iso(new Date(Date.UTC(y, m - 1, d + n))); };
function weekOf(now) { const p = sydneyParts(now); return addDays(iso(new Date(Date.UTC(p.y, p.m - 1, p.d))), -p.wd); }
function sydneyToUtc(day, hour) {
  const [y, m, d] = day.split("-").map(Number);
  let g = Date.UTC(y, m - 1, d, hour);
  for (let i = 0; i < 2; i++) { const p = sydneyParts(new Date(g)); g += Date.UTC(y, m - 1, d, hour) - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min); }
  return new Date(g);
}
export function weekInfo(week, now = new Date()) {
  const lock = sydneyToUtc(addDays(week, 8), 17);
  return { week, start: week, end: addDays(week, 6), lockAt: lock.toISOString(), locked: now >= lock, current: weekOf(now) === week };
}
const localMe = () => {
  const u = Auth.currentUser(), roles = Auth.currentRoles(), now = new Date(), w = weekOf(now);
  return {
    person: { id: null, oid: u.oid, name: u.name, email: u.email, firstSignIn: false },
    roles, access: accessFor(roles), divisions: DIVISIONS,
    week: weekInfo(w, now), reviewWeek: weekInfo(addDays(w, -7), now),
    environment: CONFIG.ENVIRONMENT, version: CONFIG.APP_VERSION, database: CONFIG.PREVIEW ? "preview" : "no-server",
  };
};

/** The signed-in person and what they can do. Falls back to the token when there's no server yet. */
export async function me() {
  if (CONFIG.PREVIEW || !CONFIG.API_BASE) return localMe();
  return api("/me");
}

/* ---------------- preview answers (simulated, clearly labelled in the UI) ---------------- */
function previewAnswer(path, method, body) {
  try {
    const out = previewApi(path, method, body);
    if (out) return structuredClone(out);
  } catch (e) { throw new ApiError(e.status || 400, e.message); }
  if (path.startsWith("/audit")) {
    const u = Auth.currentUser(), t = Date.now();
    return { events: [
      { id: 3, at: new Date(t - 60e3).toISOString(), actor: { name: u.name }, action: "view.audit-log", entity: null, reason: null },
      { id: 2, at: new Date(t - 3600e3).toISOString(), actor: { name: u.name }, action: "session.start", entity: { type: "person", id: u.oid }, reason: null },
      { id: 1, at: new Date(t - 86400e3).toISOString(), actor: { name: "Sam Leader" }, action: "session.start", entity: { type: "person", id: "preview-leadership" }, reason: null },
    ] };
  }
  if (path.startsWith("/connections")) {
    return { connections: [
      ["autotask-service", "Autotask API user: Service", true], ["autotask-people", "Autotask API user: People administration", false],
      ["autotask-finance", "Autotask API user: Finance, read-only", false], ["simplesat", "SimpleSAT API key, read-only", false],
      ["xero-app", "Xero app (standard OAuth), read-only scopes", false], ["xero-token", "Xero refresh token", false],
      ["datto-rmm", "Datto RMM API, read-only", false], ["itglue", "IT Glue API, read-only", false],
    ].map(([name, description, configured]) => ({ name, description, configured, secretUpdatedAt: configured ? new Date(Date.now() - 5 * 86400e3).toISOString() : null, lastCheckedAt: new Date().toISOString(), lastError: null })) };
  }
  if (path.startsWith("/audit/view")) return { ok: true };
  return {};
}
