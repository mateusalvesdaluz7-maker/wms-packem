begin;

create table if not exists public.wms_stock_operations (
  operation_id text primary key,
  action text not null check (action in ('saida')),
  label text not null,
  product text not null,
  source_space_id text not null,
  destination_space_id text,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  actor text not null,
  reference text not null default '',
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists wms_stock_operations_label_idx
  on public.wms_stock_operations (label, created_at desc);

alter table public.wms_stock_operations enable row level security;
revoke all on public.wms_stock_operations from anon, authenticated;

create or replace function public.wms_stock_operation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  op_id text := trim(payload->>'operation_id');
  op_action text := lower(trim(payload->>'action'));
  op_label text := upper(trim(payload->>'label'));
  op_product text := upper(trim(payload->>'product'));
  op_source text := upper(trim(payload->>'source_space_id'));
  op_unit text := upper(coalesce(nullif(trim(payload->>'unit'), ''), 'KG'));
  op_actor text := trim(payload->>'actor');
  op_reference text := left(coalesce(payload->>'reference', ''), 160);
  op_quantity numeric := nullif(payload->>'quantity', '')::numeric;
  previous_result jsonb;
  source_row public.espacos%rowtype;
  before_quantity numeric;
  after_quantity numeric;
  confirmed_at timestamptz := clock_timestamp();
  movement_id text;
  stored_label_code text;
begin
  if op_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$' then raise exception 'operation_id inválido'; end if;
  if op_action <> 'saida' then raise exception 'ação não permitida'; end if;
  if op_label = '' or op_product = '' or op_source = '' or op_actor = '' then raise exception 'dados obrigatórios ausentes'; end if;
  if op_quantity is null or op_quantity <= 0 then raise exception 'quantidade inválida'; end if;

  select result into previous_result from public.wms_stock_operations where operation_id = op_id;
  if previous_result is not null then return previous_result || jsonb_build_object('replayed', true); end if;

  insert into public.wms_stock_operations(operation_id, action, label, product, source_space_id, quantity, unit, actor, reference)
  values(op_id, op_action, op_label, op_product, op_source, op_quantity, op_unit, op_actor, op_reference)
  on conflict (operation_id) do nothing;

  if not found then
    select result into previous_result from public.wms_stock_operations where operation_id = op_id;
    if previous_result is not null then return previous_result || jsonb_build_object('replayed', true); end if;
    raise exception 'operação já está em processamento';
  end if;

  select e.* into source_row
  from public.espacos e
  where upper(e.id) = op_source
     or upper(concat_ws('-', e.s, e.l, e.p)) = op_source
  for update
  limit 1;

  if not found then raise exception 'vaga de origem não encontrada'; end if;
  if not coalesce(source_row.o, false) or coalesce(source_row.q, 0) <= 0 then raise exception 'vaga sem saldo disponível'; end if;
  if upper(coalesce(source_row.pr, '')) <> op_product then raise exception 'produto da vaga é diferente do produto solicitado'; end if;
  select l.code into stored_label_code
  from public.locais l
  where upper(l.etiqueta) = op_label and upper(l.code) = op_source
  for update
  limit 1;

  if not found then
    raise exception 'etiqueta não está armazenada na vaga informada';
  end if;

  before_quantity := source_row.q;
  if op_quantity > before_quantity + 0.0001 then raise exception 'quantidade maior que o saldo da vaga'; end if;
  after_quantity := greatest(0, before_quantity - op_quantity);

  update public.espacos
     set q = after_quantity,
         o = after_quantity > 0,
         pr = case when after_quantity > 0 then pr else '' end,
         upd = confirmed_at,
         by_user = op_actor
   where id = source_row.id;

  delete from public.locais where upper(etiqueta) = op_label;

  movement_id := op_id;
  insert into public.movimentos(id, action, w, code, pr, q, u, et, before_q, after_q, at, by_user)
  values(movement_id, 'saida', source_row.w, op_source, op_product, op_quantity, op_unit, op_label, before_quantity, after_quantity, confirmed_at, op_actor)
  on conflict (id) do nothing;

  previous_result := jsonb_build_object(
    'ok', true,
    'operation_id', op_id,
    'label', op_label,
    'product', op_product,
    'source_space_id', op_source,
    'quantity', op_quantity,
    'before', before_quantity,
    'after', after_quantity,
    'confirmed_at', confirmed_at,
    'replayed', false
  );

  update public.wms_stock_operations
     set result = previous_result, completed_at = confirmed_at
   where operation_id = op_id;
  return previous_result;
exception when others then
  delete from public.wms_stock_operations where operation_id = op_id and result is null;
  raise;
end;
$$;

revoke all on function public.wms_stock_operation(jsonb) from public, anon, authenticated;
grant execute on function public.wms_stock_operation(jsonb) to service_role;

commit;
