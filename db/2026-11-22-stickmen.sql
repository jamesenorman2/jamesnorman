-- Editable stick men (what they say, switching them off, extra ones): stored in jn_site_settings under key 'stickmen'.
-- Anyone can read it (the homepage needs to); only the admin password can change it.
-- (applied as an additive change: the existing now_playing read policy is left as it is)
create policy "jn public read stickmen" on public.jn_site_settings
  for select to anon, authenticated using (key = 'stickmen');

create or replace function public.jn_set_stickmen(p_password text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  ok := jn_private.check_pass(p_password);
  if ok is null then return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in 15 minutes.'); end if;
  if not ok then return jsonb_build_object('ok', false, 'error', 'Wrong password'); end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' or pg_column_size(p_value) > 60000 then
    return jsonb_build_object('ok', false, 'error', 'That is too big or the wrong shape');
  end if;
  insert into public.jn_site_settings(key, value, updated_at) values ('stickmen', p_value, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.jn_set_stickmen(text, jsonb) from public;
grant execute on function public.jn_set_stickmen(text, jsonb) to anon, authenticated;
