'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');

function source(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a);
  assert.ok(a>=0&&b>a,'trecho do aplicativo não encontrado: '+start);
  return app.slice(a,b);
}
const norm=s=>String(s==null?'':s).trim().toUpperCase();
const da=s=>norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const brNum=s=>Number(String(s==null?'':s).replace(',','.'))||0;

function sheetRows(){
  const rows=Array.from({length:17},()=>Array(55).fill(''));
  rows[5][28]='Nº ROMANEIO:';rows[5][37]='1419';
  rows[13][1]='Seq.';rows[13][2]='COD. PROD.';rows[13][5]='Nº DA BOBINA';
  rows[13][10]='LOTE';rows[13][13]='GRAMATURA';rows[13][18]='PESO BRUTO';rows[13][22]='PESO LIQUIDO';
  rows[13][28]='Seq.';rows[13][29]='COD. PROD.';rows[13][32]='Nº DA BOBINA';
  rows[13][37]='LOTE';rows[13][40]='GRAMATURA';rows[13][45]='PESO BRUTO';rows[13][49]='PESO LIQUIDO';
  rows[14][1]='001';rows[14][2]='11894';rows[14][5]='2600000001';rows[14][10]='4392';
  rows[14][13]='ART MAT PLAST 156GM² 360CM';rows[14][18]=322.5;rows[14][22]=318.66;
  rows[15][1]='002';rows[15][2]='11894';rows[15][5]='2600000002';rows[15][10]='4392';
  rows[15][13]='ART MAT PLAST 156GM² 360CM';rows[15][18]=308;rows[15][22]=304.16;
  return rows;
}

function parseFixture(){
  const ctx={window:{},session:{u:'admin'},da,brNum,norm};
  vm.createContext(ctx);
  vm.runInContext(source('  var CONV_MAP=', '  var CONV_BY_COD='),ctx);
  vm.runInContext(source('  function convNorm(', '  var CONV_CLOUD_KEY='),ctx);
  vm.runInContext(source('  function convExtraiMedidas(', '  /* recebe a descrição da NF'),ctx);
  vm.runInContext(source('  function convLookup(', '  window.convLookup=convLookup;'),ctx);
  vm.runInContext(source('  function romCell(', '  /* ---- NF manual'),ctx);
  return {ctx,parsed:ctx.parseRomaneioXLSX(sheetRows())};
}

test('romaneio conserva número físico e separa código Packem convertido',()=>{
  const {parsed}=parseFixture();
  assert.equal(parsed.ok,true);assert.equal(parsed.nRomaneio,'1419');assert.equal(parsed.items.length,2);
  assert.equal(parsed.items[0].bobina,'2600000001');assert.equal(parsed.items[0].codFornecedor,'11894');
  assert.equal(parsed.items[0].cProd,'0303450156');assert.equal(parsed.items[0].pesoLiquido,318.66);
  assert.match(parsed.items[0].descPackem,/^TEC\./);
  assert.equal(parsed.items[1].cProd,'0303450156');
});

function registerFixture(parsed){
  const calls={prints:0,drawer:0,bob:[],toasts:[],synced:[],catalog:[]};
  const ctx={window:{},ETQ:{},ROMS:{},BOB:{},romParsed:parsed,nfLocal:'PRE',session:{u:'admin'},
    document:{getElementById:()=>null,querySelector:()=>null},norm,brNum,nowISO:()=> '2026-10-01T12:00:00Z',
    saveNF(){},logAct(){},renderNF(){},setTimeout(){},toast:s=>calls.toasts.push(s),
    regBobFromEtq:(id,e,skipCloud)=>{calls.bob.push([id,e.cProd,skipCloud]);ctx.BOB[id]={pr:e.cProd,pl:e.kg};},
    syncBobDelta:async ids=>{calls.catalog.push([...ids]);return ids.length;},
    syncEtiquetasLote:async ids=>{calls.synced.push([...ids]);return true;},syncRomaneio:async()=>true,
    openRomBipDrawer:()=>{calls.drawer++;},openRomLabelSheet:()=>{calls.prints++;}
  };
  vm.createContext(ctx);
  vm.runInContext(source('  async function genRomLabels(){','  function openRomLabelSheet('),ctx);
  return {ctx,calls};
}

test('registrar romaneio usa o código de barras existente e abre a conferência sem imprimir',async()=>{
  const {parsed}=parseFixture(),{ctx,calls}=registerFixture(parsed);
  await ctx.genRomLabels();
  assert.deepEqual(Object.keys(ctx.ETQ).sort(),['2600000001','2600000002']);
  assert.equal(ctx.ETQ['2600000001'].bobina,'2600000001');
  assert.equal(ctx.ETQ['2600000001'].cProd,'0303450156');
  assert.equal(ctx.ETQ['2600000001'].kg,318.66);
  assert.equal(ctx.ROMS[parsed.key].supplierLabels,true);
  assert.equal(ctx.ROMS[parsed.key].supplierSource['2600000001'].code,'11894');
  assert.equal(calls.drawer,1);assert.equal(calls.prints,0);assert.equal(calls.synced[0].length,2);
  assert.equal(calls.bob.length,2);
  assert.equal(calls.bob[0][2],true);
  assert.equal(calls.catalog[0].length,2);
});

test('bobina repetida ou sem conversão bloqueia o romaneio inteiro antes do envio',async()=>{
  for(const change of [p=>{p.items[1].bobina=p.items[0].bobina;},p=>{p.items[1].cProd='';}]){
    const {parsed}=parseFixture();change(parsed);
    const {ctx,calls}=registerFixture(parsed);await ctx.genRomLabels();
    assert.equal(Object.keys(ctx.ETQ).length,0);assert.equal(calls.synced.length,0);
    assert.equal(calls.prints,0);assert.ok(calls.toasts.length);
  }
});

test('catálogo conflitante bloqueia registro e falha da nuvem pede reenvio',async()=>{
  const {parsed}=parseFixture();
  const {ctx,calls}=registerFixture(parsed);
  ctx.BOB['2600000001']={pr:'9999999999',pl:318.66};
  await ctx.genRomLabels();
  assert.equal(Object.keys(ctx.ETQ).length,0);
  assert.equal(calls.synced.length,0);
  delete ctx.BOB['2600000001'];
  ctx.syncBobDelta=async()=>{throw new Error('offline');};
  await ctx.genRomLabels();
  assert.equal(Object.keys(ctx.ETQ).length,2);
  assert.equal(calls.drawer,1);
  assert.ok(calls.toasts.some(t=>t.includes('não foi confirmado')));
});

test('scanner extrai a bobina entre cifrões e localiza o código Packem da planilha',()=>{
  const ctx={window:{},ETQ:{},ROMS:{'ROM-1419':{supplierLabels:true,supplierSource:{'2600000001':{code:'11894'},'2600000002':{code:'11894'}}}},norm};
  for(const id of ['2600000001','2600000002'])ctx.ETQ[id]={id,bobina:id,nf:'ROM-1419',nRomaneio:'1419',cProd:'0303450156'};
  vm.createContext(ctx);
  vm.runInContext(source('  function resolveRomSupplierScan(', '  window.resolveRomSupplierScan=resolveRomSupplierScan;'),ctx);
  assert.equal(ctx.resolveRomSupplierScan('2600000001').id,'2600000001');
  assert.equal(ctx.resolveRomSupplierScan('$2600000001$').id,'2600000001');
  assert.equal(ctx.resolveRomSupplierScan('41488$2600000001$11970$379$2$204').id,'2600000001');
  assert.equal(ctx.resolveRomSupplierScan('41488526000000015119705379S2S204').id,'2600000001');
  assert.equal(ctx.resolveRomSupplierScan('$2600000001$$2600000002$').ambiguous,true);
  assert.equal(ctx.resolveRomSupplierScan('2600999999'),null);
});

test('código de barras do fornecedor usa bobina importada no catálogo sem abrir NF',()=>{
  const ctx={window:{},ETQ:{},ROMS:{},BOB:{'2600256492':{pr:'0303450156',desc:'TEC.TUBULAR PP 156G 360CM',pl:318.66}},norm};
  vm.createContext(ctx);
  vm.runInContext(source('  function resolveRomSupplierScan(', '  window.resolveRomSupplierScan=resolveRomSupplierScan;'),ctx);
  assert.equal(ctx.resolveRomSupplierScan('$2600256492$').id,'2600256492');
  assert.equal(ctx.resolveRomSupplierScan('$2600256492$').supplier,false);
  assert.equal(ctx.resolveRomSupplierScan('41488$2600256492$11970$379$2$204').id,'2600256492');
  assert.equal(ctx.resolveRomSupplierScan('2600256492').id,'2600256492');
  assert.equal(ctx.resolveRomSupplierScan('$2600999999$').id,'2600999999');
});

test('OCR aceita número físico separado por espaços sem inventar ID em código longo',()=>{
  const ctx={};vm.createContext(ctx);
  vm.runInContext(source(' function supplierOcrIds(', ' function supplierOcrKnown('),ctx);
  assert.deepEqual(Array.from(ctx.supplierOcrIds('2600 267724\n11970')),['2600267724']);
  assert.deepEqual(Array.from(ctx.supplierOcrIds('41488526002677245119705361S333204')),[]);
  ctx.supplierOcrKnown=id=>id==='2600262229';
  assert.deepEqual(Array.from(ctx.supplierOcrIds('26002622294')),['2600262229']);
  assert.deepEqual(Array.from(ctx.supplierOcrIds('26002677249')),[]);
  assert.deepEqual(Array.from(ctx.supplierOcrLongCandidates('26002622294')),['2600262229','6002622294']);
  assert.deepEqual(Array.from(ctx.supplierOcrLongCandidates('41488526002622294119705361S333204')),[]);
});

test('câmera lê número de bobina em qualquer tela e mantém endereço somente no QR',()=>{
  const title={textContent:''},ctx={window:{},O:null,scanSeen:new Set(),scanIgnored:new Set(),document:{getElementById:()=>title},updateScanMode(){},open(){}};
  vm.createContext(ctx);
  vm.runInContext(source(' window.scanInto=function(', ' window.addCam=function('),ctx);
  ctx.window.scanInto('floorScan',{title:'Ler bobina no Chão'});
  assert.equal(ctx.O.scanMode,'auto');
  assert.equal(ctx.O.supplierOcr,true);
  ctx.window.scanInto('mLoc',{title:'Escanear endereço',scanKind:'addr'});
  assert.equal(ctx.O.scanMode,'qr');
  ctx.window.scanInto('rbdScan',{title:'Romaneio',supplierOcr:false});
  assert.equal(ctx.O.scanMode,'qr');
});

test('número físico fora do romaneio chega ao fluxo geral, mas não ao documento errado',()=>{
  const ctx={O:{keepOpenOnOcr:false},BOB:{},ETQ:{},ROMS:{}};
  vm.createContext(ctx);
  vm.runInContext(source(' function supplierOcrKnown(', ' function ocrRotate('),ctx);
  assert.equal(ctx.supplierOcrKnown('2600262229'),true);
  assert.equal(ctx.supplierOcrKnown('2600262229',true),false);
  ctx.ETQ['2600262229']={nf:'ROM-OUTRO'};
  ctx.ROMS['ROM-OUTRO']={supplierLabels:true};
  ctx.O={keepOpenOnOcr:true,allowedDocKey:'ROM-1367 - A'};
  assert.equal(ctx.supplierOcrKnown('2600262229'),false);
  ctx.O.allowedDocKey='ROM-OUTRO';
  assert.equal(ctx.supplierOcrKnown('2600262229'),true);
});

test('importação da planilha salva bobinas no catálogo e confirma na nuvem sem gerar NF',async()=>{
  const {parsed}=parseFixture(),calls={saved:0,cloud:[],toasts:[]},button={disabled:false,isConnected:true};
  const ctx={window:{_bobReady:true},BOB:{},supplierSheet:parsed,session:{u:'admin'},norm,nowISO:()=> '2026-10-01T12:00:00Z',
    document:{getElementById:id=>id==='supplierSave'?button:{textContent:''},querySelector:q=>{const i=Number(q.match(/="(\d+)"/)[1]);return {value:q.includes('code')?parsed.items[i].cProd:parsed.items[i].descPackem};}},
    saveBOB:()=>{calls.saved++;},_bobIDB:{set:async()=>{}},syncBobDelta:async ids=>{calls.cloud.push([...ids]);return ids.length;},
    logAct(){},renderSupplierCatalog(){},toast:t=>calls.toasts.push(t)};
  vm.createContext(ctx);
  vm.runInContext(source('async function saveSupplierSheet(){','function bobImportUI(){'),ctx);
  await ctx.saveSupplierSheet();
  assert.equal(Object.keys(ctx.BOB).length,2);
  assert.equal(ctx.BOB['2600000001'].pr,'0303450156');
  assert.equal(ctx.BOB['2600000001'].pl,318.66);
  assert.equal(calls.saved,1);assert.equal(calls.cloud[0].length,2);
  assert.equal(ctx.supplierSheet,null);
});

test('bobinas do romaneio entram em sequência no Chão 70, sem duplicar',()=>{
  const ctx={window:{},ETQ:{},ROMS:{'ROM-1419':{supplierLabels:true,local:'TEXTIL',nRomaneio:'1419',supplierSource:{'2600000001':{code:'11894'},'2600000002':{code:'11894'}}}},NFS:{},
    STAGE:[],norm,fmt:q=>String(q).replace('.',','),nowISO:()=> '2026-10-01T12:00:00Z',session:{u:'admin'},
    saveNF(){},logAct(){},syncEtiqueta(){},renderNF(){},toast(){},document:{querySelector:()=>null}};
  ctx.ETQ['2600000001']={id:'2600000001',nf:'ROM-1419',nRomaneio:'1419',bobina:'2600000001',cProd:'0303450156',xProd:'ART MAT PLAST 156G 360CM',kg:318.66,status:'gerada',hist:[]};
  ctx.ETQ['2600000002']={id:'2600000002',nf:'ROM-1419',nRomaneio:'1419',bobina:'2600000002',cProd:'0303450156',xProd:'ART MAT PLAST 156G 360CM',kg:304.16,status:'gerada',hist:[]};
  const received=[];ctx.window.f70Entrada=it=>{received.push(it.et);assert.equal(it.pr,'0303450156');return true;};
  vm.createContext(ctx);
  vm.runInContext(source('  function resolveRomSupplierScan(', '  window.resolveRomSupplierScan=resolveRomSupplierScan;'),ctx);
  vm.runInContext(source('  function nfRecvBip(v){','  /* Etiquetas pertencentes à geração atual'),ctx);
  ctx.nfRecvBip('41488$2600000001$11970$379$2$204');
  ctx.nfRecvBip('2600000001');
  ctx.nfRecvBip('2600000002');
  assert.deepEqual(received,['2600000001','2600000002']);
  assert.equal(ctx.ETQ['2600000001'].status,'entrada');
  assert.equal(ctx.ETQ['2600000002'].status,'entrada');
  assert.equal(ctx.STAGE.length,0);
  for(const id of received){assert.equal(ctx.ETQ[id].hist[0].ev,'entrada-chao70');assert.equal(ctx.ETQ[id].hist.length,1);}
});

test('Recebimento geral encaminha o fornecedor ao fluxo fiscal e não imprime',async()=>{
  const calls={received:[],printed:0,toasts:[]};
  const ctx={window:{resolveRomSupplierScan:v=>v==='$2600000001$'?{id:'2600000001',supplier:true}:{ambiguous:true},nfRecvBip:v=>calls.received.push(v)},isAdmin:()=>true,toast:s=>calls.toasts.push(s),stationPrint:()=>{calls.printed++;}};
  vm.createContext(ctx);
  vm.runInContext(source('async function recvAdd(v){','function renderRecv(){'),ctx);
  await ctx.recvAdd('2600000001');
  await ctx.recvAdd('$2600000001$');
  assert.deepEqual(calls.received,['$2600000001$']);
  assert.equal(calls.printed,0);
  assert.equal(calls.toasts.length,1);
});

test('bobina física do catálogo entra no Recebimento normal sem imprimir etiqueta Packem',async()=>{
  const calls={nf:0,printed:0,saved:0},ctx={window:{resolveRomSupplierScan:()=>({id:'2600256492',supplier:false}),nfRecvBip:()=>{calls.nf++;}},
    BOB:{'2600256492':{pr:'0303450156',desc:'TEC.TUBULAR PP 156G 360CM',pl:318.66}},STAGE:[],norm,
    isAdmin:()=>true,nowISO:()=> '2026-10-01T12:00:00Z',session:{u:'admin'},saveStage:()=>{calls.saved++;},
    syncStage(){},markLocalWrite(){},renderRecv(){},updateStageBadge(){},toast(){},fmt:x=>String(x),unitOf:()=> 'KG',stationPrint(){calls.printed++;}};
  vm.createContext(ctx);
  vm.runInContext(source('async function recvAdd(v){','function renderRecv(){'),ctx);
  await ctx.recvAdd('41488$2600256492$11970');
  await ctx.recvAdd('41488$2600256492$11970');
  assert.equal(ctx.STAGE.length,1);
  assert.equal(ctx.STAGE[0].et,'2600256492');
  assert.equal(ctx.STAGE[0].pr,'0303450156');
  assert.equal(calls.nf,0);assert.equal(calls.printed,0);assert.equal(calls.saved,1);
});
