begin;

-- Keep the seven-byte UID contract; accept the Feiju tags read in the iPhone
-- pilot as well as NXP. No tag is bound and no stock record is changed here.
alter table public.wms_nfc_tags drop constraint if exists wms_nfc_tags_uid_check;
alter table public.wms_nfc_tags add constraint wms_nfc_tags_uid_check
  check (uid ~ '^(04|53)[A-F0-9]{12}$');
alter table public.wms_nfc_scans drop constraint if exists wms_nfc_scans_uid_check;
alter table public.wms_nfc_scans add constraint wms_nfc_scans_uid_check
  check (uid ~ '^(04|53)[A-F0-9]{12}$');

-- Replace only the UID predicate in the existing routines, preserving their
-- signatures, security settings, permissions and current workflow guards.
do $$
declare signature text;
begin
  foreach signature in array array[
    'public.wms_bind_nfc_tag(text,text,text)',
    'public.wms_nfc_mobile(text,text,jsonb)'
  ] loop
    execute replace(pg_get_functiondef(signature::regprocedure),
      '^04[A-F0-9]{12}$', '^(04|53)[A-F0-9]{12}$');
  end loop;
end $$;

commit;
