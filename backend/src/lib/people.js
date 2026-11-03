"use strict";
/**
 * People directory (D10). The Entra object id is the master identity. M0 records each person
 * when they sign in; M2 adds the nightly Entra and Autotask matching and the department sync (D16).
 *
 * pulse.person is temporal (change history), so it's only updated when the name or email really
 * changes. Sign-in times live in pulse.person_activity, which keeps no history.
 */
const db = require("./sql");

/** Creates or refreshes the person's row from their sign-in. Returns { id, firstSignIn }. */
async function touch(person) {
  const rows = await db.query(
    `SET NOCOUNT ON;
     DECLARE @out TABLE (id INT, action NVARCHAR(10));
     MERGE pulse.person WITH (HOLDLOCK) AS t
     USING (SELECT @oid AS entra_oid) AS s ON t.entra_oid = s.entra_oid
     WHEN MATCHED AND (t.display_name <> @name OR ISNULL(t.email, N'') <> @email)
          THEN UPDATE SET display_name = @name, email = NULLIF(@email, N'')
     WHEN NOT MATCHED THEN INSERT (entra_oid, display_name, email) VALUES (@oid, @name, NULLIF(@email, N''))
     OUTPUT inserted.id, $action INTO @out;
     DECLARE @id INT = (SELECT TOP 1 id FROM @out);
     IF @id IS NULL SELECT @id = id FROM pulse.person WHERE entra_oid = @oid;
     MERGE pulse.person_activity AS a
     USING (SELECT @id AS person_id) AS s ON a.person_id = s.person_id
     WHEN MATCHED THEN UPDATE SET last_sign_in_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (person_id, first_sign_in_at, last_sign_in_at) VALUES (@id, SYSUTCDATETIME(), SYSUTCDATETIME());
     IF OBJECT_ID(N'pulse.seat_holder') IS NOT NULL AND @email <> N''
       UPDATE pulse.seat_holder SET person_id = @id WHERE person_id IS NULL AND holder_email = @email;
     SELECT @id AS id, (SELECT TOP 1 action FROM @out) AS action;`,
    { oid: person.oid, name: String(person.name || "").slice(0, 200), email: String(person.email || "").slice(0, 320) });
  const r = rows[0] || {};
  return { id: Number(r.id), firstSignIn: r.action === "INSERT" };
}

module.exports = { touch };
