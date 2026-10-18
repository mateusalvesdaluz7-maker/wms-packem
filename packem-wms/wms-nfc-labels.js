/* Consulta as etiquetas existentes sem criar recebimento ou movimentar estoque. */
(function(root){
  'use strict';
  function normalize(record,unitFor){
    if(!record)return null;
    var receiving=Object.prototype.hasOwnProperty.call(record,'kg');
    var code=String(receiving?(record.cProd||record.c_prod||record.bobina||record.nRomaneio||''):(record.pr||''));
    var amount=receiving?record.kg:record.pl,raw=String(amount==null?'':amount).replace(',','.');
    var explicit=record.uCom||record.u_com||record.unidade||record.un||record.u;
    var unit=String(explicit||(typeof unitFor==='function'?unitFor(code):'')||'').trim().toUpperCase();
    if(['M','MTS','METRO','METROS'].includes(unit))unit='MT';
    if(['KGS','QUILO','QUILOS'].includes(unit))unit='KG';
    if(['UND','UNID','UNIDADE','PC'].includes(unit))unit='UN';
    if(!/^[A-Za-z0-9._/-]{1,32}$/.test(code)||!/^\d{1,9}(?:\.\d{1,6})?$/.test(raw)||Number(raw)<=0||!['KG','G','MT','UN','L','ML','M2','M3'].includes(unit))return null;
    return {codigo:code,descricao:String(receiving?(record.xProd||record.gramatura||''):(record.desc||'')),quantidade:Number(raw),unidade:unit};
  }
  function recordFor(id,sources,stage){
    if(Object.prototype.hasOwnProperty.call(sources.etq||{},id))return sources.etq[id];
    if(stage)return Object.assign({},(sources.bob||{})[id]||{},stage);
    return (sources.bob||{})[id]||null;
  }
  function* rows(sources,unitFor){
    sources=sources||{};var stage=new Map(),seen=new Set();
    (sources.stage||[]).forEach(function(record){if(record&&record.et)stage.set(String(record.et),record);});
    for(var collection of [stage.keys(),Object.keys(sources.etq||{}),Object.keys(sources.bob||{})])for(var id of collection){
      if(seen.has(id))continue;seen.add(id);
      if(!/^[A-Za-z0-9._/-]{1,32}$/.test(id))continue;
      var record=recordFor(id,sources,stage.get(id)),item=normalize(record,unitFor);if(!item)continue;
      var label=(sources.etq||{})[id],received=stage.has(id),manual=label&&label.nf==='__vaga__';
      yield Object.assign({id:id,recebimento:received||!!label&&!manual,origem:received?'Recebimento':label?(manual?'Etiqueta manual':'NF / romaneio'):'Catálogo de bobinas',documento:String(label&&(label.nNF||label.nRomaneio)||'')},item);
    }
  }
  async function lookup(id,sources,unitFor,fetcher){
    sources=sources||{};
    var stage=(sources.stage||[]).find(function(record){return record&&record.et===id;});
    var record=recordFor(id,sources,stage);
    if(record||Object.prototype.hasOwnProperty.call(sources.etq||{},id))return normalize(record,unitFor);
    return typeof fetcher==='function'?normalize(await fetcher(id),unitFor):null;
  }
  function sources(){
    var state=typeof root.nfGetState==='function'?root.nfGetState():null;
    return {bob:typeof BOB!=='undefined'?BOB:{},etq:state&&state.ETQ||root.ETQ||{},stage:typeof STAGE!=='undefined'?STAGE:[]};
  }
  var api={normalize:normalize,rows:rows,lookup:lookup,sources:sources};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{api.lookupCurrent=function(id){return lookup(id,sources(),typeof unitOf==='function'?unitOf:null,root.bobFetch);};root.WmsNfcLabels=api;}
})(typeof window!=='undefined'?window:globalThis);
