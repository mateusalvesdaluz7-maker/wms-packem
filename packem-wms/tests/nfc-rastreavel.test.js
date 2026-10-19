const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createContext}=require('../wms-nfc-rastreavel.js');
const {prepare}=require('../wms-nfc-preparar.js');
const labels=require('../wms-nfc-labels.js');
const id='R-TEST-001';
function fixture(unit='KG'){
  const state={user:'admin',visible:true,view:'v-labels',tab:'rast',permitted:true,available:true,synced:true},calls=[];
  const record={id,nf:'__vaga__',cProd:'0303450047',kg:25.75,pesoBruto:27,uCom:unit};
  const options={user:()=>state.user,visible:()=>state.visible,view:()=>state.view,tab:()=>state.tab,permitted:()=>state.permitted,available:item=>item===id&&state.available,
    sync:async item=>{calls.push(['sync',item]);return state.synced;},lookup:async item=>{calls.push(['lookup',item]);return labels.normalize(record,()=> 'UN');}};
  return {state,calls,record,options,context:createContext(id,options)};
}
test('Rastreável vincula o mesmo ID com código e peso líquido, respeitando a unidade da etiqueta',async()=>{
  for(const unit of ['KG','MT']){
    const f=fixture(unit),result=await prepare(id,f.context);
    assert.deepEqual(result.tag,{job:'wms',item:id,codigo:'0303450047',quantidade:'25.75',unidade:unit});
    assert.deepEqual(f.calls,[['sync',id],['lookup',id]]);assert.equal(f.record.pesoBruto,27);
  }
});
test('falha de sincronização mantém o ID para tentar novamente, sem consultar nem criar etiqueta',async()=>{
  const f=fixture();f.state.synced=false;
  await assert.rejects(prepare(id,f.context),/já foi criada.*mesmo ID/);assert.deepEqual(f.calls,[['sync',id]]);
  f.state.synced=true;await prepare(id,f.context);assert.deepEqual(f.calls,[['sync',id],['sync',id],['lookup',id]]);
});
test('Rastreável exige usuário, permissão, aba ativa e a etiqueta ainda disponível',async()=>{
  for(const change of [{user:''},{view:'v-recv'},{tab:'bob'},{visible:false},{permitted:false},{available:false}]){
    const f=fixture();Object.assign(f.state,change);await assert.rejects(prepare(id,f.context));assert.deepEqual(f.calls,[]);
  }
  const f=fixture();await assert.rejects(prepare('OUTRA',f.context));assert.deepEqual(f.calls,[]);
});
test('trocar de usuário ou aba durante sincronização não consulta nem prepara outro contexto',async()=>{
  for(const change of [{user:'outro'},{tab:'bob'},{available:false}]){
    const f=fixture();f.options.sync=async()=>{Object.assign(f.state,change);return true;};
    await assert.rejects(prepare(id,createContext(id,f.options)),/mudou durante a sincronização/);assert.deepEqual(f.calls,[]);
  }
});
test('mudança durante consulta não libera a aproximação',async()=>{
  const f=fixture();f.options.lookup=async()=>{f.state.view='v-recv';return labels.normalize(f.record);};
  await assert.rejects(prepare(id,createContext(id,f.options)),/mudou durante a consulta/);
});
test('geração real anuncia exatamente os IDs impressos; vincular ou repetir não gera nem imprime novamente',async()=>{
  const source=fs.readFileSync(require.resolve('../wms-app.js'),'utf8');
  const start=source.indexOf('  gr.onclick=function(){'),end=source.indexOf('\n};',start)+3;
  const makeStart=source.indexOf('  window.nfMakeLabel=function(data){'),makeEnd=source.indexOf('\n  var _r=render;',makeStart);
  assert.ok(start>0&&end>start&&makeStart>0&&makeEnd>makeStart);
  const fields={rastProd:'0303450047',rastQtd:'125.5',rastDesc:'Tecido teste',rastUn:'MT',rastLote:'L01',rastCopies:'3'},events=[],printed=[],ETQ={};
  let formatCallback;
  const context={window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},gr:{},ETQ,session:{u:'admin'},
    $:selector=>({value:fields[selector.slice(1)]}),document:{getElementById:()=>({innerHTML:''})},norm:value=>value,toast:()=>{},nowISO:()=>new Date().toISOString(),saveNF:()=>{},
    syncEtiqueta:()=>true,printZebraRast:items=>printed.push(items[0].id),askLabelFormat:(_,callback)=>{formatCallback=callback;}};
  vm.runInNewContext(source.slice(makeStart,makeEnd),context);
  vm.runInNewContext(source.slice(start,end),context);context.gr.onclick();
  assert.equal(events.length,0);assert.equal(printed.length,0); // format dialog has not confirmed yet
  formatCallback({dim:[100,50],orient:'retrato'});
  assert.equal(events.length,1);assert.equal(events[0].type,'packem-rastreavel-generated');assert.equal(events[0].detail.owner,'admin');
  const ids=Array.from(events[0].detail.ids);assert.equal(new Set(ids).size,3);assert.deepEqual(ids,printed);assert.deepEqual(Object.keys(ETQ),ids);
  for(const item of ids){
    assert.equal(ETQ[item].nf,'__vaga__');
    const options={user:()=> 'admin',visible:()=>true,view:()=> 'v-labels',tab:()=> 'rast',permitted:()=>true,available:key=>!!ETQ[key],sync:async()=>true,lookup:key=>labels.normalize(ETQ[key])};
    for(let retry=0;retry<2;retry++){
      const prepared=await prepare(item,createContext(item,options));assert.equal(prepared.tag.item,item);assert.equal(prepared.tag.codigo,fields.rastProd);assert.equal(prepared.tag.quantidade,'125.5');assert.equal(prepared.tag.unidade,'MT');
    }
  }
  assert.deepEqual(Object.keys(ETQ),ids);assert.deepEqual(printed,ids);assert.equal(events.length,1);
});
