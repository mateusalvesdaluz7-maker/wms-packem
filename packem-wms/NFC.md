# Gravação de etiquetas e leitura NFC para contagem

Esta alteração conecta o bloco de etiquetas rastreáveis preparado pelo WMS à fila NFC do computador. O operador conecta a estação uma vez; cada bloco seguinte transmite ID da embalagem, código, quantidade e unidade automaticamente, antes da abertura da impressão. Não há exportação de arquivo nem cópia de cada etiqueta.

**O código está preparado para revisão. Não foi publicado no WMS de produção. Esta integração não implementa gravação contínua no iPhone nem sincroniza mecanicamente o rolo com o NFC.** O NFC.cool Platinum permanece como gravador assistido, com início da escrita e releitura no telefone. Aceitação dos dados pela estação não comprova impressão ou gravação física.


## Novo piloto: gravar, conferir e ler dentro do WMS com Natively Preview

O caminho experimental `/nfc-direto.html` integra o SDK oficial Natively 2.28.14, commit `ba20c57a0e20e5a6d9bbc0ec5d7ec1b09abbf644`, copiado localmente com atribuição ISC. A página não busca código de SDK em um CDN durante o uso. A ponte só é chamada quando o aplicativo fornece `$agent`; no navegador comum a antena fica indisponível.

Em Gestão de Etiquetas, **Escanear QR da embalagem** usa a câmera já existente, sem OCR, e consulta o cadastro automaticamente. O operador também pode informar o ID. Depois usa **Novo piloto → Gravar e vincular por aproximação** e apresenta uma NTAG213 de laboratório vazia. A escrita coloca um único registro NDEF Text com ID individual, código, quantidade e unidade na tag. Substitui o conteúdo anterior; não bloqueia nem altera senhas do chip. O campo `recordId` é um identificador do registro, **não é usado como UID de fábrica**.

Uma resposta `SUCCESS` de escrita deixa a tentativa pendente. **Conferir tag gravada** abre outra leitura e compara os quatro dados com o conteúdo esperado e com o cadastro atual. Somente essa releitura permite mostrar a conferência nesta aba. O vínculo fica no chip, referenciando o cadastro existente; não há tabela paralela nem novo comprovante de auditoria gravado no servidor. Timeout, cancelamento ou mudança de contexto deixam o resultado físico incerto. Encerrar a tentativa não apaga o chip. Cada chamada usa uma instância do serviço SDK, isolando callbacks tardios de tentativas seguintes.

Na contagem, **Iniciar contagem por aproximação** solicita uma leitura por vez ao SDK, espera a validação e a função normal do WMS e pede a seguinte após 800 ms. **Ler uma tag** faz uma leitura avulsa. Cancelamento, erro, saída da página ou troca de contexto encerram o processamento; retornos tardios não adicionam itens. A associação é pelo ID individual gravado; não identifica uma tag vazia apenas pelo UID. Os outros leitores não podem ser ativados simultaneamente a essa operação.

**Condições ainda não comprovadas:** captura física, payload real retornado no iPhone 11, reinício entre sessões e liberação do NFC no modo gratuito. A [App Store](https://apps.apple.com/br/app/natively-preview/id1626045691) lista o Preview gratuito e menciona NFC desde 2.12.6. A [documentação do Preview](https://docs.buildnatively.com/natively-platform/preview) admite limitações e não garante todos os recursos. A [página de NFC](https://docs.buildnatively.com/natively-platform/features/nfc) exige plano Unlimited/Lifetime e equipe Apple para um app próprio. Nenhum plano, conta ou build foi contratado/criado por este piloto. Não foi confirmado uso gratuito permanente; se o teste exigir assinatura, não atende ao requisito do usuário.

O ensaio `/tests/ui/nfc-direto.html?simulate=1` usa o **SDK oficial** com uma ponte de rádio fictícia, sem APIs de estoque. Duas tags virtuais são escritas, relidas e contadas, somando 550,5 kg. Repetir a primeira não duplica. Sem o parâmetro de simulação, o ensaio exige a ponte nativa; no Natively a simulação fica desativada. O teste não comprova a antena nem a licença.

Também foram conferidos os caminhos [Median NFC](https://docs.median.co/docs/nfc-tag-scanner), que documenta conteúdo NDEF, e [BDK NFC](https://docs.thebdk.com/reference/objects), que documenta `id: null` no iOS. Eles não demonstraram o cadastro gratuito por UID de tag vazia. O app próprio abaixo fornece controle nativo, mas continua dependente de assinatura iOS; o piloto Natively é uma alternativa de teste para a associação gravada no chip.

## Aplicativo próprio Packem WMS para iPhone 11

`ios/PackemWMS` contém o aplicativo nativo próprio: abre o WMS existente em `WKWebView` e usa Core NFC para entregar UID e texto de NTAG213 ao módulo `wms-nfc-app.js`. Nas três telas existentes aparece **Ler NFC**. O botão fica desabilitado no Safari; funciona somente com a ponte do aplicativo nativo. NFC.cool e iScanBrowser não são necessários nesse caminho.

O operador inicia a leitura e aproxima uma etiqueta já gravada por vez. Cada entrada aguarda conferência de ID, código, quantidade e unidade no cadastro, e confirmação pela função normal da tela. Releituras não duplicam a embalagem. Tags vazias precisam ser gravadas antes. As entradas seguem o comportamento existente do WMS, inclusive a mudança de local e o histórico quando a função normal da tela os registra; não são uma contagem independente do estoque.

Pausa, mudança de usuário/tela/modo, navegação e saída do aplicativo encerram a sessão. Uma divergência exige conferência e reapresentação da etiqueta. O iOS encerra cada sessão em até cerca de 60 segundos; o usuário toca novamente em **Ler NFC** para continuar. A ponte aceita somente a origem HTTPS exata de produção/prévia e o quadro principal. O conteúdo da tag é passado como argumento estruturado, nunca executado como código.

**Estado: fonte do app e integração web preparados; instalação, assinatura iOS e leitura física não concluídas.** Nenhum IPA assinado foi gerado. A conta gratuita Personal Team não inclui a capacidade NFC; o projeto não contorna essa restrição nem contrata assinatura. A compilação sem assinatura no workflow macOS não torna o aplicativo instalável no telefone. Configuração e ensaio estão em [`ios/PackemWMS/LEIA-ME.md`](../ios/PackemWMS/LEIA-ME.md).

A página isolada `/tests/ui/nfc-app.html` usa catálogo fictício e simula a entrega da ponte no navegador, sem APIs de estoque. Duas embalagens devem somar 550,5 kg, mantidos após repetir a primeira. Esse ensaio não aciona a antena. Os testes verificam contexto, UID, sequência, deduplicação, divergência e ausência de confirmação. A captura física e o fluxo autenticado em estoque real continuam pendentes.

Em 15/10/2026, o código nativo do commit `a1746860e666179784ba2112e8e53575e18e053e` passou os seis testes Swift e compilou com Xcode para simulador e iPhone, ambos sem assinatura, no [workflow macOS](https://github.com/mateusalvesdaluz7-maker/wms-packem/actions/runs/38783708988). Nenhum certificado ou conta Apple foi usado. Na prévia HTTPS, o ensaio da ponte recebeu duas embalagens fictícias e mostrou **2 etiquetas / 550,5 kg**; repetir a primeira manteve o total, e parar recusou outra leitura. Isso valida o software e a compilação, sem comprovar instalação ou rádio NFC.

## iPhone 11 com o WMS aberto no iScanBrowser

`wms-nfc-iphone.js` adiciona **Contar com NFC · iScanBrowser** às três telas de contagem existentes. Este é o caminho escolhido para usar o WMS no iPhone sem uma assinatura Apple Developer própria. Durante a contagem, dispensa a estação no PC e a troca para NFC.cool: o WMS fica aberto dentro do iScanBrowser, um aplicativo nativo que documenta leitura CoreNFC e regras de preenchimento de páginas. Isso não acrescenta Web NFC ao Safari.

Em **Gestão de Etiquetas → Preparar tag NFC da embalagem**, `wms-nfc-preparar.js` consulta o ID já cadastrado pelo fluxo normal do WMS e monta o texto com código, quantidade e unidade reais do cadastro. Preserva zeros à esquerda, normaliza a quantidade e aplica o mesmo parser usado na leitura. Conteúdo inválido é recusado sem truncar. A consulta só termina com o mesmo usuário e a tela ativa. Esse painel não cria estoque paralelo, não fabrica UID e não afirma que o chip foi gravado. A primeira gravação é feita como um único registro de Texto no NFC.cool. Cada embalagem usa um ID individual.

O guia operacional `/nfc-iphone.html` reúne instalação, preparação, regra de preenchimento e ensaio com duas etiquetas. O aplicativo próprio permanece como opção recolhida nas telas fora de sua ponte nativa.

**Estado: adaptador de software preparado; o usuário informou que instalou o iScanBrowser. Licença e captura NFC física ainda não foram validadas.** Em 15/10/2026, a App Store brasileira lista R$ 129,90 para “Built-in NFC reading”. Outras condições/licenças do aplicativo ainda não foram confirmadas; não foi realizada compra. O usuário não precisa se inscrever no Apple Developer para usar um aplicativo já publicado. A leitura contínua e a eventual retomada da sessão CoreNFC precisam ser conferidas com duas NTAG213.

Configuração proposta:

1. Abra a prévia do WMS dentro do iScanBrowser e entre normalmente com seu usuário. Comece pela página isolada `/tests/ui/nfc-iphone.html`, sem acessar o estoque.
2. Na contagem em modo Entrada, use **Ativar recepção do iPhone**. O campo estável `packemNfcInput` aparece fora da área que o WMS redesenha a cada entrada.
3. No iScanBrowser, crie uma regra **Active Page** para a origem exata da prévia, com fonte **Internal NFC NDEF Reader**. Use o assistente para selecionar o campo `packemNfcInput`.
4. Desative **Only if empty**, **Append data** e **Call Form.Submit()**. Em **Execute JS**, configure `window.PackemNfcIphone.capture();`. Cada chamada recolhe o texto antes de processar a fila; não é necessário tocar em Enter a cada leitura. Não marque **Scanned value is URL**.
5. Associe o gatilho nativo ao leitor CoreNFC. O fabricante documenta **Constant Read Mode** ao manter o gatilho pressionado; sua operação efetiva com o leitor interno e os limites de sessão ainda precisam de validação no iPhone 11.
6. Aproxime uma etiqueta por vez. O WMS confere ID, código, quantidade e unidade com o cadastro antes de usar a entrada normal. Para encerrar, pause a recepção no WMS e pare o gatilho no aplicativo.

Este adaptador recebe o texto NDEF, sem pressupor que o app forneça o UID. A deduplicação usa o ID único da embalagem; nenhum UID fictício é criado. O Webhook anterior continua exigindo o UID real. Links, campos desconhecidos/repetidos, texto acima de 120 bytes e medições inválidas são recusados. A fila é sequencial, limitada a dez pendências e 1000 embalagens por sessão. Erro, troca de usuário/tela/modo e saída do aplicativo pausam o processamento. Pendências ficam apenas na memória da aba: não recarregue nem feche a página antes de conferir e terminar a fila. Entradas já aplicadas seguem a persistência normal do WMS.

A página `/tests/ui/nfc-iphone.html` tem botões que entregam texto fictício ao mesmo adaptador. Duas embalagens somam 550,5 kg e repetir uma não duplica. Esse teste não aciona a antena, não comprova compatibilidade comercial do aplicativo e não usa APIs de estoque.

Referências primárias: [Serialio — Web Form Rules no iOS](https://serialio.com/faq/iscanbrowser/iscanbrowser-web-form-rules-ios/), [gatilhos e leitor CoreNFC](https://serialio.com/support/iscanbrowser-triggers-ios/), [listagem e compras do iScanBrowser](https://apps.apple.com/br/app/iscanbrowser/id427430406). Também foram pesquisados os projetos [Web NFC do W3C](https://github.com/w3c-cg/web-nfc) e [bilafish/nfc-reader](https://github.com/bilafish/nfc-reader); a API de navegador usada por eles não resolve a leitura no Safari do iPhone.

## Leitura via NFC.cool e estação no PC

A estação 0.6.0 também recebe leituras do NFC.cool por Webhook HTTPS. O aplicativo envia `identifier`, `date` e `content`; a estação exige Basic Auth exclusivo, interpreta o texto `JOB=...;ID=...;COD=...;QTD=...;UN=...` (ou o formato anterior `PLG`) e guarda a leitura antes de responder 204. Código permanece texto; quantidades são somadas com decimal exato, por unidade. UID e ID da embalagem impedem duplicação; dados conflitantes são recusados. Cada sessão recebe até 1000 etiquetas e fica pausada ao reiniciar o servidor. Sessões anteriores são arquivadas no computador.

`wms-nfc-reader.js` acrescenta **Conectar leitor** aos modos **Chão expedição**, **Chão 70** e **Recicladora - 91**. Não reativa o Inventário removido do produto. O operador conecta a estação ao destino; os eventos só entram com usuário autenticado, tela correspondente ativa e modo Entrada. O WMS consulta o cadastro pelo ID e confere código, quantidade e unidade antes de chamar a função normal de entrada. Não cria catálogo confiando no chip, não altera peso e não chama saídas automaticamente. A entrada recusada pelo WMS permanece pendente.

A conexão verifica origem, janela e identificador. O código principal da estação continua fora do WMS. No link HTTPS, o WMS recebe apenas uma credencial de leitor, que não acessa a fila de gravação nem cria leituras pelo endpoint interno. O NFC.cool usa usuário/senha diferentes, exclusivos do Webhook. O iframe de leitura admite somente a origem configurada do WMS, com alternativa em outra aba. Leituras pendentes têm sequência; confirmação perdida é repetida sem somar uma embalagem já contada.

1. Inicie a estação 0.6.0 no modo celular. Para superar bloqueio de entrada na rede, execute os iniciadores HTTPS incluídos em `computador/LEIA-ME.md`.
2. No iPhone, abra `/reader` pelo QR Code. Configure **Mais → Webhook** no NFC.cool com URL, usuário e senha mostrados; habilite somente leituras NFC.
3. Use **Abrir WMS com o leitor conectado**, entre com seu usuário e abra o destino de contagem. Clique **Conectar leitor** uma vez. Esse passo abre a sessão de recepção correspondente.
4. Abra o leitor do NFC.cool. Cada leitura enviada fica guardada; ao voltar ao WMS, as pendentes são aplicadas à contagem conectada. O Safari não acessa NFC. A continuidade de leitura e eventual necessidade de reiniciar a sessão NFC dependem do aplicativo e ainda precisam de teste físico.
5. Use **Pausar leitor** para terminar. Para recontar as mesmas etiquetas em uma sessão nova, escolha **Nova contagem NFC** depois de pausar; **Conectar leitor** retoma a sessão existente. Não inicie recepção avulsa em `/reader` e outra sessão do WMS ao mesmo tempo: há um único destino ativo por estação.

A página `/tests/ui/nfc-leitura.html` usa catálogo e contagem locais, sem carregar APIs do estoque: duas embalagens fictícias do código 0303450047 totalizam 550,5 kg. Eventos HTTP de teste validam o transporte; não comprovam captura física de NFC. A primeira leitura real depende da chegada das NTAG213. Na prévia HTTPS, o quadro de leitura conectou e aplicou 300 kg + 250,5 kg à contagem isolada. Reenviar o primeiro evento retornou `duplicate` e manteve duas etiquetas / 550,5 kg. Pausar pelo WMS encerrou a recepção. Os eventos foram enviados por HTTP com dados fictícios, sem captura NFC física.

O Webhook do NFC.cool não possui fila de reenvio automático quando a rede falha. Confira o histórico do aplicativo e reenvie a leitura; a recepção reconhece a repetição. A estação e o túnel precisam permanecer ativos. O endereço temporário muda ao reiniciar e expira em duas horas; é um piloto, não um endpoint de produção estável.

## Envio para gravação

`printZebraEtq`, quando imprime etiquetas rastreáveis, passa cada bloco efetivamente escolhido ao módulo `wms-nfc-bridge.js`. A comunicação usa um quadro local em `http://127.0.0.1:8788/wms-bridge`, aberto dentro do WMS pelo operador. O módulo aguarda a confirmação de recepção antes de chamar a impressão existente. Blocos posteriores cancelados pelo operador não são encaminhados antecipadamente.

O código de acesso é informado somente no quadro local, isolado do WMS pela política de origem do navegador. Ele não é enviado ao site Vercel. As mensagens verificam origem exata, referência do quadro e identificador da conexão. A estação só permite enquadrar a página de conexão na origem configurada; as demais páginas continuam com `frame-ancestors 'none'`. Não foi aberto CORS para sites externos.

O receptor persiste os itens e o recibo do envio juntos. Um reenvio com o mesmo identificador recupera os mesmos IDs; dados diferentes com o mesmo identificador são recusados. IDs já usados em outro envio bloqueiam reimpressão pela integração até conferência. O código do produto continua sendo texto, e a unidade é obtida pela mesma função usada no rótulo impresso: KG, MT ou UN.

## Preparar o teste

1. Atualize a estação PC com o pacote `nfc-piloto` desta entrega e abra **INICIAR-CELULAR.cmd**, porta 8788. Esse processo não imprime; a impressão permanece no WMS.
2. Aplique esta alteração primeiro em um ambiente de homologação. A origem permitida no receptor deve corresponder exatamente à origem usada no teste; o padrão de produção é `https://wms-packem.vercel.app`. Para uma prévia, defina `NFC_WMS_ORIGIN` como a origem HTTPS exata, sem barra final. Use a estação 0.5.1 ou posterior.
3. No navegador do PC que usa a Zebra, abra **Gestão de Etiquetas → Conectar estação NFC**. Informe o código exibido no terminal dentro do quadro local que aparece no WMS. Se o navegador não carregar o quadro, use **Conectar em outra aba** e mantenha essa aba aberta. Somente a janela escolhida pode confirmar a conexão.
4. Mantenha a conexão aberta. Confira primeiro a página `/tests/ui/nfc-estacao.html`: ela envia duas etiquetas fictícias e não carrega as APIs de estoque nem imprime. Depois de conferir a transmissão, teste uma etiqueta real com seu ID, código, quantidade e unidade.
5. Faça a gravação e a releitura assistidas. Só depois teste duas etiquetas diferentes e os controles de pausa e recuperação.

Ao recarregar o WMS, reconecte o quadro. Fechar a estação, pausar a fila ou falhar ao receber os dados interrompe a impressão enquanto a integração estiver habilitada. Após reiniciar o servidor, é necessária nova ativação; uma tarefa incerta exige conferência e retomada antes de habilitar o envio.

**Usar impressão sem NFC** desativa a ponte nessa aba e mantém o fluxo de impressão anterior. A função não apaga tarefas já recebidas pela estação. Não use isso como recuperação automática de um bloco cujo resultado de impressão seja incerto.

## Limites de operação

- O gancho cobre as etiquetas rastreáveis enviadas por `printZebraEtq(..., 'rast')`, inclusive os caminhos de recebimento que chamam essa função. Endereços, romaneios e outros formatos não ganham escrita NFC por esta alteração.
- A geração do ID pode já ter sido registrada no WMS antes de uma falha de comunicação. Repita a impressão da etiqueta existente após conferência; não gere novos IDs apenas para tentar novamente.
- Cancelar o diálogo de impressão não desfaz a recepção na fila. O navegador não fornece comprovação de que o papel saiu da Zebra. Confira e reconcilie o bloco antes de continuar.
- A estação não manda repetir impressão e não confirma chips ao receber dados do WMS. A confirmação física mantém a reserva de UID e a releitura existente.
- Com a Zebra imprimindo continuamente a 1–3 segundos por etiqueta, esta entrega não assegura associação física, parada do papel, seleção de uma única tag ou gravação sem intervenção. Isso exige um gravador e controle de posição/avanço validados, ou um aplicativo que implemente e valide o ciclo completo.

## Validação

Passaram **236 testes do WMS**, incluindo quatorze testes do NFC direto e quatro testes de preparação do conteúdo, nove testes da ponte do aplicativo próprio e oito do adaptador de texto nativo para iPhone, e **37 testes da estação**. Os testes cobrem KG/MT e zeros à esquerda, validação da origem e da janela, liberação somente após ACK, duplo clique, reenvio, persistência, disco sem espaço, enquadramento restrito à origem configurada, aba alternativa e cancelamento de blocos seguintes. O adaptador do iPhone foi testado com fila sequencial, repetição, divergência, pausa durante consulta, troca de contexto e retomada. A sintaxe dos scripts foi verificada. O ensaio de tela isolado recebeu duas embalagens fictícias e manteve 550,5 kg após repetir a primeira; não houve captura física de NFC.

Um ensaio de interface no navegador interno confirmou a recepção de duas etiquetas fictícias por meio do quadro local. Na prévia HTTPS da Vercel, o quadro permaneceu em branco; a aba alternativa conectou e recebeu TESTE-NFC-001 (0303450047, 300 KG) e TESTE-NFC-002 (0303410008, 6300 MT), com recibo exibido na página de teste. O painel local mostrou a primeira ativa e a segunda na fila. Cada conexão usa um nome de janela próprio para não reutilizar o vínculo de outra página. Nenhuma confirmação NFC foi simulada. A gravação no NFC.cool, a impressão na Zebra, o chip real e o primeiro teste por dentro da interface autenticada do WMS continuam pendentes.

Referência da integração do gravador assistido: [NFC.cool — Write NFC abre o fluxo preenchido](https://nfc.cool/developers/).
