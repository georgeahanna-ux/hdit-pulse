-- 0013 Sales and customer feedback measurables, on trial (0.6.5, 10 Nov 2026).
--   MQLs                 from Marketing ROI (D9), read by the sync service with Pulse.Collector
--   New MRR, weighted    from Autotask opportunities with Pulse's single API user (9 Nov 2026),
--   pipeline             worked out the way Pipeline shows them
--   CSAT, NPS            from SimpleSAT, read-only API key
-- Trial first: values fill in beside the typed-in ones until Leadership switches each one on.

UPDATE pulse.measurable SET collector = N'mroi.mqls', source = N'mroi',
  definition = N'Marketing-qualified leads this week: opportunities with a marketing event (lead source) that reached MQL or beyond (SQL, won) for the first time this week, as Marketing ROI records it. Autotask keeps no history of a client''s category, so Marketing ROI notes the moment: when someone moves the lead in Marketing ROI, or within the hour when Pulse checks. Leads that were already MQL when Marketing ROI first saw them are dated by when the opportunity was created, and the week says how many. Example: 4 leads moved to MQL and 3 created straight at SQL → 7.',
  definition_version = definition_version + 1
WHERE code = N'mqls';

UPDATE pulse.measurable SET collector = N'autotask.new_mrr', source = N'autotask',
  definition = N'Monthly recurring revenue on opportunities won this week: the opportunities'' monthly revenue in Autotask (the "+ $/mo" Pipeline shows), for opportunities at "Stage 9: Closed Won" whose close date falls in the week. Example: two deals won, $3,200 and $1,450 a month → $4,650.',
  definition_version = definition_version + 1
WHERE code = N'new_mrr';

UPDATE pulse.measurable SET collector = N'autotask.weighted_pipeline', source = N'autotask',
  definition = N'Weighted pipeline at the end of the week: active opportunities at Stage 6 or Stage 7, each one''s one-off revenue × its probability, added up (Pipeline''s "Weighted pipeline" total, without the board''s filters). Autotask keeps no stage history, so Pulse takes a reading every hour during the week and the last one before the week ends stands; earlier weeks can''t be worked out. Example: $40,000 at 60% and $25,000 at 90% → $46,500.',
  definition_version = definition_version + 1
WHERE code = N'weighted_pipeline';

UPDATE pulse.measurable SET collector = N'simplesat.csat', source = N'simplesat',
  definition = N'Share of this week''s CSAT ratings in SimpleSAT that were positive, as SimpleSAT judges them, so it matches SimpleSAT''s own reports: neutral ratings count in the total and pull the score down. One rating per survey response; follow-up questions don''t count. Example: 48 ratings, 46 positive → 95.8%.',
  definition_version = definition_version + 1
WHERE code = N'csat';

UPDATE pulse.measurable SET collector = N'simplesat.nps', source = N'simplesat',
  definition = N'Net Promoter Score over the 90 days to the end of the week, from SimpleSAT''s NPS ratings: % promoters (9–10) less % detractors (0–6); passives (7–8) count in the total only. Example: 60 ratings, 45 promoters, 3 detractors → +70.',
  definition_version = definition_version + 1
WHERE code = N'nps';
GO
