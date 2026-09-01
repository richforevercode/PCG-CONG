-- Permanent baptism and congregational life-event registers.

begin;

create table if not exists public.church_life_events (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  person_name text not null check (char_length(person_name) between 1 and 200),
  event_type text not null check (event_type in (
    'Baptism', 'Confirmation', 'Marriage', 'Child Dedication',
    'Reception into Membership', 'Transfer In', 'Transfer Out',
    'Funeral / Memorial'
  )),
  event_date date not null,
  date_of_birth date,
  location text not null default '' check (char_length(location) <= 200),
  officiant text not null default '' check (char_length(officiant) <= 200),
  register_number text not null check (char_length(register_number) between 1 and 100),
  certificate_number text not null default '' check (char_length(certificate_number) <= 100),
  baptism_type text check (baptism_type in ('Infant', 'Adult')),
  related_person_name text not null default '' check (char_length(related_person_name) <= 200),
  parents_guardians text not null default '' check (char_length(parents_guardians) <= 500),
  sponsors_witnesses text not null default '' check (char_length(sponsors_witnesses) <= 500),
  previous_congregation text not null default '' check (char_length(previous_congregation) <= 300),
  destination_congregation text not null default '' check (char_length(destination_congregation) <= 300),
  notes text not null default '' check (char_length(notes) <= 3000),
  status text not null default 'Recorded' check (status in ('Recorded', 'Voided')),
  void_reason text not null default '' check (char_length(void_reason) <= 500),
  voided_at timestamptz,
  voided_by uuid references public.user_profiles(id) on delete set null,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_of_birth is null or event_date >= date_of_birth),
  check (event_type = 'Baptism' or baptism_type is null),
  check (status = 'Recorded' or char_length(void_reason) > 0)
);

create unique index if not exists life_events_register_number_unique_idx
on public.church_life_events (lower(register_number));
create unique index if not exists life_events_certificate_number_unique_idx
on public.church_life_events (lower(certificate_number))
where certificate_number <> '';
create index if not exists life_events_member_idx on public.church_life_events (member_id, event_date desc);
create index if not exists life_events_type_date_idx on public.church_life_events (event_type, event_date desc);
create index if not exists life_events_person_idx on public.church_life_events (lower(person_name));

create or replace function public.prepare_church_life_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  new.person_name := btrim(new.person_name);
  new.location := btrim(coalesce(new.location, ''));
  new.officiant := btrim(coalesce(new.officiant, ''));
  new.register_number := btrim(new.register_number);
  new.certificate_number := btrim(coalesce(new.certificate_number, ''));
  new.related_person_name := btrim(coalesce(new.related_person_name, ''));
  new.parents_guardians := btrim(coalesce(new.parents_guardians, ''));
  new.sponsors_witnesses := btrim(coalesce(new.sponsors_witnesses, ''));
  new.previous_congregation := btrim(coalesce(new.previous_congregation, ''));
  new.destination_congregation := btrim(coalesce(new.destination_congregation, ''));
  new.notes := btrim(coalesce(new.notes, ''));
  new.void_reason := btrim(coalesce(new.void_reason, ''));

  if new.event_type <> 'Baptism' then
    new.baptism_type := null;
  elsif new.baptism_type is null then
    raise exception 'Select whether the baptism is infant or adult.';
  end if;

  if new.event_type = 'Marriage' and new.related_person_name = '' then
    raise exception 'Enter the spouse name for a marriage record.';
  end if;

  if new.status = 'Voided' then
    if new.void_reason = '' then
      raise exception 'A reason is required to void a register record.';
    end if;
    if tg_op = 'INSERT' or old.status <> 'Voided' then
      new.voided_at := now();
      new.voided_by := auth.uid();
    else
      new.voided_at := old.voided_at;
      new.voided_by := old.voided_by;
    end if;
  else
    new.void_reason := '';
    new.voided_at := null;
    new.voided_by := null;
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists church_life_event_prepare on public.church_life_events;
create trigger church_life_event_prepare
before insert or update on public.church_life_events
for each row execute function public.prepare_church_life_event();

alter table public.church_life_events enable row level security;

revoke all on public.church_life_events from anon, authenticated;
grant select, insert, update on public.church_life_events to authenticated;

create policy "register viewers read life events"
on public.church_life_events for select to authenticated
using (public.current_user_has_permission('registers.view'));

create policy "register managers create life events"
on public.church_life_events for insert to authenticated
with check (public.current_user_has_permission('registers.manage'));

create policy "register managers update life events"
on public.church_life_events for update to authenticated
using (public.current_user_has_permission('registers.manage'))
with check (public.current_user_has_permission('registers.manage'));

update public.app_roles
set permissions = array(
      select distinct permission
      from unnest(permissions || array['members.view', 'registers.view', 'registers.manage']) permission
    ),
    updated_at = now()
where name in ('Super Administrator', 'Administrator', 'Minister / Pastor', 'Secretary');

revoke all on function public.prepare_church_life_event() from public;

notify pgrst, 'reload schema';

commit;
