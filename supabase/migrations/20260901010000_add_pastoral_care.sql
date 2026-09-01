-- Structured pastoral care cases, assignments, and follow-up activity.

begin;

create table if not exists public.pastoral_care_cases (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  care_type text not null check (care_type in (
    'Visitor Follow-up', 'Inactive Member Follow-up', 'Home Visitation',
    'Hospital Visit', 'Prayer Request', 'Counselling', 'Bereavement',
    'Welfare Support', 'General Pastoral Care', 'Other'
  )),
  priority text not null default 'Normal' check (priority in ('Normal', 'High', 'Urgent')),
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Completed', 'Closed')),
  summary text not null check (char_length(summary) between 1 and 1000),
  assigned_to uuid references public.user_profiles(id) on delete set null,
  opened_on date not null default current_date,
  next_follow_up_date date,
  completed_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pastoral_care_activities (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.pastoral_care_cases(id) on delete cascade,
  activity_date date not null default current_date,
  activity_type text not null check (activity_type in (
    'Phone Call', 'Home Visit', 'Hospital Visit', 'Church Meeting',
    'Prayer', 'Message', 'Referral', 'Welfare Support', 'Note', 'Other'
  )),
  outcome text not null default '' check (char_length(outcome) <= 500),
  notes text not null default '' check (char_length(notes) <= 5000),
  next_follow_up_date date,
  is_confidential boolean not null default false,
  recorded_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pastoral_cases_member_idx on public.pastoral_care_cases (member_id, status);
create index if not exists pastoral_cases_assignee_idx on public.pastoral_care_cases (assigned_to, status);
create index if not exists pastoral_cases_follow_up_idx on public.pastoral_care_cases (next_follow_up_date) where status in ('Open', 'In Progress');
create index if not exists pastoral_activities_case_idx on public.pastoral_care_activities (case_id, activity_date desc, created_at desc);

create or replace function public.prepare_pastoral_care_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assignee_is_active_staff boolean;
begin
  new.summary := btrim(new.summary);
  if new.assigned_to is not null then
    select exists (
      select 1
      from public.user_profiles profile
      join public.app_roles role on role.id = profile.role_id
      where profile.id = new.assigned_to
        and profile.status = 'active'
        and role.name <> 'Member'
        and 'pastoral.view' = any(role.permissions)
    ) into assignee_is_active_staff;
    if not assignee_is_active_staff then
      raise exception 'Pastoral cases can be assigned only to an active staff account.';
    end if;
  end if;
  if new.status in ('Completed', 'Closed') then
    new.completed_at := coalesce(new.completed_at, now());
    new.next_follow_up_date := null;
  else
    new.completed_at := null;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.prepare_pastoral_care_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.outcome := btrim(coalesce(new.outcome, ''));
  new.notes := btrim(coalesce(new.notes, ''));
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.sync_pastoral_case_follow_up()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.next_follow_up_date is not null then
    update public.pastoral_care_cases
    set next_follow_up_date = new.next_follow_up_date,
        status = case when status = 'Open' then 'In Progress' else status end
    where id = new.case_id and status not in ('Completed', 'Closed');
  end if;
  return new;
end;
$$;

drop trigger if exists pastoral_case_prepare on public.pastoral_care_cases;
create trigger pastoral_case_prepare
before insert or update on public.pastoral_care_cases
for each row execute function public.prepare_pastoral_care_case();

drop trigger if exists pastoral_activity_prepare on public.pastoral_care_activities;
create trigger pastoral_activity_prepare
before insert or update on public.pastoral_care_activities
for each row execute function public.prepare_pastoral_care_activity();

drop trigger if exists pastoral_activity_sync_follow_up on public.pastoral_care_activities;
create trigger pastoral_activity_sync_follow_up
after insert or update of next_follow_up_date on public.pastoral_care_activities
for each row execute function public.sync_pastoral_case_follow_up();

create or replace function public.list_pastoral_caregivers()
returns table (user_id uuid, display_name text, role_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.current_user_has_permission('pastoral.view') then
    raise exception 'Pastoral care access is required.';
  end if;
  return query
  select profile.id, profile.display_name, role.name
  from public.user_profiles profile
  join public.app_roles role on role.id = profile.role_id
  where profile.status = 'active'
    and role.name <> 'Member'
    and 'pastoral.view' = any(role.permissions)
  order by profile.display_name;
end;
$$;

alter table public.pastoral_care_cases enable row level security;
alter table public.pastoral_care_activities enable row level security;

revoke all on public.pastoral_care_cases, public.pastoral_care_activities from anon, authenticated;
grant select, insert, update, delete on public.pastoral_care_cases, public.pastoral_care_activities to authenticated;

create policy "pastoral viewers read cases"
on public.pastoral_care_cases for select to authenticated
using (public.current_user_has_permission('pastoral.view'));

create policy "pastoral managers create cases"
on public.pastoral_care_cases for insert to authenticated
with check (public.current_user_has_permission('pastoral.manage'));

create policy "pastoral managers update cases"
on public.pastoral_care_cases for update to authenticated
using (public.current_user_has_permission('pastoral.manage'))
with check (public.current_user_has_permission('pastoral.manage'));

create policy "pastoral managers delete cases"
on public.pastoral_care_cases for delete to authenticated
using (public.current_user_has_permission('pastoral.manage'));

create policy "pastoral viewers read permitted activities"
on public.pastoral_care_activities for select to authenticated
using (
  public.current_user_has_permission('pastoral.view')
  and (not is_confidential or public.current_user_has_permission('pastoral.confidential'))
);

create policy "pastoral managers create permitted activities"
on public.pastoral_care_activities for insert to authenticated
with check (
  public.current_user_has_permission('pastoral.manage')
  and (not is_confidential or public.current_user_has_permission('pastoral.confidential'))
);

create policy "pastoral managers update permitted activities"
on public.pastoral_care_activities for update to authenticated
using (
  public.current_user_has_permission('pastoral.manage')
  and (not is_confidential or public.current_user_has_permission('pastoral.confidential'))
)
with check (
  public.current_user_has_permission('pastoral.manage')
  and (not is_confidential or public.current_user_has_permission('pastoral.confidential'))
);

create policy "pastoral managers delete permitted activities"
on public.pastoral_care_activities for delete to authenticated
using (
  public.current_user_has_permission('pastoral.manage')
  and (not is_confidential or public.current_user_has_permission('pastoral.confidential'))
);

update public.app_roles
set permissions = array(
      select distinct permission
      from unnest(permissions || array['members.view', 'pastoral.view', 'pastoral.manage', 'pastoral.confidential']) permission
    ),
    updated_at = now()
where name in ('Super Administrator', 'Administrator', 'Minister / Pastor');

update public.app_roles
set permissions = array(
      select distinct permission
      from unnest(permissions || array['members.view', 'pastoral.view', 'pastoral.manage']) permission
    ),
    updated_at = now()
where name = 'Secretary';

revoke all on function public.prepare_pastoral_care_case() from public;
revoke all on function public.prepare_pastoral_care_activity() from public;
revoke all on function public.sync_pastoral_case_follow_up() from public;
revoke all on function public.list_pastoral_caregivers() from public, anon;
grant execute on function public.list_pastoral_caregivers() to authenticated;

notify pgrst, 'reload schema';

commit;
