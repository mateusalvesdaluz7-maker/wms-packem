begin;

create or replace function public.wms_begin_request_operation(
  p_operation_id text,
  p_item_id text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.wms_operations%rowtype;
  v_claimed boolean;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_op from public.wms_operations where operation_id=p_operation_id for update;
  if found and v_op.status='completed' then
    return jsonb_build_object('state','completed','result',v_op.result);
  end if;
  if found and v_op.status='processing' and v_op.created_at > clock_timestamp()-interval '2 minutes' then
    return jsonb_build_object('state','busy');
  end if;

  select public.wms_claim_request_item(p_operation_id,p_item_id,45) into v_claimed;
  if not v_claimed then return jsonb_build_object('state','busy'); end if;

  insert into public.wms_operations(operation_id,kind,status,actor_login,payload,created_at,completed_at,error,result)
  values(p_operation_id,'request_pick','processing','server',p_payload,clock_timestamp(),null,null,null)
  on conflict(operation_id) do update
    set status='processing',payload=excluded.payload,created_at=clock_timestamp(),
        completed_at=null,error=null,result=null;

  return jsonb_build_object('state','claimed');
end;
$$;

create or replace function public.wms_complete_request_operation(
  p_operation_id text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  update public.wms_operations
  set status='completed',result=coalesce(p_result,'{}'::jsonb),completed_at=clock_timestamp()
  where operation_id=p_operation_id;
  delete from public.wms_request_item_locks where operation_id=p_operation_id;
  return p_result;
end;
$$;

create or replace function public.wms_fail_request_operation(
  p_operation_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  update public.wms_operations
  set status='failed',error=left(coalesce(p_error,'erro'),500),completed_at=clock_timestamp()
  where operation_id=p_operation_id;
  delete from public.wms_request_item_locks where operation_id=p_operation_id;
end;
$$;

revoke all on function public.wms_begin_request_operation(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.wms_complete_request_operation(text,jsonb) from public,anon,authenticated;
revoke all on function public.wms_fail_request_operation(text,text) from public,anon,authenticated;
grant execute on function public.wms_begin_request_operation(text,text,jsonb) to service_role;
grant execute on function public.wms_complete_request_operation(text,jsonb) to service_role;
grant execute on function public.wms_fail_request_operation(text,text) to service_role;

commit;
