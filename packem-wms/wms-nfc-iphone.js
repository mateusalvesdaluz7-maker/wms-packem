/* iScanBrowser preenche o campo e chama capture(); o WMS valida e conta. */
(function(root){
  'use strict';
  class NativeTextCounter{
    constructor(options){this.parse=options.parse;this.apply=options.apply;this.notify=options.notify||function(){};this.context=null;this.active=false;this.busy=false;this.pending=[];this.seen=new Map();this.count=0;this.task=Promise.resolve();}
    status(message){this.notify({message:message,active:this.active,busy:this.busy,pending:this.pending.length,count:this.count});}
    arm(context){
      if(this.busy||this.pending.length)throw new Error('Retome as leituras pendentes antes de mudar de sessão.');
      if(!context.isActive())throw new Error('Entre no WMS e abra a contagem de destino em modo Entrada.');
      this.context=context;this.seen.clear();this.count=0;this.active=true;this.status('Recepção ativa. Inicie o leitor NFC nativo no iScanBrowser.');
    }
    pause(message){this.active=false;this.status(message||'Recepção pausada. As pendências desta aba foram mantidas; pare também o leitor no aplicativo.');}
    resume(){
      if(!this.context||!this.context.isActive())throw new Error('Volte ao mesmo usuário e à contagem original em modo Entrada para retomar.');
      this.active=true;this.status('Recepção retomada.');this.pump();
    }
    offer(text){
      if(!this.active||!this.context||!this.context.isActive()){this.pause('Recepção inativa. Abra a contagem correta e ative a recepção antes de ler.');return false;}
      var tag;
      try{tag=Object.freeze(this.parse(text));}catch(error){this.pause(error.message+' Confira a tag antes de retomar.');return false;}
      if(this.pending.length>=10){this.pause('Há dez leituras pendentes. Retome e aguarde o processamento antes de reapresentar esta etiqueta.');return false;}
      this.pending.push(tag);this.pump();return true;
    }
    pump(){
      if(this.busy||!this.active||!this.pending.length)return this.task;
      this.busy=true;
      this.task=(async()=>{
        while(this.active&&this.pending.length){
          var tag=this.pending[0],fingerprint=JSON.stringify([tag.codigo,tag.quantidade,tag.unidade]),previous=this.seen.get(tag.item),context=this.context;
          if(!context.isActive())throw new Error('A tela, o usuário ou o modo da contagem mudou.');
          if(previous&&previous!==fingerprint)throw new Error('A embalagem '+tag.item+' chegou com dados diferentes de uma leitura anterior.');
          if(!previous&&this.seen.size>=1000)throw new Error('Esta sessão já recebeu 1000 embalagens. Termine a recepção antes de abrir outra sessão.');
          var guard={isActive:()=>this.active&&this.context===context&&context.isActive(),lookup:context.lookup,has:context.has,add:context.add};
          var result=await this.apply(tag,guard);
          this.pending.shift();this.seen.set(tag.item,fingerprint);if(!result.duplicate)this.count++;
          this.status(tag.item+' · '+tag.quantidade.replace('.',',')+' '+tag.unidade+(result.duplicate?' · já estava contada':' · entrada adicionada ao WMS')+(this.active?'':' · recepção pausada'));
        }
      })().catch(error=>{this.pause(error.message+' As leituras pendentes estão nesta aba. Confira e use Retomar.');}).finally(()=>{this.busy=false;});
      return this.task;
    }
    idle(){return this.task;}
  }
  if(typeof module==='object'&&module.exports){module.exports={NativeTextCounter:NativeTextCounter};return;}
  if(!root.WmsNfcText||!root.WmsNfcReader)return;
  var destinations=['v-floor','v-floor70','v-recic'],boundView='',lastStatus='Abra este WMS no iScanBrowser para usar o NFC do iPhone.',dock,input;
  var counter=new NativeTextCounter({parse:root.WmsNfcText.parseText,apply:root.WmsNfcReader.applyItemReading,notify:function(state){
    lastStatus=state.message;document.querySelectorAll('[data-nfc-iphone-status]').forEach(function(node){node.textContent=lastStatus;});
    var pending=document.getElementById('packemNfcPending');if(pending)pending.textContent=state.pending+' pendente(s) nesta aba';
  }});
  function showStatus(message){counter.status(message);}
  function ensureDock(){
    if(dock)return;
    dock=document.createElement('section');dock.className='panel';dock.style.cssText='position:fixed;bottom:12px;left:12px;right:12px;z-index:290;background:var(--surface,#fff);padding:16px;border:2px solid #147657;border-radius:12px;max-height:45vh;overflow:auto;color:var(--text,#173c2d)';
    var title=document.createElement('strong');title.textContent='Recepção NFC do iPhone';dock.appendChild(title);
    var label=document.createElement('label');label.htmlFor='packemNfcInput';label.textContent='Dados da etiqueta recebidos do iScanBrowser';label.style.display='block';dock.appendChild(label);
    input=document.createElement('input');input.id='packemNfcInput';input.name='packemNfcInput';input.type='text';input.autocomplete='off';input.spellcheck=false;input.className='input code';input.style.width='100%';input.setAttribute('aria-label',label.textContent);dock.appendChild(input);
    input.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();capture();}});
    var status=document.createElement('p');status.dataset.nfcIphoneStatus='1';status.textContent=lastStatus;status.setAttribute('role','status');dock.appendChild(status);
    var pending=document.createElement('small');pending.id='packemNfcPending';pending.textContent='0 pendente(s) nesta aba';dock.appendChild(pending);
    var pause=document.createElement('button');pause.type='button';pause.className='gbtn';pause.textContent='Pausar recepção';pause.style.marginLeft='12px';pause.onclick=function(){counter.pause();};dock.appendChild(pause);
    var hide=document.createElement('button');hide.type='button';hide.className='gbtn';hide.textContent='Recolher';hide.style.marginLeft='12px';hide.onclick=function(){dock.hidden=true;};dock.appendChild(hide);
    document.body.appendChild(dock);
  }
  function capture(){
    if(!input||!input.value)return false;
    var value=input.value;
    if(!counter.offer(value))return false;
    if(input.value===value)input.value='';return true;
  }
  function arm(view){
    try{
      if(root.PackemWmsApp&&root.PackemWmsApp.active())throw new Error('Pare a leitura do aplicativo Packem WMS antes de usar esta alternativa.');
      if(root.WmsNfcReader.bridgeActive())throw new Error('Pause o leitor da estação antes de usar a recepção no iPhone.');
      if(counter.active&&boundView!==view)throw new Error('Pause a recepção antes de trocar o destino.');
      ensureDock();dock.hidden=false;
      if(boundView===view&&counter.context){counter.resume();return;}
      counter.arm(root.WmsNfcReader.makeContext(view));boundView=view;
    }catch(error){showStatus(error.message);}
  }
  function mount(){
    destinations.forEach(function(view){
      var container=document.getElementById(view);if(!container||container.querySelector('[data-nfc-iphone-panel]'))return;
      var panel=document.createElement('section');panel.className='panel';panel.dataset.nfcIphonePanel='1';panel.style.cssText='padding:18px;margin:12px 0;border:2px solid #147657;border-radius:12px';
      var title=document.createElement('strong');title.textContent='Contar com NFC · iScanBrowser';panel.appendChild(title);
      var description=document.createElement('p');description.textContent='Use o iScanBrowser com o leitor NFC nativo habilitado. As etiquetas entram nesta contagem após a conferência no cadastro. O Safari não captura NFC.';panel.appendChild(description);
      var status=document.createElement('p');status.dataset.nfcIphoneStatus='1';status.textContent=lastStatus;panel.appendChild(status);
      for(var action of [['Ativar recepção do iPhone',function(){arm(view);}],['Pausar recepção',function(){counter.pause();}],['Retomar',function(){try{if(boundView!==view)throw new Error('Volte à contagem original para retomar.');counter.resume();}catch(error){showStatus(error.message);}}]]){
        var button=document.createElement('button');button.type='button';button.className='gbtn';button.style.margin='6px 8px 6px 0';button.textContent=action[0];button.onclick=action[1];panel.appendChild(button);
      }
      var details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Configurar iScanBrowser uma vez';details.appendChild(summary);
      var steps=document.createElement('p');steps.textContent='Na regra Active Page, selecione o campo packemNfcInput e a origem exata deste WMS. Fonte: Internal NFC NDEF Reader. Desative Only if empty, Append data e Call Form.Submit(). Em Execute JS, use o comando abaixo.';details.appendChild(steps);
      var code=document.createElement('code');code.textContent='window.PackemNfcIphone.capture();';details.appendChild(code);
      var note=document.createElement('p');note.textContent='O app tem licença própria. A leitura física, as condições comerciais e o modo contínuo precisam de validação no aparelho; não estão confirmados por esta integração.';details.appendChild(note);panel.appendChild(details);container.appendChild(panel);
      var guide=document.createElement('a');guide.href='/nfc-iphone.html';guide.textContent='Abrir guia de configuração do iPhone';panel.appendChild(guide);
    });
    if(counter.active&&counter.context&&!counter.context.isActive())counter.pause('Recepção pausada porque a tela, o usuário ou o modo mudou. Volte ao destino original e retome.');
  }
  var scheduled=false;new MutationObserver(function(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;mount();},120);}).observe(document.body,{childList:true,subtree:true});mount();
  document.addEventListener('visibilitychange',function(){if(document.hidden&&counter.active)counter.pause('Recepção pausada ao sair do WMS. Volte à contagem e toque em Retomar.');});
  root.PackemNfcIphone={capture:capture,active:function(){return counter.active;},arm:arm};
})(typeof window!=='undefined'?window:globalThis);
