const test=require('node:test');
const assert=require('node:assert/strict');
const expedition=require('../cut-expedition-core.js');

test('expedição usa itens conferidos como no anel do romaneio',()=>{
  const record={items:[
    {etiqueta:'T001',status:'conferido'},
    {etiqueta:'T002',status:'separado'},
    {qtdNum:100,feito:100,tags:[{tag:'T003',conf:true}]},
    {qtdNum:100,feito:100,tags:[{tag:'T004',conf:false}]}
  ]};
  assert.deepEqual(expedition.summarize(record),{linked:true,percent:50,total:4,separated:4,confirmed:2,status:'Em andamento'});
});

test('não inventa percentual nem data quando falta romaneio e programação',()=>{
  assert.equal(expedition.summarize(null).percent,null);
  assert.deepEqual(expedition.shipment([],null),{dates:[],source:''});
  assert.equal(expedition.summarize({_del:true,items:[{etiqueta:'T1',status:'conferido'}]}).linked,false);
});

test('data do romaneio prevalece sobre programação do PDF',()=>{
  assert.deepEqual(expedition.shipment(['02/10/2026'],{meta:{dataEmb:'2026-10-03'}}),{dates:['03/10/2026'],source:'romaneio'});
  assert.deepEqual(expedition.shipment(['02/10/2026'],null),{dates:['02/10/2026'],source:'programação'});
});

test('produção vem do apontamento e bipagem vem da leitura do produto',()=>{
  const record={meta:{source:'cut-op',productionTargets:[{quantity:5000}]},items:[
    {etiqueta:'',qtdNum:5000,status:'pendente'},
    {etiqueta:'T1',origin:'bobinas',qtdNum:1050,status:'conferido'},
    {etiqueta:'T2',quantitySource:'apontamento',qtdNum:950,status:'pendente'}
  ]};
  const result=expedition.quantities(record);
  assert.equal(result.planned,5000);
  assert.equal(result.produced,2000);
  assert.equal(result.scanned,1050);
  assert.equal(result.confirmed,1050);
  assert.equal(result.producedPercent,40);
  assert.equal(result.scannedPercent,21);
  assert.equal(result.confirmedPercent,21);
  assert.equal(result.producedLabels,2);
  assert.equal(result.scannedLabels,1);
});

test('progresso geral percorre OP, separação, produção, bipagem e expedição',()=>{
  assert.equal(expedition.overallProgress({}).percent,0);
  assert.equal(expedition.overallProgress({separation:50,materialScanned:50,production:25,productScanned:10,expedition:0}).percent,21);
  assert.equal(expedition.overallProgress({separation:100,materialScanned:100,production:100,productScanned:100,expedition:100}).percent,100);
});

test('prévia da OP sem apontamento não é contada como produção',()=>{
  const result=expedition.quantities({meta:{source:'cut-op',productionTargets:[{quantity:5000}]},items:[{etiqueta:'',qtdNum:5000,feito:0,tags:[]}]});
  assert.equal(result.produced,0);
  assert.equal(result.scanned,0);
  assert.equal(result.producedPercent,0);
  assert.equal(result.scannedPercent,0);
});
