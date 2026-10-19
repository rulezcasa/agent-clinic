-- Demo data for the clinic. Safe to re-run.
-- Jane has a SEVERE penicillin allergy → an amoxicillin Rx gets blocked and Dr. Sage switches to azithromycin.
-- Benzonatate is out of stock → a second flag, with dextromethorphan as the in-stock alternative.

insert into patients (id, full_name, dob, email, phone, allergies, insurance, history) values (
  '00000000-0000-4000-8000-000000000001', 'Jane Doe', '1990-04-12', 'jane.doe@example.com', '+1-555-0100',
  '[{"substance":"penicillin","severity":"severe","reaction":"anaphylaxis"}]',
  '{"payer":"Acme Health","member_id":"ACM-449-2210","plan":"Acme Health Silver","group_number":"GRP-7781"}',
  'Mild intermittent asthma, albuterol inhaler as needed. No surgeries. Non-smoker.'
) on conflict (id) do nothing;

insert into drugs (id, name, generic, drug_class, indication, price_cents, stock_qty, allergens, interacts_with) values
  ('00000000-0000-4000-9000-000000000001', 'Amoxicillin 500mg',        'amoxicillin',             'penicillin',     'bacterial_infection', 60,   200, '{}',           '{}'),
  ('00000000-0000-4000-9000-000000000002', 'Augmentin 875mg',          'amoxicillin-clavulanate', 'penicillin',     'bacterial_infection', 150,  60,  '{}',           '{}'),
  ('00000000-0000-4000-9000-000000000003', 'Cephalexin 500mg',         'cephalexin',              'cephalosporin',  'bacterial_infection', 70,   80,  '{penicillin}', '{}'),
  ('00000000-0000-4000-9000-000000000004', 'Azithromycin 250mg',       'azithromycin',            'macrolide',      'bacterial_infection', 400,  25,  '{}',           '{warfarin}'),
  ('00000000-0000-4000-9000-000000000005', 'Doxycycline 100mg',        'doxycycline',             'tetracycline',   'bacterial_infection', 90,   0,   '{}',           '{}'),
  ('00000000-0000-4000-9000-000000000006', 'Ibuprofen 400mg',          'ibuprofen',               'nsaid',          'pain',                20,   100, '{}',           '{warfarin,lisinopril}'),
  ('00000000-0000-4000-9000-000000000007', 'Acetaminophen 500mg',      'acetaminophen',           'analgesic',      'pain',                15,   300, '{}',           '{}'),
  ('00000000-0000-4000-9000-000000000008', 'Cetirizine 10mg',          'cetirizine',              'antihistamine',  'allergy',             25,   60,  '{}',           '{}'),
  ('00000000-0000-4000-9000-000000000009', 'Benzonatate 100mg',        'benzonatate',             'antitussive',    'cough',               40,   0,   '{}',           '{}'),
  ('00000000-0000-4000-9000-000000000010', 'Dextromethorphan Syrup',   'dextromethorphan',        'antitussive',    'cough',               900,  30,  '{}',           '{}'),
  ('00000000-0000-4000-9000-000000000011', 'Fluticasone Nasal Spray',  'fluticasone',             'corticosteroid', 'nasal_congestion',    1800, 25,  '{}',           '{}'),
  ('00000000-0000-4000-9000-000000000012', 'Albuterol Inhaler',        'albuterol',               'bronchodilator', 'asthma',              2500, 15,  '{}',           '{}')
on conflict (id) do update set
  name = excluded.name, generic = excluded.generic, drug_class = excluded.drug_class, indication = excluded.indication,
  price_cents = excluded.price_cents, stock_qty = excluded.stock_qty, allergens = excluded.allergens, interacts_with = excluded.interacts_with;

-- Payer data for Ivy (needs 0002_insurance.sql). The clinic is facility 'agent-clinic'; its doctor of record is NPI 1000000001.
-- Jane: active, in network, part of the deductible met.  Sam: clinic in network, doctor out of network → partial.
-- Maria: terminated → denied.  Leo: visit limit used up → partial.
insert into insurance_plans (id, payer, plan_name, group_number, coverage_pct_visit, coverage_pct_procedure, coverage_pct_rx, copay_cents, deductible_cents, oop_max_cents, effective_from, effective_to) values
  ('acme-silver',     'Acme Health',      'Acme Health Silver', 'GRP-7781', 80, 70, 60, 2500, 150000, 500000, '2026-01-01', '2026-12-31'),
  ('bluepeak-bronze', 'Blue Peak Health', 'Blue Peak Bronze',   'BPK-0042', 60, 60, 50, 4000, 300000, 800000, '2026-01-01', '2026-12-31')
on conflict (id) do update set
  payer = excluded.payer, plan_name = excluded.plan_name, group_number = excluded.group_number,
  coverage_pct_visit = excluded.coverage_pct_visit, coverage_pct_procedure = excluded.coverage_pct_procedure, coverage_pct_rx = excluded.coverage_pct_rx,
  copay_cents = excluded.copay_cents, deductible_cents = excluded.deductible_cents, oop_max_cents = excluded.oop_max_cents,
  effective_from = excluded.effective_from, effective_to = excluded.effective_to;

insert into insurance_members (member_id, plan_id, full_name, dob, status, deductible_met_cents, oop_spent_cents, annual_visit_limit, visits_used) values
  ('ACM-449-2210', 'acme-silver',     'Jane Doe',     '1990-04-12', 'active',     90000,  120000, 20,   3),
  ('ACM-449-3307', 'acme-silver',     'Maria Garcia', '1985-09-30', 'terminated', 0,      0,      20,   0),
  ('ACM-449-5120', 'acme-silver',     'Leo Park',     '2001-02-14', 'active',     150000, 210000, 6,    6),
  ('BPK-100-2001', 'bluepeak-bronze', 'Sam Rivera',   '1978-11-03', 'active',     50000,  50000,  null, 1)
on conflict (member_id) do update set
  plan_id = excluded.plan_id, full_name = excluded.full_name, dob = excluded.dob, status = excluded.status,
  deductible_met_cents = excluded.deductible_met_cents, oop_spent_cents = excluded.oop_spent_cents,
  annual_visit_limit = excluded.annual_visit_limit, visits_used = excluded.visits_used;

insert into network_providers (plan_id, provider_type, provider_key, name, in_network) values
  ('acme-silver',     'facility', 'agent-clinic', 'Agent Clinic',            true),
  ('acme-silver',     'doctor',   '1000000001',   'Clinic doctor of record', true),
  ('bluepeak-bronze', 'facility', 'agent-clinic', 'Agent Clinic',            true),
  ('bluepeak-bronze', 'doctor',   '1000000001',   'Clinic doctor of record', false)
on conflict (plan_id, provider_type, provider_key) do update set name = excluded.name, in_network = excluded.in_network;
