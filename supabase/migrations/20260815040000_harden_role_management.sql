-- Keep built-in access roles immutable. Super Administrators can create and
-- maintain custom roles without accidentally weakening the protected defaults.

drop policy if exists "super administrators create roles" on public.app_roles;
create policy "super administrators create roles"
on public.app_roles for insert to authenticated
with check (public.current_user_has_permission('roles.manage') and not is_system);

drop policy if exists "super administrators update roles" on public.app_roles;
create policy "super administrators update roles"
on public.app_roles for update to authenticated
using (public.current_user_has_permission('roles.manage') and not is_system)
with check (public.current_user_has_permission('roles.manage') and not is_system);

