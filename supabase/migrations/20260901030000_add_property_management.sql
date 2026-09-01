-- Church assets, facilities, maintenance, and facility booking registers.

begin;

create table if not exists public.church_facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 150),
  facility_type text not null check (facility_type in ('Sanctuary', 'Hall', 'Office', 'Classroom', 'Manse', 'Store', 'Kitchen', 'Washroom', 'Outdoor Space', 'Other')),
  location text not null default '' check (char_length(location) <= 250),
  capacity integer not null default 0 check (capacity >= 0),
  status text not null default 'Available' check (status in ('Available', 'In Use', 'Under Maintenance', 'Unavailable', 'Archived')),
  description text not null default '' check (char_length(description) <= 2000),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.church_assets (
  id uuid primary key default gen_random_uuid(),
  asset_tag text not null check (char_length(asset_tag) between 1 and 80),
  name text not null check (char_length(name) between 1 and 200),
  category text not null check (category in ('Audio / Visual', 'Furniture', 'Musical Instrument', 'Office Equipment', 'Electrical', 'Vehicle', 'Kitchen Equipment', 'Safety Equipment', 'Building Equipment', 'Other')),
  facility_id uuid references public.church_facilities(id) on delete set null,
  acquisition_date date,
  acquisition_cost numeric(14,2) not null default 0 check (acquisition_cost >= 0),
  current_value numeric(14,2) check (current_value is null or current_value >= 0),
  condition text not null default 'Good' check (condition in ('Excellent', 'Good', 'Fair', 'Poor', 'Unserviceable')),
  status text not null default 'In Service' check (status in ('In Service', 'In Storage', 'Under Maintenance', 'Disposed', 'Lost')),
  serial_number text not null default '' check (char_length(serial_number) <= 150),
  supplier text not null default '' check (char_length(supplier) <= 200),
  custodian text not null default '' check (char_length(custodian) <= 200),
  warranty_expires date,
  last_inspection date,
  next_inspection date,
  notes text not null default '' check (char_length(notes) <= 3000),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_inspection is null or next_inspection is null or next_inspection >= last_inspection)
);

create table if not exists public.property_maintenance (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.church_assets(id) on delete restrict,
  facility_id uuid references public.church_facilities(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  maintenance_type text not null check (maintenance_type in ('Inspection', 'Preventive Service', 'Repair', 'Cleaning', 'Safety Check', 'Renovation', 'Other')),
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High', 'Urgent')),
  status text not null default 'Reported' check (status in ('Reported', 'Scheduled', 'In Progress', 'Completed', 'Cancelled')),
  reported_on date not null default current_date,
  scheduled_for date,
  completed_on date,
  assigned_to text not null default '' check (char_length(assigned_to) <= 200),
  vendor text not null default '' check (char_length(vendor) <= 200),
  estimated_cost numeric(14,2) not null default 0 check (estimated_cost >= 0),
  actual_cost numeric(14,2) not null default 0 check (actual_cost >= 0),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((asset_id is not null)::integer + (facility_id is not null)::integer = 1),
  check (scheduled_for is null or scheduled_for >= reported_on),
  check (completed_on is null or completed_on >= reported_on),
  check (status = 'Completed' or completed_on is null)
);

create table if not exists public.facility_bookings (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.church_facilities(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  booking_date date not null,
  start_time time not null,
  end_time time not null,
  requested_by text not null check (char_length(requested_by) between 1 and 200),
  contact_phone text not null default '' check (char_length(contact_phone) <= 50),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Completed', 'Cancelled')),
  setup_notes text not null default '' check (char_length(setup_notes) <= 3000),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create unique index if not exists church_facilities_name_unique_idx on public.church_facilities (lower(name));
create unique index if not exists church_assets_tag_unique_idx on public.church_assets (lower(asset_tag));
create unique index if not exists church_assets_serial_unique_idx on public.church_assets (lower(serial_number)) where serial_number <> '';
create index if not exists church_assets_facility_idx on public.church_assets (facility_id, status);
create index if not exists church_assets_inspection_idx on public.church_assets (next_inspection) where status not in ('Disposed', 'Lost');
create index if not exists property_maintenance_due_idx on public.property_maintenance (scheduled_for, status);
create index if not exists property_maintenance_asset_idx on public.property_maintenance (asset_id);
create index if not exists property_maintenance_facility_idx on public.property_maintenance (facility_id);
create index if not exists facility_bookings_schedule_idx on public.facility_bookings (facility_id, booking_date, start_time);

create or replace function public.prepare_property_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

create or replace function public.prepare_maintenance_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.status = 'Completed' then
    new.completed_on := coalesce(new.completed_on, current_date);
  else
    new.completed_on := null;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

create or replace function public.prepare_facility_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.status = 'Approved' then
    if exists (
      select 1 from public.church_facilities facility
      where facility.id = new.facility_id and facility.status in ('Unavailable', 'Archived')
    ) then
      raise exception 'This facility is not available for approved bookings.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(new.facility_id::text || new.booking_date::text, 0));
    if exists (
      select 1 from public.facility_bookings booking
      where booking.facility_id = new.facility_id
        and booking.booking_date = new.booking_date
        and booking.status = 'Approved'
        and booking.id <> new.id
        and new.start_time < booking.end_time
        and new.end_time > booking.start_time
    ) then
      raise exception 'This facility already has an approved booking during that time.';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists church_facility_prepare on public.church_facilities;
create trigger church_facility_prepare before insert or update on public.church_facilities
for each row execute function public.prepare_property_record();
drop trigger if exists church_asset_prepare on public.church_assets;
create trigger church_asset_prepare before insert or update on public.church_assets
for each row execute function public.prepare_property_record();
drop trigger if exists property_maintenance_prepare on public.property_maintenance;
create trigger property_maintenance_prepare before insert or update on public.property_maintenance
for each row execute function public.prepare_maintenance_record();
drop trigger if exists facility_booking_prepare on public.facility_bookings;
create trigger facility_booking_prepare before insert or update on public.facility_bookings
for each row execute function public.prepare_facility_booking();

alter table public.church_facilities enable row level security;
alter table public.church_assets enable row level security;
alter table public.property_maintenance enable row level security;
alter table public.facility_bookings enable row level security;

revoke all on public.church_facilities, public.church_assets, public.property_maintenance, public.facility_bookings from anon, authenticated;
grant select, insert, update on public.church_facilities, public.church_assets, public.property_maintenance, public.facility_bookings to authenticated;

create policy "property viewers read facilities" on public.church_facilities for select to authenticated using (public.current_user_has_permission('property.view'));
create policy "property managers create facilities" on public.church_facilities for insert to authenticated with check (public.current_user_has_permission('property.manage'));
create policy "property managers update facilities" on public.church_facilities for update to authenticated using (public.current_user_has_permission('property.manage')) with check (public.current_user_has_permission('property.manage'));
create policy "property viewers read assets" on public.church_assets for select to authenticated using (public.current_user_has_permission('property.view'));
create policy "property managers create assets" on public.church_assets for insert to authenticated with check (public.current_user_has_permission('property.manage'));
create policy "property managers update assets" on public.church_assets for update to authenticated using (public.current_user_has_permission('property.manage')) with check (public.current_user_has_permission('property.manage'));
create policy "property viewers read maintenance" on public.property_maintenance for select to authenticated using (public.current_user_has_permission('property.view'));
create policy "property managers create maintenance" on public.property_maintenance for insert to authenticated with check (public.current_user_has_permission('property.manage'));
create policy "property managers update maintenance" on public.property_maintenance for update to authenticated using (public.current_user_has_permission('property.manage')) with check (public.current_user_has_permission('property.manage'));
create policy "property viewers read bookings" on public.facility_bookings for select to authenticated using (public.current_user_has_permission('property.view'));
create policy "property managers create bookings" on public.facility_bookings for insert to authenticated with check (public.current_user_has_permission('property.manage'));
create policy "property managers update bookings" on public.facility_bookings for update to authenticated using (public.current_user_has_permission('property.manage')) with check (public.current_user_has_permission('property.manage'));

update public.app_roles
set permissions = array(select distinct permission from unnest(permissions || array['property.view', 'property.manage']) permission), updated_at = now()
where name in ('Super Administrator', 'Administrator', 'Secretary');

update public.app_roles
set permissions = array(select distinct permission from unnest(permissions || array['property.view']) permission), updated_at = now()
where name = 'Minister / Pastor';

revoke all on function public.prepare_property_record() from public;
revoke all on function public.prepare_maintenance_record() from public;
revoke all on function public.prepare_facility_booking() from public;

notify pgrst, 'reload schema';
commit;
