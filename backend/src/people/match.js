"use strict";
/**
 * People directory matching rules (D10). Pure functions, no database.
 *
 *   - Everyone in Entra who is a person (a licensed member account) gets a Pulse person record.
 *   - Their addresses are every address Entra knows: sign-in name, mail, other mails and proxy
 *     addresses, because some Autotask resources use a short alias (e.g. first-name@).
 *   - They're linked to an active Autotask resource when exactly one resource has one of those
 *     addresses (email, email2 or email3), case-insensitive, and no one else matches it.
 *   - A Platform Admin's link always wins, and so does "has no Autotask account".
 *   - Anything else goes on the Needs review list.
 */

const clean = e => String(e || "").trim().toLowerCase().replace(/^smtp:/, "");
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Every address for an Entra user, lower case, no duplicates. */
function userEmails(u) {
  const list = [u.userPrincipalName, u.mail, ...(u.otherMails || []),
    ...(u.proxyAddresses || []).filter(p => /^smtp:/i.test(p))];
  return [...new Set(list.map(clean).filter(isEmail))].filter(e => !e.endsWith(".onmicrosoft.com") || list.length === 1 || e === clean(u.userPrincipalName));
}

/** A real person: a member (not a guest), enabled, with at least one licence. Rooms and shared mailboxes have none. */
const isPerson = u => u.userType !== "Guest" && u.accountEnabled !== false && Array.isArray(u.assignedLicenses) && u.assignedLicenses.length > 0;

const resourceEmails = r => [...new Set([r.email, r.email2, r.email3].map(clean).filter(isEmail))];
const looksLikePerson = r => !!(r.first_name || r.firstName) && !!(r.last_name || r.lastName);

/**
 * @param persons   [{ id, name, emails[] }] active people
 * @param resources [{ id, name, emails[], active, person: bool }]
 * @param adminLinks Map(personId → resourceId) set by a Platform Admin
 * @param noneSet   Set(personId) marked "has no Autotask account"
 * @returns { links: [{ personId, resourceId, email }], review: [{ kind, personId, externalIds, detail }] }
 */
function match({ persons, resources, adminLinks = new Map(), noneSet = new Set() }) {
  const active = resources.filter(r => r.active);
  const reserved = new Set([...adminLinks.values()].map(Number));
  const byEmail = new Map();
  for (const r of active) {
    if (reserved.has(Number(r.id))) continue;
    for (const e of r.emails) { if (!byEmail.has(e)) byEmail.set(e, new Set()); byEmail.get(e).add(Number(r.id)); }
  }

  const review = [];
  const proposals = new Map();   // personId → { resourceId, email }
  for (const p of persons) {
    if (adminLinks.has(p.id) || noneSet.has(p.id)) continue;
    const cands = new Map();
    for (const e of p.emails) for (const rid of byEmail.get(e) || []) if (!cands.has(rid)) cands.set(rid, e);
    if (cands.size === 1) { const [[rid, email]] = [...cands]; proposals.set(p.id, { resourceId: rid, email }); }
    else if (cands.size === 0) review.push({ kind: "no_match", personId: p.id, externalIds: [], detail: `No active Autotask resource has ${p.emails.length > 1 ? "any of " : ""}${p.emails.join(", ") || "an email"}.` });
    else review.push({ kind: "multiple", personId: p.id, externalIds: [...cands.keys()], detail: `${cands.size} active Autotask resources share this person's email.` });
  }

  // Two people pointing at the same resource: neither is linked automatically.
  const claim = new Map();
  for (const [pid, pr] of proposals) { if (!claim.has(pr.resourceId)) claim.set(pr.resourceId, []); claim.get(pr.resourceId).push(pid); }
  const links = [];
  for (const [rid, pids] of claim) {
    if (pids.length === 1) links.push({ personId: pids[0], resourceId: rid, email: proposals.get(pids[0]).email });
    else for (const pid of pids) review.push({ kind: "conflict", personId: pid, externalIds: [rid], detail: `${pids.length} people match the same Autotask resource.` });
  }

  // Active Autotask people that nobody is linked to (new starters, leavers still active, or test-tenancy differences).
  const linked = new Set([...links.map(l => Number(l.resourceId)), ...reserved]);
  for (const r of active) {
    if (!linked.has(Number(r.id)) && r.person !== false && r.emails.length) {
      review.push({ kind: "unlinked_account", personId: null, externalIds: [Number(r.id)], detail: `${r.name || "Autotask resource " + r.id} (${r.emails[0]}) isn't linked to anyone in Pulse.` });
    }
  }
  return { links, review };
}

module.exports = { userEmails, isPerson, resourceEmails, looksLikePerson, match, clean };
