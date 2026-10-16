const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {validate,Creator}=require('../wms-nfc-manual.js');
const fields={codigo:'0303450047',descricao:'Tecido branco',quantidade:'300,125',unidade:'KG',lote:'OP-12'};
test('etiqueta manual conserva zeros do produto e quantidade decimal sem aceitar dados ambíguos',()=>{
  assert.deepEqual(validate(fields),{cProd:'0303450047',xProd:'Tecido branco',kg:300.125,un:'KG',lote:'OP-12'});
  for(const quantidade of ['0','-1','NaN','1.234,56','1e3','1.0000001','1000000000'])assert.throws(()=>validate({...fields,quantidade}));
  assert.throws(()=>validate({...fields,codigo:'X;ID=ABC'}));assert.throws(()=>validate({...fields,unidade:'??'}));
});
test('falha de sincronização retoma o mesmo ID sem criar outra bobina nem imprimir',async()=>{
  let creates=0,syncs=0,selected=[];
  const creator=new Creator({isActive:()=>true,create:data=>{creates++;assert.equal(data._print,false);assert.equal(data._deferSync,true);return 'R001';},sync:async()=>++syncs>1,select:async id=>{selected.push(id);return {tag:{item:id,codigo:fields.codigo,quantidade:'300.125',unidade:'KG'}};}});
  await assert.rejects(creator.run(fields),/R001.*mesmo ID/);assert.equal(creator.created.id,'R001');assert.equal(selected.length,0);
  await creator.run({...fields,quantidade:'1'});await creator.run(fields);assert.equal(creates,1);assert.equal(syncs,2);assert.deepEqual(selected,['R001','R001']);
});
test('cliques concorrentes e troca de usuário não selecionam a etiqueta em outro contexto',async()=>{
  let active=true,finish,sels=0,creates=0;
  const creator=new Creator({isActive:()=>active,create:()=>{creates++;return 'R001';},sync:()=>new Promise(resolve=>finish=resolve),select:()=>{sels++;}});
  const pending=creator.run(fields);await assert.rejects(creator.run(fields),/Aguarde/);active=false;finish(true);await assert.rejects(pending,/usuário mudou/);assert.equal(creates,1);assert.equal(sels,0);
  await assert.rejects(new Creator({isActive:()=>false}).run(fields),/Abra NFC/);
});
test('cadastro manual exige os mesmos código, peso e unidade antes de liberar o vínculo',async()=>{
  const creator=new Creator({isActive:()=>true,create:()=> 'R001',sync:async()=>true,select:async id=>({tag:{item:id,codigo:fields.codigo,quantidade:'300.125',unidade:'MT'}})});
  await assert.rejects(creator.run(fields),/quantidade e unidade/);assert.equal(creator.created.id,'R001');
});
test('função do rastreio mantém impressão normal e permite criação NFC sem impressão automática',()=>{
  const source=fs.readFileSync(require.resolve('../wms-app.js'),'utf8'),start=source.indexOf('  window.nfMakeLabel=function(data){'),end=source.indexOf('\n  var _r=render;',start);
  assert.ok(start>0&&end>start);let prints=0,syncs=0;
  const context={window:{},ETQ:{},nfDescByCode:()=>'',nowISO:()=>new Date().toISOString(),saveNF:()=>{},regBobFromEtq:()=>{},syncEtiqueta:()=>syncs++,logAct:()=>{},printZebraRast:()=>prints++,toast:()=>{}};
  vm.runInNewContext(source.slice(start,end),context);const normal=context.window.nfMakeLabel({cProd:fields.codigo,kg:300});assert.ok(context.ETQ[normal]);assert.equal(prints,1);assert.equal(syncs,1);
  const nfc=context.window.nfMakeLabel({cProd:fields.codigo,kg:250.5,_print:false,_deferSync:true});assert.ok(context.ETQ[nfc]);assert.notEqual(nfc,normal);assert.equal(prints,1);assert.equal(syncs,1);
});
