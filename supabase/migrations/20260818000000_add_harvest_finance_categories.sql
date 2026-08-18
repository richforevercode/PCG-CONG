-- Canonical finance terminology and harvest metadata.
-- Extends the existing finance_collections ledger in place so historical IDs,
-- audit history, fund balances, and 60/40 distribution snapshots remain intact.

begin;

alter table public.finance_collections
  drop constraint if exists finance_collections_collection_type_check,
  drop constraint if exists finance_vto_occasion_check,
  drop constraint if exists finance_harvest_context_check;

alter table public.finance_distribution_rules
  drop constraint if exists finance_distribution_rules_collection_type_check;

alter table public.finance_collections
  add column if not exists harvest_day text,
  add column if not exists harvest_title text,
  add column if not exists harvest_period integer generated always as (extract(year from collection_date)::integer) stored;

-- Canonicalize legacy labels without recreating or deleting financial records.
update public.finance_collections
set collection_type = case collection_type
  when 'Vote of Thanks (VTO)' then 'Voluntary Thanks Offering (VTO)'
  when 'Vote of Thanks Offering' then 'Voluntary Thanks Offering (VTO)'
  when 'Children''s Service Offertory' then 'Children Service Offertory'
  when 'Junior Youth Offertory' then 'Junior Youth (JY) Offertory'
  when 'Junior Youth (JY)' then 'Junior Youth (JY) Offertory'
  else collection_type
end
where collection_type in (
  'Vote of Thanks (VTO)', 'Vote of Thanks Offering', 'Children''s Service Offertory',
  'Junior Youth Offertory', 'Junior Youth (JY)'
);

update public.finance_distribution_rules
set collection_type = case collection_type
  when 'Vote of Thanks (VTO)' then 'Voluntary Thanks Offering (VTO)'
  when 'Vote of Thanks Offering' then 'Voluntary Thanks Offering (VTO)'
  when 'Children''s Service Offertory' then 'Children Service Offertory'
  when 'Junior Youth Offertory' then 'Junior Youth (JY) Offertory'
  when 'Junior Youth (JY)' then 'Junior Youth (JY) Offertory'
  else collection_type
end
where collection_type in (
  'Vote of Thanks (VTO)', 'Vote of Thanks Offering', 'Children''s Service Offertory',
  'Junior Youth Offertory', 'Junior Youth (JY)'
);

alter table public.finance_collections
  add constraint finance_collections_collection_type_check check (collection_type in (
    'Tithe', 'Voluntary Thanks Offering (VTO)', 'Adult Offertory',
    'Junior Youth (JY) Offertory', 'Children Service Offertory',
    'Day Born Mini-Harvest', 'Main Harvest', 'Sunday Offertory',
    'Thanksgiving', 'Donation', 'Other'
  )),
  add constraint finance_vto_occasion_check check (
    collection_type <> 'Voluntary Thanks Offering (VTO)' or occasion is not null
  ),
  add constraint finance_harvest_context_check check (
    (collection_type = 'Day Born Mini-Harvest'
      and harvest_day in ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')
      and harvest_title is null)
    or (collection_type = 'Main Harvest'
      and harvest_day is null
      and nullif(btrim(harvest_title), '') is not null)
    or (collection_type not in ('Day Born Mini-Harvest', 'Main Harvest')
      and harvest_day is null
      and harvest_title is null)
  );

alter table public.finance_distribution_rules
  add constraint finance_distribution_rules_collection_type_check check (collection_type in (
    'Tithe', 'Voluntary Thanks Offering (VTO)', 'Adult Offertory',
    'Junior Youth (JY) Offertory', 'Children Service Offertory'
  ));

create index if not exists finance_collections_harvest_day_date_idx
  on public.finance_collections (harvest_day, collection_date desc)
  where collection_type = 'Day Born Mini-Harvest';
create index if not exists finance_collections_harvest_period_type_idx
  on public.finance_collections (harvest_period, collection_type, collection_date desc)
  where collection_type in ('Day Born Mini-Harvest', 'Main Harvest');
create index if not exists finance_collections_main_harvest_date_idx
  on public.finance_collections (collection_date desc, harvest_title)
  where collection_type = 'Main Harvest';

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

create or replace function public.prepare_finance_collection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_rule public.finance_distribution_rules%rowtype;
  recorder_name text;
  due_without_record numeric(14,2);
  already_remitted numeric(14,2);
  proposed_due numeric(14,2);
  load_distribution_rule boolean := false;
  finance_status_changed boolean := false;
begin
  if new.collection_date > current_date then
    raise exception 'Collection date cannot be in the future.';
  end if;
  if new.collection_type = 'Voluntary Thanks Offering (VTO)'
     and btrim(coalesce(new.occasion, '')) = '' then
    raise exception 'A Voluntary Thanks Offering (VTO) occasion is required.';
  end if;

  new.harvest_title := nullif(btrim(coalesce(new.harvest_title, '')), '');
  if new.collection_type = 'Day Born Mini-Harvest' then
    if new.harvest_day is null
       or new.harvest_day not in ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday') then
      raise exception 'Select a valid Day Born Mini-Harvest day from Sunday through Saturday.';
    end if;
    new.harvest_title := null;
  elsif new.collection_type = 'Main Harvest' then
    if new.harvest_title is null then
      raise exception 'A Main Harvest name or title is required.';
    end if;
    new.harvest_day := null;
  else
    new.harvest_day := null;
    new.harvest_title := null;
  end if;

  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
    select coalesce(nullif(display_name, ''), email, 'Finance officer')
      into recorder_name from public.user_profiles where id = auth.uid();
    new.recorded_by_name := coalesce(recorder_name, 'Finance officer');
  end if;

  -- Preserve the existing 60/40 behavior and historical snapshots exactly.
  if new.collection_type = 'Adult Offertory' then
    if tg_op = 'INSERT' then
      load_distribution_rule := true;
    else
      load_distribution_rule := old.collection_type is distinct from new.collection_type
        or new.local_percentage_snapshot is null;
    end if;
    if load_distribution_rule then
      select * into selected_rule
      from public.finance_distribution_rules
      where collection_type = 'Adult Offertory' and enabled
      order by updated_at desc limit 1;
      if not found then
        raise exception 'Enable an Adult Offertory distribution rule before recording this collection.';
      end if;
      new.distribution_rule_id := selected_rule.id;
      new.local_percentage_snapshot := selected_rule.local_percentage;
      new.district_percentage_snapshot := selected_rule.district_percentage;
      new.district_name_snapshot := selected_rule.district_name;
    end if;
    new.local_share := round(new.amount * new.local_percentage_snapshot / 100, 2);
    new.district_share := new.amount - new.local_share;
  else
    new.distribution_rule_id := null;
    new.local_percentage_snapshot := null;
    new.district_percentage_snapshot := null;
    new.district_name_snapshot := null;
    new.local_share := new.amount;
    new.district_share := 0;
  end if;

  if tg_op = 'INSERT' then
    finance_status_changed := true;
  else
    finance_status_changed := old.status is distinct from new.status;
  end if;
  if new.status in ('Verified', 'Reconciled') and finance_status_changed then
    if not public.current_user_has_permission('finance.verify') then
      raise exception 'Finance verification permission is required.';
    end if;
    new.verified_by := auth.uid();
  end if;

  if tg_op = 'UPDATE' then
    if old.amount is distinct from new.amount or old.status is distinct from new.status
       or old.collection_type is distinct from new.collection_type then
      perform pg_advisory_xact_lock(hashtext('finance-district-balance'));
      select coalesce(sum(district_share), 0) into due_without_record
        from public.finance_collections
        where id <> old.id and status not in ('Pending', 'Voided');
      proposed_due := case when new.status not in ('Pending', 'Voided') then new.district_share else 0 end;
      select coalesce(sum(amount), 0) into already_remitted
        from public.finance_remittances where status <> 'Voided';
      if already_remitted > due_without_record + proposed_due then
        raise exception 'This change would make district remittances exceed the district amount due.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

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
    'Children Service Offertory', 'Junior Youth (JY) Offertory',
    'Day Born Mini-Harvest', 'Main Harvest'
  )), 0)::numeric(14,2) as other_giving_total,
  coalesce(sum(collection.amount), 0)::numeric(14,2) as total_giving,
  coalesce(sum(collection.amount) filter (where collection.collection_type = 'Day Born Mini-Harvest'), 0)::numeric(14,2) as day_born_mini_harvest_total,
  coalesce(sum(collection.amount) filter (where collection.collection_type = 'Main Harvest'), 0)::numeric(14,2) as main_harvest_total,
  coalesce(sum(collection.amount) filter (where collection.collection_type in ('Day Born Mini-Harvest', 'Main Harvest')), 0)::numeric(14,2) as harvest_total
from public.finance_collections collection
where collection.status not in ('Pending', 'Voided')
group by collection.collection_date, collection.event_id, collection.service_name;

grant select on public.finance_service_giving_totals to authenticated;
revoke all on function public.prepare_member_giving_context() from public;
revoke all on function public.prepare_finance_collection() from public;

notify pgrst, 'reload schema';

commit;
