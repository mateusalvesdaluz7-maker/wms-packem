(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CutExpeditionCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function itemSeparated(item){
    if(item.etiqueta)return item.status==='separado'||item.status==='conferido';
    return !!item.forceDone||(Number(item.qtdNum)>0&&Number(item.feito)>=Number(item.qtdNum)-0.001);
  }
  function itemConfirmed(item){
    if(item.etiqueta)return item.status==='conferido';
    if(item.forceDone)return true;
    var tags=Array.isArray(item.tags)?item.tags:[];
    return Number(item.qtdNum)>0&&Number(item.feito)>=Number(item.qtdNum)-0.001&&tags.length>0&&tags.every(function(tag){return !!tag.conf;});
  }
  function summarize(record){
    if(!record||record._del)return {linked:false,percent:null,total:0,separated:0,confirmed:0,status:'Sem romaneio'};
    if(record.cancelado)return {linked:true,percent:null,total:0,separated:0,confirmed:0,status:'Cancelado'};
    var items=Array.isArray(record.items)?record.items:[],total=items.length;
    if(!total)return {linked:false,percent:null,total:0,separated:0,confirmed:0,status:'Sem romaneio'};
    var separated=items.filter(itemSeparated).length,confirmed=items.filter(itemConfirmed).length;
    return {linked:true,percent:Math.round(confirmed/total*100),total:total,separated:separated,confirmed:confirmed,status:confirmed===total?'Conferido':confirmed||separated?'Em andamento':'Pendente'};
  }
  function quantities(record){
    if(!record||record._del||record.cancelado)return {linked:false,planned:0,produced:0,scanned:0,confirmed:0,producedPercent:null,scannedPercent:null,confirmedPercent:null,producedLabels:0,scannedLabels:0};
    var items=Array.isArray(record.items)?record.items:[],targets=record.meta&&Array.isArray(record.meta.productionTargets)?record.meta.productionTargets:[];
    var planned=targets.reduce(function(sum,target){return sum+Math.max(0,Number(target.quantity)||0);},0);
    if(!planned)planned=items.filter(function(item){return !item.etiqueta;}).reduce(function(sum,item){return sum+Math.max(0,Number(item.qtdNum)||0);},0);
    var produced=0,scanned=0,confirmed=0,producedLabels=0,scannedLabels=0,seen=new Set();
    items.forEach(function(item){
      var label=String(item.etiqueta||'').trim().toUpperCase(),quantity=Math.max(0,Number(item.qtdNum)||0);
      if(label){
        if(seen.has(label))return;seen.add(label);
        if(item.quantitySource==='apontamento'||item.origin==='bobinas'||item.loteOrigem){produced+=quantity;producedLabels++;}
        if(item.status==='separado'||item.status==='conferido'){scanned+=quantity;scannedLabels++;}
        if(item.status==='conferido')confirmed+=quantity;
      }else{
        var tags=Array.isArray(item.tags)?item.tags:[];
        scanned+=Math.max(0,Number(item.feito)||0);
        confirmed+=tags.reduce(function(sum,tag){return sum+(tag.conf?Math.max(0,Number(tag.q)||0):0);},0);
        scannedLabels+=tags.length;
      }
    });
    if(!planned)planned=produced;
    return {linked:items.length>0,planned:planned,produced:produced,scanned:scanned,confirmed:confirmed,
      producedPercent:planned?Math.min(100,Math.round(produced/planned*100)):null,
      scannedPercent:planned?Math.min(100,Math.round(scanned/planned*100)):null,
      confirmedPercent:planned?Math.min(100,Math.round(confirmed/planned*100)):null,
      producedLabels:producedLabels,scannedLabels:scannedLabels};
  }
  function overallProgress(stages){
    function score(value){return Math.max(0,Math.min(100,Number(value)||0));}
    var scores={separation:score(stages&&stages.separation),materialScanned:score(stages&&stages.materialScanned),production:score(stages&&stages.production),productScanned:score(stages&&stages.productScanned),expedition:score(stages&&stages.expedition)};
    return {percent:Math.round(((scores.separation+scores.materialScanned)/2+scores.production+scores.productScanned+scores.expedition)/4),stages:scores};
  }
  function formatDate(value){
    var text=String(value||'').trim(),match=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
    if(match)return match[3]+'/'+match[2]+'/'+match[1];
    match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if(match)return match[1].padStart(2,'0')+'/'+match[2].padStart(2,'0')+'/'+(match[3].length===2?'20'+match[3]:match[3]);
    return '';
  }
  function shipment(scheduleDates,record){
    var fromExp=formatDate(record&&record.meta&&record.meta.dataEmb);
    if(fromExp)return {dates:[fromExp],source:'romaneio'};
    var dates=(Array.isArray(scheduleDates)?scheduleDates:[]).filter(Boolean);
    return {dates:dates,source:dates.length?'programação':''};
  }
  return {itemSeparated:itemSeparated,itemConfirmed:itemConfirmed,summarize:summarize,quantities:quantities,overallProgress:overallProgress,formatDate:formatDate,shipment:shipment};
});
