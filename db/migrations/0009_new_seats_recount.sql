-- 0009 New seats: recount (9 Nov 2026). Quotes record seats as product lines named after the seat
-- services, and wins are the stage "Stage 9: Closed Won". Clearing the automatic values lets the
-- next hourly run work them out again, including locked weeks (they only fill when empty).
-- Typed-in values and overrides are untouched.

UPDATE v SET auto_value = NULL, auto_detail = NULL, auto_at = NULL
  FROM pulse.scorecard_value v JOIN pulse.measurable m ON m.id = v.measurable_id
 WHERE m.code = N'new_seats';

UPDATE a SET auto_value = NULL, auto_detail = NULL, auto_at = NULL
  FROM pulse.plan_month_actual a JOIN pulse.plan_metric p ON p.id = a.metric_id
 WHERE p.code = N'new_seats';

UPDATE pulse.measurable SET
  definition = N'Seats on opportunities won this week: opportunities that reached the stage "Stage 9: Closed Won", counted in the week they closed. Seats are the quantity of quote lines on the primary quote that are one of the seat services, or a product named after one (for example "HD IT - IT Managed Services Support - Business Class - Per User per Month"). Example: two deals won with 25 and 50 users → 75.',
  definition_version = definition_version + 1
WHERE code = N'new_seats';
GO
