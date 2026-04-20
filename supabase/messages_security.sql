alter table public.messages
  add column if not exists language text,
  add column if not exists full_code text,
  add column if not exists is_deleted boolean not null default false;

alter table public.messages enable row level security;

drop policy if exists "messages_public_select" on public.messages;
create policy "messages_public_select"
on public.messages
for select
to public
using (is_deleted = false);

drop policy if exists "messages_public_insert" on public.messages;
create policy "messages_public_insert"
on public.messages
for insert
to public
with check (
  is_deleted = false
  and char_length(text) between 1 and 500
);

drop policy if exists "messages_public_update" on public.messages;
drop policy if exists "messages_public_delete" on public.messages;

revoke update on public.messages from anon, authenticated;
revoke delete on public.messages from anon, authenticated;

comment on table public.messages is
'Public wall entries. Anonymous users may read visible entries and insert new ones, but they cannot update or delete existing rows.';
