-- Índices usados pela sincronização e reconciliação fiscal.
create index if not exists etiquetas_doc_key_idx on public.etiquetas (doc_key);
create index if not exists etiquetas_updated_at_idx on public.etiquetas (updated_at);
create index if not exists notas_fiscais_updated_at_idx on public.notas_fiscais (updated_at);
create index if not exists romaneios_updated_at_idx on public.romaneios (updated_at);

-- DELETE precisa carregar a chave antiga para todos os aparelhos removerem o registro.
alter table public.etiquetas replica identity full;
alter table public.notas_fiscais replica identity full;
alter table public.romaneios replica identity full;

-- Garante eventos em tempo real para as três tabelas fiscais.
do $$
declare tabela text;
begin
  foreach tabela in array array['etiquetas','notas_fiscais','romaneios'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabela);
    end if;
  end loop;
end $$;
