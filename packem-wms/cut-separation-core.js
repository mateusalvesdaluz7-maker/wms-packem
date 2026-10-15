(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CutSeparationCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function operationNumbers(value){return String(value==null?'':value).match(/\d{8,}/g)||[];}
  function matches(request,operations){
    var wanted=new Set((operations||[]).flatMap(operationNumbers));
    if(!wanted.size||!request)return false;
    var reference=String(request.op||'').trim();
    var legacy=String(request.observacoes||request.obs||'').match(/\bOPs?\s*:?\s*([\d,;\s]+)/i);
    var candidates=reference?operationNumbers(reference):operationNumbers(request.numero||request.num).concat(legacy?operationNumbers(legacy[1]):[]);
    return candidates.some(function(number){return wanted.has(number);});
  }
  function requestProgress(request){
    var items=Array.isArray(request.itens)?request.itens:(Array.isArray(request.items)?request.items:[]);
    var completion=0,complete=0,valid=0;
    items.forEach(function(item){
      var quantity=Number(item.quantidade!=null?item.quantidade:item.qtd)||0;
      var done=Number(item.quantidade_separada!=null?item.quantidade_separada:item.delivered)||0;
      if(quantity<=0)return;
      valid++;
      completion+=Math.min(1,Math.max(0,done)/quantity);
      if(done>=quantity)complete++;
    });
    return {id:String(request.id||''),number:String(request.numero||request.num||request.op||''),status:String(request.status||'pendente').toLowerCase(),percent:valid?Math.round(completion/valid*100):0,complete:complete,items:valid};
  }
  function summarize(operations,requests,sourceId){
    var linkedRecords=(Array.isArray(requests)?requests:[]).filter(function(request){
      if(sourceId&&request&&request.source_cut_op_id)return String(request.source_cut_op_id)===String(sourceId);
      return matches(request,operations);
    });
    var linked=linkedRecords.map(requestProgress);
    var active=linked.filter(function(request){return request.status!=='cancelado';});
    var completed=active.reduce(function(sum,request){return sum+request.complete;},0);
    var count=active.reduce(function(sum,request){return sum+request.items;},0);
    var percent=count?Math.round(active.reduce(function(sum,request){return sum+request.percent*request.items;},0)/count):active.length?0:null;
    var units={},bippedLabels=0,seenLabels=new Set(),scanFractions=0,scanItems=0;
    linkedRecords.filter(function(request){return String(request.status||'').toLowerCase()!=='cancelado';}).forEach(function(request){
      var items=Array.isArray(request.itens)?request.itens:(Array.isArray(request.items)?request.items:[]);
      items.forEach(function(item){
        var unit=String(item.unidade||item.unit||'UN').toUpperCase();if(unit==='M')unit='MT';
        var totals=units[unit]||(units[unit]={requested:0,separated:0,bipped:0});
        var requested=Math.max(0,Number(item.quantidade!=null?item.quantidade:item.qtd)||0),bippedForItem=0;
        totals.requested+=requested;
        totals.separated+=Math.max(0,Number(item.quantidade_separada!=null?item.quantidade_separada:item.delivered)||0);
        (Array.isArray(item.fifo_etiquetas)?item.fifo_etiquetas:[]).forEach(function(scan){
          var tag=String(typeof scan==='string'?scan:scan&&scan.et||'').trim().toUpperCase();
          if(!tag||seenLabels.has(tag))return;seenLabels.add(tag);bippedLabels++;
          var amount=Math.max(0,Number(scan&&scan.q)||0);totals.bipped+=amount;bippedForItem+=amount;
        });
        if(requested>0){scanItems++;scanFractions+=Math.min(1,bippedForItem/requested);}
      });
    });
    return {linked:linked.length>0,percent:percent,requests:linked,complete:completed,items:count,units:units,bippedLabels:bippedLabels,bippedPercent:scanItems?Math.round(scanFractions/scanItems*100):active.length?0:null};
  }
  function urgentForOp(op,requests){
    if(!op)return [];
    return (Array.isArray(requests)?requests:[]).filter(function(request){
      if(!request||String(request.status||'').toLowerCase()==='cancelado')return false;
      if(request.source_cut_op_id)return String(request.source_cut_op_id)===String(op.id);
      return matches(request,op.operations||[]);
    }).flatMap(function(request){
      var items=Array.isArray(request.itens)?request.itens:(Array.isArray(request.items)?request.items:[]);
      return items.filter(function(item){return ['urgente','critico'].includes(String(item.prioridade_logistica||'').toLowerCase());}).map(function(item){
        var key=String(item.codigo||item.material||''),machine=String(item.maquina||''),history=(Array.isArray(request.historico)?request.historico:[]).filter(function(entry){return /Urgência do item/i.test(String(entry.acao||''))&&String(entry.detalhe||'').indexOf(key+' · ')===0;});
        var exact=history.filter(function(entry){return !machine||String(entry.detalhe||'').includes(' · '+machine+' · ');}),legacy=(exact.length?exact:history).map(function(entry){return entry.ts;}).filter(Boolean).sort()[0]||'';
        var alert=request.alerta_logistica||{},fallback=String(alert.item_id||'')===String(item.id||'')?alert.enviado_em:'';
        return {id:String(item.id||''),stage:String(item.etapa_corte||''),machine:machine,code:String(item.codigo||''),material:String(item.material||''),priority:String(item.prioridade_logistica).toLowerCase(),requestNumber:String(request.numero||''),requestedAt:String(item.urgencia_solicitada_em||legacy||fallback||request.liberada_em||request.created_date||'')};
      });
    }).sort(function(a,b){var x=Date.parse(a.requestedAt),y=Date.parse(b.requestedAt);return (isFinite(x)?x:Number.MAX_SAFE_INTEGER)-(isFinite(y)?y:Number.MAX_SAFE_INTEGER);});
  }
  function buildDraft(sheet,entries,cutCore){
    var pieces=Number(sheet&&sheet.quantity)||0;
    return (entries||[]).flatMap(function(entry){
      var rows=entry.group.rows||[],unit=entry.unit==='MT'?'MT':'KG';
      var measures=rows.map(function(row){var value=cutCore.consumption(row);return unit==='MT'?value.metresPerBag:value.kgPerBag;});
      var total=measures.reduce(function(sum,value){return sum+(Number(value)||0);},0);
      var target=entry.manualPerBag!==null&&Number.isFinite(entry.manualPerBag)?entry.manualPerBag:total;
      return rows.map(function(row,index){
        var base=Number(measures[index])||0,share=total>0?base/total:1/rows.length;
        return {op:String(row.op||''),label:String(row.label||''),description:String(entry.group.description||row.description||''),code:String(entry.code||''),quantity:Math.round(target*share*pieces*1000000)/1000000,unit:unit,formula:cutCore.consumption(row).formula||'',verified:!!entry.verified,suggestions:(entry.candidates||[]).slice(0,6).map(function(candidate){return {code:candidate.code,description:candidate.description};})};
      });
    });
  }
  return {operationNumbers:operationNumbers,matches:matches,requestProgress:requestProgress,summarize:summarize,urgentForOp:urgentForOp,buildDraft:buildDraft};
});
