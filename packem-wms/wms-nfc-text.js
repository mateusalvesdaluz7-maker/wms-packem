/* Texto NDEF da etiqueta WMS, recebido por um leitor nativo autorizado. */
(function(root){
  'use strict';
  function quantity(value){
    if(typeof value!=='string'||!/^\d{1,9}(?:[.,]\d{1,6})?$/.test(value)||!/[1-9]/.test(value))throw new Error('Quantidade da tag invalida.');
    var parts=value.replace(',','.').split('.'),fraction=(parts[1]||'').replace(/0+$/,'');
    return parts[0].replace(/^0+(?=\d)/,'')+(fraction?'.'+fraction:'');
  }
  function parseText(text){
    if(typeof text!=='string'||new TextEncoder().encode(text).length>120)throw new Error('Use uma etiqueta WMS com ate 120 bytes de texto.');
    var fields=Object.create(null),allowed=['JOB','ID','COD','QTD','UN','PLG'];
    for(var part of text.split(';')){
      var match=/^([A-Z]+)=([^;=]+)$/.exec(part);
      if(!match||!allowed.includes(match[1])||fields[match[1]]!==undefined)throw new Error('A tag nao contem os campos unicos da etiqueta WMS.');
      fields[match[1]]=match[2];
    }
    if(!/^[A-Za-z0-9-]{1,36}$/.test(fields.JOB||''))throw new Error('Lote NFC ausente ou invalido.');
    for(var key of ['ID','COD'])if(!/^[A-Za-z0-9._/-]{1,32}$/.test(fields[key]||''))throw new Error('ID ou codigo da tag invalido.');
    var amount,unit;
    if(fields.PLG!==undefined){
      if(fields.QTD!==undefined||fields.UN!==undefined||!/^\d{1,10}$/.test(fields.PLG)||BigInt(fields.PLG)<1n||BigInt(fields.PLG)>1000000000n)throw new Error('Peso em gramas da tag invalido.');
      var grams=BigInt(fields.PLG),fraction=String(grams%1000n).padStart(3,'0').replace(/0+$/,'');
      amount=String(grams/1000n)+(fraction?'.'+fraction:'');unit='KG';
    }else{
      amount=quantity(fields.QTD);unit=fields.UN;
      if(!['KG','G','MT','UN','L','ML','M2','M3'].includes(unit))throw new Error('Unidade da tag invalida.');
    }
    return {item:fields.ID,codigo:fields.COD,quantidade:amount,unidade:unit,job:fields.JOB};
  }
  var api={parseText:parseText};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WmsNfcText=api;
})(typeof window!=='undefined'?window:globalThis);
