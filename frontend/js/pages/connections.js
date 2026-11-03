// Connections (D7): Platform Admins enter, replace and remove the credentials Pulse uses.
// Write-only: Pulse saves a credential to Key Vault and can never show it again.
import { api } from "../api.js";
import { esc, icon, fmtDate, fmtDateTime, toast } from "../ui.js";
import { dialog } from "../components.js";

export async function connectionsPage(me) {
  if (!me.access.manageConnections) {
    return { title: "Connections", html: `<div class="denied"><span class="ic">${icon("compliance", "i-lg")}</span><h2>Connections are for Platform Admins</h2><p>Ask George or Bernadette if a connection needs changing.</p><a href="#/">Back to Home</a></div>` };
  }
  api("/audit/view", { method: "POST", body: { page: "connections" } }).catch(() => {});
  const { connections: list } = await api("/connections");
  const today = new Date().toISOString().slice(0, 10);
  const status = c => {
    if (c.kind === "oauth") return c.configured ? `<span class="chip ok">Connected</span>` : `<span class="chip quiet">Not connected</span>`;
    if (c.lastError) return `<span class="chip alert">Needs attention</span>`;
    if (!c.configured) return `<span class="chip scheduled">Not entered yet</span>`;
    if (c.rotationDue && c.rotationDue.slice(0, 10) < today) return `<span class="chip alert">Rotation overdue</span>`;
    return `<span class="chip ok">Entered</span>`;
  };
  const groups = [...new Set(list.map(c => c.system))];
  return {
    title: "Connections",
    html: `<div class="ph"><span class="hd-eyebrow">Platform</span><h1>Connections</h1>
      <p>The credentials Pulse uses to read HD IT's systems. Each one is saved straight to Key Vault and can only be read by the part of Pulse that needs it. Pulse never shows a credential again: to change one, replace it.</p></div>
      <div class="note info">${icon("compliance")}<span>Use a dedicated API user for each connection, with only the permissions listed. Every change is recorded in the audit log with your name and reason.</span></div>
      ${groups.map(g => `<section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">System</span><h2>${esc(g)}</h2></div></div>
        <div class="conn-list">${list.filter(c => c.system === g).map(c => `<article class="conn">
          <div class="conn-main">
            <div class="conn-h"><b>${esc(c.label)}</b>${status(c)}</div>
            <p>${esc(c.purpose)}</p>
            <p class="dim small"><b>Permissions:</b> ${esc(c.permissions)}</p>
            <div class="conn-meta small">
              <span>${c.secretUpdatedAt ? `Last changed ${esc(fmtDate(c.secretUpdatedAt))}${c.updatedBy ? ` by ${esc(c.updatedBy)}` : ""}` : "Never entered"}</span>
              ${c.lastSuccessAt ? `<span>Last worked ${esc(fmtDateTime(c.lastSuccessAt))}</span>` : ""}
              <span>Owner: ${esc(c.owner || "not set")}</span>
              <span>Rotation due: ${c.rotationDue ? esc(fmtDate(c.rotationDue)) : "not set"}</span>
            </div>
            ${c.lastError ? `<div class="err small">${esc(c.lastError)}</div>` : ""}
          </div>
          <div class="conn-act">
            ${c.kind === "oauth" ? `<span class="dim small">Set by "Connect to Xero" (0.6.0)</span>`
              : `<button class="btn sm" type="button" data-enter="${c.name}">${c.configured ? "Replace" : "Enter"}</button>`}
            <button class="link-btn small" type="button" data-details="${c.name}">Owner and rotation</button>
            ${c.configured && c.kind !== "oauth" ? `<button class="link-btn small" type="button" data-remove="${c.name}">Remove</button>` : ""}
          </div>
        </article>`).join("")}</div></section>`).join("")}`,
    mount: (root, refresh) => {
      const find = n => list.find(c => c.name === n);
      root.querySelectorAll("[data-enter]").forEach(b => {
        const c = find(b.dataset.enter);
        b.onclick = () => {
          const d = dialog({
            title: `${c.configured ? "Replace" : "Enter"}: ${c.label}`,
            intro: `${esc(c.purpose)} ${c.kind === "autotask" ? "Pulse signs in to Autotask with these details before saving them." : ""}`,
            fields: [
              ...c.fields.map(f => ({ name: f.key, label: f.label, type: f.secret ? "password" : "text", required: f.required, hint: f.hint })),
              { name: "owner", label: "Owner (who looks after this API user)", value: c.owner || "" },
              { name: "rotationDue", label: "Rotation due", type: "date", value: c.rotationDue ? c.rotationDue.slice(0, 10) : "" },
              ...(c.configured ? [{ name: "reason", label: "Reason for replacing", type: "textarea", rows: 2, required: true, hint: "For example: scheduled rotation, or the API user changed." }] : []),
            ],
            submit: c.kind === "autotask" ? "Test and save" : "Save",
            onSubmit: async f => {
              const r = await api(`/connections/${c.name}`, { method: "PUT", body: f });
              toast(r.note || "Saved"); refresh();
            },
          });
          // Credentials must never be remembered by the browser.
          d.querySelectorAll("input").forEach(i => { i.setAttribute("autocomplete", i.type === "password" ? "new-password" : "off"); i.spellcheck = false; });
        };
      });
      root.querySelectorAll("[data-details]").forEach(b => {
        const c = find(b.dataset.details);
        b.onclick = () => dialog({
          title: `${c.label}: owner and rotation`,
          fields: [{ name: "owner", label: "Owner", value: c.owner || "" }, { name: "rotationDue", label: "Rotation due", type: "date", value: c.rotationDue ? c.rotationDue.slice(0, 10) : "" }],
          onSubmit: async f => { await api(`/connections/${c.name}`, { method: "PATCH", body: f }); toast("Saved"); refresh(); },
        });
      });
      root.querySelectorAll("[data-remove]").forEach(b => {
        const c = find(b.dataset.remove);
        b.onclick = () => dialog({
          title: `Remove: ${c.label}`, intro: "Pulse stops using this credential straight away. Anything that depends on it stops updating.",
          fields: [{ name: "reason", label: "Reason", type: "textarea", rows: 2, required: true }], submit: "Remove", danger: true,
          onSubmit: async f => { await api(`/connections/${c.name}`, { method: "DELETE", body: f }); toast("Removed"); refresh(); },
        });
      });
    },
  };
}
