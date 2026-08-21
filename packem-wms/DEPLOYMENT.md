# Implantação segura do WMS

## 1. Banco de dados

No SQL Editor do projeto Supabase usado pelo WMS, execute uma vez:

`supabase/migrations/202608200001_stock_operations.sql`

Essa migração cria o registro idempotente e a função transacional que bloqueia a vaga durante a baixa. Repetir o mesmo `operation_id` não retira estoque novamente.

Antes de liberar em produção, confirme que não existem etiquetas repetidas:

```sql
select upper(etiqueta) etiqueta, count(*) quantidade
from public.locais
where coalesce(etiqueta, '') <> ''
group by upper(etiqueta)
having count(*) > 1;
```

O resultado esperado é vazio. Se aparecer algum registro, confira fisicamente a localização antes de corrigir o banco.

## 2. Variáveis da Vercel

Configure no projeto que publica a pasta `packem-wms`:

- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: chave `service_role`, somente no servidor; nunca coloque no HTML ou JavaScript do navegador.
- `BASE44_API_KEY`: chave usada pela integração das requisições.
- `BASE44_APP_ID`: opcional; se ausente, o identificador atual do aplicativo será usado.
- `WMS_ALLOWED_ORIGINS`: opcional, lista separada por vírgulas. Exemplo: `https://wms-packem.vercel.app`.

Depois de alterar variáveis, faça um novo deploy.

## 3. Verificação antes de liberar

Na pasta `packem-wms`, rode:

```text
npm test
npm run check
```

Teste com uma etiqueta de homologação: faça a entrada, bipe uma vez, repita o mesmo envio e confirme que existe apenas uma saída em `movimentos` e que a vaga ficou com o saldo correto.

## Fluxo corrigido

Uma baixa completa deixa a requisição em **A Confirmar**. Apenas a confirmação administrativa muda para **Finalizadas**. Falhas de rede podem ser repetidas com segurança usando o mesmo identificador da operação.

