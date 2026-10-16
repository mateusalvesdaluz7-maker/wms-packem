/* Ponte gratuita Packem WMS: gravação de tags vazias e contagem via Core NFC. */
(function(root){
  'use strict';
  var targets=['v-floor','v-floor70','v-recic'];
  class AppCounter{
    constructor(options){this.parse=options.parse;this.apply=options.apply;this.notify=options.notify||function(){};this.uuid=options.uuid;this.binding=null;this.busy=false;this.seen=new Map();this.count=0;}
    status(message){this.notify({message:message,active:!!this.binding,busy:this.busy,count:this.count});}
    start(target,context){
      if(this.binding||this.busy)throw new Error('Encerre a leitura atual antes de iniciar outra.');
      if(!targets.includes(target)||!context.isActive())throw new Error('Entre no WMS e abra a contagem de destino em modo Entrada.');
      this.binding={sessionId:this.uuid(),target:target,context:context};this.seen.clear();this.count=0;
      this.status('Leitura iniciada. Aproxime uma etiqueta de cada vez da parte superior do iPhone.');
      return {type:'start',sessionId:this.binding.sessionId,target:target};
    }
    stop(message){var old=this.binding;this.binding=null;this.status(message||'Leitura encerrada. As embalagens confirmadas permanecem na contagem.');return old?{type:'stop',sessionId:old.sessionId,target:old.target}:null;}
    async receive(reading){
      var binding=this.binding;
      if(!binding||!reading||reading.sessionId!==binding.sessionId||reading.target!==binding.target)throw new Error('Esta leitura pertence a outra sessão de contagem.');
      if(this.busy)throw new Error('Aguarde a confirmação da etiqueta anterior.');
      this.busy=true;
      try{
        if(typeof reading.uid!=='string'||!/^04[A-F0-9]{12}$/.test(reading.uid))throw new Error('UID da NTAG213 inválido.');
        var tag=this.parse(reading.content),fingerprint=JSON.stringify([tag.item,tag.codigo,tag.quantidade,tag.unidade]);
        if(this.seen.has(reading.uid)&&this.seen.get(reading.uid)!==fingerprint)throw new Error('A mesma tag foi recebida com dados diferentes. Confira a etiqueta.');
        if(!this.seen.has(reading.uid)&&this.seen.size>=1000)throw new Error('Limite de 1000 tags nesta sessão. Encerre e inicie outra leitura.');
        var context=binding.context,guard={isActive:()=>this.binding===binding&&context.isActive(),lookup:context.lookup,has:context.has,add:context.add};
        var result=await this.apply(tag,guard);
        this.seen.set(reading.uid,fingerprint);if(!result.duplicate)this.count++;
        var label=tag.item+' · '+tag.quantidade.replace('.',',')+' '+tag.unidade+(result.duplicate?' · já estava contada':' · adicionada à contagem');
        this.status(label);return {accepted:true,duplicate:result.duplicate,label:label};
      }catch(error){this.stop(error.message+' Reapresente esta etiqueta depois de conferir e iniciar a leitura novamente.');throw error;}
      finally{this.busy=false;}
    }
  }
  class AppProgrammer{
    constructor(options){this.prepare=options.prepare;this.uuid=options.uuid;this.notify=options.notify||function(){};this.binding=null;this.busy=false;}
    status(message){this.notify({message:message,active:!!this.binding,busy:this.busy});}
    stop(message){var old=this.binding;this.binding=null;this.status(message||'Gravação encerrada. Se houve contato com a tag, confira seu conteúdo antes de reutilizá-la.');return old?{type:'stop',sessionId:old.sessionId,target:'v-labels'}:null;}
    guard(binding){if(this.binding!==binding||!binding.context.isActive())throw new Error('O usuário, a tela ou a embalagem selecionada mudou. Confira a tag antes de reutilizá-la.');}
    async fresh(binding){this.guard(binding);var value=await this.prepare(binding.value.tag.item,binding.context);this.guard(binding);if(value.content!==binding.value.content)throw new Error('O cadastro mudou. Consulte a embalagem novamente; a gravação não foi confirmada.');}
    async start(value,context){
      if(this.binding||this.busy)throw new Error('Encerre a operação NFC atual antes de gravar outra tag.');
      if(!value||!value.tag||typeof value.content!=='string')throw new Error('Selecione e consulte a embalagem primeiro.');
      var binding={sessionId:this.uuid(),value:{content:value.content,tag:{item:value.tag.item}},context:context,uid:null};this.binding=binding;this.busy=true;
      try{await this.fresh(binding);this.status('Aproxime uma NTAG213 vazia para gravar a embalagem '+value.tag.item+'. Mantenha-a parada até a conferência.');return {type:'program',sessionId:binding.sessionId,target:'v-labels',content:binding.value.content};}
      catch(error){this.stop(error.message);throw error;}finally{this.busy=false;}
    }
    match(reading){var binding=this.binding;if(!binding||!reading||reading.sessionId!==binding.sessionId||reading.target!=='v-labels')throw new Error('Esta gravação pertence a outra sessão.');if(typeof reading.uid!=='string'||!/^04[A-F0-9]{12}$/.test(reading.uid)||reading.content!==binding.value.content)throw new Error('A tag ou o conteúdo não corresponde à gravação solicitada.');return binding;}
    async authorize(reading){
      var binding=this.match(reading);if(this.busy)throw new Error('Aguarde a conferência atual.');this.busy=true;
      try{if(binding.uid)throw new Error('Esta tentativa já autorizou uma tag. Inicie outra tentativa para repetir.');await this.fresh(binding);binding.uid=reading.uid;return {accepted:true};}
      catch(error){this.stop(error.message);throw error;}finally{this.busy=false;}
    }
    async complete(reading){
      var binding=this.match(reading);if(this.busy)throw new Error('Aguarde a conferência atual.');this.busy=true;
      try{if(binding.uid!==reading.uid)throw new Error('O UID relido não corresponde à tag autorizada.');await this.fresh(binding);var label='Tag gravada e relida: '+binding.value.tag.item+' · UID '+reading.uid;this.binding=null;this.status(label);return {accepted:true,label:label};}
      catch(error){this.stop(error.message);throw error;}finally{this.busy=false;}
    }
  }
  if(typeof module==='object'&&module.exports){module.exports={AppCounter:AppCounter,AppProgrammer:AppProgrammer};return;}
  if(!root.WmsNfcText||!root.WmsNfcReader)return;
  function handler(){return root.webkit&&root.webkit.messageHandlers&&root.webkit.messageHandlers.packemNfc;}
  var lastStatus=handler()?'Entre na contagem e toque em Ler NFC.':'A leitura NFC funciona no aplicativo Packem WMS para iPhone. O Safari não acessa esta antena.';
  var counter=new AppCounter({parse:root.WmsNfcText.parseText,apply:root.WmsNfcReader.applyItemReading,uuid:()=>crypto.randomUUID(),notify:function(state){lastStatus=state.message;document.querySelectorAll('[data-nfc-app-status]').forEach(function(node){node.textContent=lastStatus;});}});
  var programStatus='Selecione uma embalagem no painel Preparar tag NFC. Use uma NTAG213 vazia.';
  var programmer=new AppProgrammer({prepare:function(id,context){return root.WmsNfcPrepare.prepare(id,context);},uuid:()=>crypto.randomUUID(),notify:function(state){programStatus=state.message;document.querySelectorAll('[data-nfc-app-program-status]').forEach(function(node){node.textContent=programStatus;});}});
  function stop(message){[counter.stop(message),programmer.stop(message)].forEach(function(command){if(command&&handler())handler().postMessage(command);});}
  function othersActive(){return root.WmsNfcReader.bridgeActive()||(root.PackemNfcIphone&&root.PackemNfcIphone.active())||(root.WmsNfcDireto&&root.WmsNfcDireto.active());}
  async function program(){
    try{
      if(!handler())throw new Error('Abra o WMS no aplicativo Packem WMS com a permissão NFC.');
      if(othersActive()||counter.binding||counter.busy)throw new Error('Conclua ou pause a outra operação NFC antes de gravar.');
      var value=root.WmsNfcPrepare&&root.WmsNfcPrepare.current();if(!value)throw new Error('Selecione e consulte a embalagem no painel Preparar tag NFC primeiro.');
      var original=root.WmsNfcReader.makeLabelContext(),context={lookup:original.lookup,isActive:function(){var current=root.WmsNfcPrepare.current();return original.isActive()&&!!current&&current.content===value.content;}};
      var command=await programmer.start(value,context);
      try{handler().postMessage(command);}catch(error){stop('A antena não iniciou. Nenhuma gravação foi confirmada.');throw error;}
    }catch(error){programmer.status(error.message);}
  }
  function start(view){
    try{
      if(!handler())throw new Error('Abra este WMS no aplicativo Packem WMS com NFC nativo.');
      if(othersActive()||programmer.binding||programmer.busy)throw new Error('Conclua ou pause a outra operação NFC antes de usar o app Packem WMS.');
      var command=counter.start(view,root.WmsNfcReader.makeContext(view));
      try{handler().postMessage(command);}catch(error){stop('Não foi possível iniciar a antena do aplicativo.');throw error;}
    }catch(error){counter.status(error.message);}
  }
  function mount(){
    if(counter.binding&&!counter.binding.context.isActive())stop('Leitura encerrada porque o usuário, a tela ou o modo de contagem mudou.');
    if(programmer.binding&&!programmer.binding.context.isActive())stop('Gravação interrompida pela mudança de usuário, tela ou embalagem. Confira o conteúdo da tag antes de reutilizá-la.');
    var labels=document.getElementById('v-labels');
    if(labels&&!labels.querySelector('[data-nfc-app-program]')){
      var section=document.createElement(handler()?'section':'details');section.className='panel';section.dataset.nfcAppProgram='1';section.style.cssText='padding:18px;margin:12px 0;border:1px solid #b8d4c4;border-radius:12px';
      var title=document.createElement(handler()?'strong':'summary');title.textContent='Gravar tag · aplicativo Packem WMS';section.appendChild(title);
      var intro=document.createElement('p');intro.textContent='Consulte a embalagem acima e aproxime uma NTAG213 vazia. O app grava os dados e os relê antes de confirmar. Tags com conteúdo anterior são recusadas.';section.appendChild(intro);
      var status=document.createElement('p');status.dataset.nfcAppProgramStatus='1';status.setAttribute('role','status');status.textContent=programStatus;section.appendChild(status);
      [['Gravar tag vazia',program],['Parar gravação',()=>stop()]].forEach(function(action){var button=document.createElement('button');button.type='button';button.className='gbtn';button.textContent=action[0];button.disabled=!handler();button.style.margin='6px 10px 6px 0';button.onclick=action[1];section.appendChild(button);});
      labels.appendChild(section);
    }
    targets.forEach(function(view){
      var container=document.getElementById(view);if(!container||container.querySelector('[data-nfc-app-panel]'))return;
      var panel=document.createElement(handler()?'section':'details');panel.className='panel';panel.dataset.nfcAppPanel='1';panel.style.cssText='padding:18px;margin:12px 0;border:1px solid #b8d4c4;border-radius:12px';
      var title=document.createElement(handler()?'strong':'summary');title.textContent=handler()?'NFC · aplicativo Packem WMS':'Outra opção: aplicativo próprio Packem WMS';panel.appendChild(title);
      var description=document.createElement('p');description.textContent='Toque em Ler NFC e aproxime as etiquetas já gravadas. Cada embalagem é conferida no cadastro e adicionada uma única vez a esta contagem.';panel.appendChild(description);
      var status=document.createElement('p');status.dataset.nfcAppStatus='1';status.setAttribute('role','status');status.textContent=lastStatus;panel.appendChild(status);
      var begin=document.createElement('button');begin.type='button';begin.className='gbtn';begin.textContent='Ler NFC';begin.disabled=!handler();begin.style.marginRight='12px';begin.onclick=function(){start(view);};panel.appendChild(begin);
      var end=document.createElement('button');end.type='button';end.className='gbtn';end.textContent='Parar leitura';end.onclick=function(){stop();};panel.appendChild(end);
      var note=document.createElement('small');note.style.display='block';note.textContent='O iOS encerra a sessão em até 60 segundos. Toque em Ler NFC para continuar; os itens já contados permanecem. Tags vazias precisam ser gravadas antes.';panel.appendChild(note);container.prepend(panel);
    });
  }
  root.PackemWmsApp={start:start,program:program,stop:stop,active:()=>!!counter.binding||counter.busy||!!programmer.binding||programmer.busy,
    receive:reading=>counter.receive(reading),
    authorizeWriting:reading=>programmer.authorize(reading),programmed:reading=>programmer.complete(reading),
    stopped:function(sessionId,message){if(counter.binding&&counter.binding.sessionId===sessionId)counter.stop(message);if(programmer.binding&&programmer.binding.sessionId===sessionId)programmer.stop(message);}
  };
  var scheduled=false;new MutationObserver(function(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;mount();},80);}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});mount();
  document.addEventListener('visibilitychange',function(){if(document.hidden&&(counter.binding||programmer.binding))stop('NFC interrompido ao sair do WMS. Confira a tag antes de repetir uma gravação.');});
})(typeof window!=='undefined'?window:globalThis);
