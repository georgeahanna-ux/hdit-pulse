-- 0007 Seats, new seats and MRR from Autotask (decided 9 Nov 2026), on trial first.
--   Seat  = quantity of the seat services on recurring-service contracts in force.
--   New seats = seats on opportunities won in the period (primary quote).
--   MRR   = recurring contract services converted to a monthly amount.

ALTER TABLE pulse.plan_metric ADD
  collector        NVARCHAR(40)  NULL,
  auto_enabled     BIT NOT NULL CONSTRAINT df_plan_auto DEFAULT (0),
  auto_changed_by  NVARCHAR(200) NULL,
  auto_changed_at  DATETIME2(3)  NULL;
GO

ALTER TABLE pulse.plan_month_actual ADD auto_detail NVARCHAR(2000) NULL;
GO

UPDATE pulse.plan_metric SET collector = N'autotask.mrr'       WHERE code = N'mrr';
UPDATE pulse.plan_metric SET collector = N'autotask.seats'     WHERE code = N'seats';
UPDATE pulse.plan_metric SET collector = N'autotask.new_seats' WHERE code = N'new_seats';

UPDATE pulse.measurable SET collector = N'autotask.seats_serviced', source = N'autotask',
  definition = N'Seats under recurring-service contracts in force at the end of the week (today, for the current week). A seat is one unit of any of these Autotask services: IT Support & Proactive Maintenance - Business Class Plan; Technical Services and Management; IT Managed Services Support - Business Class - Per User per Month. Units come from each contract service''s billing period covering that day. Example: 40 contracts with 2,214 units of those services → 2,214.',
  definition_version = definition_version + 1
WHERE code = N'seats_serviced';

UPDATE pulse.measurable SET collector = N'autotask.new_seats', source = N'autotask',
  definition = N'Seats on opportunities won this week: the quantity of the seat services (as for Seats serviced) on each won opportunity''s primary quote, counted in the week the opportunity was closed. Example: two deals won, 25 and 40 users → 65.',
  definition_version = definition_version + 1
WHERE code = N'new_seats';
GO

MERGE pulse.app_setting AS t
USING (VALUES (N'collect.seat_services',
  N'["IT Support & Proactive Maintenance - Business Class Plan","Technical Services and Management","IT Managed Services Support - Business Class - Per User per Month"]')
) AS s ([key], [value]) ON t.[key] = s.[key]
WHEN MATCHED THEN UPDATE SET [value] = s.[value], updated_by = N'migration 0007'
WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], s.[value], N'migration 0007');
GO
