(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PackemNfcCore=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function normalizeCode(value,mode){
    mode=mode===undefined?'ndef':mode;
    if(mode!=='ndef'&&mode!=='uid')throw new Error('Modo NFC inválido.');
    if(typeof value!=='string')throw new Error('A leitura NFC deve conter texto.');
    var text=value.trim();
    if(!text||value.length>1024)throw new Error('Conteúdo NFC vazio ou maior que 1024 caracteres.');
    var bytes;
    try{bytes=typeof TextEncoder!=='undefined'?new TextEncoder().encode(value).length:unescape(encodeURIComponent(value)).length;}
    catch(_){throw new Error('O texto NFC tem codificação inválida.');}
    if(bytes>2048)throw new Error('O conteúdo NFC ultrapassa 2048 bytes.');
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f<>\u0060]/.test(text))throw new Error('O conteúdo NFC contém caracteres não permitidos.');
    if(mode==='uid'){
      if(!/^[a-f0-9]{8,32}$/i.test(text)||text.length%2)throw new Error('UID NFC inválido: use de 4 a 16 bytes em hexadecimal.');
      return text.toUpperCase();
    }
    if(/^https?:\/\//i.test(text)){
      var url;
      try{url=new URL(text);}catch(_){throw new Error('O link NFC é inválido.');}
      var values=[];
      ['etiqueta','codigo','code','sku'].forEach(function(key){
        url.searchParams.getAll(key).forEach(function(code){if(code.trim())values.push(code.trim());});
      });
      values=values.filter(function(code,index){return values.indexOf(code)===index;});
      if(values.length!==1)throw new Error(values.length?'O link NFC contém códigos conflitantes.':'O link NFC não informa etiqueta, codigo, code ou sku.');
      if(/^https?:\/\//i.test(values[0]))throw new Error('O código da etiqueta não pode ser outro link.');
      return normalizeCode(values[0],'ndef');
    }
    if(/^[a-z][a-z0-9+.-]*:/i.test(text)&&!/^(COD|VAGA)\s*:/i.test(text))throw new Error('Esse tipo de link não é um código de estoque.');
    return text;
  }
  function createReader(options){
    options=options||{};
    if(typeof options.send!=='function'||typeof options.deliver!=='function')throw new Error('Configure o envio NFC e o destino da leitura.');
    var setTimer=options.setTimer||setTimeout,clearTimer=options.clearTimer||clearTimeout;
    var serial=0,pending=null;
    var timeout=Number.isFinite(options.timeoutMs)&&options.timeoutMs>0?options.timeoutMs:35000;
    function state(status,message,extra){
      if(typeof options.onState==='function'){
        try{options.onState(Object.assign({status:status,message:message},extra||{}));}catch(_){}
      }
    }
    function finish(record){
      if(record.timer!==undefined)clearTimer(record.timer);
      if(pending===record)pending=null;
    }
    function cancelNative(record){try{options.send({action:'cancel',requestId:record.id});}catch(_){}}
    function start(context,settings){
      if(pending){state('busy','Aguarde a leitura ou o processamento atual.');return false;}
      var mode=settings&&settings.mode!==undefined?settings.mode:'ndef';
      if(mode!=='ndef'&&mode!=='uid'){state('error','Modo NFC inválido.');return false;}
      var id;
      try{id=options.makeId?options.makeId():'nfc-'+Date.now().toString(36)+'-'+(++serial);}
      catch(_){state('error','Não foi possível iniciar a leitura NFC.');return false;}
      if(typeof id!=='string'||!id.trim()||id.length>120){state('error','Identificador da leitura NFC inválido.');return false;}
      var record={id:id,context:context,mode:mode,phase:'scanning'};
      pending=record;
      record.timer=setTimer(function(){
        if(pending!==record||record.phase!=='scanning')return;
        finish(record);cancelNative(record);
        state('error','Tempo de leitura encerrado. Toque em NFC para tentar novamente.',{requestId:id});
      },timeout);
      state('scanning','Encoste a parte superior do iPhone na etiqueta.',{requestId:id});
      try{options.send({action:'scan',requestId:id,mode:mode});return true;}
      catch(_){finish(record);state('error','Não foi possível abrir o leitor NFC do app.',{requestId:id});return false;}
    }
    async function receive(payload){
      var record=pending;
      if(!record||record.phase!=='scanning'||!payload||typeof payload!=='object'||payload.requestId!==record.id)return false;
      if(['read','cancelled','error'].indexOf(payload.status)<0)return false;
      clearTimer(record.timer);record.timer=undefined;
      if(payload.status!=='read'){
        finish(record);
        var message=typeof payload.message==='string'&&payload.message.trim()?payload.message.slice(0,400):payload.status==='cancelled'?'Leitura cancelada.':'Não foi possível ler esta etiqueta.';
        state(payload.status==='cancelled'?'cancelled':'error',message,{requestId:record.id});
        return true;
      }
      record.phase='delivering';
      try{
        var code=normalizeCode(payload.text,record.mode);
        var result=await options.deliver(code,record.context,record.mode);
        if(result===false)throw new Error('A leitura não foi aceita pelo campo atual. Confira a tela e tente novamente.');
        state('delivered','Código lido e encaminhado à conferência do WMS.',{requestId:record.id,code:code});
      }catch(error){
        state('error',error&&typeof error.message==='string'?error.message:'Falha ao processar a leitura NFC.',{requestId:record.id});
      }finally{finish(record);}
      return true;
    }
    function cancel(){
      if(!pending||pending.phase!=='scanning')return false;
      var record=pending;finish(record);cancelNative(record);
      state('cancelled','Leitura cancelada.',{requestId:record.id});return true;
    }
    return {start:start,receive:receive,cancel:cancel,isBusy:function(){return pending!==null;}};
  }
  return {normalizeCode:normalizeCode,createReader:createReader};
});
