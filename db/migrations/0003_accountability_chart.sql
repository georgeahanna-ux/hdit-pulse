-- =============================================================================
-- 0003 Accountability Chart (Pulse 0.5.0)
-- Seats, roles, key results and seat holders from the HD IT Accountability Chart
-- (19 August 2026) and Organisational Chart (21 August 2026). Editable in Pulse afterwards.
-- Seat holders are matched to people by email when known, otherwise by name (until the
-- People directory fills in emails in 0.6.0).
-- =============================================================================

ALTER TABLE pulse.seat_holder ADD holder_title NVARCHAR(200) NULL, team NVARCHAR(100) NULL;
ALTER TABLE pulse.seat ADD apps_json NVARCHAR(400) NULL;
GO

-- Functions now mirror the Accountability Chart's seats under each head.
DELETE FROM pulse.division_function;
INSERT INTO pulse.division_function (division_code, name, sort) VALUES
  (N'Leadership', N'Board of Directors', 1), (N'Leadership', N'Visionary', 2), (N'Leadership', N'Integrator', 3),
  (N'Finance', N'Office Management', 1), (N'Finance', N'Accounts Administration', 2),
  (N'SalesMarketing', N'Marketing', 1), (N'SalesMarketing', N'Business Development', 2),
  (N'SalesMarketing', N'Sales Administration', 3), (N'SalesMarketing', N'Account Management', 4),
  (N'InnovationCompliance', N'DevOps', 1), (N'InnovationCompliance', N'Compliance', 2),
  (N'ManagedServices', N'Service Team Leadership', 1), (N'ManagedServices', N'Projects Team Leadership', 2),
  (N'ManagedServices', N'Client Success', 3), (N'ManagedServices', N'Service Admin', 4),
  (N'ManagedServices', N'NOC', 5), (N'ManagedServices', N'Service Teams', 6), (N'ManagedServices', N'Projects Teams', 7);

UPDATE pulse.division SET summary = CASE code
  WHEN N'Leadership' THEN N'A clear vision and a viable, expanding organisation.'
  WHEN N'Finance' THEN N'Preserved and valuable assets and resources.'
  WHEN N'People' THEN N'Established, productive and ethical staff.'
  WHEN N'SalesMarketing' THEN N'New client acquisitions, retention and profitable growth.'
  WHEN N'InnovationCompliance' THEN N'Software systems that support the efficient delivery of services and contribute to the organisation''s success.'
  WHEN N'ManagedServices' THEN N'Effective and efficient delivery of services resulting in satisfied clients.'
END;
GO

DECLARE @fn TABLE (name NVARCHAR(100), id INT);
INSERT INTO @fn SELECT name, id FROM pulse.division_function;
DECLARE @board INT, @vis INT, @int INT, @fin INT, @hr INT, @sm INT, @ic INT, @ms INT, @stl INT, @ptl INT, @s INT;

-- ---------------- Leadership ----------------
INSERT INTO pulse.seat (division_code, function_id, title, roles_json, key_result, sort)
VALUES (N'Leadership', (SELECT id FROM @fn WHERE name = N'Board of Directors'), N'Board of Directors', N'[]', NULL, 1);
SET @board = SCOPE_IDENTITY();
INSERT INTO pulse.seat (division_code, function_id, title, roles_json, key_result, sort)
VALUES (N'Leadership', (SELECT id FROM @fn WHERE name = N'Visionary'), N'Visionary',
  N'["New ideas and vision","Big relationships","Culture","Research and development"]',
  N'A clear vision, with strategic direction that leads to long-term viability of the organisation.', 2);
SET @vis = SCOPE_IDENTITY();
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'Leadership', (SELECT id FROM @fn WHERE name = N'Integrator'), @vis, N'Integrator',
  N'["Lead, manage and hold accountable (LMA)","Special projects","Profit and loss","Business plan","Harmonious integration"]',
  N'A viable and expanding organisation.', 3);
SET @int = SCOPE_IDENTITY();

-- ---------------- Finance & Accounts ----------------
INSERT INTO pulse.seat (division_code, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'Finance', @int, N'Head of Finance & Accounts',
  N'["Lead, manage and hold accountable (LMA)","Financial reporting","Asset management","Accounts receivable","Accounts payable","Payroll"]',
  N'Preserved and valuable assets and resources.', 1);
SET @fin = SCOPE_IDENTITY();
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'Finance', (SELECT id FROM @fn WHERE name = N'Office Management'), @fin, N'Office Management',
  N'["Clean office","Office supplies","Events","Reception","Logistics"]',
  N'An organised, clean and fully stocked office facilitating production.', 2);
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'Finance', (SELECT id FROM @fn WHERE name = N'Accounts Administration'), @fin, N'Accounts Administration',
  N'["Accounts receivable","Accounts payable","Invoicing","Reconciling","Data entry","General admin and accounts tasks"]',
  N'Accurately organised and recorded financial transactions.', 3);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES (@s, N'TBA', N'Accounts Admin', N'Accounts Administration');

-- ---------------- People (HR) ----------------
INSERT INTO pulse.seat (division_code, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'People', @int, N'Head of Human Resources',
  N'["Lead, manage and hold accountable (LMA)","Facilitate the recruitment process","Manage employment documents","Policy creation and distribution","Onboarding and training","Facilitate the performance management process"]',
  N'Established, productive and ethical staff.', 1);
SET @hr = SCOPE_IDENTITY();

-- ---------------- Sales & Marketing ----------------
INSERT INTO pulse.seat (division_code, parent_seat_id, title, roles_json, key_result, apps_json, sort)
VALUES (N'SalesMarketing', @int, N'Head of Sales & Marketing',
  N'["Lead, manage and hold accountable (LMA)","Marketing plan","Sales strategy","Sales process","Pre-sales","Contract creation","Brand management","Vendor and partner management"]',
  N'New client acquisitions, retention and profitable growth.', N'["pipeline","mroi","wspace"]', 1);
SET @sm = SCOPE_IDENTITY();
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, apps_json, sort)
VALUES (N'SalesMarketing', (SELECT id FROM @fn WHERE name = N'Marketing'), @sm, N'Marketing',
  N'["Lead generation","Brand","Implement the marketing plan","Social content","Website","Campaign creation and execution","Vendor engagement (MDF)"]',
  N'Constant and steady lead generation and brand awareness.', N'["mroi"]', 2);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES (@s, N'Vacant', N'Marketing Administrator', N'Marketing');
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, apps_json, sort)
VALUES (N'SalesMarketing', (SELECT id FROM @fn WHERE name = N'Business Development'), @sm, N'Business Development',
  N'["New client sales","Lead generation","Campaign execution","Opportunity identification and management"]',
  N'Profitable new client sales.', N'["pipeline","mroi","wspace"]', 3);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES
  (@s, N'Vacant', N'BDM', N'Business Development'),
  (@s, N'Mariano Ordonez', N'Sales Development Rep', N'Business Development'),
  (@s, N'Dree Sumbillo', N'Sales Development Rep', N'Business Development');
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, apps_json, sort)
VALUES (N'SalesMarketing', (SELECT id FROM @fn WHERE name = N'Sales Administration'), @sm, N'Sales Administration',
  N'["Opportunity identification","Quoting","Process documentation","Vendor engagement (procurement)","Sales tool management"]',
  N'A supported sales team.', N'["pipeline"]', 4);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES (@s, N'Nour Chalouhi', N'IT Sales Admin', N'Sales Administration');
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, apps_json, sort)
VALUES (N'SalesMarketing', (SELECT id FROM @fn WHERE name = N'Account Management'), @sm, N'Account Management',
  N'["Strategic business reviews","Opportunity identification and management","Client retention and renewal"]',
  N'Profitable client retention and growth.', N'["pipeline","wspace"]', 5);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES (@s, N'Omotayo Aweda', N'Account Manager', N'Account Management');

-- ---------------- Innovation & Compliance ----------------
INSERT INTO pulse.seat (division_code, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'InnovationCompliance', @int, N'Head of Innovation & Compliance',
  N'["Lead, manage and hold accountable (LMA)","Process improvement","Automation and integration"]',
  N'Software systems that support the efficient delivery of services and contribute to the organisation''s success.', 1);
SET @ic = SCOPE_IDENTITY();
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'InnovationCompliance', (SELECT id FROM @fn WHERE name = N'DevOps'), @ic, N'DevOps',
  N'["Strategic delivery of optimisations","Support internal systems and processes"]',
  N'Effective optimisations that streamline processes and enhance productivity.', 2);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES (@s, N'Hayden Hartley', N'DevOps Engineer', N'DevOps');
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'InnovationCompliance', (SELECT id FROM @fn WHERE name = N'Compliance'), @ic, N'Compliance',
  N'["ISO compliance framework ownership","Risk management","Policy and control management","Internal audit management","Corrective actions and continuous improvement","Compliance training and awareness"]',
  N'Sustained ISO compliance and risk control.', 3);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES (@s, N'ISO365', N'Virtual Compliance Officers', N'Compliance');

-- ---------------- Managed Services ----------------
INSERT INTO pulse.seat (division_code, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'ManagedServices', @int, N'Head of Managed Services',
  N'["Lead, manage and hold accountable (LMA)","Delivery of service","Delivery of projects","Change management","Service improvements","Customer satisfaction","Technical data and documentation"]',
  N'Effective and efficient delivery of services resulting in satisfied clients.', 1);
SET @ms = SCOPE_IDENTITY();
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'ManagedServices', (SELECT id FROM @fn WHERE name = N'Service Team Leadership'), @ms, N'Service Team Leadership',
  N'["Team leadership","Dispatching and scheduling","SLA adherence","Ticket and queue management","Customer satisfaction","Client comms and escalations","Technical data and documentation","Onboarding and offboarding"]',
  N'A productive and efficient service team.', 2);
SET @stl = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES
  (@stl, N'Ragavendran Kannan', N'Service Team Lead', N'Service Desk'),
  (@stl, N'Tony Parzakonis', N'Field Services Team Lead', N'Field Services'),
  (@stl, N'Tony Parzakonis', N'NOC Team Lead', N'NOC');
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'ManagedServices', (SELECT id FROM @fn WHERE name = N'Projects Team Leadership'), @ms, N'Projects Team Leadership',
  N'["Project delivery oversight","Project co-ordination","Project reporting"]',
  N'Projects delivered within budget, schedule and scope.', 3);
SET @ptl = SCOPE_IDENTITY();
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'ManagedServices', (SELECT id FROM @fn WHERE name = N'Client Success'), @ms, N'Client Success',
  N'["Client communication and escalation","Basic client technology education","Sales opportunity identification","Client experience and satisfaction","Client reporting and review","Client retention","Admin tasks"]',
  N'Extremely satisfied clients with high client retention.', 4);
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'ManagedServices', (SELECT id FROM @fn WHERE name = N'Service Admin'), @ms, N'Service Admin',
  N'["On-site visit scheduling","On-call roster scheduling","Internal asset management","Assist management with special projects","Couriers and deliveries"]',
  N'An administratively supported and efficient service delivery team.', 5);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES (@s, N'Nathan Tang', N'IT Administrator', N'Service Admin');
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'ManagedServices', (SELECT id FROM @fn WHERE name = N'NOC'), @ms, N'NOC',
  N'["Change requests","Backup and alert monitoring","Anti-virus","Patching","Monitoring","Networking"]',
  N'Client systems and networks proactively maintained, working efficiently and reliably.', 6);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES
  (@s, N'Rinus Besselaar', N'NOC Engineer', N'NOC (South Africa)'),
  (@s, N'Alex Abbas', N'NOC Engineer', N'NOC (India)');
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'ManagedServices', (SELECT id FROM @fn WHERE name = N'Service Teams'), @stl, N'Service Teams',
  N'["Level 1/2/3 user support","Level 1/2/3 desktop support","Server support","Change requests","Project task execution","Customer service","SLA adherence","Documentation"]',
  N'Requests resolved in an effective and efficient manner.', 7);
SET @s = SCOPE_IDENTITY();
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES
  (@s, N'Daniel Tousi', N'Senior Solutions Engineer', N'Service Desk'),
  (@s, N'Jacob McCredie', N'Senior Solutions Engineer', N'Service Desk'),
  (@s, N'Bovorn Saysouthinh', N'Service Desk Engineer', N'Service Desk'),
  (@s, N'Sebouh Khatchador', N'Service Desk Engineer', N'Service Desk'),
  (@s, N'Olu Bashiru', N'Service Desk Engineer', N'Service Desk'),
  (@s, N'Gabriel Chehade', N'L1 Service Desk Engineer', N'Service Desk'),
  (@s, N'Ryker Santiago', N'L1 Service Desk Engineer', N'Service Desk'),
  (@s, N'Abiy Amdemariam', N'Senior Service Desk Engineer', N'Field Services'),
  (@s, N'Michael Baltagi', N'Service Desk Engineer', N'Field Services'),
  (@s, N'Sean Nguyen', N'Service Desk Engineer', N'Field Services'),
  (@s, N'Neelima Thota', N'Service Desk Engineer', N'Field Services');
INSERT INTO pulse.seat (division_code, function_id, parent_seat_id, title, roles_json, key_result, sort)
VALUES (N'ManagedServices', (SELECT id FROM @fn WHERE name = N'Projects Teams'), @ptl, N'Projects Teams',
  N'["Project scoping","Project execution and delivery"]',
  N'Projects executed to meet quality, budget, schedule and scope targets.', 8);

-- ---------------- Holders of the top seats ----------------
INSERT INTO pulse.seat_holder (seat_id, holder_name, holder_title, team) VALUES
  (@board, N'George Hanna', N'Managing Director', NULL),
  (@board, N'Bernadette Hanna', N'Director', NULL),
  (@vis, N'George Hanna', N'Managing Director', NULL),
  (@int, N'George Hanna', N'Managing Director', NULL),
  (@fin, N'Mandy Moujalli', N'Head of Finance & Accounts', NULL),
  (@hr, N'Bernadette Hanna', N'Head of Human Resources', NULL),
  (@sm, N'Faben Miglani', N'Head of Sales & Marketing', NULL),
  (@ic, N'Bernadette Hanna', N'Head of Innovation & Compliance', NULL),
  (@ms, N'Tony Parzakonis', N'Head of Managed Services', NULL);

-- Company measurables belong to the head seat of their division (D4 owners).
UPDATE pulse.measurable SET seat_id = @sm WHERE division_code = N'SalesMarketing';
UPDATE pulse.measurable SET seat_id = @ms WHERE division_code = N'ManagedServices';
UPDATE pulse.measurable SET seat_id = @fin WHERE division_code = N'Finance';
GO
