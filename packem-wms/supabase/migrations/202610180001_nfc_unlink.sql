begin;

-- An exact binding version prevents an old confirmation from removing a tag
-- that was unlinked and registered again in another tab.
alter table public.wms_nfc_tags add column if not exists binding_id uuid not null default gen_random_uuid();
create unique index if not exists wms_nfc_tags_binding_id_idx on public.wms_nfc_tags(binding_id);
alter table public.wms_nfc_scans add column if not exists bound_item text;
create index if not exists wms_nfc_scans_uid_idx on public.wms_nfc_scans(uid);

create table if not exists public.wms_nfc_tag_unlinks (
  binding_id uuid primary key, uid text not null, item text not null,
  linked_at timestamptz not null, linked_by text not null,
  unlinked_at timestamptz not null default now(), unlinked_by text not null
);
alter table public.wms_nfc_tag_unlinks enable row level security;
revoke all on public.wms_nfc_tag_unlinks from public,anon,authenticated,service_role;

create or replace function public.wms_bind_nfc_tag(p_uid text, p_item text, p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare stored public.wms_nfc_tags%rowtype; inserted boolean;
begin
  if p_uid is null or p_uid !~ '^(04|53)[A-F0-9]{12}$'
     or p_item is null or p_item !~ '^[A-Za-z0-9._/-]{1,32}$'
     or coalesce(trim(p_actor),'')='' then raise exception 'Dados NFC inválidos'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wms-nfc-tag:'||p_uid,0));
  if not exists(select 1 from public.etiquetas where id=p_item)
     and not exists(select 1 from public.bobinas where etiqueta=p_item)
     then raise exception 'Embalagem ainda não sincronizada'; end if;
  insert into public.wms_nfc_tags(uid,item,by_user) values(p_uid,p_item,p_actor) on conflict(uid) do nothing;
  inserted:=found;
  select * into strict stored from public.wms_nfc_tags where uid=p_uid for update;
  if stored.item<>p_item then raise exception 'UID já pertence a outra embalagem'; end if;
  return jsonb_build_object('uid',stored.uid,'item',stored.item,'binding_id',stored.binding_id,
    'created_at',stored.created_at,'by_user',stored.by_user,'duplicate',not inserted);
end; $$;
revoke all on function public.wms_bind_nfc_tag(text,text,text) from public,anon,authenticated;
grant execute on function public.wms_bind_nfc_tag(text,text,text) to service_role;

-- Serialize a physical scan with reuse of that UID. Old queue entries retain
-- their original item even after the same chip is linked to a different roll.
create or replace function public.wms_nfc_snapshot_scan()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('wms-nfc-tag:'||new.uid,0));
  select item into new.bound_item from public.wms_nfc_tags where uid=new.uid;
  return new;
end; $$;
revoke all on function public.wms_nfc_snapshot_scan() from public,anon,authenticated,service_role;
drop trigger if exists wms_nfc_snapshot_scan on public.wms_nfc_scans;
create trigger wms_nfc_snapshot_scan before insert on public.wms_nfc_scans
for each row execute function public.wms_nfc_snapshot_scan();
update public.wms_nfc_scans s set bound_item=t.item from public.wms_nfc_tags t
where s.uid=t.uid and s.bound_item is null;

create or replace function public.wms_unbind_nfc_tag(p_uid text,p_item text,p_binding_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare stored public.wms_nfc_tags%rowtype; previous public.wms_nfc_tag_unlinks%rowtype; actor_role text;
begin
  select role into actor_role from public.usuarios where u=p_actor and active=true limit 1;
  if not found or not public.wms_nfc_can_use(actor_role,'v-labels') then
    raise exception using errcode='42501',message='Sem permissão para desvincular tags'; end if;
  if p_uid is null or p_uid !~ '^(04|53)[A-F0-9]{12}$' or p_item is null
     or p_item !~ '^[A-Za-z0-9._/-]{1,32}$' or p_binding_id is null then
    raise exception 'Confirmação de vínculo inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wms-nfc-tag:'||p_uid,0));
  select * into previous from public.wms_nfc_tag_unlinks where binding_id=p_binding_id;
  if found then
    if previous.uid<>p_uid or previous.item<>p_item then raise exception 'Confirmação de vínculo diferente'; end if;
    return jsonb_build_object('uid',p_uid,'item',p_item,'binding_id',p_binding_id,'unlinked',true,'duplicate',true,
      'available',not exists(select 1 from public.wms_nfc_tags where uid=p_uid));
  end if;
  select * into stored from public.wms_nfc_tags where uid=p_uid for update;
  if not found or stored.item<>p_item or stored.binding_id<>p_binding_id then
    raise exception using errcode='NFC01',message='O vínculo mudou. Consulte a tag novamente'; end if;
  if exists(select 1 from public.wms_nfc_readers r where r.active and r.expires_at>now() and
      ((r.mode='enroll' and r.enrollment_item=p_item and r.arm_until>now()) or
       (r.mode='count' and r.owner=p_actor)))
     or exists(select 1 from public.wms_nfc_scans s join public.wms_nfc_counts c on c.id=s.session_id
       where s.uid=p_uid and c.active and c.expires_at>now()) then
    raise exception using errcode='NFC02',message='Pause a contagem ou cancele o cadastro em andamento antes de desvincular'; end if;
  update public.wms_nfc_scans set bound_item=stored.item where uid=p_uid and bound_item is null;
  insert into public.wms_nfc_tag_unlinks(binding_id,uid,item,linked_at,linked_by,unlinked_by)
    values(stored.binding_id,stored.uid,stored.item,stored.created_at,stored.by_user,p_actor);
  delete from public.wms_nfc_tags where uid=p_uid and binding_id=p_binding_id;
  return jsonb_build_object('uid',p_uid,'item',p_item,'binding_id',p_binding_id,
    'unlinked',true,'duplicate',false,'available',true);
end; $$;
revoke all on function public.wms_unbind_nfc_tag(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.wms_unbind_nfc_tag(text,text,uuid,text) to service_role;

-- Keep the existing ownership/session checks, adding the historical binding
-- to each authorized queue row. Reapplying this migration is harmless.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.wms_nfc_mobile(text,text,jsonb)'::regprocedure);
  if position('coalesce(scan.bound_item,tag.item)' in definition)=0 then
    if position('select seq,uid,scanned_at,received_at from public.wms_nfc_scans where session_id=sid' in definition)=0 then
      raise exception 'Fila NFC incompatível: revisão necessária antes de ativar desvinculação'; end if;
    execute replace(definition,
      'select seq,uid,scanned_at,received_at from public.wms_nfc_scans where session_id=sid',
      'select scan.seq,scan.uid,scan.scanned_at,scan.received_at,coalesce(scan.bound_item,tag.item) as bound_item from public.wms_nfc_scans scan left join public.wms_nfc_tags tag on tag.uid=scan.uid where scan.session_id=sid');
  end if;
end $$;
commit;
