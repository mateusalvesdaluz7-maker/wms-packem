# Envio automático de dados das etiquetas à estação NFC

Esta alteração conecta o bloco de etiquetas rastreáveis preparado pelo WMS à fila NFC do computador. O operador conecta a estação uma vez; cada bloco seguinte transmite ID da embalagem, código, quantidade e unidade automaticamente, antes da abertura da impressão. Não há exportação de arquivo nem cópia de cada etiqueta.

**O código está preparado para revisão. Não foi publicado no WMS de produção. Esta integração não implementa gravação contínua no iPhone nem sincroniza mecanicamente o rolo com o NFC.** O NFC.cool Platinum permanece como gravador assistido, com início da escrita e releitura no telefone. Aceitação dos dados pela estação não comprova impressão ou gravação física.

## Funcionamento

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

Passaram **194 testes do WMS**, incluindo os seis testes da ponte, e **31 testes da estação**. Os testes cobrem KG/MT e zeros à esquerda, validação da origem e da janela, liberação somente após ACK, duplo clique, reenvio, persistência, disco sem espaço, enquadramento restrito à origem configurada, aba alternativa e cancelamento de blocos seguintes. A sintaxe dos scripts foi verificada.

Um ensaio de interface no navegador interno confirmou a recepção de duas etiquetas fictícias por meio do quadro local. Na prévia HTTPS da Vercel, o quadro permaneceu em branco; a aba alternativa conectou e recebeu TESTE-NFC-001 (0303450047, 300 KG) e TESTE-NFC-002 (0303410008, 6300 MT), com recibo exibido na página de teste. O painel local mostrou a primeira ativa e a segunda na fila. Cada conexão usa um nome de janela próprio para não reutilizar o vínculo de outra página. Nenhuma confirmação NFC foi simulada. A gravação no NFC.cool, a impressão na Zebra, o chip real e o primeiro teste por dentro da interface autenticada do WMS continuam pendentes.

Referência da integração do gravador assistido: [NFC.cool — Write NFC abre o fluxo preenchido](https://nfc.cool/developers/).
