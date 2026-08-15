-- Live service attendance for dashboard participation insights.

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  service_name text not null,
  service_date date not null default current_date,
  adults integer not null default 0 check (adults >= 0),
  children integer not null default 0 check (children >= 0),
  visitors integer not null default 0 check (visitors >= 0),
  created_at timestamptz not null default now()
);

create index if not exists attendance_service_date_idx
on public.attendance_records (service_date desc);

alter table public.attendance_records enable row level security;

grant select, insert, update, delete on public.attendance_records to authenticated;

drop policy if exists "authenticated attendance access" on public.attendance_records;
create policy "authenticated attendance access"
on public.attendance_records
for all to authenticated
using (true)
with check (true);
