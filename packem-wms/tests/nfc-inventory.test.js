const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require.resolve('../wms-app.js'),'utf8').split('window.WmsNfcInventory={context:function(){')[1].split('/* CONFIRMA a vaga:')[0];
function fixture(){
  let who='qa',pass=0;
  const inv={tid:'TASK1',status:'andamento',atribuido:'qa',cur:'VAGA1',sel:{},bip:{},done:{}};
  const sandbox={window:{bobFetch:async()=>({pr:'0303450047',pl:300})},document:{hidden:false,querySelector:()=>true},loadInv:()=>inv,_me:()=>who,_adm:()=>false,norm:s=>s.toUpperCase(),unitOf:()=> 'KG',_recGet:()=>Array(pass).fill({}),_chaoSt:()=>({pass:pass+1}),_chaoAlvos:()=>[{id:'CHAO1',_code:'T001'}],_chaoSeen:()=>inv.seen||{},_bipAplica:(et,info)=>{inv.bip[inv.cur]={items:[{et,...info}]};}};
  vm.runInNewContext('window.WmsNfcInventory={context:function(){'+code,sandbox);
  return {inv,sandbox,context:()=>sandbox.window.WmsNfcInventory.context(),pass:()=>pass++,user:()=>who='other'};
}
test('contexto NFC do inventário exige atribuição, vaga e tarefa em andamento',()=>{
  const f=fixture();assert.ok(f.context().isActive());f.inv.cur=null;assert.equal(f.context().isActive(),false);
  f.inv.sel.chao='exp';assert.ok(f.context().isActive());f.user();assert.equal(f.context().isActive(),false);
});
test('vaga, passada, usuário e visibilidade invalidam contexto antigo',async()=>{
  for(const mutate of [f=>f.inv.cur='VAGA2',f=>f.pass(),f=>f.user(),f=>f.sandbox.document.hidden=true]){
    const f=fixture(),ctx=f.context();mutate(f);assert.equal(!!ctx.isActive(),false);await assert.rejects(ctx.add('T001'));assert.deepEqual(f.inv.bip,{});
  }
});
test('NFC encaminha ao bip existente e confirma presença sem encerrar a vaga',async()=>{
  const f=fixture(),ctx=f.context();assert.equal(ctx.has('T001'),false);await ctx.add('T001');assert.ok(ctx.has('T001'));
  assert.equal(f.inv.cur,'VAGA1');assert.equal(f.inv.status,'andamento');assert.equal(f.inv.bip.VAGA1.items[0].pl,300);
});
test('nova passada de chão ganha contexto próprio e não herda confirmação anterior',()=>{
  const f=fixture();f.inv.sel.chao='exp';f.inv.seen={CHAO1:1};const ctx=f.context();assert.ok(ctx.has('T001'));
  f.pass();f.inv.seen={};assert.equal(!!ctx.isActive(),false);assert.notEqual(ctx.scope,f.context().scope);assert.equal(f.context().has('T001'),false);
});
