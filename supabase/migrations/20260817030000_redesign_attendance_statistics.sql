-- Redesign attendance_records as a church service statistics register.
-- Existing aggregate records are preserved. Their original adults, children,
-- and visitors values remain as legacy unclassified counts in generated totals.

alter table public.attendance_records
  add column if not exists occasion_type text,
  add column if not exists adult_male integer not null default 0,
  add column if not exists adult_female integer not null default 0,
  add column if not exists junior_youth_boys integer not null default 0,
  add column if not exists junior_youth_girls integer not null default 0,
  add column if not exists children_boys integer not null default 0,
  add column if not exists children_girls integer not null default 0,
  add column if not exists visitor_male integer not null default 0,
  add column if not exists visitor_female integer not null default 0,
  add column if not exists include_visitors boolean not null default true,
  add column if not exists recorded_by uuid references public.user_profiles(id) on delete set null,
  add column if not exists recorded_by_name text not null default 'Administrator',
  add column if not exists updated_at timestamptz not null default now();

update public.attendance_records
set occasion_type = coalesce(nullif(trim(occasion_type), ''), service_name)
where occasion_type is null or trim(occasion_type) = '';

alter table public.attendance_records
  alter column occasion_type set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_adult_male_nonnegative') then
    alter table public.attendance_records add constraint attendance_adult_male_nonnegative check (adult_male >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_adult_female_nonnegative') then
    alter table public.attendance_records add constraint attendance_adult_female_nonnegative check (adult_female >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_jy_boys_nonnegative') then
    alter table public.attendance_records add constraint attendance_jy_boys_nonnegative check (junior_youth_boys >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_jy_girls_nonnegative') then
    alter table public.attendance_records add constraint attendance_jy_girls_nonnegative check (junior_youth_girls >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_children_boys_nonnegative') then
    alter table public.attendance_records add constraint attendance_children_boys_nonnegative check (children_boys >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_children_girls_nonnegative') then
    alter table public.attendance_records add constraint attendance_children_girls_nonnegative check (children_girls >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_visitor_male_nonnegative') then
    alter table public.attendance_records add constraint attendance_visitor_male_nonnegative check (visitor_male >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_visitor_female_nonnegative') then
    alter table public.attendance_records add constraint attendance_visitor_female_nonnegative check (visitor_female >= 0);
  end if;
end;
$$;

alter table public.attendance_records
  add column if not exists adult_total integer generated always as
    (adults + adult_male + adult_female) stored,
  add column if not exists junior_youth_total integer generated always as
    (junior_youth_boys + junior_youth_girls) stored,
  add column if not exists children_total integer generated always as
    (children + children_boys + children_girls) stored,
  add column if not exists visitor_total integer generated always as
    (visitors + visitor_male + visitor_female) stored,
  add column if not exists male_boys_total integer generated always as
    (adult_male + junior_youth_boys + children_boys) stored,
  add column if not exists female_girls_total integer generated always as
    (adult_female + junior_youth_girls + children_girls) stored,
  add column if not exists regular_total integer generated always as
    (adults + adult_male + adult_female
      + junior_youth_boys + junior_youth_girls
      + children + children_boys + children_girls) stored,
  add column if not exists grand_total integer generated always as
    (adults + adult_male + adult_female
      + junior_youth_boys + junior_youth_girls
      + children + children_boys + children_girls
      + case when include_visitors then visitors + visitor_male + visitor_female else 0 end) stored;

create index if not exists attendance_occasion_date_idx
on public.attendance_records (lower(service_name), service_date desc);

create index if not exists attendance_occasion_type_idx
on public.attendance_records (occasion_type, service_date desc);

create or replace function public.prepare_service_attendance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recorder_name text;
  duplicate_id uuid;
  lock_key text;
begin
  new.service_name := trim(new.service_name);
  new.occasion_type := trim(new.occasion_type);

  if new.service_date is null then
    raise exception 'Attendance date is required.';
  end if;
  if new.service_date > current_date then
    raise exception 'Attendance cannot be recorded for a future date.';
  end if;
  if new.service_name = '' or new.occasion_type = '' then
    raise exception 'An occasion or service is required.';
  end if;

  lock_key := new.service_date::text || '|' || lower(new.service_name);
  perform pg_advisory_xact_lock(hashtext(lock_key));
  select record.id into duplicate_id
  from public.attendance_records record
  where record.service_date = new.service_date
    and lower(trim(record.service_name)) = lower(new.service_name)
    and (tg_op = 'INSERT' or record.id <> new.id)
  limit 1;
  if duplicate_id is not null then
    raise exception using
      errcode = '23505',
      message = 'Attendance already exists for this date and occasion.';
  end if;

  if tg_op = 'INSERT' and auth.uid() is not null then
    new.recorded_by := auth.uid();
    select nullif(trim(profile.display_name), '') into recorder_name
    from public.user_profiles profile where profile.id = auth.uid();
    new.recorded_by_name := coalesce(recorder_name, 'Administrator');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prepare_service_attendance_record_trigger
on public.attendance_records;
create trigger prepare_service_attendance_record_trigger
before insert or update on public.attendance_records
for each row execute function public.prepare_service_attendance_record();

alter table public.attendance_records enable row level security;
grant select, insert, update, delete on public.attendance_records to authenticated;

drop policy if exists "authenticated attendance access" on public.attendance_records;
drop policy if exists "attendance read access" on public.attendance_records;
drop policy if exists "attendance create access" on public.attendance_records;
drop policy if exists "attendance update access" on public.attendance_records;
drop policy if exists "attendance delete access" on public.attendance_records;

create policy "attendance read access"
on public.attendance_records for select to authenticated
using (public.current_user_has_permission('attendance.view'));

create policy "attendance create access"
on public.attendance_records for insert to authenticated
with check (public.current_user_has_permission('attendance.manage'));

create policy "attendance update access"
on public.attendance_records for update to authenticated
using (public.current_user_has_permission('attendance.manage'))
with check (public.current_user_has_permission('attendance.manage'));

create policy "attendance delete access"
on public.attendance_records for delete to authenticated
using (public.current_user_has_permission('attendance.manage'));

revoke all on function public.prepare_service_attendance_record() from public;

notify pgrst, 'reload schema';
