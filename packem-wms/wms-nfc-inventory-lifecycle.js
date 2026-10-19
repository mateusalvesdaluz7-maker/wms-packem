/* Inventários encerrados têm resultado próprio; uma nova captura começa vazia. */
(function(root){
  'use strict';
  function createManager(options){
    var owner=options.user(),state={current:null,history:[],detail:null,offset:0,hasMore:false,busy:false,loaded:false,message:''};
    function guard(){if(!owner||options.user()!==owner||!options.active())throw new Error('Abra Inventário NFC com o mesmo usuário.');}
    async function run(callback){guard();if(state.busy)throw new Error('Aguarde a operação do inventário.');state.busy=true;try{return await callback();}finally{state.busy=false;}}
    async function list(offset){var result=await options.api('inventory_list',{readerId:await options.reader(),offset:offset});guard();state.current=result.current;state.history=result.history;state.hasMore=result.hasMore;state.offset=offset;state.loaded=true;return result;}
    return {state:state,load:function(offset){return run(()=>list(offset||0));},
      begin:function(fresh){return run(async function(){var status=await list(0);if(fresh&&status.current)throw new Error('Encerre o inventário em andamento antes de iniciar outro.');var previous=options.capture();if(fresh&&previous?.viewTarget==='v-nfc-test'&&status.history.some(item=>item.id===previous.sessionId))options.completed(previous.sessionId);var binding=await options.start(fresh,status);guard();state.detail=null;state.current={id:binding.sessionId,active:true,createdAt:new Date().toISOString()};state.message=fresh?'Novo inventário iniciado. A contagem começa do zero.':'Inventário retomado.';});},
      finish:function(){return run(async function(){
        var capture=options.capture();if(!capture||capture.viewTarget!=='v-nfc-test')throw new Error('Retome o inventário nesta tela antes de encerrar.');
        // An uncertain HTTP reply may have followed a committed finish.
        var status=await list(0),result;
        if(!status.current||status.current.id!==capture.sessionId){
          result=await options.api('inventory_get',{readerId:capture.readerId,sessionId:capture.sessionId});
        }else{
          await options.prepare();guard();if(options.capture()!==capture)throw new Error('A contagem mudou. Retome o inventário antes de encerrar.');
          var entries=options.entries();if(entries.some(entry=>!entry.confirmed))throw new Error('Há leituras aguardando confirmação. Tente novamente após processar a fila.');
          result=await options.api('inventory_finish',{readerId:capture.readerId,sessionId:capture.sessionId,consumerId:capture.consumerId,entries:entries});
        }
        guard();if(result.id!==capture.sessionId||!result.finishedAt||!Array.isArray(result.entries))throw new Error('O encerramento não foi confirmado. Confira antes de iniciar outro inventário.');
        options.completed(result.id);state.current=null;state.detail=result;state.history=[result,...state.history.filter(item=>item.id!==result.id)];state.message='Inventário encerrado e salvo. Use Iniciar novo inventário para contar novamente.';
      });},
      select:function(id){return run(async function(){var result=await options.api('inventory_get',{readerId:await options.reader(),sessionId:id});guard();if(result.id!==id||!result.finishedAt)throw new Error('Resultado do inventário inválido.');state.detail=result;});}
    };
  }
  if(typeof module==='object'&&module.exports){module.exports={createManager:createManager};return;}
  if(!document.querySelector('[data-nfc-inventory-screen]'))return;
  var manager=null,owner='',controls=null,status,history,detail,newButton,resumeButton,finishButton,lastLoad=0,loadedReader='',error='';
  function user(){return typeof session!=='undefined'&&session?session.u:'';}
  function active(){return !!user()&&!document.hidden&&!!root.WmsNfcWorkspace?.isActive('v-nfc-test');}
  function mobile(){return root.WmsNfcMobile;}
  function ensureManager(){
    if(owner===user()&&manager)return;
    owner=user();lastLoad=0;loadedReader='';error='';manager=null;if(!owner)return;
    manager=createManager({user:user,active:active,api:mobile().inventory.request,reader:mobile().inventory.reader,start:mobile().inventory.start,
      capture:()=>mobile().queue.binding,entries:()=>mobile().queue.entries(),completed:mobile().inventory.completed,
      prepare:async function(){var queue=mobile().queue;if(queue.busy)throw new Error('Aguarde a leitura atual terminar e toque em Encerrar inventário novamente.');
        for(var page=0;page<10&&queue.binding&&queue.binding.historyCursor<queue.binding.historyUntil&&!queue.binding.historyError;page++){
          if(!active())throw new Error('Volte ao Inventário NFC antes de encerrar.');
          var previous=queue.binding.historyCursor;await queue.loadHistory();
          if(queue.binding&&queue.binding.historyCursor===previous&&!queue.binding.historyError)throw new Error('A consulta dos detalhes foi interrompida. Use Atualizar detalhes.');
        }
        if(queue.binding?.historyError)throw new Error('Use Atualizar detalhes antes de encerrar o inventário.');
        await queue.poll();if(queue.blocked)throw new Error('Confira as leituras pendentes e use Tentar novamente antes de encerrar.');}});
  }
  async function action(callback){if(!manager||manager.state.busy)return;error='';try{var pending=mobile().inventory.perform(callback);paint();await pending;}catch(e){error=e.message;}paint();}
  function text(node,value){if(node.textContent!==value)node.textContent=value;}
  function date(value){return new Date(value).toLocaleString('pt-BR');}
  function mount(){
    var host=document.querySelector('[data-nfc-inventory-controls]');if(!host||controls===host)return;
    controls=host;function button(label,callback){var node=document.createElement('button');node.type='button';node.className='gbtn';node.textContent=label;node.onclick=()=>action(callback);controls.appendChild(node);return node;}
    newButton=button('Iniciar novo inventário',()=>manager.begin(true));newButton.className='btn brand';
    resumeButton=button('Retomar inventário',()=>manager.begin(false));finishButton=button('Encerrar inventário',()=>manager.finish());
    var section=document.createElement('section');section.dataset.nfcInventoryLifecycle='1';section.style.cssText='margin:12px 0';
    status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');section.appendChild(status);controls.before(section);
    var past=document.createElement('details');past.style.cssText='margin-top:18px';var caption=document.createElement('summary');caption.textContent='Inventários encerrados';past.appendChild(caption);
    history=document.createElement('div');history.style.cssText='display:grid;gap:8px;margin-top:10px';past.appendChild(history);
    detail=document.createElement('div');detail.style.cssText='overflow-x:auto';past.appendChild(detail);host.parentElement.appendChild(past);
  }
  function paint(){
    if(!controls)return;var state=manager?.state,busy=!!state?.busy||!!mobile().enrollmentState().working;
    newButton.disabled=busy||!state?.loaded||!!state.current;resumeButton.disabled=busy||!state?.current;finishButton.disabled=busy||!state?.current;
    if(mobile().queue.binding?.running&&mobile().queue.binding.sessionId===state?.current?.id)resumeButton.disabled=true;
    resumeButton.hidden=!state?.current;finishButton.hidden=!state?.current;
    text(status,error||state?.message||(state?.current?'Inventário em andamento. Retome para continuar ou encerre para salvar o resultado.':state?.loaded?'Nenhum inventário em andamento. Inicie um novo inventário para contar.':'Carregando o inventário…'));
    var key=JSON.stringify([state?.history,state?.offset,state?.hasMore]);if(history.dataset.key!==key){history.dataset.key=key;history.replaceChildren();
      (state?.history||[]).forEach(function(item){var button=document.createElement('button');button.type='button';button.className='gbtn';button.textContent=date(item.finishedAt)+' · '+item.items+' bobina(s) · Ver resultado';button.onclick=()=>action(()=>manager.select(item.id));history.appendChild(button);});
      if(!state?.history.length){var empty=document.createElement('p');empty.textContent='Nenhum inventário encerrado nesta página.';history.appendChild(empty);}
      [['Anteriores',Math.max(0,(state?.offset||0)-20),!!state?.offset],['Mais antigos',(state?.offset||0)+20,state?.hasMore]].forEach(function(page){if(page[2]){var button=document.createElement('button');button.type='button';button.className='gbtn';button.textContent=page[0];button.onclick=()=>action(()=>manager.load(page[1]));history.appendChild(button);}});
    }
    var result=state?.detail;if(detail.dataset.key===(result?.id||''))return;detail.dataset.key=result?.id||'';detail.replaceChildren();if(!result)return;
    var title=document.createElement('h4');title.textContent='Resultado encerrado em '+date(result.finishedAt);detail.appendChild(title);
    var totals={};result.entries.forEach(item=>totals[item.unidade]=Math.round(((totals[item.unidade]||0)+Number(item.quantidade))*1e6)/1e6);
    var summary=document.createElement('p');summary.textContent=result.entries.length+' bobina(s) · '+Object.entries(totals).map(([unit,value])=>value.toLocaleString('pt-BR',{maximumFractionDigits:6})+' '+unit).join(' · ');detail.appendChild(summary);
    var table=document.createElement('table');table.className='packem-nfc-count-table';table.style.cssText='width:100%;text-align:left';
    var head=document.createElement('thead'),row=document.createElement('tr'),columns=['Etiqueta / bobina','Código do material','Peso líquido / quantidade'];columns.forEach(label=>{var cell=document.createElement('th');cell.scope='col';cell.textContent=label;row.appendChild(cell);});head.appendChild(row);table.appendChild(head);
    var body=document.createElement('tbody');result.entries.forEach(item=>{var row=document.createElement('tr');[item.item,item.codigo,Number(item.quantidade).toLocaleString('pt-BR',{maximumFractionDigits:6})+' '+item.unidade].forEach((value,index)=>{var cell=document.createElement('td'),label=document.createElement('span'),text=document.createElement('span');label.className='packem-nfc-cell-label';label.textContent=columns[index];label.setAttribute('aria-hidden','true');text.className='packem-nfc-cell-value';text.textContent=value;cell.appendChild(label);cell.appendChild(text);cell.style.cssText='padding:10px;border-bottom:1px solid #d5dfe9;overflow-wrap:anywhere';row.appendChild(cell);});body.appendChild(row);});table.appendChild(body);detail.appendChild(table);
  }
  async function tick(){
    mount();if(!controls||!mobile()?.inventory)return;ensureManager();paint();
    if(mobile().inventory.selectedReader()!==loadedReader){loadedReader=mobile().inventory.selectedReader();lastLoad=0;}
    if(!active()||!manager||manager.state.busy||mobile().enrollmentState().working||Date.now()-lastLoad<15000)return;
    lastLoad=Date.now();var current=manager;try{var pending=current.load();paint();await pending;if(current!==manager)return;error='';}catch(e){if(current!==manager)return;error=e.message;}paint();
  }
  setInterval(tick,750);tick();
})(typeof window!=='undefined'?window:globalThis);
