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
