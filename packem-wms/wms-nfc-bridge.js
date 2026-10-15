/* WMS -> janela local -> fila NFC. Não contém código de acesso à estação. */
(function(root){
  'use strict';
  function mapLabels(rows,unitOf){
    if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw new Error('NFC: envie de 1 a 1000 etiquetas.');
    var seen=new Set();
    return rows.map(function(row){
      var item=String(row.id||'').trim(),codigo=String(row.cProd||'').trim();
      if(!/^[A-Za-z0-9._/-]{1,32}$/.test(item)||!/^[A-Za-z0-9._/-]{1,32}$/.test(codigo))throw new Error('NFC: etiqueta sem ID ou código de produto válido.');
      if(seen.has(item))throw new Error('NFC: ID repetido neste bloco: '+item);seen.add(item);
      var quantidade=String(row.kg==null?'':row.kg).replace(',','.');
      var unidade=String(unitOf(row)||'').toUpperCase();
      if(!/^\d{1,9}(?:\.\d{1,6})?$/.test(quantidade)||!/[1-9]/.test(quantidade))throw new Error('NFC: confira a quantidade de '+item+'.');
      if(!['KG','MT','UN'].includes(unidade))throw new Error('NFC: unidade não identificada para '+item+'.');
      return {item:item,codigo:codigo,quantidade:quantidade,unidade:unidade};
    });
  }
  function validReply(event,station,origin,linkId){
    return event.source===station&&event.origin===origin&&event.data&&event.data.linkId===linkId;
  }
  if(typeof module==='object'&&module.exports){module.exports={mapLabels:mapLabels,validReply:validReply};return;}

  var stationOrigin='http://127.0.0.1:8788',station=null,linkId='',connected=false;
  var pending=new Map(),batches=new Map(),statusNode,stationFrame,stationFallback;
  function enabled(){return sessionStorage.getItem('packem-nfc-enabled')==='1';}
  function notice(text){if(statusNode)statusNode.textContent=text;if(typeof root.toast==='function')root.toast(text,false);}
  function disconnected(){connected=false;notice('NFC desconectado. Reconecte a estação antes de imprimir com NFC.');}
  function connect(){
    linkId=crypto.randomUUID();connected=false;
    if(stationFrame)stationFrame.remove();
    if(stationFallback)stationFallback.remove();
    stationFrame=document.createElement('iframe');
    stationFrame.title='Conectar estação NFC';
    stationFrame.src=stationOrigin+'/wms-bridge?linkId='+encodeURIComponent(linkId);
    stationFrame.allow='loopback-network '+stationOrigin+'; local-network-access '+stationOrigin;
    stationFrame.style.cssText='display:block;width:100%;height:470px;border:1px solid #cbd5e1;border-radius:12px;margin:12px 0;background:#fff';
    (document.getElementById('v-labels')||document.body).appendChild(stationFrame);
    station=stationFrame.contentWindow;
    if(!station){notice('Não foi possível abrir a conexão local da estação NFC.');return;}
    stationFallback=document.createElement('button');stationFallback.type='button';
    stationFallback.textContent='Quadro não carregou? Conectar em outra aba';
    stationFallback.className='gbtn';
    stationFallback.onclick=function(){
      connected=false;
      var opened=root.open(stationFrame.src,'packem-nfc-station-'+linkId);
      if(!opened){notice('Permita abrir a aba local da estação e tente novamente.');return;}
      station=opened;notice('Informe o código na aba da estação e mantenha a conexão aberta.');
    };
    (document.getElementById('v-labels')||document.body).appendChild(stationFallback);
    sessionStorage.setItem('packem-nfc-enabled','1');
    notice('Informe o código no quadro da estação abaixo. O envio NFC fica bloqueado até conectar.');
  }
  root.addEventListener('message',function(event){
    if(!validReply(event,station,stationOrigin,linkId))return;
    var message=event.data;
    if(message.type==='packem-nfc-ready'){connected=true;if(statusNode)statusNode.textContent='NFC conectado · dados enviados automaticamente antes de cada bloco.';return;}
    if(message.type==='packem-nfc-paused'){disconnected();return;}
    var entry=pending.get(message.requestId);if(!entry)return;
    if(!['packem-nfc-accepted','packem-nfc-error'].includes(message.type))return;
    clearTimeout(entry.timer);pending.delete(message.requestId);
    if(message.type==='packem-nfc-accepted'&&message.count===entry.count)entry.resolve();
    else entry.reject(new Error(message.error||'A estação não aceitou todo o bloco.'));
  });
  function send(requestId,jobs){
    return new Promise(function(resolve,reject){
      if(!connected||!station||station.closed){disconnected();reject(new Error('Conecte a estação NFC antes de imprimir.'));return;}
      var timer=setTimeout(function(){pending.delete(requestId);reject(new Error('Sem confirmação da estação. Confira a conexão e repita o mesmo bloco; não gere IDs novos.'));},8000);
      pending.set(requestId,{resolve:resolve,reject:reject,timer:timer,count:jobs.length});
      station.postMessage({type:'packem-nfc-labels',linkId:linkId,requestId:requestId,jobs:jobs},stationOrigin);
    });
  }
  function beforePrint(rows,print,unitOf){
    if(!enabled())return print();
    try{
      var jobs=mapLabels(rows,unitOf),fingerprint=JSON.stringify(jobs),batch=batches.get(fingerprint);
      if(batch&&batch.inFlight){notice('Este bloco já está sendo enviado ao NFC.');return;}
      if(batch&&batch.submitted){notice('Este bloco já foi liberado à impressão. Confira a saída antes de reimprimir.');return;}
      if(!batch){batch={requestId:crypto.randomUUID(),submitted:false,inFlight:false};batches.set(fingerprint,batch);}
      batch.inFlight=true;
      return send(batch.requestId,jobs).then(function(){
        batch.submitted=true;batch.inFlight=false;
        if(statusNode)statusNode.textContent=jobs.length+' etiqueta(s) recebida(s) na estação. Impressão liberada; NFC físico ainda pendente.';
        return print();
      }).catch(function(error){batch.inFlight=false;notice(error.message+' O envio à impressão foi interrompido.');});
    }catch(error){notice(error.message+' Impressão interrompida antes de enviar dados incorretos.');}
  }
  root.WmsNfcBridge={beforePrint:beforePrint,enabled:enabled,connect:connect};
  var view=document.getElementById('v-labels');
  if(view){
    var panel=document.createElement('div');panel.className='panel';panel.style.cssText='padding:16px;margin-bottom:18px;border:1px solid #cbd5e1';
    var title=document.createElement('strong');title.textContent='Estação NFC · envio automático junto da impressão';panel.appendChild(title);
    statusNode=document.createElement('p');statusNode.style.cssText='font-size:.82rem;color:var(--muted);margin:8px 0';
    statusNode.textContent=enabled()?'NFC habilitado nesta aba. Reconecte a estação antes de imprimir.':'Desativado. Ao conectar, cada bloco rastreável envia seus dados antes da impressão.';panel.appendChild(statusNode);
    var button=document.createElement('button');button.type='button';button.className='btn brand';button.textContent='Conectar estação NFC';button.onclick=connect;panel.appendChild(button);
    var off=document.createElement('button');off.type='button';off.className='gbtn';off.textContent='Usar impressão sem NFC';off.style.marginLeft='8px';off.onclick=function(){sessionStorage.removeItem('packem-nfc-enabled');connected=false;notice('Integração NFC desativada nesta aba. Impressão normal habilitada.');};panel.appendChild(off);
    var detail=document.createElement('p');detail.style.cssText='font-size:.76rem;color:var(--muted);margin:10px 0 0';detail.textContent='A estação recebe os dados sem exportação. O NFC.cool no iPhone continua assistido. Não há confirmação de posição do rolo nem pausa automática da Zebra.';panel.appendChild(detail);
    view.insertBefore(panel,view.children[1]||null);
  }
})(typeof window!=='undefined'?window:globalThis);
