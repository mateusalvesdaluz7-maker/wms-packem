const test=require('node:test'),assert=require('node:assert/strict');
const {createContext}=require('../wms-nfc-recebimento.js');
const {prepare}=require('../wms-nfc-preparar.js');
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
