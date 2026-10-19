/* UID real -> embalagem. As credenciais do WMS ficam somente em memória. */
(function(root){
  'use strict';
  function validUid(uid){return typeof uid==='string'&&/^(04|53)[A-F0-9]{12}$/.test(uid);}
  function validBinding(record){return !!record&&validUid(record.uid)&&typeof record.item==='string'&&/^[A-Za-z0-9._/-]{1,32}$/.test(record.item)&&typeof record.binding_id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(record.binding_id);}
  function createClient(options){
    async function request(action,uid,item,signal,extra){
      if(action!=='list'&&!validUid(uid))throw new Error('UID NFC de sete bytes inválido.');
      if(action==='bind'&&(typeof item!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(item)))throw new Error('Embalagem inválida.');
      var auth=options.auth();
      if(!auth||typeof auth.u!=='string'||typeof auth.p!=='string'||!auth.u||!auth.p)throw new Error('Entre novamente no WMS para usar o cadastro NFC.');
      var response=await options.fetch('/api/nfc-tags',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',signal:signal,
        body:JSON.stringify({action:action,uid:uid,item:item,...extra,auth:{u:auth.u,p:auth.p}})});
      var reply=await response.json().catch(function(){return null;});
      if(!response.ok||!reply||reply.ok!==true)throw new Error(reply&&reply.error||'O serviço NFC não confirmou a operação.');
      var data=reply.data;
      if(action==='list'){
        if(!data||!Array.isArray(data.rows)||data.rows.length>20||typeof data.hasMore!=='boolean'||data.rows.some(record=>!validBinding(record)))throw new Error('A lista de vínculos NFC está inválida. Atualize a página.');
        return data;
      }
      if(action==='unbind'){
        if(!validBinding(data)||data.uid!==uid||data.item!==item||data.binding_id!==extra.bindingId||data.unlinked!==true||typeof data.available!=='boolean')throw new Error('A desvinculação não foi confirmada. Consulte a lista antes de repetir.');
        return data;
      }
      if(!data||data.uid!==uid||typeof data.item!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(data.item)||(action==='bind'&&data.item!==item))throw new Error('O cadastro NFC respondeu com um vínculo diferente do solicitado.');
      return data;
    }
    return {lookup:function(uid,signal){return request('lookup',uid,undefined,signal);},bind:function(uid,item,signal){return request('bind',uid,item,signal);},
      list:function(search,offset){search=String(search||'').trim();offset=offset||0;if(search&&!/^[A-Za-z0-9._/-]{1,32}$/.test(search)||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new Error('Busque pelo ID da etiqueta ou pelo UID do chip.');return request('list',undefined,undefined,undefined,{search:search,offset:offset});},
      unbind:function(record){if(!validBinding(record))throw new Error('Consulte o vínculo novamente antes de desvincular.');return request('unbind',record.uid,record.item,undefined,{bindingId:record.binding_id});}};
  }
  if(typeof module==='object'&&module.exports){module.exports={createClient:createClient,validUid:validUid};return;}
  var client=createClient({fetch:root.fetch.bind(root),auth:function(){
    var user=typeof session!=='undefined'&&session?session.u:null,auth=root._fiscalAuth;
    return user&&auth&&auth.u===user?auth:null;
  }});
  root.PackemNfcRegistry={bind:client.bind,lookup:client.lookup,list:client.list,unbind:client.unbind,resolve:async function(uid,context){
    if(!context.isActive())throw new Error('A sessão de contagem mudou.');
    var record=await client.lookup(uid);
    if(!context.isActive())throw new Error('A sessão de contagem mudou.');
    return (await root.WmsNfcPrepare.prepare(record.item,context)).tag;
  }};
})(typeof window!=='undefined'?window:globalThis);
