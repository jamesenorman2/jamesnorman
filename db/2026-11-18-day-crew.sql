-- Day crew reports
create table if not exists public.jn_crew (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  agent text not null check (agent ~ '^[a-z]{2,20}$'),
  report jsonb not null
);
create index if not exists jn_crew_agent_id on public.jn_crew (agent, id desc);
alter table public.jn_crew enable row level security;
drop policy if exists jn_crew_read on public.jn_crew;
create policy jn_crew_read on public.jn_crew for select to anon, authenticated using (true);
grant select on public.jn_crew to anon, authenticated;

create table if not exists jn_private.crew_clock (agent text primary key, last_claim timestamptz not null default '1970-01-01');

create or replace function public.jn_claim_crew(p_token text, p_agent text, p_hours int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare h text; claimed int;
begin
  select token_hash into h from jn_private.shift_token where id = 1;
  if h is null or extensions.crypt(coalesce(p_token, ''), h) <> h then return false; end if;
  if p_agent !~ '^[a-z]{2,20}$' then return false; end if;
  insert into jn_private.crew_clock(agent) values (p_agent) on conflict do nothing;
  update jn_private.crew_clock set last_claim = now()
   where agent = p_agent and last_claim < now() - make_interval(hours => greatest(p_hours, 0));
  get diagnostics claimed = row_count;
  return claimed > 0;
end $$;

create or replace function public.jn_post_crew(p_token text, p_agent text, p_report jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select token_hash into h from jn_private.shift_token where id = 1;
  if h is null or extensions.crypt(coalesce(p_token, ''), h) <> h then return jsonb_build_object('ok', false, 'error', 'Not authorised'); end if;
  if p_agent !~ '^[a-z]{2,20}$' or pg_column_size(p_report) > 120000 then return jsonb_build_object('ok', false, 'error', 'Bad report'); end if;
  insert into public.jn_crew(agent, report) values (p_agent, p_report);
  delete from public.jn_crew where agent = p_agent and id not in (select id from public.jn_crew where agent = p_agent order by id desc limit 60);
  return jsonb_build_object('ok', true);
end $$;

-- Privacy-friendly visit counts for Agent Pigeon (no IPs, no cookies)
create table if not exists jn_private.views (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  path text not null, ref text, mobile boolean
);
create index if not exists views_at on jn_private.views (at);

create or replace function public.jn_view(p_path text, p_ref text, p_mobile boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_path is null or length(p_path) > 100 or p_path !~ '^(/[A-Za-z0-9/_.-]*|event:[a-z0-9-]{1,60})$' then return; end if;
  if p_ref is not null and (length(p_ref) > 80 or p_ref !~ '^[A-Za-z0-9.-]*$') then p_ref := null; end if;
  insert into jn_private.views(path, ref, mobile) values (p_path, nullif(p_ref, ''), coalesce(p_mobile, false));
  delete from jn_private.views where at < now() - interval '120 days';
end $$;

create or replace function public.jn_view_stats(p_token text, p_days int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; since timestamptz := now() - make_interval(days => least(greatest(p_days, 1), 90));
begin
  select token_hash into h from jn_private.shift_token where id = 1;
  if h is null or extensions.crypt(coalesce(p_token, ''), h) <> h then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'days', p_days,
    'total', (select count(*) from jn_private.views where at >= since and path not like 'event:%'),
    'mobile_share', (select avg(case when mobile then 1 else 0 end) from jn_private.views where at >= since and path not like 'event:%'),
    'top', coalesce((select jsonb_agg(t) from (select path, count(*) views from jn_private.views where at >= since and path not like 'event:%' group by path order by 2 desc limit 15) t), '[]'),
    'events', coalesce((select jsonb_agg(t) from (select path event, count(*) times from jn_private.views where at >= since and path like 'event:%' group by path order by 2 desc) t), '[]'),
    'referrers', coalesce((select jsonb_agg(t) from (select ref, count(*) visits from jn_private.views where at >= since and ref is not null group by ref order by 2 desc limit 10) t), '[]'),
    'by_day', coalesce((select jsonb_agg(t order by t."day") from (select to_char(at, 'YYYY-MM-DD') as "day", count(*) views from jn_private.views where at >= since and path not like 'event:%' group by 1) t), '[]'));
end $$;

-- Agent Bunsen's question of the day: the answer stays private until someone answers
create table if not exists jn_private.quiz (id text primary key, answer int not null, explanation text not null, options int not null default 4, created_at timestamptz not null default now());
create table if not exists jn_private.quiz_answers (id bigint generated always as identity primary key, quiz_id text not null, choice int not null, at timestamptz not null default now());

create or replace function public.jn_post_quiz(p_token text, p_id text, p_answer int, p_explanation text, p_options int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select token_hash into h from jn_private.shift_token where id = 1;
  if h is null or extensions.crypt(coalesce(p_token, ''), h) <> h then return jsonb_build_object('ok', false); end if;
  insert into jn_private.quiz(id, answer, explanation, options) values (left(p_id, 20), p_answer, left(p_explanation, 800), coalesce(p_options, 4))
  on conflict (id) do update set answer = excluded.answer, explanation = excluded.explanation, options = excluded.options;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.jn_answer(p_id text, p_choice int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q record; tot int; rgt int;
begin
  select * into q from jn_private.quiz where id = p_id;
  if q is null or p_choice < 0 or p_choice >= q.options then return jsonb_build_object('ok', false); end if;
  insert into jn_private.quiz_answers(quiz_id, choice) values (p_id, p_choice);
  select count(*), count(*) filter (where choice = q.answer) into tot, rgt from jn_private.quiz_answers where quiz_id = p_id;
  return jsonb_build_object('ok', true, 'correct', p_choice = q.answer, 'answer_index', q.answer, 'explanation', q.explanation, 'total', tot, 'right', rgt);
end $$;

revoke all on function public.jn_claim_crew(text, text, int) from public;
revoke all on function public.jn_post_crew(text, text, jsonb) from public;
revoke all on function public.jn_view(text, text, boolean) from public;
revoke all on function public.jn_view_stats(text, int) from public;
revoke all on function public.jn_post_quiz(text, text, int, text, int) from public;
revoke all on function public.jn_answer(text, int) from public;
grant execute on function public.jn_claim_crew(text, text, int) to anon, authenticated;
grant execute on function public.jn_post_crew(text, text, jsonb) to anon, authenticated;
grant execute on function public.jn_view(text, text, boolean) to anon, authenticated;
grant execute on function public.jn_view_stats(text, int) to anon, authenticated;
grant execute on function public.jn_post_quiz(text, text, int, text, int) to anon, authenticated;
grant execute on function public.jn_answer(text, int) to anon, authenticated;
