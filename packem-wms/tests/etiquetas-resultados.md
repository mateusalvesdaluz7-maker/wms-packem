# Verificação das etiquetas — 29/09/2026

## Resultado

- `node --test tests/*.test.js`: **88 testes aprovados**, nenhuma falha.
- `node --test tests/space-labels.test.js`: **22 testes de etiquetas aprovados**.
- Sintaxe dos cinco arquivos indicados no comando `check`: aprovada.
- `git diff --check`: sem erros de conteúdo.

## Casos verificados

- Todas as etiquetas da vaga, incluindo saldo manual antigo e material bipado.
- Endereço abaixo do ID e no QR; unidades KG e MT.
- Reimpressão conserva T ou RV; geração não aumenta o saldo da vaga.
- Saída seguida de nova entrada manual cria outro RV, mesmo com colisão de código.
- QR de entrada conserva o ID lido; entrada repetida na mesma vaga ou em outra vaga não duplica estoque.
- Saída e reentrada por QR restauram o saldo do mesmo ID; reimpressão posterior conserva esse ID.
- Geração da rua inclui todos os níveis do depósito selecionado, preserva IDs e prepara as 301 etiquetas de um lote grande.
- Falha de uma vaga, mudança de saldo, cache incompleto e consulta com erro bloqueiam a impressão do lote.

## Leitura da imagem do QR

Três etiquetas renderizadas no navegador com as funções reais `zEtqCard`, `rastQRPayload` e `qrSvg` foram capturadas e decodificadas com jsQR 1.4.0. A biblioteca de geração usada na prévia é qrcode-generator 1.4.4, a mesma versão do aplicativo.

| ID de exemplo | Produto | Quantidade | Endereço | Leitura |
| --- | --- | --- | --- | --- |
| T20358969 | 0303010066 | 371,5 KG | I-70-1 | Aprovada |
| RV48769DCF02A83E2B | 0303010066 | 200 KG | I-70-1 | Aprovada |
| RVM0SAMPLE6720ABCD | 0303410001 | 6.720 MT | I-70-1 | Aprovada, incluindo ALÇA na descrição |

Os payloads lidos contêm o ID original, o produto, a quantidade e `Vaga: I-70-1`, separados por ` | `, sem quebras de linha.

## Falhas encontradas e corrigidas

1. A entrada por `placeBobina` não restaurava `BOB[id].rem` após uma saída. Isso fazia a geração tratar o saldo como manual e criar outro RV. A reentrada agora restaura o saldo do mesmo rastreio e preserva sua unidade.
2. Descrição acentuada era enviada ao QR com bytes incompatíveis com UTF-8. A geração agora usa o encoder UTF-8 disponível na biblioteca e restaura o encoder anterior ao terminar.

## Ambiente e limites

- Os testes usam estoque de exemplo e Supabase simulado em memória. Não registram movimentos no estoque de produção.
- A verificação do QR foi digital. Impressora Zebra, papel impresso e leitor físico não foram testados.
- Esta alteração usa as tabelas e a API fiscal existentes. Não exige uma nova migração no Supabase.
- O código e os testes estão na PR #14; este relatório não confirma publicação do código no site.
