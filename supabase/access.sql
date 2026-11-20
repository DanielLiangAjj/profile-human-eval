-- Research profile rating: let the personal code open the profiles, so that evaluators need no access phrase.
-- Run supabase/schema.sql first. Then run this file once in the Supabase SQL editor
-- (running it again is harmless: the table is created only if missing and the functions are replaced).
--
-- Why this exists. The profiles are published only in encrypted form (data/items.enc.json), because the
-- repository of the site is public and the texts are about real people. Someone has to give the browser the
-- key. Without this file, that is the evaluator (the access phrase in the invitation link). With this file,
-- the database keeps the key and gives it to any code it knows, that is, to everyone who has signed up.
-- The site notices by itself which of the two is the case (it asks pr_access_ready).
--
-- The key is NOT in this file. scripts/make_access_sql.py writes a private copy of this file, outside the
-- repository, that ends with the one statement that stores it:
--   insert into public.pr_access (name, value) values ('items_phrase', '<the access phrase>')
--     on conflict (name) do update set value = excluded.value, updated_at = now();
-- Paste that private copy, not this file, to do both steps at once.
--
-- To close the profiles again (for example when the rating is over):
--   delete from public.pr_access where name = 'items_phrase';
-- From then on the site asks for the access phrase again, and nobody can open the profiles with a code.

create table if not exists public.pr_access (
  name       text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

alter table public.pr_access enable row level security;
-- No policies on purpose: anon and authenticated get no rows and can change nothing.
revoke all on table public.pr_access from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- pr_access_ready: true when the key is stored, so the site need not ask anyone for the access phrase.
-- ---------------------------------------------------------------------------------------------
create or replace function public.pr_access_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.pr_access a where a.name = 'items_phrase' and a.value <> '');
$$;

-- ---------------------------------------------------------------------------------------------
-- pr_get_access: the key of the items for a code that has signed up; null for a code nobody has.
-- ---------------------------------------------------------------------------------------------
create or replace function public.pr_get_access(p_code text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result text;
begin
  if p_code is null or p_code !~ '^[0-9A-HJKMNP-TV-Z]{10}$' then
    raise exception 'invalid code';
  end if;
  if not exists (select 1 from public.pr_evaluators e where e.code = p_code) then
    return null;
  end if;
  select a.value into result from public.pr_access a where a.name = 'items_phrase';
  return result;
end;
$$;

revoke all on function public.pr_access_ready() from public;
revoke all on function public.pr_get_access(text) from public;
grant execute on function public.pr_access_ready() to anon, authenticated, service_role;
grant execute on function public.pr_get_access(text) to anon, authenticated, service_role;

-- Ask the API layer to pick up the new functions straight away.
notify pgrst, 'reload schema';
