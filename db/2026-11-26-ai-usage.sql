-- AI usage log and daily token budget (applied 2026-11-26)
create table if not exists jn_private.ai_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  label text not null, model text not null,
  input_tokens int not null default 0, output_tokens int not null default 0
);
create index if not exists ai_usage_at on jn_private.ai_usage (at);
create table if not exists jn_private.ai_budget (id int primary key default 1 check (id = 1), daily_tokens bigint not null default 500000);
insert into jn_private.ai_budget(id) values (1) on conflict do nothing;

-- the site's server logs each Claude call (token-checked, like the other agent writes)
create or replace function public.jn_log_usage(p_token text, p_label text, p_model text, p_in int, p_out int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select token_hash into h from jn_private.shift_token where id = 1;
  if h is null or extensions.crypt(coalesce(p_token, ''), h) <> h then return jsonb_build_object('ok', false); end if;
  insert into jn_private.ai_usage(label, model, input_tokens, output_tokens)
  values (left(coalesce(p_label, 'unknown'), 40), left(coalesce(p_model, 'unknown'), 60), greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0));
  delete from jn_private.ai_usage where at < now() - interval '90 days';
  return jsonb_build_object('ok', true);
end $$;

-- the server asks how much is left today (UTC day) before each Claude call
create or replace function public.jn_usage_today(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; used bigint; b bigint;
begin
  select token_hash into h from jn_private.shift_token where id = 1;
  if h is null or extensions.crypt(coalesce(p_token, ''), h) <> h then return jsonb_build_object('ok', false); end if;
  select coalesce(sum(input_tokens + output_tokens), 0) into used from jn_private.ai_usage where at >= date_trunc('day', now());
  select daily_tokens into b from jn_private.ai_budget where id = 1;
  return jsonb_build_object('ok', true, 'used', used, 'budget', b);
end $$;

-- the admin page: today, the last N days, per agent and per day (password-checked)
create or replace function public.jn_usage_report(p_password text, p_days int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ok boolean; since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
begin
  ok := jn_private.check_pass(p_password);
  if ok is null then return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in 15 minutes.'); end if;
  if not ok then return jsonb_build_object('ok', false, 'error', 'Wrong password'); end if;
  return jsonb_build_object('ok', true,
    'budget', (select daily_tokens from jn_private.ai_budget where id = 1),
    'today', (select jsonb_build_object('input', coalesce(sum(input_tokens), 0), 'output', coalesce(sum(output_tokens), 0), 'calls', count(*)) from jn_private.ai_usage where at >= date_trunc('day', now())),
    'by_agent', coalesce((select jsonb_agg(t order by t.tokens desc) from (select label, count(*) calls, sum(input_tokens) input, sum(output_tokens) output, sum(input_tokens + output_tokens) tokens from jn_private.ai_usage where at >= since group by label) t), '[]'),
    'by_day', coalesce((select jsonb_agg(t order by t."day") from (select to_char(at, 'YYYY-MM-DD') as "day", count(*) calls, sum(input_tokens + output_tokens) tokens from jn_private.ai_usage where at >= since group by 1) t), '[]'));
end $$;

create or replace function public.jn_set_budget(p_password text, p_tokens bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  ok := jn_private.check_pass(p_password);
  if ok is null then return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in 15 minutes.'); end if;
  if not ok then return jsonb_build_object('ok', false, 'error', 'Wrong password'); end if;
  if p_tokens is null or p_tokens < 0 or p_tokens > 1000000000 then return jsonb_build_object('ok', false, 'error', 'Pick a number from 0 (no limit) up'); end if;
  update jn_private.ai_budget set daily_tokens = p_tokens where id = 1;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.jn_log_usage(text, text, text, int, int) from public;
revoke all on function public.jn_usage_today(text) from public;
revoke all on function public.jn_usage_report(text, int) from public;
revoke all on function public.jn_set_budget(text, bigint) from public;
grant execute on function public.jn_log_usage(text, text, text, int, int) to anon, authenticated;
grant execute on function public.jn_usage_today(text) to anon, authenticated;
grant execute on function public.jn_usage_report(text, int) to anon, authenticated;
grant execute on function public.jn_set_budget(text, bigint) to anon, authenticated;
