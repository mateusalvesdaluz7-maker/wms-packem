begin;

create table if not exists public.wms_nfc_tags (
  uid text primary key check (uid ~ '^04[A-F0-9]{12}$'),
  item text not null unique check (item ~ '^[A-Za-z0-9._/-]{1,32}$'),
  created_at timestamptz not null default now(),
  by_user text not null
);
alter table public.wms_nfc_tags enable row level security;
revoke all on public.wms_nfc_tags from public, anon, authenticated;
grant select, insert on public.wms_nfc_tags to service_role;

create or replace function public.wms_bind_nfc_tag(p_uid text, p_item text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  stored public.wms_nfc_tags%rowtype;
  inserted boolean;
begin
  if p_uid is null or p_uid !~ '^04[A-F0-9]{12}$'
     or p_item is null or p_item !~ '^[A-Za-z0-9._/-]{1,32}$'
     or coalesce(trim(p_actor), '') = '' then raise exception 'Dados NFC inválidos'; end if;
  if not exists (select 1 from public.etiquetas where id = p_item)
     and not exists (select 1 from public.bobinas where etiqueta = p_item)
     then raise exception 'Embalagem ainda não sincronizada'; end if;

  insert into public.wms_nfc_tags(uid, item, by_user) values (p_uid, p_item, p_actor)
  on conflict (uid) do nothing;
  inserted := found;
  select * into strict stored from public.wms_nfc_tags where uid = p_uid for update;
  if stored.item <> p_item then raise exception 'UID já pertence a outra embalagem'; end if;
  return jsonb_build_object('uid', stored.uid, 'item', stored.item,
    'created_at', stored.created_at, 'by_user', stored.by_user, 'duplicate', not inserted);
end;
$$;
revoke all on function public.wms_bind_nfc_tag(text, text, text) from public, anon, authenticated;
grant execute on function public.wms_bind_nfc_tag(text, text, text) to service_role;
commit;
