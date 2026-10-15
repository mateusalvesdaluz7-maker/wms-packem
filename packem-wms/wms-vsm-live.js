(function(){
  'use strict';
  var view=document.getElementById('v-flow'),snapshot=null,viewRows=[],selected='',query='',busy=false,lastRefresh=0;
  if(!view)return;
  var format=window.CutFlowDashboardCore.duration;
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];});}
  function pct(value){return Math.max(0,Math.min(100,Math.round(Number(value)||0)));}
  function date(value){var time=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(time)&&time>0?new Date(time).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Sem horário';}
  function bar(value){return '<span class="vsmBar"><i style="width:'+pct(value)+'%"></i></span>';}
  function pairs(){return viewRows;}
  function filtered(){return pairs().filter(function(pair){var op=pair.item.op||{};return !query||[op.ap,op.lot,op.client,op.fileName].join(' ').toLowerCase().includes(query);});}
  function currentStep(item,q,times){return !times.request.ready?1:item.sepPercent<100?2:pct(q.producedPercent)<100?3:pct(q.scannedPercent)<100?4:item.expPercent<100?5:-1;}
  function prepareRows(data){return data.report.items.map(function(item,index){var row=data.rows[index]||{},q=(row.expedition&&row.expedition.quantities)||{},times=window.CutFlowDashboardCore.flowStageTimes(row,item,data.updatedAt);return {item:item,row:row,times:times,current:currentStep(item,q,times)};});}
  function phaseTime(time,remaining,progress){if(progress>=100)return time.completedMinutes===null?'Concluída':'Concluída em '+format(time.completedMinutes);if(time.paused)return 'Pausada';if(remaining!==null)return 'Previsão: mais '+format(remaining);return time.elapsedMinutes===null?'Sem início registrado':format(time.elapsedMinutes)+' em andamento';}
  function timeLabel(clock,fallback){if(clock.immediate)return 'Tempo: imediato';if(clock.waitingMinutes!==null&&clock.waitingMinutes!==undefined)return 'Na fila: '+format(clock.waitingMinutes);if(clock.elapsedMinutes!==null&&clock.elapsedMinutes!==undefined)return (clock.finishedAt!==null&&clock.finishedAt!==undefined||clock.ready?'Tempo: ':'Há ')+format(clock.elapsedMinutes);return fallback||'Sem horário registrado';}
  function setup(){
    if(view.querySelector('.vsmLive'))return;
    view.innerHTML='<div class="vsmLive"><header class="vsmHeader"><div><h1>VSM da fábrica</h1><p>Da matéria-prima ao embarque, com os registros vinculados à OP.</p></div><div class="vsmHeaderSide"><span class="vsmLivePill"><i></i> Ao vivo</span><span id="vsmUpdated">Carregando…</span><button type="button" id="vsmRefresh">Atualizar</button></div></header><div class="vsmSelector"><label for="vsmSelect">Escolha a OP</label><div class="vsmSelectorInputs"><input id="vsmSearch" type="search" placeholder="Buscar AP, lote ou cliente" aria-label="Buscar OP no VSM"><select id="vsmSelect" aria-label="Escolher OP"></select></div></div><div id="vsmMap"></div><details class="vsmAll"><summary>Ver todas as OPs <span id="vsmCount"></span></summary><div id="vsmList"></div></details></div>';
    view.querySelector('#vsmRefresh').onclick=function(){load(true);};
    view.querySelector('#vsmSearch').oninput=function(event){query=event.target.value.trim().toLowerCase();paintSelector();paintList();};
    view.querySelector('#vsmSelect').onchange=function(event){selected=event.target.value;paintMap();paintList();};
    view.querySelector('#vsmList').onclick=function(event){var row=event.target.closest('[data-vsm-op]');if(!row)return;selected=row.dataset.vsmOp;query='';view.querySelector('#vsmSearch').value='';paintSelector();paintList();view.querySelector('.vsmSelector').scrollIntoView({behavior:'smooth',block:'start'});};
    view.querySelector('#vsmMap').onclick=function(event){var link=event.target.closest('[data-vsm-open]');if(!link)return;var nav=document.querySelector('.nav[data-view="v-corte"]');if(nav)nav.click();if(window.wmsCorteOpenOp)window.wmsCorteOpenOp(link.dataset.vsmOpen);};
  }
  function paintSelector(){
    var select=view.querySelector('#vsmSelect'),options=filtered();if(!select)return;
    if(!options.some(function(pair){return String(pair.item.op.id)===selected;}))selected=options.length?String(options[0].item.op.id):'';
    select.innerHTML=options.length?options.map(function(pair){var op=pair.item.op||{};return '<option value="'+esc(op.id)+'">AP '+esc(op.ap||'—')+' · '+esc(op.lot||'sem lote')+' · '+esc(op.client||'')+'</option>';}).join(''):'<option value="">Nenhuma OP encontrada</option>';
    select.value=selected;paintMap();
  }
  function stage(index,label,percent,linked,current,time){
    var value=pct(percent),done=linked&&value>=100,state=done?'Concluída':!linked?'Pendente':value>0?'Em andamento':'Aguardando';
    return '<article class="vsmStage'+(done?' vsmComplete':'')+(current===index?' vsmCurrent':'')+'"><div class="vsmStageTitle"><span>'+String(index+1).padStart(2,'0')+'</span><b>'+esc(label)+'</b></div><div class="vsmStageProgress"><strong>'+value+'%</strong><small>'+state+'</small></div>'+bar(value)+'<div class="vsmStageTime">'+esc(time)+'</div></article>';
  }
  function upstreamStage(index,label,output){
    return '<article class="vsmStage vsmUnlinked"><div class="vsmStageTitle"><span>'+String(index+1).padStart(2,'0')+'</span><b>'+esc(label)+'</b></div><div class="vsmStageProgress"><strong>—</strong><small>Sem vínculo</small></div><p>'+esc(output)+'</p><div class="vsmStageTime">Bipagem ainda não ligada a esta OP</div></article>';
  }
  function paintMap(){
    var box=view.querySelector('#vsmMap');if(!box)return;
    var expanded=!!(box.querySelector('.vsmDisclosure')&&box.querySelector('.vsmDisclosure').open),pair=pairs().find(function(entry){return String(entry.item.op.id)===selected;});
    if(!pair){box.innerHTML='<div class="vsmEmpty">Nenhuma OP encontrada.</div>';return;}
    var item=pair.item,row=pair.row||{},op=item.op||{},sep=row.separation||{},shipment=row.shipment||{},q=(row.expedition&&row.expedition.quantities)||{},times=pair.times,current=pair.current,urgent=(row.urgent||[]).length;
    var names=['OP importada','Requisição','Separação','Produção no Corte','Produto bipado','Conferência'];
    var actions=['','Conferir requisição','Separar e bipar o material','Acompanhar produção','Bipar produto pronto','Conferir romaneio'];
    var forecast=item.opCompletedMinutes!==null?'Concluída em '+format(item.opCompletedMinutes):item.opRemaining!==null?'Previsão: mais '+format(item.opRemaining):'Sem previsão ainda';
    var shipmentDate=shipment.dates&&shipment.dates.length?shipment.dates.join(' · '):'A definir';
    var events=[['OP importada',op.createdAt],['Separação iniciada',item.separation.startedAt],['Separação concluída',item.separation.finishedAt],['Primeiro bip na expedição',item.expedition.startedAt],['Expedição concluída',item.expedition.finishedAt]].filter(function(event){return event[1]!=null;});
    box.innerHTML='<div class="vsmOpHead"><div><h2>AP '+esc(op.ap||'—')+' <span>rev. '+esc(op.revision||'—')+'</span></h2><p>'+esc(op.client||'Cliente não informado')+' · lote '+esc(op.lot||'—')+' · '+Number(op.quantity||0).toLocaleString('pt-BR')+' peças</p></div><div class="vsmOpHeadRight">'+(urgent?'<span class="vsmUrgent">'+urgent+' '+(urgent===1?'item urgente':'itens urgentes')+'</span>':'')+'<span>Embarque: <b>'+esc(shipmentDate)+'</b></span><button type="button" data-vsm-open="'+esc(op.id)+'">Abrir OP →</button></div></div>'+
      '<div class="vsmNow"><div><small>ETAPA ATUAL</small><strong>'+esc(current<0?'Romaneio conferido':names[current])+'</strong></div><div><small>PRÓXIMA AÇÃO</small><b>'+esc(current<0?'Aguardar registro do embarque':actions[current])+'</b></div></div>'+
      '<section class="vsmFlowSection"><div class="vsmSectionHead"><div><small>01 · PRODUÇÃO DO MATERIAL</small><h3>Antes da OP de Corte</h3></div><span>Rastreio de origem a conectar</span></div><div class="vsmUpstream">'+upstreamStage(0,'Recebimento','Resina e insumos')+upstreamStage(1,'Extrusora','Fitilho produzido')+upstreamStage(2,'Tear','Bobina de tecido')+upstreamStage(3,'Logística / estoque','Bobina endereçada')+'</div><p class="vsmOptional">Formulação, laminação e outros processos entram quando houver registros para a rota do produto.</p></section>'+
      '<div class="vsmFlowBridge"><span>O PCP usa o material disponível para atender a OP</span></div>'+
      '<section class="vsmFlowSection vsmOrderSection"><div class="vsmSectionHead"><div><small>02 · ATENDIMENTO DA OP</small><h3>Da requisição à conferência</h3></div><span>Progresso calculado pelos registros atuais</span></div><div class="vsmFlow">'+stage(0,'OP / PCP',100,true,current,timeLabel(times.pcp))+stage(1,'Requisição / Corte',times.request.ready?100:0,times.request.ready,current,timeLabel(times.request,item.sepLinked?'Sem horário':'Aguardando PCP'))+stage(2,'Logística / separação',item.sepPercent,item.sepLinked&&times.request.ready,current,timeLabel(times.separation,times.request.ready?'Aguardando 1º bipe':'Aguardando requisição'))+stage(3,'Corte / produção',q.producedPercent,q.linked,current,timeLabel(times.production,'Sem horário de produção'))+stage(4,'Produto bipado',q.scannedPercent,q.linked,current,timeLabel(times.productScan,pct(q.scannedPercent)>0?'Sem horário do bip':'Aguardando 1º bip'))+stage(5,'Expedição / conferência',item.expPercent,item.expLinked,current,timeLabel(times.expedition,pct(item.expPercent)>0?'Sem horário da conferência':'Aguardando conferência'))+'</div></section>'+
      '<div class="vsmShipment"><div><small>03 · SAÍDA DA FÁBRICA</small><strong>Embarque</strong><span>Bipagem do carregamento ainda não vinculada a este VSM.</span></div><b>'+esc(shipmentDate==='A definir'?'Sem data prevista':'Previsto para '+shipmentDate)+'</b></div>'+
      '<details class="vsmDisclosure"'+(expanded?' open':'')+'><summary>Ver tempos e horários <span>▾</span></summary><div class="vsmDetails"><div class="vsmMetrics"><div><small>Desde a importação</small><strong>'+esc(format(item.opElapsedMinutes))+'</strong></div><div><small>Separação</small><strong>'+esc(item.sepLinked?phaseTime(item.separation,item.sepRemaining,item.sepPercent):'Aguardando requisição')+'</strong></div><div><small>Expedição</small><strong>'+esc(item.expLinked?phaseTime(item.expedition,item.expRemaining,item.expPercent):'Sem romaneio')+'</strong></div><div><small>Conclusão</small><strong>'+esc(forecast)+'</strong></div></div><div class="vsmDetailBottom"><div><h3>Horários registrados</h3><div class="vsmEvents">'+(events.length?events.map(function(event){return '<div><b>'+esc(event[0])+'</b><span>'+esc(date(event[1]))+'</span></div>';}).join(''):'<p>Nenhum horário registrado.</p>')+'</div></div><div><h3>Leitura do processo</h3><p>Matéria-prima bipada: '+pct(sep.bippedPercent)+'% · Produção: '+pct(q.producedPercent)+'% · Produto bipado: '+pct(q.scannedPercent)+'% · Expedição: '+pct(item.expPercent)+'%.</p><p>Os tempos usam os registros da requisição e do romaneio. A previsão muda conforme o ritmo observado.</p></div></div></div></details>';
    var expeditionMetric=box.querySelector('.vsmMetrics>div:nth-child(3) strong');
    if(expeditionMetric)expeditionMetric.textContent=item.expLinked?timeLabel(times.expedition,pct(item.expPercent)>0?'Sem horário da conferência':'Aguardando conferência'):'Sem romaneio';
  }
  function paintList(){
    var box=view.querySelector('#vsmList');if(!box||!snapshot)return;
    var list=filtered().sort(function(a,b){return String(b.item.op.createdAt||'').localeCompare(String(a.item.op.createdAt||''));});
    view.querySelector('#vsmCount').textContent='('+list.length+')';
    box.innerHTML=list.length?'<div class="vsmTableScroll"><table class="vsmTable"><thead><tr><th>OP / LOTE</th><th>ETAPA ATUAL</th><th>SEPARAÇÃO</th><th>EXPEDIÇÃO</th></tr></thead><tbody>'+list.map(function(pair){var item=pair.item,op=item.op||{},step=pair.current,names=['OP importada','Requisição','Separação','Produção','Produto bipado','Expedição'];return '<tr data-vsm-op="'+esc(op.id)+'" class="'+(String(op.id)===selected?'isSelected':'')+'"><td><b>AP '+esc(op.ap||'—')+'</b><span>'+esc(op.lot||'—')+' · '+esc(op.client||'')+'</span></td><td>'+esc(step<0?'Concluída':names[step])+'</td><td>'+pct(item.sepPercent)+'%'+bar(item.sepPercent)+'</td><td>'+pct(item.expPercent)+'%'+bar(item.expPercent)+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="vsmEmpty">Nenhuma OP corresponde à busca.</div>';
  }
  function paint(){if(!snapshot)return;view.querySelector('#vsmUpdated').textContent='Atualizado às '+new Date(snapshot.updatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});paintSelector();paintList();}
  async function load(remote){if(busy||!view.classList.contains('active')||typeof window.wmsCorteFlowSnapshot!=='function')return;busy=true;try{var data=await window.wmsCorteFlowSnapshot({remote:!!remote});viewRows=prepareRows(data);snapshot=data;lastRefresh=Date.now();paint();}catch(error){view.querySelector('#vsmUpdated').textContent='Não foi possível atualizar';console.error('VSM ao vivo',error);}finally{busy=false;}}
  function render(){setup();load(true);}
  var previousRender=window.render;window.render=function(id){if(id==='v-flow'){render();return;}return previousRender(id);};
  window.addEventListener('wms-flow-updated',function(){if(view.classList.contains('active'))load(false);});
  setInterval(function(){if(view.classList.contains('active')&&Date.now()-lastRefresh>=14000)load(true);},15000);
})();
