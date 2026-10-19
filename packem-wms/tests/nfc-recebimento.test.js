const test=require('node:test'),assert=require('node:assert/strict');
const {createContext}=require('../wms-nfc-recebimento.js');
const {prepare}=require('../wms-nfc-preparar.js');
const fs=require('node:fs'),vm=require('node:vm');
const id='RNFCT261018048C01';
function fixture(){
  const state={user:'admin',view:'v-recv',visible:true,permitted:true,pending:true},calls=[];
  const context=createContext(id,{user:()=>state.user,view:()=>state.view,visible:()=>state.visible,permitted:()=>state.permitted,pending:item=>state.pending&&item===id,
    lookup:async item=>{calls.push(item);return {codigo:'0303450047',quantidade:25,unidade:'KG'};}});
  return {state,calls,context};
}
test('Recebimento prepara somente a bobina clicada, com código e peso originais',async()=>{
  const f=fixture(),result=await prepare(id,f.context);assert.equal(result.tag.item,id);assert.equal(result.tag.codigo,'0303450047');assert.equal(result.tag.quantidade,'25');assert.deepEqual(f.calls,[id]);
  await assert.rejects(prepare('OUTRA',f.context),/etiqueta/);assert.equal(f.calls.length,1);
});
test('sem usuário, permissão, pendência ou tela de recebimento não inicia cadastro',async()=>{
  for(const change of [{user:''},{view:'v-floor70'},{visible:false},{permitted:false},{pending:false}]){
    const f=fixture();Object.assign(f.state,change);await assert.rejects(prepare(id,f.context));assert.equal(f.calls.length,0);
  }
});
test('troca de usuário durante consulta impede preparar vínculo em outro usuário',async()=>{
  let user='admin';const context=createContext(id,{user:()=>user,view:()=> 'v-recv',visible:()=>true,permitted:()=>true,pending:()=>true,
    lookup:async()=>{user='outro';return {codigo:'0303450047',quantidade:25,unidade:'KG'};}});
  await assert.rejects(prepare(id,context),/usuário mudou/);assert.equal(context.isActive(),false);
});
test('bobina retirada do recebimento durante a consulta não fica pronta para armar',async()=>{
  let pending=true;const context=createContext(id,{user:()=> 'admin',view:()=> 'v-recv',visible:()=>true,permitted:()=>true,pending:()=>pending,
    lookup:async()=>{pending=false;return {codigo:'0303410008',quantidade:6300,unidade:'MT'};}});
  await assert.rejects(prepare(id,context),/etiqueta.*mudou/);
});

// Exercise the browser entry point as well as its pure context: a blocked click
// must render feedback before it returns, including after the list is rebuilt.
function uiFixture(snapshot={}){
  const listeners={},calls=[];
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.hidden=false;this.textContent='';}
    appendChild(node){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(x=>x!==node);this.children.push(node);node.parentElement=this;return node;}
    setAttribute(key,value){this[key]=value;}
    get isConnected(){return this===body||!!this.parentElement&&this.parentElement.isConnected;}
    matches(selector){return selector[0]==='#'?this.id===selector.slice(1):selector==='[data-az]'?'az' in this.dataset:selector==='[data-nfc-receber]'?'nfcReceber' in this.dataset:false;}
    querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    closest(selector){return this.matches(selector)?this:this.parentElement&&this.parentElement.closest(selector);}
    scrollIntoView(){}
  }
  const body=new Element('body'),view=new Element('section'),list=new Element('div'),card=new Element('article'),actions=new Element('div'),store=new Element('button');
  view.id='v-recv';list.id='stageList';store.dataset.az=id;body.appendChild(view);view.appendChild(list);list.appendChild(card);card.appendChild(actions);actions.appendChild(store);
  const document={body,hidden:false,createElement:tag=>{assert.notEqual(tag,'dialog');return new Element(tag);},getElementById:key=>body.querySelector('#'+key),querySelector:selector=>selector==='.view.active'?view:body.querySelector(selector),addEventListener:(name,fn)=>listeners[name]=fn};
  const state={owner:'admin',working:false,pendingItem:null,operationId:null,message:'Aguardando chip',...snapshot};
  const mobile={enrollmentState:()=>state,registerItem:async(item,context)=>{calls.push('register');assert.equal(context.isActive(),true);if(state.mode==='count')throw Error('O leitor está em contagem. Pause a captura.');state.pendingItem=item;state.operationId='operation';return {tag:{item,codigo:'0303450047',quantidade:'25',unidade:'KG'},operationId:'operation'};},pauseCapture:async()=>{calls.push('pause');state.mode='idle';},cancelEnrollment:async()=>{state.pendingItem=null;},checkEnrollment:async()=>{}};
  const root={WmsNfcMobile:mobile,WmsNfcLabels:{sources:()=>({stage:[{et:id}]}),lookupCurrent:async()=>({codigo:'0303450047',quantidade:25,unidade:'KG'})},allowedViews:()=>null,addEventListener:(name,fn)=>listeners[name]=fn};
  vm.runInNewContext(fs.readFileSync(require.resolve('../wms-nfc-recebimento.js'),'utf8'),{window:root,document,session:{u:'admin'},MutationObserver:class{observe(){}},setTimeout});
  return {root,document,state,mobile,calls,card,Element,async click(){const target=card.querySelector('[data-nfc-receber]');listeners.click({target,preventDefault(){},stopPropagation(){}});await new Promise(resolve=>setImmediate(resolve));},panel:()=>document.getElementById('packemNfcRecebimento'),status:()=>document.getElementById('packemNfcRecebimento').children.find(x=>x.role==='status').textContent};
}
test('clique com cadastro anterior pendente abre aviso visível e não arma outra bobina',async()=>{
  const f=uiFixture({pendingItem:'ETIQUETA-ANTERIOR',operationId:'previous'});await f.click();
  assert.equal(f.panel().hidden,false);assert.match(f.status(),/cadastro pendente da etiqueta ETIQUETA-ANTERIOR/);assert.deepEqual(f.calls,[]);
});
test('módulo incompleto mostra instrução de atualização em vez de falhar silenciosamente',async()=>{
  const f=uiFixture();f.mobile.enrollmentState=null;await f.click();assert.equal(f.panel().hidden,false);assert.match(f.status(),/Ctrl \+ F5/);assert.deepEqual(f.calls,[]);
});
test('botão recriado continua recebendo o clique sem depender de onclick ou diálogo nativo',async()=>{
  const f=uiFixture(),old=f.card.querySelector('[data-nfc-receber]'),replacement=new f.Element('button');replacement.dataset.nfcReceber=id;f.card.children=f.card.children.filter(x=>x!==old);f.card.appendChild(replacement);
  await f.click();assert.deepEqual(f.calls,['register']);assert.equal(f.panel().hidden,false);assert.match(f.status(),/Aguardando chip/);
});
test('contagem ativa exige pausa explícita e só depois prepara a tag clicada',async()=>{
  const f=uiFixture({mode:'count'});await f.click();assert.deepEqual(f.calls,['register']);assert.match(f.status(),/leitor está em contagem/);
  const controls=f.panel().children.find(x=>x.children.some(b=>b.textContent==='Pausar contagem e preparar esta tag')),button=controls.children.find(b=>b.textContent==='Pausar contagem e preparar esta tag');
  assert.equal(button.hidden,false);await button.onclick();assert.deepEqual(f.calls,['register','pause','register']);assert.equal(f.state.pendingItem,id);
});

test('painel compartilhado mantém o contexto e o cartão de Rastreável ao pausar e tentar novamente',async()=>{
  const f=uiFixture({mode:'count'}),host=new f.Element('article');f.document.body.appendChild(host);
  const context={isActive:()=>true,lookup:async()=>({codigo:'0303410008',quantidade:6300,unidade:'MT'})};
  f.mobile.registerItem=async(item,received)=>{f.calls.push('register');assert.equal(received,context);if(f.state.mode==='count')throw Error('Pause a contagem');f.state.pendingItem=item;return {tag:{item,codigo:'0303410008',quantidade:'6300',unidade:'MT'},operationId:'operation'};};
  await f.root.WmsNfcRecebimento.register('R-MANUAL-001',{host,context});assert.equal(f.panel().parentElement,host);
  const pause=f.panel().children.flatMap(n=>n.children).find(b=>b.textContent==='Pausar contagem e preparar esta tag');
  await pause.onclick();assert.deepEqual(f.calls,['register','pause','register']);assert.equal(f.panel().parentElement,host);assert.equal(f.state.pendingItem,'R-MANUAL-001');
  assert.match(f.panel().children[1].textContent,/Código 0303410008 · Metragem: 6\.300 MT/);
});
