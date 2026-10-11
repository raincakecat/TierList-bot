-- Run once in your own Supabase SQL editor. Server-side credentials only.
begin;
create table if not exists public.crystal_state (
  guild text primary key,
  revision bigint not null default 0 check (revision >= 0),
  body jsonb not null check (jsonb_typeof(body) = 'object')
);
alter table public.crystal_state enable row level security;
revoke all on public.crystal_state from public, anon, authenticated;
grant select, insert, update on public.crystal_state to service_role;

create or replace function public.crystal_commit(p_guild text, p_revision bigint, p_body jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.crystal_state set revision = revision + 1, body = p_body
    where guild = p_guild and revision = p_revision;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.crystal_commit(text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.crystal_commit(text,bigint,jsonb) to service_role;
commit;
