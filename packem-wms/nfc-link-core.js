(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PackemNfcLinkCore=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var KEY='packem-nfc-link-v1',TTL=15*60*1000;
  function normalizeCode(value){
    if(typeof value!=='string')throw new Error('Informe o código da etiqueta.');
    var code=value.trim();
    if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(code))throw new Error('Use o código da etiqueta do WMS: até 128 letras, números, ponto, hífen, barra ou sublinhado.');
    return code;
  }
  function parseFragment(hash){
    if(!hash||hash==='#')return null;
    if(typeof hash!=='string'||hash.length>1600)throw new Error('Link NFC inválido ou muito longo.');
    var params=new URLSearchParams(hash.replace(/^#/,'')),keys=Array.from(params.keys());
    if(keys.length!==1||keys[0]!=='etiqueta')throw new Error('Este link precisa conter somente o código da etiqueta.');
    return normalizeCode(params.get('etiqueta'));
  }
  function buildURL(base,code){
    var url=new URL('nfc.html',base);
    if(url.protocol!=='https:'||url.username||url.password)throw new Error('Abra a versão HTTPS do WMS para gerar um link de etiqueta.');
    url.search='';url.hash='etiqueta='+encodeURIComponent(normalizeCode(code));
    return url.href;
  }
  function createInbox(storage,now){
    now=now||Date.now;var memory=null;
    function clear(){memory=null;try{storage.removeItem(KEY);}catch(_){}}
    function read(){
      var raw=memory;
      try{raw=storage.getItem(KEY)||memory;}catch(_){}
      if(!raw)return null;
      try{
        var value=JSON.parse(raw),at=value.at;
        if(!Number.isFinite(at)||at>now()+5000||now()-at>=TTL)throw new Error('expired');
        return {code:normalizeCode(value.code),at:at};
      }catch(_){clear();return null;}
    }
    function capture(hash){
      if(!hash||hash==='#')return {status:'none'};
      try{
        var code=parseFragment(hash),value={code:code,at:now()};
        memory=JSON.stringify(value);
        try{storage.setItem(KEY,memory);}catch(_){}
        return {status:'received',code:code};
      }catch(error){clear();return {status:'error',message:error.message};}
    }
    return {read:read,capture:capture,clear:clear};
  }
  return {normalizeCode:normalizeCode,parseFragment:parseFragment,buildURL:buildURL,createInbox:createInbox,storageKey:KEY,ttl:TTL};
});
