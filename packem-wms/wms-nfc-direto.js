/* Piloto Natively: escrita e releitura iniciadas no WMS. id NDEF não é UID. */
(function(root){
  'use strict';
  var common=typeof module==='object'&&module.exports;
  var text=common?require('./wms-nfc-text.js'):root.WmsNfcText;
  function tagText(reply){
    if(!reply||reply.status!=='SUCCESS')throw new Error('O leitor não confirmou a operação NFC. '+String(reply&&reply.message||'Confira a tag e tente novamente.').slice(0,220));
    if(typeof reply.payload_content!=='string')throw new Error('A leitura não trouxe o texto da tag. O campo id de um registro não será usado como UID do chip.');
    return text.parseText(reply.payload_content);
  }
  function sameTag(a,b){return ['item','codigo','quantidade','unidade'].every(function(key){return a[key]===b[key];});}
  class DirectTagPilot{
    constructor(options){this.serviceFactory=options.serviceFactory||function(){return options.service;};this.prepare=options.prepare;this.apply=options.apply;this.notify=options.notify||function(){};this.timeout=options.timeout||75000;this.busy=false;this.pending=null;this.epoch=0;}
    status(message){this.notify({message:message,busy:this.busy,pending:!!this.pending});}
    guard(context,epoch){if(this.epoch!==epoch||!context.isActive())throw new Error('A tela ou o usuário mudou. O resultado físico pode estar incerto; releia a tag antes de reutilizá-la.');}
    invoke(method,args){return new Promise((resolve,reject)=>{
      var finished=false,timer=setTimeout(()=>{if(finished)return;finished=true;reject(new Error('O aplicativo não respondeu ao NFC. A operação física não foi confirmada.'));},this.timeout);
      var done=function(reply,meta){if(finished)return;finished=true;clearTimeout(timer);if(meta&&meta.message){reject(new Error(String(meta.message).slice(0,220)));return;}resolve(reply);};
      try{var channel=this.serviceFactory();channel[method].apply(channel,(args||[]).concat(done));}catch(error){if(!finished){finished=true;clearTimeout(timer);reject(error);}}
    });}
    async operation(context,work){
      if(this.busy)throw new Error('Aguarde o fim da operação NFC atual.');
      this.busy=true;var epoch=this.epoch;
      try{this.guard(context,epoch);var available=await this.invoke('available');this.guard(context,epoch);if(!available||available.status!==true)throw new Error('NFC indisponível neste aplicativo. Confira o Natively Preview e suas condições de teste.');return await work(epoch);}
      catch(error){this.status(error.message);throw error;}
      finally{this.busy=false;}
    }
    async program(value,context){return this.operation(context,async epoch=>{
      if(this.pending)throw new Error('Confira a tentativa anterior ou encerre-a antes de preparar outra tag.');
      var fresh=await this.prepare(value.tag.item,context);this.guard(context,epoch);
      if(!sameTag(fresh.tag,value.tag))throw new Error('O cadastro mudou. Consulte a embalagem novamente antes de gravar.');
      this.pending={value:fresh,context:context};this.status('Aproxime uma tag de teste vazia para gravar a embalagem '+fresh.tag.item+'.');
      var reply=await this.invoke('write',[fresh.tag.item,fresh.content,'text']);this.guard(context,epoch);
      if(!reply||reply.status!=='SUCCESS')throw new Error('A escrita não foi confirmada. Confira a tag antes de repetir. '+String(reply&&reply.message||'').slice(0,180));
      this.status('O app informou escrita concluída. Afaste a tag e toque em Conferir tag gravada; o vínculo ainda não foi conferido.');return {verified:false};
    });}
    async verify(context){return this.operation(context,async epoch=>{
      var pending=this.pending;if(!pending)throw new Error('Grave uma tag por esta tela antes de conferir.');
      if(!pending.context.isActive())throw new Error('Volte ao usuário e à tela da tentativa original para conferir.');
      this.status('Aproxime novamente a mesma tag para conferir o vínculo gravado.');
      var tag=tagText(await this.invoke('read'));this.guard(context,epoch);
      if(this.pending!==pending||!pending.context.isActive())throw new Error('A tentativa mudou. A leitura não confirmou o vínculo.');
      if(!sameTag(tag,pending.value.tag))throw new Error('Esta tag não contém os dados da embalagem selecionada. Confira antes de usar.');
      var fresh=await this.prepare(tag.item,context);this.guard(context,epoch);
      if(!sameTag(tag,fresh.tag))throw new Error('Os dados gravados divergem do cadastro atual. Consulte a embalagem novamente.');
      this.pending=null;this.status('Tag conferida por releitura: '+tag.item+' · '+tag.codigo+' · '+tag.quantidade.replace('.',',')+' '+tag.unidade+'. O vínculo usa o ID gravado; não é o UID de fábrica.');return {verified:true,tag:tag};
    });}
    async count(context){return this.operation(context,async epoch=>{
      if(this.pending)throw new Error('Confira ou encerre a tentativa de gravação antes de contar.');
      this.status('Aproxime a tag para esta contagem.');var tag=tagText(await this.invoke('read'));this.guard(context,epoch);
      var guarded={isActive:()=>this.epoch===epoch&&context.isActive(),lookup:context.lookup,has:context.has,add:context.add};
      var result=await this.apply(tag,guarded);this.status(tag.item+' · '+tag.quantidade.replace('.',',')+' '+tag.unidade+(result.duplicate?' · já estava contada':' · adicionada ao WMS'));return result;
    });}
    end(){this.epoch++;this.pending=null;this.status('Tentativa encerrada nesta aba. Isso não apaga nem confirma o conteúdo físico da tag.');}
  }
  if(common){module.exports={DirectTagPilot:DirectTagPilot,tagText:tagText,sameTag:sameTag};return;}
  if(!text||!root.WmsNfcReader||!root.WmsNfcPrepare)return;
  var pilot=null,loading=null,starting=false,sequence=null,lastStatus='Piloto: abra o WMS no Natively Preview. Recurso NFC e uso gratuito precisam de validação no aparelho.';
  function notice(state){lastStatus=state.message;document.querySelectorAll('[data-nfc-direto-status]').forEach(function(node){node.textContent=lastStatus;});}
  function nativePresent(){return root.$agent&&typeof root.$agent.trigger==='function'&&typeof root.$agent.response==='function';}
  function loadService(){
    if(loading)return loading;
    loading=new Promise(function(resolve,reject){
      if(!nativePresent()){reject(new Error('Abra esta prévia dentro do Natively Preview para usar a antena. No navegador comum há somente o teste de software.'));return;}
      var timer=setTimeout(function(){reject(new Error('A ponte NFC do aplicativo não ficou pronta. Nenhuma gravação foi confirmada.'));},10000);
      function ready(){
        if(!root.natively||!root.NativelyNFCService){clearTimeout(timer);reject(new Error('SDK NFC indisponível.'));return;}
        root.natively.addObserver(function(){
          function supported(){clearTimeout(timer);resolve(function(){return new root.NativelyNFCService('Aproxime a tag NFC da embalagem.','Aproxime a tag de teste vazia para gravar.','Tag detectada; conferindo resposta.','Tag detectada; aguardando confirmação.');});}
          if(root.natively.app_version>=15){supported();return;}
          if(!root.NativelyInfo){clearTimeout(timer);reject(new Error('Não foi possível conferir a versão da ponte nativa.'));return;}
          new root.NativelyInfo().getAppInfo(function(info){
            if(!info||!Number.isInteger(info.sdkVersion)||info.sdkVersion<15){clearTimeout(timer);reject(new Error('Esta versão da ponte Natively não confirmou suporte ao comando NFC.'));return;}
            root.natively.app_version=info.sdkVersion;supported();
          });
        });
      }
      if(root.natively&&root.NativelyNFCService){ready();return;}
      var script=document.createElement('script');script.src='/vendor/natively-2.28.14.min.js';script.onload=ready;script.onerror=function(){clearTimeout(timer);reject(new Error('Não foi possível carregar o SDK NFC local.'));};document.head.appendChild(script);
    }).catch(function(error){loading=null;throw error;});return loading;
  }
  function othersActive(){return (root.PackemNfcIphone&&root.PackemNfcIphone.active())||(root.PackemWmsApp&&root.PackemWmsApp.active())||root.WmsNfcReader.bridgeActive();}
  async function getPilot(){if(pilot)return pilot;var serviceFactory=await loadService();pilot=new DirectTagPilot({serviceFactory:serviceFactory,prepare:root.WmsNfcPrepare.prepare,apply:root.WmsNfcReader.applyItemReading,notify:notice});return pilot;}
  async function action(type,view){
    if(sequence){notice({message:'Encerre a leitura em sequência antes de iniciar outra operação.'});return;}
    if(starting){notice({message:'Aguarde o fim da operação NFC atual.'});return;}starting=true;
    try{
      if(othersActive())throw new Error('Pause os outros leitores antes de iniciar o NFC direto.');
      var context=view?root.WmsNfcReader.makeContext(view):root.WmsNfcReader.makeLabelContext();
      if(!context.isActive())throw new Error('Entre no WMS e abra a tela correta para usar o NFC.');
      var value=type==='program'?root.WmsNfcPrepare.current():null;
      if(type==='program'&&!value)throw new Error('Selecione e consulte a embalagem no painel Preparar tag NFC primeiro.');
      var selected=await getPilot();if(type==='program')await selected.program(value,context);else if(type==='verify')await selected.verify(context);else await selected.count(context);
    }catch(error){notice({message:error.message});}finally{starting=false;}
  }
  async function startSequence(view){
    if(starting||sequence||(pilot&&(pilot.busy||pilot.pending))){notice({message:'Conclua a operação atual antes de iniciar a sequência.'});return;}
    starting=true;var binding=null;
    try{
      if(othersActive())throw new Error('Pause os outros leitores antes de iniciar o NFC direto.');
      var context=root.WmsNfcReader.makeContext(view);if(!context.isActive())throw new Error('Abra esta contagem em modo Entrada com seu usuário.');
      var selected=await getPilot();if(!context.isActive())throw new Error('A tela ou o usuário mudou.');
      binding={context:context};sequence=binding;starting=false;
      var guarded={isActive:function(){return sequence===binding&&context.isActive();},lookup:context.lookup,has:context.has,add:context.add};
      while(sequence===binding&&context.isActive()){
        await selected.count(guarded);
        if(sequence===binding&&context.isActive())await new Promise(function(resolve){setTimeout(resolve,800);});
      }
    }catch(error){notice({message:error.message+' A sequência foi encerrada; os itens já contados permanecem.'});}
    finally{if(sequence===binding)sequence=null;starting=false;}
  }
  function end(){sequence=null;if(pilot)pilot.end();else notice({message:'Nenhuma operação NFC iniciada.'});}
  function mount(){
    ['v-labels','v-floor','v-floor70','v-recic'].forEach(function(view){
      var container=document.getElementById(view);if(!container||container.querySelector('[data-nfc-direto-panel]'))return;
      var panel=document.createElement('details');panel.open=!!nativePresent();panel.dataset.nfcDiretoPanel='1';panel.className='panel';panel.style.cssText='padding:18px;margin:12px 0;border:2px solid #297a64;border-radius:12px';panel.dataset.nfcDiretoView=view;
      var title=document.createElement('summary');title.textContent='Novo piloto · NFC direto na tela do WMS';panel.appendChild(title);
      var intro=document.createElement('p');intro.textContent=view==='v-labels'?'No Natively Preview, o WMS pode iniciar a gravação e a releitura. Selecione uma embalagem acima e use uma NTAG213 de teste vazia. Gravar substitui o conteúdo anterior.':'Inicie a sequência e aproxime uma tag por vez. O WMS solicita a próxima leitura após conferir a anterior. O comportamento dos avisos e a continuidade precisam de teste físico no iPhone.';panel.appendChild(intro);
      var status=document.createElement('p');status.dataset.nfcDiretoStatus='1';status.textContent=lastStatus;status.setAttribute('role','status');panel.appendChild(status);
      var actions=view==='v-labels'?[['Gravar e vincular por aproximação',()=>action('program')],['Conferir tag gravada',()=>action('verify')]]:[['Iniciar contagem por aproximação',()=>startSequence(view)],['Ler uma tag',()=>action('count',view)]];
      actions.push(['Encerrar tentativa',end]);
      actions.forEach(function(item){var button=document.createElement('button');button.type='button';button.className='gbtn';button.textContent=item[0];button.style.margin='6px 8px 6px 0';button.onclick=item[1];panel.appendChild(button);});
      var guide=document.createElement('a');guide.href='/nfc-direto.html';guide.textContent='Como testar esta alternativa';guide.style.display='block';panel.appendChild(guide);container.appendChild(panel);
    });
  }
  root.WmsNfcDireto={active:function(){return starting||!!sequence||!!(pilot&&(pilot.busy||pilot.pending));}};
  new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});mount();
  document.addEventListener('visibilitychange',function(){if(document.hidden&&(pilot||sequence))end();});
})(typeof window!=='undefined'?window:globalThis);
