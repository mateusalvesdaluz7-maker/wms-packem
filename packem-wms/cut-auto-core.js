(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CutAutoCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function text(value){return String(value==null?'':value).trim();}
  function roundRequestQuantity(value){var quantity=Number(value);return Number.isFinite(quantity)&&quantity>0?Math.ceil(quantity):quantity;}
  function validate(draft,catalog,polymer,score){
    var lines=[],issues=[];
    (draft||[]).forEach(function(row){
      var label=text(row.label)||'etapa',rawOp=text(row.op),op=rawOp.replace(/\D/g,''),code=text(row.code),validOp=!rawOp||/^\d{8,15}$/.test(op);
      var material=(catalog||[]).find(function(item){return text(item.code)===code;});
      var quantity=Number(row.quantity);
      if(!validOp)issues.push(label+': número da OP inválido.');
      if(!material)issues.push(label+': código de matéria-prima não encontrado no catálogo.');
      else if(score(row.description,material.description,polymer).score<0)issues.push(label+': código '+code+' incompatível com a especificação da ficha.');
      if(!Number.isFinite(quantity)||quantity<=0)issues.push(label+': consumo não calculado; confira fórmula e quantidade.');
      if(material&&validOp&&Number.isFinite(quantity)&&quantity>0){
        lines.push({op:op,code:code,description:material.description,quantity:quantity,unit:row.unit==='MT'?'MT':'KG',label:label,formula:text(row.formula)});
      }
    });
    if(!draft||!draft.length)issues.push('Nenhuma matéria-prima de corte foi identificada.');
    return {ok:issues.length===0,issues:issues,lines:lines};
  }
  function request(record,lines,user,now){
    var id='REQ-CUT-'+record.id,ap=text(record.ap),lot=text(record.lot),when=new Date(now),ops=Array.from(new Set(lines.map(function(line){return line.op;}).filter(Boolean)));
    return {id:id,numero:'CORTE-AP'+ap+'-'+(ops[0]||text(record.id).slice(-8)),op:ops.join(', '),source_cut_op_id:record.id,source_cut_ap:ap,
      data:now.slice(0,10),hora:when.toTimeString().slice(0,5),turno:'Produção',solicitante:user,setor:'Corte',setor_operacional:'CORTE',
      status:'pendente',selecao_corte_requerida:true,liberada_logistica:false,prioridade:'normal',observacoes:'Requisição automática da OP AP '+ap+' · lote '+lot+' · '+record.quantity+' peças.',
      operador_logistica:'',created_date:now,updated_date:now,
      itens:lines.map(function(line,index){return {id:id+'-'+index,op:line.op,codigo:line.code,material:line.description,
        maquina:'',etapa_corte:line.label,prioridade_logistica:'normal',liberado_logistica:false,quantidade_calculada:line.quantity,quantidade:roundRequestQuantity(line.quantity),unidade:line.unit,quantidade_separada:0,separado:false,entrega_parcial:false,falta_material:false};}),
      historico:[{ts:now,acao:'Requisição criada pelo PCP',usuario:user,detalhe:lines.length+' etapa(s) da ficha AP '+ap+' · pendente de escolha dos materiais pelo corte'}]};
  }
  function releaseRequest(request,choices,user,now){
    if(!request||!Array.isArray(request.itens)||!request.itens.length)throw new Error('Requisição de corte incompleta.');
    if(!['aguardando_corte','pendente','em_separacao','pausado'].includes(text(request.status).toLowerCase()))throw new Error('Esta requisição não aceita novos materiais.');
    if(!Array.isArray(choices)||choices.length!==request.itens.length)throw new Error('Confira a lista de materiais da OP.');
    var ranks={normal:0,urgente:1,critico:2},max=0;
    var items=request.itens.map(function(item,index){var choice=choices[index]||{},machine=text(choice.maquina),priority=text(choice.prioridade).toLowerCase();
      if(Number(item.quantidade_separada)>0){max=Math.max(max,ranks[item.prioridade_logistica]||0);return Object.assign({},item,{liberado_logistica:true});}
      if(!choice.selected){if(item.liberado_logistica){max=Math.max(max,ranks[item.prioridade_logistica]||0);return item;}return Object.assign({},item,{liberado_logistica:false});}
      if(!machine||machine.length>80)throw new Error('Escolha uma máquina válida para '+(item.etapa_corte||item.material||'o item')+'.');
      if(!Object.prototype.hasOwnProperty.call(ranks,priority))throw new Error('Escolha a prioridade de '+(item.etapa_corte||item.material||'o item')+'.');
      var urgent=priority==='urgente'||priority==='critico',oldAlert=request.alerta_logistica||{},wasUrgent=(ranks[item.prioridade_logistica]||0)>0;
      var key=text(item.codigo||item.material),oldMachine=text(item.maquina),legacy=wasUrgent?(Array.isArray(request.historico)?request.historico:[]).filter(function(entry){return /Urgência do item/i.test(text(entry.acao))&&text(entry.detalhe).indexOf(key+' · ')===0&&(!oldMachine||text(entry.detalhe).includes(' · '+oldMachine+' · '));}).map(function(entry){return entry.ts;}).filter(Boolean).sort()[0]||'':'';
      var existingTime=text(item.urgencia_solicitada_em),choiceTime=text(choice.urgencia_solicitada_em),firstTime=existingTime&&choiceTime&&Date.parse(choiceTime)<Date.parse(existingTime)?choiceTime:(existingTime||choiceTime);
      var requestedAt=urgent?(firstTime||legacy||(wasUrgent&&String(oldAlert.item_id)===String(item.id)?oldAlert.enviado_em:'')||(wasUrgent?request.liberada_em:'')||now):'';
      max=Math.max(max,ranks[priority]);return Object.assign({},item,{maquina:machine,prioridade_logistica:priority,urgencia_solicitada_em:requestedAt,liberado_logistica:true});});
    var selected=items.filter(function(item){return item.liberado_logistica;});
    if(!selected.length)throw new Error('Selecione pelo menos um material para a logística.');
    var priority=max===2?'critico':max===1?'urgente':'normal',history=Array.isArray(request.historico)?request.historico.slice():[];
    history.push({ts:now,acao:'Corte escolheu materiais para a logística',usuario:user,detalhe:selected.length+' de '+items.length+' material(is) · prioridade '+priority});
    var status=text(request.status).toLowerCase()==='aguardando_corte'?'pendente':request.status;
    return Object.assign({},request,{itens:items,status:status,selecao_corte_requerida:true,liberada_logistica:true,prioridade:priority,liberada_em:now,liberada_por:user,updated_date:now,historico:history});
  }
  function productionQuantity(record,line,index){
    var total=Number(record&&record.quantity),sheet=record&&record.sheet||{},rows=sheet.rows||[];
    var same=function(value){return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');};
    var op=text(line.op).replace(/\D/g,''),label=same(line.label);
    var exact=Number(op&&sheet.operationQuantities&&sheet.operationQuantities[op]);
    if(Number.isFinite(exact)&&exact>0)return Number.isFinite(total)&&total>0&&Number(sheet.quantity)>0?exact*total/Number(sheet.quantity):exact;
    var row=(op&&rows.find(function(item){return text(item.op).replace(/\D/g,'')===op;}))
      ||rows.find(function(item){return same(item.label)===label;});
    var multiplier=Number(row&&row.piecesPerBag);
    return Number.isFinite(total)&&total>0?total*(Number.isFinite(multiplier)&&multiplier>0?multiplier:1):0;
  }
  function romaneio(record,lines,user,now){
    var lot=text(record.lot),destination=text(record.client);
    var planned=lines.map(function(line,index){var quantity=productionQuantity(record,line,index);return {num:String(index+1),etiqueta:'',descricao:line.label,
        codigo:'',codigoMateriaPrima:line.code,materialDescricao:line.description,op:line.op,qtd:quantity?String(quantity):'',qtdNum:quantity,unidade:'UN',lote:lot,destino:destination,
        feito:0,tags:[],status:'pendente',manualTag:false,isNew:false};});
    return {id:'EXP-CUT-'+record.id,meta:{loteMain:lot,destMain:destination,resp:user,dataRom:now.slice(0,10),dataEmb:'',source:'cut-op',sourceCutOpId:record.id,sourceCutAp:record.ap,sourceOperations:(record.operations||[]).map(function(value){return text(value).replace(/\D/g,'');}).filter(Boolean),productionTargets:planned.map(function(item){return {num:item.num,op:item.op,label:item.descricao,quantity:item.qtdNum,unit:'UN',materialCode:item.codigoMateriaPrima,materialDescription:item.materialDescricao};})},
      items:planned,
      _upd:Date.parse(now),_synced:false,_audit:[{id:'AUD-CUT-'+record.id,at:now,romaneio:'EXP-CUT-'+record.id,usuario:user,
        acao:'romaneio_criado_da_op',detalhe:lines.length+' itens produzidos da OP AP '+record.ap+' · '+record.quantity+' peças.'}]};
  }
  return {validate:validate,request:request,releaseRequest:releaseRequest,romaneio:romaneio,productionQuantity:productionQuantity,roundRequestQuantity:roundRequestQuantity};
});
