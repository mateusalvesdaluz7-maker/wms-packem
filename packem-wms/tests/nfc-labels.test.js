const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,rows,lookup}=require('../wms-nfc-labels.js');
const {choices,prepare}=require('../wms-nfc-preparar.js');
const {applyItemReading}=require('../wms-nfc-reader.js');
const fs=require('node:fs'),vm=require('node:vm');
const product='0303450047',unitOf=()=> 'KG';

test('recebimento sem catálogo conserva a identidade e o peso líquido, sem usar o bruto',async()=>{
  const sources={stage:[{et:'2600241918',pr:product,desc:'Tecido',pl:307.8}],etq:{'NF-01':{cProd:product,kg:300.125,pesoBruto:330,uCom:'KG',nf:'NF1'}}};
  assert.deepEqual([...rows(sources,unitOf)].map(item=>[item.id,item.codigo,item.quantidade,item.unidade,item.recebimento]),[['2600241918',product,307.8,'KG',true],['NF-01',product,300.125,'KG',true]]);
  const before=JSON.stringify(sources);let fetches=0;
  const found=await lookup('NF-01',sources,unitOf,()=>{fetches++;});
  assert.equal(found.quantidade,300.125);assert.equal(found.codigo,product);assert.equal(fetches,0);assert.equal(JSON.stringify(sources),before);
});

test('etiqueta fiscal em metros prevalece sobre catálogo antigo e unidade padrão do produto',async()=>{
  const sources={bob:{E1:{pr:product,pl:999,uCom:'KG'}},stage:[{et:'E1',pr:product,pl:888}],etq:{E1:{cProd:'0303410008',xProd:'Alça',kg:6300,uCom:'M',nf:'NF1',nNF:'123'}}};
  const list=[...rows(sources,unitOf)];assert.equal(list.length,1);assert.equal(list[0].quantidade,6300);assert.equal(list[0].unidade,'MT');assert.equal(list[0].origem,'Recebimento');
  const selected=await prepare('E1',{isActive:()=>true,lookup:id=>lookup(id,sources,unitOf)});
  assert.equal(selected.tag.codigo,'0303410008');assert.equal(selected.tag.unidade,'MT');assert.equal(selected.tag.quantidade,'6300');
  const counted=new Set();await applyItemReading(selected.tag,{isActive:()=>true,lookup:id=>lookup(id,sources,unitOf),has:id=>counted.has(id),add:id=>counted.add(id)});assert.deepEqual([...counted],['E1']);
});

test('busca por recebimento inclui documento e separa etiqueta manual e catálogo',()=>{
  const bob={T1:{pr:product,pl:5}},etq={N1:{cProd:product,kg:300,uCom:'KG',nf:'NF1',nNF:'9876'},R1:{cProd:product,kg:50,uCom:'KG',nf:'__vaga__'}},stage=[{et:'T2',pr:product,pl:250.5}];
  const options={etq,stage,unitOf,recebimento:true};
  assert.deepEqual(choices(bob,'',options).map(item=>item.id),['T2','N1']);
  assert.deepEqual(choices(bob,'9876',options).map(item=>item.id),['N1']);
  assert.equal(choices(bob,'',{...options,recebimento:false}).length,4);
  etq.N1.kg=301;assert.equal(choices(bob,'N1',options)[0].quantidade,301);
});

test('etiqueta fiscal inválida não reaparece com peso ou código antigo do catálogo',async()=>{
  const sources={bob:{E1:{pr:product,pl:300}},etq:{E1:{cProd:product,kg:0,uCom:'KG'}}};
  assert.deepEqual([...rows(sources,unitOf)],[]);assert.equal(await lookup('E1',sources,unitOf),null);
  for(const record of [{pr:product,pl:1,uCom:'CX'},{pr:product,pl:'1.234,56',uCom:'KG'},{pr:'',pl:300,uCom:'KG'}])assert.equal(normalize(record,unitOf),null);
});

test('consulta remota de etiqueta conserva a unidade recebida e a quantidade original',async()=>{
  const found=await lookup('E1',{},unitOf,async id=>{assert.equal(id,'E1');return {pr:'0303410008',pl:1250,uCom:'MT'};});
  assert.equal(found.unidade,'MT');assert.equal(found.quantidade,1250);
  assert.equal(await lookup('ausente',{},unitOf,async()=>null),null);
});

function bobContext(extra){
  const source=fs.readFileSync(require.resolve('../wms-app.js'),'utf8'),start=source.indexOf('var _bobFetchPending={};'),end=source.indexOf('window.bobFetch=bobFetch;',start)+'window.bobFetch=bobFetch;'.length;
  assert.ok(start>0&&end>start);
  const context={window:{},BOB:{},supa:null,saveBOB:()=>{},setTimeout:()=>0,...extra};vm.runInNewContext(source.slice(start,end),context);return context;
}

test('bobFetch mantém a unidade da etiqueta fiscal local para os demais fluxos',async()=>{
  const context=bobContext({window:{etqLookup:()=>({pr:product,pl:6300,uCom:'MT'})}});
  const found=await context.window.bobFetch('E1');assert.equal(found.uCom,'MT');assert.equal(context.BOB.E1.pl,6300);
});

test('bobFetch pede e conserva u_com ao resolver uma etiqueta fiscal da nuvem',async()=>{
  const context=bobContext({supa:{from(table){return {select(fields){if(table==='etiquetas')assert.ok(fields.split(',').includes('u_com'));return {eq(){return this;},limit:async()=>({data:table==='etiquetas'?[{id:'E1',c_prod:product,kg:6300,u_com:'MT'}]:[]})};}};}}});
  const found=await context.window.bobFetch('E1');assert.equal(found.uCom,'MT');assert.equal(found.pl,6300);
});
