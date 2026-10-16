/* Prepara NDEF a partir do cadastro existente. Não grava nem cria estoque. */
(function(root){
  'use strict';
  var parse=typeof module==='object'&&module.exports?require('./wms-nfc-text.js').parseText:root.WmsNfcText&&root.WmsNfcText.parseText;
  function buildPayload(id,item){
    if(typeof id!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(id)||!item)throw new Error('Informe o ID de uma embalagem cadastrada no WMS.');
    var code=String(item.codigo==null?'':item.codigo),amount=String(item.quantidade==null?'':item.quantidade).replace(',','.');
    var content='JOB=wms;ID='+id+';COD='+code+';QTD='+amount+';UN='+String(item.unidade||'');
    var tag=parse(content);
    content='JOB=wms;ID='+tag.item+';COD='+tag.codigo+';QTD='+tag.quantidade+';UN='+tag.unidade;
    parse(content);return {content:content,tag:tag};
  }
  async function prepare(id,context){
    if(!context.isActive())throw new Error('Entre no WMS e abra NFC → Cadastrar tags para preparar a tag.');
    if(typeof id!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(id))throw new Error('Informe o ID de uma embalagem cadastrada no WMS.');
    var item=await context.lookup(id);
    if(!context.isActive())throw new Error('O usuário ou a tela mudou durante a consulta. Consulte novamente.');
    if(!item)throw new Error('Embalagem não encontrada. Gere ou cadastre a etiqueta no fluxo normal do WMS primeiro.');
    return buildPayload(id,item);
  }
  function choices(catalog,query){
    var found=[],q=String(query||'').trim().toUpperCase();
    for(var id of Object.keys(catalog||{})){
      var item=catalog[id];if(!/^[A-Za-z0-9._/-]{1,32}$/.test(id)||!item||!item.pr)continue;
      if(q&&![id,item.pr,item.desc].some(function(value){return String(value||'').toUpperCase().includes(q);}))continue;
      found.push({id:id,codigo:String(item.pr),descricao:String(item.desc||''),quantidade:item.pl});if(found.length===25)break;
    }
    return found;
  }
  if(typeof module==='object'&&module.exports){module.exports={buildPayload:buildPayload,prepare:prepare,choices:choices};return;}
  if(!parse||!root.WmsNfcReader)return;
  var lastUser=null,epoch=0,result=null;
  function mount(){
    var view=root.WmsNfcWorkspace?root.WmsNfcWorkspace.host('v-labels'):document.getElementById('v-labels');if(!view||view.querySelector('[data-nfc-preparar]'))return;
    var panel=document.createElement('section');panel.className='panel';panel.dataset.nfcPreparar='1';panel.style.cssText='padding:18px;margin:12px 0;border:2px solid #147657;border-radius:12px';
    var title=document.createElement('h3');title.textContent='Escolher embalagem para a tag';panel.appendChild(title);
    var intro=document.createElement('p');intro.textContent=root.webkit&&root.webkit.messageHandlers&&root.webkit.messageHandlers.packemNfc?'Escolha a embalagem já cadastrada no WMS. Depois toque em Cadastrar chip por aproximação e apresente a tag ao iPhone, mantendo o WMS neste aplicativo.':'Escolha a embalagem já cadastrada no WMS. Depois prepare o cadastro abaixo e aproxime a tag do iPhone no NFC.cool. O UID ficará ligado a essa embalagem.';panel.appendChild(intro);
    var searchLabel=document.createElement('label');searchLabel.htmlFor='packemNfcSearch';searchLabel.textContent='Buscar por código, descrição ou ID';panel.appendChild(searchLabel);
    var search=document.createElement('input');search.id='packemNfcSearch';search.type='search';search.className='input';search.autocomplete='off';search.placeholder='Escolha na lista ou filtre as embalagens';search.style.cssText='display:block;width:100%;box-sizing:border-box;margin:6px 0 12px';panel.appendChild(search);
    var refresh=document.createElement('button');refresh.type='button';refresh.className='gbtn';refresh.textContent='Atualizar embalagens';panel.appendChild(refresh);
    var results=document.createElement('div');results.setAttribute('aria-label','Embalagens cadastradas');results.style.cssText='display:grid;gap:8px;margin:12px 0;max-height:300px;overflow:auto';panel.appendChild(results);
    var searchNote=document.createElement('small');panel.appendChild(searchNote);
    var manual=document.createElement('details'),manualTitle=document.createElement('summary');manualTitle.textContent='Localizar diretamente pelo ID';manual.style.marginTop='14px';manual.appendChild(manualTitle);panel.appendChild(manual);
    var label=document.createElement('label');label.htmlFor='packemNfcLabelId';label.textContent='ID da embalagem';
    manual.appendChild(label);
    var input=document.createElement('input');input.id='packemNfcLabelId';input.className='input';input.autocomplete='off';input.maxLength=32;input.style.cssText='display:block;width:100%;max-width:360px;margin:6px 0 12px';manual.appendChild(input);
    var button=document.createElement('button');button.type='button';button.className='btn brand';button.textContent='Consultar embalagem';manual.appendChild(button);
    var status=document.createElement('p');status.setAttribute('role','status');status.id='packemNfcPrepareStatus';status.textContent='Selecione uma embalagem da lista para cadastrar sua tag por aproximação.';panel.appendChild(status);
    var detail=document.createElement('p');detail.id='packemNfcPrepareDetail';panel.appendChild(detail);
    var textLabel=document.createElement('label');textLabel.htmlFor='packemNfcPayload';textLabel.textContent='Texto para gravar na NTAG213';panel.appendChild(textLabel);
    var text=document.createElement('textarea');text.id='packemNfcPayload';text.readOnly=true;text.rows=3;text.className='input code';text.style.cssText='display:block;width:100%;box-sizing:border-box;margin:6px 0 12px';panel.appendChild(text);
    var copy=document.createElement('button');copy.type='button';copy.className='gbtn';copy.disabled=true;copy.textContent='Copiar conteúdo NFC';panel.appendChild(copy);
    var guide=document.createElement('a');guide.href='/nfc-iphone.html';guide.textContent='Configurar leitura no iPhone';guide.style.marginLeft='12px';panel.appendChild(guide);
    var optional=document.createElement('details'),optionalTitle=document.createElement('summary');optionalTitle.textContent='Gravação opcional de texto na tag';optional.appendChild(optionalTitle);[textLabel,text,copy,guide].forEach(function(node){optional.appendChild(node);});panel.appendChild(optional);
    var nativeApp=!!(root.webkit&&root.webkit.messageHandlers&&root.webkit.messageHandlers.packemNfc);
    if(nativeApp){text.hidden=true;text.style.display='none';textLabel.hidden=true;copy.hidden=true;guide.href='/nfc-app.html';guide.textContent='Como usar o aplicativo Packem WMS';}
    var note=document.createElement('p');note.style.cssText='font-size:.82rem;color:var(--muted)';note.textContent='Use o painel de cadastro por UID abaixo para vincular o chip à embalagem. Não é necessário gravar texto na tag para esse cadastro. A consulta da embalagem ainda não confirma leitura física NFC.';panel.appendChild(note);
    function clear(){epoch++;result=null;text.value='';detail.textContent='';copy.disabled=true;}
    input.addEventListener('input',clear);
    var lastCatalog=null;
    function catalog(){return typeof BOB!=='undefined'?BOB:null;}
    function showChoices(){
      lastCatalog=catalog();results.replaceChildren();var list=choices(lastCatalog,search.value);
      list.forEach(function(item){
        var option=document.createElement('button');option.type='button';option.className='gbtn';option.style.cssText='display:block;width:100%;min-width:0;box-sizing:border-box;margin:0;text-align:left;white-space:normal;overflow-wrap:anywhere;padding:12px';
        var unit=typeof unitOf==='function'?unitOf(item.codigo):'',amount=item.quantidade==null?'':String(item.quantidade).replace('.',',');
        option.textContent=item.id+' · '+item.codigo+(amount?' · '+amount+' '+unit:'')+(item.descricao?' · '+item.descricao:'');
        option.onclick=function(){
          if([root.WmsNfcMobile,root.PackemWmsApp,root.WmsNfcDireto].some(function(reader){return reader&&reader.active();})){status.textContent='Conclua ou cancele a operação NFC atual antes de escolher outra embalagem.';return;}
          input.value=item.id;lookup();
        };results.appendChild(option);
      });
      searchNote.textContent=list.length===25?'Mostrando até 25 embalagens. Use a busca para filtrar.':list.length?list.length+' embalagem(ns) encontrada(s).':'Nenhuma embalagem encontrada nesta lista. Atualize após carregar o catálogo ou consulte pelo ID.';
    }
    search.oninput=showChoices;refresh.onclick=showChoices;
    async function lookup(){
      clear();var request=epoch,id=input.value.trim().toUpperCase(),context=root.WmsNfcReader.makeLabelContext();button.disabled=true;status.textContent='Consultando o cadastro do WMS…';
      try{
        var value=await prepare(id,context);
        if(request!==epoch||!context.isActive())return;
        result=value;text.value=value.content;detail.textContent='Embalagem '+value.tag.item+' · código '+value.tag.codigo+' · '+value.tag.quantidade.replace('.',',')+' '+value.tag.unidade;
        copy.disabled=false;status.textContent='Embalagem consultada. Use o painel de cadastro por UID abaixo para salvar o vínculo com a tag.';
      }catch(error){if(request===epoch)status.textContent=error.message;}
      finally{button.disabled=false;}
    }
    button.onclick=function(){lookup();};input.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();if(!button.disabled)lookup();}});
    copy.onclick=async function(){
      if(!result||!root.WmsNfcReader.makeLabelContext().isActive()){clear();return;}
      var request=epoch;
      try{await navigator.clipboard.writeText(result.content);if(request===epoch)status.textContent='Conteúdo copiado. No NFC.cool, escolha Texto e grave na tag da embalagem indicada.';}
      catch(error){if(request===epoch){text.focus();text.select();status.textContent='Selecione e copie o texto acima para gravar no NFC.cool.';}}
    };
    view.insertBefore(panel,view.children[1]||null);
    showChoices();panel.refreshNfcChoices=function(){if(lastCatalog!==catalog())showChoices();};
    panel.resetNfcPreparation=function(){clear();status.textContent='Consulte a etiqueta novamente para preparar o conteúdo NFC.';};
  }
  function check(){mount();var user=typeof session!=='undefined'&&session?session.u:null;
    var choicesPanel=document.querySelector('[data-nfc-preparar]');if(choicesPanel&&choicesPanel.refreshNfcChoices)choicesPanel.refreshNfcChoices();
    if(user!==lastUser||!root.WmsNfcReader.makeLabelContext().isActive()){
      if(result){var panel=document.querySelector('[data-nfc-preparar]');if(panel&&panel.resetNfcPreparation)panel.resetNfcPreparation();}
      lastUser=user;
    }
  }
  var scheduled=false;new MutationObserver(function(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;check();},100);}).observe(document.body,{childList:true,subtree:true});check();
  document.addEventListener('visibilitychange',check);
  root.WmsNfcPrepare={prepare:prepare,current:function(){return result&&root.WmsNfcReader.makeLabelContext().isActive()?buildPayload(result.tag.item,{codigo:result.tag.codigo,quantidade:result.tag.quantidade,unidade:result.tag.unidade}):null;}};
})(typeof window!=='undefined'?window:globalThis);
