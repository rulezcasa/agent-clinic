-- Agent-run clinic schema (matches lib/types.ts and lib/db.ts).
-- ⚠️ Drops the existing clinic tables (integer-id version) and recreates them. Run supabase/seed.sql afterwards.

create extension if not exists pgcrypto;

drop table if exists memory_notes, messages, chat_sessions, visits, drugs, patients cascade;

create table patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  dob date not null,
  email text,
  phone text,
  allergies jsonb not null default '[]'::jsonb,   -- [{substance, severity: mild|moderate|severe, reaction}]
  insurance jsonb,                                -- {payer, member_id, plan, group_number}
  history text not null default '',               -- approved history only
  created_at timestamptz not null default now()
);
create index patients_email_idx on patients (lower(email));

create table drugs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  generic text not null,
  drug_class text not null,
  indication text not null default '',
  allergens text[] not null default '{}',
  interacts_with text[] not null default '{}',
  price_cents integer not null check (price_cents >= 0),   -- per unit (tablet, capsule, bottle, inhaler)
  stock_qty integer not null default 0 check (stock_qty >= 0)
);

create table visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id),
  status text not null default 'BOOKED' check (status in (
    'BOOKED','CHECKED_IN','IN_CONSULT','RX_DRAFTED','RX_FLAGGED','RX_PENDING_APPROVAL',
    'RX_APPROVED','DISPENSED','INVOICED','CLOSED','CANCELLED')),
  visit_type text not null default 'new_patient',
  reason text,
  slot_start timestamptz,
  cal_booking_uid text unique,
  identity_verified boolean not null default false,
  coverage_status text not null default 'NOT_STARTED' check (coverage_status in (
    'NOT_STARTED','PENDING','ACTIVE','PARTIAL','DENIED','ESCALATED')),
  coverage jsonb,
  consult_notes text,
  procedures text[] not null default '{}',
  rx jsonb,
  rx_safety jsonb,
  rx_approved_by text,
  rx_approved_at timestamptz,
  history_update text,
  history_update_approved boolean not null default false,
  dispensed jsonb,
  invoice jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visits_patient_idx on visits (patient_id);
create index visits_status_idx on visits (status);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id),
  visit_id uuid references visits(id),
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits(id),
  session_id uuid references chat_sessions(id),
  channel text not null check (channel in ('patient_chat','band','kylon','system')),
  sender text not null,
  recipient text,
  body text not null default '',
  payload jsonb,
  created_at timestamptz not null default now()
);
create index messages_visit_idx on messages (visit_id, created_at);
create index messages_session_idx on messages (session_id, created_at);

create table memory_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id),
  visit_id uuid references visits(id),
  note text not null,
  created_at timestamptz not null default now()
);
create index memory_notes_patient_idx on memory_notes (patient_id, created_at);

-- The backend uses the secret (service role) key, which bypasses RLS. RLS on = the publishable key reads nothing.
alter table patients enable row level security;
alter table drugs enable row level security;
alter table visits enable row level security;
alter table chat_sessions enable row level security;
alter table messages enable row level security;
alter table memory_notes enable row level security;
