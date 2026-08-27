begin;

-- The congregation's district split applies only to Tithe and regular Sunday
-- Offertory. "Adult Offertory" is the application's regular-Sunday category.
with adult_rule as (
  select local_percentage, district_percentage, district_name, enabled
  from public.finance_distribution_rules
  where collection_type = 'Adult Offertory'
  order by updated_at desc
  limit 1
)
insert into public.finance_distribution_rules (
  collection_type,
  local_percentage,
  district_percentage,
  district_name,
  enabled
)
select
  'Tithe',
  adult_rule.local_percentage,
  adult_rule.district_percentage,
  adult_rule.district_name,
  adult_rule.enabled
from adult_rule
on conflict (collection_type) do update
set local_percentage = excluded.local_percentage,
    district_percentage = excluded.district_percentage,
    district_name = excluded.district_name,
    enabled = excluded.enabled;

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

  if new.collection_type in ('Tithe', 'Adult Offertory') then
    if tg_op = 'INSERT' then
      load_distribution_rule := true;
    else
      load_distribution_rule := old.collection_type is distinct from new.collection_type
        or new.local_percentage_snapshot is null;
    end if;
    if load_distribution_rule then
      select * into selected_rule
      from public.finance_distribution_rules
      where collection_type = new.collection_type and enabled
      order by updated_at desc limit 1;
      if not found then
        raise exception 'Enable the % distribution rule before recording this collection.', new.collection_type;
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

-- Apply the newly eligible rule to existing Tithe records. Existing regular
-- Sunday (Adult) Offertory snapshots remain historical and unchanged.
update public.finance_collections as collection
set distribution_rule_id = rule.id,
    local_percentage_snapshot = rule.local_percentage,
    district_percentage_snapshot = rule.district_percentage,
    district_name_snapshot = rule.district_name,
    local_share = round(collection.amount * rule.local_percentage / 100, 2),
    district_share = collection.amount - round(collection.amount * rule.local_percentage / 100, 2)
from public.finance_distribution_rules as rule
where collection.collection_type = 'Tithe'
  and rule.collection_type = collection.collection_type;

-- Correct any non-eligible income that may previously have received a split.
-- This explicitly includes Mini-Harvest, Main Harvest, VTO, Children/JY
-- Offertory, Thanksgiving, Donation, and Other income.
update public.finance_collections
set distribution_rule_id = null,
    local_percentage_snapshot = null,
    district_percentage_snapshot = null,
    district_name_snapshot = null,
    local_share = amount,
    district_share = 0
where collection_type not in ('Tithe', 'Adult Offertory')
  and (
    distribution_rule_id is not null
    or local_percentage_snapshot is not null
    or district_percentage_snapshot is not null
    or district_name_snapshot is not null
    or local_share is distinct from amount
    or district_share is distinct from 0
  );

commit;
