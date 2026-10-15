(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BobLotCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function text(value){return String(value==null?'':value).trim();}
  function tag(value){return text(value).toUpperCase();}
  function op(value){return text(value).replace(/\D/g,'');}
  function lot(value){
    var valueText=text(value),normalized=valueText.toUpperCase().replace(/[^A-Z0-9]/g,'');
    return !normalized||/^(?:PACKEMSA|PACKEM|NAOINFORMADO|SEML0TE|SEMLOTE|LOTE|NAN)$/.test(normalized)?'':valueText;
  }
  function lotStem(value){var match=lot(value).match(/^(\d+\.\d+)(?:\/\d{2})?$/);return match?match[1].toUpperCase():'';}
  function idForLot(value){
    var s=lot(value).toUpperCase(),hash=2166136261;
    for(var i=0;i<s.length;i++){hash^=s.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return 'BOB-LOTE-'+(hash>>>0).toString(36);
  }
  function group(rows){
    var seen={},groups={},missing=0,conflicts=[];
    (rows||[]).forEach(function(row){
      var et=tag(row.et),code=text(row.pr),lote=lot(row.lote);
      if(!et||!code)return;
      if(seen[et]){
        if(seen[et].lote!==lote||seen[et].pr!==code||seen[et].op!==op(row.op))conflicts.push(et);
        return;
      }
      var entry={et:et,pr:code,desc:text(row.desc),pl:Number(row.pl)||0,lote:lote,sourceLote:lot(row.sourceLote),op:op(row.op)};
      seen[et]=entry;
      if(!lote){missing++;return;}
      var key=lote.toUpperCase();
      if(!groups[key])groups[key]={lote:lote,rows:[]};
      groups[key].rows.push(entry);
    });
    return {groups:Object.keys(groups).map(function(key){return groups[key];}),missingLot:missing,conflicts:conflicts};
  }
  function expItem(row,num){
    return {num:String(num),etiqueta:tag(row.et),descricao:text(row.desc)||text(row.pr),codigo:text(row.pr),qtd:row.pl>0?String(row.pl):'',qtdNum:Number(row.pl)||0,lote:lot(row.lote),loteOrigem:lot(row.sourceLote),op:op(row.op),origin:'bobinas',destino:'',feito:0,tags:[],status:'pendente',manualTag:false,isNew:false};
  }
  function appendItems(existing,rows,blocked){
    var items=Array.isArray(existing)?existing.slice():[],known={};
    items.forEach(function(item){known[tag(item.etiqueta)]=true;});
    var used={};items.forEach(function(item){used[String(item.num)]=true;});
    var next=1,added=0,skipped=0;
    (rows||[]).forEach(function(row){
      var et=tag(row.et);
      if(known[et]||blocked&&blocked.has(et)){skipped++;return;}
      while(used[String(next)])next++;
      items.push(expItem(row,next));used[String(next)]=true;known[et]=true;next++;added++;
    });
    return {items:items,added:added,skipped:skipped};
  }
  function latestBatch(catalog){
    var latest='',rows=[];
    Object.keys(catalog||{}).forEach(function(et){
      var item=catalog[et]||{},at=text(item.apAt),lote=lot(item.lote);
      if(!at||(!lote&&!op(item.op))||!text(item.pr))return;
      if(at>latest){latest=at;rows=[];}
      if(at===latest)rows.push({et:et,pr:item.pr,desc:item.desc,pl:item.pl,lote:lote,op:op(item.op)});
    });
    return {at:latest,rows:rows,groups:group(rows).groups.length};
  }
  function matchCutOp(rows,record){
    var allowed=new Set((record&&record.items||[]).map(function(item){return op(item.op);}).concat((record&&record.meta&&record.meta.sourceOperations||[]).map(op)).filter(Boolean));
    return (rows||[]).filter(function(row){return !!op(row.op)&&allowed.has(op(row.op));});
  }
  function replaceCutPlaceholders(record){
    if(!record||!record.meta||record.meta.source!=='cut-op')return {record:record,replaced:0};
    var items=(record.items||[]).slice(),meta=Object.assign({},record.meta),targets=(meta.productionTargets||[]).slice();
    items.filter(function(item){return !item.etiqueta;}).forEach(function(item){
      if(targets.some(function(target){return String(target.num)===String(item.num);}))return;
      targets.push({num:String(item.num),op:op(item.op),label:text(item.descricao),quantity:Number(item.qtdNum)||0,unit:'UN',materialCode:text(item.codigoMateriaPrima||item.codigo),materialDescription:text(item.materialDescricao)});
    });
    var labelsByOp={};
    items.filter(function(item){return item.etiqueta&&(item.origin==='bobinas'||item.loteOrigem)&&op(item.op);}).forEach(function(item){
      var number=op(item.op);(labelsByOp[number]||(labelsByOp[number]=[])).push(item);
    });
    var removed=new Set(),replaced=0;
    Object.keys(labelsByOp).forEach(function(number){
      var matchingTargets=targets.filter(function(target){return op(target.op)===number;});
      if(matchingTargets.length!==1)return;
      var target=matchingTargets[0],planned=Number(target.quantity)||0;
      if(planned<=0)return;
      var placeholders=items.filter(function(item){return !item.etiqueta&&op(item.op)===number;});
      if(placeholders.length>1)return;
      var placeholder=placeholders[0];
      if(placeholder&&(placeholder.status!=='pendente'||Number(placeholder.feito)>0||(placeholder.tags||[]).length||placeholder.forceDone))return;
      if(placeholder){removed.add(placeholder);replaced++;}
    });
    items=items.filter(function(item){return !removed.has(item);}).map(function(item){
      if(!item.etiqueta||!(item.origin==='bobinas'||item.loteOrigem)||!op(item.op))return item;
      var target=targets.find(function(entry){return op(entry.op)===op(item.op);});
      return Object.assign({},item,{unidade:'UN',quantitySource:'apontamento',targetQuantity:target?Number(target.quantity)||0:0,targetLabel:target?text(target.label):''});
    });
    items.sort(function(a,b){return Number(a.num)-Number(b.num);});
    meta.productionTargets=targets;
    return {record:Object.assign({},record,{meta:meta,items:items}),replaced:replaced};
  }
  return {group:group,idForLot:idForLot,expItem:expItem,appendItems:appendItems,latestBatch:latestBatch,lot:lot,lotStem:lotStem,op:op,matchCutOp:matchCutOp,replaceCutPlaceholders:replaceCutPlaceholders};
});
