const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../nfc-link-core');
const createUI=require('../wms-nfc-link');
const app=fs.readFileSync(path.join(__dirname,'../wms-app.js'),'utf8');
const handoff=app.split('/* PACKEM_NFC_LINK_HANDOFF_START:')[1].split('\n').slice(1).join('\n').split('/* PACKEM_NFC_LINK_HANDOFF_END */')[0];
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}

test('link NFC conserva zeros, maiúsculas/minúsculas e caracteres de códigos do WMS',()=>{
  for(const code of ['000015','ETQ-001','abc_02.3','2026/001']){
    const url=core.buildURL('https://wms.example.test/packem/index.html',code);
    assert.equal(new URL(url).pathname,'/packem/nfc.html');
    assert.equal(new URL(url).search,'');
    assert.equal(core.parseFragment(new URL(url).hash),code);
  }
});
for(const input of ['','   ','<img>','javascript:x','https://evil.test','A\nB','A B','A\u0085B','A&quantidade=5','a'.repeat(129),null,15]){
  test('código inválido não vira link: '+JSON.stringify(input),()=>assert.throws(()=>core.buildURL('https://wms.example.test/',input)));
}
test('base precisa ser HTTPS sem credenciais',()=>{
  for(const base of ['http://wms.example.test/','javascript:alert(1)','https://user:secret@wms.example.test/'])assert.throws(()=>core.buildURL(base,'A'));
});
test('fragmento não aceita instruções, duplicatas, codificação inválida ou HTML',()=>{
  assert.equal(core.parseFragment(''),null);
  for(const hash of ['#etiqueta=A&etiqueta=A','#etiqueta=A&action=saida','#quantidade=1','#etiqueta=%ZZ','#etiqueta=%3Cscript%3E','#etiqueta=','#etiqueta='+('A'.repeat(1601))])assert.throws(()=>core.parseFragment(hash));
});
test('pendente atravessa reload na mesma aba e expira em quinze minutos',()=>{
  let now=100000;const saved=storage(),inbox=core.createInbox(saved,()=>now);
  inbox.capture('#etiqueta=0001');
  assert.equal(core.createInbox(saved,()=>now).read().code,'0001');
  now+=core.ttl;assert.equal(inbox.read(),null);assert.equal(saved.getItem(core.storageKey),null);
});
test('pendente adulterado, futuro ou corrompido é descartado',()=>{
  for(const raw of ['bad','null',JSON.stringify({code:'A',at:Infinity}),JSON.stringify({code:'A',at:9999999}),JSON.stringify({code:'<img>',at:100})]){
    const saved=storage();saved.setItem(core.storageKey,raw);
    assert.equal(core.createInbox(saved,()=>100).read(),null);
  }
});
test('link inválido remove código anterior; nova leitura válida substitui uma única pendência',()=>{
  const inbox=core.createInbox(storage(),()=>100);
  inbox.capture('#etiqueta=A');inbox.capture('#etiqueta=B');assert.equal(inbox.read().code,'B');
  assert.equal(inbox.capture('#etiqueta=X&action=saida').status,'error');assert.equal(inbox.read(),null);
});
test('armazenamento bloqueado mantém somente o pendente em memória',()=>{
  const saved={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};
  const inbox=core.createInbox(saved,()=>100);inbox.capture('#etiqueta=A');assert.equal(inbox.read().code,'A');inbox.clear();assert.equal(inbox.read(),null);
});

function actualHandoff(){
  const events=[],view={id:'v-etqconsulta'};
  const field={isConnected:true,disabled:false,value:'',getClientRects:()=>[{}],closest:()=>view,dispatchEvent:e=>events.push(e.type)};
  const calls=[];
  const state={window:{PackemNfcLinkCore:core,canAction:()=>true},session:{u:'ana'},US:[{u:'ana',active:true}],allowedViews:()=>null,
    document:{querySelector:()=>view,getElementById:()=>field},go:id=>calls.push(id),Event:class{constructor(type){this.type=type;}}};
  vm.createContext(state);vm.runInContext(handoff,state);
  return {state,field,view,calls,events};
}
test('dispatcher real só preenche consulta após autorização e não emite Enter/onResult',()=>{
  const h=actualHandoff();assert.equal(h.state.window.applyPackemNfcLink('0001','ana'),true);
  assert.deepEqual(h.calls,['v-etqconsulta']);assert.equal(h.field.value,'0001');assert.deepEqual(h.events,['input']);
  assert.equal(/\.click\(|consultar\(|onResult|keydown/.test(handoff),false);
});
for(const reason of ['logout','outro-usuario','inativo','sem-conta','sem-visualizar','sem-aba']){
  test('dispatcher real impede preenchimento: '+reason,()=>{
    const h=actualHandoff(),s=h.state;
    if(reason==='logout')s.session=null;
    if(reason==='outro-usuario')s.session={u:'outro'};
    if(reason==='inativo')s.US[0].active=false;
    if(reason==='sem-conta')s.US=[];
    if(reason==='sem-visualizar')s.window.canAction=()=>false;
    if(reason==='sem-aba')s.allowedViews=()=>['v-home'];
    assert.equal(s.window.applyPackemNfcLink('A','ana'),false);assert.equal(h.field.value,'');assert.equal(h.calls.length,0);
  });
}
for(const reason of ['usuario-mudou','permissao-mudou','aba-errada','campo-desabilitado','campo-removido','campo-oculto','campo-outra-aba']){
  test('dispatcher revalida depois da navegação: '+reason,()=>{
    const h=actualHandoff(),s=h.state;
    s.go=()=>{
      if(reason==='usuario-mudou')s.session={u:'bia'};
      if(reason==='permissao-mudou')s.window.canAction=()=>false;
      if(reason==='aba-errada')h.view.id='v-mov';
      if(reason==='campo-desabilitado')h.field.disabled=true;
      if(reason==='campo-removido')h.field.isConnected=false;
      if(reason==='campo-oculto')h.field.getClientRects=()=>[];
      if(reason==='campo-outra-aba')h.field.closest=()=>({id:'v-mov'});
    };
    assert.equal(s.window.applyPackemNfcLink('A','ana'),false);assert.equal(h.field.value,'');assert.deepEqual(h.events,[]);
  });
}

class Element{
  constructor(tag,doc){this.tagName=tag;this.doc=doc;this.children=[];this.hidden=false;this.disabled=false;this.isConnected=true;this.listeners={};}
  appendChild(el){this.children.push(el);return el;}
  setAttribute(){}
  addEventListener(name,fn){this.listeners[name]=fn;}
  focus(){this.doc.activeElement=this;}
}
function uiHarness(hash='#etiqueta=0001'){
  const doc={activeElement:null,createElement(tag){return new Element(tag,this);}};doc.body=new Element('body',doc);
  let current=null,now=100000;const handlers={},calls=[],saved=storage(),toasts=[];
  const win={sessionStorage:saved,location:{hash,pathname:'/index.html',search:''},history:{replaceState(a,b,url){calls.push(['strip',url]);win.location.hash='';}},
    addEventListener:(name,fn)=>handlers[name]=fn,packemNfcLinkUser:()=>current,
    applyPackemNfcLink:(code,user)=>{calls.push(['apply',code,user]);return true;},toast:(...v)=>toasts.push(v)};
  const api=createUI(win,doc,{...core,createInbox:s=>core.createInbox(s,()=>now)});
  function buttons(){const root=doc.body.children[0],panel=root.children[0];return {root,panel,apply:panel.children[3],cancel:panel.children[4],status:panel.children[2]};}
  return {win,doc,api,calls,handlers,saved,toasts,buttons,login:(u={user:'ana',canConsult:true})=>{current=u;return api.onLogin();},setUser:u=>current=u,expire:()=>now+=core.ttl};
}
test('receber link antes do login não navega, consulta nem preenche; confirmação consome uma vez',()=>{
  const h=uiHarness();assert.deepEqual(h.calls,[['strip','/index.html']]);assert.equal(h.doc.body.children.length,0);
  assert.equal(h.login(),true);assert.equal(h.calls.length,1);
  const b=h.buttons();b.apply.onclick();assert.deepEqual(h.calls[1],['apply','0001','ana']);assert.equal(b.root.hidden,true);
  b.apply.onclick();assert.equal(h.calls.filter(c=>c[0]==='apply').length,1);
});
test('login sem permissão mostra código sem permitir encaminhamento',()=>{
  const h=uiHarness();h.login({user:'ana',canConsult:false});const b=h.buttons();assert.equal(b.apply.disabled,true);b.apply.onclick();assert.equal(h.calls.length,1);
});
test('troca de usuário antes de confirmar descarta o código',()=>{
  const h=uiHarness();h.login();h.setUser({user:'bia',canConsult:true});h.buttons().apply.onclick();assert.equal(h.calls.length,1);assert.equal(h.saved.getItem(core.storageKey),null);
});
test('expiração antes da confirmação não preenche',()=>{
  const h=uiHarness();h.login();h.expire();h.buttons().apply.onclick();assert.equal(h.calls.length,1);assert.equal(h.buttons().apply.disabled,true);
});
test('logout descarta a leitura e uma nova sessão não a reapresenta',()=>{
  const h=uiHarness();h.login();h.api.onLogout();assert.equal(h.saved.getItem(core.storageKey),null);assert.equal(h.login(),false);
});
test('falha de autorização na entrega não indica sucesso e permite descartar',()=>{
  const h=uiHarness();h.login();h.win.applyPackemNfcLink=()=>false;h.buttons().apply.onclick();assert.equal(h.buttons().root.hidden,false);assert.equal(h.toasts.length,0);h.buttons().cancel.onclick();assert.equal(h.login(),false);
});
test('hashchange válido exige nova confirmação e não dispara aplicação',()=>{
  const h=uiHarness();h.login();h.win.location.hash='#etiqueta=B';h.handlers.hashchange();assert.equal(h.buttons().panel.children[1].textContent,'B');assert.equal(h.calls.filter(c=>c[0]==='apply').length,0);
});
test('landing real recebe link inicial e uma segunda etiqueta na mesma aba, sem navegar ao WMS',()=>{
  const ids=new Map(),handlers={},replaced=[];
  const doc={getElementById(id){if(!ids.has(id))ids.set(id,{hidden:true,addEventListener(){},focus(){}});return ids.get(id);}};
  const win={PackemNfcLinkCore:core,location:{hash:'#etiqueta=0001',pathname:'/nfc.html',search:'',href:'https://wms.example.test/nfc.html#etiqueta=0001'},
    history:{replaceState(a,b,url){replaced.push(url);win.location.hash='';}},addEventListener:(name,fn)=>handlers[name]=fn};
  const source=fs.readFileSync(path.join(__dirname,'../nfc-link-page.js'),'utf8');
  vm.runInNewContext(source,{window:win,document:doc,navigator:{},encodeURIComponent});
  assert.equal(ids.get('nfc-received').hidden,false);assert.equal(ids.get('nfc-code').textContent,'0001');
  assert.equal(ids.get('nfc-open').href,'index.html#etiqueta=0001');assert.equal(win.location.hash,'');
  win.location.hash='#etiqueta=NEW-02';handlers.hashchange();
  assert.equal(ids.get('nfc-code').textContent,'NEW-02');assert.equal(ids.get('nfc-open').href,'index.html#etiqueta=NEW-02');
  assert.equal(replaced.length,2);assert.equal(win.location.pathname,'/nfc.html');
  win.location.hash='#etiqueta=%3Cimg%3E';handlers.hashchange();
  assert.equal(ids.get('nfc-invalid').hidden,false);assert.equal(ids.get('nfc-received').hidden,true);
});
test('scripts carregam antes do WMS; login e logout usam os hooks reais',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.ok(html.indexOf('wms-nfc-link.js')<html.indexOf('src="wms-app.js'));
  assert.match(app,/PackemNfcLink\.onLogin\(\)/);assert.match(app,/PackemNfcLink\.onLogout\(\)/);
  assert.match(app,/class="ec-nfc-link" href="nfc\.html"/);
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json'),'utf8'));
  const headers=config.headers.find(h=>h.source==='/nfc.html').headers;
  assert.equal(headers.find(h=>h.key==='Referrer-Policy').value,'no-referrer');
  assert.match(headers.find(h=>h.key==='Content-Security-Policy').value,/connect-src 'none'/);
});
