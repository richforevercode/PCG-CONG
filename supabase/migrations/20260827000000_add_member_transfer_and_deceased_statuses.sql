-- Add the two Presbyterian transfer directions and preserve deceased records.

begin;

alter table public.members drop constraint if exists members_status_check;
alter table public.members
  add constraint members_status_check
  check (status in (
    'Active', 'Visitor', 'Inactive',
    'Transferred In', 'Transferred Out', 'Deceased'
  ));

create index if not exists members_status_idx on public.members (status);

commit;

notify pgrst, 'reload schema';
