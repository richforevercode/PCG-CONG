-- Configurable age-based membership classification.
-- The calculated age and group are intentionally not stored on members: both
-- are derived from date_of_birth, current_date, gender, and these live rules.

alter table public.members
add column if not exists date_of_birth date;

create or replace function public.validate_member_date_of_birth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > current_date then
    raise exception using
      errcode = '23514',
      message = 'Date of birth cannot be in the future.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_member_date_of_birth_trigger on public.members;
create trigger validate_member_date_of_birth_trigger
before insert or update of date_of_birth on public.members
for each row execute function public.validate_member_date_of_birth();

create index if not exists members_date_of_birth_idx
on public.members (date_of_birth)
where date_of_birth is not null;

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

create unique index if not exists generational_groups_name_unique_idx
on public.generational_groups (lower(name));

create index if not exists generational_groups_rule_idx
on public.generational_groups (status, minimum_age, maximum_age, gender);

create or replace function public.validate_generational_group_rule()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  conflicting_group_name text;
begin
  new.name := trim(new.name);
  new.description := trim(coalesce(new.description, ''));

  if new.name = '' then
    raise exception using
      errcode = '23514',
      message = 'Generational group name is required.';
  end if;

  if new.maximum_age is not null and new.maximum_age < new.minimum_age then
    raise exception using
      errcode = '23514',
      message = 'Maximum age must be greater than or equal to minimum age.';
  end if;

  if new.status = 'Active' then
    -- Serialize rule writes so two concurrent requests cannot both pass the
    -- overlap check before either transaction commits.
    perform pg_advisory_xact_lock(764329810527);

    select existing.name
    into conflicting_group_name
    from public.generational_groups as existing
    where existing.status = 'Active'
      and existing.id <> new.id
      and (new.maximum_age is null or existing.minimum_age <= new.maximum_age)
      and (existing.maximum_age is null or new.minimum_age <= existing.maximum_age)
      and (
        new.gender = 'All'
        or existing.gender = 'All'
        or new.gender = existing.gender
      )
    order by existing.minimum_age, existing.name
    limit 1;

    if conflicting_group_name is not null then
      raise exception using
        errcode = '23514',
        message = format(
          'The rule for "%s" overlaps with active group "%s". Age boundaries are inclusive; adjust the age range or gender.',
          new.name,
          conflicting_group_name
        );
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_generational_group_rule_trigger on public.generational_groups;
create trigger validate_generational_group_rule_trigger
before insert or update on public.generational_groups
for each row execute function public.validate_generational_group_rule();

insert into public.generational_groups
  (name, minimum_age, maximum_age, gender, status, description)
select seed.name, seed.minimum_age, seed.maximum_age, seed.gender, 'Active', seed.description
from (values
  ('Children Service', 0, 11, 'All', 'Age-based classification for children.'),
  ('Junior Youth (JY)', 12, 17, 'All', 'Age-based classification for junior youth.'),
  ('Young People''s Guild (YPG)', 18, 29, 'All', 'Age-based classification for young people.'),
  ('Young Adult Fellowship (YAF)', 30, 39, 'All', 'Age-based classification for young adults.'),
  ('Men''s Fellowship', 40, null::integer, 'Male', 'Age-based classification for adult men.'),
  ('Women''s Fellowship', 40, null::integer, 'Female', 'Age-based classification for adult women.')
) as seed(name, minimum_age, maximum_age, gender, description)
where not exists (
  select 1
  from public.generational_groups existing
  where lower(existing.name) = lower(seed.name)
    or (
      existing.status = 'Active'
      and (seed.maximum_age is null or existing.minimum_age <= seed.maximum_age)
      and (existing.maximum_age is null or seed.minimum_age <= existing.maximum_age)
      and (seed.gender = 'All' or existing.gender = 'All' or seed.gender = existing.gender)
    )
)
on conflict do nothing;

create or replace function public.protect_generational_group_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'Active' and exists (
    select 1
    from public.members as member
    where member.date_of_birth is not null
      and member.date_of_birth <= current_date
      and extract(year from age(current_date, member.date_of_birth))::integer >= old.minimum_age
      and (
        old.maximum_age is null
        or extract(year from age(current_date, member.date_of_birth))::integer <= old.maximum_age
      )
      and (old.gender = 'All' or member.gender = old.gender)
  ) then
    raise exception using
      errcode = '23503',
      message = format(
        'Group "%s" currently classifies one or more members. Deactivate it before deleting it.',
        old.name
      );
  end if;

  return old;
end;
$$;

drop trigger if exists protect_generational_group_in_use_trigger on public.generational_groups;
create trigger protect_generational_group_in_use_trigger
before delete on public.generational_groups
for each row execute function public.protect_generational_group_in_use();

alter table public.generational_groups enable row level security;

grant select, insert, update, delete on public.generational_groups to authenticated;

drop policy if exists "active users read generational groups" on public.generational_groups;
create policy "active users read generational groups"
on public.generational_groups for select to authenticated
using (
  public.current_user_has_permission('members.view')
  or public.current_user_has_permission('settings.manage')
);

drop policy if exists "settings administrators create generational groups" on public.generational_groups;
create policy "settings administrators create generational groups"
on public.generational_groups for insert to authenticated
with check (public.current_user_has_permission('settings.manage'));

drop policy if exists "settings administrators update generational groups" on public.generational_groups;
create policy "settings administrators update generational groups"
on public.generational_groups for update to authenticated
using (public.current_user_has_permission('settings.manage'))
with check (public.current_user_has_permission('settings.manage'));

drop policy if exists "settings administrators delete generational groups" on public.generational_groups;
create policy "settings administrators delete generational groups"
on public.generational_groups for delete to authenticated
using (public.current_user_has_permission('settings.manage'));

revoke all on function public.validate_member_date_of_birth() from public;
revoke all on function public.validate_generational_group_rule() from public;
revoke all on function public.protect_generational_group_in_use() from public;
