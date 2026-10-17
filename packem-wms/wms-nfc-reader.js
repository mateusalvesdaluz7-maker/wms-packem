/* Leitura NFC.cool -> estacao -> entrada de contagem existente no WMS. */
(function(root){
  'use strict';
  function validateReading(event){
    if(!event || !Number.isSafeInteger(event.seq) || event.seq<1 || !/^[A-F0-9]{14}$/.test(event.uid||''))throw new Error('Leitura NFC sem sequência ou UID válido.');
    return validateItemReading(event);
  }
  function validateItemReading(event){
    if(!event)throw new Error('Leitura NFC vazia.');
    for(var name of ['item','codigo'])if(typeof event[name]!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(event[name]))throw new Error('Leitura NFC sem identificação válida.');
    if(typeof event.quantidade!=='string' || !/^\d{1,9}(?:\.\d{1,6})?$/.test(event.quantidade) || Number(event.quantidade)<=0 || !['KG','G','MT','UN','L','ML','M2','M3'].includes(event.unidade))throw new Error('Quantidade ou unidade NFC inválida.');
    return event;
  }
  function scaled(value){var parts=String(value).split('.');return BigInt(parts[0])*1000000n+BigInt((parts[1]||'').padEnd(6,'0'));}
  async function applyReading(event,context){
    validateReading(event);
    return applyItemReading(event,context);
  }
  async function applyItemReading(event,context){
    validateItemReading(event);
    if(!context.isActive())throw new Error('Abra a contagem de destino em modo Entrada com seu usuário autenticado.');
    var item=await context.lookup(event.item);
    if(!item || !item.codigo)throw new Error('Etiqueta '+event.item+' não encontrada no cadastro do WMS.');
    var amount=Number(item.quantidade);
    if(String(item.codigo)!==event.codigo || item.unidade!==event.unidade || !Number.isFinite(amount) || amount<=0 || amount>=1e9 || scaled(amount.toFixed(6))!==scaled(event.quantidade))throw new Error('Código, quantidade ou unidade da tag '+event.item+' divergem do cadastro. Confira antes de contar.');
    if(!context.isActive())throw new Error('A tela, o usuário ou o modo de contagem mudou durante a consulta.');
    if(context.has(event.item))return {duplicate:true};
    await context.add(event.item);
    if(!context.has(event.item))throw new Error('O WMS não confirmou a entrada de '+event.item+'. Confira a mensagem da contagem.');
    return {duplicate:false};
  }
  function validReply(event,station,origin,linkId){return event.source===station && event.origin===origin && event.data && event.data.linkId===linkId;}
  if(typeof module==='object' && module.exports){module.exports={validateReading:validateReading,validateItemReading:validateItemReading,applyReading:applyReading,applyItemReading:applyItemReading,validReply:validReply};return;}

  var targets={ 'v-floor':{label:'Chão expedição',mode:'_floorScanMode',has:'floorHasEt',add:'floorAdd'},'v-floor70':{label:'Chão 70',mode:'_f70ScanMode',has:'f70HasEt',add:'floor70Add'},'v-recic':{label:'Recicladora - 91',mode:'_recScanMode',has:'recicHasEt',add:'recicAdd'}};
  var station=null,frame=null,host=null,connected=false,opening=false,busy=false,blocked=false,linkId='',destination='',stationOrigin='',cursor=0;
  var lastNotice='Conecte o NFC.cool para receber ID, código e peso sem copiar.';
  var config={origin:'http://127.0.0.1:8788',token:''};
  function validConfig(value){var url=new URL(value.origin);if(url.origin!==value.origin || !(url.protocol==='https:' || (url.protocol==='http:' && url.hostname==='127.0.0.1')))throw new Error('Use o endereço HTTPS da estação ou 127.0.0.1 neste PC.');if(value.token && !/^[A-Za-z0-9_-]{20,80}$/.test(value.token))throw new Error('Código de leitor inválido.');return {origin:url.origin,token:value.token||''};}
  try{var saved=JSON.parse(sessionStorage.getItem('packem-nfc-reader')||'null');if(saved)config=validConfig(saved);}catch(e){}
  try{
    var hash=new URLSearchParams(location.hash.slice(1)),input=hash.get('nfcReader');
    if(input){if(input.length>2000)throw new Error('Conexão de leitor inválida.');config=validConfig(JSON.parse(input));sessionStorage.setItem('packem-nfc-reader',JSON.stringify(config));hash.delete('nfcReader');history.replaceState(null,'',location.pathname+location.search+(hash.size?'#'+hash:''));}
  }catch(e){console.warn('Configuração de leitor NFC recusada.');}
  function notice(text){lastNotice=text;document.querySelectorAll('[data-nfc-reader-status]').forEach(function(node){node.textContent=text;});}
  function send(type,extra){if(station && !station.closed)station.postMessage(Object.assign({type:type,linkId:linkId},extra||{}),stationOrigin);}
  function activeView(){return (document.querySelector('.view.active')||{}).id;}
  function context(){
    return makeContext(destination,function(){return connected && !blocked;});
  }
  function makeContext(view,enabled){
    var target=targets[view],user=(typeof session!=='undefined' && session)?session.u:null;
    return {
      isActive:function(){return (!enabled||enabled()) && !document.hidden && !!target && !!user && typeof session!=='undefined' && !!session && session.u===user && (root.WmsNfcWorkspace?root.WmsNfcWorkspace.isActive(view):activeView()===view) && root[target.mode]!=='out' && typeof root[target.has]==='function' && typeof root[target.add]==='function';},
      lookup:async function(id){var item=typeof root.bobFetch==='function'?await root.bobFetch(id):null;return item?{codigo:String(item.pr||''),quantidade:item.pl,unidade:typeof unitOf==='function'?unitOf(item.pr):''}:null;},
      has:function(id){return root[target.has](id);},add:function(id){return root[target.add](id);}
    };
  }
  function makeLabelContext(){
    var user=typeof session!=='undefined'&&session?session.u:null;
    return {isActive:function(){return !document.hidden&&!!user&&typeof session!=='undefined'&&!!session&&session.u===user&&(root.WmsNfcWorkspace?root.WmsNfcWorkspace.isActive('v-labels'):activeView()==='v-labels');},
      lookup:async function(id){var item=typeof root.bobFetch==='function'?await root.bobFetch(id):null;return item?{codigo:String(item.pr||''),quantidade:item.pl,unidade:typeof unitOf==='function'?unitOf(item.pr):''}:null;}};
  }
  async function receive(data){
    if(!connected || busy || blocked)return;
    if(data.session?.id!==linkId || data.session?.label!==targets[destination]?.label || !Array.isArray(data.items) || data.items.length>1000){blocked=true;notice('A sessão recebida não corresponde a esta contagem. Reconecte o leitor.');return;}
    if(document.hidden || !context().isActive()){notice(data.count+' leitura(s) guardada(s). Volte à contagem de destino em modo Entrada para aplicar.');return;}
    busy=true;
    try{
      for(var event of data.items){
        if(event.seq<=cursor)continue;
        if(event.seq!==cursor+1)throw new Error('Há uma leitura pendente antes desta. Reconecte para conferir a sequência.');
        var result=await applyReading(event,context());cursor=event.seq;
        sessionStorage.setItem('packem-nfc-reader-cursor-'+linkId,String(cursor));
        notice(event.item+' · '+event.quantidade.replace('.',',')+' '+event.unidade+(result.duplicate?' · já estava contada':' · entrada recebida no WMS'));
      }
      send('packem-nfc-reader-ack',{cursor:cursor});
    }catch(error){blocked=true;notice(error.message+' As leituras restantes estão guardadas. Use Tentar novamente depois de conferir.');}
    finally{busy=false;}
  }
  root.addEventListener('message',function(event){
    if(!validReply(event,station,stationOrigin,linkId))return;
    var data=event.data;
    if(data.type==='packem-nfc-reader-ready'){opening=false;connected=true;notice('Leitor conectado a '+targets[destination].label+'. Abra o NFC.cool para ler as tags.');if(host)host.hidden=true;return;}
    if(data.type==='packem-nfc-reader-paused'){opening=false;connected=false;notice('Recepção do leitor pausada; dados guardados.');return;}
    if(data.type==='packem-nfc-reader-error'){opening=false;notice(data.error||'Falha na estação de leitura.');return;}
    if(data.type==='packem-nfc-reads')receive(data);
  });
  function connect(view){
    if(root.WmsNfcMobile&&root.WmsNfcMobile.active()){notice('Pause a captura Platinum antes de conectar a estação.');return;}
    if(root.WmsNfcDireto&&root.WmsNfcDireto.active()){notice('Conclua ou encerre a tentativa de NFC direto antes de conectar a estação.');return;}
    if(root.PackemWmsApp&&root.PackemWmsApp.active()){notice('Pare a leitura do aplicativo Packem WMS antes de conectar a estação.');return;}
    if(root.PackemNfcIphone&&root.PackemNfcIphone.active()){notice('Pause a recepção do iPhone antes de conectar a estação.');return;}
    if(connected && destination!==view){notice('Pause o leitor antes de mudar o destino de contagem.');return;}
    if(!targets[view] || !activeView() || typeof session==='undefined' || !session){notice('Entre no WMS e abra o destino da contagem.');return;}
    destination=view;stationOrigin=config.origin;blocked=false;connected=false;opening=true;
    var binding;try{binding=JSON.parse(sessionStorage.getItem('packem-nfc-reader-binding')||'null');}catch(e){}
    linkId=binding && binding.view===view && binding.origin===stationOrigin?binding.id:crypto.randomUUID();
    sessionStorage.setItem('packem-nfc-reader-binding',JSON.stringify({view:view,origin:stationOrigin,id:linkId}));
    cursor=Number(sessionStorage.getItem('packem-nfc-reader-cursor-'+linkId)||0);
    var url=new URL('/reader-bridge',stationOrigin);url.searchParams.set('linkId',linkId);url.searchParams.set('label',targets[view].label);if(config.token)url.hash=new URLSearchParams({token:config.token});
    if(host)host.remove();host=document.createElement('section');host.className='panel';host.style.cssText='position:fixed;inset:10%;z-index:900;background:white;color:#18332e;padding:16px;overflow:auto;border:2px solid #147657;border-radius:12px';
    var close=document.createElement('button');close.textContent='Voltar à contagem';close.className='gbtn';close.onclick=function(){host.hidden=true;};host.appendChild(close);
    frame=document.createElement('iframe');frame.title='Conectar leitor NFC à contagem';frame.src=url.href;frame.style.cssText='width:100%;height:440px;border:0';host.appendChild(frame);document.body.appendChild(host);station=frame.contentWindow;
    var fallback=document.createElement('button');fallback.textContent='Conectar em outra aba';fallback.className='gbtn';fallback.onclick=function(){var opened=root.open(url.href,'packem-nfc-reader-'+linkId);if(opened)station=opened;};host.appendChild(fallback);
    notice('Conecte o leitor na janela aberta. A contagem será aplicada somente neste destino.');
  }
  function mount(){Object.keys(targets).forEach(function(view){
    var container=root.WmsNfcWorkspace?root.WmsNfcWorkspace.host(view,true):document.getElementById(view);if(!container || container.querySelector('[data-nfc-reader-panel]'))return;
    var panel=document.createElement('details');panel.className='panel';panel.dataset.nfcReaderPanel='1';panel.style.cssText='padding:14px;margin:12px 0;border:1px solid #b8d4c4';
    var title=document.createElement('summary');title.textContent='Alternativa: NFC.cool com estação no PC';title.style.cursor='pointer';panel.appendChild(title);
    var status=document.createElement('p');status.dataset.nfcReaderStatus='1';status.textContent=lastNotice;panel.appendChild(status);
    var address=document.createElement('input');address.className='input';address.type='url';address.value=config.origin;address.setAttribute('aria-label','Endereço da estação de leitura NFC');panel.appendChild(address);
    for(var action of [['Conectar leitor',function(){try{config=validConfig({origin:address.value.trim(),token:address.value.trim()===config.origin?config.token:''});sessionStorage.setItem('packem-nfc-reader',JSON.stringify(config));connect(view);}catch(error){notice(error.message);}}],['Pausar leitor',function(){connected=false;send('packem-nfc-reader-stop');notice('Pausando a recepção do leitor…');}],['Nova contagem NFC',function(){if(connected){notice('Pause o leitor antes de iniciar outra sessão de contagem.');return;}sessionStorage.removeItem('packem-nfc-reader-binding');connect(view);}],['Tentar novamente',function(){blocked=false;send('packem-nfc-reader-poll');}]]){
      var button=document.createElement('button');button.type='button';button.className='gbtn';button.style.margin='8px 8px 0 0';button.textContent=action[0];button.onclick=action[1];panel.appendChild(button);
    }
    container.appendChild(panel);
  });}
  var mountPending=false;new MutationObserver(function(){if(mountPending)return;mountPending=true;setTimeout(function(){mountPending=false;mount();},120);}).observe(document.body,{childList:true,subtree:true});mount();
  setInterval(function(){if(connected && !document.hidden)send('packem-nfc-reader-poll');},2000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)send('packem-nfc-reader-poll');});
  root.WmsNfcReader={connect:connect,makeContext:makeContext,makeLabelContext:makeLabelContext,applyItemReading:applyItemReading,bridgeActive:function(){return connected||opening||busy;}};
})(typeof window!=='undefined'?window:globalThis);
