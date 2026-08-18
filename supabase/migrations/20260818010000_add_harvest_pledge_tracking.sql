-- Add group-level pledge tracking to the existing harvest collection ledger.
-- `amount` remains actual cash collected and therefore continues to be the only
-- harvest value included in fund balances, giving totals, and 60/40 calculations.

begin;

alter table public.finance_collections
  add column if not exists pledge_amount numeric(14,2) not null default 0,
  add column if not exists pledge_redeemed numeric(14,2) not null default 0,
  add column if not exists outstanding_pledge numeric(14,2)
    generated always as (pledge_amount - pledge_redeemed) stored;

alter table public.finance_collections
  drop constraint if exists finance_collections_amount_check,
  drop constraint if exists finance_collection_amount_check,
  drop constraint if exists finance_harvest_pledge_check,
  drop constraint if exists finance_harvest_value_check;

alter table public.finance_collections
  add constraint finance_collection_amount_check check (
    amount >= 0
    and (collection_type in ('Day Born Mini-Harvest', 'Main Harvest') or amount > 0)
  ),
  add constraint finance_harvest_pledge_check check (
    pledge_amount >= 0
    and pledge_redeemed >= 0
    and pledge_redeemed <= pledge_amount
    and (
      collection_type in ('Day Born Mini-Harvest', 'Main Harvest')
      or (pledge_amount = 0 and pledge_redeemed = 0)
    )
  ),
  add constraint finance_harvest_value_check check (
    collection_type not in ('Day Born Mini-Harvest', 'Main Harvest')
    or amount > 0
    or pledge_amount > 0
    or pledge_redeemed > 0
  );

create index if not exists finance_collections_outstanding_harvest_pledge_idx
  on public.finance_collections (collection_type, harvest_period, harvest_day, collection_date desc)
  where collection_type in ('Day Born Mini-Harvest', 'Main Harvest')
    and pledge_amount > pledge_redeemed;

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

  if new.collection_type in ('Day Born Mini-Harvest', 'Main Harvest') then
    if new.amount < 0 or new.pledge_amount < 0 or new.pledge_redeemed < 0 then
      raise exception 'Harvest financial amounts cannot be negative.';
    end if;
    if new.pledge_redeemed > new.pledge_amount then
      raise exception 'Pledge Redeemed cannot exceed Pledge.';
    end if;
    if new.amount = 0 and new.pledge_amount = 0 and new.pledge_redeemed = 0 then
      raise exception 'Enter an Actual Collection, Pledge, or Pledge Redeemed amount.';
    end if;
  else
    new.pledge_amount := 0;
    new.pledge_redeemed := 0;
    if new.amount <= 0 then
      raise exception 'Collection amount must be greater than zero.';
    end if;
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
  coalesce(sum(collection.amount) filter (where collection.collection_type in ('Day Born Mini-Harvest', 'Main Harvest')), 0)::numeric(14,2) as harvest_total,
  coalesce(sum(collection.pledge_amount) filter (where collection.collection_type in ('Day Born Mini-Harvest', 'Main Harvest')), 0)::numeric(14,2) as harvest_pledge_total,
  coalesce(sum(collection.pledge_redeemed) filter (where collection.collection_type in ('Day Born Mini-Harvest', 'Main Harvest')), 0)::numeric(14,2) as harvest_pledge_redeemed_total,
  coalesce(sum(collection.outstanding_pledge) filter (where collection.collection_type in ('Day Born Mini-Harvest', 'Main Harvest')), 0)::numeric(14,2) as harvest_outstanding_pledge_total
from public.finance_collections collection
where collection.status not in ('Pending', 'Voided')
group by collection.collection_date, collection.event_id, collection.service_name;

grant select on public.finance_service_giving_totals to authenticated;
revoke all on function public.prepare_finance_collection() from public;

notify pgrst, 'reload schema';

commit;
