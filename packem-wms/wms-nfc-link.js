(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory;
  else factory(root,root.document,root.PackemNfcLinkCore);
})(typeof window!=='undefined'?window:this,function(win,doc,core){
  'use strict';
  var storage;try{storage=win.sessionStorage;}catch(_){storage=null;}
  var inbox=core.createInbox(storage),dialog=null,shownUser=null;
  function element(tag,text,cls){var el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
  function user(){return typeof win.packemNfcLinkUser==='function'?win.packemNfcLinkUser():null;}
  function close(){if(dialog){dialog.root.hidden=true;if(dialog.previous&&dialog.previous.isConnected)dialog.previous.focus();}shownUser=null;}
  function discard(){inbox.clear();close();}
  function ensureDialog(){
    if(dialog)return;
    var root=element('div',undefined,'nfc-wms-overlay');root.hidden=true;
    var panel=element('section',undefined,'nfc-wms-panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','nfc-wms-title');
    var title=element('h2','Etiqueta recebida por link NFC');title.id='nfc-wms-title';
    var code=element('strong',undefined,'nfc-code'),status=element('p');status.setAttribute('role','status');
    var apply=element('button','Conferir esta etiqueta','nfc-primary');apply.type='button';
    var cancel=element('button','Descartar leitura','nfc-outline');cancel.type='button';cancel.onclick=discard;
    panel.appendChild(title);panel.appendChild(code);panel.appendChild(status);panel.appendChild(apply);panel.appendChild(cancel);
    panel.appendChild(element('small','O link preenche somente a Consulta de Etiqueta. Nenhuma movimentação é executada.'));
    root.appendChild(panel);doc.body.appendChild(root);
    root.addEventListener('keydown',function(event){
      if(event.key==='Escape'){event.preventDefault();discard();}
      if(event.key==='Tab'){
        var first=apply.disabled?cancel:apply;
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();cancel.focus();}
        else if(!event.shiftKey&&doc.activeElement===cancel){event.preventDefault();first.focus();}
      }
    });
    apply.onclick=function(){
      var reading=inbox.read(),current=user();
      if(!reading){status.textContent='A leitura expirou. Aproxime a etiqueta novamente.';apply.disabled=true;return;}
      if(!current||current.user!==shownUser||!current.canConsult){inbox.clear();status.textContent='A sessão ou a permissão mudou. Faça uma nova leitura.';apply.disabled=true;return;}
      if(typeof win.applyPackemNfcLink!=='function'||win.applyPackemNfcLink(reading.code,current.user)!==true){status.textContent='Não foi possível abrir a consulta. Confira suas permissões.';return;}
      inbox.clear();close();
      if(typeof win.toast==='function')win.toast('Etiqueta preenchida. Toque em Consultar para conferir o material.');
    };
    dialog={root:root,code:code,status:status,apply:apply,cancel:cancel};
  }
  function onLogin(){
    var reading=inbox.read(),current=user();
    if(!reading||!current)return false;
    ensureDialog();shownUser=current.user;dialog.previous=doc.activeElement;
    dialog.code.textContent=reading.code;
    dialog.status.textContent=current.canConsult?'Confira o código e continue para a Consulta de Etiqueta.':'Seu perfil não permite acessar a Consulta de Etiqueta. Nenhum dado foi aplicado.';
    dialog.apply.disabled=!current.canConsult;dialog.root.hidden=false;
    (current.canConsult?dialog.apply:dialog.cancel).focus();return true;
  }
  function capture(){
    var hash=win.location.hash;
    if(!hash||!/^#etiqueta(?:=|&|$)/.test(hash))return;
    var result=inbox.capture(hash);
    win.history.replaceState(null,'',win.location.pathname+win.location.search);
    if(result.status==='error'){
      close();if(typeof win.toast==='function')win.toast(result.message,false);
    }else onLogin();
  }
  var api={onLogin:onLogin,onLogout:discard};win.PackemNfcLink=api;
  capture();win.addEventListener('hashchange',capture);
  return api;
});
