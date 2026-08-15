-- Presbyterian Church of Ghana — Resurrection Congregation

create extension if not exists pgcrypto;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  gender text not null check (gender in ('Female', 'Male')),
  phone text not null,
  email text,
  group_name text,
  role text not null default 'Member',
  status text not null default 'Active' check (status in ('Active', 'Visitor', 'Inactive')),
  joined_at date not null default current_date,
  created_at timestamptz not null default now()
);

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
create index if not exists transactions_date_idx on public.transactions (transaction_date desc);
create index if not exists events_date_idx on public.events (event_date);
create index if not exists attendance_service_date_idx on public.attendance_records (service_date desc);

alter table public.members enable row level security;
alter table public.transactions enable row level security;
alter table public.events enable row level security;
alter table public.attendance_records enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;

drop policy if exists "authenticated members access" on public.members;
create policy "authenticated members access" on public.members for all to authenticated using (true) with check (true);
drop policy if exists "authenticated transactions access" on public.transactions;
create policy "authenticated transactions access" on public.transactions for all to authenticated using (true) with check (true);
drop policy if exists "authenticated events access" on public.events;
create policy "authenticated events access" on public.events for all to authenticated using (true) with check (true);
drop policy if exists "authenticated attendance access" on public.attendance_records;
create policy "authenticated attendance access" on public.attendance_records for all to authenticated using (true) with check (true);
