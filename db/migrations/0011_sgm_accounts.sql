-- 0011 Services gross margin by Finance's account list (George, 10 Nov 2026).
-- Revenue (I22) and cost (C11, C12, C13) accounts by their Xero account code. 51119 (Parking -
-- Managed Services Work) was listed twice; it counts once.

MERGE pulse.app_setting AS t
USING (VALUES
  (N'xero.sgm_revenue_accounts', N'["41113","41114","41115","45131"]'),
  (N'xero.sgm_cost_accounts', N'["51114","51119","57100","57110","57120","57130","57140","57150","57170","57190","51115","52222","51103"]')
) AS s ([key], [value]) ON t.[key] = s.[key]
WHEN MATCHED THEN UPDATE SET [value] = s.[value], updated_by = N'migration 0011'
WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], s.[value], N'migration 0011');
GO

UPDATE pulse.measurable SET
  definition = N'Services gross margin (SLI F18) for the month so far, shown weekly and provisional until Finance closes the month: services revenue less services costs ÷ services revenue. Revenue accounts (I22): 41113 Support Agreement Retainer, 41114 Support Agreement Managed Services, 41115 Professional Services Other, 45131 After Hours. Cost accounts (C11, C12, C13): 51114, 51119, 57100, 57110, 57120, 57130, 57140, 57150, 57170, 57190, 51115, 52222, 51103 (service desk wages, allowances, travel, training, contractors and managed-services costs). Example: $500,000 services revenue, $290,000 services costs → 42%.',
  definition_version = definition_version + 1
WHERE code = N'sgm';
GO
