/* Consulta e desvinculação de chips na aba NFC; não altera estoque. */
(function(root){
  'use strict';
  function createManager(options){
    var generation=0,state={owner:'',rows:[],search:'',offset:0,hasMore:false,selected:null,details:null,confirming:false,busy:false,message:'Consulte as tags vinculadas para liberar um chip.'};
    function changed(){if(options.onChange)options.onChange(state);}
    function guard(){if(!state.owner||options.user()!==state.owner||!options.active())throw new Error('O usuário ou a tela mudou. Consulte a tag novamente.');}
    async function run(callback){
      if(state.busy)throw new Error('Aguarde a consulta atual terminar.');
      guard();var current=++generation,owner=state.owner;state.busy=true;changed();
      try{await callback(function(){guard();if(current!==generation||state.owner!==owner)throw new Error('A seleção mudou. Consulte a tag novamente.');});}
      catch(error){if(current===generation&&state.owner===options.user()){state.message=error.message;state.confirming=false;}throw error;}
      finally{if(current===generation){state.busy=false;changed();}}
    }
    return {state:state,clear:function(){generation++;Object.assign(state,{owner:'',rows:[],selected:null,details:null,confirming:false,busy:false,message:'Consulte as tags vinculadas para liberar um chip.'});changed();},
      load:async function(search,offset){
        if(state.busy)throw new Error('Aguarde a consulta atual terminar.');
        state.owner=options.user();
        return run(async function(current){
          state.selected=null;state.details=null;state.confirming=false;state.message='Consultando tags…';
          var data=await options.list(search,offset);current();
          Object.assign(state,{rows:data.rows,search:search,offset:offset,hasMore:data.hasMore,message:data.rows.length?'Selecione a etiqueta cujo chip deseja liberar.':'Nenhuma tag vinculada encontrada.'});
        });
      },
      select:async function(bindingId){
        return run(async function(current){
          var row=state.rows.find(record=>record.binding_id===bindingId);if(!row)throw new Error('Atualize a lista e selecione a tag novamente.');
          state.selected={...row};state.details=null;state.confirming=false;state.message='Consultando código e quantidade da etiqueta…';changed();
          var details=await options.lookup(row.item);current();state.details=details;
          state.message=details?'Confira o chip e a etiqueta antes de desvincular.':'Os detalhes da bobina não estão disponíveis. Confira o ID e o UID antes de continuar.';
        });
      },
      ask:function(){guard();if(state.busy||!state.selected)throw new Error('Selecione uma tag e aguarde a consulta.');if(options.blocked())throw new Error('Pause a contagem ou cancele o cadastro NFC antes de desvincular.');state.confirming=true;state.message='Confirme abaixo para liberar somente este chip.';changed();},
      cancel:function(){state.confirming=false;state.message='Desvinculação cancelada. O vínculo foi mantido.';changed();},
      confirm:async function(){
        if(!state.confirming||!state.selected)throw new Error('Confira a tag e confirme a desvinculação primeiro.');
        return run(async function(current){
          if(options.blocked())throw new Error('Pause a contagem ou cancele o cadastro NFC antes de desvincular.');
          var selected={...state.selected};state.message='Liberando o vínculo…';changed();
          var reply=await options.unbind(selected);current();
          state.rows=state.rows.filter(row=>row.binding_id!==selected.binding_id);state.selected=null;state.details=null;state.confirming=false;
          state.message=reply.available?'Chip '+selected.uid+' liberado. Escolha outra etiqueta e use Vincular tag NFC para reutilizá-lo.':'Este vínculo já foi removido, mas o chip recebeu outro cadastro. Atualize a lista antes de continuar.';
        });
      }};
  }
  if(typeof module==='object'&&module.exports){module.exports={createManager:createManager};return;}
  var page=document.getElementById('v-nfc-unlink')||document.getElementById('v-nfc');if(!page)return;
  var dedicated=page.id==='v-nfc-unlink';
  function user(){return typeof session!=='undefined'&&session?session.u:'';}
  function permitted(){var views=typeof root.allowedViews==='function'?root.allowedViews():null;return !views||views.includes('v-labels');}
  function active(){return !document.hidden&&permitted()&&(document.querySelector('.view.active')||{}).id===page.id;}
  function registry(){if(!root.PackemNfcRegistry?.list||!root.PackemNfcRegistry?.unbind)throw new Error('Atualize o WMS com Ctrl + F5 para carregar a gestão de chips.');return root.PackemNfcRegistry;}
  function blocked(){return [root.WmsNfcMobile,root.PackemWmsApp,root.WmsNfcDireto,root.PackemNfcIphone].some(reader=>reader&&reader.active())||!!root.WmsNfcReader?.bridgeActive();}
  var section=document.createElement(dedicated?'section':'details');section.className='panel';section.id='packemNfcTags';section.style.cssText='padding:20px;margin-top:20px;overflow-wrap:anywhere';
  var title=document.createElement(dedicated?'h2':'summary');title.textContent=dedicated?'Selecione o chip para liberar':'Tags vinculadas — desvincular e reutilizar';title.style.cssText='font-weight:700;font-size:18px;margin:0';section.appendChild(title);
  var count=document.createElement('span');count.className='packem-nfc-list-count';if(dedicated){var heading=document.createElement('div');heading.className='packem-nfc-unlink-heading';title.before(heading);heading.appendChild(title);heading.appendChild(count);}else section.appendChild(count);
  var hint=document.createElement('p');hint.className='packem-nfc-unlink-hint';hint.textContent='Libere o chip para usar em outra etiqueta. O cadastro da bobina, as quantidades e o histórico das contagens serão preservados.';section.appendChild(hint);
  var form=document.createElement('form');form.style.cssText='display:flex;gap:10px;flex-wrap:wrap;align-items:end';section.appendChild(form);
  var label=document.createElement('label');label.textContent='Buscar etiqueta ou UID';label.style.cssText='display:grid;gap:6px;flex:1;min-width:180px';form.appendChild(label);
  var search=document.createElement('input');search.type='search';search.maxLength=32;search.placeholder='ID da etiqueta ou UID do chip';search.style.cssText='padding:12px;border:1px solid #b8c8d7;border-radius:9px;width:100%;box-sizing:border-box';label.appendChild(search);
  function button(host,text){var node=document.createElement('button');node.type='button';node.className='gbtn';node.textContent=text;host.appendChild(node);return node;}
  var refresh=button(form,'Consultar tags');refresh.type='submit';
  var status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');section.appendChild(status);
  var workspace=document.createElement('div');workspace.className='packem-nfc-unlink-workspace';section.appendChild(workspace);var results=document.createElement('div');results.className='packem-nfc-unlink-results';workspace.appendChild(results);
  var list=document.createElement('div');list.className='packem-nfc-tag-list';list.style.cssText='display:grid;gap:8px';results.appendChild(list);
  var emptyList=document.createElement('div');emptyList.className='packem-nfc-empty';emptyList.textContent='Nenhuma tag nesta lista. Busque pelo ID da etiqueta ou pelo UID do chip.';results.appendChild(emptyList);
  var pagination=document.createElement('div');pagination.style.cssText='display:flex;gap:10px;margin:12px 0';results.appendChild(pagination);
  var previous=button(pagination,'Anterior'),next=button(pagination,'Próxima página');
  var selectionEmpty=document.createElement('div');selectionEmpty.className='packem-nfc-selection-empty';var selectionTitle=document.createElement('strong');selectionTitle.textContent='Confira antes de liberar';selectionEmpty.appendChild(selectionTitle);selectionEmpty.appendChild(document.createTextNode('Selecione uma etiqueta na lista para ver o código do material, a quantidade e o UID do chip.'));workspace.appendChild(selectionEmpty);
  var detail=document.createElement('div');detail.className='packem-nfc-tag-detail';detail.style.cssText='margin-top:16px;border:1px solid #0d8571;border-radius:10px;padding:16px';workspace.appendChild(detail);
  var detailTitle=document.createElement('h3');detailTitle.textContent='Etiqueta selecionada';detail.appendChild(detailTitle);
  var description=document.createElement('p');description.style.fontWeight='700';detail.appendChild(description);
  var chip=document.createElement('p');detail.appendChild(chip);
  var fields=document.createElement('div');fields.className='packem-nfc-tag-fields';detail.appendChild(fields);
  function field(label){var wrapper=document.createElement('div');wrapper.className='packem-nfc-tag-field';var caption=document.createElement('small');caption.textContent=label;var value=document.createElement('strong');wrapper.appendChild(caption);wrapper.appendChild(value);fields.appendChild(wrapper);return {caption:caption,value:value};}
  var material=field('Código do material'),amount=field('Quantidade');
  var unlink=button(detail,'Desvincular tag NFC');
  var confirmation=document.createElement('div');confirmation.className='packem-nfc-confirmation';confirmation.style.cssText='padding:14px;margin-top:12px;border:1px solid #cf6c23;border-radius:9px;background:#fff5e9;color:#512f11';detail.appendChild(confirmation);
  var question=document.createElement('p');confirmation.appendChild(question);
  var controls=document.createElement('div');controls.style.cssText='display:flex;gap:10px;flex-wrap:wrap';confirmation.appendChild(controls);
  var confirm=button(controls,'Confirmar desvinculação'),cancel=button(controls,'Cancelar');
  page.insertBefore(section,page.querySelector('[data-nfc-host]'));
  function visible(node,on,display){node.hidden=!on;node.style.display=on?(display||'block'):'none';}
  var model=createManager({user:user,active:active,list:(text,offset)=>registry().list(text,offset),lookup:id=>root.WmsNfcLabels.lookupCurrent(id),unbind:record=>registry().unbind(record),blocked:blocked,onChange:paint});
  var signature='';
  function paint(){
    var s=model.state;visible(section,permitted());status.textContent=s.message;refresh.disabled=s.busy;search.disabled=s.busy;
    count.textContent=s.owner?s.rows.length+' tag(s) nesta página':'';visible(emptyList,!!s.owner&&!s.rows.length&&!s.busy);visible(selectionEmpty,!s.selected);
    previous.disabled=s.busy;next.disabled=s.busy;visible(previous,s.offset>0,'inline-flex');visible(next,s.hasMore,'inline-flex');
    var key=s.rows.map(row=>row.binding_id).join('|');
    if(key!==signature){signature=key;list.replaceChildren();s.rows.forEach(function(row){var choice=button(list,'');choice.classList.add('packem-nfc-tag-choice');choice.setAttribute('aria-label','Etiqueta '+row.item+' · Chip '+row.uid);var item=document.createElement('strong');item.textContent='Etiqueta '+row.item;var uid=document.createElement('span');uid.textContent='Chip '+row.uid;choice.appendChild(item);choice.appendChild(uid);choice.style.cssText='width:100%;justify-content:flex-start;text-align:left;white-space:normal;overflow-wrap:anywhere';choice.dataset.nfcBinding=row.binding_id;choice.onclick=()=>perform(async function(){await model.select(row.binding_id);if(dedicated&&root.matchMedia('(max-width:850px)').matches)detail.scrollIntoView({block:'nearest'});});});}
    list.querySelectorAll('button').forEach(function(node){node.disabled=s.busy;node.setAttribute('aria-pressed',String(s.selected?.binding_id===node.dataset.nfcBinding));});
    visible(detail,!!s.selected);visible(confirmation,!!s.selected&&s.confirming);visible(unlink,!!s.selected&&!s.confirming,'inline-flex');
    unlink.disabled=confirm.disabled=cancel.disabled=s.busy;
    if(s.selected){
      var d=s.details;description.textContent='Etiqueta '+s.selected.item;visible(fields,!!d,'grid');if(d){material.value.textContent=d.codigo;amount.caption.textContent=d.unidade==='KG'?'Peso líquido':d.unidade==='MT'?'Metragem':'Quantidade';amount.value.textContent=Number(d.quantidade).toLocaleString('pt-BR',{maximumFractionDigits:6})+' '+d.unidade;}
      chip.textContent='Chip '+s.selected.uid;
      question.textContent='Liberar o chip '+s.selected.uid+' da etiqueta '+s.selected.item+'? A etiqueta impressa e o cadastro da bobina continuam no WMS. Para contar a nova bobina, vincule o chip novamente e inicie uma nova captura.';
    }
  }
  async function perform(callback){try{await callback();}catch(error){if(user()===model.state.owner){model.state.message=error.message;paint();}}}
  form.onsubmit=function(event){event.preventDefault();perform(()=>model.load(search.value.trim(),0));};
  previous.onclick=()=>perform(()=>model.load(model.state.search,Math.max(0,model.state.offset-20)));
  next.onclick=()=>perform(()=>model.load(model.state.search,model.state.offset+20));
  unlink.onclick=()=>perform(()=>model.ask());confirm.onclick=()=>perform(()=>model.confirm());cancel.onclick=()=>model.cancel();
  section.addEventListener('toggle',function(){if(section.open&&!model.state.owner)perform(()=>model.load(search.value.trim(),0));});
  var wasActive=false;
  setInterval(function(){if(model.state.owner&&model.state.owner!==user())model.clear();visible(section,permitted());var nowActive=active();if(dedicated&&nowActive&&!wasActive&&!model.state.busy)perform(()=>model.load(search.value.trim(),0));wasActive=nowActive;},750);
  root.WmsNfcTags={open:function(item){if(typeof root.go==='function')root.go(page.id);section.open=true;search.value=item||'';section.scrollIntoView({block:'start'});return perform(()=>model.load(search.value.trim(),0));}};
  paint();
})(typeof window!=='undefined'?window:globalThis);
