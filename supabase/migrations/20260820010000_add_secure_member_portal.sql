-- Secure, account-linked Member Portal. Administrative access remains governed
-- by the existing permission policies; Member access is restricted to the
-- single members row linked to auth.uid().

begin;

create sequence if not exists public.membership_number_seq start with 1001;

alter table public.members
  add column if not exists membership_number text,
  add column if not exists address text not null default '',
  add column if not exists profile_photo_url text not null default '',
  add column if not exists emergency_contact_name text not null default '',
  add column if not exists emergency_contact_phone text not null default '';

alter table public.members
  drop constraint if exists members_profile_photo_url_check,
  add constraint members_profile_photo_url_check check (
    profile_photo_url = '' or profile_photo_url ~* '^https?://'
  );

update public.members
set membership_number = 'RC-' || lpad(nextval('public.membership_number_seq')::text, 6, '0')
where nullif(btrim(membership_number), '') is null;

create unique index if not exists members_membership_number_unique_idx
  on public.members (lower(btrim(membership_number)))
  where membership_number is not null;

create or replace function public.prepare_member_portal_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.membership_number := nullif(btrim(coalesce(new.membership_number, '')), '');
  if new.membership_number is null then
    new.membership_number := 'RC-' || lpad(nextval('public.membership_number_seq')::text, 6, '0');
  end if;
  new.address := btrim(coalesce(new.address, ''));
  new.profile_photo_url := btrim(coalesce(new.profile_photo_url, ''));
  new.emergency_contact_name := btrim(coalesce(new.emergency_contact_name, ''));
  new.emergency_contact_phone := btrim(coalesce(new.emergency_contact_phone, ''));
  return new;
end;
$$;

drop trigger if exists member_portal_prepare_member_identity on public.members;
create trigger member_portal_prepare_member_identity
before insert or update on public.members
for each row execute function public.prepare_member_portal_identity();

insert into public.app_roles (name, description, permissions, is_system)
values (
  'Member',
  'Private access to the authenticated member''s own church records and public church information.',
  array['member.portal'],
  true
)
on conflict (name) do update
set description = excluded.description,
    permissions = excluded.permissions,
    is_system = true,
    updated_at = now();

alter table public.user_profiles
  add column if not exists member_id uuid references public.members(id) on delete set null;

alter table public.user_profiles
  drop constraint if exists user_profiles_member_id_fkey,
  add constraint user_profiles_member_id_fkey foreign key (member_id) references public.members(id) on delete restrict;

create unique index if not exists user_profiles_member_unique_idx
  on public.user_profiles (member_id)
  where member_id is not null;

create or replace function public.validate_user_profile_member_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text;
begin
  select name into assigned_role from public.app_roles where id = new.role_id;
  if assigned_role = 'Member' and new.member_id is null then
    raise exception 'A Member portal account must be linked to an existing church member.';
  end if;
  if assigned_role <> 'Member' and new.member_id is not null then
    raise exception 'Only accounts with the Member role can be linked to a church member.';
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_validate_member_link on public.user_profiles;
create trigger user_profiles_validate_member_link
before insert or update of role_id, member_id on public.user_profiles
for each row execute function public.validate_user_profile_member_link();

create or replace function public.current_user_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profile.member_id
  from public.user_profiles profile
  join public.app_roles role on role.id = profile.role_id
  where profile.id = auth.uid()
    and profile.status = 'active'
    and role.name = 'Member'
    and profile.member_id is not null
$$;

create or replace function public.current_user_is_member_portal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_member_id() is not null
$$;

create or replace function public.current_user_role_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select role_id from public.user_profiles
  where id = auth.uid() and status = 'active'
$$;

create or replace function public.member_matches_audience(target_type text, target_group text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members member
    where member.id = public.current_user_member_id()
      and (
        coalesce(target_type, 'All') = 'All'
        or (target_type = 'Fellowship' and lower(btrim(member.group_name)) = lower(btrim(target_group)))
        or (
          target_type = 'Generational Group'
          and lower(btrim(public.communion_group_for_member(member.id, current_date))) = lower(btrim(target_group))
        )
      )
  )
$$;

create or replace function public.update_own_member_contact(
  new_phone text,
  new_email text,
  new_address text,
  new_profile_photo_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_member uuid := public.current_user_member_id();
begin
  if linked_member is null then raise exception 'Member portal access is required.'; end if;
  if char_length(btrim(coalesce(new_phone, ''))) > 40 then raise exception 'Phone number is too long.'; end if;
  if char_length(btrim(coalesce(new_email, ''))) > 254 then raise exception 'Email address is too long.'; end if;
  if nullif(btrim(coalesce(new_email, '')), '') is not null
     and btrim(new_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if char_length(btrim(coalesce(new_address, ''))) > 500 then raise exception 'Address is too long.'; end if;
  if char_length(btrim(coalesce(new_profile_photo_url, ''))) > 1000 then raise exception 'Profile photo URL is too long.'; end if;

  update public.members
  set phone = btrim(coalesce(new_phone, '')),
      email = nullif(btrim(coalesce(new_email, '')), ''),
      address = btrim(coalesce(new_address, '')),
      profile_photo_url = btrim(coalesce(new_profile_photo_url, ''))
  where id = linked_member;

  update public.user_profiles
  set phone = btrim(coalesce(new_phone, '')), updated_at = now()
  where id = auth.uid();
end;
$$;

create table if not exists public.member_profile_update_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  requested_changes jsonb not null check (jsonb_typeof(requested_changes) = 'object'),
  reason text not null default '' check (char_length(reason) <= 1000),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Declined')),
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  review_notes text not null default '' check (char_length(review_notes) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists member_profile_requests_member_date_idx
  on public.member_profile_update_requests (member_id, created_at desc);

create or replace function public.prepare_member_profile_update_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.member_id := public.current_user_member_id();
    if new.member_id is null then raise exception 'Member portal access is required.'; end if;
    new.status := 'Pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_notes := '';
  elsif old.status is distinct from new.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists member_profile_request_prepare on public.member_profile_update_requests;
create trigger member_profile_request_prepare
before insert or update on public.member_profile_update_requests
for each row execute function public.prepare_member_profile_update_request();

create table if not exists public.member_portal_preferences (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  email_notifications boolean not null default true,
  event_reminders boolean not null default true,
  communion_updates boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.events
  add column if not exists audience_type text not null default 'All'
    check (audience_type in ('All', 'Fellowship', 'Generational Group')),
  add column if not exists audience_group text,
  add column if not exists status text not null default 'Published'
    check (status in ('Draft', 'Published', 'Cancelled'));

alter table public.events
  drop constraint if exists events_audience_target_check,
  add constraint events_audience_target_check check (
    audience_type = 'All' or nullif(btrim(audience_group), '') is not null
  );

create or replace function public.member_can_access_event(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events event
    where event.id = target_event_id
      and event.status = 'Published'
      and public.current_user_is_member_portal()
      and public.member_matches_audience(event.audience_type, event.audience_group)
  )
$$;

create table if not exists public.event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  response text not null check (response in ('Going', 'Interested', 'Unable to Attend')),
  updated_at timestamptz not null default now(),
  unique (event_id, member_id)
);

create index if not exists event_rsvps_member_idx on public.event_rsvps (member_id, updated_at desc);

create or replace function public.prepare_member_event_rsvp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.member_id := public.current_user_member_id();
  if new.member_id is null then raise exception 'Member portal access is required.'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists member_event_rsvp_prepare on public.event_rsvps;
create trigger member_event_rsvp_prepare
before insert or update on public.event_rsvps
for each row execute function public.prepare_member_event_rsvp();

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  content text not null check (char_length(btrim(content)) between 1 and 10000),
  priority text not null default 'Normal' check (priority in ('Normal', 'Important', 'Urgent')),
  audience_type text not null default 'All' check (audience_type in ('All', 'Fellowship', 'Generational Group')),
  audience_group text,
  attachment_url text not null default '' check (attachment_url = '' or attachment_url ~* '^https?://'),
  status text not null default 'Draft' check (status in ('Draft', 'Published', 'Archived')),
  published_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_status_date_idx
  on public.announcements (status, published_at desc);
create index if not exists announcements_audience_idx
  on public.announcements (audience_type, audience_group);

create or replace function public.prepare_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.title := btrim(new.title);
  new.content := btrim(new.content);
  new.audience_group := nullif(btrim(coalesce(new.audience_group, '')), '');
  new.attachment_url := btrim(coalesce(new.attachment_url, ''));
  if new.audience_type <> 'All' and new.audience_group is null then
    raise exception 'Choose the fellowship or generational group for this announcement.';
  end if;
  if new.status = 'Published' and (tg_op = 'INSERT' or old.status is distinct from new.status or new.published_at is null) then
    new.published_at := coalesce(new.published_at, now());
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists announcement_prepare on public.announcements;
create trigger announcement_prepare
before insert or update on public.announcements
for each row execute function public.prepare_announcement();

alter table public.member_profile_update_requests enable row level security;
alter table public.member_portal_preferences enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.announcements enable row level security;

grant select, insert on public.member_profile_update_requests to authenticated;
grant update on public.member_profile_update_requests to authenticated;
grant select, insert, update on public.member_portal_preferences to authenticated;
grant select, insert, update, delete on public.event_rsvps to authenticated;
grant select, insert, update, delete on public.announcements to authenticated;

drop policy if exists "active users read roles" on public.app_roles;
create policy "authorized users read roles" on public.app_roles for select to authenticated
using (
  id = public.current_user_role_id()
  or public.current_user_has_permission('users.manage')
  or public.current_user_has_permission('roles.manage')
);

drop policy if exists "member portal reads own member profile" on public.members;
create policy "member portal reads own member profile" on public.members for select to authenticated
using (id = public.current_user_member_id());

drop policy if exists "member portal reads own giving" on public.finance_collections;
create policy "member portal reads own giving" on public.finance_collections for select to authenticated
using (
  member_id = public.current_user_member_id()
  and status not in ('Pending', 'Voided')
);

drop policy if exists "member portal reads own communion entries" on public.communion_participants;
create policy "member portal reads own communion entries" on public.communion_participants for select to authenticated
using (member_id = public.current_user_member_id());

drop policy if exists "member portal reads own communion occasions" on public.communion_occasions;
create policy "member portal reads own communion occasions" on public.communion_occasions for select to authenticated
using (
  exists (
    select 1 from public.communion_participants participant
    where participant.occasion_id = communion_occasions.id
      and participant.member_id = public.current_user_member_id()
  )
);

drop policy if exists "member portal reads own attendance" on public.member_attendance_records;
create policy "member portal reads own attendance" on public.member_attendance_records for select to authenticated
using (member_id = public.current_user_member_id());

drop policy if exists "member portal reads active group rules" on public.generational_groups;
create policy "member portal reads active group rules" on public.generational_groups for select to authenticated
using (public.current_user_is_member_portal() and status = 'Active');

drop policy if exists "member portal reads targeted events" on public.events;
create policy "member portal reads targeted events" on public.events for select to authenticated
using (
  public.current_user_is_member_portal()
  and status in ('Published', 'Cancelled')
  and public.member_matches_audience(audience_type, audience_group)
);

drop policy if exists "members manage own event responses" on public.event_rsvps;
drop policy if exists "event administrators read responses" on public.event_rsvps;
drop policy if exists "members read own event responses" on public.event_rsvps;
drop policy if exists "members create own event responses" on public.event_rsvps;
drop policy if exists "members update own event responses" on public.event_rsvps;
drop policy if exists "members delete own event responses" on public.event_rsvps;
create policy "members read own event responses" on public.event_rsvps for select to authenticated
using (member_id = public.current_user_member_id());
create policy "event administrators read responses" on public.event_rsvps for select to authenticated
using (public.current_user_has_permission('events.view'));
create policy "members create own event responses" on public.event_rsvps for insert to authenticated
with check (
  member_id = public.current_user_member_id()
  and public.member_can_access_event(event_id)
);
create policy "members update own event responses" on public.event_rsvps for update to authenticated
using (member_id = public.current_user_member_id())
with check (
  member_id = public.current_user_member_id()
  and public.member_can_access_event(event_id)
);
create policy "members delete own event responses" on public.event_rsvps for delete to authenticated
using (member_id = public.current_user_member_id());

drop policy if exists "members read own profile requests" on public.member_profile_update_requests;
drop policy if exists "members create own profile requests" on public.member_profile_update_requests;
drop policy if exists "membership administrators read profile requests" on public.member_profile_update_requests;
drop policy if exists "membership administrators review profile requests" on public.member_profile_update_requests;
create policy "members read own profile requests" on public.member_profile_update_requests for select to authenticated
using (member_id = public.current_user_member_id());
create policy "members create own profile requests" on public.member_profile_update_requests for insert to authenticated
with check (member_id = public.current_user_member_id());
create policy "membership administrators read profile requests" on public.member_profile_update_requests for select to authenticated
using (public.current_user_has_permission('members.manage'));
create policy "membership administrators review profile requests" on public.member_profile_update_requests for update to authenticated
using (public.current_user_has_permission('members.manage'))
with check (public.current_user_has_permission('members.manage'));

drop policy if exists "members manage own portal preferences" on public.member_portal_preferences;
drop policy if exists "members read own portal preferences" on public.member_portal_preferences;
drop policy if exists "members create own portal preferences" on public.member_portal_preferences;
drop policy if exists "members update own portal preferences" on public.member_portal_preferences;
create policy "members read own portal preferences" on public.member_portal_preferences for select to authenticated
using (user_id = auth.uid() and public.current_user_is_member_portal());
create policy "members create own portal preferences" on public.member_portal_preferences for insert to authenticated
with check (user_id = auth.uid() and public.current_user_is_member_portal());
create policy "members update own portal preferences" on public.member_portal_preferences for update to authenticated
using (user_id = auth.uid() and public.current_user_is_member_portal())
with check (user_id = auth.uid() and public.current_user_is_member_portal());

drop policy if exists "announcement administrators read all" on public.announcements;
drop policy if exists "announcement administrators create" on public.announcements;
drop policy if exists "announcement administrators update" on public.announcements;
drop policy if exists "announcement administrators delete" on public.announcements;
drop policy if exists "members read targeted announcements" on public.announcements;
create policy "announcement administrators read all" on public.announcements for select to authenticated
using (public.current_user_has_permission('announcements.view'));
create policy "announcement administrators create" on public.announcements for insert to authenticated
with check (public.current_user_has_permission('announcements.manage'));
create policy "announcement administrators update" on public.announcements for update to authenticated
using (public.current_user_has_permission('announcements.manage'))
with check (public.current_user_has_permission('announcements.manage'));
create policy "announcement administrators delete" on public.announcements for delete to authenticated
using (public.current_user_has_permission('announcements.manage'));
create policy "members read targeted announcements" on public.announcements for select to authenticated
using (
  public.current_user_is_member_portal()
  and status = 'Published'
  and published_at <= now()
  and public.member_matches_audience(audience_type, audience_group)
);

update public.app_roles
set permissions = array(select distinct permission from unnest(permissions || array['announcements.view', 'announcements.manage']) permission),
    updated_at = now()
where name in ('Super Administrator', 'Administrator', 'Secretary', 'Minister / Pastor');

revoke all on function public.prepare_member_portal_identity() from public;
revoke all on function public.validate_user_profile_member_link() from public;
revoke all on function public.prepare_member_profile_update_request() from public;
revoke all on function public.prepare_member_event_rsvp() from public;
revoke all on function public.prepare_announcement() from public;
revoke all on function public.current_user_member_id() from public;
revoke all on function public.current_user_is_member_portal() from public;
revoke all on function public.current_user_role_id() from public;
revoke all on function public.member_matches_audience(text, text) from public;
revoke all on function public.member_can_access_event(uuid) from public;
revoke all on function public.update_own_member_contact(text, text, text, text) from public;
grant execute on function public.current_user_member_id() to authenticated;
grant execute on function public.current_user_is_member_portal() to authenticated;
grant execute on function public.current_user_role_id() to authenticated;
grant execute on function public.member_matches_audience(text, text) to authenticated;
grant execute on function public.member_can_access_event(uuid) to authenticated;
grant execute on function public.update_own_member_contact(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
