/* Ponte do aplicativo Packem WMS: Core NFC -> contagem autenticada existente. */
(function(root){
  'use strict';
  var targets=['v-floor','v-floor70','v-recic'];
  class AppCounter{
    constructor(options){this.parse=options.parse;this.resolve=options.resolve;this.apply=options.apply;this.notify=options.notify||function(){};this.uuid=options.uuid;this.binding=null;this.busy=false;this.seen=new Map();this.count=0;}
    status(message){this.notify({message:message,active:!!this.binding,busy:this.busy,count:this.count});}
    start(target,context){
      if(this.binding||this.busy)throw new Error('Encerre a leitura atual antes de iniciar outra.');
      if(!targets.includes(target)||!context.isActive())throw new Error('Entre no WMS e abra a contagem de destino em modo Entrada.');
      this.binding={sessionId:this.uuid(),target:target,context:context};this.seen.clear();this.count=0;
      this.status('Leitura iniciada. Aproxime uma etiqueta de cada vez da parte superior do iPhone.');
      return {type:'start',sessionId:this.binding.sessionId,target:target,mode:'count'};
    }
    stop(message){var old=this.binding;this.binding=null;this.status(message||'Leitura encerrada. As embalagens confirmadas permanecem na contagem.');return old?{type:'stop',sessionId:old.sessionId,target:old.target}:null;}
    async receive(reading){
      var binding=this.binding;
      if(!binding||!reading||reading.sessionId!==binding.sessionId||reading.target!==binding.target)throw new Error('Esta leitura pertence a outra sessão de contagem.');
      if(this.busy)throw new Error('Aguarde a confirmação da etiqueta anterior.');
      this.busy=true;
      try{
        if(typeof reading.uid!=='string'||!/^04[A-F0-9]{12}$/.test(reading.uid))throw new Error('UID da NTAG213 inválido.');
        var context=binding.context,guard={isActive:()=>this.binding===binding&&context.isActive(),lookup:context.lookup,has:context.has,add:context.add};
        if(!guard.isActive())throw new Error('A sessão de contagem mudou.');
        var tag=this.resolve?await this.resolve(reading.uid,guard):this.parse(reading.content);
        if(!guard.isActive())throw new Error('A sessão de contagem mudou.');
        var fingerprint=JSON.stringify([tag.item,tag.codigo,tag.quantidade,tag.unidade]);
        if(this.seen.has(reading.uid)&&this.seen.get(reading.uid)!==fingerprint)throw new Error('A mesma tag foi recebida com dados diferentes. Confira a etiqueta.');
        if(!this.seen.has(reading.uid)&&this.seen.size>=1000)throw new Error('Limite de 1000 tags nesta sessão. Encerre e inicie outra leitura.');
        var result=await this.apply(tag,guard);
        if(!guard.isActive())throw new Error('A sessão mudou antes da confirmação. Confira os itens já contados.');
        this.seen.set(reading.uid,fingerprint);if(!result.duplicate)this.count++;
        var label=tag.item+' · '+tag.quantidade.replace('.',',')+' '+tag.unidade+(result.duplicate?' · já estava contada':' · adicionada à contagem');
        this.status(label);return {accepted:true,duplicate:result.duplicate,label:label};
      }catch(error){this.stop(error.message+' Reapresente esta etiqueta depois de conferir e iniciar a leitura novamente.');throw error;}
      finally{this.busy=false;}
    }
  }
  class AppEnrollment{
    constructor(options){this.prepare=options.prepare;this.bind=options.bind;this.uuid=options.uuid;this.notify=options.notify||function(){};this.binding=null;this.busy=false;}
    status(message){this.notify({message:message,active:!!this.binding,busy:this.busy});}
    guard(binding){if(this.binding!==binding||!binding.context.isActive())throw new Error('A tela ou o usuário mudou. Consulte a embalagem novamente.');}
    async start(value,context){
      if(this.binding||this.busy)throw new Error('Encerre o cadastro NFC atual antes de iniciar outro.');
      if(!value||!value.tag||!context.isActive())throw new Error('Consulte a embalagem em Gestão de Etiquetas primeiro.');
      var binding={sessionId:this.uuid(),target:'v-labels',context:context,tag:Object.assign({},value.tag)};this.binding=binding;this.busy=true;
      try{
        var fresh=await this.prepare(value.tag.item,context);this.guard(binding);
        if(!sameTag(fresh.tag,binding.tag))throw new Error('O cadastro mudou. Consulte a embalagem novamente.');
        this.status('Aproxime uma NTAG213 para cadastrar seu UID na embalagem '+fresh.tag.item+'. A memória do chip não será alterada.');
        return {type:'start',mode:'enroll',sessionId:binding.sessionId,target:binding.target};
      }catch(error){if(this.binding===binding)this.stop(error.message);throw error;}
      finally{this.busy=false;}
    }
    stop(message){var old=this.binding;this.binding=null;this.status(message||'Cadastro interrompido. Se o envio já começou, consulte o vínculo antes de tentar outra embalagem.');return old?{type:'stop',sessionId:old.sessionId,target:old.target,mode:'enroll'}:null;}
    async receive(reading){
      var binding=this.binding;
      if(!binding||!reading||reading.sessionId!==binding.sessionId||reading.target!=='v-labels')throw new Error('Esta leitura não pertence ao cadastro NFC atual.');
      if(this.busy)throw new Error('Aguarde a confirmação do cadastro anterior.');
      this.busy=true;
      try{
        if(typeof reading.uid!=='string'||!/^04[A-F0-9]{12}$/.test(reading.uid))throw new Error('UID da NTAG213 inválido.');
        this.guard(binding);var fresh=await this.prepare(binding.tag.item,binding.context);this.guard(binding);
        if(!sameTag(fresh.tag,binding.tag))throw new Error('O código ou peso mudou. Consulte a embalagem novamente.');
        this.status('Salvando UID '+reading.uid+' na embalagem '+binding.tag.item+'…');
        var record=await this.bind(reading.uid,binding.tag.item);this.guard(binding);
        if(!record||record.uid!==reading.uid||record.item!==binding.tag.item)throw new Error('O servidor não confirmou o vínculo solicitado.');
        this.binding=null;
        var label='UID '+reading.uid+' · embalagem '+record.item+' · '+(record.duplicate?'vínculo já existente':'cadastro confirmado no servidor');
        this.status(label);return {accepted:true,duplicate:record.duplicate===true,label:label};
      }catch(error){this.stop(error.message+' Se o envio já começou, confira o vínculo antes de repetir.');throw error;}
      finally{this.busy=false;}
    }
  }
  function sameTag(a,b){return ['item','codigo','quantidade','unidade'].every(function(key){return a[key]===b[key];});}
  class AppProgrammer{
    constructor(options){this.prepare=options.prepare;this.uuid=options.uuid;this.notify=options.notify||function(){};this.binding=null;this.busy=false;}
    status(message){this.notify({message:message,active:!!this.binding,busy:this.busy});}
    stop(message){var old=this.binding;this.binding=null;this.status(message||'Gravação encerrada. Se houve contato com a tag, confira seu conteúdo antes de reutilizá-la.');return old?{type:'stop',sessionId:old.sessionId,target:'v-labels',mode:'program'}:null;}
    guard(binding){if(this.binding!==binding||!binding.context.isActive())throw new Error('O usuário, a tela ou a embalagem selecionada mudou. Confira a tag antes de reutilizá-la.');}
    async fresh(binding){this.guard(binding);var value=await this.prepare(binding.value.tag.item,binding.context);this.guard(binding);if(value.content!==binding.value.content)throw new Error('O cadastro mudou. Consulte a embalagem novamente; a gravação não foi confirmada.');}
    async start(value,context){
      if(this.binding||this.busy)throw new Error('Encerre a operação NFC atual antes de gravar outra tag.');
      if(!value||!value.tag||typeof value.content!=='string')throw new Error('Selecione e consulte a embalagem primeiro.');
      var binding={sessionId:this.uuid(),value:{content:value.content,tag:{item:value.tag.item}},context:context,uid:null};this.binding=binding;this.busy=true;
      try{await this.fresh(binding);this.status('Aproxime uma NTAG213 vazia para gravar a embalagem '+value.tag.item+'. Mantenha-a parada até a conferência.');return {type:'program',mode:'program',sessionId:binding.sessionId,target:'v-labels',content:binding.value.content};}
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
  if(typeof module==='object'&&module.exports){module.exports={AppCounter:AppCounter,AppEnrollment:AppEnrollment,AppProgrammer:AppProgrammer};return;}
  if(!root.WmsNfcText||!root.WmsNfcReader)return;
  function handler(){return root.webkit&&root.webkit.messageHandlers&&root.webkit.messageHandlers.packemNfc;}
  var lastStatus=handler()?'Entre na contagem e toque em Ler NFC.':'A leitura NFC funciona no aplicativo Packem WMS para iPhone. O Safari não acessa esta antena.';
  function notice(state){lastStatus=state.message;document.querySelectorAll('[data-nfc-app-status]').forEach(function(node){node.textContent=lastStatus;});}
  var counter=new AppCounter({parse:root.WmsNfcText.parseText,resolve:function(uid,context){if(!root.PackemNfcRegistry)throw new Error('Cadastro NFC não publicado nesta página.');return root.PackemNfcRegistry.resolve(uid,context);},apply:root.WmsNfcReader.applyItemReading,uuid:()=>crypto.randomUUID(),notify:notice});
  var enrollment=new AppEnrollment({prepare:function(id,context){return root.WmsNfcPrepare.prepare(id,context);},bind:function(uid,item){if(!root.PackemNfcRegistry)throw new Error('Cadastro NFC indisponível.');return root.PackemNfcRegistry.bind(uid,item);},uuid:()=>crypto.randomUUID(),notify:notice});
  var programStatus='Selecione uma embalagem no painel Preparar tag NFC. Use uma NTAG213 vazia.';
  var programmer=new AppProgrammer({prepare:function(id,context){return root.WmsNfcPrepare.prepare(id,context);},uuid:()=>crypto.randomUUID(),notify:function(state){programStatus=state.message;document.querySelectorAll('[data-nfc-app-program-status]').forEach(function(node){node.textContent=programStatus;});}});
  function stop(message){var commands=[];if(counter.binding||counter.busy)commands.push(counter.stop(message));if(enrollment.binding||enrollment.busy)commands.push(enrollment.stop(message));if(programmer.binding||programmer.busy)commands.push(programmer.stop(message));commands.forEach(function(command){if(command&&handler())handler().postMessage(command);});if(!commands.length)notice({message:message||'Nenhuma operação NFC ativa.'});}
  function othersActive(){return (root.WmsNfcMobile&&root.WmsNfcMobile.active())||root.WmsNfcReader.bridgeActive()||(root.PackemNfcIphone&&root.PackemNfcIphone.active())||(root.WmsNfcDireto&&root.WmsNfcDireto.active());}
  async function program(){
    try{
      if(!handler())throw new Error('Abra o WMS no aplicativo Packem WMS com a permissão NFC.');
      if(othersActive()||counter.binding||counter.busy||enrollment.binding||enrollment.busy)throw new Error('Conclua ou pause a outra operação NFC antes de gravar.');
      var value=root.WmsNfcPrepare&&root.WmsNfcPrepare.current();if(!value)throw new Error('Selecione e consulte a embalagem no painel Preparar tag NFC primeiro.');
      var original=root.WmsNfcReader.makeLabelContext(),context={lookup:original.lookup,isActive:function(){var current=root.WmsNfcPrepare.current();return original.isActive()&&!!current&&current.content===value.content;}};
      var command=await programmer.start(value,context);
      try{handler().postMessage(command);}catch(error){stop('A antena não iniciou. Nenhuma gravação foi confirmada.');throw error;}
    }catch(error){programmer.status(error.message);}
  }
  function start(view){
    try{
      if(!handler())throw new Error('Abra este WMS no aplicativo Packem WMS com NFC nativo.');
      if(othersActive()||enrollment.binding||enrollment.busy||programmer.binding||programmer.busy)throw new Error('Conclua ou pause a outra operação NFC antes de usar o app Packem WMS.');
      var command=counter.start(view,root.WmsNfcReader.makeContext(view));
      try{handler().postMessage(command);}catch(error){stop('Não foi possível iniciar a antena do aplicativo.');throw error;}
    }catch(error){counter.status(error.message);}
  }
  async function enroll(){
    try{
      if(!handler())throw new Error('Abra este WMS no aplicativo Packem WMS com NFC nativo.');
      if(othersActive()||counter.binding||counter.busy||programmer.binding||programmer.busy)throw new Error('Pare a contagem ou outra operação NFC antes de cadastrar o chip.');
      var value=root.WmsNfcPrepare&&root.WmsNfcPrepare.current(),original=root.WmsNfcReader.makeLabelContext();
      var context={lookup:original.lookup,isActive:function(){var current=root.WmsNfcPrepare.current();return original.isActive()&&!!current&&!!value&&current.content===value.content;}};
      var command=await enrollment.start(value,context);
      try{handler().postMessage(command);}catch(error){stop('A antena não iniciou o cadastro.');throw error;}
    }catch(error){enrollment.status(error.message);}
  }
  function mount(){
    if(counter.binding&&!counter.binding.context.isActive())stop('Leitura encerrada porque o usuário, a tela ou o modo de contagem mudou.');
    if(enrollment.binding&&!enrollment.binding.context.isActive())stop('Cadastro encerrado porque a tela ou o usuário mudou. Confira o vínculo se o envio já começou.');
    if(programmer.binding&&!programmer.binding.context.isActive())stop('Gravação interrompida pela mudança de usuário, tela ou embalagem. Confira o conteúdo da tag antes de reutilizá-la.');
    var labels=root.WmsNfcWorkspace?root.WmsNfcWorkspace.host('v-labels',true):document.getElementById('v-labels');
    if(labels&&!labels.querySelector('[data-nfc-app-enroll]')){
      var registration=document.createElement(handler()?'section':'details');registration.className='panel';registration.dataset.nfcAppEnroll='1';registration.style.cssText='padding:18px;margin:12px 0;border:2px solid #147657;border-radius:12px';
      var heading=document.createElement(handler()?'h3':'summary');heading.textContent='Cadastrar chip pelo UID · aplicativo Packem WMS';registration.appendChild(heading);
      var explanation=document.createElement('p');explanation.textContent='Consulte a embalagem no painel Preparar tag NFC e aproxime uma NTAG213. O UID de fábrica fica vinculado no WMS; tags vazias também servem. Código e peso são consultados no cadastro da embalagem.';registration.appendChild(explanation);
      var status=document.createElement('p');status.dataset.nfcAppStatus='1';status.setAttribute('role','status');status.textContent=lastStatus;registration.appendChild(status);
      var bindButton=document.createElement('button');bindButton.type='button';bindButton.className='btn brand';bindButton.textContent='Cadastrar chip por aproximação';bindButton.disabled=!handler();bindButton.onclick=enroll;registration.appendChild(bindButton);
      var cancel=document.createElement('button');cancel.type='button';cancel.className='gbtn';cancel.textContent='Cancelar cadastro';cancel.style.marginLeft='12px';cancel.onclick=function(){stop();};registration.appendChild(cancel);
      var guide=document.createElement('a');guide.href='/nfc-app.html';guide.textContent='Sobre o aplicativo Packem WMS';guide.style.cssText='display:block;margin-top:12px';registration.appendChild(guide);
      var prepared=labels.querySelector('[data-nfc-preparar]');if(prepared)prepared.after(registration);else labels.prepend(registration);
    }
    if(labels&&!labels.querySelector('[data-nfc-app-program]')){
      var section=document.createElement('details');section.className='panel';section.dataset.nfcAppProgram='1';section.style.cssText='padding:18px;margin:12px 0;border:1px solid #b8d4c4;border-radius:12px';
      var title=document.createElement('summary');title.textContent='Opcional: gravar dados na memória do chip';section.appendChild(title);
      var intro=document.createElement('p');intro.textContent='Consulte a embalagem acima e aproxime uma NTAG213 vazia. O app grava os dados e os relê antes de confirmar. Esta opção é independente: cadastre também o UID no painel acima para contar no WMS. Tags com conteúdo anterior são recusadas.';section.appendChild(intro);
      var status=document.createElement('p');status.dataset.nfcAppProgramStatus='1';status.setAttribute('role','status');status.textContent=programStatus;section.appendChild(status);
      [['Gravar tag vazia',program],['Parar gravação',()=>stop()]].forEach(function(action){var button=document.createElement('button');button.type='button';button.className='gbtn';button.textContent=action[0];button.disabled=!handler();button.style.margin='6px 10px 6px 0';button.onclick=action[1];section.appendChild(button);});
      labels.appendChild(section);
    }
    targets.forEach(function(view){
      var container=root.WmsNfcWorkspace?root.WmsNfcWorkspace.host(view,true):document.getElementById(view);if(!container||container.querySelector('[data-nfc-app-panel]'))return;
      var panel=document.createElement(handler()?'section':'details');panel.className='panel';panel.dataset.nfcAppPanel='1';panel.style.cssText='padding:18px;margin:12px 0;border:1px solid #b8d4c4;border-radius:12px';
      var title=document.createElement(handler()?'strong':'summary');title.textContent=handler()?'NFC · aplicativo Packem WMS':'Outra opção: aplicativo próprio Packem WMS';panel.appendChild(title);
      var description=document.createElement('p');description.textContent='Toque em Ler NFC e aproxime as tags cadastradas pelo UID. O WMS busca código e peso da embalagem e evita duplicar itens nesta contagem. Não é necessário tocar a cada etiqueta.';panel.appendChild(description);
      var status=document.createElement('p');status.dataset.nfcAppStatus='1';status.setAttribute('role','status');status.textContent=lastStatus;panel.appendChild(status);
      var begin=document.createElement('button');begin.type='button';begin.className='gbtn';begin.textContent='Ler NFC';begin.disabled=!handler();begin.style.marginRight='12px';begin.onclick=function(){start(view);};panel.appendChild(begin);
      var end=document.createElement('button');end.type='button';end.className='gbtn';end.textContent='Parar leitura';end.onclick=function(){stop();};panel.appendChild(end);
      var note=document.createElement('small');note.style.display='block';note.textContent='O iOS limita cada sessão a cerca de 60 segundos. Toque em Ler NFC para continuar; os itens já contados permanecem. Cadastre as tags em NFC → Cadastrar tags antes de contar.';panel.appendChild(note);container.prepend(panel);
    });
  }
  root.PackemWmsApp={start:start,enroll:enroll,program:program,stop:stop,active:()=>!!counter.binding||counter.busy||!!enrollment.binding||enrollment.busy||!!programmer.binding||programmer.busy,
    receive:reading=>counter.receive(reading),
    receiveEnrollment:reading=>enrollment.receive(reading),
    authorizeWriting:reading=>programmer.authorize(reading),programmed:reading=>programmer.complete(reading),
    stopped:function(sessionId,message){if(counter.binding&&counter.binding.sessionId===sessionId)counter.stop(message);if(enrollment.binding&&enrollment.binding.sessionId===sessionId)enrollment.stop(message);if(programmer.binding&&programmer.binding.sessionId===sessionId)programmer.stop(message);}
  };
  var scheduled=false;new MutationObserver(function(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;mount();},80);}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});mount();
  document.addEventListener('visibilitychange',function(){if(document.hidden&&(counter.binding||enrollment.binding||programmer.binding))stop('NFC encerrado ao sair do WMS. Confira os itens e vínculos já enviados antes de continuar.');});
})(typeof window!=='undefined'?window:globalThis);
