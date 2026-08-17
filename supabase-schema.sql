-- Presbyterian Church of Ghana — Resurrection Congregation
-- Run this entire file in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  gender text not null check (gender in ('Female', 'Male')),
  phone text not null,
  email text,
  group_name text,
  role text not null default 'Member',
  status text not null default 'Active' check (status in ('Active', 'Visitor', 'Inactive')),
  joined_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.generational_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  minimum_age integer not null check (minimum_age >= 0),
  maximum_age integer check (maximum_age is null or maximum_age >= minimum_age),
  gender text not null default 'All' check (gender in ('All', 'Male', 'Female')),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.generational_groups
  (name, minimum_age, maximum_age, gender, status, description)
values
  ('Children Service', 0, 11, 'All', 'Active', 'Age-based classification for children.'),
  ('Junior Youth (JY)', 12, 17, 'All', 'Active', 'Age-based classification for junior youth.'),
  ('Young People''s Guild (YPG)', 18, 29, 'All', 'Active', 'Age-based classification for young people.'),
  ('Young Adult Fellowship (YAF)', 30, 39, 'All', 'Active', 'Age-based classification for young adults.'),
  ('Men''s Fellowship', 40, null, 'Male', 'Active', 'Age-based classification for adult men.'),
  ('Women''s Fellowship', 40, null, 'Female', 'Active', 'Age-based classification for adult women.')
on conflict do nothing;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_date date not null default current_date,
  description text not null,
  fund text not null default 'General Fund',
  type text not null check (type in ('Income', 'Expense')),
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  start_time time not null,
  location text not null,
  type text not null check (type in ('Worship', 'Meeting', 'Outreach', 'Fellowship')),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  service_name text not null,
  service_date date not null default current_date,
  adults integer not null default 0 check (adults >= 0),
  children integer not null default 0 check (children >= 0),
  visitors integer not null default 0 check (visitors >= 0),
  created_at timestamptz not null default now()
);

create index if not exists members_name_idx on public.members (last_name, first_name);
create index if not exists members_date_of_birth_idx on public.members (date_of_birth) where date_of_birth is not null;
create unique index if not exists generational_groups_name_unique_idx on public.generational_groups (lower(name));
create index if not exists generational_groups_rule_idx on public.generational_groups (status, minimum_age, maximum_age, gender);
create index if not exists transactions_date_idx on public.transactions (transaction_date desc);
create index if not exists events_date_idx on public.events (event_date);
create index if not exists attendance_service_date_idx on public.attendance_records (service_date desc);

alter table public.members enable row level security;
alter table public.generational_groups enable row level security;
alter table public.transactions enable row level security;
alter table public.events enable row level security;
alter table public.attendance_records enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.generational_groups to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;

-- Access policies are intentionally installed by the versioned migrations in
-- supabase/migrations. Run `npx supabase db push` after linking the project.
-- This avoids granting every authenticated account unrestricted access.
