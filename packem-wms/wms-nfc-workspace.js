/* Área NFC: controles separados das telas normais de estoque e impressão. */
(function(root){
  'use strict';
  var destinations={'v-labels':'Cadastrar tags','v-floor70':'Chão de Fábrica - 70','v-floor':'Expedição - 71','v-recic':'Recicladora - 91','v-inv':'Inventário'};
  function permitted(target,allowed){return Object.hasOwn(destinations,target)&&(!allowed||allowed.includes(target));}
  if(typeof module==='object'&&module.exports){module.exports={permitted:permitted};return;}
  var page=document.getElementById('v-nfc');if(!page)return;
  var mode='register',destination='v-floor70',lastPermissions='',lastUser='';
  function allowed(){return typeof root.allowedViews==='function'?root.allowedViews():null;}
  function active(){return (document.querySelector('.view.active')||{}).id;}
  function selected(){return mode==='register'?'v-labels':destination;}
  function isActive(target){return permitted(target,allowed())&&(active()===target||active()==='v-nfc'&&selected()===target);}
  function busy(){return [root.WmsNfcMobile,root.PackemWmsApp,root.WmsNfcDireto,root.PackemNfcIphone].some(function(reader){return reader&&reader.active();})||(root.WmsNfcReader&&root.WmsNfcReader.bridgeActive());}
  function host(target,alternative){
    var node=page.querySelector('[data-nfc-host="'+target+'"]');
    return alternative?node?.querySelector('[data-nfc-other-host]'):node?.querySelector('[data-nfc-main-host]');
  }
  function notice(text){page.querySelector('[data-nfc-workspace-status]').textContent=text;}
  function paint(){
    page.querySelectorAll('[data-nfc-mode]').forEach(function(button){var on=button.dataset.nfcMode===mode;button.classList.toggle('on',on);button.setAttribute('aria-selected',String(on));});
    page.querySelector('[data-nfc-destination-field]').hidden=mode!=='count';
    page.querySelectorAll('[data-nfc-host]').forEach(function(node){node.hidden=node.dataset.nfcHost!==selected()||!permitted(selected(),allowed());});
    page.querySelector('[data-nfc-workspace-empty]').hidden=permitted(selected(),allowed());
    var link=page.querySelector('[data-nfc-open-destination]');link.hidden=mode!=='count'||!permitted(destination,allowed());
    link.textContent='Abrir '+(destinations[destination]||'contagem')+' na aba normal';
  }
  function change(nextMode,nextDestination){
    if((nextMode!==mode||nextDestination!==destination)&&busy()){notice('Pause a leitura ou encerre o cadastro antes de trocar a operação NFC.');return false;}
    mode=nextMode;destination=nextDestination;notice('');paint();return true;
  }
  Object.keys(destinations).forEach(function(target){
    var section=document.createElement('div');section.dataset.nfcHost=target;section.hidden=true;
    var main=document.createElement('div');main.dataset.nfcMainHost='1';section.appendChild(main);
    if(target==='v-inv'){
      var hint=document.createElement('p');hint.textContent='Primeiro selecione a tarefa e a vaga/passada na aba Inventário. Depois volte aqui para iniciar a leitura NFC. As confirmações continuam no inventário.';main.appendChild(hint);
    }
    var alternatives=document.createElement('details');alternatives.className='panel';alternatives.style.cssText='padding:16px;margin-top:16px';
    var title=document.createElement('summary');title.textContent='Outras integrações NFC';alternatives.appendChild(title);
    var other=document.createElement('div');other.dataset.nfcOtherHost='1';alternatives.appendChild(other);section.appendChild(alternatives);page.appendChild(section);
  });
  var select=page.querySelector('[data-nfc-destination]');
  page.querySelectorAll('[data-nfc-mode]').forEach(function(button){button.onclick=function(){change(button.dataset.nfcMode,destination);};});
  select.onchange=function(){if(!change(mode,select.value))select.value=destination;};
  page.querySelector('[data-nfc-open-destination]').onclick=function(){if(permitted(destination,allowed())&&typeof root.go==='function')root.go(destination);};
  function refresh(){
    var user=typeof session!=='undefined'&&session?session.u:'',permissions=allowed(),key=JSON.stringify(permissions);
    if(key===lastPermissions&&user===lastUser)return;
    lastPermissions=key;lastUser=user;
    select.replaceChildren();
    Object.entries(destinations).filter(function(entry){return entry[0]!=='v-labels'&&permitted(entry[0],permissions);}).forEach(function(entry){var option=document.createElement('option');option.value=entry[0];option.textContent=entry[1];select.appendChild(option);});
    if(!permitted(destination,permissions))destination=select.options[0]?.value||'';
    if(!permitted('v-labels',permissions))mode='count';
    page.querySelector('[data-nfc-mode="register"]').disabled=!permitted('v-labels',permissions);
    page.querySelector('[data-nfc-mode="count"]').disabled=!select.options.length;
    select.value=destination;paint();
  }
  root.WmsNfcWorkspace={host:host,isActive:isActive};
  refresh();paint();setInterval(refresh,1000);
})(typeof window!=='undefined'?window:globalThis);
