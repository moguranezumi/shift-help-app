-- =====================================================================
-- Shift Help App - Database Schema
-- =====================================================================
-- This file creates all tables, indexes, Row Level Security (RLS)
-- policies, and trigger functions required by the app.
--
-- HOW TO USE:
--   1. Create a new Supabase project.
--   2. Open the SQL Editor.
--   3. Paste this entire file and run it.
--
-- NOTE:
--   - This script contains NO personal data and NO secrets.
--   - The HQ (headquarters) account is created during initial setup,
--     not here. See README for details.
-- =====================================================================

-- Required for password hashing helpers used during setup (pgcrypto).
create extension if not exists pgcrypto;

-- =====================================================================
-- TABLES
-- =====================================================================

-- ---- Headquarters (single row, id is always 1) ----------------------
create table if not exists public.hq (
  id        integer not null default 1,
  auth_id   uuid null references auth.users (id) on delete cascade,
  code      text not null default 'Admin',
  recovery  text not null default '',          -- recovery code, set during setup
  constraint hq_pkey primary key (id),
  constraint hq_single check (id = 1)
);

-- ---- Stores ---------------------------------------------------------
create table if not exists public.stores (
  code                  text not null,
  auth_id               uuid null references auth.users (id) on delete cascade,
  name                  text null default '',
  pref                  text null default '',
  area                  text null default '',
  targets               text[] null default '{}'::text[],   -- "apply allowed" stores (max scope)
  in_area               text[] null default '{}'::text[],   -- "in area" stores
  nearby                text[] null default '{}'::text[],    -- "nearby" stores
  proxy                 text[] null default '{}'::text[],    -- stores granted proxy rights
  pw_changed            boolean null default false,          -- initial password changed?
  apply_scope           text null default 'nearby',          -- self | nearby | inArea | all
  default_min_apply     integer null default 60,             -- store-posted default (minutes)
  default_min_apply_emp integer null default 0,              -- employee-posted default (minutes)
  created_at            timestamptz null default now(),
  constraint stores_pkey primary key (code)
);

-- ---- Employees ------------------------------------------------------
create table if not exists public.employees (
  code        text not null,
  auth_id     uuid null references auth.users (id) on delete cascade,
  store       text not null references public.stores (code) on delete cascade,
  name        text null default '',
  pw_changed  boolean null default false,
  created_at  timestamptz null default now(),
  constraint employees_pkey primary key (code)
);

-- ---- Requests (help requests) ---------------------------------------
create table if not exists public.requests (
  id                 bigint not null,
  store              text not null references public.stores (code) on delete cascade,
  by_emp             text null references public.employees (code) on delete cascade,
  by_store           boolean null default false,
  date_start         date not null,
  date_end           date not null,
  start_time         text not null,
  end_time           text not null,
  memo               text null default '',
  scope              text null default 'nearby',          -- nearby | inArea | all
  fills              jsonb null default '[]'::jsonb,        -- applicants (array)
  min_apply_minutes  integer null default 0,                -- 0=none, -1=full slot only
  edited_by_store    boolean null default false,
  edited_from        jsonb null,
  edited_seen        boolean null default false,
  cancelled_by_store boolean null default false,
  cancelled_seen     boolean null default false,
  created_at         timestamptz null default now(),
  constraint requests_pkey primary key (id)
);

-- ---- Push subscriptions (Web Push) ----------------------------------
create table if not exists public.push_subscriptions (
  id         bigserial not null,
  auth_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_role  text not null,   -- 'hq' | 'store' | 'emp'
  user_code  text not null,   -- HQ code, store code, or employee code
  created_at timestamptz null default now(),
  constraint push_subscriptions_pkey primary key (id),
  constraint push_subscriptions_auth_id_endpoint_key unique (auth_id, endpoint)
);

-- ---- Audit logs -----------------------------------------------------
create table if not exists public.audit_logs (
  id          bigserial not null,
  occurred_at timestamptz not null default now(),
  actor_role  text null,
  actor_code  text null,
  action      text not null,
  target_type text null,
  target_code text null,
  detail      jsonb null,
  ip          text null,
  ua          text null,
  constraint audit_logs_pkey primary key (id)
);

-- =====================================================================
-- INDEXES
-- =====================================================================
create index if not exists push_subs_user_role_idx  on public.push_subscriptions (user_role);
create index if not exists push_subs_user_code_idx  on public.push_subscriptions (user_code);
create index if not exists audit_logs_occurred_idx  on public.audit_logs (occurred_at desc);
create index if not exists audit_logs_actor_idx     on public.audit_logs (actor_role, actor_code);
create index if not exists audit_logs_action_idx    on public.audit_logs (action);

-- =====================================================================
-- TRIGGER FUNCTIONS
-- =====================================================================

-- Prevent an employee from changing their own code / store / auth_id.
-- HQ and store managers may change anything.
create or replace function public.prevent_emp_self_identity_change()
returns trigger
language plpgsql
security definer
as $$
declare
  is_hq boolean;
  is_store_mgr boolean;
begin
  -- service role / internal calls have no auth.uid(); allow them.
  -- (Edge Functions already perform their own permission checks.)
  if auth.uid() is null then return new; end if;

  select exists(select 1 from public.hq where hq.auth_id = auth.uid()) into is_hq;
  if is_hq then return new; end if;

  select exists(select 1 from public.stores where stores.auth_id = auth.uid()) into is_store_mgr;
  if is_store_mgr then return new; end if;

  if old.auth_id = auth.uid() then
    if new.code != old.code or new.store != old.store or new.auth_id != old.auth_id then
      raise exception 'cannot change code, store, or auth_id by self';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_emp_identity_change on public.employees;
create trigger prevent_emp_identity_change
  before update on public.employees
  for each row
  execute function public.prevent_emp_self_identity_change();

-- Prevent identity columns (by_emp / by_store / store) of a request from
-- being changed on update. HQ may change anything.
create or replace function public.prevent_request_identity_change()
returns trigger
language plpgsql
security definer
as $$
declare
  is_hq boolean;
begin
  -- service role / internal calls have no auth.uid(); allow them.
  -- (Edge Functions already perform their own permission checks.)
  if auth.uid() is null then return new; end if;

  select exists(select 1 from public.hq where hq.auth_id = auth.uid()) into is_hq;
  if is_hq then return new; end if;

  if new.by_emp is distinct from old.by_emp
     or new.by_store is distinct from old.by_store
     or new.store is distinct from old.store then
    raise exception 'cannot change by_emp, by_store, or store';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_request_identity_change on public.requests;
create trigger prevent_request_identity_change
  before update on public.requests
  for each row
  execute function public.prevent_request_identity_change();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.hq                 enable row level security;
alter table public.stores             enable row level security;
alter table public.employees          enable row level security;
alter table public.requests           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_logs         enable row level security;

-- ---- HQ -------------------------------------------------------------
-- Any authenticated user can read the single HQ row (needed to verify
-- the HQ code at login). Only HQ itself can update it.
drop policy if exists "hq read"        on public.hq;
drop policy if exists "hq self update" on public.hq;

create policy "hq read" on public.hq
  for select to authenticated
  using (true);

create policy "hq self update" on public.hq
  for update to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- ---- Stores ---------------------------------------------------------
drop policy if exists "hq all stores"     on public.stores;
drop policy if exists "all read stores"   on public.stores;
drop policy if exists "store update self" on public.stores;

create policy "hq all stores" on public.stores
  for all to authenticated
  using (exists (select 1 from public.hq where hq.auth_id = auth.uid()))
  with check (exists (select 1 from public.hq where hq.auth_id = auth.uid()));

-- Everyone authenticated can read all stores (needed for store names,
-- apply-scope settings, applicant lists, etc.).
create policy "all read stores" on public.stores
  for select to authenticated
  using (true);

-- A store manager can update only their own store row.
create policy "store update self" on public.stores
  for update to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- ---- Employees ------------------------------------------------------
drop policy if exists "hq full access on employees" on public.employees;
drop policy if exists "store read employees"        on public.employees;
drop policy if exists "store write employees"       on public.employees;
drop policy if exists "store update employees"      on public.employees;
drop policy if exists "store delete employees"      on public.employees;
drop policy if exists "emp read own"                on public.employees;
drop policy if exists "emp update own"              on public.employees;

create policy "hq full access on employees" on public.employees
  for all to authenticated
  using (exists (select 1 from public.hq where hq.auth_id = auth.uid()))
  with check (exists (select 1 from public.hq where hq.auth_id = auth.uid()));

-- Store managers can read all employees (needed to display applicants),
-- but can only insert/update/delete employees of their own store.
create policy "store read employees" on public.employees
  for select to authenticated
  using (exists (select 1 from public.stores where stores.auth_id = auth.uid()));

create policy "store write employees" on public.employees
  for insert to authenticated
  with check (exists (
    select 1 from public.stores
    where stores.auth_id = auth.uid() and stores.code = employees.store
  ));

create policy "store update employees" on public.employees
  for update to authenticated
  using (exists (
    select 1 from public.stores
    where stores.auth_id = auth.uid() and stores.code = employees.store
  ))
  with check (exists (
    select 1 from public.stores
    where stores.auth_id = auth.uid() and stores.code = employees.store
  ));

create policy "store delete employees" on public.employees
  for delete to authenticated
  using (exists (
    select 1 from public.stores
    where stores.auth_id = auth.uid() and stores.code = employees.store
  ));

-- An employee can read and update only their own row. Changing
-- code/store/auth_id is blocked by the trigger above.
create policy "emp read own" on public.employees
  for select to authenticated
  using (auth_id = auth.uid());

create policy "emp update own" on public.employees
  for update to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- ---- Requests -------------------------------------------------------
drop policy if exists "hq all requests"                on public.requests;
drop policy if exists "all read requests"              on public.requests;
drop policy if exists "all update requests"            on public.requests;
drop policy if exists "create own request"             on public.requests;
drop policy if exists "delete own or related request"  on public.requests;

create policy "hq all requests" on public.requests
  for all to authenticated
  using (exists (select 1 from public.hq where hq.auth_id = auth.uid()))
  with check (exists (select 1 from public.hq where hq.auth_id = auth.uid()));

-- Everyone authenticated can read all requests (needed for the
-- applicant candidate list).
create policy "all read requests" on public.requests
  for select to authenticated
  using (true);

-- Updates are broadly allowed (applying/cancelling edits the fills
-- column). Identity columns are protected by the trigger above.
create policy "all update requests" on public.requests
  for update to authenticated
  using (true)
  with check (true);

-- Create: an employee may post only as themselves; a store may post
-- only its own store-originated request, or one for a store that
-- granted it proxy rights.
create policy "create own request" on public.requests
  for insert to authenticated
  with check (
    exists (
      select 1 from public.employees
      where employees.auth_id = auth.uid()
        and employees.code = requests.by_emp
        and requests.by_store = false
    )
    or exists (
      select 1 from public.stores
      where stores.auth_id = auth.uid()
        and stores.code = requests.store
        and requests.by_store = true
    )
    or exists (
      select 1 from public.stores s_grantor, public.stores s_me
      where s_me.auth_id = auth.uid()
        and s_grantor.code = requests.store
        and s_me.code = any(s_grantor.proxy)
        and requests.by_store = true
    )
  );

-- Delete: the requesting employee, the originating store, or a store
-- holding proxy rights.
create policy "delete own or related request" on public.requests
  for delete to authenticated
  using (
    exists (
      select 1 from public.employees
      where employees.auth_id = auth.uid()
        and employees.code = requests.by_emp
    )
    or exists (
      select 1 from public.stores
      where stores.auth_id = auth.uid()
        and stores.code = requests.store
    )
    or exists (
      select 1 from public.stores s_grantor, public.stores s_me
      where s_me.auth_id = auth.uid()
        and s_grantor.code = requests.store
        and s_me.code = any(s_grantor.proxy)
    )
  );

-- ---- Push subscriptions ---------------------------------------------
drop policy if exists "own subscriptions" on public.push_subscriptions;

create policy "own subscriptions" on public.push_subscriptions
  for all to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- ---- Audit logs -----------------------------------------------------
-- HQ can read and delete; any authenticated user can insert (so their
-- own actions get logged).
drop policy if exists "hq read audit_logs"     on public.audit_logs;
drop policy if exists "auth insert audit_logs" on public.audit_logs;
drop policy if exists "hq delete audit_logs"   on public.audit_logs;

create policy "hq read audit_logs" on public.audit_logs
  for select to authenticated
  using (exists (select 1 from public.hq where hq.auth_id = auth.uid()));

create policy "auth insert audit_logs" on public.audit_logs
  for insert to authenticated
  with check (true);

create policy "hq delete audit_logs" on public.audit_logs
  for delete to authenticated
  using (exists (select 1 from public.hq where hq.auth_id = auth.uid()));

-- =====================================================================
-- DONE
-- =====================================================================
