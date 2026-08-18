# Segurança e operação

## Configuração obrigatória

Configure `WMS_ALLOWED_ORIGINS` na Vercel com os endereços autorizados, separados por vírgula.

Exemplo:

```text
https://seu-wms.vercel.app,https://wms.suaempresa.com.br
```

As funções recusam chamadas declaradas pelo navegador como `cross-site`, limitam volume por IP e não devolvem fragmentos de chaves secretas.

## Segredos

Mantenha apenas na Vercel:

- `GEMINI_API_KEY`
- `BASE44_API_KEY`
- `WMS_ALLOWED_ORIGINS`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (somente nas funções do servidor)

Nunca grave senhas administrativas ou chaves privadas no JavaScript do navegador.

## Preparação do banco de homologação

Use um projeto Supabase separado do banco em produção. Aplique, nessa ordem:

1. `supabase/migrations/202608170001_wms_atomic_security.sql`
2. `supabase/migrations/202608170002_request_idempotency.sql`

A chave `SUPABASE_SERVICE_ROLE_KEY` nunca pode aparecer no navegador ou no repositório.

## Antes de publicar

Execute:

```text
npm test
```

Depois valide em homologação:

1. login de administrador e operador;
2. consulta de requisições;
3. uma baixa controlada;
4. assistente de IA;
5. envio em lote;
6. backup e zeragem apenas em ambiente de teste.

## Estado desta base de teste

A branch contém a fundação de banco para movimentação atômica, bloqueio serializado das baixas e identificadores idempotentes. Ela deve ser validada em um Supabase de homologação antes de qualquer integração com a base ativa.
