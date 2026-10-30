// Help pages: compares the version the page was written for with the version of Pulse that opened it (?v=).
const built = document.body.dataset.builtFor;
const appV = new URLSearchParams(location.search).get("v");
const b = document.getElementById("ver-banner");
const tag = document.getElementById("built-for");
if (tag) tag.textContent = "v" + built;
if (b) {
  if (appV && appV !== built) { b.className = "ver-banner warn"; b.textContent = `You're running Pulse v${appV}. This page is for v${built}. Reload Pulse to pick up the latest version.`; }
  else if (appV) { b.className = "ver-banner ok"; b.textContent = `You're on the latest version, v${built}.`; }
  else { b.className = "ver-banner"; b.textContent = `This page is for Pulse v${built}. Your version is shown next to the Pulse name at the top of the app.`; }
}
