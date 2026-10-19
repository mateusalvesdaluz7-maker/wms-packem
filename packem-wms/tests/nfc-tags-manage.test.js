const test=require('node:test'),assert=require('node:assert/strict');
const {createManager}=require('../wms-nfc-tags.js');
const {createClient}=require('../wms-nfc-registry.js');
const binding={uid:'530AC2BA330001',item:'REC-1',binding_id:'11111111-1111-4111-8111-111111111111'};
function fixture(){
  let user='qa',active=true,blocked=false,calls=[];
  const options={user:()=>user,active:()=>active,list:async()=>({rows:[{...binding}],hasMore:false}),lookup:async()=>({codigo:'0303450047',quantidade:25,unidade:'KG'}),
    blocked:()=>blocked,unbind:async row=>{calls.push({...row});return {...row,unlinked:true,available:true};}};
  return {options,calls,manager:createManager(options),setUser:value=>user=value,setActive:value=>active=value,setBlocked:value=>blocked=value};
}
test('gestão exige seleção e confirmação explícita; cancelar não remove vínculo',async()=>{
  const f=fixture();await f.manager.load('',0);await f.manager.select(binding.binding_id);
  assert.equal(f.manager.state.details.quantidade,25);await assert.rejects(f.manager.confirm(),/confirme/);
  f.manager.ask();f.manager.cancel();await assert.rejects(f.manager.confirm(),/confirme/);assert.equal(f.calls.length,0);
  f.manager.ask();await f.manager.confirm();assert.deepEqual(f.calls,[binding]);assert.match(f.manager.state.message,/liberado/);assert.equal(f.manager.state.rows.length,0);
});
test('contagem ativa, troca de usuário e saída da tela impedem desvinculação',async()=>{
  for(const kind of ['blocked','user','view']){
    const f=fixture();await f.manager.load('',0);await f.manager.select(binding.binding_id);f.manager.ask();
    if(kind==='blocked')f.setBlocked(true);if(kind==='user')f.setUser('other');if(kind==='view')f.setActive(false);
    await assert.rejects(f.manager.confirm());assert.equal(f.calls.length,0);
  }
});
test('resposta antiga de consulta não seleciona um chip para outro usuário',async()=>{
  const f=fixture();let release;f.options.list=()=>new Promise(resolve=>release=resolve);
  const pending=f.manager.load('',0);f.setUser('other');await assert.rejects(f.manager.load('',0),/Aguarde/);
  release({rows:[binding],hasMore:false});await assert.rejects(pending,/usuário|seleção/i);assert.equal(f.manager.state.rows.length,0);
});
test('clique repetido não envia duas desvinculações e falha de rede não anuncia sucesso',async()=>{
  const f=fixture();let release;f.options.unbind=async row=>{f.calls.push(row);return new Promise(resolve=>release=resolve);};
  await f.manager.load('',0);await f.manager.select(binding.binding_id);f.manager.ask();const pending=f.manager.confirm();
  await assert.rejects(f.manager.confirm(),/Aguarde/);assert.equal(f.calls.length,1);release({...binding,unlinked:true,available:true});await pending;
  const g=fixture();g.options.unbind=async()=>{throw Error('Sem rede');};await g.manager.load('',0);await g.manager.select(binding.binding_id);g.manager.ask();
  await assert.rejects(g.manager.confirm(),/Sem rede/);assert.equal(g.manager.state.rows.length,1);assert.equal(g.manager.state.confirming,false);
});
test('cliente confirma a versão exata do vínculo e recusa resposta de outro cadastro',async()=>{
  const calls=[],client=createClient({auth:()=>({u:'qa',p:'test-only'}),fetch:async(_,init)=>{const body=JSON.parse(init.body);calls.push(body);return {ok:true,json:async()=>({ok:true,data:body.action==='list'?{rows:[binding],hasMore:false}:{...binding,unlinked:true,available:true}})};}});
  assert.deepEqual((await client.list('REC-1',0)).rows,[binding]);await client.unbind(binding);
  assert.equal(calls[1].bindingId,binding.binding_id);assert.equal(calls[1].item,binding.item);
  await assert.rejects(client.unbind({...binding,binding_id:'22222222-2222-4222-8222-222222222222'}),/não foi confirmada/);
  assert.throws(()=>client.list('x),uid.gt.',0),/Busque/);
});
