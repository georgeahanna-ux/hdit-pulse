-- 0012 Xero recount (10 Nov 2026): debtor days now find receivables by Xero's system account, and
-- SGM and EBITDA % show the latest whole month (a part month misleads: wages and depreciation are
-- posted later). Clearing the automatic values lets the next run work them out again, locked weeks
-- included. Typed-in values and overrides are untouched.
UPDATE v SET auto_value = NULL, auto_detail = NULL, auto_at = NULL, provisional = 0
  FROM pulse.scorecard_value v JOIN pulse.measurable m ON m.id = v.measurable_id
 WHERE m.code IN (N'dso', N'sgm', N'ebitda_pct');

UPDATE pulse.measurable SET definition = REPLACE(definition, N'for the month so far, shown weekly and provisional until Finance closes the month', N'for the latest whole month (shown each week, provisional for 20 days after the month ends while Finance closes it)'),
  definition_version = definition_version + 1
 WHERE code IN (N'sgm', N'ebitda_pct');
GO
