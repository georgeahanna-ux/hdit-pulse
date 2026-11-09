-- 0010 Xero (D17): "Connect to Xero" and the finance measurables, on trial first.

-- One-time states for Connect to Xero (10 minutes, single use). No tokens are stored here.
CREATE TABLE pulse.xero_oauth_state (
  state        NVARCHAR(64)  NOT NULL CONSTRAINT pk_xero_oauth_state PRIMARY KEY,
  person_oid   NVARCHAR(64)  NOT NULL,
  person_name  NVARCHAR(200) NOT NULL,
  created_at   DATETIME2(3)  NOT NULL CONSTRAINT df_xero_state_created DEFAULT (SYSUTCDATETIME()),
  used_at      DATETIME2(3)  NULL
);
GO

UPDATE pulse.measurable SET collector = N'xero.cash', source = N'xero',
  definition = N'Cash in HD IT''s bank accounts at the end of the week (today, for the current week): the total closing balance on Xero''s Bank Summary. Example: operating $612,400 + savings $250,000 → $862,400.',
  definition_version = definition_version + 1
WHERE code = N'cash';

UPDATE pulse.measurable SET collector = N'xero.dso', source = N'xero',
  definition = N'Debtor days: how many days of sales are owed to HD IT. Accounts receivable at the end of the week (Xero Balance Sheet) ÷ the last 91 days'' revenue plus 10% GST (receivables include GST, revenue doesn''t), × 91. Example: $420,000 owed, $1,150,000 revenue over 91 days → 420,000 ÷ 1,265,000 × 91 = 30.2 days.',
  definition_version = definition_version + 1
WHERE code = N'dso';

UPDATE pulse.measurable SET collector = N'xero.sgm', source = N'xero',
  definition = N'Services gross margin (SLI F18) for the month so far, shown weekly and provisional until Finance closes the month: services revenue less services cost of sales ÷ services revenue, using the SLI reporting codes on HD IT''s Xero accounts. Until Finance confirms which codes are services, Pulse shows the whole business''s gross margin and says so.',
  definition_version = definition_version + 1
WHERE code = N'sgm';

UPDATE pulse.measurable SET collector = N'xero.ebitda_pct', source = N'xero',
  definition = N'EBITDA as a % of revenue (SLI IS4) for the month so far, shown weekly and provisional until Finance closes the month: Xero''s net profit plus depreciation, amortisation, interest and income tax expense, less interest income, ÷ trading income. Example: net profit $70,000 + depreciation $8,000 + interest $2,000 on revenue $760,000 → 10.5%.',
  definition_version = definition_version + 1
WHERE code = N'ebitda_pct';

UPDATE pulse.plan_metric SET collector = N'xero.revenue' WHERE code = N'revenue';
GO

MERGE pulse.app_setting AS t
USING (VALUES
  (N'xero.gst_rate', N'0.1'),
  (N'xero.sgm_revenue_codes', N'[]'),   -- SLI reporting codes of services revenue accounts, set with Finance
  (N'xero.sgm_cost_codes', N'[]')       -- and of services cost accounts
) AS s ([key], [value]) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], s.[value], N'migration 0010');
GO
