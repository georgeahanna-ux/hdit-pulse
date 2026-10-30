// Sign-in with Microsoft Entra ID (MSAL for the browser, authorization code + PKCE).
// No third-party cookies: tokens go in request headers, and embedded apps get theirs over postMessage.
// With no client id filled in, Pulse runs as a preview with simulated people (no real data).
import { CONFIG, DEPLOY } from "./config.js";

export const PREVIEW_PERSONAS = [
  { k: "admin", label: "Platform Admin", name: "George Hanna", email: "george.hanna@hdit.com.au", roles: ["Pulse.Admin"] },
  { k: "leadership", label: "Leadership team member", name: "Sam Leader", email: "sam.leader@hdit.com.au", roles: ["Pulse.User", "Pulse.Leadership", "Pipeline.User", "MarketingROI.User", "Whitespace.User"] },
  { k: "service", label: "Managed Services staff", name: "Riley Tech", email: "riley.tech@hdit.com.au", roles: ["Pulse.User", "Division.ManagedServices"] },
  { k: "finance", label: "Finance, with finance detail", name: "Jordan Ledger", email: "jordan.ledger@hdit.com.au", roles: ["Pulse.User", "Division.Finance", "Pulse.FinanceDetail"] },
  { k: "sales", label: "Sales: Pipeline and Whitespace", name: "Taylor Reid", email: "taylor.reid@hdit.com.au", roles: ["Pulse.User", "Division.SalesMarketing", "Pipeline.User", "Whitespace.Editor", "MarketingROI.User"] },
  { k: "staff", label: "New starter: no division yet", name: "Morgan Ellis", email: "morgan.ellis@hdit.com.au", roles: ["Pulse.User"] },
];

let pca = null, account = null, user = null, roles = [];

const decode = t => {
  try { return JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); }
  catch { return {}; }
};
function fromToken(t) {
  const c = decode(t);
  roles = Array.isArray(c.roles) ? c.roles : [];
  user = { name: c.name || (account && account.name) || "", email: String(c.preferred_username || (account && account.username) || "").toLowerCase(), oid: c.oid || "" };
}
function preview() {
  let k = "admin";
  try { k = localStorage.getItem("hdit-pulse:preview") || "admin"; } catch { /* storage blocked */ }
  const p = PREVIEW_PERSONAS.find(x => x.k === k) || PREVIEW_PERSONAS[0];
  user = { name: p.name, email: p.email, oid: "preview-" + p.k }; roles = p.roles.slice();
}

function friendly(e) {
  const m = String((e && (e.errorMessage || e.message)) || e);
  if (/AADSTS50105/.test(m)) return new Error("Your Microsoft 365 account isn't set up for Pulse yet. Ask a Platform Admin to add you to a Pulse group, then sign in again.");
  if (/AADSTS53000|AADSTS53003/.test(m)) return new Error("Pulse needs an HD IT managed device. Sign in from your work laptop, or ask the service desk to check your device is compliant.");
  if (/AADSTS65001|consent/i.test(m)) return new Error("An administrator needs to approve Pulse for your organisation first.");
  if (/user_cancelled|AADSTS50058/.test(m)) return new Error("Sign-in was cancelled.");
  return new Error("Sign-in didn't complete: " + m.split("\n")[0].slice(0, 220));
}

/** Returns true when someone is signed in. Throws a friendly error for sign-in failures. */
export async function init() {
  if (CONFIG.PREVIEW) { preview(); return true; }
  if (!window.msal) throw new Error("The sign-in library didn't load. Reload the page.");
  pca = await window.msal.PublicClientApplication.createPublicClientApplication({
    auth: {
      clientId: DEPLOY.clientId, authority: `https://login.microsoftonline.com/${DEPLOY.tenantId}`,
      redirectUri: location.origin + "/", postLogoutRedirectUri: location.origin + "/", navigateToLoginRequestUrl: true,
    },
    cache: { cacheLocation: "localStorage" },
  });
  let r = null;
  try { r = await pca.handleRedirectPromise(); } catch (e) { throw friendly(e); }
  account = (r && r.account) || pca.getActiveAccount() || pca.getAllAccounts()[0] || null;
  if (!account) return false;
  pca.setActiveAccount(account);
  if (r && r.accessToken && (r.scopes || []).some(s => s.endsWith("access_as_user"))) fromToken(r.accessToken);
  else await token();
  return true;
}

/** An access token for Pulse's API scope. Signs in again (redirect) when Microsoft asks for it. */
export async function token(force = false) {
  if (CONFIG.PREVIEW) throw new Error("Preview: there's no real sign-in here.");
  try {
    const r = await pca.acquireTokenSilent({ scopes: [CONFIG.API_SCOPE], account, forceRefresh: !!force });
    fromToken(r.accessToken);
    return r.accessToken;
  } catch (e) {
    if (e instanceof window.msal.InteractionRequiredAuthError || /interaction_required|login_required|consent_required|no_tokens_found/i.test(e.errorCode || "")) {
      await pca.acquireTokenRedirect({ scopes: [CONFIG.API_SCOPE], account });
      return new Promise(() => {});   // the page is navigating away
    }
    throw friendly(e);
  }
}

export const signIn = () => pca.loginRedirect({ scopes: [CONFIG.API_SCOPE], prompt: "select_account" });
export const signOut = () => (CONFIG.PREVIEW ? location.reload() : pca.logoutRedirect({ account }));
export const currentUser = () => user;
export const currentRoles = () => roles;
export function setPreview(k) {
  try { localStorage.setItem("hdit-pulse:preview", k); } catch { /* ignore */ }
  preview();
}
