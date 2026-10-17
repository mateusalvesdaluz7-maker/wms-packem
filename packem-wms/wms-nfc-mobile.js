/* NFC.cool Platinum -> fila autenticada do WMS. Safari não acessa o rádio NFC. */
(function(root){
  'use strict';
  var uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  function createClient(options){
    var token='',owner='',login=null;
    async function request(action,data,retry){
      var auth=options.auth();
      if(!auth||!auth.u||!auth.p){token='';owner='';throw new Error('Entre novamente no WMS para conectar o celular.');}
      if(owner!==auth.u){token='';owner=auth.u;login=null;}
      var user=owner;
      if(!token){
        if(!login)login=(async function(){
          var response=await options.fetch('/api/nfc-mobile',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({action:'login',auth:{u:auth.u,p:auth.p}})});
          var reply=await response.json().catch(function(){return null;});
          if(!response.ok||!reply||!reply.token)throw new Error(reply&&reply.error||'Não foi possível conectar o serviço NFC.');
          if(owner!==user||!options.auth()||options.auth().u!==user)throw new Error('O usuário do WMS mudou.');
          token=reply.token;
        })().finally(function(){if(owner===user)login=null;});
        await login;
      }
      if(owner!==user||options.auth()?.u!==user)throw new Error('O usuário do WMS mudou.');
      var response=await options.fetch('/api/nfc-mobile',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},cache:'no-store',body:JSON.stringify({action:action,data:data||{}})});
      var reply=await response.json().catch(function(){return null;});
      if(owner!==user||options.auth()?.u!==user)throw new Error('O usuário do WMS mudou.');
      if(response.status===401&&!retry&&owner===user){token='';return request(action,data,true);}
      if(!response.ok||!reply||reply.ok!==true)throw new Error(reply&&reply.error||'O serviço NFC não confirmou a operação. Confira antes de repetir.');
      return reply.data;
    }
    return {request:request,clear:function(){owner='';token='';login=null;}};
  }
  // This context never calls a stock writer: only the authenticated NFC queue
  // is persisted. The result list is kept in this page's memory.
  function createTestCount(options){
    var items=new Map(),pending=new Map();
    var context={scope:options.scope,isActive:options.isActive,
      lookup:async function(id){
        var item=await options.lookup(id);
        if(!context.isActive())throw new Error('O teste de contagem mudou durante a consulta.');
        pending.set(id,item?{...item}:null);return item;
      },
      has:function(id){return items.has(id);},
      add:function(id){
        if(!context.isActive())throw new Error('O teste de contagem não está ativo.');
        var item=pending.get(id);
        if(!item)throw new Error('Consulte a embalagem antes de contar.');
        if(!items.has(id)){items.set(id,{item:id,...item});if(options.onChange)options.onChange();}
      }};
    return {context:context,entries:function(){return Array.from(items.values(),function(item){return {...item};});},
      totals:function(){var totals={};items.forEach(function(item){totals[item.unidade]=Math.round(((totals[item.unidade]||0)+Number(item.quantidade))*1e6)/1e6;});return totals;}};
  }
  function CountQueue(options){this.options=options;this.binding=null;this.busy=false;this.blocked=false;this.epoch=0;}
  CountQueue.prototype.start=async function(config,context){
    if(this.busy)throw new Error('Aguarde a leitura atual terminar.');
    if(!context.isActive())throw new Error('Abra a tarefa e a vaga/passada da contagem antes de iniciar.');
    var generation=++this.epoch, self=this;
    if(!uuid.test(config.sessionId)||!uuid.test(config.readerId)||!uuid.test(config.consumerId)||!config.contextKey)throw new Error('Sessão NFC inválida.');
    this.busy=true;
    try{
      var state=await this.options.api('count_start',config);
      if(generation!==this.epoch||!context.isActive())throw new Error('A contagem mudou durante a conexão. Pause o leitor e tente novamente.');
      this.check(state,config);
      var b={...config,cursor:state.session.cursor,running:true,context:context};
      b.guard={...context,isActive:function(){return self.binding===b&&b.running&&context.isActive();}};
      this.binding=b;this.blocked=false;this.options.notify('Leitor conectado. Abra o NFC.cool e aproxime uma tag por vez. Ao voltar, o WMS processará a fila.',state);
      return b;
    }finally{this.busy=false;}
  };
  CountQueue.prototype.check=function(state,b){
    var s=state&&state.session;
    if(!s||s.id!==b.sessionId||s.consumerId!==b.consumerId||s.target!==b.target||s.contextKey!==b.contextKey||!Number.isSafeInteger(s.cursor)||s.cursor<0||!Number.isSafeInteger(s.received)||s.received<s.cursor||s.received>1000||!Array.isArray(state.items)||state.items.length>100)throw new Error('A fila recebida pertence a outra contagem/tela ou está inválida.');
  };
  CountQueue.prototype.poll=async function(){
    var b=this.binding;if(!b||!b.running||this.busy||this.blocked||!b.guard.isActive())return;
    this.busy=true;
    try{
      var state=await this.options.api('count_status',{readerId:b.readerId,sessionId:b.sessionId,consumerId:b.consumerId,cursor:b.cursor});
      if(this.binding!==b||!b.running)return;this.check(state,b);
      if(state.session.cursor!==b.cursor)throw new Error('A fila foi processada em outra sessão. Pause e reconecte para conferir.');
      if(!state.session.active||Date.parse(state.session.expiresAt)<=Date.now())throw new Error('A captura está pausada ou expirou. Retome a contagem para continuar.');
      this.options.notify(state.session.received+' tag(s) recebida(s) · '+b.cursor+' processada(s).',state);
      for(var event of state.items){
        if(!b.guard.isActive())return;
        if(event.seq!==b.cursor+1||!/^(04|53)[A-F0-9]{12}$/.test(event.uid||''))throw new Error('Há uma leitura fora de sequência. A fila foi preservada.');
        var tag=await this.options.resolve(event.uid,b.guard);
        if(!b.guard.isActive())return;
        var applied=await this.options.apply(tag,b.guard);
        if(!b.guard.isActive())return;
        var ack=await this.options.api('count_ack',{readerId:b.readerId,sessionId:b.sessionId,consumerId:b.consumerId,cursor:event.seq});
        this.check(ack,b);
        if(ack.session.cursor!==event.seq)throw new Error('A confirmação da leitura não foi recebida. Confira antes de continuar.');
        b.cursor=event.seq;
        this.options.notify(tag.item+' · '+tag.quantidade+' '+tag.unidade+(applied.duplicate?' · já contada':' · contada'),ack);
      }
    }catch(error){if(this.binding===b){this.blocked=true;this.options.notify(error.message+' A fila foi mantida; corrija o cadastro e use Tentar novamente.');}}
    finally{this.busy=false;}
  };
  CountQueue.prototype.pause=async function(){
    ++this.epoch;var b=this.binding;if(!b)return;b.running=false;
    await this.options.api('count_stop',{readerId:b.readerId,sessionId:b.sessionId});
    this.blocked=false;this.options.notify('Captura pausada. As leituras recebidas continuam guardadas para esta contagem.');
  };
  if(typeof module==='object'&&module.exports){module.exports={createClient:createClient,CountQueue:CountQueue,createTestCount:createTestCount};return;}
  if(!root.WmsNfcReader||!root.PackemNfcRegistry)return;
  var labels={'v-floor':'Chão expedição','v-floor70':'Chão 70','v-recic':'Recicladora','v-inv':'Inventário','v-nfc-test':'Teste de contagem'};
  var reader=null,link='',enrollment=null,lastUser='',working=false,ticking=false,trial=null;
  var message='Conecte o NFC.cool Platinum para cadastrar chips e receber as leituras.',summary='';
  function user(){return typeof session!=='undefined'&&session?session.u:'';}
  function auth(){var a=root._fiscalAuth;return a&&a.u===user()?a:null;}
  var client=createClient({fetch:function(url,options){options.signal=AbortSignal.timeout(15000);return root.fetch(url,options);},auth:auth});
  function notice(text,state){message=text;if(state&&state.session)summary=state.session.received+' recebidas · '+state.session.cursor+' processadas';paint();}
  var queue=new CountQueue({api:client.request,resolve:root.PackemNfcRegistry.resolve,apply:root.WmsNfcReader.applyItemReading,notify:notice});
  function storageKey(){return 'packem-nfc-mobile:'+user();}
  function saved(){try{return JSON.parse(sessionStorage.getItem(storageKey())||'{}');}catch(_){return {};}}
  function save(value){try{sessionStorage.setItem(storageKey(),JSON.stringify(value));}catch(_){}}
  function view(){return (document.querySelector('.view.active')||{}).id;}
  function makeContext(target){
    if(target==='v-nfc-test'){
      if(!trial||trial.owner!==user()){
        var current={owner:user()};trial=current;
        current.counter=createTestCount({scope:current.owner+':teste-nfc:'+crypto.randomUUID(),
          isActive:function(){return trial===current&&user()===current.owner&&!document.hidden&&!!root.WmsNfcWorkspace?.isActive('v-nfc-test');},
          lookup:root.WmsNfcReader.makeLabelContext().lookup,onChange:paintTest});
      }
      return trial.counter.context;
    }
    if(target==='v-inv')return root.WmsNfcInventory?root.WmsNfcInventory.context():null;
    var context=root.WmsNfcReader.makeContext(target);context.scope=user()+':'+target+':entrada';return context;
  }
  function othersActive(){return root.WmsNfcReader.bridgeActive()||(root.PackemWmsApp&&root.PackemWmsApp.active())||(root.WmsNfcDireto&&root.WmsNfcDireto.active())||(root.PackemNfcIphone&&root.PackemNfcIphone.active());}
  function ensureAlone(){if(othersActive())throw new Error('Pare o outro leitor NFC antes de conectar o Platinum.');}
  async function selectReader(){
    if(reader)return reader;
    var list=await client.request('reader_list'),id=saved().readerId;
    var selected=list.find(function(item){return item.id===id;})||list[0];
    if(selected){reader=await client.request('reader_get',{readerId:selected.id});save({...saved(),readerId:reader.id});}
    return reader;
  }
  async function connect(){
    ensureAlone();if(queue.binding&&queue.binding.running||enrollment)throw new Error('Pause a contagem ou cancele o cadastro antes de renovar a conexão.');
    await selectReader();var result=await client.request(reader?'reader_rotate':'reader_create',reader?{readerId:reader.id}:{});
    reader=result;link=result.webhookUrl;save({...saved(),readerId:reader.id});
    notice('Conexão criada. Copie o endereço para o Webhook do NFC.cool. Deixe a autenticação básica HTTP desligada.');
  }
  async function arm(){
    ensureAlone();if(queue.binding&&queue.binding.running)throw new Error('Pause a contagem antes de cadastrar uma tag.');
    var selected=root.WmsNfcPrepare.current();if(!selected)throw new Error('Primeiro selecione a embalagem cadastrada na lista acima.');
    if(enrollment){
      if(enrollment.item!==selected.tag.item)throw new Error('Conclua ou cancele o cadastro atual antes de escolher outra embalagem.');
      reader=await client.request('enroll_arm',{readerId:enrollment.readerId,operationId:enrollment.operationId,item:enrollment.item});
      await checkEnrollment();return;
    }
    await selectReader();if(!reader)throw new Error('Use Conectar celular primeiro.');
    var data={readerId:reader.id,operationId:crypto.randomUUID(),item:selected.tag.item};
    // Save the operation before sending: a retry/reload must never arm the next tag.
    enrollment={...data,user:user()};save({...saved(),enrollment:enrollment});
    try{reader=await client.request('enroll_arm',data);notice('Aguardando o chip da embalagem '+data.item+' por 2 minutos. No NFC.cool, inicie a leitura e aproxime somente essa tag. Volte ao WMS para conferir o vínculo.');}
    catch(error){notice(error.message+' Use Conferir cadastro para consultar o resultado ou cancelar.');}
  }
  async function checkEnrollment(){
    if(!enrollment||enrollment.user!==user())return;
    var data=await client.request('reader_get',{readerId:enrollment.readerId});reader=data;
    var result=data.enrollment;
    if(result&&result.operationId===enrollment.operationId){
      if(result.status==='bound')notice('Tag '+result.uid+' cadastrada na embalagem '+enrollment.item+'. Agora ela pode ser lida na contagem.');
      else notice(result.status==='conflict'?'Cadastro recusado: este chip ou esta embalagem já tem outro vínculo. Confira as etiquetas.':'Cadastro cancelado.');
      enrollment=null;var state=saved();delete state.enrollment;save(state);
    }else if(data.operationId!==enrollment.operationId)notice('O leitor está em outra operação. Confira antes de cadastrar novamente.');
    else if(Date.parse(data.armUntil)<=Date.now()&&data.mode==='enroll')notice('O prazo para aproximar o chip terminou. Cancele e prepare uma nova tentativa.');
    paint();
  }
  async function cancel(){
    var op=enrollment;if(!op)return;
    await client.request('enroll_cancel',{readerId:op.readerId,operationId:op.operationId});enrollment=null;
    var state=saved();delete state.enrollment;save(state);notice('Cadastro encerrado. Consulte o resultado antes de reutilizar a tag.');
  }
  async function start(target,fresh){
    ensureAlone();if(enrollment)throw new Error('Conclua ou cancele o cadastro antes de contar.');
    if(queue.binding&&queue.binding.running)throw new Error('Pause a captura atual antes de iniciar outra.');
    var context=makeContext(target);if(!context||!context.isActive()||!context.scope)throw new Error('Abra uma contagem atribuída a você e escolha a vaga ou o chão que será contado.');
    await selectReader();if(!reader)throw new Error('Use Conectar celular primeiro.');
    reader=await client.request('reader_get',{readerId:reader.id});
    var apiTarget=target==='v-nfc-test'?'v-inv':target;
    var state=saved(),counts=state.counts||{},previous=counts[context.scope]||state.count;
    if(previous&&(previous.contextKey!==context.scope||previous.readerId!==reader.id||previous.target!==apiTarget))previous=null;
    // Transfer only after an explicit pause; two screens must not consume the same queue.
    if(!previous&&reader.count&&reader.count.target===apiTarget&&reader.count.contextKey===context.scope){
      if(reader.count.active)throw new Error('Este leitor está conectado a outra tela. Use Pausar captura antes de transferir a contagem.');
      previous={readerId:reader.id,sessionId:reader.count.id,target:apiTarget,contextKey:context.scope,consumerId:crypto.randomUUID()};
    }
    if(fresh&&previous){
      var pending=reader.count&&reader.count.id===previous.sessionId?reader.count:(await client.request('count_status',{readerId:reader.id,sessionId:previous.sessionId,consumerId:previous.consumerId,cursor:0})).session;
      if(pending.received!==pending.cursor)throw new Error('Retome e processe a fila pendente antes de abrir uma nova captura neste contexto.');
    }
    if(fresh&&reader.mode==='count')throw new Error('Pause a captura antes de iniciar um teste novo.');
    if(target==='v-nfc-test'&&fresh){trial=null;context=makeContext(target);}
    var config=previous&&!fresh?previous:{readerId:reader.id,sessionId:crypto.randomUUID(),consumerId:crypto.randomUUID(),contextKey:context.scope,target:apiTarget};
    if(reader.mode==='count'&&reader.countSessionId!==config.sessionId)throw new Error('Existe outra captura ativa neste leitor. Use Pausar captura antes de iniciar esta contagem.');
    // Persist before the request, including an uncertain response after a network failure.
    save({...state,counts:{...counts,[context.scope]:config}});await queue.start(config,context);await queue.poll();paint();
  }
  async function pause(){
    if(queue.binding)await queue.pause();
    await selectReader();if(!reader)throw new Error('Nenhum celular conectado.');
    reader=await client.request('reader_get',{readerId:reader.id});
    if(reader.mode==='count'&&reader.countSessionId)await client.request('count_stop',{readerId:reader.id,sessionId:reader.countSessionId});
    notice('Captura pausada. A fila anterior foi mantida no seu contexto original.');
  }
  function action(callback){return async function(){if(working)return;working=true;paint();try{await callback();}catch(error){notice(error.message);}finally{working=false;paint();}};}
  function button(parent,text,callback){var b=document.createElement('button');b.type='button';b.className='gbtn';b.textContent=text;b.style.margin='4px';b.onclick=action(callback);b.dataset.nfcMobileAction='1';parent.appendChild(b);return b;}
  function mount(){
    ['v-labels',...Object.keys(labels)].forEach(function(target){
      var page=root.WmsNfcWorkspace?root.WmsNfcWorkspace.host(target,'platinum'):document.getElementById(target);if(!page||page.querySelector('[data-nfc-mobile]'))return;
      var panel=document.createElement('section');panel.className='panel';panel.dataset.nfcMobile='1';panel.style.cssText='padding:18px;margin:12px 0;border:2px solid #0d8571;border-radius:12px;overflow-wrap:anywhere';
      var h=document.createElement('h3');h.textContent=target==='v-labels'?'Cadastrar chip com NFC.cool Platinum':target==='v-nfc-test'?'Teste de contagem com NFC.cool Platinum':'Contar com NFC.cool Platinum';panel.appendChild(h);
      var p=document.createElement('p');p.textContent=target==='v-labels'?'1. Escolha a embalagem na lista acima. 2. Toque em Cadastrar próxima tag. 3. Aproxime a tag do iPhone no NFC.cool. O UID ficará vinculado ao código e à quantidade existentes no WMS.':'As tags cadastradas entram nesta contagem por aproximação. No iPhone, leia no NFC.cool e volte ao WMS para processar a fila. Com o WMS aberto no PC, a fila pode ser processada durante as leituras.';panel.appendChild(p);
      var state=document.createElement('p');state.dataset.nfcMobileStatus='1';state.setAttribute('role','status');state.textContent=message;panel.appendChild(state);
      var total=document.createElement('strong');total.dataset.nfcMobileTotal='1';total.textContent=summary;panel.appendChild(total);
      if(target==='v-nfc-test'){
        var hint=document.createElement('p');hint.textContent='Somente conferência: recebe as leituras reais e busca os dados no WMS. Não cria entradas, saídas nem ajustes de estoque. O resultado fica nesta tela até fechar ou recarregar; pause antes de iniciar um teste novo.';panel.appendChild(hint);
        var results=document.createElement('div');results.dataset.nfcTestResults='1';results.setAttribute('aria-live','polite');panel.appendChild(results);
      }
      var controls=document.createElement('div');panel.appendChild(controls);
      if(target==='v-labels'){
        button(controls,'Cadastrar próxima tag',arm);button(controls,'Conferir cadastro',checkEnrollment);button(controls,'Cancelar cadastro',cancel);
      }else{
        button(controls,'Iniciar / retomar contagem',function(){return start(target);});
        button(controls,'Nova captura após pausa',function(){return start(target,true);});
        button(controls,'Tentar novamente',function(){queue.blocked=false;return queue.poll();});
        button(controls,'Pausar captura',pause);
      }
      var details=document.createElement('details'),caption=document.createElement('summary');caption.textContent='Conexão do celular e instruções';details.appendChild(caption);panel.appendChild(details);
      button(details,'Conectar celular / renovar link',connect);
      var input=document.createElement('input');input.readOnly=true;input.type='text';input.setAttribute('aria-label','Endereço privado do Webhook NFC');input.dataset.nfcMobileLink='1';input.style.cssText='width:100%;box-sizing:border-box;margin:8px 0';details.appendChild(input);
      button(details,'Copiar endereço do Webhook',async function(){if(!link)throw new Error('Gere uma conexão para exibir o endereço.');await navigator.clipboard.writeText(link);notice('Endereço copiado. Cole no NFC.cool → Webhook; autenticação básica HTTP desligada.');});
      var help=document.createElement('p');help.textContent='No NFC.cool: ative Webhook e Ativar para NFC; desligue Autenticação básica HTTP e QR/código de barras. Cole o endereço privado acima. O teste do Webhook só verifica a conexão e não cadastra nem conta tags. O link vale 30 dias. Renovar interrompe a captura anterior.';details.appendChild(help);
      var guide=document.createElement('a');guide.href='/nfc-platinum.html';guide.target='_blank';guide.rel='noopener';guide.textContent='Ver configuração passo a passo';details.appendChild(guide);
      var at=target==='v-labels'?page.querySelector('[data-nfc-preparar]'):null;
      if(at)at.after(panel);else page.insertBefore(panel,page.children[1]||null);
    });paintTest();
  }
  function paintTest(){
    var entries=trial?trial.counter.entries():[],totals=trial?trial.counter.totals():{},key=JSON.stringify(entries);
    document.querySelectorAll('[data-nfc-test-results]').forEach(function(node){
      if(node.dataset.resultKey===key)return;node.dataset.resultKey=key;node.replaceChildren();
      var count=document.createElement('p');count.style.fontWeight='700';count.textContent=entries.length+' embalagem(ns) contada(s)'+(entries.length?' · '+Object.entries(totals).map(function(pair){return pair[1].toLocaleString('pt-BR',{maximumFractionDigits:6})+' '+pair[0];}).join(' · '):'');node.appendChild(count);
      var list=document.createElement('ul');entries.forEach(function(item){var row=document.createElement('li');row.textContent=item.item+' · '+item.codigo+' · '+Number(item.quantidade).toLocaleString('pt-BR',{maximumFractionDigits:6})+' '+item.unidade;list.appendChild(row);});node.appendChild(list);
    });
  }
  function paint(){
    document.querySelectorAll('[data-nfc-mobile-status]').forEach(function(n){if(n.textContent!==message)n.textContent=message;});
    document.querySelectorAll('[data-nfc-mobile-total]').forEach(function(n){if(n.textContent!==summary)n.textContent=summary;});
    document.querySelectorAll('[data-nfc-mobile-action]').forEach(function(n){n.disabled=working;});
    document.querySelectorAll('[data-nfc-mobile-link]').forEach(function(n){if(n.value!==link)n.value=link;});
    paintTest();
  }
  async function tick(){
    mount();var current=user();
    if(current!==lastUser){
      ++queue.epoch;if(queue.binding)queue.binding.running=false;queue.binding=null;queue.blocked=false;
      client.clear();reader=null;link='';enrollment=null;summary='';trial=null;paintTest();lastUser=current;
      var state=saved();if(current&&state.enrollment&&state.enrollment.user===current)enrollment=state.enrollment;
      message='Conecte o NFC.cool Platinum para cadastrar chips e receber as leituras.';paint();
    }
    if(ticking||working||!current||document.hidden)return;ticking=true;
    try{if(enrollment)await checkEnrollment();else await queue.poll();}catch(error){notice(error.message);}finally{ticking=false;}
  }
  root.WmsNfcMobile={active:function(){return working||!!enrollment||!!(queue.binding&&queue.binding.running);},queue:queue};
  setInterval(tick,2500);document.addEventListener('visibilitychange',tick);tick();
})(typeof window!=='undefined'?window:globalThis);
