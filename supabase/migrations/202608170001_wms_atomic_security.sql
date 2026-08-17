begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.wms_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique,
  role text not null check (role in ('admin','operador','recepcao','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wms_profiles enable row level security;
revoke all on public.wms_profiles from anon;
grant select on public.wms_profiles to authenticated;
grant all on public.wms_profiles to service_role;

drop policy if exists "profile reads own row" on public.wms_profiles;
create policy "profile reads own row" on public.wms_profiles
for select to authenticated
using (user_id = (select auth.uid()));

create or replace function private.wms_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.wms_profiles p
  where p.user_id = (select auth.uid()) and p.active = true
$$;

revoke all on function private.wms_role() from public, anon, authenticated;

create table if not exists public.wms_operations (
  operation_id text primary key,
  kind text not null,
  status text not null check (status in ('processing','completed','failed')),
  actor_id uuid references auth.users(id),
  actor_login text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.wms_operations enable row level security;
revoke all on public.wms_operations from anon, authenticated;
grant all on public.wms_operations to service_role;

alter table public.movimentos add column if not exists operation_id text;
create unique index if not exists movimentos_operation_id_uidx
  on public.movimentos(operation_id)
  where operation_id is not null;

create unique index if not exists locais_etiqueta_uidx on public.locais(etiqueta);

create or replace function public.wms_move_stock(
  p_operation_id text,
  p_action text,
  p_source_space_id text,
  p_destination_space_id text,
  p_label text,
  p_product text,
  p_quantity numeric,
  p_unit text,
  p_actor_login text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_existing public.wms_operations%rowtype;
  v_source public.espacos%rowtype;
  v_destination public.espacos%rowtype;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_current_location text;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_role := private.wms_role();
  if v_role not in ('admin','operador') then
    raise exception 'FORBIDDEN';
  end if;

  if p_operation_id is null or length(trim(p_operation_id)) < 12 then
    raise exception 'INVALID_OPERATION_ID';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 10000000 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if upper(coalesce(p_unit,'')) not in ('KG','MT','UN') then
    raise exception 'INVALID_UNIT';
  end if;
  if p_action not in ('entrada','saida','transferencia') then
    raise exception 'INVALID_ACTION';
  end if;

  select * into v_existing
  from public.wms_operations
  where operation_id = p_operation_id;

  if found then
    if v_existing.status = 'completed' then return v_existing.result; end if;
    raise exception 'OPERATION_ALREADY_PROCESSING';
  end if;

  insert into public.wms_operations(operation_id,kind,status,actor_id,actor_login,payload)
  values (
    p_operation_id,'stock_move','processing',(select auth.uid()),left(trim(p_actor_login),80),
    jsonb_build_object('action',p_action,'source',p_source_space_id,'destination',p_destination_space_id,
      'label',p_label,'product',p_product,'quantity',p_quantity,'unit',upper(p_unit))
  );

  if p_source_space_id is not null then
    select * into v_source from public.espacos where id = p_source_space_id for update;
    if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
    if coalesce(v_source.q,0) < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
    if p_product is not null and coalesce(v_source.pr,'') <> p_product then raise exception 'SOURCE_PRODUCT_MISMATCH'; end if;
  end if;

  if p_destination_space_id is not null then
    select * into v_destination from public.espacos where id = p_destination_space_id for update;
    if not found then raise exception 'DESTINATION_NOT_FOUND'; end if;
    if coalesce(v_destination.o,false) and coalesce(v_destination.pr,'') not in ('',p_product) then
      raise exception 'DESTINATION_OCCUPIED_BY_OTHER_PRODUCT';
    end if;
  end if;

  if nullif(trim(coalesce(p_label,'')),'') is not null then
    select code into v_current_location
    from public.locais where etiqueta = upper(trim(p_label))
    for update;
    if p_action = 'entrada' and v_current_location is not null
       and v_current_location <> p_destination_space_id then
      raise exception 'LABEL_ALREADY_LOCATED';
    end if;
  end if;

  if p_source_space_id is not null then
    update public.espacos
    set q = greatest(0,coalesce(q,0)-p_quantity),
        o = (coalesce(q,0)-p_quantity) > 0,
        pr = case when (coalesce(q,0)-p_quantity) > 0 then pr else '' end,
        upd = v_now,
        by_user = left(trim(p_actor_login),80)
    where id = p_source_space_id;
  end if;

  if p_destination_space_id is not null then
    update public.espacos
    set q = coalesce(q,0)+p_quantity,
        o = true,
        pr = p_product,
        u = upper(p_unit),
        upd = v_now,
        by_user = left(trim(p_actor_login),80)
    where id = p_destination_space_id;
  end if;

  if nullif(trim(coalesce(p_label,'')),'') is not null then
    if p_destination_space_id is null then
      delete from public.locais where etiqueta = upper(trim(p_label));
    else
      insert into public.locais(etiqueta,code)
      values (upper(trim(p_label)),p_destination_space_id)
      on conflict (etiqueta) do update set code = excluded.code;
    end if;
  end if;

  insert into public.movimentos(
    id,operation_id,action,w,code,pr,q,u,et,before_q,after_q,at,by_user
  ) values (
    p_operation_id,p_operation_id,p_action,'70',
    coalesce(p_destination_space_id,p_source_space_id),p_product,p_quantity,upper(p_unit),
    upper(trim(coalesce(p_label,''))),
    case when p_source_space_id is not null then coalesce(v_source.q,0) else coalesce(v_destination.q,0) end,
    case when p_destination_space_id is not null then coalesce(v_destination.q,0)+p_quantity else greatest(0,coalesce(v_source.q,0)-p_quantity) end,
    v_now,left(trim(p_actor_login),80)
  );

  v_result := jsonb_build_object(
    'ok',true,'operation_id',p_operation_id,'action',p_action,
    'source',p_source_space_id,'destination',p_destination_space_id,
    'label',upper(trim(coalesce(p_label,''))),'quantity',p_quantity,'unit',upper(p_unit),
    'confirmed_at',v_now
  );

  update public.wms_operations
  set status='completed',result=v_result,completed_at=v_now
  where operation_id=p_operation_id;

  return v_result;
exception when others then
  update public.wms_operations
  set status='failed',error=sqlerrm,completed_at=clock_timestamp()
  where operation_id=p_operation_id;
  raise;
end;
$$;

revoke all on function public.wms_move_stock(text,text,text,text,text,text,numeric,text,text) from public, anon;
grant execute on function public.wms_move_stock(text,text,text,text,text,text,numeric,text,text) to authenticated, service_role;

create table if not exists public.wms_request_item_locks (
  item_id text primary key,
  operation_id text not null unique,
  locked_until timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.wms_request_item_locks enable row level security;
revoke all on public.wms_request_item_locks from anon, authenticated;
grant all on public.wms_request_item_locks to service_role;

create or replace function public.wms_claim_request_item(
  p_operation_id text,
  p_item_id text,
  p_lease_seconds integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_claimed boolean := false;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if length(trim(coalesce(p_operation_id,''))) < 12 or length(trim(coalesce(p_item_id,''))) < 1 then
    raise exception 'INVALID_CLAIM';
  end if;

  insert into public.wms_request_item_locks(item_id,operation_id,locked_until)
  values (p_item_id,p_operation_id,clock_timestamp()+make_interval(secs=>greatest(5,least(p_lease_seconds,120))))
  on conflict (item_id) do update
    set operation_id=excluded.operation_id,locked_until=excluded.locked_until
    where public.wms_request_item_locks.locked_until < clock_timestamp()
       or public.wms_request_item_locks.operation_id = excluded.operation_id;

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

create or replace function public.wms_release_request_item(p_operation_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.wms_request_item_locks where operation_id = p_operation_id
$$;

revoke all on function public.wms_claim_request_item(text,text,integer) from public, anon, authenticated;
revoke all on function public.wms_release_request_item(text) from public, anon, authenticated;
grant execute on function public.wms_claim_request_item(text,text,integer) to service_role;
grant execute on function public.wms_release_request_item(text) to service_role;

commit;
