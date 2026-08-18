-- Member-linked giving and service totals for the Presbyterian finance module.
-- Extends finance_collections in place; no existing collection or legacy ledger row is removed.

alter table public.finance_collections
  add column if not exists service_name text;

update public.finance_collections collection
set service_name = coalesce(
  nullif(btrim(event.title), ''),
  nullif(btrim(collection.occasion), ''),
  'Unspecified service'
)
from public.events event
where collection.event_id = event.id
  and nullif(btrim(collection.service_name), '') is null;

update public.finance_collections
set service_name = coalesce(
  nullif(btrim(service_name), ''),
  nullif(btrim(occasion), ''),
  'Unspecified service'
)
where nullif(btrim(service_name), '') is null;

alter table public.finance_collections
  alter column service_name set default 'Unspecified service',
  alter column service_name set not null;

alter table public.finance_collections
  drop constraint if exists finance_collections_collection_type_check;

alter table public.finance_collections
  add constraint finance_collections_collection_type_check check (collection_type in (
    'Tithe', 'Voluntary Thanks Offering (VTO)', 'Sunday Offertory',
    'Children Service Offertory', 'Junior Youth (JY) Offertory',
    'Thanksgiving', 'Donation', 'Other', 'Adult Offertory'
  ));

create index if not exists finance_collections_service_date_idx
  on public.finance_collections (collection_date desc, service_name);
create index if not exists finance_collections_member_type_date_idx
  on public.finance_collections (member_id, collection_type, collection_date desc)
  where member_id is not null;
create index if not exists finance_collections_event_idx
  on public.finance_collections (event_id)
  where event_id is not null;

create or replace function public.prepare_member_giving_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_event public.events%rowtype;
  member_required boolean;
  legacy_status_only_update boolean := false;
begin
  new.service_name := nullif(btrim(coalesce(new.service_name, '')), '');

  if new.event_id is not null then
    select * into linked_event from public.events where id = new.event_id;
    if not found then
      raise exception 'The selected service or event no longer exists.';
    end if;
    new.service_name := coalesce(new.service_name, linked_event.title);
  end if;

  if new.service_name is null then
    raise exception 'A service or occasion is required.';
  end if;

  member_required := new.collection_type in ('Tithe', 'Voluntary Thanks Offering (VTO)');

  if tg_op = 'UPDATE' then
    legacy_status_only_update := old.member_id is null
      and old.collection_type in ('Tithe', 'Voluntary Thanks Offering (VTO)')
      and old.collection_type is not distinct from new.collection_type
      and old.member_id is not distinct from new.member_id
      and old.amount is not distinct from new.amount
      and old.collection_date is not distinct from new.collection_date
      and old.event_id is not distinct from new.event_id
      and old.service_name is not distinct from new.service_name;
  end if;

  if member_required and new.member_id is null
     and (tg_op = 'INSERT' or not legacy_status_only_update) then
    raise exception 'Select the member who gave this Tithe or Voluntary Thanks Offering (VTO).';
  end if;

  return new;
end;
$$;

drop trigger if exists finance_00_member_giving_context on public.finance_collections;
create trigger finance_00_member_giving_context
before insert or update on public.finance_collections
for each row execute function public.prepare_member_giving_context();

create or replace view public.finance_service_giving_totals
with (security_invoker = true)
as
select
  collection.collection_date,
  collection.event_id,
  collection.service_name,
  count(*)::integer as transaction_count,
  count(distinct collection.member_id)::integer as member_count,
  coalesce(sum(collection.amount) filter (where collection.collection_type = 'Tithe'), 0)::numeric(14,2) as tithe_total,
  coalesce(sum(collection.amount) filter (where collection.collection_type = 'Voluntary Thanks Offering (VTO)'), 0)::numeric(14,2) as vto_total,
  coalesce(sum(collection.amount) filter (where collection.collection_type in (
    'Sunday Offertory', 'Adult Offertory', 'Children Service Offertory',
    'Junior Youth (JY) Offertory'
  )), 0)::numeric(14,2) as offertory_total,
  coalesce(sum(collection.amount) filter (where collection.collection_type not in (
    'Tithe', 'Voluntary Thanks Offering (VTO)', 'Sunday Offertory', 'Adult Offertory',
    'Children Service Offertory', 'Junior Youth (JY) Offertory'
  )), 0)::numeric(14,2) as other_giving_total,
  coalesce(sum(collection.amount), 0)::numeric(14,2) as total_giving
from public.finance_collections collection
where collection.status not in ('Pending', 'Voided')
group by collection.collection_date, collection.event_id, collection.service_name;

grant select on public.finance_service_giving_totals to authenticated;
revoke all on function public.prepare_member_giving_context() from public;

notify pgrst, 'reload schema';
