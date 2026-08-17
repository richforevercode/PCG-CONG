-- Complete Presbyterian finance module for Resurrection Congregation.
-- Keeps the legacy public.transactions table intact for backwards compatibility.

create table if not exists public.finance_funds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  is_active boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_distribution_rules (
  id uuid primary key default gen_random_uuid(),
  collection_type text not null unique check (collection_type in (
    'Tithe', 'Vote of Thanks (VTO)', 'Children''s Service Offertory',
    'Junior Youth (JY)', 'Adult Offertory'
  )),
  local_percentage numeric(5,2) not null check (local_percentage between 0 and 100),
  district_percentage numeric(5,2) not null check (district_percentage between 0 and 100),
  district_name text not null default 'Sebrepor District',
  enabled boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_distribution_total_check check (local_percentage + district_percentage = 100)
);

create table if not exists public.finance_collections (
  id uuid primary key default gen_random_uuid(),
  collection_date date not null default current_date,
  collection_type text not null check (collection_type in (
    'Tithe', 'Vote of Thanks (VTO)', 'Children''s Service Offertory',
    'Junior Youth (JY)', 'Adult Offertory'
  )),
  event_id uuid references public.events(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  fund_id uuid not null references public.finance_funds(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  collection_method text not null check (collection_method in ('Cash', 'Mobile Money', 'Bank', 'Other')),
  reference_number text,
  description text not null default '',
  occasion text,
  status text not null default 'Pending' check (status in (
    'Pending', 'Counted', 'Verified', 'Deposited', 'Reconciled', 'Voided'
  )),
  recorded_by uuid references public.user_profiles(id) on delete set null,
  recorded_by_name text not null default '',
  verified_by uuid references public.user_profiles(id) on delete set null,
  distribution_rule_id uuid references public.finance_distribution_rules(id) on delete restrict,
  local_percentage_snapshot numeric(5,2),
  district_percentage_snapshot numeric(5,2),
  district_name_snapshot text,
  local_share numeric(14,2) not null default 0 check (local_share >= 0),
  district_share numeric(14,2) not null default 0 check (district_share >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_collection_shares_check check (local_share + district_share = amount),
  constraint finance_vto_occasion_check check (
    collection_type <> 'Vote of Thanks (VTO)' or occasion is not null
  )
);

create table if not exists public.finance_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  description text not null,
  category text not null check (category in (
    'Utilities', 'Maintenance', 'Repairs', 'Transport', 'Stationery', 'Events',
    'Ministry', 'Welfare', 'Bank Charges', 'Salaries/Allowances', 'Other'
  )),
  amount numeric(14,2) not null check (amount > 0),
  fund_id uuid not null references public.finance_funds(id) on delete restrict,
  payment_method text not null check (payment_method in ('Cash', 'Mobile Money', 'Bank', 'Other')),
  reference_number text,
  requested_by text not null,
  approved_by uuid references public.user_profiles(id) on delete set null,
  paid_by uuid references public.user_profiles(id) on delete set null,
  receipt_url text,
  notes text not null default '',
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Paid', 'Voided')),
  recorded_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_remittances (
  id uuid primary key default gen_random_uuid(),
  remittance_date date not null default current_date,
  district_name text not null default 'Sebrepor District',
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('Cash', 'Mobile Money', 'Bank', 'Other')),
  reference_number text,
  notes text not null default '',
  status text not null default 'Submitted' check (status in ('Submitted', 'Verified', 'Voided')),
  remitted_by uuid references public.user_profiles(id) on delete set null,
  remitted_by_name text not null default '',
  verified_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_fund_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_date date not null default current_date,
  from_fund_id uuid not null references public.finance_funds(id) on delete restrict,
  to_fund_id uuid not null references public.finance_funds(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  reference_number text,
  notes text not null default '',
  status text not null default 'Posted' check (status in ('Posted', 'Voided')),
  recorded_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_transfer_distinct_funds check (from_fund_id <> to_fund_id)
);

create table if not exists public.finance_audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('Created', 'Updated', 'Verified', 'Approved', 'Paid', 'Remitted', 'Voided')),
  user_id uuid references public.user_profiles(id) on delete set null,
  previous_value jsonb,
  new_value jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists finance_collections_date_idx on public.finance_collections (collection_date desc);
create index if not exists finance_collections_type_idx on public.finance_collections (collection_type);
create index if not exists finance_collections_member_idx on public.finance_collections (member_id) where member_id is not null;
create index if not exists finance_collections_fund_idx on public.finance_collections (fund_id);
create index if not exists finance_collections_status_idx on public.finance_collections (status);
create index if not exists finance_expenses_date_idx on public.finance_expenses (expense_date desc);
create index if not exists finance_expenses_fund_idx on public.finance_expenses (fund_id);
create index if not exists finance_expenses_status_idx on public.finance_expenses (status);
create index if not exists finance_remittances_date_idx on public.finance_remittances (remittance_date desc);
create index if not exists finance_transfers_date_idx on public.finance_fund_transfers (transfer_date desc);
create index if not exists finance_transfers_from_idx on public.finance_fund_transfers (from_fund_id);
create index if not exists finance_transfers_to_idx on public.finance_fund_transfers (to_fund_id);
create index if not exists finance_audit_record_idx on public.finance_audit_log (table_name, record_id, occurred_at desc);
create index if not exists finance_audit_time_idx on public.finance_audit_log (occurred_at desc);

insert into public.finance_funds (name, description)
values
  ('General Fund', 'Unrestricted congregational funds'),
  ('Building / Project Fund', 'Building and capital projects'),
  ('Youth Ministry', 'Junior Youth and youth ministry'),
  ('Children''s Ministry', 'Children''s ministry activities'),
  ('Welfare', 'Member and community welfare'),
  ('Evangelism', 'Evangelism and mission activities'),
  ('Other Special Funds', 'Other designated funds')
on conflict (name) do nothing;

insert into public.finance_distribution_rules (
  collection_type, local_percentage, district_percentage, district_name, enabled
)
values ('Adult Offertory', 60, 40, 'Sebrepor District', true)
on conflict (collection_type) do nothing;

create or replace function public.finance_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_finance_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.local_percentage + new.district_percentage <> 100 then
    raise exception 'Local Church and district percentages must total exactly 100%%.';
  end if;
  if new.district_name is null or btrim(new.district_name) = '' then
    raise exception 'District name is required.';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
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
  if new.collection_type = 'Vote of Thanks (VTO)' and btrim(coalesce(new.occasion, '')) = '' then
    raise exception 'A Vote of Thanks occasion is required.';
  end if;

  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
    select coalesce(nullif(display_name, ''), email, 'Finance officer')
      into recorder_name from public.user_profiles where id = auth.uid();
    new.recorded_by_name := coalesce(recorder_name, 'Finance officer');
  end if;

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

create or replace function public.prepare_finance_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  finance_status_changed boolean := false;
begin
  if new.expense_date > current_date then raise exception 'Expense date cannot be in the future.'; end if;
  if tg_op = 'INSERT' then new.recorded_by := auth.uid(); end if;
  if tg_op = 'INSERT' then finance_status_changed := true;
  else finance_status_changed := old.status is distinct from new.status;
  end if;
  if new.status in ('Approved', 'Paid') and finance_status_changed then
    if not public.current_user_has_permission('finance.approve') then
      raise exception 'Finance approval permission is required.';
    end if;
    if new.status = 'Approved' then new.approved_by := auth.uid(); end if;
    if new.status = 'Paid' then
      new.approved_by := coalesce(new.approved_by, auth.uid());
      new.paid_by := auth.uid();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_finance_remittance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  finance_status_changed boolean := false;
begin
  if new.remittance_date > current_date then raise exception 'Remittance date cannot be in the future.'; end if;
  if tg_op = 'UPDATE' then
    finance_status_changed := old.status is distinct from new.status;
    if old.amount is distinct from new.amount or old.remittance_date is distinct from new.remittance_date
       or old.district_name is distinct from new.district_name then
      raise exception 'A posted remittance cannot be rewritten. Void it and record a correction instead.';
    end if;
  else
    finance_status_changed := true;
  end if;
  if new.status = 'Verified' and finance_status_changed
     and not public.current_user_has_permission('finance.verify') then
    raise exception 'Finance verification permission is required.';
  end if;
  if new.status = 'Verified' then new.verified_by := coalesce(new.verified_by, auth.uid()); end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_finance_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  available_balance numeric(14,2);
begin
  if new.transfer_date > current_date then raise exception 'Transfer date cannot be in the future.'; end if;
  if new.from_fund_id = new.to_fund_id then raise exception 'Source and destination funds must be different.'; end if;
  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
    perform pg_advisory_xact_lock(hashtext('finance-fund-' || new.from_fund_id::text));
    select
      fund.opening_balance
      + coalesce((select sum(collection.local_share) from public.finance_collections collection where collection.fund_id = fund.id and collection.status not in ('Pending', 'Voided')), 0)
      - coalesce((select sum(expense.amount) from public.finance_expenses expense where expense.fund_id = fund.id and expense.status = 'Paid'), 0)
      + coalesce((select sum(legacy.amount) from public.transactions legacy where legacy.fund = fund.name and legacy.type = 'Income'), 0)
      - coalesce((select sum(legacy.amount) from public.transactions legacy where legacy.fund = fund.name and legacy.type = 'Expense'), 0)
      + coalesce((select sum(incoming.amount) from public.finance_fund_transfers incoming where incoming.to_fund_id = fund.id and incoming.status = 'Posted'), 0)
      - coalesce((select sum(outgoing.amount) from public.finance_fund_transfers outgoing where outgoing.from_fund_id = fund.id and outgoing.status = 'Posted'), 0)
      into available_balance
    from public.finance_funds fund where fund.id = new.from_fund_id;
    if new.amount > coalesce(available_balance, 0) then
      raise exception 'Transfer cannot exceed the available source fund balance of GH₵%.', coalesce(available_balance, 0);
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.amount is distinct from new.amount or old.transfer_date is distinct from new.transfer_date
       or old.from_fund_id is distinct from new.from_fund_id or old.to_fund_id is distinct from new.to_fund_id then
      raise exception 'A posted transfer cannot be rewritten. Void it and record a correction instead.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.record_finance_remittance(
  p_remittance_date date,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text default null,
  p_notes text default ''
)
returns public.finance_remittances
language plpgsql
security definer
set search_path = public
as $$
declare
  total_due numeric(14,2);
  total_remitted numeric(14,2);
  active_district text;
  recorder_name text;
  result public.finance_remittances;
begin
  if not public.current_user_has_permission('finance.manage') then raise exception 'Finance management permission is required.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Remittance amount must be greater than zero.'; end if;
  if p_remittance_date > current_date then raise exception 'Remittance date cannot be in the future.'; end if;
  if p_payment_method not in ('Cash', 'Mobile Money', 'Bank', 'Other') then raise exception 'Invalid payment method.'; end if;

  perform pg_advisory_xact_lock(hashtext('finance-district-balance'));
  select coalesce(sum(district_share), 0) into total_due
    from public.finance_collections where status not in ('Pending', 'Voided');
  select coalesce(sum(amount), 0) into total_remitted
    from public.finance_remittances where status <> 'Voided';
  if p_amount > total_due - total_remitted then
    raise exception 'Remittance cannot exceed the outstanding district balance of GH₵%.', total_due - total_remitted;
  end if;

  select district_name into active_district from public.finance_distribution_rules
    where collection_type = 'Adult Offertory' and enabled order by updated_at desc limit 1;
  select coalesce(nullif(display_name, ''), email, 'Finance officer') into recorder_name
    from public.user_profiles where id = auth.uid();

  insert into public.finance_remittances (
    remittance_date, district_name, amount, payment_method, reference_number,
    notes, remitted_by, remitted_by_name
  ) values (
    p_remittance_date, coalesce(active_district, 'Sebrepor District'), p_amount,
    p_payment_method, nullif(btrim(p_reference_number), ''), coalesce(p_notes, ''),
    auth.uid(), coalesce(recorder_name, 'Finance officer')
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.finance_audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_action text;
  row_id uuid;
begin
  row_id := case when tg_op = 'DELETE' then old.id else new.id end;
  audit_action := case
    when tg_op = 'INSERT' and tg_table_name = 'finance_remittances' then 'Remitted'
    when tg_op = 'INSERT' then 'Created'
    when to_jsonb(new)->>'status' = 'Voided' and to_jsonb(old)->>'status' is distinct from to_jsonb(new)->>'status' then 'Voided'
    when tg_table_name = 'finance_collections' and to_jsonb(new)->>'status' in ('Verified', 'Reconciled') and to_jsonb(old)->>'status' is distinct from to_jsonb(new)->>'status' then 'Verified'
    when tg_table_name = 'finance_expenses' and to_jsonb(new)->>'status' = 'Approved' and to_jsonb(old)->>'status' is distinct from to_jsonb(new)->>'status' then 'Approved'
    when tg_table_name = 'finance_expenses' and to_jsonb(new)->>'status' = 'Paid' and to_jsonb(old)->>'status' is distinct from to_jsonb(new)->>'status' then 'Paid'
    else 'Updated'
  end;
  insert into public.finance_audit_log (table_name, record_id, action, user_id, previous_value, new_value)
  values (
    tg_table_name, row_id, audit_action, auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.reject_finance_history_deletion()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Financial history cannot be deleted. Void or reverse the record instead.';
end;
$$;

drop trigger if exists finance_rules_prepare on public.finance_distribution_rules;
create trigger finance_rules_prepare before insert or update on public.finance_distribution_rules
for each row execute function public.prepare_finance_rule();
drop trigger if exists finance_funds_touch on public.finance_funds;
create trigger finance_funds_touch before update on public.finance_funds
for each row execute function public.finance_touch_updated_at();
drop trigger if exists finance_collections_prepare on public.finance_collections;
create trigger finance_collections_prepare before insert or update on public.finance_collections
for each row execute function public.prepare_finance_collection();
drop trigger if exists finance_expenses_prepare on public.finance_expenses;
create trigger finance_expenses_prepare before insert or update on public.finance_expenses
for each row execute function public.prepare_finance_expense();
drop trigger if exists finance_remittances_touch on public.finance_remittances;
create trigger finance_remittances_touch before insert or update on public.finance_remittances
for each row execute function public.prepare_finance_remittance();
drop trigger if exists finance_transfers_prepare on public.finance_fund_transfers;
create trigger finance_transfers_prepare before insert or update on public.finance_fund_transfers
for each row execute function public.prepare_finance_transfer();

do $$
declare target_table text;
begin
  foreach target_table in array array['finance_collections', 'finance_expenses', 'finance_remittances', 'finance_fund_transfers', 'finance_distribution_rules', 'finance_funds'] loop
    execute format('drop trigger if exists %I_audit on public.%I', target_table, target_table);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function public.finance_audit_changes()', target_table, target_table);
    execute format('drop trigger if exists %I_no_delete on public.%I', target_table, target_table);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.reject_finance_history_deletion()', target_table, target_table);
  end loop;
end;
$$;

-- Add granular finance permissions to the roles that are responsible for them.
update public.app_roles
set permissions = array(select distinct permission from unnest(permissions || array[
  'finance.verify', 'finance.approve', 'finance.settings', 'finance.audit'
]) permission), updated_at = now()
where name in ('Super Administrator', 'Administrator', 'Treasurer');

update public.app_roles
set permissions = array(select distinct permission from unnest(permissions || array['events.view']) permission), updated_at = now()
where name = 'Treasurer';

-- A general viewer should not automatically receive sensitive financial access.
update public.app_roles
set permissions = array_remove(permissions, 'finance.view'), updated_at = now()
where name = 'Viewer';

insert into public.app_roles (name, description, permissions, is_system)
values
  ('Auditor', 'Read-only access to finance records and the financial audit trail.', array['dashboard.view', 'finance.view', 'finance.audit', 'reports.view'], true),
  ('Minister / Pastor', 'Read-only access to approved church financial reports.', array['dashboard.view', 'finance.view', 'reports.view'], true)
on conflict (name) do update set description = excluded.description, permissions = excluded.permissions, is_system = true, updated_at = now();

alter table public.finance_funds enable row level security;
alter table public.finance_distribution_rules enable row level security;
alter table public.finance_collections enable row level security;
alter table public.finance_expenses enable row level security;
alter table public.finance_remittances enable row level security;
alter table public.finance_fund_transfers enable row level security;
alter table public.finance_audit_log enable row level security;

grant select on public.finance_funds, public.finance_distribution_rules, public.finance_collections,
  public.finance_expenses, public.finance_remittances, public.finance_fund_transfers to authenticated;
grant insert, update on public.finance_funds, public.finance_distribution_rules,
  public.finance_collections, public.finance_expenses, public.finance_remittances, public.finance_fund_transfers to authenticated;
grant select on public.finance_audit_log to authenticated;
grant usage, select on sequence public.finance_audit_log_id_seq to authenticated;
revoke delete on public.finance_funds, public.finance_distribution_rules, public.finance_collections,
  public.finance_expenses, public.finance_remittances, public.finance_fund_transfers, public.finance_audit_log from authenticated;
revoke all on function public.record_finance_remittance(date, numeric, text, text, text) from public;
grant execute on function public.record_finance_remittance(date, numeric, text, text, text) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['finance_funds', 'finance_distribution_rules', 'finance_collections', 'finance_expenses', 'finance_remittances', 'finance_fund_transfers'] loop
    execute format('drop policy if exists "finance viewers read %s" on public.%I', table_name, table_name);
    execute format('create policy "finance viewers read %s" on public.%I for select to authenticated using (public.current_user_has_permission(''finance.view''))', table_name, table_name);
  end loop;
end;
$$;

drop policy if exists "finance managers create funds" on public.finance_funds;
create policy "finance managers create funds" on public.finance_funds for insert to authenticated
with check (public.current_user_has_permission('finance.settings'));
drop policy if exists "finance managers update funds" on public.finance_funds;
create policy "finance managers update funds" on public.finance_funds for update to authenticated
using (public.current_user_has_permission('finance.settings')) with check (public.current_user_has_permission('finance.settings'));

drop policy if exists "finance managers create rules" on public.finance_distribution_rules;
create policy "finance managers create rules" on public.finance_distribution_rules for insert to authenticated
with check (public.current_user_has_permission('finance.settings'));
drop policy if exists "finance managers update rules" on public.finance_distribution_rules;
create policy "finance managers update rules" on public.finance_distribution_rules for update to authenticated
using (public.current_user_has_permission('finance.settings')) with check (public.current_user_has_permission('finance.settings'));

drop policy if exists "finance managers create collections" on public.finance_collections;
create policy "finance managers create collections" on public.finance_collections for insert to authenticated
with check (public.current_user_has_permission('finance.manage'));
drop policy if exists "finance managers update collections" on public.finance_collections;
create policy "finance managers update collections" on public.finance_collections for update to authenticated
using (public.current_user_has_permission('finance.manage')) with check (public.current_user_has_permission('finance.manage'));

drop policy if exists "finance managers create expenses" on public.finance_expenses;
create policy "finance managers create expenses" on public.finance_expenses for insert to authenticated
with check (public.current_user_has_permission('finance.manage'));
drop policy if exists "finance managers update expenses" on public.finance_expenses;
create policy "finance managers update expenses" on public.finance_expenses for update to authenticated
using (public.current_user_has_permission('finance.manage') or public.current_user_has_permission('finance.approve'))
with check (public.current_user_has_permission('finance.manage') or public.current_user_has_permission('finance.approve'));

-- Direct remittance inserts are intentionally unavailable; use record_finance_remittance().
drop policy if exists "finance managers update remittances" on public.finance_remittances;
create policy "finance managers update remittances" on public.finance_remittances for update to authenticated
using (public.current_user_has_permission('finance.manage')) with check (public.current_user_has_permission('finance.manage'));

drop policy if exists "finance managers create transfers" on public.finance_fund_transfers;
create policy "finance managers create transfers" on public.finance_fund_transfers for insert to authenticated
with check (public.current_user_has_permission('finance.manage'));
drop policy if exists "finance managers update transfers" on public.finance_fund_transfers;
create policy "finance managers update transfers" on public.finance_fund_transfers for update to authenticated
using (public.current_user_has_permission('finance.manage')) with check (public.current_user_has_permission('finance.manage'));

drop policy if exists "finance auditors read audit trail" on public.finance_audit_log;
create policy "finance auditors read audit trail" on public.finance_audit_log for select to authenticated
using (public.current_user_has_permission('finance.audit'));

notify pgrst, 'reload schema';
