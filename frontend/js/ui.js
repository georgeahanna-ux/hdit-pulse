// Small helpers shared by every view.
export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const initials = n => String(n || "?").split(/[\s.@]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();

/** An HD IT brand icon from the official sprite (BRAND.md §9). Decorative: labels sit beside it. */
export const icon = (name, cls = "") =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="brand/hdit-icons.svg#hd-${name}"></use></svg>`;

export const eyebrow = text => `<span class="hd-eyebrow">${esc(text)}</span>`;

export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3600);
}

const SYD = "Australia/Sydney";
/** 8 October 2026 */
export const fmtDate = d => new Date(d.length === 10 ? d + "T12:00:00+10:00" : d).toLocaleDateString("en-AU", { timeZone: SYD, day: "numeric", month: "long", year: "numeric" });
/** 8 Oct */
export const fmtShort = d => new Date(d.length === 10 ? d + "T12:00:00+10:00" : d).toLocaleDateString("en-AU", { timeZone: SYD, day: "numeric", month: "short" });
/** Tuesday 3 November, 5pm */
export const fmtWhen = d => {
  const x = new Date(d);
  const day = x.toLocaleDateString("en-AU", { timeZone: SYD, weekday: "long", day: "numeric", month: "long" });
  const time = x.toLocaleTimeString("en-AU", { timeZone: SYD, hour: "numeric", minute: "2-digit", hour12: true }).replace(":00", "").replace(/\s/g, "").toLowerCase();
  return `${day}, ${time}`;
};
export const fmtDateTime = d => new Date(d).toLocaleString("en-AU", { timeZone: SYD, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
