-- Allow Super Administrators to delete any role that does not itself grant
-- Super Administrator access. Roles assigned to users remain protected by the
-- user_profiles role_id foreign key until those users are reassigned.

drop policy if exists "super administrators delete custom roles" on public.app_roles;
drop policy if exists "super administrators delete non-super roles" on public.app_roles;

create policy "super administrators delete non-super roles"
on public.app_roles for delete to authenticated
using (
  public.current_user_has_permission('roles.manage')
  and not ('roles.manage' = any(permissions))
);
