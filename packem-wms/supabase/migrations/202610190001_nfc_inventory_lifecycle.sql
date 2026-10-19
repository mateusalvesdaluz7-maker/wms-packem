begin;
alter table public.wms_nfc_counts add column if not exists finished_at timestamptz;
alter table public.wms_nfc_counts add column if not exists result jsonb;

-- Reader and count locks are taken in the same order as wms_nfc_mobile.
-- A finalized capture cannot resume or accept more scans through the old API.
create or replace function public.wms_nfc_inventory_guard()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if old.finished_at is not null and new is distinct from old then raise exception 'Inventário encerrado'; end if;
  elsif new.target='v-inv' and new.context_key=new.owner||':inventario-nfc:conferencia' then
    if exists(select 1 from public.wms_nfc_readers r join public.wms_nfc_counts c on c.id=r.count_session_id
      where r.id=new.reader_id and c.id<>new.id and c.owner=new.owner and c.context_key=new.context_key and c.finished_at is null)
      then raise exception 'Encerre o inventário anterior'; end if;
  end if;
  return new;
end; $$;
create or replace trigger wms_nfc_inventory_guard before insert or update on public.wms_nfc_counts for each row execute function public.wms_nfc_inventory_guard();

create or replace function public.wms_nfc_inventory(p_action text,p_actor text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.wms_nfc_readers%rowtype; c public.wms_nfc_counts%rowtype;
  role_now text; rid uuid:=(p_payload->>'readerId')::uuid; sid uuid; snapshot jsonb; result_json jsonb; page_offset integer;
begin
  select role into role_now from public.usuarios where u=p_actor and active=true;
  if not found or not public.wms_nfc_can_use(role_now,'v-inv') then raise exception 'Inventário não autorizado'; end if;
  select * into r from public.wms_nfc_readers where id=rid and owner=p_actor for update;
  if not found then raise exception 'Leitor não pertence ao usuário'; end if;
  if p_action='inventory_list' then
    page_offset:=greatest(0,least(100000,coalesce((p_payload->>'offset')::integer,0)));
    select open_count.* into c from public.wms_nfc_counts open_count where reader_id=rid and owner=p_actor and target='v-inv'
      and context_key=p_actor||':inventario-nfc:conferencia' and finished_at is null
      and not exists(select 1 from public.wms_nfc_counts closed_count where closed_count.reader_id=rid and closed_count.owner=p_actor
        and closed_count.context_key=open_count.context_key and closed_count.finished_at is not null and closed_count.created_at>=open_count.created_at)
      order by (id=r.count_session_id) desc,created_at desc limit 1;
    result_json:=jsonb_build_object('current',case when c.id is null then null else jsonb_build_object('id',c.id,'active',c.active,'createdAt',c.created_at,'received',c.next_seq,'processed',c.ack_cursor) end);
    select coalesce(jsonb_agg(row_json order by finished_at desc,id),'[]') into snapshot from
      (select finished_at,id,jsonb_build_object('id',id,'createdAt',created_at,'finishedAt',finished_at,'received',next_seq,'processed',ack_cursor,'items',jsonb_array_length(result)) row_json
       from public.wms_nfc_counts where reader_id=rid and owner=p_actor and target='v-inv' and context_key=p_actor||':inventario-nfc:conferencia' and finished_at is not null
       order by finished_at desc,id offset page_offset limit 20) page;
    return result_json||jsonb_build_object('history',snapshot,'hasMore',exists(select 1 from public.wms_nfc_counts where reader_id=rid and owner=p_actor and target='v-inv' and context_key=p_actor||':inventario-nfc:conferencia' and finished_at is not null offset page_offset+20 limit 1));
  end if;
  sid:=(p_payload->>'sessionId')::uuid;
  select * into c from public.wms_nfc_counts where id=sid and reader_id=rid and owner=p_actor and target='v-inv' and context_key=p_actor||':inventario-nfc:conferencia' for update;
  if not found then raise exception 'Inventário não autorizado'; end if;
  if p_action='inventory_finish' and c.finished_at is null then
    if c.consumer_id<>(p_payload->>'consumerId')::uuid then raise exception 'Retome o inventário nesta tela'; end if;
    if c.next_seq<>c.ack_cursor then return jsonb_build_object('reason','pending'); end if;
    snapshot:=p_payload->'entries';
    if snapshot is null or jsonb_typeof(snapshot)<>'array' or jsonb_array_length(snapshot)>1000 then raise exception 'Resultado inválido'; end if;
    -- Every displayed item must belong to this exact acknowledged scan prefix.
    if jsonb_array_length(snapshot)<>(select count(distinct bound_item) from public.wms_nfc_scans where session_id=sid)
      or exists(select 1 from jsonb_to_recordset(snapshot) e(seq integer,uid text,item text) where not exists
        (select 1 from public.wms_nfc_scans s where s.session_id=sid and s.seq=e.seq and s.seq<=c.ack_cursor and s.uid=e.uid and s.bound_item=e.item))
      then return jsonb_build_object('reason','snapshot'); end if;
    update public.wms_nfc_counts set active=false,finished_at=now(),result=snapshot where id=sid returning * into c;
    if r.count_session_id=sid then update public.wms_nfc_readers set mode='idle' where id=rid; end if;
  elsif p_action not in ('inventory_get','inventory_finish') then raise exception 'Operação inválida'; end if;
  if c.finished_at is null then raise exception 'Este inventário ainda está em andamento'; end if;
  return jsonb_build_object('id',c.id,'createdAt',c.created_at,'finishedAt',c.finished_at,'received',c.next_seq,'processed',c.ack_cursor,'items',jsonb_array_length(c.result),'entries',c.result);
end; $$;
revoke all on function public.wms_nfc_inventory(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.wms_nfc_inventory(text,text,jsonb) to service_role;
commit;
