-- Payer data Ivy verifies against: plans, members (with this year's accumulators) and each plan's network.
-- Additive: run after 0001_init.sql, then supabase/seed.sql.

drop table if exists network_providers, insurance_members, insurance_plans cascade;

create table insurance_plans (
  id text primary key,                                   -- e.g. 'acme-silver'
  payer text not null,
  plan_name text not null,
  group_number text,
  coverage_pct_visit integer not null check (coverage_pct_visit between 0 and 100),
  coverage_pct_procedure integer not null check (coverage_pct_procedure between 0 and 100),
  coverage_pct_rx integer not null check (coverage_pct_rx between 0 and 100),
  copay_cents integer not null default 0 check (copay_cents >= 0),
  deductible_cents integer not null default 0 check (deductible_cents >= 0),
  oop_max_cents integer not null default 0 check (oop_max_cents >= 0),
  effective_from date not null,
  effective_to date                                       -- null = open-ended
);

create table insurance_members (
  member_id text primary key,
  plan_id text not null references insurance_plans(id),
  full_name text not null,
  dob date not null,
  status text not null default 'active' check (status in ('active','terminated','suspended')),
  deductible_met_cents integer not null default 0 check (deductible_met_cents >= 0),
  oop_spent_cents integer not null default 0 check (oop_spent_cents >= 0),
  annual_visit_limit integer check (annual_visit_limit >= 0), -- null = unlimited
  visits_used integer not null default 0 check (visits_used >= 0)
);

create table network_providers (
  plan_id text not null references insurance_plans(id),
  provider_type text not null check (provider_type in ('facility','doctor')),
  provider_key text not null,                             -- facility id or doctor NPI
  name text not null,
  in_network boolean not null,
  primary key (plan_id, provider_type, provider_key)
);

alter table insurance_plans enable row level security;
alter table insurance_members enable row level security;
alter table network_providers enable row level security;
