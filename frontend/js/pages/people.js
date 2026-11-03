// People and departments (D10, D16): who's who across Entra and Autotask, Autotask default
// departments (and changing them), and the Needs review list for Platform Admins.
import { api } from "../api.js";
import { esc, icon, fmtDateTime, toast } from "../ui.js";
import { dialog, tabs, empty } from "../components.js";

const KIND = {
  no_match: "No Autotask match",
  multiple: "More than one Autotask match",
  conflict: "Two people match one Autotask account",
  unlinked_account: "Autotask account not linked to anyone",
};

export async function peoplePage(me, tab = "directory") {
  const a = me.access;
  if (!(a.leadership || a.manageDirectory)) {
    return { title: "People and departments", html: `<div class="ph"><span class="hd-eyebrow">Platform</span><h1>People and departments</h1></div>
      <div class="note info">${icon("compliance")}<span>The directory is for Leadership and Platform Admins.</span></div>` };
  }
  const nav = tabs([["directory", "Directory"], ["departments", "Autotask departments"], ...(a.manageDirectory ? [["review", "Needs review"]] : [])]
    .map(([k, l]) => ({ href: k === "directory" ? "#/people" : `#/people/${k}`, label: l, on: tab === k })));
  const head = sub => `<div class="ph"><span class="hd-eyebrow">Platform</span><h1>People and departments</h1><p>${sub}</p></div>${nav}`;
  const syncLine = ls => `<p class="dim small">Autotask last read ${ls && ls.departments ? esc(fmtDateTime(ls.departments)) : "not yet"} · Entra last read ${ls && ls.directory ? esc(fmtDateTime(ls.directory)) : "not yet"}.</p>`;

  if (tab === "departments") return departmentsTab(me, head);
  const data = await api("/people");
  if (tab === "review" && a.manageDirectory) return reviewTab(me, head, data, syncLine);

  /* ---------- directory ---------- */
  const linked = data.people.filter(p => p.autotask).length;
  return {
    title: "People and departments",
    html: head("Everyone in Pulse, matched to their Autotask resource by email. Platform Admins can fix any match.") + `
      <div class="filters"><label>Find a person<input id="ppl-q" placeholder="Name or email"></label>
        ${a.manageDirectory ? `<button class="btn outline sm" type="button" data-sync="directory">${icon("discover", "i-sm")}Refresh from Entra and Autotask</button>` : ""}</div>
      ${syncLine(data.lastSync)}
      <p><b>${data.people.length}</b> people · <b>${linked}</b> linked to Autotask${data.review.length ? ` · <a href="#/people/review">${data.review.length} to review</a>` : ""}</p>
      <div class="tbl-wrap"><table id="ppl"><thead><tr><th>Person</th><th>Autotask</th><th>Default department</th><th>Last in Pulse</th>${a.manageDirectory ? "<th></th>" : ""}</tr></thead><tbody>
        ${data.people.map(p => `<tr data-q="${esc((p.name + " " + (p.email || "")).toLowerCase())}">
          <td><b>${esc(p.name)}</b><div class="dim small">${esc(p.email || "")}${p.jobTitle ? ` · ${esc(p.jobTitle)}` : ""}</div></td>
          <td>${p.autotask ? `${esc(p.autotask.name)}<div class="dim small">#${p.autotask.resourceId} · ${p.autotask.linkedBy === "email" ? `matched on ${esc(p.autotask.matchedEmail || "email")}` : `set by ${esc(p.autotask.linkedBy)}`}</div>`
            : p.noAutotask ? `<span class="chip quiet">No Autotask account</span>` : `<span class="chip scheduled">Not linked</span>`}</td>
          <td>${p.autotask && p.autotask.department ? `${esc(p.autotask.department)}${/^service desk$/i.test(p.autotask.department) ? ` <span class="chip progress">Tech</span>` : ""}` : `<span class="dim">—</span>`}</td>
          <td>${p.lastSignIn ? esc(fmtDateTime(p.lastSignIn)) : `<span class="dim">Never</span>`}</td>
          ${a.manageDirectory ? `<td class="nowrap"><button class="link-btn small" type="button" data-link="${p.id}">Change link</button></td>` : ""}
        </tr>`).join("") || `<tr><td colspan="5" class="dim">Nobody yet. The directory fills in from Entra each night, or select Refresh.</td></tr>`}
      </tbody></table></div>`,
    mount: (root, refresh) => {
      const q = root.querySelector("#ppl-q");
      if (q) q.oninput = () => root.querySelectorAll("#ppl tbody tr[data-q]").forEach(tr => { tr.hidden = !tr.dataset.q.includes(q.value.trim().toLowerCase()); });
      wireSync(root);
      root.querySelectorAll("[data-link]").forEach(b => { b.onclick = () => linkDialog(data.people.find(p => p.id === Number(b.dataset.link)), refresh); });
    },
  };
}

function wireSync(root) {
  root.querySelectorAll("[data-sync]").forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      try { const r = await api("/people/sync", { method: "POST", body: { job: b.dataset.sync } }); toast(r.detail || "Done"); }
      catch (e) { toast(e.message); }
      b.disabled = false;
      if (b.dataset.sync === "departments") setTimeout(() => location.reload(), 600);
    };
  });
}

/* ---------- link dialog (Platform Admins) ---------- */
async function linkDialog(person, refresh, suggestedIds = []) {
  const d = await api("/people/departments");
  const all = [...d.departments.flatMap(x => x.people), ...d.noDepartment];
  const opts = all.sort((x, y) => x.name.localeCompare(y.name)).map(r => ({ v: r.resourceId,
    t: `${r.name} · ${r.email || "no email"}${r.inPulse && (!person.autotask || r.resourceId !== person.autotask.resourceId) ? ` (linked to ${r.inPulse})` : ""}${suggestedIds.includes(r.resourceId) ? " · suggested" : ""}` }));
  dialog({
    title: `Autotask account for ${person.name || "this person"}`,
    intro: "Normally Pulse matches people by email. Set it by hand when the emails differ, or when someone has no Autotask account.",
    fields: [
      { name: "mode", label: "Link", type: "select", value: "resource", options: [
        { v: "resource", t: "Link to this Autotask resource" }, { v: "none", t: "This person has no Autotask account" }, { v: "automatic", t: "Match automatically by email" }] },
      { name: "resourceId", label: "Autotask resource", type: "select", value: (person.autotask && person.autotask.resourceId) || suggestedIds[0] || "", options: [{ v: "", t: "Choose…" }, ...opts] },
      { name: "reason", label: "Reason", type: "textarea", rows: 2, required: true, hint: "Kept in the audit log." },
    ],
    onSubmit: async f => {
      const body = f.mode === "none" ? { none: true } : f.mode === "automatic" ? { automatic: true } : { resourceId: Number(f.resourceId) };
      if (f.mode === "resource" && !f.resourceId) throw new Error("Choose an Autotask resource.");
      await api(`/people/${person.id}/link`, { method: "POST", body: { ...body, reason: f.reason } });
      toast("Link saved"); refresh();
    },
  });
}

/* ---------- departments ---------- */
async function departmentsTab(me, head) {
  const d = await api("/people/departments");
  const can = me.access.changeDepartments;
  const card = (dept) => `<section class="panel dept" data-dept="${dept.id}">
    <div class="sec-h"><h2>${esc(dept.name)}</h2><span class="aside">${dept.people.length} ${dept.people.length === 1 ? "person" : "people"}</span></div>
    ${dept.isServiceDesk || !dept.active ? `<p class="dept-tags">${dept.isServiceDesk ? `<span class="chip progress">Techs for the Scorecard</span>` : ""}${dept.active ? "" : `<span class="chip quiet">Inactive</span>`}</p>` : ""}
    ${dept.people.length ? `<ul class="plain people-list">${dept.people.map(p => `<li>${can ? `<label class="check"><input type="checkbox" data-res="${p.resourceId}"> ` : ""}<span><b>${esc(p.name)}</b> <span class="dim small">${esc([p.role, p.title, p.inPulse ? "" : "not in Pulse"].filter(Boolean).join(" · "))}</span></span>${can ? "</label>" : ""}</li>`).join("")}</ul>`
      : `<p class="dim">Nobody has this as their default department.</p>`}
  </section>`;
  return {
    title: "People and departments",
    html: head("Each person's default department in Autotask. A tech is anyone whose default department is Service Desk (D16): they're who the Scorecard counts for tickets per tech and utilisation.") + `
      <div class="filters">
        ${can ? `<button class="btn" type="button" id="dept-change" disabled>${icon("co-managed", "i-sm")}Change default department</button>` : ""}
        <button class="btn outline sm" type="button" data-sync="departments">${icon("discover", "i-sm")}Refresh from Autotask</button>
      </div>
      <p class="dim small">Autotask last read ${d.lastSync && d.lastSync.departments ? esc(fmtDateTime(d.lastSync.departments)) : "not yet"}. ${can ? "Tick people, then change their default department. Pulse updates Autotask straight away." : ""}</p>
      ${!d.departments.length ? `<div class="note info">${icon("infrastructure")}<span>No departments yet. Enter the <b>Autotask: People administration</b> credential under Connections, then select Refresh from Autotask.</span></div>` : ""}
      <div class="dept-grid">${d.departments.filter(x => x.active || x.people.length).map(card).join("")}</div>
      ${d.noDepartment.length ? `<section class="panel"><h2>No default department</h2><ul class="plain">${d.noDepartment.map(p => `<li>${can ? `<label class="check"><input type="checkbox" data-res="${p.resourceId}"> ` : ""}<b>${esc(p.name)}</b>${can ? "</label>" : ""}</li>`).join("")}</ul></section>` : ""}`,
    mount: (root, refresh) => {
      wireSync(root);
      const btn = root.querySelector("#dept-change");
      if (!btn) return;
      const picked = () => [...root.querySelectorAll("[data-res]:checked")].map(c => Number(c.dataset.res));
      root.querySelectorAll("[data-res]").forEach(c => { c.onchange = () => { const n = picked().length; btn.disabled = !n; btn.lastChild.textContent = n ? `Change default department (${n})` : "Change default department"; }; });
      btn.onclick = () => {
        const ids = picked();
        const names = [...d.departments.flatMap(x => x.people), ...d.noDepartment].filter(p => ids.includes(p.resourceId)).map(p => p.name);
        dialog({
          title: `Change default department for ${ids.length === 1 ? names[0] : `${ids.length} people`}`,
          intro: `${ids.length > 1 ? esc(names.join(", ")) + ". " : ""}Pulse sets this in Autotask now. If someone isn't in the new department yet, Pulse adds them with their current role unless you choose one.`,
          fields: [
            { name: "departmentId", label: "New default department", type: "select", required: true, options: [{ v: "", t: "Choose…" }, ...d.departments.filter(x => x.active).map(x => ({ v: x.id, t: x.name }))] },
            { name: "roleId", label: "Role in the new department", type: "select", options: [{ v: "", t: "Keep their current role" }, ...d.roles.map(r => ({ v: r.id, t: r.name }))] },
            { name: "reason", label: "Reason", type: "textarea", rows: 2, required: true, hint: "Kept in the audit log." },
          ],
          submit: "Change in Autotask",
          onSubmit: async f => {
            if (!f.departmentId) throw new Error("Choose a department.");
            const r = await api("/people/departments/change", { method: "POST", body: { resourceIds: ids, departmentId: Number(f.departmentId), roleId: f.roleId ? Number(f.roleId) : null, reason: f.reason } });
            if (r.failed) throw new Error(`${r.changed} changed, ${r.failed} not: ${r.results.filter(x => !x.ok).map(x => x.error).join(" ")}`);
            toast(`${r.changed} moved to ${r.department}`); refresh();
          },
        });
      };
    },
  };
}

/* ---------- needs review (Platform Admins) ---------- */
function reviewTab(me, head, data, syncLine) {
  const groups = Object.keys(KIND).map(k => [k, data.review.filter(r => r.kind === k)]).filter(([, l]) => l.length);
  return {
    title: "People and departments",
    html: head("Matches Pulse couldn't make on its own. Link each person to their Autotask resource, or mark that they don't have one.") + syncLine(data.lastSync) + `
      ${groups.length ? groups.map(([k, list]) => `<section class="sec review-sec"><div class="sec-h"><div><h2>${esc(KIND[k])}</h2></div><span class="aside">${list.length}</span></div>
        <div class="tbl-wrap"><table><tbody>${list.map(r => `<tr><td>${r.personName ? `<b>${esc(r.personName)}</b><div class="dim small">${esc(r.detail || "")}</div>` : esc(r.detail || "")}</td>
          <td style="text-align:right">${r.personId ? `<button class="btn outline sm" type="button" data-fix="${r.personId}" data-sugg="${r.resourceIds.join(",")}">Fix</button>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`).join("")
        : empty("Nothing to review. Everyone is matched.")}
      <p class="dim small">"Autotask account not linked to anyone" is for information: it often means an API user, a leaver whose Autotask account is still active, or (in the test environment) that test accounts use different emails.</p>`,
    mount: (root, refresh) => root.querySelectorAll("[data-fix]").forEach(b => {
      const p = data.people.find(x => x.id === Number(b.dataset.fix)) || { id: Number(b.dataset.fix), name: "" };
      b.onclick = () => linkDialog(p, refresh, b.dataset.sugg ? b.dataset.sugg.split(",").map(Number) : []);
    }),
  };
}
