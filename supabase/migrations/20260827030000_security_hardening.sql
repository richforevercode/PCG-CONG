-- Defense-in-depth hardening for privileged access and security accountability.
-- Member Portal accounts keep their existing own-record access. Every other
-- active role must present an AAL2 (MFA-verified) JWT before database access.

begin;

-- This application has no public data API. Remove inherited anonymous access,
-- including defaults that can otherwise expose tables created in the future.
revoke all privileges on schema public from public, anon;
grant usage on schema public to authenticated, service_role;
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

create table if not exists public.security_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.user_profiles(id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 100),
  entity_id text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index if not exists security_audit_time_idx
  on public.security_audit_log (occurred_at desc);
create index if not exists security_audit_actor_idx
  on public.security_audit_log (actor_id, occurred_at desc);
create index if not exists security_audit_entity_idx
  on public.security_audit_log (entity_type, entity_id, occurred_at desc);

alter table public.security_audit_log enable row level security;
revoke all on public.security_audit_log from anon, authenticated;
grant select on public.security_audit_log to authenticated;

create policy "super administrators read security audit"
on public.security_audit_log for select to authenticated
using (public.current_user_has_permission('roles.manage'));

create or replace function public.current_user_satisfies_mfa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select role.name = 'Member' or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    from public.user_profiles profile
    join public.app_roles role on role.id = profile.role_id
    where profile.id = auth.uid()
      and profile.status = 'active'
  ), false)
$$;

revoke all on function public.current_user_satisfies_mfa() from public, anon;
grant execute on function public.current_user_satisfies_mfa() to authenticated;

-- Make MFA part of the shared authorization primitive. This also protects
-- SECURITY DEFINER RPCs (such as finance remittance recording) that bypass RLS
-- internally but already call current_user_has_permission().
create or replace function public.current_user_has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_satisfies_mfa() and exists (
    select 1
    from public.user_profiles profile
    join public.app_roles role on role.id = profile.role_id
    where profile.id = auth.uid()
      and profile.status = 'active'
      and required_permission = any(role.permissions)
  )
$$;

revoke all on function public.current_user_has_permission(text) from public, anon;
grant execute on function public.current_user_has_permission(text) to authenticated;

create or replace function public.update_own_profile(new_display_name text, new_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_satisfies_mfa() then raise exception 'MFA-verified active access is required.'; end if;
  if char_length(btrim(coalesce(new_display_name, ''))) not between 1 and 160 then
    raise exception 'Display name must be between 1 and 160 characters.';
  end if;
  if char_length(btrim(coalesce(new_phone, ''))) > 50 then raise exception 'Phone number is too long.'; end if;

  update public.user_profiles
  set display_name = btrim(new_display_name),
      phone = btrim(coalesce(new_phone, '')),
      updated_at = now()
  where id = auth.uid() and status = 'active';
end;
$$;

revoke all on function public.update_own_profile(text, text) from public, anon;
grant execute on function public.update_own_profile(text, text) to authenticated;

-- Permit an AAL1 session to read only its own account and assigned role so the
-- sign-in page can decide whether to enroll or challenge MFA. All broader
-- administrator access still requires AAL2.
drop policy if exists "mfa protects user profiles" on public.user_profiles;
create policy "mfa protects user profiles"
on public.user_profiles as restrictive for all to authenticated
using (id = auth.uid() or public.current_user_satisfies_mfa())
with check (public.current_user_satisfies_mfa());

drop policy if exists "mfa protects application roles" on public.app_roles;
create policy "mfa protects application roles"
on public.app_roles as restrictive for all to authenticated
using (id = public.current_user_role_id() or public.current_user_satisfies_mfa())
with check (public.current_user_satisfies_mfa());

-- Apply MFA as a restrictive policy so it is ANDed with every existing
-- permission and own-record policy rather than replacing any of them.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'members', 'transactions', 'events', 'attendance_records',
    'generational_groups', 'member_attendance_records',
    'finance_funds', 'finance_distribution_rules', 'finance_collections',
    'finance_expenses', 'finance_remittances', 'finance_fund_transfers',
    'finance_audit_log', 'communion_occasions', 'communion_participants',
    'member_profile_update_requests', 'member_portal_preferences',
    'event_rsvps', 'announcements', 'security_audit_log'
  ] loop
    execute format('drop policy if exists "mfa protects privileged access" on public.%I', table_name);
    execute format(
      'create policy "mfa protects privileged access" on public.%I as restrictive for all to authenticated using (public.current_user_satisfies_mfa()) with check (public.current_user_satisfies_mfa())',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.security_audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  record_id text := coalesce(new_row ->> 'id', old_row ->> 'id', '');
begin
  -- Avoid copying unnecessary contact and free-text PII into the audit trail.
  if tg_table_name = 'members' then
    old_row := old_row - array['phone','email','address','profile_photo_url','emergency_contact_name','emergency_contact_phone'];
    new_row := new_row - array['phone','email','address','profile_photo_url','emergency_contact_name','emergency_contact_phone'];
  elsif tg_table_name = 'user_profiles' then
    old_row := old_row - array['email','display_name','phone'];
    new_row := new_row - array['email','display_name','phone'];
  elsif tg_table_name = 'announcements' then
    old_row := old_row - array['content'];
    new_row := new_row - array['content'];
  elsif tg_table_name = 'member_profile_update_requests' then
    old_row := old_row - array['requested_changes','reason','review_notes'];
    new_row := new_row - array['requested_changes','reason','review_notes'];
  end if;

  insert into public.security_audit_log (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    record_id,
    jsonb_strip_nulls(jsonb_build_object('before', old_row, 'after', new_row))
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.security_audit_changes() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'members', 'user_profiles', 'app_roles', 'generational_groups', 'events', 'announcements',
    'member_profile_update_requests', 'communion_occasions'
  ] loop
    execute format('drop trigger if exists security_audit_changes on public.%I', table_name);
    execute format(
      'create trigger security_audit_changes after insert or update or delete on public.%I for each row execute function public.security_audit_changes()',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.record_own_security_event(
  event_action text,
  event_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_satisfies_mfa() then raise exception 'MFA-verified active access is required.'; end if;
  if event_action not in ('password.changed', 'sessions.revoked', 'mfa.enrolled', 'mfa.verified') then
    raise exception 'Unsupported security event.';
  end if;
  if jsonb_typeof(coalesce(event_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Security event metadata must be an object.';
  end if;

  -- Client-reported events are useful context, but they are rate-limited and
  -- explicitly marked so they cannot be mistaken for authoritative server logs.
  if exists (
    select 1 from public.security_audit_log
    where actor_id = auth.uid()
      and action = event_action
      and occurred_at >= now() - interval '1 minute'
  ) then
    return;
  end if;

  insert into public.security_audit_log (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    event_action,
    'user_account',
    auth.uid()::text,
    coalesce(event_metadata, '{}'::jsonb) || jsonb_build_object('source', 'authenticated_client')
  );
end;
$$;

revoke all on function public.record_own_security_event(text, jsonb) from public, anon;
grant execute on function public.record_own_security_event(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
