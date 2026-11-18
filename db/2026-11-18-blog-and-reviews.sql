-- Research desk and blog
create table if not exists public.jn_blog (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  topic text not null, title text not null, dek text, author text, body text not null,
  sources jsonb not null default '[]'::jsonb
);
create table if not exists public.jn_desk (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  incidents jsonb not null default '[]'::jsonb,
  briefs jsonb not null default '[]'::jsonb
);
alter table public.jn_blog enable row level security;
alter table public.jn_desk enable row level security;
drop policy if exists jn_blog_read on public.jn_blog;
create policy jn_blog_read on public.jn_blog for select to anon, authenticated using (true);
drop policy if exists jn_desk_read on public.jn_desk;
create policy jn_desk_read on public.jn_desk for select to anon, authenticated using (true);
grant select on public.jn_blog, public.jn_desk to anon, authenticated;

create table if not exists jn_private.desk_clock (id int primary key, last_claim timestamptz not null);
insert into jn_private.desk_clock values (1, '1970-01-01') on conflict do nothing;

create or replace function public.jn_claim_desk(p_token text, p_hours int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare h text; claimed int;
begin
  select token_hash into h from jn_private.shift_token where id = 1;
  if h is null or extensions.crypt(coalesce(p_token, ''), h) <> h then return false; end if;
  update jn_private.desk_clock set last_claim = now()
   where id = 1 and last_claim < now() - make_interval(hours => greatest(p_hours, 6));
  get diagnostics claimed = row_count;
  return claimed > 0;
end $$;

create or replace function public.jn_post_desk(p_token text, p_post jsonb, p_incidents jsonb, p_briefs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; new_id bigint;
begin
  select token_hash into h from jn_private.shift_token where id = 1;
  if h is null or extensions.crypt(coalesce(p_token, ''), h) <> h then return jsonb_build_object('ok', false, 'error', 'Not authorised'); end if;
  if pg_column_size(p_post) > 80000 or pg_column_size(p_incidents) > 100000 or pg_column_size(p_briefs) > 100000 then
    return jsonb_build_object('ok', false, 'error', 'Too large'); end if;
  insert into public.jn_desk(incidents, briefs) values (coalesce(p_incidents, '[]'), coalesce(p_briefs, '[]'));
  if p_post is not null and jsonb_typeof(p_post) = 'object' and coalesce(p_post->>'body', '') <> '' then
    insert into public.jn_blog(topic, title, dek, author, body, sources)
    values (p_post->>'topic', p_post->>'title', p_post->>'dek', p_post->>'author', p_post->>'body', coalesce(p_post->'sources', '[]'))
    returning id into new_id;
  end if;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

-- James's verdicts on Agent Doodlebug's ideas
create table if not exists public.jn_idea_reviews (
  idea_id text primary key check (length(idea_id) between 1 and 80),
  verdict text not null check (verdict in ('agree', 'disagree')),
  note text check (note is null or length(note) <= 600),
  reviewed_at timestamptz not null default now()
);
alter table public.jn_idea_reviews enable row level security;
drop policy if exists jn_idea_reviews_read on public.jn_idea_reviews;
create policy jn_idea_reviews_read on public.jn_idea_reviews for select to anon, authenticated using (true);
grant select on public.jn_idea_reviews to anon, authenticated;

create or replace function public.jn_review_idea(p_password text, p_idea_id text, p_verdict text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  ok := jn_private.check_pass(p_password);
  if ok is null then return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in 15 minutes.'); end if;
  if not ok then return jsonb_build_object('ok', false, 'error', 'Wrong password'); end if;
  if p_verdict not in ('agree', 'disagree') or coalesce(p_idea_id, '') = '' or length(p_idea_id) > 80 then
    return jsonb_build_object('ok', false, 'error', 'Bad request'); end if;
  insert into public.jn_idea_reviews(idea_id, verdict, note, reviewed_at)
  values (p_idea_id, p_verdict, nullif(left(coalesce(p_note, ''), 600), ''), now())
  on conflict (idea_id) do update set verdict = excluded.verdict, note = excluded.note, reviewed_at = now();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.jn_claim_desk(text, int) from public;
revoke all on function public.jn_post_desk(text, jsonb, jsonb, jsonb) from public;
revoke all on function public.jn_review_idea(text, text, text, text) from public;
grant execute on function public.jn_claim_desk(text, int) to anon, authenticated;
grant execute on function public.jn_post_desk(text, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.jn_review_idea(text, text, text, text) to anon, authenticated;
