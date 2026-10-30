// The three apps inside Pulse (D9), and the token hand-off they use to sign in.
import { CONFIG } from "./config.js";
import * as Auth from "./auth.js";

export const APPS = [
  { k: "pipeline", name: "Pipeline", prefix: "Pipeline", icon: "trend-up",
    desc: "Your Autotask opportunities as a board. Move deals between stages, update close dates and probability, and log notes." },
  { k: "mroi", name: "Marketing ROI", prefix: "MarketingROI", icon: "savings",
    desc: "Leads from each marketing event through MQL, SQL and won, with spend against return for every event." },
  { k: "wspace", name: "Whitespace Matrix", prefix: "Whitespace", icon: "business-intelligence",
    desc: "Which clients have which services, what's been quoted, and the gaps worth a conversation. Includes contracts." },
].map(a => ({ ...a, url: CONFIG.APP_URLS[a.k] || "" }));

const has = v => Auth.currentRoles().includes(v);
export const canOpen = a => has("Pulse.Admin") || Auth.currentRoles().some(r => r.startsWith(a.prefix + "."));
export const appRole = a => (has("Pulse.Admin") || has(a.prefix + ".Admin") ? "Administrator" : has(a.prefix + ".Editor") ? "Editor" : a.k === "wspace" ? "Viewer" : "User");

/** Answers token requests from the app iframe Pulse created, at its exact address only. */
export function startTokenBridge() {
  window.addEventListener("message", async e => {
    const m = e.data;
    if (!m || m.type !== "pulse:token-request") return;
    const frame = [...document.querySelectorAll("iframe[data-app]")].find(f => f.contentWindow === e.source);
    if (!frame) return;
    const a = APPS.find(x => x.k === frame.dataset.app);
    if (!a || !a.url || e.origin !== new URL(a.url).origin) return;
    let reply;
    try {
      if (!canOpen(a)) throw new Error(`You don't have access to ${a.name}.`);
      reply = { type: "pulse:token", id: m.id, token: await Auth.token(!!m.force) };
    } catch (err) { reply = { type: "pulse:token", id: m.id, error: err.message }; }
    e.source.postMessage(reply, e.origin);
  });
}
