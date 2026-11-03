"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/people/match");

test("every Entra address counts, lower case, smtp proxies included", () => {
  const e = M.userEmails({ userPrincipalName: "George.Hanna@hdit.com.au", mail: "george.hanna@hdit.com.au",
    otherMails: ["G@Example.com"], proxyAddresses: ["SMTP:George.Hanna@hdit.com.au", "smtp:george@hdit.com.au", "x500:/o=whatever"] });
  assert.deepEqual(e.sort(), ["g@example.com", "george.hanna@hdit.com.au", "george@hdit.com.au"]);
});

test("only licensed member accounts are people", () => {
  assert.equal(M.isPerson({ userType: "Member", accountEnabled: true, assignedLicenses: [{ skuId: "x" }] }), true);
  assert.equal(M.isPerson({ userType: "Member", accountEnabled: true, assignedLicenses: [] }), false);    // room, shared mailbox
  assert.equal(M.isPerson({ userType: "Guest", accountEnabled: true, assignedLicenses: [{ skuId: "x" }] }), false);
  assert.equal(M.isPerson({ userType: "Member", accountEnabled: false, assignedLicenses: [{ skuId: "x" }] }), false);
});

const R = (id, emails, extra = {}) => ({ id, name: "R" + id, emails, active: true, ...extra });

test("exactly one match links; alias addresses match too", () => {
  const r = M.match({
    persons: [{ id: 1, emails: ["tony.parzakonis@hdit.com.au", "tony@hdit.com.au"] }],
    resources: [R(101, ["tony@hdit.com.au"]), R(102, ["mandy@hdit.com.au"])],
  });
  assert.deepEqual(r.links, [{ personId: 1, resourceId: 101, email: "tony@hdit.com.au" }]);
  assert.ok(r.review.some(x => x.kind === "unlinked_account" && x.externalIds[0] === 102));
});

test("no match and several matches go to Needs review", () => {
  const r = M.match({
    persons: [{ id: 1, emails: ["nobody@hdit.com.au"] }, { id: 2, emails: ["api@hdit.com.au"] }],
    resources: [R(201, ["api@hdit.com.au"]), R(202, ["api@hdit.com.au"])],
  });
  assert.equal(r.links.length, 0);
  assert.equal(r.review.find(x => x.personId === 1).kind, "no_match");
  const multi = r.review.find(x => x.personId === 2);
  assert.equal(multi.kind, "multiple");
  assert.deepEqual(multi.externalIds.sort(), [201, 202]);
});

test("inactive resources are ignored (the active duplicate wins)", () => {
  const r = M.match({
    persons: [{ id: 1, emails: ["neelima@hdit.com.au"] }],
    resources: [R(301, ["neelima@hdit.com.au"], { active: false }), R(302, ["Neelima@hdit.com.au".toLowerCase()])],
  });
  assert.deepEqual(r.links.map(l => l.resourceId), [302]);
});

test("two people can't both claim one resource", () => {
  const r = M.match({
    persons: [{ id: 1, emails: ["shared@hdit.com.au"] }, { id: 2, emails: ["shared@hdit.com.au", "two@hdit.com.au"] }],
    resources: [R(401, ["shared@hdit.com.au"])],
  });
  assert.equal(r.links.length, 0);
  assert.equal(r.review.filter(x => x.kind === "conflict").length, 2);
});

test("an admin's link wins and its resource is reserved; 'no account' stops the review", () => {
  const r = M.match({
    persons: [{ id: 1, emails: ["x@hdit.com.au"] }, { id: 2, emails: ["r@hdit.com.au"] }, { id: 3, emails: ["noat@hdit.com.au"] }],
    resources: [R(501, ["r@hdit.com.au"])],
    adminLinks: new Map([[1, 501]]),
    noneSet: new Set([3]),
  });
  assert.equal(r.links.length, 0);                       // 2 can't take 501: it's reserved for 1
  assert.equal(r.review.find(x => x.personId === 2).kind, "no_match");
  assert.ok(!r.review.some(x => x.personId === 3));
  assert.ok(!r.review.some(x => x.kind === "unlinked_account"));
});
