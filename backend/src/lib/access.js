"use strict";
/**
 * Who can do what in Pulse (D3, override rule, D16). Decided only from the app roles in
 * the person's Entra token, which come from their "Pulse - …" groups.
 *
 *   Pulse.Admin            Platform Admin: everything.
 *   Pulse.Leadership       every division; override any measurable; change Autotask departments.
 *   Division.<Name>        that division in full; override that division's measurables.
 *   Pulse.FinanceDetail    full P&L detail, wages, per-client profitability.
 *   Pulse.Compliance       audit log and access review.
 *   Pulse.ProjectManager   Projects: reschedule tasks, log time on any task, resource planning (D21).
 *   (Client health, 0.10.0: Leadership, Sales & Marketing and Managed Services; MRR on it for Leadership and Sales & Marketing.)
 *   Pulse.User             sign in; company-wide items (V/TO, company Rocks, company Scorecard).
 *
 * The backend calls these on every request. The UI uses the same answers (from /api/me)
 * only to hide what someone can't use.
 */
const DIVISIONS = Object.freeze([
  { code: "Leadership", name: "Leadership" },
  { code: "Finance", name: "Finance & Accounts" },
  { code: "People", name: "People (HR)" },
  { code: "SalesMarketing", name: "Sales & Marketing" },
  { code: "InnovationCompliance", name: "Innovation & Compliance" },
  { code: "ManagedServices", name: "Managed Services" },
]);
const DIVISION_CODES = DIVISIONS.map(d => d.code);

/** Every role Pulse itself understands (the apps' own roles are passed through). */
const PULSE_ROLES = ["Pulse.Admin", "Pulse.User", "Pulse.Leadership", "Pulse.FinanceDetail", "Pulse.Compliance", "Pulse.ProjectManager",
  ...DIVISION_CODES.filter(c => c !== "Leadership").map(c => `Division.${c}`)];

function accessFor(roleList) {
  const roles = new Set((Array.isArray(roleList) ? roleList : []).map(String));
  const platform = roles.has("Pulse.Admin");
  const leadership = platform || roles.has("Pulse.Leadership");
  const ownDivisions = DIVISION_CODES.filter(c => roles.has(`Division.${c}`));
  const divisions = leadership ? DIVISION_CODES.slice() : ownDivisions;
  const signIn = platform || leadership || ownDivisions.length > 0 ||
    ["Pulse.User", "Pulse.FinanceDetail", "Pulse.Compliance", "Pulse.ProjectManager"].some(r => roles.has(r));
  const projectManager = leadership || roles.has("Pulse.ProjectManager");
  const viewProjects = projectManager || ownDivisions.includes("ManagedServices");

  return Object.freeze({
    roles: [...roles],
    signIn,
    platform,
    leadership,
    divisions,
    ownDivisions,
    financeDetail: platform || roles.has("Pulse.FinanceDetail"),
    compliance: platform || roles.has("Pulse.Compliance"),
    peopleData: platform || roles.has("Division.People"),
    viewAudit: platform || roles.has("Pulse.Compliance"),
    changeDepartments: platform || leadership,
    manageConnections: platform,
    manageDirectory: platform,
    // Projects (D21): Managed Services sees every project; Project Managers and Leadership also reschedule.
    viewProjects,
    editSchedules: projectManager,
    viewLeadTime: viewProjects || ownDivisions.includes("SalesMarketing"),
    // Client health and the Early Warning (0.10.0, D23): Account Managers (Sales & Marketing), Managed Services and Leadership.
    viewClients: leadership || ownDivisions.includes("SalesMarketing") || ownDivisions.includes("ManagedServices"),
    // Each client's MRR on that page: Leadership, Sales & Marketing and Finance detail.
    clientMrr: leadership || ownDivisions.includes("SalesMarketing"),
  });
}

/** Can see a division's own pages in full. Company-wide items are open to everyone signed in. */
const canSeeDivision = (a, division) => a.divisions.includes(division);

/**
 * Override rule (confirmed 31 Oct 2026): leadership can override any measurable;
 * everyone else only measurables owned by their own division.
 */
function canOverride(a, measurable) {
  if (!a || !a.signIn || !measurable) return false;
  if (a.leadership) return true;
  return !!measurable.division && a.ownDivisions.includes(measurable.division);
}

/** Edit a measurable's definition, goal or owner: leadership, or the measurable's owner. */
function canEditMeasurable(a, measurable, personOid) {
  if (!a || !a.signIn || !measurable) return false;
  return a.leadership || (!!personOid && measurable.ownerOid === personOid);
}

/** The shape /api/me returns to the browser. */
function describe(a) {
  return {
    platform: a.platform, leadership: a.leadership, divisions: a.divisions, ownDivisions: a.ownDivisions,
    financeDetail: a.financeDetail, compliance: a.compliance, viewAudit: a.viewAudit,
    changeDepartments: a.changeDepartments, manageConnections: a.manageConnections, manageDirectory: a.manageDirectory,
    viewProjects: a.viewProjects, editSchedules: a.editSchedules, viewLeadTime: a.viewLeadTime,
  };
}

module.exports = { DIVISIONS, DIVISION_CODES, PULSE_ROLES, accessFor, canSeeDivision, canOverride, canEditMeasurable, describe };
