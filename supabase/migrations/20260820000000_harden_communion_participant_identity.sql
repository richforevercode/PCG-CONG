-- Tighten individual Communion identity safeguards without changing historical
-- participation snapshots. Active registered members and visitors remain
-- separate participant types.

begin;

create or replace function public.communion_normalized_visitor_name(visitor_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(btrim(coalesce(visitor_name, '')), '[[:space:]]+', ' ', 'g'))
$$;

drop index if exists public.communion_participants_visitor_unique_idx;
create unique index communion_participants_visitor_unique_idx
  on public.communion_participants (
    occasion_id,
    public.communion_normalized_visitor_name(visitor_name)
  )
  where member_id is null;

create or replace function public.validate_communion_active_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_status text;
begin
  if new.person_type <> 'Member' or not new.partook then
    return new;
  end if;

  -- Preserve historical snapshots when non-identity details such as notes are
  -- corrected after the member later becomes inactive.
  if tg_op = 'UPDATE'
     and old.member_id is not distinct from new.member_id
     and old.occasion_id is not distinct from new.occasion_id
     and old.person_type is not distinct from new.person_type
     and old.partook is not distinct from new.partook then
    return new;
  end if;

  select status into selected_status
  from public.members
  where id = new.member_id;

  if selected_status is distinct from 'Active' then
    raise exception 'Only active registered church members can be recorded as having partaken. Use the visitor option for non-members.';
  end if;
  return new;
end;
$$;

drop trigger if exists communion_participants_active_member_guard on public.communion_participants;
create trigger communion_participants_active_member_guard
before insert or update on public.communion_participants
for each row execute function public.validate_communion_active_member();

revoke all on function public.communion_normalized_visitor_name(text) from public;
revoke all on function public.validate_communion_active_member() from public;

notify pgrst, 'reload schema';

commit;
