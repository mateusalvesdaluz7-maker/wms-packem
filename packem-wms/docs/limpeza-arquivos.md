# Limpeza de arquivos sem uso - 22/10/2026

Revisão da branch `codex/wms-nfc-envio-automatico`, a partir do commit
`194202c`. Foram conferidos os 144 arquivos rastreados, os carregamentos de
HTML/JavaScript, as rotas Vercel, os imports, a documentação e os workflows.
Ausência de referência no código não é uma medição de acessos em produção.

## Arquivos removidos

| Arquivo em `packem-wms/` | Evidência |
| --- | --- |
| `ask.js` | Cópia antiga da função de servidor. A rota `/api/ask` e o wrapper da raiz usam `api/ask.js`. Não era carregada pelo navegador. |
| `requisicoes.js` | Cópia antiga da função de servidor. A rota e os aliases usam `api/requisicoes.js`. A mensagem no navegador sobre esse nome se refere à versão na pasta `api/`. |
| `ocr-etiqueta.js` | Cópia fora da pasta `api/`, sem imports ou referências. A função publicada permanece em `api/ocr-etiqueta.js`. |
| `wms-floor-sync-fix.js` | Patch avulso sem referência em HTML, JavaScript, documentação ou workflow. A sincronização ativa está em `wms-app.js` e é coberta pelos testes existentes. |
| `wms-ocr-id-fix.js` | Patch avulso sem qualquer carregamento no projeto. O OCR ativo e seus testes permanecem. |
| `wms-recebimento-print20.js` | Implementação avulsa de impressão sem qualquer referência ou carregamento. |
| `wms-recebimento-print20-v2.js` | Segunda implementação avulsa de impressão, também sem referência ou carregamento. |
| `galpao_-_34_x_70.glb` | Modelo 3D de 14.755.228 bytes sem referência. O carregamento GLTF ativo usa `forklift.glb`, que foi preservado. |

Total retirado da árvore atual: **14.784.877 bytes**, aproximadamente
**14,10 MiB**. O histórico Git continua disponível; esta alteração não reduz
o tamanho dos clones que baixam todo o histórico.

## Arquivos preservados

- As funções publicadas em `packem-wms/api/` e os wrappers da pasta `api/`
  da raiz, que encaminham chamadas para essas funções.
- Todos os módulos NFC carregados pelo `index.html`, inclusive as alternativas
  de leitura que compartilham a infraestrutura de cadastro e contagem.
- O projeto iOS, que possui workflow, fontes e testes próprios. Sua remoção
  seria uma retirada de funcionalidade, não uma limpeza de arquivo sem uso.
- Testes, migrações SQL, bibliotecas, catálogos e o modelo `forklift.glb` usado
  no mapa 3D.

## Verificação

Antes e depois da limpeza, os **355 testes Node passaram**. A validação de
sintaxe dos JavaScripts fora de `vendor/`, os **74 caminhos locais em HTML**
e os imports CommonJS também passaram. O teste SQL NFC isolado foi executado
com sucesso usando a dependência PGlite já disponível no ambiente de testes.

Comandos equivalentes para repetir a validação a partir de `packem-wms/`:

```text
npm test
npm run check
node tests/sql/nfc-mobile.mjs
```

O teste SQL depende de `@electric-sql/pglite`, conforme o workflow de validação,
e usa um banco isolado, sem credenciais nem alterações no Supabase real.
O módulo pode ser apontado por `NFC_PGLITE_MODULE` quando instalado fora da
pasta do projeto. A execução local usou Node 24.19.0; o workflow do GitHub
configura Node 20. Não foram modificados fluxos de estoque, rotas ou código ativo.

A `.gitignore` na raiz impede o versionamento acidental de dependências,
variáveis de ambiente, saídas e pastas locais de pesquisa. Nenhum dado de
estoque foi apagado.
