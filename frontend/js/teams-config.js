// The set-up page Teams shows when Pulse is added as a tab to a channel, chat or meeting (0.9.0).
(function () {
  "use strict";
  var NAMES = { l10: "L10 meeting", scorecard: "Scorecard", rocks: "Rocks", issues: "Issues", todos: "To-dos", home: "Pulse" };
  var form = document.getElementById("pick"), err = document.getElementById("tc-err");
  var chosen = function () { var c = form.querySelector("input[name=page]:checked"); return c ? c.value : "l10"; };
  if (!window.microsoftTeams) { err.textContent = "Open this page from Microsoft Teams."; err.hidden = false; return; }
  var t = window.microsoftTeams;
  t.app.initialize().then(function () {
    t.pages.config.registerOnSaveHandler(function (save) {
      var page = chosen(), base = location.origin + "/";
      t.pages.config.setConfig({
        entityId: page,
        contentUrl: base + "?teams=1#/" + (page === "home" ? "" : page),
        websiteUrl: base + "#/" + (page === "home" ? "" : page),
        suggestedDisplayName: NAMES[page] || "Pulse",
      }).then(function () { save.notifySuccess(); }, function (e) { save.notifyFailure(String(e && e.message || e)); });
    });
    t.pages.config.setValidityState(true);
  }, function (e) { err.textContent = "Teams didn't answer: " + (e && e.message || e); err.hidden = false; });
})();
