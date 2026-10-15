(function(){
  'use strict';
  var core=window.FitilhoStockCore,views=['v-extrusora-pet','v-extrusora-pp','v-tear'],state=core&&core.initial(),ready=false,loading=null,busy=false,notice='',noticeError=false,lastView='';
  if(!core||views.some(function(id){return !document.getElementById(id);}))return;
  var channel=typeof BroadcastChannel==='function'?new BroadcastChannel('packem-fitilho-stock'):null;
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function kg(value){return Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3})+' kg';}
  function date(value){var n=Date.parse(value||'');return Number.isFinite(n)?new Date(n).toLocaleString('pt-BR'):'—';}
  function user(){return String((document.getElementById('uName')||{}).textContent||'').trim()||'Operador';}
  function currentView(){var node=document.querySelector('.view.active');return node&&node.id;}
  function clean(value){var raw=String(value||'').trim();try{if(typeof window.cleanScanCode==='function')raw=window.cleanScanCode(raw)||raw;}catch(_error){}return String(raw).trim().toUpperCase();}
  function areaForView(id){return id==='v-extrusora-pet'?'pet-24':'pp-21';}
  function areaName(value){return value==='pet-24'?'PET - 24':value==='pp-21'?'PP - 21':'Sem setor';}
  function openDb(){return new Promise(function(resolve,reject){var request=indexedDB.open('packem-fitilho-stock-v1',1);request.onupgradeneeded=function(){if(!request.result.objectStoreNames.contains('records'))request.result.createObjectStore('records');};request.onsuccess=function(){resolve(request.result);};request.onerror=function(){reject(request.error||new Error('Não foi possível abrir o estoque local.'));};});}
  async function read(){var db=await openDb();return new Promise(function(resolve,reject){var tx=db.transaction('records','readonly'),request=tx.objectStore('records').get('state');request.onsuccess=function(){resolve(core.normalize(request.result));};request.onerror=function(){reject(request.error);};tx.oncomplete=function(){db.close();};});}
  async function write(command){var db=await openDb();return new Promise(function(resolve,reject){var tx=db.transaction('records','readwrite'),request=tx.objectStore('records').get('state'),result=null,error=null;request.onsuccess=function(){try{result=command(core.normalize(request.result));tx.objectStore('records').put(result,'state');}catch(cause){error=cause;tx.abort();}};request.onerror=function(){error=request.error;tx.abort();};tx.oncomplete=function(){db.close();resolve(result);};tx.onabort=function(){db.close();reject(error||tx.error||new Error('Não foi possível salvar o registro.'));};});}
  async function ensure(){if(ready)return;if(!loading)loading=read().then(function(saved){state=saved;ready=true;}).finally(function(){loading=null;});await loading;}
  async function change(command,message){if(busy)return false;busy=true;try{state=await write(command);notice=message;noticeError=false;paint();if(channel)channel.postMessage('updated');return true;}catch(error){notice=error&&error.message||String(error);noticeError=true;paint();return false;}finally{busy=false;}}
  function frame(title,subtitle,body){return '<div class="fitPage"><header class="fitHeader"><div><span class="fitEyebrow">PRODUÇÃO TÊXTIL · ESTOQUE</span><h1>'+esc(title)+'</h1><p>'+esc(subtitle)+'</p></div><span class="fitScope">Atualiza neste aparelho · sem nuvem</span></header>'+(notice?'<div class="fitNotice'+(noticeError?' error':'')+'" role="status">'+esc(notice)+'</div>':'')+body+'</div>';}
  function usage(value){return {warp:'Urdume',weft:'Trama',both:'Urdume e trama'}[value]||'Uso não informado';}
  function requestCard(row,scan){
    var progress=core.requestProgress(state,row.id),complete=progress.complete;
    return '<article class="fitRequest '+(complete?'done':'')+'"><header><div><span class="fitEyebrow">'+(complete?'ATENDIDA':'AGUARDANDO FITILHO')+' · '+esc(areaName(row.area))+' · '+esc(usage(row.usage))+'</span><h3>'+esc(row.tearOp)+'</h3><p>'+esc(row.productCode)+' · pedido '+kg(row.requestedKg)+' · '+esc(date(row.createdAt))+'</p></div><strong>'+kg(progress.deliveredKg)+'<small> '+progress.percent+'% entregue</small></strong></header><div class="fitProgress"><i style="width:'+progress.percent+'%"></i></div>'+(progress.excessKg?'<p class="fitExcess">Bobina completa: '+kg(progress.excessKg)+' acima do pedido.</p>':'')+(scan&&!complete?'<form class="fitScan" data-fit-form="dispatch" data-request="'+esc(row.id)+'"><label>Bipar saída do estoque<input name="label" required autocomplete="off" placeholder="Etiqueta da bobina de fitilho"></label><button class="fitPrimary" type="submit">Enviar ao Tear</button></form>':'')+(row.deliveries.length?'<div class="fitDelivered">'+row.deliveries.map(function(item){return '<div><b>'+esc(item.label)+'</b><span>'+esc(item.lot)+' · '+esc(usage(item.usage))+'</span><strong>'+kg(item.kg)+'</strong></div>';}).join('')+'</div>':'<p class="fitHint">Nenhuma bobina entregue ainda.</p>')+'</article>';
  }
  var extrusoraMode={'pet-24':'add','pp-21':'add'},scanDraft=null;
  function renderExtrusora(stockArea){
    var stock=core.inventory(state,stockArea),mode=extrusoraMode[stockArea],groups={};
    stock.available.forEach(function(row){
      var key=row.productCode||'SEM CÓDIGO',group=groups[key]||(groups[key]={code:key,kg:0,rows:[],description:row.description||''});
      group.rows.push(row);group.kg+=Number(row.kg)||0;if(!group.description&&row.description)group.description=row.description;
    });
    var codes=Object.values(groups).sort(function(a,b){return b.rows.length-a.rows.length||a.code.localeCompare(b.code);});
    var total=stock.available.reduce(function(sum,row){return sum+Number(row.kg||0);},0);
    var open=state.requests.filter(function(row){return row.area===stockArea&&!core.requestProgress(state,row.id).complete;}).length;
    var hint=mode==='add'?'Bipe a etiqueta para registrar a entrada. As etiquetas da requisição são reconhecidas automaticamente.':'Bipe a etiqueta que está saindo. Matéria-prima vai para a máquina; fitilho atende o pedido mais antigo do Tear.';
    var scan='<div class="fitSimpleTop"><section class="fitSimpleScan"><div class="fitSimpleScanHead"><span class="fitEyebrow">BIPAR ETIQUETA</span><div class="fitSimpleMode" role="group" aria-label="Movimentação"><button type="button" data-fit-mode="add" data-fit-area="'+stockArea+'" class="'+(mode==='add'?'active':'')+'" aria-pressed="'+(mode==='add')+'">+ Entrada</button><button type="button" data-fit-mode="out" data-fit-area="'+stockArea+'" class="'+(mode==='out'?'active':'')+'" aria-pressed="'+(mode==='out')+'">− Saída</button></div></div><form data-fit-form="scan" class="fitSimpleForm"><input type="hidden" name="area" value="'+stockArea+'"><label for="fitSimpleScan-'+stockArea+'">Etiqueta</label><div class="fitSimpleInput"><input id="fitSimpleScan-'+stockArea+'" name="label" required autocomplete="off" placeholder="BIPE OU DIGITE"><button type="submit" class="fitPrimary">Bipar</button></div></form><p class="fitSimpleHint">'+hint+'</p></section><section class="fitSimpleTotal"><strong>'+stock.available.length+'</strong><span>etiqueta(s) no estoque</span><small>'+kg(total)+' · '+codes.length+' código(s)'+(open?' · '+open+' pedido(s) do Tear':'')+'</small></section></div>';
    var draft='';
    if(scanDraft&&scanDraft.area===stockArea&&mode==='add'){
      var item=scanDraft.item||{};
      draft='<section class="fitSimpleDraft"><span class="fitEyebrow">CONFERIR ENTRADA</span><h3>'+esc(scanDraft.label)+'</h3><p>Confira o tipo, código e peso antes de salvar esta etiqueta.</p><form class="fitGrid" data-fit-form="receive"><input type="hidden" name="area" value="'+stockArea+'"><input type="hidden" name="label" value="'+esc(scanDraft.label)+'"><label>Tipo de material<select name="materialType" required><option value="">Selecionar</option><option value="materia-prima">Matéria-prima</option><option value="fitilho">Fitilho produzido</option></select></label><label>Código do material<input name="productCode" required autocomplete="off" value="'+esc(item.code||'')+'"></label><label>Peso (kg)<input name="kg" type="number" min="0.001" step="0.001" required value="'+(Number(item.kg)>0?esc(item.kg):'')+'"></label><label>Lote, se houver<input name="lot" autocomplete="off" value="'+esc(item.lot||'')+'"></label><label class="fitWide">Descrição<input name="description" autocomplete="off" value="'+esc(item.description||'')+'"></label><div class="fitSimpleDraftActions"><button type="submit" class="fitPrimary">Confirmar entrada</button><button type="button" data-fit-cancel>Cancelar</button></div></form></section>';
    }
    var list=codes.length?codes.map(function(group){
      var raw=group.rows.filter(function(row){return row.materialType==='materia-prima';}).length;
      return '<details class="fitSimpleCode"><summary><div><b>'+esc(group.code)+'</b><span>'+esc(group.description||'Sem descrição')+'</span></div><div class="fitSimpleCodeTotals"><em>'+group.rows.length+' etiqueta(s)</em><strong>'+kg(group.kg)+'</strong></div></summary><div class="fitSimpleCodeDetail"><p>'+raw+' matéria-prima · '+(group.rows.length-raw)+' fitilho produzido</p>'+group.rows.map(function(row){return '<div><span>'+esc(row.label)+(row.lot?' · lote '+esc(row.lot):'')+'</span><b>'+kg(row.kg)+'</b></div>';}).join('')+'</div></details>';
    }).join(''):'<div class="fitSimpleEmpty"><b>Estoque vazio</b><span>Bipe uma etiqueta na Entrada para começar.</span></div>';
    var legacy=core.inventory(state,'').available;
    var older=legacy.length?'<details class="fitPanel fitLegacy"><summary>'+legacy.length+' etiqueta(s) antigas sem setor · classificar</summary>'+legacy.map(function(item){return '<div class="fitStockRow"><div><b>'+esc(item.label)+'</b><small>'+esc(item.productCode)+'</small></div><strong>'+kg(item.kg)+'</strong><button type="button" class="fitLookup" data-fit-assign-bobbin="'+esc(item.label)+'" data-fit-area="'+stockArea+'">Atribuir a '+esc(areaName(stockArea))+'</button></div>';}).join('')+'</details>':'';
    return frame('Extrusora '+areaName(stockArea),'Entrada e saída de materiais por etiqueta.','<div class="fitSimple">'+scan+draft+'<h2 class="fitSimpleTitle">Totais por código</h2>'+list+older+'</div>');
  }
  async function scanExtrusora(stockArea,label){
    label=clean(label);if(!label)return;await ensure();
    if(extrusoraMode[stockArea]==='out'){
      var row=state.bobbins.find(function(item){return item.label===label;});
      if(!row||row.area!==stockArea||row.status!=='stock'){notice='Etiqueta não disponível no estoque da Extrusora '+areaName(stockArea)+'.';noticeError=true;paint();return;}
      if(row.materialType==='materia-prima'){
        var machine='EXTRUSORA '+areaName(stockArea);
        await change(function(old){return core.sendToMachine(old,{label:label,area:stockArea,machine:machine,by:user()});},'Saída registrada: '+label+' para '+machine+'.');
      }else{
        var matching=state.requests.filter(function(request){return request.area===stockArea&&request.productCode===row.productCode&&!core.requestProgress(state,request.id).complete;});
        matching.sort(function(a,b){return (Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0)||a.id.localeCompare(b.id);});
        if(!matching.length){notice='Não há requisição aberta do Tear para o código '+row.productCode+'.';noticeError=true;paint();return;}
        var request=matching[0];
        await change(function(old){return core.dispatch(old,request.id,{label:label,by:user()});},'Saída registrada: '+label+' para a OP '+request.tearOp+' do Tear.');
      }
      var next=document.getElementById('fitSimpleScan-'+stockArea);if(next)next.focus();
      return;
    }
    var known=state.bobbins.find(function(item){return item.label===label;});
    if(known){notice='Esta etiqueta já está registrada em '+areaName(known.area)+'.';noticeError=true;paint();return;}
    try{
      var delivery=core.requestDelivery(window.REQS,label,stockArea);
      if(!delivery&&typeof window.wmsReqCloudPull==='function'){await window.wmsReqCloudPull();delivery=core.requestDelivery(window.REQS,label,stockArea);}
      if(delivery){scanDraft=null;await window.FitilhoStock.receiveFromRequest(Object.assign({},delivery,{by:user()}));return;}
    }catch(error){notice=error&&error.message||String(error);noticeError=true;paint();return;}
    var item=null;
    if(typeof window.wmsRaffiaLookupLabel==='function'){try{item=await window.wmsRaffiaLookupLabel(label);}catch(_error){}}
    scanDraft={area:stockArea,label:label,item:item};
    notice=item?'Etiqueta localizada. Confira os dados para registrar a entrada.':'Etiqueta não localizada no catálogo. Informe os dados da entrada.';
    noticeError=false;paint();
    var select=document.querySelector('.view.active .fitSimpleDraft select[name="materialType"]');if(select)select.focus();
  }
  function renderTear(){
    var requests=state.requests,delivered=requests.reduce(function(total,row){return total+core.requestProgress(state,row.id).deliveredKg;},0),open=requests.filter(function(row){return !core.requestProgress(state,row.id).complete;}).length;
    var summary='<div class="fitStats"><div><span>REQUISIÇÕES</span><strong>'+requests.length+'</strong><small>'+open+' aguardando fitilho</small></div><div><span>CONSUMO REGISTRADO</span><strong>'+kg(delivered)+'</strong><small>pelas saídas da Extrusora</small></div><div><span>BOBINAS RECEBIDAS</span><strong>'+requests.reduce(function(total,row){return total+row.deliveries.length;},0)+'</strong><small>vinculadas às OPs do Tear</small></div></div>';
    var form='<section class="fitPanel"><div class="fitSectionHead"><div><span class="fitEyebrow">01 · SOLICITAÇÃO</span><h2>Requisitar fitilho</h2><p>Informe a OP e o estoque de origem. A extrusora escolhida atende pelo bipe das bobinas disponíveis.</p></div></div><form class="fitGrid" data-fit-form="request"><label>OP do Tear<input name="tearOp" required autocomplete="off" placeholder="Número da OP"></label><label>Estoque de origem<select name="area" required><option value="">Selecionar</option><option value="pp-21">Extrusora PP - 21</option><option value="pet-24">Extrusora PET - 24</option></select></label><label>Código do fitilho<input name="productCode" required autocomplete="off" placeholder="Código solicitado"></label><label>Peso solicitado (kg)<input name="kg" type="number" min="0.001" step="0.001" required placeholder="Quantidade estimada"></label><label>Uso no Tear<select name="usage" required><option value="">Selecionar</option><option value="warp">Urdume</option><option value="weft">Trama</option><option value="both">Urdume e trama</option></select></label><button class="fitPrimary fitSubmit" type="submit">Criar requisição</button></form></section>';
    var list='<section class="fitPanel"><div class="fitSectionHead"><div><span class="fitEyebrow">02 · ACOMPANHAMENTO</span><h2>Requisições e consumo</h2><p>O consumo aparece assim que a etiqueta sai do estoque da Extrusora.</p></div></div>'+(requests.length?requests.map(function(row){return requestCard(row,false)+(row.area?'':'<div class="fitLegacyRequest">Requisição antiga sem origem: <button type="button" data-fit-assign-request="'+esc(row.id)+'" data-fit-area="pp-21">PP - 21</button><button type="button" data-fit-assign-request="'+esc(row.id)+'" data-fit-area="pet-24">PET - 24</button></div>');}).join(''):'<div class="fitEmpty">Nenhuma requisição de fitilho registrada.</div>')+'</section>';
    return frame('Tear','Peça fitilho por OP e acompanhe as bobinas entregues ao consumo.',summary+form+list);
  }
  function paint(){var id=currentView();if(views.indexOf(id)<0)return;var host=document.getElementById(id);if(!host)return;host.innerHTML=id==='v-tear'?renderTear():renderExtrusora(areaForView(id));if(typeof window.addCam==='function')host.querySelectorAll('[data-fit-form] input[name="label"]:not([type="hidden"])').forEach(function(input,index){if(!input.id)input.id='fitScan-'+id+'-'+index;window.addCam(input.id,{title:'Bipar etiqueta',onResult:function(value){input.value=clean(value);var form=input.closest('form');if(!form)return;var action=form.dataset.fitForm;if(action==='machineUpdate'||action==='exit')return;if(form.checkValidity()){var submit=form.querySelector('button[type="submit"]');if(submit)submit.click();}}});});}
  async function activate(id){if(views.indexOf(id)<0)return;if(id!==lastView){notice='';noticeError=false;lastView=id;}try{await ensure();paint();}catch(error){var host=document.getElementById(id);if(host)host.innerHTML='<div class="fitEmpty">Não foi possível abrir os registros: '+esc(error.message||error)+'</div>';}}
  document.addEventListener('submit',function(event){
    var form=event.target.closest('[data-fit-form]');if(!form)return;
    event.preventDefault();var data=Object.fromEntries(new FormData(form).entries()),kind=form.dataset.fitForm;data.label=clean(data.label);data.by=user();
    if(kind==='scan'){
      scanExtrusora(data.area,data.label).catch(function(error){notice=error&&error.message||String(error);noticeError=true;paint();});
    }else if(kind==='receive'){
      try{
        var delivery=core.requestDelivery(window.REQS,data.label,data.area);
        if(delivery){window.FitilhoStock.receiveFromRequest(Object.assign({},delivery,{by:user()})).then(function(){scanDraft=null;paint();}).catch(function(error){notice=error&&error.message||String(error);noticeError=true;paint();});return;}
      }catch(error){notice=error&&error.message||String(error);noticeError=true;paint();return;}
      change(function(old){return core.receive(old,data);},'Etiqueta '+data.label+' registrada no estoque da Extrusora.').then(function(ok){if(ok){scanDraft=null;paint();}});
    }else if(kind==='machine'){change(function(old){return core.sendToMachine(old,data);},'Etiqueta '+data.label+' saiu do estoque e está na máquina '+clean(data.machine)+'.');}
    else if(kind==='exit'){change(function(old){return core.exitStock(old,data);},'Saída de '+data.label+' confirmada para '+data.destination+'.');}
    else if(kind==='machineUpdate'){var action=data.action,machine=data.machine;if(action==='consume')change(function(old){return core.consumeMachine(old,data);},'Consumo da etiqueta '+data.label+' apontado na máquina '+machine+'.');else if(action==='return')change(function(old){return core.returnFromMachine(old,data);},'Material restante da etiqueta '+data.label+' voltou ao estoque.');}
    else if(kind==='request'){data.id='REQ-FIT-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();change(function(old){return core.request(old,data);},'Requisição criada. A Extrusora já pode bipar a saída das bobinas.');}
    else if(kind==='dispatch'){var label=data.label;change(function(old){return core.dispatch(old,form.dataset.request,{label:label,by:user()});},'Saída confirmada. A bobina '+label+' entrou no consumo do Tear.');}
  });
  views.forEach(function(id){document.getElementById(id).addEventListener('click',function(event){var button=event.target.closest('button');if(!button)return;if(button.dataset.fitMode){var area=button.dataset.fitArea;extrusoraMode[area]=button.dataset.fitMode;scanDraft=null;notice='';noticeError=false;paint();var input=document.getElementById('fitSimpleScan-'+area);if(input)input.focus();}else if(button.dataset.fitCancel!==undefined){scanDraft=null;notice='';paint();}else if(button.dataset.fitAssignBobbin){var label=button.dataset.fitAssignBobbin,area=button.dataset.fitArea;change(function(old){return core.assignArea(old,'bobbin',label,area);},'Bobina '+label+' atribuída ao estoque '+areaName(area)+'.');}else if(button.dataset.fitAssignRequest){var requestId=button.dataset.fitAssignRequest,source=button.dataset.fitArea;change(function(old){return core.assignArea(old,'request',requestId,source);},'Requisição atribuída ao estoque '+areaName(source)+'.');}});});
  if(channel)channel.onmessage=function(){read().then(function(saved){state=saved;ready=true;paint();}).catch(function(){});};
  var previous=window.render;window.render=function(id){if(views.indexOf(id)>=0){activate(id);return;}return previous(id);};
  window.FitilhoStock={
    read:function(){return ensure().then(function(){return state;});},
    refresh:async function(){state=await read();ready=true;return state;},
    createRequest:async function(data){
      await ensure();
      if(busy)throw new Error('Aguarde o registro anterior terminar.');
      busy=true;
      try{
        var id='REQ-FIT-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
        state=await write(function(old){return core.request(old,Object.assign({},data,{id:id,by:user()}));});
        notice='Requisição criada. A Extrusora já pode bipar a saída das bobinas.';noticeError=false;paint();
        if(channel)channel.postMessage('updated');
        return state.requests.find(function(row){return row.id===id;});
      }finally{busy=false;}
    },
    location:function(label){var row=state.bobbins.find(function(item){return item.label===clean(label)&&['stock','machine'].indexOf(item.status)>=0;});if(!row)return null;return {etiqueta:row.label,local:'Extrusora '+areaName(row.area),detalhe:row.status==='machine'?'Máquina '+row.machineId:'Estoque de matéria-prima ou fitilho'};},
    receiveFromRequest:async function(delivery){
      await ensure();
      var created=false;
      state=await write(function(old){created=!old.bobbins.some(function(row){return row.label===clean(delivery.label);});return core.receiveFromRequest(old,delivery);});
      if(created){notice='Etiqueta '+clean(delivery.label)+' recebida da requisição '+clean(delivery.requestId)+' em '+areaName(delivery.area)+'.';noticeError=false;paint();if(channel)channel.postMessage('updated');}
      return {created:created,area:delivery.area,label:clean(delivery.label)};
    }
  };
  ensure().catch(function(){});
})();
