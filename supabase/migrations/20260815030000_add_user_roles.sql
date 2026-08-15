-- Role-based access control for Resurrection Congregation.
-- Existing Auth users are promoted to Super Administrator so the project owner
-- is not locked out when this migration is first applied.

create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_roles (name, description, permissions, is_system)
values
  (
    'Super Administrator',
    'Complete access to church records, users, roles, and system settings.',
    array[
      'dashboard.view', 'members.view', 'members.manage',
      'finance.view', 'finance.manage', 'events.view', 'events.manage',
      'attendance.view', 'attendance.manage', 'reports.view',
      'settings.manage', 'users.manage', 'roles.manage'
    ],
    true
  ),
  (
    'Administrator',
    'Manages church operations and user accounts, but cannot change roles.',
    array[
      'dashboard.view', 'members.view', 'members.manage',
      'finance.view', 'finance.manage', 'events.view', 'events.manage',
      'attendance.view', 'attendance.manage', 'reports.view',
      'settings.manage', 'users.manage'
    ],
    true
  ),
  (
    'Secretary',
    'Manages membership, programmes, attendance, and reports.',
    array[
      'dashboard.view', 'members.view', 'members.manage',
      'events.view', 'events.manage', 'attendance.view',
      'attendance.manage', 'reports.view'
    ],
    true
  ),
  (
    'Treasurer',
    'Manages financial records and views membership and reports.',
    array[
      'dashboard.view', 'members.view', 'finance.view',
      'finance.manage', 'reports.view'
    ],
    true
  ),
  (
    'Viewer',
    'Read-only access to ordinary church records.',
    array[
      'dashboard.view', 'members.view', 'finance.view',
      'events.view', 'attendance.view', 'reports.view'
    ],
    true
  )
on conflict (name) do update
set description = excluded.description,
    permissions = excluded.permissions,
    is_system = excluded.is_system,
    updated_at = now();

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  phone text not null default '',
  role_id uuid not null references public.app_roles(id),
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_role_idx on public.user_profiles(role_id);
create index if not exists user_profiles_status_idx on public.user_profiles(status);

insert into public.user_profiles (id, email, display_name, role_id, status)
select
  users.id,
  coalesce(users.email, ''),
  coalesce(users.raw_user_meta_data ->> 'display_name', split_part(coalesce(users.email, ''), '@', 1)),
  roles.id,
  'active'
from auth.users as users
cross join public.app_roles as roles
where roles.name = 'Super Administrator'
on conflict (id) do update
set email = excluded.email,
    display_name = case
      when public.user_profiles.display_name = '' then excluded.display_name
      else public.user_profiles.display_name
    end,
    status = 'active',
    updated_at = now();

create or replace function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_role_id uuid;
begin
  select id into default_role_id from public.app_roles where name = 'Viewer';
  insert into public.user_profiles (id, email, display_name, phone, role_id, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    default_role_id,
    'inactive'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.create_user_profile();

create or replace function public.current_user_has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles as profiles
    join public.app_roles as roles on roles.id = profiles.role_id
    where profiles.id = auth.uid()
      and profiles.status = 'active'
      and required_permission = any(roles.permissions)
  );
$$;

revoke all on function public.current_user_has_permission(text) from public;
grant execute on function public.current_user_has_permission(text) to authenticated;

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and status = 'active'
  );
$$;

revoke all on function public.current_user_is_active() from public;
grant execute on function public.current_user_is_active() to authenticated;

create or replace function public.update_own_profile(new_display_name text, new_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  update public.user_profiles
  set display_name = trim(new_display_name),
      phone = trim(coalesce(new_phone, '')),
      updated_at = now()
  where id = auth.uid() and status = 'active';
end;
$$;

revoke all on function public.update_own_profile(text, text) from public;
grant execute on function public.update_own_profile(text, text) to authenticated;

alter table public.app_roles enable row level security;
alter table public.user_profiles enable row level security;

grant select on public.app_roles to authenticated;
grant select on public.user_profiles to authenticated;
grant insert, update, delete on public.app_roles to authenticated;

drop policy if exists "active users read roles" on public.app_roles;
create policy "active users read roles"
on public.app_roles for select to authenticated
using (public.current_user_is_active());

drop policy if exists "super administrators create roles" on public.app_roles;
create policy "super administrators create roles"
on public.app_roles for insert to authenticated
with check (public.current_user_has_permission('roles.manage'));

drop policy if exists "super administrators update roles" on public.app_roles;
create policy "super administrators update roles"
on public.app_roles for update to authenticated
using (public.current_user_has_permission('roles.manage'))
with check (public.current_user_has_permission('roles.manage'));

drop policy if exists "super administrators delete custom roles" on public.app_roles;
create policy "super administrators delete custom roles"
on public.app_roles for delete to authenticated
using (public.current_user_has_permission('roles.manage') and not is_system);

drop policy if exists "users read own profile" on public.user_profiles;
create policy "users read own profile"
on public.user_profiles for select to authenticated
using (id = auth.uid() or public.current_user_has_permission('users.manage'));

-- Replace the broad authenticated policies with role-aware access.
drop policy if exists "authenticated members access" on public.members;
drop policy if exists "members read access" on public.members;
drop policy if exists "members create access" on public.members;
drop policy if exists "members update access" on public.members;
drop policy if exists "members delete access" on public.members;
create policy "members read access" on public.members for select to authenticated
using (public.current_user_has_permission('members.view'));
create policy "members create access" on public.members for insert to authenticated
with check (public.current_user_has_permission('members.manage'));
create policy "members update access" on public.members for update to authenticated
using (public.current_user_has_permission('members.manage'))
with check (public.current_user_has_permission('members.manage'));
create policy "members delete access" on public.members for delete to authenticated
using (public.current_user_has_permission('members.manage'));

drop policy if exists "authenticated transactions access" on public.transactions;
drop policy if exists "transactions read access" on public.transactions;
drop policy if exists "transactions create access" on public.transactions;
drop policy if exists "transactions update access" on public.transactions;
drop policy if exists "transactions delete access" on public.transactions;
create policy "transactions read access" on public.transactions for select to authenticated
using (public.current_user_has_permission('finance.view'));
create policy "transactions create access" on public.transactions for insert to authenticated
with check (public.current_user_has_permission('finance.manage'));
create policy "transactions update access" on public.transactions for update to authenticated
using (public.current_user_has_permission('finance.manage'))
with check (public.current_user_has_permission('finance.manage'));
create policy "transactions delete access" on public.transactions for delete to authenticated
using (public.current_user_has_permission('finance.manage'));

drop policy if exists "authenticated events access" on public.events;
drop policy if exists "events read access" on public.events;
drop policy if exists "events create access" on public.events;
drop policy if exists "events update access" on public.events;
drop policy if exists "events delete access" on public.events;
create policy "events read access" on public.events for select to authenticated
using (public.current_user_has_permission('events.view'));
create policy "events create access" on public.events for insert to authenticated
with check (public.current_user_has_permission('events.manage'));
create policy "events update access" on public.events for update to authenticated
using (public.current_user_has_permission('events.manage'))
with check (public.current_user_has_permission('events.manage'));
create policy "events delete access" on public.events for delete to authenticated
using (public.current_user_has_permission('events.manage'));

drop policy if exists "authenticated attendance access" on public.attendance_records;
drop policy if exists "attendance read access" on public.attendance_records;
drop policy if exists "attendance create access" on public.attendance_records;
drop policy if exists "attendance update access" on public.attendance_records;
drop policy if exists "attendance delete access" on public.attendance_records;
create policy "attendance read access" on public.attendance_records for select to authenticated
using (public.current_user_has_permission('attendance.view'));
create policy "attendance create access" on public.attendance_records for insert to authenticated
with check (public.current_user_has_permission('attendance.manage'));
create policy "attendance update access" on public.attendance_records for update to authenticated
using (public.current_user_has_permission('attendance.manage'))
with check (public.current_user_has_permission('attendance.manage'));
create policy "attendance delete access" on public.attendance_records for delete to authenticated
using (public.current_user_has_permission('attendance.manage'));
