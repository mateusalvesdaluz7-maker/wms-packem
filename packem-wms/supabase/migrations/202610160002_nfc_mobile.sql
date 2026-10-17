begin;
create table if not exists public.wms_nfc_readers (
  id uuid primary key, owner text not null, label text not null,
  secret_hash text not null unique check (secret_hash ~ '^[a-f0-9]{64}$'),
  active boolean not null default true, expires_at timestamptz not null default now()+interval '30 days',
  mode text not null default 'idle' check (mode in ('idle','enroll','count')),
  target text, operation_id uuid, enrollment_item text, arm_until timestamptz,
  enrollment_result jsonb, count_session_id uuid, last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.wms_nfc_counts (
  id uuid primary key, reader_id uuid not null references public.wms_nfc_readers(id),
  owner text not null, consumer_id uuid not null, target text not null check (target in ('v-floor','v-floor70','v-recic','v-inv')),
  context_key text not null check (length(context_key) between 1 and 200), active boolean not null default true,
  next_seq integer not null default 0, ack_cursor integer not null default 0,
  expires_at timestamptz not null default now()+interval '2 hours', created_at timestamptz not null default now()
);
create table if not exists public.wms_nfc_scans (
  session_id uuid not null references public.wms_nfc_counts(id), seq integer not null,
  uid text not null check (uid ~ '^04[A-F0-9]{12}$'), scanned_at timestamptz not null,
  received_at timestamptz not null default now(), primary key(session_id,seq), unique(session_id,uid)
);
alter table public.wms_nfc_readers enable row level security;
alter table public.wms_nfc_counts enable row level security;
alter table public.wms_nfc_scans enable row level security;
revoke all on public.wms_nfc_readers, public.wms_nfc_counts, public.wms_nfc_scans from public,anon,authenticated,service_role;
grant select on public.wms_nfc_readers to service_role;

create or replace function public.wms_nfc_can_use(p_role text,p_view text)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare base text:=split_part(p_role,'|',1); views text;
begin
  if base='admin' then return true; end if;
  if p_view='v-inv' then return true; end if;
  select part into views from unnest(string_to_array(p_role,'|')) part where part like 'v=%' limit 1;
  if views is not null then return p_view=any(string_to_array(substr(views,3),',')); end if;
  if p_view='v-labels' then return base in ('operador','recepcao'); end if;
  if p_view in ('v-floor','v-floor70') then return base in ('operador','recepcao'); end if;
  return p_view='v-recic' and base='operador';
end; $$;
revoke all on function public.wms_nfc_can_use(text,text) from public,anon,authenticated;

create or replace function public.wms_nfc_mobile(p_action text,p_actor text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.wms_nfc_readers%rowtype; c public.wms_nfc_counts%rowtype;
  role_now text; rid uuid; sid uuid; op uuid; item text; tag_uid text;
  result jsonb; rows_json jsonb; duplicate boolean:=false;
begin
  select role into role_now from public.usuarios where u=p_actor and active=true limit 1;
  if not found then raise exception 'Usuário inativo'; end if;
  if p_action='reader_list' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'active',active,'expiresAt',expires_at,'mode',mode) order by created_at desc),'[]') into result
      from public.wms_nfc_readers where owner=p_actor and active=true;
    return result;
  end if;
  rid:=(p_payload->>'readerId')::uuid;
  if p_action='reader_create' then
    perform pg_advisory_xact_lock(hashtext('wms-nfc-reader:'||p_actor));
    if (select count(*) from public.wms_nfc_readers where owner=p_actor and active=true)>=5 then raise exception 'Revogue um leitor antes de criar outro'; end if;
    insert into public.wms_nfc_readers(id,owner,label,secret_hash) values(rid,p_actor,left(p_payload->>'label',80),p_payload->>'secretHash');
  end if;
  select * into r from public.wms_nfc_readers where id=rid and owner=p_actor for update;
  if not found then raise exception 'Leitor não pertence ao usuário'; end if;
  if p_action='reader_revoke' then
    update public.wms_nfc_readers set active=false,mode='idle',arm_until=null where id=rid;
    update public.wms_nfc_counts set active=false where reader_id=rid;
    return jsonb_build_object('revoked',true,'id',rid);
  end if;
  if not r.active or (r.expires_at<=now() and p_action not in ('reader_get','reader_rotate')) then raise exception 'Leitor expirado'; end if;
  if p_action='reader_rotate' then
    update public.wms_nfc_counts set active=false where reader_id=rid;
    update public.wms_nfc_readers set secret_hash=p_payload->>'secretHash',expires_at=now()+interval '30 days',mode='idle',arm_until=null,count_session_id=null where id=rid;
  elsif p_action='enroll_arm' then
    if not public.wms_nfc_can_use(role_now,'v-labels') then raise exception 'Sem permissão de etiquetas'; end if;
    op:=(p_payload->>'operationId')::uuid; item:=p_payload->>'item';
    if r.operation_id=op then
      if r.enrollment_item<>item then raise exception 'Operação pertence a outra embalagem'; end if;
    else
      if r.mode='count' or (r.mode='enroll' and r.arm_until>now()) then raise exception 'Outra operação já está ativa'; end if;
      if not exists(select 1 from public.etiquetas where id=item) and not exists(select 1 from public.bobinas where etiqueta=item) then raise exception 'Embalagem não sincronizada'; end if;
      update public.wms_nfc_readers set mode='enroll',operation_id=op,enrollment_item=item,arm_until=now()+interval '2 minutes',enrollment_result=null,count_session_id=null,target=null where id=rid;
    end if;
  elsif p_action='enroll_cancel' then
    if r.operation_id=(p_payload->>'operationId')::uuid and r.mode='enroll' then
      update public.wms_nfc_readers set mode='idle',arm_until=null,enrollment_result=jsonb_build_object('status','cancelled','operationId',r.operation_id,'item',r.enrollment_item) where id=rid;
    end if;
  elsif p_action='count_start' then
    sid:=(p_payload->>'sessionId')::uuid;
    if not public.wms_nfc_can_use(role_now,p_payload->>'target') then raise exception 'Destino não autorizado'; end if;
    if r.mode='enroll' and r.arm_until>now() then raise exception 'Cadastro de chip em andamento'; end if;
    if r.mode='count' and r.count_session_id<>sid then raise exception 'Pause a outra sessão de contagem'; end if;
    insert into public.wms_nfc_counts(id,reader_id,owner,consumer_id,target,context_key)
      values(sid,rid,p_actor,(p_payload->>'consumerId')::uuid,p_payload->>'target',p_payload->>'contextKey') on conflict(id) do nothing;
    select * into c from public.wms_nfc_counts where id=sid for update;
    if c.owner<>p_actor or c.reader_id<>rid or c.target<>p_payload->>'target' or c.context_key<>p_payload->>'contextKey' then raise exception 'Sessão pertence a outro contexto'; end if;
    if c.active and c.expires_at>now() and c.consumer_id<>(p_payload->>'consumerId')::uuid then raise exception 'Pause a captura na outra tela antes de transferir'; end if;
    update public.wms_nfc_counts set active=true,consumer_id=(p_payload->>'consumerId')::uuid,expires_at=now()+interval '2 hours' where id=sid;
    update public.wms_nfc_readers set mode='count',count_session_id=sid,target=c.target,arm_until=null where id=rid;
  elsif p_action in ('count_status','count_stop','count_ack') then
    sid:=(p_payload->>'sessionId')::uuid;
    select * into c from public.wms_nfc_counts where id=sid and reader_id=rid and owner=p_actor for update;
    if not found or not public.wms_nfc_can_use(role_now,c.target) then raise exception 'Contagem não autorizada'; end if;
    if p_action<>'count_stop' and c.consumer_id<>(p_payload->>'consumerId')::uuid then raise exception 'Contagem conectada em outra tela'; end if;
    if p_action='count_stop' then
      update public.wms_nfc_counts set active=false where id=sid;
      if r.count_session_id=sid then update public.wms_nfc_readers set mode='idle' where id=rid; end if;
    elsif p_action='count_ack' then
      if (p_payload->>'cursor')::integer>c.next_seq or (p_payload->>'cursor')::integer<c.ack_cursor then raise exception 'Confirmação fora da sequência'; end if;
      update public.wms_nfc_counts set ack_cursor=(p_payload->>'cursor')::integer where id=sid;
    end if;
  elsif p_action='ingest' then
    if r.secret_hash<>p_payload->>'secretHash' then raise exception 'Link revogado'; end if;
    update public.wms_nfc_readers set last_seen_at=now() where id=rid;
    if coalesce((p_payload->>'probe')::boolean,false) then return jsonb_build_object('probe',true); end if;
    tag_uid:=p_payload->>'uid';
    if tag_uid is null or tag_uid !~ '^04[A-F0-9]{12}$' then raise exception 'UID inválido'; end if;
    if r.mode='enroll' then
      if not public.wms_nfc_can_use(role_now,'v-labels') then raise exception 'Sem permissão de etiquetas'; end if;
      if r.arm_until is null or r.arm_until<=now() then raise exception 'Prazo de cadastro terminou'; end if;
      begin
        result:=public.wms_bind_nfc_tag(tag_uid,r.enrollment_item,p_actor);
        result:=result||jsonb_build_object('status','bound','operationId',r.operation_id);
      exception when unique_violation or raise_exception then
        result:=jsonb_build_object('status','conflict','operationId',r.operation_id,'uid',tag_uid,'item',r.enrollment_item);
      end;
      update public.wms_nfc_readers set mode='idle',arm_until=null,enrollment_result=result where id=rid;
      return jsonb_build_object('enrollment',result);
    end if;
    if r.mode<>'count' then raise exception 'Abra cadastro ou contagem no WMS antes de ler'; end if;
    select * into c from public.wms_nfc_counts where id=r.count_session_id and reader_id=rid and owner=p_actor for update;
    if not found or not c.active or c.expires_at<=now() or not public.wms_nfc_can_use(role_now,c.target) then raise exception 'Contagem pausada ou expirada'; end if;
    if exists(select 1 from public.wms_nfc_scans where session_id=c.id and uid=tag_uid) then return jsonb_build_object('duplicate',true); end if;
    if c.next_seq>=1000 then raise exception 'Limite de 1000 tags nesta sessão'; end if;
    insert into public.wms_nfc_scans(session_id,seq,uid,scanned_at) values(c.id,c.next_seq+1,tag_uid,(p_payload->>'scannedAt')::timestamptz);
    update public.wms_nfc_counts set next_seq=next_seq+1 where id=c.id;
    return jsonb_build_object('duplicate',false);
  elsif p_action not in ('reader_create','reader_get','reader_rotate') then raise exception 'Ação inválida';
  end if;
  select * into r from public.wms_nfc_readers where id=rid;
  result:=jsonb_build_object('id',r.id,'label',r.label,'mode',r.mode,'active',r.active,'expiresAt',r.expires_at,
    'operationId',r.operation_id,'enrollmentItem',r.enrollment_item,'armUntil',r.arm_until,'enrollment',r.enrollment_result,'lastSeenAt',r.last_seen_at,
    'countSessionId',r.count_session_id,'target',r.target,
    'count', (select jsonb_build_object('id',id,'target',target,'contextKey',context_key,'active',active,'cursor',ack_cursor,'received',next_seq) from public.wms_nfc_counts where id=r.count_session_id and reader_id=rid and owner=p_actor));
  if p_action like 'count_%' then
    sid:=(p_payload->>'sessionId')::uuid;
    select * into c from public.wms_nfc_counts where id=sid;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.seq),'[]') into rows_json from
      (select seq,uid,scanned_at,received_at from public.wms_nfc_scans where session_id=sid and seq>coalesce((p_payload->>'cursor')::integer,c.ack_cursor) order by seq limit 100) s;
    result:=result||jsonb_build_object('session',jsonb_build_object('id',c.id,'consumerId',c.consumer_id,'target',c.target,'contextKey',c.context_key,'active',c.active,'cursor',c.ack_cursor,'received',c.next_seq,'expiresAt',c.expires_at),'items',rows_json);
  end if;
  return result;
end; $$;
revoke all on function public.wms_nfc_mobile(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.wms_nfc_mobile(text,text,jsonb) to service_role;
commit;
