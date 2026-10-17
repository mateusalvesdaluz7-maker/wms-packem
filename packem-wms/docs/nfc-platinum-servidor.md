# NFC.cool Platinum no WMS

O cadastro é feito em NFC → Cadastrar tags: a lista do WMS seleciona uma embalagem existente, o usuário arma uma operação de dois minutos e a próxima leitura física vincula o UID NFC a essa embalagem. A contagem recebe apenas UIDs pela fila; produto, quantidade e unidade são consultados no WMS. Não é necessário escrever NDEF neste fluxo.

## Ativação no ambiente de prévia

1. Aplicar, nesta ordem, `supabase/migrations/202610160001_nfc_tags.sql`, `202610160002_nfc_mobile.sql` e `202610160003_nfc_feiju_uid.sql` no Supabase do WMS. São migrações repetíveis; as novas tabelas têm RLS e nenhuma permissão para anon/authenticated. Não alteram estoque. A terceira migração preserva os vínculos existentes e acrescenta UIDs Feiju ao contrato de sete bytes.
2. Configurar **no servidor da Vercel**, para Preview, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do mesmo projeto que contém `usuarios`, `etiquetas`, `bobinas` e os dados do WMS. A chave de serviço não deve ir para HTML, variáveis públicas, celular ou GitHub. Não use a chave anon em seu lugar.
3. Reimplantar a prévia do PR #48. A ausência de configuração retorna HTTP 503 com orientação, sem habilitar cadastro fictício ou simular sucesso.
4. Entrar novamente no WMS para disponibilizar a autenticação de usuário em memória. Em Gestão de Etiquetas, abrir o painel Platinum, gerar a conexão e colar o endereço no Webhook do NFC.cool. Ativar NFC; desligar Basic Auth e QR/código de barras. A chave aleatória do endereço é mostrada uma vez e seu hash fica no banco; renovar invalida o endereço anterior.
5. Com uma tag física compatível, selecionar uma etiqueta de ensaio existente, armar o cadastro e ler o chip. Conferir o UID no WMS. Depois abrir uma tarefa de inventário de ensaio e testar leitura, repetição e duas embalagens, sem usar estoque de produção na validação.

O PR e a publicação da prévia não aplicam migrações nem publicam em produção. Produção requer a configuração equivalente e a integração do PR pelo responsável.

## Teste físico sem movimentar estoque

Em NFC → Contar tags, selecione **Teste de contagem — sem movimentar estoque** e inicie a captura. O modo usa o leitor, o Webhook, a fila autenticada e a consulta UID → embalagem reais. A aplicação de cada leitura acrescenta somente à lista em memória dessa página, sem chamar as funções de entrada, saída ou ajuste. Quantidades são totalizadas separadamente por unidade; a releitura não soma a mesma embalagem novamente.

Os eventos e suas confirmações permanecem na fila NFC, em um contexto exclusivo de teste. O destino técnico dessa fila usa a permissão de inventário existente; ele não cria uma tarefa nem aplica o inventário normal. Pausar e retomar preserva o resultado enquanto a página permanecer aberta. “Nova captura após pausa” inicia outro teste, desde que a fila anterior tenha sido processada. Fechar/recarregar limpa a lista em memória; se houver captura anterior ativa, pause antes de iniciar novamente.

Os demais destinos conservam seu fluxo normal. Chão 70, Expedição e Recicladora aplicam entradas; Inventário depende de tarefa e vaga/passada disponíveis no WMS.

## Contrato do aplicativo e processamento

`POST /nfc-receber/<chave aleatória>` é reescrito para `/api/nfc-webhook`. Aceita o JSON observado/documentado pelo NFC.cool: `identifier`, `date`, `content`. O identificador precisa ser um UID de sete bytes com prefixo 04 (NXP) ou 53 (Feiju, observado no piloto); UUID de leitura QR é recusado. O UID não comprova o modelo nem a autenticidade do chip. Esta compatibilidade se aplica ao cadastro e à contagem pelo Platinum; as verificações específicas de NTAG no aplicativo nativo de gravação permanecem restritas a NXP. `content` não determina produto ou peso. O probe oficial `xx:xx:xx:xx` / `Awesome it worked!` verifica a conexão e não conta.

O vínculo só é aceito para embalagem existente e usuário ativo com Gestão de Etiquetas. O procedimento SQL serializa a operação, preserva vínculos existentes e grava o resultado. Repetir o mesmo UUID de operação não arma inadvertidamente outro cadastro. A fila mantém UID único por sessão, sequência, contexto e cursor de confirmação, com limite de mil UIDs e duas horas por captura. Leitores expiram em 30 dias e podem ter sua chave renovada ou ser revogados via API.

O cliente troca as credenciais existentes em memória por um token HMAC de quinze minutos. Senha e token NFC não são gravados em armazenamento do navegador. A cada chamada o servidor verifica usuário e permissões atuais; o Webhook só permite capturar no destino previamente armado pelo usuário. O endereço do Webhook não permite consultar registros nem alterar estoque diretamente.

O WMS resolve UID → embalagem → dados atuais e aplica o fluxo normal de entrada/contagem. A confirmação da fila ocorre somente após a presença ser confirmada pelo WMS. Uma resposta de confirmação perdida pode ser repetida sem somar novamente. Tag desconhecida ou erro bloqueia a sequência, preservando a fila para correção. Nenhum peso do Webhook é confiado.

Cada sessão fica ligada a uma tela consumidora. Outra tela só pode assumir depois de uma pausa explícita; o servidor recusa processamento com o identificador de uma tela anterior. Evite manter consumidores diferentes da mesma contagem abertos durante a transferência; um bip já em aplicação segue as regras normais de sincronização do WMS.

No inventário, o contexto inclui usuário, tarefa, vaga/chão e passada. Alterá-lo impede aplicação de leituras antigas no contexto novo. A confirmação de vaga e as passadas de reconferência continuam manuais pelo fluxo existente. Em uma captura pausada, a fila pode ser retomada na mesma sessão/contexto; uma passada nova recebe outra sessão.

No mesmo iPhone, o WMS fica suspenso enquanto o NFC.cool está em primeiro plano: a fila fica no servidor e é processada ao voltar ao WMS. Com WMS aberto no PC, o processamento pode acompanhar o celular. Esta implementação não fornece NFC ao Safari, não controla a Zebra e não garante sessões NFC indefinidas; o usuário reinicia a sessão no NFC.cool quando solicitado pelo iOS/app.

## Verificação reproduzível

- `node --test tests/*.test.js`: APIs, autenticação, parser, fila, resolução, confirmação e guardas de inventário, além da suíte existente.
- `npm install --no-save --package-lock=false @electric-sql/pglite@0.5.10` e `node tests/sql/nfc-mobile.mjs`: executa as migrações duas vezes em PostgreSQL isolado e verifica preservação de vínculos NXP, cadastro e contagem Feiju, conflitos, propriedade, privilégios, duplicatas, cursores, rotação e contexto. Não toca banco real. Também roda no CI.
- `/tests/ui/nfc-platinum.html`: ensaio visual com a interface real e API simulada, duas embalagens (300 + 250,5 kg). Não é evidência de leitura física e não altera estoque.

Em 16/10/2026, imagens do iPhone mostraram uma tag vazia ISO14443 Type A, fabricante informado Shanghai Feiju. O filtro anterior aceitava somente 04 e foi ampliado para 53. Após gravar o texto “Packem” e fazer nova aproximação no NFC.cool, o WMS confirmou um vínculo físico por UID à embalagem manual selecionada, com código e quantidade em MT. Não houve movimento de estoque nesse cadastro. O UID efetivamente cadastrado difere do da primeira foto; a tag a usar é a que aparece na confirmação do WMS.

As leituras anteriores da tag vazia não geraram POST observado. O servidor aceita UID sem conteúdo, mas o NFC.cool documenta o disparo para leituras NDEF; para o piloto, prepare a tag com texto simples antes do cadastro. O texto não contém nem determina código ou quantidade.

O teste físico de contagem no iPhone confirmou uma embalagem de 5.000 MT, com releituras mantendo o total e o cursor em uma única entrada. Os envios reais receberam HTTP 204. Houve expiração temporária na consulta do navegador; “Tentar novamente” recuperou a fila sem duplicar. A captura foi pausada com uma leitura recebida e processada, mantendo o resultado na tela e sem movimentar estoque. Não foi confirmado o modelo exato NTAG213 nem a cadência contínua do aparelho.
