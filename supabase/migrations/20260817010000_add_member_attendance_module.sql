-- Member-level attendance linked to the existing members and events tables.
-- The older attendance_records table remains intact because it contains
-- historical aggregate service totals (adults, children, and visitors).

create table if not exists public.member_attendance_records (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  attendance_date date not null default current_date,
  status text not null check (status in ('Present', 'Absent', 'Excused')),
  recorded_by uuid references public.user_profiles(id) on delete set null,
  recorded_by_name text not null default 'Administrator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_attendance_member_event_date_key
    unique (member_id, event_id, attendance_date)
);

create index if not exists member_attendance_date_idx
on public.member_attendance_records (attendance_date desc);

create index if not exists member_attendance_event_date_idx
on public.member_attendance_records (event_id, attendance_date desc);

create index if not exists member_attendance_status_date_idx
on public.member_attendance_records (status, attendance_date desc);

create index if not exists member_attendance_member_idx
on public.member_attendance_records (member_id);

create or replace function public.prepare_member_attendance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recorder_name text;
begin
  if new.attendance_date > current_date then
    raise exception using
      errcode = '23514',
      message = 'Attendance cannot be recorded for a future date.';
  end if;

  if auth.uid() is not null then
    new.recorded_by := auth.uid();

    select nullif(trim(profile.display_name), '')
    into recorder_name
    from public.user_profiles as profile
    where profile.id = auth.uid();

    new.recorded_by_name := coalesce(recorder_name, 'Administrator');
  else
    new.recorded_by_name := coalesce(nullif(trim(new.recorded_by_name), ''), 'Administrator');
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prepare_member_attendance_record_trigger
on public.member_attendance_records;

create trigger prepare_member_attendance_record_trigger
before insert or update on public.member_attendance_records
for each row execute function public.prepare_member_attendance_record();

alter table public.member_attendance_records enable row level security;

grant select, insert, update, delete on public.member_attendance_records to authenticated;

drop policy if exists "attendance viewers read member records"
on public.member_attendance_records;
create policy "attendance viewers read member records"
on public.member_attendance_records for select to authenticated
using (public.current_user_has_permission('attendance.view'));

drop policy if exists "attendance managers create member records"
on public.member_attendance_records;
create policy "attendance managers create member records"
on public.member_attendance_records for insert to authenticated
with check (public.current_user_has_permission('attendance.manage'));

drop policy if exists "attendance managers update member records"
on public.member_attendance_records;
create policy "attendance managers update member records"
on public.member_attendance_records for update to authenticated
using (public.current_user_has_permission('attendance.manage'))
with check (public.current_user_has_permission('attendance.manage'));

drop policy if exists "attendance managers delete member records"
on public.member_attendance_records;
create policy "attendance managers delete member records"
on public.member_attendance_records for delete to authenticated
using (public.current_user_has_permission('attendance.manage'));

revoke all on function public.prepare_member_attendance_record() from public;

notify pgrst, 'reload schema';
