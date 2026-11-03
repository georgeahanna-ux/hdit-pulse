-- 0006 Scorecard collectors (M2): automatic values worked out from source systems.
-- A measurable with a collector fills in auto_value every hour. Until Leadership switches it
-- on (auto_enabled = 1) it runs in shadow: the automatic value is kept and shown beside the
-- entered one for comparison, but the entered value is what the Scorecard shows.

ALTER TABLE pulse.measurable ADD
  collector        NVARCHAR(40)  NULL,      -- e.g. autotask.sla_first_response; NULL = typed in only
  auto_changed_by  NVARCHAR(200) NULL,      -- who last switched automatic on or off
  auto_changed_at  DATETIME2(3)  NULL;
GO

-- How the automatic value was worked out (JSON: plain-English sentence plus the counts), for the ⓘ panel.
ALTER TABLE pulse.scorecard_value ADD auto_detail NVARCHAR(2000) NULL;
GO

UPDATE pulse.measurable SET collector = N'autotask.sla_first_response', source = N'autotask',
  definition = N'Share of tickets created this week whose first response met its SLA. Counts tickets that have a first-response due time. A ticket meets it when its first response was at or before that time. Tickets still waiting for a first response count once their due time has passed. Example: 150 tickets with an SLA, 142 answered in time → 94.7%.',
  definition_version = definition_version + 1
WHERE code = N'sla_first_response';

UPDATE pulse.measurable SET collector = N'autotask.tickets_per_tech', source = N'autotask',
  definition = N'Tickets completed this week by techs ÷ (techs × working days). A tech is an active Autotask resource whose default department is Service Desk (D16). A ticket counts for the tech who completed it (or, if Autotask doesn''t record that, the tech it''s assigned to). Working days are Monday to Friday less public holidays in Autotask''s holiday set. Example: 6 techs, 4 working days, 216 tickets → 9.0.',
  definition_version = definition_version + 1
WHERE code = N'tickets_per_tech';

UPDATE pulse.measurable SET collector = N'autotask.fcr', source = N'autotask',
  definition = N'Share of tickets completed this week by techs that were resolved in a single touch: exactly one time entry on the ticket. Tickets with no time entries are left out. (Proposed definition, to confirm with the owner while in trial.) Example: 180 tickets with time, 117 with one entry → 65%.',
  definition_version = definition_version + 1
WHERE code = N'fcr';

UPDATE pulse.measurable SET collector = N'autotask.utilisation', source = N'autotask',
  definition = N'Billable hours ÷ available hours for techs this week. Billable hours are hours worked on tickets and project tasks not marked non-billable. Available hours are techs × working days × standard hours a day (7.6, a 38-hour week). Leave isn''t taken off yet. Example: 6 techs × 5 days × 7.6 = 228 available hours, 160 billable → 70.2%.',
  definition_version = definition_version + 1
WHERE code = N'utilisation';
GO

MERGE pulse.app_setting AS t
USING (VALUES
  (N'collect.hours_per_day', N'7.6'),
  (N'collect.tech_department', N'Service Desk'),
  (N'collect.holiday_set', NULL)          -- Autotask holiday set name; NULL = the only one, or one named NSW/Sydney/Australia
) AS s ([key], [value]) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], s.[value], N'migration 0006');
GO
