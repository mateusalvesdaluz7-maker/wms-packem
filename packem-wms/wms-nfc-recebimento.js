/* Vincula o chip à etiqueta selecionada no próprio Recebimento. */
(function(root){
  'use strict';
  function createContext(id,options){
    var owner=options.user();
    return {isActive:function(){return !!owner&&options.user()===owner&&options.visible()&&options.view()==='v-recv'&&options.permitted()&&options.pending(id);},
      lookup:async function(item){
        if(item!==id||!this.isActive())throw new Error('A etiqueta, a tela ou o usuário mudou. Escolha a bobina novamente.');
        var found=await options.lookup(item);
        if(!this.isActive())throw new Error('A etiqueta, a tela ou o usuário mudou durante a consulta.');
        return found;
      }};
  }
  if(typeof module==='object'&&module.exports){module.exports={createContext:createContext};return;}
  if(!root.WmsNfcMobile||!root.WmsNfcLabels)return;
  var dialog=null,selection=null,busy=false,status,detail,checkButton,closeButton,openButton;
  function user(){return typeof session!=='undefined'&&session?session.u:'';}
  function permitted(){var allowed=typeof root.allowedViews==='function'?root.allowedViews():null;return !allowed||allowed.includes('v-labels');}
  function context(id){return createContext(id,{user:user,visible:function(){return !document.hidden;},
    view:function(){return (document.querySelector('.view.active')||{}).id;},permitted:permitted,
    pending:function(item){return root.WmsNfcLabels.sources().stage.some(function(record){return record.et===item;});},lookup:root.WmsNfcLabels.lookupCurrent});}
  function setText(node,value){if(node.textContent!==value)node.textContent=value;}
  function paint(){
    if(!dialog||!selection)return;
    if(selection.owner!==user()){selection=null;if(dialog.open)dialog.close();return;}
    var state=root.WmsNfcMobile.enrollmentState(),pending=state.pendingItem===selection.id;
    var result=state.result&&state.result.operationId===selection.operationId?state.result:null;
    if(result&&result.status==='bound')setText(status,'Tag '+result.uid+' vinculada à bobina '+selection.id+'. Pode colar o chip nessa etiqueta.');
    else if(result&&result.status==='conflict')setText(status,'Vínculo recusado: o chip ou a bobina já está vinculado a outra etiqueta. Confira antes de tentar novamente.');
    else if(!selection.error&&pending)setText(status,state.message);
    checkButton.disabled=busy||state.working||!pending;
    closeButton.disabled=busy||state.working;
    setText(closeButton,pending?'Cancelar vínculo':'Fechar');
    openButton.hidden=!pending;openButton.style.display=pending?'inline-flex':'none';
  }
  function mountDialog(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='packemNfcRecebimento';dialog.setAttribute('aria-labelledby','packemNfcRecebimentoTitle');
    dialog.style.cssText='width:min(520px,calc(100vw - 32px));max-height:85vh;box-sizing:border-box;overflow:auto;border:2px solid #0d8571;border-radius:16px;padding:22px;background:var(--card,#fff);color:var(--ink,#123);box-shadow:0 16px 60px #0005';
    var title=document.createElement('h3');title.id='packemNfcRecebimentoTitle';title.textContent='Vincular tag NFC à bobina';dialog.appendChild(title);
    detail=document.createElement('p');detail.style.cssText='font-weight:700;overflow-wrap:anywhere';dialog.appendChild(detail);
    var instruction=document.createElement('p');instruction.textContent='No iPhone, abra o perfil do WMS no TapPony, deixe Lote desligado e aproxime somente o chip desta bobina. O vínculo será confirmado aqui.';dialog.appendChild(instruction);
    status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');dialog.appendChild(status);
    var controls=document.createElement('div');controls.style.cssText='display:flex;gap:10px;flex-wrap:wrap';dialog.appendChild(controls);
    openButton=document.createElement('a');openButton.href='tappony://scan';openButton.className='gbtn';openButton.textContent='Abrir TapPony no iPhone';controls.appendChild(openButton);
    checkButton=document.createElement('button');checkButton.type='button';checkButton.className='gbtn';checkButton.textContent='Conferir vínculo';controls.appendChild(checkButton);
    closeButton=document.createElement('button');closeButton.type='button';closeButton.className='gbtn';controls.appendChild(closeButton);
    checkButton.onclick=async function(){if(busy||!selection||selection.owner!==user())return;var current=selection;busy=true;current.error='';paint();try{await root.WmsNfcMobile.checkEnrollment();}catch(error){if(selection===current){current.error=error.message;setText(status,error.message);}}finally{busy=false;paint();}};
    async function close(){
      if(busy||!selection||selection.owner!==user())return;var current=selection;busy=true;paint();
      try{var state=root.WmsNfcMobile.enrollmentState();if(selection&&state.pendingItem===selection.id)await root.WmsNfcMobile.cancelEnrollment();dialog.close();}
      catch(error){if(selection===current){current.error=error.message;setText(status,error.message);}}
      finally{busy=false;paint();}
    }
    closeButton.onclick=close;dialog.addEventListener('cancel',function(event){event.preventDefault();close();});document.body.appendChild(dialog);
  }
  async function register(id){
    if(busy)return;
    mountDialog();var state=root.WmsNfcMobile.enrollmentState();
    if(state.pendingItem&&state.pendingItem!==id){
      if(selection&&selection.id===state.pendingItem){selection.error='Conclua ou cancele este vínculo antes de escolher outra bobina.';setText(status,selection.error);if(!dialog.open)dialog.showModal();return;}
      if(typeof root.toast==='function')root.toast('Conclua ou cancele o cadastro NFC atual antes de escolher outra bobina.',false);return;
    }
    selection={id:id,owner:user(),operationId:state.pendingItem===id?state.operationId:null,error:''};
    setText(detail,'Etiqueta '+id);setText(status,'Preparando código e peso da bobina…');if(!dialog.open)dialog.showModal();busy=true;paint();
    var current=selection;
    try{
      var result=await root.WmsNfcMobile.registerItem(id,context(id));
      if(selection!==current||current.owner!==user())return;
      current.operationId=result.operationId;
      var tag=result.tag;setText(detail,'Etiqueta '+tag.item+' · Código '+tag.codigo+' · '+(tag.unidade==='KG'?'Peso líquido':tag.unidade==='MT'?'Metragem':'Quantidade')+': '+Number(tag.quantidade).toLocaleString('pt-BR',{maximumFractionDigits:6})+' '+tag.unidade);
    }catch(error){if(selection===current){current.error=error.message;setText(status,error.message);}}
    finally{busy=false;paint();}
  }
  function mount(){
    var list=document.getElementById('stageList');if(!list||!permitted())return;
    list.querySelectorAll('[data-az]').forEach(function(storeButton){
      var card=storeButton.parentElement&&storeButton.parentElement.parentElement;if(!card||card.querySelector('[data-nfc-receber]'))return;
      var button=document.createElement('button');button.type='button';button.className='gbtn';button.dataset.nfcReceber=storeButton.dataset.az;
      button.style.cssText='width:100%;justify-content:center;margin-top:10px;border-color:#0d8571;color:var(--ink,#123)';button.textContent='Vincular tag NFC';
      button.onclick=function(){register(button.dataset.nfcReceber);};card.appendChild(button);
    });
  }
  var scheduled=false;new MutationObserver(function(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;mount();},80);}).observe(document.body,{childList:true,subtree:true});
  root.addEventListener('packem-nfc-mobile-state',paint);root.WmsNfcRecebimento={mount:mount,register:register};mount();
})(typeof window!=='undefined'?window:globalThis);
