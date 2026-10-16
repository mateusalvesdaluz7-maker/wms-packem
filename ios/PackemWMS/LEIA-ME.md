# Aplicativo Packem WMS para iPhone

Este projeto gratuito em Swift abre o WMS existente em uma `WKWebView` e liga **Gravar tag vazia** e **Ler NFC** ao Core NFC do iPhone. Em **Gestão de Etiquetas**, selecione uma embalagem cadastrada, consulte seus dados e aproxime uma NTAG213 vazia. Depois, abra **Chão expedição**, **Chão 70** ou **Recicladora - 91** em modo Entrada e aproxime as tags gravadas, uma por vez. Não exige uma biblioteca comercial.

É código de um aplicativo nativo, não um aplicativo instalável pelo Safari. A distribuição e o teste físico ainda dependem de assinatura/provisionamento iOS com a capacidade NFC. Uma conta gratuita Personal Team não disponibiliza essa capacidade; nenhuma assinatura foi contratada por este projeto. Nenhum IPA assinado foi gerado.

## O que está integrado

- A interface é o sistema existente; o leitor não cria outra base de estoque.
- A gravação exige uma NTAG213 formatada para NDEF, gravável e sem mensagem anterior (ou com registro vazio). Tags sem formatação, bloqueadas ou com dados são recusadas. O app não apaga, formata nem bloqueia chips.
- O WMS consulta o cadastro ao preparar, imediatamente antes de autorizar a escrita e depois da releitura. O app escreve um único registro NDEF Text UTF-8, no formato `JOB=wms;ID=embalagem;COD=codigo;QTD=300;UN=KG`, até 120 bytes de texto. O ID é da embalagem individual e mantém os zeros à esquerda.
- A gravação só mostra confirmação após reler o texto e o UID da mesma tag e receber a confirmação da página. Cancelamento, timeout ou perda de contato não provam que a tag ficou vazia: releia antes de reutilizar. Uma tentativa grava apenas uma tag.
- O vínculo durável é o ID da embalagem no conteúdo da tag. O UID é conferido durante a operação e exibido no resultado; não há nova tabela de vínculo UID/embalagem ou auditoria de gravação no servidor.
- O leitor verifica versão compatível com NTAG213, UID de sete bytes e conteúdo NDEF. O UID não é prova criptográfica de autenticidade.
- O WMS consulta o cadastro, confere código, quantidade e unidade, chama a função normal de entrada da tela e confirma somente quando a embalagem aparece contada.
- O app aguarda a confirmação antes da próxima tag. Reaproximar uma embalagem já contada não a adiciona novamente. Tags permanecendo no campo são ignoradas até a próxima etiqueta.
- Uma divergência encerra a leitura e pede conferência. Depois de corrigir, inicie novamente e reapresente a etiqueta. As entradas já confirmadas permanecem no WMS.
- Mudança de usuário, tela, modo, navegação ou saída do app encerra a sessão. O Core NFC limita cada sessão a cerca de 60 segundos; é preciso tocar em **Ler NFC** novamente para continuar.
- A gravação é iniciada pelo usuário para uma embalagem já existente. Ela não gera estoque nem codifica um rolo na Zebra ZT230.

## Compilar e instalar

1. No macOS, abra `PackemWMS.xcodeproj` com Xcode, selecione o esquema **PackemWMS** e um iPhone com iOS 16 ou posterior.
2. Defina um Bundle ID disponível e uma equipe de desenvolvimento habilitada para **Near Field Communication Tag Reading**. O projeto não inclui equipe, certificados, perfil, senha ou conta Apple.
3. Compile/assine e instale no aparelho pelo fluxo normal da equipe. Não remova a capacidade NFC para tentar contornar o provisionamento: a antena não funcionaria.
4. O app abre inicialmente a prévia do PR #48. Em **Opções → Ensaio sem estoque real**, o catálogo é fictício. No menu Produção, a leitura só estará disponível após publicar a integração web na produção por revisão normal.
5. Entre com sua conta. Nenhuma senha administrativa está embutida no app.

No Windows, o repositório inclui um workflow macOS do GitHub para `swift test` e compilação sem assinatura tanto de simulador quanto de iPhone. Compilação sem assinatura verifica o código; não instala o app no iPhone nem testa a antena.

### Instalação gratuita: o que foi verificado

O código usa o Core NFC gratuito já disponível no iOS. Migrar para [Capgo NFC](https://github.com/Cap-go/capacitor-nfc) ou React Native adicionaria outra estrutura sem remover o requisito de assinatura NFC.

A [tabela oficial da Apple](https://developer.apple.com/help/account/reference/supported-capabilities-ios/) não disponibiliza NFC Tag Reading para a conta gratuita. O [AltStore Classic](https://developer.altstore.io/) permite instalação sem conta paga, mas limita os entitlements à coluna Apple Developer dessa tabela. O [SideStore](https://docs.sidestore.io/docs/faq) também reassina usando o certificado pessoal. Portanto, não foi validado um caminho gratuito para instalar este app próprio com NFC no iPhone 11. Não há instalador, certificado comprado ou promessa de que reassinar um IPA libere a antena.

## Conferência com etiquetas de teste

Na tela **Ensaio sem estoque real**, a etapa **1 · Preparar e gravar** usa os IDs `NFC-LEITURA-001` e `NFC-LEITURA-002`. Consulte cada ID e toque em **Gravar tag vazia**, usando uma NTAG213 de laboratório vazia e formatada para cada embalagem. A etapa **2 · Contar embalagens** permite conferir as duas sem estoque real. Também aceita tags previamente gravadas com estes dados:

```text
JOB=qa-app;ID=NFC-LEITURA-001;COD=0303450047;QTD=300;UN=KG
JOB=qa-app;ID=NFC-LEITURA-002;COD=0303450047;QTD=250.5;UN=KG
```

Aproxime a primeira, espere a confirmação, afaste-a e aproxime a segunda. O esperado é **2 etiquetas / 550,5 kg**. Repetir a primeira mantém o total. Parar e tentar outra leitura deve exigir uma nova sessão. No navegador de computador, os botões da página simulam a ponte com dados fictícios, inclusive a autorização e o recibo de gravação: isso não testa o Core NFC nem comprova escrita ou leitura física. No app nativo esses botões de simulação ficam desabilitados.

## Limites da ponte

Somente os hosts HTTPS exatos de produção e prévia definidos em `WMSPolicy.swift` podem usar a ponte. Mensagens de iframe, portas diferentes e páginas de outros sites são recusadas. O conteúdo da tag é argumento estruturado de `callAsyncJavaScript`, nunca código JavaScript concatenado. Não há certificado ignorado nem acesso LAN especial. A autorização de acesso aos dados continua sendo a sessão e as APIs existentes do WMS.

O texto fica na tag e qualquer leitor NFC compatível pode lê-lo; não inclua senhas ou tokens. As entradas seguem o fluxo normal da tela, inclusive mudança de local e histórico quando previstos no WMS. Não é uma contagem independente do estoque.

Referências: [Core NFC](https://developer.apple.com/documentation/corenfc/building-an-nfc-tag-reader-app), [capacidades iOS e tipos de conta](https://developer.apple.com/help/account/reference/supported-capabilities-ios), [callAsyncJavaScript](https://developer.apple.com/documentation/webkit/wkwebview/callasyncjavascript(_:arguments:in:in:completionhandler:)), [sessões NFC](https://developer.apple.com/videos/play/wwdc2020/10209/).
