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
  var panel=null,selection=null,busy=false,status,detail,checkButton,cancelButton,closeButton,retryButton,pauseButton,openButton;
  function user(){return typeof session!=='undefined'&&session?session.u:'';}
  function permitted(){var allowed=typeof root.allowedViews==='function'?root.allowedViews():null;return !allowed||allowed.includes('v-labels');}
  function context(id){return createContext(id,{user:user,visible:function(){return !document.hidden;},
    view:function(){return (document.querySelector('.view.active')||{}).id;},permitted:permitted,
    pending:function(item){return root.WmsNfcLabels.sources().stage.some(function(record){return record.et===item;});},lookup:root.WmsNfcLabels.lookupCurrent});}
  function setText(node,value){if(node.textContent!==value)node.textContent=value;}
  function state(){
    if(!root.WmsNfcMobile||typeof root.WmsNfcMobile.enrollmentState!=='function'||typeof root.WmsNfcMobile.registerItem!=='function')throw new Error('O módulo NFC não terminou de atualizar. Atualize a página com Ctrl + F5 e tente novamente.');
    return root.WmsNfcMobile.enrollmentState();
  }
  function report(error,current){if(!selection||current&&selection!==current)return;selection.error=String(error&&error.message||error||'Não foi possível iniciar o vínculo NFC.');setText(status,selection.error);}
  function paint(){
    if(!panel||!selection)return;
    if(selection.owner!==user()){panel.hidden=true;panel.style.display='none';selection=null;return;}
    var snapshot;
    try{snapshot=state();}catch(error){report(error);snapshot={};}
    var pending=!!snapshot.pendingItem,other=pending&&snapshot.pendingItem!==selection.id;
    var result=snapshot.result&&snapshot.result.operationId===selection.operationId?snapshot.result:null;
    if(result&&result.status==='bound')setText(status,'Tag '+result.uid+' vinculada à bobina '+selection.id+'. Pode colar o chip nessa etiqueta.');
    else if(result&&result.status==='conflict')setText(status,'Vínculo recusado: o chip ou a bobina já está vinculado a outra etiqueta. Confira antes de tentar novamente.');
    else if(other){selection.blockedBy=snapshot.pendingItem;setText(status,'Há um cadastro pendente da etiqueta '+snapshot.pendingItem+'. Confira ou cancele esse cadastro antes de vincular a bobina '+selection.id+'.');}
    else if(selection.blockedBy&&!pending){selection.error='O cadastro anterior foi encerrado. Toque em Tentar novamente para preparar a bobina '+selection.id+'.';setText(status,selection.error);}
    else if(!selection.error&&pending)setText(status,snapshot.message);
    var disabled=busy||!!snapshot.working;
    checkButton.disabled=disabled||!pending;checkButton.hidden=!pending;
    cancelButton.disabled=disabled;cancelButton.hidden=!pending;
    setText(cancelButton,other?'Cancelar cadastro pendente':'Cancelar vínculo');
    closeButton.disabled=disabled;closeButton.hidden=pending;
    retryButton.disabled=disabled;retryButton.hidden=pending||!(selection.error||result&&result.status!=='bound');
    pauseButton.disabled=disabled;pauseButton.hidden=pending||snapshot.mode!=='count';
    openButton.hidden=!pending||other;openButton.style.display=pending&&!other?'inline-flex':'none';
    [checkButton,cancelButton,closeButton,retryButton,pauseButton].forEach(function(button){button.style.display=button.hidden?'none':'inline-flex';});
  }
  function show(id){
    var list=document.getElementById('stageList'),button=list&&Array.from(list.querySelectorAll('[data-nfc-receber]')).find(function(node){return node.dataset.nfcReceber===id;});
    var host=button&&button.parentElement||document.getElementById('v-recv');
    if(host&&panel.parentElement!==host)host.appendChild(panel);
    panel.hidden=false;panel.style.display='block';panel.scrollIntoView({block:'nearest'});
  }
  function mountPanel(){
    if(panel)return;
    panel=document.createElement('section');panel.id='packemNfcRecebimento';panel.setAttribute('role','region');panel.setAttribute('aria-labelledby','packemNfcRecebimentoTitle');panel.hidden=true;
    panel.style.cssText='box-sizing:border-box;margin-top:12px;border:2px solid #0d8571;border-radius:12px;padding:18px;background:var(--card,#fff);color:var(--ink,#123);overflow-wrap:anywhere';
    var title=document.createElement('h3');title.id='packemNfcRecebimentoTitle';title.textContent='Vincular tag NFC à bobina';panel.appendChild(title);
    detail=document.createElement('p');detail.style.fontWeight='700';panel.appendChild(detail);
    var instruction=document.createElement('p');instruction.textContent='No iPhone, abra o perfil do WMS no TapPony, deixe Lote desligado e aproxime somente o chip desta bobina. A confirmação aparecerá aqui.';panel.appendChild(instruction);
    status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.appendChild(status);
    var controls=document.createElement('div');controls.style.cssText='display:flex;gap:10px;flex-wrap:wrap';panel.appendChild(controls);
    openButton=document.createElement('a');openButton.href='tappony://scan';openButton.className='gbtn';openButton.textContent='Abrir TapPony no iPhone';controls.appendChild(openButton);
    function button(text){var node=document.createElement('button');node.type='button';node.className='gbtn';node.textContent=text;controls.appendChild(node);return node;}
    checkButton=button('Conferir vínculo');cancelButton=button('Cancelar vínculo');retryButton=button('Tentar novamente');pauseButton=button('Pausar contagem e preparar esta tag');closeButton=button('Fechar');
    checkButton.onclick=function(){return perform(function(){return root.WmsNfcMobile.checkEnrollment();});};
    cancelButton.onclick=function(){return perform(async function(){await root.WmsNfcMobile.cancelEnrollment();selection.error='Cadastro encerrado. Toque em Tentar novamente para preparar esta bobina.';});};
    retryButton.onclick=function(){return register(selection.id);};
    pauseButton.onclick=async function(){var current=selection;await perform(function(){return root.WmsNfcMobile.pauseCapture();});if(selection===current&&!current.error)await register(current.id);};
    closeButton.onclick=function(){if(!busy){panel.hidden=true;panel.style.display='none';if(selection)selection.closed=true;}};
  }
  async function perform(callback){
    if(busy||!selection||selection.owner!==user())return;
    var current=selection;busy=true;current.error='';paint();
    try{await callback();}catch(error){report(error,current);}finally{busy=false;paint();}
  }
  async function register(id){
    mountPanel();
    if(busy){if(selection){show(selection.id);setText(status,'O vínculo da bobina '+selection.id+' está sendo preparado. Aguarde a resposta.');}return;}
    selection={id:id,owner:user(),operationId:null,error:'',closed:false,blockedBy:null};
    setText(detail,'Etiqueta '+id);setText(status,'Consultando código e peso da bobina…');show(id);busy=true;
    var current=selection;
    try{
      var snapshot=state();
      if(snapshot.pendingItem&&snapshot.pendingItem!==id){current.blockedBy=snapshot.pendingItem;return;}
      current.operationId=snapshot.pendingItem===id?snapshot.operationId:null;
      if(!root.WmsNfcLabels)throw new Error('A consulta das etiquetas não carregou. Atualize a página e tente novamente.');
      paint();var result=await root.WmsNfcMobile.registerItem(id,context(id));
      if(selection!==current||current.owner!==user())return;
      current.operationId=result.operationId;var tag=result.tag;
      setText(detail,'Etiqueta '+tag.item+' · Código '+tag.codigo+' · '+(tag.unidade==='KG'?'Peso líquido':tag.unidade==='MT'?'Metragem':'Quantidade')+': '+Number(tag.quantidade).toLocaleString('pt-BR',{maximumFractionDigits:6})+' '+tag.unidade);
    }catch(error){report(error,current);}finally{busy=false;paint();}
  }
  function mount(){
    var list=document.getElementById('stageList');if(!list||!permitted())return;
    list.querySelectorAll('[data-az]').forEach(function(storeButton){
      var card=storeButton.parentElement&&storeButton.parentElement.parentElement;if(!card||card.querySelector('[data-nfc-receber]'))return;
      var button=document.createElement('button');button.type='button';button.className='gbtn';button.dataset.nfcReceber=storeButton.dataset.az;
      button.style.cssText='width:100%;justify-content:center;margin-top:10px;border-color:#0d8571;color:var(--ink,#123)';button.textContent='Vincular tag NFC';card.appendChild(button);
    });
    if(selection&&!selection.closed&&panel&&!panel.isConnected)show(selection.id);
  }
  document.addEventListener('click',function(event){
    var button=event.target&&event.target.closest&&event.target.closest('[data-nfc-receber]');if(!button||!button.closest('#stageList'))return;
    event.preventDefault();event.stopPropagation();
    register(button.dataset.nfcReceber).catch(function(error){mountPanel();if(!selection)selection={id:button.dataset.nfcReceber,owner:user()};show(selection.id);report(error);paint();});
  },true);
  var scheduled=false;new MutationObserver(function(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;mount();},80);}).observe(document.body,{childList:true,subtree:true});
  root.addEventListener('packem-nfc-mobile-state',paint);root.WmsNfcRecebimento={mount:mount,register:register};mount();
})(typeof window!=='undefined'?window:globalThis);
