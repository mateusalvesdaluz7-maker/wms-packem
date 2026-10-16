# Aplicativo Packem WMS para iPhone

O projeto Swift abre o WMS existente em uma `WKWebView` e integra Core NFC. O fluxo principal cadastra uma NTAG213 pelo UID e depois conta pela identificação do chip, inclusive quando sua memória está vazia. Não usa biblioteca comercial nem NFC.cool.

**Entrega: código-fonte, projeto Xcode e testes. Não há IPA assinado, instalação no aparelho ou captura física validada.** A assinatura deve incluir NFC Tag Reading. A conta gratuita Personal Team não oferece essa capacidade; nenhuma assinatura ou certificado foi contratado. Compilar sem assinatura no GitHub não instala o app no iPhone.

## Cadastro e contagem

1. Entre no WMS pelo app. Abra **NFC → Cadastrar tags** e escolha a embalagem na lista, podendo buscar por ID, código ou descrição. Não abre câmera nem usa QR Code.
2. Consulte e confira os dados. Toque em **Cadastrar chip por aproximação** e apresente uma NTAG213. O leitor confere GET_VERSION, UID de 7 bytes e os bytes de verificação da página 0; aguarda o servidor confirmar o vínculo.
3. Em **NFC → Contar tags**, escolha **Expedição - 71**, **Chão de Fábrica - 70**, **Recicladora - 91** ou **Inventário**. Para inventário, selecione antes a tarefa e a vaga/passada na aba normal. Toque em **Ler NFC** e apresente as tags cadastradas uma por vez, aguardando cada confirmação. Não há toque por etiqueta dentro da sessão nem troca para o NFC.cool. No app instalado, esses controles ficam no painel principal; a alternativa Platinum fica recolhida.
4. O UID é resolvido no servidor; código, quantidade e unidade são consultados no cadastro atual. A entrada usa a função normal da tela, inclusive regras de estoque, local e histórico. Embalagens já contadas não entram novamente.

Pausar, mudar usuário/tela/modo, navegar ou sair do app encerra a operação. Erros e divergências pedem conferência antes de repetir. O iOS exibe sua interface de NFC e limita cada sessão a cerca de 60 segundos; é necessário tocar em Ler NFC novamente para continuar. O UID não é autenticação criptográfica.

## Configuração do servidor

O cadastro requer `packem-wms/supabase/migrations/202610160001_nfc_tags.sql` e `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` configuradas **somente no servidor Vercel**. Não coloque service_role no HTML ou no app. As migrações NFC foram aplicadas no banco do WMS em 16/10/2026; as variáveis de serviço ficaram restritas à prévia da branch `codex/wms-nfc-envio-automatico`. Isso não substitui a assinatura do aplicativo nem a validação da antena.

`/api/nfc-tags` autentica o usuário ativo com a credencial normal do WMS, mantida em memória pela página e enviada por HTTPS. Verifica a senha existente (PBKDF2 ou formato legado), exige permissão de etiquetas para cadastrar e não retorna senhas/chaves. O banco aceita somente uma tag por embalagem e uma embalagem por tag. Repetir o mesmo vínculo é idempotente; conflitos não reatribuem chips. A embalagem precisa existir no servidor em `etiquetas` ou `bobinas`.

A tabela tem RLS e não permite acesso direto por anon/authenticated. O endpoint executa a função restrita ao serviço. Sem configuração/migração, retorna indisponibilidade em vez de simular sucesso. Para recuperação de uma tentativa incerta, selecionar a mesma embalagem e reapresentar a mesma tag confirma o vínculo já existente; não troque a embalagem sem conferir. O app não oferece exclusão/reassociação de chips.

## Gravação opcional no chip

**Gravar tag vazia** exige NTAG213 NDEF formatada, gravável e sem mensagem anterior. Não apaga, formata, bloqueia nem modifica senhas. Escreve um registro Text UTF-8 de até 120 bytes: `JOB=wms;ID=embalagem;COD=codigo;QTD=300;UN=KG`. Confere cadastro antes e depois da escrita, texto relido e UID. Uma tentativa grava apenas uma tag.

Essa função é independente: para contar no fluxo principal, cadastre também o UID. Cancelamento ou perda de contato não provam que a tag permaneceu vazia; releia antes de reutilizar. O app não sincroniza a Zebra ZT230 nem grava um rolo automaticamente.

## Compilar e instalar

1. Abra `PackemWMS.xcodeproj` no Xcode/macOS. Use o esquema PackemWMS, iOS 16 ou posterior e um Bundle ID disponível.
2. Configure uma equipe habilitada para **Near Field Communication Tag Reading**. Não há equipe, certificado, perfil ou senha no projeto.
3. Compile, assine e instale pelo fluxo da equipe. Remover o entitlement não libera NFC.
4. O app abre a prévia do PR #48. **Opções → Ensaio sem estoque real** usa somente dados fictícios. Produção depende da publicação revisada das alterações web e da configuração do banco.

O workflow macOS do GitHub executa testes Swift e compila para simulador e iPhone com `CODE_SIGNING_ALLOWED=NO`. O artefato `PackemWMS-iphone-sem-assinatura` guarda o aplicativo compilado para assinatura posterior; **não é um instalador nem um IPA pronto**. A compilação não testa a antena. A assinatura com NFC continua sendo um pré-requisito externo. A [tabela Apple](https://developer.apple.com/help/account/reference/supported-capabilities-ios/) não disponibiliza NFC Tag Reading ao Personal Team gratuito. Reassinar com um certificado pessoal não foi validado como solução para esse requisito.

## Ensaio sem estoque real

`/tests/ui/nfc-app.html` usa um catálogo e vínculos somente em memória. No navegador, os botões simulam a antena; no app nativo esses botões ficam desabilitados e é possível usar chips de laboratório. Nenhuma chamada ao estoque real é feita. Recarregar a página apaga os vínculos fictícios.

Selecione a embalagem 1 (300 kg), consulte e inicie o cadastro, depois simule a aproximação. Repita para a embalagem 2 (250,5 kg). Abra a etapa Contar embalagens e toque em Ler NFC. As duas devem somar **2 etiquetas / 550,5 kg**; repetir a primeira mantém o total. Enviar tag sem cadastro deve recusar. A simulação não comprova NFC físico, instalação, login real nem persistência no Supabase de homologação.

## Proteção da ponte

Somente os hosts HTTPS exatos de produção/prévia em `WMSPolicy.swift` e o quadro principal podem acessar a ponte. Iframes, outras origens e portas diferentes são recusados. Sessão UUID e modo de operação isolam cadastro, contagem e gravação. Dados chegam ao JavaScript como argumentos estruturados. O app não ignora certificados.

Referências: [Core NFC](https://developer.apple.com/documentation/corenfc/building-an-nfc-tag-reader-app), [capacidades iOS](https://developer.apple.com/help/account/reference/supported-capabilities-ios/), [sessões NFC](https://developer.apple.com/videos/play/wwdc2020/10209/).
