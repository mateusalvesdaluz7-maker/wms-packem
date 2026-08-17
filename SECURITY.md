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

Nunca grave senhas administrativas ou chaves privadas no JavaScript do navegador.

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

## Limite desta etapa

Este pacote não implementa transação única de estoque, controle de concorrência da baixa de requisições nem um novo identificador de movimentação.
