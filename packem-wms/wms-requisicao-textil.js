(function(){
  'use strict';
  var host=document.getElementById('v-requisicao-textil');
  if(!host)return;
  var sector=/^tecelagem$/i.test(String((typeof session!=='undefined'&&session&&session.u)||''))?'tecelagem':'extrusora';
  var busy=false,feedback='',feedbackError=false,stamp=0;
  var channel=typeof BroadcastChannel==='function'?new BroadcastChannel('packem-fitilho-stock'):null;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function kg(v){return Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:3})+' kg';}
  function when(v){var n=Date.parse(v||'');return Number.isFinite(n)?new Date(n).toLocaleString('pt-BR'):'—';}
  function progress(row){return window.FitilhoStockCore.requestProgress({requests:[row],bobbins:[]},row.id);}
  function status(r){var s=String(r.status||'').toLowerCase();return {'pendente':'Pendente','em_separacao':'Em separação','separado':'Separado','finalizado':'Finalizado','cancelado':'Cancelado','pausado':'Pausado','a_confirmar':'A confirmar'}[s]||s||'Pendente';}
  function bodyTear(state){
    var rows=(state.requests||[]),open=rows.filter(function(r){return !progress(r).complete;}).length;
    return '<div class="rtSummary"><strong>'+open+'</strong><span>pedido(s) aguardando fitilho</span><small>Origem: estoque das Extrusoras PP e PET</small></div>'+
      '<section class="rtPanel"><div class="rtPanelHead"><div><span class="rtEyebrow">TECELAGEM · SOLICITAÇÃO</span><h2>Pedir fitilho</h2><p>Informe a OP do Tear e o fitilho necessário. A Extrusora atende o pedido ao bipar a saída.</p></div></div><form class="rtForm" id="rtTearForm"><label>OP do Tear<input name="tearOp" required autocomplete="off" placeholder="Número da OP"></label><label>Estoque de origem<select name="area" required><option value="">Selecione</option><option value="pp-21">Extrusora PP - 21</option><option value="pet-24">Extrusora PET - 24</option></select></label><label>Código do fitilho<input name="productCode" required autocomplete="off" placeholder="Código do produto"></label><label>Peso solicitado (kg)<input name="kg" type="number" min="0.001" step="0.001" required placeholder="0,000"></label><label>Uso no Tear<select name="usage" required><option value="">Selecione</option><option value="warp">Urdume</option><option value="weft">Trama</option><option value="both">Urdume e trama</option></select></label><button type="submit" class="rtPrimary">Criar requisição</button></form></section>'+
      '<section class="rtPanel"><div class="rtPanelHead"><div><span class="rtEyebrow">ACOMPANHAMENTO</span><h2>Pedidos de fitilho</h2></div></div><div class="rtList">'+(rows.length?rows.map(function(r){var p=progress(r);return '<article class="rtRow"><div><span class="rtTag">'+(p.complete?'Atendida':'Aguardando fitilho')+'</span><h3>OP '+esc(r.tearOp)+'</h3><p>'+esc(r.productCode)+' · '+esc(r.area==='pet-24'?'PET - 24':'PP - 21')+' · '+esc({warp:'Urdume',weft:'Trama',both:'Urdume e trama'}[r.usage]||'')+'</p><small>'+esc(when(r.createdAt))+'</small></div><div class="rtRowEnd"><b>'+kg(p.deliveredKg)+' / '+kg(r.requestedKg)+'</b><small>'+p.percent+'% entregue</small><div class="rtBar"><i style="width:'+p.percent+'%"></i></div></div></article>';}).join(''):'<div class="rtEmpty">Nenhuma requisição de fitilho registrada.</div>')+'</div></section>'+
      '<p class="rtLocal">Os pedidos de fitilho desta tela são registrados neste aparelho. Para atender o mesmo pedido em outro aparelho, é necessária sincronização.</p>';
  }
  function bodyExtrusora(){
    var rows=(typeof REQS!=='undefined'&&Array.isArray(REQS)?REQS:[]).filter(function(r){return r&&String(r.setor||r.setor_operacional||'').toUpperCase()==='EXTRUSORA';});
    var open=rows.filter(function(r){return !/finalizad|cancelad/i.test(String(r.status||''));}).length;
    return '<div class="rtSummary"><strong>'+open+'</strong><span>requisição(ões) em andamento</span><small>Destino: Extrusora PP - 21 ou PET - 24</small></div>'+
      '<section class="rtPanel"><div class="rtPanelHead"><div><span class="rtEyebrow">EXTRUSORA · ABASTECIMENTO</span><h2>Matéria-prima para produção</h2><p>Peça o material para a logística. Depois da separação, a etiqueta bipada entra no estoque da Extrusora escolhida.</p></div><button type="button" id="rtNewExtrusora" class="rtPrimary">Nova requisição</button></div></section>'+
      '<section class="rtPanel"><div class="rtPanelHead"><div><span class="rtEyebrow">ACOMPANHAMENTO</span><h2>Pedidos da Extrusora</h2></div></div><div class="rtList">'+(rows.length?rows.map(function(r){var items=Array.isArray(r.itens)?r.itens:[],qty=items.reduce(function(n,i){return n+Number(i.quantidade||0);},0),dest=[].concat(items.map(function(i){return i.maquina;})).filter(Boolean).filter(function(v,i,a){return a.indexOf(v)===i;}).join(' · ');return '<article class="rtRow"><div><span class="rtTag">'+esc(status(r))+'</span><h3>Requisição '+esc(r.numero||r.id)+'</h3><p>'+esc(dest||'Extrusora')+' · '+items.length+' item(ns)</p><small>'+esc(when(r.created_date||r.data))+'</small></div><div class="rtRowEnd"><b>'+kg(qty)+'</b><small>OP '+esc(r.op||'não informada')+'</small></div></article>';}).join(''):'<div class="rtEmpty">Nenhuma requisição da Extrusora registrada.</div>')+'</div></section>';
  }
  async function render(){
    var ticket=++stamp,state=null;
    if(sector==='tecelagem'){
      try{state=await window.FitilhoStock.refresh();}catch(e){feedback=e.message||String(e);feedbackError=true;}
    }
    if(ticket!==stamp)return;
    host.innerHTML='<div class="rtPage"><header class="rtHeader"><div><span class="rtEyebrow">OPERAÇÃO · PRODUÇÃO TÊXTIL</span><h1>Requisição Têxtil</h1><p>Pedidos separados por setor, ligados à entrada e à saída por bipagem.</p></div><button type="button" class="rtRefresh" id="rtRefresh">Atualizar</button></header><div class="rtTabs" role="tablist" aria-label="Setor da requisição"><button type="button" role="tab" data-rt-sector="tecelagem" aria-selected="'+(sector==='tecelagem')+'" class="'+(sector==='tecelagem'?'active':'')+'">Tecelagem <small>Fitilho</small></button><button type="button" role="tab" data-rt-sector="extrusora" aria-selected="'+(sector==='extrusora')+'" class="'+(sector==='extrusora'?'active':'')+'">Extrusora <small>Matéria-prima</small></button></div>'+(feedback?'<div class="rtNotice '+(feedbackError?' error':'')+'" role="status">'+esc(feedback)+'</div>':'')+(sector==='tecelagem'?(state?bodyTear(state):'<div class="rtEmpty">Não foi possível carregar os pedidos de fitilho.</div>'):bodyExtrusora())+'</div>';
  }
  window.wmsReqTextilRender=render;
  host.addEventListener('click',function(e){var tab=e.target.closest('[data-rt-sector]');if(tab){sector=tab.dataset.rtSector;feedback='';render();return;}if(e.target.closest('#rtRefresh')){if(sector==='extrusora'&&typeof window.wmsReqCloudPull==='function')window.wmsReqCloudPull().then(render);else render();return;}if(e.target.closest('#rtNewExtrusora')&&typeof window.rqNovaTextilExtrusora==='function')window.rqNovaTextilExtrusora();});
  host.addEventListener('submit',async function(e){if(e.target.id!=='rtTearForm')return;e.preventDefault();if(busy)return;busy=true;var form=e.target,data=Object.fromEntries(new FormData(form).entries());try{await window.FitilhoStock.createRequest(data);feedback='Requisição criada. A Extrusora já pode bipar as bobinas para o Tear.';feedbackError=false;await render();}catch(error){feedback=error.message||String(error);feedbackError=true;await render();}finally{busy=false;}});
  var previous=window.render;window.render=function(id){if(id==='v-requisicao-textil'){render();return;}return previous(id);};
  if(channel)channel.onmessage=function(){if(host.classList.contains('active')&&sector==='tecelagem'&&!host.querySelector('.rqNewShell'))render();};
  setInterval(function(){if(!host.classList.contains('active')||sector!=='extrusora'||host.querySelector('.rqNewShell'))return;if(typeof window.wmsReqCloudPull==='function')window.wmsReqCloudPull().then(render);},15000);
})();
