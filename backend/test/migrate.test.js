"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../scripts/migrate");

test("SID from a client id matches SQL Server's uniqueidentifier byte order", () => {
  // CONVERT(varbinary(16), CAST('6dcedf3f-9147-4fd7-b8bf-472ab77b7cf1' AS uniqueidentifier))
  assert.equal(m.sidFromClientId("6dcedf3f-9147-4fd7-b8bf-472ab77b7cf1"), "0x3FDFCE6D4791D74FB8BF472AB77B7CF1");
});

test("identity user SQL refuses anything that isn't a plain name and GUID", () => {
  assert.match(m.identityUserSql("id-hdit-pulse-api-test-aue", "6dcedf3f-9147-4fd7-b8bf-472ab77b7cf1", "pulse_api"), /CREATE USER \[id-hdit-pulse-api-test-aue\] WITH SID = 0x3FDF/);
  assert.throws(() => m.identityUserSql("x]; DROP TABLE y;--", "6dcedf3f-9147-4fd7-b8bf-472ab77b7cf1", "pulse_api"));
  assert.throws(() => m.identityUserSql("id-ok-name", "not-a-guid", "pulse_api"));
  assert.throws(() => m.identityUserSql("id-ok-name", "6dcedf3f-9147-4fd7-b8bf-472ab77b7cf1", "db_owner"));
});

test("batches split on GO lines only", () => {
  const b = m.splitBatches("SELECT 1;\nGO\n-- only a comment\nGO\nSELECT 'GOOD' AS go_col;\n  go  \n");
  assert.deepEqual(b, ["SELECT 1;", "SELECT 'GOOD' AS go_col;"]);
});

test("migrations load in order with stable checksums", () => {
  const list = m.loadMigrations();
  assert.ok(list.length >= 1);
  assert.equal(list[0].id, "0001_foundations");
  assert.deepEqual(list.map(x => x.id), [...list.map(x => x.id)].sort());
  for (const x of list) assert.match(x.sha, /^[0-9a-f]{64}$/);
  // every table people edit is versioned; the audit table is protected
  const all = list.map(x => x.batches.join("\n")).join("\n");
  assert.match(all, /DENY UPDATE, DELETE ON pulse\.audit_event TO pulse_api/);
  assert.match(all, /HISTORY_TABLE = pulse\.person_history/);
});
