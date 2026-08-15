-- Restore the original role-deletion rule. System roles cannot be deleted;
-- Super Administrators can delete custom roles only.

drop policy if exists "super administrators delete non-super roles" on public.app_roles;
drop policy if exists "super administrators delete custom roles" on public.app_roles;

create policy "super administrators delete custom roles"
on public.app_roles for delete to authenticated
using (
  public.current_user_has_permission('roles.manage')
  and not is_system
);
