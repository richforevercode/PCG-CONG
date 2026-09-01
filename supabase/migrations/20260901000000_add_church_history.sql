-- Publishable congregation history with an administrator-managed milestone timeline.

begin;

create table if not exists public.church_history (
  id smallint primary key default 1 check (id = 1),
  title text not null default 'Our Story' check (char_length(title) between 1 and 120),
  subtitle text not null default '' check (char_length(subtitle) <= 240),
  founding_date date,
  founding_members text not null default '' check (char_length(founding_members) <= 2000),
  summary text not null default '' check (char_length(summary) <= 2000),
  story text not null default '' check (char_length(story) <= 20000),
  hero_image_url text not null default '' check (hero_image_url = '' or (char_length(hero_image_url) <= 1000 and hero_image_url ~* '^https://')),
  hero_image_caption text not null default '' check (char_length(hero_image_caption) <= 240),
  is_published boolean not null default false,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.church_history_milestones (
  id uuid primary key default gen_random_uuid(),
  event_year smallint not null check (event_year between 1700 and 2200),
  event_date date,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  image_url text not null default '' check (image_url = '' or (char_length(image_url) <= 1000 and image_url ~* '^https://')),
  image_caption text not null default '' check (char_length(image_caption) <= 240),
  display_order integer not null default 0 check (display_order between 0 and 10000),
  is_published boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists church_history_milestones_order_idx
  on public.church_history_milestones (display_order, event_year, event_date);

insert into public.church_history (id, title, subtitle)
values (1, 'Our Story', 'The journey of Resurrection Congregation')
on conflict (id) do nothing;

create or replace function public.prepare_church_history_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := 1;
  new.title := btrim(new.title);
  new.subtitle := btrim(coalesce(new.subtitle, ''));
  new.founding_members := btrim(coalesce(new.founding_members, ''));
  new.summary := btrim(coalesce(new.summary, ''));
  new.story := btrim(coalesce(new.story, ''));
  new.hero_image_url := btrim(coalesce(new.hero_image_url, ''));
  new.hero_image_caption := btrim(coalesce(new.hero_image_caption, ''));
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_church_history_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.title := btrim(new.title);
  new.description := btrim(coalesce(new.description, ''));
  new.image_url := btrim(coalesce(new.image_url, ''));
  new.image_caption := btrim(coalesce(new.image_caption, ''));
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists church_history_prepare_record on public.church_history;
create trigger church_history_prepare_record
before insert or update on public.church_history
for each row execute function public.prepare_church_history_record();

drop trigger if exists church_history_prepare_milestone on public.church_history_milestones;
create trigger church_history_prepare_milestone
before insert or update on public.church_history_milestones
for each row execute function public.prepare_church_history_milestone();

alter table public.church_history enable row level security;
alter table public.church_history_milestones enable row level security;

revoke all on public.church_history, public.church_history_milestones from anon, authenticated;
grant select, insert, update, delete on public.church_history, public.church_history_milestones to authenticated;

create policy "authorized users read church history"
on public.church_history for select to authenticated
using (
  public.current_user_has_permission('history.view')
  or (public.current_user_is_member_portal() and is_published)
);

create policy "history managers create church history"
on public.church_history for insert to authenticated
with check (public.current_user_has_permission('history.manage'));

create policy "history managers update church history"
on public.church_history for update to authenticated
using (public.current_user_has_permission('history.manage'))
with check (public.current_user_has_permission('history.manage'));

create policy "history managers delete church history"
on public.church_history for delete to authenticated
using (public.current_user_has_permission('history.manage'));

create policy "authorized users read church history milestones"
on public.church_history_milestones for select to authenticated
using (
  public.current_user_has_permission('history.view')
  or (
    public.current_user_is_member_portal()
    and is_published
    and exists (select 1 from public.church_history history where history.id = 1 and history.is_published)
  )
);

create policy "history managers create milestones"
on public.church_history_milestones for insert to authenticated
with check (public.current_user_has_permission('history.manage'));

create policy "history managers update milestones"
on public.church_history_milestones for update to authenticated
using (public.current_user_has_permission('history.manage'))
with check (public.current_user_has_permission('history.manage'));

create policy "history managers delete milestones"
on public.church_history_milestones for delete to authenticated
using (public.current_user_has_permission('history.manage'));

update public.app_roles
set permissions = array(
      select distinct permission
      from unnest(permissions || array['history.view', 'history.manage']) permission
    ),
    updated_at = now()
where name in ('Super Administrator', 'Administrator', 'Secretary', 'Minister / Pastor');

update public.app_roles
set permissions = array(
      select distinct permission
      from unnest(permissions || array['history.view']) permission
    ),
    updated_at = now()
where name in ('Treasurer', 'Viewer');

revoke all on function public.prepare_church_history_record() from public;
revoke all on function public.prepare_church_history_milestone() from public;

notify pgrst, 'reload schema';

commit;
