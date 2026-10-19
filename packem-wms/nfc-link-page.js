(function(){
  'use strict';
  var core=window.PackemNfcLinkCore;
  var byId=function(id){return document.getElementById(id);};
  function receiveLink(){
    var hash=window.location.hash;
    // Também trata uma segunda etiqueta ou teste aberto na mesma aba.
    if(hash)window.history.replaceState(null,'',window.location.pathname+window.location.search);
    ['nfc-received','nfc-generator','nfc-invalid'].forEach(function(id){byId(id).hidden=true;});
    try{
      var code=core.parseFragment(hash);
      if(code){
        byId('nfc-code').textContent=code;
        byId('nfc-open').href='index.html#etiqueta='+encodeURIComponent(code);
        byId('nfc-received').hidden=false;byId('nfc-open').focus();
      }else{byId('nfc-generator').hidden=false;}
    }catch(error){byId('nfc-invalid-message').textContent=error.message;byId('nfc-invalid').hidden=false;}
  }
  receiveLink();window.addEventListener('hashchange',receiveLink);
  byId('nfc-form').addEventListener('submit',function(event){
    event.preventDefault();byId('nfc-error').hidden=true;byId('nfc-generated').hidden=true;
    try{
      var url=core.buildURL(window.location.href,byId('nfc-input').value);
      byId('nfc-url').value=url;byId('nfc-test').href=url;byId('nfc-generated').hidden=false;byId('nfc-copy-status').textContent='';
    }catch(error){byId('nfc-error').textContent=error.message;byId('nfc-error').hidden=false;}
  });
  byId('nfc-copy').onclick=async function(){
    try{await navigator.clipboard.writeText(byId('nfc-url').value);byId('nfc-copy-status').textContent='Link copiado. Grave-o como URL / URI na etiqueta.';}
    catch(_){byId('nfc-url').focus();byId('nfc-url').select();byId('nfc-copy-status').textContent='Selecione e copie o link acima.';}
  };
})();
