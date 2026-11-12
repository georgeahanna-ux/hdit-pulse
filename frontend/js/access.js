// Mirror of backend/src/lib/access.js for the browser. The server decides; the page only
// uses this to hide what someone can't use, and when no server is set up yet.
export const DIVISIONS = [
  { code: "Leadership", name: "Leadership" },
  { code: "Finance", name: "Finance & Accounts" },
  { code: "People", name: "People (HR)" },
  { code: "SalesMarketing", name: "Sales & Marketing" },
  { code: "InnovationCompliance", name: "Innovation & Compliance" },
  { code: "ManagedServices", name: "Managed Services" },
];
const CODES = DIVISIONS.map(d => d.code);

export function accessFor(roleList) {
  const roles = new Set(roleList || []);
  const platform = roles.has("Pulse.Admin");
  const leadership = platform || roles.has("Pulse.Leadership");
  const ownDivisions = CODES.filter(c => roles.has(`Division.${c}`));
  return {
    platform, leadership, ownDivisions,
    divisions: leadership ? CODES.slice() : ownDivisions,
    financeDetail: platform || roles.has("Pulse.FinanceDetail"),
    compliance: platform || roles.has("Pulse.Compliance"),
    viewAudit: platform || roles.has("Pulse.Compliance"),
    changeDepartments: platform || leadership,
    manageConnections: platform,
    manageDirectory: platform,
    viewProjects: leadership || roles.has("Pulse.ProjectManager") || ownDivisions.includes("ManagedServices"),
    editSchedules: leadership || roles.has("Pulse.ProjectManager"),
    viewLeadTime: leadership || roles.has("Pulse.ProjectManager") || ownDivisions.includes("ManagedServices") || ownDivisions.includes("SalesMarketing"),
    viewClients: leadership || ownDivisions.includes("SalesMarketing") || ownDivisions.includes("ManagedServices"),
    clientMrr: leadership || ownDivisions.includes("SalesMarketing"),
  };
}

/** Every role, its group and what it gives (the "Your access" page). */
export const ROLES = [
  { v: "Pulse.Admin", label: "Platform Admin", group: "Pulse - Platform Admins", grants: "Everything in Pulse and every app, as an administrator" },
  { v: "Pulse.User", label: "Pulse user", group: "Pulse - All Staff", grants: "Sign in; company-wide V/TO, Rocks and Scorecard" },
  { v: "Pulse.Leadership", label: "Leadership", group: "Pulse - Leadership", grants: "Every division; override any measurable; change Autotask departments" },
  { v: "Pulse.FinanceDetail", label: "Finance detail", group: "Pulse - Finance Detail", grants: "Full P&L, wages and per-client profitability" },
  { v: "Pulse.Compliance", label: "Compliance", group: "Pulse - Compliance", grants: "Audit log and the quarterly access review" },
  { v: "Pulse.ProjectManager", label: "Project Manager", group: "Pulse - Project Managers", grants: "Projects: reschedule tasks, log time on any task, resource planning" },
  { v: "Division.Finance", label: "Finance & Accounts", group: "Pulse - Division Finance", grants: "That division in full; override its measurables" },
  { v: "Division.People", label: "People (HR)", group: "Pulse - Division People", grants: "That division in full; override its measurables" },
  { v: "Division.SalesMarketing", label: "Sales & Marketing", group: "Pulse - Division Sales and Marketing", grants: "That division in full; override its measurables; Client health with MRR" },
  { v: "Division.InnovationCompliance", label: "Innovation & Compliance", group: "Pulse - Division Innovation and Compliance", grants: "That division in full; override its measurables" },
  { v: "Division.ManagedServices", label: "Managed Services", group: "Pulse - Division Managed Services", grants: "That division in full; override its measurables; Projects; Client health (without MRR)" },
  { v: "Pipeline.User", label: "Pipeline user", group: "Pulse - Pipeline Users", grants: "Pipeline: view and update opportunities" },
  { v: "Pipeline.Admin", label: "Pipeline administrator", group: "Pulse - Pipeline Admins", grants: "Pipeline: everything, plus Settings" },
  { v: "MarketingROI.User", label: "Marketing ROI user", group: "Pulse - Marketing ROI Users", grants: "Marketing ROI: view the funnel, move leads, log contacts" },
  { v: "MarketingROI.Admin", label: "Marketing ROI administrator", group: "Pulse - Marketing ROI Admins", grants: "Marketing ROI: everything, plus events, costs and Settings" },
  { v: "Whitespace.User", label: "Whitespace viewer", group: "Pulse - Whitespace Users", grants: "Whitespace Matrix: view only" },
  { v: "Whitespace.Editor", label: "Whitespace editor", group: "Pulse - Whitespace Editors", grants: "Whitespace Matrix: edit cells, contracts and hidden items" },
  { v: "Whitespace.Admin", label: "Whitespace administrator", group: "Pulse - Whitespace Admins", grants: "Whitespace Matrix: everything, plus the service catalogue and Settings" },
];
export const roleInfo = v => ROLES.find(r => r.v === v) || { v, label: v, group: "—", grants: "" };
