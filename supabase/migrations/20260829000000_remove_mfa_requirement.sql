-- Remove the authenticator-app requirement from databases where the earlier
-- security-hardening migration has already been applied. Existing password,
-- active-account, role-permission, RLS, and audit controls remain in force.

begin;

drop policy if exists "mfa protects user profiles" on public.user_profiles;
drop policy if exists "mfa protects application roles" on public.app_roles;

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
  end loop;
end;
$$;

create or replace function public.current_user_has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
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
  if not public.current_user_is_active() then raise exception 'Active account access is required.'; end if;
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
  if not public.current_user_is_active() then raise exception 'Active account access is required.'; end if;
  if event_action not in ('password.changed', 'sessions.revoked') then
    raise exception 'Unsupported security event.';
  end if;
  if jsonb_typeof(coalesce(event_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Security event metadata must be an object.';
  end if;

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

drop function if exists public.current_user_satisfies_mfa();

notify pgrst, 'reload schema';

commit;
