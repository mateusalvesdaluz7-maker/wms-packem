/* A etiqueta impressa em Rastreável usa o mesmo ID no vínculo NFC. */
(function(root){
  'use strict';
  function createContext(id,options){
    var owner=options.user();
    var context={isActive:function(){return !!owner&&owner===options.user()&&options.visible()&&options.view()==='v-labels'&&options.tab()==='rast'&&options.permitted()&&options.available(id);},
      lookup:async function(item){
        if(item!==id||!context.isActive())throw new Error('Abra Rastreável e escolha novamente a etiqueta gerada.');
        if(await options.sync(id)!==true)throw new Error('A etiqueta '+id+' já foi criada, mas ainda não sincronizou. Tente vincular novamente o mesmo ID.');
        if(!context.isActive())throw new Error('A tela, a etiqueta ou o usuário mudou durante a sincronização.');
        var record=await options.lookup(id);
        if(!context.isActive())throw new Error('A tela, a etiqueta ou o usuário mudou durante a consulta.');
        return record;
      }};
    return context;
  }
  if(typeof module==='object'&&module.exports){module.exports={createContext:createContext};return;}
  var host=document.getElementById('lblRast');if(!host)return;
  var owner='',ids=[],cards=new Map();
  function user(){return typeof session!=='undefined'&&session?session.u:'';}
  function permitted(){var views=typeof root.allowedViews==='function'?root.allowedViews():null;return !views||views.includes('v-labels');}
  function records(){return root.WmsNfcLabels?root.WmsNfcLabels.sources().etq:{};}
  function manual(record){return !!record&&record.nf==='__vaga__';}
  function key(){return 'packem-nfc-rastreavel:'+owner;}
  function remember(){try{sessionStorage.setItem(key(),JSON.stringify(ids.slice(0,100)));}catch(_){}}
  var panel=document.createElement('section');panel.id='packemNfcRastreavel';panel.setAttribute('aria-labelledby','packemNfcRastreavelTitle');panel.style.cssText='margin-top:18px;padding:16px;border:1px solid #0d8571;border-radius:12px;overflow-wrap:anywhere';
  var title=document.createElement('h3');title.id='packemNfcRastreavelTitle';title.textContent='Vincular chip NFC à etiqueta';title.style.marginTop='0';panel.appendChild(title);
  var instruction=document.createElement('p');instruction.textContent='Gere a etiqueta acima. Depois escolha o ID abaixo, toque em Vincular tag NFC e leia o chip no TapPony com Lote desligado. O código e o peso ou metragem serão os mesmos da etiqueta impressa.';panel.appendChild(instruction);
  var message=document.createElement('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');panel.appendChild(message);
  var list=document.createElement('div');list.style.cssText='display:grid;gap:12px';panel.appendChild(list);host.appendChild(panel);
  function setText(node,text){if(node.textContent!==text)node.textContent=text;}
  function refresh(){
    var current=user();
    if(current!==owner){
      owner=current;ids=[];cards.clear();list.replaceChildren();
      try{var saved=JSON.parse(sessionStorage.getItem(key())||'[]');if(Array.isArray(saved))ids=[...new Set(saved.filter(id=>typeof id==='string'&&/^[A-Za-z0-9._/-]{1,32}$/.test(id)))].slice(0,100);}catch(_){}
    }
    panel.hidden=!owner||!permitted();panel.style.display=panel.hidden?'none':'block';
    if(panel.hidden)return;
    var source=records();
    cards.forEach(function(card,id){card.hidden=!manual(source[id]);});
    ids.forEach(function(id){
      var record=source[id];if(!manual(record))return;
      var item=root.WmsNfcLabels.normalize(record,typeof unitOf==='function'?unitOf:null),card=cards.get(id);
      if(!card){
        card=document.createElement('article');card.dataset.nfcRastreavel=id;card.style.cssText='padding:14px;border:1px solid var(--line,#cbd5e1);border-radius:10px;background:var(--card,#fff)';
        var text=document.createElement('p');text.style.cssText='font-weight:700;margin:0 0 10px';card.appendChild(text);
        var button=document.createElement('button');button.type='button';button.className='gbtn';button.textContent='Vincular tag NFC';button.style.cssText='width:100%;justify-content:center;border-color:#0d8571';card.appendChild(button);
        var note=document.createElement('p');note.style.cssText='margin:10px 0 0;font-size:13px';card.appendChild(note);
        button.onclick=function(){
          if(!root.WmsNfcRecebimento?.register){setText(note,'Atualize o WMS com Ctrl + F5 para carregar o vínculo NFC.');return;}
          var context=createContext(id,{user:user,visible:()=>!document.hidden,view:()=>(document.querySelector('.view.active')||{}).id,
            tab:()=>document.querySelector('#lblTabs .on')?.dataset.t,permitted:permitted,available:item=>ids.includes(item)&&manual(records()[item]),
            lookup:root.WmsNfcLabels.lookupCurrent,sync:async function(item){var label=records()[item];if(!label||typeof syncEtiqueta!=='function')throw new Error('Sincronização da etiqueta indisponível. Atualize o WMS antes de vincular.');return await syncEtiqueta(label);}});
          root.WmsNfcRecebimento.register(id,{host:card,context:context}).catch(error=>setText(note,error.message));
        };
        cards.set(id,card);list.appendChild(card);
      }
      var text=card.children[0],button=card.children[1],note=card.children[2];
      setText(text,'Etiqueta '+id+(item?' · Código '+item.codigo+' · '+(item.unidade==='KG'?'Peso líquido':item.unidade==='MT'?'Metragem':'Quantidade')+': '+Number(item.quantidade).toLocaleString('pt-BR',{maximumFractionDigits:6})+' '+item.unidade:''));
      button.disabled=!item;
      if(!item)setText(note,'Para vincular NFC, a etiqueta precisa de código, quantidade maior que zero e unidade válida.');
      else if(note.textContent.startsWith('Para vincular NFC'))setText(note,'');
    });
    setText(message,ids.some(id=>manual(source[id]))?'Escolha uma etiqueta por vez. Cada ID deve receber seu próprio chip.':'Após gerar, a etiqueta aparecerá aqui para vincular o chip.');
  }
  root.addEventListener('packem-rastreavel-generated',function(event){
    refresh();var batch=event.detail;
    if(!owner||!permitted()||!batch||batch.owner!==owner||!Array.isArray(batch.ids))return;
    var incoming=batch.ids.filter(id=>typeof id==='string'&&/^[A-Za-z0-9._/-]{1,32}$/.test(id)&&manual(records()[id]));
    ids=[...new Set(incoming.concat(ids))];remember();refresh();
  });
  refresh();setInterval(refresh,1000);
})(typeof window!=='undefined'?window:globalThis);
