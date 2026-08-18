-- Dedicated Communion records. Communion participation is intentionally
-- separate from service attendance and is never inferred from attendance data.

begin;

alter table public.members
  add column if not exists communicant_status text not null default 'Non-Communicant';

alter table public.members
  drop constraint if exists members_communicant_status_check;
alter table public.members
  add constraint members_communicant_status_check
  check (communicant_status in ('Communicant', 'Non-Communicant'));

create table if not exists public.communion_occasions (
  id uuid primary key default gen_random_uuid(),
  communion_date date not null default current_date,
  service_name text not null check (char_length(btrim(service_name)) between 1 and 120),
  event_id uuid references public.events(id) on delete set null,
  location text not null default '' check (char_length(location) <= 160),
  presiding_minister text not null check (char_length(btrim(presiding_minister)) between 1 and 160),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communion_participants (
  id uuid primary key default gen_random_uuid(),
  occasion_id uuid not null references public.communion_occasions(id) on delete cascade,
  person_type text not null check (person_type in ('Member', 'Visitor')),
  member_id uuid references public.members(id) on delete restrict,
  visitor_name text,
  communicant_status text not null check (communicant_status in ('Communicant', 'Non-Communicant', 'Unknown')),
  partook boolean not null default true,
  gender_snapshot text not null check (gender_snapshot in ('Female', 'Male')),
  generational_group_snapshot text not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  recorded_by uuid references public.user_profiles(id) on delete set null,
  recorded_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communion_participant_identity_check check (
    (person_type = 'Member' and member_id is not null and visitor_name is null)
    or
    (person_type = 'Visitor' and member_id is null and nullif(btrim(visitor_name), '') is not null)
  ),
  constraint communion_participation_eligibility_check check (
    not partook or communicant_status = 'Communicant'
  )
);

create index if not exists communion_occasions_date_idx
  on public.communion_occasions (communion_date desc);
create index if not exists communion_occasions_event_idx
  on public.communion_occasions (event_id) where event_id is not null;
create index if not exists communion_participants_occasion_idx
  on public.communion_participants (occasion_id, partook);
create index if not exists communion_participants_member_history_idx
  on public.communion_participants (member_id, occasion_id) where member_id is not null;
create unique index if not exists communion_participants_member_unique_idx
  on public.communion_participants (occasion_id, member_id) where member_id is not null;
create unique index if not exists communion_participants_visitor_unique_idx
  on public.communion_participants (occasion_id, lower(btrim(visitor_name))) where member_id is null;

create or replace function public.communion_group_for_member(
  target_member_id uuid,
  target_date date
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select groups.name
  from public.members member
  join public.generational_groups groups
    on groups.status = 'Active'
   and member.date_of_birth is not null
   and extract(year from age(target_date, member.date_of_birth))::integer >= groups.minimum_age
   and (groups.maximum_age is null or extract(year from age(target_date, member.date_of_birth))::integer <= groups.maximum_age)
   and (groups.gender = 'All' or groups.gender = member.gender)
  where member.id = target_member_id
    and member.date_of_birth <= target_date
  order by groups.minimum_age desc
  limit 1
$$;

create or replace function public.communion_group_is_ineligible(group_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(coalesce(group_name, '')), '[^a-z]+', '', 'g')
    in ('childrenservice', 'junioryouth', 'junioryouthjy')
$$;

create or replace function public.validate_member_communicant_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_group text;
begin
  if new.communicant_status = 'Communicant' then
    if new.date_of_birth is not null and new.date_of_birth <= current_date then
      select groups.name into current_group
      from public.generational_groups groups
      where groups.status = 'Active'
        and extract(year from age(current_date, new.date_of_birth))::integer >= groups.minimum_age
        and (groups.maximum_age is null or extract(year from age(current_date, new.date_of_birth))::integer <= groups.maximum_age)
        and (groups.gender = 'All' or groups.gender = new.gender)
      order by groups.minimum_age desc
      limit 1;
    end if;
    if current_group is null then
      raise exception 'A member must have a valid eligible adult generational group before being marked Communicant.';
    end if;
    if public.communion_group_is_ineligible(current_group) then
      raise exception '% members cannot be marked as Communicants.', current_group;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_member_communicant_status_trigger on public.members;
create trigger validate_member_communicant_status_trigger
before insert or update of communicant_status, date_of_birth, gender on public.members
for each row execute function public.validate_member_communicant_status();

create or replace function public.prepare_communion_occasion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recorder_name text;
begin
  new.service_name := btrim(new.service_name);
  new.location := btrim(coalesce(new.location, ''));
  new.presiding_minister := btrim(new.presiding_minister);
  new.notes := btrim(coalesce(new.notes, ''));
  if new.communion_date > current_date then
    raise exception 'Communion date cannot be in the future.';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    select coalesce(nullif(display_name, ''), email, 'Church officer')
      into recorder_name from public.user_profiles where id = auth.uid();
    new.created_by_name := coalesce(recorder_name, 'Church officer');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_communion_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_member public.members%rowtype;
  selected_occasion public.communion_occasions%rowtype;
  member_group text;
  recorder_name text;
begin
  select * into selected_occasion from public.communion_occasions where id = new.occasion_id;
  if not found then
    raise exception 'The selected Communion occasion no longer exists.';
  end if;

  new.notes := btrim(coalesce(new.notes, ''));
  if new.person_type = 'Member' then
    if new.member_id is null then
      raise exception 'Select a registered member.';
    end if;
    select * into selected_member from public.members where id = new.member_id;
    if not found then
      raise exception 'The selected member no longer exists.';
    end if;
    if tg_op = 'INSERT'
       or old.member_id is distinct from new.member_id
       or old.occasion_id is distinct from new.occasion_id
       or old.person_type is distinct from new.person_type then
      member_group := public.communion_group_for_member(selected_member.id, selected_occasion.communion_date);
      if member_group is null then
        raise exception 'The selected member has no valid generational group for this Communion date.';
      end if;
      new.communicant_status := selected_member.communicant_status;
      new.gender_snapshot := selected_member.gender;
      new.generational_group_snapshot := member_group;
    else
      new.communicant_status := old.communicant_status;
      new.gender_snapshot := old.gender_snapshot;
      new.generational_group_snapshot := old.generational_group_snapshot;
      member_group := old.generational_group_snapshot;
    end if;
    if new.partook and public.communion_group_is_ineligible(member_group) then
      raise exception '% members do not partake in Communion.', member_group;
    end if;
    if new.partook and new.communicant_status <> 'Communicant' then
      raise exception 'Only members with Communicant status can be recorded as having partaken.';
    end if;
    new.person_type := 'Member';
    new.visitor_name := null;
  else
    new.person_type := 'Visitor';
    new.member_id := null;
    new.visitor_name := nullif(btrim(coalesce(new.visitor_name, '')), '');
    if new.visitor_name is null then
      raise exception 'Enter the visitor or non-member full name.';
    end if;
    if new.partook and new.communicant_status <> 'Communicant' then
      raise exception 'A visitor or non-member must be an eligible Communicant to partake.';
    end if;
    new.generational_group_snapshot := 'Visitor / Non-Member';
  end if;

  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
    select coalesce(nullif(display_name, ''), email, 'Church officer')
      into recorder_name from public.user_profiles where id = auth.uid();
    new.recorded_by_name := coalesce(recorder_name, 'Church officer');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists communion_occasions_prepare on public.communion_occasions;
create trigger communion_occasions_prepare
before insert or update on public.communion_occasions
for each row execute function public.prepare_communion_occasion();

drop trigger if exists communion_participants_prepare on public.communion_participants;
create trigger communion_participants_prepare
before insert or update on public.communion_participants
for each row execute function public.prepare_communion_participant();

create or replace view public.communion_occasion_statistics
with (security_invoker = true)
as
select
  occasion.id as occasion_id,
  occasion.communion_date,
  occasion.service_name,
  count(participant.id) filter (where participant.partook)::integer as total_participants,
  count(participant.id) filter (where participant.partook and participant.gender_snapshot = 'Male')::integer as male_participants,
  count(participant.id) filter (where participant.partook and participant.gender_snapshot = 'Female')::integer as female_participants,
  count(participant.id) filter (where participant.partook and participant.person_type = 'Member')::integer as member_participants,
  count(participant.id) filter (where participant.partook and participant.person_type = 'Visitor')::integer as visitor_participants
from public.communion_occasions occasion
left join public.communion_participants participant on participant.occasion_id = occasion.id
group by occasion.id, occasion.communion_date, occasion.service_name;

grant select, insert, update, delete on public.communion_occasions, public.communion_participants to authenticated;
grant select on public.communion_occasion_statistics to authenticated;

alter table public.communion_occasions enable row level security;
alter table public.communion_participants enable row level security;

drop policy if exists "communion viewers read occasions" on public.communion_occasions;
create policy "communion viewers read occasions" on public.communion_occasions
for select to authenticated using (public.current_user_has_permission('communion.view'));
drop policy if exists "communion managers create occasions" on public.communion_occasions;
create policy "communion managers create occasions" on public.communion_occasions
for insert to authenticated with check (public.current_user_has_permission('communion.manage'));
drop policy if exists "communion managers update occasions" on public.communion_occasions;
create policy "communion managers update occasions" on public.communion_occasions
for update to authenticated using (public.current_user_has_permission('communion.manage'))
with check (public.current_user_has_permission('communion.manage'));
drop policy if exists "communion managers delete occasions" on public.communion_occasions;
create policy "communion managers delete occasions" on public.communion_occasions
for delete to authenticated using (public.current_user_has_permission('communion.manage'));

drop policy if exists "communion viewers read participants" on public.communion_participants;
create policy "communion viewers read participants" on public.communion_participants
for select to authenticated using (public.current_user_has_permission('communion.view'));
drop policy if exists "communion managers create participants" on public.communion_participants;
create policy "communion managers create participants" on public.communion_participants
for insert to authenticated with check (public.current_user_has_permission('communion.manage'));
drop policy if exists "communion managers update participants" on public.communion_participants;
create policy "communion managers update participants" on public.communion_participants
for update to authenticated using (public.current_user_has_permission('communion.manage'))
with check (public.current_user_has_permission('communion.manage'));
drop policy if exists "communion managers delete participants" on public.communion_participants;
create policy "communion managers delete participants" on public.communion_participants
for delete to authenticated using (public.current_user_has_permission('communion.manage'));

update public.app_roles
set permissions = array(select distinct permission from unnest(permissions || array['communion.view', 'communion.manage']) permission),
    updated_at = now()
where name in ('Super Administrator', 'Administrator', 'Secretary');

update public.app_roles
set permissions = array(select distinct permission from unnest(permissions || array['communion.view', 'members.view']) permission),
    updated_at = now()
where name = 'Minister / Pastor';

revoke all on function public.communion_group_for_member(uuid, date) from public;
revoke all on function public.communion_group_is_ineligible(text) from public;
revoke all on function public.validate_member_communicant_status() from public;
revoke all on function public.prepare_communion_occasion() from public;
revoke all on function public.prepare_communion_participant() from public;

notify pgrst, 'reload schema';

commit;
