-- The track catalogue: SoundCloud tracks you add on the admin page, so the homepage can pick from your whole discography
-- (applied to the project on 2026-11-26)
create table if not exists public.jn_catalogue (
  url text primary key check (url ~ '^https://(www\.|m\.)?soundcloud\.com/[^[:space:]"<>]+$' and length(url) <= 300),
  title text not null default '' check (length(title) <= 200),
  added_at timestamptz not null default now()
);
alter table public.jn_catalogue enable row level security;
drop policy if exists jn_catalogue_read on public.jn_catalogue;
create policy jn_catalogue_read on public.jn_catalogue for select to anon, authenticated using (true);
grant select on public.jn_catalogue to anon, authenticated;
-- plus the functions jn_catalogue_add(p_password, p_tracks) and jn_catalogue_remove(p_password, p_url), both password-checked
