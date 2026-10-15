const test=require('node:test'),assert=require('node:assert/strict');
const {parseText}=require('../wms-nfc-text.js');
const {NativeTextCounter}=require('../wms-nfc-iphone.js');
const {applyItemReading,applyReading}=require('../wms-nfc-reader.js');
const first='JOB=teste;ID=T001;COD=0303450047;QTD=300;UN=KG',second=first.replace('T001','T002').replace('QTD=300','QTD=250.5');
function fixture(overrides={}){const items=new Map(),states=[],catalog={T001:{codigo:'0303450047',quantidade:300,unidade:'KG'},T002:{codigo:'0303450047',quantidade:250.5,unidade:'KG'}};const context={isActive:()=>true,lookup:async id=>catalog[id]||null,has:id=>items.has(id),add:async id=>{items.set(id,catalog[id]);},...overrides};const counter=new NativeTextCounter({parse:parseText,apply:applyItemReading,notify:s=>states.push(s)});return {counter,context,items,states,catalog};}
test('texto nativo preserva zeros, decimais e peso legado sem fabricar UID',()=>{
  assert.deepEqual(parseText(first),{item:'T001',codigo:'0303450047',quantidade:'300',unidade:'KG',job:'teste'});
  assert.equal(parseText(first.replace('QTD=300;UN=KG','PLG=1250')).quantidade,'1.25');
  assert.equal(parseText(first.replace('QTD=300','QTD=006,300000')).quantidade,'6.3');
  assert.equal('uid' in parseText(first),false);
});
test('recusa links, campos repetidos/desconhecidos, formatos misturados e texto grande',()=>{
  for(const text of ['https://example.com','javascript:alert(1)',first+';ID=T002',first+';X=1',first+';PLG=1',first.replace('QTD=300','QTD=0'),first.replace('UN=KG','UN=ZZ'),first.replace('QTD=300;UN=KG','PLG=1000000001'),first+'a'.repeat(121)])assert.throws(()=>parseText(text));
});
test('texto recebido em sequência conta duas embalagens sem duplicar releitura',async()=>{
  const f=fixture();f.counter.arm(f.context);assert.equal(f.counter.offer(first),true);assert.equal(f.counter.offer(second),true);assert.equal(f.counter.offer(first),true);await f.counter.idle();
  assert.equal(f.items.size,2);assert.equal([...f.items.values()].reduce((sum,x)=>sum+x.quantidade,0),550.5);assert.equal(f.counter.count,2);assert.equal(f.counter.pending.length,0);
});
test('recepção inativa não aceita texto, e pausa durante consulta impede entrada',async()=>{
  let resolve;const f=fixture({lookup:()=>new Promise(r=>{resolve=r;})});assert.equal(f.counter.offer(first),false);f.counter.arm(f.context);f.counter.offer(first);f.counter.pause();resolve(f.catalog.T001);await f.counter.idle();assert.equal(f.items.size,0);assert.equal(f.counter.pending.length,1);
});
test('mudança de contexto durante consulta é recusada e a leitura fica pendente',async()=>{
  let active=true;const f=fixture({isActive:()=>active,lookup:async()=>{active=false;return {codigo:'0303450047',quantidade:300,unidade:'KG'};}});f.counter.arm(f.context);f.counter.offer(first);await f.counter.idle();assert.equal(f.items.size,0);assert.equal(f.counter.pending.length,1);assert.equal(f.counter.active,false);assert.throws(()=>f.counter.resume());
});
test('divergência no cadastro interrompe a fila; corrigir e retomar preserva a ordem',async()=>{
  const f=fixture();f.catalog.T001.quantidade=301;f.counter.arm(f.context);f.counter.offer(first);f.counter.offer(second);await f.counter.idle();assert.equal(f.items.size,0);assert.equal(f.counter.pending.length,2);assert.equal(f.counter.active,false);f.catalog.T001.quantidade=300;f.counter.resume();await f.counter.idle();assert.deepEqual([...f.items.keys()],['T001','T002']);
});
test('a mesma embalagem com dados divergentes não vira outra entrada',async()=>{
  const f=fixture();f.counter.arm(f.context);f.counter.offer(first);await f.counter.idle();f.counter.offer(first.replace('QTD=300','QTD=301'));await f.counter.idle();assert.equal(f.items.size,1);assert.equal(f.counter.active,false);assert.equal(f.counter.pending.length,1);
});
test('limite da fila e troca de sessão preservam pendências; UID continua obrigatório no Webhook',async()=>{
  let resolve;const f=fixture({lookup:()=>new Promise(r=>{resolve=r;})});f.counter.arm(f.context);for(let i=0;i<10;i++)assert.equal(f.counter.offer(first),true);assert.equal(f.counter.offer(first),false);assert.equal(f.counter.pending.length,10);assert.throws(()=>f.counter.arm(f.context));resolve(f.catalog.T001);await f.counter.idle();assert.equal(f.items.size,0);
  await assert.rejects(applyReading({...parseText(first),seq:1},fixture().context),/UID/);
});
