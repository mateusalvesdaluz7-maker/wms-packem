(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory;
  else factory(root,root.document,root.PackemNfcCore);
})(typeof window!=='undefined'?window:this,function(win,doc,core){
  'use strict';
  if(!doc||!core)return null;
  var bindings=new WeakMap(),choice=null,dialog=null;
  function node(tag,text,cls){
    var el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;
  }
  function bridge(){
    var handler=win.webkit&&win.webkit.messageHandlers&&win.webkit.messageHandlers.packemNFC;
    return handler&&typeof handler.postMessage==='function'?handler:null;
  }
  function note(text,error){
    if(!choice)return;
    var binding=bindings.get(choice.input);
    if(binding){binding.note.hidden=false;binding.note.textContent=text;binding.note.className='packem-nfc-result'+(error?' error':'');}
  }
  var reader=core.createReader({
    send:function(message){var handler=bridge();if(!handler)throw new Error('Leitor NFC nativo indisponível.');handler.postMessage(message);},
    deliver:function(code,context){
      if(!context.input.isConnected||context.input.disabled||doc.getElementById(context.id)!==context.input)return false;
      if(typeof win.applyPackemNfcScan!=='function')return false;
      return win.applyPackemNfcScan(context.id,code,context.options,context.authorization);
    },
    onState:function(event){
      ensureDialog();
      dialog.status.textContent=event.message;
      var busy=event.status==='scanning'||event.status==='busy';
      dialog.scan.disabled=busy||!bridge();dialog.mode.disabled=busy;
      if(event.status==='delivered'){
        note('NFC: '+event.code+' · leitura enviada à conferência.',false);dialog.overlay.hidden=true;
      }else if(event.status==='error'){note(event.message,true);}
    }
  });
  function close(){
    if(reader.isBusy()&&!reader.cancel()){dialog.status.textContent='Aguarde a conferência da leitura atual.';return;}
    dialog.overlay.hidden=true;
    if(choice&&choice.button)choice.button.focus();
  }
  function ensureDialog(){
    if(dialog)return;
    var overlay=node('div',undefined,'packem-nfc-overlay');overlay.hidden=true;
    var panel=node('section',undefined,'packem-nfc-panel');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','packem-nfc-title');
    var head=node('div',undefined,'packem-nfc-head'),title=node('h2','Ler etiqueta NFC');title.id='packem-nfc-title';
    var dismiss=node('button','Fechar');dismiss.type='button';dismiss.className='packem-nfc-close';dismiss.onclick=close;
    head.appendChild(title);head.appendChild(dismiss);panel.appendChild(head);
    panel.appendChild(node('p','A leitura identifica a etiqueta. O WMS continua conferindo o material, a operação e suas permissões.'));
    var label=node('label','O que está cadastrado no WMS?'),mode=node('select');mode.id='packem-nfc-mode';label.htmlFor=mode.id;
    [['ndef','Código gravado na etiqueta'],['uid','Identificador da etiqueta (UID)']].forEach(function(entry){var option=node('option',entry[1]);option.value=entry[0];mode.appendChild(option);});
    var status=node('p',undefined,'packem-nfc-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    var scan=node('button','Encostar e ler');scan.type='button';scan.className='packem-nfc-start';
    var hint=node('small','Use UID somente quando esse identificador estiver vinculado à etiqueta no seu WMS. Os dois modos não são equivalentes.');
    scan.onclick=function(){
      if(!choice||reader.isBusy())return;
      var authorization=typeof win.packemNfcContext==='function'?win.packemNfcContext(choice.id,choice.options):null;
      if(!authorization){status.textContent='Confira o login, a tela e a permissão do campo antes de ler.';return;}
      choice.authorization=authorization;
      reader.start(choice,{mode:mode.value});
    };
    panel.appendChild(label);panel.appendChild(mode);panel.appendChild(status);panel.appendChild(scan);panel.appendChild(hint);
    overlay.appendChild(panel);doc.body.appendChild(overlay);
    overlay.addEventListener('keydown',function(event){
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        var controls=[dismiss,mode,scan].filter(function(el){return !el.disabled;});
        if(!controls.length)return;
        var first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    dialog={overlay:overlay,status:status,mode:mode,scan:scan,dismiss:dismiss};
  }
  function open(input,binding){
    ensureDialog();
    if(reader.isBusy()){dialog.status.textContent='Aguarde a leitura ou o processamento atual.';dialog.overlay.hidden=false;return;}
    choice={id:input.id,input:input,options:Object.assign({},binding.options),button:binding.button};
    dialog.mode.value='ndef';dialog.mode.disabled=false;
    var authorization=typeof win.packemNfcContext==='function'?win.packemNfcContext(input.id,choice.options):null;
    dialog.scan.disabled=!bridge()||!authorization;
    dialog.status.textContent=!authorization?'Confira o login, a tela e a permissão do campo.':bridge()?'Escolha o conteúdo e toque em Encostar e ler.':'O navegador não acessa o NFC do iPhone. Abra este WMS no app Packem com NFC. A leitura física não está ativa nesta página.';
    dialog.overlay.hidden=false;dialog.dismiss.focus();
  }
  function attach(inputId,options){
    var input=doc.getElementById(inputId);
    if(!input||input.type==='hidden'||!input.parentNode)return false;
    var old=bindings.get(input);
    if(old){old.options=Object.assign({},options||{});return true;}
    var wrapper=input.parentNode;
    var button=node('button','NFC','packem-nfc-button');button.type='button';button.title='Ler esta etiqueta por NFC';button.setAttribute('aria-label','Ler '+(options&&options.title||'etiqueta')+' por NFC');
    var result=node('small',undefined,'packem-nfc-result');result.hidden=true;result.setAttribute('role','status');
    var binding={options:Object.assign({},options||{}),button:button,note:result};
    bindings.set(input,binding);input.style.paddingRight='112px';
    wrapper.appendChild(button);
    if(wrapper.parentNode)wrapper.parentNode.insertBefore(result,wrapper.nextSibling);
    button.onclick=function(){open(input,binding);};
    return true;
  }
  var api={attach:attach,receive:function(payload){void reader.receive(payload);},cancel:function(){return reader.cancel();}};
  win.PackemNFC=api;
  win.addEventListener('pagehide',api.cancel);
  doc.addEventListener('visibilitychange',function(){if(doc.hidden)reader.cancel();});
  return api;
});
