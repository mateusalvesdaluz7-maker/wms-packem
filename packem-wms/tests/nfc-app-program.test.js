const test=require('node:test'),assert=require('node:assert/strict');
const {AppProgrammer}=require('../wms-nfc-app.js'),{prepare}=require('../wms-nfc-preparar.js');
function fixture(){
  let active=true,sequence=0;
  const catalog={T001:{codigo:'0303450047',quantidade:300,unidade:'KG'}},notices=[];
  const context={isActive:()=>active,lookup:async id=>catalog[id]||null};
  const programmer=new AppProgrammer({prepare,uuid:()=>String(++sequence),notify:s=>notices.push(s.message)});
  return {programmer,context,catalog,notices,deactivate:()=>{active=false;},value:()=>prepare('T001',context)};
}
function reading(command,overrides={}){return {...command,uid:'04112233445566',...overrides};}

test('gravação parte de embalagem existente e só confirma após autorizar e conferir a mesma tag',async()=>{
  const f=fixture(),command=await f.programmer.start(await f.value(),f.context);
  assert.equal(command.type,'program');assert.equal(command.target,'v-labels');assert.match(command.content,/COD=0303450047;QTD=300/);
  const reply=reading(command);assert.equal((await f.programmer.authorize(reply)).accepted,true);
  assert.ok(f.programmer.binding);assert.equal(f.notices.some(n=>n.startsWith('Tag gravada e relida')),false);
  assert.equal((await f.programmer.complete(reply)).accepted,true);assert.equal(f.programmer.binding,null);
  assert.match(f.notices.at(-1),/T001.*04112233445566/);
});
test('não autoriza embalagem alterada no cadastro depois de preparar o texto',async()=>{
  const f=fixture(),value=await f.value();f.catalog.T001.quantidade=301;
  await assert.rejects(f.programmer.start(value,f.context),/cadastro mudou/);assert.equal(f.programmer.binding,null);
});
test('refaz consulta ao cadastro imediatamente antes da escrita e ao confirmar a releitura',async()=>{
  for(const phase of ['authorize','complete']){
    const f=fixture(),command=await f.programmer.start(await f.value(),f.context),reply=reading(command);
    if(phase==='complete')await f.programmer.authorize(reply);
    f.catalog.T001.codigo='303450047';await assert.rejects(f.programmer[phase](reply),/cadastro mudou/);
    assert.equal(f.programmer.binding,null);assert.equal(f.notices.some(n=>n.startsWith('Tag gravada e relida')),false);
  }
});
test('não confirma releitura antes da autorização nem UID diferente depois da escrita',async()=>{
  for(const authorized of [false,true]){
    const f=fixture(),command=await f.programmer.start(await f.value(),f.context),reply=reading(command);
    if(authorized)await f.programmer.authorize(reply);
    await assert.rejects(f.programmer.complete({...reply,uid:'04778899001122'}),/UID relido/);
    assert.equal(f.programmer.binding,null);
  }
});
test('callbacks de outra sessão, outro destino, UID falso ou texto diferente não confirmam',async()=>{
  const f=fixture(),command=await f.programmer.start(await f.value(),f.context);
  for(const change of [{sessionId:'old'},{target:'v-floor'},{uid:'fake'},{content:command.content.replace('300','301')}]){
    await assert.rejects(f.programmer.authorize(reading(command,change)));
    assert.ok(f.programmer.binding);assert.equal(f.programmer.binding.uid,null);
  }
  await f.programmer.authorize(reading(command));assert.equal((await f.programmer.complete(reading(command))).accepted,true);
});
test('uma autorização não pode ser repetida para gravar outra tag na mesma tentativa',async()=>{
  const f=fixture(),command=await f.programmer.start(await f.value(),f.context);await f.programmer.authorize(reading(command));
  await assert.rejects(f.programmer.authorize(reading(command,{uid:'04778899001122'})),/já autorizou/);assert.equal(f.programmer.binding,null);
});
test('cancelar durante consulta bloqueia resultado tardio e nova tentativa até a consulta terminar',async()=>{
  const f=fixture(),value=await f.value();let resolve;
  const context={isActive:()=>true,lookup:()=>new Promise(r=>{resolve=r;})};
  const pending=f.programmer.start(value,context);f.programmer.stop();
  await assert.rejects(f.programmer.start(value,f.context),/operação NFC/);resolve(f.catalog.T001);
  await assert.rejects(pending,/mudou/);assert.equal(f.programmer.binding,null);
  const next=await f.programmer.start(value,f.context);await assert.rejects(f.programmer.authorize(reading(next,{sessionId:'1'})),/outra sessão/);
});
test('mudança de usuário, tela ou seleção impede autorização e confirmação',async()=>{
  for(const phase of ['authorize','complete']){
    const f=fixture(),command=await f.programmer.start(await f.value(),f.context),reply=reading(command);
    if(phase==='complete')await f.programmer.authorize(reply);
    f.deactivate();await assert.rejects(f.programmer[phase](reply),/mudou/);assert.equal(f.programmer.binding,null);
  }
});
test('falha de rede não produz confirmação nem mantém gravador ocupado',async()=>{
  const f=fixture(),command=await f.programmer.start(await f.value(),f.context);
  f.context.lookup=async()=>{throw new Error('sem rede');};
  await assert.rejects(f.programmer.authorize(reading(command)),/sem rede/);
  assert.equal(f.programmer.binding,null);assert.equal(f.programmer.busy,false);
  assert.equal(f.notices.some(n=>n.startsWith('Tag gravada e relida')),false);
});
test('recusa operações concorrentes enquanto confere o cadastro antes da escrita',async()=>{
  const f=fixture(),command=await f.programmer.start(await f.value(),f.context);let resolve;
  f.context.lookup=()=>new Promise(r=>{resolve=r;});
  const pending=f.programmer.authorize(reading(command));
  await assert.rejects(f.programmer.complete(reading(command)),/Aguarde/);
  await assert.rejects(f.programmer.authorize(reading(command)),/Aguarde/);
  resolve(f.catalog.T001);assert.equal((await pending).accepted,true);
});
