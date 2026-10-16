/* UID real -> embalagem. As credenciais do WMS ficam somente em memória. */
(function(root){
  'use strict';
  function validUid(uid){return typeof uid==='string'&&/^04[A-F0-9]{12}$/.test(uid);}
  function createClient(options){
    async function request(action,uid,item,signal){
      if(!validUid(uid))throw new Error('UID da NTAG213 inválido.');
      if(action==='bind'&&(typeof item!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(item)))throw new Error('Embalagem inválida.');
      var auth=options.auth();
      if(!auth||typeof auth.u!=='string'||typeof auth.p!=='string'||!auth.u||!auth.p)throw new Error('Entre novamente no WMS para usar o cadastro NFC.');
      var response=await options.fetch('/api/nfc-tags',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',signal:signal,
        body:JSON.stringify({action:action,uid:uid,item:item,auth:{u:auth.u,p:auth.p}})});
      var reply=await response.json().catch(function(){return null;});
      if(!response.ok||!reply||reply.ok!==true)throw new Error(reply&&reply.error||'O serviço NFC não confirmou a operação.');
      var data=reply.data;
      if(!data||data.uid!==uid||typeof data.item!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(data.item)||(action==='bind'&&data.item!==item))throw new Error('O cadastro NFC respondeu com um vínculo diferente do solicitado.');
      return data;
    }
    return {lookup:function(uid,signal){return request('lookup',uid,undefined,signal);},bind:function(uid,item,signal){return request('bind',uid,item,signal);}};
  }
  if(typeof module==='object'&&module.exports){module.exports={createClient:createClient,validUid:validUid};return;}
  var client=createClient({fetch:root.fetch.bind(root),auth:function(){
    var user=typeof session!=='undefined'&&session?session.u:null,auth=root._fiscalAuth;
    return user&&auth&&auth.u===user?auth:null;
  }});
  root.PackemNfcRegistry={bind:client.bind,lookup:client.lookup,resolve:async function(uid,context){
    if(!context.isActive())throw new Error('A sessão de contagem mudou.');
    var record=await client.lookup(uid);
    if(!context.isActive())throw new Error('A sessão de contagem mudou.');
    return (await root.WmsNfcPrepare.prepare(record.item,context)).tag;
  }};
})(typeof window!=='undefined'?window:globalThis);
