# Packem WMS + NFC no iPhone

Projeto-fonte de um aplicativo iOS próprio com SwiftUI, `WKWebView` persistente e Core NFC. O WMS continua hospedado no endereço HTTPS que o operador configurar; o app não empacota o frontend, dados, chaves ou credenciais do WMS.

**Situação da validação:** criado em Windows. Não foi compilado no Xcode, os testes XCTest não foram executados e nenhuma leitura foi validada em iPhone real. A existência do projeto e dos testes-fonte não confirma funcionamento em hardware ou assinatura/distribuição. Não houve push, deploy ou instalação de dependências.

## Abrir e assinar no Mac

1. Abra `PackemNFC.xcodeproj` no Xcode 15 ou superior. O deployment target é iOS 15 e o destino é iPhone.
2. Selecione o target `PackemNFC`. Em Signing & Capabilities escolha sua equipe Apple e um Bundle Identifier próprio; o identificador `com.example.packem.nfc` é apenas marcador. Não há Team ID ou certificado incluído.
3. Confira a capability **Near Field Communication Tag Reading** e o entitlement `com.apple.developer.nfc.readersession.formats = [TAG]`. O projeto usa `NFCTagReaderSession` para UID e também para consultar/ler NDEF; não instancia `NFCNDEFReaderSession`, por isso não solicita um formato NDEF separado. Confira o perfil de provisionamento gerado pela sua equipe.
4. Confira `NFCReaderUsageDescription` no Info.plist. Os AIDs ISO 7816 declarados são apenas os padrões NDEF `D2760000850101` e `D2760000850100`; tags ISO 7816 com outra aplicação podem não ser detectadas sem definição específica adicional. Não há suporte genérico a cartões de pagamento, autenticação ou tags protegidas.
5. Conecte um iPhone compatível, selecione-o e execute. O simulador pode servir aos testes de helpers; ele não lê NFC. A primeira instalação e a assinatura dependem da conta/equipe e do Xcode.
6. Informe a URL HTTPS real do WMS, incluindo o caminho inicial se necessário, e toque em **Salvar URL e abrir WMS**. Não há host real presumido. A URL fica em `UserDefaults`; cookies/login usam o armazenamento padrão persistente do WebKit.
7. Entre no WMS normalmente. A leitura é iniciada pelo controle NFC do próprio WMS. **Trocar URL** abre uma configuração explícita; trocar ou abrir configuração encerra a leitura pendente.

O login, as permissões e as validações dos códigos continuam no WMS. UID é identificador técnico, não prova de identidade e não autenticação. O nativo não chama APIs de estoque e não registra movimentação.

## Contrato da ponte

Somente a página principal da origem exata configurada pode solicitar:

```javascript
window.webkit.messageHandlers.packemNFC.postMessage({
  action: 'scan', requestId: 'id-unico-da-leitura', mode: 'ndef' // ou 'uid'
});
window.webkit.messageHandlers.packemNFC.postMessage({
  action: 'cancel', requestId: 'id-unico-da-leitura'
});
```

O WMS precisa implementar o callback antes de solicitar a leitura:

```javascript
window.PackemNFC.receive({
  requestId: 'id-unico-da-leitura',
  status: 'read', // ou 'cancelled' / 'error'
  text: 'conteudo-da-tag',
  message: 'mensagem em português',
  uid: '04A1B2C3' // opcional, quando a leitura fornece UID
});
```

`requestId` precisa ser string não vazia com até 120 unidades UTF-16, como o comprimento de strings JS. Campos, ações e modos são estritos. Existe uma leitura ativa por vez. Conteúdo não confiável é serializado com `JSONSerialization` e enviado como argumento de `callAsyncJavaScript` ao frame original; texto de tag não é interpolado em código.

Na entrega, o app verifica novamente main frame, origem HTTPS, porta efetiva (443 quando omitida), época da navegação, URL atual e foreground. O JavaScript também verifica `window.top` e `location.origin`. Pedidos expirados são descartados ao navegar/trocar URL/ir para background; o frontend deve tratar esse descarte em seu timeout ou ao retornar para a tela.

Uma requisição de outro frame/origem é descartada sem callback para não criar canal de comunicação indevido. Uma requisição malformada com `requestId` válido recebe erro somente quando o frame autorizado está atual. `requestId` inválido não recebe callback. Mensagens de prontidão, indisponibilidade, cancelamento e erros de sessão são em português.

## Leitura e limites

- Sessão explícita em foreground com polling ISO 14443 e ISO 15693. Mais de uma tag pede afastamento e reinicia polling; uma tag é conectada antes da leitura.
- UID: bytes `identifier` de MiFare, ISO 7816 ou ISO 15693 em hexadecimal maiúsculo, sem prefixo. Em modo `uid`, esse valor é também `text`. Não há inversão arbitrária de bytes.
- NDEF: consulta suporte/status e lê a mensagem. Apenas registros NFC Well Known Text `T` ou URI `U` são aceitos. Text respeita o tamanho do idioma e UTF-8/UTF-16; a decodificação final usa `wellKnownTypeTextPayload()`. URI usa `wellKnownTypeURIPayload()`.
- Vazio, formato desconhecido, payload total maior que 2048 bytes, texto decodificado maior que 2048 bytes ou valores diferentes em registros múltiplos resultam em erro. Registros repetidos com o mesmo conteúdo são aceitos. Uma falha NDEF não faz fallback para UID.
- URI lida é apenas texto devolvido ao WMS. O app não abre o endereço da tag nem executa seu conteúdo.
- Ao concluir ou cancelar, o estado é limpo antes de invalidar a sessão para evitar callback duplicado em `didInvalidateWithError`.

Navegação principal fica na origem HTTPS exata (scheme/host/porta), inclusive em redirects. Links HTTPS externos acionados pelo usuário podem abrir no Safari, fora da ponte. HTTP, `file:`, `javascript:` e esquemas customizados não são permitidos como navegação; não há exceções ATS, trust bypass ou tratamento permissivo de certificados. Login que dependa de redirecionar a página principal para outro domínio precisa ser avaliado separadamente; não existe allowlist implícita.

O fluxo escolhido é leitura explícita dentro do aplicativo. Background Tag Reading exige outro fluxo de notificação e associação de domínio; não foi implementado nem apresentado como leitura automática do WMS no Safari.

## Testes-fonte e roteiro manual — não executados

`PackemNFCTests/BridgeHelpersTests.swift` contém testes de URL/origem exata, requests estritos, hexadecimal, JSON com caracteres especiais, NDEF UTF-8, UTF-16, URI, vazio, ambiguidade, limite e formato desconhecido. No Mac, use o scheme compartilhado `PackemNFC` e **Product > Test**. Esses testes-fonte não foram compilados/executados no Windows.

Antes de uso operacional, execute no Xcode e em iPhone real:

1. Compilar app e testes; verificar assinatura/capability e ausência de exceptions ATS. Registrar modelo, versão iOS/Xcode e resultado real.
2. Configurar URL HTTPS válida; rejeitar HTTP, credenciais na URL, `file:` e host vazio. Fechar/reabrir e confirmar URL e login persistentes. Trocar explicitamente de URL.
3. Ler uma tag Text UTF-8, outra UTF-16, URI e UID; conferir bytes/valor com a ferramenta atual e depois validações do WMS. A representação de UID de outro leitor pode usar ordem diferente: não alterar silenciosamente.
4. Ler tag vazia, desconhecida, protegida, com mais de 2048 bytes ou conteúdos diferentes; confirmar erro e nenhuma movimentação/URL aberta. Confirmar que NDEF inválido não vira UID automaticamente.
5. Afastar a tag durante a conexão, aproximar duas tags, cancelar na folha iOS, cancelar pelo WMS e aguardar timeout. Conferir um callback por pedido e mensagens em português.
6. Disparar uma segunda leitura enquanto a primeira está ativa; receber erro só para a segunda. Após conclusão, nova leitura deve funcionar.
7. Testar iframe HTTPS da mesma origem e de outra origem: nenhum pode usar NFC. Testar host semelhante, subdomínio e porta diferente: não autorizar ponte.
8. Durante uma leitura, navegar/recarregar/trocar URL/ir para background e voltar; confirmar que pedido antigo não chega à nova página. Um redirect externo deve ficar bloqueado; link externo só deve sair ao Safari por interação do usuário, sem ponte.
9. Testar caracteres como aspas, barras, quebras de linha e `</script>` no conteúdo; conferir retorno literal e ausência de execução. Testar aplicativo sem capacidade de NFC/perfil incorreto e aparelho não compatível.

## Fontes primárias consultadas

- [Apple: Building an NFC Tag-Reader App](https://developer.apple.com/documentation/corenfc/building-an-nfc-tag-reader-app)
- [Apple: Adding Support for Background Tag Reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading)
- [Apple: NFCTagReaderSession initializer](https://developer.apple.com/documentation/corenfc/nfctagreadersession/init(pollingoption:delegate:queue:))
- [Apple: Text NDEF decoder](https://developer.apple.com/documentation/corenfc/nfcndefpayload/wellknowntypetextpayload())
- [Apple: URI NDEF decoder](https://developer.apple.com/documentation/corenfc/nfcndefpayload/wellknowntypeuripayload())
- [Apple: callAsyncJavaScript](https://developer.apple.com/documentation/webkit/wkwebview/callasyncjavascript(_:arguments:in:in:completionhandler:))
