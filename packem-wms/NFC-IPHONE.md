# Etiquetas NFC no iPhone, sem aplicativo próprio

O iPhone 11 pode abrir o link HTTPS gravado numa etiqueta NFC NDEF. O operador aproxima o aparelho com a tela em uso, toca na notificação e abre o WMS. Este fluxo dispensa TapPony no uso diário, Xcode e assinatura de aplicativo próprio. Ele transporta o código gravado no link; não lê o UID pelo Safari.

## Preparar uma etiqueta

1. Abra **Consulta de Etiqueta → Preparar etiqueta NFC para iPhone** no WMS publicado em HTTPS, ou acesse `nfc.html` na mesma origem.
2. Informe o código de etiqueta/bobina já reconhecido no WMS. Gere e copie o link.
3. Com um gravador NFC, grave esse link como um registro **URL / URI NDEF** numa etiqueta compatível e gravável. Essa configuração é feita uma vez por etiqueta. O site no Safari não grava NFC. Faça a primeira validação numa tag de teste.
4. Aproxime a parte superior do iPhone da etiqueta e toque na notificação. A página exibirá o código.
5. Toque em **Abrir no WMS**, faça o login normal e escolha **Conferir esta etiqueta**. O sistema abre Consulta de Etiqueta e preenche somente seu campo de código.
6. Toque em **Consultar** para buscar os dados do material. O link não registra entrada, saída, transferência ou recebimento.

O link gerado usa a origem atual do site. Não grave uma URL de prévia temporária para uso operacional: gere os links no domínio definitivo do WMS. Para testar a interface sem tag, use **Testar abertura** no gerador.

## Dados e permissões

O código vai no fragmento `nfc.html#etiqueta=...`, que não integra o pedido HTTP. A página remove o fragmento da barra e mantém o código somente para navegação explícita. Não coloque credenciais ou dados pessoais em etiquetas; qualquer pessoa pode ler/copiar seu link.

No WMS, um único código aguarda confirmação em `sessionStorage`, por até quinze minutos. A pendência sobrevive a reload na mesma aba e é descartada no logout, no cancelamento ou na expiração. Se o armazenamento estiver bloqueado, ela fica apenas em memória. Nenhuma autorização ou senha é persistida por esse módulo.

Antes e depois da navegação, o encaminhamento confere sessão, conta ativa, permissão `visualizar`, acesso a `v-etqconsulta`, usuário atual e campo visível/habilitado. Não torna inputs editáveis e não dispara Enter, clique em Consultar ou callbacks de operação.

São aceitos códigos de até 128 caracteres: letras ASCII, números, ponto, hífen, barra e sublinhado. Outros parâmetros, duplicatas e conteúdos inválidos são recusados. Uma URL copiada não prova presença física nem autentica uma pessoa.

## Validação

`node --test tests/*.test.js` inclui os cenários NFC, autorização, expiração, substituição de leitura, armazenamento bloqueado e os hooks reais de consulta/login/logout. Os testes exercitam o dispatcher real com DOM isolado, sem consultar nem alterar estoque remoto.

O fluxo de leitura física precisa de uma etiqueta NDEF real e iPhone compatível. O Safari não lê NFC diretamente: o sistema iOS abre a URL. Etiquetas somente UID, bloqueadas para escrita ou de tecnologia incompatível não passam a funcionar só por gerar um link. Câmera/Wallet em uso e outras condições podem impedir a leitura de fundo.

[Apple: leitura de etiquetas em segundo plano](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading).
