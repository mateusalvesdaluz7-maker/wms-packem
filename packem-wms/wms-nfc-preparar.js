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
    if(!context.isActive())throw new Error('Entre no WMS e abra Gestão de Etiquetas para preparar a tag.');
    if(typeof id!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(id))throw new Error('Informe o ID de uma embalagem cadastrada no WMS.');
    var item=await context.lookup(id);
    if(!context.isActive())throw new Error('O usuário ou a tela mudou durante a consulta. Consulte novamente.');
    if(!item)throw new Error('Embalagem não encontrada. Gere ou cadastre a etiqueta no fluxo normal do WMS primeiro.');
    return buildPayload(id,item);
  }
  if(typeof module==='object'&&module.exports){module.exports={buildPayload:buildPayload,prepare:prepare};return;}
  if(!parse||!root.WmsNfcReader)return;
  var lastUser=null,epoch=0,result=null;
  function mount(){
    var view=document.getElementById('v-labels');if(!view||view.querySelector('[data-nfc-preparar]'))return;
    var panel=document.createElement('section');panel.className='panel';panel.dataset.nfcPreparar='1';panel.style.cssText='padding:18px;margin:12px 0;border:2px solid #147657;border-radius:12px';
    var title=document.createElement('h3');title.textContent='Preparar tag NFC da embalagem';panel.appendChild(title);
    var intro=document.createElement('p');intro.textContent='O cadastro continua no WMS. Informe o ID da embalagem gerada aqui; o código, a quantidade e a unidade serão consultados no cadastro.';panel.appendChild(intro);
    var label=document.createElement('label');label.htmlFor='packemNfcLabelId';label.textContent='ID da embalagem';panel.appendChild(label);
    var input=document.createElement('input');input.id='packemNfcLabelId';input.className='input';input.autocomplete='off';input.maxLength=32;input.style.cssText='display:block;width:100%;max-width:360px;margin:6px 0 12px';panel.appendChild(input);
    var button=document.createElement('button');button.type='button';button.className='btn brand';button.textContent='Consultar e preparar NFC';panel.appendChild(button);
    var status=document.createElement('p');status.setAttribute('role','status');status.id='packemNfcPrepareStatus';status.textContent='Consulte uma etiqueta existente para preparar seu conteúdo NFC.';panel.appendChild(status);
    var detail=document.createElement('p');detail.id='packemNfcPrepareDetail';panel.appendChild(detail);
    var textLabel=document.createElement('label');textLabel.htmlFor='packemNfcPayload';textLabel.textContent='Texto para gravar na NTAG213';panel.appendChild(textLabel);
    var text=document.createElement('textarea');text.id='packemNfcPayload';text.readOnly=true;text.rows=3;text.className='input code';text.style.cssText='display:block;width:100%;box-sizing:border-box;margin:6px 0 12px';panel.appendChild(text);
    var copy=document.createElement('button');copy.type='button';copy.className='gbtn';copy.disabled=true;copy.textContent='Copiar conteúdo NFC';panel.appendChild(copy);
    var guide=document.createElement('a');guide.href='/nfc-iphone.html';guide.textContent='Configurar leitura no iPhone';guide.style.marginLeft='12px';panel.appendChild(guide);
    var note=document.createElement('p');note.style.cssText='font-size:.82rem;color:var(--muted)';note.textContent='No NFC.cool, grave este conteúdo como um único registro de Texto. Depois leia no WMS aberto no iScanBrowser. Preparar o conteúdo não confirma gravação física. Uma embalagem usa um ID individual; não reaproveite a mesma tag em duas embalagens.';panel.appendChild(note);
    function clear(){epoch++;result=null;text.value='';detail.textContent='';copy.disabled=true;}
    input.addEventListener('input',clear);
    async function lookup(){
      clear();var request=epoch,id=input.value.trim().toUpperCase(),context=root.WmsNfcReader.makeLabelContext();button.disabled=true;status.textContent='Consultando o cadastro do WMS…';
      try{
        var value=await prepare(id,context);
        if(request!==epoch||!context.isActive())return;
        result=value;text.value=value.content;detail.textContent='Embalagem '+value.tag.item+' · código '+value.tag.codigo+' · '+value.tag.quantidade.replace('.',',')+' '+value.tag.unidade;
        copy.disabled=false;status.textContent='Conteúdo preparado a partir do cadastro. A gravação na tag ainda precisa ser feita e conferida.';
      }catch(error){if(request===epoch)status.textContent=error.message;}
      finally{button.disabled=false;}
    }
    button.onclick=lookup;input.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();if(!button.disabled)lookup();}});
    copy.onclick=async function(){
      if(!result||!root.WmsNfcReader.makeLabelContext().isActive()){clear();return;}
      var request=epoch;
      try{await navigator.clipboard.writeText(result.content);if(request===epoch)status.textContent='Conteúdo copiado. No NFC.cool, escolha Texto e grave na tag da embalagem indicada.';}
      catch(error){if(request===epoch){text.focus();text.select();status.textContent='Selecione e copie o texto acima para gravar no NFC.cool.';}}
    };
    view.insertBefore(panel,view.children[1]||null);
    panel.resetNfcPreparation=function(){clear();status.textContent='Consulte a etiqueta novamente para preparar o conteúdo NFC.';};
  }
  function check(){mount();var user=typeof session!=='undefined'&&session?session.u:null;
    if(user!==lastUser||!root.WmsNfcReader.makeLabelContext().isActive()){
      if(result){var panel=document.querySelector('[data-nfc-preparar]');if(panel&&panel.resetNfcPreparation)panel.resetNfcPreparation();}
      lastUser=user;
    }
  }
  var scheduled=false;new MutationObserver(function(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;check();},100);}).observe(document.body,{childList:true,subtree:true});check();
  document.addEventListener('visibilitychange',check);
})(typeof window!=='undefined'?window:globalThis);
